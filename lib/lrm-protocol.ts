// Client-side Local Relief Model (LRM) tile computation, registered as the `lrm://`
// maplibre custom protocol. Unlike every other mode in this family (slope, aspect,
// TRI, curvature, TPI, roughness — see lib/normal-derived-protocol.ts), LRM isn't a
// per-pixel function of one 3x3 same-zoom window: it's raw elevation minus a
// low-pass "regional trend" surface, which normally means averaging over a much
// wider neighborhood (tens of pixels) than a 3x3 kernel — expensive if done as a
// literal box/Gaussian blur over same-zoom tiles.
//
// Instead this exploits the tile pyramid itself: an ancestor tile `k` zoom levels up
// is already a downsampled, low-pass version of the same ground area at 2^k× coarser
// resolution — for free, since the tile server (or a COG's baked-in overview level)
// already did that averaging. So LRM here is just:
//   LRM = fineElevation(this tile, native zoom) − bilinear(ancestor tile, k levels up)
// The bilinear step (via bilinearSamplePadded) is what avoids the hard "boxy" edges
// a naive nearest-neighbor pyramid upsample would leave at ancestor-pixel boundaries.
// It needs the ancestor's own 3x3-neighbor-stitched grid (fetchPaddedElevationGrid)
// so sampling near this tile's edges still has real neighbor data to interpolate
// against, not a clamped repeat of the ancestor tile's own edge.
//
// Bonus: the ancestor tile is shared (via the same decoded-tile cache every other
// mode uses) across every one of the up-to-4^k fine-resolution sibling tiles that
// fall within its footprint — so panning around within one ancestor's coverage only
// pays for the coarse fetch once, unlike a same-zoom box blur which can't share any
// work between neighboring output tiles.

import { elevationToTerrarium } from "./elevation-encoding"
import {
  sharedTileCache, fetchDecodedTile, fetchPaddedElevationGrid, bilinearSamplePadded,
  buildProtocolUrl, type UpstreamEncoding, type DecodedTile,
} from "./normal-derived-protocol"

const LRM_URL_RE = /^lrm:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?k=(\d+)$/

// A WMS-raw ("float32dem-bbox://") upstream has no real pre-built overview
// pyramid the way TMS/COG do — each tile is generated on the fly by asking
// the server's GetMap endpoint for whatever bbox+pixel-size is requested.
// For the FINE tile that's a small bbox at native resolution, but for the
// ANCESTOR (k levels up) the bbox is scale× larger per side while this app
// still asked for the SAME n×n pixels — forcing the server to downsample
// scale²× worth of data on its own, by whatever method it defaults to
// (often nearest-neighbor for a WMS GetMap with no explicit INTERPOLATION
// param). That server-side resampling — not this file's own bilinear math —
// is what produces the hard block edges seen on IGN's LidarHD WMS at large
// radii (confirmed absent on Mapterhorn, a real COG/XYZ overview pyramid, at
// the same radius). The fix: ask the WMS for a properly SMALLER image
// (honestly matching how much detail a scale×-coarser area needs) and do
// the upsampling ourselves via bilinear — the same interpolation TMS/COG
// ancestors already get from their own pre-filtered overview levels.
const FLOAT32DEM_BBOX_TEMPLATE_RE = /^float32dem-bbox:\/\/(.+)\/\{z\}\/\{x\}\/\{y\}$/

function rewriteWmsRequestSize(upstreamTemplate: string, size: number): string {
  const match = upstreamTemplate.match(FLOAT32DEM_BBOX_TEMPLATE_RE)
  if (!match) return upstreamTemplate
  const decodedWmsUrl = decodeURIComponent(match[1])
    .replace(/([?&])WIDTH=\d+/i, `$1WIDTH=${size}`)
    .replace(/([?&])HEIGHT=\d+/i, `$1HEIGHT=${size}`)
  return `float32dem-bbox://${encodeURIComponent(decodedWmsUrl)}/{z}/{x}/{y}`
}

/** Bilinear-resizes a decoded tile to targetSize×targetSize — a no-op if
 *  it's already that size (every non-WMS-raw ancestor, and any WMS-raw one
 *  small enough that rewriteWmsRequestSize's clamp left it at full size). */
