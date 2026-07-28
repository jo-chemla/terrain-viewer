// Saved-view bookmarks: a name + thumbnail + the full nuqs URL query string
// (viewport, every viz mode, every option) captured verbatim. Modeled after
// RiverREM_UI's Runs/GalleryModal (github.com/Iconem/RiverREM_UI) — same
// "sidebar list or fullscreen gallery, click a thumbnail to load" shape,
// adapted to this app's full-state-in-the-URL model instead of a server-side
// compute run.
//
// Two kinds, distinguished by `parentId`: a "project" (no parentId) is a
// viewport + full initial state; a "view mode child" (parentId set) is saved
// at that same project's viewport and only really differs in its
// visualization-mode settings. Restoring a child while its parent project is
// already the active one skips re-applying the (identical) viewport fields —
// see restoreBookmark.

import type React from "react"
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import type { MapRef } from "react-map-gl/maplibre"
import { QUERY_STATE_PARSERS } from "@/components/TerrainViewer"

export interface Bookmark {
  id: string
  name: string
  /** Epoch ms. */
  ts: number
  /** JPEG data URL (see captureBookmarkThumbnail) — kept deliberately
   *  moderate-res since these all live in localStorage, which has a small
   *  (~5-10MB) total quota shared with every other atomWithStorage in the app. */
  thumb: string | null
  /** Everything after "?" in the URL at save time — the full nuqs state. */
  search: string
  /** Id of the "project" bookmark this one is a view-mode child of. Absent
   *  for a project (root) bookmark itself. */
  parentId?: string
}

export const bookmarksAtom = atomWithStorage<Bookmark[]>("bookmarks", [], undefined, { getOnInit: true })

/** Id of the project bookmark whose viewport is considered "already applied" —
 *  set whenever a project (or one of its children) is restored. Deliberately
 *  not persisted: a fresh page load has no "currently selected project"
 *  context to preserve. */
export const activeBookmarkProjectIdAtom = atom<string | null>(null)

/** Id of the exact bookmark last restored (project OR child) — purely for
 *  highlighting "this is the one currently loaded" in the UI. Distinct from
 *  activeBookmarkProjectIdAtom above: that one always names the reference
 *  PROJECT (a child's own parentId), this one names whichever row was
 *  actually clicked. Also deliberately not persisted. */
export const activeBookmarkIdAtom = atom<string | null>(null)

/** Camera fields a "view mode child" bookmark shares verbatim with its parent
 *  project — skipped on restore when that project is already active, so the
 *  map doesn't visibly re-settle onto the exact spot it's already at. */
const VIEWPORT_KEYS = ["lat", "lng", "zoom", "pitch", "bearing"] as const

/** Parses a bookmark's saved query string back into typed state using the
 *  exact same nuqs parsers useQueryStates itself is built from (see
 *  components/TerrainViewer.tsx's QUERY_STATE_PARSERS) — every field parses
 *  through its own parser's `parseServerSide`, which already falls back to
 *  that field's real default when the key is missing or fails to parse. This
 *  is what makes an in-place restore safe for an older/shorter bookmark: a
 *  field absent from its search string resets to its default rather than
 *  lingering at whatever the current URL happens to have. */
function parseBookmarkSearch(search: string): Record<string, unknown> {
  const params = new URLSearchParams(search)
  const result: Record<string, unknown> = {}
  for (const [key, parser] of Object.entries(QUERY_STATE_PARSERS as Record<string, any>)) {
    const raw = parser.type === "multi" ? params.getAll(key) : (params.get(key) ?? undefined)
    result[key] = parser.parseServerSide(raw)
  }
  return result
}

/** Applies a bookmark's saved state in place via nuqs's own setState — no SPA
 *  reload, unlike the earlier version of this function. A child bookmark
 *  restored while its parent project is already active drops the viewport
 *  keys from the patch first (see VIEWPORT_KEYS) so the camera stays put.
 *
 *  setState alone is NOT enough to move the camera, though: TerrainViewer's
 *  <Map> only reads lat/lng/zoom/pitch/bearing once, as `initialViewState` —
 *  after mount the state fields are downstream of the map's own onMove
 *  handler (committed there on a debounce), not an input that drives it. The
 *  old page-reload version of this function got away with that because a
 *  reload remounts the map fresh against the just-updated URL; restoring in
 *  place has to explicitly ease the camera there itself instead. */
