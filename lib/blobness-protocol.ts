// Client-side structure-tensor "blobness" tile computation, registered as the
// `blobness://` maplibre custom protocol. See lib/normal-derived-protocol.ts for
// the shared pipeline. Unlike TRI/TPI/Roughness (plain 3x3 neighborhood
// aggregations), blobness needs the Horn gradient *at* each of the 9 cells of a
// 3x3 neighborhood, and each of those gradients itself needs its own 3x3
// neighborhood — so it reads a 5x5 (halo=2) window via runWindowedProtocol rather
// than runNormalDerivedProtocol's fixed 3x3 ElevationWindow.
//
// This is the Förstner/Harris-style structure tensor: J = [[Ixx, Ixy], [Ixy, Iyy]]
// where Ixx/Iyy/Ixy are the 3x3-box-averaged gx², gy², gx·gy (gx, gy the Horn
// gradient at each of the 9 sub-cells). blobness = det(J) / trace(J) is large where
// the gradient direction varies across the window in every direction (peaks, pits,
// saddles, knolls — "blob-like" surface features) and near zero on a uniform slope
// or a straight ridge/valley, where the gradient barely changes direction across
// the window even though its magnitude may be large.

import {
  sharedTileCache, runWindowedProtocol, buildProtocolUrl, type UpstreamEncoding,
} from "./normal-derived-protocol"

const BLOBNESS_URL_RE = /^blobness:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildBlobnessProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number): string {
  return buildProtocolUrl("blobness", upstreamTileTemplate, encoding, tileSize)
}

// Same Horn 3x3 kernel as normal-derived-protocol.ts's hornGradient, but sampled
// relative to an arbitrary sub-cell (dr, dc) rather than only the output pixel's
// own center — needed here since blobness averages the gradient over a 3x3 grid of
// sub-cells around the output pixel, not just the one cell.
function hornGradientAt(
  sample: (dr: number, dc: number) => number,
  dr: number,
  dc: number,
  invGroundResolutionM: number,
): { gx: number; gy: number } {
  const gx = (
    sample(dr - 1, dc - 1) + 2 * sample(dr, dc - 1) + sample(dr + 1, dc - 1)
    - (sample(dr - 1, dc + 1) + 2 * sample(dr, dc + 1) + sample(dr + 1, dc + 1))
  ) * invGroundResolutionM
  const gy = (
    sample(dr + 1, dc - 1) + 2 * sample(dr + 1, dc) + sample(dr + 1, dc + 1)
    - (sample(dr - 1, dc - 1) + 2 * sample(dr - 1, dc) + sample(dr - 1, dc + 1))
  ) * invGroundResolutionM
  return { gx, gy }
}

// The Horn kernel's weights (1,2,1 / 1,2,1) sum to 8x the true gradient, so each
// gx/gy above is 8x true scale. det(J)/trace(J) is degree-2 overall in the
// gradient (det is degree 4, trace is degree 2), so that 8x inflation compounds to
// 64x — this constant divides it back out, then scales up (true blobness is a
// small dimensionless slope² term) to roughly match TRI/Roughness's 0-50-ish
// visual range.
const BLOBNESS_SCALE = 100 / 64

function computeBlobness(sample: (dr: number, dc: number) => number, groundResolutionM: number): number {
  const invGroundResolutionM = 1 / groundResolutionM
  let sumGxGx = 0, sumGyGy = 0, sumGxGy = 0
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const { gx, gy } = hornGradientAt(sample, dr, dc, invGroundResolutionM)
      sumGxGx += gx * gx
      sumGyGy += gy * gy
      sumGxGy += gx * gy
    }
  }
  const Ixx = sumGxGx / 9, Iyy = sumGyGy / 9, Ixy = sumGxGy / 9

  const trace = Ixx + Iyy
  if (trace < 1e-9) return 0 // flat ground — undefined direction, treat as no blobness

  const det = Ixx * Iyy - Ixy * Ixy
  return (det / trace) * BLOBNESS_SCALE
}

export async function blobnessProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  return runWindowedProtocol({
    url: params.url,
    urlRegex: BLOBNESS_URL_RE,
    abortController,
    cache: sharedTileCache,
    halo: 2,
    computeValue: computeBlobness,
  })
}
