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
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { bookmarksAtom, parseBookmarkSearch } from "@/lib/bookmarks"
import { drawingLayersAtom, drawingFeaturesAtom } from "./TerraDrawSystem"
import { customTerrainSourcesAtom, customBasemapSourcesAtom } from "@/lib/settings-atoms"
import {
  buildProjectExportArchive, applyProjectImport, hasLocalFileSources, parseProjectExportArchive,
  type ProjectExportSelection,
} from "@/lib/project-export"

// "localCogs" and "bookmarkThumbsInZip" are modifiers of the Sources/
// Bookmarks categories (each rendered as its own nested checkbox below, only
// when relevant) rather than top-level categories — excluded from
// CATEGORY_ORDER so neither gets its own row in the main list or counts
// toward "at least one category checked".
type Category = Exclude<keyof ProjectExportSelection, "localCogs" | "bookmarkThumbsInZip">

const CATEGORY_ORDER: Category[] = ["viewState", "sources", "bookmarks", "drawings", "settings"]
const CATEGORY_LABELS: Record<Category, string> = {
  sources: "Sources", bookmarks: "Bookmarks", viewState: "View & Viz State", drawings: "Drawings", settings: "Settings",
}
const DEFAULT_SELECTION: ProjectExportSelection = {
  sources: true, bookmarks: true, viewState: true, drawings: false, settings: false, localCogs: false, bookmarkThumbsInZip: false,
}

// Zip files start with a "PK" local-file-header signature — cheap way to
// tell a .zip archive (project.json + optional .cog.tiff blobs) apart from
// a plain-JSON export without trusting the file's extension.
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

export function ImportExportProjectDialog({ setState }: { setState: (updates: Record<string, unknown>) => void }) {
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
  const hasBookmarkThumbs = bookmarks.some((b) => b.thumb)

  const toggle = (category: keyof ProjectExportSelection) => setSelection((prev) => ({ ...prev, [category]: !prev[category] }))

  const handleExport = useCallback(async () => {
    // The raw query string, not the decoded state object — see
    // ProjectExportPayload.viewState's own comment for why: replaying a
    // fully-populated object through setState on import writes every field
    // explicitly, defeating nuqs's default-omission and blowing well past
    // the URL length limit.
    const viewState = window.location.search.replace(/^\?/, "")
    const archive = await buildProjectExportArchive(selection, { bookmarks, drawingLayers, drawingFeatures, viewState })
    // `as BlobPart` — TS's DOM lib type for Blob's constructor wants a
    // Uint8Array<ArrayBuffer> specifically, but fflate's zipSync returns the
    // wider Uint8Array<ArrayBufferLike>; a plain Uint8Array is accepted by
    // Blob at runtime regardless, this is purely a type-level mismatch.
    const blob = new Blob([archive.bytes as BlobPart], { type: archive.isZip ? "application/zip" : "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `terrain-viewer-project-${Date.now()}.${archive.isZip ? "zip" : "json"}`
    a.click()
    URL.revokeObjectURL(url)
    setStatus(
      archive.missingCogIds.length
        ? `Exported (${archive.missingCogIds.length} local file${archive.missingCogIds.length === 1 ? "" : "s"} couldn't be bundled — never persisted, evicted, or too large for this browser's storage; check the console for which).`
        : "Exported.",
    )
  }, [selection, bookmarks, drawingLayers, drawingFeatures])

  const handleImportFile = useCallback((file: File) => {
    setError(null)
    setStatus(null)
    file.arrayBuffer().then(async (buf) => {
      const bytes = new Uint8Array(buf)
      let payload
      let cogBytesById
      let bookmarkThumbBytesById
      try {
        ({ payload, cogBytesById, bookmarkThumbBytesById } = parseProjectExportArchive(bytes, looksLikeZip(bytes)))
      } catch {
        setError(`"${file.name}" isn't a valid project export.`)
        return
      }
      if (!payload || typeof payload !== "object" || !("version" in payload)) {
        setError(`"${file.name}" doesn't look like a project export.`)
        return
      }
      const { failedCogIds } = await applyProjectImport(payload, cogBytesById, bookmarkThumbBytesById)
      // Nothing bundled at all (plain export, or localCogs was left
      // unchecked at export time) — the pre-existing generic warning still
      // applies. A more specific one below covers bytes that WERE bundled
      // but failed to persist on THIS machine (e.g. OPFS quota).
      const nothingBundled = hasLocalFileSources(payload.sources) && cogBytesById.size === 0
      // viewState is a raw query string (same convention as a Bookmark's own
      // `search` field) — parseBookmarkSearch decodes it through the exact
      // same nuqs parsers useQueryStates itself uses, so only fields it
      // actually contained get written; setState then carries that into the
      // URL ahead of the reload below (not localStorage).
      if (payload.viewState) setState(parseBookmarkSearch(payload.viewState))
      setStatus(
        failedCogIds.length
          ? `Imported — reloading… (${failedCogIds.length} local file${failedCogIds.length === 1 ? "" : "s"} failed to persist here — likely too large for this browser's storage; you'll need to re-select ${failedCogIds.length === 1 ? "it" : "them"})`
          : nothingBundled
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
        <div className="flex rounded-md border overflow-hidden w-[140px]">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.zip"
            className="hidden"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) handleImportFile(f)
            }}
          />
          <Button variant="ghost" size="sm" className="flex-1 rounded-none cursor-pointer" onClick={() => importInputRef.current?.click()}>
            Import
          </Button>
          <Dialog open={isExportOpen} onOpenChange={setIsExportOpen}>
            <DialogTrigger
              render={
                <Button variant="ghost" size="sm" className="flex-1 rounded-none border-l cursor-pointer">
                  Export
                </Button>
              }
            />
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
                  <div key={category}>
                    <div className="flex items-start gap-2">
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

                    {category === "sources" && selection.sources && localFileWarning && (
                      <div className="mt-2 space-y-2 pl-6">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="export-localCogs"
                            checked={selection.localCogs}
                            onCheckedChange={() => toggle("localCogs")}
                            className="mt-0.5 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <Label htmlFor="export-localCogs" className="cursor-pointer">Include local COG files</Label>
                            <p className="text-xs text-muted-foreground">Bundles each local file's raw bytes as a .zip — larger download, but re-importable elsewhere without re-selecting files.</p>
                          </div>
                        </div>
                        {!selection.localCogs && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            One or more sources reference a locally-picked file — only the source's settings travel unless you check the
                            box above; otherwise you'll need to re-select the file after importing elsewhere.
                          </p>
                        )}
                      </div>
                    )}

                    {category === "bookmarks" && selection.bookmarks && hasBookmarkThumbs && !selection.localCogs && (
                      <div className="mt-2 space-y-2 pl-6">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id="export-bookmarkThumbsInZip"
                            checked={selection.bookmarkThumbsInZip}
                            onCheckedChange={() => toggle("bookmarkThumbsInZip")}
                            className="mt-0.5 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <Label htmlFor="export-bookmarkThumbsInZip" className="cursor-pointer">Bookmark thumbnails as a .zip</Label>
                            <p className="text-xs text-muted-foreground">
                              {selection.bookmarkThumbsInZip
                                ? "Thumbnails travel as separate files in a bookmarks_thumbs/ folder instead of inlined base64."
                                : "Thumbnails stay inlined as base64 in project.json — check this to externalize them into a .zip instead."}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

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
