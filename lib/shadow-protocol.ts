// Client-side cast-shadow tile computation, registered as the `shadow://`
// maplibre custom protocol — a plain `raster` source/layer pair (same
// drape-for-free reasoning as every other derived mode in this app, see
// matcap-protocol.ts's header). Reuses lib/normal-derived-protocol.ts's
// fetchPaddedElevationGrid for the padded-neighbor-tile DEM fetch (shared,
// cached independent of light direction — dragging the light control never
// re-derives elevation, only re-marches).
//
// A cast shadow only ever cares about ONE direction, straight toward the
// sun's actual azimuth: a pixel is in shadow when something within the Search
// Radius toward the sun rises above the sun's own angle in the sky. Since
// 2026-11-25 lib/shadow-kernel.ts answers that with a shadow-height sweep
// (cost independent of the radius) instead of one ray march per pixel, so the
// default radius is 256 px (it was 32) and the cap 512: a halo above one tile
// comes from a second ring of same-zoom neighbours (fetchPaddedElevationGrid).
// Why not a lower zoom for the far part: docs/content/docs/dev/shadow-renderers.mdx.
import { sharedTileCache, fetchPaddedElevationGrid, tileRowToLatRad, groundResolutionM, buildProtocolUrl, formatUrlNumber, type UpstreamEncoding } from "./normal-derived-protocol"
import { toTileImage, type TileImage } from "./tile-image"
import { computeShadowTile, type ShadowKernelInput } from "./shadow-kernel"
import { computeInWorker, rasterComputeInWorker } from "./raster-compute-pool"

const SHADOW_URL_RE = /^shadow:\/\/(-?[\d.]+)\/(-?[\d.]+)\/(\d+)\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

/** `azimuthDeg`/`altitudeDeg` — same compass-clockwise-from-north / degrees-
 *  above-horizon convention as state.illuminationDir/illuminationAlt (shared
 *  with Hillshade and Phong, see lighting-effects-options-section.tsx: no
 *  separate light control for Shadows). `radiusPx` is how far same-zoom
 *  pixels are marched toward the sun looking for an obstruction — same
 *  "Search Radius" convention SVF/Openness use. */
/** Hard Shadows' Search Radius: default and slider maximum, in tile pixels
 *  (measured in docs/content/docs/dev/shadow-renderers.mdx). */
export const SHADOW_RADIUS_DEFAULT_PX = 256
export const SHADOW_RADIUS_MAX_PX = 512

export function buildShadowProtocolUrl(
  azimuthDeg: number, altitudeDeg: number, radiusPx: number,
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
): string {
  const base = buildProtocolUrl("shadow", upstreamTileTemplate, encoding, tileSize)
  return base.replace("shadow://", `shadow://${formatUrlNumber(azimuthDeg)}/${formatUrlNumber(altitudeDeg)}/${radiusPx}/`)
}

export async function shadowProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(SHADOW_URL_RE)
  if (!match) throw new Error(`Invalid shadow protocol URL: ${params.url}`)
  const [, azimuthDegStr, altitudeDegStr, radiusStr, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const azimuthDeg = parseFloat(azimuthDegStr)
  const altitudeDeg = parseFloat(altitudeDegStr)
  // Capped where the fetch stops (two rings of neighbours) and the kernel
  // stays under about 10 ms a 256 px tile.
  const radiusPx = Math.min(parseInt(radiusStr, 10), Math.min(SHADOW_RADIUS_MAX_PX, 2 * parseInt(tileSizeStr, 10)))
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10), x = parseInt(xStr, 10), y = parseInt(yStr, 10)
  const signal = abortController.signal

  const { padded, stride } = await fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, z, x, y, n, signal, radiusPx)

  const latDeg = tileRowToLatRad(y + 0.5, z) * (180 / Math.PI)
  const groundResM = groundResolutionM(latDeg, z, n)

  // Direction TOWARD the sun in (row=south-component, col=east-component)
  // pixel-step space — azimuth 0 (north) should step toward negative row
  // (northward, i.e. up-tile), matching phong-live-gl-layer.ts's own
  // az->vector sign convention for the same compass/tile-space pairing.
  const azimuthRad = (azimuthDeg * Math.PI) / 180
  const altitudeRad = (altitudeDeg * Math.PI) / 180
  const dCol = Math.sin(azimuthRad)
  const dRow = -Math.cos(azimuthRad)

  const input: ShadowKernelInput = { padded, stride, n, radiusPx, dRow, dCol, groundResM, altitudeRad }

  // Settings, Streaming, Raster Compute in a Worker: the whole tile in the
  // pool. With the old march a screenful at radius 64 froze the page for
  // 100 ms at a time on the main thread (2026-11-18: 12 tiles, 19 frames
  // missed); the sweep takes a few ms a tile, in one piece (it is not
  // row-separable, so no yielding inside a tile).
  if (rasterComputeInWorker()) return { data: await toTileImage(await computeInWorker("shadow", input), n, n) }

  if (signal.aborted) throw new Error("Aborted")
  const outData = new Uint8ClampedArray(n * n * 4)
  computeShadowTile(input, outData)

  return { data: await toTileImage(outData, n, n) }
}
