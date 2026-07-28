// Client-side surface curvature tile computation, registered as the `curvature://`
// maplibre custom protocol. See lib/normal-derived-protocol.ts for the shared
// pipeline. Four formula variants share this one protocol, selected by a `?mode=`
// suffix on the tile URL (see buildCurvatureProtocolUrl) rather than four separate
// maplibre protocols, since they only differ in the per-pixel formula:
//  - "combined": no single canonical GDAL algorithm to port from (unlike slope/
//    aspect/TRI, which do) — a discrete Laplacian approximation (∇²z, the sum of
//    the 4 direct neighbors minus 4x center, over ground distance²), scaled ×100.
//  - "profile"/"plan": the standard Zevenbergen & Thorne (1987) quadratic-surface-fit
//    curvatures (as used by GRASS r.slope.aspect / SAGA), also ×100 to match
//    "combined"'s scale so they share the same color ramp bounds. Profile is
//    curvature along the steepest-descent direction (affects flow acceleration);
//    plan is curvature across contours (affects flow convergence/divergence),
//    equivalent to the divergence of the normalized gradient field, div(∇z/|∇z|).
//  - "det-hessian": determinant of the Hessian (fxx*fyy - fxy²) — a blob/saddle
//    detector (positive at bowl/dome-shaped extrema, negative at saddle points, ~0
//    on cylindrical/planar terrain like a straight ridge or uniform slope) rather
//    than a flow quantity. Reuses the exact r/t/s (fxx/fyy/fxy) intermediates
//    computeProfileAndPlan already derives, so it's effectively free to add.
//  - "casorati"/"shape-index": both derived from the same small-slope-approximation
//    principal curvatures κ1/κ2 (the eigenvalues of the Hessian [[r,s],[s,t]] —
//    the same r/t/s intermediates det-hessian already uses, just via its
//    eigenvalues instead of only their product) as computeDetHessian, just two
//    different combinations of the same two numbers: Casorati (Koch 1993),
//    sqrt((κ1²+κ2²)/2), is an always-positive "how curved, regardless of shape"
//    magnitude (RMS of the two principal curvatures); Shape Index (Koenderink &
//    van Doorn 1992), (2/π)·atan2(κ1+κ2, κ1-κ2), is shape-only and scale-free —
//    always in [-1, 1] regardless of how strongly curved the surface is (+1 dome,
//    +0.5 ridge, 0 saddle, -0.5 valley, -1 bowl) — the two are complementary the
//    same way a vector splits into magnitude and direction.
// All modes share this file's sign convention (matching "combined"): positive =
// concave (valleys), negative = convex (ridges) — det-hessian/shape-index instead
// read positive = bowl/dome extremum, negative = saddle; Casorati is unsigned.

import {
  sharedTileCache, runNormalDerivedProtocol, buildProtocolUrl, type UpstreamEncoding, type ElevationWindow,
} from "./normal-derived-protocol"

export type CurvatureMode = "combined" | "profile" | "plan" | "det-hessian" | "casorati" | "shape-index"

const CURVATURE_URL_RE = /^curvature:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?mode=(combined|profile|plan|det-hessian|casorati|shape-index)$/

export function buildCurvatureProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, mode: CurvatureMode = "combined",
): string {
  return `${buildProtocolUrl("curvature", upstreamTileTemplate, encoding, tileSize)}?mode=${mode}`
}

function computeCombined(w: ElevationWindow): number {
  const laplacian = (w.a1 + w.a3 + w.a5 + w.a7 - 4 * w.a4) / (w.groundResolutionM * w.groundResolutionM)
  return laplacian * 100
}

// Zevenbergen & Thorne (1987) second-order partial derivatives over the 3x3 window
// (a0..a8 is their Z1..Z9, row-major, a4 the center cell) with ground spacing L.
function computeSecondDerivatives(w: ElevationWindow): { p: number; q: number; r: number; t: number; s: number } {
  const L = w.groundResolutionM
  const p = (w.a5 - w.a3) / (2 * L) // dz/dx
  const q = (w.a7 - w.a1) / (2 * L) // dz/dy
  const r = (w.a5 - 2 * w.a4 + w.a3) / (L * L) // d2z/dx2
  const t = (w.a7 - 2 * w.a4 + w.a1) / (L * L) // d2z/dy2
  const s = (w.a2 - w.a0 - w.a8 + w.a6) / (4 * L * L) // d2z/dxdy
  return { p, q, r, t, s }
}

export function computeProfileAndPlan(w: ElevationWindow): { profile: number; plan: number } {
  const { p, q, r, t, s } = computeSecondDerivatives(w)

  const gradSq = p * p + q * q
  if (gradSq < 1e-12) return { profile: 0, plan: 0 } // flat ground — direction undefined

  const profile = 100 * (r * p * p + 2 * s * p * q + t * q * q) / (gradSq * Math.pow(1 + gradSq, 1.5))
  const plan = 100 * (r * q * q - 2 * s * p * q + t * p * p) / Math.pow(gradSq, 1.5)
  return { profile, plan }
}

