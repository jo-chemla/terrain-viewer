// The one lookup of terrain sources by id. A source is a Worldwide Default
// (the built-ins of lib/terrain-sources.ts, then the library entries marked
// `section: "defaults"` in lib/custom-sources.json, GEM-15 today), a library
// entry the user added, or the user's own: all the same record
// (TerrainSourceEntry, lib/source-schema.ts), so the map, the derived modes,
// the contours, the exports, the GDAL commands and the tile service resolve
// every one of them through the same code (lib/terrain-tile-spec.ts) with no
// branch for built-ins.
//
// The user's list wins over a default of the same id: a library default
// added to Bring Your Own Data before it became a default (GEM-15 was, by
// the pinned row that preceded this) keeps the user's settings.
import customSources from "./custom-sources.json"
import { BUILTIN_TERRAIN_SOURCES } from "./terrain-sources"
import { hasEntryKey, type SourceKeys, type TerrainSourceEntry } from "./source-schema"

const LIBRARY_DEFAULTS = (customSources.SAMPLE_TERRAIN_SOURCES as TerrainSourceEntry[]).filter((s) => s.section === "defaults")

/** Every Worldwide Default, in the picker's order: `order` where set, else
 *  list order (built-ins first). */
export const WORLDWIDE_DEFAULTS: readonly TerrainSourceEntry[] = [...BUILTIN_TERRAIN_SOURCES, ...LIBRARY_DEFAULTS]
  .map((entry, i) => ({ entry: { ...entry, kind: "terrain" as const, section: "defaults" as const }, rank: entry.order ?? i }))
  .sort((a, b) => a.rank - b.rank)
  .map(({ entry }) => entry)

const DEFAULT_BY_ID = new Map(WORLDWIDE_DEFAULTS.map((s) => [s.id, s]))

/** Whether an id names a Worldwide Default. */
export function isWorldwideDefault(id: string | null | undefined): boolean {
  return !!id && DEFAULT_BY_ID.has(id)
}

/** The Worldwide Defaults the caller can read: a keyed one (Mapbox, MapTiler,
 *  Cesium ion) only once its key is set. */
export function visibleWorldwideDefaults(keys: SourceKeys): TerrainSourceEntry[] {
  return WORLDWIDE_DEFAULTS.filter((s) => hasEntryKey(s, keys))
}

/** The entry of a terrain source id: the user's own (or added library)
 *  entry, else a Worldwide Default. */
export function findTerrainSource(id: string | null | undefined, customs: readonly TerrainSourceEntry[] = []): TerrainSourceEntry | undefined {
  if (!id) return undefined
  return customs.find((s) => s.id === id) ?? DEFAULT_BY_ID.get(id)
}

const withDefaultsCache = new WeakMap<readonly TerrainSourceEntry[], TerrainSourceEntry[]>()
/** The user's list followed by the defaults it does not shadow: what the
 *  map's components look a source up in. The same array for the same input
 *  (React dependencies stay stable). */
export function withWorldwideDefaults(customs: readonly TerrainSourceEntry[]): TerrainSourceEntry[] {
  let out = withDefaultsCache.get(customs)
  if (!out) {
    const have = new Set(customs.map((s) => s.id))
    out = [...customs, ...WORLDWIDE_DEFAULTS.filter((s) => !have.has(s.id))]
    withDefaultsCache.set(customs, out)
  }
  return out
}
