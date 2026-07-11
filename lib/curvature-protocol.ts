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
// All four share this file's sign convention (matching "combined"): positive =
// concave (valleys), negative = convex (ridges) — det-hessian instead reads
// positive = bowl/dome extremum, negative = saddle.

import {
  sharedTileCache, runNormalDerivedProtocol, buildProtocolUrl, type UpstreamEncoding, type ElevationWindow,
} from "./normal-derived-protocol"

export type CurvatureMode = "combined" | "profile" | "plan" | "det-hessian"

const CURVATURE_URL_RE = /^curvature:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?mode=(combined|profile|plan|det-hessian)$/

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

function computeProfileAndPlan(w: ElevationWindow): { profile: number; plan: number } {
  const { p, q, r, t, s } = computeSecondDerivatives(w)

  const gradSq = p * p + q * q
  if (gradSq < 1e-12) return { profile: 0, plan: 0 } // flat ground — direction undefined

  const profile = 100 * (r * p * p + 2 * s * p * q + t * q * q) / (gradSq * Math.pow(1 + gradSq, 1.5))
  const plan = 100 * (r * q * q - 2 * s * p * q + t * p * p) / Math.pow(gradSq, 1.5)
  return { profile, plan }
}

// det(H) = fxx*fyy - fxy^2, scaled to roughly match the other modes' ×100 magnitude.
function computeDetHessian(w: ElevationWindow): number {
  const { r, t, s } = computeSecondDerivatives(w)
  return (r * t - s * s) * 10000
}

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
      if (mode === "combined") return computeCombined(w)
      if (mode === "det-hessian") return computeDetHessian(w)
      const { profile, plan } = computeProfileAndPlan(w)
      return mode === "profile" ? profile : plan
    },
  })
}
