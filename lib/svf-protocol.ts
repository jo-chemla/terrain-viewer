// Client-side Sky View Factor tile computation, registered as the `svf://` maplibre
// custom protocol. See lib/normal-derived-protocol.ts for the shared tile-fetch
// pipeline and lib/horizon-angle.ts for the shared ray-marching core this and
// openness-protocol.ts both build on.
//
// SVF is the fraction of the sky hemisphere visible from a point (1 = fully open,
// e.g. a summit; 0 = fully enclosed, e.g. the bottom of a narrow pit) — the
// standard proxy for ambient/diffuse illumination in relief visualization (RVT's
// "Sky-View Factor" mode). Uses the common simplified estimator: for each of 8
// directions, find the horizon angle (see computeHorizonAngles), clamp to >= 0
// (a ray that dips downhill still leaves the *entire* sky visible in that
// direction — SVF can't exceed "fully open" the way Openness can), then
// SVF ≈ 1 - mean(sin(horizonAngle)). Output scaled ×100 (0-100) to fit the
// terrain-rgb re-encoding's precision comfortably and give round color-ramp bounds.

import {
  sharedTileCache, runWindowedProtocol, buildProtocolUrl, type UpstreamEncoding,
} from "./normal-derived-protocol"
import { computeHorizonAngles } from "./horizon-angle"

const SVF_URL_RE = /^svf:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?r=(\d+)$/

// `radiusPx` is the user-facing "Search Radius" control — how many same-zoom
// pixels each of the 8 rays marches outward. Bare pixel count (unlike LRM's
// radius, which maps to pyramid *levels*): SVF/Openness need the true local
// elevation profile along each ray, not a coarser ancestor tile, so this stays
// a same-zoom windowed fetch (see runWindowedProtocol) rather than LRM's
// cross-zoom trick.
export function buildSvfProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number, radiusPx = 8,
): string {
  return `${buildProtocolUrl("svf", upstreamTileTemplate, encoding, tileSize)}?r=${radiusPx}`
}

export function computeSvf(
  sample: (dr: number, dc: number) => number,
  groundResolutionM: number,
  radiusPx: number,
): number {
  const angles = computeHorizonAngles(sample, groundResolutionM, radiusPx, 1)
  const meanSin = angles.reduce((sum, a) => sum + Math.sin(Math.max(0, a)), 0) / angles.length
  return (1 - meanSin) * 100
}

export async function svfProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(SVF_URL_RE)
  const radiusPx = match ? parseInt(match[7], 10) : 8

  return runWindowedProtocol({
    url: params.url,
    urlRegex: SVF_URL_RE,
    abortController,
    cache: sharedTileCache,
    halo: radiusPx,
    computeValue: (sample, groundResolutionM) => computeSvf(sample, groundResolutionM, radiusPx),
  })
}
