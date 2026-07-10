// Client-side Topographic Position Index (TPI) tile computation, registered as the
// `tpi://` maplibre custom protocol. See lib/normal-derived-protocol.ts for the
// shared pipeline. TPI is the center cell's elevation minus the mean elevation of
// its 8 immediate neighbors, in the same units as the source elevation (meters) —
// positive values sit above their neighborhood (ridges/peaks), negative values sit
// below it (valleys/pits), and values near zero are flat or mid-slope ground.

import {
  sharedTileCache, runNormalDerivedProtocol, buildProtocolUrl, type UpstreamEncoding,
} from "./normal-derived-protocol"

const TPI_URL_RE = /^tpi:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildTpiProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number): string {
  return buildProtocolUrl("tpi", upstreamTileTemplate, encoding, tileSize)
}

export async function tpiProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  return runNormalDerivedProtocol({
    url: params.url,
    urlRegex: TPI_URL_RE,
    abortController,
    cache: sharedTileCache,
    computeValue: (w) => {
      const neighborMean = (w.a0 + w.a1 + w.a2 + w.a3 + w.a5 + w.a6 + w.a7 + w.a8) / 8
      return w.a4 - neighborMean
    },
  })
}
