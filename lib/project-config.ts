// Named "project" presets for embedding — a project config bundles a curated
// initial view (camera, sources, viz options), which sections are visible/open,
// and which view modes are selectable, so an embedder can link to `?project=foo`
// instead of hand-assembling dozens of individual query params.

import projectsData from "./projects.json"
// Type-only — erased at compile time, so this doesn't create a real circular
// runtime dependency with settings-atoms.ts (which imports ProjectConfig from here).
import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"

export type ProjectViewMode = "2d" | "globe" | "3d"

export interface ProjectConfig {
  id: string
  name: string
  description?: string
  /** View modes to hide from the View Mode toggle. Defaults to none (all of
   *  2d/globe/3d available), matching current behavior for non-project sessions. */
  disableViewModes?: ProjectViewMode[]
  /** View mode applied on load if the URL doesn't already specify one. Renamed from
   *  the earlier draft's `initial` — this only sets viewMode, not the rest of state. */
  initialViewMode?: ProjectViewMode
  /** Hides the terrain/basemap source-picker sections (TerrainSourceSection,
   *  RasterBasemapSection) — for embeds that pin a single source via
   *  terrainUrl/basemapUrl and don't want visitors switching it. */
  hideSourcePanels?: boolean
  /** Partial overrides applied to the shared nuqs state bag (TerrainViewer's
   *  useQueryStates) on first load — any key from that bag: lat/lng/zoom/pitch/
   *  bearing, opacity sliders, colorRamp, theme, sourceA/basemapSource, etc.
   *  Only fills in keys the URL doesn't already specify explicitly. */
  initialState?: Record<string, unknown>
  /** Partial overrides for the sidebar's per-section expanded/collapsed state
   *  (jotai sectionOpenAtom) on first load — keys match TerrainControlPanel's
   *  SectionKey (e.g. "general", "terrainSource", "hillshade", ...). */
  initialSections?: Record<string, boolean>
  /** Whether the whole sidebar (isSidebarOpenAtom) starts open or closed — for
   *  embeds that want a clean, panel-free view by default. Visitors can still
   *  reopen it via the collapse/expand toggle; this only sets the first-load state. */
  initialSidebarOpen?: boolean
  /** Map controls to omit entirely (not just visually hide) — "zoom" is MapLibre's
   *  NavigationControl (zoom + rotate buttons). For embeds that want a minimal,
   *  chrome-free map. Defaults to showing all of them. */
  hideMapControls?: Array<"geocoder" | "zoom" | "geolocate" | "minimap" | "scale">
  /** Sidebar accordion sections to hide entirely — keys match TerrainControlPanel's
   *  SectionKey (e.g. "contour", "background", "drawing", ...). Distinct from
   *  hideSourcePanels (which only covers terrainSource/rasterBasemap): for "contour"
   *  specifically, this also hides the "Contours + GeoGrid" checkbox row in
   *  VisualizationModesSection, since that's the same feature exposed twice. */
  hiddenSections?: string[]
  /** Custom terrain/basemap sources this project depends on (e.g. referenced by id
   *  in initialState.sourceA/basemapSource) — merged by id into the visitor's
   *  customTerrainSourcesAtom/customBasemapSourcesAtom on first load (same
   *  merge-by-id semantics as the "Load Sample" buttons), so a project embed works
   *  even for a visitor whose browser has never seen these sources before. */
  customTerrainSources?: CustomTerrainSource[]
  customBasemapSources?: CustomBasemapSource[]
  /** [west, south, east, north] — if set, the map flies to these bounds once on
   *  first load (after sources are seeded), independent of the smart-bounds-zoom
   *  heuristic used for click-driven fits elsewhere (see shouldZoomToBounds). Use
   *  this for a literal, known bbox (e.g. "whole world"); for a COG whose real
   *  extent isn't known ahead of time (including "fakegeo" COGs whose embedded
   *  bounds are an arbitrary synthetic anchor, not real-world coordinates), use
   *  `autoZoomToSource` instead so the bounds are read from the file itself. */
  initialBounds?: [west: number, south: number, east: number, north: number]
  /** Fetches the COG metadata bbox for sourceA/basemapSource (whichever is named)
   *  once it's resolved, and flies to it — for sources whose real extent can only
   *  be known by reading the file (see initialBounds' doc for why). COG only. */
  autoZoomToSource?: "sourceA" | "basemapSource"
}

const projects = projectsData as Record<string, ProjectConfig>

export function getProjectConfig(id: string | null | undefined): ProjectConfig | null {
  if (!id) return null
  return projects[id] || null
}
