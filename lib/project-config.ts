// Named "project" presets for embedding — a project config bundles a curated
// initial view (camera, sources, viz options), which sections are visible/open,
// and which view modes are selectable, so an embedder can link to `?project=foo`
// instead of hand-assembling dozens of individual query params.

import projectsData from "./projects.json"

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
}

const projects = projectsData as Record<string, ProjectConfig>

export function getProjectConfig(id: string | null | undefined): ProjectConfig | null {
  if (!id) return null
  return projects[id] || null
}
