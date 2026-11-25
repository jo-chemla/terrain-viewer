// Client-side structure-tensor "blobness" tile computation, registered as the
// `blobness://` maplibre custom protocol. See lib/normal-derived-protocol.ts for
// the shared pipeline. Unlike TRI/TPI/Roughness (plain 3x3 neighborhood
// aggregations), blobness needs the Horn gradient *at* each of the 9 cells of a
// 3x3 neighborhood, and each of those gradients itself needs its own 3x3
// neighborhood — so it reads a 5x5 (halo=2) window (its own tile loop,
// blobnessProtocol below) rather than runNormalDerivedProtocol's fixed 3x3 ElevationWindow.
//
// This is the Förstner/Harris-style structure tensor: J = [[Ixx, Ixy], [Ixy, Iyy]]
// where Ixx/Iyy/Ixy are the 3x3-box-averaged gx², gy², gx·gy (gx, gy the Horn
// gradient at each of the 9 sub-cells) — literally a local 2D PCA of the window's
// gradient vectors: J's eigenvalues are the variance of those vectors along its
// eigenvectors. Three modes share this one protocol, selected by a `?mode=` suffix
// (see buildBlobnessProtocolUrl), all read off the same tensor:
//  - "blobness": det(J)/trace(J) (the harmonic-mean-ish combination of both
//    eigenvalues) — large where gradient direction varies across the window in
//    every direction (peaks, pits, saddles, knolls — "blob-like" surface features)
//    and near zero on a uniform slope or straight ridge/valley, where the gradient
//    barely changes direction even though its magnitude may be large. Conflates
//    "how blob-like" with "how steep", the same way Casorati curvature and
//    det-hessian each conflate magnitude and shape in their own way.
//  - "eigen-ratio": λmin/λmax (0-100, as a percentage) — isolates the *shape*
//    question alone, independent of magnitude: 0 where the gradient field is
//    perfectly coherent (an edge — slope, ridge, or valley, all equally "linear"),
//    100 where it's perfectly isotropic (a blob — peak/pit/saddle). Two patches
//    with the same blobness score but different steepness will still read
//    differently here; two with different steepness but the same *shape* won't.
//  - "orientation": the direction a linear feature runs, as a compass axis
//    0-180° (an axis has no inherent direction — 0° and 180° are the same
//    axis, unlike Aspect's full 0-360° compass bearing): a ridge, valley or
//    fault line running north-south reads 0° (or 180°), one running
//    east-west 90°, one running north-east to south-west 45°. It is the
//    axis of the tensor's MINOR eigenvector, i.e. the dominant gradient
//    direction (the major eigenvector, across the feature) turned by 90°;
//    until 2026-11-26 the value was that across-axis itself (a north-south
//    ridge read 90°), which nobody read the intended way. On a plane the
//    "feature" is the contour: a plane rising to the north-east reads 135°.
//    Not mirrored, unlike Aspect was: Horn's dx (west - east) and dy (south -
//    north) are both negated, and the tensor is quadratic in them
//    (blobness-protocol.test.ts).
//    Most meaningful where eigen-ratio is low (a coherent edge) and closer
//    to noise where it's high (an isotropic blob has no dominant axis).

import {
  sharedTileCache, fetchPaddedElevationGrid, tileGroundResolutionM, buildProtocolUrl, RAD_TO_DEG, type UpstreamEncoding,
} from "./normal-derived-protocol"
import { pixelView, writeTerrariumPx } from "./elevation-encoding"
import { toTileImage, type TileImage } from "./tile-image"

export type BlobnessMode = "blobness" | "eigen-ratio" | "orientation"

const BLOBNESS_URL_RE = /^blobness:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?mode=(blobness|eigen-ratio|orientation)$/

