import type React from "react"
import { useState, useCallback, useRef } from "react"
import { useAtom } from "jotai"
import { Bookmark as BookmarkIcon, Trash2, Pencil, Maximize2, Upload, Download as DownloadIcon, ImageOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { MapRef } from "react-map-gl/maplibre"
import { Section, TooltipButton, TooltipIconButton } from "./controls-components"
import { bookmarksAtom, restoreBookmark, exportBookmarksJson, mergeImportedBookmarks, type Bookmark } from "@/lib/bookmarks"
import { captureBookmarkThumbnail } from "@/lib/controls-utils"
import { BookmarksGalleryModal } from "./bookmarks-gallery-modal"

// Saved-view bookmarks — see lib/bookmarks.ts for the data model/restore
// mechanism. This is the sidebar (1-column list) half of the feature;
// bookmarks-gallery-modal.tsx is the fullscreen (3-column) half, modeled
// after RiverREM_UI's Runs list / GalleryModal.
export const BookmarksSection: React.FC<{
  mapRef: React.RefObject<MapRef>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ mapRef, isOpen, onOpenChange }) => {
  const [bookmarks, setBookmarks] = useAtom(bookmarksAtom)
  const [isSaving, setIsSaving] = useState(false)
  const [isGalleryOpen, setIsGalleryOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const thumb = await captureBookmarkThumbnail(mapRef)
      const bookmark: Bookmark = {
        id: crypto.randomUUID(),
        name: new Date().toLocaleString(),
        ts: Date.now(),
        thumb,
        // Full nuqs state lives entirely in the query string already (every
        // viewport/viz-mode/option param) — this is the same string a shared
        // link would carry, just snapshotted for later instead of copied now.
        search: window.location.search.replace(/^\?/, ""),
      }
      setBookmarks([bookmark, ...bookmarks])
    } finally {
      setIsSaving(false)
    }
  }, [mapRef, bookmarks, setBookmarks])

  const handleDelete = useCallback((id: string) => {
    setBookmarks(bookmarks.filter((b) => b.id !== id))
  }, [bookmarks, setBookmarks])

  const handleRename = useCallback((id: string, name: string) => {
    setBookmarks(bookmarks.map((b) => (b.id === id ? { ...b, name } : b)))
  }, [bookmarks, setBookmarks])

  const commitRename = useCallback(() => {
    if (editId) handleRename(editId, editName)
    setEditId(null)
  }, [editId, editName, handleRename])

  const handleExport = useCallback(() => {
    const blob = new Blob([exportBookmarksJson(bookmarks)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `terrain-viewer-bookmarks-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [bookmarks])

  const handleImportFile = useCallback((file: File) => {
    file.text().then((text) => {
      try {
        const imported = JSON.parse(text)
        if (!Array.isArray(imported)) return
        setBookmarks(mergeImportedBookmarks(bookmarks, imported as Bookmark[]))
      } catch (e) {
        console.error("Failed to import bookmarks:", e)
      }
    })
  }, [bookmarks, setBookmarks])

  return (
    <Section title="Bookmarks" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <TooltipButton
            icon={BookmarkIcon}
            label={isSaving ? "Saving…" : "Save View"}
            tooltip="Save the current viewport and every visualization setting as a bookmark"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1"
          />
          <TooltipIconButton
            icon={Maximize2}
            tooltip="Open full gallery"
            onClick={() => setIsGalleryOpen(true)}
            variant="outline"
            disabled={bookmarks.length === 0}
          />
        </div>

        {bookmarks.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {bookmarks.map((b) => (
              <div key={b.id} className="flex items-center gap-2 min-w-0">
                <button
                  className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted cursor-pointer"
                  onClick={() => restoreBookmark(b)}
                  title="Load this view"
                >
                  {b.thumb ? (
                    <img src={b.thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageOff className="h-3.5 w-3.5" />
                    </div>
                  )}
                </button>
                {editId === b.id ? (
                  <Input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                      if (e.key === "Escape") setEditId(null)
                    }}
                    className="h-8 flex-1 min-w-0 text-sm"
                  />
                ) : (
                  <button className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => restoreBookmark(b)}>
                    <div className="text-sm truncate">{b.name}</div>
                    <div className="text-xs text-muted-foreground">{new Date(b.ts).toLocaleDateString()}</div>
                  </button>
                )}
                <TooltipIconButton
                  icon={Pencil}
                  tooltip="Rename"
                  onClick={() => { setEditId(b.id); setEditName(b.name) }}
                  className="h-8 w-8 shrink-0"
                />
                <TooltipIconButton
                  icon={Trash2}
                  tooltip="Delete"
                  onClick={() => handleDelete(b.id)}
                  className="h-8 w-8 shrink-0"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) handleImportFile(f)
            }}
          />
          <Button variant="outline" size="sm" className="flex-1 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Import
          </Button>
          <Button variant="outline" size="sm" className="flex-1 cursor-pointer" disabled={bookmarks.length === 0} onClick={handleExport}>
            <DownloadIcon className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
        </div>
      </div>

      <BookmarksGalleryModal
        open={isGalleryOpen}
        onClose={() => setIsGalleryOpen(false)}
        bookmarks={bookmarks}
        onDelete={handleDelete}
        onRename={handleRename}
      />
    </Section>
  )
}
