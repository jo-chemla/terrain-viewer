import type React from "react"
import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react"
import { useAtom, useSetAtom } from "jotai"
import { v4 as uuidv4 } from "uuid"
import { ChevronDown, Link, Settings2, Expand, Copy, Check, ExternalLink, Loader2 } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SegmentedToggle } from "./controls-components"
import { type CustomBasemapSource, customTerrainSourcesAtom, customBasemapLastTypeAtom } from "@/lib/settings-atoms"
import { registerLocalFileAtom, makeLocalFileUrl, localFileId, getLocalFileName, validateLocalCogFile, resolveLocalFileUrl } from "@/lib/local-file-store"
import { copyToClipboard } from "@/lib/controls-utils"
import { useCogMetadata, useCogResolution, zoomRangeFromMetadata, formatGsd } from "@/lib/cog-metadata"
import { NextGisQmsSearchPanel } from "./nextgis-qms-search-modal"
// Lazy: the Editor Layer Index ships an ~800 KB always-loaded locator, which
// should only ever be fetched once someone picks this option.
const EliSearchPanel = lazy(() => import("./eli-search-panel").then((m) => ({ default: m.EliSearchPanel })))
const StacSearchPanel = lazy(() => import("./stac-search-panel").then((m) => ({ default: m.StacSearchPanel })))
import { WmsPickerPanel } from "./wms-picker-panel"
import { SourceUrlAutoPanel, DetectedNote } from "./source-url-auto"
import { nameFromUrl, templateWmsGetMap, type DetectedSource } from "@/lib/source-url-detect"
import { probeWmsZoomRange } from "@/lib/wms-zoom-range"
import { allmapsAnnotationGsd } from "@/lib/allmaps-gsd"

// The types a new source opens on: Auto unless a search panel or a local
// file was the last choice (a URL type found by Auto is not remembered).
const OPENING_TYPES = ["auto", "qms", "eli", "stac", "cog-local", "wms-picker"]

type BasemapFormType = "auto" | "cog" | "cog-local" | "tms" | "wms" | "wmts" | "qms" | "eli" | "tilejson" | "wms-picker" | "stac" | "iiif"

