import type React from "react"
import { useMemo, useState } from "react"
import { useAtom } from "jotai"
import { Trash2, ImageOff, Pencil, Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { restoreBookmark, activeBookmarkProjectIdAtom, activeBookmarkIdAtom, formatBookmarkDate, type Bookmark } from "@/lib/bookmarks"

// Fullscreen gallery — the other half of bookmarks-section.tsx's sidebar
// list. Built on the same Dialog primitives as settings-dialog.tsx (rather
// than a bespoke fixed-overlay div) so it matches the rest of the app's
// modal chrome: dialog surface, DialogClose ✕, header/description pattern.
type Sort = "recent-desc" | "recent-asc" | "name"

export const BookmarksGalleryModal: React.FC<{
  open: boolean
  onClose: () => void
  bookmarks: Bookmark[]
  setState: (updates: any) => void
  onDelete: (id: string) => void
  onRename?: (id: string, name: string) => void
}> = ({ open, onClose, bookmarks, setState, onDelete, onRename }) => {
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
    restoreBookmark(b, setState, activeProjectId, setActiveProjectId, setActiveBookmarkId)
    onClose()
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
              <div
                key={b.id}
                className={cn(
                  "group overflow-hidden rounded-lg border text-left transition-colors hover:border-foreground/40",
                  !b.parentId && activeProjectId === b.id && "ring-1 ring-primary/50",
                  activeBookmarkId === b.id && "border-2 border-primary p-1",
                )}
              >
                <button className="relative block w-full cursor-pointer" onClick={() => handleRestore(b)}>
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
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { onRename?.(b.id, editName); setEditId(null) } if (e.key === "Escape") setEditId(null) }}
                      className="h-6 flex-1 min-w-0 text-xs"
                    />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => handleRestore(b)}>
                          <div className="truncate text-xs font-medium">{b.name}</div>
                          <div className="text-[10px] text-muted-foreground">{formatBookmarkDate(b.ts)}</div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent><p>{b.name}</p></TooltipContent>
                    </Tooltip>
                  )}
                  {editId === b.id ? (
                    <button onClick={() => { onRename?.(b.id, editName); setEditId(null) }} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    onRename && (
                      <button onClick={() => { setEditId(b.id); setEditName(b.name) }} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
                        <Pencil className="h-3 w-3" />
                      </button>
                    )
                  )}
                  <button onClick={() => onDelete(b.id)} className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
