import type React from "react"
import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useAtom } from "jotai"
import { v4 as uuidv4 } from "uuid"
import {
  Bookmark as BookmarkIcon, Trash2, Pencil, Maximize2, Upload, Download as DownloadIcon, ImageOff, Plus, ChevronDown,
  ChevronsDownUp, ChevronsUpDown, Edit,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toggle } from "@/components/ui/toggle"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { MapRef } from "react-map-gl/maplibre"
import { Section, TooltipButton, TooltipIconButton } from "./controls-components"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsTruncated } from "@/hooks/use-is-truncated"
import {
  bookmarksAtom, activeBookmarkProjectIdAtom, activeBookmarkIdAtom, restoreBookmark, exportBookmarksJson,
  mergeImportedBookmarks, summarizeActiveVizModes, type Bookmark,
} from "@/lib/bookmarks"
import { bookmarksListHeightAtom, collapsedBookmarkGroupsAtom } from "@/lib/settings-atoms"
import { reverseGeocodeLabel } from "@/lib/geocode"
import { captureBookmarkThumbnail } from "@/lib/controls-utils"
import { BookmarksGalleryModal } from "./bookmarks-gallery-modal"
import { PRESET_BOOKMARKS, restorePreset } from "@/lib/preset-bookmarks"

// A single read-only "starter" viewpoint (see lib/preset-bookmarks.ts) — same
// thumbnail-left/name-right shape as a real BookmarkRow, minus every
// editing/dragging affordance, since these aren't part of the user's own
// bookmarksAtom list.
const PresetBookmarkRow: React.FC<{ preset: Bookmark; onRestore: (b: Bookmark) => void }> = ({ preset, onRestore }) => (
  <button
    onClick={() => onRestore(preset)}
    title={`Load "${preset.name}"`}
    className="flex items-center gap-2 min-w-0 rounded-md p-0.5 text-left cursor-pointer hover:bg-muted/50"
  >
    <span className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center text-muted-foreground">
      {preset.thumb ? <img src={preset.thumb} alt="" className="h-full w-full object-cover" /> : <ImageOff className="h-3.5 w-3.5" />}
    </span>
    <span className="flex-1 min-w-0 truncate text-sm">{preset.name}</span>
  </button>
)

const BookmarkRow: React.FC<{
  bookmark: Bookmark
  isChild: boolean
  isActive: boolean
  editMode: boolean
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
  onDragStartItem: (id: string) => void
  onDropOnItem: (id: string) => void
  canDropOn: (id: string) => boolean
  // Set on the last child of an expanded project while a sibling PROJECT is
  // being dragged over that project's block — see the per-project wrapper's
  // own drag handlers below. Shows the same bottom-edge bar this row already
  // renders for its own (child-child) drag-over, just for a different reason.
  forceShowDropIndicator?: boolean
}> = ({
  bookmark: b, isChild, isActive, editMode, editId, editName, isSaving,
  onRestore, onStartEdit, onEditNameChange, onCommitRename, onCancelEdit, onSaveChild, onDelete,
  onDragStartItem, onDropOnItem, canDropOn, forceShowDropIndicator,
}) => {
  const [nameRef, isNameTruncated] = useIsTruncated<HTMLDivElement>()
  const [isDragOver, setIsDragOver] = useState(false)

  const nameButton = (
    <button className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => onRestore(b)}>
      <div ref={nameRef} className="text-sm truncate">{b.name}</div>
    </button>
  )

  return (
    <div
      draggable
      onDragStart={() => onDragStartItem(b.id)}
      onDragOver={(e) => { if (!canDropOn(b.id)) return; e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { if (!canDropOn(b.id)) return; e.preventDefault(); setIsDragOver(false); onDropOnItem(b.id) }}
      className={cn(
        "relative flex items-center gap-1 min-w-0 rounded-md border-2 border-transparent p-0.5 cursor-grab active:cursor-grabbing",
        // Exact bookmark last restored, project or child.
        isActive && "border-primary p-1.5",
      )}
    >
      {/* Same width as BookmarkGroupHeader's collapse chevron button (+ the
          row's own gap-1) so a child's thumbnail lines up directly under its
          project's thumbnail instead of sitting further right or left of it. */}
      {isChild && <span className="h-8 w-6 shrink-0" />}
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
      {editMode && (
        <>
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
        </>
      )}
      {/* Insertion indicator — a highlighted bar just below the hovered row,
          rather than outlining/circling the row itself (that read as "this
          row is selected", not "drop here"). Same visual regardless of
          whether the drop will reorder or reparent the dragged item. */}
      {(isDragOver || forceShowDropIndicator) && (
        <div className="pointer-events-none absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-primary" />
      )}
    </div>
  )
}

