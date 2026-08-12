// Copernicus Data Space Ecosystem (CDSE) Sentinel Hub OGC WMS — Plan B1
// (MAXAR_SENTINEL_INTEGRATION_PLAN.md §4.1). CONFIRMED LIVE 2026-08-12
// against Jonathan's own CDSE configuration instance ("quarterly-mosaic",
// account jchemla@ico...): GetCapabilities + two real GetMap requests
// (LAYER-MOSAIC and TRUE_COLOR, both over Paris, TIME=2024-06-01/2024-09-01,
// maxcc=20) each returned a real 200 image/jpeg ~30KB, visually confirmed as
// real Sentinel-2 true-color imagery (not blank/error tiles).
//  - Base URL: https://sh.dataspace.copernicus.eu/ogc/wms/<instanceId> — CDSE's
//    own domain, not the legacy Sinergise sentinel-hub.com one.
//  - The instance id alone (in the URL path) is sufficient auth — no OAuth
//    client id/secret needed.
//  - LAYERS=LAYER-MOSAIC (not a guessed default-template name) — this
//    specific instance has a custom layer literally named "LAYER-MOSAIC"
//    (Title "LAYER MOSAIC"), evidently set up for exactly this purpose. Its
//    rendering visibly looks like a properly color-balanced true-color
//    composite — noticeably brighter/more natural than the generic
//    TRUE_COLOR layer's darker, less-adjusted output — so it's used here in
//    preference to TRUE_COLOR. Re-verify this choice if the instance's
//    layers are ever reconfigured.
//  - TIME dimension param name is lowercase `time` (confirmed from
//    GetCapabilities' own <Dimension name="time".../> — not `TIME`).
//  - Tiles initially carried a visible "Copernicus — Europe's eyes on Earth"
//    watermark logo — fixed by unchecking "Show logo" in this instance's
//    Configuration Utility settings (a per-instance config toggle, not a
//    paid-tier restriction). Re-confirmed live 2026-08-13 after the fix:
//    clean tile, no watermark.
const SH_WMS_BASE = "https://sh.dataspace.copernicus.eu/ogc/wms"

const SH_MOSAIC_LAYER = "LAYER-MOSAIC"

export const SH_TILE_SIZE = 256
// 10m native Sentinel-2 — same ceiling reasoning as lib/planetary-computer.ts.
export const SH_MAXZOOM = 17

const SH_MAX_CLOUD_COVER_PCT = 20

// Same quarterly windows (Dec-Feb / Mar-May / Jun-Aug / Sep-Nov) as lib/
// planetary-computer.ts, computed independently (not imported) so the two
// modules stay self-contained like every other lib/*.ts source here — but
// deliberately using the SAME boundaries/dateMs, unlike e.g. HLS vs. Planet's
// intentionally-offset synthetic cadences (lib/hls.ts's header), since a
// Sentinel Hub tick and a Planetary Computer tick for "Jun–Aug 2022" really
// do represent the identical real-world window, just rendered by a different
// provider — coinciding is the semantically correct behavior here, and the
// timeline panel already supports coincident ticks from different sources
// (historical-timeline-panel.tsx's coincidentGroup).
const SH_COVERAGE_START_MS = Date.UTC(2017, 11, 1) // 2017-12-01

export interface ShQuarterTick {
  dateMs: number
  label: string
  startIso: string
  endIso: string
}

export function sentinelHubQuarterTicks(): ShQuarterTick[] {
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
      dateMs: end.getTime(),
      label: `${startLabel}–${endLabel} ${lastDayInWindow.getUTCFullYear()}`,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    })
    cursor = end.getTime()
  }
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

/** WMS GetMap tile URL template for the quarter containing `dateMs` — a
 *  plain synchronous URL build (no register/poll step, unlike Planetary
 *  Computer's mosaic API), since WMS's TIME param does the server-side
 *  mosaicking per-request. `{bbox-epsg-3857}` is MapLibre's own built-in
 *  per-tile substitution for a `type: "raster"` Source (confirmed already in
 *  use by this app's "wms"/"wms-raw" custom source types — see lib/source-
 *  builder.ts) — no custom protocol needed for a plain (non-DEM) WMS image
 *  layer the way wms-raw's DEM case needs one. WMS 1.1.1 (not 1.3.0) — its
 *  SRS axis order for EPSG:3857 needs no special-casing, unlike 1.3.0's CRS
 *  axis-order rules for some other CRSes. */
export function sentinelHubTileUrl(instanceId: string, dateMs: number): string | null {
  const tick = nearestSentinelHubQuarterTick(dateMs)
  if (!tick) return null
  const params = new URLSearchParams({
    service: "WMS", request: "GetMap", version: "1.1.1",
    layers: SH_MOSAIC_LAYER, styles: "",
    format: "image/jpeg", transparent: "false",
    srs: "EPSG:3857", width: "256", height: "256",
    time: `${tick.startIso}/${tick.endIso}`,
    maxcc: String(SH_MAX_CLOUD_COVER_PCT),
  })
  return `${SH_WMS_BASE}/${instanceId}?${params.toString()}&bbox={bbox-epsg-3857}`
}
