import type React from "react"
import { useState, useCallback, useRef, useMemo } from "react"
import { useAtom } from "jotai"
import { Bookmark as BookmarkIcon, Trash2, Pencil, Maximize2, Upload, Download as DownloadIcon, ImageOff, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { MapRef } from "react-map-gl/maplibre"
import { Section, TooltipButton, TooltipIconButton } from "./controls-components"
import {
  bookmarksAtom, activeBookmarkProjectIdAtom, activeBookmarkIdAtom, restoreBookmark, exportBookmarksJson,
  mergeImportedBookmarks, formatBookmarkDate, summarizeActiveVizModes, type Bookmark,
} from "@/lib/bookmarks"
import { reverseGeocodeLabel } from "@/lib/geocode"
import { captureBookmarkThumbnail } from "@/lib/controls-utils"
import { BookmarksGalleryModal } from "./bookmarks-gallery-modal"

// Saved-view bookmarks — see lib/bookmarks.ts for the data model/restore
// mechanism. This is the sidebar (1-column tree) half of the feature;
// bookmarks-gallery-modal.tsx is the fullscreen (grid) half, modeled after
// RiverREM_UI's Runs list / GalleryModal.
//
// Two kinds, a "project" (root, no parentId — a viewport + full state) and a
// "view mode child" (parentId set, saved at that same project's viewport) —
// rendered as a project row with its children indented beneath it. Restoring
// a child while its parent project is already the active one leaves the
// camera alone (lib/bookmarks.ts's restoreBookmark) — the active project row
// gets a ring so that's visible, and whichever exact bookmark was last
// restored gets a filled background.
export const BookmarksSection: React.FC<{
  state: any
  setState: (updates: any) => void
  mapRef: React.RefObject<MapRef>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, mapRef, isOpen, onOpenChange }) => {
  const [bookmarks, setBookmarks] = useAtom(bookmarksAtom)
  const [activeProjectId, setActiveProjectId] = useAtom(activeBookmarkProjectIdAtom)
  const [activeBookmarkId, setActiveBookmarkId] = useAtom(activeBookmarkIdAtom)
  const [isSaving, setIsSaving] = useState(false)
  const [isGalleryOpen, setIsGalleryOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const roots = useMemo(() => {
    const ids = new Set(bookmarks.map((b) => b.id))
    // A child whose parent was since deleted floats up to root level instead
    // of silently vanishing from the list.
    return bookmarks.filter((b) => !b.parentId || !ids.has(b.parentId))
  }, [bookmarks])
  const childrenOf = useCallback(
    (id: string) => bookmarks.filter((b) => b.parentId === id),
    [bookmarks],
  )

  const saveBookmark = useCallback(async (parentId?: string) => {
    setIsSaving(true)
    try {
      const thumb = await captureBookmarkThumbnail(mapRef)
      // Project (root): reverse-geocode the viewport center into "Country -
      // Region/City" (falls back to a timestamp if the lookup fails/times out).
      // Child: a shorthand of whichever viz modes are actually on — that's
      // what actually distinguishes it from its siblings, not the viewport
      // they all share.
      const name = parentId
        ? summarizeActiveVizModes(state)
        : (await reverseGeocodeLabel(state.lat, state.lng)) ?? new Date().toLocaleString()
      const bookmark: Bookmark = {
        id: crypto.randomUUID(),
        name,
        ts: Date.now(),
        thumb,
        // Full nuqs state lives entirely in the query string already (every
        // viewport/viz-mode/option param) — this is the same string a shared
        // link would carry, just snapshotted for later instead of copied now.
        search: window.location.search.replace(/^\?/, ""),
        ...(parentId ? { parentId } : {}),
      }
      setBookmarks((prev) => [bookmark, ...prev])
      setActiveProjectId(parentId ?? bookmark.id)
      setActiveBookmarkId(bookmark.id)
    } finally {
      setIsSaving(false)
    }
  }, [mapRef, state, setBookmarks, setActiveProjectId, setActiveBookmarkId])

  const handleDelete = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
  }, [setBookmarks])

  const handleRename = useCallback((id: string, name: string) => {
    setBookmarks((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)))
  }, [setBookmarks])

  const commitRename = useCallback(() => {
    if (editId) handleRename(editId, editName)
    setEditId(null)
  }, [editId, editName, handleRename])

  const handleRestore = useCallback((b: Bookmark) => {
    restoreBookmark(b, setState, activeProjectId, setActiveProjectId, setActiveBookmarkId)
  }, [setState, activeProjectId, setActiveProjectId, setActiveBookmarkId])

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
        setBookmarks((prev) => mergeImportedBookmarks(prev, imported as Bookmark[]))
      } catch (e) {
        console.error("Failed to import bookmarks:", e)
      }
    })
  }, [setBookmarks])

  const renderRow = (b: Bookmark, isChild: boolean) => (
    <div
      key={b.id}
      className={cn(
        "flex items-center gap-2 min-w-0 rounded-md p-0.5",
        isChild && "pl-4",
        // Reference project (its own row, or the currently-loaded project when
        // a child is active) — the one whose viewport a sibling/child restore
        // won't disturb.
        !isChild && activeProjectId === b.id && "ring-1 ring-primary/50",
        // Exact bookmark last restored, project or child.
        activeBookmarkId === b.id && "bg-accent/60",
      )}
    >
      <button
        className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted cursor-pointer"
        onClick={() => handleRestore(b)}
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
        <button className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => handleRestore(b)}>
          <div className="text-sm truncate">{b.name}</div>
          <div className="text-xs text-muted-foreground">{formatBookmarkDate(b.ts)}</div>
        </button>
      )}
      {!isChild && (
        <TooltipIconButton
          icon={Plus}
          tooltip="Save current view as a child of this project"
          onClick={() => saveBookmark(b.id)}
          disabled={isSaving}
          className="h-8 w-8 shrink-0"
        />
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
  )

  return (
    <Section title="Bookmarks" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <TooltipButton
            icon={BookmarkIcon}
            label={isSaving ? "Saving…" : "Save View"}
            tooltip="Save the current viewport and every visualization setting as a new project bookmark"
            onClick={() => saveBookmark()}
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

        {roots.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {roots.map((project) => (
              <div key={project.id} className="space-y-1">
                {renderRow(project, false)}
                {childrenOf(project.id).map((child) => renderRow(child, true))}
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
        setState={setState}
        onDelete={handleDelete}
        onRename={handleRename}
      />
    </Section>
  )
}
