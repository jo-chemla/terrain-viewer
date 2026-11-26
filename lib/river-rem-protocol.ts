// `riverrem://` - the River REM as live tiles: the upstream DEM tile minus the
// trend surface that follows the river (lib/river-rem.ts builds it), written
// as Terrarium so the layer is an ordinary raster-dem source drawn with a
// color-relief ramp, exported, contoured and picked like every other derived
// mode.
//
//   riverrem://<encoding>/<tileSize>/<encoded upstream template>/{z}/{x}/{y}?rev=<n>
//   riverrem://...?rev=<n>&abs=1     the same heights with no trend removed
//
// The trend grid is too big for a URL, so it lives here, in one module-level
// slot, and the URL carries its revision: a new centerline or a new parameter
// stores a new grid under the next revision, the source's `tiles` change, and
// MapLibre (and the result cache, keyed by URL) fetch fresh tiles. No map is
// remounted. A tile asked under an older revision is answered from the
// current grid: it is on its way out of the screen anyway.
//
// `abs=1` is the mode's Elevation display: the terrain source's own heights
// through the same kernel (and the same smoothing of a rounded DEM), so the
// REM / Elevation switch changes the picture and nothing else. It needs no
// trend, so it draws before the river is found.

import { pixelView, writeTerrariumPx } from "./elevation-encoding"
import { sharedTileCache, fetchDecodedTile, fetchPaddedElevationGrid, buildProtocolUrl, yieldToMainThread, type UpstreamEncoding } from "./normal-derived-protocol"
import { toTileImage, type TileImage } from "./tile-image"
import { MERCATOR_HALF, quantizationStep, dequantizeDem, type TrendGrid } from "./river-rem"

const RIVER_REM_URL_RE = /^riverrem:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?rev=(\d+)(&abs=1)?$/

/** Box-blur radii of the smoothing of a rounded DEM, and their sum: the halo
 *  read around the tile so two neighbors compute the same edge. */
const DEQUANTIZE_RADII = [24, 16, 8] as const
const DEQUANTIZE_HALO = 48

// On globalThis for the same reason as the protocol registry's table: a hot
// reload of this module must not leave the registered handler reading an
// empty copy.
type TileRange = { z: number; x: number; y: number; samples: Float32Array }
type Slot = {
  grid: TrendGrid | null
  revision: number
  /** Tiles answered since the last reset, and the time spent in them. */
  stats: { tiles: number; ms: number; step: number }
  /** A 16 x 16 sample of the heights of each Elevation tile, newest last. */
  ranges: Map<string, TileRange>
  listeners: Set<() => void>
}
const slot: Slot = ((globalThis as { __tvRiverRemTrend?: Slot }).__tvRiverRemTrend ??= { grid: null, revision: 0, stats: { tiles: 0, ms: 0, step: 0 }, ranges: new Map(), listeners: new Set() })
slot.stats ??= { tiles: 0, ms: 0, step: 0 }
slot.ranges ??= new Map()
slot.listeners ??= new Set()

/** Stores the trend and returns its revision, for the tile URL. */
export function setRiverRemTrend(grid: TrendGrid | null): number {
  slot.grid = grid
  slot.revision++
  return slot.revision
}
export function getRiverRemTrend(): TrendGrid | null { return slot.grid }
export function getRiverRemRevision(): number { return slot.revision }

/** Tiles computed since `resetRiverRemTileStats`, the time they took, and the
 *  vertical step of the last rounded DEM tile met (0: none). */
export function getRiverRemTileStats(): { tiles: number; ms: number; step: number } { return slot.stats }
export function resetRiverRemTileStats(): void { slot.stats = { tiles: 0, ms: 0, step: 0 } }
/** Called after every tile (the progress toast, the Elevation range). */
export function onRiverRemTile(listener: () => void): () => void {
  slot.listeners.add(listener)
  return () => { slot.listeners.delete(listener) }
}

/** The 2nd and 98th percentile of the heights of the Elevation tiles that
 *  meet a box (degrees), at the finest zoom available there; null before any
 *  is computed. Percentiles, not the extremes: one bluff or one pit at the
 *  edge of the view would spend the whole ramp (27.8 to 69.8 m for a
 *  floodplain that lies between 28 and 42 m). */
