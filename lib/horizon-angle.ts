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
// resolution halo `radiusPx` wide around the tile (runWindowedProtocol/
// fetchPaddedElevationGrid) — fine at small radii, but at a large one (32-64px)
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
  sharedTileCache, fetchPaddedElevationGrid, bilinearSamplePadded,
  tileRowToLatRad, groundResolutionM as groundResolutionAtLat, YIELD_EVERY_ROWS, yieldToMainThread,
  type UpstreamEncoding, type PaddedElevationGrid,
} from "./normal-derived-protocol"
import { elevationToTerrarium } from "./elevation-encoding"

export type HorizonPrecision = "precise" | "fast"

/** 8 compass directions as (dRow, dCol) unit vectors — N/NE/E/SE/S/SW/W/NW. */
const HORIZON_DIRECTIONS = 8
const DIR_VECTORS: readonly (readonly [number, number])[] = Array.from(
  { length: HORIZON_DIRECTIONS },
  (_, i) => {
    const angle = (2 * Math.PI * i) / HORIZON_DIRECTIONS
    return [Math.sin(angle), Math.cos(angle)] as const
  },
)

/** For each compass direction, marches outward up to `radiusPx` same-zoom
 *  pixels and returns the elevation angle (radians, signed — NOT clamped to
 *  >= 0) to the ray's single highest-angle point: the horizon angle in that
 *  direction. A negative angle means even the ray's local high point dips
 *  below the plane through the center pixel (e.g. standing on a summit
 *  looking outward) — this is what lets Openness read above/below 90° rather
 *  than saturating at "fully open" the way Sky View Factor does.
 *
 *  `sign` flips the surface upside down (elevation differences × -1) — used
 *  by Negative Openness, which is exactly Positive Openness computed on the
 *  terrain's mirror image (turns pits/valleys into the "peaks" the same
 *  formula highlights). */
export function computeHorizonAngles(
  sample: (dr: number, dc: number) => number,
  groundResolutionM: number,
  radiusPx: number,
  sign: 1 | -1,
  nearFieldExponential = false,
): number[] {
  const center = sample(0, 0)
  // Precomputed once per pixel (not once per direction) — which native radii
  // to visit along each ray. "precise" (and the far-field's own near grid at
  // radii <= FAST_NATIVE_RADIUS_PX) walks every pixel; "fast" only visits
  // powers of two plus the exact boundary radius — see this file's header.
  const steps: number[] = []
  if (nearFieldExponential) {
    for (let r = 1; r <= radiusPx; r *= 2) steps.push(r)
    if (steps[steps.length - 1] !== radiusPx) steps.push(radiusPx)
  } else {
    for (let r = 1; r <= radiusPx; r++) steps.push(r)
  }
  return DIR_VECTORS.map(([dRow, dCol]) => {
    let maxAngle = -Infinity
    for (const r of steps) {
      const rr = Math.round(r * dRow)
      const rc = Math.round(r * dCol)
      const dist = Math.sqrt(rr * rr + rc * rc) * groundResolutionM
      if (dist === 0) continue
      const elevDiff = (sample(rr, rc) - center) * sign
      const angle = Math.atan2(elevDiff, dist)
      if (angle > maxAngle) maxAngle = angle
    }
    // Only unreachable if radiusPx < 1, which the UI clamps against — falls
    // back to "flat" (0) rather than -Infinity poisoning downstream math.
    return maxAngle === -Infinity ? 0 : maxAngle
  })
}

export const RAD_TO_DEG = 180 / Math.PI

// ---------------------------------------------------------------------------
// Shared tile-fetch/loop orchestration for svf-protocol.ts and openness-
// protocol.ts — parses the same URL shape they already use, handles both
// precision modes, and calls back with the per-direction angles for each pixel
// so each protocol only needs to supply its own aggregation formula.
// ---------------------------------------------------------------------------

/** Beyond this native-pixel radius, "fast" precision switches from marching
 *  every pixel to sampling one coarse pyramid ancestor ring per octave — see
 *  this file's header. Fixed rather than radius-dependent so the near field's
 *  accuracy guarantee doesn't shrink as the user drags the radius slider up. */
export const FAST_NATIVE_RADIUS_PX = 8

function octaveOf(radiusPx: number): number {
  return Math.min(6, Math.max(1, Math.round(Math.log2(Math.max(2, radiusPx)))))
}

interface FarRing {
  grid: PaddedElevationGrid
  scale: number
  xOffsetTiles: number
  yOffsetTiles: number
  distM: number
}

