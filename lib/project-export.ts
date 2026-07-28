// Whole-project import/export: bundles the BYOD sources, bookmarks, drawing
// layers and jotai `atomWithStorage` config settings a user might want to
// carry between browsers/machines into a single downloadable JSON file.
// Each category is optional per-export/import (see import-export-project-
// dialog.tsx's checkboxes) and reuses the same upsert-by-id merge convention
// bookmarks-section.tsx's mergeImportedBookmarks already established, so
// re-importing a previously-exported file is idempotent rather than
// duplicating everything.
//
// Deliberately reads/writes localStorage directly instead of going through
// each atom's own setter — there'd otherwise be ~20 settings atoms to import
// here just to write them, and jotai's atomWithStorage is itself a thin
// JSON-serialize wrapper over the exact same keys. Callers must reload the
// page after an import (see applyProjectImport's own note) since already-
// mounted components/atoms won't pick up a raw localStorage write on their
// own.
import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"
import type { Bookmark } from "./bookmarks"
import type { DrawLayer, GeoJSONFeature } from "@/components/TerrainControlPanel/TerraDrawSystem"
import { persistVectorLayerFeatures, readPersistedVectorLayerFeatures } from "./opfs-vector-store"

export const PROJECT_EXPORT_VERSION = 1

/** Curated jotai `atomWithStorage` keys exported/imported as "Settings" —
 *  deliberately excludes pure UI fold/scroll state (isSettings*Open,
 *  isByodOpen, sectionOpen, sidebarScroll, macroGroupOpen,
 *  bookmarksListHeight, vizModePinned, ...) and whatever the other three
 *  checkboxes already cover (customTerrainSources/customBasemapSources ->
 *  Sources, bookmarks -> Bookmarks, drawingLayers -> Drawings), keeping this
 *  bucket to values a user would actually want to carry to a new machine. */
export const SETTINGS_STORAGE_KEYS = [
  "mapboxKey", "googleKey", "mapzenKey", "maptilerKey", "titilerEndpoint", "maxResolution",
  "colorRampType", "licenseFilter", "highResTerrain", "cacheVizTiles",
  "terrainAnalysisAdvanced", "reliefVisualizationAdvanced",
  "useCogProtocolVsTitiler", "useClientExport", "isTransparentUi",
  "customThemes", "persistVectorLayers", "persistLocalCogs",
  "anim-resolution-key", "anim-render-quality", "anim-fps", "anim-target-size-mb",
] as const

export interface ProjectExportSelection {
  sources: boolean
  bookmarks: boolean
  drawings: boolean
  settings: boolean
}

export interface ProjectExportPayload {
  version: number
  /** Epoch ms. */
  exportedAt: number
  sources?: { customTerrainSources: CustomTerrainSource[]; customBasemapSources: CustomBasemapSource[] }
  bookmarks?: Bookmark[]
  drawings?: { layers: DrawLayer[]; features: GeoJSONFeature[] }
  settings?: Record<string, unknown>
}

function readLocalJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeLocalJSON(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value))
}

/** Upserts by `id` — re-importing a previously-exported file updates
 *  matching entries in place instead of duplicating them, the same
 *  convention bookmarks.ts's mergeImportedBookmarks already uses. */
function mergeById<T extends { id: string }>(existing: T[], imported: T[]): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const item of imported) byId.set(item.id, item)
  return Array.from(byId.values())
}

/** Same idea as mergeById, but for GeoJSON features whose `id` is optional
 *  (terra-draw doesn't always assign one) — id-less features are kept as-is
 *  from both sides rather than collapsed onto each other. */
function mergeFeaturesById(existing: GeoJSONFeature[], imported: GeoJSONFeature[]): GeoJSONFeature[] {
  const byId = new Map<string, GeoJSONFeature>()
  const idLess: GeoJSONFeature[] = []
  for (const f of [...existing, ...imported]) {
    if (f.id != null) byId.set(String(f.id), f)
    else idLess.push(f)
  }
  return [...byId.values(), ...idLess]
}

