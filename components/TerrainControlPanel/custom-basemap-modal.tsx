import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { type CustomBasemapSource } from "@/lib/settings-atoms"
import { NextGisQmsSearchPanel } from "./nextgis-qms-search-modal"
import { WmsPickerPanel } from "./wms-picker-panel"

type BasemapFormType = "cog" | "tms" | "wms" | "wmts" | "qms" | "tilejson" | "wms-picker"

export const CustomBasemapModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomBasemapSource | null
  onSave: (source: Omit<CustomBasemapSource, "id"> & { id?: string }) => void
}> = ({ isOpen, onOpenChange, editingSource, onSave }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [type, setType] = useState<BasemapFormType>("tms")
  const [description, setDescription] = useState("")
  const [role, setRole] = useState<CustomBasemapSource["role"]>("basemap")

  useEffect(() => {
    if (editingSource) {
      setName(editingSource.name)
      setUrl(editingSource.url)
      setType(editingSource.type)
      setDescription(editingSource.description || "")
      setRole(editingSource.role ?? "basemap")
    } else {
      setName("")
      setUrl("")
      setType("tms")
      setDescription("")
      setRole("basemap")
    }
  }, [editingSource, isOpen])

  const handleSave = useCallback(() => {
    if (!name || !url) return
    onSave({ id: editingSource?.id, name, url, type: type as CustomBasemapSource["type"], description, role })
    onOpenChange(false)
  }, [name, url, type, description, role, editingSource, onSave, onOpenChange])

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
  else if (type === "wms") helper_text = 'bbox={bbox-epsg-3857}'
  
  // Only WMS URLs need this — re-serializing via `new URL(...).toString()` percent-
  // encodes literal `{`/`}` characters, which would corrupt a TMS/XYZ/TileJSON URL's
  // `{z}/{x}/{y}` placeholders (e.g. tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png
  // failing to fetch because its braces got encoded to %7Bz%7D etc).
  const normalizeBboxParam = (input: string) => {
    if (type !== "wms") return input
    try {
      const parsedUrl = new URL(input);
      if (parsedUrl.searchParams.has("bbox")) {
        parsedUrl.searchParams.set("bbox", "{bbox-epsg-3857}");
      }
      return parsedUrl.toString();
    } catch {
      return input;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
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
        <div className="space-y-4 min-w-0">
          <div className="space-y-2">
            <Label htmlFor="basemap-type">Type *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
              <SelectTrigger id="basemap-type" className="cursor-pointer w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tms">TMS/XYZ (Raster Tile)</SelectItem>
                <SelectItem value="cog">COG (Cloud Optimized Geotiff)</SelectItem>
                <SelectItem value="wms">Raster (WMS / WMTS)</SelectItem>
                <SelectItem value="tilejson">TileJSON (Raster Basemap)</SelectItem>
                {!editingSource && <SelectItem value="wms-picker">WMS (list layers)</SelectItem>}
                {!editingSource && <SelectItem value="qms">NextGIS QMS (search)</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {type === "qms" ? (
            <NextGisQmsSearchPanel onSave={(source) => { onSave(source); onOpenChange(false) }} />
          ) : type === "wms-picker" ? (
            <WmsPickerPanel
              format="image/png"
              tileSize={256}
              onSave={(params) => { onSave({ ...params, type: "wms" }); onOpenChange(false) }}
            />
          ) : (
            <>
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
                <Label htmlFor="basemap-url">
                  URL * {helper_text && <span className="select-text">(hint: {helper_text})</span>}
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
              </div>
              <div className="space-y-2">
                <Label>Use as</Label>
                <ToggleGroup
                  type="single"
                  value={role}
                  onValueChange={(value) => value && setRole(value as CustomBasemapSource["role"])}
                  className="border rounded-md w-full"
                >
                  <ToggleGroupItem
                    value="basemap"
                    className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
                  >
                    Basemap
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="overlay"
                    className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
                  >
                    Overlay
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  Overlays stack on top of the active basemap instead of replacing it — only available in Split/Radio basemap mode.
                </p>
              </div>
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
              <div className="flex justify-end gap-2">
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
