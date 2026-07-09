// Client-side Terrain Ruggedness Index (TRI) tile computation, registered as the
// `tri://` maplibre custom protocol. See lib/normal-derived-protocol.ts for the
// shared pipeline — TRI itself is Riley et al. 2006's definition: the root-mean-
// square elevation difference between a cell and its 8 immediate neighbors, in the
// same units as the source elevation (meters).

import {
  sharedTileCache, runNormalDerivedProtocol, buildProtocolUrl, type UpstreamEncoding,
} from "./normal-derived-protocol"

const TRI_URL_RE = /^tri:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildTriProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number): string {
  return buildProtocolUrl("tri", upstreamTileTemplate, encoding, tileSize)
}

export async function triProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  return runNormalDerivedProtocol({
    url: params.url,
    urlRegex: TRI_URL_RE,
    abortController,
    cache: sharedTileCache,
    computeValue: (w) => {
      const d0 = w.a0 - w.a4, d1 = w.a1 - w.a4, d2 = w.a2 - w.a4
      const d3 = w.a3 - w.a4, d5 = w.a5 - w.a4
      const d6 = w.a6 - w.a4, d7 = w.a7 - w.a4, d8 = w.a8 - w.a4
      const sumSquares = d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d5 * d5 + d6 * d6 + d7 * d7 + d8 * d8
      return Math.sqrt(sumSquares)
    },
  })
}
