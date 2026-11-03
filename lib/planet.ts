// Planet's global monthly basemap mosaics as a 4th historical/date-driven
// source — gated behind a Planet API key (Settings > API Keys) since these
// tiles require authentication, unlike Wayback/HLS/GE.
// Every tile counts against a quota that has to last the whole grant, so the
// key is left out of production builds (planetKeyFromEnv in vite.config.ts),
// the ticks are computed rather than listed, and the map waits for the
// timeline to settle before asking for a month (MapSources.tsx).
export const PLANET_TILE_SIZE = 256
export const PLANET_MAXZOOM = 15

export function planetTileUrl(dateMs: number, apiKey: string): string {
  const d = new Date(dateMs)
  const basemapDateStr = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`
  return `https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_${basemapDateStr}_mosaic/gmap/{z}/{x}/{y}.png?api_key=${apiKey}`
}

// Unlike lib/hls.ts's synthetic placeholder ticks, Planet's global monthly
// mosaic product genuinely IS monthly — every one of these ticks is a real
// mosaic that exists. The Planetary Security grant starts at
// global_monthly_2020_01, and a mosaic is published some weeks after its month
// ends: on 2026-11-03 the newest was 2026_09, hence two months back.
const PLANET_COVERAGE_START_MS = Date.parse("2020-01-01T00:00:00Z")
const PLANET_PUBLICATION_LAG_MONTHS = 2

// Ticks land on the 2nd of each month (not the 1st) — HLS's own synthetic
// ticks (lib/hls.ts) and EOX's yearly ticks (lib/eox-s2-cloudless.ts) each
// use a different day-of-month offset too, so the three sources' otherwise-
// identical monthly/yearly cadence never lands on the exact same
// millisecond (a real, recurring collision, not just a rare coincidence —
// e.g. every January). planetTileUrl only reads the tick's year+month, so
// this is purely a display/positioning nudge and never changes which mosaic
// actually loads.
export function planetMonthlyTicks(nowMs: number = Date.now()): { dateMs: number; label: string }[] {
  const now = new Date(nowMs)
  const lastMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - PLANET_PUBLICATION_LAG_MONTHS, 2)
  const ticks: { dateMs: number; label: string }[] = []
  const d = new Date(PLANET_COVERAGE_START_MS)
  d.setUTCDate(2)
  while (d.getTime() <= lastMs) {
    ticks.push({ dateMs: d.getTime(), label: d.toISOString().slice(0, 7) })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return ticks
}
