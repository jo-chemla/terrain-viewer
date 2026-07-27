// A raster-dem source's declared maxzoom (lib/terrain-sources.ts) isn't always
// backed by real coverage at every location — Mapterhorn is the visible
// example: it declares maxzoom 18 globally, but plenty of locations only have
// real tiles down to z15-17 (same gap lib/source-provenance.ts's header and
// lib/elevation-query.ts's client-side sampler already document and work
// around for THEIR own tile fetches). MapLibre's own `<Source maxzoom>` has no
// way to know this per-location, so it dutifully requests z18 for the whole
// viewport, gets 404s, and shows gaps instead of gracefully overzooming a
// real lower-zoom tile the way it would if maxzoom were set correctly.
//
// This probes ONE tile at the viewport center, stepping the zoom down from
// the configured maxzoom until a real tile exists, so callers can clamp the
// `<Source>`'s own maxzoom to something this location actually has —
// exactly the same "declare a lower maxzoom so maplibre overzooms real
// pixels instead of fetching placeholders" fix already applied by hand to
// the Esri basemap (see MapSources.tsx's rasterBasemaps.esri comment), just
// computed per-viewport instead of guessed once and hardcoded.

import { lngLatToTile } from "./source-provenance"

const MAX_STEP_DOWN = 8

// Cached at a coarse zoom-6 tile bucket (~300km square at the equator) keyed
// by URL template — panning within the same region resolves instantly from
// cache instead of re-probing on every viewport-center change.
const CACHE_ZOOM = 6
const cache = new Map<string, Promise<number>>()

function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
}

/** HEAD first (cheap — no tile body downloaded); falls back to a real GET
 *  (the pattern lib/elevation-query.ts and lib/source-provenance.ts already
 *  rely on for these exact tile hosts) if HEAD isn't supported or is blocked
 *  for any reason, so a probe never mistakes "HEAD doesn't work here" for
 *  "no tile exists here". */
async function tileExists(url: string): Promise<boolean> {
  try {
    const headRes = await fetch(url, { method: "HEAD" })
    if (headRes.status !== 405 && headRes.status !== 501) return headRes.ok
  } catch {
    // fall through to GET below
  }
  const res = await fetch(url)
  return res.ok
}

/** Highest zoom (≤ configuredMaxzoom) that actually has a tile at (lng, lat)
 *  for this XYZ template. Returns `configuredMaxzoom` unchanged if every step
 *  down to `configuredMaxzoom - MAX_STEP_DOWN` (or 0) fails — better to fall
 *  back to the configured value than to silently cripple the source over a
 *  transient network hiccup. */
export async function probeMaxZoomAt(
  tileUrlTemplate: string,
  lng: number,
  lat: number,
  configuredMaxzoom: number,
): Promise<number> {
  const { x: bucketX, y: bucketY } = lngLatToTile(lng, lat, CACHE_ZOOM)
  const key = `${tileUrlTemplate}|${configuredMaxzoom}|${bucketX}|${bucketY}`
  const cached = cache.get(key)
  if (cached) return cached

  const promise = (async () => {
    for (let step = 0; step <= MAX_STEP_DOWN; step++) {
      const z = configuredMaxzoom - step
      if (z < 0) break
      const { x, y } = lngLatToTile(lng, lat, z)
      try {
        if (await tileExists(tileUrl(tileUrlTemplate, z, x, y))) return z
      } catch {
        // keep stepping down rather than aborting the whole probe
      }
    }
    return configuredMaxzoom
  })()

  cache.set(key, promise)
  return promise
}
