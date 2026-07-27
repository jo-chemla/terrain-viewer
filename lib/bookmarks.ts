// Saved-view bookmarks: a name + thumbnail + the full nuqs URL query string
// (viewport, every viz mode, every option) captured verbatim — restoring one
// is just navigating to `pathname + search`, so nuqs re-hydrates the ENTIRE
// state from scratch exactly the way a shared link already does, with no
// separate "reset every field first" bookkeeping needed. Modeled after
// RiverREM_UI's Runs/GalleryModal (github.com/Iconem/RiverREM_UI) — same
// "sidebar list or fullscreen gallery, click a thumbnail to load" shape,
// adapted to this app's full-state-in-the-URL model instead of a server-side
// compute run.
//
// Flat list for now — the "viewport bookmark with viz-mode bookmarks nested
// under it" hierarchy the feature was requested with is a natural follow-up
// (group by a shared `parentId`), not implemented yet.

import { atomWithStorage } from "jotai/utils"

export interface Bookmark {
  id: string
  name: string
  /** Epoch ms. */
  ts: number
  /** Small JPEG data URL (see captureBookmarkThumbnail) — kept deliberately
   *  low-res since these all live in localStorage, which has a small (~5-10MB)
   *  total quota shared with every other atomWithStorage in the app. */
  thumb: string | null
  /** Everything after "?" in the URL at save time — the full nuqs state. */
  search: string
}

export const bookmarksAtom = atomWithStorage<Bookmark[]>("bookmarks", [], undefined, { getOnInit: true })

/** Navigates to a bookmark's saved state — a real navigation (not an in-place
 *  nuqs setState), so every param re-hydrates from scratch, including ones
 *  that have since drifted from their default and aren't present in the
 *  bookmark's own (possibly older/shorter) query string. Same "apply on load"
 *  approach the ?project= preset mechanism already uses in TerrainViewer.tsx. */
export function restoreBookmark(bookmark: Bookmark) {
  window.location.href = `${window.location.pathname}?${bookmark.search}`
}

export function exportBookmarksJson(bookmarks: Bookmark[]): string {
  return JSON.stringify(bookmarks, null, 2)
}

/** Merges imported bookmarks by id — an import that includes a bookmark
 *  already present (e.g. re-importing a previously-exported file) updates it
 *  in place instead of duplicating it. */
export function mergeImportedBookmarks(existing: Bookmark[], imported: Bookmark[]): Bookmark[] {
  const byId = new Map(existing.map((b) => [b.id, b]))
  for (const b of imported) byId.set(b.id, b)
  return Array.from(byId.values()).sort((a, b) => b.ts - a.ts)
}
