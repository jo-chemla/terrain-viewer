import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type CustomTerrainSource } from "@/lib/settings-atoms"

export const CustomTerrainSourceModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomTerrainSource | null
  onSave: (source: Omit<CustomTerrainSource, "id"> & { id?: string }) => void
}> = ({ isOpen, onOpenChange, editingSource, onSave }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [type, setType] = useState<"cog" | "terrainrgb" | "terrarium" | "vrt" | "wms-raw" | "tilejson">("cog")
  const [description, setDescription] = useState("")
  const [maxzoom, setMaxzoom] = useState("")

  useEffect(() => {
    if (editingSource) {
      setName(editingSource.name)
      setUrl(editingSource.url)
      setType(editingSource.type)
      setDescription(editingSource.description || "")
      setMaxzoom(editingSource.maxzoom === undefined ? "" : String(editingSource.maxzoom))
    } else {
      setName("")
      setUrl("")
      setType("cog")
      setDescription("")
      setMaxzoom("")
    }
  }, [editingSource, isOpen])

  const handleSave = useCallback(() => {
    if (!name || !url) return
    const parsedMaxzoom = maxzoom === "" ? undefined : Number(maxzoom)
    onSave({ id: editingSource?.id, name, url, type, description, maxzoom: parsedMaxzoom })
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
            <Label htmlFor="source-name">Name *</Label>
            <Input id="source-name" type="text" placeholder="My Custom Terrain" value={name} onChange={(e) => setName(e.target.value)} className="cursor-text" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-url">URL *</Label>
            <Input id="source-url" type="text" placeholder={url_placeholder} value={url} onChange={(e) => setUrl(e.target.value)} className="cursor-text" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-type">Type *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
              <SelectTrigger id="source-type" className="cursor-pointer w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cog">COG (Cloud Optimized GeoTIFF)</SelectItem>
                <SelectItem value="terrainrgb">TMS (TerrainRGB)</SelectItem>
                <SelectItem value="terrarium">TMS (Terrarium)</SelectItem>
                <SelectItem value="vrt">VRT</SelectItem>
                <SelectItem value="wms-raw">WMS (raw Float32 elevation)</SelectItem>
                <SelectItem value="tilejson">TileJSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