// A project (root) row rendered as a foldable group header — the collapse
// chevron, its geocoded name/view-count (still the click target to restore
// that viewport), and the add-child/rename/delete actions. `showThumbnail`
// (see the caller — tied to this group's own collapse state) shows the first
// child's thumbnail as a stand-in preview only while collapsed; once
// expanded, its children (BookmarkRow, isChild) already show their own
// thumbnails right below it, so the header's copy would be redundant.
const BookmarkGroupHeader: React.FC<{
  bookmark: Bookmark
  childCount: number
  thumb: string | null
  showThumbnail: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  isActive: boolean
  editMode: boolean
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
  onDragStartItem: (id: string) => void
  // Drop-target handling for reordering PROJECTS lives on the shared wrapper
  // around this header + its children (see the per-project block in the
  // main render loop) rather than here — hovering anywhere in an expanded
  // project's block should count as hovering that whole project, not just
  // its header, and a plain sibling <div> can't express that on its own.
  // showDropIndicator is that wrapper's own isDragOver, computed only for
  // the case where this header is the right place to show it (collapsed, or
  // no children at all — see the caller).
  showDropIndicator: boolean
}> = ({
  bookmark: b, childCount, thumb, showThumbnail, isCollapsed, onToggleCollapse, isActive, editMode, editId, editName, isSaving,
  onRestore, onStartEdit, onEditNameChange, onCommitRename, onCancelEdit, onSaveChild, onDelete,
  onDragStartItem, showDropIndicator,
}) => {
  const [nameRef, isNameTruncated] = useIsTruncated<HTMLDivElement>()

  const nameButton = (
    <button className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => onRestore(b)}>
      <div ref={nameRef} className="text-sm font-medium truncate">{b.name}</div>
      <div className="text-xs text-muted-foreground">{childCount} view{childCount === 1 ? "" : "s"}</div>
    </button>
  )

  return (
    <div
      draggable
      onDragStart={() => onDragStartItem(b.id)}
      className={cn(
        "relative flex items-center gap-1 min-w-0 rounded-md border-2 border-transparent p-0.5 cursor-grab active:cursor-grabbing",
        isActive && "border-primary p-1.5",
      )}
    >
      <button
        onClick={onToggleCollapse}
        disabled={childCount === 0}
        className="flex h-8 w-6 shrink-0 items-center justify-center text-muted-foreground disabled:opacity-30 cursor-pointer"
        title={childCount === 0 ? "No child views yet" : isCollapsed ? "Expand" : "Collapse"}
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} />
      </button>
      {showThumbnail && (
        <button
          className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted cursor-pointer"
          onClick={() => onRestore(b)}
          title="Load this view"
        >
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-3.5 w-3.5" />
            </div>
          )}
        </button>
      )}
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
      <TooltipIconButton
        icon={Plus}
        tooltip="Save current view as a child of this project"
        onClick={() => onSaveChild(b.id)}
        disabled={isSaving}
        className="h-8 w-8 shrink-0"
      />
      {editMode && (
        <>
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
        </>
      )}
      {showDropIndicator && <div className="pointer-events-none absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-primary" />}
    </div>
  )
}

