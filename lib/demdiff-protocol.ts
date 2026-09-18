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
 * resolutions. A pixel missing from either side is written as 0.
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
    fetchDecodedTile(sharedTileCache, fill(decodeURIComponent(tplA), z, x, y), encA as UpstreamEncoding, abortController.signal),
    fetchDecodedTile(sharedTileCache, fill(decodeURIComponent(tplB), z, x, y), encB as UpstreamEncoding, abortController.signal),
  ])
  if (abortController.signal.aborted) throw new Error("aborted")

  // Nearest sample when an operand's tile size differs from the output's
  // (a 512 px float32dem tile against 256 px TMS tiles).
  // A sample is missing when the tile is, when titiler wrote it transparent
  // (nodata), or when it decodes to a sentinel no real DEM holds (terrarium
  // -32768 for RGB 0, terrainrgb -10000): those would otherwise produce
  // 30 km "heights" along every nodata edge.
  const sample = (t: DecodedTile | null, row: number, col: number): number => {
    if (!t) return NaN
    const r = Math.min(t.height - 1, Math.floor((row * t.height) / n))
    const c = Math.min(t.width - 1, Math.floor((col * t.width) / n))
    const i = r * t.width + c
    if (t.valid && !t.valid[i]) return NaN
    const v = t.data[i]
    return v < -1000 || v > 10000 ? NaN : v
  }
  const out = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const va = sample(a, row, col), vb = sample(b, row, col)
      const d = Number.isFinite(va) && Number.isFinite(vb) ? va - vb : 0
      const [r, g, bl, al] = elevationToTerrainrgb(d)
      const i = (row * n + col) * 4
      out[i] = r; out[i + 1] = g; out[i + 2] = bl; out[i + 3] = al
    }
  }
  const canvas = new OffscreenCanvas(n, n)
  canvas.getContext("2d")!.putImageData(new ImageData(out, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