export function buildBlobnessProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, mode: BlobnessMode = "blobness",
): string {
  return `${buildProtocolUrl("blobness", upstreamTileTemplate, encoding, tileSize)}?mode=${mode}`
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

/** The 2x2 structure tensor J = [[Ixx,Ixy],[Ixy,Iyy]] (each entry the 3x3-box
 *  average of gx²/gy²/gx·gy over the window's 9 sub-cells) plus its trace, shared
 *  by all three modes below. */
export function computeStructureTensor(
  sample: (dr: number, dc: number) => number, groundResolutionM: number,
): { Ixx: number; Iyy: number; Ixy: number; trace: number } {
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
  return { Ixx, Iyy, Ixy, trace: Ixx + Iyy }
}

// The Horn kernel's weights (1,2,1 / 1,2,1) sum to 8x the true gradient, so each
// gx/gy above is 8x true scale. det(J)/trace(J) is degree-2 overall in the
// gradient (det is degree 4, trace is degree 2), so that 8x inflation compounds to
// 64x — this constant divides it back out, then scales up (true blobness is a
// small dimensionless slope² term) to roughly match TRI/Roughness's 0-50-ish
// visual range.
const BLOBNESS_SCALE = 100 / 64

export function computeBlobness(sample: (dr: number, dc: number) => number, groundResolutionM: number): number {
  const { Ixx, Iyy, Ixy } = computeStructureTensor(sample, groundResolutionM)
  return blobnessFromTensor(Ixx, Iyy, Ixy)
}

function blobnessFromTensor(Ixx: number, Iyy: number, Ixy: number): number {
  const trace = Ixx + Iyy
  if (trace < 1e-9) return 0 // flat ground — undefined direction, treat as no blobness
  const det = Ixx * Iyy - Ixy * Ixy
  return (det / trace) * BLOBNESS_SCALE
}

// λmin/λmax as a 0-100 percentage — the eigenvalue-ratio "shape only" read on the
// same tensor blobness uses. J's eigenvalues (for a symmetric 2x2 matrix) are
// (trace ± sqrt((Ixx-Iyy)² + 4·Ixy²)) / 2; the ×8 Horn-kernel inflation present in
// Ixx/Iyy/Ixy cancels out in this ratio (both eigenvalues scale by the same
// factor), so — unlike computeBlobness — no BLOBNESS_SCALE-style correction is
// needed here.
export function eigenRatioFromTensor(Ixx: number, Iyy: number, Ixy: number): number {
  const trace = Ixx + Iyy
  if (trace < 1e-9) return 0 // flat ground — undefined shape, treat as maximally linear/0
  const disc = Math.sqrt((Ixx - Iyy) * (Ixx - Iyy) + 4 * Ixy * Ixy)
  const lambdaMax = (trace + disc) / 2
  const lambdaMin = (trace - disc) / 2
  return lambdaMax > 1e-12 ? (lambdaMin / lambdaMax) * 100 : 0
}

// The feature's direction: the dominant (largest-eigenvalue) eigenvector's
// axis turned by 90°, as a 0-180° orientation rather
// than a 0-360° direction — a ridge/valley line and its own reverse are the same
// axis, unlike Aspect's compass bearing where opposite directions mean opposite
// slope-facing. Standard 2D-tensor principal-axis formula: the eigenvector angle
// (in the gx/gy "math" space Ixx/Iyy/Ixy were built from) is
// 0.5*atan2(2*Ixy, Ixx-Iyy), counterclockwise from the gx axis. gx = west - east
// and gy = south - north are minus the east and north slopes, and an axis is its
// own opposite, so that is also the angle from east toward north: the compass
// bearing of the gradient axis is 90 - mathDeg, and the feature runs at
// right angles to it: 180 - mathDeg, folded mod 180 (not 360) since only the
// axis, not which end of it, is meaningful here. (Aspect's mirroring, fixed 2026-11-25,
// came from negating only dx; nothing here is negated alone.)
export function orientationFromTensor(Ixx: number, Iyy: number, Ixy: number): number {
  const trace = Ixx + Iyy
  if (trace < 1e-9) return 0 // flat ground — no dominant axis
  const mathDeg = 0.5 * Math.atan2(2 * Ixy, Ixx - Iyy) * RAD_TO_DEG
  const compassDeg = 180 - mathDeg // along the feature: the gradient axis (90 - mathDeg) + 90
  return ((compassDeg % 180) + 180) % 180
}

// One tile. The structure tensor of a pixel averages gx², gy² and gx·gy over
// its 3x3 neighbours, and neighbouring pixels share six of those nine
// gradients, so the Horn gradient is computed ONCE per cell into two grids
// (the tile plus a one-pixel ring) and each pixel then sums nine products.
// The first version called a sampling closure 72 times per pixel (nine Horn
// kernels of eight reads): 160 ms of compute per 512 px tile, plus 130 ms of
// timer waits from yielding. Same operations in the same order, so the tile
// is bit for bit the same (2026-11-17).
export async function blobnessProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(BLOBNESS_URL_RE)
  if (!match) throw new Error(`Invalid blobness protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, modeRaw] = match
  const mode = (modeRaw as BlobnessMode) ?? "blobness"
  const n = parseInt(tileSizeStr, 10)
  const z = parseInt(zStr, 10), x = parseInt(xStr, 10), y = parseInt(yStr, 10)
  const HALO = 2
  const { padded, stride } = await fetchPaddedElevationGrid(
    sharedTileCache, decodeURIComponent(encodedTemplate), encodingRaw as UpstreamEncoding, z, x, y, n, abortController.signal, HALO,
  )
  const invGroundResolutionM = 1 / tileGroundResolutionM(n, z, y)

  // Gradient grids over the tile and a one-pixel ring: cell (gr, gc) is the
  // padded cell (gr + 1, gc + 1). Float64, as the closure version kept them.
  const gStride = n + 2
  const gxGrid = new Float64Array(gStride * gStride)
  const gyGrid = new Float64Array(gStride * gStride)
  for (let gr = 0; gr < gStride; gr++) {
    const up = gr * stride, mid = up + stride, down = mid + stride
    for (let gc = 0; gc < gStride; gc++) {
      const l = gc, c = gc + 1, r = gc + 2
      gxGrid[gr * gStride + gc] = (
        padded[up + l] + 2 * padded[mid + l] + padded[down + l]
        - (padded[up + r] + 2 * padded[mid + r] + padded[down + r])
      ) * invGroundResolutionM
      gyGrid[gr * gStride + gc] = (
        padded[down + l] + 2 * padded[down + c] + padded[down + r]
        - (padded[up + l] + 2 * padded[up + c] + padded[up + r])
      ) * invGroundResolutionM
    }
  }

  const fromTensor = mode === "eigen-ratio" ? eigenRatioFromTensor : mode === "orientation" ? orientationFromTensor : blobnessFromTensor
  const outData = new Uint8ClampedArray(n * n * 4)
  const out32 = pixelView(outData)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      let sumGxGx = 0, sumGyGy = 0, sumGxGy = 0
      for (let dr = 0; dr < 3; dr++) {
        const base = (row + dr) * gStride + col
        for (let dc = 0; dc < 3; dc++) {
          const gx = gxGrid[base + dc], gy = gyGrid[base + dc]
          sumGxGx += gx * gx
          sumGyGy += gy * gy
          sumGxGy += gx * gy
        }
      }
      writeTerrariumPx(outData, out32, row * n + col, fromTensor(sumGxGx / 9, sumGyGy / 9, sumGxGy / 9))
    }
  }
  return { data: await toTileImage(outData, n, n) }
}
