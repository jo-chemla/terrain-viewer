import type React from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { ChevronDown, ChevronLeft, ChevronRight, Link2, Settings2, Loader2, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWaybackItemsWithLocalChanges, useWaybackRealCaptureDates, sortByDateAscending } from "@/lib/wayback"
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
export const SOURCE_CONFIG: Record<string, { label: string; fullLabel: string; color: string; resClass: "vhr" | "medium" }> = {
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
const WaybackTickMark: React.FC<{ tick: TimelineTick; leftPct: number; activeOnSide: "A" | "B" | null }> = ({ tick, leftPct, activeOnSide }) => {
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
      {/* Date first, then source, then which map (if any) it's active on —
          same order as the generic tick tooltip below. */}
      <TooltipContent>
        <div>{new Date(tick.dateMs).toISOString().slice(0, 10)}</div>
        <div>{SOURCE_CONFIG.wayback.label}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">Mosaic: {tick.label}</div>
        {activeOnSide && <div className="text-[10px] text-gray-400">Map {activeOnSide}</div>}
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
  // Once in dual mode, BOTH sides always get a handle/date on the timeline —
  // even a side currently on a plain (non-historical) basemap like ESRI
  // World Imagery still shows a PROPOSED tick (see displaySourceA/B and
  // resolveDisplayTick below) that the user can click/drag to actually
  // switch that side onto it, instead of needing to first select "Historical
  // Imagery" on both sides via the sidebar before either handle appears.
  // This is display-only — nothing about a side's ACTUAL basemap changes
  // until a tick is clicked (buildTickUpdates, unchanged). Outside dual mode
  // there's no separate "B" to reason about, so single-view keeps the
  // original "only show if actually historical" gating.
  const showA = dualMode ? true : aIsHistorical
  const showB = dualMode
  // The source browsed/displayed for each side — identical to
  // activeBasemapSource(A/B) when that side IS already historical
  // (resolveActiveHistoricalSource makes them the same value in that case),
  // but falls back to historicalActiveSource(A/B) even when the side is
  // currently a plain basemap, so showA/showB above always have a real
  // source to look up a proposed tick for.
  const displaySourceA = state.basemapPerView ? state.historicalActiveSourceA : state.historicalActiveSource
  const displaySourceB = state.historicalActiveSourceB
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
  // can differ significantly from the real capture date). A release only
  // becomes a tick once ITS OWN real date has resolved (rather than all
  // waiting on waybackDatesLoading to go false) — useWaybackRealCaptureDates
  // now resolves one release at a time, not behind a single Promise.all, so
  // ticks populate progressively as each one's real date actually arrives
  // instead of the whole timeline sitting empty until Esri's slowest
  // response comes back. The "wayback" pill's own spinner (elsewhere in this
  // file) still reflects waybackDatesLoading, so there's still a visible
  // sign more are on the way.
  const { resolved: waybackRealDates, loading: waybackDatesLoading } = useWaybackRealCaptureDates(rawWaybackItems, state.lat, state.lng, state.zoom)
  // key is the tick's real dateMs (same convention as every other source
  // now — see the state.date/dateA/dateB consolidation) rather than the
  // release number; lib/wayback.ts's useResolvedWaybackRelease is what
  // turns a date back into the actual release to fetch, entirely inside
  // MapSources.tsx, so this panel's own tick model never needs to think in
  // release numbers at all.
  const waybackTicks = useMemo<TimelineTick[]>(() => {
    // Distinct releases commonly resolve to the SAME real capture date at a
    // given spot (Esri's own dedup, onlyUseSizeToFilterDuplicates, is a
    // same-tile-size heuristic, not an exact-image check) — without this
    // dedup, two+ ticks sharing one dateMs also shared one `${source}-${key}`
    // string, which is this list's own React key, so React's reconciler
    // ended up reusing/misplacing DOM nodes across renders (worse the more
    // re-renders — e.g. repeated zooming — happened in between). Seen live
    // as many tick elements pinned to one identical pixel. Keeping one tick
    // per real date (first/oldest release to report it) fixes this at the
    // source instead of trying to visually separate marks that represent
    // the exact same real-world photo date.
    const seenDates = new Set<number>()
    const ticks: TimelineTick[] = []
    for (const item of sortByDateAscending(rawWaybackItems)) {
      const real = waybackRealDates[item.releaseNum]
      if (!real || seenDates.has(real.dateMs)) continue
      seenDates.add(real.dateMs)
      ticks.push({ source: "wayback", key: real.dateMs, dateMs: real.dateMs, label: item.releaseDateLabel })
    }
    return ticks
  }, [rawWaybackItems, waybackRealDates])
  // No per-location catalog exists for HLS — these are evenly-spaced
  // placeholder monthly points (see lib/hls.ts), not verified real capture
  // dates the way Wayback's are.
  const hlsTicks = useMemo<TimelineTick[]>(
    () => syntheticHlsTicks().map((t) => ({ source: "hls", key: t.dateMs, dateMs: t.dateMs, label: t.label })),
    [],
  )
  const { items: rawGeItems, loading: geDatesLoading } = useGeHistoricalDates(state.lat, state.lng, state.zoom)
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
  // date so dateForSide/findNearestTick below work identically to every other
  // source even though there's nothing to actually scrub through.
  const { label: bingCaptureLabel, dateMs: bingCaptureDateMs, loading: bingLoading } = useBingCaptureDate(state.lat, state.lng, state.zoom)
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
  // NEAREST match, not exact equality — a stored date (state.dateA/dateB)
  // and a wayback tick's own real.dateMs both ultimately come from Esri's
  // getMetadata() at slightly different times/locations (the map can pan a
  // hair between the original pick and a later re-render, re-triggering
  // useWaybackRealCaptureDates with marginally different coordinates), so
  // requiring bit-for-bit equality could genuinely miss the intended tick
  // and silently fall back elsewhere — reading as "the handle jumped to a
  // different mark". Nearest-match is also just the semantically correct
  // behavior for a date-based lookup: the source closest to that timestamp,
  // exactly as historicalActiveSource(A/B) already documents.
  const findNearestTick = useCallback((source: string, targetDateMs: number): TimelineTick | null => {
    if (!targetDateMs) return null
    let best: TimelineTick | null = null
    let bestDist = Infinity
    for (const t of allTicks) {
      if (t.source !== source) continue
      const dist = Math.abs(t.dateMs - targetDateMs)
      if (dist < bestDist) { bestDist = dist; best = t }
    }
    return best
  }, [allTicks])

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

  // The one scrubbed date for a side, regardless of which concrete source is
  // active — every source (including Wayback, whose real tile lookup keys
  // off a release NUMBER internally, see lib/wayback.ts's
  // useResolvedWaybackRelease) shares the same state.date/dateA/dateB field
  // now. Named for what it returns (a plain epoch-ms date, or 0 for "not yet
  // picked"), not "release", since it's no longer wayback-specific.
  const dateForSide = useCallback((side: "A" | "B"): number => {
    return side === "A" ? (state.basemapPerView ? state.dateA : state.date) : state.dateB
  }, [state.basemapPerView, state.date, state.dateA, state.dateB])

  // Falls back to the newest tick for a source when no date has ever been
  // recorded for it yet — lets a side that isn't historical yet (showA/showB
  // above) still preview a sensible tick instead of showing nothing.
  const newestTickFor = useCallback((source: string): TimelineTick | null => {
    for (let i = allTicks.length - 1; i >= 0; i--) if (allTicks[i].source === source) return allTicks[i]
    return null
  }, [allTicks])

  // The single source of truth for "what tick is this side showing right
  // now" — used both to compute the axis envelope (items, below) and the
  // actual handle position/caption (tickA/tickB, near the bottom). Falls
  // back to a proposed (not-yet-committed) tick via newestTickFor so a
  // side that's merely PREVIEWING a source (not historical yet) still has
  // something sensible to render and click.
  const resolveDisplayTick = useCallback((side: "A" | "B"): TimelineTick | null => {
    const source = side === "A" ? displaySourceA : displaySourceB
    return findNearestTick(source, dateForSide(side)) ?? newestTickFor(source)
  }, [displaySourceA, displaySourceB, findNearestTick, dateForSide, newestTickFor])

  // Ticks/gridlines show sources currently toggled on via the pill row (both
  // the source pills and the VHR/Medium res chips). When unsynced in dual
  // mode, this is scoped to whichever side is currently active (activeSide)
  // — clicking "A" shows only A's chosen sources' ticks, clicking "B" shows
  // only B's, per the user's request (not a union of both).
  //
  // BUT a side's own actively-displayed tick is always unioned in even if
  // its source isn't part of that filter — otherwise, since fullMin/fullMax
  // below are derived from this same list, a handle whose source falls
  // outside the currently-toggled pills (e.g. A is scrubbing Planet/EOX-S2
  // while B actually sits on a Google Earth date not in A's pill set) still
  // got positioned against an axis that never accounted for its own date,
  // landing it away from any visible mark — reading as "the pill doesn't
  // attach to a mark" even though the caption below was reading the correct
  // tick all along (captions don't depend on this filtered/scaled list).
  const items = useMemo(() => {
    const filtered = allTicks.filter((t) => timelineSourcesForPills.includes(t.source) && resolutionClasses.includes(SOURCE_CONFIG[t.source]?.resClass))
    const activeTickA = showA ? resolveDisplayTick("A") : null
    const activeTickB = showB ? resolveDisplayTick("B") : null
    const seen = new Set(filtered.map((t) => `${t.source}-${t.key}`))
    const extra = [activeTickA, activeTickB].filter((t): t is TimelineTick => !!t && !seen.has(`${t.source}-${t.key}`))
    return extra.length ? [...filtered, ...extra].sort((a, b) => a.dateMs - b.dateMs) : filtered
  }, [allTicks, timelineSourcesForPills, resolutionClasses, showA, showB, resolveDisplayTick])

  // A side's basemapSource(A/B) is either a normal basemap id or the single
  // combined "historical" entry. Picking a non-Bing tick sets that field to
  // "historical" plus records WHICH concrete source is now active for that
  // side (historicalActiveSource(A/B)) — Bing bypasses the indirection
  // entirely and is written directly, same as any other plain basemap id.
  // The date field itself is just dateA/dateB (or date, single-view) now,
  // the same one regardless of source — no more per-source field name to
  // resolve.
  const buildTickUpdates = useCallback((side: "A" | "B", tick: TimelineTick): Record<string, any> => {
    const sourceField = side === "A" ? (state.basemapPerView ? "basemapSourceA" : "basemapSource") : "basemapSourceB"
    const dateField = side === "A" ? (state.basemapPerView ? "dateA" : "date") : "dateB"
    const updates: Record<string, any> = { [dateField]: tick.dateMs }
    if (tick.source === "bing") {
      updates[sourceField] = "bing"
    } else {
      updates[sourceField] = "historical"
      const activeSourceField = side === "A" ? (state.basemapPerView ? "historicalActiveSourceA" : "historicalActiveSource") : "historicalActiveSourceB"
      updates[activeSourceField] = tick.source
    }
    return updates
  }, [state.basemapPerView])

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

  // First time either side actually LANDS on a historical source (via the
  // sidebar radio, not just the timeline's own display preview — see
  // showA/showB/resolveDisplayTick above) with no date picked yet, jump
  // straight to the newest available tick for that side's active source
  // rather than rendering nothing until the user manually picks one. Guarded
  // on aIsHistorical/bIsHistorical specifically (not showA/showB, which are
  // now unconditionally true in dual mode) — a side that's merely PREVIEWING
  // a not-yet-selected source must never get auto-committed to historical
  // just because its handle is showing; resolveDisplayTick's own fallback
  // already renders a sensible proposed tick for that case without writing
  // any state, only actually committing once the user clicks/drags it.
  useEffect(() => {
    if (aIsHistorical && !dateForSide("A")) {
      const pool = allTicks.filter((t) => t.source === displaySourceA)
      if (pool.length) setTickForSide("A", pool[pool.length - 1])
    }
    if (bIsHistorical && !dateForSide("B")) {
      const pool = allTicks.filter((t) => t.source === displaySourceB)
      if (pool.length) setTickForSide("B", pool[pool.length - 1])
    }
  }, [aIsHistorical, bIsHistorical, displaySourceA, displaySourceB, allTicks, dateForSide, setTickForSide])

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

  // Ticks previously got nudged a few pixels apart from a close neighbor to
  // stay visually distinct (two different sources landing on the same or
  // near-same date, e.g. Planet/HLS both on the 1st) — dropped in favor of
  // always drawing at the tick's own true chronological position. Nudging
  // interacted badly with the A/B handle (which must sit exactly ON the
  // active tick's own position, see handleLeftPctA/B below): whenever a
  // handle's tick had a close neighbor, the nudge could shift either one
  // just enough that the round handle no longer visually lined up with its
  // own mark, even though the underlying date/source selection was always
  // correct. Genuinely coincident ticks now simply overlap — the same
  // trade-off already accepted for the A/B handles themselves further down.
  const tickLeftPct = useCallback((t: TimelineTick) => fracForTick(t) * 100, [fracForTick])

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
    const source = which === "A" ? displaySourceA : displaySourceB
    const key = dateForSide(which)
    const idx = items.findIndex((t) => t.source === source && t.key === key)
    if (idx === -1) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= items.length) return
    applyTick(items[newIdx])
  }, [resolveSide, displaySourceA, displaySourceB, dateForSide, items, applyTick])

  const panelVisible = state.historicalBeta && (showA || showB) && !collapsed
  // The primary basemap SOURCE is always mounted regardless of this toggle
  // (RasterBasemapSource in MapSources.tsx) — but its LAYER's visibility is
  // separately gated by state.showRasterBasemap (MapLayers.tsx), and that
  // defaults to OFF. So it's entirely possible to be actively scrubbing
  // through historical dates here while nothing is actually visible on the
  // map — worth flagging rather than leaving the user to wonder why nothing
  // changed.
  const rasterBasemapOff = !state.showRasterBasemap

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

  // Mousewheel zoom/pan reads effectiveMin/Max/Span, fullMin/Max/Span and
  // viewWindow — all of which change on EVERY wheel tick once zoomed in.
  // Keeping those in the listener effect's own dependency array (as before)
  // meant the effect tore down and re-added the native "wheel" listener on
  // every single scroll step — during a fast trackpad pan (many events per
  // frame), that teardown/re-add churn could miss or reorder events between
  // the old listener being removed and the new one attaching, reading from
  // whichever closure happened to still be attached at that instant. That's
  // consistent with two related reports: a multi-second "freeze" during
  // fast horizontal panning, and stray tick marks that stopped tracking
  // further pans (rendered once against a stale effectiveMin/Max, then
  // never touched again if their listener generation got skipped). A ref
  // lets the listener itself be attached exactly ONCE (whenever
  // panelVisible flips true) while always reading the LATEST values on each
  // event, regardless of how fast they arrive.
  const wheelStateRef = useRef({ effectiveMin, effectiveMax, effectiveSpan, fullMin, fullMax, fullSpan, viewWindow })
  useEffect(() => {
    wheelStateRef.current = { effectiveMin, effectiveMax, effectiveSpan, fullMin, fullMax, fullSpan, viewWindow }
  })

  // Attached imperatively (not a JSX onWheel) so preventDefault reliably
  // blocks page-scroll — React treats wheel listeners as passive by default.
  useEffect(() => {
    const el = trackRef.current
    if (!el || !panelVisible) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { effectiveMin, effectiveMax, effectiveSpan, fullMin, fullMax, fullSpan, viewWindow } = wheelStateRef.current
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
  }, [panelVisible])

  if (!panelVisible) return null

  const tickA = showA ? resolveDisplayTick("A") : null
  const tickB = showB ? resolveDisplayTick("B") : null
  // A wayback tick's own dateMs IS already the real resolved capture date
  // (see waybackTicks above) — no separate lookup needed, unlike before the
  // state.date/dateA/dateB consolidation.
  const captionLabelA = tickA?.source === "wayback" ? new Date(tickA.dateMs).toISOString().slice(0, 10) : tickA?.label
  const captionLabelB = tickB?.source === "wayback" ? new Date(tickB.dateMs).toISOString().slice(0, 10) : tickB?.label

  // A and B can genuinely land on the same date (e.g. both set to Planet
  // Monthly 2023-12) and render as two overlapping circles — rather than
  // artificially nudging them apart (which read as fundamentally weird:
  // the dot's position implying a date it doesn't actually have), B's own
  // handle is declared after A's in the JSX below, so it's on top and
  // naturally captures the click/drag first; each handle's own
  // stopPropagation() keeps that click from also reaching A's handle or the
  // track background underneath. Dragging A out from under B (or an
  // arrow-key step on the other side) reveals it normally.
  // tickLeftPct (the same nudged/decluttered position the tick MARKS
  // themselves render at), not raw fracForTick — when ticks are crowded
  // enough to get nudged apart from their true chronological position, using
  // the raw position here made the handle visually "snap" away from the
  // mark it actually corresponds to (the underlying date/source was always
  // correct — only the dot's rendered position disagreed with the mark's).
  const handleLeftPctA = tickA ? tickLeftPct(tickA) : 0
  const handleLeftPctB = tickB ? tickLeftPct(tickB) : 0
  // When both land on (essentially) the same date, B's solid green fully
  // covers A's handle — previously there was NO visible sign A was even
  // there. Both handles switch to a half-and-half A/B split so hovering
  // either one still reads as "both sides are here", regardless of which is
  // on top.
  const handlesCoincide = !!(showA && showB && tickA && tickB && Math.abs(handleLeftPctA - handleLeftPctB) < 0.05)
  const handleBgA = handlesCoincide ? `linear-gradient(90deg, ${COLOR_A} 50%, ${COLOR_B} 50%)` : COLOR_A
  const handleBgB = handlesCoincide ? `linear-gradient(90deg, ${COLOR_A} 50%, ${COLOR_B} 50%)` : COLOR_B
  // A handle's own date can fall outside the current zoomed viewWindow
  // (mousewheel zoom) while fracForTick still clamps its POSITION to
  // [0,1] — rendering the round handle pinned at the edge at the same time
  // as a separate off-screen indicator collided visually. Instead, off-
  // screen replaces the round handle entirely with one combined rect chip
  // (letter + chevron, see the JSX below) — never both at once.
  const dirA = tickA && (tickA.dateMs < effectiveMin ? "left" : tickA.dateMs > effectiveMax ? "right" : null)
  const dirB = tickB && (tickB.dateMs < effectiveMin ? "left" : tickB.dateMs > effectiveMax ? "right" : null)

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
                          // Active pills keep their original dark-slate text at
                          // rest (readable against the pastel background) —
                          // only switching to text-primary-foreground on hover,
                          // to signal "hovering this will toggle it off"
                          // without changing the resting appearance.
                          active ? "text-slate-900 border-transparent hover:text-primary-foreground" : "text-muted-foreground border-border hover:bg-primary hover:text-primary-foreground hover:border-transparent",
                        )}
                        style={active ? { backgroundColor: cfg.color } : undefined}
                      >
                        {cfg.label}
                        {/* Real per-tile imagery date (vs. release/layer date) is
                            still being computed for every candidate release — its
                            ticks aren't drawn yet either (see waybackDatesLoading
                            above), so this spinner is the only visible sign
                            anything's happening. Same idea for Google Earth
                            (fetching its own per-tile IMAGERY_HISTORY dates) and
                            Bing (fetching the current tile's capture-date-range
                            header) — both a real network round-trip per
                            location, not instant. */}
                        {id === "wayback" && waybackDatesLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                        {id === "ge-historical" && geDatesLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                        {id === "bing" && bingLoading && <Loader2 className="h-3 w-3 animate-spin" />}
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
                    // rounded-full to match the source pills immediately to
                    // its left (px-2 not px-2.5 — no colored dot/loader to
                    // balance, so it reads fine slightly narrower).
                    "cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
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
            {rasterBasemapOff && (
              <Tooltip>
                <TooltipTrigger
                  render={<TriangleAlert className="h-4 w-4 text-primary shrink-0" />}
                />
                <TooltipContent>Raster Basemap is off (Visualization Modes) — historical imagery won't be visible on the map</TooltipContent>
              </Tooltip>
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
          {rasterBasemapOff && (
            <Tooltip>
              <TooltipTrigger
                render={<TriangleAlert className="h-4 w-4 text-primary shrink-0 mx-1" />}
              />
              <TooltipContent>Raster Basemap is off (Visualization Modes) — historical imagery won't be visible on the map</TooltipContent>
            </Tooltip>
          )}
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
              {visibleItems.map((t) => {
                // Which map (if any) currently has this exact tick active —
                // shown as the last line of its tooltip.
                const activeOnSide = tickA && tickA.source === t.source && tickA.key === t.key ? "A" : tickB && tickB.source === t.source && tickB.key === t.key ? "B" : null
                return t.source === "wayback" ? (
                  <WaybackTickMark key={`${t.source}-${t.key}`} tick={t} leftPct={tickLeftPct(t)} activeOnSide={activeOnSide} />
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
                    {/* Date (yyyy-mm) first, then source, then which map (if
                        any) it's active on. */}
                    <TooltipContent>
                      <div>{new Date(t.dateMs).toISOString().slice(0, 7)}</div>
                      <div>{SOURCE_CONFIG[t.source]?.label ?? t.source}</div>
                      {activeOnSide && <div className="text-[10px] text-gray-400">Map {activeOnSide}</div>}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
            {/* Off-screen (dirA/dirB set): ONE combined rounded-rect chip —
                letter + chevron pointing which way to look, e.g. "A>" or
                "<A" — replacing the round handle entirely rather than
                rendering both at the same clamped edge position (which
                collided visually). Clicking recenters the view on that
                handle's actual date. In-bounds: the normal round handle,
                draggable as before. */}
            {showA && tickA && (
              dirA ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => maybeRecenterWindow(tickA.dateMs)}
                        className={cn(
                          "absolute top-1/2 -translate-y-1/2 z-10 cursor-pointer flex items-center rounded-md border-2 border-background shadow px-0.5 h-4 text-[8px] font-bold leading-none text-white",
                          dirA === "left" ? "left-0" : "right-0",
                        )}
                        style={{ background: handleBgA }}
                      >
                        {dirA === "left" && <ChevronLeft className="h-3 w-3" />}
                        A
                        {dirA === "right" && <ChevronRight className="h-3 w-3" />}
                      </button>
                    }
                  />
                  <TooltipContent>A — off-screen ({captionLabelA}), click to bring into view</TooltipContent>
                </Tooltip>
              ) : (
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
                      >
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold leading-none text-white pointer-events-none select-none">A</span>
                      </div>
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
              )
            )}
            {showB && tickB && (
              dirB ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => maybeRecenterWindow(tickB.dateMs)}
                        className={cn(
                          "absolute top-1/2 -translate-y-1/2 z-10 cursor-pointer flex items-center rounded-md border-2 border-background shadow px-0.5 h-4 text-[8px] font-bold leading-none text-white",
                          dirB === "left" ? "left-0" : "right-0",
                        )}
                        style={{ background: handleBgB }}
                      >
                        {dirB === "left" && <ChevronLeft className="h-3 w-3" />}
                        B
                        {dirB === "right" && <ChevronRight className="h-3 w-3" />}
                      </button>
                    }
                  />
                  <TooltipContent>B — off-screen ({captionLabelB}), click to bring into view</TooltipContent>
                </Tooltip>
              ) : (
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
                      >
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold leading-none text-white pointer-events-none select-none">B</span>
                      </div>
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
              )
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
