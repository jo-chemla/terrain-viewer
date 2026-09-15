import type React from "react"
import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { Layers, Loader2, X, CalendarDays, ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import saveAs from "file-saver"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { planetKeyAtom, mapboxKeyAtom, hereKeyAtom, timelineWindowRequestAtom } from "@/lib/settings-atoms"
import { SegmentedToggle } from "./controls-components"
import { drawingFeaturesAtom, drawingLayersAtom } from "./TerraDrawSystem"
import { SOURCE_CONFIG } from "./historical-timeline-panel"
import { CURRENT_BASEMAP_SOURCE_IDS, EXPORT_SOURCE_LABELS, listExportTicks, type ExportSourceId } from "@/lib/historical-export-sources"
import { exportMultiHistorical, type ExportMultiMode, type ExportMultiSkip } from "@/lib/export-multi"
import type { Bbox4 } from "@/lib/feature-extent"
import { track } from "@/lib/analytics"

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

/** "2024-03-08" <-> Date, UTC, for the calendar pickers. */
const parseIso = (s: string) => new Date(`${s}T12:00:00Z`)
const DatePickerButton: React.FC<{ value: string; onChange: (iso: string) => void; min?: string; max?: string }> = ({ value, onChange, min, max }) => (
  <Popover>
    <PopoverTrigger
      render={
        <Button variant="outline" className="w-full justify-between cursor-pointer font-normal tabular-nums">
          {value || "Pick a date"}
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </Button>
      }
    />
    <PopoverContent align="start" className="w-auto p-0">
      <Calendar
        mode="single"
        selected={value ? parseIso(value) : undefined}
        defaultMonth={value ? parseIso(value) : undefined}
        captionLayout="dropdown"
        startMonth={new Date(1930, 0)}
        endMonth={new Date()}
        disabled={[
          ...(min ? [{ before: parseIso(min) }] : []),
          ...(max ? [{ after: parseIso(max) }] : []),
        ]}
        onSelect={(d) => { if (d) onChange(isoDate(d)) }}
      />
    </PopoverContent>
  </Popover>
)
const ALL_LAYERS = "__all__"

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export const ExportMultiDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  /** Viewport centre + zoom, for the live "how many captures in this range"
   *  count below; the export itself still reads bounds at run time. */
  getMapView?: () => { lat: number; lng: number; zoom: number } | null
}> = ({ open, onOpenChange, getMapBounds, getMapView }) => {
  const features = useAtomValue(drawingFeaturesAtom)
  const layers = useAtomValue(drawingLayersAtom)
  const planetKey = useAtomValue(planetKeyAtom)
  const hasPlanetKey = !!planetKey
  const mapboxKey = useAtomValue(mapboxKeyAtom)
  const hereKey = useAtomValue(hereKeyAtom)
  const keys = useMemo(() => ({ mapbox: mapboxKey || undefined, here: hereKey || undefined }), [mapboxKey, hereKey])
  const requestTimelineWindow = useSetAtom(timelineWindowRequestAtom)

  // "viewport" is the default — it needs nothing drawn at all, just the
  // current map view, so it's the path that works the instant the dialog
  // opens; "feature" (drawn layers) still needs an explicit switch.
  const [mode, setMode] = useState<ExportMultiMode>("viewport")
  const [layerId, setLayerId] = useState(ALL_LAYERS)
  const [sourceIds, setSourceIds] = useState<Set<ExportSourceId>>(new Set(DEFAULT_SOURCE_IDS))
  const [startDate, setStartDate] = useState(() => isoDate(new Date(Date.now() - 365 * 86_400_000)))
  const [endDate, setEndDate] = useState(() => isoDate(new Date()))
  const [pointPaddingMeters, setPointPaddingMeters] = useState(100)
  const [percentPadding, setPercentPadding] = useState(20)
  const [targetResolution, setTargetResolution] = useState(512)
  const [includeGdalScript, setIncludeGdalScript] = useState(false)

  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<{ phase: "listing" | "exporting"; fraction: number; label: string } | null>(null)
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ fileCount: number; skipped: ExportMultiSkip[] } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const selectedFeatures = useMemo(
    () => layerId === ALL_LAYERS ? features : features.filter((f) => f.properties?.layerId === layerId),
    [features, layerId],
  )

  const hasTargets = mode === "viewport" ? true : selectedFeatures.length > 0

  // How many captures each selected source has inside the date range, at
  // the viewport centre — the same listing the export runs first, so the
  // dialog can say "37 files" before anyone presses Export instead of after.
  // Debounced: the date inputs fire on every keystroke, and Wayback/GE
  // listings are real network calls.
  const [rangeCounts, setRangeCounts] = useState<{ counts: Partial<Record<ExportSourceId, number>>; pending: boolean }>({ counts: {}, pending: false })
  useEffect(() => {
    if (!open || !getMapView) return
    const view = getMapView()
    if (!view) return
    const startMs = new Date(`${startDate}T00:00:00Z`).getTime()
    const endMs = new Date(`${endDate}T23:59:59Z`).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return
    let cancelled = false
    setRangeCounts((prev) => ({ ...prev, pending: true }))
    const timer = setTimeout(async () => {
      const ids = Array.from(sourceIds)
      const results = await Promise.all(ids.map(async (id) => {
        try { return [id, (await listExportTicks(id, view.lat, view.lng, view.zoom, startMs, endMs, planetKey, keys)).length] as const }
        catch { return [id, undefined] as const }
      }))
      if (cancelled) return
      const counts: Partial<Record<ExportSourceId, number>> = {}
      for (const [id, n] of results) if (n !== undefined) counts[id] = n
      setRangeCounts({ counts, pending: false })
    }, 500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, getMapView, startDate, endDate, sourceIds, planetKey, keys])

  // Mirror the chosen range onto the historical timeline so its ticks show
  // exactly what is about to be exported. Debounced with the count above.
  useEffect(() => {
    if (!open) return
    const startMs = new Date(`${startDate}T00:00:00Z`).getTime()
    const endMs = new Date(`${endDate}T23:59:59Z`).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return
    const timer = setTimeout(() => requestTimelineWindow({ min: startMs, max: endMs, nonce: Date.now() }), 500)
    return () => clearTimeout(timer)
  }, [open, startDate, endDate, requestTimelineWindow])
  const totalInRange = Array.from(sourceIds).reduce((n, id) => n + (rangeCounts.counts[id] ?? 0), 0)
  const targetCount = mode === "viewport" ? 1 : selectedFeatures.length

  const handleRun = useCallback(async () => {
    if (isRunning || !hasTargets || !sourceIds.size) return
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
        startMs: new Date(`${startDate}T00:00:00Z`).getTime(),
        endMs: new Date(`${endDate}T23:59:59Z`).getTime(),
        pointPaddingMeters,
        percentPadding,
        targetResolution,
        includeGdalScript,
        planetKey,
        keys,
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
      setResult({ fileCount: outcome.fileCount, skipped: outcome.skipped })
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
  }, [isRunning, hasTargets, mode, selectedFeatures, sourceIds, layers, startDate, endDate, pointPaddingMeters, percentPadding, targetResolution, includeGdalScript, planetKey, getMapBounds])

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
              <DatePickerButton value={startDate} max={endDate} onChange={setStartDate} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">End date</Label>
              <DatePickerButton value={endDate} min={startDate} onChange={setEndDate} />
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
              ids={CURRENT_BASEMAP_SOURCE_IDS.filter((id) => (id !== "mapbox" || !!mapboxKey) && (id !== "here" || !!hereKey))}
              labelOf={(id) => EXPORT_SOURCE_LABELS[id].replace(" (current)", "")}
              selected={sourceIds}
              setSelected={setSourceIds}
              hint="One file each, today's mosaic, regardless of the date range."
            />
            {getMapView && sourceIds.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {rangeCounts.pending ? "Counting captures in range… " : ""}
                <span className="text-foreground/80">{totalInRange} capture{totalInRange === 1 ? "" : "s"}</span> in range at the viewport centre
                {targetCount > 1 && <> → about {totalInRange * targetCount} files across {targetCount} features</>}
                {": "}
                {Array.from(sourceIds).map((id) => `${SOURCE_CONFIG[id]?.shortLabel ?? EXPORT_SOURCE_LABELS[id]} ${rangeCounts.counts[id] ?? "…"}`).join(" · ")}
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

          <div className="flex items-center gap-3">
            <Label className="text-sm font-medium shrink-0 w-36">Target resolution (px)</Label>
            <Input type="number" min={64} value={targetResolution} onChange={(e) => setTargetResolution(Number(e.target.value) || 512)} className="cursor-text w-32" />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="export-multi-gdal" checked={includeGdalScript} onCheckedChange={(v) => setIncludeGdalScript(!!v)} className="cursor-pointer" />
            <Label htmlFor="export-multi-gdal" className="text-sm cursor-pointer">Include gdal_translate script</Label>
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
              disabled={isRunning || !hasTargets || !sourceIds.size}
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
