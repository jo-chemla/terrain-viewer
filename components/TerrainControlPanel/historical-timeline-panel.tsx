import type React from "react"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { ChevronDown, ChevronLeft, ChevronRight, Link2, Settings2, Loader2, TriangleAlert } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { OpenInLinksButton } from "./open-in-links"
import { useWaybackItemsWithLocalChanges, useWaybackRealCaptureDates, sortByDateAscending } from "@/lib/wayback"
import { syntheticHlsTicks } from "@/lib/hls"
import { useGeHistoricalDates } from "@/lib/ge-historical"
import { planetMonthlyTicks } from "@/lib/planet"
import { useBingCaptureDate } from "@/lib/bing"
import { eoxS2CloudlessTicks } from "@/lib/eox-s2-cloudless"
import { TIMELINE_SOURCE_IDS, resolveActiveHistoricalSource } from "@/lib/historical-sources"
import { planetKeyAtom } from "@/lib/settings-atoms"
import { historicalTimelinePanelHeightAtom, sideColorOverridesAtom, colorizeMapBordersAtom } from "@/lib/layout-constants"
import { GRID_LAYOUTS, viewFieldName, SIDE_COLORS, type GridLayoutId, type ViewId } from "@/lib/grid-layouts"
import { isSidebarOpenAtom } from "@/components/TerrainControlPanel/TerrainControlPanel"
import { useIsMobile } from "@/hooks/use-mobile"

// Persisted (not plain local state) — this was the actual cause behind "no
// matter what I do, dragging one side always drags the other": sync
// defaulted to on every fresh page load/reload, so turning it off in one
// session silently reverted on the next. Now an explicit "off" sticks.
const historicalTimelineSyncAtom = atomWithStorage("historicalTimelineSync", true)

// Minimum pixel gap between two adjacent year labels before the later one is
// dropped — same idea as a chart axis thinning its tick labels, so a dense
// multi-decade range never renders overlapping text.
const MIN_YEAR_LABEL_GAP_PX = 32

// Registry of aggregatable timeline sources — the pill row below toggles
// membership in state.timelineSources (or its per-side A-F variants), and
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
export const SOURCE_CONFIG: Record<string, { label: string; fullLabel: string; shortLabel: string; color: string; resClass: "vhr" | "medium" }> = {
  // shortLabel is just the provider name, no product qualifier — used by
  // TerrainViewer.tsx's "Show Capture Date" pill in its "source + date" mode,
  // where space is tight and the provider alone is enough context.
  wayback: { label: "ESRI Wayback", fullLabel: "ESRI World Imagery Wayback", shortLabel: "ESRI", color: "#cbe4bd", resClass: "vhr" }, // Esri green (#7ebc59), pastelized
  "ge-historical": { label: "Google Earth", fullLabel: "Google Earth Historical", shortLabel: "Google", color: "#aecbfa", resClass: "vhr" }, // Google's own Material "blue-100"
  bing: { label: "Bing Single", fullLabel: "Bing Maps (single current mosaic)", shortLabel: "Bing", color: "#c4b5fd", resClass: "vhr" }, // pastel purple (too close to Esri/Google's own teal otherwise)
  planet: { label: "Planet Monthly", fullLabel: "Planet Global Monthly Basemap", shortLabel: "Planet", color: "#fdba74", resClass: "medium" }, // pastel orange
  "eox-s2": { label: "EOX Sentinel 2", fullLabel: "EOX Sentinel-2 Cloudless (Yearly)", shortLabel: "EOX", color: "#fca5a5", resClass: "medium" }, // pastel red
  hls: { label: "NASA HLS", fullLabel: "NASA Harmonized Landsat Sentinel-2", shortLabel: "NASA", color: "#f9a8d4", resClass: "medium" }, // pastel pink
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
// How far the zoom-out limit (and the pan-gutter's own 100%-width extent)
// reaches PAST the true oldest/newest tick on each side — without this, the
// two extreme ticks sit exactly at frac 0/1, pinned right against the
// track's edge with no breathing room, and half a handle can render clipped
// off the visible track. 10% of the true span per side, but capped at 6
// months — a flat 10% is fine for a typical multi-year span, but for a very
// long one (e.g. a 1945-2025 GE Historical outlier) it let the zoomed-out
// view pan years past both real ends (8 years each side for an 80-year
// span). Whichever of the two is smaller applies, so a short span still
// gets its full proportional padding instead of being swallowed by a fixed
// cap sized for decades-long spans.
const ZOOM_OUT_PADDING_FRACTION = 0.1
const ZOOM_OUT_PADDING_MAX_MS = 1000 * 60 * 60 * 24 * 182.5 // ~6 months
// How long a gap between wheel events ends the current pan/zoom gesture and
// lets the next event's own deltaX/deltaY ratio re-decide the mode — see
// wheelGestureRef above.
const WHEEL_GESTURE_TIMEOUT_MS = 200
// How much an off-screen handle's chevron click grows the view window by,
// on the side the handle is actually off-screen toward — see
// expandViewWindowToward below.
const CHEVRON_EXPAND_FRACTION = 0.2

// A Wayback tick's own release/mosaic label (t.label, from releaseDateLabel)
// is a catalog-wide publish date — the REAL per-tile imagery date can differ
// (see lib/wayback.ts) and is now what the tick is actually POSITIONED at
// (see useWaybackRealCaptureDates in the parent), so it's already resolved
// by the time this renders — no separate per-hover fetch needed anymore.
const WaybackTickMark: React.FC<{ tick: TimelineTick; leftPct: number; activeSides: ViewId[]; onSelect: () => void }> = ({ tick, leftPct, activeSides, onSelect }) => {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            // stopPropagation so this exact tick is what gets picked, even
            // when it happens to sit at (or very near) the same pixel as a
            // tick from another source — the track's own onPointerDown below
            // otherwise resolves by nearest-pixel across EVERY source, and a
            // strict "<" tie-break there always keeps whichever tick sorted
            // earliest (Wayback/HLS/GE before Bing), silently making a
            // source unclickable whenever its one tick coincides with an
            // earlier-sorted one (Bing's single "current" date landing on
            // the same day as Wayback's/GE's own latest, in particular).
            onPointerDown={(e) => { e.stopPropagation(); onSelect() }}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-11 cursor-pointer"
            style={{ left: `${leftPct}%` }}
          >
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 mx-auto w-1"
              style={{ backgroundColor: SOURCE_CONFIG.wayback.color, opacity: 0.85 }}
            />
          </div>
        }
      />
      {/* Date first, then source, then which view(s) (if any) it's active
          on — same order as the generic tick tooltip below. */}
      <TooltipContent>
        <div>{new Date(tick.dateMs).toISOString().slice(0, 10)}</div>
        <div>{SOURCE_CONFIG.wayback.label}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">Mosaic: {tick.label}</div>
        {activeSides.length > 0 && <div className="text-[10px] text-gray-400">Map {activeSides.join(", ")}</div>}
      </TooltipContent>
    </Tooltip>
  )
}

