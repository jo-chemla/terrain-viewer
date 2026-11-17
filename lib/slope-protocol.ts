import { pixelView, writeTerrainrgbPx } from "./elevation-encoding"
import { sharedTileCache, fetchPaddedElevationGrid } from "./normal-derived-protocol"
import { toTileImage, type TileImage } from "./tile-image"

// Client-side slope-angle tile computation, registered as the `slope://` maplibre
// custom protocol — a from-scratch equivalent of PlanTopo's server-side slope-server
// (https://tile.plantopo.com/slope/{z}/{x}/{y}, see SLOPE_SOURCE_URL in MapSources.tsx),
// computed entirely in the browser from whichever raster-dem terrain source is active.
// See https://github.com/Iconem/terrain-viewer/issues/8 and
// https://github.com/dzfranklin/plantopo/issues/258 for the original design discussion.
//
// Pipeline per tile request:
//   1. Fetch the center tile + its 8 neighbors from the upstream DEM (concurrently,
//      LRU-cached so panning only re-fetches the newly-exposed edge).
//   2. Decode each to a Float32 elevation grid using the upstream's encoding.
//   3. Stitch into a padded (N+2)x(N+2) buffer, replicating edge pixels where a
//      neighbor is missing (world edges, poles, or a failed fetch).
//   4. Compute slope via the Horn 3x3 kernel (ported from GDAL's GDALSlopeHornAlg,
//      apps/gdaldem_lib.cpp as of GDAL 3.9), Mercator-corrected by cos(tile center lat).
//   5. Re-encode slope degrees using the same terrain-rgb packing this app already
//      uses for elevation (base -10000, 0.1 unit interval) — since slope is fed in
//      directly where elevation would normally go, decoding it downstream with a
//      standard "mapbox" raster-dem `encoding` recovers `slopeDegrees` unchanged,
//      which drops straight into the existing slope color-relief layer/ramp.

// -------------------------
// URL encoding
// -------------------------

const SLOPE_URL_RE = /^slope:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildSlopeProtocolUrl(upstreamTileTemplate: string, encoding: "terrarium" | "mapbox", tileSize: number): string {
  // The embedded upstream template's own {z}/{x}/{y} placeholders are percent-encoded
  // so maplibre's tile-URL substitution (a literal string replace) only touches the
  // trailing, real {z}/{x}/{y} — the handler below decodes and substitutes the
  // embedded ones itself, once per neighbor tile.
  return `slope://${encoding}/${tileSize}/${encodeURIComponent(upstreamTileTemplate)}/{z}/{x}/{y}`
}

// Web Mercator tile-row -> latitude (radians) of the tile's top edge; standard inverse
// Mercator formula. y+0.5 gives the tile's vertical center.
function tileRowToLatRad(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z)
  return Math.atan(Math.sinh(n))
}

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137
const RAD_TO_DEG = 180 / Math.PI

// -------------------------
// Protocol handler
// -------------------------

export async function slopeProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(SLOPE_URL_RE)
  if (!match) throw new Error(`Invalid slope protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const encoding = encodingRaw as "terrarium" | "mapbox"
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)
  const worldSize = 1 << z

  // Centre tile + 8 neighbours, stitched into a padded (n+2)x(n+2) buffer by
  // the pipeline every other derived mode uses (shared decoded-tile cache,
  // edge replication where a neighbour is missing, one GetMap for a WMS).
  const { padded, stride } = await fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, z, x, y, n, abortController.signal)

  // Mercator scale correction: ground distance per pixel shrinks by cos(lat) away
  // from the equator. gdaldem's xscale/yscale are "ratio of vertical to horizontal
  // units" — feeding cos(lat_center) makes the Horn kernel divide by true ground
  // distance instead of the nominal (equator-only) pixel size. Neighbor tiles reuse
  // the center tile's scale (negligible error at the zoom levels this targets).
  const groundResolutionM = EARTH_CIRCUMFERENCE_M / (n * worldSize)
  const latCenterRad = tileRowToLatRad(y + 0.5, z)
  const scale = Math.cos(latCenterRad)
  const invEwresXscale = 1 / (groundResolutionM * scale)
  const invNsresYscale = 1 / (groundResolutionM * scale)

  const outData = new Uint8ClampedArray(n * n * 4)
  const out32 = pixelView(outData)
  for (let row = 0; row < n; row++) {
    const pr = row + 1
    for (let col = 0; col < n; col++) {
      const pc = col + 1
      // 3x3 window indexed 0 1 2 / 3 4 5 / 6 7 8, matching GDAL's convention.
      const a0 = padded[(pr - 1) * stride + (pc - 1)]
      const a1 = padded[(pr - 1) * stride + pc]
      const a2 = padded[(pr - 1) * stride + (pc + 1)]
      const a3 = padded[pr * stride + (pc - 1)]
      const a5 = padded[pr * stride + (pc + 1)]
      const a6 = padded[(pr + 1) * stride + (pc - 1)]
      const a7 = padded[(pr + 1) * stride + pc]
      const a8 = padded[(pr + 1) * stride + (pc + 1)]

      // Ported directly from GDAL's GDALSlopeHornAlg (apps/gdaldem_lib.cpp, GDAL 3.9).
      // The 1/8 normalization is folded into the atan call rather than into the
      // inverse-resolution factors, matching upstream.
      const dx = (a0 + a3 + a3 + a6 - (a2 + a5 + a5 + a8)) * invEwresXscale
      const dy = (a6 + a7 + a7 + a8 - (a0 + a1 + a1 + a2)) * invNsresYscale
      const key = dx * dx + dy * dy
      const slopeDegrees = Math.atan(Math.sqrt(key) * (1 / 8)) * RAD_TO_DEG

      writeTerrainrgbPx(outData, out32, row * n + col, slopeDegrees)
    }
  }

  return { data: await toTileImage(outData, n, n) }
}