// det(H) = fxx*fyy - fxy^2, scaled to roughly match the other modes' ×100 magnitude.
export function computeDetHessian(w: ElevationWindow): number {
  const { r, t, s } = computeSecondDerivatives(w)
  return (r * t - s * s) * 10000
}

/** Principal curvatures κ1 ≥ κ2 — the eigenvalues of the Hessian [[r,s],[s,t]] —
 *  in the same small-slope approximation computeDetHessian already uses (exact
 *  only where the gradient is ~0, unlike computeProfileAndPlan's slope-corrected
 *  profile/plan curvatures; consistent with det-hessian's existing precedent
 *  rather than a new, more rigorous derivation). */
function computePrincipalCurvatures(w: ElevationWindow): { k1: number; k2: number } {
  const { r, t, s } = computeSecondDerivatives(w)
  const trace = r + t
  const disc = Math.sqrt((r - t) * (r - t) + 4 * s * s)
  return { k1: (trace + disc) / 2, k2: (trace - disc) / 2 }
}

// sqrt((κ1²+κ2²)/2) — Koch (1993)'s Casorati curvature, an always-nonnegative "how
// curved" magnitude (RMS of the two principal curvatures) — 0 only on flat/planar
// ground, regardless of dome/ridge/saddle/valley/bowl shape. κ1/κ2 are degree-1 in
// r/t/s (same units as profile/plan's numerator), so this gets their ×100 scale
// rather than det-hessian's ×10000 (which compensates for being a degree-2 product).
export function computeCasorati(w: ElevationWindow): number {
  const { k1, k2 } = computePrincipalCurvatures(w)
  return Math.sqrt((k1 * k1 + k2 * k2) / 2) * 100
}

// (2/π)·atan2(κ1+κ2, κ1-κ2) — Koenderink & van Doorn (1992)'s shape index: shape-
// only and scale-free, always in [-1, 1] no matter how strongly curved the surface
// is (+1 dome/peak, +0.5 ridge, 0 saddle, -0.5 valley, -1 pit/bowl). κ1-κ2 (the
// eigengap) is never negative, so atan2's result — and this — never leaves
// [-1, 1]; deliberately NOT given the other modes' ×100 bake-in (it's already
// dimensionless and bounded, unlike their raw 1/m-scale curvatures) — the outer
// CURVATURE_ENCODE_SCALE wire-quantization multiply below is enough on its own.
// atan2(0, 0) = 0 on a perfectly flat patch (κ1=κ2=0) — shape is undefined there,
// and 0 (this file's universal "no feature" value, same as TPI/LRM/Openness)
// is as good a fallback as any.
export function computeShapeIndex(w: ElevationWindow): number {
  const { k1, k2 } = computePrincipalCurvatures(w)
  return (2 / Math.PI) * Math.atan2(k1 + k2, k1 - k2)
}

// Curvature's own compute* functions already land in a small, near-zero-heavy
// range (roughly -20..20 for real terrain, by design — see computeDetHessian's
// comment). Wired straight into elevationToTerrarium's native ~0.0039 step
// (see normal-derived-protocol.ts), that still leaves under 10,000 distinct
// levels across the whole ramp, and far fewer within the near-zero band where
// most real terrain actually falls — the likely source of the visible
// banding/discretization on some sources. This extra factor multiplies the
// value going into the wire encoding only, undone by dividing back out
// wherever the raw ["elevation"] is read for display (curvatureReliefPaint's
// min/max in TerrainViewer.tsx) — the slider/ramp UI and its stored min/max
// stay in ordinary curvature units throughout, unaffected.
export const CURVATURE_ENCODE_SCALE = 1000

export async function curvatureProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const modeMatch = params.url.match(CURVATURE_URL_RE)
  const mode = (modeMatch?.[7] as CurvatureMode) ?? "combined"

  return runNormalDerivedProtocol({
    url: params.url,
    urlRegex: CURVATURE_URL_RE,
    abortController,
    cache: sharedTileCache,
    computeValue: (w) => {
      let value: number
      if (mode === "combined") value = computeCombined(w)
      else if (mode === "det-hessian") value = computeDetHessian(w)
      else if (mode === "casorati") value = computeCasorati(w)
      else if (mode === "shape-index") value = computeShapeIndex(w)
      else {
        const { profile, plan } = computeProfileAndPlan(w)
        value = mode === "profile" ? profile : plan
      }
      return value * CURVATURE_ENCODE_SCALE
    },
  })
}
