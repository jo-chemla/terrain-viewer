// Georeference Image: a plain PNG or JPEG (a figure, a scan, a drawn plan)
// placed on the map from control points. The user clicks a spot on the image
// here in the panel, then the same spot on the map; from two or more pairs
// lib/georef.ts fits a transform (@allmaps/transform) and GeorefImageLayer
// (MapLayers.tsx) draws the image through MapLibre's image source. Points
// and the fit type live in the URL (georefGcps, georefType); the image is
// in georefImageAtom, and in the URL too (georefImage) when it came from a
// URL rather than from disk.
import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { GEOREF_TYPES, fitGeoref, fitBounds, gcpsFromParam, gcpsToParam, minPointsFor, worldFile, completeGcps, type GeorefGcp, type GeorefType } from "@/lib/georef"

const completeCount = (g: GeorefGcp[]) => completeGcps(g).length
import { track } from "@/lib/analytics"

const MARKER_COLOR = "#f59e0b"
const WKT_4326 = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error("The image could not be loaded (not an image, or the server does not allow cross-origin reads)."))
    img.src = url
  })
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
  const [loadError, setLoadError] = useState<string | null>(null)
  // The pair being placed: its image pixel is known, its map point is not.
  const [pending, setPending] = useState<{ px: number; py: number } | null>(null)
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
  const gcps = useMemo(() => gcpsFromParam(state.georefGcps), [state.georefGcps])
  const fit = useMemo(() => (image ? fitGeoref(gcps, type, image.width, image.height) : null), [gcps, type, image])
  const needed = minPointsFor(type)

  useEffect(() => { if (drawModeActive) setIsActive(false) }, [drawModeActive, setIsActive])

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

  const setGcps = useCallback((next: GeorefGcp[]) => {
    setState({ georefGcps: gcpsToParam(next) })
  }, [setState])

  const loadFromUrl = useCallback(async (url: string, fromDisk: boolean, name: string) => {
    setLoadError(null)
    try {
      const { width, height } = await loadImageSize(url)
      const next: GeorefImage = { url, width, height, name, fromDisk }
      setImage(next)
      setState({ georefImage: fromDisk ? "" : url, georefGcps: "", showGeoref: true })
      setPending(null)
      setIsActive(true)
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
    setPending(null)
    setIsActive(false)
    setEditingId(null)
    fileRef.current = null
    setState({ georefImage: "", georefGcps: "" })
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null }
  }, [setImage, setIsActive, setState, setEditingId])

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
      georef: { gcps: gcpsToParam(gcps), type: fit.type, width: image.width, height: image.height },
      description: `Georeferenced picture, ${completeCount(gcps)} control points, ${fit.type} fit, RMSE ${fit.rmseM.toFixed(1)} m (Tools > Georeference Image).`,
    } as CustomBasemapSource
    setCustomBasemapSources((prev) => existing ? prev.map((s) => (s.id === existing.id ? entry : s)) : [...prev, entry])
    const ids: string[] = state.overlayBasemapIds || []
    setState({ overlayBasemapIds: ids.includes(entry.id) ? ids : [...ids, entry.id], showRasterBasemap: true, georefImage: "", georefGcps: "" })
    track("georef-save-overlay", { type: fit.type, points: completeCount(gcps), local: type === "image-local" })
    pushToast({ key: "georef", title: existing ? "Overlay updated" : "Saved as a basemap overlay", body: "Basemap > Bring Your Own Data > Overlays. Edit its points again from there.", duration: 6000 })
    setImage(null); setPending(null); setIsActive(false); setEditingId(null); fileRef.current = null
  }, [image, fit, editingId, customBasemapSources, gcps, registerLocalFile, setCustomBasemapSources, setState, state.overlayBasemapIds, setImage, setIsActive, setEditingId])

  // Map clicks complete the pending pair. Registered while the tool is on,
  // on view A, the way the Elevation Picker does it.
  const pendingRef = useRef(pending); pendingRef.current = pending
  const gcpsRef = useRef(gcps); gcpsRef.current = gcps
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !isActive) return
    const onClick = (e: MapMouseEvent) => {
      const p = pendingRef.current
      if (!p) return
      const id = (gcpsRef.current.reduce((m, g) => Math.max(m, g.id), 0)) + 1
      setGcps([...gcpsRef.current, { id, px: p.px, py: p.py, lng: e.lngLat.lng, lat: e.lngLat.lat }])
      setPending(null)
    }
    map.on("click", onClick)
    const container = map.getContainer()
    container.classList.add("elevation-picker-active")
    return () => { map.off("click", onClick); container.classList.remove("elevation-picker-active") }
  }, [isActive, mapRef, setGcps])

  // Numbered markers on the map for every complete pair.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    if (!map || !isOpen) return
    for (const g of gcps) {
      if (g.lng == null || g.lat == null) continue
      const el = document.createElement("div")
      el.textContent = String(g.id)
      el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${MARKER_COLOR};color:#111;font:700 11px/18px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4)`
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map))
    }
    return () => { markersRef.current.forEach((m) => m.remove()); markersRef.current = [] }
  }, [gcps, mapRef, isOpen])

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

  return (
    <Section title="Georeference Image" isOpen={isOpen} onOpenChange={onOpenChange}>
      {!image ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Place a plain image (a figure, a scan, a plan) on the map: click a spot on the image, then the same spot on the map, two or more times.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => fileInputRef.current?.click()}>Open image…</Button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }} />
          </div>
          <div className="flex gap-2">
            <Input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://…/figure.png" className="h-8 text-xs" />
            <Button variant="outline" size="sm" className="cursor-pointer" disabled={!urlInput.trim()} onClick={() => void loadFromUrl(urlInput.trim(), false, urlInput.trim().split("/").pop() ?? "image")}>Load</Button>
          </div>
          {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground" title={image.name}>{image.name} · {image.width}×{image.height}</span>
            <Button variant="ghost" size="sm" className="h-7 cursor-pointer text-xs" onClick={clearAll}>Remove</Button>
          </div>

          <div className="flex items-center gap-2">
            <Switch id="georef-toggle" checked={isActive} onCheckedChange={setIsActive} disabled={drawModeActive} className="cursor-pointer" />
            <Label htmlFor="georef-toggle" className="text-sm font-medium">Place control points</Label>
          </div>
          {drawModeActive && <p className="text-xs text-muted-foreground">Unavailable while a drawing tool is active.</p>}

          <GeorefImagePane
            image={image}
            gcps={gcps}
            pending={pending}
            active={isActive}
            onPick={(px, py) => { if (isActive) setPending({ px, py }) }}
          />
          {isActive && (
            <p className="text-xs text-muted-foreground">
              {pending ? `Point ${gcps.length + 1}: now click the same spot on the map.` : `Point ${gcps.length + 1}: click a spot on the image (wheel to zoom, drag to pan).`}
            </p>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Transform</Label>
            <Select value={type} onValueChange={(v) => v && setState({ georefType: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GEOREF_TYPES.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{GEOREF_TYPES.find((t) => t.value === type)?.hint}</p>
          </div>

          {gcps.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Control points ({gcps.length}{gcps.length < needed ? `, ${needed} needed` : ""})</Label>
              <ul className="space-y-0.5 text-xs">
                {gcps.map((g, i) => (
                  <li key={g.id} className="flex items-center gap-2">
                    <span className="inline-block h-4 w-4 rounded-full text-center text-[10px] font-bold leading-4 text-black" style={{ background: MARKER_COLOR }}>{g.id}</span>
                    <span className="text-muted-foreground">{Math.round(g.px)},{Math.round(g.py)} → {g.lat?.toFixed(5)}, {g.lng?.toFixed(5)}</span>
                    <span className="ml-auto tabular-nums">{fit ? `${fit.residualsM[i] >= 1000 ? (fit.residualsM[i] / 1000).toFixed(1) + " km" : fit.residualsM[i].toFixed(1) + " m"}` : ""}</span>
                    <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" title="Remove this pair" onClick={() => setGcps(gcps.filter((x) => x.id !== g.id))}>×</button>
                  </li>
                ))}
              </ul>
              {fit && <p className="text-xs text-muted-foreground">RMSE {fit.rmseM >= 1000 ? `${(fit.rmseM / 1000).toFixed(2)} km` : `${fit.rmseM.toFixed(1)} m`}{gcps.length === needed ? " (exact fit: add a point to see real residuals)" : ""}</p>}
              {!fit && gcps.length >= needed && <p className="text-xs text-destructive">No solution: the points may be on one line, or too close together.</p>}
            </div>
          )}

          {fit && (
            <>
              <div className="flex items-center gap-2">
                <Switch id="georef-visible" checked={state.showGeoref} onCheckedChange={(v) => setState({ showGeoref: v })} className="cursor-pointer" />
                <Label htmlFor="georef-visible" className="text-xs">Show on map</Label>
                <div className="ml-auto flex items-center gap-2">
                  <Label className="text-xs">Opacity</Label>
                  <MobileSlider className="w-24" min={0} max={1} step={0.05} value={state.georefOpacity} onValueChange={(v: number | readonly number[]) => setState({ georefOpacity: Array.isArray(v) ? v[0] : v })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-7 cursor-pointer text-xs" onClick={zoomToImage}>Zoom to image</Button>
                <Button variant="outline" size="sm" className="h-7 cursor-pointer text-xs" onClick={downloadWorldFile} title="ESRI world file (lng/lat, WGS 84) plus .prj: drop next to the image for QGIS">World file</Button>
                <Button variant="outline" size="sm" className="h-7 cursor-pointer text-xs" onClick={() => setGcps([])}>Clear points</Button>
              </div>
              <Button size="sm" className="h-7 w-full cursor-pointer text-xs" onClick={saveAsOverlay}>{editingId ? "Update the overlay" : "Save as basemap overlay"}</Button>
              {image.fromDisk && <p className="text-[11px] text-muted-foreground">The image stays in this browser session; the points are in the URL. Load it from a URL to share the whole result.</p>}
            </>
          )}
        </div>
      )}
    </Section>
  )
}

// The image in the panel, with wheel zoom and drag pan, numbered marks on
// the placed points and a click that reports image pixels.
const GeorefImagePane: React.FC<{
  image: GeorefImage
  gcps: GeorefGcp[]
  pending: { px: number; py: number } | null
  active: boolean
  onPick: (px: number, py: number) => void
}> = ({ image, gcps, pending, active, onPick }) => {
  const paneRef = useRef<HTMLDivElement>(null)
  // View transform: image pixel -> pane CSS pixel is  x * scale + tx.
  const [view, setView] = useState({ scale: 0, tx: 0, ty: 0 })
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const PANE_H = 220

  // Fit the whole image on first show and whenever the image changes.
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const w = el.clientWidth
    const scale = Math.min(w / image.width, PANE_H / image.height)
    setView({ scale, tx: (w - image.width * scale) / 2, ty: (PANE_H - image.height * scale) / 2 })
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

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [view])
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.moved) setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }))
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.moved) return
    const el = paneRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left - view.tx) / view.scale
    const py = (e.clientY - r.top - view.ty) / view.scale
    if (px < 0 || py < 0 || px > image.width || py > image.height) return
    onPick(px, py)
  }, [view, image, onPick])

  const marks = [...gcps.map((g) => ({ id: g.id, px: g.px, py: g.py, pending: false })), ...(pending ? [{ id: gcps.length + 1, px: pending.px, py: pending.py, pending: true }] : [])]
  return (
    <div
      ref={paneRef}
      className={`relative w-full select-none overflow-hidden rounded border bg-muted/40 ${active ? "cursor-crosshair" : "cursor-grab"}`}
      style={{ height: PANE_H, touchAction: "none" }}
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
      {view.scale > 0 && marks.map((m) => (
        <div
          key={`${m.id}-${m.pending}`}
          className="pointer-events-none absolute flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-black shadow"
          style={{ left: m.px * view.scale + view.tx, top: m.py * view.scale + view.ty, background: MARKER_COLOR, opacity: m.pending ? 0.6 : 1 }}
        >{m.id}</div>
      ))}
    </div>
  )
}
