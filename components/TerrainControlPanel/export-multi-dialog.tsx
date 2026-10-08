import type React from "react"
import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { Layers, Loader2, X, ChevronDown, TriangleAlert, RefreshCw } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DateField } from "@/components/ui/date-field"
import saveAs from "file-saver"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { planetKeyAtom, mapboxKeyAtom, maptilerKeyAtom, hereKeyAtom, timelineWindowRequestAtom, timelineViewWindowAtom } from "@/lib/settings-atoms"
import { SegmentedToggle } from "./controls-components"
import { drawingFeaturesAtom, drawingLayersAtom } from "./TerraDrawSystem"
import { SOURCE_CONFIG } from "./historical-timeline-panel"
import { CURRENT_BASEMAP_SOURCE_IDS, EXPORT_SOURCE_LABELS, listExportTicks, type ExportSourceId } from "@/lib/historical-export-sources"
import { exportMultiHistorical, exportTargetsFor, fetchZoomFor, groundSpanMeters, wantedPixelsFor, pickExportZoom, MAX_EXPORT_PIXELS_PER_SIDE, type ExportMultiMode, type ExportMultiSkip, type ExportResolutionSpec } from "@/lib/export-multi"
import { checkExportAvailability, zoomHintsFrom, type AvailabilityResult } from "@/lib/export-availability"
import { affineForGrid, crsLabel, projDef, resolveOutputCrs, suggestUtmEpsg, utmZoneOf, residualNote, RESIDUAL_WARNING_PX, type OutputCrsChoice } from "@/lib/output-crs"
import type { MapRef } from "react-map-gl/maplibre"
import type { Bbox4 } from "@/lib/feature-extent"
import { track } from "@/lib/analytics"
import { subscribeWaybackMeta } from "@/lib/wayback"
import { isoFromUtcMs, utcMsFromIso } from "@/lib/date-input"

// EOX Sentinel-2 is off by default: a 10 m yearly cloudless mosaic is rarely
// what someone exporting VHR history wants, and it adds a file per year.
const DEFAULT_SOURCE_IDS: ExportSourceId[] = ["wayback", "ge-historical", ...CURRENT_BASEMAP_SOURCE_IDS]
// Ordered for the picker: very-high-resolution archives first (Wayback, then
// Google Earth right under it), a rule, then the medium-resolution ones.
const HISTORICAL_VHR_IDS: readonly ExportSourceId[] = ["wayback", "ge-historical"]
const HISTORICAL_MEDIUM_IDS: readonly ExportSourceId[] = ["hls", "eox-s2", "planet"]
const HISTORICAL_SOURCE_IDS: readonly ExportSourceId[] = [...HISTORICAL_VHR_IDS, ...HISTORICAL_MEDIUM_IDS]

/** Label + one multi-select control on a single line: "All" first, then
 *  each source individually. The trigger spells out what is chosen. */
const SourcePicker: React.FC<{
  label: string
  ids: readonly ExportSourceId[]
  labelOf: (id: ExportSourceId) => string
  selected: Set<ExportSourceId>
  setSelected: React.Dispatch<React.SetStateAction<Set<ExportSourceId>>>
  hint?: string
  /** Optional partition: ids in groups[0] are listed first, then a rule,
   *  then the next group, and so on (VHR sources above medium-resolution). */
  groups?: readonly (readonly ExportSourceId[])[]
}> = ({ label, ids, labelOf, selected, setSelected, hint, groups }) => {
  const chosen = ids.filter((id) => selected.has(id))
  const allOn = chosen.length === ids.length && ids.length > 0
  const setMany = (on: boolean, only?: ExportSourceId) => setSelected((prev) => {
    const next = new Set(prev)
    for (const id of only ? [only] : ids) on ? next.add(id) : next.delete(id)
    return next
  })
  const names = chosen.map(labelOf).join(", ")
  const summary = chosen.length === 0 ? "None" : allOn ? `All (${names})` : names
  const slug = label.toLowerCase().replace(/\W+/g, "-")
  return (
    <div className="flex items-center gap-3">
      <Label className="text-sm font-medium shrink-0 w-36">{label}</Label>
      <Popover>
        <PopoverTrigger
          render={
            // w-0 + flex-1: a definite zero width makes the button contribute
            // nothing to the row's min-content size, so a long "All (...)"
            // summary truncates instead of widening the whole dialog (min-w-0
            // alone lets it SHRINK but still counts its text toward the
            // container's intrinsic width, which the dialog grid then honoured).
            <Button variant="outline" title={summary} className="flex-1 w-0 min-w-0 overflow-hidden justify-between cursor-pointer font-normal">
              <span className="truncate min-w-0">{summary}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </Button>
          }
        />
        <PopoverContent align="end" className="w-64 space-y-1.5">
          <div className="flex items-center gap-2">
            <Checkbox id={`${slug}-all`} checked={allOn} indeterminate={!allOn && chosen.length > 0} onCheckedChange={(v) => setMany(v === true)} className="cursor-pointer" />
            <Label htmlFor={`${slug}-all`} className="text-sm cursor-pointer font-medium">All</Label>
          </div>
          {(groups ?? [ids]).map((group, gi) => {
            const members = group.filter((id) => ids.includes(id))
            if (!members.length) return null
            return (
              <div key={gi} className="border-t pt-1.5 space-y-1.5">
                {members.map((id) => (
                  <div key={id} className="flex items-center gap-2">
                    <Checkbox id={`${slug}-${id}`} checked={selected.has(id)} onCheckedChange={(v) => setMany(v === true, id)} className="cursor-pointer" />
                    <Label htmlFor={`${slug}-${id}`} className="text-sm cursor-pointer truncate">{labelOf(id)}</Label>
                  </div>
                ))}
              </div>
            )
          })}
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </PopoverContent>
      </Popover>
    </div>
  )
}

