// The dated imagery sources, entries of the shared schema (DatedImagerySource
// in lib/source-schema.ts): for each, the catalog of dates at a place, the
// tiles of a date and the ceiling. The map's basemap (RasterBasemapSource),
// the multi-date export (lib/historical-export-sources.ts), the timeline's
// fixed date lists and the MCP server's imagery_dates read them from here.
//
// Not here: the per-place live walks the timeline runs as React hooks
// (useWaybackItemsWithLocalChanges, useGeHistoricalDates, useBingCaptureDate:
// debounced, cached, progressive), and the dynamic attribution hooks
// (useWaybackDynamicAttribution, useGeHistoricalDynamicAttribution,
// useBingDynamicAttribution); listDates is their one-shot equivalent.
// Ids are the URL's (?historicalActiveSourceA=wayback) and never change.
import type { DatedImagerySource, DatedImageryTick, SourceKeys } from "./source-schema"
import { STATIC_BASEMAP_ATTRIBUTIONS } from "./basemap-attribution"
import { listWaybackTicksInRange, waybackTileUrl, type WaybackItem } from "./wayback"
import { syntheticHlsTicks, hlsTileUrl } from "./hls"
import { listGeHistoricalTicksInRange, geHistoricalTileSource, fetchGeHistoricalTileBlob } from "./ge-historical"
import { planetMonthlyTicks, planetTileUrl, PLANET_TILE_SIZE, PLANET_MAXZOOM } from "./planet"
import { planetProtocolUrl, planetTileBlobFetcher } from "./planet-tiles"
import { eoxS2CloudlessTicks, eoxS2CloudlessTileUrl, EOX_S2_TILE_SIZE, EOX_S2_MAXZOOM } from "./eox-s2-cloudless"
import { fetchBingCaptureDate, toQuadkey } from "./bing"

const inRange = (startMs: number, endMs: number) => (t: DatedImageryTick) => t.dateMs >= startMs && t.dateMs <= endMs
const BING_URL_BASE = "https://t.ssl.ak.tiles.virtualearth.net/tiles/a"
const BING_URL_SUFFIX = ".jpeg?g=14603&n=z&prx=1"
const todayUtc = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }

