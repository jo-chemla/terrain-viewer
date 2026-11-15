// Copernicus Data Space Ecosystem (CDSE) Sentinel Hub OGC WMS as a dated
// basemap on the historical timeline: one tick per quarter since Dec 2017,
// each a WMS GetMap with a `time` window and a cloud cap, mosaicked by
// Sentinel Hub per request (no register step, unlike Planetary Computer's
// mosaic API, lib/pc-mosaic.ts). Only offered once the visitor has entered a
// Sentinel Hub configuration ("instance") id in Settings → API Keys
// (sentinelHubInstanceIdAtom); the layer name is a setting too
// (sentinelHubMosaicLayerAtom), since it depends on how the instance was set up.
//
// Checked live 2026-08-12 against a real CDSE configuration instance
// (GetCapabilities + GetMap over Paris, time=2024-06-01/2024-09-01, maxcc=20,
// 200 image/jpeg of real Sentinel-2 true colour):
//  - Base URL https://sh.dataspace.copernicus.eu/ogc/wms/<instanceId>, CDSE's
//    own domain (not the legacy Sinergise sentinel-hub.com one).
//  - The instance id in the path is the whole auth: no OAuth client needed.
//  - The default templates carry a TRUE_COLOR layer. An instance can add its
//    own colour-balanced layer (the tested one had LAYER-MOSAIC, brighter and
//    more natural than TRUE_COLOR): set its name in Settings.
//  - The time dimension is lowercase `time`; `maxcc` is a 0-100 percentage.
//  - Tiles carry a "Copernicus — Europe's eyes on Earth" watermark unless
//    "Show logo" is unchecked in the instance's Configuration Utility.
//
// The instance id never goes into a saved or shared URL: the tile template is
// built at render time from the atom (MapSources.tsx), and the timeline ticks
// carry only dates.
const SH_WMS_BASE = "https://sh.dataspace.copernicus.eu/ogc/wms"

export const SH_DEFAULT_MOSAIC_LAYER = "TRUE_COLOR"

export const SH_TILE_SIZE = 256
// 10 m native Sentinel-2.
export const SH_MAXZOOM = 17
// Sentinel Hub answers an error for Sentinel-2 coarser than 200 m a pixel.
export const SH_MINZOOM = 10

const SH_MAX_CLOUD_COVER_PCT = 20

// Quarterly windows Dec-Feb / Mar-May / Jun-Aug / Sep-Nov. Planetary
// Computer's Sentinel-2 catalog on the timeline is monthly (cat-nat-mspc-s2),
// so the two never land on the same tick.
const SH_COVERAGE_START_MS = Date.UTC(2017, 11, 1) // 2017-12-01

export interface ShQuarterTick {
  dateMs: number
  label: string
  startIso: string
  endIso: string
}

let cachedTicks: { day: number; ticks: ShQuarterTick[] } | null = null
export function sentinelHubQuarterTicks(): ShQuarterTick[] {
  const day = Math.floor(Date.now() / 86_400_000)
  if (cachedTicks?.day === day) return cachedTicks.ticks
  const ticks: ShQuarterTick[] = []
  const nowMs = Date.now()
  let cursor = SH_COVERAGE_START_MS
  while (cursor <= nowMs) {
    const start = new Date(cursor)
    const end = new Date(cursor)
    end.setUTCMonth(end.getUTCMonth() + 3)
    const lastDayInWindow = new Date(end.getTime() - 86_400_000)
    const startLabel = start.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    const endLabel = lastDayInWindow.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    ticks.push({
      // The window's middle, so a tick sits inside the quarter it draws.
      dateMs: Math.round((start.getTime() + end.getTime()) / 2),
      label: `${startLabel}–${endLabel} ${lastDayInWindow.getUTCFullYear()}`,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    })
    cursor = end.getTime()
  }
  cachedTicks = { day, ticks }
  return ticks
}

export function nearestSentinelHubQuarterTick(dateMs: number): ShQuarterTick | null {
  const ticks = sentinelHubQuarterTicks()
  if (!ticks.length) return null
  let best = ticks[0]
  let bestDist = Math.abs(ticks[0].dateMs - dateMs)
  for (const t of ticks) {
    const dist = Math.abs(t.dateMs - dateMs)
    if (dist < bestDist) { best = t; bestDist = dist }
  }
  return best
}

/** WMS GetMap tile template for the quarter nearest `dateMs`. MapLibre fills
 *  `{bbox-epsg-3857}` per tile. WMS 1.1.1, whose SRS axis order for
 *  EPSG:3857 needs no special-casing. */
export function sentinelHubTileUrl(instanceId: string, dateMs: number, layer: string = SH_DEFAULT_MOSAIC_LAYER): string | null {
  const tick = nearestSentinelHubQuarterTick(dateMs)
  if (!tick || !instanceId.trim()) return null
  const params = new URLSearchParams({
    service: "WMS", request: "GetMap", version: "1.1.1",
    layers: layer.trim() || SH_DEFAULT_MOSAIC_LAYER, styles: "",
    format: "image/jpeg", transparent: "false",
    srs: "EPSG:3857", width: "256", height: "256",
    time: `${tick.startIso}/${tick.endIso}`,
    maxcc: String(SH_MAX_CLOUD_COVER_PCT),
  })
  return `${SH_WMS_BASE}/${encodeURIComponent(instanceId.trim())}?${params.toString()}&bbox={bbox-epsg-3857}`
}
