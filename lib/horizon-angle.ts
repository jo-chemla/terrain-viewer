import type { TileImage } from "./tile-image"
// Shared "horizon angle" ray-marching core behind both svf-protocol.ts and
// openness-protocol.ts — Sky View Factor and (positive/negative) Openness are
// both built from the same underlying quantity (Yokoyama et al. 2002; Zakšek et
// al. 2011 for SVF): in each of several compass directions, march outward from
// the center pixel and find the steepest elevation angle to any point along that
// ray — the "horizon angle" in that direction. SVF and Openness then just apply
// different formulas to the same set of per-direction angles.
//
// Deliberately the *simplest* viable version, not the literature's full accuracy:
// - Fixed 8 compass directions (not the 16-32 RVT typically uses).
// - Integer-pixel ray steps (round to nearest same-zoom pixel each step) rather
//   than bilinear-sampling fractional points along the ray.
// - No anisotropic/weighted sky-sector integration for SVF — the common
//   simplified estimator (mean of sin(angle) across directions) instead of the
//   literature's per-sector solid-angle weighting.
// A later pass can raise direction count, switch to bilinear ray sampling, or
// adopt the more precise SVF integral — this just needs the same per-direction
// angles, so upgrading is additive, not a rewrite.
//
// PERFORMANCE — "fast" precision. The precise path above fetches a native-
// resolution halo `radiusPx` wide around the tile
// (fetchPaddedElevationGrid) — fine at small radii, but at a large one (32-64px)
// that's a lot of same-zoom neighbor-tile data to fetch and march through, per
// output tile. lib/local-dominance-protocol.ts sidesteps the equivalent cost for
// its own "look at neighbors at increasing radii" quantity via the tile pyramid:
// one coarse ancestor pixel per octave instead of marching every native pixel.
// That trick is NOT safely portable here as-is, though — it works for local
// dominance because that's a MEAN across many samples (a coarse per-octave
// sample is a legitimate low-pass proxy for an average), whereas horizon angle
// is a MAX: the single steepest obstruction along each ray. Coarsening the
// search risks silently skipping past a narrow, nearby ridge that dominates the
// true horizon angle — a systematic *underestimate* of occlusion, a worse
// failure mode than local dominance's smoothing bias.
//
// The compromise "fast" precision takes: within FAST_NATIVE_RADIUS_PX, only
// visit powers-of-two radii (1, 2, 4, 8, ...) instead of every native pixel —
// the same octave/pyramid idea as the far-field trick below, just one level
// earlier, so near-field cost grows with log2(radius) instead of radius. r=1
// (the single nearest, highest-leverage sample — largest angular contribution
// per unit missed) is always visited, and the exact requested radius is
// always visited too even if the doubling sequence overshoots it, so the
// user's slider setting is still a hard boundary. This means "fast" no longer
// exactly matches "precise" even at small radii the way it used to (it's a
// genuine approximation everywhere now, not just past FAST_NATIVE_RADIUS_PX) —
// beyond that radius, it additionally falls back to local dominance's
// one-ancestor-pixel-per-octave trick for the far field, where a given ring's
// angular contribution is small anyway (atan(height/distance) flattens with
// distance) and a missed peak costs less. Each far ring samples 3 angular
// sub-offsets (not local dominance's single sample) and takes their max, not
// their mean — still a MAX operation, just a cheap hedge against the ring's
// one sample point happening to land on a locally low spot in that direction.
// Neither trick recovers genuine sub-sample detail the way native marching
// does — both are an approximation offered as an opt-in speed/precision
// tradeoff, not a replacement for "precise".

import {
  sharedTileCache, fetchPaddedElevationGrid,
  tileRowToLatRad, groundResolutionM as groundResolutionAtLat, YIELD_EVERY_ROWS, yieldToMainThread,
  type UpstreamEncoding,
} from "./normal-derived-protocol"
import { computeHorizonRows, type HorizonAggregate, type HorizonFarRing, type HorizonKernelInput } from "./horizon-kernel"
import { computeInWorker, rasterComputeInWorker } from "./raster-compute-pool"
import { toTileImage } from "./tile-image"

export type HorizonPrecision = "precise" | "fast"
export type { HorizonAggregate }

// The per-pixel loop (8 directions; per direction the horizon angle, signed and
// NOT clamped to >= 0, so Openness can read above and below 90 degrees; `sign`
// -1 mirrors the surface for Negative Openness) lives in lib/horizon-kernel.ts,
// shared with the raster compute worker.

