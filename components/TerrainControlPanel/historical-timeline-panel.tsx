import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom } from "jotai"
import { ChevronDown, Play, Pause, SkipBack, SkipForward } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWaybackItemsWithLocalChanges, useWaybackCaptureDate, sortByDateAscending } from "@/lib/wayback"
import { syntheticHlsTicks } from "@/lib/hls"
import { useGeHistoricalDates } from "@/lib/ge-historical"
import { planetMonthlyTicks } from "@/lib/planet"
import { useBingCaptureDate } from "@/lib/bing"
import { HISTORICAL_BASEMAP_IDS } from "@/lib/historical-sources"
import { planetKeyAtom } from "@/lib/settings-atoms"

// Hardcoded (not var(--primary)/theme tokens) deliberately — same reasoning
// as the geolocate control's active/error state colors (src/index.css): A/B
// need to read as the same two colors regardless of which color preset is
// active, since they're a stable visual convention (blue=A, green=B) shared
// with the timeline captions and the sidebar's own SourceAbToggle meaning,
// not a themeable decoration.
const COLOR_A = "#3b82f6"
const COLOR_B = "#22c55e"

const PLAY_INTERVAL_MS = 900

// Minimum pixel gap between two adjacent year labels before the later one is
// dropped — same idea as a chart axis thinning its tick labels, so a dense
// multi-decade range never renders overlapping text.
const MIN_YEAR_LABEL_GAP_PX = 32

// Registry of aggregatable timeline sources — the pill row below toggles
// membership in state.timelineSources, and each tick is colored by its
// source so a merged wayback+HLS timeline still reads as two distinct series.
// resClass is a coarse, per-SOURCE (not per-tile) resolution bucket used by
// the VHR/Medium chips below — Wayback/GE Historical/Bing are all sub-meter-
// ish "very high resolution" mosaics, while HLS (Landsat/Sentinel-2, 10-30m)
// and Planet (~4.7m PlanetScope) read as coarser "medium" imagery next to them.
const SOURCE_CONFIG: Record<string, { label: string; color: string; resClass: "vhr" | "medium" }> = {
  wayback: { label: "Wayback", color: "#64748b", resClass: "vhr" },
  hls: { label: "HLS", color: "#8b5cf6", resClass: "medium" },
  "ge-historical": { label: "GE Historical", color: "#f97316", resClass: "vhr" },
  planet: { label: "Planet", color: "#14b8a6", resClass: "medium" },
  bing: { label: "Bing", color: "#0078d4", resClass: "vhr" },
}
const SOURCE_IDS = Object.keys(SOURCE_CONFIG)

const RESOLUTION_CLASSES: { id: "vhr" | "medium"; label: string }[] = [
  { id: "vhr", label: "VHR" },
  { id: "medium", label: "Medium res" },
]

type TimelineTick = { source: string; key: number; dateMs: number; label: string }

