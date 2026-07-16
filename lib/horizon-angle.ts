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
): number[] {
  const center = sample(0, 0)
  return DIR_VECTORS.map(([dRow, dCol]) => {
    let maxAngle = -Infinity
    for (let r = 1; r <= radiusPx; r++) {
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
