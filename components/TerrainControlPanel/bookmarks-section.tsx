import type React from "react"
import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useAtom } from "jotai"
import { v4 as uuidv4 } from "uuid"
import { Bookmark as BookmarkIcon, Trash2, Pencil, Maximize2, Upload, Download as DownloadIcon, ImageOff, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { MapRef } from "react-map-gl/maplibre"
import { Section, TooltipButton, TooltipIconButton } from "./controls-components"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsTruncated } from "@/hooks/use-is-truncated"
import {
  bookmarksAtom, activeBookmarkProjectIdAtom, activeBookmarkIdAtom, restoreBookmark, exportBookmarksJson,
  mergeImportedBookmarks, formatBookmarkDate, summarizeActiveVizModes, type Bookmark,
} from "@/lib/bookmarks"
import { bookmarksListHeightAtom } from "@/lib/settings-atoms"
import { reverseGeocodeLabel } from "@/lib/geocode"
import { captureBookmarkThumbnail } from "@/lib/controls-utils"
import { BookmarksGalleryModal } from "./bookmarks-gallery-modal"

const BookmarkRow: React.FC<{
  bookmark: Bookmark
  isChild: boolean
  isReferenceProject: boolean
  isActive: boolean
  editId: string | null
  editName: string
  isSaving: boolean
  onRestore: (b: Bookmark) => void
  onStartEdit: (b: Bookmark) => void
  onEditNameChange: (name: string) => void
  onCommitRename: () => void
  onCancelEdit: () => void
  onSaveChild: (id: string) => void
  onDelete: (id: string) => void
}> = ({
  bookmark: b, isChild, isReferenceProject, isActive, editId, editName, isSaving,
  onRestore, onStartEdit, onEditNameChange, onCommitRename, onCancelEdit, onSaveChild, onDelete,
}) => {
  const [nameRef, isNameTruncated] = useIsTruncated<HTMLDivElement>()

  const nameButton = (
    <button className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => onRestore(b)}>
      <div ref={nameRef} className="text-sm truncate">{b.name}</div>
      <div className="text-xs text-muted-foreground">{formatBookmarkDate(b.ts)}</div>
    </button>
  )

  return (
    <div
      className={cn(
        "flex items-center gap-2 min-w-0 rounded-md border border-transparent p-0.5",
        // Reference project (its own row, or the currently-loaded project when
        // a child is active) — the one whose viewport a sibling/child restore
        // won't disturb.
        isReferenceProject && "ring-1 ring-primary/50",
        // Exact bookmark last restored, project or child.
        isActive && "border-primary p-1.5",
        // Applied last so a child's indent always wins over the (all-sides)
        // padding bump above — twMerge lets a later, more specific side
        // utility (pl-4) override just that one side of an earlier shorthand.
        isChild && "pl-4",
      )}
    >
      <button
        className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted cursor-pointer"
        onClick={() => onRestore(b)}
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
          onChange={(e) => onEditNameChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            if (e.key === "Escape") onCancelEdit()
          }}
          className="h-8 flex-1 min-w-0 text-sm"
        />
      ) : isNameTruncated ? (
        <Tooltip>
          <TooltipTrigger render={nameButton} />
          <TooltipContent><p>{b.name}</p></TooltipContent>
        </Tooltip>
      ) : nameButton}
      {!isChild && (
        <TooltipIconButton
          icon={Plus}
          tooltip="Save current view as a child of this project"
          onClick={() => onSaveChild(b.id)}
          disabled={isSaving}
          className="h-8 w-8 shrink-0"
        />
      )}
      <TooltipIconButton
        icon={Pencil}
        tooltip="Rename"
        onClick={() => onStartEdit(b)}
        className="h-8 w-8 shrink-0"
      />
      <TooltipIconButton
        icon={Trash2}
        tooltip="Delete"
        onClick={() => onDelete(b.id)}
        className="h-8 w-8 shrink-0"
      />
    </div>
  )
}

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
// restored gets a solid border (+ a touch more padding).
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

  // Drag-to-resize the bookmark list's scroll area — same pointer-based
  // approach as theme-editor/ThemeEditorPanel.tsx's own resize handle, minus
  // the floating-panel positioning (this list sits in normal document flow,
  // so only its own height needs tracking, not screen position).
  const [listHeight, setListHeight] = useAtom(bookmarksListHeightAtom)
  const listRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ startY: number; origH: number } | null>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const rz = resizeRef.current
      if (!rz) return
      setListHeight(Math.min(Math.max(96, rz.origH + (e.clientY - rz.startY)), Math.round(window.innerHeight * 0.8)))
    }
    const onUp = () => { resizeRef.current = null }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [setListHeight])
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, origH: listRef.current?.offsetHeight ?? 256 }
  }

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
      // Full nuqs state lives entirely in the query string already (every
      // viewport/viz-mode/option param) — this is the same string a shared
      // link would carry, just snapshotted for later instead of copied now.
      const search = window.location.search.replace(/^\?/, "")
      const ts = Date.now()
      // crypto.randomUUID() throws on a non-secure context (plain HTTP, not
      // localhost) — this 'uuid' package version works everywhere, same
      // reasoning as TerraDrawSystem.tsx's own use of it.
      const makeId = () => uuidv4()

      if (parentId) {
        // Explicit child save (e.g. a project row's own "+" button) — a
        // shorthand of whichever viz modes are actually on, since that's
        // what distinguishes it from its siblings, not the (shared) viewport.
        const bookmark: Bookmark = { id: makeId(), name: summarizeActiveVizModes(state), ts, thumb, search, parentId }
        setBookmarks((prev) => [bookmark, ...prev])
        setActiveProjectId(parentId)
        setActiveBookmarkId(bookmark.id)
        return
      }

      // New project (root): reverse-geocode the viewport center into
      // "Country - Region/City" (falls back to a timestamp if the lookup
      // fails/times out). Immediately paired with one child capturing the
      // current viz-mode snapshot — a bare project row with no children
      // used to look like an empty shell until the user thought to add one
      // manually; every "Save View" now leaves a project with at least its
      // own state already represented as a child.
      const projectName = (await reverseGeocodeLabel(state.lat, state.lng)) ?? new Date().toLocaleString()
      const project: Bookmark = { id: makeId(), name: projectName, ts, thumb, search }
      const child: Bookmark = { id: makeId(), name: summarizeActiveVizModes(state), ts, thumb, search, parentId: project.id }
      setBookmarks((prev) => [project, child, ...prev])
      setActiveProjectId(project.id)
      setActiveBookmarkId(child.id)
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
    restoreBookmark(b, setState, activeProjectId, setActiveProjectId, setActiveBookmarkId, mapRef)
  }, [setState, activeProjectId, setActiveProjectId, setActiveBookmarkId, mapRef])

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
          <div>
            <div
              ref={listRef}
              className="space-y-1 overflow-y-auto"
              style={{ height: listHeight ?? 256 }}
            >
              {roots.map((project) => (
                <div key={project.id} className="space-y-1">
                  <BookmarkRow
                    bookmark={project}
                    isChild={false}
                    isReferenceProject={activeProjectId === project.id}
                    isActive={activeBookmarkId === project.id}
                    editId={editId}
                    editName={editName}
                    isSaving={isSaving}
                    onRestore={handleRestore}
                    onStartEdit={(bm) => { setEditId(bm.id); setEditName(bm.name) }}
                    onEditNameChange={setEditName}
                    onCommitRename={commitRename}
                    onCancelEdit={() => setEditId(null)}
                    onSaveChild={saveBookmark}
                    onDelete={handleDelete}
                  />
                  {childrenOf(project.id).map((child) => (
                    <BookmarkRow
                      key={child.id}
                      bookmark={child}
                      isChild
                      isReferenceProject={false}
                      isActive={activeBookmarkId === child.id}
                      editId={editId}
                      editName={editName}
                      isSaving={isSaving}
                      onRestore={handleRestore}
                      onStartEdit={(bm) => { setEditId(bm.id); setEditName(bm.name) }}
                      onEditNameChange={setEditName}
                      onCommitRename={commitRename}
                      onCancelEdit={() => setEditId(null)}
                      onSaveChild={saveBookmark}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div
              className="mx-auto mt-1 h-2 w-10 cursor-ns-resize touch-none rounded-full bg-border hover:bg-muted-foreground/50"
              onPointerDown={startResize}
              title="Drag to resize"
            />
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
        mapRef={mapRef}
        onDelete={handleDelete}
        onRename={handleRename}
      />
    </Section>
  )
}