function upsampleDecodedTile(tile: DecodedTile, targetSize: number): DecodedTile {
  if (tile.width === targetSize && tile.height === targetSize) return tile
  const out = new Float32Array(targetSize * targetSize)
  const scaleX = tile.width / targetSize
  const scaleY = tile.height / targetSize
  for (let ty = 0; ty < targetSize; ty++) {
    const fy = Math.min(tile.height - 1, Math.max(0, (ty + 0.5) * scaleY - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(tile.height - 1, y0 + 1)
    const wy = fy - y0
    for (let tx = 0; tx < targetSize; tx++) {
      const fx = Math.min(tile.width - 1, Math.max(0, (tx + 0.5) * scaleX - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(tile.width - 1, x0 + 1)
      const wx = fx - x0
      const v00 = tile.data[y0 * tile.width + x0]
      const v10 = tile.data[y0 * tile.width + x1]
      const v01 = tile.data[y1 * tile.width + x0]
      const v11 = tile.data[y1 * tile.width + x1]
      out[ty * targetSize + tx] = v00 * (1 - wx) * (1 - wy) + v10 * wx * (1 - wy) + v01 * (1 - wx) * wy + v11 * wx * wy
    }
  }
  return { data: out, width: targetSize, height: targetSize }
}

// `radiusPx` is the user-facing "Smoothing Radius" control (roughly, how many native
// pixels wide the low-pass regional trend should span) — converted here to `k`
// (pyramid levels to go up) since that's what actually determines which ancestor
// tile gets fetched. Clamped to [1, 6]: k=1 is barely more than a 3x3 blur, k=6
// (~64px radius) is already a broad regional trend for a 256px tile.
export function radiusToLevels(radiusPx: number): number {
  return Math.min(6, Math.max(1, Math.round(Math.log2(Math.max(2, radiusPx)))))
}

export function buildLrmProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, radiusPx = 16,
): string {
  return `${buildProtocolUrl("lrm", upstreamTileTemplate, encoding, tileSize)}?k=${radiusToLevels(radiusPx)}`
}

export async function lrmProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(LRM_URL_RE)
  if (!match) throw new Error(`Invalid LRM protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, kStr] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)
  const k = parseInt(kStr, 10)
  const signal = abortController.signal

  const upstreamUrl = (tz: number, tx: number, ty: number) =>
    upstreamTemplate.replace("{z}", String(tz)).replace("{x}", String(tx)).replace("{y}", String(ty))

  // Can't go higher in the pyramid than the world's own root (z=0) — near the top of
  // the zoom range (small z), fewer than `k` levels may be available.
  const levels = Math.min(k, z)
  const scale = 1 << levels
  const ancestorZ = z - levels
  const ancestorX = x >> levels
  const ancestorY = y >> levels
  // This tile's position within its ancestor's footprint, in ancestor-tile units —
  // both in [0, scale), used below to map this tile's pixels into the ancestor's
  // own local pixel space.
  const xOffsetTiles = x - (ancestorX << levels)
  const yOffsetTiles = y - (ancestorY << levels)

  // For a WMS-raw upstream, request the ancestor at a genuinely smaller
  // pixel size (honestly matching how much detail a `scale`×-coarser area
  // needs) instead of asking for n×n and trusting the server's own
  // downsampling — see this file's header comment. ×4 oversampling gives
  // bilinear some real neighboring detail to work with rather than the bare
  // theoretical minimum; the 32px floor avoids a degenerate request at very
  // large radii; the n ceiling means a barely-coarser ancestor (small scale)
  // just requests full size as before (upsampleDecodedTile no-ops on it).
  const ancestorRequestSize = Math.max(32, Math.min(n, Math.round((n / scale) * 4)))
  const rewrittenAncestorTemplate = rewriteWmsRequestSize(upstreamTemplate, ancestorRequestSize)
  const ancestorFetchTile = rewrittenAncestorTemplate === upstreamTemplate
    ? undefined
    : async (url: string, tileSignal: AbortSignal) => {
        const tile = await fetchDecodedTile(sharedTileCache, url, encoding, tileSignal)
        return tile ? upsampleDecodedTile(tile, n) : null
      }

  const [centerTile, ancestorGrid] = await Promise.all([
    fetchDecodedTile(sharedTileCache, upstreamUrl(z, x, y), encoding, signal),
    fetchPaddedElevationGrid(sharedTileCache, rewrittenAncestorTemplate, encoding, ancestorZ, ancestorX, ancestorY, n, signal, 1, ancestorFetchTile),
  ])
  if (!centerTile) throw new Error(`Failed to fetch LRM center tile at ${z}/${x}/${y}`)

  // bilinearSamplePadded (and the ancestor grid it reads) index pixels by position,
  // i.e. ancestor pixel `i` is assumed to sit at coordinate `i`. But ancestor pixel
  // `i` is really the box-average of fine pixels [i*scale, (i+1)*scale) — its true
  // center of mass is at fine-position i*scale + scale/2, i.e. ancestor-coordinate
  // i + 0.5, not i. Omitting that half-pixel recentering (`+0.5` before dividing,
  // `-0.5` after) shifts every sample by up to half an *ancestor* pixel toward
  // larger x/y (south-east) — negligible at k=1 but up to ~scale/2 fine pixels at
  // k=6, which on steep terrain reads as a strong, aspect-correlated relief bias
  // rather than genuine local relief (confirmed empirically: this fix takes the
  // correlation between LRM and local slope gradient from -0.3..-0.6 to ~0).
  const outData = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    const ancestorPxY = (yOffsetTiles * n + row + 0.5) / scale - 0.5
    for (let col = 0; col < n; col++) {
      const ancestorPxX = (xOffsetTiles * n + col + 0.5) / scale - 0.5
      const coarseElevation = bilinearSamplePadded(ancestorGrid, ancestorPxX, ancestorPxY)
      const fineElevation = centerTile.data[row * centerTile.width + col]
      const lrm = fineElevation - coarseElevation

      const [r, g, b, alpha] = elevationToTerrarium(lrm)
      const idx = (row * n + col) * 4
      outData[idx] = r
      outData[idx + 1] = g
      outData[idx + 2] = b
      outData[idx + 3] = alpha
    }
  }

  const canvas = new OffscreenCanvas(n, n)
  const ctx = canvas.getContext("2d")!
  ctx.putImageData(new ImageData(outData, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}

/** `fetchTileBlob` override for lib/tile-mosaic.ts's `fetchTileMosaic` — calls
 *  `lrmProtocol` directly as a plain function instead of a `fetch()`, since an
 *  `lrm://` URL isn't fetchable outside maplibre's own request pipeline (see
 *  fetchTileMosaic's own `fetchTileBlob` option header). Used by the client-
 *  side LRM point/path sampling in lib/elevation-query.ts. */
export async function lrmFetchTileBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", () => controller.abort())
  }
  const { data } = await lrmProtocol({ url }, controller)
  return new Blob([data as BlobPart], { type: "image/png" })
}
