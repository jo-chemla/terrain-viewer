// Heights along the river centerline, read from the same upstream DEM tiles
// (and through the same decoded-tile cache) as the riverrem:// tiles and every
// other derived mode: whatever `useClientDemUpstream` resolves a terrain
// source to (XYZ, COG, VRT, WMS, a difference...) is read here without this
// file knowing which.

import { sharedTileCache, fetchDecodedTile, type DecodedTile, type UpstreamEncoding } from "./normal-derived-protocol"
import type { LngLat } from "./river-rem"

export interface RiverSampleSource { template: string; encoding: UpstreamEncoding; tileSize: number; minzoom?: number; maxzoom?: number }

/** Most tiles one centerline may read. A long river is sampled a zoom or two
 *  lower rather than fetching hundreds of tiles: the water level varies
 *  slowly, the sampled width does not matter much. */
const MAX_SAMPLE_TILES = 48
/** Never sample above this zoom: at z15 a 512 px tile is about 1 m a pixel,
 *  finer adds tiles without a better water level. */
const MAX_SAMPLE_ZOOM = 15

const tileFractionX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z
function tileFractionY(lat: number, z: number): number {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

function countTiles(points: LngLat[], z: number): number {
  const seen = new Set<number>()
  const span = 2 ** z
  for (const [lng, lat] of points) seen.add(Math.floor(tileFractionY(lat, z)) * span + Math.floor(tileFractionX(lng, z)))
  return seen.size
}

/** The zoom the centerline is read at: the source's finest, lowered until the
 *  line touches few enough tiles. */
export function pickSampleZoom(points: LngLat[], source: RiverSampleSource): number {
  const floor = source.minzoom ?? 0
  let z = Math.max(floor, Math.min(source.maxzoom ?? 14, MAX_SAMPLE_ZOOM))
  while (z > floor && countTiles(points, z) > MAX_SAMPLE_TILES) z--
  return z
}

function bilinear(tile: DecodedTile, fx: number, fy: number): number {
  const { data, width, height, valid } = tile
  const px = Math.min(width - 1, Math.max(0, fx * width - 0.5))
  const py = Math.min(height - 1, Math.max(0, fy * height - 0.5))
  const x0 = Math.floor(px), y0 = Math.floor(py)
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
  if (valid && !(valid[y0 * width + x0] && valid[y0 * width + x1] && valid[y1 * width + x0] && valid[y1 * width + x1])) return NaN
  const tx = px - x0, ty = py - y0
  return (data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx) * (1 - ty)
    + (data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx) * ty
}

/** Heights at the points, NaN where the source has none. A tile the source
 *  does not serve is read from its parent, up to three levels (a declared
 *  maxzoom is not always backed by tiles everywhere). */
export async function sampleRiverElevations(
  points: LngLat[], source: RiverSampleSource, signal: AbortSignal,
  /** Called as the tiles under the line arrive: tiles read, tiles needed. */
  onProgress?: (done: number, total: number) => void,
): Promise<{ elevations: Float64Array; zoom: number; tiles: number }> {
  const zoom = pickSampleZoom(points, source)
  const floor = source.minzoom ?? 0
  const urlAt = (z: number, x: number, y: number) => source.template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
  const loaded = new Map<string, Promise<{ tile: DecodedTile; z: number } | null>>()
  const span = 2 ** zoom
  const total = countTiles(points, zoom)
  let done = 0
  const load = (x: number, y: number) => {
    const key = `${x}/${y}`
    let pending = loaded.get(key)
    if (!pending) {
      pending = (async () => {
        try {
          for (let up = 0; up <= 3 && zoom - up >= floor; up++) {
            if (signal.aborted) return null
            const tile = await fetchDecodedTile(sharedTileCache, urlAt(zoom - up, x >> up, y >> up), source.encoding, signal)
            if (tile) return { tile, z: zoom - up }
          }
          return null
        } finally {
          done++
          if (!signal.aborted) onProgress?.(done, total)
        }
      })()
      loaded.set(key, pending)
    }
    return pending
  }
  const elevations = new Float64Array(points.length).fill(NaN)
  await Promise.all(points.map(async ([lng, lat], i) => {
    const tx = Math.min(span - 1, Math.max(0, Math.floor(tileFractionX(lng, zoom))))
    const ty = Math.min(span - 1, Math.max(0, Math.floor(tileFractionY(lat, zoom))))
    const hit = await load(tx, ty)
    if (!hit) return
    const fx = tileFractionX(lng, hit.z), fy = tileFractionY(lat, hit.z)
    elevations[i] = bilinear(hit.tile, fx - Math.floor(fx), fy - Math.floor(fy))
  }))
  return { elevations, zoom, tiles: loaded.size }
}
