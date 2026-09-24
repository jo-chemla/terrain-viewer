// Planet's global monthly basemap mosaics as a 4th historical/date-driven
// source — gated behind a Planet API key (Settings > API Keys) since these
// tiles require authentication, unlike Wayback/HLS/GE.
export const PLANET_TILE_SIZE = 256
export const PLANET_MAXZOOM = 15

export function planetTileUrl(dateMs: number, apiKey: string): string {
  const d = new Date(dateMs)
  const basemapDateStr = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`
  return `https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_${basemapDateStr}_mosaic/gmap/{z}/{x}/{y}.png?api_key=${apiKey}`
}

// Unlike lib/hls.ts's synthetic placeholder ticks, Planet's global monthly
// mosaic product genuinely IS monthly — every one of these ticks is a real
// mosaic that exists (subject to Planet's own coverage start).
const PLANET_COVERAGE_START_MS = Date.parse("2016-09-01T00:00:00Z")

// Ticks land on the 2nd of each month (not the 1st) — HLS's own synthetic
// ticks (lib/hls.ts) and EOX's yearly ticks (lib/eox-s2-cloudless.ts) each
// use a different day-of-month offset too, so the three sources' otherwise-
// identical monthly/yearly cadence never lands on the exact same
// millisecond (a real, recurring collision, not just a rare coincidence —
// e.g. every January). planetTileUrl only reads the tick's year+month, so
// this is purely a display/positioning nudge and never changes which mosaic
// actually loads.
export function planetMonthlyTicks(range?: PlanetMonthlyRange | null): { dateMs: number; label: string }[] {
  const nowMs = range?.endMs ?? Date.now()
  const ticks: { dateMs: number; label: string }[] = []
  const d = new Date(range?.startMs ?? PLANET_COVERAGE_START_MS)
  d.setUTCDate(2)
  while (d.getTime() <= nowMs) {
    ticks.push({ dateMs: d.getTime(), label: d.toISOString().slice(0, 7) })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return ticks
}

/** The monthly mosaics a key can actually see. A subscription does not
 *  necessarily reach back to 2016: the Planetary Security basemaps grant
 *  starts at global_monthly_2020_01, and a tick before a key's first mosaic
 *  just 404s tile by tile, which reads as "Planet does not work". Read once
 *  per key from the Basemaps API (the same api_key query the tiles use),
 *  paged, and reduced to the first and last global_monthly_* names. */
export interface PlanetMonthlyRange { startMs: number; endMs: number; count: number }
const rangeCache = new Map<string, Promise<PlanetMonthlyRange | null>>()
export function fetchPlanetMonthlyRange(apiKey: string): Promise<PlanetMonthlyRange | null> {
  if (!apiKey) return Promise.resolve(null)
  const cached = rangeCache.get(apiKey)
  if (cached) return cached
  const p = (async () => {
    const names: string[] = []
    let url: string | null = `https://api.planet.com/basemaps/v1/mosaics?api_key=${encodeURIComponent(apiKey)}&_page_size=500`
    for (let i = 0; url && i < 10; i++) {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`Planet mosaics ${r.status}`)
      const j = (await r.json()) as { mosaics?: { name: string }[]; _links?: { _next?: string } }
      for (const m of j.mosaics ?? []) names.push(m.name)
      url = j._links?._next ?? null
    }
    const monthly = names.map((n) => /^global_monthly_(\d{4})_(\d{2})_mosaic$/.exec(n)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => Date.UTC(+m[1], +m[2] - 1, 2)).sort((a, b) => a - b)
    if (!monthly.length) return null
    return { startMs: monthly[0], endMs: monthly[monthly.length - 1], count: monthly.length }
  })().catch(() => { rangeCache.delete(apiKey); return null })
  rangeCache.set(apiKey, p)
  return p
}
