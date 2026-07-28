// Client-side Sky View Factor tile computation, registered as the `svf://` maplibre
// custom protocol. See lib/normal-derived-protocol.ts for the shared tile-fetch
// pipeline and lib/horizon-angle.ts for the shared ray-marching core this and
// openness-protocol.ts both build on — including the "precise"/"fast" precision
// modes (see that file's header for the tradeoff fast makes).
//
// SVF is the fraction of the sky hemisphere visible from a point (1 = fully open,
// e.g. a summit; 0 = fully enclosed, e.g. the bottom of a narrow pit) — the
// standard proxy for ambient/diffuse illumination in relief visualization (RVT's
// "Sky-View Factor" mode). Uses the common simplified estimator: for each of 8
// directions, find the horizon angle, clamp to >= 0 (a ray that dips downhill
// still leaves the *entire* sky visible in that direction — SVF can't exceed
// "fully open" the way Openness can), then SVF ≈ 1 - mean(sin(horizonAngle)).
// Output scaled ×100 (0-100) to fit the terrain-rgb re-encoding's precision
// comfortably and give round color-ramp bounds.

import { type UpstreamEncoding, buildProtocolUrl } from "./normal-derived-protocol"
import { runHorizonAngleProtocol, type HorizonPrecision } from "./horizon-angle"

const SVF_URL_RE = /^svf:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?r=(\d+)&precision=(precise|fast)$/

// `radiusPx` is the user-facing "Search Radius" control — how many same-zoom
// pixels each of the 8 rays marches outward (in "precise" precision — see
// horizon-angle.ts for what "fast" does past FAST_NATIVE_RADIUS_PX instead).
export function buildSvfProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, radiusPx = 8, precision: HorizonPrecision = "precise",
): string {
  return `${buildProtocolUrl("svf", upstreamTileTemplate, encoding, tileSize)}?r=${radiusPx}&precision=${precision}`
}

function aggregateSvf(angles: number[]): number {
  const meanSin = angles.reduce((sum, a) => sum + Math.sin(Math.max(0, a)), 0) / angles.length
  return (1 - meanSin) * 100
}

export async function svfProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(SVF_URL_RE)
  if (!match) throw new Error(`Invalid SVF protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, radiusStr, precisionRaw] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)
  const radiusPx = parseInt(radiusStr, 10)
  const precision = precisionRaw as HorizonPrecision

  return runHorizonAngleProtocol({
    upstreamTemplate, encoding, n, z, x, y,
    signal: abortController.signal,
    radiusPx, precision, sign: 1,
    aggregate: aggregateSvf,
  })
}
