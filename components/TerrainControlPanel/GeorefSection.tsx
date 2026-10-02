// Image Georeferencer: a plain PNG or JPEG (a figure, a scan, a drawn plan)
// placed on the map from control points. Points are clicked on the image,
// in a floating window over the map, and on the map, in any order: the
// n-th image point pairs with the n-th map point. From two or more pairs
// lib/georef.ts fits a transform (@allmaps/transform) and GeorefImageLayer
// (MapLayers.tsx) draws the image through MapLibre's image source. Complete
// pairs and the fit type live in the URL (georefGcps, georefType); the image
// is in georefImageAtom, and in the URL too (georefImage) when it came from
// a URL rather than from disk. "Save as basemap overlay" keeps the result
// as a custom basemap of type image / image-local (settings-atoms.ts).
import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { GripHorizontal, X, ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { v4 as uuidv4 } from "uuid"
import * as maplibregl from "maplibre-gl"
import type { MapMouseEvent } from "maplibre-gl"
import type { MapRef } from "react-map-gl/maplibre"
import saveAs from "file-saver"
import { Section, MobileSlider } from "./controls-components"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { georefImageAtom, georefActiveAtom, georefEditingIdAtom, customBasemapSourcesAtom, type GeorefImage, type CustomBasemapSource } from "@/lib/settings-atoms"
import { registerLocalFileAtom, makeLocalFileUrl } from "@/lib/local-file-store"
import { pushToast } from "@/components/ui/toast"
import { activeDrawModeAtom } from "./TerraDrawSystem"
import { GEOREF_TYPES, fitGeoref, fitBounds, gcpsFromParam, gcpsToParam, minPointsFor, worldFile, type GeorefGcp, type GeorefType } from "@/lib/georef"
import { track } from "@/lib/analytics"

const MARKER_COLOR = "#f59e0b"
const WKT_4326 = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'

type ImagePt = { px: number; py: number }
type MapPt = { lng: number; lat: number }

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error("The image could not be loaded (not an image, or the server does not allow cross-origin reads)."))
    img.src = url
  })
}

/** The n-th image point with the n-th map point, for as many as both have. */
function pairUp(imagePts: ImagePt[], mapPts: MapPt[]): GeorefGcp[] {
  const n = Math.min(imagePts.length, mapPts.length)
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, px: imagePts[i].px, py: imagePts[i].py, lng: mapPts[i].lng, lat: mapPts[i].lat }))
}