export const DATED_IMAGERY_SOURCES: readonly DatedImagerySource[] = [
  {
    id: "wayback", name: "Esri World Imagery Wayback", shortName: "Wayback", kind: "raster", section: "defaults",
    description: "Every archived release of Esri World Imagery since 2014; the dates are the real capture dates per tile, one per distinct capture.",
    infoUrl: "https://livingatlas.arcgis.com/wayback/",
    granularity: "capture", realDates: true, historicalEntry: true,
    tileSize: 256, maxzoom: 19, attribution: STATIC_BASEMAP_ATTRIBUTIONS.wayback,
    fileStem: "esri-wayback", exportLabel: "Esri Wayback",
    listDates: async ({ lat, lng, zoom }, startMs, endMs) =>
      (await listWaybackTicksInRange(lat, lng, zoom, startMs, endMs)).map((t) => ({ dateMs: t.dateMs, label: t.label, ref: t.item })),
    // The release, not the date, names the tiles: the map resolves a date to
    // the release serving it at the place (useResolvedWaybackRelease).
    tiles: ({ ref }) => (ref ? { tiles: [waybackTileUrl(ref as WaybackItem)], tileSize: 256, maxzoom: 19 } : null),
  },
  {
    id: "hls", name: "NASA Harmonized Landsat Sentinel-2", shortName: "HLS", kind: "raster", section: "defaults",
    description: "Monthly true-colour mosaics of HLS, each the granules of a 30-day window around the date (titiler-cmr). The dates are a monthly cadence, not captures found at the place.",
    infoUrl: "https://hls.gsfc.nasa.gov/",
    granularity: "month", realDates: false, historicalEntry: true,
    tileSize: 256, maxzoom: 16, attribution: STATIC_BASEMAP_ATTRIBUTIONS.hls,
    fileStem: "nasa-hls", exportLabel: "HLS",
    fixedDates: () => syntheticHlsTicks(),
    listDates: async (_p, startMs, endMs) => syntheticHlsTicks().filter(inRange(startMs, endMs)),
    tiles: ({ dateMs }) => (dateMs ? { tiles: [hlsTileUrl(dateMs)], tileSize: 256, maxzoom: 16 } : null),
  },
  {
    id: "ge-historical", name: "Google Earth Historical", shortName: "GE Historical", kind: "raster", section: "defaults",
    description: "Every dated capture Google Earth holds at the place, read from its own quadtree packets.",
    infoUrl: "https://earth.google.com/",
    granularity: "capture", realDates: true, historicalEntry: true,
    tileSize: 256, maxzoom: 23, attribution: "Google, see dynamic attribution in source panel",
    fileStem: "google-earth", exportLabel: "GE Historical",
    listDates: async ({ lat, lng, zoom }, startMs, endMs) => listGeHistoricalTicksInRange(lat, lng, zoom, startMs, endMs),
    // No date yet (a fresh activation, date 0): today as the target, which
    // the protocol turns into the newest capture on or before it.
    tiles: ({ dateMs }, opts) => {
      const target = dateMs || todayUtc()
      const spec = geHistoricalTileSource(target, opts?.hd)
      return {
        tiles: spec.tiles, tileSize: spec.tileSize, maxzoom: spec.maxzoom,
        // gehist:// is not a scheme fetch accepts: an export goes through this.
        fetchTileBlob: (z, x, y, signal) => fetchGeHistoricalTileBlob(z, x, y, target, signal),
      }
    },
  },
  {
    id: "planet", name: "Planet Global Monthly Basemaps", shortName: "Planet", kind: "raster", section: "defaults",
    description: "Planet's monthly global mosaics, from 2020, two months behind; needs a Planet key.",
    infoUrl: "https://www.planet.com/",
    apiKey: "planetKey",
    granularity: "month", realDates: true, historicalEntry: true,
    tileSize: PLANET_TILE_SIZE, maxzoom: PLANET_MAXZOOM, attribution: STATIC_BASEMAP_ATTRIBUTIONS.planet,
    fileStem: "planet", exportLabel: "Planet",
    fixedDates: (keys) => (keys.planetKey ? planetMonthlyTicks() : []),
    listDates: async (_p, startMs, endMs, keys) => (keys.planetKey ? planetMonthlyTicks().filter(inRange(startMs, endMs)) : []),
    // The map reads planet:// (the key stays in the protocol, and out of the
    // tile cache's key); an export fetches through the same protocol and
    // keeps the https template for its GDAL script.
    tiles: ({ dateMs }, opts) => {
      if (!dateMs || !opts?.keys?.planetKey) return null
      return {
        tiles: [planetProtocolUrl(dateMs)], urlTemplate: planetTileUrl(dateMs, opts.keys.planetKey),
        fetchTileBlob: planetTileBlobFetcher(dateMs), tileSize: PLANET_TILE_SIZE, maxzoom: PLANET_MAXZOOM,
      }
    },
  },
  {
    id: "eox-s2", name: "EOX Sentinel-2 Cloudless", shortName: "EOX S2", kind: "raster", section: "defaults",
    description: "EOX's yearly cloudless Sentinel-2 mosaics, one per published year.",
    infoUrl: "https://s2maps.eu/",
    granularity: "year", realDates: true, historicalEntry: true,
    tileSize: EOX_S2_TILE_SIZE, maxzoom: EOX_S2_MAXZOOM, attribution: STATIC_BASEMAP_ATTRIBUTIONS["eox-s2"],
    fileStem: "eox-sentinel2", exportLabel: "EOX Sentinel-2",
    fixedDates: () => eoxS2CloudlessTicks(),
    listDates: async (_p, startMs, endMs) => eoxS2CloudlessTicks().filter(inRange(startMs, endMs)),
    tiles: ({ dateMs }) => (dateMs ? { tiles: [eoxS2CloudlessTileUrl(new Date(dateMs).getUTCFullYear())], tileSize: EOX_S2_TILE_SIZE, maxzoom: EOX_S2_MAXZOOM } : null),
  },
  {
    id: "bing", name: "Bing Aerial", shortName: "Bing", kind: "raster", section: "defaults",
    description: "Bing's one current mosaic; its capture date at the place is read from the tile's own headers.",
    infoUrl: "https://www.bing.com/maps",
    granularity: "current", realDates: true, historicalEntry: false,
    tileSize: 256, maxzoom: 21, attribution: STATIC_BASEMAP_ATTRIBUTIONS.bing,
    fileStem: "bing", exportLabel: "Bing (current)",
    // One tick whatever the range: the current mosaic, dated by its capture
    // date at the place when Bing reports one ("latest" otherwise).
    listDates: async ({ lat, lng, zoom }) => {
      const { dateMs } = await fetchBingCaptureDate(lat, lng, zoom)
      return [{ dateMs: dateMs ?? Date.now(), label: dateMs ? new Date(dateMs).toISOString().slice(0, 10) : "latest" }]
    },
    tiles: () => ({
      tiles: [`${BING_URL_BASE}{quadkey}${BING_URL_SUFFIX}`],
      buildTileUrl: (z, x, y) => `${BING_URL_BASE}${toQuadkey(x, y, z)}${BING_URL_SUFFIX}`,
      quadkeyUrlTemplate: `${BING_URL_BASE}{quadkey}${BING_URL_SUFFIX}`,
      tileSize: 256, maxzoom: 21,
    }),
  },
]

const BY_ID = new Map(DATED_IMAGERY_SOURCES.map((s) => [s.id, s]))

/** A dated source by id, or undefined. */
export function findDatedImagery(id: string | null | undefined): DatedImagerySource | undefined {
  return id ? BY_ID.get(id) : undefined
}

/** The dates of a source known without a request, for the timeline. */
export function fixedDatedTicks(id: string, keys: SourceKeys): DatedImageryTick[] {
  return findDatedImagery(id)?.fixedDates?.(keys) ?? []
}
