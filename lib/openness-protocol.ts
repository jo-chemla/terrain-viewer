// Client-side (positive/negative) Openness tile computation, registered as the
// `openness://` maplibre custom protocol. See lib/normal-derived-protocol.ts for
// the shared tile-fetch pipeline and lib/horizon-angle.ts for the shared
// ray-marching core this and svf-protocol.ts both build on.
//
// Openness (Yokoyama, Merry & Pike, 2002) is a Sky-View-Factor relative, but
// unlike SVF it isn't clamped to "at most fully open": Positive Openness is the
// mean angular distance from zenith to the horizon across 8 directions, using
// the *unclamped* (signed) horizon angle — a summit with nothing higher anywhere
// nearby reads *above* 90° (the ray's high point dips downhill in every
// direction), a flat plain reads exactly 90°, and a valley/pit reads below 90°.
// Negative Openness is the same formula computed on the terrain flipped upside
// down (elevation × -1), which is what makes it highlight enclosed
// valleys/channels the same way Positive Openness highlights ridges/summits.
//
// Output in degrees (0-90ish, occasionally a little past 90 for very convex
// summits) to match the literature's own units rather than an arbitrary scale —
// re-centered around 0 (subtracting the flat-ground reference of 90°) for the
// color ramp, same "0 = boring, diverging" convention as TPI/LRM.

import {
  sharedTileCache, runWindowedProtocol, buildProtocolUrl, type UpstreamEncoding,
} from "./normal-derived-protocol"
import { computeHorizonAngles, RAD_TO_DEG } from "./horizon-angle"

export type OpennessMode = "positive" | "negative"

const OPENNESS_URL_RE = /^openness:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?r=(\d+)&mode=(positive|negative)$/

export function buildOpennessProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
  radiusPx = 8, mode: OpennessMode = "positive",
): string {
  return `${buildProtocolUrl("openness", upstreamTileTemplate, encoding, tileSize)}?r=${radiusPx}&mode=${mode}`
}

/** Returns openness *minus* the flat-ground reference of 90° — so 0 means flat,
 *  positive means more open (convex/summit-like), negative means more enclosed
 *  (concave/valley-like), matching TPI/LRM's "0 = no feature, diverging" ramp
 *  convention instead of the literature's raw 0-180° scale. */
export function computeOpenness(
  sample: (dr: number, dc: number) => number,
  groundResolutionM: number,
  radiusPx: number,
  mode: OpennessMode,
): number {
  const sign = mode === "negative" ? -1 : 1
  const angles = computeHorizonAngles(sample, groundResolutionM, radiusPx, sign)
  const meanAngleDeg = (angles.reduce((sum, a) => sum + a, 0) / angles.length) * RAD_TO_DEG
  // Raw openness is (90 - meanAngleDeg); subtracting the flat-ground reference
  // again to re-center on 0 leaves just -meanAngleDeg.
  return -meanAngleDeg
}

export async function opennessProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(OPENNESS_URL_RE)
  const radiusPx = match ? parseInt(match[7], 10) : 8
  const mode = (match?.[8] as OpennessMode) ?? "positive"

  return runWindowedProtocol({
    url: params.url,
    urlRegex: OPENNESS_URL_RE,
    abortController,
    cache: sharedTileCache,
    halo: radiusPx,
    computeValue: (sample, groundResolutionM) => computeOpenness(sample, groundResolutionM, radiusPx, mode),
  })
}
