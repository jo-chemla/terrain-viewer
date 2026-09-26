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
import { encodeFloat32GeoTiff, encodeRgbaGeoTiff, encodeImageWithWorldFile, type GeoBbox } from "@/lib/float-geotiff"
import { compileRamp, colorize } from "@/lib/color-ramp-eval"
import { renderLayers, renderExportBlocker, displayedTileZoom, exportOutputSize, MAX_EXPORT_EDGE } from "@/lib/map-render-export"
import { exportResolutionModeAtom, exportValueFormatAtom, exportImageFormatAtom, maxResolutionAtom } from "@/lib/settings-atoms"
import { downloadGeoJSON } from "@/lib/download-geojson"
import { track } from "@/lib/analytics"
import { SegmentedToggle } from "./controls-components"
import { derivedModeTemplate, type ClientDemUpstream, type DerivedModeParams } from "@/components/LayersAndSources/MapSources"

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
// "Snapshot" is the render of every layer at once.
//
// Two top-level branches: what is visible now, and what is not - the modes
// that are off and the rendered layers that are hidden - so either set can
// be toggled in one click.
type Kind = "vector" | "dem" | "values" | "render" | "composite"
type Item = { id: string; label: string; detail?: string; kind: Kind; sourceId?: string; layers?: string[]; vector?: "contours" | "tells" }
type Group = { key: string; title: string; hint?: string; items: Item[] }
type Branch = { key: "visible" | "hidden"; title: string; groups: Group[] }

// `scale`: the protocol stores value x scale in the tile (curvature and
// shape index, CURVATURE_ENCODE_SCALE in lib/curvature-protocol.ts, for
// precision); the export divides it back out.
const VALUE_MODES: { group: "Terrain Analysis" | "Relief Visualization"; sourceId: string; layerId: string; label: string; unit?: string; scale?: number }[] = [
  { group: "Terrain Analysis", sourceId: "slopeSource", layerId: "slope-relief", label: "Slope", unit: "degrees" },
  { group: "Terrain Analysis", sourceId: "aspectSource", layerId: "aspect-relief", label: "Aspect", unit: "degrees" },
  { group: "Terrain Analysis", sourceId: "curvatureSource", layerId: "curvature-relief", label: "Curvature", scale: 1000 },
  { group: "Terrain Analysis", sourceId: "tpiSource", layerId: "tpi-relief", label: "TPI", unit: "m" },
  { group: "Terrain Analysis", sourceId: "triSource", layerId: "tri-relief", label: "TRI", unit: "m" },
  { group: "Terrain Analysis", sourceId: "roughnessSource", layerId: "roughness-relief", label: "Roughness" },
  { group: "Terrain Analysis", sourceId: "shapeIndexSource", layerId: "shape-index-relief", label: "Shape Index", scale: 1000 },
  { group: "Terrain Analysis", sourceId: "blobnessSource", layerId: "blobness-relief", label: "Blobness" },
  { group: "Terrain Analysis", sourceId: "eigenRatioSource", layerId: "eigen-ratio-relief", label: "Eigen Ratio" },
  { group: "Terrain Analysis", sourceId: "orientationSource", layerId: "orientation-relief", label: "Orientation", unit: "degrees" },
  { group: "Relief Visualization", sourceId: "lrmSource", layerId: "lrm-relief", label: "LRM", unit: "m" },
  { group: "Relief Visualization", sourceId: "svfSource", layerId: "svf-relief", label: "SVF", unit: "%" },
  { group: "Relief Visualization", sourceId: "opennessSource", layerId: "openness-relief", label: "Openness" },
  { group: "Relief Visualization", sourceId: "localDominanceSource", layerId: "local-dominance-relief", label: "Local Dominance" },
]

const isShown = (map: maplibregl.Map, id: string) => !!map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none"