export function riverRemElevationRange(bbox: [number, number, number, number]): { min: number; max: number } | null {
  let bestZ = -1
  let picked: Float32Array[] = []
  const [w, s, e, n] = bbox
  const lngOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180
  const latOf = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
  for (const t of slot.ranges.values()) {
    if (lngOf(t.x + 1, t.z) < w || lngOf(t.x, t.z) > e || latOf(t.y, t.z) < s || latOf(t.y + 1, t.z) > n) continue
    if (t.z > bestZ) { bestZ = t.z; picked = [] }
    if (t.z < bestZ) continue
    picked.push(t.samples)
  }
  const total = picked.reduce((sum, s) => sum + s.length, 0)
  if (total < 2) return null
  const all = new Float32Array(total)
  let offset = 0
  for (const s of picked) { all.set(s, offset); offset += s.length }
  all.sort()
  const min = all[Math.floor(0.02 * (total - 1))], max = all[Math.ceil(0.98 * (total - 1))]
  return max > min ? { min, max } : null
}

/** Up to 16 x 16 heights of a tile, holes left out. */
function sampleHeights(dem: Float32Array, width: number, height: number, valid: Uint8Array | undefined): Float32Array {
  const out = new Float32Array(256)
  let count = 0
  for (let j = 0; j < 16; j++) {
    const row = Math.min(height - 1, Math.floor(((j + 0.5) * height) / 16)) * width
    for (let i = 0; i < 16; i++) {
      const at = row + Math.min(width - 1, Math.floor(((i + 0.5) * width) / 16))
      const v = dem[at]
      if ((valid !== undefined && valid[at] === 0) || !(v === v) || v === Infinity || v === -Infinity) continue
      out[count++] = v
    }
  }
  return out.subarray(0, count)
}

export function buildRiverRemProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, revision: number, absolute = false): string {
  return `${buildProtocolUrl("riverrem", upstreamTileTemplate, encoding, tileSize)}?rev=${revision}${absolute ? "&abs=1" : ""}`
}

/** The kernel: `out` (RGBA, n x n) gets elevation minus trend as Terrarium
 *  (the elevation itself when `grid` is null). A pixel's place in the trend
 *  grid depends on its column or its row alone, so the two cells and the
 *  weight are worked out once per column and once per row
 *  (kernel-performance-rules: nothing allocated per pixel). Nodata (`valid`
 *  0, or a non-finite height) is written 0 with alpha 254, the hole marker of
 *  the other derived sources. Returns the lowest and highest value written. */
export function riverRemKernel(
  dem: Float32Array, demWidth: number, demHeight: number, valid: Uint8Array | undefined,
  n: number, z: number, x: number, y: number, grid: TrendGrid | null, out: Uint8ClampedArray,
): { min: number; max: number } {
  const trend = grid ? grid.data : null
  const w = grid ? grid.w : 1, h = grid ? grid.h : 1
  const x0 = grid ? grid.x0 : 0, x1 = grid ? grid.x1 : 1, y0 = grid ? grid.y0 : 0, y1 = grid ? grid.y1 : 1
  const tiles = 2 ** z
  const scaleX = (w - 1) / (x1 - x0), scaleY = (h - 1) / (y1 - y0)
  const colA = new Int32Array(n), colB = new Int32Array(n), colF = new Float64Array(n), colSrc = new Int32Array(n)
  for (let col = 0; col < n; col++) {
    const mx = (((x + (col + 0.5) / n) / tiles) * 2 - 1) * MERCATOR_HALF
    const gx = Math.min(w - 1, Math.max(0, (mx - x0) * scaleX))
    const a = Math.floor(gx)
    colA[col] = a; colB[col] = Math.min(w - 1, a + 1); colF[col] = gx - a
    colSrc[col] = demWidth === n ? col : Math.min(demWidth - 1, Math.floor(((col + 0.5) * demWidth) / n))
  }
  const out32 = pixelView(out)
  let min = Infinity, max = -Infinity
  for (let row = 0; row < n; row++) {
    const my = (1 - ((y + (row + 0.5) / n) / tiles) * 2) * MERCATOR_HALF
    const gy = Math.min(h - 1, Math.max(0, (y1 - my) * scaleY))
    const rowA = Math.floor(gy)
    const fy = gy - rowA
    const top = rowA * w, bottom = Math.min(h - 1, rowA + 1) * w
    const srcRow = (demHeight === n ? row : Math.min(demHeight - 1, Math.floor(((row + 0.5) * demHeight) / n))) * demWidth
    for (let col = 0; col < n; col++) {
      const source = srcRow + colSrc[col]
      let value = dem[source]
      if (trend !== null) {
        const a = colA[col], b = colB[col], fx = colF[col]
        value -= (trend[top + a] * (1 - fx) + trend[top + b] * fx) * (1 - fy) + (trend[bottom + a] * (1 - fx) + trend[bottom + b] * fx) * fy
      }
      if ((valid !== undefined && valid[source] === 0) || !(value === value) || value === Infinity || value === -Infinity) writeTerrariumPx(out, out32, row * n + col, 0, 254)
      else {
        writeTerrariumPx(out, out32, row * n + col, value)
        if (value < min) min = value
        if (value > max) max = value
      }
    }
  }
  return { min, max }
}

