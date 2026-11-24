// Which alpha mode a stored raster source draws with, and whether it can
// have one at all (lib/tile-transform-protocol.ts). Shared by the map
// (MapSources.tsx, withTileTransform) and the edit-source dialog's
// Transparency field (custom-basemap-modal.tsx), so both read the same
// resolution.
import customSourcesData from "./custom-sources.json"
import type { RasterSourceEntry } from "./source-schema"
import { resolveAlphaMode, type TileAlphaMode } from "./tile-transform-protocol"

/** The Library's own copy of each basemap, by id: a source added before the
 *  Library gave it alphaMode / underzoom still gets them (the user's stored
 *  copy is a snapshot of the entry at the time it was added). */
export const LIBRARY_BASEMAPS: ReadonlyMap<string, RasterSourceEntry> = new Map(((customSourcesData as unknown as { SAMPLE_BASEMAPS_SOURCES: RasterSourceEntry[] }).SAMPLE_BASEMAPS_SOURCES).map((s) => [s.id, s]))

/** Whether a source's tiles can go through tiletx:// (the alpha mode menu is
 *  offered only then, in the edit-source dialog): an http(s) tile, WMTS or WMS template. */
export function supportsTileTransform(source: { type?: string; url?: string } | null | undefined): boolean {
  return !!source?.url && (source.type === "tms" || source.type === "wms" || source.type === "wmts") && /^https?:\/\//.test(source.url)
}

/** The alpha mode a stored source draws with: its own choice, else its
 *  Library entry's, else legacy forceOpaque, else as served. */
export function sourceAlphaMode(source: Pick<RasterSourceEntry, "id" | "alphaMode" | "forceOpaque">): TileAlphaMode {
  return resolveAlphaMode(source, LIBRARY_BASEMAPS.get(source.id))
}
