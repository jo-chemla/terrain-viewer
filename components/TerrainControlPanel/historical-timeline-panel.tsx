import type React from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { ChevronDown, Link2, Settings2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWaybackItemsWithLocalChanges, useWaybackCaptureDate, useWaybackRealCaptureDates, sortByDateAscending } from "@/lib/wayback"
import { syntheticHlsTicks } from "@/lib/hls"
import { useGeHistoricalDates } from "@/lib/ge-historical"
import { planetMonthlyTicks } from "@/lib/planet"
import { useBingCaptureDate } from "@/lib/bing"
import { eoxS2CloudlessTicks } from "@/lib/eox-s2-cloudless"
import { TIMELINE_SOURCE_IDS, resolveActiveHistoricalSource } from "@/lib/historical-sources"
import { planetKeyAtom } from "@/lib/settings-atoms"
import { historicalTimelinePanelHeightAtom } from "@/lib/layout-constants"
import { isSidebarOpenAtom } from "@/components/TerrainControlPanel/TerrainControlPanel"
import { useIsMobile } from "@/hooks/use-mobile"
import { OpenInLinksButton } from "@/components/TerrainControlPanel/open-in-links"
import type { MapRef } from "react-map-gl/maplibre"

// Persisted (not plain local state) — this was the actual cause behind "no
// matter what I do, dragging one side always drags the other": sync
// defaulted to on every fresh page load/reload, so turning it off in one
// session silently reverted on the next. Now an explicit "off" sticks.
const historicalTimelineSyncAtom = atomWithStorage("historicalTimelineSync", true)

// Hardcoded (not var(--primary)/theme tokens) deliberately — same reasoning
// as the geolocate control's active/error state colors (src/index.css): A/B
// need to read as the same two colors regardless of which color preset is
// active, since they're a stable visual convention (blue=A, green=B) shared
// with the timeline captions and the sidebar's own SourceAbToggle meaning,
// not a themeable decoration.
const COLOR_A = "#3b82f6"
const COLOR_B = "#22c55e"

// Minimum pixel gap between two adjacent year labels before the later one is
// dropped — same idea as a chart axis thinning its tick labels, so a dense
// multi-decade range never renders overlapping text.
const MIN_YEAR_LABEL_GAP_PX = 32

// Registry of aggregatable timeline sources — the pill row below toggles
// membership in state.timelineSources (or its per-side A/B variants), and
// each tick is colored by its source so a merged wayback+HLS timeline still
// reads as two distinct series. resClass is a coarse, per-SOURCE (not
// per-tile) resolution bucket used by the VHR/Medium chips below —
// Wayback/GE Historical/Bing are all sub-meter-ish "very high resolution"
// mosaics, while HLS (Landsat/Sentinel-2, 10-30m) and Planet (~4.7m
// PlanetScope) read as coarser "medium" imagery next to them. Object order
// here is also the pill row's display order.
//
// Colors are each source's own brand color where one applies, pastelized
// (Esri green, Google blue) — Bing's own teal read too close to both of
// those side by side, so it takes the purple originally picked for HLS
// instead; HLS/Planet/EOX (none with one clean owning brand, or whose real
// brand color would've clashed) get distinct neutral pastels — orange,
// pink, red — chosen so all 6 remain clearly distinguishable next to each
// other. Pill "active" text uses a dark slate instead of white (see the
// pill button below) since white-on-pastel has poor contrast.
// label is the short pill/caption text; fullLabel is what shows in the
// pill's own hover tooltip — a few of these (Google Earth, EOX, HLS) got
// shortened to keep the pill row from wrapping, so the full descriptive
// name needs to live somewhere still discoverable.
const SOURCE_CONFIG: Record<string, { label: string; fullLabel: string; color: string; resClass: "vhr" | "medium" }> = {
  wayback: { label: "ESRI Wayback", fullLabel: "ESRI World Imagery Wayback", color: "#cbe4bd", resClass: "vhr" }, // Esri green (#7ebc59), pastelized
  "ge-historical": { label: "Google Earth", fullLabel: "Google Earth Historical", color: "#aecbfa", resClass: "vhr" }, // Google's own Material "blue-100"
  bing: { label: "Bing Single", fullLabel: "Bing Maps (single current mosaic)", color: "#c4b5fd", resClass: "vhr" }, // pastel purple (too close to Esri/Google's own teal otherwise)
  planet: { label: "Planet Monthly", fullLabel: "Planet Global Monthly Basemap", color: "#fdba74", resClass: "medium" }, // pastel orange
  "eox-s2": { label: "EOX Sentinel 2", fullLabel: "EOX Sentinel-2 Cloudless (Yearly)", color: "#fca5a5", resClass: "medium" }, // pastel red
  hls: { label: "NASA HLS", fullLabel: "NASA Harmonized Landsat Sentinel-2", color: "#f9a8d4", resClass: "medium" }, // pastel pink
}
const SOURCE_IDS = Object.keys(SOURCE_CONFIG)

const RESOLUTION_CLASSES: { id: "vhr" | "medium"; label: string }[] = [
  { id: "vhr", label: "VHR" },
  { id: "medium", label: "Medium res" },
]

type TimelineTick = { source: string; key: number; dateMs: number; label: string }

// Zoom-window bounds for the mousewheel handler below — a floor so the
// visible span never collapses to near-nothing (even Wayback rarely has
// multiple releases closer than ~2 weeks apart at one spot), a factor
// controlling how much each wheel tick zooms by.
const MIN_VISIBLE_SPAN_MS = 1000 * 60 * 60 * 24 * 14
const ZOOM_FACTOR = 0.85

// A Wayback tick's own release/mosaic label (t.label, from releaseDateLabel)
// is a catalog-wide publish date — the REAL per-tile imagery date can differ
// (see lib/wayback.ts) and is now what the tick is actually POSITIONED at
// (see useWaybackRealCaptureDates in the parent), so it's already resolved
// by the time this renders — no separate per-hover fetch needed anymore.
const WaybackTickMark: React.FC<{ tick: TimelineTick; leftPct: number; realLabel: string | null }> = ({ tick, leftPct, realLabel }) => {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-11 cursor-help"
            style={{ left: `${leftPct}%` }}
          >
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 mx-auto w-1"
              style={{ backgroundColor: SOURCE_CONFIG.wayback.color, opacity: 0.85 }}
            />
          </div>
        }
      />
      <TooltipContent>
        <div>{realLabel ?? tick.label}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">Mosaic: {tick.label}</div>
      </TooltipContent>
    </Tooltip>
  )
}

