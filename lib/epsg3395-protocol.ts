// Tiles cut in EPSG:3395 (World Mercator, on the WGS84 ellipsoid) served as
// Web Mercator tiles, registered as `epsg3395://`. Yandex is the one tile
// provider of note on that grid: its satellite layer sits up to a dozen
// kilometres off the Web Mercator tiles at mid latitudes, so it cannot be
// handed to MapLibre as a plain XYZ source. The historical-satellite app
// went through titiler and a GDAL_WMS XML for this; here the warp runs in
// the browser.
//
//   epsg3395://<encoded template>/{z}/{x}/{y}
//
// The two projections share their x axis exactly: the same longitude lands
// on the same column at the same zoom, since both span ±20037508.34 m over
// the same tile count (Yandex's data window is that square in 3395 units,
// the same as the GDAL definition the titiler route used). Only the
// latitude-to-row mapping differs, and by a bounded amount: the ellipsoid
// pulls every row towards the equator. A Web Mercator tile therefore reads
// its columns straight from the 3395 tiles of the same x, at the same zoom,
// and resamples rows alone: for each output row, the 3395 pixel row of that
// latitude, interpolated between its two neighbours. One or two source tiles
// cover one output tile, cached here so neighbours share them.
import { toTileImage, type TileImage } from "./tile-image"

const URL_RE = /^epsg3395:\/\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

const R = 6378137
const E = 0.0818191908426215 // WGS84 first eccentricity
const HALF = Math.PI * R // 20037508.34: half the world in both projections
const TILE = 256

export function buildEpsg3395Url(template: string): string {
  return `epsg3395://${encodeURIComponent(template)}/{z}/{x}/{y}`
}

/** EPSG:3395 northing of a latitude in radians. */
function northing3395(lat: number): number {
  const s = E * Math.sin(lat)
  return R * Math.log(Math.tan(Math.PI / 4 + lat / 2) * Math.pow((1 - s) / (1 + s), E / 2))
}

/** Latitude (radians) at a Web Mercator northing. */
function latFrom3857(y: number): number {
  return 2 * Math.atan(Math.exp(y / R)) - Math.PI / 2
}

const tileUrl = (template: string, z: number, x: number, y: number) =>
  template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)).replace("{-y}", String((1 << z) - 1 - y))

type Pixels = Uint8ClampedArray<ArrayBuffer>

// Source tiles decoded once and shared by the output tiles that straddle
// them (two neighbours in y read the same 3395 tile). Keyed by URL, a small
// LRU: the result cache in front of the protocol holds finished tiles.
const sourceCache = new Map<string, Promise<Pixels | null>>()
const SOURCE_CACHE_MAX = 128

function fetchSourceTile(url: string, signal: AbortSignal): Promise<Pixels | null> {
  const hit = sourceCache.get(url)
  if (hit) return hit
  const p = (async () => {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const bmp = await createImageBitmap(await res.blob())
    const canvas = new OffscreenCanvas(TILE, TILE)
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0, TILE, TILE)
    bmp.close()
    return ctx.getImageData(0, 0, TILE, TILE).data as Pixels
  })()
  // An aborted or failed fetch must not poison the cache: drop it, so the
  // next tile that needs this source requests it again.
  p.catch(() => sourceCache.delete(url))
  sourceCache.set(url, p)
  if (sourceCache.size > SOURCE_CACHE_MAX) sourceCache.delete(sourceCache.keys().next().value!)
  return p
}

export async function epsg3395Protocol(params: { url: string }, abortController: AbortController): Promise<{ data: TileImage }> {
  const m = params.url.match(URL_RE)
  if (!m) throw new Error(`Invalid epsg3395 protocol URL: ${params.url}`)
  const template = decodeURIComponent(m[1])
  const z = +m[2], x = +m[3], y = +m[4]
  const n = 1 << z
  const res = (2 * HALF) / (TILE * n) // metres per pixel at this zoom, both projections

  // The 3395 pixel row (global, at this zoom) of each output row's centre.
  const rows = new Float64Array(TILE)
  for (let r = 0; r < TILE; r++) {
    const y3857 = HALF - (y * TILE + r + 0.5) * res
    rows[r] = (HALF - northing3395(latFrom3857(y3857))) / res - 0.5
  }
  const first = Math.max(0, Math.floor(rows[0])), last = Math.min(n * TILE - 1, Math.ceil(rows[TILE - 1]))
  const tyFirst = Math.floor(first / TILE), tyLast = Math.floor(last / TILE)

  const tiles = new Map<number, Pixels | null>()
  await Promise.all(Array.from({ length: tyLast - tyFirst + 1 }, (_, i) => tyFirst + i).map(async (ty) => {
    tiles.set(ty, await fetchSourceTile(tileUrl(template, z, x, ty), abortController.signal).catch(() => null))
  }))

  const out = new Uint8ClampedArray(TILE * TILE * 4) as Pixels
  const rowOf = (py: number): { px: Pixels; off: number } | null => {
    const ty = Math.floor(py / TILE)
    const px = tiles.get(ty) ?? null
    return px ? { px, off: (py - ty * TILE) * TILE * 4 } : null
  }
  for (let r = 0; r < TILE; r++) {
    const py = rows[r]
    const p0 = Math.max(0, Math.min(n * TILE - 1, Math.floor(py)))
    const p1 = Math.min(n * TILE - 1, p0 + 1)
    const t = Math.max(0, Math.min(1, py - p0))
    const a = rowOf(p0), b = rowOf(p1)
    const o = r * TILE * 4
    if (!a && !b) continue // transparent: nothing served there
    if (!a || !b || t === 0) {
      const src = (a ?? b)!
      out.set(src.px.subarray(src.off, src.off + TILE * 4), o)
      continue
    }
    for (let i = 0; i < TILE * 4; i++) out[o + i] = a.px[a.off + i] + (b.px[b.off + i] - a.px[a.off + i]) * t
  }
  return { data: await toTileImage(out, TILE) }
}
