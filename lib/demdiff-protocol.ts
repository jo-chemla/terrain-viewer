import { elevationToTerrainrgb } from "./elevation-encoding"
import { sharedTileCache, fetchDecodedTile, type DecodedTile, type UpstreamEncoding } from "./normal-derived-protocol"

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
const DEMDIFF_URL_RE = /^demdiff:\/\/(terrarium|mapbox)\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildDemDiffUrl(
  minuend: { template: string; encoding: UpstreamEncoding },
  subtrahend: { template: string; encoding: UpstreamEncoding },
  tileSize: number,
): string {
  // Embedded templates keep their own {z}/{x}/{y} percent-encoded so
  // maplibre's literal placeholder substitution only touches the trailing ones.
  return `demdiff://${minuend.encoding}/${subtrahend.encoding}/${tileSize}/${encodeURIComponent(minuend.template)}/${encodeURIComponent(subtrahend.template)}/{z}/{x}/{y}`
}

const fill = (u: string, z: number, x: number, y: number) => u.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))

/** An operand's tile at z/x/y, or - when the source has no tile that deep
 *  (a 30 m DEM under a 0.5 m DSM) - the nearest ancestor that exists, with
 *  the sub-window to read: the coarser side is then upsampled bilinearly
 *  on the fly, up to 6 levels, instead of going missing above its maxzoom. */
type Operand = { tile: DecodedTile; scale: number; ox: number; oy: number }
async function fetchOperand(template: string, enc: UpstreamEncoding, z: number, x: number, y: number, signal: AbortSignal): Promise<Operand | null> {
  for (let d = 0; d <= 6 && z - d >= 0; d++) {
    const tile = await fetchDecodedTile(sharedTileCache, fill(template, z - d, x >> d, y >> d), enc, signal)
    if (tile) {
      const scale = 1 << d
      return { tile, scale, ox: x - ((x >> d) << d), oy: y - ((y >> d) << d) }
    }
    if (signal.aborted) return null
  }
  return null
}

/** Bilinear sample of an operand at output pixel (row, col) of an n-px tile,
 *  honouring the validity mask and the DEM sentinels. */
function sampleOperand(op: Operand | null, row: number, col: number, n: number): number {
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

export async function demDiffProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const m = params.url.match(DEMDIFF_URL_RE)
  if (!m) throw new Error(`Invalid demdiff protocol URL: ${params.url}`)
  const [, encA, encB, sizeStr, tplA, tplB, zS, xS, yS] = m
  const z = parseInt(zS, 10), x = parseInt(xS, 10), y = parseInt(yS, 10)
  const n = parseInt(sizeStr, 10)
  const [a, b] = await Promise.all([
    fetchOperand(decodeURIComponent(tplA), encA as UpstreamEncoding, z, x, y, abortController.signal),
    fetchOperand(decodeURIComponent(tplB), encB as UpstreamEncoding, z, x, y, abortController.signal),
  ])
  if (abortController.signal.aborted) throw new Error("aborted")

  const out = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const va = sampleOperand(a, row, col, n), vb = sampleOperand(b, row, col, n)
      const i = (row * n + col) * 4
      // A hole is written as 0 m with alpha 254: MapLibre reads the colour
      // channels and keeps the terrain flat there (a transparent floor pixel
      // made a 10 km pit along every nodata edge), while this app's decoders
      // still see the cell as invalid - the same convention as the in-browser
      // COG reader's own tiles (makeElevationColorFunction in MapSources.tsx).
      const hole = !(Number.isFinite(va) && Number.isFinite(vb))
      const [r, g, bl] = elevationToTerrainrgb(hole ? 0 : va - vb)
      out[i] = r; out[i + 1] = g; out[i + 2] = bl; out[i + 3] = hole ? 254 : 255
    }
  }
  const canvas = new OffscreenCanvas(n, n)
  canvas.getContext("2d")!.putImageData(new ImageData(out, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
