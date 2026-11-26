// `riverrem://` - the River REM as live tiles: the upstream DEM tile minus the
// trend surface that follows the river (lib/river-rem.ts builds it), written
// as Terrarium so the layer is an ordinary raster-dem source drawn with a
// color-relief ramp, exported and picked like every other derived mode.
//
//   riverrem://<encoding>/<tileSize>/<encoded upstream template>/{z}/{x}/{y}?rev=<n>
//
// The trend grid is too big for a URL, so it lives here, in one module-level
// slot, and the URL carries its revision: a new centerline or a new parameter
// stores a new grid under the next revision, the source's `tiles` change, and
// MapLibre (and the result cache, keyed by URL) fetch fresh tiles. No map is
// remounted. A tile asked under an older revision is answered from the
// current grid: it is on its way out of the screen anyway.

import { pixelView, writeTerrariumPx } from "./elevation-encoding"
import { sharedTileCache, fetchDecodedTile, buildProtocolUrl, type UpstreamEncoding } from "./normal-derived-protocol"
import { toTileImage, type TileImage } from "./tile-image"
import { MERCATOR_HALF, type TrendGrid } from "./river-rem"

const RIVER_REM_URL_RE = /^riverrem:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?rev=(\d+)$/

// On globalThis for the same reason as the protocol registry's table: a hot
// reload of this module must not leave the registered handler reading an
// empty copy.
type Slot = { grid: TrendGrid | null; revision: number }
const slot: Slot = ((globalThis as { __tvRiverRemTrend?: Slot }).__tvRiverRemTrend ??= { grid: null, revision: 0 })

/** Stores the trend and returns its revision, for the tile URL. */
export function setRiverRemTrend(grid: TrendGrid | null): number {
  slot.grid = grid
  slot.revision++
  return slot.revision
}
export function getRiverRemTrend(): TrendGrid | null { return slot.grid }
export function getRiverRemRevision(): number { return slot.revision }

export function buildRiverRemProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, revision: number): string {
  return `${buildProtocolUrl("riverrem", upstreamTileTemplate, encoding, tileSize)}?rev=${revision}`
}

/** The kernel: `out` (RGBA, n x n) gets elevation minus trend as Terrarium.
 *  A pixel's place in the trend grid depends on its column or its row alone,
 *  so the two cells and the weight are worked out once per column and once
 *  per row (kernel-performance-rules: nothing allocated per pixel). Nodata
 *  (`valid` 0, or a non-finite height) is written 0 with alpha 254, the
 *  hole marker of the other derived sources. */
export function riverRemKernel(
  dem: Float32Array, demWidth: number, demHeight: number, valid: Uint8Array | undefined,
  n: number, z: number, x: number, y: number, grid: TrendGrid, out: Uint8ClampedArray,
): void {
  const { data: trend, w, h, x0, y0, x1, y1 } = grid
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
  for (let row = 0; row < n; row++) {
    const my = (1 - ((y + (row + 0.5) / n) / tiles) * 2) * MERCATOR_HALF
    const gy = Math.min(h - 1, Math.max(0, (y1 - my) * scaleY))
    const rowA = Math.floor(gy)
    const fy = gy - rowA
    const top = rowA * w, bottom = Math.min(h - 1, rowA + 1) * w
    const srcRow = (demHeight === n ? row : Math.min(demHeight - 1, Math.floor(((row + 0.5) * demHeight) / n))) * demWidth
    for (let col = 0; col < n; col++) {
      const source = srcRow + colSrc[col]
      const elevation = dem[source]
      const a = colA[col], b = colB[col], fx = colF[col]
      const level = (trend[top + a] * (1 - fx) + trend[top + b] * fx) * (1 - fy) + (trend[bottom + a] * (1 - fx) + trend[bottom + b] * fx) * fy
      const value = elevation - level
      if ((valid !== undefined && valid[source] === 0) || !(value === value) || value === Infinity || value === -Infinity) writeTerrariumPx(out, out32, row * n + col, 0, 254)
      else writeTerrariumPx(out, out32, row * n + col, value)
    }
  }
}

export async function riverRemProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(RIVER_REM_URL_RE)
  if (!match) throw new Error(`Invalid River REM protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const n = parseInt(tileSizeStr, 10)
  const z = parseInt(zStr, 10), x = parseInt(xStr, 10), y = parseInt(yStr, 10)
  const grid = slot.grid
  if (!grid) throw new Error("River REM: no trend surface yet")
  const upstreamUrl = decodeURIComponent(encodedTemplate).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
  const tile = await fetchDecodedTile(sharedTileCache, upstreamUrl, encodingRaw as UpstreamEncoding, abortController.signal)
  if (!tile) throw new Error(`Failed to fetch River REM elevation tile at ${z}/${x}/${y}`)
  const out = new Uint8ClampedArray(n * n * 4)
  riverRemKernel(tile.data, tile.width, tile.height, tile.valid, n, z, x, y, grid, out)
  return { data: await toTileImage(out, n, n) }
}
