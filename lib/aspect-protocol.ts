// Client-side aspect (compass direction of slope) tile computation, registered as
// the `aspect://` maplibre custom protocol. See lib/normal-derived-protocol.ts for
// the shared tile-fetch/neighbor-stitch/re-encode pipeline this reuses — the only
// aspect-specific piece is the dx/dy -> compass-bearing formula below, ported from
// GDAL's aspect algorithm (apps/gdaldem_lib.cpp, GDALAspectAlg).

import {
  sharedTileCache, runNormalDerivedProtocol, buildProtocolUrl, hornGradient, RAD_TO_DEG,
  type UpstreamEncoding,
} from "./normal-derived-protocol"

const ASPECT_URL_RE = /^aspect:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildAspectProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number): string {
  return buildProtocolUrl("aspect", upstreamTileTemplate, encoding, tileSize)
}

export async function aspectProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  return runNormalDerivedProtocol({
    url: params.url,
    urlRegex: ASPECT_URL_RE,
    abortController,
    cache: sharedTileCache,
    computeValue: (window) => {
      const { dx, dy } = hornGradient(window)
      if (dx === 0 && dy === 0) return 0 // flat ground — direction is undefined, default to North

      // Mathematical (CCW from east) -> compass bearing (CW from north, 0-360).
      const mathDeg = Math.atan2(dy, -dx) * RAD_TO_DEG
      let compassDeg = 90 - mathDeg
      if (compassDeg < 0) compassDeg += 360
      if (compassDeg >= 360) compassDeg -= 360
      return compassDeg
    },
  })
}
