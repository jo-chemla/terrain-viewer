import type React from "react"
import { useMemo, useState } from "react"
import { X, Trash2, ImageOff, Pencil, Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import { restoreBookmark, type Bookmark } from "@/lib/bookmarks"

// Fullscreen 3-column gallery — the other half of bookmarks-section.tsx's
// sidebar list. Structurally modeled on RiverREM_UI's GalleryModal.tsx
// (github.com/Iconem/RiverREM_UI): dim overlay, centered card, a
// most-recent-first grid of thumbnail cards, click to load.
type Sort = "recent-desc" | "recent-asc" | "name"

export const BookmarksGalleryModal: React.FC<{
  open: boolean
  onClose: () => void
  bookmarks: Bookmark[]
  onDelete: (id: string) => void
  onRename?: (id: string, name: string) => void
}> = ({ open, onClose, bookmarks, onDelete, onRename }) => {
  const [sort, setSort] = useState<Sort>("recent-desc")
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")

  const sorted = useMemo(() => {
    const arr = [...bookmarks]
    if (sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name))
    else arr.sort((a, b) => (sort === "recent-asc" ? a.ts - b.ts : b.ts - a.ts))
    return arr
  }, [bookmarks, sort])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="text-base font-semibold tracking-tight">Bookmarks</div>
          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-7 rounded-md border bg-transparent px-2 text-xs cursor-pointer"
            >
              <option value="recent-desc">Most recent</option>
              <option value="recent-asc">Oldest first</option>
              <option value="name">Name (A-Z)</option>
            </select>
            <button
              onClick={onClose}
              aria-label="close"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookmarks yet — save your current view from the Bookmarks panel.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sorted.map((b) => (
                <div key={b.id} className="group overflow-hidden rounded-lg border text-left transition-colors hover:border-foreground/40">
                  <button className="relative block w-full cursor-pointer" onClick={() => restoreBookmark(b)}>
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
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { onRename?.(b.id, editName); setEditId(null) } if (e.key === "Escape") setEditId(null) }}
                        className="h-6 flex-1 min-w-0 text-xs"
                      />
                    ) : (
                      <button className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => restoreBookmark(b)}>
                        <div className="truncate text-xs font-medium">{b.name}</div>
                        <div className="text-[10px] text-muted-foreground">{new Date(b.ts).toLocaleDateString()}</div>
                      </button>
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
        </div>
      </div>
    </div>
  )
}
