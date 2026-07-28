// Whole-project Import/Export — bundles BYOD sources, bookmarks, drawing
// layers, jotai config settings and the current view/viz-mode state
// (lib/project-export.ts) into one downloadable JSON file. Import is a
// plain file picker (whatever categories the file contains are applied
// as-is); Export opens a dialog with a checkbox per category so the user
// can pick what travels. Default checked: Sources + Bookmarks + View/Viz
// State (the three most people would want on a new browser/machine);
// default unchecked: Drawings (potentially large/personal sketches) and
// Settings (API keys/local toggles — mostly not something you want
// silently overwritten on import).
import type React from "react"
import { useCallback, useMemo, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import { Download, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { bookmarksAtom } from "@/lib/bookmarks"
import { drawingLayersAtom, drawingFeaturesAtom } from "./TerraDrawSystem"
import { customTerrainSourcesAtom, customBasemapSourcesAtom } from "@/lib/settings-atoms"
import {
  buildProjectExport, applyProjectImport, hasLocalFileSources,
  type ProjectExportSelection, type ProjectExportPayload,
} from "@/lib/project-export"

type Category = keyof ProjectExportSelection

const CATEGORY_ORDER: Category[] = ["sources", "bookmarks", "viewState", "drawings", "settings"]
const CATEGORY_LABELS: Record<Category, string> = {
  sources: "Sources", bookmarks: "Bookmarks", viewState: "View & Viz State", drawings: "Drawings", settings: "Settings",
}
const DEFAULT_SELECTION: ProjectExportSelection = { sources: true, bookmarks: true, viewState: true, drawings: false, settings: false }

export function ImportExportProjectDialog({ state, setState }: { state: Record<string, unknown>; setState: (updates: Record<string, unknown>) => void }) {
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [selection, setSelection] = useState<ProjectExportSelection>(DEFAULT_SELECTION)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const bookmarks = useAtomValue(bookmarksAtom)
  const drawingLayers = useAtomValue(drawingLayersAtom)
  const drawingFeatures = useAtomValue(drawingFeaturesAtom)
  const customTerrainSources = useAtomValue(customTerrainSourcesAtom)
  const customBasemapSources = useAtomValue(customBasemapSourcesAtom)

  const counts: Record<Category, string> = useMemo(() => ({
    sources: `${customTerrainSources.length} terrain, ${customBasemapSources.length} basemap`,
    bookmarks: `${bookmarks.length}`,
    viewState: "current viewport + visualization toggles",
    drawings: `${drawingLayers.length} layer${drawingLayers.length === 1 ? "" : "s"}, ${drawingFeatures.length} feature${drawingFeatures.length === 1 ? "" : "s"}`,
    settings: "API keys, UI toggles, saved themes",
  }), [customTerrainSources, customBasemapSources, bookmarks, drawingLayers, drawingFeatures])

  const localFileWarning = hasLocalFileSources({ customTerrainSources, customBasemapSources })

  const toggle = (category: Category) => setSelection((prev) => ({ ...prev, [category]: !prev[category] }))

  const handleExport = useCallback(() => {
    const payload = buildProjectExport(selection, { bookmarks, drawingLayers, drawingFeatures, viewState: state })
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `terrain-viewer-project-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus("Exported.")
  }, [selection, bookmarks, drawingLayers, drawingFeatures, state])

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
      // viewState lives in the URL (nuqs), not localStorage — applied through
      // the query-state setter so the URL carries it into the reload below,
      // instead of through applyProjectImport's raw-localStorage path.
      if (payload.viewState) setState(payload.viewState)
      setStatus(
        importedLocalFiles
          ? "Imported — reloading… (some sources reference local files you'll need to re-select)"
          : "Imported — reloading…",
      )
      setTimeout(() => window.location.reload(), 600)
    })
  }, [setState])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">Project</Label>
        <div className="flex rounded-md border overflow-hidden">
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) handleImportFile(f)
            }}
          />
          <Button variant="ghost" size="sm" className="rounded-none cursor-pointer" onClick={() => importInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Import
          </Button>
          <Dialog open={isExportOpen} onOpenChange={setIsExportOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="rounded-none border-l cursor-pointer">
                <Download className="h-3.5 w-3.5 mr-1" /> Export
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md" showCloseButton={false}>
              <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
              <DialogHeader>
                <DialogTitle>Export Project</DialogTitle>
                <DialogDescription>
                  Bundle BYOD sources, bookmarks, drawings, settings and/or the current view into one JSON file.
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
                      <Label htmlFor={`export-${category}`} className="cursor-pointer">{CATEGORY_LABELS[category]}</Label>
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

              <Button
                variant="outline"
                size="sm"
                className="w-full cursor-pointer"
                disabled={!CATEGORY_ORDER.some((c) => selection[c])}
                onClick={handleExport}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> Export
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {status && <p className="text-xs text-muted-foreground text-right">{status}</p>}
      {error && <p className="text-xs text-destructive text-right">{error}</p>}
    </div>
  )
}
