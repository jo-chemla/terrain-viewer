import { pixelView, writeTerrainrgbPx } from "./elevation-encoding"
import { sharedTileCache, fetchDecodedTile, type DecodedTile, type UpstreamEncoding } from "./normal-derived-protocol"
import { toTileImage, type TileImage } from "./tile-image"

/**
 * `demdiff://` - a derived DEM that is the difference of two elevation
 * sources, tile by tile: minuend minus subtrahend. The canonical use is a
 * normalised height model, DSM minus DTM: what stands on the ground
 * (canopy, buildings) with the ground itself subtracted, so 0 is bare
 * earth and 25 m is a 25 m tree, whatever the terrain underneath.
 *
 * The output is an ordinary Terrain-RGB tile, so the result behaves like any
 * other terrain source: 3D terrain shows the objects' heights, and every viz
 * mode (hillshade, hypsometric tint, slope, contours, ...) reads the
 * difference as if it were elevation - a hypsometric ramp from 0 to 40 m is
 * a canopy-height map.
 *
 * Both operands are fetched through the same decoded-tile cache the viz
 * protocols use (cog://, titiler, TMS, float32dem:// all work), at the same
 * z/x/y, so the two grids line up pixel for pixel whatever their native
 * resolutions; an operand with no tile that deep is read from its nearest
 * ancestor tile and upsampled bilinearly. A pixel missing from either side
 * (nodata, or nothing within 6 zoom levels) is written as 0 m, flagged with
 * alpha 254 so downstream decoders know it is a hole while MapLibre keeps
 * the terrain flat there rather than digging a pit to the Terrain-RGB
 * floor.
 *
 * URL: demdiff://<encA>/<encB>/<tileSize>/<encoded template A>/<encoded template B>/{z}/{x}/{y}
 */
// The size segment may carry each operand's start depth, "256~2~0": an
// operand whose tiles are larger than the output's (a 1024 px WMS under
// 256 px difference tiles) is read from its ancestor that many levels up, at
// its own pixel density, instead of asking it for every small tile.
//
// Two more fields may follow, "256~0~0~17~12": each operand's maxzoom (in its
// own tile numbering, empty when unknown). A 30 m DEM under a 0.5 m DSM has
// no tile at z18, and without this every tile first asked the coarse source
// for z18, z17 ... down to z12, one failed request after another, before
// reaching the tile that exists; past 6 levels it gave up (2026-11-17).
const DEMDIFF_URL_RE = /^demdiff:\/\/(terrarium|mapbox)\/(terrarium|mapbox)\/(\d+)(?:~(\d+)~(\d+)(?:~(\d*)~(\d*))?)?\/(-?[\d.]+)\/([^/]+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildDemDiffUrl(
  minuend: { template: string; encoding: UpstreamEncoding; tileSize?: number; maxzoom?: number },
  subtrahend: { template: string; encoding: UpstreamEncoding; tileSize?: number; maxzoom?: number },
  tileSize: number,
  /** Metres added to every difference (see CustomTerrainSource.diffOffsetM). */
  offsetM = 0,
): string {
  // Embedded templates keep their own {z}/{x}/{y} percent-encoded so
  // maplibre's literal placeholder substitution only touches the trailing ones.
  const depth = (op: { tileSize?: number }) => Math.max(0, Math.round(Math.log2((op.tileSize ?? tileSize) / tileSize)))
  const dA = depth(minuend), dB = depth(subtrahend)
  const max = (op: { maxzoom?: number }) => (typeof op.maxzoom === "number" && Number.isFinite(op.maxzoom) ? String(Math.round(op.maxzoom)) : "")
  const mA = max(minuend), mB = max(subtrahend)
  const size = mA || mB ? `${tileSize}~${dA}~${dB}~${mA}~${mB}` : dA || dB ? `${tileSize}~${dA}~${dB}` : `${tileSize}`
  return `demdiff://${minuend.encoding}/${subtrahend.encoding}/${size}/${offsetM}/${encodeURIComponent(minuend.template)}/${encodeURIComponent(subtrahend.template)}/{z}/{x}/{y}`
}

export const fillTileTemplate = (u: string, z: number, x: number, y: number) => u.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))

