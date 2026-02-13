import type React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { type CustomBasemapSource } from "@/lib/settings-atoms"
import saveAs from "file-saver"

export const BasemapBatchEditModal: React.FC<{
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  sources: CustomBasemapSource[]
  onSave: (sources: CustomBasemapSource[]) => void
}> = ({ isOpen, onOpenChange, sources, onSave }) => {
  const [json, setJson] = useState("")
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setJson(JSON.stringify(sources, null, 2))
      setError("")
    }
  }, [isOpen, sources])

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(json)
      if (!Array.isArray(parsed)) {
        setError("Input must be a valid JSON array")
        return
      }
      for (const source of parsed) {
        if (!source.id || !source.name || !source.url || !source.type) {
          setError("Each source must have id, name, url, and type fields")
          return
        }
      }
      onSave(parsed)
      onOpenChange(false)
    } catch (e) {
      setError("Invalid JSON: " + (e as Error).message)
    }
  }, [json, onSave, onOpenChange])

  const handleLoadFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      try {
        JSON.parse(content)
        setJson(content)
        setError("")
      } catch (err) {
        setError("Invalid JSON file: " + (err as Error).message)
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }, [])

  const handleExport = useCallback(() => {
    const blob = new Blob([json], { type: "application/json" })
    saveAs(blob, `basemap-sources-${Date.now()}.json`)
  }, [json])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Batch Edit Basemaps</DialogTitle>
          <DialogDescription>
            Edit all custom basemaps as JSON. Each source must have id, name, url, and type fields.
          </DialogDescription>
        </DialogHeader>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">
          ✕
        </DialogClose>
        <div className="space-y-4 overflow-y-auto px-1">
          <div className="space-y-2">
            <textarea
              className="w-full min-h-[400px] p-3 border rounded-md font-mono text-xs bg-background text-foreground resize-none outline-none focus:ring-2 focus:ring-ring"
              value={json}
              onChange={(e) => {
                setJson(e.target.value)
                setError("")
              }}
              spellCheck={false}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <div className="flex justify-between gap-2 flex-wrap">
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button variant="outline" onClick={handleLoadFile} className="cursor-pointer">
                <Download className="h-4 w-4 mr-2 rotate-180" />
                Load File
              </Button>
              <Button variant="outline" onClick={handleExport} className="cursor-pointer">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
                Cancel
              </Button>
              <Button onClick={handleSave} className="cursor-pointer">
                Validate & Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
