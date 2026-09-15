// Plain (non-hook) unified dispatcher over the app's 6 historical basemap
// sources, for lib/export-multi.ts's batch export — every one of these
// normally resolves through RasterBasemapSource (a mounted React component,
// see components/LayersAndSources/MapSources.tsx), which isn't usable from a
// plain async batch loop. Each branch below just calls the same underlying
// pure per-source functions RasterBasemapSource itself calls.
import { listWaybackTicksInRange, waybackTileUrl } from "./wayback"
import { syntheticHlsTicks, hlsTileUrl } from "./hls"
import { listGeHistoricalTicksInRange, geHistoricalTileSource } from "./ge-historical"
import { planetMonthlyTicks, planetTileUrl } from "./planet"
import { eoxS2CloudlessTicks, eoxS2CloudlessTileUrl } from "./eox-s2-cloudless"
import { fetchBingCaptureDate, toQuadkey } from "./bing"
import type { FetchRgbTileMosaicOptions } from "./rgb-tile-mosaic"

export const EXPORT_SOURCE_IDS = ["wayback", "hls", "ge-historical", "planet", "eox-s2", "bing", "google", "esri", "mapbox", "maptiler", "here"] as const
export type ExportSourceId = (typeof EXPORT_SOURCE_IDS)[number]
/** The non-archival providers: one current mosaic each, no date range. Bing
 *  is the odd one out only in that it can report its capture date. */
export const CURRENT_BASEMAP_SOURCE_IDS: readonly ExportSourceId[] = ["bing", "google", "esri", "mapbox", "maptiler", "here"]
export const EXPORT_SOURCE_LABELS: Record<ExportSourceId, string> = {
  wayback: "Esri Wayback", hls: "HLS", "ge-historical": "GE Historical", planet: "Planet", "eox-s2": "EOX Sentinel-2",
  bing: "Bing (current)", google: "Google (current)", esri: "Esri (current)", mapbox: "Mapbox (current)", maptiler: "MapTiler (current)", here: "HERE (current)",
}
/** Keys some current basemaps need; a missing key makes that source list nothing. */
export interface ExportSourceKeys { mapbox?: string; maptiler?: string; here?: string }

export interface ExportTick {
  dateMs: number
  /** yyyy-mm-dd, for filenames — see lib/export-multi.ts. */
  label: string
  tileSpec: Pick<FetchRgbTileMosaicOptions, "tileUrlTemplate" | "buildTileUrl" | "tileSize"> & {
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

const BING_URL_BASE = "https://t.ssl.ak.tiles.virtualearth.net/tiles/a"
const BING_URL_SUFFIX = ".jpeg?g=14603&n=z&prx=1"

/**
 * Every real capture within [startMs, endMs] at (lat, lng, zoom) for one
 * historical source, each already carrying everything fetchRgbTileMosaic
 * needs to fetch it. Bing has no browsable archive (see lib/historical-
 * sources.ts) — it always returns at most ONE tick (its single current
 * mosaic), included regardless of the requested range, labeled with its own
 * reported capture date if available.
 */
export async function listExportTicks(
  sourceId: ExportSourceId, lat: number, lng: number, zoom: number,
  startMs: number, endMs: number, planetKey?: string, keys?: ExportSourceKeys,
): Promise<ExportTick[]> {
  const dateLabel = (dateMs: number) => new Date(dateMs).toISOString().slice(0, 10)

  // Current (non-archival) basemaps: exactly one tick, dated today, whatever
  // the range says — same convention as Bing below. Templates mirror
  // rasterBasemaps in MapSources.tsx.
  // Their capture date is unknown, so the tick is labelled "latest" rather
  // than today's date - a date in the filename would claim a precision the
  // data does not have.
  const current = (tileUrlTemplate: string, maxzoom: number): ExportTick[] => {
    return [{ dateMs: Date.now(), label: "latest", tileSpec: { tileUrlTemplate, tileSize: 256, maxzoom } }]
  }
  if (sourceId === "google") return current("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", 21)
  if (sourceId === "esri") return current("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}.jpg", 19)
  if (sourceId === "mapbox") return keys?.mapbox ? current(`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token=${keys.mapbox}`, 22) : []
  if (sourceId === "maptiler") return keys?.maptiler ? current(`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${keys.maptiler}`, 20) : []
  if (sourceId === "here") return keys?.here ? current(`https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?style=satellite.day&apiKey=${keys.here}`, 20) : []

  if (sourceId === "wayback") {
    const ticks = await listWaybackTicksInRange(lat, lng, zoom, startMs, endMs)
    return ticks.map((t) => ({
      dateMs: t.dateMs, label: dateLabel(t.dateMs),
      tileSpec: { tileUrlTemplate: waybackTileUrl(t.item), tileSize: 256, maxzoom: 19 },
    }))
  }
  if (sourceId === "hls") {
    return syntheticHlsTicks()
      .filter((t) => t.dateMs >= startMs && t.dateMs <= endMs)
      .map((t) => ({
        dateMs: t.dateMs, label: dateLabel(t.dateMs),
        tileSpec: { tileUrlTemplate: hlsTileUrl(t.dateMs), tileSize: 256, maxzoom: 16 },
      }))
  }
  if (sourceId === "ge-historical") {
    const ticks = await listGeHistoricalTicksInRange(lat, lng, zoom, startMs, endMs)
    return ticks.map((t) => {
      const spec = geHistoricalTileSource(t.dateMs)
      return {
        dateMs: t.dateMs, label: dateLabel(t.dateMs),
        tileSpec: { tileUrlTemplate: spec.tiles[0], tileSize: spec.tileSize, maxzoom: spec.maxzoom },
      }
    })
  }
  if (sourceId === "planet") {
    if (!planetKey) return []
    return planetMonthlyTicks()
      .filter((t) => t.dateMs >= startMs && t.dateMs <= endMs)
      .map((t) => ({
        dateMs: t.dateMs, label: dateLabel(t.dateMs),
        tileSpec: { tileUrlTemplate: planetTileUrl(t.dateMs, planetKey), tileSize: 256, maxzoom: 15 },
      }))
  }
  if (sourceId === "eox-s2") {
    return eoxS2CloudlessTicks()
      .filter((t) => t.dateMs >= startMs && t.dateMs <= endMs)
      .map((t) => ({
        dateMs: t.dateMs, label: dateLabel(t.dateMs),
        tileSpec: { tileUrlTemplate: eoxS2CloudlessTileUrl(new Date(t.dateMs).getUTCFullYear()), tileSize: 256, maxzoom: 14 },
      }))
  }
  // bing
  const { dateMs } = await fetchBingCaptureDate(lat, lng, zoom)
  const effectiveDateMs = dateMs ?? Date.now()
  return [{
    dateMs: effectiveDateMs,
    // Bing does report its mosaic's capture date at the location; only when
    // that lookup fails does the file fall back to "latest".
    label: dateMs ? dateLabel(dateMs) : "latest",
    tileSpec: {
      buildTileUrl: (z, x, y) => `${BING_URL_BASE}${toQuadkey(x, y, z)}${BING_URL_SUFFIX}`,
      quadkeyUrlTemplate: `${BING_URL_BASE}{quadkey}${BING_URL_SUFFIX}`,
      tileSize: 256,
      maxzoom: 21,
    },
  }]
}