export const HistoricalTimelinePanel: React.FC<{ state: any; setState: (updates: any) => void; mapRef: React.RefObject<MapRef> }> = ({ state, setState, mapRef }) => {
  const collapsed = !!state.historicalTimelineCollapsed
  const setCollapsed = useCallback((v: boolean) => setState({ historicalTimelineCollapsed: v }), [setState])
  const [activeSide, setActiveSide] = useState<ViewId>("A")
  const [syncEnabled, setSyncEnabled] = useAtom(historicalTimelineSyncAtom)
  const [sideColorOverrides] = useAtom(sideColorOverridesAtom)
  const [colorizeMapBordersStored] = useAtom(colorizeMapBordersAtom)
  // Colored map borders are historical-mode-only (TerrainViewer.tsx forces
  // them off for terrain mode's own Overlay/Side split) — this panel needs
  // the same override on its own read of the atom, or a preference set
  // while in historical mode would keep coloring these handles/captions
  // after switching to terrain, even though the actual map borders they're
  // supposed to match are already gone.
  const colorizeMapBorders = colorizeMapBordersStored && state.appMode === "historical"
  // Per-side identity colors are meaningless once the map borders they're
  // meant to match are off — undefined here signals every caller (handle
  // chips, side-picker buttons, A/B captions) to fall back to a plain
  // primary-colored/neutral look instead of a per-view hue nothing on the
  // map actually shows anymore.
  const colorFor = useCallback((side: ViewId): string | undefined =>
    colorizeMapBorders ? (sideColorOverrides[side] ?? SIDE_COLORS[side]) : undefined,
  [colorizeMapBorders, sideColorOverrides])
  // Expanded by default: title + source/resolution pills + sync/side-picker
  // shown. Toggled off via the cog button for a minimal header (just a small
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
  const setPanelHeight = useSetAtom(historicalTimelinePanelHeightAtom)
  // null = full extent (no zoom applied) — see the wheel-zoom handler below.
  const [viewWindow, setViewWindow] = useState<{ min: number; max: number } | null>(null)
  // See the DEFAULT_VIEW_FLOOR_MS/defaultMin/effectiveMin comments further
  // down — a plain ref (not state) since it only ever needs to be read
  // during the SAME render pass whose triggering action (a wheel event, a
  // gutter drag) already calls setViewWindow and forces that re-render.
  const hasZoomedRef = useRef(false)
  // A continuous trackpad two-finger swipe rarely has PURE deltaX — tiny
  // deltaY noise on individual events means a per-event `abs(deltaX) >
  // abs(deltaY)` check can flip between the pan and zoom branches below
  // several times within what's really one gesture, each flip changing the
  // view a different (wrong) way — reads as a stutter/jitter rather than a
  // smooth pan. Locking the whole gesture to whichever mode its FIRST event
  // looked like, and only re-deciding after a real pause (no wheel events
  // for WHEEL_GESTURE_TIMEOUT_MS), keeps one swipe consistently doing one
  // thing.
  const wheelGestureRef = useRef<{ mode: "pan" | "zoom"; lastEventTime: number } | null>(null)
  // The track's own bounding rect, measured once per gesture (on its first
  // event) and reused for every subsequent event in that same gesture rather
  // than re-measured on every single wheel tick — a fast trackpad's momentum-
  // decay tail can fire dozens of events a second, and layout stays put for
  // the gesture's whole duration (nothing else resizes the panel while the
  // user is actively scrolling it), so the repeated getBoundingClientRect()
  // calls were pure unnecessary layout-read cost landing right in the
  // highest-frequency part of the gesture — exactly where any extra per-event
  // work is most likely to show up as a dropped frame / light stutter.
  const gestureRectRef = useRef<DOMRect | null>(null)
  // `| null` in the generic (not just the initial value) so this stays a
  // MutableRefObject — setTrackRef below needs to assign trackRef.current
  // itself (not just let JSX's `ref={trackRef}` do it), which TS otherwise
  // rejects as read-only on the plain useRef<HTMLDivElement>(null) overload.
  const trackRef = useRef<HTMLDivElement | null>(null)
  // Ctrl+drag on a handle: sweep every OTHER handle on one side of it along
  // by the same number of tick-marks. `snapshot` is frozen at pointerdown —
  // which handles count as "left"/"right" of the dragged one is decided
  // once, from positions at drag START, not recomputed as things move (a
  // handle that gets swept past the dragged one mid-gesture stays swept).
  // `direction` starts at 0 (undecided) and locks to -1/1 on the first
  // pointermove that clears a small dead-zone — this is "the start of the
  // drag indicates which side moves": a left-starting drag only ever
  // affects handles that started left of the dragged one, even if the user
  // later drags back past their starting point.
  const ctrlGroupDragRef = useRef<{
    dragSide: ViewId
    dragOriginalIndex: number
    startClientX: number
    direction: -1 | 0 | 1
    snapshot: { side: ViewId; originalIndex: number }[]
  } | null>(null)
  // Which DOM node the panel itself lives in, plus whether the user's most
  // recent pointerdown anywhere on the page landed inside it — see the
  // ArrowLeft/ArrowRight handler below for why this exists.
  const panelElRef = useRef<HTMLDivElement | null>(null)
  const lastPointerInPanelRef = useRef(false)
  // Drag state for the horizontal pan gutter below the track — a plain ref
  // (not state) since it only needs to survive across pointermove events
  // within one drag gesture, not trigger renders itself.
  const gutterDragRef = useRef<{ startClientX: number; startMin: number; gutterWidthPx: number } | null>(null)
  const [planetKey] = useAtom(planetKeyAtom)
  const hasPlanetKey = !!planetKey
  const [isSidebarOpen] = useAtom(isSidebarOpenAtom)
  const isMobile = useIsMobile()

  // Grid/dual-mode shape — generalizes the old fixed A/B pair to every
  // active view (A-F) in the current gridLayout. "overlay" always compares
  // exactly 2 views (A/B), and terrain mode is always forced to 2x1 too
  // (it has no grid-layout picker of its own) — same policy as
  // TerrainViewer.tsx's own effectiveGridLayout. Missing the terrain-mode
  // half of that used to leave this reading state.gridLayout's raw stored
  // value directly — switching FROM a historical 3x2 grid TO terrain mode
  // left every one of that grid's 6 views' pills on the timeline, even
  // though TerrainViewer.tsx itself had already collapsed back to 2x1.
  const gridLayoutForTimeline: GridLayoutId = (state.splitStyle === "overlay" || state.appMode !== "historical")
    ? "2x1"
    : (state.gridLayout ?? "2x1")
  // Every side beyond A only ever shows as independently-draggable when
  // views are genuinely independent (per-view basemap AND split both on) —
  // in every other mode every side's basemap is identical by construction
  // (see TerrainViewer.tsx), so extra handles would just shadow the first.
  const dualMode = !!state.basemapPerView && state.splitStyle !== "off"
  const activeViews: ViewId[] = dualMode ? GRID_LAYOUTS[gridLayoutForTimeline].grid.flat() : ["A"]

  const activeBasemapSourceFor = useCallback((side: ViewId) => resolveActiveHistoricalSource(
    state[viewFieldName(side, "basemapSource", state.basemapPerView)],
    state[viewFieldName(side, "historicalActiveSource", state.basemapPerView)],
  ), [state])
  const isHistoricalFor = useCallback((side: ViewId) => TIMELINE_SOURCE_IDS.has(activeBasemapSourceFor(side)), [activeBasemapSourceFor])
  // A view only ever gets a handle/pill once it's ACTUALLY on a historical
  // source — a dual-mode view sitting on a plain basemap (e.g. B on Google
  // Hybrid while A is historical) has no real date to show, so it's dropped
  // entirely rather than showing a placeholder/preview pill for a source
  // it isn't even on yet.
  const showFor = isHistoricalFor
  // The source browsed/displayed for each view. Bing bypasses the
  // "historical" indirection entirely (buildTickUpdates writes
  // basemapSource(side) = "bing" directly, never touching
  // historicalActiveSource(side) at all — see its own comment) — so a plain
  // read of historicalActiveSource(side) here (the previous version of this)
  // stayed on whatever nested source was last browsed (e.g. "wayback") even
  // once the view was actually showing Bing, silently pointing every tick
  // lookup at the wrong source: the handle would render at that stale
  // source's position, and clicking/dragging Bing's own tick never visibly
  // "stuck" since the very next render immediately looked it up under the
  // wrong source again. activeBasemapSourceFor(side) already resolves this
  // correctly (including the "historical" indirection's own nested-source
  // lookup) whenever the view is genuinely on a real timeline source; only
  // fall back to the plain historicalActiveSource(side) read for a view
  // that's on neither (e.g. Google Hybrid) — used by the "first landing on
  // historical" effect below to still have a sensible source to jump to.
  const displaySourceFor = useCallback((side: ViewId) => {
    const active = activeBasemapSourceFor(side)
    return TIMELINE_SOURCE_IDS.has(active) ? active : state[viewFieldName(side, "historicalActiveSource", state.basemapPerView)]
  }, [activeBasemapSourceFor, state])
  // Sync only ever governs which SOURCE/RESOLUTION PILLS are toggled on
  // (shared vs. per-side, see pillsField below) — it has never applied to
  // the actual scrubber selection (which tick/date is active). Every active
  // view always gets its own independent handle and its own independent
  // date, full stop, even if they happen to coincide (e.g. two views both
  // set to Planet Monthly 2023-12) — that's just two handles landing on the
  // same spot, not a "linked" state.
  const dualUnsynced = dualMode && !syncEnabled

  // Both refs below use a CALLBACK ref (not a plain useRef + useEffect
  // keyed on an empty/stable dep array) for a real reason, not style: this
  // whole component returns null outright whenever `panelVisible` is false
  // (see "if (!panelVisible) return null" below) — collapsing the timeline
  // (the clock-icon toggle) and re-expanding it later unmounts and remounts
  // BOTH the track div and the outer panel div together. A plain effect
  // with `[]`/`[setPanelHeight]` deps only runs once, on this component
  // instance's very first mount — its ResizeObserver keeps watching that
  // ORIGINAL (now-detached, dead) DOM node forever, and the ref variable
  // itself gets silently repointed at the new node on every remount with no
  // new observer ever created for it. Concretely: the reported width/height
  // atoms froze at whatever they were the very first time the panel ever
  // appeared, and every consumer keyed off them (minimap/scale offset here,
  // TerrainViewer.tsx's colored map borders) drifted out of sync with the
  // ACTUAL panel after the first collapse/expand cycle — confirmed live: the
  // border sat correctly on first load but landed behind the panel after
  // toggling it off and back on. A callback ref fires on every mount AND
  // unmount of the node it's attached to (not just the owning component's
  // own mount), so the observer always gets torn down and recreated against
  // whichever DOM node is actually live right now.
  const trackObserverRef = useRef<ResizeObserver | null>(null)
  const setTrackRef = useCallback((el: HTMLDivElement | null) => {
    trackRef.current = el
    trackObserverRef.current?.disconnect()
    trackObserverRef.current = null
    if (!el) return
    setTrackWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => setTrackWidth(entries[0].contentRect.width))
    observer.observe(el)
    trackObserverRef.current = observer
  }, [])

  // Reports the panel's own actual rendered height (border box, so
  // TerrainViewer's clearance above it is exact) — expanded vs. minimal mode
  // and the pill row wrapping onto a second line all change this, so a
  // static guessed constant elsewhere was never right for every case. A
  // callback ref fires synchronously during commit, before the browser
  // paints — same "no stale-fallback flash" guarantee the old
  // useLayoutEffect version had, without that version's stale-observer bug
  // (see the comment above setTrackRef).
  const panelObserverRef = useRef<ResizeObserver | null>(null)
  const setPanelRef = useCallback((el: HTMLDivElement | null) => {
    panelElRef.current = el
    panelObserverRef.current?.disconnect()
    panelObserverRef.current = null
    if (!el) return
    setPanelHeight(el.getBoundingClientRect().height)
    const observer = new ResizeObserver(() => setPanelHeight(el.getBoundingClientRect().height))
    observer.observe(el)
    panelObserverRef.current = observer
  }, [setPanelHeight])

  const { items: rawWaybackItems } = useWaybackItemsWithLocalChanges(state.lat, state.lng, state.zoom)
  // Reuses the same fetch as the ticks below (no separate network round
  // trip) for the "Open in..." button's own ESRI Wayback deep link — see
  // its terrain-mode mount further down.
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
  // now — see the state.date/dateA-F consolidation) rather than the release
  // number; lib/wayback.ts's useResolvedWaybackRelease is what turns a date
  // back into the actual release to fetch, entirely inside MapSources.tsx,
  // so this panel's own tick model never needs to think in release numbers
  // at all.
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
  // NEAREST match, not exact equality — a stored date (state.dateA-F) and a
  // wayback tick's own real.dateMs both ultimately come from Esri's
  // getMetadata() at slightly different times/locations (the map can pan a
  // hair between the original pick and a later re-render, re-triggering
  // useWaybackRealCaptureDates with marginally different coordinates), so
  // requiring bit-for-bit equality could genuinely miss the intended tick
  // and silently fall back elsewhere — reading as "the handle jumped to a
  // different mark". Nearest-match is also just the semantically correct
  // behavior for a date-based lookup: the source closest to that timestamp,
  // exactly as historicalActiveSource(A-F) already documents.
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
  // currently active (via the side picker below) when in dual mode with sync
  // off — letting each side aggregate a different subset of sources (e.g.
  // Wayback+GE for view A, HLS+Bing for view B).
  const pillsField = dualUnsynced ? viewFieldName(activeSide, "timelineSources", true) : "timelineSources"
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
  // time sync is off (edits go to timelineSources<Side> instead), so it can
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
  // useResolvedWaybackRelease) shares the same state.date/dateA-F field now.
  // Named for what it returns (a plain epoch-ms date, or 0 for "not yet
  // picked"), not "release", since it's no longer wayback-specific.
  const dateForSide = useCallback((side: ViewId): number => state[viewFieldName(side, "date", state.basemapPerView)], [state])

  // Falls back to the newest tick for a source when no date has ever been
  // recorded for it yet — lets a side that isn't historical yet (showFor
  // above) still preview a sensible tick instead of showing nothing.
  const newestTickFor = useCallback((source: string): TimelineTick | null => {
    for (let i = allTicks.length - 1; i >= 0; i--) if (allTicks[i].source === source) return allTicks[i]
    return null
  }, [allTicks])

  // The single source of truth for "what tick is this side showing right
  // now" — used both to compute the axis envelope (items, below) and the
  // actual handle position/caption. Falls back to a proposed (not-yet-
  // committed) tick via newestTickFor so a side that's merely PREVIEWING a
  // source (not historical yet) still has something sensible to render and
  // click.
  const resolveDisplayTick = useCallback((side: ViewId): TimelineTick | null => {
    const source = displaySourceFor(side)
    return findNearestTick(source, dateForSide(side)) ?? newestTickFor(source)
  }, [displaySourceFor, findNearestTick, dateForSide, newestTickFor])

  // Ticks/gridlines show sources currently toggled on via the pill row (both
  // the source pills and the VHR/Medium res chips). When unsynced in dual
  // mode, this is scoped to whichever side is currently active (activeSide)
  // — clicking a side letter shows only that side's chosen sources' ticks,
  // per the user's request (not a union of every side).
  //
  // BUT a side's own actively-displayed tick is always unioned in even if
  // its source isn't part of that filter — otherwise, since fullMin/fullMax
  // below are derived from this same list, a handle whose source falls
  // outside the currently-toggled pills still got positioned against an
  // axis that never accounted for its own date, landing it away from any
  // visible mark — reading as "the pill doesn't attach to a mark" even
  // though the caption below was reading the correct tick all along
  // (captions don't depend on this filtered/scaled list).
  const items = useMemo(() => {
    const filtered = allTicks.filter((t) => timelineSourcesForPills.includes(t.source) && resolutionClasses.includes(SOURCE_CONFIG[t.source]?.resClass))
    const activeTicks = activeViews.filter(showFor).map(resolveDisplayTick).filter((t): t is TimelineTick => !!t)
    const seen = new Set(filtered.map((t) => `${t.source}-${t.key}`))
    const extra = activeTicks.filter((t) => !seen.has(`${t.source}-${t.key}`))
    return extra.length ? [...filtered, ...extra].sort((a, b) => a.dateMs - b.dateMs) : filtered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTicks, timelineSourcesForPills, resolutionClasses, activeViews.join(","), showFor, resolveDisplayTick])

  // A side's basemapSource field is either a normal basemap id or the single
  // combined "historical" entry. Picking a non-Bing tick sets that field to
  // "historical" plus records WHICH concrete source is now active for that
  // side (historicalActiveSource<Side>) — Bing bypasses the indirection
  // entirely and is written directly, same as any other plain basemap id.
  // The date field itself is just its own date<Side> (or date, single-view)
  // now, the same one regardless of source — no more per-source field name
  // to resolve.
  const buildTickUpdates = useCallback((side: ViewId, tick: TimelineTick): Record<string, any> => {
    const sourceField = viewFieldName(side, "basemapSource", state.basemapPerView)
    const dateField = viewFieldName(side, "date", state.basemapPerView)
    const updates: Record<string, any> = { [dateField]: tick.dateMs }
    if (tick.source === "bing") {
      updates[sourceField] = "bing"
    } else {
      updates[sourceField] = "historical"
      updates[viewFieldName(side, "historicalActiveSource", state.basemapPerView)] = tick.source
    }
    return updates
  }, [state.basemapPerView])

  const setTickForSide = useCallback((side: ViewId, tick: TimelineTick) => {
    setState(buildTickUpdates(side, tick))
  }, [buildTickUpdates, setState])

  // Absent an explicit pointer target (e.g. a keyboard step), which side an
  // action applies to: the only historical side when just one is showing,
  // otherwise whichever side the user last touched (activeSide).
  const resolveSide = useCallback((): ViewId => {
    if (!dualMode) return "A"
    const showing = activeViews.filter(showFor)
    if (showing.length === 1) return showing[0]
    return showing.includes(activeSide) ? activeSide : (showing[0] ?? "A")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualMode, activeViews.join(","), showFor, activeSide])

  // First time a view actually lands on a historical source with no date
  // picked yet (dateForSide still 0), jump straight to the newest available
  // tick for that view's active source rather than rendering nothing until
  // the user manually picks one.
  useEffect(() => {
    for (const side of activeViews) {
      if (isHistoricalFor(side) && !dateForSide(side)) {
        const pool = allTicks.filter((t) => t.source === displaySourceFor(side))
        if (pool.length) setTickForSide(side, pool[pool.length - 1])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeViews.join(","), isHistoricalFor, displaySourceFor, allTicks, dateForSide, setTickForSide,
    state.basemapPerView,
    state.basemapSourceA, state.basemapSourceB, state.basemapSourceC, state.basemapSourceD, state.basemapSourceE, state.basemapSourceF, state.basemapSourceG, state.basemapSourceH, state.basemapSource,
    state.historicalActiveSourceA, state.historicalActiveSourceB, state.historicalActiveSourceC, state.historicalActiveSourceD, state.historicalActiveSourceE, state.historicalActiveSourceF, state.historicalActiveSourceG, state.historicalActiveSourceH, state.historicalActiveSource,
    state.dateA, state.dateB, state.dateC, state.dateD, state.dateE, state.dateF, state.dateG, state.dateH, state.date,
  ])

  // fullMin/fullMax are the TRUE domain (every real tick, unfloored) — they
  // gate how far zoom/pan can ever reach, so an old outlier (Google Earth
  // Historical often has one isolated ~1945 tick for well-covered cities
  // like Paris, decades before its next real one) must stay reachable by
  // manually zooming/panning out, not permanently hidden. defaultMin is a
  // SEPARATE floor that only affects the very first render (no viewWindow
  // yet) — without it, that single outlier would squish the default view
  // into an unusable sliver where every recent decade is a few pixels wide.
  // Once the user has actually zoomed/panned (viewWindow set), this floor
  // no longer applies at all — see effectiveMin below.
  const DEFAULT_VIEW_FLOOR_MS = Date.UTC(2010, 0, 1)
  const fullMin = items[0]?.dateMs ?? 0
  const fullMax = items[items.length - 1]?.dateMs ?? fullMin + 1
  const fullSpan = Math.max(1, fullMax - fullMin)
  const defaultMin = fullMax > DEFAULT_VIEW_FLOOR_MS ? Math.max(fullMin, DEFAULT_VIEW_FLOOR_MS) : fullMin
  // The actual reachable zoom-out/pan boundary — every fullMin/fullMax used
  // below as a hard zoom/pan limit (as opposed to the raw tick data itself)
  // is now this, not the true unpadded domain — see ZOOM_OUT_PADDING_FRACTION.
  const zoomOutPaddingMs = Math.min(fullSpan * ZOOM_OUT_PADDING_FRACTION, ZOOM_OUT_PADDING_MAX_MS)
  const paddedMin = fullMin - zoomOutPaddingMs
  const paddedMax = fullMax + zoomOutPaddingMs
  const paddedSpan = paddedMax - paddedMin
  // Sticky once true — the wheel-zoom handler and the pan-gutter below both
  // set this on the FIRST real interaction. Needed because zooming/panning
  // all the way back out to the padded full extent resets viewWindow to null
  // (same "no zoom active" state as the pristine initial render, see the
  // wheel handler's own `newSpan >= paddedSpan ? null : ...`) — without this,
  // effectiveMin would then snap back to the floored defaultMin instead of
  // staying at paddedMin, undoing the very zoom-out the user just did.

  // Re-clamp a zoomed window whenever the full extent itself shifts (e.g. a
  // pill toggle shrinks the dataset) so a stale window can't reference dates
  // outside the new full range.
  useEffect(() => {
    if (!viewWindow) return
    const min = Math.max(paddedMin, viewWindow.min)
    const max = Math.min(paddedMax, viewWindow.max)
    if (max <= min) { setViewWindow(null); return }
    if (min !== viewWindow.min || max !== viewWindow.max) setViewWindow({ min, max })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paddedMin, paddedMax])

  const effectiveMin = viewWindow ? Math.max(paddedMin, viewWindow.min) : (hasZoomedRef.current ? paddedMin : defaultMin)
  const effectiveMax = viewWindow ? Math.min(paddedMax, viewWindow.max) : paddedMax
  const effectiveSpan = Math.max(1, effectiveMax - effectiveMin)
  // Is there real content outside the current view (pan gutter's own
  // visibility gate) — independent of whether the user has ever actually
  // zoomed (viewWindow can be null while this is still true, e.g. the very
  // first render with an outlier tick clipped by the 2010 default-view floor).
  const hasHiddenRange = effectiveSpan < paddedSpan - 1
  const fracForTick = useCallback((tick: TimelineTick) => Math.min(1, Math.max(0, (tick.dateMs - effectiveMin) / effectiveSpan)), [effectiveMin, effectiveSpan])

  // Only ticks inside the current zoom window actually render — clamping
  // their frac to [0,1] instead (piling up out-of-window ticks at the edges)
  // would misleadingly suggest they're at the boundary.
  const visibleItems = useMemo(() => items.filter((t) => t.dateMs >= effectiveMin && t.dateMs <= effectiveMax), [items, effectiveMin, effectiveMax])

  // Ticks previously got nudged a few pixels apart from a close neighbor to
  // stay visually distinct (two different sources landing on the same or
  // near-same date, e.g. Planet/HLS both on the 1st) — dropped in favor of
  // always drawing at the tick's own true chronological position. Nudging
  // interacted badly with the per-side handles (which must sit exactly ON
  // the active tick's own position, see handleLeftPctFor below): whenever a
  // handle's tick had a close neighbor, the nudge could shift either one
  // just enough that the round handle no longer visually lined up with its
  // own mark, even though the underlying date/source selection was always
  // correct. Genuinely coincident ticks now simply overlap — the same
  // trade-off already accepted for the handles themselves further down.
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
    // UTC throughout (getUTCFullYear/Date.UTC), not local time — effectiveMin's
    // own floor (DEFAULT_VIEW_FLOOR_MS) is a Date.UTC value, so mixing in a
    // local-time year boundary here could put it on the wrong side of that
    // floor in any non-UTC timezone: in a UTC+ zone, local Jan-1-2010
    // midnight is BEFORE the UTC floor, so the "2010" mark computed itself
    // then got silently dropped by the `t < effectiveMin` check below,
    // leaving 2011 as the first visible label instead of 2010.
    const startYear = new Date(effectiveMin).getUTCFullYear()
    const endYear = new Date(effectiveMax).getUTCFullYear()
    const msPerYear = 365.25 * 86_400_000
    const pxPerYear = trackWidth / (effectiveSpan / msPerYear)
    let step = YEAR_STEPS[YEAR_STEPS.length - 1]
    for (const s of YEAR_STEPS) {
      if (pxPerYear * s >= MIN_YEAR_LABEL_GAP_PX) { step = s; break }
    }
    const marks: { frac: number; label: string }[] = []
    const firstMarkYear = Math.ceil(startYear / step) * step
    for (let y = firstMarkYear; y <= endYear; y += step) {
      const t = Date.UTC(y, 0, 1)
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
  const nearestIndexForClientX = useCallback((clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !items.length) return null
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    let bestIdx = 0
    let bestDist = Math.abs(tickLeftPct(items[0]) / 100 - frac)
    for (let i = 1; i < items.length; i++) {
      const d = Math.abs(tickLeftPct(items[i]) / 100 - frac)
      if (d < bestDist) { bestIdx = i; bestDist = d }
    }
    return bestIdx
  }, [items, tickLeftPct])
  const nearestTickForClientX = useCallback((clientX: number): TimelineTick | null => {
    const idx = nearestIndexForClientX(clientX)
    return idx === null ? null : items[idx]
  }, [items, nearestIndexForClientX])

  // Ctrl+drag "move this pill and sweep everything on one side along with
  // it" — see ctrlGroupDragRef below for the full gesture. Index space here
  // is the FLATTENED, all-sources-combined `items` list (same list/order
  // nearestTickForClientX above already searches) — NOT each handle's own
  // source filtered down on its own. Two sides on different sources still
  // move by "the same number of marks" this way, just counted along the one
  // timeline everything is actually drawn on, matching what dragging N
  // marks visually looks like on screen — scoping the index to each
  // handle's own source individually (an earlier version of this) meant two
  // sources with very different tick density disagreed on what "N marks"
  // even meant, which read as the sweep being driven by raw time distance
  // instead of a clean mark count.
  const indexInFlatList = useCallback((source: string, key: number): number => {
    return items.findIndex((t) => t.source === source && t.key === key)
  }, [items])
  const tickAtFlatOffset = useCallback((originalIndex: number, deltaN: number): TimelineTick | null => {
    if (!items.length) return null
    return items[Math.max(0, Math.min(items.length - 1, originalIndex + deltaN))]
  }, [items])

  // If a zoomed window is active and the tick just applied falls outside it,
  // recenter (keeping the same span) so the newly-active selection never
  // strands itself off-screen.
  const maybeRecenterWindow = useCallback((dateMs: number) => {
    if (!viewWindow) return
    if (dateMs >= effectiveMin && dateMs <= effectiveMax) return
    const span = effectiveMax - effectiveMin
    let newMin = dateMs - span / 2
    newMin = Math.max(paddedMin, Math.min(paddedMax - span, newMin))
    setViewWindow({ min: newMin, max: newMin + span })
  }, [viewWindow, effectiveMin, effectiveMax, paddedMin, paddedMax])

  // An off-screen handle's chevron click used to recenter the view exactly
  // on that handle's own date — jumping straight to it rather than letting
  // the user see what's actually between here and there. Instead, this
  // moves just the relevant edge (min for a left chevron, max for a right
  // one) all the way PAST the clicked handle's own real date, by a further
  // 20% of that same delta — e.g. left: delta = effectiveMin - targetDateMs
  // (always positive, since dirFor only calls this when the tick is
  // genuinely off-screen that way), newMin = targetDateMs - delta * 0.2,
  // landing 20% of the original gap beyond the handle rather than exactly
  // on top of it. This guarantees the handle is inside the new window after
  // exactly ONE click — a flat "20% of the current span" step (an earlier
  // version of this) could take an arbitrarily long string of barely-
  // perceptible clicks to ever reach a handle far off-screen, since each
  // step was scaled to the current (possibly tiny, zoomed-in) span rather
  // than to how far away the target actually was.
  const expandViewWindowToward = useCallback((dir: "left" | "right", targetDateMs: number) => {
    hasZoomedRef.current = true
    let newMin = effectiveMin
    let newMax = effectiveMax
    if (dir === "left") {
      const delta = effectiveMin - targetDateMs
      newMin = Math.max(paddedMin, targetDateMs - delta * CHEVRON_EXPAND_FRACTION)
    } else {
      const delta = targetDateMs - effectiveMax
      newMax = Math.min(paddedMax, targetDateMs + delta * CHEVRON_EXPAND_FRACTION)
    }
    setViewWindow(newMax - newMin >= paddedSpan ? null : { min: newMin, max: newMax })
  }, [effectiveMin, effectiveMax, paddedMin, paddedMax, paddedSpan])

  // The single entry point for "a tick was picked", whether by click, drag,
  // or arrow-key step — always applies to exactly ONE side (explicit, from a
  // pointer event targeting a specific handle, or resolved from context for
  // a keyboard step/background click). Sync never affects this — see the
  // dualUnsynced comment above.
  const applyTick = useCallback((tick: TimelineTick, explicitSide?: ViewId) => {
    const which = explicitSide ?? resolveSide()
    setActiveSide(which)
    setTickForSide(which, tick)
    maybeRecenterWindow(tick.dateMs)
  }, [resolveSide, setTickForSide, maybeRecenterWindow])

  const scrubTo = useCallback((which: ViewId, clientX: number) => {
    const tick = nearestTickForClientX(clientX)
    if (tick) applyTick(tick, which)
  }, [nearestTickForClientX, applyTick])

  const step = useCallback((direction: number) => {
    const which = resolveSide()
    const source = displaySourceFor(which)
    const key = dateForSide(which)
    const idx = items.findIndex((t) => t.source === source && t.key === key)
    if (idx === -1) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= items.length) return
    applyTick(items[newIdx])
  }, [resolveSide, displaySourceFor, dateForSide, items, applyTick])

  const panelVisible = state.historicalBeta && activeViews.some(showFor) && !collapsed
  // The primary basemap SOURCE is always mounted regardless of this toggle
  // (RasterBasemapSource in MapSources.tsx) — but its LAYER's visibility is
  // separately gated by state.showRasterBasemap (MapLayers.tsx), and that
  // defaults to OFF. So it's entirely possible to be actively scrubbing
  // through historical dates here while nothing is actually visible on the
  // map — worth flagging rather than leaving the user to wonder why nothing
  // changed.
  const rasterBasemapOff = !state.showRasterBasemap

  // Tracks whether the user's most recent pointerdown anywhere on the page
  // landed inside this panel — capture phase so it still fires even when the
  // mousedown target is inside a Portal-rendered popover (a Select's open
  // listbox, a Dialog, etc.) that would otherwise stop propagation before a
  // bubble-phase listener saw it.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      lastPointerInPanelRef.current = !!(panelElRef.current && e.target instanceof Node && panelElRef.current.contains(e.target))
    }
    window.addEventListener("pointerdown", handler, { capture: true })
    return () => window.removeEventListener("pointerdown", handler, { capture: true })
  }, [])

  // Arrow-key stepping — replaces the old play/pause/prev/next buttons.
  // Listens globally (not just while the track has focus) so it still works
  // while a pill/handle has focus rather than the track itself, but that
  // same "not just while the track has focus" breadth was exactly the bug:
  // arrowing through an OPEN dropdown's own options (e.g. cycling Blend Mode
  // in the sidebar) also fired this handler on every keypress, since a
  // Select's trigger button isn't an INPUT/TEXTAREA/SELECT/contentEditable
  // and so slipped right past the exclusion check below, silently stepping
  // the historical date/source underneath the sidebar at the same time.
  // Gating on lastPointerInPanelRef instead — arrow keys only step the
  // timeline when the panel itself was the last thing actually clicked —
  // fixes that without having to special-case every possible non-native
  // dropdown/listbox implementation elsewhere in the app.
  useEffect(() => {
    if (!panelVisible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      if (!lastPointerInPanelRef.current) return
      const el = document.activeElement
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable)) return
      e.preventDefault()
      step(e.key === "ArrowLeft" ? -1 : 1)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [panelVisible, step])

  // Mousewheel zoom/pan reads effectiveMin/Max/Span, paddedMin/Max/Span and
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
  const wheelStateRef = useRef({ effectiveMin, effectiveMax, effectiveSpan, paddedMin, paddedMax, paddedSpan, viewWindow, hasHiddenRange })
  useEffect(() => {
    wheelStateRef.current = { effectiveMin, effectiveMax, effectiveSpan, paddedMin, paddedMax, paddedSpan, viewWindow, hasHiddenRange }
  })

  // Coalesces rapid wheel events (a trackpad's momentum-deceleration tail
  // can fire far faster than 60fps) into at most one setViewWindow per
  // animation frame — every event still updates `pendingViewWindowRef`
  // (so nothing is lost), only the actual React state write is throttled.
  // Wrapped in `{ window }` (rather than storing the window directly) so
  // "a reset-to-full-extent is pending" (window: null) stays distinguishable
  // from "nothing is pending yet" (the ref itself is null).
  const pendingViewWindowRef = useRef<{ window: { min: number; max: number } | null } | null>(null)
  const wheelRafIdRef = useRef<number | null>(null)
  const scheduleViewWindow = useCallback((window: { min: number; max: number } | null) => {
    pendingViewWindowRef.current = { window }
    if (wheelRafIdRef.current !== null) return
    wheelRafIdRef.current = requestAnimationFrame(() => {
      wheelRafIdRef.current = null
      const pending = pendingViewWindowRef.current
      pendingViewWindowRef.current = null
      if (pending) setViewWindow(pending.window)
    })
  }, [setViewWindow])

  // Attached imperatively (not a JSX onWheel) so preventDefault reliably
  // blocks page-scroll — React treats wheel listeners as passive by default.
  useEffect(() => {
    const el = trackRef.current
    if (!el || !panelVisible) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      hasZoomedRef.current = true
      // Base this event's math off whatever's still PENDING (not yet
      // flushed to React state) rather than the last committed render's
      // wheelStateRef snapshot, whenever one exists — otherwise several
      // events coalesced into the same animation frame would each compute
      // their delta against the same stale starting point instead of
      // compounding on each other, undercounting the total pan/zoom by
      // however many events got batched into that frame.
      const pending = pendingViewWindowRef.current
      const committed = wheelStateRef.current
      const { paddedMin, paddedMax, paddedSpan, hasHiddenRange } = committed
      const effectiveMin = pending ? (pending.window?.min ?? paddedMin) : committed.effectiveMin
      const effectiveMax = pending ? (pending.window?.max ?? paddedMax) : committed.effectiveMax
      const effectiveSpan = effectiveMax - effectiveMin
      // A trackpad's two-finger swipe fires wheel events with deltaX
      // dominant (vs. deltaY for a mouse wheel / vertical scroll gesture) —
      // treat that as PAN instead of zoom, matching how every other
      // horizontally-zoomed surface (a browser page, a chart) responds to
      // the same gesture. Gated on hasHiddenRange (is there real content to
      // pan to), NOT on viewWindow already being set — same bug the pan
      // gutter had: the very first render can already have hasHiddenRange
      // true (an outlier tick clipped by the 2010 default-view floor) while
      // viewWindow is still null, and gating on viewWindow there silently
      // no-opped every pan tick while nearby near-vertical wheel noise (a
      // real trackpad swipe is rarely PURE deltaX) still fell through to the
      // zoom branch below and changed the view anyway — the mix of "nothing
      // happens" and "a little zoom happens" on alternating events is what
      // read as stutter, plus whatever tick sits mid-view staying visually
      // pinned since the pan itself never actually moved anything.
      const now = performance.now()
      const priorGesture = wheelGestureRef.current
      const isNewGesture = !priorGesture || now - priorGesture.lastEventTime > WHEEL_GESTURE_TIMEOUT_MS
      const mode: "pan" | "zoom" = isNewGesture
        ? (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? "pan" : "zoom")
        : priorGesture.mode
      wheelGestureRef.current = { mode, lastEventTime: now }
      if (isNewGesture || !gestureRectRef.current) gestureRectRef.current = el.getBoundingClientRect()
      const rect = gestureRectRef.current
      if (mode === "pan") {
        if (!hasHiddenRange) return
        const span = effectiveMax - effectiveMin
        const deltaMs = (e.deltaX / rect.width) * effectiveSpan
        let newMin = effectiveMin + deltaMs
        newMin = Math.max(paddedMin, Math.min(paddedMax - span, newMin))
        scheduleViewWindow({ min: newMin, max: newMin + span })
        return
      }
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const cursorDate = effectiveMin + frac * effectiveSpan
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newSpan = Math.min(paddedSpan, Math.max(MIN_VISIBLE_SPAN_MS, effectiveSpan * factor))
      let newMin = cursorDate - frac * newSpan
      newMin = Math.max(paddedMin, Math.min(paddedMax - newSpan, newMin))
      const newMax = newMin + newSpan
      scheduleViewWindow(newSpan >= paddedSpan ? null : { min: newMin, max: newMax })
    }
    el.addEventListener("wheel", handleWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", handleWheel)
      if (wheelRafIdRef.current !== null) cancelAnimationFrame(wheelRafIdRef.current)
      wheelRafIdRef.current = null
      pendingViewWindowRef.current = null
    }
  }, [panelVisible, scheduleViewWindow])

  if (!panelVisible) return null

  // Per-side display tick/caption/handle-position, computed once here for
  // every active+showing view — replaces the old tickA/tickB/captionLabelA/
  // captionLabelB/handleLeftPctA/handleLeftPctB pairs.
  const showingViews = activeViews.filter(showFor)
  const tickBySide: Partial<Record<ViewId, TimelineTick>> = {}
  const captionBySide: Partial<Record<ViewId, string>> = {}
  const handleLeftPctBySide: Partial<Record<ViewId, number>> = {}
  for (const side of showingViews) {
    const tick = resolveDisplayTick(side)
    if (!tick) continue
    tickBySide[side] = tick
    // A wayback tick's own dateMs IS already the real resolved capture date
    // (see waybackTicks above) — no separate lookup needed, unlike before
    // the state.date/dateA-F consolidation.
    captionBySide[side] = tick.source === "wayback" ? new Date(tick.dateMs).toISOString().slice(0, 10) : tick.label
    handleLeftPctBySide[side] = tickLeftPct(tick)
  }

  // Two (or more) views can genuinely land on the same date (e.g. both set
  // to Planet Monthly 2023-12) and render as overlapping circles — rather
  // than artificially nudging them apart (which read as fundamentally
  // weird: the dot's position implying a date it doesn't actually have),
  // later-declared handles sit on top and naturally capture the click/drag
  // first (each handle's own stopPropagation() keeps that click from also
  // reaching an earlier handle or the track background underneath).
  // Dragging one out from under another (or an arrow-key step) reveals it
  // normally. Coincident handles switch to a split gradient (one color slice
  // per coincident side) so hovering any one of them still reads as "N sides
  // are here", regardless of which is on top.
  const coincidentGroup = (side: ViewId): ViewId[] => {
    const pct = handleLeftPctBySide[side]
    if (pct === undefined) return [side]
    return showingViews.filter((s) => handleLeftPctBySide[s] !== undefined && Math.abs((handleLeftPctBySide[s] as number) - pct) < 0.05)
  }
  // undefined (colorizeMapBorders off) means "use the plain primary-colored
  // CSS classes instead" — every caller applies those as a className
  // fallback rather than trying to render an undefined inline background.
  const handleBackground = (side: ViewId): string | undefined => {
    if (!colorizeMapBorders) return undefined
    const group = coincidentGroup(side)
    if (group.length <= 1) return colorFor(side)
    const step = 100 / group.length
    return `linear-gradient(90deg, ${group.map((s, i) => `${colorFor(s)} ${i * step}%, ${colorFor(s)} ${(i + 1) * step}%`).join(", ")})`
  }

  // A handle's own date can fall outside the current zoomed viewWindow
  // (mousewheel zoom) while fracForTick still clamps its POSITION to
  // [0,1] — rendering the round handle pinned at the edge at the same time
  // as a separate off-screen indicator collided visually. Instead, off-
  // screen replaces the round handle entirely with one combined rect chip
  // (letter + chevron, see renderHandle below) — never both at once.
  const dirFor = (side: ViewId): "left" | "right" | null => {
    const tick = tickBySide[side]
    if (!tick) return null
    return tick.dateMs < effectiveMin ? "left" : tick.dateMs > effectiveMax ? "right" : null
  }

  const renderHandle = (side: ViewId) => {
    const tick = tickBySide[side]
    if (!tick) return null
    const dir = dirFor(side)
    const bg = handleBackground(side)
    const group = coincidentGroup(side)
    if (dir) {
      return (
        <Tooltip key={side}>
          <TooltipTrigger
            render={
              <button
                type="button"
                // The track underneath has its own onPointerDown that scrubs
                // whichever side is active to the nearest tick under the
                // cursor (by pixel, across every source) — without stopping
                // propagation here the same way the in-range handle below
                // does, that pointerdown bubbles up from this button BEFORE
                // its own onClick fires, silently re-scrubbing this handle to
                // an unrelated nearby tick (a different source entirely, in
                // the worst case) a split second before the click's own
                // zoom-out actually runs. This button only ever widens the
                // shared view window — it must never touch any side's own
                // source/date.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => expandViewWindowToward(dir, tick.dateMs)}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 z-10 cursor-pointer flex items-center rounded-md border-2 border-background shadow px-0.5 h-4 text-[8px] font-bold leading-none",
                  bg ? "text-white" : "bg-primary text-primary-foreground",
                  dir === "left" ? "left-0" : "right-0",
                )}
                style={bg ? { background: bg } : undefined}
              >
                {dir === "left" && <ChevronLeft className="h-3 w-3" />}
                {showingViews.length > 1 && side}
                {dir === "right" && <ChevronRight className="h-3 w-3" />}
              </button>
            }
          />
          <TooltipContent>{side} — off-screen ({captionBySide[side]}), click to zoom out toward it</TooltipContent>
        </Tooltip>
      )
    }
    return (
      <Tooltip key={side}>
        <TooltipTrigger
          render={
            <div
              onPointerDown={(e: React.PointerEvent) => {
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
                setActiveSide(side)
                if (e.ctrlKey || e.metaKey) {
                  const snapshot = showingViews
                    .filter((s) => s !== side && tickBySide[s])
                    .map((s) => ({
                      side: s,
                      originalIndex: indexInFlatList(tickBySide[s]!.source, tickBySide[s]!.key),
                    }))
                    .filter((s) => s.originalIndex >= 0)
                  ctrlGroupDragRef.current = {
                    dragSide: side,
                    dragOriginalIndex: indexInFlatList(tick.source, tick.key),
                    startClientX: e.clientX,
                    direction: 0,
                    snapshot,
                  }
                  // No scrubTo here (unlike the plain-drag branch below) — the
                  // click landed on the handle itself, already at its own
                  // current tick, so there's nothing to move yet until the
                  // pointer actually travels.
                } else {
                  ctrlGroupDragRef.current = null
                  scrubTo(side, e.clientX)
                }
              }}
              onPointerMove={(e: React.PointerEvent) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
                const drag = ctrlGroupDragRef.current
                if (!drag || drag.dragSide !== side) {
                  scrubTo(side, e.clientX)
                  return
                }
                // Ctrl-drag: index space is the flattened, all-sources
                // combined list (nearestIndexForClientX/tickAtFlatOffset —
                // same list the plain drag's own nearestTickForClientX
                // already searches), not each handle's own source filtered
                // down on its own — so "N marks" means the same visual
                // distance along the timeline for every handle, dragged or
                // swept, regardless of which source each one happens to be
                // on.
                const newIdx = nearestIndexForClientX(e.clientX)
                if (newIdx === null) return
                const deltaN = newIdx - drag.dragOriginalIndex
                const draggedTick = tickAtFlatOffset(drag.dragOriginalIndex, deltaN)
                if (draggedTick) applyTick(draggedTick, side)
                if (drag.direction === 0) {
                  const dx = e.clientX - drag.startClientX
                  // Small dead-zone so a near-stationary click-then-jiggle
                  // doesn't lock in an arbitrary direction before the user's
                  // actual intent is clear.
                  if (Math.abs(dx) > 3) drag.direction = dx < 0 ? -1 : 1
                }
                if (drag.direction === 0) return
                // No "deltaN === 0 -> skip" shortcut here on purpose: dragging
                // back to the exact starting mark needs to re-apply deltaN=0
                // to every swept handle too, restoring each one to its own
                // original tick — an early return here would leave them
                // stuck at whatever the last nonzero deltaN had set them to.
                for (const snap of drag.snapshot) {
                  // Compare by flat-list INDEX, not date — a date comparison
                  // (the earlier version of this) is direction-asymmetric for
                  // a handle exactly coincident with the dragged one (a
                  // strict `<` can never be true for a tie, so it only ever
                  // classified as "right", meaning a coincident handle swept
                  // when dragging right but never when dragging left). Two
                  // distinct entries in `items` always have distinct indices
                  // even when their dates tie, so this has no tie case at all.
                  const isLeftOfDrag = snap.originalIndex < drag.dragOriginalIndex
                  if ((drag.direction === -1) !== isLeftOfDrag) continue
                  const newTick = tickAtFlatOffset(snap.originalIndex, deltaN)
                  if (newTick) setTickForSide(snap.side, newTick)
                }
              }}
              onPointerUp={(e: React.PointerEvent) => {
                e.currentTarget.releasePointerCapture(e.pointerId)
                ctrlGroupDragRef.current = null
              }}
              className={cn(
                "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-background shadow cursor-grab active:cursor-grabbing",
                !bg && "bg-primary",
              )}
              style={{ left: `${handleLeftPctBySide[side]}%`, ...(bg ? { background: bg } : {}) }}
            >
              {/* A single showing view has nothing to disambiguate — the
                  letter is pure clutter on an otherwise plain dot then. */}
              {showingViews.length > 1 && (
                <span className={cn("absolute inset-0 flex items-center justify-center text-[8px] font-bold leading-none pointer-events-none select-none", bg ? "text-white" : "text-primary-foreground")}>{side}</span>
              )}
            </div>
          }
        />
        <TooltipContent>
          {group.length > 1 ? (
            <>
              {group.map((s) => (
                <div key={s}>{s} — {SOURCE_CONFIG[tickBySide[s]!.source]?.label ?? tickBySide[s]!.source}: {captionBySide[s]}</div>
              ))}
            </>
          ) : (
            <>{side} — {SOURCE_CONFIG[tick.source]?.label ?? tick.source}: {captionBySide[side]}</>
          )}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      ref={setPanelRef}
      id="tour-historical-timeline"
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
              trailing cluster adjacent. Sync/side-picker only exist while the
              controls are expanded — hidden along with the pills otherwise. */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Which side's pill selection the source/resolution chips above
                edit — only meaningful (and only shown) while sync is off,
                since a shared pill state has no separate "side" to pick. */}
            {dualUnsynced && (
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                {activeViews.map((side) => {
                  const bg = colorFor(side)
                  return (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setActiveSide(side)}
                      className={cn(
                        "cursor-pointer px-2 py-0.5 text-[11px] font-semibold transition-colors",
                        activeSide === side
                          ? (bg ? "text-white" : "bg-primary text-primary-foreground")
                          : "text-muted-foreground hover:bg-accent",
                      )}
                      style={activeSide === side && bg ? { backgroundColor: bg } : undefined}
                    >
                      {side}
                    </button>
                  )
                })}
              </div>
            )}
            {dualMode && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={toggleSync}
                      className={cn(
                        "cursor-pointer p-1 rounded shrink-0",
                        syncEnabled ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                      aria-label={syncEnabled ? "Unsync per-view source & resolution pills" : "Sync per-view source & resolution pills"}
                    >
                      <Link2 className="h-4 w-4" />
                    </button>
                  }
                />
                <TooltipContent>{syncEnabled ? "Source/resolution pills shared between every view — the scrubbed date is always independent per side" : "Source/resolution pills set independently per side (use the letters above to pick which)"}</TooltipContent>
              </Tooltip>
            )}
            {rasterBasemapOff && (
              <Tooltip>
                <TooltipTrigger
                  render={<TriangleAlert className="h-4 w-4 text-primary shrink-0" />}
                />
                <TooltipContent>Raster Basemap is off (Visualization Modes) — historical imagery won't be visible on the map</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setControlsExpanded((v) => !v)}
                    className={cn(
                      "cursor-pointer p-1 rounded shrink-0",
                      controlsExpanded ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-label={controlsExpanded ? "Hide source/resolution controls" : "Show source/resolution controls"}
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>
                }
              />
              <TooltipContent>Sources & resolution</TooltipContent>
            </Tooltip>
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
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setControlsExpanded((v) => !v)}
                  className="cursor-pointer p-1 rounded text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Show source/resolution controls"
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              }
            />
            <TooltipContent>Sources & resolution</TooltipContent>
          </Tooltip>
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
            ref={setTrackRef}
            className="relative flex-1 h-12 mx-2 cursor-pointer touch-none"
            onPointerDown={(e) => {
              const which = showingViews.length === 1 ? showingViews[0] : activeSide
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
                gridlines/ticks (not the whole track) so the per-side handles
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
                // Which view(s) (if any) currently have this exact tick
                // active — shown as the last line of its tooltip.
                const activeSides = showingViews.filter((s) => tickBySide[s]?.source === t.source && tickBySide[s]?.key === t.key)
                return t.source === "wayback" ? (
                  <WaybackTickMark key={`${t.source}-${t.key}`} tick={t} leftPct={tickLeftPct(t)} activeSides={activeSides} onSelect={() => applyTick(t)} />
                ) : (
                  <Tooltip key={`${t.source}-${t.key}`}>
                    <TooltipTrigger
                      render={
                        <div
                          // See WaybackTickMark's own comment — stopPropagation
                          // here so clicking this exact mark always picks THIS
                          // source's tick, not whichever tied source sorts
                          // earlier under the track's nearest-pixel fallback.
                          onPointerDown={(e) => { e.stopPropagation(); applyTick(t) }}
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-11 cursor-pointer"
                          style={{ left: `${tickLeftPct(t)}%` }}
                        >
                          <div
                            className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 mx-auto w-1"
                            style={{ backgroundColor: SOURCE_CONFIG[t.source]?.color ?? "var(--muted-foreground)", opacity: 0.85 }}
                          />
                        </div>
                      }
                    />
                    {/* Date (yyyy-mm) first, then source, then which view(s)
                        (if any) it's active on. */}
                    <TooltipContent>
                      <div>{new Date(t.dateMs).toISOString().slice(0, 7)}</div>
                      <div>{SOURCE_CONFIG[t.source]?.label ?? t.source}</div>
                      {activeSides.length > 0 && <div className="text-[10px] text-gray-400">Map {activeSides.join(", ")}</div>}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
            {/* Off-screen (dirFor(side) set): ONE combined rounded-rect chip —
                letter + chevron pointing which way to look, e.g. "A>" or
                "<A" — replacing the round handle entirely rather than
                rendering both at the same clamped edge position (which
                collided visually). Clicking recenters the view on that
                handle's actual date. In-bounds: the normal round handle,
                draggable as before. Rendered in REVERSE activeViews order
                (A last) so A ends up on top and gets first pointer priority
                whenever multiple handles coincide — per the user's
                requested preference order (A, then B, then C, ...), the
                opposite of DOM order's default "later element wins". */}
            {[...showingViews].reverse().map(renderHandle)}
          </div>
        </div>

        {/* Horizontal pan gutter — always rendered (so the panel's own height
            never changes between zoomed and not), just transparent/inert at
            full extent since there's nowhere to pan to then. The track's own
            click/drag is already claimed by tick-scrubbing, so panning lives
            here instead: drag the thumb (sized/positioned to represent the
            current zoomed window's share of the full date range) to shift
            the view, or click the gutter background to jump the window
            there.

            Visibility is keyed on `hasHiddenRange` (is the full date range
            actually wider than what's currently shown), NOT on `viewWindow`
            being set — those are different things. `viewWindow` is only
            non-null once the user has manually zoomed/panned; the very
            first render already has real hidden content whenever the 2010
            default-view floor (defaultMin, see effectiveMin above) clips off
            an older outlier tick (Google Earth Historical's occasional
            1945-era mark for well-covered cities). Gating on `viewWindow`
            instead left the gutter fully transparent AND pointer-events-none
            in exactly that case — reachable only by first nudging the wheel
            zoom (which sets viewWindow), reading as "there's nothing back
            there" when there actually was. Toggling a source pill off/on
            reproduces this immediately: turning Google Earth back on adds
            its 1945 tick back into fullMin without ever setting viewWindow,
            so the gutter needs to react to that on its own. */}
        <div
          className={cn("relative h-1.5 mx-2 rounded-full", hasHiddenRange ? "bg-border/60 cursor-pointer" : "bg-transparent pointer-events-none")}
          onPointerDown={(e) => {
            if (!hasHiddenRange) return
            hasZoomedRef.current = true
            const rect = e.currentTarget.getBoundingClientRect()
            const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
            const span = effectiveMax - effectiveMin
            const newMin = Math.max(paddedMin, Math.min(paddedMax - span, paddedMin + frac * paddedSpan - span / 2))
            setViewWindow({ min: newMin, max: newMin + span })
          }}
        >
          <div
            onPointerDown={(e: React.PointerEvent) => {
              if (!hasHiddenRange) return
              hasZoomedRef.current = true
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
              const deltaMs = ((e.clientX - drag.startClientX) / drag.gutterWidthPx) * paddedSpan
              const span = effectiveMax - effectiveMin
              const newMin = Math.max(paddedMin, Math.min(paddedMax - span, drag.startMin + deltaMs))
              setViewWindow({ min: newMin, max: newMin + span })
            }}
            onPointerUp={(e: React.PointerEvent) => { e.currentTarget.releasePointerCapture(e.pointerId); gutterDragRef.current = null }}
            className={cn(
              "absolute top-0 bottom-0 rounded-full touch-none",
              hasHiddenRange ? "bg-muted-foreground/50 hover:bg-muted-foreground/70 cursor-grab active:cursor-grabbing" : "bg-transparent",
            )}
            style={{
              left: hasHiddenRange ? `${((effectiveMin - paddedMin) / paddedSpan) * 100}%` : "0%",
              width: hasHiddenRange ? `${Math.max(4, (effectiveSpan / paddedSpan) * 100)}%` : "100%",
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

        {/* The A/B date-caption row only ever fits 2 sides side by side — so
            it's strictly a 2x1-dual-mode row (for any bigger grid — 3x1,
            2x2, 3x2, 4x1 — the per-handle tooltips above already carry each
            side's own date/source, and the panel is simply shorter by this
            row's height instead). Within 2x1, each side's caption shows
            independently: A only if A is actually on a historical source, B
            only if B is — a non-historical side keeps an empty span
            placeholder so justify-between doesn't drift the other caption
            (or the centered launcher below) sideways. Gating on
            showingViews.length === 2 (the previous version) got both halves
            wrong: a 2x2 with exactly two historical views showed the row
            (mislabeled as if A/B), and a 2x1 with only one historical side
            hid a perfectly good caption.
            Terrain mode's own "Open in..." launcher is ALSO centered between
            the two captions here, since terrain mode is always forced to
            the 2x1 grid this row needs anyway — a second copy alongside the
            unconditional one in General Settings (general-settings.tsx),
            since this row (and the whole timeline panel it's part of) only
            shows once a historical basemap is actually active and expanded.
            Historical mode keeps its own copy in Compare and Blend
            (comparison-mix-section.tsx), unrelated to this row. */}
        {dualMode && gridLayoutForTimeline === "2x1" && (
          <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums mx-2">
            {(["A", "B"] as const).map((side, idx) => (
              <Fragment key={side}>
                {idx === 1 && state.appMode !== "historical" && (
                  <OpenInLinksButton state={state} mapRef={mapRef} waybackLatestRelease={latestWaybackRelease} className="shrink-0 h-6 px-2 text-[10px]" />
                )}
                {isHistoricalFor(side) ? (
                  <span style={{ color: colorFor(side) }}>
                    {`${side}: ${tickBySide[side] ? `${SOURCE_CONFIG[tickBySide[side]!.source]?.label} ${captionBySide[side]}` : "—"}`}
                  </span>
                ) : (
                  <span />
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