/** An operand's tile at z/x/y, or - when the source has no tile that deep
 *  (a 30 m DEM under a 0.5 m DSM) - the nearest ancestor that exists, with
 *  the sub-window to read: the coarser side is then upsampled bilinearly
 *  on the fly, up to 6 levels, instead of going missing above its maxzoom. */
export type Operand = { tile: DecodedTile; scale: number; ox: number; oy: number }

// Where a source stops, remembered: a tile that came back missing while a
// coarser ancestor exists. In a pyramid, nothing exists below a missing tile,
// so every later request under it skips straight to the level that answered
// (one z13 miss covers 256 z17 tiles) instead of one failed request per level
// per tile; misses are not cached anywhere else. Kept per place, not per
// source: Mapterhorn is z12 worldwide and z17 over Switzerland. Entries expire
// (a miss may have been a network error) and the map is bounded.
const MISS_TTL_MS = 10 * 60_000
const MISS_MAX = 4000
const missingTiles = new Map<string, number>()
const missKey = (template: string, z: number, x: number, y: number) => `${z}/${x}/${y}|${template}`
function knownMissing(template: string, z: number, x: number, y: number, now: number): boolean {
  // The tile itself or any ancestor up to 8 levels.
  for (let u = 0; u <= 8 && z - u >= 0; u++) {
    const key = missKey(template, z - u, x >> u, y >> u)
    const at = missingTiles.get(key)
    if (at === undefined) continue
    if (now - at < MISS_TTL_MS) return true
    missingTiles.delete(key)
  }
  return false
}
function rememberMissing(template: string, z: number, x: number, y: number, now: number): void {
  if (missingTiles.size >= MISS_MAX) {
    let drop = MISS_MAX >> 2
    for (const key of missingTiles.keys()) { missingTiles.delete(key); if (--drop <= 0) break }
  }
  missingTiles.set(missKey(template, z, x, y), now)
}

export async function fetchOperand(template: string, enc: UpstreamEncoding, z: number, x: number, y: number, signal: AbortSignal, startDepth = 0): Promise<Operand | null> {
  const now = Date.now()
  const missed: number[] = []
  for (let d = startDepth; d <= startDepth + 6 && z - d >= 0; d++) {
    // The last level of the walk is always asked, so a stale memory cannot
    // turn a tile that exists into nodata.
    const last = d === startDepth + 6 || z - d === 0
    if (!last && knownMissing(template, z - d, x >> d, y >> d, now)) continue
    const tile = await fetchDecodedTile(sharedTileCache, fillTileTemplate(template, z - d, x >> d, y >> d), enc, signal)
    if (tile) {
      for (const m of missed) rememberMissing(template, z - m, x >> m, y >> m, now)
      const scale = 1 << d
      return { tile, scale, ox: x - ((x >> d) << d), oy: y - ((y >> d) << d) }
    }
    if (signal.aborted) return null
    missed.push(d)
  }
  return null
}

/** Bilinear sample of an operand at output pixel (row, col) of an n-px tile,
 *  honouring the validity mask and the DEM sentinels. */
export function sampleOperand(op: Operand | null, row: number, col: number, n: number): number {
  if (!op) return NaN
  const { tile: t, scale, ox, oy } = op
  // Position in the ancestor tile, in its own pixels.
  const fx = ((col + 0.5) / n + ox) / scale * t.width - 0.5
  const fy = ((row + 0.5) / n + oy) / scale * t.height - 0.5
  const x0 = Math.max(0, Math.min(t.width - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(t.height - 1, Math.floor(fy)))
  const x1 = Math.min(t.width - 1, x0 + 1), y1 = Math.min(t.height - 1, y0 + 1)
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0))
  const at = (xx: number, yy: number) => {
    const i = yy * t.width + xx
    if (t.valid && !t.valid[i]) return NaN
    const v = t.data[i]
    return v < -1000 || v > 10000 ? NaN : v
  }
  const v00 = at(x0, y0), v10 = at(x1, y0), v01 = at(x0, y1), v11 = at(x1, y1)
  if (![v00, v10, v01, v11].every(Number.isFinite)) return Number.isFinite(v00) ? v00 : NaN
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
}

/** sampleOperand for every pixel of an n-px tile at once (NaN = nodata).
 *  A pixel's two source columns and their weight depend on its column alone,
 *  and likewise for rows, so they are worked out once per column and per row;
 *  the arithmetic per pixel is sampleOperand's own, in the same order, so the
 *  values are identical. Float64, as sampleOperand returns. */