export const CustomBasemapModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomBasemapSource | null
  onSave: (source: Omit<CustomBasemapSource, "id"> & { id?: string }) => void
  // Applies opacity straight to the live source (bypassing onSave) as the
  // slider drags, so you can see the blend against the map while adjusting it
  // instead of only after committing — unlike every other field here (name,
  // url, type, role...), which stay purely local state until Save/Add is
  // clicked. Only meaningful while editing an existing (already-rendered)
  // source; there's nothing on the map yet for a brand-new one to preview
  // against, so this is omitted for the "Add New Basemap" flow.
  onLiveOpacityChange?: (opacity: number) => void
  mapRef?: React.RefObject<MapRef>
  /** A URL handed over by Add Terrain: the dialog opens on Auto with it. */
  initialUrl?: string
}> = ({ isOpen, onOpenChange, editingSource, onSave, onLiveOpacityChange, mapRef, initialUrl }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [lastType, setLastType] = useAtom(customBasemapLastTypeAtom)
  const fitTo = (b?: [number, number, number, number]) => { const m = mapRef?.current?.getMap(); if (m && b) m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, speed: 6 }) }
  const [type, setTypeState] = useState<BasemapFormType>(lastType as BasemapFormType)
  // Remember the choice for the next "Add Basemap" (not while editing an
  // existing source, whose type is its own).
  const setType = useCallback((t: BasemapFormType) => {
    setTypeState(t)
    setDetected(null)
    if (!editingSource) setLastType(t)
  }, [editingSource, setLastType])
  // What Auto recognised, shown above the field of the type it switched to.
  const [detected, setDetected] = useState<DetectedSource | null>(null)
  const handleDetected = useCallback((d: DetectedSource) => {
    setTypeState(d.type as BasemapFormType)
    setUrl(d.url)
    setDetected(d)
    if (d.allmapsTiles !== undefined) setAllmapsTiles(d.allmapsTiles)
    setName((n) => n || nameFromUrl(d.url))
  }, [])
  // Brief "copied!" confirmation on the template hint's copy button — same
  // 2s-timeout pattern as ShareSection's CopyUrlButton.
  const [templateCopied, setTemplateCopied] = useState(false)
  const handleCopyTemplate = useCallback((text: string) => {
    copyToClipboard(text)
    setTemplateCopied(true)
    setTimeout(() => setTemplateCopied(false), 1000)
  }, [])
  const [description, setDescription] = useState("")
  const [role, setRole] = useState<CustomBasemapSource["role"]>("basemap")
  const [stack, setStack] = useState<NonNullable<CustomBasemapSource["stack"]>>("under")
  const [cogViaTitiler, setCogViaTitiler] = useState(false)
  // IIIF maps: warped in the browser (sharp, flat views) or from Allmaps'
  // tile server (cached, tilted and 3D views too).
  const [allmapsTiles, setAllmapsTiles] = useState(false)
  const [opacity, setOpacity] = useState(100)
  // Unlike the terrain side, no basemap source type gets an auto-detected zoom
  // range (RasterBasemapSource just reads customBasemap.minzoom/maxzoom with a
  // 0/22 fallback — see MapSources.tsx) — so these are always user-settable
  // here, not gated behind a showMaxzoomField-style type check.
  const [minzoom, setMinzoom] = useState("")
  const [maxzoom, setMaxzoom] = useState("")
  // A WMS's zoom range, probed from the server (lib/wms-zoom-range.ts) when
  // a WMS URL is set and the fields are empty, or on "Detect".
  const [wmsZoomProbe, setWmsZoomProbe] = useState<"idle" | "probing" | "done" | "none">("idle")
  const detectWmsZooms = useCallback(async () => {
    const c = mapRef?.current?.getMap()?.getCenter()
    if (!c || !/\{bbox-epsg-3857\}/.test(url)) return
    setWmsZoomProbe("probing")
    const range = await probeWmsZoomRange(url, c.lng, c.lat).catch(() => null)
    if (range) { setMinzoom(String(range[0])); setMaxzoom(String(range[1])); setWmsZoomProbe("done") }
    else setWmsZoomProbe("none")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, mapRef])
  useEffect(() => {
    if (!isOpen || editingSource || type !== "wms" || minzoom !== "" || maxzoom !== "" || !/\{bbox-epsg-3857\}/.test(url)) return
    const t = setTimeout(() => { detectWmsZooms() }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingSource, type, url])
  // Pairs this basemap/raster source with a terrain one (e.g. a fresco's
  // albedo photo COG paired with its own DTM) — "" means unlinked. See
  // CustomBasemapSource.linkedTerrainId; the reverse Select lives in
  // custom-terrain-source-modal.tsx and either side is enough to link the pair.
  const [linkedTerrainId, setLinkedTerrainId] = useState("")
  // [west, south, east, north] as free-text draft strings — mirrors
  // CustomBasemapSource.bounds, manually settable for sources (e.g. WMS/WMTS)
  // whose extent can't be auto-detected the way COG metadata is.
  const [boundsWest, setBoundsWest] = useState("")
  const [boundsSouth, setBoundsSouth] = useState("")
  const [boundsEast, setBoundsEast] = useState("")
  const [boundsNorth, setBoundsNorth] = useState("")
  // Folded by default — most sources need neither a linked pair nor manual
  // bounds, so this stays out of the way unless deliberately expanded.
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  // The opacity editingSource had when the modal opened — restored on Cancel/
  // close-without-saving so a live-previewed drag doesn't stick if abandoned.
  const originalOpacityRef = useRef(100)
  const savedRef = useRef(false)
  const [localFileName, setLocalFileName] = useState<string | null>(null)
  const [localFileWarning, setLocalFileWarning] = useState<string | null>(null)
  const registerLocalFile = useSetAtom(registerLocalFileAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Guards against an in-flight validateLocalCogFile from a previous pick
  // resolving after (and clobbering the warning for) a newer one — a plain
  // event handler has no useEffect-style cleanup to cancel it with.
  const latestFileIdRef = useRef(0)

  useEffect(() => {
    // Only (re-)initialize on the open transition — this effect also depends
    // on isOpen so switching which source is being edited while the dialog
    // opens still picks up fresh values, but running it again on CLOSE would
    // reset savedRef.current to false right after handleSave had just set it
    // to true, making the close-revert effect below think Save was never
    // clicked and stomp the just-saved opacity back to its original value.
    if (!isOpen) return
    if (editingSource) {
      setName(editingSource.name)
      setUrl(editingSource.url)
      setType(editingSource.type as BasemapFormType)
      setDescription(editingSource.description || "")
      setRole(editingSource.role ?? "basemap")
      setStack(editingSource.stack ?? "under")
      setCogViaTitiler(!!editingSource.cogViaTitiler)
      setAllmapsTiles(!!editingSource.allmapsTiles)
      setOpacity(editingSource.opacity ?? 100)
      originalOpacityRef.current = editingSource.opacity ?? 100
      setMinzoom(editingSource.minzoom === undefined ? "" : String(editingSource.minzoom))
      setMaxzoom(editingSource.maxzoom === undefined ? "" : String(editingSource.maxzoom))
      setLinkedTerrainId(editingSource.linkedTerrainId ?? "")
      setBoundsWest(editingSource.bounds ? String(editingSource.bounds[0]) : "")
      setBoundsSouth(editingSource.bounds ? String(editingSource.bounds[1]) : "")
      setBoundsEast(editingSource.bounds ? String(editingSource.bounds[2]) : "")
      setBoundsNorth(editingSource.bounds ? String(editingSource.bounds[3]) : "")
      // Description deliberately excluded — it alone shouldn't pop Advanced open;
      // only fields whose value actually diverges from doing-nothing should.
      setIsAdvancedOpen(editingSource.minzoom !== undefined || editingSource.maxzoom !== undefined || !!editingSource.linkedTerrainId || !!editingSource.bounds)
      // Re-opening the modal on an existing "cog-local" source: the File itself
      // only lives in-memory for the session it was picked in, so after a reload
      // this is null until the user picks the file again via the button below.
      setLocalFileName(editingSource.type === "cog-local" ? getLocalFileName(localFileId(editingSource.url)) : null)
      setLocalFileWarning(null)
    } else {
      setName("")
      setUrl("")
      // NextGIS QMS on the very first run, then the last type used.
      setTypeState((!initialUrl && OPENING_TYPES.includes(lastType) ? lastType : "auto") as BasemapFormType)
      setDetected(null)
      setDescription("")
      setRole("basemap")
      setStack("under")
      setCogViaTitiler(false)
      setAllmapsTiles(false)
      setWmsZoomProbe("idle")
      setOpacity(100)
      setMinzoom("")
      setMaxzoom("")
      setLinkedTerrainId("")
      setBoundsWest("")
      setBoundsSouth("")
      setBoundsEast("")
      setBoundsNorth("")
      setIsAdvancedOpen(false)
      setLocalFileName(null)
      setLocalFileWarning(null)
    }
    savedRef.current = false
  }, [editingSource, isOpen])

  const handleLocalFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-picking the same filename later without a no-op change event
    if (!file) return
    const id = uuidv4() // crypto.randomUUID() throws on a non-secure context (plain HTTP)
    registerLocalFile({ id, file })
    setUrl(makeLocalFileUrl(id))
    setLocalFileName(file.name)
    setLocalFileWarning(null)
    if (!name) setName(file.name.replace(/\.(tif|tiff)$/i, ""))

    const thisFileId = ++latestFileIdRef.current
    validateLocalCogFile(file).then((result) => {
      if (latestFileIdRef.current !== thisFileId || !result) return
      if (!result.isTiled) {
        setLocalFileWarning(
          "This file is strip-organized, not internally tiled — it isn't a real Cloud-Optimized GeoTIFF, and streaming it in the browser can be very slow or crash on anything but tiny files. Re-export it with GDAL, e.g. gdal_translate -of COG src.tif out_cog.tif.",
        )
      } else if (result.epsg !== null && result.epsg !== 3857) {
        setLocalFileWarning(
          `This file is in EPSG:${result.epsg}, not Web Mercator (EPSG:3857) — the in-browser COG reader assumes 3857 and doesn't reproject, so its detected bounds/zoom range (and "Fit to bounds") will be wrong. Reproject it first, e.g. gdalwarp -t_srs EPSG:3857 -of COG src.tif out_3857.tif.`,
        )
      } else if (!result.hasOverviews) {
        setLocalFileWarning(
          "This file has no overviews (only one resolution level) — it'll work, but zoomed-out views will be slower to render since every zoom reads from the same full-resolution data.",
        )
      }
    })
  }, [name, registerLocalFile])

  // Roll back a live-previewed opacity if the dialog closes without Save —
  // fires on the isOpen:true->false transition, whichever way it closes
  // (Cancel, the X button, Escape, or an outside click all funnel through
  // Dialog's onOpenChange).
  useEffect(() => {
    if (isOpen) return
    if (!savedRef.current && editingSource && onLiveOpacityChange) {
      onLiveOpacityChange(originalOpacityRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleOpacityChange = useCallback((value: number) => {
    setOpacity(value)
    if (editingSource) onLiveOpacityChange?.(value)
  }, [editingSource, onLiveOpacityChange])

  const handleSave = useCallback(async () => {
    if (!name || !url) return
    savedRef.current = true
    // An Allmaps map's metres per pixel, from its control points, once.
    const resolutionM = type === "iiif" && !editingSource?.resolutionM ? await allmapsAnnotationGsd(url).catch(() => undefined) : editingSource?.resolutionM
    const boundsValues = [boundsWest, boundsSouth, boundsEast, boundsNorth].map((v) => Number(v))
    // All four or none — a partial bounds box isn't meaningful, so treat it the
    // same as unset rather than saving e.g. [NaN, 41, 9.8, 51.5].
    const parsedBounds = [boundsWest, boundsSouth, boundsEast, boundsNorth].every((v) => v !== "") && boundsValues.every(Number.isFinite)
      ? (boundsValues as [number, number, number, number])
      : undefined
    onSave({
      id: editingSource?.id, name, url, type: type as CustomBasemapSource["type"], description, role: type === "iiif" ? "overlay" : role, opacity, stack: (type === "iiif" || role === "overlay") ? (type === "iiif" && role !== "overlay" ? "top" : stack) : undefined,
      ...(type === "iiif" ? { provider: "allmaps" as const, allmapsTiles: allmapsTiles || undefined } : {}),
      minzoom: minzoom === "" ? undefined : Number(minzoom),
      maxzoom: maxzoom === "" ? undefined : Number(maxzoom),
      linkedTerrainId: linkedTerrainId || undefined,
      bounds: parsedBounds,
      cogViaTitiler: type === "cog" && cogViaTitiler ? true : undefined,
      ...(resolutionM ? { resolutionM } : {}),
    })
    onOpenChange(false)
  }, [name, url, type, description, role, opacity, stack, minzoom, maxzoom, linkedTerrainId, boundsWest, boundsSouth, boundsEast, boundsNorth, cogViaTitiler, editingSource, onSave, onOpenChange])

  // Unlike terrain, no basemap source type gets an auto-detected zoom range applied
  // at render time (RasterBasemapSource just reads customBasemap.maxzoom with a 0/22
  // fallback regardless of type — see MapSources.tsx) — so this inferred value is
  // purely a starting point/hint here, not something already silently in effect.
  const isCogType = type === "cog" || type === "cog-local"
  const cogUrlForMetadata = !isCogType ? null : type === "cog-local" ? resolveLocalFileUrl(localFileId(url)) : (url || null)
  const { data: cogMetadata, status: cogMetadataStatus } = useCogMetadata(cogUrlForMetadata)
  const inferredCogZoomRange = useMemo(() => zoomRangeFromMetadata(cogMetadata), [cogMetadata])
  const { data: cogResolution } = useCogResolution(cogUrlForMetadata)

  const url_placeholder = type === "cog" ?
    "https://example.com/basemap.cog.tiff" :
    (type === "tms") ?
      "https://example.com/tms/{z}/{x}/{y}.png" :
      type === "wms" ?
        "http://tiles.example.com/wms?bbox={bbox-epsg-3857}&format=image/png&service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&width=256&height=256&layers=example" :
        type === "tilejson" ?
          "https://example.com/basemap-tilejson.json" :
          "Not supported type"

  let helper_text = ""
  if (type === "tms") helper_text = '/{z}/{x}/{y}.png'
  if (type === "iiif") helper_text = 'https://annotations.allmaps.org/maps/<id>  (or ?url=<IIIF manifest or image>)'
  else if (type === "wms") helper_text = 'bbox={bbox-epsg-3857}'
  
  // Only WMS URLs need this. A plain string replace, not `new URL(...
  // ).toString()` — re-serializing through the URL API percent-encodes every
  // literal `{`/`}` in the ENTIRE url, not just the bbox value being
  // normalized, which corrupted any `{z}/{x}/{y}`-style template elsewhere in
  // the same url (e.g. a WMTS REST endpoint) into %7Bz%7D etc. Mirrors
  // lib/wms-client.ts's own bbox-param rewrite.
  const normalizeBboxParam = (input: string) => {
    if (type !== "wms" || !/[?&]request=getmap/i.test(input) && !/[?&]bbox=/i.test(input)) return input
    return templateWmsGetMap(input, 256)
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] flex flex-col gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>
            {editingSource ? "Edit Basemap" : "Add New Basemap"}
          </DialogTitle>
          <DialogDescription>
            Add your own basemap from a raster tile or vector style endpoint.
          </DialogDescription>
        </DialogHeader>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">
          ✕
        </DialogClose>
        {/* The form scrolls; the footer below it does not. */}
        <div className="space-y-4 min-w-0 flex-1 min-h-0 overflow-y-auto px-6 pb-4">
          <div className="space-y-2">
            <Label htmlFor="basemap-name">Name *</Label>
            <Input
              id="basemap-name"
              type="text"
              placeholder="My Custom Basemap"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="cursor-text"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="basemap-type">Type *</Label>
            <Select
              key={detected ? `d:${detected.type}` : "manual"}
              value={type}
              onValueChange={(value: any) => setType(value)}
              items={{
                auto: "Auto (detect from the URL)",
                tms: "TMS/XYZ (Raster Tile)",
                cog: "Remote COG (URL)",
                "cog-local": "Local COG file (this browser only)",
                wms: "Raster (WMS / WMTS)",
                tilejson: "TileJSON (Raster Basemap)",
                iiif: "IIIF map with a Georeference Annotation (Allmaps)",
                "wms-picker": "WMS (list layers)",
                qms: "NextGIS QMS (search)",
                eli: "OSM Editor Layer Index (search)",
                stac: "STAC catalog search",
              }}
            >
              <SelectTrigger id="basemap-type" className="cursor-pointer w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!editingSource && <SelectItem value="auto">Auto (detect from the URL)</SelectItem>}
                {!editingSource && (
                  <SelectGroup>
                    <SelectLabel>Search a catalog</SelectLabel>
                    <SelectItem value="qms">NextGIS QMS (search)</SelectItem>
                    <SelectItem value="eli">OSM Editor Layer Index (search)</SelectItem>
                    <SelectItem value="stac">STAC catalog search</SelectItem>
                  </SelectGroup>
                )}
                <SelectGroup>
                  <SelectLabel>Cloud Optimized GeoTIFF</SelectLabel>
                  {/* Streams straight off the user's disk via a blob: object URL — no
                      upload, no companion server. Only ever readable via the geomatico
                      cog:// protocol, and the picked file only lives in this browser
                      tab's memory — it isn't saved, so it needs re-picking after a
                      reload (mirrors "Local COG file" on the Terrain Source side). */}
                  <SelectItem value="cog-local">Local COG file (this browser only)</SelectItem>
                  <SelectItem value="cog">Remote COG (URL)</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Tile and map services</SelectLabel>
                  <SelectItem value="tms">TMS/XYZ (Raster Tile)</SelectItem>
                  {!editingSource && <SelectItem value="wms-picker">WMS (list layers)</SelectItem>}
                  <SelectItem value="wms">Raster (WMS / WMTS)</SelectItem>
                  <SelectItem value="tilejson">TileJSON (Raster Basemap)</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Georeferenced images</SelectLabel>
                  {/* A Georeference Annotation (the IIIF extension Allmaps
                      writes): the URL of the annotation, a map's at
                      annotations.allmaps.org/maps/<id>, or a manifest's or
                      image's annotation page. Drawn warped from its control
                      points; always an overlay. */}
                  <SelectItem value="iiif">IIIF map with a Georeference Annotation (Allmaps)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <DetectedNote detected={detected} onDismiss={() => setDetected(null)} onBack={() => { setType("auto"); setUrl("") }} />

          {type === "auto" ? (
            <SourceUrlAutoPanel key={initialUrl ?? ""} target="basemap" onDetected={handleDetected} initialUrl={initialUrl} />
          ) : type === "qms" ? (
            <NextGisQmsSearchPanel onSave={(source) => { onSave(source); onOpenChange(false) }} />
          ) : type === "eli" ? (
            <Suspense fallback={<p className="text-sm text-muted-foreground py-4 text-center">Loading the Editor Layer Index…</p>}>
              <EliSearchPanel mapRef={mapRef} onSave={(source) => { onSave(source); onOpenChange(false) }} />
            </Suspense>
          ) : type === "stac" ? (
            <Suspense fallback={<p className="text-sm text-muted-foreground py-4 text-center">Loading STAC search…</p>}>
              <StacSearchPanel key={detected?.url ?? "manual"} initialUrl={detected?.type === "stac" ? detected.url : undefined} target="basemap" mapRef={mapRef} onSave={(source) => { onSave({ ...source, role: source.role ?? "basemap", opacity: 100 } as any); fitTo(source.bounds) }} />
            </Suspense>
          ) : type === "wms-picker" ? (
            <WmsPickerPanel
              key={detected?.url ?? "manual"}
              initialUrl={detected?.type === "wms-picker" ? detected.url : undefined}
              format="image/png"
              mapCenter={() => { const c = mapRef?.current?.getMap()?.getCenter(); return c ? [c.lng, c.lat] : undefined }}
              tileSize={256}
              onSave={(params) => { onSave({ ...params, type: "wms" }); onOpenChange(false) }}
            />
          ) : (
            <>
              {type === "cog-local" ? (
                <div className="space-y-2">
                  <Label htmlFor="basemap-local-file">COG file *</Label>
                  <input
                    ref={fileInputRef}
                    id="basemap-local-file"
                    type="file"
                    accept=".tif,.tiff,image/tiff"
                    className="hidden"
                    onChange={handleLocalFileChange}
                  />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="cursor-pointer">
                      Choose file…
                    </Button>
                    <span className="text-sm text-muted-foreground truncate min-w-0">
                      {localFileName ?? "No file selected"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Must be:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>a real COG (Cloud-Optimized GeoTIFF, internally tiled, with overviews)</li>
                      <li>in CRS EPSG:3857 (Web Mercator)</li>
                    </ul>
                    <p>
                      No live reprojection is performed on the client, so any other CRS
                      will show wrong bounds/zoom. Directly read from disk, never
                      uploaded, and remembered locally between sessions (via OPFS) when
                      there's room — otherwise you'll be asked to re-pick it next time.
                    </p>
                  </div>
                  {localFileWarning && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">{localFileWarning}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="basemap-url">
                    URL * {helper_text && (
                      <span className="select-text inline-flex items-center">
                        (hint: {helper_text}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                onClick={() => handleCopyTemplate(helper_text)}
                                className="ml-1.5 cursor-pointer hover:opacity-70"
                                aria-label="Copy template"
                              >
                                {templateCopied ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            }
                          />
                          <TooltipContent><p>{templateCopied ? "Copied!" : "Copy template"}</p></TooltipContent>
                        </Tooltip>
                        )
                      </span>
                    )}
                  </Label>
                  <Input
                    id="basemap-url"
                    type="text"
                    placeholder={url_placeholder}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={(e) => {
                      const normalized = normalizeBboxParam(e.target.value);
                      setUrl(normalized);
                    }}
                    className="cursor-text"
                  />
                  {type === "cog" && /^https?:\/\//.test(url.trim()) && (
                    <p className="text-[11px] text-muted-foreground">
                      Inspect this COG in the{" "}
                      <a href={`https://source-cooperative.github.io/cog-viewer/?url=${encodeURIComponent(url.trim())}`} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">source.coop viewer <ExternalLink className="h-3 w-3" /></a>
                      {" "}or{" "}
                      <a href={`https://web.geolibre.app/?data=${encodeURIComponent(url.trim())}`} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">GeoLibre <ExternalLink className="h-3 w-3" /></a>
                    </p>
                  )}
                </div>
              )}
              {type === "iiif" && (
                <div className="space-y-2">
                  <Label>Warp (projection transform)</Label>
                  <SegmentedToggle
                    className="w-full"
                    value={allmapsTiles ? "tiles" : "browser"}
                    onChange={(v) => setAllmapsTiles(v === "tiles")}
                    options={[
                      { value: "browser" as const, label: "Warped in the browser" },
                      { value: "tiles" as const, label: "Allmaps tile server" },
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    In the browser: the sharpest, from the IIIF image itself, flat views only (a tilted view switches to the tile server by itself). Tile server: warped and cached by Allmaps (allmaps.xyz), a plain raster that tilts and drapes on terrain, and much faster when the image server is slow (David Rumsey's).
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Use as</Label>
                <SegmentedToggle
                  className="w-full"
                  value={(role ?? "basemap") as NonNullable<CustomBasemapSource["role"]>}
                  onChange={(value) => setRole(value)}
                  options={[
                    { value: "basemap" as NonNullable<CustomBasemapSource["role"]>, label: "Basemap" },
                    { value: "overlay" as NonNullable<CustomBasemapSource["role"]>, label: "Overlay" },
                  ]}
                />
                <p className="text-xs text-muted-foreground">
                  Overlays stack on top of the active basemap instead of replacing it — only available in Split/Radio basemap mode.
                </p>
              </div>
              {/* Named "Style" (rather than folded into the fields above) so it
                  reads as a display preference belonging to this saved source —
                  not a live per-session slider like the main Raster Basemap
                  Opacity control, which still applies on top of this one. */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Style</p>
                <div className="flex items-center justify-between">
                  <Label htmlFor="basemap-opacity" className="text-sm">Opacity</Label>
                  <span className="text-sm text-muted-foreground">{opacity}%</span>
                </div>
                <Slider
                  id="basemap-opacity"
                  min={0}
                  max={100}
                  step={1}
                  value={opacity}
                  onValueChange={(value) => handleOpacityChange(value as number)}
                  className="cursor-pointer"
                />
              </div>
              <Separator className="my-3" />
              <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Settings2 className="h-3.5 w-3.5" />
                    Advanced
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  {type === "cog" && (
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="basemap-cog-via-titiler" className="block text-sm leading-snug cursor-pointer">
                        <span className="font-medium">Always serve via titiler</span>{" "}
                        <span className="font-normal text-muted-foreground">for a COG not in EPSG:3857: the in-browser reader shows nothing for it, titiler warps it server-side. Overrides the global COG setting for this source only.</span>
                      </Label>
                      <Switch id="basemap-cog-via-titiler" checked={cogViaTitiler} onCheckedChange={setCogViaTitiler} className="cursor-pointer shrink-0" />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="basemap-description">
                      Description (optional)
                    </Label>
                    <Input
                      id="basemap-description"
                      type="text"
                      placeholder="Custom basemap from..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="cursor-text"
                    />
                  </div>
                  {isCogType && (
                    <p className="text-xs text-muted-foreground">
                      {cogUrlForMetadata === null
                        ? "Inferred native resolution zoom appears once a file/URL is set."
                        : cogMetadataStatus === "error"
                        ? "Couldn't read this file's metadata (blocked by CORS, or a network error) — set Max Zoom manually below."
                        : cogMetadata
                        ? `Inferred native resolution: zoom ${inferredCogZoomRange.maxzoom}${cogResolution ? ` (~${formatGsd(cogResolution.meanGsd)} GSD)` : ""} — override below if it's wrong.`
                        : "Detecting native resolution…"}
                    </p>
                  )}
                  {type === "wms" && (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {wmsZoomProbe === "probing" ? "Finding the zooms this WMS draws at, around the map's centre…"
                          : wmsZoomProbe === "none" ? "No zoom drew anything around the map's centre: move the map over the layer and try again, or set the zooms by hand."
                          : wmsZoomProbe === "done" ? "Zooms detected from the server (empty tiles outside them); edit them if needed."
                          : "A WMS answers an empty image outside a layer's scales: detect the zooms it draws at, around the map's centre."}
                      </p>
                      <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 cursor-pointer" disabled={wmsZoomProbe === "probing" || !/\{bbox-epsg-3857\}/.test(url)} onClick={detectWmsZooms}>
                        {wmsZoomProbe === "probing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Detect"}
                      </Button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="basemap-minzoom">Min Zoom (optional)</Label>
                      <Input
                        id="basemap-minzoom"
                        type="number"
                        min={0}
                        max={24}
                        placeholder={isCogType && cogMetadata ? `${inferredCogZoomRange.minzoom} (inferred)` : "0"}
                        value={minzoom}
                        onChange={(e) => setMinzoom(e.target.value)}
                        className="cursor-text"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="basemap-maxzoom">Max Zoom (optional)</Label>
                      <Input
                        id="basemap-maxzoom"
                        type="number"
                        min={0}
                        max={24}
                        placeholder={isCogType && cogMetadata ? `${inferredCogZoomRange.maxzoom} (inferred)` : "Native resolution zoom level, e.g. 19"}
                        value={maxzoom}
                        onChange={(e) => setMaxzoom(e.target.value)}
                        className="cursor-text"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-sm">
                      Linked Terrain Source{linkedTerrainId && " (set)"}
                      <Link className="h-3.5 w-3.5" />
                    </Label>
                    <Select
                      value={linkedTerrainId || "none"}
                      onValueChange={(value) => value && setLinkedTerrainId(value === "none" ? "" : value)}
                      items={{ none: "None", ...Object.fromEntries(customTerrainSources.map((t) => [t.id, t.name])) }}
                    >
                      <SelectTrigger id="basemap-linked-terrain" className="cursor-pointer w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {customTerrainSources.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Pairs this with a terrain/elevation source (e.g. a fresco's albedo photo
                      with its own DTM) — selecting either one as active auto-selects the other.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Source Bounds (optional)</Label>
                      <Tooltip>
                        {/* Span wrapper keeps the tooltip working when the
                            button is disabled (no mapRef) — a disabled button
                            doesn't dispatch hover events. */}
                        <TooltipTrigger
                          render={
                            <span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 cursor-pointer"
                                disabled={!mapRef}
                                onClick={() => {
                                  const bounds = mapRef?.current?.getMap()?.getBounds()
                                  if (!bounds) return
                                  setBoundsWest(bounds.getWest().toFixed(6))
                                  setBoundsSouth(bounds.getSouth().toFixed(6))
                                  setBoundsEast(bounds.getEast().toFixed(6))
                                  setBoundsNorth(bounds.getNorth().toFixed(6))
                                }}
                              >
                                <Expand className="h-3.5 w-3.5" />
                              </Button>
                            </span>
                          }
                        />
                        <TooltipContent><p>Set to the map&apos;s current bounds</p></TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <Input type="text" inputMode="decimal" placeholder="West" value={boundsWest} onChange={(e) => setBoundsWest(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="South" value={boundsSouth} onChange={(e) => setBoundsSouth(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="East" value={boundsEast} onChange={(e) => setBoundsEast(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="North" value={boundsNorth} onChange={(e) => setBoundsNorth(e.target.value)} className="cursor-text text-xs" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      [west, south, east, north] in degrees — powers "Fit to bounds" for sources
                      whose extent can't be auto-detected (e.g. a WMS/WMTS endpoint has no such
                      metadata). Leave any field empty to leave it unset.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </div>
        {!(["auto", "stac-search", "wms-picker"].includes(type)) && (
          <div className="relative shrink-0 px-6 pb-5 pt-3 flex justify-end gap-2 border-t bg-background before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-background before:to-transparent">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name || !url}
            className="cursor-pointer"
          >
            {editingSource ? "Save Changes" : "Add Basemap"}
          </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