// Angular spread (radians, ~±17°) of the extra sub-samples each far ring checks
// alongside its nominal direction — see this file's header for why a single
// coarse sample per far ring isn't trusted alone the way a native ray step is.
const FAR_SUB_ANGLES = [-0.3, 0, 0.3]

/** Precomputed once at module load: DIR_VECTORS rotated by each FAR_SUB_ANGLES
 *  spread, as [rdRow, rdCol] pairs — indexed [direction][subAngle]. Both
 *  inputs are fixed constants, so there's nothing to gain by recomputing
 *  Math.cos/Math.sin(spread) and the rotation per pixel per far ring, which
 *  is what runHorizonAngleProtocol's hot loop used to do (up to 8 directions
 *  × 3 sub-angles × every far ring × every output pixel). */
const FAR_DIR_OFFSETS: readonly (readonly [number, number])[][] = DIR_VECTORS.map(([dRow, dCol]) =>
  FAR_SUB_ANGLES.map((spread) => {
    const cosA = Math.cos(spread), sinA = Math.sin(spread)
    return [dRow * cosA + dCol * sinA, dCol * cosA - dRow * sinA] as const // [rdRow, rdCol]
  }),
)

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
  /** SVF's `(1 - mean(sin(clamp(angle, >=0)))) * 100` or Openness's
   *  `-mean(angle) * RAD_TO_DEG` — the one piece that differs between them. */
  aggregate: (angles: number[]) => number
}

export async function runHorizonAngleProtocol(params: RunHorizonAngleProtocolParams): Promise<{ data: Uint8Array }> {
  const { upstreamTemplate, encoding, n, z, x, y, signal, radiusPx, precision, sign, aggregate } = params

  const upstreamUrl = (tz: number, tx: number, ty: number) =>
    upstreamTemplate.replace("{z}", String(tz)).replace("{x}", String(tx)).replace("{y}", String(ty))

  const nearRadiusPx = precision === "fast" ? Math.min(radiusPx, FAST_NATIVE_RADIUS_PX) : radiusPx

  const nearGridPromise = fetchPaddedElevationGrid(
    sharedTileCache, upstreamTemplate, encoding, z, x, y, n, signal, nearRadiusPx,
  )

  // Far rings only exist in "fast" precision, and only once the radius actually
  // reaches past the near field — a small radius stays exactly the same as
  // "precise" (just the one native grid, no ancestor fetches at all).
  const farRingPromises: Promise<FarRing>[] = []
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
            grid,
            scale,
            xOffsetTiles: x - (ancestorX << levels),
            yOffsetTiles: y - (ancestorY << levels),
            distM: scale * nativeGroundRes,
          })),
      )
    }
  }

  const [nearGrid, farRings] = await Promise.all([nearGridPromise, Promise.all(farRingPromises)])
  const { padded, stride } = nearGrid

  // Same Mercator-corrected per-tile ground resolution runWindowedProtocol computes.
  const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137
  const worldSize = 1 << z
  const groundResolutionM = (EARTH_CIRCUMFERENCE_M / (n * worldSize)) * Math.cos(tileRowToLatRad(y + 0.5, z))

  const outData = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    if (row > 0 && row % YIELD_EVERY_ROWS === 0) {
      if (signal.aborted) throw new Error("Aborted")
      await yieldToMainThread()
    }
    const pr = row + nearRadiusPx
    for (let col = 0; col < n; col++) {
      const pc = col + nearRadiusPx
      const sampleNative = (dr: number, dc: number) => padded[(pr + dr) * stride + (pc + dc)]
      const centerElevation = sampleNative(0, 0)

      const angles = computeHorizonAngles(sampleNative, groundResolutionM, nearRadiusPx, sign, precision === "fast")

      for (const ring of farRings) {
        const ancestorPxX = (ring.xOffsetTiles * n + col + 0.5) / ring.scale - 0.5
        const ancestorPxY = (ring.yOffsetTiles * n + row + 0.5) / ring.scale - 0.5
        for (let i = 0; i < DIR_VECTORS.length; i++) {
          let ringMax = -Infinity
          const offsets = FAR_DIR_OFFSETS[i]
          for (let j = 0; j < offsets.length; j++) {
            const [rdRow, rdCol] = offsets[j]
            const elevDiff = (bilinearSamplePadded(ring.grid, ancestorPxX + rdCol, ancestorPxY + rdRow) - centerElevation) * sign
            const angle = Math.atan2(elevDiff, ring.distM)
            if (angle > ringMax) ringMax = angle
          }
          if (ringMax > angles[i]) angles[i] = ringMax
        }
      }

      const [r, g, b, alpha] = elevationToTerrarium(aggregate(angles))
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
