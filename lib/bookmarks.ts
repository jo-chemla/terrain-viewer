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
import type maplibregl from "maplibre-gl"
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

/** Pending "did the ease actually land" check per map instance — keyed so a
 *  second restore fired before the first one's check runs (rapid clicks
 *  through several bookmarks) cancels the stale check instead of it firing
 *  later and yanking the camera back toward an already-superseded target. */
const pendingEaseVerifyTimeouts = new WeakMap<maplibregl.Map, ReturnType<typeof setTimeout>>()

/** Pixel-space "is the camera basically at this target already" check — pixel
 *  distance (via `project`, which is inherently zoom-normalized) rather than
 *  a raw lng/lat delta, since a fixed degrees threshold would be meaninglessly
 *  loose at a low zoom and too strict at a high one. */
function isCameraNear(map: maplibregl.Map, target: { lng: number; lat: number; zoom: number }): boolean {
  const targetPx = map.project([target.lng, target.lat])
  const currentPx = map.project(map.getCenter())
  const pixelDistance = Math.hypot(targetPx.x - currentPx.x, targetPx.y - currentPx.y)
  return pixelDistance < 5 && Math.abs(map.getZoom() - target.zoom) < 0.05
}

/** Eases the camera to a bookmark/preset's saved viewport — an 800ms
 *  animated flight, MapLibre's usual "restore a saved view" feel. Verified
 *  this animation can, at least in principle, silently never actually
 *  progress at all: `easeTo` drives its transition off
 *  `requestAnimationFrame`, which a backgrounded/throttled tab or a heavy
 *  render tick can starve — the rest of a bookmark's settings still visibly
 *  apply (those don't depend on rAF) while the camera would then silently
 *  stay put. Rather than give up the animation over that edge case, this
 *  schedules a one-time check shortly after the ease should have finished
 *  and snaps straight to the target with `jumpTo` only if the camera didn't
 *  actually get there — invisible in the overwhelmingly common case where
 *  the ease worked fine, a safety net for the rest. */
export function easeToBookmarkViewport(
  map: maplibregl.Map,
  patch: Record<string, unknown>,
): void {
  const target = {
    lng: patch.lng as number,
    lat: patch.lat as number,
    zoom: patch.zoom as number,
    bearing: patch.bearing as number,
    pitch: patch.pitch as number,
  }
  map.easeTo({ center: [target.lng, target.lat], zoom: target.zoom, bearing: target.bearing, pitch: target.pitch, duration: 800 })
  const existing = pendingEaseVerifyTimeouts.get(map)
  if (existing) clearTimeout(existing)
  pendingEaseVerifyTimeouts.set(map, setTimeout(() => {
    pendingEaseVerifyTimeouts.delete(map)
    if (!isCameraNear(map, target)) {
      map.jumpTo({ center: [target.lng, target.lat], zoom: target.zoom, bearing: target.bearing, pitch: target.pitch })
    }
  }, 1000))
}

/** Parses a saved query string back into typed state using the exact same
 *  nuqs parsers useQueryStates itself is built from (see
 *  components/TerrainViewer.tsx's QUERY_STATE_PARSERS) — every field parses
 *  through its own parser's `parseServerSide`, which already falls back to
 *  that field's real default when the key is missing or fails to parse. This
 *  is what makes an in-place restore safe for an older/shorter search string: a
 *  field absent from it resets to its default rather than lingering at
 *  whatever the current URL happens to have.
 *
 *  Exported (not just used by restoreBookmark below) because
 *  lib/project-export.ts's "View & Viz State" import needs the exact same
 *  behavior — critically, feeding a *search string* through setState()
 *  (which only ever writes the fields that were actually present) rather
 *  than a fully-populated decoded object (which writes EVERY field
 *  explicitly, defeating nuqs's own default-omission and bloating the URL
 *  with dozens of otherwise-never-written keys like the per-mode
 *  colour-ramp custom-stops arrays — confirmed 2026-07-28 via a real "Max
 *  safe URL length exceeded" warning after a "View & Viz State" import). */
export function parseBookmarkSearch(search: string): Record<string, unknown> {
  const params = new URLSearchParams(search)
  const result: Record<string, unknown> = {}
  for (const [key, parser] of Object.entries(QUERY_STATE_PARSERS as Record<string, any>)) {
    const raw = parser.type === "multi" ? params.getAll(key) : (params.get(key) ?? undefined)
    result[key] = parser.parseServerSide(raw)
  }
  return result
}

/** Applies a bookmark's saved state in place via nuqs's own setState — no SPA
 *  reload, unlike the earlier version of this function. Always eases the
 *  camera to the bookmark's own saved viewport (see easeToBookmarkViewport)
 *  — setState alone is NOT enough to move it: TerrainViewer's <Map> only
 *  reads lat/lng/zoom/pitch/bearing once, as `initialViewState`, and after
 *  mount those state fields are downstream of the map's own onMove handler
 *  (committed there on a debounce), not an input that drives it. The old
 *  page-reload version of this function got away with that because a reload
 *  remounts the map fresh against the just-updated URL; restoring in place
 *  has to explicitly move the camera itself instead.
 *
 *  Restoring any bookmark from the same "family" (project or one of its
 *  children) as whichever one was active before is deliberately a no-op for
 *  the camera (on top of dropping the viewport keys from the STATE patch,
 *  see VIEWPORT_KEYS) — not just a child restored while its own parent
 *  project is active, but also the reverse (its parent restored while that
 *  child is active) and siblings restored after one another, since a
 *  project and all its children always share one viewport by construction:
 *  switching between them should read as "just the visualization changed,"
 *  not a camera move. activeProjectId already names "whichever project
 *  family was active" regardless of whether a project or one of its
 *  children was the exact bookmark last restored (see the setActiveProjectId
 *  call below), so comparing the newly selected bookmark's own family id
 *  (its parentId, or its own id if it has none) against it covers all three
 *  relationships in one check. */
export function restoreBookmark(
  bookmark: Bookmark,
  setState: (updates: Record<string, unknown>) => void,
  activeProjectId: string | null,
  setActiveProjectId: (id: string | null) => void,
  setActiveBookmarkId: (id: string | null) => void,
  mapRef?: React.RefObject<MapRef>,
) {
  const patch = parseBookmarkSearch(bookmark.search)
  const sameFamilyAsActive = activeProjectId !== null && (bookmark.parentId ?? bookmark.id) === activeProjectId
  if (sameFamilyAsActive) {
    for (const key of VIEWPORT_KEYS) delete patch[key]
  } else {
    const map = mapRef?.current?.getMap()
    // Split-screen's own onMove sync (TerrainViewer.tsx's onMoveA/onMoveB)
    // mirrors this onto the secondary map — no need to touch it here too.
    if (map) easeToBookmarkViewport(map, patch)
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
  { master: "showTerrainAnalysis", flag: "showShapeIndex", label: "Shape Index" },
  { master: "showTerrainAnalysis", flag: "showBlobness", label: "Blobness" },
  { master: "showTerrainAnalysis", flag: "showEigenRatio", label: "Eigen Ratio" },
  { master: "showTerrainAnalysis", flag: "showOrientation", label: "Orientation" },
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
