// Vexcel Data Program — historical aerial Ortho imagery (Plan §4.6 in
// MAXAR_SENTINEL_INTEGRATION_PLAN.md). UNTESTED SCAFFOLDING, LOWER
// CONFIDENCE than lib/nearmap.ts/lib/maxar.ts: Vexcel's own API docs
// (vexcel.atlassian.net/wiki/spaces/APIDOCS) were largely unreachable
// during research — most sub-pages that would show a real worked GetTile
// example either 404'd or didn't render, including the WMTS-specific page
// linked from their own search results. What WAS confirmed (2026-08-13):
//  - Current API base is https://api.vexcelgroup.com/v2/ — their OWN docs
//    state API 1.0 (a different domain, api.gic.org) was deprecated July
//    2026; do not use that older domain even though some public search
//    results still reference it.
//  - The platform exposes a standard OGC WebMapTileService (GetCapabilities
//    + GetTile) for their Ortho imagery, described as usable from
//    "third-party applications such as ArcGIS, QGIS, Global Mapper" — this
//    module assumes standard WMTS param names (service/request/layer/
//    tilematrixset/tilematrix/tilecol/tilerow), the same shape Maxar's own
//    confirmed-working WMTS uses, rather than a custom scheme, since that's
//    the one part of their docs that clearly described a standards-based
//    service.
//  - Resources are organized by "collection"/"event"/"extract"/"tile" —
//    reads as genuinely dated/vintaged imagery (an "event" is one capture
//    campaign; marketing separately describes an "annually refreshed"
//    historical library) — but the exact layer-naming or TIME-dimension
//    mechanism for selecting a specific vintage through the WMTS endpoint
//    specifically was NOT confirmed. VEXCEL_ORTHO_LAYER below is a
//    best-guess placeholder.
//  - No metadata/coverage endpoint (Nearmap's Coverage API / Maxar's
//    seamlines equivalent) was found or confirmed for Vexcel — so unlike
//    lib/nearmap.ts, this module can NOT build real per-location historical
//    ticks. vexcelAnnualTicks() below is a SYNTHETIC once-a-year cadence
//    (same "placeholder, not verified real dates" flavor as lib/hls.ts's
//    syntheticHlsTicks), not a real per-location catalog.
//  - Access model: no self-serve signup was found anywhere in reachable
//    docs or marketing — reads as an enterprise product (support@
//    vexcelgroup.com / helpdesk ticketing), same access tier as Maxar/
//    Airbus OneAtlas, not a self-serve trial like Sentinel Hub/Planetary
//    Computer.
//  - Coverage: North America plus parts of Europe/Australia-NZ, described
//    as "40+ countries" with annual refresh — isInVexcelCoverageArea below
//    is a coarse placeholder bounding box, not real coverage polygons.
//
// Given how little of the real request shape could be confirmed, expect to
// rewrite most of the URL-building logic here once a real account or API
// explorer is available — this is closer to "a documented starting point"
// than lib/nearmap.ts's confirmed endpoint shapes.
const VEXCEL_WMTS_BASE = "https://api.vexcelgroup.com/v2/wmts"

// UNVERIFIED placeholder — see header.
const VEXCEL_ORTHO_LAYER = "Ortho"

export const VEXCEL_TILE_SIZE = 256
export const VEXCEL_MAXZOOM = 21

// Coarse bounding boxes — [minLat, minLng, maxLat, maxLng]. North America +
// a rough Western Europe box, per "40+ countries" marketing; not real
// coverage polygons.
const VEXCEL_COVERAGE_BOXES: [number, number, number, number][] = [
  [24, -125, 60, -52],  // US + southern/populated Canada
  [36, -10, 60, 20],    // Western/Central Europe
  [-44, 112, -10, 154], // Australia
  [-47, 166, -34, 179], // New Zealand
]

export function isInVexcelCoverageArea(lat: number, lng: number): boolean {
  return VEXCEL_COVERAGE_BOXES.some(([minLat, minLng, maxLat, maxLng]) => lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng)
}

const VEXCEL_COVERAGE_START_YEAR = 2016

export interface VexcelYearTick {
  dateMs: number
  label: string
  year: number
}

/** SYNTHETIC once-a-year placeholder ticks — see header. Not a real
 *  per-location catalog like lib/nearmap.ts's Coverage-API-driven ticks. */
export function vexcelAnnualTicks(): VexcelYearTick[] {
  const ticks: VexcelYearTick[] = []
  const nowYear = new Date().getUTCFullYear()
  // Day 5 (not 1/3) — distinct day-of-month offset from every other
  // synthetic-cadence source in this app (lib/hls.ts, lib/planet.ts), same
  // "never land on the exact same tick date" reasoning as those.
  for (let year = VEXCEL_COVERAGE_START_YEAR; year <= nowYear; year++) {
    const d = Date.UTC(year, 5, 5) // June 5th — mid-year, arbitrary
    ticks.push({ dateMs: d, label: String(year), year })
  }
  return ticks
}

function nearestVexcelYear(dateMs: number): number {
  const ticks = vexcelAnnualTicks()
  let best = ticks[ticks.length - 1]?.year ?? VEXCEL_COVERAGE_START_YEAR
  let bestDist = Infinity
  for (const t of ticks) {
    const dist = Math.abs(t.dateMs - dateMs)
    if (dist < bestDist) { best = t.year; bestDist = dist }
  }
  return best
}

/** WMTS GetTile URL template for the year nearest `dateMs` — UNVERIFIED
 *  whether `time`/`year`/a per-year layer suffix is the real mechanism (see
 *  header); `time` is used here as the most standards-consistent guess
 *  (matches the OGC WMTS Dimension convention CDSE's own Sentinel Hub WMS
 *  uses — see lib/sentinel-hub.ts). */
export function vexcelTileUrl(token: string, dateMs: number): string {
  const year = nearestVexcelYear(dateMs)
  const params = new URLSearchParams({
    service: "WMTS", request: "GetTile", version: "1.0.0",
    layer: VEXCEL_ORTHO_LAYER, style: "default",
    format: "image/jpeg", tilematrixset: "EPSG:3857",
    time: String(year),
    token,
  })
  return `${VEXCEL_WMTS_BASE}?${params.toString()}&tilematrix=EPSG:3857:{z}&tilecol={x}&tilerow={y}`
}