export function restoreBookmark(
  bookmark: Bookmark,
  setState: (updates: Record<string, unknown>) => void,
  activeProjectId: string | null,
  setActiveProjectId: (id: string | null) => void,
  setActiveBookmarkId: (id: string | null) => void,
  mapRef?: React.RefObject<MapRef>,
) {
  const patch = parseBookmarkSearch(bookmark.search)
  const isChildOfActiveProject = !!bookmark.parentId && bookmark.parentId === activeProjectId
  if (isChildOfActiveProject) {
    for (const key of VIEWPORT_KEYS) delete patch[key]
  } else {
    const map = mapRef?.current?.getMap()
    if (map) {
      // Split-screen's own onMove sync (TerrainViewer.tsx's onMoveA/onMoveB)
      // mirrors this onto the secondary map — no need to touch it here too.
      map.easeTo({
        center: [patch.lng as number, patch.lat as number],
        zoom: patch.zoom as number,
        bearing: patch.bearing as number,
        pitch: patch.pitch as number,
        duration: 800,
      })
    }
  }
  setState(patch)
  setActiveProjectId(bookmark.parentId ?? bookmark.id)
  setActiveBookmarkId(bookmark.id)
}

/** Master-flag + sub-flag pairs behind each visualization mode, in the same
 *  order they appear in the sidebar — used to build a shorthand default name
 *  for a "view mode child" bookmark (e.g. "SVF + Basemap"). A sub-mode only
 *  counts as active when both its own flag AND its section's master toggle
 *  are on, matching what's actually visible on the map. */
const VIZ_MODE_SHORTHANDS: Array<{ master: string; flag: string; label: string }> = [
  { master: "showRasterBasemap", flag: "showRasterBasemap", label: "Basemap" },
  { master: "showContoursAndGraticules", flag: "showContours", label: "Contours" },
  { master: "showContoursAndGraticules", flag: "showGraticules", label: "Graticule" },
  { master: "showHillshade", flag: "showHillshade", label: "Hillshade" },
  { master: "showColorRelief", flag: "showColorRelief", label: "Hypso" },
  { master: "showTerrainAnalysis", flag: "showSlope", label: "Slope" },
  { master: "showTerrainAnalysis", flag: "showAspect", label: "Aspect" },
  { master: "showTerrainAnalysis", flag: "showCurvature", label: "Curvature" },
  { master: "showTerrainAnalysis", flag: "showTpi", label: "TPI" },
  { master: "showTerrainAnalysis", flag: "showTri", label: "TRI" },
  { master: "showTerrainAnalysis", flag: "showRoughness", label: "Roughness" },
  { master: "showTerrainAnalysis", flag: "showBlobness", label: "Blobness" },
  { master: "showReliefVisualization", flag: "showLrm", label: "LRM" },
  { master: "showReliefVisualization", flag: "showSvf", label: "SVF" },
  { master: "showReliefVisualization", flag: "showOpenness", label: "Openness" },
  { master: "showReliefVisualization", flag: "showLocalDominance", label: "Local Dominance" },
  { master: "showLightingEffects", flag: "showMatcap", label: "Matcap" },
  { master: "showLightingEffects", flag: "showPhong", label: "Phong" },
  { master: "showTellsDetector", flag: "showTellsDetector", label: "Tells" },
  { master: "showPlaneSlicer", flag: "showPlaneSlicer", label: "Plane Slicer" },
]

/** Shorthand summary of whichever viz modes/submodes are actually on right
 *  now (e.g. "SVF + Basemap") — the default name for a "view mode child"
 *  bookmark, since what distinguishes it from its sibling children is
 *  exactly this, not the (shared) viewport. */
export function summarizeActiveVizModes(state: Record<string, unknown>): string {
  const active = VIZ_MODE_SHORTHANDS.filter((m) => state[m.master] && state[m.flag]).map((m) => m.label)
  return active.length ? active.join(" + ") : "No viz modes"
}

/** YYYY-MM-DD, local time — used everywhere a bookmark's save date is shown. */
export function formatBookmarkDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