function buildTree(map: maplibregl.Map, contoursVisible: boolean, tellsVisible: boolean): Branch[] {
  const all = map.getStyle().layers.map((l) => l.id)
  const visible: Group[] = []
  const hidden: Group[] = []

  visible.push({ key: "dem", title: "Elevation", hint: "float32 GeoTIFF, EPSG:4326", items: [{ id: "dem", label: "DEM", detail: "metres", kind: "dem" }] })
  visible.push({ key: "composite", title: "Snapshot", hint: "RGBA GeoTIFF, EPSG:3857, screen resolution", items: [{ id: "composite", label: "Every visible layer, as seen", kind: "composite" }] })

  const vector: Item[] = []
  if (contoursVisible) vector.push({ id: "contours", label: "Contour lines", detail: "GeoJSON", kind: "vector", vector: "contours" })
  if (tellsVisible) vector.push({ id: "tells", label: "Mound candidates", detail: "GeoJSON", kind: "vector", vector: "tells" })
  if (vector.length) visible.push({ key: "vector", title: "Vector", items: vector })

  for (const title of ["Terrain Analysis", "Relief Visualization"] as const) {
    const modes = VALUE_MODES.filter((m) => m.group === title)
    const toItem = (m: (typeof VALUE_MODES)[number]): Item => ({ id: `values:${m.sourceId}`, label: m.label, detail: m.unit, kind: "values", sourceId: m.sourceId })
    const on = modes.filter((m) => isShown(map, m.layerId)).map(toItem)
    const off = modes.filter((m) => !isShown(map, m.layerId)).map(toItem)
    if (on.length) visible.push({ key: `v-${title}`, title, hint: "raw values, float32 GeoTIFF, EPSG:4326", items: on })
    if (off.length) hidden.push({ key: `h-${title}`, title, hint: "raw values, float32 GeoTIFF, EPSG:4326", items: off })
  }

  // Rendered layers: shown ones under Visible; hidden ones that still exist
  // in the style (their group is on, the layer is switched off) under Not
  // visible - they are shown for the moment of their capture.
  const shownRender: Item[] = []
  const hiddenRender: Item[] = []
  const add = (id: string, label: string, layers: string[]) => {
    const present = layers.filter((l) => !!map.getLayer(l))
    const shown = present.filter((l) => isShown(map, l))
    if (shown.length) shownRender.push({ id: `render:${id}`, label, kind: "render", layers: shown })
    else if (present.length) hiddenRender.push({ id: `render:${id}`, label, kind: "render", layers: present })
  }
  add("hillshade", "Hillshade", ["hillshade"])
  add("hypso", "Elevation Hypso", ["color-relief"])
  add("terrain-analysis", "Terrain Analysis, coloured", VALUE_MODES.filter((m) => m.group === "Terrain Analysis").map((m) => m.layerId))
  add("relief", "Relief Visualization, coloured", VALUE_MODES.filter((m) => m.group === "Relief Visualization").map((m) => m.layerId))
  add("lighting", "Lighting Effects", ["matcap-terrain", "phong-terrain", "shadow-terrain", "matcap-live", "phong-live"])
  add("basemap", "Raster Basemap", ["raster-basemap", ...all.filter((id) => id.startsWith("overlay-basemap-"))])
  if (shownRender.length) visible.push({ key: "v-render", title: "Rendered layers", hint: "RGBA GeoTIFF, EPSG:3857, screen resolution", items: shownRender })
  if (hiddenRender.length) hidden.push({ key: "h-render", title: "Rendered layers", hint: "RGBA GeoTIFF, EPSG:3857, screen resolution", items: hiddenRender })

  return [
    { key: "visible", title: "Visible", groups: visible },
    ...(hidden.length ? [{ key: "hidden" as const, title: "Not visible", groups: hidden }] : []),
  ]
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
  /** Terrain upstream and settings, to build the template of a mode whose
   *  group is off and whose source is therefore not on the map. */
  upstream: ClientDemUpstream | null
  derivedParams: DerivedModeParams
  /** Switches the view to 2D, north up, untilted. */
  onMakeFlat: () => void
}> = ({ open, onOpenChange, mapRef, getMapBounds, maxResolution, contoursVisible, tellsVisible, onExportContours, onExportDem, upstream, derivedParams, onMakeFlat }) => {
  const [branches, setBranches] = useState<Branch[]>([])
  const groups = branches.flatMap((b) => b.groups)
  const [canvasSize, setCanvasSize] = useState<string>("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [progress, setProgress] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [renderBlocker, setRenderBlocker] = useState<string | null>(null)
  const [resolutionMode, setResolutionMode] = useAtom(exportResolutionModeAtom)
  const [longestEdge, setLongestEdge] = useAtom(maxResolutionAtom)
  const [valueFormat, setValueFormat] = useAtom(exportValueFormatAtom)
  const [imageFormat, setImageFormat] = useAtom(exportImageFormatAtom)
  const [edgeDraft, setEdgeDraft] = useState(String(longestEdge))
  useEffect(() => setEdgeDraft(String(longestEdge)), [longestEdge])
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (open && map) setSize(exportOutputSize(map, resolutionMode, longestEdge))
  }, [open, mapRef, resolutionMode, longestEdge, canvasSize])
  const abortRef = useRef<AbortController | null>(null)

  // What is on screen when the dialog opens.
  useEffect(() => {
    if (!open) return
    const map = mapRef.current?.getMap()
    if (!map) return
    const tree = buildTree(map, contoursVisible, tellsVisible)
    setBranches(tree)
    setRenderBlocker(renderExportBlocker(map))
    const c = map.getCanvas()
    setCanvasSize(`${c.width} × ${c.height} px`)
    // Everything visible is ticked, the snapshot and DEM included; nothing
    // hidden is, and that branch starts folded.
    setSelected(new Set(tree.filter((b) => b.key === "visible").flatMap((b) => b.groups).flatMap((g) => g.items).map((i) => i.id)))
    setFolded(new Set(["branch:hidden"]))
    setStatus({})
    setProgress(null)
  }, [open, mapRef, contoursVisible, tellsVisible])

  const blocked = (i: Item) => (i.kind === "render" || i.kind === "composite") && !!renderBlocker
  const setMany = (ids: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    return next
  })

  // RGBA outputs in the chosen format: GeoTIFF, or PNG/JPEG with a world
  // file and a .prj beside it.
  const saveRgba = async (rgba: Uint8ClampedArray, width: number, height: number, bbox: GeoBbox, epsg: 3857 | 4326, base: string) => {
    if (imageFormat === "tiff") {
      saveAs(new Blob([encodeRgbaGeoTiff(rgba, width, height, bbox, epsg)], { type: "image/tiff" }), `${base}.tif`)
      return
    }
    const f = await encodeImageWithWorldFile(rgba, width, height, bbox, epsg, imageFormat)
    const ext = imageFormat === "png" ? "png" : "jpg"
    saveAs(f.image, `${base}.${ext}`)
    saveAs(new Blob([f.worldFile], { type: "text/plain" }), `${base}.${ext === "png" ? "pgw" : "jgw"}`)
    saveAs(new Blob([f.prj], { type: "text/plain" }), `${base}.prj`)
    // GDAL (and QGIS through it) takes a PNG/JPEG's CRS from this sidecar,
    // not from the .prj, which other tools read.
    saveAs(new Blob([`<PAMDataset><SRS>${f.prj.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</SRS></PAMDataset>`], { type: "text/xml" }), `${base}.${ext}.aux.xml`)
  }

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
          // The mode's source on the map when its group is on; otherwise its
          // template is built from the terrain upstream with the same builder.
          const spec = map.getStyle().sources[item.sourceId!] as { tiles?: string[]; encoding?: string; tileSize?: number; maxzoom?: number } | undefined
          const built = spec?.tiles?.[0] ? null : upstream ? derivedModeTemplate(item.sourceId!, upstream, derivedParams) : null
          const template = spec?.tiles?.[0] ?? built?.template
          if (!template) throw new Error("this terrain source has no client-side tile path")
          const encoding = spec?.tiles?.[0] ? spec.encoding : built!.encoding
          const tileSize = spec?.tileSize ?? built?.tileSize ?? 256
          const maxzoom = spec?.maxzoom ?? built?.maxzoom ?? 20
          // "screen": the zoom the map draws, so every tile is already in the
          // result cache (a hidden mode has none drawn: the zoom it would be
          // drawn at). Custom: the zoom that meets the longest edge.
          const zoom = resolutionMode === "screen"
            ? Math.min(maxzoom, displayedTileZoom(map, [item.sourceId!]) ?? Math.floor(map.getZoom() + Math.log2(512 / tileSize)))
            : undefined
          const outputSize = exportOutputSize(map, resolutionMode, longestEdge)
          const result = await exportElevationClientSide({
            source: { type: encoding === "terrarium" ? "terrarium" : "terrainrgb", url: template, tileSize, maxzoom },
            bbox: [b.west, b.south, b.east, b.north],
            targetResolution: Math.max(outputSize.width, outputSize.height),
            zoom,
            outputSize,
            onProgress: (p) => setProgress((n + p) / todo.length),
            signal: controller.signal,
          })
          const [west, south, east, north] = result.bbox
          const mode = VALUE_MODES.find((m) => m.sourceId === item.sourceId)!
          const base = `terrain-viewer_${slug(mode.group)}_${slug(item.label)}_${stamp}`
          if (valueFormat !== "raw") {
            // The ramp is the layer's own expression, in tile units: bounds,
            // symmetric and inverted settings included, as on screen.
            const ramp = compileRamp(map.getLayer(mode.layerId) ? map.getPaintProperty(mode.layerId, "color-relief-color") : undefined)
            if (!ramp) throw new Error("no colour ramp: switch this mode's section on")
            await saveRgba(colorize(result.data, ramp), result.width, result.height, { west, south, east, north }, 4326, `${base}_coloured`)
          }
          if (valueFormat !== "color") {
            const data = mode.scale ? result.data.map((v) => v / mode.scale!) : result.data
            saveAs(new Blob([encodeFloat32GeoTiff(data, result.width, result.height, { west, south, east, north })], { type: "image/tiff" }), `${base}.tif`)
          }
        } else {
          const r = await renderLayers(map, item.kind === "composite" ? null : new Set(item.layers))
          await saveRgba(r.rgba, r.width, r.height, r.bbox, 3857, `terrain-viewer_${item.kind === "composite" ? "snapshot" : "rendered_" + slug(item.label)}_${stamp}`)
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
  }, [mapRef, running, groups, selected, renderBlocker, resolutionMode, longestEdge, valueFormat, imageFormat, getMapBounds, onExportContours, onExportDem, upstream, derivedParams])

  const statusIcon = (id: string) => {
    const s = status[id]
    if (s === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    if (s === "done") return <Check className="h-3.5 w-3.5 text-green-600" />
    if (s && typeof s === "object") return <span className="text-xs text-red-500 truncate max-w-[160px]" title={s.error}>{s.error}</span>
    return null
  }
  const count = groups.flatMap((g) => g.items).filter((i) => selected.has(i.id) && !blocked(i)).length
  const toggleFold = (key: string) => setFolded((f) => { const n = new Set(f); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const headerId = (key: string) => `export-group-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`
  const treeHeader = (key: string, title: string, ids: string[], on: number, isFolded: boolean, hint?: string, top = false) => (
    <div className="flex items-center gap-1.5">
      <button type="button" aria-label={isFolded ? "Unfold" : "Fold"} className="cursor-pointer text-muted-foreground" onClick={() => toggleFold(key)}>
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isFolded ? "" : "rotate-90"}`} />
      </button>
      <Checkbox
        id={headerId(key)}
        checked={ids.length > 0 && on === ids.length}
        indeterminate={on > 0 && on < ids.length}
        disabled={running || ids.length === 0}
        onCheckedChange={() => setMany(ids, on < ids.length)}
        className="cursor-pointer"
      />
      <Label htmlFor={headerId(key)} className={`cursor-pointer ${top ? "text-xs font-bold uppercase tracking-wide" : "text-sm font-semibold"}`}>{title}</Label>
      {hint && <span className="text-[11px] text-muted-foreground truncate">{hint}</span>}
    </div>
  )

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
        {renderBlocker && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
            <p className="text-xs text-amber-700 dark:text-amber-400 flex-1">
              2D, north up is recommended for export: the snapshot and rendered layers need it ({renderBlocker.toLowerCase()}). Values and the DEM export either way.
            </p>
            <Button size="sm" variant="outline" className="cursor-pointer shrink-0 h-7" disabled={running} onClick={() => {
              onMakeFlat()
              const map = mapRef.current?.getMap()
              if (map) map.once("idle", () => { setRenderBlocker(renderExportBlocker(map)); setCanvasSize(`${map.getCanvas().width} × ${map.getCanvas().height} px`) })
            }}>
              Switch to 2D, north up
            </Button>
          </div>
        )}
        <div className="grid grid-cols-[80px_1fr] items-center gap-x-2 gap-y-2">
          <Label className="text-sm">Resolution</Label>
          <SegmentedToggle
            className="w-full"
            value={resolutionMode}
            onChange={(v) => setResolutionMode(v)}
            disabled={running}
            options={[
              { value: "screen", label: canvasSize ? `Screen, ${canvasSize}` : "Screen", tooltip: "The canvas's own pixels, at the zoom the map is drawing: every tile is already cached, so it takes seconds" },
              { value: "max", label: "Custom size", tooltip: "Set the longest edge; tiles are fetched at the zoom that meets it" },
            ]}
          />
          {resolutionMode === "max" && (
            <>
              <span />
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="number" min={16} max={MAX_EXPORT_EDGE} step={256}
                  value={edgeDraft}
                  disabled={running}
                  onChange={(e) => setEdgeDraft(e.target.value)}
                  onBlur={() => { const v = Number(edgeDraft); if (Number.isFinite(v) && v > 0) setLongestEdge(Math.min(MAX_EXPORT_EDGE, Math.max(16, Math.round(v)))); else setEdgeDraft(String(longestEdge)) }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                  className="h-7 w-24 rounded border bg-transparent px-2 text-right"
                  aria-label="Longest edge in pixels"
                />
                <span className="text-muted-foreground">
                  px longest edge{size ? `: ${size.width} × ${size.height} px` : ""}
                </span>
              </div>
              {size && size.width * size.height > 64e6 && (
                <>
                  <span />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    About {Math.round((size.width * size.height * 4 * 3) / 1e6)} MB of memory per layer while exporting; a browser tab may run out past a few GB.
                  </p>
                </>
              )}
            </>
          )}
          <Label className="text-sm">Values as</Label>
          <SegmentedToggle
            className="w-full"
            value={valueFormat}
            onChange={(v) => setValueFormat(v)}
            disabled={running}
            options={[
              { value: "raw", label: "Raw values", tooltip: "float32, one band: the mode's own numbers" },
              { value: "color", label: "Coloured", tooltip: "RGBA through the mode's ramp, with its bounds, symmetric and inverted settings" },
              { value: "both", label: "Both" },
            ]}
          />
          <Label className="text-sm">Images as</Label>
          <SegmentedToggle
            className="w-full"
            value={imageFormat}
            onChange={(v) => setImageFormat(v)}
            disabled={running}
            options={[
              { value: "tiff", label: "GeoTIFF", tooltip: "RGBA GeoTIFF with its CRS inside" },
              { value: "png", label: "PNG + pgw", tooltip: "PNG with a world file and a .prj; keeps transparency" },
              { value: "jpeg", label: "JPEG + jgw", tooltip: "JPEG with a world file and a .prj; transparent areas become white" },
            ]}
          />
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          The size applies to the DEM and the values. The snapshot and rendered layers are the screen's own pixels. Raw values and the DEM are always float32 GeoTIFF.
        </p>
        <div className="space-y-3">
          {branches.map((br) => {
            const branchIds = br.groups.flatMap((g) => g.items).filter((i) => !blocked(i)).map((i) => i.id)
            const branchOn = branchIds.filter((id) => selected.has(id)).length
            const branchFolded = folded.has(`branch:${br.key}`)
            return (
              <div key={br.key}>
                {treeHeader(`branch:${br.key}`, br.title, branchIds, branchOn, branchFolded, undefined, true)}
                {!branchFolded && (
                  <div className="ml-5 mt-1.5 space-y-2">
                    {br.groups.map((g) => {
                      const ids = g.items.filter((i) => !blocked(i)).map((i) => i.id)
                      const on = ids.filter((id) => selected.has(id)).length
                      const isFolded = folded.has(g.key)
                      return (
                        <div key={g.key}>
                          {treeHeader(g.key, g.title, ids, on, isFolded, g.hint)}
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