function fmtM(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m.toFixed(1)} m`
}

export const GeorefSection: React.FC<{
  state: any
  setState: (updates: any) => void
  mapRef: React.RefObject<MapRef>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, mapRef, isOpen, onOpenChange }) => {
  const [image, setImage] = useAtom(georefImageAtom)
  const [isActive, setIsActive] = useAtom(georefActiveAtom)
  const activeDrawMode = useAtomValue(activeDrawModeAtom)
  const drawModeActive = activeDrawMode !== "select"
  const [urlInput, setUrlInput] = useState("")
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The two point lists, paired by index. Only complete pairs go to the URL.
  const [imagePts, setImagePts] = useState<ImagePt[]>([])
  const [mapPts, setMapPts] = useState<MapPt[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  // The image is worked on in a floating window over the map (the sidebar
  // is far too narrow to pick points in); opened with the image.
  const [windowOpen, setWindowOpen] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const objectUrlRef = useRef<string | null>(null)
  // The picked File, kept for "Save as overlay" (it goes into the local file
  // store then, like a local COG). Null for a URL image or a reopened one.
  const fileRef = useRef<File | null>(null)
  const [editingId, setEditingId] = useAtom(georefEditingIdAtom)
  const [customBasemapSources, setCustomBasemapSources] = useAtom(customBasemapSourcesAtom)
  const registerLocalFile = useSetAtom(registerLocalFileAtom)

  const type = state.georefType as GeorefType
  const gcps = useMemo(() => pairUp(imagePts, mapPts), [imagePts, mapPts])
  const fit = useMemo(() => (image ? fitGeoref(gcps, type, image.width, image.height) : null), [gcps, type, image])
  const needed = minPointsFor(type)

  useEffect(() => { if (drawModeActive) setIsActive(false) }, [drawModeActive, setIsActive])

  // URL <-> lists. The lists are the source of truth while editing; complete
  // pairs are written to georefGcps. A param that differs from what was
  // last written came from outside (a shared link, an overlay reopened from
  // the Basemap section) and replaces the lists.
  const lastParamRef = useRef<string | null>(null)
  useEffect(() => {
    const param: string = state.georefGcps || ""
    if (param === lastParamRef.current) return
    lastParamRef.current = param
    const parsed = gcpsFromParam(param)
    setImagePts(parsed.map((g) => ({ px: g.px, py: g.py })))
    setMapPts(parsed.map((g) => ({ lng: g.lng as number, lat: g.lat as number })))
    setSelected(null)
  }, [state.georefGcps])
  useEffect(() => {
    const param = gcpsToParam(gcps)
    if (param === lastParamRef.current) return
    lastParamRef.current = param
    setState({ georefGcps: param })
  }, [gcps, setState])

  // A URL-loaded image shared by link arrives with georefImage set and the
  // atom empty: measure it so the layer can place it.
  useEffect(() => {
    if (image || !state.georefImage) return
    let cancelled = false
    loadImageSize(state.georefImage)
      .then(({ width, height }) => { if (!cancelled) setImage({ url: state.georefImage, width, height, name: state.georefImage.split("/").pop() ?? "image", fromDisk: false }) })
      .catch((e) => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [state.georefImage, image, setImage])

  const loadFromUrl = useCallback(async (url: string, fromDisk: boolean, name: string) => {
    setLoadError(null)
    try {
      const { width, height } = await loadImageSize(url)
      const next: GeorefImage = { url, width, height, name, fromDisk }
      setImage(next)
      setImagePts([]); setMapPts([]); setSelected(null)
      setState({ georefImage: fromDisk ? "" : url, georefGcps: "", showGeoref: true })
      setIsActive(true)
      setWindowOpen(true)
      track("georef-load", { fromDisk, width, height })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [setImage, setState, setIsActive])

  const onFile = useCallback((file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    fileRef.current = file
    setEditingId(null)
    void loadFromUrl(url, true, file.name)
  }, [loadFromUrl, setEditingId])

  const clearAll = useCallback(() => {
    setImage(null)
    setImagePts([]); setMapPts([]); setSelected(null)
    setIsActive(false)
    setEditingId(null)
    fileRef.current = null
    setState({ georefImage: "", georefGcps: "" })
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null }
  }, [setImage, setIsActive, setState, setEditingId])

  const removePair = useCallback((i: number) => {
    setImagePts((p) => p.filter((_, k) => k !== i))
    setMapPts((p) => p.filter((_, k) => k !== i))
    setSelected(null)
  }, [])
  // Delete / Backspace removes the selected pair on both sides.
  useEffect(() => {
    if (selected == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      e.preventDefault()
      removePair(selected)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [selected, removePair])

  // Keeps the result as a basemap overlay (Basemap > Bring Your Own Data,
  // overlay list), the way a local COG or a WMS is kept: in the custom
  // basemap list in local storage, the picture itself in the local file
  // store when it came from disk. Editing an existing overlay updates it.
  const saveAsOverlay = useCallback(() => {
    if (!image || !fit) return
    const existing = editingId ? customBasemapSources.find((s) => s.id === editingId) : undefined
    let url = image.url
    let type: CustomBasemapSource["type"] = "image"
    if (image.fromDisk) {
      if (fileRef.current) {
        const id = existing?.type === "image-local" ? existing.url.replace(/^local:\/\//, "") : uuidv4()
        registerLocalFile({ id, file: fileRef.current })
        url = makeLocalFileUrl(id)
      } else if (existing?.type === "image-local") {
        url = existing.url
      } else {
        pushToast({ key: "georef", title: "The picture is no longer available", body: "Open it again." })
        return
      }
      type = "image-local"
    }
    const entry: CustomBasemapSource = {
      ...(existing ?? { id: `georef-${Date.now()}`, name: image.name.replace(/\.[^.]+$/, "") || "Georeferenced image" }),
      url, type,
      role: "overlay",
      coordinates: fit.corners,
      bounds: fitBounds(fit),
      georef: { gcps: gcpsToParam(gcps), type: fit.type, width: image.width, height: image.height },
      description: `Georeferenced picture, ${gcps.length} control points, ${fit.type} fit, RMSE ${fmtM(fit.rmseM)} (Tools > Image Georeferencer).`,
    } as CustomBasemapSource
    setCustomBasemapSources((prev) => existing ? prev.map((s) => (s.id === existing.id ? entry : s)) : [...prev, entry])
    const ids: string[] = state.overlayBasemapIds || []
    setState({ overlayBasemapIds: ids.includes(entry.id) ? ids : [...ids, entry.id], showRasterBasemap: true, georefImage: "", georefGcps: "" })
    track("georef-save-overlay", { type: fit.type, points: gcps.length, local: type === "image-local" })
    pushToast({ key: "georef", title: existing ? "Overlay updated" : "Saved as a basemap overlay", body: "Basemap > Bring Your Own Data > Overlays. Edit its points again from there.", duration: 6000 })
    setImage(null); setImagePts([]); setMapPts([]); setSelected(null); setIsActive(false); setEditingId(null); fileRef.current = null
  }, [image, fit, editingId, customBasemapSources, gcps, registerLocalFile, setCustomBasemapSources, setState, state.overlayBasemapIds, setImage, setIsActive, setEditingId])

  // Map clicks add a map point. Registered while the tool is on, on view A,
  // the way the Elevation Picker does it.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !isActive) return
    const onClick = (e: MapMouseEvent) => {
      setMapPts((p) => [...p, { lng: e.lngLat.lng, lat: e.lngLat.lat }])
    }
    map.on("click", onClick)
    const container = map.getContainer()
    container.classList.add("elevation-picker-active")
    return () => { map.off("click", onClick); container.classList.remove("elevation-picker-active") }
  }, [isActive, mapRef])

  // Numbered, draggable markers on the map, one per map point; the one
  // selected in the list is bigger, a point without its image twin is
  // hollow.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    if (!map || !isOpen) return
    mapPts.forEach((p, i) => {
      const el = document.createElement("div")
      const size = selected === i ? 28 : 18
      const complete = i < imagePts.length
      el.textContent = String(i + 1)
      el.style.cssText = `display:flex;align-items:center;justify-content:center;line-height:1;width:${size}px;height:${size}px;border-radius:50%;background:${complete ? MARKER_COLOR : "rgba(245,158,11,.35)"};color:#111;font:700 ${selected === i ? 14 : 11}px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);cursor:crosshair`
      el.title = `Point ${i + 1}: drag to move, click to select`
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lng, p.lat]).addTo(map)
      // Hidden while dragged, so the crosshair lands on the spot itself.
      marker.on("dragstart", () => { el.style.opacity = "0" })
      marker.on("drag", () => { el.style.opacity = "0" })
      marker.on("dragend", () => {
        el.style.opacity = "1"
        const ll = marker.getLngLat()
        setMapPts((prev) => prev.map((q, k) => (k === i ? { lng: ll.lng, lat: ll.lat } : q)))
      })
      el.addEventListener("click", (ev) => { ev.stopPropagation(); setSelected(i) })
      markersRef.current.push(marker)
    })
    return () => { markersRef.current.forEach((m) => m.remove()); markersRef.current = [] }
  }, [mapPts, imagePts.length, selected, mapRef, isOpen])

  const zoomToImage = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map || !fit) return
    const [w, s, e, n] = fitBounds(fit)
    map.fitBounds([[w, s], [e, n]], { padding: 40, duration: 800 })
  }, [fit, mapRef])

  const downloadWorldFile = useCallback(() => {
    if (!fit || !image) return
    const base = image.name.replace(/\.[^.]+$/, "") || "image"
    const ext = /\.png$/i.test(image.name) ? "pgw" : "jgw"
    saveAs(new Blob([worldFile(fit, image.width, image.height)], { type: "text/plain" }), `${base}.${ext}`)
    saveAs(new Blob([WKT_4326], { type: "text/plain" }), `${base}.prj`)
    track("georef-worldfile", { type })
  }, [fit, image, type])

  const rows = Math.max(imagePts.length, mapPts.length)
  const hint = !isActive ? null
    : imagePts.length === mapPts.length ? `Point ${rows + 1}: click it on the image or on the map, in any order.`
    : imagePts.length > mapPts.length ? `${imagePts.length - mapPts.length} image point${imagePts.length - mapPts.length > 1 ? "s" : ""} waiting: click the same spot${imagePts.length - mapPts.length > 1 ? "s" : ""} on the map (point ${mapPts.length + 1}).`
    : `${mapPts.length - imagePts.length} map point${mapPts.length - imagePts.length > 1 ? "s" : ""} waiting: click the same spot${mapPts.length - imagePts.length > 1 ? "s" : ""} on the image (point ${imagePts.length + 1}).`

  return (
    <Section title="Image Georeferencer" isOpen={isOpen} onOpenChange={onOpenChange}>
      {!image ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Place a plain image (a figure, a scan, a plan) on the map: click matching spots on the image and on the map, two or more pairs, in any order.
          </p>
          <div className="flex">
            <Button variant="outline" size="sm" className="cursor-pointer rounded-r-none" onClick={() => fileInputRef.current?.click()}>Open image…</Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="cursor-pointer rounded-l-none border-l-0 px-1.5" aria-label="More ways to open an image" />}>
                <ChevronDown className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem className="cursor-pointer" onClick={() => fileInputRef.current?.click()}>From disk…</DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => setUrlDialogOpen(true)}>From a URL…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }} />
          </div>
          <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Open an image from a URL</DialogTitle>
                <DialogDescription>A PNG, JPEG or WebP the server lets other sites read (CORS). The link to the result will carry this URL.</DialogDescription>
              </DialogHeader>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const u = urlInput.trim(); if (!u) return; setUrlDialogOpen(false); void loadFromUrl(u, false, u.split("/").pop() ?? "image") }}>
                <Input autoFocus value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://…/figure.png" className="h-8 text-xs" />
                <Button type="submit" size="sm" className="cursor-pointer" disabled={!urlInput.trim()}>Load</Button>
              </form>
            </DialogContent>
          </Dialog>
          {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground" title={image.name}>{image.name} · {image.width}×{image.height}</span>
            <Button variant="ghost" size="sm" className="cursor-pointer" onClick={clearAll}>Remove</Button>
          </div>

          <div className="flex items-center gap-2">
            <Switch id="georef-toggle" checked={isActive} onCheckedChange={setIsActive} disabled={drawModeActive} className="cursor-pointer" />
            <Label htmlFor="georef-toggle" className="text-sm font-medium">Place control points</Label>
          </div>
          {drawModeActive && <p className="text-xs text-muted-foreground">Unavailable while a drawing tool is active.</p>}

          <div className="flex items-center gap-2">
            <Switch id="georef-window" checked={windowOpen} onCheckedChange={setWindowOpen} className="cursor-pointer" />
            <Label htmlFor="georef-window" className="text-sm font-medium">Image window</Label>
          </div>
          {windowOpen && (
            <GeorefImageWindow title={image.name} aspect={image.width / image.height} onClose={() => setWindowOpen(false)}>
              <GeorefImagePane
                image={image}
                points={imagePts}
                mapCount={mapPts.length}
                selected={selected}
                active={isActive}
                onAdd={(px, py) => { if (isActive) setImagePts((p) => [...p, { px, py }]) }}
                onMove={(i, px, py) => setImagePts((p) => p.map((q, k) => (k === i ? { px, py } : q)))}
                onSelect={setSelected}
              />
            </GeorefImageWindow>
          )}
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="shrink-0 text-sm font-medium">Transform</Label>
              <Select value={type} onValueChange={(v) => v && setState({ georefType: v })}>
                <SelectTrigger className="h-8 flex-1 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GEOREF_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{GEOREF_TYPES.find((t) => t.value === type)?.hint}</p>
          </div>

          {rows > 0 && (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <Label className="text-sm font-medium">Control points ({gcps.length}{gcps.length < needed ? `, ${needed} needed` : ""})</Label>
                <button type="button" className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { setImagePts([]); setMapPts([]); setSelected(null) }}>clear all</button>
              </div>
              <ul className="space-y-0.5 text-sm">
                {Array.from({ length: rows }, (_, i) => {
                  const ip = imagePts[i], mp = mapPts[i]
                  const isSel = selected === i
                  return (
                    <li key={i} className={`flex cursor-pointer items-center gap-2 rounded px-1 ${isSel ? "bg-muted" : "hover:bg-muted/50"}`} onClick={() => setSelected(isSel ? null : i)} title="Click to highlight this point on the image and the map">
                      <span className={`w-5 shrink-0 text-right font-mono text-xs ${ip && mp ? "" : "text-muted-foreground"}`}>{i + 1}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{ip ? `${Math.round(ip.px)},${Math.round(ip.py)}` : "image?"} → {mp ? `${mp.lat.toFixed(5)}, ${mp.lng.toFixed(5)}` : "map?"}</span>
                      <span className="ml-auto font-mono text-xs tabular-nums">{fit && i < fit.residualsM.length ? fmtM(fit.residualsM[i]) : ""}</span>
                      <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" title="Remove this pair" onClick={(e) => { e.stopPropagation(); removePair(i) }}>×</button>
                    </li>
                  )
                })}
              </ul>
              {fit && <p className="text-xs text-muted-foreground">RMSE {fmtM(fit.rmseM)}{gcps.length === needed ? " (exact fit: add a point to see real residuals)" : ""}</p>}
              {!fit && gcps.length >= needed && <p className="text-xs text-destructive">No solution: the points may be on one line, or too close together.</p>}
            </div>
          )}

          {fit && (
            <>
              <div className="flex items-center gap-2">
                <Switch id="georef-visible" checked={state.showGeoref} onCheckedChange={(v) => setState({ showGeoref: v })} className="cursor-pointer" />
                <Label htmlFor="georef-visible" className="text-sm font-medium">Show on map</Label>
                <div className="ml-auto flex items-center gap-2">
                  <Label className="text-sm">Opacity</Label>
                  <MobileSlider className="w-24" min={0} max={1} step={0.05} value={state.georefOpacity} onValueChange={(v: number | readonly number[]) => setState({ georefOpacity: Array.isArray(v) ? v[0] : v })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="w-full cursor-pointer" onClick={zoomToImage}>Zoom to image</Button>
                <Button variant="outline" size="sm" className="w-full cursor-pointer" onClick={downloadWorldFile} title="ESRI world file (lng/lat, WGS 84) plus .prj: drop next to the image for QGIS">World file</Button>
              </div>
              <Button size="sm" className="w-full cursor-pointer" onClick={saveAsOverlay}>{editingId ? "Update the overlay" : "Save as basemap overlay"}</Button>
              {image.fromDisk && <p className="text-xs text-muted-foreground">The image stays in this browser session; the points are in the URL. Load it from a URL to share the whole result.</p>}
            </>
          )}
        </div>
      )}
    </Section>
  )
}

