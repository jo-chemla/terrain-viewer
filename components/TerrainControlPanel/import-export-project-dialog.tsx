// Whole-project Import/Export — bundles BYOD sources, bookmarks, drawing
// layers and jotai config settings (lib/project-export.ts) into one
// downloadable JSON file, with a checkbox per category so the user can pick
// what travels. Default checked: Sources + Bookmarks (the two most people
// would want on a new browser/machine); default unchecked: Drawings
// (potentially large/personal sketches) and Settings (API keys/local
// toggles — mostly not something you want silently overwritten on import).
import type React from "react"
import { useCallback, useMemo, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import { Download, Upload, FolderSync } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { TooltipIconButton } from "./controls-components"
import { bookmarksAtom } from "@/lib/bookmarks"
import { drawingLayersAtom, drawingFeaturesAtom } from "./TerraDrawSystem"
import { customTerrainSourcesAtom, customBasemapSourcesAtom } from "@/lib/settings-atoms"
import {
  buildProjectExport, applyProjectImport, hasLocalFileSources,
  type ProjectExportSelection, type ProjectExportPayload,
} from "@/lib/project-export"

type Category = keyof ProjectExportSelection

const CATEGORY_ORDER: Category[] = ["sources", "bookmarks", "drawings", "settings"]
const DEFAULT_SELECTION: ProjectExportSelection = { sources: true, bookmarks: true, drawings: false, settings: false }

export function ImportExportProjectDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const [selection, setSelection] = useState<ProjectExportSelection>(DEFAULT_SELECTION)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const bookmarks = useAtomValue(bookmarksAtom)
  const drawingLayers = useAtomValue(drawingLayersAtom)
  const drawingFeatures = useAtomValue(drawingFeaturesAtom)
  const customTerrainSources = useAtomValue(customTerrainSourcesAtom)
  const customBasemapSources = useAtomValue(customBasemapSourcesAtom)

  const counts: Record<Category, string> = useMemo(() => ({
    sources: `${customTerrainSources.length} terrain, ${customBasemapSources.length} basemap`,
    bookmarks: `${bookmarks.length}`,
    drawings: `${drawingLayers.length} layer${drawingLayers.length === 1 ? "" : "s"}, ${drawingFeatures.length} feature${drawingFeatures.length === 1 ? "" : "s"}`,
    settings: "API keys, UI toggles, saved themes",
  }), [customTerrainSources, customBasemapSources, bookmarks, drawingLayers, drawingFeatures])

  const localFileWarning = hasLocalFileSources({ customTerrainSources, customBasemapSources })

  const toggle = (category: Category) => setSelection((prev) => ({ ...prev, [category]: !prev[category] }))

  const handleExport = useCallback(() => {
    const payload = buildProjectExport(selection, { bookmarks, drawingLayers, drawingFeatures })
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `terrain-viewer-project-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus("Exported.")
  }, [selection, bookmarks, drawingLayers, drawingFeatures])

  const handleImportFile = useCallback((file: File) => {
    setError(null)
    setStatus(null)
    file.text().then(async (text) => {
      let payload: ProjectExportPayload
      try {
        payload = JSON.parse(text)
      } catch {
        setError(`"${file.name}" isn't valid JSON.`)
        return
      }
      if (!payload || typeof payload !== "object" || !("version" in payload)) {
        setError(`"${file.name}" doesn't look like a project export.`)
        return
      }
      const importedLocalFiles = hasLocalFileSources(payload.sources)
      await applyProjectImport(payload)
      setStatus(
        importedLocalFiles
          ? "Imported — reloading… (some sources reference local files you'll need to re-select)"
          : "Imported — reloading…",
      )
      setTimeout(() => window.location.reload(), 600)
    })
  }, [])

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">Import/Export</Label>
        <DialogTrigger asChild>
          <TooltipIconButton icon={FolderSync} tooltip="Import / Export Project" />
        </DialogTrigger>
      </div>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
        <DialogHeader>
          <DialogTitle>Import / Export Project</DialogTitle>
          <DialogDescription>
            Move BYOD sources, bookmarks, drawings and settings to another browser or machine as a single JSON file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {CATEGORY_ORDER.map((category) => (
            <div key={category} className="flex items-start gap-2">
              <Checkbox
                id={`export-${category}`}
                checked={selection[category]}
                onCheckedChange={() => toggle(category)}
                className="mt-0.5 cursor-pointer"
              />
              <div className="min-w-0">
                <Label htmlFor={`export-${category}`} className="capitalize cursor-pointer">{category}</Label>
                <p className="text-xs text-muted-foreground">{counts[category]}</p>
              </div>
            </div>
          ))}
        </div>

        {selection.sources && localFileWarning && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            One or more sources reference a locally-picked file — only the source's settings travel with the export,
            not the file's bytes. Re-select the file after importing elsewhere.
          </p>
        )}

        {status && <p className="text-xs text-muted-foreground">{status}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) handleImportFile(f)
            }}
          />
          <Button variant="outline" size="sm" className="flex-1 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 cursor-pointer"
            disabled={!CATEGORY_ORDER.some((c) => selection[c])}
            onClick={handleExport}
          >
            <Download className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
