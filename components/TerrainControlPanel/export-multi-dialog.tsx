import type React from "react"
import { useState, useCallback, useRef, useMemo } from "react"
import { useAtomValue } from "jotai"
import { Layers, Loader2, X } from "lucide-react"
import saveAs from "file-saver"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { planetKeyAtom } from "@/lib/settings-atoms"
import { drawingFeaturesAtom, drawingLayersAtom } from "./TerraDrawSystem"
import { SOURCE_CONFIG } from "./historical-timeline-panel"
import { EXPORT_SOURCE_IDS, type ExportSourceId } from "@/lib/historical-export-sources"
import { exportMultiHistorical, type ExportMultiSkip } from "@/lib/export-multi"
import { track } from "@/lib/analytics"

const DEFAULT_SOURCE_IDS: ExportSourceId[] = ["wayback", "ge-historical", "bing", "eox-s2"]
const ALL_LAYERS = "__all__"

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export const ExportMultiDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const features = useAtomValue(drawingFeaturesAtom)
  const layers = useAtomValue(drawingLayersAtom)
  const planetKey = useAtomValue(planetKeyAtom)
  const hasPlanetKey = !!planetKey

  const [layerId, setLayerId] = useState(ALL_LAYERS)
  const [sourceIds, setSourceIds] = useState<Set<ExportSourceId>>(new Set(DEFAULT_SOURCE_IDS))
  const [startDate, setStartDate] = useState(() => isoDate(new Date(Date.now() - 365 * 86_400_000)))
  const [endDate, setEndDate] = useState(() => isoDate(new Date()))
  const [pointPaddingMeters, setPointPaddingMeters] = useState(100)
  const [percentPadding, setPercentPadding] = useState(20)
  const [targetResolution, setTargetResolution] = useState(512)

  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<{ phase: "listing" | "exporting"; fraction: number; label: string } | null>(null)
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ fileCount: number; skipped: ExportMultiSkip[] } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const selectedFeatures = useMemo(
    () => layerId === ALL_LAYERS ? features : features.filter((f) => f.properties?.layerId === layerId),
    [features, layerId],
  )

  const toggleSource = useCallback((id: ExportSourceId) => {
    setSourceIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleRun = useCallback(async () => {
    if (isRunning || !selectedFeatures.length || !sourceIds.size) return
    const controller = new AbortController()
    abortControllerRef.current = controller
    setIsRunning(true)
    setError("")
    setResult(null)
    setProgress({ phase: "listing", fraction: 0, label: "Starting…" })
    track("actions-export", { kind: "export-multi", features: selectedFeatures.length, sources: sourceIds.size })
    try {
      const outcome = await exportMultiHistorical({
        features: selectedFeatures,
        layers,
        sourceIds: Array.from(sourceIds),
        startMs: new Date(`${startDate}T00:00:00Z`).getTime(),
        endMs: new Date(`${endDate}T23:59:59Z`).getTime(),
        pointPaddingMeters,
        percentPadding,
        targetResolution,
        planetKey,
        signal: controller.signal,
        onProgress: ({ phase, completed, total, label }) => setProgress({ phase, fraction: total ? completed / total : 0, label }),
      })
      if (controller.signal.aborted) return
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
  }, [isRunning, selectedFeatures, sourceIds, layers, startDate, endDate, pointPaddingMeters, percentPadding, targetResolution, planetKey])

  const handleCancel = useCallback(() => abortControllerRef.current?.abort(), [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" showCloseButton={false}>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">
          <X className="h-4 w-4" />
        </DialogClose>
        <DialogHeader>
          <DialogTitle>Export Multi (Historical)</DialogTitle>
          <DialogDescription>
            One GeoTIFF per drawn feature × historical source × capture date in range, cropped to each feature's own extent, bundled into a .zip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Start date</Label>
              <Input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} className="cursor-text" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">End date</Label>
              <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="cursor-text" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Historical sources</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {EXPORT_SOURCE_IDS.filter((id) => id !== "planet" || hasPlanetKey).map((id) => (
                <div key={id} className="flex items-center gap-2">
                  <Checkbox id={`export-multi-src-${id}`} checked={sourceIds.has(id)} onCheckedChange={() => toggleSource(id)} className="cursor-pointer" />
                  <Label htmlFor={`export-multi-src-${id}`} className="text-sm cursor-pointer truncate">{SOURCE_CONFIG[id]?.label ?? id}</Label>
                </div>
              ))}
            </div>
            {/* Bing has no browsable archive (a single current mosaic) — its
                one export ignores the date range above entirely. */}
            {sourceIds.has("bing") && (
              <p className="text-xs text-muted-foreground">Bing has no date archive — contributes exactly one (current) capture regardless of date range.</p>
            )}
          </div>

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

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Target resolution (px per tile)</Label>
            <Input type="number" min={64} value={targetResolution} onChange={(e) => setTargetResolution(Number(e.target.value) || 512)} className="cursor-text w-32" />
          </div>

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
              disabled={isRunning || !selectedFeatures.length || !sourceIds.size}
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
