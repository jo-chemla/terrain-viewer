import type React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useAtom, useSetAtom } from "jotai"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type CustomTerrainSource, useCogProtocolVsTitilerAtom } from "@/lib/settings-atoms"
import { registerLocalFileAtom, makeLocalFileUrl, localFileId, getLocalFileName, validateLocalCogFile } from "@/lib/local-file-store"
import { WmsPickerPanel } from "./wms-picker-panel"

type TerrainFormType = CustomTerrainSource["type"] | "wms-picker"

export const CustomTerrainSourceModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomTerrainSource | null
  onSave: (source: Omit<CustomTerrainSource, "id"> & { id?: string }) => void
}> = ({ isOpen, onOpenChange, editingSource, onSave }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [type, setType] = useState<TerrainFormType>("cog")
  const [description, setDescription] = useState("")
  const [maxzoom, setMaxzoom] = useState("")
  const [localFileName, setLocalFileName] = useState<string | null>(null)
  const [localFileWarning, setLocalFileWarning] = useState<string | null>(null)
  const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
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
      setLocalFileName(null)
      setLocalFileWarning(null)
    }
  }, [editingSource, isOpen])

  const handleLocalFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-picking the same filename later without a no-op change event
    if (!file) return
    const id = crypto.randomUUID()
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
    onSave({ id: editingSource?.id, name, url, type: type as CustomTerrainSource["type"], description, maxzoom: parsedMaxzoom })
    onOpenChange(false)
  }, [name, url, type, description, maxzoom, editingSource, onSave, onOpenChange])

  // COG/VRT sources detect their own zoom range from file metadata; WMS/TMS/TileJSON
  // sources (wms-raw, terrainrgb, terrarium, tilejson) have no such metadata, so they
  // fall back to a generic 0-20 range unless the user overrides it here. TileJSON's
  // manifest technically carries its own maxzoom, but MapLibre applies that as a hard
  // tile-fetch ceiling rather than feeding it back into this app's zoom-range UI, so
  // the override still matters here too.
  const showMaxzoomField = type === "wms-raw" || type === "terrainrgb" || type === "terrarium" || type === "tilejson"

  const url_placeholder = type === "cog" ?
    "https://example.com/terrain-dtm.cog.tiff" :
    type === "wms-raw" ?
    "https://example.com/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=...&FORMAT=image%2Fgeotiff&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=514&HEIGHT=514" :
    type === "tilejson" ?
    "https://example.com/terrain-tilejson.json" :
    "https://example.com/tms/{z}/{x}/{y}.png"

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
            <Label htmlFor="source-type">Type *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
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
              <div className="space-y-2">
                <Label htmlFor="source-name">Name *</Label>
                <Input id="source-name" type="text" placeholder="My Custom Terrain" value={name} onChange={(e) => setName(e.target.value)} className="cursor-text" />
              </div>
              {type === "cog-local" ? (
                <div className="space-y-2">
                  <Label htmlFor="source-local-file">COG file *</Label>
                  <p className="text-xs text-muted-foreground">
                    Must be a real COG (Cloud-Optimized GeoTIFF, internally tiled, with
                    overviews) in CRS EPSG:3857 (Web Mercator) — the in-browser reader
                    doesn't reproject, so any other CRS will show wrong bounds/zoom.
                  </p>
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
                  <p className="text-xs text-muted-foreground">
                    Read directly from disk, never uploaded — but only kept in this
                    browser tab's memory, so it needs re-picking after a page reload.
                  </p>
                  {localFileWarning && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">{localFileWarning}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="source-url">URL *</Label>
                  <Input id="source-url" type="text" placeholder={url_placeholder} value={url} onChange={(e) => setUrl(e.target.value)} className="cursor-text" />
                </div>
              )}
              {showMaxzoomField && (
                <div className="space-y-2">
                  <Label htmlFor="source-maxzoom">Max Zoom (optional)</Label>
                  <Input
                    id="source-maxzoom"
                    type="number"
                    min={0}
                    max={24}
                    placeholder="Native resolution zoom level, e.g. 17"
                    value={maxzoom}
                    onChange={(e) => setMaxzoom(e.target.value)}
                    className="cursor-text"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="source-description">Description (optional)</Label>
                <Input id="source-description" type="text" placeholder="Custom terrain data from..." value={description} onChange={(e) => setDescription(e.target.value)} className="cursor-text" />
              </div>
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
