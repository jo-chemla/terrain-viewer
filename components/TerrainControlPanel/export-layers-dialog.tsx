import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import type * as maplibregl from "maplibre-gl"
import { useAtom } from "jotai"
import saveAs from "file-saver"
import { Check, ChevronRight, Download, Loader2, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { exportElevationClientSide } from "@/lib/client-export"
import { encodeFloat32GeoTiff, encodeRgbaGeoTiff3857 } from "@/lib/float-geotiff"
import { renderLayers, renderExportBlocker, displayedTileZoom } from "@/lib/map-render-export"
import { exportResolutionModeAtom } from "@/lib/settings-atoms"
import { downloadGeoJSON } from "@/lib/download-geojson"
import { track } from "@/lib/analytics"
import { SegmentedToggle } from "./controls-components"

// Four kinds of export, one tree:
// - vector:    GeoJSON of what is on screen (contour lines, mound candidates);
// - dem:       the elevation, float32 (the main GeoTIFF button's export);
// - values:    a derived mode's own values, float32 single band. Every derived
//              mode is a raster-dem source whose tiles carry the value (slope
//              degrees, aspect and orientation degrees, LRM metres...), so this
//              is the elevation export pointed at that source's template;
// - render:    RGBA of what MapLibre draws for some layers: hillshade and hypso
//              (shaded on the GPU), lighting, the basemap, and the coloured
//              version of the modes. Only a flat north-up view is a raster, see
//              lib/map-render-export.ts.
// "Everything as seen" at the top is the render of every layer at once.
type Kind = "vector" | "dem" | "values" | "render" | "composite"
type Item = { id: string; label: string; detail?: string; kind: Kind; sourceId?: string; layers?: string[]; vector?: "contours" | "tells" }
type Group = { key: string; title: string; hint?: string; items: Item[] }

const VALUE_MODES: { group: "Terrain Analysis" | "Relief Visualization"; sourceId: string; layerId: string; label: string; unit?: string }[] = [
  { group: "Terrain Analysis", sourceId: "slopeSource", layerId: "slope-relief", label: "Slope", unit: "degrees" },
  { group: "Terrain Analysis", sourceId: "aspectSource", layerId: "aspect-relief", label: "Aspect", unit: "degrees" },
  { group: "Terrain Analysis", sourceId: "curvatureSource", layerId: "curvature-relief", label: "Curvature" },
  { group: "Terrain Analysis", sourceId: "tpiSource", layerId: "tpi-relief", label: "TPI", unit: "m" },
  { group: "Terrain Analysis", sourceId: "triSource", layerId: "tri-relief", label: "TRI", unit: "m" },
  { group: "Terrain Analysis", sourceId: "roughnessSource", layerId: "roughness-relief", label: "Roughness" },
  { group: "Terrain Analysis", sourceId: "shapeIndexSource", layerId: "shape-index-relief", label: "Shape Index" },
  { group: "Terrain Analysis", sourceId: "blobnessSource", layerId: "blobness-relief", label: "Blobness" },
  { group: "Terrain Analysis", sourceId: "eigenRatioSource", layerId: "eigen-ratio-relief", label: "Eigen Ratio" },
  { group: "Terrain Analysis", sourceId: "orientationSource", layerId: "orientation-relief", label: "Orientation", unit: "degrees" },
  { group: "Relief Visualization", sourceId: "lrmSource", layerId: "lrm-relief", label: "LRM", unit: "m" },
  { group: "Relief Visualization", sourceId: "svfSource", layerId: "svf-relief", label: "SVF", unit: "%" },
  { group: "Relief Visualization", sourceId: "opennessSource", layerId: "openness-relief", label: "Openness" },
  { group: "Relief Visualization", sourceId: "localDominanceSource", layerId: "local-dominance-relief", label: "Local Dominance" },
]

const isShown = (map: maplibregl.Map, id: string) => !!map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none"

function buildTree(map: maplibregl.Map, contoursVisible: boolean, tellsVisible: boolean): Group[] {
  const groups: Group[] = []
  const all = map.getStyle().layers.map((l) => l.id)
  groups.push({ key: "composite", title: "Everything as seen", hint: "RGBA GeoTIFF, EPSG:3857, screen resolution", items: [{ id: "composite", label: "Composite of all visible layers", kind: "composite" }] })

  const vector: Item[] = []
  if (contoursVisible) vector.push({ id: "contours", label: "Contour lines", detail: "GeoJSON", kind: "vector", vector: "contours" })
  if (tellsVisible) vector.push({ id: "tells", label: "Mound candidates", detail: "GeoJSON", kind: "vector", vector: "tells" })
  if (vector.length) groups.push({ key: "vector", title: "Vector", items: vector })

  groups.push({ key: "dem", title: "Elevation", hint: "float32 GeoTIFF, EPSG:4326", items: [{ id: "dem", label: "DEM", detail: "metres", kind: "dem" }] })

  for (const title of ["Terrain Analysis", "Relief Visualization"] as const) {
    const items = VALUE_MODES.filter((m) => m.group === title && isShown(map, m.layerId))
      .map<Item>((m) => ({ id: `values:${m.sourceId}`, label: m.label, detail: m.unit, kind: "values", sourceId: m.sourceId }))
    if (items.length) groups.push({ key: title, title, hint: "raw values, float32 GeoTIFF, EPSG:4326", items })
  }

  const render: Item[] = []
  const add = (id: string, label: string, layers: string[]) => {
    const shown = layers.filter((l) => isShown(map, l))
    if (shown.length) render.push({ id: `render:${id}`, label, kind: "render", layers: shown })
  }
  add("hillshade", "Hillshade", ["hillshade"])
  add("hypso", "Elevation Hypso", ["color-relief"])
  add("terrain-analysis", "Terrain Analysis, coloured", VALUE_MODES.filter((m) => m.group === "Terrain Analysis").map((m) => m.layerId))
  add("relief", "Relief Visualization, coloured", VALUE_MODES.filter((m) => m.group === "Relief Visualization").map((m) => m.layerId))
  add("lighting", "Lighting Effects", ["matcap-terrain", "phong-terrain", "shadow-terrain", "matcap-live", "phong-live"])
  add("basemap", "Raster Basemap", ["raster-basemap", ...all.filter((id) => id.startsWith("overlay-basemap-"))])
  if (render.length) groups.push({ key: "render", title: "Rendered layers", hint: "RGBA GeoTIFF, EPSG:3857, screen resolution", items: render })
  return groups
}

type Status = "running" | "done" | { error: string }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export const ExportLayersDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  mapRef: React.RefObject<MapRef>
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  maxResolution: number
  contoursVisible: boolean
  tellsVisible: boolean
  onExportContours: () => void
  onExportDem: (signal: AbortSignal) => Promise<void>
}> = ({ open, onOpenChange, mapRef, getMapBounds, maxResolution, contoursVisible, tellsVisible, onExportContours, onExportDem }) => {
  const [groups, setGroups] = useState<Group[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [progress, setProgress] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [renderBlocker, setRenderBlocker] = useState<string | null>(null)
  const [resolutionMode, setResolutionMode] = useAtom(exportResolutionModeAtom)
  const abortRef = useRef<AbortController | null>(null)

  // What is on screen when the dialog opens. Everything checked except the
  // DEM (it has its own button) and the composite.
  useEffect(() => {
    if (!open) return
    const map = mapRef.current?.getMap()
    if (!map) return
    const tree = buildTree(map, contoursVisible, tellsVisible)
    setGroups(tree)
    setRenderBlocker(renderExportBlocker(map))
    setSelected(new Set(tree.flatMap((g) => g.items).filter((i) => i.kind !== "dem" && i.kind !== "composite").map((i) => i.id)))
    setStatus({})
    setProgress(null)
  }, [open, mapRef, contoursVisible, tellsVisible])

  const blocked = (i: Item) => (i.kind === "render" || i.kind === "composite") && !!renderBlocker
  const setMany = (ids: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    return next
  })

  const runExport = useCallback(async () => {
    const map = mapRef.current?.getMap()
    if (!map || running) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    const todo = groups.flatMap((g) => g.items).filter((i) => selected.has(i.id) && !blocked(i))
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    track("actions-export", { kind: "layers", count: todo.length, resolution: resolutionMode })
    const b = getMapBounds()
    for (let n = 0; n < todo.length; n++) {
      if (controller.signal.aborted) break
      const item = todo[n]
      setStatus((s) => ({ ...s, [item.id]: "running" }))
      setProgress(n / todo.length)
      try {
        if (item.kind === "vector") {
          if (item.vector === "contours") onExportContours()
          else {
            const source = map.getSource("tellsSourceFrozen") && !map.getSource("tellsSource") ? "tellsSourceFrozen" : "tellsSource"
            const features = source === "tellsSource" ? map.querySourceFeatures(source, { sourceLayer: "tells" }) : map.querySourceFeatures(source)
            downloadGeoJSON(features as GeoJSON.Feature[], "mound-candidates")
          }
        } else if (item.kind === "dem") {
          await onExportDem(controller.signal)
        } else if (item.kind === "values") {
          const spec = map.getStyle().sources[item.sourceId!] as { tiles?: string[]; encoding?: string; tileSize?: number; maxzoom?: number } | undefined
          const template = spec?.tiles?.[0]
          if (!template) throw new Error("source not on the map any more")
          // "screen": the zoom the map draws, every tile already in the result
          // cache. "max": the Max Resolution setting picks a deeper zoom.
          const zoom = resolutionMode === "screen" ? displayedTileZoom(map, [item.sourceId!]) ?? undefined : undefined
          const result = await exportElevationClientSide({
            source: { type: spec?.encoding === "terrarium" ? "terrarium" : "terrainrgb", url: template, tileSize: spec?.tileSize ?? 256, maxzoom: spec?.maxzoom ?? 20 },
            bbox: [b.west, b.south, b.east, b.north],
            targetResolution: maxResolution,
            zoom,
            onProgress: (p) => setProgress((n + p) / todo.length),
            signal: controller.signal,
          })
          const [west, south, east, north] = result.bbox
          const group = VALUE_MODES.find((m) => m.sourceId === item.sourceId)!.group
          saveAs(new Blob([encodeFloat32GeoTiff(result.data, result.width, result.height, { west, south, east, north })], { type: "image/tiff" }),
            `terrain-viewer_${slug(group)}_${slug(item.label)}_${stamp}.tif`)
        } else {
          const r = await renderLayers(map, item.kind === "composite" ? null : new Set(item.layers))
          saveAs(new Blob([encodeRgbaGeoTiff3857(r.rgba, r.width, r.height, r.bbox)], { type: "image/tiff" }),
            `terrain-viewer_${item.kind === "composite" ? "composite" : "rendered_" + slug(item.label)}_${stamp}.tif`)
        }
        setStatus((s) => ({ ...s, [item.id]: "done" }))
      } catch (e) {
        if (controller.signal.aborted) break
        setStatus((s) => ({ ...s, [item.id]: { error: e instanceof Error ? e.message : String(e) } }))
      }
    }
    setProgress(null)
    setRunning(false)
    abortRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, running, groups, selected, renderBlocker, resolutionMode, getMapBounds, maxResolution, onExportContours, onExportDem])

  const statusIcon = (id: string) => {
    const s = status[id]
    if (s === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    if (s === "done") return <Check className="h-3.5 w-3.5 text-green-600" />
    if (s && typeof s === "object") return <span className="text-xs text-red-500 truncate max-w-[160px]" title={s.error}>{s.error}</span>
    return null
  }
  const count = groups.flatMap((g) => g.items).filter((i) => selected.has(i.id) && !blocked(i)).length

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) abortRef.current?.abort(); onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export layers</DialogTitle>
          <DialogDescription>
            What is on the map, over the current view, one file per line. Values keep the data (degrees, metres...);
            rendered layers are the pixels as drawn.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Label className="text-sm shrink-0">Resolution</Label>
          <SegmentedToggle
            className="flex-1"
            value={resolutionMode}
            onChange={(v) => setResolutionMode(v)}
            disabled={running}
            options={[
              { value: "screen", label: "Screen", tooltip: "The resolution the map is drawing: every tile is already cached, so it takes seconds" },
              { value: "max", label: `Up to ${maxResolution} px`, tooltip: "The Max Resolution setting (Export settings): a deeper zoom, fetched and computed afresh" },
            ]}
          />
        </div>
        <p className="text-xs text-muted-foreground -mt-1">Applies to the DEM and the values. Renders are always at screen resolution.</p>
        {renderBlocker && <p className="text-xs text-amber-600 dark:text-amber-500">Rendered layers and the composite: {renderBlocker.toLowerCase()}.</p>}
        <div className="space-y-2">
          {groups.map((g) => {
            const ids = g.items.filter((i) => !blocked(i)).map((i) => i.id)
            const on = ids.filter((id) => selected.has(id)).length
            const isFolded = folded.has(g.key)
            return (
              <div key={g.key}>
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label={isFolded ? "Unfold" : "Fold"} className="cursor-pointer text-muted-foreground" onClick={() => setFolded((f) => { const n = new Set(f); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>
                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isFolded ? "" : "rotate-90"}`} />
                  </button>
                  <Checkbox
                    id={`export-group-${g.key}`}
                    checked={ids.length > 0 && on === ids.length}
                    indeterminate={on > 0 && on < ids.length}
                    disabled={running || ids.length === 0}
                    onCheckedChange={() => setMany(ids, on < ids.length)}
                    className="cursor-pointer"
                  />
                  <Label htmlFor={`export-group-${g.key}`} className="text-sm font-semibold cursor-pointer">{g.title}</Label>
                  {g.hint && <span className="text-[11px] text-muted-foreground truncate">{g.hint}</span>}
                </div>
                {!isFolded && (
                  <div className="ml-[42px] mt-1 space-y-1">
                    {g.items.map((i) => (
                      <div key={i.id} className="flex items-center gap-2 min-w-0">
                        <Checkbox id={`export-${i.id}`} checked={selected.has(i.id) && !blocked(i)} disabled={running || blocked(i)} onCheckedChange={(c) => setMany([i.id], c === true)} className="cursor-pointer" />
                        <Label htmlFor={`export-${i.id}`} className={`text-sm cursor-pointer ${blocked(i) ? "opacity-50" : ""}`}>{i.label}</Label>
                        {i.detail && <span className="text-xs text-muted-foreground">{i.detail}</span>}
                        <span className="ml-auto flex items-center">{statusIcon(i.id)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
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
