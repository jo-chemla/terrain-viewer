import type React from "react"
import { useMemo, useState } from "react"
import { useAtom } from "jotai"
import { Trash2, ImageOff, Pencil, Check } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsTruncated } from "@/hooks/use-is-truncated"
import { cn } from "@/lib/utils"
import { restoreBookmark, activeBookmarkProjectIdAtom, activeBookmarkIdAtom, formatBookmarkDate, type Bookmark } from "@/lib/bookmarks"

// Fullscreen gallery — the other half of bookmarks-section.tsx's sidebar
// list. Built on the same Dialog primitives as settings-dialog.tsx (rather
// than a bespoke fixed-overlay div) so it matches the rest of the app's
// modal chrome: dialog surface, DialogClose ✕, header/description pattern.
type Sort = "recent-desc" | "recent-asc" | "name"

const BookmarkCard: React.FC<{
  bookmark: Bookmark
  isReferenceProject: boolean
  isActive: boolean
  editId: string | null
  editName: string
  onRestore: (b: Bookmark) => void
  onEditNameChange: (name: string) => void
  onCommitRename: (id: string, name: string) => void
  onStartEdit: (b: Bookmark) => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
  onRename?: (id: string, name: string) => void
}> = ({
  bookmark: b, isReferenceProject, isActive, editId, editName,
  onRestore, onEditNameChange, onCommitRename, onStartEdit, onCancelEdit, onDelete, onRename,
}) => {
  const [nameRef, isNameTruncated] = useIsTruncated<HTMLDivElement>()

  const nameButton = (
    <button className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => onRestore(b)}>
      <div ref={nameRef} className="truncate text-xs font-medium">{b.name}</div>
      <div className="text-[10px] text-muted-foreground">{formatBookmarkDate(b.ts)}</div>
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
        {b.parentId && (
          <span className="absolute left-1.5 top-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground backdrop-blur-sm">
            child
          </span>
        )}
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
        ) : isNameTruncated ? (
          <Tooltip>
            <TooltipTrigger asChild>{nameButton}</TooltipTrigger>
            <TooltipContent><p>{b.name}</p></TooltipContent>
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
        <button onClick={() => onDelete(b.id)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
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

  const sorted = useMemo(() => {
    const arr = [...bookmarks]
    if (sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name))
    else arr.sort((a, b) => (sort === "recent-asc" ? a.ts - b.ts : b.ts - a.ts))
    return arr
  }, [bookmarks, sort])

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
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto" showCloseButton={false}>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
        <DialogHeader>
          <DialogTitle>Bookmarks</DialogTitle>
          <DialogDescription>Every saved view — click a thumbnail to load it.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end gap-2 -mt-2">
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger size="sm" className="w-[140px] cursor-pointer text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent-desc">Most recent</SelectItem>
              <SelectItem value="recent-asc">Oldest first</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bookmarks yet — save your current view from the Bookmarks panel.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sorted.map((b) => (
              <BookmarkCard
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
        )}
      </DialogContent>
    </Dialog>
  )
}