/** True if any exported/imported BYOD source references a browser-local file
 *  (`cog-local`) — only the OPFS best-effort byte cache and an in-memory
 *  `File` back those on the machine that added them, so a JSON export can't
 *  carry the actual bytes. The other side will need to re-select the file
 *  (existing "Re-select file…" affordance in custom-source-details.tsx)
 *  before that source renders. */
export function hasLocalFileSources(sources?: ProjectExportPayload["sources"]): boolean {
  if (!sources) return false
  return sources.customTerrainSources.some((s) => s.type === "cog-local") || sources.customBasemapSources.some((s) => s.type === "cog-local")
}

export function buildProjectExport(
  selection: ProjectExportSelection,
  live: { bookmarks: Bookmark[]; drawingLayers: DrawLayer[]; drawingFeatures: GeoJSONFeature[] },
): ProjectExportPayload {
  const payload: ProjectExportPayload = { version: PROJECT_EXPORT_VERSION, exportedAt: Date.now() }

  if (selection.sources) {
    payload.sources = {
      customTerrainSources: readLocalJSON("customTerrainSources", []),
      customBasemapSources: readLocalJSON("customBasemapSources", []),
    }
  }
  if (selection.bookmarks) payload.bookmarks = live.bookmarks
  if (selection.drawings) payload.drawings = { layers: live.drawingLayers, features: live.drawingFeatures }
  if (selection.settings) {
    const settings: Record<string, unknown> = {}
    for (const key of SETTINGS_STORAGE_KEYS) {
      const value = readLocalJSON<unknown>(key, undefined)
      if (value !== undefined) settings[key] = value
    }
    payload.settings = settings
  }
  return payload
}

/** Applies an imported payload on top of whatever's already here — sources/
 *  bookmarks/drawing-layers upsert by id, a drawing layer's features merge
 *  into that layer's existing OPFS-persisted features, and settings values
 *  overwrite outright (single scalars, no meaningful "merge").
 *
 *  Writes straight to localStorage/OPFS rather than through jotai's atoms
 *  (see this module's own header comment) — callers MUST reload the page
 *  afterwards for already-mounted components to pick the change up. */
export async function applyProjectImport(payload: ProjectExportPayload): Promise<void> {
  if (payload.sources) {
    const existingTerrain = readLocalJSON<CustomTerrainSource[]>("customTerrainSources", [])
    const existingBasemap = readLocalJSON<CustomBasemapSource[]>("customBasemapSources", [])
    writeLocalJSON("customTerrainSources", mergeById(existingTerrain, payload.sources.customTerrainSources))
    writeLocalJSON("customBasemapSources", mergeById(existingBasemap, payload.sources.customBasemapSources))
  }

  if (payload.bookmarks) {
    const existing = readLocalJSON<Bookmark[]>("bookmarks", [])
    writeLocalJSON("bookmarks", mergeById(existing, payload.bookmarks))
  }

  if (payload.drawings) {
    const existingLayers = readLocalJSON<DrawLayer[]>("drawingLayers", [])
    writeLocalJSON("drawingLayers", mergeById(existingLayers, payload.drawings.layers))

    const featuresByLayer = new Map<string, GeoJSONFeature[]>()
    for (const feature of payload.drawings.features) {
      const layerId = feature.properties?.layerId
      if (!layerId) continue
      const bucket = featuresByLayer.get(layerId) ?? []
      bucket.push(feature)
      featuresByLayer.set(layerId, bucket)
    }
    await Promise.all(
      Array.from(featuresByLayer.entries()).map(async ([layerId, imported]) => {
        const existingFeatures = (await readPersistedVectorLayerFeatures<GeoJSONFeature>(layerId)) ?? []
        await persistVectorLayerFeatures(layerId, mergeFeaturesById(existingFeatures, imported))
      }),
    )
  }

  if (payload.settings) {
    for (const [key, value] of Object.entries(payload.settings)) writeLocalJSON(key, value)
  }
}
