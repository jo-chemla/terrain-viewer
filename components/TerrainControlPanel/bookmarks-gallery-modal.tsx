import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom } from "jotai"
import { Trash2, ImageOff, Pencil, Check, List, LayoutGrid, Star } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useIsTruncated } from "@/hooks/use-is-truncated"
import { cn } from "@/lib/utils"
import { restoreBookmark, activeBookmarkProjectIdAtom, activeBookmarkIdAtom, type Bookmark } from "@/lib/bookmarks"
import { PRESET_BOOKMARKS, restorePreset } from "@/lib/preset-bookmarks"
import { galleryFlattenGroupsAtom, galleryShowFeaturedAtom, bookmarksGalleryViewModeAtom } from "@/lib/settings-atoms"

// Fullscreen gallery — the other half of bookmarks-section.tsx's sidebar
// list. Built on the same Dialog primitives as settings-dialog.tsx (rather
// than a bespoke fixed-overlay div) so it matches the rest of the app's
// modal chrome: dialog surface, DialogClose ✕, header/description pattern.
type Sort = "recent-desc" | "recent-asc" | "name"

// Shared by BookmarkCard (grid view) and BookmarkListRow (list view) — the
// two are interchangeable render targets for the exact same item data, so the
// caller can swap components without reshaping any props.
interface BookmarkItemProps {
  bookmark: Bookmark
  /** Flattened view only — the project this bookmark belongs to, display-only
   *  and never fed into rename (which always edits the bookmark's own real
   *  name). Rendered on its own (smaller, muted) line above the name rather
   *  than combined into one "Project — view" string, which ran long enough
   *  to truncate almost immediately at this card width. */
  parentName?: string
  isReferenceProject: boolean
  isActive: boolean
  editId: string | null
  editName: string
  onRestore: (b: Bookmark) => void
  onEditNameChange: (name: string) => void
  onCommitRename: (id: string, name: string) => void
  onStartEdit: (b: Bookmark) => void
  onCancelEdit: () => void
  onDelete?: (id: string) => void
  onRename?: (id: string, name: string) => void
}

