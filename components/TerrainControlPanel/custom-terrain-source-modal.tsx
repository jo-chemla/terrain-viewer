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
  const [type, setType] = useState<"cog" | "terrainrgb" | "terrarium" | "vrt">("cog")
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
      setType("cog")
      setDescription("")
    }
  }, [editingSource, isOpen])

  const handleSave = useCallback(() => {
    if (!name || !url) return
    onSave({ id: editingSource?.id, name, url, type, description })
    onOpenChange(false)
  }, [name, url, type, description, editingSource, onSave, onOpenChange])

  const url_placeholder = type === "cog" ?
    "https://example.com/terrain-dtm.cog.tiff" :
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
              </SelectContent>
            </Select>
          </div>
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
