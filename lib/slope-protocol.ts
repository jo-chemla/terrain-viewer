import { elevationToTerrainrgb } from "./elevation-encoding"
import { sharedTileCache, fetchDecodedTile as fetchDecodedTileShared } from "./normal-derived-protocol"

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

// -------------------------
// Decoded-tile cache — shared with aspect/tri/curvature-protocol.ts (see
// lib/normal-derived-protocol.ts): when more than one of these is active at once
// they're all decoding the exact same upstream tiles, so sharing the cache means
// the expensive fetch+decode step happens once per tile no matter how many
// derived layers are turned on.
// -------------------------

type DecodedTile = { data: Float32Array; width: number; height: number }

function fetchDecodedTile(url: string, encoding: "terrarium" | "mapbox", signal: AbortSignal): Promise<DecodedTile | null> {
  return fetchDecodedTileShared(sharedTileCache, url, encoding, signal)
}

// -------------------------
// Tile math helpers
// -------------------------

function wrapTileX(x: number, z: number): number {
  const size = 1 << z
  return ((x % size) + size) % size
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
): Promise<{ data: Uint8Array }> {
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

  const upstreamUrl = (tx: number, ty: number) =>
    upstreamTemplate.replace("{z}", String(z)).replace("{x}", String(tx)).replace("{y}", String(ty))

  // Fetch center + 8 neighbors concurrently. Tiles beyond the poles (ty out of range)
  // are skipped up front — there's no data there, so we fall back to edge replication.
  const tilePromises = new Map<string, Promise<DecodedTile | null>>()
  for (let tdy = -1; tdy <= 1; tdy++) {
    const ty = y + tdy
    if (ty < 0 || ty >= worldSize) continue
    for (let tdx = -1; tdx <= 1; tdx++) {
      const tx = wrapTileX(x + tdx, z)
      tilePromises.set(`${tdx},${tdy}`, fetchDecodedTile(upstreamUrl(tx, ty), encoding, abortController.signal))
    }
  }

  const resolved = new Map<string, DecodedTile | null>()
  await Promise.all(
    Array.from(tilePromises.entries()).map(async ([key, promise]) => {
      resolved.set(key, await promise)
    }),
  )

  const centerTile = resolved.get("0,0")
  if (!centerTile) throw new Error(`Failed to fetch center slope source tile at ${z}/${x}/${y}`)

  const sampleElevation = (tdx: number, tdy: number, row: number, col: number): number => {
    const tile = resolved.get(`${tdx},${tdy}`)
    const source = tile ?? centerTile
    const r = Math.min(Math.max(row, 0), source.height - 1)
    const c = Math.min(Math.max(col, 0), source.width - 1)
    return source.data[r * source.width + c]
  }

  // Stitch into a padded (n+2)x(n+2) buffer: row/col 0 and n+1 are the one-pixel
  // border sampled from neighbor tiles (or replicated from the center tile's own
  // edge when a neighbor is missing).
  const stride = n + 2
  const padded = new Float32Array(stride * stride)
  for (let pr = 0; pr < stride; pr++) {
    const globalRow = pr - 1
    const tdy = globalRow < 0 ? -1 : globalRow >= n ? 1 : 0
    const srcRow = globalRow - tdy * n
    for (let pc = 0; pc < stride; pc++) {
      const globalCol = pc - 1
      const tdx = globalCol < 0 ? -1 : globalCol >= n ? 1 : 0
      const srcCol = globalCol - tdx * n
      padded[pr * stride + pc] = sampleElevation(tdx, tdy, srcRow, srcCol)
    }
  }

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

      const [r, g, b, alpha] = elevationToTerrainrgb(slopeDegrees)
      const idx = (row * n + col) * 4
      outData[idx] = r
      outData[idx + 1] = g
      outData[idx + 2] = b
      outData[idx + 3] = alpha
    }
  }

  const canvas = new OffscreenCanvas(n, n)
  const ctx = canvas.getContext("2d")!
  ctx.putImageData(new ImageData(outData, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
