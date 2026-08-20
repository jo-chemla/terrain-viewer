import type React from "react"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useAtom, useSetAtom } from "jotai"
import { v4 as uuidv4 } from "uuid"
import { ChevronDown, Link, Settings2, Expand, Copy, Check } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type CustomTerrainSource, useCogProtocolVsTitilerAtom, customBasemapSourcesAtom } from "@/lib/settings-atoms"
import { registerLocalFileAtom, makeLocalFileUrl, localFileId, getLocalFileName, validateLocalCogFile, resolveLocalFileUrl } from "@/lib/local-file-store"
import { copyToClipboard } from "@/lib/controls-utils"
import { useCogMetadata, useCogResolution, zoomRangeFromMetadata, formatGsd } from "@/lib/cog-metadata"
import { WmsPickerPanel } from "./wms-picker-panel"

type TerrainFormType = CustomTerrainSource["type"] | "wms-picker"

export const CustomTerrainSourceModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomTerrainSource | null
  onSave: (source: Omit<CustomTerrainSource, "id"> & { id?: string }) => void
  mapRef?: React.RefObject<MapRef>
}> = ({ isOpen, onOpenChange, editingSource, onSave, mapRef }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [type, setType] = useState<TerrainFormType>("cog")
  // Brief "copied!" confirmation on the template hint's copy button — same
  // 2s-timeout pattern as ShareSection's CopyUrlButton.
  const [templateCopied, setTemplateCopied] = useState(false)
  const handleCopyTemplate = useCallback((text: string) => {
    copyToClipboard(text)
    setTemplateCopied(true)
    setTimeout(() => setTemplateCopied(false), 1000)
  }, [])
  const [description, setDescription] = useState("")
  const [maxzoom, setMaxzoom] = useState("")
  // Pairs this terrain source with a basemap/raster one (e.g. a fresco's DTM
  // paired with its own albedo photo COG) — "" means unlinked. See
  // CustomTerrainSource.linkedBasemapId; the reverse Select lives in
  // custom-basemap-modal.tsx and either side is enough to link the pair.
  const [linkedBasemapId, setLinkedBasemapId] = useState("")
  // [west, south, east, north] as free-text draft strings — mirrors
  // CustomTerrainSource.bounds, manually settable for sources (e.g. WMS) whose
  // extent can't be auto-detected the way COG metadata is.
  const [boundsWest, setBoundsWest] = useState("")
  const [boundsSouth, setBoundsSouth] = useState("")
  const [boundsEast, setBoundsEast] = useState("")
  const [boundsNorth, setBoundsNorth] = useState("")
  // Folded by default — most sources need neither a linked pair nor manual
  // bounds, so this stays out of the way unless deliberately expanded.
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [localFileName, setLocalFileName] = useState<string | null>(null)
  const [localFileWarning, setLocalFileWarning] = useState<string | null>(null)
  const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const registerLocalFile = useSetAtom(registerLocalFileAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Guards against an in-flight validateLocalCogFile from a previous pick
  // resolving after (and clobbering the warning for) a newer one — a plain
  // event handler has no useEffect-style cleanup to cancel it with.
  const latestFileIdRef = useRef(0)

  useEffect(() => {
    if (editingSource) {
      setName(editingSource.name)
      setUrl(editingSource.url)
      setType(editingSource.type)
      setDescription(editingSource.description || "")
      setMaxzoom(editingSource.maxzoom === undefined ? "" : String(editingSource.maxzoom))
      setLinkedBasemapId(editingSource.linkedBasemapId ?? "")
      setBoundsWest(editingSource.bounds ? String(editingSource.bounds[0]) : "")
      setBoundsSouth(editingSource.bounds ? String(editingSource.bounds[1]) : "")
      setBoundsEast(editingSource.bounds ? String(editingSource.bounds[2]) : "")
      setBoundsNorth(editingSource.bounds ? String(editingSource.bounds[3]) : "")
      // Description deliberately excluded — it alone shouldn't pop Advanced open;
      // only fields whose value actually diverges from doing-nothing should.
      setIsAdvancedOpen(editingSource.maxzoom !== undefined || !!editingSource.linkedBasemapId || !!editingSource.bounds)
      // Re-opening the modal on an existing "cog-local" source: the File itself
      // only lives in-memory for the session it was picked in, so after a reload
      // this is null until the user picks the file again via the button below.
      setLocalFileName(editingSource.type === "cog-local" ? getLocalFileName(localFileId(editingSource.url)) : null)
      setLocalFileWarning(null)
    } else {
      setName("")
      setUrl("")
      setType("cog")
      setDescription("")
      setMaxzoom("")
      setLinkedBasemapId("")
      setBoundsWest("")
      setBoundsSouth("")
      setBoundsEast("")
      setBoundsNorth("")
      setIsAdvancedOpen(false)
      setLocalFileName(null)
      setLocalFileWarning(null)
    }
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

  const handleSave = useCallback(() => {
    if (!name || !url) return
    const parsedMaxzoom = maxzoom === "" ? undefined : Number(maxzoom)
    const boundsValues = [boundsWest, boundsSouth, boundsEast, boundsNorth].map((v) => Number(v))
    // All four or none — a partial bounds box isn't meaningful, so treat it the
    // same as unset rather than saving e.g. [NaN, 41, 9.8, 51.5].
    const parsedBounds = [boundsWest, boundsSouth, boundsEast, boundsNorth].every((v) => v !== "") && boundsValues.every(Number.isFinite)
      ? (boundsValues as [number, number, number, number])
      : undefined
    onSave({
      id: editingSource?.id, name, url, type: type as CustomTerrainSource["type"], description, maxzoom: parsedMaxzoom,
      linkedBasemapId: linkedBasemapId || undefined,
      bounds: parsedBounds,
    })
    onOpenChange(false)
  }, [name, url, type, description, maxzoom, linkedBasemapId, boundsWest, boundsSouth, boundsEast, boundsNorth, editingSource, onSave, onOpenChange])

  // COG/cog-local sources detect their own zoom range from file metadata via
  // geomatico (below) rather than needing a manual field — but MapSources.tsx's
  // TerrainSources already lets customSource.maxzoom win over that detected value
  // (`customSource?.maxzoom ?? detectedMaxzoom`), so surfacing the field here too
  // (with the inferred value as a starting point) just exposes an override that
  // already worked, silently, before this. VRT has no such detection at all — it
  // streams through titiler, which doesn't report back a native zoom — so it falls
  // back to the same generic 0-20 range as WMS/TMS/TileJSON unless overridden here.
  const showMaxzoomField = type === "wms-raw" || type === "terrainrgb" || type === "terrarium" || type === "tilejson" || type === "cog" || type === "cog-local"

  const isCogType = type === "cog" || type === "cog-local"
  const cogUrlForMetadata = !isCogType ? null : type === "cog-local" ? resolveLocalFileUrl(localFileId(url)) : (url || null)
  const { data: cogMetadata, status: cogMetadataStatus } = useCogMetadata(cogUrlForMetadata)
  const inferredCogZoomRange = useMemo(() => zoomRangeFromMetadata(cogMetadata), [cogMetadata])
  const { data: cogResolution } = useCogResolution(cogUrlForMetadata)

  const url_placeholder = type === "cog" ?
    "https://example.com/terrain-dtm.cog.tiff" :
    type === "wms-raw" ?
    "https://example.com/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=...&FORMAT=image%2Fgeotiff&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=514&HEIGHT=514" :
    type === "tilejson" ?
    "https://example.com/terrain-tilejson.json" :
    "https://example.com/tms/{z}/{x}/{y}.png"

  let helper_text = ""
  if (type === "terrarium" || type === "terrainrgb") helper_text = "/{z}/{x}/{y}.png"
  else if (type === "wms-raw") helper_text = "BBOX={bbox-epsg-3857}"

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{editingSource ? "Edit Terrain Dataset" : "Add New Terrain Dataset"}</DialogTitle>
          <DialogDescription>Add your own terrain data source from a TerrainRGB, Terrarium or COG endpoint.</DialogDescription>
        </DialogHeader>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-name">Name *</Label>
            <Input id="source-name" type="text" placeholder="My Custom Terrain" value={name} onChange={(e) => setName(e.target.value)} className="cursor-text" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-type">Type *</Label>
            <Select
              value={type}
              onValueChange={(value: any) => setType(value)}
              items={{
                cog: "COG (Cloud Optimized GeoTIFF)",
                "cog-local": "Local COG file (this browser only)",
                terrarium: "TMS (Terrarium)",
                terrainrgb: "TMS (TerrainRGB)",
                "wms-picker": "WMS (list layers)",
                "wms-raw": "WMS (raw Float32 elevation)",
                tilejson: "TileJSON",
                vrt: `VRT${useCogProtocol ? " (titiler mode only)" : ""}`,
              }}
            >
              <SelectTrigger id="source-type" className="cursor-pointer w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cog">COG (Cloud Optimized GeoTIFF)</SelectItem>
                {/* Streams straight off the user's disk via a blob: object URL — no
                    upload, no companion server. Only ever readable via the geomatico
                    cog:// protocol (there's no titiler server that could reach a local
                    file), and the picked file only lives in this browser tab's memory —
                    it isn't saved, so it needs re-picking after a reload. */}
                <SelectItem value="cog-local">Local COG file (this browser only)</SelectItem>
                <SelectItem value="terrarium">TMS (Terrarium)</SelectItem>
                <SelectItem value="terrainrgb">TMS (TerrainRGB)</SelectItem>
                {!editingSource && <SelectItem value="wms-picker">WMS (list layers)</SelectItem>}
                <SelectItem value="wms-raw">WMS (raw Float32 elevation)</SelectItem>
                <SelectItem value="tilejson">TileJSON</SelectItem>
                {/* VRT only streams through titiler (GDAL's vsicurl driver) — the
                    geomatico cog:// protocol reads a real COG file directly and can't
                    open a VRT mosaic, so this option is a dead end in that mode. */}
                <SelectItem value="vrt" disabled={useCogProtocol}>
                  VRT{useCogProtocol ? " (titiler mode only)" : ""}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === "wms-picker" ? (
            <WmsPickerPanel
              format="image/geotiff"
              tileSize={514}
              onSave={(params) => { onSave({ ...params, type: "wms-raw" }); onOpenChange(false) }}
            />
          ) : (
            <>
              {type === "cog-local" ? (
                <div className="space-y-2">
                  <Label htmlFor="source-local-file">COG file *</Label>
                  <input
                    ref={fileInputRef}
                    id="source-local-file"
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
                  <Label htmlFor="source-url">
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
                  <Input id="source-url" type="text" placeholder={url_placeholder} value={url} onChange={(e) => setUrl(e.target.value)} className="cursor-text" />
                </div>
              )}
              <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Settings2 className="h-3.5 w-3.5" />
                    Advanced
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="source-description">Description (optional)</Label>
                    <Input id="source-description" type="text" placeholder="Custom terrain data from..." value={description} onChange={(e) => setDescription(e.target.value)} className="cursor-text" />
                  </div>
                  {showMaxzoomField && (
                    <div className="space-y-2">
                      <Label htmlFor="source-maxzoom">Max Zoom (optional)</Label>
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
                      <Input
                        id="source-maxzoom"
                        type="number"
                        min={0}
                        max={24}
                        placeholder={isCogType && cogMetadata ? `${inferredCogZoomRange.maxzoom} (inferred)` : "Native resolution zoom level, e.g. 17"}
                        value={maxzoom}
                        onChange={(e) => setMaxzoom(e.target.value)}
                        className="cursor-text"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-sm">
                      Linked Basemap Source{linkedBasemapId && " (set)"}
                      <Link className="h-3.5 w-3.5" />
                    </Label>
                    <Select
                      value={linkedBasemapId || "none"}
                      onValueChange={(value) => value && setLinkedBasemapId(value === "none" ? "" : value)}
                      items={{ none: "None", ...Object.fromEntries(customBasemapSources.map((b) => [b.id, b.name])) }}
                    >
                      <SelectTrigger id="source-linked-basemap" className="cursor-pointer w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {customBasemapSources.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Pairs this with a basemap/raster source (e.g. a fresco's DTM with its own
                      albedo photo) — selecting either one as active auto-selects the other.
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
                      whose extent can't be auto-detected (e.g. a WMS endpoint has no such
                      metadata). Leave any field empty to leave it unset.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
                <Button onClick={handleSave} disabled={!name || !url} className="cursor-pointer">{editingSource ? "Save Changes" : "Add Source"}</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