// Reorders (or reparents) bookmarks by dragging one onto another — `matches`
// picks out the sibling group both belong to (all roots, or all children of
// one particular parent); everything outside that group stays at its own
// array index untouched. Used both for a plain within-group reorder and,
// after reparenting a child (rewriting its parentId first), to also drop it
// at roughly the position it was dragged to rather than wherever the
// reparent left it.
function moveWithinGroup(list: Bookmark[], matches: (b: Bookmark) => boolean, fromId: string, toId: string): Bookmark[] {
  const indices: number[] = []
  list.forEach((item, i) => { if (matches(item)) indices.push(i) })
  const group = indices.map((i) => list[i])
  const fromPos = group.findIndex((b) => b.id === fromId)
  const toPos = group.findIndex((b) => b.id === toId)
  if (fromPos === -1 || toPos === -1 || fromPos === toPos) return list
  const reordered = [...group]
  const [moved] = reordered.splice(fromPos, 1)
  reordered.splice(toPos, 0, moved)
  const result = [...list]
  indices.forEach((idx, i) => { result[idx] = reordered[i] })
  return result
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
// camera alone (lib/bookmarks.ts's restoreBookmark) — whichever exact
// bookmark was last restored gets a solid border (+ a touch more padding).
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
  // Gates the rename/delete buttons on every row — same "Edit layer names…"
  // convention as TerraDrawSystem.tsx's own layers editMode toggle, so
  // day-to-day use (restore a view, add a new one) isn't cluttered by them.
  const [editMode, setEditMode] = useState(false)
  const [isFeaturedOpen, setIsFeaturedOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleRestorePreset = useCallback((preset: Bookmark) => {
    restorePreset(preset, setState, mapRef)
    setActiveBookmarkId(null)
    setActiveProjectId(null)
  }, [setState, mapRef, setActiveBookmarkId, setActiveProjectId])

  // Which project (root) rows currently have their children folded away —
  // see collapsedBookmarkGroupsAtom's own comment.
  const [collapsedGroups, setCollapsedGroups] = useAtom(collapsedBookmarkGroupsAtom)
  const toggleGroupCollapse = useCallback((id: string) => {
    setCollapsedGroups((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [setCollapsedGroups])

  // Plain HTML5 drag-and-drop, no library: a project dropped on another
  // project reorders the roots; a child dropped on a sibling reorders within
  // its own parent. Deliberately NOT cross-project (a child dropped on a
  // different project's header/children, or a project dropped on any child
  // row) — canDropOn below is what a dragged row's onDragOver checks before
  // even calling preventDefault, so those combinations never light up the
  // drop indicator and the browser's own "not allowed" cursor shows instead;
  // see moveWithinGroup above for the actual reorder.
  const draggedIdRef = useRef<string | null>(null)
  const handleDragStartItem = useCallback((id: string) => { draggedIdRef.current = id }, [])
  // Which project is the current drop target while dragging another project
  // over it — tracked here (not as local state inside the header row) since
  // hovering ANY of that project's children while it's expanded should also
  // count, and those live in sibling DOM nodes the header can't see into.
  // The per-project wrapper below sets/clears this; BookmarkGroupHeader only
  // renders the indicator itself when there's nowhere else to put it
  // (collapsed, or no children), otherwise the LAST child renders it instead.
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null)
  const canDropOn = useCallback((targetId: string): boolean => {
    const draggedId = draggedIdRef.current
    if (!draggedId || draggedId === targetId) return false
    const dragged = bookmarks.find((b) => b.id === draggedId)
    const target = bookmarks.find((b) => b.id === targetId)
    if (!dragged || !target) return false
    // Dragging a project — only another project header is a valid target.
    if (!dragged.parentId) return !target.parentId
    // Dragging a child — only a sibling under the same project is valid.
    return target.parentId === dragged.parentId
  }, [bookmarks])
  const handleDropOnItem = useCallback((targetId: string) => {
    const draggedId = draggedIdRef.current
    draggedIdRef.current = null
    if (!draggedId || draggedId === targetId) return
    setBookmarks((prev) => {
      const dragged = prev.find((b) => b.id === draggedId)
      const target = prev.find((b) => b.id === targetId)
      if (!dragged || !target) return prev
      if (!dragged.parentId) {
        if (target.parentId) return prev // guarded by canDropOn already; kept defensive
        return moveWithinGroup(prev, (b) => !b.parentId, draggedId, targetId)
      }
      if (target.parentId !== dragged.parentId) return prev // guarded by canDropOn already; kept defensive
      return moveWithinGroup(prev, (b) => b.parentId === dragged.parentId, draggedId, targetId)
    })
  }, [setBookmarks])

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

  // "Fold all" toggles based on whether every group with at least one child
  // is currently collapsed — so it always reads as a clean expand/collapse
  // pair instead of getting stuck once some groups are collapsed and others
  // aren't.
  const foldableRootIds = useMemo(() => roots.filter((r) => childrenOf(r.id).length > 0).map((r) => r.id), [roots, childrenOf])
  const allGroupsCollapsed = foldableRootIds.length > 0 && foldableRootIds.every((id) => collapsedGroups.includes(id))
  const handleToggleFoldAll = useCallback(() => {
    setCollapsedGroups(allGroupsCollapsed ? [] : foldableRootIds)
  }, [allGroupsCollapsed, foldableRootIds, setCollapsedGroups])

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

  // Deleting a project (parent) also deletes its view-mode children — only
  // an orphan whose parent bookmark is missing entirely (e.g. a partial
  // import) floats up to root instead of vanishing (see `roots` above).
  const handleDelete = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id && b.parentId !== id))
  }, [setBookmarks])

  const handleRename = useCallback((id: string, name: string) => {
    setBookmarks((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)))
  }, [setBookmarks])

  const commitRename = useCallback(() => {
    if (editId) handleRename(editId, editName)
    setEditId(null)
  }, [editId, editName, handleRename])

  const handleRestore = useCallback((b: Bookmark) => {
    // Clicking a project restores whatever its current first child (by
    // display order — the same one the header's own thumbnail shows, so
    // dragging a different child to the front changes both together)
    // represents, rather than the project's own frozen search snapshot —
    // that first child IS "the project's view" as far as the list shows it.
    // Falls back to the project itself if it has no children.
    const target = !b.parentId ? (childrenOf(b.id)[0] ?? b) : b
    restoreBookmark(target, setState, activeProjectId, setActiveProjectId, setActiveBookmarkId, mapRef)
  }, [setState, activeProjectId, setActiveProjectId, setActiveBookmarkId, mapRef, childrenOf])

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
          <TooltipButton
            icon={Maximize2}
            label="Gallery"
            tooltip="Open full gallery"
            onClick={() => setIsGalleryOpen(true)}
            disabled={bookmarks.length === 0}
            className="flex-1"
          />
          <TooltipIconButton
            icon={allGroupsCollapsed ? ChevronsUpDown : ChevronsDownUp}
            tooltip={allGroupsCollapsed ? "Expand all projects" : "Fold all projects"}
            onClick={handleToggleFoldAll}
            variant="outline"
            disabled={foldableRootIds.length === 0}
          />
          <Tooltip>
            <TooltipTrigger
              delay={0}
              render={
                <span>
                  <Toggle
                    pressed={editMode}
                    onPressedChange={setEditMode}
                    variant="outline"
                    aria-label={editMode ? "Done editing bookmarks" : "Rename or delete bookmarks"}
                    className="cursor-pointer"
                  >
                    <Edit className="h-4 w-4" />
                  </Toggle>
                </span>
              }
            />
            <TooltipContent><p>{editMode ? "Done editing" : "Rename or delete bookmarks"}</p></TooltipContent>
          </Tooltip>
        </div>

        <Collapsible open={isFeaturedOpen} onOpenChange={setIsFeaturedOpen}>
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger className="flex-1 min-w-0 text-left cursor-pointer">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Featured</span>
            </CollapsibleTrigger>
            <CollapsibleTrigger className="cursor-pointer">
              <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", isFeaturedOpen && "rotate-180")} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="space-y-0.5 pt-1">
            {PRESET_BOOKMARKS.map((preset) => (
              <PresetBookmarkRow key={preset.id} preset={preset} onRestore={handleRestorePreset} />
            ))}
          </CollapsibleContent>
        </Collapsible>

        {roots.length > 0 && (
          <div>
            <div
              ref={listRef}
              className="space-y-1 overflow-y-auto"
              style={{ height: listHeight ?? 256 }}
            >
              {roots.map((project) => {
                const children = childrenOf(project.id)
                const isCollapsed = collapsedGroups.includes(project.id)
                const isDragOverProject = dragOverProjectId === project.id
                return (
                  <div
                    key={project.id}
                    className="space-y-1"
                    // Reordering PROJECTS is scoped to this whole block (header
                    // + every visible child), not just the header row — a
                    // child's own onDragOver already rejects a dragged project
                    // (canDropOn) and returns without stopping propagation, so
                    // it bubbles up to here; this is what actually decides
                    // "hovering anywhere in project X's expanded group counts
                    // as hovering project X".
                    onDragOver={(e) => { if (!canDropOn(project.id)) return; e.preventDefault(); setDragOverProjectId(project.id) }}
                    onDragLeave={() => setDragOverProjectId((prev) => (prev === project.id ? null : prev))}
                    onDrop={(e) => {
                      if (!canDropOn(project.id)) return
                      e.preventDefault()
                      setDragOverProjectId(null)
                      handleDropOnItem(project.id)
                    }}
                  >
                    <BookmarkGroupHeader
                      bookmark={project}
                      childCount={children.length}
                      thumb={children[0]?.thumb ?? null}
                      showThumbnail={isCollapsed}
                      isCollapsed={isCollapsed}
                      onToggleCollapse={() => toggleGroupCollapse(project.id)}
                      isActive={activeBookmarkId === project.id}
                      editMode={editMode}
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
                      onDragStartItem={handleDragStartItem}
                      // Nothing to show below the header when it's collapsed
                      // or has no children — otherwise the last child (below)
                      // renders it instead, at the bottom of the open group.
                      showDropIndicator={isDragOverProject && (isCollapsed || children.length === 0)}
                    />
                    {!isCollapsed && children.map((child, childIndex) => (
                      <BookmarkRow
                        key={child.id}
                        bookmark={child}
                        isChild
                        isActive={activeBookmarkId === child.id}
                        editMode={editMode}
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
                        onDragStartItem={handleDragStartItem}
                        onDropOnItem={handleDropOnItem}
                        canDropOn={canDropOn}
                        forceShowDropIndicator={isDragOverProject && childIndex === children.length - 1}
                      />
                    ))}
                  </div>
                )
              })}
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