// The image, with wheel zoom and drag pan, numbered draggable marks on the
// placed points and a click that adds one.
const GeorefImagePane: React.FC<{
  image: GeorefImage
  points: ImagePt[]
  mapCount: number
  selected: number | null
  active: boolean
  onAdd: (px: number, py: number) => void
  onMove: (i: number, px: number, py: number) => void
  onSelect: (i: number | null) => void
}> = ({ image, points, mapCount, selected, active, onAdd, onMove, onSelect }) => {
  const paneRef = useRef<HTMLDivElement>(null)
  // View transform: image pixel -> pane CSS pixel is  x * scale + tx.
  const [view, setView] = useState({ scale: 0, tx: 0, ty: 0 })
  const viewRef = useRef(view); viewRef.current = view
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const markDragRef = useRef<{ i: number; moved: boolean } | null>(null)
  // The mark being dragged is hidden, so the crosshair lands on the spot.
  const [dragging, setDragging] = useState<number | null>(null)

  // Fit the whole image on first show, when the image changes, and when the
  // window is resized (the pane fills whatever holds it).
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      const scale = Math.min(w / image.width, h / image.height)
      setView({ scale, tx: (w - image.width * scale) / 2, ty: (h - image.height * scale) / 2 })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [image])

  // A native, non-passive wheel listener: React registers onWheel passively,
  // so preventDefault there is ignored and the wheel scrolls the sidebar
  // under the pane as well as zooming the image.
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015)
        const scale = Math.min(Math.max(v.scale * factor, 0.02), 40)
        // keep the pixel under the cursor fixed
        const ix = (mx - v.tx) / v.scale, iy = (my - v.ty) / v.scale
        return { scale, tx: mx - ix * scale, ty: my - iy * scale }
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const toImage = (clientX: number, clientY: number) => {
    const r = paneRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { px: (clientX - r.left - v.tx) / v.scale, py: (clientY - r.top - v.ty) / v.scale }
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [view])
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const md = markDragRef.current
    if (md) {
      if (!md.moved) setDragging(md.i)
      md.moved = true
      const { px, py } = toImage(e.clientX, e.clientY)
      onMove(md.i, Math.min(Math.max(px, 0), image.width), Math.min(Math.max(py, 0), image.height))
      return
    }
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.moved) setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }))
  }, [image, onMove])
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const md = markDragRef.current
    if (md) { markDragRef.current = null; setDragging(null); if (!md.moved) onSelect(selected === md.i ? null : md.i); return }
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.moved || !paneRef.current) return
    const { px, py } = toImage(e.clientX, e.clientY)
    if (px < 0 || py < 0 || px > image.width || py > image.height) return
    onAdd(px, py)
  }, [image, onAdd, onSelect, selected])

  return (
    <div
      ref={paneRef}
      className={`relative h-full w-full select-none overflow-hidden rounded border bg-muted/40 ${active ? "cursor-crosshair" : "cursor-grab"}`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {view.scale > 0 && (
        <img
          src={image.url}
          alt=""
          draggable={false}
          className="absolute left-0 top-0 max-w-none"
          style={{ width: image.width * view.scale, height: image.height * view.scale, transform: `translate(${view.tx}px, ${view.ty}px)`, imageRendering: view.scale > 2 ? "pixelated" : "auto" }}
        />
      )}
      {view.scale > 0 && points.map((m, i) => {
        const size = selected === i ? 28 : 18
        return (
          <div
            key={i}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border-2 border-white font-bold leading-none text-black shadow"
            style={{ left: m.px * view.scale + view.tx, top: m.py * view.scale + view.ty, width: size, height: size, fontSize: selected === i ? 14 : 11, background: i < mapCount ? MARKER_COLOR : "rgba(245,158,11,.35)", opacity: dragging === i ? 0 : 1 }}
            title={`Point ${i + 1}: drag to move, click to select`}
            onPointerDown={(e) => { e.stopPropagation(); markDragRef.current = { i, moved: false }; (paneRef.current as HTMLElement).setPointerCapture(e.pointerId) }}
          >{i + 1}</div>
        )
      })}
    </div>
  )
}