export const HistoricalTimelinePanel: React.FC<{ state: any; setState: (updates: any) => void; mapRef: React.RefObject<MapRef> }> = ({ state, setState, mapRef }) => {
  const collapsed = !!state.historicalTimelineCollapsed
  const setCollapsed = useCallback((v: boolean) => setState({ historicalTimelineCollapsed: v }), [setState])
  const [activeSide, setActiveSide] = useState<"A" | "B">("A")
  const [syncEnabled, setSyncEnabled] = useAtom(historicalTimelineSyncAtom)
  // Expanded by default: title + source/resolution pills + sync/A-B shown.
  // Toggled off via the cog button for a minimal header (just a small
  // floating cog+collapse cluster hovering over the track's top-right
  // corner, no separate title/pills row at all). Lifted to shared state
  // (not local) — TerrainViewer needs to know it too, since the panel is
  // visibly shorter in minimal mode and the minimap/scale/attribution
  // clearance above it differs between the two.
  const controlsExpanded = state.historicalControlsExpanded !== false
  const setControlsExpanded = useCallback((updater: boolean | ((v: boolean) => boolean)) => {
    const next = typeof updater === "function" ? updater(controlsExpanded) : updater
    setState({ historicalControlsExpanded: next })
  }, [controlsExpanded, setState])
  const [trackWidth, setTrackWidth] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const setPanelHeight = useSetAtom(historicalTimelinePanelHeightAtom)
  // null = full extent (no zoom applied) — see the wheel-zoom handler below.
  const [viewWindow, setViewWindow] = useState<{ min: number; max: number } | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  // Drag state for the horizontal pan gutter below the track — a plain ref
  // (not state) since it only needs to survive across pointermove events
  // within one drag gesture, not trigger renders itself.
  const gutterDragRef = useRef<{ startClientX: number; startMin: number; gutterWidthPx: number } | null>(null)
  const [planetKey] = useAtom(planetKeyAtom)
  const hasPlanetKey = !!planetKey
  const [isSidebarOpen] = useAtom(isSidebarOpenAtom)
  const isMobile = useIsMobile()

  const rawBasemapSourceA = state.basemapPerView ? state.basemapSourceA : state.basemapSource
  const rawBasemapSourceB = state.basemapPerView ? state.basemapSourceB : state.basemapSource
  const activeBasemapSourceA = resolveActiveHistoricalSource(rawBasemapSourceA, state.basemapPerView ? state.historicalActiveSourceA : state.historicalActiveSource)
  const activeBasemapSourceB = resolveActiveHistoricalSource(rawBasemapSourceB, state.basemapPerView ? state.historicalActiveSourceB : state.historicalActiveSource)
  const aIsHistorical = TIMELINE_SOURCE_IDS.has(activeBasemapSourceA)
  const bIsHistorical = TIMELINE_SOURCE_IDS.has(activeBasemapSourceB)
  // A and B only ever show as independently-draggable when they're genuinely
  // independent views (per-view basemap AND split-screen both on) — in every
  // other mode activeBasemapSourceA === activeBasemapSourceB by construction
  // (see TerrainViewer.tsx), so a second handle would just shadow the first.
  const dualMode = state.basemapPerView && state.splitScreen
  const showA = aIsHistorical
  const showB = dualMode && bIsHistorical
  // Sync only ever governs which SOURCE/RESOLUTION PILLS are toggled on
  // (shared vs. per-side, see pillsField below) — it has never applied to
  // the actual scrubber selection (which tick/date is active). A and B
  // always get their own independent handle and their own independent
  // date, full stop, even if they happen to coincide (e.g. both set to
  // Planet Monthly 2023-12) — that's just two handles landing on the same
  // spot, not a "linked" state.
  const dualUnsynced = dualMode && !syncEnabled

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => setTrackWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Reports the panel's own actual rendered height (border box, so
  // TerrainViewer's clearance above it is exact) — expanded vs. minimal mode
  // and the pill row wrapping onto a second line all change this, so a
  // static guessed constant elsewhere was never right for every case.
  // useLayoutEffect (not useEffect) deliberately — a plain effect only runs
  // AFTER the browser paints, so the panel's first-ever frame (or the frame
  // right after toggling expanded/minimal) would briefly paint using the
  // unmeasured 13rem fallback in TerrainViewer before the observer's
  // callback fires and corrects it one frame later — a real, if brief,
  // "wrong margin" flash. Measuring synchronously before paint (here) plus
  // keeping the observer for subsequent size changes avoids that.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    setPanelHeight(el.getBoundingClientRect().height)
    const observer = new ResizeObserver(() => setPanelHeight(el.getBoundingClientRect().height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [setPanelHeight])

  const { items: rawWaybackItems } = useWaybackItemsWithLocalChanges(state.lat, state.lng, state.zoom)
  // Newest release at this location — used by the "Open in..." ESRI Wayback
  // link (lib/open-in-links.tsx) instead of a hardcoded release id.
  const latestWaybackRelease = useMemo(
    () => rawWaybackItems.reduce<number | null>((max, item) => (max === null || item.releaseNum > max ? item.releaseNum : max), null),
    [rawWaybackItems],
  )
  // REAL per-tile imagery capture dates for every release at this location —
  // ticks are positioned by these (the actual date the imagery was taken),
  // not each release's own releaseDatetime (a catalog-wide publish date that
  // can differ significantly from the real capture date). Falls back to
  // releaseDatetime for any release whose real date hasn't resolved yet —
  // EXCEPT ticks aren't actually rendered until they resolve (see the
  // waybackDatesLoading gate below): showing them at the wrong (layer-date)
  // position first and then jumping to the real position a moment later
  // read as more confusing than a brief "computing…" gap.
  const { resolved: waybackRealDates, loading: waybackDatesLoading } = useWaybackRealCaptureDates(rawWaybackItems, state.lat, state.lng, state.zoom)
  const waybackTicks = useMemo<TimelineTick[]>(
    () => waybackDatesLoading ? [] : sortByDateAscending(rawWaybackItems).map((item) => {
      const real = waybackRealDates[item.releaseNum]
      return {
        source: "wayback", key: item.releaseNum,
        dateMs: real?.dateMs ?? item.releaseDatetime,
        label: item.releaseDateLabel,
      }
    }),
    [rawWaybackItems, waybackRealDates, waybackDatesLoading],
  )
  // No per-location catalog exists for HLS — these are evenly-spaced
  // placeholder monthly points (see lib/hls.ts), not verified real capture
  // dates the way Wayback's are.
  const hlsTicks = useMemo<TimelineTick[]>(
    () => syntheticHlsTicks().map((t) => ({ source: "hls", key: t.dateMs, dateMs: t.dateMs, label: t.label })),
    [],
  )
  const { items: rawGeItems } = useGeHistoricalDates(state.lat, state.lng, state.zoom)
  const geTicks = useMemo<TimelineTick[]>(
    () => rawGeItems.map((t) => ({ source: "ge-historical", key: t.dateMs, dateMs: t.dateMs, label: t.label })),
    [rawGeItems],
  )
  // Real monthly mosaics (see lib/planet.ts) — only generated once a Planet
  // API key is set; otherwise this source simply contributes no ticks and
  // its pill is hidden below.
  const planetTicks = useMemo<TimelineTick[]>(
    () => (hasPlanetKey ? planetMonthlyTicks().map((t) => ({ source: "planet", key: t.dateMs, dateMs: t.dateMs, label: t.label })) : []),
    [hasPlanetKey],
  )
  // Bing has no browsable historical archive — just its single "current"
  // mosaic — so this is always at most a one-item pool: the real capture
  // date for the current view center (see lib/bing.ts), keyed by that same
  // date so releaseForSide/findTick below work identically to every other
  // source even though there's nothing to actually scrub through.
  const { label: bingCaptureLabel, dateMs: bingCaptureDateMs } = useBingCaptureDate(state.lat, state.lng, state.zoom)
  const bingTicks = useMemo<TimelineTick[]>(
    () => (bingCaptureDateMs ? [{ source: "bing", key: bingCaptureDateMs, dateMs: bingCaptureDateMs, label: bingCaptureLabel ?? "" }] : []),
    [bingCaptureDateMs, bingCaptureLabel],
  )
  // Real yearly mosaics (see lib/eox-s2-cloudless.ts) — a fixed, known list of
  // published years, free/no-key like Wayback/GE Historical/Bing.
  const eoxS2Ticks = useMemo<TimelineTick[]>(
    () => eoxS2CloudlessTicks().map((t) => ({ source: "eox-s2", key: t.dateMs, dateMs: t.dateMs, label: t.label })),
    [],
  )
  const allTicks = useMemo(
    () => [...waybackTicks, ...hlsTicks, ...geTicks, ...planetTicks, ...bingTicks, ...eoxS2Ticks].sort((a, b) => a.dateMs - b.dateMs),
    [waybackTicks, hlsTicks, geTicks, planetTicks, bingTicks, eoxS2Ticks],
  )
  const findTick = useCallback(
    (source: string, key: number) => allTicks.find((t) => t.source === source && t.key === key) ?? null,
    [allTicks],
  )

  const visibleSourceIds = useMemo(() => SOURCE_IDS.filter((id) => id !== "planet" || hasPlanetKey), [hasPlanetKey])

  // Which pill-toggle array the source/resolution chips edit: the shared
  // state.timelineSources when synced (or single-view), or whichever side is
  // currently active (via the A|B picker below) when in dual mode with sync
  // off — letting each side aggregate a different subset of sources (e.g.
  // Wayback+GE for map A, HLS+Bing for map B).
  const pillsField = dualUnsynced ? (activeSide === "A" ? "timelineSourcesA" : "timelineSourcesB") : "timelineSources"
  const timelineSourcesForPills: string[] = state[pillsField]?.length ? state[pillsField] : visibleSourceIds
  const toggleSource = useCallback((id: string) => {
    const set = new Set(timelineSourcesForPills)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    // Never allow zero sources selected — collapsing to none would make the
    // timeline unusable with no way back in through the UI.
    setState({ [pillsField]: set.size ? Array.from(set) : [id] })
  }, [timelineSourcesForPills, pillsField, setState])

  // Re-enabling sync switches the pill row's source back to the shared
  // state.timelineSources field — but that field sits untouched the whole
  // time sync is off (edits go to timelineSourcesA/B instead), so it can
  // hold a stale value from before the user ever unsynced. Without this,
  // toggling sync back on could silently swap the visible pills to that old
  // set instead of whatever the user was just looking at — adopt the
  // currently-active side's live selection as the new shared value instead.
  const toggleSync = useCallback(() => {
    if (!syncEnabled) setState({ timelineSources: timelineSourcesForPills })
    setSyncEnabled(!syncEnabled)
  }, [syncEnabled, timelineSourcesForPills, setState, setSyncEnabled])

  const resolutionClasses: string[] = state.resolutionClasses?.length ? state.resolutionClasses : ["vhr", "medium"]
  const toggleResolutionClass = useCallback((id: string) => {
    const set = new Set(resolutionClasses)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    // Same "never allow zero" rule as toggleSource above.
    setState({ resolutionClasses: set.size ? Array.from(set) : [id] })
  }, [resolutionClasses, setState])

  // Ticks/gridlines only ever show sources currently toggled on via the pill
  // row (both the source pills and the VHR/Medium res chips) — but a side's
  // OWN active handle (below) still resolves against allTicks, so switching a
  // pill off doesn't strand an already-picked date. When unsynced in dual
  // mode, this is scoped to whichever side is currently active (activeSide) —
  // clicking "A" shows only A's chosen sources' ticks, clicking "B" shows
  // only B's, per the user's request (not a union of both).
  const items = useMemo(
    () => allTicks.filter((t) => timelineSourcesForPills.includes(t.source) && resolutionClasses.includes(SOURCE_CONFIG[t.source]?.resClass)),
    [allTicks, timelineSourcesForPills, resolutionClasses],
  )

  const releaseForSide = useCallback((side: "A" | "B"): number => {
    const basemapSource = side === "A" ? activeBasemapSourceA : activeBasemapSourceB
    if (basemapSource === "wayback") {
      return side === "A" ? (state.basemapPerView ? state.waybackReleaseA : state.waybackRelease) : state.waybackReleaseB
    }
    if (basemapSource === "hls") {
      return side === "A" ? (state.basemapPerView ? state.hlsDateA : state.hlsDate) : state.hlsDateB
    }
    if (basemapSource === "ge-historical") {
      return side === "A" ? (state.basemapPerView ? state.geDateA : state.geDate) : state.geDateB
    }
    if (basemapSource === "planet") {
      return side === "A" ? (state.basemapPerView ? state.planetDateA : state.planetDate) : state.planetDateB
    }
    if (basemapSource === "bing") {
      return side === "A" ? (state.basemapPerView ? state.bingDateA : state.bingDate) : state.bingDateB
    }
    if (basemapSource === "eox-s2") {
      return side === "A" ? (state.basemapPerView ? state.eoxS2DateA : state.eoxS2Date) : state.eoxS2DateB
    }
    return 0
  }, [activeBasemapSourceA, activeBasemapSourceB, state.basemapPerView, state.waybackRelease, state.waybackReleaseA, state.waybackReleaseB, state.hlsDate, state.hlsDateA, state.hlsDateB, state.geDate, state.geDateA, state.geDateB, state.planetDate, state.planetDateA, state.planetDateB, state.bingDate, state.bingDateA, state.bingDateB, state.eoxS2Date, state.eoxS2DateA, state.eoxS2DateB])

  const dateFieldFor = useCallback((source: string, side: "A" | "B") => {
    if (source === "wayback") return side === "A" ? (state.basemapPerView ? "waybackReleaseA" : "waybackRelease") : "waybackReleaseB"
    if (source === "hls") return side === "A" ? (state.basemapPerView ? "hlsDateA" : "hlsDate") : "hlsDateB"
    if (source === "ge-historical") return side === "A" ? (state.basemapPerView ? "geDateA" : "geDate") : "geDateB"
    if (source === "bing") return side === "A" ? (state.basemapPerView ? "bingDateA" : "bingDate") : "bingDateB"
    if (source === "eox-s2") return side === "A" ? (state.basemapPerView ? "eoxS2DateA" : "eoxS2Date") : "eoxS2DateB"
    return side === "A" ? (state.basemapPerView ? "planetDateA" : "planetDate") : "planetDateB"
  }, [state.basemapPerView])

  // A side's basemapSource(A/B) is either a normal basemap id or the single
  // combined "historical" entry. Picking a non-Bing tick sets that field to
  // "historical" plus records WHICH concrete source is now active for that
  // side (historicalActiveSource(A/B)) — Bing bypasses the indirection
  // entirely and is written directly, same as any other plain basemap id.
  const buildTickUpdates = useCallback((side: "A" | "B", tick: TimelineTick): Record<string, any> => {
    const sourceField = side === "A" ? (state.basemapPerView ? "basemapSourceA" : "basemapSource") : "basemapSourceB"
    const updates: Record<string, any> = { [dateFieldFor(tick.source, side)]: tick.key }
    if (tick.source === "bing") {
      updates[sourceField] = "bing"
    } else {
      updates[sourceField] = "historical"
      const activeSourceField = side === "A" ? (state.basemapPerView ? "historicalActiveSourceA" : "historicalActiveSource") : "historicalActiveSourceB"
      updates[activeSourceField] = tick.source
    }
    return updates
  }, [state.basemapPerView, dateFieldFor])

  const setTickForSide = useCallback((side: "A" | "B", tick: TimelineTick) => {
    setState(buildTickUpdates(side, tick))
  }, [buildTickUpdates, setState])

  // Absent an explicit pointer target (e.g. a keyboard step), which side an
  // action applies to: the only historical side when just one is showing,
  // otherwise whichever side the user last touched (activeSide).
  const resolveSide = useCallback((): "A" | "B" => {
    if (!dualMode) return "A"
    if (showA && !showB) return "A"
    if (showB && !showA) return "B"
    return activeSide
  }, [dualMode, showA, showB, activeSide])

  // First time either side lands on a historical source with no date picked
  // yet, jump straight to the newest available tick for THAT side's active
  // source rather than rendering nothing until the user manually picks one.
  useEffect(() => {
    if (showA && !releaseForSide("A")) {
      const pool = allTicks.filter((t) => t.source === activeBasemapSourceA)
      if (pool.length) setTickForSide("A", pool[pool.length - 1])
    }
    if (showB && !releaseForSide("B")) {
      const pool = allTicks.filter((t) => t.source === activeBasemapSourceB)
      if (pool.length) setTickForSide("B", pool[pool.length - 1])
    }
  }, [showA, showB, activeBasemapSourceA, activeBasemapSourceB, allTicks, releaseForSide, setTickForSide])

  const fullMin = items[0]?.dateMs ?? 0
  const fullMax = items[items.length - 1]?.dateMs ?? fullMin + 1
  const fullSpan = Math.max(1, fullMax - fullMin)

  // Re-clamp a zoomed window whenever the full extent itself shifts (e.g. a
  // pill toggle shrinks the dataset) so a stale window can't reference dates
  // outside the new full range.
  useEffect(() => {
    if (!viewWindow) return
    const min = Math.max(fullMin, viewWindow.min)
    const max = Math.min(fullMax, viewWindow.max)
    if (max <= min) { setViewWindow(null); return }
    if (min !== viewWindow.min || max !== viewWindow.max) setViewWindow({ min, max })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullMin, fullMax])

  const effectiveMin = viewWindow ? Math.max(fullMin, viewWindow.min) : fullMin
  const effectiveMax = viewWindow ? Math.min(fullMax, viewWindow.max) : fullMax
  const effectiveSpan = Math.max(1, effectiveMax - effectiveMin)
  const fracForTick = useCallback((tick: TimelineTick) => Math.min(1, Math.max(0, (tick.dateMs - effectiveMin) / effectiveSpan)), [effectiveMin, effectiveSpan])

  // Only ticks inside the current zoom window actually render — clamping
  // their frac to [0,1] instead (piling up out-of-window ticks at the edges)
  // would misleadingly suggest they're at the boundary.
  const visibleItems = useMemo(() => items.filter((t) => t.dateMs >= effectiveMin && t.dateMs <= effectiveMax), [items, effectiveMin, effectiveMax])

  // Ticks from DIFFERENT sources can legitimately land on the same or
  // near-same date (e.g. Planet's and HLS's synthetic monthly ticks both
  // falling on the 1st) and would otherwise render pixel-on-pixel. A small
  // left-to-right sweep nudges each one just far enough from its immediate
  // left neighbor to stay visually distinct — a few pixels' worth of "a very
  // little", not a real repositioning; only used for DRAWING, the
  // underlying date each tick represents is untouched.
  // Each tick's hit-box/mark is 8px wide (w-2, centered via -translate-x-1/2)
  // — a 5px gap between centers still left two neighbors' 8px-wide marks
  // overlapping by ~3px, which is why this read as "not working" on a real
  // EOX/Planet January collision. 10px clears the full tick width plus a
  // couple pixels of visible daylight between them.
  const MIN_TICK_GAP_PX = 10
  const nudgedLeftPct = useMemo(() => {
    const map = new Map<string, number>()
    if (!trackWidth) return map
    const sorted = [...visibleItems].sort((a, b) => fracForTick(a) - fracForTick(b))
    const positions = sorted.map((t) => fracForTick(t) * trackWidth)
    // Forward pass: push each tick at least MIN_TICK_GAP_PX right of its
    // predecessor.
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] - positions[i - 1] < MIN_TICK_GAP_PX) positions[i] = positions[i - 1] + MIN_TICK_GAP_PX
    }
    // A long run of tightly-packed ticks near the right edge had nothing
    // stopping the forward pass above from pushing the tail PAST the
    // track's own right boundary — since the track sits inside a fixed-
    // position panel with no clipping, an overflowing tick rendered fully
    // outside it, visibly floating over the map. Backward pass: clamp the
    // last tick to the track width, then walk backward pulling any tick
    // that's now within MIN_TICK_GAP_PX of its right neighbor left just
    // enough to keep the gap — compressing spacing below the ideal minimum
    // only under genuinely extreme crowding, but never overflowing.
    if (positions.length) {
      positions[positions.length - 1] = Math.min(positions[positions.length - 1], trackWidth)
      for (let i = positions.length - 2; i >= 0; i--) {
        if (positions[i + 1] - positions[i] < MIN_TICK_GAP_PX) positions[i] = positions[i + 1] - MIN_TICK_GAP_PX
      }
    }
    sorted.forEach((t, i) => {
      // Final hard clamp — if there are simply more ticks than trackWidth /
      // MIN_TICK_GAP_PX can fit, the backward pass above can still drive
      // early positions negative; clamping to [0, trackWidth] guarantees no
      // tick ever renders outside the track no matter how crowded, even if
      // that means some neighbors end up overlapping.
      const px = Math.max(0, Math.min(trackWidth, positions[i]))
      map.set(`${t.source}-${t.key}`, (px / trackWidth) * 100)
    })
    return map
  }, [visibleItems, fracForTick, trackWidth])
  const tickLeftPct = useCallback((t: TimelineTick) => nudgedLeftPct.get(`${t.source}-${t.key}`) ?? fracForTick(t) * 100, [nudgedLeftPct, fracForTick])

  // Full-year gridlines/labels, independent of where actual ticks fall —
  // reads as a normal calendar axis rather than one tick per release. Rather
  // than generating one mark per year and then greedily dropping whichever
  // ones end up too close together (which still leaves a cluttered "every
  // year, several missing" axis on a multi-decade span), this picks a nice
  // round step (1/2/5/10/20/25/50/100 years) up front — the smallest step
  // whose marks are guaranteed at least MIN_YEAR_LABEL_GAP_PX apart — so a
  // long span reads as a clean "every 5 years" or "every 10 years" axis
  // instead of a sparse, irregular subset of individual years.
  const YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100]
  const yearMarks = useMemo(() => {
    if (!items.length || !trackWidth) return [] as { frac: number; label: string }[]
    const startYear = new Date(effectiveMin).getFullYear()
    const endYear = new Date(effectiveMax).getFullYear()
    const msPerYear = 365.25 * 86_400_000
    const pxPerYear = trackWidth / (effectiveSpan / msPerYear)
    let step = YEAR_STEPS[YEAR_STEPS.length - 1]
    for (const s of YEAR_STEPS) {
      if (pxPerYear * s >= MIN_YEAR_LABEL_GAP_PX) { step = s; break }
    }
    const marks: { frac: number; label: string }[] = []
    const firstMarkYear = Math.ceil(startYear / step) * step
    for (let y = firstMarkYear; y <= endYear; y += step) {
      const t = new Date(y, 0, 1).getTime()
      if (t < effectiveMin || t > effectiveMax) continue
      marks.push({ frac: (t - effectiveMin) / effectiveSpan, label: String(y) })
    }
    // A zoomed-in window can span a single year without ever containing that
    // year's Jan 1 boundary (e.g. zoomed to Mar-Sep 2020) — the step logic
    // above only places marks AT those boundaries, so it can come up
    // completely empty and read as "the year label just disappeared". Always
    // show at least the window's own start year, anchored to the left edge.
    if (!marks.length) marks.push({ frac: 0, label: String(startYear) })
    return marks
  }, [items.length, effectiveMin, effectiveMax, effectiveSpan, trackWidth])

  // Nearest-tick search still considers the FULL (pill-filtered but not
  // zoom-windowed) items list — a background click near the zoomed-in
  // track's edge can still jump to a tick just outside the current view.
  //
  // Distance is measured against each tick's NUDGED draw position
  // (tickLeftPct), not its raw chronological position (fracForTick) — a tick
  // that got nudged a few px away from its true date to stay visually
  // distinct from a same-day neighbor was still being hit-tested at its
  // true (unnudged) position, so clicking/dragging exactly onto the visible
  // dot could resolve to the WRONG tick (whichever was truly closest by
  // date), reading as "can't select the tick that's right there". Ticks
  // outside the current zoom window have no nudged position (tickLeftPct
  // falls back to fracForTick for those), which is fine since they aren't
  // rendered anyway — only an approximate "jump near the edge" target.
  const nearestTickForClientX = useCallback((clientX: number): TimelineTick | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !items.length) return null
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    let best = items[0]
    let bestDist = Math.abs(tickLeftPct(items[0]) / 100 - frac)
    for (const t of items) {
      const d = Math.abs(tickLeftPct(t) / 100 - frac)
      if (d < bestDist) { best = t; bestDist = d }
    }
    return best
  }, [items, tickLeftPct])

  // If a zoomed window is active and the tick just applied falls outside it,
  // recenter (keeping the same span) so the newly-active selection never
  // strands itself off-screen.
  const maybeRecenterWindow = useCallback((dateMs: number) => {
    if (!viewWindow) return
    if (dateMs >= effectiveMin && dateMs <= effectiveMax) return
    const span = effectiveMax - effectiveMin
    let newMin = dateMs - span / 2
    newMin = Math.max(fullMin, Math.min(fullMax - span, newMin))
    setViewWindow({ min: newMin, max: newMin + span })
  }, [viewWindow, effectiveMin, effectiveMax, fullMin, fullMax])

  // The single entry point for "a tick was picked", whether by click, drag,
  // or arrow-key step — always applies to exactly ONE side (explicit, from a
  // pointer event targeting a specific handle, or resolved from context for
  // a keyboard step/background click). Sync never affects this — see the
  // dualUnsynced comment above.
  const applyTick = useCallback((tick: TimelineTick, explicitSide?: "A" | "B") => {
    const which = explicitSide ?? resolveSide()
    setActiveSide(which)
    setTickForSide(which, tick)
    maybeRecenterWindow(tick.dateMs)
  }, [resolveSide, setTickForSide, maybeRecenterWindow])

  const scrubTo = useCallback((which: "A" | "B", clientX: number) => {
    const tick = nearestTickForClientX(clientX)
    if (tick) applyTick(tick, which)
  }, [nearestTickForClientX, applyTick])

  const step = useCallback((direction: number) => {
    const which = resolveSide()
    const source = which === "A" ? activeBasemapSourceA : activeBasemapSourceB
    const key = releaseForSide(which)
    const idx = items.findIndex((t) => t.source === source && t.key === key)
    if (idx === -1) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= items.length) return
    applyTick(items[newIdx])
  }, [resolveSide, activeBasemapSourceA, activeBasemapSourceB, releaseForSide, items, applyTick])

  // The REAL per-tile acquisition date for the active wayback release at this
  // exact spot — a release's own label is a catalog-wide publish date, which
  // can differ from when this specific tile's imagery was actually taken
  // (see lib/wayback.ts's useWaybackCaptureDate). Queried unconditionally
  // (hooks can't be called conditionally); the hook itself no-ops when the
  // release number is 0 (i.e. this side isn't currently on wayback).
  const { label: waybackCaptureLabelA } = useWaybackCaptureDate(state.lat, state.lng, state.zoom, activeBasemapSourceA === "wayback" ? releaseForSide("A") : 0)
  const { label: waybackCaptureLabelB } = useWaybackCaptureDate(state.lat, state.lng, state.zoom, activeBasemapSourceB === "wayback" ? releaseForSide("B") : 0)

  const panelVisible = state.historicalBeta && (showA || showB) && !collapsed

  // Arrow-key stepping — replaces the old play/pause/prev/next buttons.
  // Listens globally (not just while the track has focus) but ignores the
  // event whenever an editable element elsewhere on the page has focus.
  useEffect(() => {
    if (!panelVisible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      const el = document.activeElement
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable)) return
      e.preventDefault()
      step(e.key === "ArrowLeft" ? -1 : 1)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [panelVisible, step])

  // Mousewheel zoom — narrows/widens the visible date window, keeping the
  // date under the cursor fixed, bounded between MIN_VISIBLE_SPAN_MS and the
  // true full extent (saturating back to viewWindow=null, i.e. "no zoom", at
  // that upper bound). Attached imperatively (not a JSX onWheel) so
  // preventDefault reliably blocks page-scroll — React treats wheel listeners
  // as passive by default.
  useEffect(() => {
    const el = trackRef.current
    if (!el || !panelVisible) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      // A trackpad's two-finger swipe fires wheel events with deltaX
      // dominant (vs. deltaY for a mouse wheel / vertical scroll gesture) —
      // treat that as PAN instead of zoom, matching how every other
      // horizontally-zoomed surface (a browser page, a chart) responds to
      // the same gesture. Only meaningful once already zoomed in — at full
      // extent there's nowhere to pan to.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        if (!viewWindow) return
        const span = effectiveMax - effectiveMin
        const deltaMs = (e.deltaX / rect.width) * effectiveSpan
        let newMin = effectiveMin + deltaMs
        newMin = Math.max(fullMin, Math.min(fullMax - span, newMin))
        setViewWindow({ min: newMin, max: newMin + span })
        return
      }
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const cursorDate = effectiveMin + frac * effectiveSpan
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newSpan = Math.min(fullSpan, Math.max(MIN_VISIBLE_SPAN_MS, effectiveSpan * factor))
      let newMin = cursorDate - frac * newSpan
      newMin = Math.max(fullMin, Math.min(fullMax - newSpan, newMin))
      const newMax = newMin + newSpan
      setViewWindow(newSpan >= fullSpan ? null : { min: newMin, max: newMax })
    }
    el.addEventListener("wheel", handleWheel, { passive: false })
    return () => el.removeEventListener("wheel", handleWheel)
  }, [panelVisible, effectiveMin, effectiveMax, effectiveSpan, fullMin, fullMax, fullSpan, viewWindow])

  if (!panelVisible) return null

  const tickA = showA ? findTick(activeBasemapSourceA, releaseForSide("A")) : null
  const tickB = showB ? findTick(activeBasemapSourceB, releaseForSide("B")) : null
  const captionLabelA = tickA && tickA.source === "wayback" && waybackCaptureLabelA ? waybackCaptureLabelA : tickA?.label
  const captionLabelB = tickB && tickB.source === "wayback" && waybackCaptureLabelB ? waybackCaptureLabelB : tickB?.label

  // A and B can genuinely land on the same date (e.g. both set to Planet
  // Monthly 2023-12) and render as two overlapping circles — rather than
  // artificially nudging them apart (which read as fundamentally weird:
  // the dot's position implying a date it doesn't actually have), B's own
  // handle is declared after A's in the JSX below, so it's on top and
  // naturally captures the click/drag first; each handle's own
  // stopPropagation() keeps that click from also reaching A's handle or the
  // track background underneath. Dragging A out from under B (or an
  // arrow-key step on the other side) reveals it normally.
  const handleLeftPctA = tickA ? fracForTick(tickA) * 100 : 0
  const handleLeftPctB = tickB ? fracForTick(tickB) * 100 : 0
  // When both land on (essentially) the same date, B's solid green fully
  // covers A's handle — previously there was NO visible sign A was even
  // there. Both handles switch to a half-and-half A/B split so hovering
  // either one still reads as "both sides are here", regardless of which is
  // on top.
  const handlesCoincide = !!(showA && showB && tickA && tickB && Math.abs(handleLeftPctA - handleLeftPctB) < 0.05)
  const handleBgA = handlesCoincide ? `linear-gradient(90deg, ${COLOR_A} 50%, ${COLOR_B} 50%)` : COLOR_A
  const handleBgB = handlesCoincide ? `linear-gradient(90deg, ${COLOR_A} 50%, ${COLOR_B} 50%)` : COLOR_B

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed z-10 backdrop-blur-[2px] border border-border bg-background/95 shadow-sm transition-[background-color,right] duration-150",
        "bottom-0 left-0 right-0 rounded-none",
        "sm:bottom-4 sm:left-4 sm:right-[var(--timeline-right-offset)] sm:rounded-xl",
      )}
      style={{ ["--timeline-right-offset" as any]: isSidebarOpen && !isMobile ? "26rem" : "1rem" }}
    >
      {controlsExpanded ? (
        <div className="flex items-center justify-between px-4 pt-3 pb-3 border-b gap-3">
          <h2 className="text-sm font-semibold shrink-0">Historical Timeline</h2>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {visibleSourceIds.map((id) => {
              const active = timelineSourcesForPills.includes(id)
              const cfg = SOURCE_CONFIG[id]
              return (
                <Tooltip key={id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => toggleSource(id)}
                        className={cn(
                          "cursor-pointer flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                          active ? "text-slate-900 border-transparent" : "text-muted-foreground border-border hover:bg-accent",
                        )}
                        style={active ? { backgroundColor: cfg.color } : undefined}
                      >
                        {cfg.label}
                        {/* Real per-tile imagery date (vs. release/layer date) is
                            still being computed for every candidate release — its
                            ticks aren't drawn yet either (see waybackDatesLoading
                            above), so this spinner is the only visible sign
                            anything's happening. */}
                        {id === "wayback" && waybackDatesLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                      </button>
                    }
                  />
                  <TooltipContent>{cfg.fullLabel}</TooltipContent>
                </Tooltip>
              )
            })}
            <div className="w-px self-stretch bg-border mx-0.5" />
            {RESOLUTION_CLASSES.map(({ id, label }) => {
              const active = resolutionClasses.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleResolutionClass(id)}
                  className={cn(
                    "cursor-pointer rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    active ? "bg-accent text-accent-foreground border-border" : "text-muted-foreground border-border/60 hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {/* Grouped into one flex item (not separate siblings of the header's
              own justify-between) so the sync toggle always sits immediately
              left of the collapse button regardless of how much space the
              pills above take — justify-between would otherwise spread N
              siblings evenly across the whole row instead of keeping this
              trailing cluster adjacent. Sync/A-B only exist while the
              controls are expanded — hidden along with the pills otherwise. */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Which side's pill selection the source/resolution chips above
                edit — only meaningful (and only shown) while sync is off,
                since a shared pill state has no separate "side" to pick. */}
            {dualMode && !syncEnabled && (
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                {(["A", "B"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setActiveSide(side)}
                    className={cn(
                      "cursor-pointer px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      activeSide === side ? "text-white" : "text-muted-foreground hover:bg-accent",
                    )}
                    style={activeSide === side ? { backgroundColor: side === "A" ? COLOR_A : COLOR_B } : undefined}
                  >
                    {side}
                  </button>
                ))}
              </div>
            )}
            {dualMode && (
              <button
                type="button"
                onClick={toggleSync}
                className={cn(
                  "cursor-pointer p-1 rounded shrink-0",
                  syncEnabled ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                aria-label={syncEnabled ? "Unsync A/B source & resolution pills" : "Sync A/B source & resolution pills"}
                title={syncEnabled ? "Source/resolution pills shared between A and B — the scrubbed date is always independent per side" : "Source/resolution pills set independently per side (use A/B above to pick which)"}
              >
                <Link2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setControlsExpanded((v) => !v)}
              className={cn(
                "cursor-pointer p-1 rounded shrink-0",
                controlsExpanded ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={controlsExpanded ? "Hide source/resolution controls" : "Show source/resolution controls"}
              title="Sources & resolution"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="cursor-pointer p-1 text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Collapse timeline"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        // Minimal mode: no dedicated header row at all — just a small
        // floating chip hovering over the track's own top-right corner, so
        // the panel doesn't grow a whole extra line just to hold 2 buttons.
        <div className="absolute top-2 right-3 z-20 flex items-center gap-0.5 rounded-md border border-border bg-background/90 backdrop-blur-sm shadow-sm px-0.5 py-0.5">
          <button
            type="button"
            onClick={() => setControlsExpanded((v) => !v)}
            className="cursor-pointer p-1 rounded text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Show source/resolution controls"
            title="Sources & resolution"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="cursor-pointer p-1 text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Collapse timeline"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="px-4 py-3 space-y-1">
        <div className="flex items-center gap-2">
          <div
            ref={trackRef}
            className="relative flex-1 h-12 mx-2 cursor-pointer touch-none"
            onPointerDown={(e) => {
              const which = showA && !showB ? "A" : showB && !showA ? "B" : activeSide
              setActiveSide(which)
              scrubTo(which, e.clientX)
            }}
          >
            {/* overflow-hidden here (not on the outer track div) is a
                deliberate backstop, not just cosmetic — the track sits
                inside a fixed-position panel with no other clipping, so a
                tick position that's ever wrong (nudged past the edge, a
                stale calc, etc.) must never be able to render outside the
                track and appear to float over the map. Scoped to just the
                gridlines/ticks (not the whole track) so the A/B handles
                below — always correctly clamped to [0,100] via
                fracForTick's own min/max — don't get clipped in half when
                sitting exactly at the oldest/newest edge. */}
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
              {yearMarks.map((mark) => (
                <div
                  key={`grid-${mark.label}`}
                  className="absolute top-0 bottom-0 w-px bg-border/70 pointer-events-none"
                  style={{ left: `${mark.frac * 100}%` }}
                />
              ))}
              {visibleItems.map((t) => (
                t.source === "wayback" ? (
                  <WaybackTickMark key={`${t.source}-${t.key}`} tick={t} leftPct={tickLeftPct(t)} realLabel={waybackRealDates[t.key]?.label ?? null} />
                ) : (
                  <Tooltip key={`${t.source}-${t.key}`}>
                    <TooltipTrigger
                      render={
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-11 cursor-help"
                          style={{ left: `${tickLeftPct(t)}%` }}
                        >
                          <div
                            className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 mx-auto w-1"
                            style={{ backgroundColor: SOURCE_CONFIG[t.source]?.color ?? "var(--muted-foreground)", opacity: 0.85 }}
                          />
                        </div>
                      }
                    />
                    <TooltipContent>{SOURCE_CONFIG[t.source]?.label ?? t.source}: {t.label}</TooltipContent>
                  </Tooltip>
                )
              ))}
            </div>
            {showA && tickA && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      onPointerDown={(e: React.PointerEvent) => {
                        e.stopPropagation()
                        e.currentTarget.setPointerCapture(e.pointerId)
                        setActiveSide("A")
                        scrubTo("A", e.clientX)
                      }}
                      onPointerMove={(e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo("A", e.clientX) }}
                      onPointerUp={(e: React.PointerEvent) => e.currentTarget.releasePointerCapture(e.pointerId)}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-background shadow cursor-grab active:cursor-grabbing"
                      style={{ left: `${handleLeftPctA}%`, background: handleBgA }}
                    />
                  }
                />
                <TooltipContent>
                  {handlesCoincide ? (
                    <>
                      <div>A — {SOURCE_CONFIG[tickA.source]?.label ?? tickA.source}: {captionLabelA}</div>
                      {tickB && <div>B — {SOURCE_CONFIG[tickB.source]?.label ?? tickB.source}: {captionLabelB}</div>}
                    </>
                  ) : (
                    <>A — {SOURCE_CONFIG[tickA.source]?.label ?? tickA.source}: {captionLabelA}</>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {showB && tickB && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      onPointerDown={(e: React.PointerEvent) => {
                        e.stopPropagation()
                        e.currentTarget.setPointerCapture(e.pointerId)
                        setActiveSide("B")
                        scrubTo("B", e.clientX)
                      }}
                      onPointerMove={(e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo("B", e.clientX) }}
                      onPointerUp={(e: React.PointerEvent) => e.currentTarget.releasePointerCapture(e.pointerId)}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-background shadow cursor-grab active:cursor-grabbing"
                      style={{ left: `${handleLeftPctB}%`, background: handleBgB }}
                    />
                  }
                />
                <TooltipContent>
                  {handlesCoincide ? (
                    <>
                      {tickA && <div>A — {SOURCE_CONFIG[tickA.source]?.label ?? tickA.source}: {captionLabelA}</div>}
                      <div>B — {SOURCE_CONFIG[tickB.source]?.label ?? tickB.source}: {captionLabelB}</div>
                    </>
                  ) : (
                    <>B — {SOURCE_CONFIG[tickB.source]?.label ?? tickB.source}: {captionLabelB}</>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Horizontal pan gutter — always rendered (so the panel's own height
            never changes between zoomed and not), just transparent/inert at
            full extent since there's nowhere to pan to then. The track's own
            click/drag is already claimed by tick-scrubbing, so panning lives
            here instead: drag the thumb (sized/positioned to represent the
            current zoomed window's share of the full date range) to shift
            the view, or click the gutter background to jump the window
            there. */}
        <div
          className={cn("relative h-1.5 mx-2 rounded-full", viewWindow ? "bg-border/60 cursor-pointer" : "bg-transparent pointer-events-none")}
          onPointerDown={(e) => {
            if (!viewWindow) return
            const rect = e.currentTarget.getBoundingClientRect()
            const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
            const span = effectiveMax - effectiveMin
            const newMin = Math.max(fullMin, Math.min(fullMax - span, fullMin + frac * fullSpan - span / 2))
            setViewWindow({ min: newMin, max: newMin + span })
          }}
        >
          <div
            onPointerDown={(e: React.PointerEvent) => {
              if (!viewWindow) return
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              gutterDragRef.current = {
                startClientX: e.clientX,
                startMin: effectiveMin,
                gutterWidthPx: e.currentTarget.parentElement!.getBoundingClientRect().width,
              }
            }}
            onPointerMove={(e: React.PointerEvent) => {
              const drag = gutterDragRef.current
              if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return
              const deltaMs = ((e.clientX - drag.startClientX) / drag.gutterWidthPx) * fullSpan
              const span = effectiveMax - effectiveMin
              const newMin = Math.max(fullMin, Math.min(fullMax - span, drag.startMin + deltaMs))
              setViewWindow({ min: newMin, max: newMin + span })
            }}
            onPointerUp={(e: React.PointerEvent) => { e.currentTarget.releasePointerCapture(e.pointerId); gutterDragRef.current = null }}
            className={cn(
              "absolute top-0 bottom-0 rounded-full touch-none",
              viewWindow ? "bg-muted-foreground/50 hover:bg-muted-foreground/70 cursor-grab active:cursor-grabbing" : "bg-transparent",
            )}
            style={{
              left: viewWindow ? `${((effectiveMin - fullMin) / fullSpan) * 100}%` : "0%",
              width: viewWindow ? `${Math.max(4, (effectiveSpan / fullSpan) * 100)}%` : "100%",
            }}
          />
        </div>

        {/* Aligned to the track's own inset (mx-2 = 0.5rem on both sides,
            now that the removed play/pause/prev/next buttons no longer push
            the track's left edge in further than that). */}
        <div className="relative h-3 mx-2">
          {yearMarks.map((mark) => (
            <span
              key={mark.label}
              className="absolute -translate-x-1/2 text-[9px] text-muted-foreground tabular-nums"
              style={{ left: `${mark.frac * 100}%` }}
            >
              {mark.label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[10px] tabular-nums mx-2">
          <span className="text-left" style={showA ? { color: COLOR_A } : undefined}>
            {showA ? `A: ${tickA ? `${SOURCE_CONFIG[tickA.source]?.label} ${captionLabelA}` : "—"}` : ""}
          </span>
          <OpenInLinksButton state={state} mapRef={mapRef} waybackLatestRelease={latestWaybackRelease} />
          <span className="text-right" style={showB ? { color: COLOR_B } : undefined}>
            {showB ? `B: ${tickB ? `${SOURCE_CONFIG[tickB.source]?.label} ${captionLabelB}` : "—"}` : ""}
          </span>
        </div>
      </div>
    </div>
  )
}
