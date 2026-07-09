// Client-side surface curvature tile computation, registered as the `curvature://`
// maplibre custom protocol. See lib/normal-derived-protocol.ts for the shared
// pipeline. Curvature has no single canonical GDAL algorithm to port from (unlike
// slope/aspect/TRI, which do) — this uses a discrete Laplacian approximation
// (∇²z, the sum of the 4 direct neighbors minus 4x center, over ground distance²),
// scaled ×100 to land in a human-readable range. Positive = concave (valleys),
// negative = convex (ridges), matching the usual cartographic sign convention.

import {
  sharedTileCache, runNormalDerivedProtocol, buildProtocolUrl, type UpstreamEncoding,
} from "./normal-derived-protocol"

const CURVATURE_URL_RE = /^curvature:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildCurvatureProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number): string {
  return buildProtocolUrl("curvature", upstreamTileTemplate, encoding, tileSize)
}

export async function curvatureProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  return runNormalDerivedProtocol({
    url: params.url,
    urlRegex: CURVATURE_URL_RE,
    abortController,
    cache: sharedTileCache,
    computeValue: (w) => {
      const laplacian = (w.a1 + w.a3 + w.a5 + w.a7 - 4 * w.a4) / (w.groundResolutionM * w.groundResolutionM)
      return laplacian * 100
    },
  })
}