const ALL_LAYERS = "__all__"
/** Above this many pixels a side the dialog shows a warning (the hard cap
 *  is MAX_EXPORT_PIXELS_PER_SIDE, where the export scales down). */
const LARGE_EDGE_PX = 4096
/** Targets probed by the availability check in feature mode, at most. */
const MAX_CHECKED_TARGETS = 8
/** Longest edge the first-opened dialog aims for, from which the GSD starts. */
const DEFAULT_LONGEST_EDGE_PX = 1024

/** "utm" is the zone of each AOI (the viewport's, or each feature's own);
 *  "utm-fixed" is the one zone of the viewport centre for every file. */
type CrsChoice = "3857" | "4326" | "utm" | "utm-fixed" | "other"

function formatGsd(m: number): string {
  return m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m >= 1 ? m.toFixed(2) : m.toFixed(3)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export const ExportMultiDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  /** Viewport centre + zoom, for the live "how many captures in this range"
   *  count below; the export itself still reads bounds at run time. */
  getMapView?: () => { lat: number; lng: number; zoom: number } | null
  /** View A, so the sizes follow the map while the dialog is open. */
  mapRef?: React.RefObject<MapRef | null>
}> = ({ open, onOpenChange, getMapBounds, getMapView, mapRef }) => {
  const features = useAtomValue(drawingFeaturesAtom)
  const layers = useAtomValue(drawingLayersAtom)
  const planetKey = useAtomValue(planetKeyAtom)
  const hasPlanetKey = !!planetKey
  const mapboxKey = useAtomValue(mapboxKeyAtom)
  const maptilerKey = useAtomValue(maptilerKeyAtom)
  const hereKey = useAtomValue(hereKeyAtom)
  const keys = useMemo(() => ({ mapbox: mapboxKey || undefined, maptiler: maptilerKey || undefined, here: hereKey || undefined }), [mapboxKey, maptilerKey, hereKey])
  const requestTimelineWindow = useSetAtom(timelineWindowRequestAtom)
  // Start from the range the timeline is already showing: opening the dialog
  // adopts its visible window as the start/end dates (only on open, so the
  // dates typed here are never overwritten while it is up). The two then stay
  // in step the other way round through timelineWindowRequestAtom below.
  const timelineWindow = useAtomValue(timelineViewWindowAtom)
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current && timelineWindow) {
      setStartDate(isoFromUtcMs(timelineWindow.min))
      setEndDate(isoFromUtcMs(timelineWindow.max))
    }
    wasOpenRef.current = open
  }, [open, timelineWindow])

  // "viewport" is the default — it needs nothing drawn at all, just the
  // current map view, so it's the path that works the instant the dialog
  // opens; "feature" (drawn layers) still needs an explicit switch.
  const [mode, setMode] = useState<ExportMultiMode>("viewport")
  const [layerId, setLayerId] = useState(ALL_LAYERS)
  const [sourceIds, setSourceIds] = useState<Set<ExportSourceId>>(new Set(DEFAULT_SOURCE_IDS))
  const [startDate, setStartDate] = useState(() => isoFromUtcMs(Date.now() - 365 * 86_400_000))
  const [endDate, setEndDate] = useState(() => isoFromUtcMs(Date.now()))
  const [pointPaddingMeters, setPointPaddingMeters] = useState(100)
  const [percentPadding, setPercentPadding] = useState(20)
  // The resolution is one ground sample distance (m/px at the AOI's centre
  // latitude), from which the output width and height follow through the
  // AOI's aspect; the three inputs edit the same number. Set from the
  // viewport the first time the dialog opens.
  const [gsd, setGsd] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ field: "gsd" | "w" | "h"; text: string } | null>(null)
  // When the last edit was a width or height, that edge is what is kept
  // as the view moves (the GSD re-derives); otherwise the GSD is kept.
  const keptEdgeRef = useRef<{ field: "w" | "h"; px: number } | null>(null)
  const [crsChoice, setCrsChoice] = useState<CrsChoice>("3857")
  const [otherEpsg, setOtherEpsg] = useState("")
  const [includeGdalScript, setIncludeGdalScript] = useState(false)
  // Off = list dates at the zoom the tiles are fetched at (accurate for the
  // exported pixels, may re-query). On = reuse the timeline's dates at the
  // map zoom (instant, matches the ticks on screen). See listingZoom.
  const [reuseTimelineDates, setReuseTimelineDates] = useState(false)

  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<{ phase: "listing" | "exporting"; fraction: number; label: string } | null>(null)
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ fileCount: number; skipped: ExportMultiSkip[]; warnings?: string[] } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const selectedFeatures = useMemo(
    () => layerId === ALL_LAYERS ? features : features.filter((f) => f.properties?.layerId === layerId),
    [features, layerId],
  )

  const hasTargets = mode === "viewport" ? true : selectedFeatures.length > 0

  // The map moving while the dialog is open: the viewport AOI, the sizes
  // and the availability check follow (moveend on view A).
  const [viewNonce, setViewNonce] = useState(0)
  useEffect(() => {
    if (!open) return
    const map = mapRef?.current?.getMap()
    if (!map) return
    const bump = () => setViewNonce((n) => n + 1)
    // A browser window resize changes the view's bbox too (MapLibre fires
    // moveend from resize(), but not from every container change).
    map.on("moveend", bump)
    map.on("resize", bump)
    return () => { map.off("moveend", bump); map.off("resize", bump) }
  }, [open, mapRef])

  // The export targets with their padded extents, as the export builds
  // them. The viewport bounds are re-read each time the dialog opens and
  // after every move.
  const targets = useMemo(() => {
    const b = getMapBounds()
    return exportTargetsFor({ mode, features: selectedFeatures, layers, viewportBbox: [b.west, b.south, b.east, b.north], pointPaddingMeters, percentPadding })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getMapBounds, mode, selectedFeatures, layers, pointPaddingMeters, percentPadding, open, viewNonce])
  const viewCenter = useMemo(() => { const b = getMapBounds(); return { lng: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 } }, [getMapBounds, viewNonce, open]) // eslint-disable-line react-hooks/exhaustive-deps
  // The AOI the size fields describe: the viewport, or the largest feature
  // (its width and height are then the maxima over the features).
  const sizingTarget = useMemo(() => {
    let best = targets[0]
    let bestArea = -1
    for (const t of targets) {
      const [w, h] = groundSpanMeters(t.paddedBbox)
      if (w * h > bestArea) { bestArea = w * h; best = t }
    }
    return best
  }, [targets])
  useEffect(() => {
    if (!open || gsd !== null) return
    const b = getMapBounds()
    const [w, h] = groundSpanMeters([b.west, b.south, b.east, b.north])
    const longest = Math.max(w, h)
    if (longest > 0) setGsd(longest / DEFAULT_LONGEST_EDGE_PX)
  }, [open, gsd, getMapBounds])
  const resolution = useMemo<ExportResolutionSpec>(() => ({ kind: "metersPerPixel", metersPerPixel: gsd ?? 1 }), [gsd])
  useEffect(() => {
    const kept = keptEdgeRef.current
    if (!kept || !sizingTarget) return
    const [wM, hM] = groundSpanMeters(sizingTarget.paddedBbox)
    const next = (kept.field === "w" ? wM : hM) / kept.px
    if (next > 0 && Number.isFinite(next)) setGsd(next)
  }, [sizingTarget])
  const sizePx = useMemo(() => (sizingTarget && gsd ? wantedPixelsFor(sizingTarget.paddedBbox, resolution)! : [0, 0] as [number, number]), [sizingTarget, gsd, resolution])
  const targetResolution = Math.max(sizePx[0], sizePx[1], 1)
  const sizeText = (field: "gsd" | "w" | "h") => {
    if (editing?.field === field) return editing.text
    if (!gsd) return ""
    return field === "gsd" ? formatGsd(gsd) : String(field === "w" ? sizePx[0] : sizePx[1])
  }
  const onSizeChange = (field: "gsd" | "w" | "h", text: string) => {
    setEditing({ field, text })
    const v = Number(text)
    if (!Number.isFinite(v) || v <= 0 || !sizingTarget) return
    const [wM, hM] = groundSpanMeters(sizingTarget.paddedBbox)
    if (field === "gsd") { keptEdgeRef.current = null; setGsd(v) }
    else if (field === "w") { keptEdgeRef.current = { field: "w", px: Math.round(v) }; setGsd(wM / Math.round(v)) }
    else { keptEdgeRef.current = { field: "h", px: Math.round(v) }; setGsd(hM / Math.round(v)) }
  }
  // The zoom the tiles are fetched at for this GSD (exportZoom below is
  // the listing zoom, capped where Wayback's metadata stops).
  const tileZoom = sizingTarget && gsd ? pickExportZoom(sizingTarget.paddedBbox, resolution, 256, 22) : 0
  const largeEdge = Math.max(sizePx[0], sizePx[1]) > LARGE_EDGE_PX
  const cappedEdge = Math.max(sizePx[0], sizePx[1]) > MAX_EXPORT_PIXELS_PER_SIDE

  // Output CRS: the suggested UTM zone follows the AOI centre (per target
  // in feature mode, each its own zone).
  const utmEpsgs = useMemo(() => Array.from(new Set(targets.map((t) => suggestUtmEpsg(t.centerLng, t.centerLat)))).sort((a, b) => a - b), [targets])
  const zoneName = (e: number) => { const z = utmZoneOf(e)!; return `${z.zone}${z.south ? "S" : "N"}` }
  const utmEachLabel = `UTM, zone of each AOI${utmEpsgs.length ? ` (${utmEpsgs.length > 4 ? `${utmEpsgs.slice(0, 4).map(zoneName).join(", ")}, …` : utmEpsgs.map(zoneName).join(", ")})` : ""}`
  const fixedUtmEpsg = suggestUtmEpsg(viewCenter.lng, viewCenter.lat)
  const utmFixedLabel = `UTM ${zoneName(fixedUtmEpsg)} (EPSG:${fixedUtmEpsg})`
  const otherEpsgCode = Number.parseInt(otherEpsg, 10)
  const outputCrs = useMemo<OutputCrsChoice | null>(() => {
    if (crsChoice === "3857") return { kind: "epsg", epsg: 3857 }
    if (crsChoice === "4326") return { kind: "epsg", epsg: 4326 }
    if (crsChoice === "utm") return { kind: "utm" }
    if (crsChoice === "utm-fixed") return { kind: "epsg", epsg: fixedUtmEpsg }
    return Number.isInteger(otherEpsgCode) && otherEpsgCode > 0 ? { kind: "epsg", epsg: otherEpsgCode } : null
  }, [crsChoice, otherEpsgCode, fixedUtmEpsg])
  // The affine's residual over the targets at the output size, so the
  // dialog can say when the footprint is too large for an unwarped export
  // in that CRS (the export itself still runs; the manifest records it).
  const [crsCheck, setCrsCheck] = useState<{ maxResidualPx: number; epsgs: number[]; error?: string } | null>(null)
  useEffect(() => {
    if (!open || !outputCrs || !gsd) { setCrsCheck(null); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      let maxResidualPx = 0
      const epsgs = new Set<number>()
      try {
        for (const t of targets.slice(0, 64)) {
          const epsg = resolveOutputCrs(outputCrs, t.centerLng, t.centerLat)
          epsgs.add(epsg)
          if (epsg !== 3857) await projDef(epsg)
          let [w, h] = wantedPixelsFor(t.paddedBbox, resolution)!
          const longest = Math.max(w, h)
          if (longest > MAX_EXPORT_PIXELS_PER_SIDE) { const k = MAX_EXPORT_PIXELS_PER_SIDE / longest; w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)) }
          const [west, south, east, north] = t.paddedBbox
          maxResidualPx = Math.max(maxResidualPx, affineForGrid({ west, south, east, north }, w, h, epsg).maxResidualPx)
        }
        if (!cancelled) setCrsCheck({ maxResidualPx, epsgs: Array.from(epsgs) })
      } catch (err) {
        if (!cancelled) setCrsCheck({ maxResidualPx: 0, epsgs: Array.from(epsgs), error: err instanceof Error ? err.message : String(err) })
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, outputCrs, gsd, targets, resolution])

  // Availability: one tile at each target's centre per source, at the zoom
  // the GSD needs; on a miss the finest zoom that answers. Runs on open,
  // when the GSD, sources, targets or dates change (debounced), and on
  // the Check button. The export starts from the zooms found.
  const [availability, setAvailability] = useState<{ results: AvailabilityResult[]; pending: boolean; forGsd: number | null; nothing?: string }>({ results: [], pending: false, forGsd: null })
  const [checkNonce, setCheckNonce] = useState(0)
  const availabilityAbortRef = useRef<AbortController | null>(null)
  const availabilityRunRef = useRef(0)
  const checkedTargets = useMemo(() => targets.slice(0, MAX_CHECKED_TARGETS), [targets])
  // Only the sources the pickers offer: a keyless Mapbox / MapTiler / HERE
  // or Planet is in the default selection but lists nothing.
  const checkedSourceIds = useMemo(() => Array.from(sourceIds).filter((id) =>
    (id !== "planet" || hasPlanetKey) && (id !== "mapbox" || !!mapboxKey) && (id !== "maptiler" || !!maptilerKey) && (id !== "here" || !!hereKey)), [sourceIds, hasPlanetKey, mapboxKey, maptilerKey, hereKey])
  useEffect(() => {
    if (!open) return
    availabilityAbortRef.current?.abort()
    const runId = ++availabilityRunRef.current
    // Nothing to check: say so and finish at once, no spinner.
    const nothing = !sourceIds.size ? "no source selected"
      : !checkedSourceIds.length ? "the selected sources have no key set"
        : !checkedTargets.length ? "no export target (draw something, or export the viewport)"
          : !gsd ? "no resolution" : null
    const startMs = utcMsFromIso(startDate)
    const endMs = utcMsFromIso(endDate, "end")
    if (nothing || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      setAvailability({ results: [], pending: false, forGsd: null, nothing: nothing ?? "the date range is empty" })
      return
    }
    const controller = new AbortController()
    availabilityAbortRef.current = controller
    setAvailability((prev) => ({ ...prev, pending: true, nothing: undefined }))
    const timer = setTimeout(async () => {
      let results: AvailabilityResult[] = []
      let forGsd: number | null = null
      try {
        results = await checkExportAvailability({ targets: checkedTargets, sourceIds: checkedSourceIds, resolution, startMs, endMs, planetKey, keys, signal: controller.signal })
        forGsd = gsd
      } catch (err) {
        if (!isAbortError(err)) console.warn("availability check failed", err)
      } finally {
        // Only the latest run reports; a superseded one has been aborted
        // and its successor is in charge of the pending flag.
        if (availabilityRunRef.current === runId && !controller.signal.aborted) setAvailability({ results, pending: false, forGsd })
      }
    }, 800)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, gsd, resolution, sourceIds, checkedSourceIds, checkedTargets, startDate, endDate, planetKey, keys, checkNonce])
  // The two candidate listing zooms for the viewport, so the choice below
  // can say when they coincide (and the toggle then changes nothing).
  const viewZoom = getMapView ? Math.round(getMapView()?.zoom ?? 0) : 0
  // Re-read the bounds each time the dialog opens: this component mounts
  // with the panel, before the map exists, and getMapBounds() then answers
  // the whole-world fallback - which at 512 px resolves to z1 and stuck
  // there because nothing in the memo's inputs ever changed.
  const exportZoom = useMemo(() => {
    const b = getMapBounds()
    return fetchZoomFor([b.west, b.south, b.east, b.north], targetResolution, resolution)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getMapBounds, targetResolution, resolution, open])
  const countZoom = reuseTimelineDates ? viewZoom : exportZoom

  // How many captures each selected source has inside the date range, at
  // the viewport centre — the same listing the export runs first, so the
  // dialog can say "37 files" before anyone presses Export instead of after.
  // Debounced: the date inputs fire on every keystroke, and Wayback/GE
  // listings are real network calls.
  const [rangeCounts, setRangeCounts] = useState<{ counts: Partial<Record<ExportSourceId, number>>; pending: boolean }>({ counts: {}, pending: false })
  // A Wayback release's real imagery date can land after the listing ran
  // (the lookup was failing or still in flight and the release was counted
  // at its catalog date, if at all): count again when one does. Dates that
  // land WHILE a listing is in flight are noted and folded into one recount
  // after it completes, rather than restarting it (the listing resolves
  // those very dates, so restarting on each would never let it finish).
  // Only wired while Wayback is selected.
  const [recount, setRecount] = useState(0)
  const countPendingRef = useRef(false)
  const missedMetaRef = useRef(false)
  const waybackSelected = sourceIds.has("wayback")
  useEffect(() => {
    if (!open || !waybackSelected) return
    return subscribeWaybackMeta(() => {
      if (countPendingRef.current) missedMetaRef.current = true
      else setRecount((n) => n + 1)
    })
  }, [open, waybackSelected])
  useEffect(() => {
    if (!open || !getMapView) return
    const view = getMapView()
    if (!view) return
    const startMs = utcMsFromIso(startDate)
    const endMs = utcMsFromIso(endDate, "end")
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return
    let cancelled = false
    setRangeCounts((prev) => ({ ...prev, pending: true }))
    countPendingRef.current = true
    const timer = setTimeout(async () => {
      const ids = Array.from(sourceIds)
      const results = await Promise.all(ids.map(async (id) => {
        try { return [id, (await listExportTicks(id, view.lat, view.lng, countZoom, startMs, endMs, planetKey, keys)).length] as const }
        catch { return [id, undefined] as const }
      }))
      if (cancelled) return
      const counts: Partial<Record<ExportSourceId, number>> = {}
      for (const [id, n] of results) if (n !== undefined) counts[id] = n
      setRangeCounts({ counts, pending: false })
      countPendingRef.current = false
      if (missedMetaRef.current) { missedMetaRef.current = false; setRecount((n) => n + 1) }
    }, 500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, getMapView, startDate, endDate, sourceIds, planetKey, keys, countZoom, recount])

  // Mirror the chosen range onto the historical timeline so its ticks show
  // exactly what is about to be exported. Debounced with the count above.
  useEffect(() => {
    if (!open) return
    const startMs = utcMsFromIso(startDate)
    const endMs = utcMsFromIso(endDate, "end")
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return
    const timer = setTimeout(() => requestTimelineWindow({ min: startMs, max: endMs, nonce: Date.now() }), 500)
    return () => clearTimeout(timer)
  }, [open, startDate, endDate, requestTimelineWindow])
  const totalInRange = Array.from(sourceIds).reduce((n, id) => n + (rangeCounts.counts[id] ?? 0), 0)
  const targetCount = mode === "viewport" ? 1 : selectedFeatures.length

  const handleRun = useCallback(async () => {
    if (isRunning || !hasTargets || !sourceIds.size || !outputCrs || !gsd) return
    const controller = new AbortController()
    abortControllerRef.current = controller
    setIsRunning(true)
    setError("")
    setResult(null)
    setProgress({ phase: "listing", fraction: 0, label: "Starting…" })
    // Read the LIVE viewport bounds right at run time (not memoized earlier
    // in the component's lifetime) — the user may have panned/zoomed since
    // opening this dialog.
    const bounds = getMapBounds()
    const viewportBbox: Bbox4 = [bounds.west, bounds.south, bounds.east, bounds.north]
    // sourceIds spells out WHICH historical providers get exported (wayback,
    // ge-historical, hls, planet, …), not just how many — sorted so the same
    // selection always yields one dashboard value regardless of click order.
    track("actions-export", { kind: "export-multi", mode, features: mode === "feature" ? selectedFeatures.length : 0, sources: sourceIds.size, sourceIds: Array.from(sourceIds).sort().join(","), gdal: includeGdalScript })
    try {
      const outcome = await exportMultiHistorical({
        mode,
        features: selectedFeatures,
        viewportBbox,
        layers,
        sourceIds: Array.from(sourceIds),
        startMs: utcMsFromIso(startDate),
        endMs: utcMsFromIso(endDate, "end"),
        pointPaddingMeters,
        percentPadding,
        targetResolution,
        resolution,
        outputCrs,
        // Only the zooms a finished check found for this very GSD: a hint
        // from a coarser one would cap the export below what it asks for.
        zoomHints: !availability.pending && availability.forGsd === gsd ? zoomHintsFrom(availability.results) : undefined,
        includeGdalScript,
        planetKey,
        keys,
        listingZoom: reuseTimelineDates ? getMapView?.()?.zoom : "fetch",
        signal: controller.signal,
        onProgress: ({ phase, completed, total, label }) => setProgress({ phase, fraction: total ? completed / total : 0, label }),
      })
      if (controller.signal.aborted) return
      // Nothing fetched means nothing worth a download: an empty zip (or one
      // holding only the gdal script) would just look like a broken export.
      if (outcome.fileCount === 0) {
        setError(outcome.skipped.length
          ? `Nothing exported — every target was skipped (${outcome.skipped[0].reason}${outcome.skipped.length > 1 ? `, and ${outcome.skipped.length - 1} more` : ""}).`
          : "Nothing exported — no target and source combination produced a file.")
        setResult({ fileCount: 0, skipped: outcome.skipped })
        return
      }
      saveAs(outcome.zipBlob, `historical-export-${Date.now()}.zip`)
      setResult({ fileCount: outcome.fileCount, skipped: outcome.skipped, warnings: outcome.warnings })
    } catch (err) {
      if (isAbortError(err)) {
        track("actions-export", { kind: "export-multi-cancelled" })
      } else {
        console.error("Export multi failed:", err)
        setError(err instanceof Error ? err.message : "Export failed")
      }
    } finally {
      abortControllerRef.current = null
      setIsRunning(false)
      setProgress(null)
    }
  }, [isRunning, hasTargets, mode, selectedFeatures, sourceIds, layers, startDate, endDate, pointPaddingMeters, percentPadding, targetResolution, resolution, outputCrs, gsd, availability, includeGdalScript, planetKey, keys, reuseTimelineDates, getMapView, getMapBounds])

  // Abort AND release the UI at once: the pipeline only notices the abort at
  // its next checkpoint, and a slow Wayback / Google Earth listing can sit
  // in between for many seconds, which read as "cancel does nothing".
  // Whatever the in-flight run produces afterwards is dropped via the
  // `controller.signal.aborted` guard in handleRun.
  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsRunning(false)
    setProgress(null)
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden" showCloseButton={false}>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">
          <X className="h-4 w-4" />
        </DialogClose>
        <DialogHeader>
          <DialogTitle>Export Multi (Historical)</DialogTitle>
          <DialogDescription>
            One GeoTIFF per export target × historical source × capture date in range, cropped to each target's own extent, bundled into a .zip. A target is either the current map viewport, or every drawn feature.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Export target</Label>
            <SegmentedToggle
              className="w-full"
              value={mode}
              onChange={(v) => setMode(v as ExportMultiMode)}
              options={[
                { value: "viewport", label: "Viewport" },
                { value: "feature", label: "Per-Feature" },
              ]}
            />
          </div>

          {mode === "viewport" ? (
            <p className="text-xs text-muted-foreground">Exports the current map view as a single extent — nothing needs to be drawn.</p>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Drawing layer</Label>
              <Select value={layerId} onValueChange={(v) => v && setLayerId(v)} items={[{ value: ALL_LAYERS, label: "All layers" }, ...layers.map((l) => ({ value: l.id, label: l.name }))]}>
                <SelectTrigger className="w-full cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_LAYERS}>All layers</SelectItem>
                  {layers.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedFeatures.length} feature{selectedFeatures.length === 1 ? "" : "s"} selected
                {!selectedFeatures.length && " — draw something first (Drawing section)"}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Start date</Label>
              <DateField value={startDate} max={endDate} onChange={setStartDate} aria-label="Start date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">End date</Label>
              <DateField value={endDate} min={startDate} onChange={setEndDate} aria-label="End date" />
            </div>
          </div>

          <div className="space-y-2">
            <SourcePicker
              label="Historical sources"
              ids={HISTORICAL_SOURCE_IDS.filter((id) => id !== "planet" || hasPlanetKey)}
              groups={[HISTORICAL_VHR_IDS, HISTORICAL_MEDIUM_IDS]}
              labelOf={(id) => SOURCE_CONFIG[id]?.label ?? EXPORT_SOURCE_LABELS[id]}
              selected={sourceIds}
              setSelected={setSourceIds}
              hint="One file per capture date in the range. Very-high-resolution archives above the rule, medium-resolution below."
            />
            <SourcePicker
              label="Current basemaps"
              ids={CURRENT_BASEMAP_SOURCE_IDS.filter((id) => (id !== "mapbox" || !!mapboxKey) && (id !== "maptiler" || !!maptilerKey) && (id !== "here" || !!hereKey))}
              labelOf={(id) => EXPORT_SOURCE_LABELS[id].replace(" (current)", "")}
              selected={sourceIds}
              setSelected={setSourceIds}
              hint="One file each, today's mosaic, regardless of the date range."
            />
            {getMapView && sourceIds.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {rangeCounts.pending ? "Counting captures in range… " : ""}
                <span className="text-foreground/80">{totalInRange} capture{totalInRange === 1 ? "" : "s"}</span> in range at the viewport centre, listed at z{countZoom}
                {targetCount > 1 && <> → about {totalInRange * targetCount} files across {targetCount} features</>}
                {": "}
                {[
                  ...Array.from(sourceIds).filter((id) => !CURRENT_BASEMAP_SOURCE_IDS.includes(id)).map((id) => `${SOURCE_CONFIG[id]?.shortLabel ?? EXPORT_SOURCE_LABELS[id]} ${rangeCounts.counts[id] ?? "…"}`),
                  ...(() => {
                    const cur = Array.from(sourceIds).filter((id) => CURRENT_BASEMAP_SOURCE_IDS.includes(id))
                    if (!cur.length) return []
                    const n = cur.reduce((acc, id) => acc + (rangeCounts.counts[id] ?? 0), 0)
                    return [`current basemaps ${rangeCounts.pending ? "…" : n}`]
                  })(),
                ].join(" · ")}
              </p>
            )}

          </div>

          {/* Padding only means anything relative to a drawn feature's own
              extent — the viewport target already IS the extent, nothing
              to pad it against. */}
          {mode === "feature" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Point padding (m)</Label>
                <Input type="number" min={0} value={pointPaddingMeters} onChange={(e) => setPointPaddingMeters(Number(e.target.value) || 0)} className="cursor-text" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Polygon/line padding (%)</Label>
                <Input type="number" min={0} value={percentPadding} onChange={(e) => setPercentPadding(Number(e.target.value) || 0)} className="cursor-text" />
              </div>
            </div>
          )}

          {/* One GSD, with the width and height it gives over the AOI: the
              three inputs edit the same number through the AOI's aspect. */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 min-w-0">
              <Label className="text-sm font-medium shrink-0 w-36">Resolution</Label>
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <Input type="number" min={0} step="any" aria-label="Ground sample distance, metres per pixel" title="Ground sample distance at the AOI centre latitude" value={sizeText("gsd")} onChange={(e) => onSizeChange("gsd", e.target.value)} onBlur={() => setEditing(null)} className="cursor-text w-0 flex-1 min-w-0 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                <span className="text-xs text-muted-foreground shrink-0">m/px</span>
                <Input type="number" min={1} step={1} aria-label={mode === "feature" ? "Maximum width in pixels" : "Width in pixels"} value={sizeText("w")} onChange={(e) => onSizeChange("w", e.target.value)} onBlur={() => setEditing(null)} className="cursor-text w-0 flex-1 min-w-0 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                <span className="text-xs text-muted-foreground shrink-0">×</span>
                <Input type="number" min={1} step={1} aria-label={mode === "feature" ? "Maximum height in pixels" : "Height in pixels"} value={sizeText("h")} onChange={(e) => onSizeChange("h", e.target.value)} onBlur={() => setEditing(null)} className="cursor-text w-0 flex-1 min-w-0 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                <span className="text-xs text-muted-foreground shrink-0">px</span>
                {largeEdge && (
                  <Tooltip>
                    <TooltipTrigger render={<TriangleAlert aria-label="Large output" className="h-4 w-4 shrink-0 text-amber-500 cursor-help" />} />
                    <TooltipContent side="top" className="max-w-[260px] text-xs">
                      {cappedEdge
                        ? `Over ${MAX_EXPORT_PIXELS_PER_SIDE} px a side: each file is scaled down to that cap.`
                        : `Over ${LARGE_EDGE_PX} px a side: large files, and a long fetch per capture (the cap is ${MAX_EXPORT_PIXELS_PER_SIDE} px).`}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground pl-[9.75rem]">
              {mode === "feature"
                ? `GSD at the AOI centre latitude; width × height are the maxima, over the largest feature${targets.length > 1 ? ` of ${targets.length}` : ""}.`
                : "GSD at the viewport centre latitude; width × height follow the viewport's aspect."}
              {" "}Tiles at z{tileZoom}.
            </p>
          </div>

          {/* Output CRS: the georeferencing only, the pixels stay the Web
              Mercator mosaic (an affine fitted through the corners). */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 min-w-0">
              <Label className="text-sm font-medium shrink-0 w-36">Output CRS</Label>
              <Select value={crsChoice} onValueChange={(v) => v && setCrsChoice(v as CrsChoice)} items={[
                { value: "3857", label: "EPSG:3857 (Web Mercator)" },
                { value: "4326", label: "EPSG:4326 (WGS 84)" },
                { value: "utm", label: utmEachLabel },
                { value: "utm-fixed", label: utmFixedLabel },
                { value: "other", label: "Other EPSG code…" },
              ]}>
                <SelectTrigger className="flex-1 w-0 min-w-0 cursor-pointer" aria-label="Output CRS">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3857">EPSG:3857 (Web Mercator)</SelectItem>
                  <SelectItem value="4326">EPSG:4326 (WGS 84)</SelectItem>
                  <SelectItem value="utm">{utmEachLabel}</SelectItem>
                  <SelectItem value="utm-fixed">{utmFixedLabel}</SelectItem>
                  <SelectItem value="other">Other EPSG code…</SelectItem>
                </SelectContent>
              </Select>
              {crsChoice === "other" && (
                <Input type="number" min={1} step={1} placeholder="e.g. 2154" aria-label="EPSG code" value={otherEpsg} onChange={(e) => setOtherEpsg(e.target.value)} className="cursor-text w-24 shrink-0 text-right" />
              )}
            </div>
            {crsChoice !== "3857" && (
              <p className={cn("text-xs pl-[9.75rem]", crsCheck?.error ? "text-red-500" : crsCheck && crsCheck.maxResidualPx > RESIDUAL_WARNING_PX ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                {crsCheck?.error ? crsCheck.error
                  : crsCheck && crsCheck.maxResidualPx > RESIDUAL_WARNING_PX
                    ? `Footprint too large for an unwarped export in ${crsCheck.epsgs.map((e) => `EPSG:${e}`).join(", ")}: up to ${crsCheck.maxResidualPx.toFixed(1)} px off at the corners, use EPSG:3857 or a smaller AOI.`
                    : crsCheck
                      ? `Pixels stay on the Web Mercator grid; the georeferencing is an affine in ${crsCheck.epsgs.map((e) => crsLabel(e)).join(", ")}, ${residualNote(crsCheck.maxResidualPx)}.`
                      : outputCrs ? "Checking the projection…" : "Type an EPSG code."}
              </p>
            )}
          </div>

          {/* Availability of the zoom the GSD needs, per source and target. */}
          {(
            <div className="space-y-1" data-testid="export-availability">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Tiles at this resolution</Label>
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs cursor-pointer ml-auto" disabled={availability.pending} onClick={() => setCheckNonce((n) => n + 1)}>
                  {availability.pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Check
                </Button>
              </div>
              {availability.nothing ? (
                <p className="text-xs text-muted-foreground" data-testid="availability-nothing">Nothing to check: {availability.nothing}.</p>
              ) : availability.pending && !availability.results.length ? (
                <p className="text-xs text-muted-foreground">Asking each source for one tile at the AOI centre…</p>
              ) : availability.results.length > 0 ? (
                <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                  {availability.results.map((r) => (
                    <li key={`${r.target}-${r.source}`} className={cn(
                      r.status === "ok" ? "text-muted-foreground" : r.status === "coarser" ? "text-amber-600 dark:text-amber-400" : r.status === "no-capture" ? "text-muted-foreground/70" : "text-red-500",
                    )}>
                      {checkedTargets.length > 1 && <span className="font-medium">{r.target}: </span>}{r.message}
                    </li>
                  ))}
                  {targets.length > checkedTargets.length && <li className="text-muted-foreground/70">Checked the first {checkedTargets.length} of {targets.length} features; the export steps down on its own for the rest.</li>}
                </ul>
              ) : null}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox id="export-multi-gdal" checked={includeGdalScript} onCheckedChange={(v) => setIncludeGdalScript(!!v)} className="cursor-pointer" />
            <Label htmlFor="export-multi-gdal" className="text-sm cursor-pointer">Include gdal_translate script</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="export-multi-reuse-dates" checked={reuseTimelineDates} onCheckedChange={(v) => setReuseTimelineDates(!!v)} className="cursor-pointer" />
            <Label htmlFor="export-multi-reuse-dates" className="text-sm cursor-pointer">
              Reuse the timeline&apos;s dates (map zoom z{viewZoom})
              <span className="text-xs text-muted-foreground font-normal">
                {viewZoom === exportZoom
                  ? " — same as the export zoom, no difference"
                  : ` — instant, but the export fetches at z${exportZoom}, where Wayback's releases and dates can differ`}
              </span>
            </Label>
          </div>
          {includeGdalScript && (
            <p className="text-xs text-muted-foreground">
              Adds a .bat per target with a gdal_translate command per capture (Wayback/HLS/Planet/EOX Sentinel-2 via GDAL_WMS's TMS service, Bing via its VirtualEarth service). Google Earth Historical has no public tile URL at all (this app resolves it internally), so it's skipped and REM-commented instead of included.
            </p>
          )}

          {progress && (
            <div className="space-y-1">
              <Progress value={progress.fraction * 100} className="h-1.5" />
              <p className="text-xs text-muted-foreground truncate">{progress.phase === "listing" ? "Listing dates: " : "Exporting: "}{progress.label}</p>
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          {result && (
            <div className="text-xs space-y-1 rounded bg-muted/50 p-2">
              <p className="font-medium">{result.fileCount} file{result.fileCount === 1 ? "" : "s"} exported.</p>
              {!!result.warnings?.length && (
                <ul className="text-amber-600 dark:text-amber-400 list-disc pl-4 max-h-24 overflow-y-auto">
                  {result.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {result.skipped.length > 0 && (
                <>
                  <p className="text-muted-foreground">{result.skipped.length} skipped:</p>
                  <ul className="text-muted-foreground list-disc pl-4 max-h-24 overflow-y-auto">
                    {result.skipped.slice(0, 20).map((s, i) => (
                      <li key={i}>{s.feature} — {s.source}: {s.reason}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleRun}
              disabled={isRunning || !hasTargets || !sourceIds.size || !outputCrs || !gsd}
              className={cn("flex-1 cursor-pointer", isRunning && "[&_svg]:animate-spin")}
            >
              {isRunning ? <Loader2 className="h-4 w-4 mr-1.5" /> : null}
              {isRunning ? "Exporting…" : "Run Export"}
            </Button>
            {isRunning && (
              <Button variant="outline" onClick={handleCancel} className="cursor-pointer text-destructive border-destructive hover:text-destructive">
                Cancel
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
