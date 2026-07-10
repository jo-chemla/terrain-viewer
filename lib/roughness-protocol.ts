// Client-side (surface) Roughness tile computation, registered as the `roughness://`
// maplibre custom protocol. See lib/normal-derived-protocol.ts for the shared
// pipeline. Roughness is the simplest of the neighborhood-statistic measures: the
// max minus min elevation across the cell and its 8 immediate neighbors, in the
// same units as the source elevation (meters) — flat ground is near 0, rugged
// terrain is large.

import {
  sharedTileCache, runNormalDerivedProtocol, buildProtocolUrl, type UpstreamEncoding,
} from "./normal-derived-protocol"

const ROUGHNESS_URL_RE = /^roughness:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildRoughnessProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number): string {
  return buildProtocolUrl("roughness", upstreamTileTemplate, encoding, tileSize)
}

export async function roughnessProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  return runNormalDerivedProtocol({
    url: params.url,
    urlRegex: ROUGHNESS_URL_RE,
    abortController,
    cache: sharedTileCache,
    computeValue: (w) => {
      const min = Math.min(w.a0, w.a1, w.a2, w.a3, w.a4, w.a5, w.a6, w.a7, w.a8)
      const max = Math.max(w.a0, w.a1, w.a2, w.a3, w.a4, w.a5, w.a6, w.a7, w.a8)
      return max - min
    },
  })
}