export const RAD_TO_DEG = 180 / Math.PI

/** Beyond this native-pixel radius, "fast" precision switches from marching
 *  every pixel to sampling one coarse pyramid ancestor ring per octave — see
 *  this file's header. Fixed rather than radius-dependent so the near field's
 *  accuracy guarantee doesn't shrink as the user drags the radius slider up. */
const FAST_NATIVE_RADIUS_PX = 8

function octaveOf(radiusPx: number): number {
  return Math.min(6, Math.max(1, Math.round(Math.log2(Math.max(2, radiusPx)))))
}

export interface RunHorizonAngleProtocolParams {
  upstreamTemplate: string
  encoding: UpstreamEncoding
  n: number
  z: number
  x: number
  y: number
  signal: AbortSignal
  radiusPx: number
  precision: HorizonPrecision
  sign: 1 | -1
  /** "svf": `(1 - mean(sin(clamp(angle, >=0)))) * 100`; "openness":
   *  `-mean(angle) * RAD_TO_DEG`. The one piece that differs between them. */
  aggregate: HorizonAggregate
}

export async function runHorizonAngleProtocol(params: RunHorizonAngleProtocolParams): Promise<{ data: TileImage }> {
  const { upstreamTemplate, encoding, n, z, x, y, signal, radiusPx, precision, sign, aggregate } = params

  const nearRadiusPx = precision === "fast" ? Math.min(radiusPx, FAST_NATIVE_RADIUS_PX) : radiusPx

  const nearGridPromise = fetchPaddedElevationGrid(
    sharedTileCache, upstreamTemplate, encoding, z, x, y, n, signal, nearRadiusPx,
  )

  // Far rings only exist in "fast" precision, and only once the radius actually
  // reaches past the near field — a small radius stays exactly the same as
  // "precise" (just the one native grid, no ancestor fetches at all).
  const farRingPromises: Promise<HorizonFarRing>[] = []
  if (precision === "fast" && radiusPx > nearRadiusPx) {
    const latDeg = tileRowToLatRad(y + 0.5, z) * RAD_TO_DEG
    const nativeGroundRes = groundResolutionAtLat(latDeg, z, n)
    const octaveMin = octaveOf(nearRadiusPx) + 1
    const octaveMax = Math.max(octaveMin, octaveOf(radiusPx))
    for (let L = octaveMin; L <= octaveMax; L++) {
      const levels = Math.min(L, z)
      const scale = 1 << levels
      const ancestorZ = z - levels
      const ancestorX = x >> levels
      const ancestorY = y >> levels
      farRingPromises.push(
        fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, ancestorZ, ancestorX, ancestorY, n, signal, 1)
          .then((grid) => ({
            padded: grid.padded,
            stride: grid.stride,
            scale,
            xOffsetTiles: x - (ancestorX << levels),
            yOffsetTiles: y - (ancestorY << levels),
            distM: scale * nativeGroundRes,
          })),
      )
    }
  }

  const [nearGrid, farRings] = await Promise.all([nearGridPromise, Promise.all(farRingPromises)])

  // Same Mercator-corrected per-tile ground resolution tileGroundResolutionM computes.
  const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137
  const worldSize = 1 << z
  const groundResolutionM = (EARTH_CIRCUMFERENCE_M / (n * worldSize)) * Math.cos(tileRowToLatRad(y + 0.5, z))

  const input: HorizonKernelInput = {
    padded: nearGrid.padded, stride: nearGrid.stride, n, nearRadiusPx, groundResolutionM,
    sign, fast: precision === "fast", aggregate, farRings,
  }

  // Settings → Streaming → Raster Compute in a Worker: the whole tile in the pool.
  if (rasterComputeInWorker()) return { data: await toTileImage(await computeInWorker("horizon", input), n, n) }

  // Deliberately NOT bailing out on signal.aborted below (unlike the fetch
  // phase above, which still honors it): by this point the upstream fetch is
  // already done, so all that's left is bounded CPU work over data already in
  // hand. Throwing it away on abort made withTileResultCache (lib/tile-result-
  // cache.ts) look like it was not caching these modes at all: a rejected
  // promise is never cached, and a toggle-off routinely landed mid-tile. Still
  // yields every YIELD_EVERY_ROWS rows for responsiveness.
  const outData = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row += YIELD_EVERY_ROWS) {
    if (row > 0) await yieldToMainThread()
    computeHorizonRows(input, row, Math.min(n, row + YIELD_EVERY_ROWS), outData)
  }
  return { data: await toTileImage(outData, n, n) }
}