const BookmarkCard: React.FC<BookmarkItemProps> = ({
  bookmark: b, parentName, isReferenceProject, isActive, editId, editName,
  onRestore, onEditNameChange, onCommitRename, onStartEdit, onCancelEdit, onDelete, onRename,
}) => {
  const [nameRef, isNameTruncated] = useIsTruncated<HTMLDivElement>()
  const [parentNameRef, isParentNameTruncated] = useIsTruncated<HTMLDivElement>()
  const isTruncated = isNameTruncated || isParentNameTruncated
  const label = parentName ? `${parentName} — ${b.name}` : b.name

  const nameButton = (
    <button className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => onRestore(b)}>
      {parentName && (
        <div ref={parentNameRef} className="truncate text-[10px] leading-tight text-muted-foreground">{parentName}</div>
      )}
      <div ref={nameRef} className="truncate text-xs font-medium leading-tight">{b.name}</div>
    </button>
  )

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-lg border text-left transition-colors hover:border-foreground/40",
        isReferenceProject && "ring-1 ring-primary/50",
        isActive && "border-2 border-primary p-1",
      )}
    >
      <button className="relative block w-full cursor-pointer" onClick={() => onRestore(b)}>
        <div className="aspect-[16/10] w-full bg-muted">
          {b.thumb ? (
            <img src={b.thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-5 w-5" />
            </div>
          )}
        </div>
      </button>
      <div className="flex items-center gap-1.5 px-2 py-2">
        {editId === b.id ? (
          <Input
            autoFocus
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onCommitRename(b.id, editName) } if (e.key === "Escape") onCancelEdit() }}
            className="h-6 flex-1 min-w-0 text-xs"
          />
        ) : isTruncated ? (
          <Tooltip>
            <TooltipTrigger render={nameButton} />
            <TooltipContent><p>{label}</p></TooltipContent>
          </Tooltip>
        ) : nameButton}
        {editId === b.id ? (
          <button onClick={() => onCommitRename(b.id, editName)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
            <Check className="h-3.5 w-3.5" />
          </button>
        ) : (
          onRename && (
            <button onClick={() => onStartEdit(b)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
              <Pencil className="h-3 w-3" />
            </button>
          )
        )}
        {onDelete && (
          <button onClick={() => onDelete(b.id)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// List-view counterpart of BookmarkCard — the same compact row shape as the
// sidebar's BookmarkRow (small thumbnail left, project + view name right),
// with the card's own rename/delete affordances kept inline at the row's end.
// Since children are named by summarizeActiveVizModes at save time, the name
// line doubles as the viz-mode summary.
const BookmarkListRow: React.FC<BookmarkItemProps> = ({
  bookmark: b, parentName, isReferenceProject, isActive, editId, editName,
  onRestore, onEditNameChange, onCommitRename, onStartEdit, onCancelEdit, onDelete, onRename,
}) => {
  const [nameRef, isNameTruncated] = useIsTruncated<HTMLDivElement>()
  const [parentNameRef, isParentNameTruncated] = useIsTruncated<HTMLDivElement>()
  const isTruncated = isNameTruncated || isParentNameTruncated
  const label = parentName ? `${parentName} — ${b.name}` : b.name

  const nameButton = (
    <button className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => onRestore(b)}>
      {parentName && (
        <div ref={parentNameRef} className="truncate text-[10px] leading-tight text-muted-foreground">{parentName}</div>
      )}
      <div ref={nameRef} className="truncate text-sm leading-tight">{b.name}</div>
    </button>
  )

  return (
    <div
      className={cn(
        "flex items-center gap-2 min-w-0 rounded-md border-2 border-transparent p-0.5 transition-colors hover:bg-muted/50",
        isReferenceProject && "ring-1 ring-primary/50",
        isActive && "border-primary p-1.5",
      )}
    >
      <button
        className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted cursor-pointer"
        onClick={() => onRestore(b)}
        aria-label="Load this view"
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
          onKeyDown={(e) => { if (e.key === "Enter") { onCommitRename(b.id, editName) } if (e.key === "Escape") onCancelEdit() }}
          className="h-7 flex-1 min-w-0 text-sm"
        />
      ) : isTruncated ? (
        <Tooltip>
          <TooltipTrigger render={nameButton} />
          <TooltipContent><p>{label}</p></TooltipContent>
        </Tooltip>
      ) : nameButton}
      {editId === b.id ? (
        <button onClick={() => onCommitRename(b.id, editName)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
          <Check className="h-3.5 w-3.5" />
        </button>
      ) : (
        onRename && (
          <button onClick={() => onStartEdit(b)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
            <Pencil className="h-3 w-3" />
          </button>
        )
      )}
      {onDelete && (
        <button onClick={() => onDelete(b.id)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export const BookmarksGalleryModal: React.FC<{
  open: boolean
  onClose: () => void
  bookmarks: Bookmark[]
  setState: (updates: any) => void
  mapRef: React.RefObject<MapRef>
  onDelete: (id: string) => void
  onRename?: (id: string, name: string) => void
}> = ({ open, onClose, bookmarks, setState, mapRef, onDelete, onRename }) => {
  const [sort, setSort] = useState<Sort>("recent-desc")
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [activeProjectId, setActiveProjectId] = useAtom(activeBookmarkProjectIdAtom)
  const [activeBookmarkId, setActiveBookmarkId] = useAtom(activeBookmarkIdAtom)
  const [flattenGroups, setFlattenGroups] = useAtom(galleryFlattenGroupsAtom)
  const [showFeatured, setShowFeatured] = useAtom(galleryShowFeaturedAtom)
  // Card grid vs compact rows — deliberately its OWN atom, not the sidebar's
  // bookmarksViewModeAtom (see settings-atoms.ts): different contexts,
  // independently remembered preferences.
  const [galleryView, setGalleryView] = useAtom(bookmarksGalleryViewModeAtom)
  // BookmarkCard and BookmarkListRow take the exact same props — the whole
  // grid/list switch is just which component each section maps items through,
  // plus the container class (3-col grid of cards vs a single stack of rows).
  const ItemComp = galleryView === "grid" ? BookmarkCard : BookmarkListRow
  const itemsContainerCls = galleryView === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-1"

  // Scroll-fade (same pattern as TerrainControlPanel.tsx's sidebar panel):
  // soften the top/bottom edges of the card grid with a mask gradient, only
  // on the edge that actually has more content past it.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ top: false, bottom: false })
  const FADE_PX = 40
  const updateFade = useCallback((el: HTMLElement | null) => {
    if (!el) return
    const top = el.scrollTop > 4
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4
    setFade((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }))
  }, [])
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => updateFade(e.currentTarget), [updateFade])
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !open) return
    updateFade(el)
    const ro = new ResizeObserver(() => updateFade(el))
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [updateFade, open, bookmarks, flattenGroups, showFeatured, galleryView])
  const scrollMask = `linear-gradient(to bottom, ${fade.top ? "transparent" : "#000"} 0, #000 ${FADE_PX}px, #000 calc(100% - ${FADE_PX}px), ${fade.bottom ? "transparent" : "#000"} 100%)`

  const handleRestorePreset = (preset: Bookmark) => {
    restorePreset(preset, setState, mapRef)
    setActiveBookmarkId(null)
    setActiveProjectId(null)
    onClose()
  }

  const compareBookmarks = useCallback((a: Bookmark, b: Bookmark) => {
    if (sort === "name") return a.name.localeCompare(b.name)
    return sort === "recent-asc" ? a.ts - b.ts : b.ts - a.ts
  }, [sort])

  // Groups children under their parent project without rendering the parent
  // itself as a card (it's just an organizational anchor, not a viewport
  // worth previewing separately — same reasoning as bookmarks-section.tsx's
  // BookmarkGroupHeader). A project with no children yet, or a child whose
  // parent was since deleted, has nothing to group under — it renders as its
  // own standalone card instead of silently vanishing.
  const groups = useMemo(() => {
    const byId = new Map(bookmarks.map((b) => [b.id, b]))
    const childrenByParent = new Map<string, Bookmark[]>()
    for (const b of bookmarks) {
      if (!b.parentId || !byId.has(b.parentId)) continue
      const siblings = childrenByParent.get(b.parentId) ?? []
      siblings.push(b)
      childrenByParent.set(b.parentId, siblings)
    }
    const result: { key: string; parent: Bookmark | null; items: Bookmark[] }[] = []
    for (const b of bookmarks) {
      if (b.parentId && byId.has(b.parentId)) continue // handled as a child below, via its parent
      const children = childrenByParent.get(b.id)
      result.push(
        children && children.length > 0
          ? { key: b.id, parent: b, items: [...children].sort(compareBookmarks) }
          : { key: b.id, parent: null, items: [b] },
      )
    }
    result.sort((g1, g2) => compareBookmarks(g1.parent ?? g1.items[0], g2.parent ?? g2.items[0]))
    return result
  }, [bookmarks, compareBookmarks])

  // Flattened view: same cards `groups` already resolved (so a childless
  // project or an orphaned child still shows up exactly once), just
  // re-sorted as one continuous list instead of per-group grids — that's
  // what actually removes the wasted row space a group of 1, or one that
  // isn't a multiple of 3, leaves behind. Each card's label gets its
  // project name prefixed back on since the grouping heading it would have
  // sat under is gone.
  const flatItems = useMemo(() => {
    const items = groups.flatMap((g) => g.items.map((b) => ({ bookmark: b, parentName: g.parent?.name })))
    return items.sort((a, z) => compareBookmarks(a.bookmark, z.bookmark))
  }, [groups, compareBookmarks])

  const handleRestore = (b: Bookmark) => {
    restoreBookmark(b, setState, activeProjectId, setActiveProjectId, setActiveBookmarkId, mapRef)
    onClose()
  }

  const commitRename = (id: string, name: string) => {
    onRename?.(id, name)
    setEditId(null)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="sm:max-w-5xl max-h-[85vh] flex flex-col gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        {/* Non-scrolling header block, a plain flex sibling above the
         *  independently-scrolling card grid below — deliberately NOT
         *  `position: sticky` inside the scroll container: that approach
         *  (tried first) put the header inside the same CSS Grid as the
         *  scrollable content, and negative margins used to bleed it to the
         *  container's padding edges don't interact cleanly with grid track
         *  sizing — the header ended up short of the true scroll top, so a
         *  sliver of the card grid stayed visible above it while scrolling.
         *  A separate fixed-height flex child sidesteps that entirely. */}
        <div className="shrink-0 border-b px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <DialogHeader className="gap-0.5">
              <DialogTitle>Bookmarks</DialogTitle>
              <DialogDescription>Every saved view — click a thumbnail to load it.</DialogDescription>
            </DialogHeader>

            {/* DialogClose lives IN this row (not absolutely positioned
             *  outside it) so it shares the row's single `items-center` rule
             *  with the controls next to it — two independent alignment
             *  mechanisms (absolute top-4 vs. flex items-center against a
             *  taller title block) only approximately lined up in practice. */}
            <div className="flex shrink-0 items-center gap-3">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="gallery-show-featured" className="text-xs text-muted-foreground cursor-pointer">Featured</Label>
                      <Switch id="gallery-show-featured" checked={showFeatured} onCheckedChange={setShowFeatured} className="cursor-pointer" />
                    </div>
                  }
                />
                <TooltipContent>
                  <p>{showFeatured
                    ? "Curated example viewpoints shown at the top, above your own bookmarks"
                    : "Hide the curated examples — only your own bookmarks"}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="gallery-flatten" className="text-xs text-muted-foreground cursor-pointer">Flatten</Label>
                      <Switch id="gallery-flatten" checked={flattenGroups} onCheckedChange={setFlattenGroups} className="cursor-pointer" />
                    </div>
                  }
                />
                <TooltipContent>
                  <p>{flattenGroups
                    ? "One continuous grid — no per-project row breaks or leftover empty slots"
                    : "Grouped by project, one grid per group"}</p>
                </TooltipContent>
              </Tooltip>
              {/* Same icon-button-group pattern as the sidebar's list/grid
                  selector (bookmarks-section.tsx) — h-8 to sit flush with the
                  size="sm" SelectTrigger next to it. */}
              <div className="inline-flex h-8 shrink-0 overflow-hidden rounded-md border">
                {([
                  ["list", List, "List view — compact rows, thumbnail beside each name"],
                  ["grid", LayoutGrid, "Grid view — thumbnail cards"],
                ] as const).map(([v, Icon, tip]) => (
                  <Tooltip key={v}>
                    <TooltipTrigger
                      delay={0}
                      render={
                        <button
                          onClick={() => setGalleryView(v)}
                          aria-label={tip}
                          className={cn(
                            "px-2 cursor-pointer transition-colors",
                            galleryView === v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                    <TooltipContent><p>{tip}</p></TooltipContent>
                  </Tooltip>
                ))}
              </div>
              <Select
                value={sort}
                onValueChange={(v) => setSort(v as Sort)}
                items={{ "recent-desc": "Most recent", "recent-asc": "Oldest first", name: "Name (A-Z)" }}
              >
                <SelectTrigger size="sm" className="w-[140px] cursor-pointer text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent-desc">Most recent</SelectItem>
                  <SelectItem value="recent-asc">Oldest first</SelectItem>
                  <SelectItem value="name">Name (A-Z)</SelectItem>
                </SelectContent>
              </Select>
              <DialogClose className="ml-1 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
          style={{ maskImage: scrollMask, WebkitMaskImage: scrollMask }}
        >
        <div className="space-y-4">
        {showFeatured && (
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Star className="h-3 w-3 shrink-0" />
              Featured
            </h3>
            <div className={itemsContainerCls}>
              {PRESET_BOOKMARKS.map((preset) => (
                <ItemComp
                  key={preset.id}
                  bookmark={preset}
                  isReferenceProject={false}
                  isActive={false}
                  editId={null}
                  editName=""
                  onRestore={handleRestorePreset}
                  onEditNameChange={() => {}}
                  onCommitRename={() => {}}
                  onStartEdit={() => {}}
                  onCancelEdit={() => {}}
                />
              ))}
            </div>
          </div>
        )}
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bookmarks yet — save your current view from the Bookmarks panel.</p>
        ) : flattenGroups ? (
          <div className={itemsContainerCls}>
            {flatItems.map(({ bookmark: b, parentName }) => (
              <ItemComp
                key={b.id}
                bookmark={b}
                parentName={parentName}
                isReferenceProject={!b.parentId && activeProjectId === b.id}
                isActive={activeBookmarkId === b.id}
                editId={editId}
                editName={editName}
                onRestore={handleRestore}
                onEditNameChange={setEditName}
                onCommitRename={commitRename}
                onStartEdit={(bm) => { setEditId(bm.id); setEditName(bm.name) }}
                onCancelEdit={() => setEditId(null)}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.key}>
                {group.parent && (
                  <h3 className="mb-1.5 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.parent.name}
                  </h3>
                )}
                <div className={itemsContainerCls}>
                  {group.items.map((b) => (
                    <ItemComp
                      key={b.id}
                      bookmark={b}
                      isReferenceProject={!b.parentId && activeProjectId === b.id}
                      isActive={activeBookmarkId === b.id}
                      editId={editId}
                      editName={editName}
                      onRestore={handleRestore}
                      onEditNameChange={setEditName}
                      onCommitRename={commitRename}
                      onStartEdit={(bm) => { setEditId(bm.id); setEditName(bm.name) }}
                      onCancelEdit={() => setEditId(null)}
                      onDelete={onDelete}
                      onRename={onRename}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