// A floating window over the map, dragged by its header and resized from
// any corner, so the image can be read at a useful size while the map stays
// clickable beside it. Opens at about 30% of the screen width in the image's
// own aspect. Not a dialog: nothing is modal. Portaled to the body so the
// sidebar's own scrolling and clipping do not apply.
const HEADER_H = 28
const GeorefImageWindow: React.FC<{ title: string; aspect: number; onClose: () => void; children: React.ReactNode }> = ({ title, aspect, onClose, children }) => {
  const [box, setBox] = useState(() => {
    const w = Math.max(360, Math.round(window.innerWidth * 0.3))
    const h = Math.min(Math.round(w / aspect) + HEADER_H, Math.round(window.innerHeight * 0.8))
    return { x: Math.max(16, Math.round(window.innerWidth * 0.5 - w / 2)), y: 72, w, h }
  })
  const dragRef = useRef<{ x: number; y: number; box: typeof box; corner: string | null } | null>(null)
  const start = (corner: string | null) => (e: React.PointerEvent) => {
    e.stopPropagation()
    dragRef.current = { x: e.clientX, y: e.clientY, box, corner }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.corner) { setBox({ ...d.box, x: Math.max(0, d.box.x + dx), y: Math.max(0, d.box.y + dy) }); return }
    let { x, y, w, h } = d.box
    if (d.corner.includes("e")) w = Math.max(320, d.box.w + dx)
    if (d.corner.includes("s")) h = Math.max(200, d.box.h + dy)
    if (d.corner.includes("w")) { w = Math.max(320, d.box.w - dx); x = d.box.x + d.box.w - w }
    if (d.corner.includes("n")) { h = Math.max(200, d.box.h - dy); y = d.box.y + d.box.h - h }
    setBox({ x, y, w, h })
  }
  const onPointerUp = () => { dragRef.current = null }
  const corner = (c: string, cls: string) => (
    <div className={`absolute z-10 h-3.5 w-3.5 ${cls}`} style={{ cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize" }} onPointerDown={start(c)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
  )
  return createPortal(
    <div
      className="fixed z-[60] flex flex-col overflow-hidden rounded-md border bg-background shadow-xl"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      {corner("nw", "left-0 top-0")}{corner("ne", "right-0 top-0")}{corner("sw", "bottom-0 left-0")}{corner("se", "bottom-0 right-0")}
      <div
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b bg-muted/60 px-2 text-xs"
        style={{ height: HEADER_H }}
        onPointerDown={start(null)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate font-medium">{title}</span>
        <span className="ml-auto hidden text-muted-foreground sm:inline">wheel: zoom · drag: pan · click: point · drag a point to move it</span>
        <button type="button" className="ml-1 cursor-pointer rounded p-0.5 hover:bg-muted" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} aria-label="Close the image window"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1 p-1">{children}</div>
    </div>,
    document.body,
  )
}