/** The tile's heights with the staircase of a rounded DEM smoothed, or null
 *  when the tile is not rounded (the caller keeps the tile as decoded). The
 *  tile is read again with a halo from its eight neighbors (shared, cached
 *  reads) so the smoothing has no seam at the tile's edge. */
async function dequantizedHeights(
  template: string, encoding: UpstreamEncoding, z: number, x: number, y: number, n: number,
  center: { data: Float32Array; valid?: Uint8Array }, signal: AbortSignal,
): Promise<{ data: Float32Array; valid?: Uint8Array; step: number; ms: number } | null> {
  const t0 = performance.now()
  const step = quantizationStep(center.data, center.valid)
  if (!(step > 0)) return null
  const detectMs = performance.now() - t0
  const grid = await fetchPaddedElevationGrid(sharedTileCache, template, encoding, z, x, y, n, signal, DEQUANTIZE_HALO)
  // Timed without the wait for the neighbors: the statistics are about the
  // computing, the network is the terrain source's.
  const t1 = performance.now()
  const stride = grid.stride
  const padded = grid.padded.slice()
  dequantizeDem(padded, stride, stride, step, DEQUANTIZE_RADII)
  const data = new Float32Array(n * n)
  const valid = grid.paddedValid ? new Uint8Array(n * n) : undefined
  for (let row = 0; row < n; row++) {
    const from = (row + DEQUANTIZE_HALO) * stride + DEQUANTIZE_HALO
    data.set(padded.subarray(from, from + n), row * n)
    if (valid) valid.set(grid.paddedValid!.subarray(from, from + n), row * n)
  }
  return { data, valid, step, ms: detectMs + performance.now() - t1 }
}

export async function riverRemProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(RIVER_REM_URL_RE)
  if (!match) throw new Error(`Invalid River REM protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, , absolute] = match
  const n = parseInt(tileSizeStr, 10)
  const z = parseInt(zStr, 10), x = parseInt(xStr, 10), y = parseInt(yStr, 10)
  const grid = absolute ? null : slot.grid
  if (!absolute && !grid) throw new Error("River REM: no trend surface yet")
  const template = decodeURIComponent(encodedTemplate)
  const encoding = encodingRaw as UpstreamEncoding
  const upstreamUrl = template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
  const tile = await fetchDecodedTile(sharedTileCache, upstreamUrl, encoding, abortController.signal)
  if (!tile) throw new Error(`Failed to fetch River REM elevation tile at ${z}/${x}/${y}`)
  const out = new Uint8ClampedArray(n * n * 4)
  // A halo read that fails (a neighbor off the source's edge, a cancelled
  // pan) must not cost the tile: it is drawn as decoded.
  const smooth = await dequantizedHeights(template, encoding, z, x, y, n, tile, abortController.signal).catch(() => null)
  // The tiles of a new trend all arrive at once (their DEM is cached): a
  // breath between two of them keeps the page answering.
  await yieldToMainThread()
  const started = performance.now()
  const range = smooth
    ? riverRemKernel(smooth.data, n, n, smooth.valid, n, z, x, y, grid, out)
    : riverRemKernel(tile.data, tile.width, tile.height, tile.valid, n, z, x, y, grid, out)
  slot.stats.tiles++
  slot.stats.ms += performance.now() - started + (smooth ? smooth.ms : 0)
  if (smooth) slot.stats.step = smooth.step
  if (absolute && range.max > range.min) {
    const key = `${z}/${x}/${y}`
    slot.ranges.delete(key)
    slot.ranges.set(key, { z, x, y, samples: smooth ? sampleHeights(smooth.data, n, n, smooth.valid) : sampleHeights(tile.data, tile.width, tile.height, tile.valid) })
    if (slot.ranges.size > 600) slot.ranges.delete(slot.ranges.keys().next().value as string)
  }
  const data = await toTileImage(out, n, n)
  for (const listener of slot.listeners) listener()
  return { data }
}