export function sampleOperandTile(op: Operand | null, n: number): Float64Array {
  const out = new Float64Array(n * n)
  if (!op) return out.fill(NaN)
  const { tile: t, scale, ox, oy } = op
  const { data, valid, width, height } = t
  const X0 = new Int32Array(n), X1 = new Int32Array(n), TX = new Float64Array(n)
  for (let col = 0; col < n; col++) {
    const fx = ((col + 0.5) / n + ox) / scale * width - 0.5
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)))
    X0[col] = x0; X1[col] = Math.min(width - 1, x0 + 1); TX[col] = Math.max(0, Math.min(1, fx - x0))
  }
  for (let row = 0; row < n; row++) {
    const fy = ((row + 0.5) / n + oy) / scale * height - 0.5
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)))
    const y1 = Math.min(height - 1, y0 + 1)
    const ty = Math.max(0, Math.min(1, fy - y0))
    const r0 = y0 * width, r1 = y1 * width
    for (let col = 0; col < n; col++) {
      const i00 = r0 + X0[col], i10 = r0 + X1[col], i01 = r1 + X0[col], i11 = r1 + X1[col]
      const v00 = data[i00], v10 = data[i10], v01 = data[i01], v11 = data[i11]
      // A cell counts when it is not masked and inside the DEM range (the
      // comparisons are false for NaN, as Number.isFinite was).
      const ok00 = !(valid && !valid[i00]) && v00 >= -1000 && v00 <= 10000
      if (ok00 && !(valid && !valid[i10]) && v10 >= -1000 && v10 <= 10000
        && !(valid && !valid[i01]) && v01 >= -1000 && v01 <= 10000
        && !(valid && !valid[i11]) && v11 >= -1000 && v11 <= 10000) {
        const tx = TX[col]
        out[row * n + col] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
      } else {
        out[row * n + col] = ok00 ? v00 : NaN
      }
    }
  }
  return out
}

export async function demDiffProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const m = params.url.match(DEMDIFF_URL_RE)
  if (!m) throw new Error(`Invalid demdiff protocol URL: ${params.url}`)
  const [, encA, encB, sizeStr, dAStr, dBStr, mAStr, mBStr, offsetStr, tplA, tplB, zS, xS, yS] = m
  const z = parseInt(zS, 10), x = parseInt(xS, 10), y = parseInt(yS, 10)
  // Start depth: the tile-size shift, or deeper when the operand is known to
  // stop above the zoom that shift would ask for.
  const depth = (dStr: string | undefined, maxStr: string | undefined) => {
    const d = parseInt(dStr ?? "0", 10) || 0
    return maxStr ? Math.max(d, z - parseInt(maxStr, 10)) : d
  }
  const dA = depth(dAStr, mAStr), dB = depth(dBStr, mBStr)
  const n = parseInt(sizeStr, 10)
  const offset = parseFloat(offsetStr) || 0
  const [a, b] = await Promise.all([
    fetchOperand(decodeURIComponent(tplA), encA as UpstreamEncoding, z, x, y, abortController.signal, dA),
    fetchOperand(decodeURIComponent(tplB), encB as UpstreamEncoding, z, x, y, abortController.signal, dB),
  ])
  if (abortController.signal.aborted) throw new Error("aborted")

  const gridA = sampleOperandTile(a, n), gridB = sampleOperandTile(b, n)
  const out = new Uint8ClampedArray(n * n * 4)
  const out32 = pixelView(out)
  for (let p = 0; p < n * n; p++) {
    const va = gridA[p], vb = gridB[p]
    // A hole is written as 0 m with alpha 254: MapLibre reads the colour
    // channels and keeps the terrain flat there (a transparent floor pixel
    // made a 10 km pit along every nodata edge), while this app's decoders
    // still see the cell as invalid - the same convention as the in-browser
    // COG reader's own tiles (makeElevationColorFunction in MapSources.tsx).
    const hole = !(Number.isFinite(va) && Number.isFinite(vb))
    writeTerrainrgbPx(out, out32, p, hole ? 0 : va - vb + offset, hole ? 254 : 255)
  }
  return { data: await toTileImage(out, n, n) }
}
