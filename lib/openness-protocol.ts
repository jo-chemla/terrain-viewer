// Client-side (positive/negative) Openness tile computation, registered as the
// `openness://` maplibre custom protocol. See lib/normal-derived-protocol.ts for
// the shared tile-fetch pipeline and lib/horizon-angle.ts for the shared
// ray-marching core this and svf-protocol.ts both build on — including the
// "precise"/"fast" precision modes (see that file's header for the tradeoff
// fast makes).
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

import { type UpstreamEncoding, buildProtocolUrl } from "./normal-derived-protocol"
import { runHorizonAngleProtocol, RAD_TO_DEG, type HorizonPrecision } from "./horizon-angle"

export type OpennessMode = "positive" | "negative"

const OPENNESS_URL_RE = /^openness:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?r=(\d+)&mode=(positive|negative)&precision=(precise|fast)$/

export function buildOpennessProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
  radiusPx = 8, mode: OpennessMode = "positive", precision: HorizonPrecision = "precise",
): string {
  return `${buildProtocolUrl("openness", upstreamTileTemplate, encoding, tileSize)}?r=${radiusPx}&mode=${mode}&precision=${precision}`
}

// Raw openness is (90 - meanAngleDeg); subtracting the flat-ground reference
// again to re-center on 0 (this file's "0 = flat" convention — see header)
// leaves just -meanAngleDeg.
function aggregateOpenness(angles: number[]): number {
  const meanAngleDeg = (angles.reduce((sum, a) => sum + a, 0) / angles.length) * RAD_TO_DEG
  return -meanAngleDeg
}

export async function opennessProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(OPENNESS_URL_RE)
  if (!match) throw new Error(`Invalid Openness protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, radiusStr, modeRaw, precisionRaw] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)
  const radiusPx = parseInt(radiusStr, 10)
  const mode = modeRaw as OpennessMode
  const precision = precisionRaw as HorizonPrecision
  const sign = mode === "negative" ? -1 : 1

  return runHorizonAngleProtocol({
    upstreamTemplate, encoding, n, z, x, y,
    signal: abortController.signal,
    radiusPx, precision, sign,
    aggregate: aggregateOpenness,
  })
}
