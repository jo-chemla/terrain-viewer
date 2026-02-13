import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type CustomBasemapSource } from "@/lib/settings-atoms"

export const CustomBasemapModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomBasemapSource | null
  onSave: (source: Omit<CustomBasemapSource, "id"> & { id?: string }) => void
}> = ({ isOpen, onOpenChange, editingSource, onSave }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [type, setType] = useState<"cog" | "tms" | "wms" | "wmts">("tms")
  const [description, setDescription] = useState("")

  useEffect(() => {
    if (editingSource) {
      setName(editingSource.name)
      setUrl(editingSource.url)
      setType(editingSource.type)
      setDescription(editingSource.description || "")
    } else {
      setName("")
      setUrl("")
      setType("tms")
      setDescription("")
    }
  }, [editingSource, isOpen])

  const handleSave = useCallback(() => {
    if (!name || !url) return
    onSave({ id: editingSource?.id, name, url, type, description })
    onOpenChange(false)
  }, [name, url, type, description, editingSource, onSave, onOpenChange])

  const url_placeholder = type === "cog" ?
    "https://example.com/basemap.cog.tiff" :
    (type === "tms") ?
      "https://example.com/tms/{z}/{x}/{y}.png" :
      type === "wms" ?
        "http://tiles.example.com/wms?bbox={bbox-epsg-3857}&format=image/png&service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&width=256&height=256&layers=example" :
        "Not supported type"

  let helper_text = ""
  if (type === "tms") helper_text = '/{z}/{x}/{y}.png'
  else if (type === "wms") helper_text = 'bbox={bbox-epsg-3857}'
  
  const normalizeBboxParam = (input: string) => {
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
        <div className="space-y-4">
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
            <Label htmlFor="basemap-url">URL * {helper_text && `(hint: ${helper_text})`}</Label>
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
            <Label htmlFor="basemap-type">Type *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
              <SelectTrigger id="basemap-type" className="cursor-pointer w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tms">Raster (XYZ / TMS)</SelectItem>
                <SelectItem value="cog">COG (Cloud Optimized Geotiff)</SelectItem>
                <SelectItem value="wms">Raster (WMS / WMTS)</SelectItem>
              </SelectContent>
            </Select>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
