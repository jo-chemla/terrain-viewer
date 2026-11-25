// Client-side aspect (compass direction of slope) tile computation, registered as
// the `aspect://` maplibre custom protocol. See lib/normal-derived-protocol.ts for
// the shared tile-fetch/neighbor-stitch/re-encode pipeline this reuses — the only
// aspect-specific piece is the dx/dy -> compass-bearing formula below, ported from
// GDAL's aspect algorithm (apps/gdaldem_lib.cpp, GDALAspectAlg).

import {
  sharedTileCache, runNormalDerivedProtocol, buildProtocolUrl, RAD_TO_DEG,
  type UpstreamEncoding,
} from "./normal-derived-protocol"
import type { TileImage } from "./tile-image"

/** Compass bearing (0-360, clockwise from north) that the slope faces, from
 *  the Horn gradient above: `dx` = west column minus east column, `dy` = south
 *  row minus north row (both per metre). GDAL's GDALAspectAlg takes its dx as
 *  east minus west and computes atan2(dy, -dx); with our dx of the opposite
 *  sign that is atan2(dy, dx). (Until 2026-11-25 this read atan2(dy, -dx) and
 *  mirrored east and west: an east-facing slope read 270°.) Flat ground: 0. */
export function aspectCompassDeg(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0 // flat ground: direction undefined, default to north
  // Mathematical (CCW from east) -> compass bearing (CW from north, 0-360).
  const mathDeg = Math.atan2(dy, dx) * RAD_TO_DEG
  let compassDeg = 90 - mathDeg
  if (compassDeg < 0) compassDeg += 360
  if (compassDeg >= 360) compassDeg -= 360
  return compassDeg
}

const ASPECT_URL_RE = /^aspect:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildAspectProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number): string {
  return buildProtocolUrl("aspect", upstreamTileTemplate, encoding, tileSize)
}

export async function aspectProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  return runNormalDerivedProtocol({
    url: params.url,
    urlRegex: ASPECT_URL_RE,
    abortController,
    cache: sharedTileCache,
    computeValue: (window) => {
      // hornGradient, inlined so no {dx, dy} object is allocated per pixel
      // (same expressions, same order, same result).
      const w = window
      const dx = (w.a0 + w.a3 + w.a3 + w.a6 - (w.a2 + w.a5 + w.a5 + w.a8)) * w.invEwresXscale
      const dy = (w.a6 + w.a7 + w.a7 + w.a8 - (w.a0 + w.a1 + w.a1 + w.a2)) * w.invNsresYscale
      return aspectCompassDeg(dx, dy)
    },
  })
}
