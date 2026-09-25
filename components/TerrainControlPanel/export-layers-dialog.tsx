import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import type * as maplibregl from "maplibre-gl"
import saveAs from "file-saver"
import { Check, Download, Loader2, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { exportElevationClientSide } from "@/lib/client-export"
import { encodeFloat32GeoTiff } from "@/lib/float-geotiff"
import { track } from "@/lib/analytics"
import { GroupHeading } from "./controls-components"

// Every derived mode is a raster-dem source whose tiles carry the mode's own
// value (slope in degrees, LRM in metres...) Terrarium- or Terrain-RGB-encoded,
// so exporting one is the elevation export pointed at that source's template:
// the mosaic decodes the value back to a float per pixel. Matcap, Phong and
// hard shadows output colours, not values, and hillshade is drawn by MapLibre
// from the elevation itself - none of them have raw data to export.
type LayerDef = { sourceId: string; group: string; label: string; unit?: string }
const LAYER_DEFS: LayerDef[] = [
  { sourceId: "slopeSource", group: "Terrain Analysis", label: "Slope", unit: "degrees" },
  { sourceId: "aspectSource", group: "Terrain Analysis", label: "Aspect", unit: "degrees" },
  { sourceId: "curvatureSource", group: "Terrain Analysis", label: "Curvature" },
  { sourceId: "tpiSource", group: "Terrain Analysis", label: "TPI", unit: "m" },
  { sourceId: "triSource", group: "Terrain Analysis", label: "TRI", unit: "m" },
  { sourceId: "roughnessSource", group: "Terrain Analysis", label: "Roughness" },
  { sourceId: "shapeIndexSource", group: "Terrain Analysis", label: "Shape Index" },
  { sourceId: "blobnessSource", group: "Terrain Analysis", label: "Blobness" },
  { sourceId: "eigenRatioSource", group: "Terrain Analysis", label: "Eigen Ratio" },
  { sourceId: "orientationSource", group: "Terrain Analysis", label: "Orientation" },
  { sourceId: "lrmSource", group: "Relief Visualization", label: "LRM", unit: "m" },
  { sourceId: "svfSource", group: "Relief Visualization", label: "SVF", unit: "%" },
  { sourceId: "opennessSource", group: "Relief Visualization", label: "Openness" },
  { sourceId: "localDominanceSource", group: "Relief Visualization", label: "Local Dominance" },
]
const CONTOURS_ID = "contours"

type Status = "pending" | "running" | "done" | { error: string }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

/** The derived modes currently drawn on the map: a layer on the source exists
 *  and is not hidden. */
function visibleLayers(map: maplibregl.Map | undefined): LayerDef[] {
  if (!map) return []
  const layers = map.getStyle()?.layers ?? []
  return LAYER_DEFS.filter((d) =>
    layers.some((l) => (l as { source?: string }).source === d.sourceId && (l.layout as { visibility?: string } | undefined)?.visibility !== "none"))
}

export const ExportLayersDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  mapRef: React.RefObject<MapRef>
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  maxResolution: number
  contoursVisible: boolean
  onExportContours: () => void
}> = ({ open, onOpenChange, mapRef, getMapBounds, maxResolution, contoursVisible, onExportContours }) => {
  const [layers, setLayers] = useState<LayerDef[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [progress, setProgress] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // What is on screen when the dialog opens; everything checked by default.
  useEffect(() => {
    if (!open) return
    const found = visibleLayers(mapRef.current?.getMap())
    setLayers(found)
    setSelected(new Set([...found.map((l) => l.sourceId), ...(contoursVisible ? [CONTOURS_ID] : [])]))
    setStatus({})
    setProgress(null)
  }, [open, mapRef, contoursVisible])

  const toggle = (id: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })

  const runExport = useCallback(async () => {
    const map = mapRef.current?.getMap()
    if (!map || running) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    const todo = layers.filter((l) => selected.has(l.sourceId))
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    track("actions-export", { kind: "layers", count: todo.length + (selected.has(CONTOURS_ID) ? 1 : 0) })
    if (selected.has(CONTOURS_ID)) {
      onExportContours()
      setStatus((s) => ({ ...s, [CONTOURS_ID]: "done" }))
    }
    const b = getMapBounds()
    for (let i = 0; i < todo.length; i++) {
      if (controller.signal.aborted) break
      const def = todo[i]
      setStatus((s) => ({ ...s, [def.sourceId]: "running" }))
      try {
        const spec = map.getStyle().sources[def.sourceId] as { tiles?: string[]; encoding?: string; tileSize?: number; maxzoom?: number } | undefined
        const template = spec?.tiles?.[0]
        if (!template) throw new Error("source not on the map any more")
        // The zoom the map is drawing this source at: every tile of the view
        // is then already in the result cache (lib/tile-result-cache.ts) and
        // the export only decodes it. Without it the mosaic picks a zoom from
        // the resolution setting and recomputes a whole new pyramid level.
        const tm = (map as unknown as { style?: { tileManagers?: Record<string, { getVisibleCoordinates(): { canonical: { z: number } }[] }> } }).style?.tileManagers?.[def.sourceId]
        const shownZoom = tm?.getVisibleCoordinates()[0]?.canonical.z
        const result = await exportElevationClientSide({
          source: { type: spec?.encoding === "terrarium" ? "terrarium" : "terrainrgb", url: template, tileSize: spec?.tileSize ?? 256, maxzoom: spec?.maxzoom ?? 20 },
          bbox: [b.west, b.south, b.east, b.north],
          targetResolution: maxResolution,
          zoom: shownZoom,
          onProgress: (p) => setProgress((i + p) / todo.length),
          signal: controller.signal,
        })
        const [west, south, east, north] = result.bbox
        const buffer = encodeFloat32GeoTiff(result.data, result.width, result.height, { west, south, east, north })
        saveAs(new Blob([buffer], { type: "image/tiff" }), `terrain-viewer_${slug(def.group)}_${slug(def.label)}_${stamp}.tif`)
        setStatus((s) => ({ ...s, [def.sourceId]: "done" }))
      } catch (e) {
        if (controller.signal.aborted) break
        setStatus((s) => ({ ...s, [def.sourceId]: { error: e instanceof Error ? e.message : String(e) } }))
      }
    }
    setProgress(null)
    setRunning(false)
    abortRef.current = null
  }, [mapRef, running, layers, selected, getMapBounds, maxResolution, onExportContours])

  const groups = [...new Set(layers.map((l) => l.group))]
  const count = selected.size
  const statusIcon = (id: string) => {
    const s = status[id]
    if (s === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    if (s === "done") return <Check className="h-3.5 w-3.5 text-green-600" />
    if (s && typeof s === "object") return <span className="text-xs text-red-500 truncate max-w-[180px]" title={s.error}>{s.error}</span>
    return null
  }
  const row = (id: string, label: string, detail?: string) => (
    <div key={id} className="flex items-center gap-2 min-w-0">
      <Checkbox id={`export-layer-${id}`} checked={selected.has(id)} disabled={running} onCheckedChange={(c) => toggle(id, c === true)} className="cursor-pointer" />
      <Label htmlFor={`export-layer-${id}`} className="text-sm cursor-pointer">{label}</Label>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      <span className="ml-auto flex items-center">{statusIcon(id)}</span>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) abortRef.current?.abort(); onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export layers</DialogTitle>
          <DialogDescription>
            The modes visible on the map, over the current view, one file each. Values are the mode's own raw data (degrees,
            metres...), as float32 GeoTIFF in EPSG:4326 with NaN for nodata, at the resolution the map is showing.
          </DialogDescription>
        </DialogHeader>
        {layers.length === 0 && !contoursVisible ? (
          <p className="text-sm text-muted-foreground">
            No exportable mode is visible. Turn on a Terrain Analysis or Relief Visualization mode, or contours, first.
            Hillshade, Matcap, Phong and shadows are drawn as colours and have no raw values to export; the elevation itself is the DEM GeoTIFF button.
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g} className="space-y-1.5">
                <GroupHeading>{g}</GroupHeading>
                {layers.filter((l) => l.group === g).map((l) => row(l.sourceId, l.label, l.unit))}
              </div>
            ))}
            {contoursVisible && (
              <div className="space-y-1.5">
                <GroupHeading>Contours</GroupHeading>
                {row(CONTOURS_ID, "Contour lines", "GeoJSON")}
              </div>
            )}
          </div>
        )}
        {progress !== null && <Progress value={progress * 100} className="h-1" />}
        <div className="flex justify-end gap-2 pt-1">
          {running ? (
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => abortRef.current?.abort()}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => onOpenChange(false)}>Close</Button>
          )}
          <Button size="sm" className="cursor-pointer" disabled={running || count === 0} onClick={runExport}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            Export {count > 0 ? count : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