export const HistoricalTimelinePanel: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [collapsed, setCollapsed] = useState(false)
  const [activeHandle, setActiveHandle] = useState<"A" | "B">("A")
  const [playing, setPlaying] = useState(false)
  const [trackWidth, setTrackWidth] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)
  const [planetKey] = useAtom(planetKeyAtom)
  const hasPlanetKey = !!planetKey

  const activeBasemapSourceA = state.basemapPerView ? state.basemapSourceA : state.basemapSource
  const activeBasemapSourceB = state.basemapPerView ? state.basemapSourceB : state.basemapSource
  const aIsHistorical = HISTORICAL_BASEMAP_IDS.has(activeBasemapSourceA)
  const bIsHistorical = HISTORICAL_BASEMAP_IDS.has(activeBasemapSourceB)
  // A and B only ever show as independently-draggable when they're genuinely
  // independent views (per-view basemap AND split-screen both on) — in every
  // other mode activeBasemapSourceA === activeBasemapSourceB by construction
  // (see TerrainViewer.tsx), so a second handle would just shadow the first.
  const dualMode = state.basemapPerView && state.splitScreen
  const showA = aIsHistorical
  const showB = dualMode && bIsHistorical

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => setTrackWidth(entries[0].contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { items: rawWaybackItems } = useWaybackItemsWithLocalChanges(state.lat, state.lng, state.zoom)
  const waybackTicks = useMemo<TimelineTick[]>(
    () => sortByDateAscending(rawWaybackItems).map((item) => ({
      source: "wayback", key: item.releaseNum, dateMs: item.releaseDatetime, label: item.releaseDateLabel,
    })),
    [rawWaybackItems],
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
  const allTicks = useMemo(
    () => [...waybackTicks, ...hlsTicks, ...geTicks, ...planetTicks, ...bingTicks].sort((a, b) => a.dateMs - b.dateMs),
    [waybackTicks, hlsTicks, geTicks, planetTicks, bingTicks],
  )
  const findTick = useCallback(
    (source: string, key: number) => allTicks.find((t) => t.source === source && t.key === key) ?? null,
    [allTicks],
  )

  const visibleSourceIds = useMemo(() => SOURCE_IDS.filter((id) => id !== "planet" || hasPlanetKey), [hasPlanetKey])
  const timelineSources: string[] = state.timelineSources?.length ? state.timelineSources : visibleSourceIds
  const toggleSource = useCallback((id: string) => {
    const set = new Set(timelineSources)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    // Never allow zero sources selected — collapsing to none would make the
    // timeline unusable with no way back in through the UI.
    setState({ timelineSources: set.size ? Array.from(set) : [id] })
  }, [timelineSources, setState])

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
  // pill off doesn't strand an already-picked date.
  const items = useMemo(
    () => allTicks.filter((t) => timelineSources.includes(t.source) && resolutionClasses.includes(SOURCE_CONFIG[t.source]?.resClass)),
    [allTicks, timelineSources, resolutionClasses],
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
    return 0
  }, [activeBasemapSourceA, activeBasemapSourceB, state.basemapPerView, state.waybackRelease, state.waybackReleaseA, state.waybackReleaseB, state.hlsDate, state.hlsDateA, state.hlsDateB, state.geDate, state.geDateA, state.geDateB, state.planetDate, state.planetDateA, state.planetDateB, state.bingDate, state.bingDateA, state.bingDateB])

  const dateFieldFor = useCallback((source: string, side: "A" | "B") => {
    if (source === "wayback") return side === "A" ? (state.basemapPerView ? "waybackReleaseA" : "waybackRelease") : "waybackReleaseB"
    if (source === "hls") return side === "A" ? (state.basemapPerView ? "hlsDateA" : "hlsDate") : "hlsDateB"
    if (source === "ge-historical") return side === "A" ? (state.basemapPerView ? "geDateA" : "geDate") : "geDateB"
    if (source === "bing") return side === "A" ? (state.basemapPerView ? "bingDateA" : "bingDate") : "bingDateB"
    return side === "A" ? (state.basemapPerView ? "planetDateA" : "planetDate") : "planetDateB"
  }, [state.basemapPerView])

  const setTickForSide = useCallback((side: "A" | "B", tick: TimelineTick) => {
    const sourceField = side === "A" ? (state.basemapPerView ? "basemapSourceA" : "basemapSource") : "basemapSourceB"
    setState({ [sourceField]: tick.source, [dateFieldFor(tick.source, side)]: tick.key })
  }, [state.basemapPerView, dateFieldFor, setState])

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

  const minDate = items[0]?.dateMs ?? 0
  const maxDate = items[items.length - 1]?.dateMs ?? minDate + 1
  const dateSpan = Math.max(1, maxDate - minDate)
  const fracForTick = useCallback((tick: TimelineTick) => Math.min(1, Math.max(0, (tick.dateMs - minDate) / dateSpan)), [minDate, dateSpan])

  // Full-year gridlines/labels, independent of where actual ticks fall —
  // reads as a normal calendar axis rather than one tick per release.
  const yearMarks = useMemo(() => {
    if (!items.length) return [] as { frac: number; label: string }[]
    const startYear = new Date(minDate).getFullYear()
    const endYear = new Date(maxDate).getFullYear()
    const marks: { frac: number; label: string }[] = []
    for (let y = startYear; y <= endYear; y++) {
      const t = new Date(y, 0, 1).getTime()
      if (t < minDate || t > maxDate) continue
      marks.push({ frac: (t - minDate) / dateSpan, label: String(y) })
    }
    return marks
  }, [items.length, minDate, maxDate, dateSpan])

  const visibleYearMarks = useMemo(() => {
    if (!trackWidth) return yearMarks
    const out: typeof yearMarks = []
    let lastPx = -Infinity
    for (const mark of yearMarks) {
      const px = mark.frac * trackWidth
      if (px - lastPx >= MIN_YEAR_LABEL_GAP_PX) { out.push(mark); lastPx = px }
    }
    return out
  }, [yearMarks, trackWidth])

  const nearestTickForClientX = useCallback((clientX: number): TimelineTick | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !items.length) return null
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    let best = items[0]
    let bestDist = Math.abs(fracForTick(items[0]) - frac)
    for (const t of items) {
      const d = Math.abs(fracForTick(t) - frac)
      if (d < bestDist) { best = t; bestDist = d }
    }
    return best
  }, [items, fracForTick])

  const scrubTo = useCallback((which: "A" | "B", clientX: number) => {
    const tick = nearestTickForClientX(clientX)
    if (tick) setTickForSide(which, tick)
  }, [nearestTickForClientX, setTickForSide])

  const step = useCallback((direction: number) => {
    const which = activeHandle === "B" && showB ? "B" : "A"
    const source = which === "A" ? activeBasemapSourceA : activeBasemapSourceB
    const key = releaseForSide(which)
    const idx = items.findIndex((t) => t.source === source && t.key === key)
    if (idx === -1) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= items.length) { setPlaying(false); return }
    setTickForSide(which, items[newIdx])
  }, [activeHandle, showB, activeBasemapSourceA, activeBasemapSourceB, releaseForSide, items, setTickForSide])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => step(1), PLAY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [playing, step])

  // The REAL per-tile acquisition date for the active wayback release at this
  // exact spot — a release's own label is a catalog-wide publish date, which
  // can differ from when this specific tile's imagery was actually taken
  // (see lib/wayback.ts's useWaybackCaptureDate). Queried unconditionally
  // (hooks can't be called conditionally); the hook itself no-ops when the
  // release number is 0 (i.e. this side isn't currently on wayback).
  const { label: waybackCaptureLabelA } = useWaybackCaptureDate(state.lat, state.lng, state.zoom, activeBasemapSourceA === "wayback" ? releaseForSide("A") : 0)
  const { label: waybackCaptureLabelB } = useWaybackCaptureDate(state.lat, state.lng, state.zoom, activeBasemapSourceB === "wayback" ? releaseForSide("B") : 0)

  if (!state.historicalBeta || (!showA && !showB)) return null

  const tickA = showA ? findTick(activeBasemapSourceA, releaseForSide("A")) : null
  const tickB = showB ? findTick(activeBasemapSourceB, releaseForSide("B")) : null
  const captionLabelA = tickA && tickA.source === "wayback" && waybackCaptureLabelA ? waybackCaptureLabelA : tickA?.label
  const captionLabelB = tickB && tickB.source === "wayback" && waybackCaptureLabelB ? waybackCaptureLabelB : tickB?.label

  return (
    <div className={cn(
      "fixed z-10 backdrop-blur-[2px] border border-border bg-background/95 shadow-sm transition-[background-color] duration-150",
      "bottom-0 left-0 right-0 rounded-none",
      "sm:bottom-4 sm:left-4 sm:right-[26rem] sm:rounded-xl",
    )}>
      <div className="flex items-center justify-between px-4 pt-3 pb-3 border-b gap-3">
        <h2 className="text-sm font-semibold shrink-0">Historical Timeline</h2>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {visibleSourceIds.map((id) => {
            const active = timelineSources.includes(id)
            const cfg = SOURCE_CONFIG[id]
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleSource(id)}
                className={cn(
                  "cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  active ? "text-white border-transparent" : "text-muted-foreground border-border hover:bg-accent",
                )}
                style={active ? { backgroundColor: cfg.color } : undefined}
              >
                {cfg.label}
              </button>
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
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="cursor-pointer p-1 text-muted-foreground hover:text-foreground shrink-0"
          aria-label={collapsed ? "Expand timeline" : "Collapse timeline"}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 py-3 space-y-1">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => step(-1)} className="cursor-pointer p-1.5 rounded hover:bg-accent" aria-label="Previous date">
              <SkipBack className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setPlaying((v) => !v)} className="cursor-pointer p-1.5 rounded hover:bg-accent" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => step(1)} className="cursor-pointer p-1.5 rounded hover:bg-accent" aria-label="Next date">
              <SkipForward className="h-4 w-4" />
            </button>

            <div
              ref={trackRef}
              className="relative flex-1 h-8 mx-2 cursor-pointer touch-none"
              onPointerDown={(e) => {
                const which = showA && !showB ? "A" : showB && !showA ? "B" : activeHandle
                setActiveHandle(which)
                scrubTo(which, e.clientX)
              }}
            >
              <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
              {yearMarks.map((mark) => (
                <div
                  key={`grid-${mark.label}`}
                  className="absolute top-0 bottom-0 w-px bg-border/70 pointer-events-none"
                  style={{ left: `${mark.frac * 100}%` }}
                />
              ))}
              {items.map((t) => (
                <Tooltip key={`${t.source}-${t.key}`}>
                  <TooltipTrigger
                    render={
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-3 cursor-help"
                        style={{ left: `${fracForTick(t) * 100}%` }}
                      >
                        <div
                          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 mx-auto w-px"
                          style={{ backgroundColor: SOURCE_CONFIG[t.source]?.color ?? "var(--muted-foreground)", opacity: 0.6 }}
                        />
                      </div>
                    }
                  />
                  <TooltipContent>{SOURCE_CONFIG[t.source]?.label ?? t.source}: {t.label}</TooltipContent>
                </Tooltip>
              ))}
              {showA && tickA && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div
                        onPointerDown={(e: React.PointerEvent) => {
                          e.stopPropagation()
                          e.currentTarget.setPointerCapture(e.pointerId)
                          setActiveHandle("A")
                          scrubTo("A", e.clientX)
                        }}
                        onPointerMove={(e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo("A", e.clientX) }}
                        onPointerUp={(e: React.PointerEvent) => e.currentTarget.releasePointerCapture(e.pointerId)}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-background shadow cursor-grab active:cursor-grabbing"
                        style={{ left: `${fracForTick(tickA) * 100}%`, backgroundColor: COLOR_A }}
                      />
                    }
                  />
                  <TooltipContent>A — {SOURCE_CONFIG[tickA.source]?.label ?? tickA.source}: {captionLabelA}</TooltipContent>
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
                          setActiveHandle("B")
                          scrubTo("B", e.clientX)
                        }}
                        onPointerMove={(e: React.PointerEvent) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo("B", e.clientX) }}
                        onPointerUp={(e: React.PointerEvent) => e.currentTarget.releasePointerCapture(e.pointerId)}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-background shadow cursor-grab active:cursor-grabbing"
                        style={{ left: `${fracForTick(tickB) * 100}%`, backgroundColor: COLOR_B }}
                      />
                    }
                  />
                  <TooltipContent>B — {SOURCE_CONFIG[tickB.source]?.label ?? tickB.source}: {captionLabelB}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          <div className="relative h-3">
            {visibleYearMarks.map((mark) => (
              <span
                key={mark.label}
                className="absolute -translate-x-1/2 text-[9px] text-muted-foreground tabular-nums"
                style={{ left: `calc(104px + ${mark.frac} * (100% - 104px))` }}
              >
                {mark.label}
              </span>
            ))}
          </div>

          <div className="flex justify-between text-[10px] tabular-nums pl-[104px]">
            {showA ? <span style={{ color: COLOR_A }}>A: {tickA ? `${SOURCE_CONFIG[tickA.source]?.label} ${captionLabelA}` : "—"}</span> : <span />}
            {showB ? <span style={{ color: COLOR_B }}>B: {tickB ? `${SOURCE_CONFIG[tickB.source]?.label} ${captionLabelB}` : "—"}</span> : <span />}
          </div>
        </div>
      )}
    </div>
  )
}
