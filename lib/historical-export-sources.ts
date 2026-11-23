// The multi-date export's sources (lib/export-multi.ts), resolved outside a
// mounted component: the dated imagery through its schema (lib/dated-imagery.ts:
// each source's catalog of dates at a place and the tiles of a date), the
// current basemaps through theirs (lib/basemap-sources.ts: one address each).
// The map's RasterBasemapSource reads the same two registries.
import { DATED_IMAGERY_SOURCES, findDatedImagery } from "./dated-imagery"
import { builtinBasemap } from "./basemap-sources"
import { entryUrl } from "./source-schema"
import type { FetchRgbTileMosaicOptions } from "./rgb-tile-mosaic"

export const EXPORT_SOURCE_IDS = ["wayback", "hls", "ge-historical", "planet", "eox-s2", "bing", "google", "esri", "mapbox", "maptiler", "here"] as const
export type ExportSourceId = (typeof EXPORT_SOURCE_IDS)[number]
/** The non-archival providers: one current mosaic each, no date range. Bing
 *  is the odd one out only in that it can report its capture date. */
export const CURRENT_BASEMAP_SOURCE_IDS: readonly ExportSourceId[] = ["bing", "google", "esri", "mapbox", "maptiler", "here"]
/** The export's current basemaps and their built-in entry: "google" exports
 *  Google's satellite layer (googlesat), not the hybrid with labels. */
const CURRENT_ENTRY: Record<string, string> = { google: "googlesat", esri: "esri", mapbox: "mapbox", maptiler: "maptiler", here: "here" }
export const EXPORT_SOURCE_LABELS: Record<ExportSourceId, string> = {
  ...Object.fromEntries(DATED_IMAGERY_SOURCES.map((s) => [s.id, s.exportLabel])),
  google: "Google (current)", esri: "Esri (current)", mapbox: "Mapbox (current)", maptiler: "MapTiler (current)", here: "HERE (current)",
} as Record<ExportSourceId, string>
/** Filename stem per source - the provider name rather than the internal id
 *  ("esri-wayback" beats "wayback" when a file turns up out of context). */
export const EXPORT_SOURCE_FILE_STEMS: Record<ExportSourceId, string> = {
  ...Object.fromEntries(DATED_IMAGERY_SOURCES.map((s) => [s.id, s.fileStem])),
  google: "google", esri: "esri", mapbox: "mapbox", maptiler: "maptiler", here: "here",
} as Record<ExportSourceId, string>
/** Keys some current basemaps need; a missing key makes that source list nothing. */
export interface ExportSourceKeys { mapbox?: string; maptiler?: string; here?: string }

export interface ExportTick {
  dateMs: number
  /** yyyy-mm-dd, for filenames — see lib/export-multi.ts. */
  label: string
  tileSpec: Pick<FetchRgbTileMosaicOptions, "tileUrlTemplate" | "buildTileUrl" | "fetchTileBlob" | "tileSize"> & {
    maxzoom: number
    /** Bing only — a literal `{quadkey}` placeholder template (this app's
     *  own convention, same as `{x}`/`{y}`/`{z}` elsewhere), since Bing
     *  addresses tiles by quadkey rather than z/x/y and so has no
     *  `tileUrlTemplate` of its own (buildTileUrl computes the quadkey
     *  itself instead). Only lib/gdal-export.ts reads this — it maps to
     *  GDAL_WMS's own `${quadkey}` templating for the dedicated
     *  VirtualEarth service (gdal.org/en/stable/drivers/raster/wms.html#virtualearth). */
    quadkeyUrlTemplate?: string
  }
}

/**
 * Every real capture within [startMs, endMs] at (lat, lng, zoom) for one
 * source, each already carrying everything fetchRgbTileMosaic needs to fetch
 * it. A current basemap returns one tick whatever the range, labelled
 * "latest" (its capture date is unknown, and a date in the filename would
 * claim a precision the data does not have); Bing's one tick carries its
 * capture date at the place when Bing reports one.
 */
export async function listExportTicks(
  sourceId: ExportSourceId, lat: number, lng: number, zoom: number,
  startMs: number, endMs: number, planetKey?: string, keys?: ExportSourceKeys,
): Promise<ExportTick[]> {
  const entryId = CURRENT_ENTRY[sourceId]
  if (entryId) {
    const entry = builtinBasemap(entryId)
    if (!entry) return []
    const sourceKeys = { mapboxKey: keys?.mapbox, maptilerKey: keys?.maptiler, hereKey: keys?.here }
    if (entry.apiKey && !sourceKeys[entry.apiKey as keyof typeof sourceKeys]) return []
    // The export reads Esri's tiles without blankTile=false: a placeholder
    // tile past its imagery is better in a mosaic than a hole.
    const url = entryUrl(entry, sourceKeys).replace(/\?blankTile=false$/, "")
    return [{ dateMs: Date.now(), label: "latest", tileSpec: { tileUrlTemplate: url, tileSize: entry.tileSize ?? 256, maxzoom: entry.maxzoom ?? 20 } }]
  }

  const source = findDatedImagery(sourceId)
  if (!source) return []
  const sourceKeys = { planetKey }
  const ticks = await source.listDates({ lat, lng, zoom }, startMs, endMs, sourceKeys)
  const out: ExportTick[] = []
  for (const tick of ticks) {
    const spec = source.tiles(tick, { keys: sourceKeys })
    if (!spec) continue
    out.push({
      dateMs: tick.dateMs, label: tick.label,
      tileSpec: {
        // A template on an app scheme (gehist://, planet://) is kept for the
        // GDAL script's note; the mosaic itself goes through fetchTileBlob.
        tileUrlTemplate: spec.buildTileUrl ? undefined : spec.urlTemplate ?? spec.tiles[0],
        buildTileUrl: spec.buildTileUrl,
        fetchTileBlob: spec.fetchTileBlob,
        quadkeyUrlTemplate: spec.quadkeyUrlTemplate,
        tileSize: spec.tileSize,
        maxzoom: spec.maxzoom,
      },
    })
  }
  return out
}
