// Client-side Local Dominance tile computation, registered as the
// `local-dominance://` maplibre custom protocol. Same family as svf/openness
// (multi-direction terrain sampling) but a different quantity, and — crucially —
// a different sampling strategy built for speed (see below).
//
// Local Dominance (Hesse 2016; also RVT's "Local dominance"): place a virtual
// observer of eye height `oh` at each pixel and measure the angle DOWNWARD at
// which it sees the surrounding terrain, in several compass directions and at
// several distances, then average those angles. atan((zObserver − zTerrain) / d)
// is positive when the observer stands above what it's looking at, so the mean is
// high on local highs (mounds/ridges/tells that look down on their surroundings)
// and low/negative in enclosed depressions. It isolates closed mounds and pits,
// complementing Openness's general sky-exposure read.
//
// PERFORMANCE — pyramid octave sampling. A naive version samples every integer
// radius from minRadius to maxRadius at native resolution: directions ×
// (maxRadius−minRadius+1) atan calls per pixel over a maxRadius-wide halo — tens
// of millions of trig ops per tile plus a big neighbour fetch. Instead this snaps
// the annulus to powers of two and samples ONE ring per octave from the matching
// pyramid level (exactly LRM's ancestor-tile trick, lib/lrm-protocol.ts): a ring
// at native radius 2^L is a single 1-pixel step on the tile L levels up (already
// downsampled 2^L×, fetched once and shared across all 4^L fine sibling tiles).
// So a [2^a, 2^b] annulus costs directions × (b−a+1) samples (~a couple dozen)
// instead of directions × 2^b, and reads tiny coarse tiles instead of a wide
// native halo. The observer's own elevation is still read at full (native)
// resolution so local highs/lows aren't washed out.

import {
  sharedTileCache, fetchDecodedTile, fetchPaddedElevationGrid,
  buildProtocolUrl, groundResolutionM, tileRowToLatRad,
  YIELD_EVERY_ROWS, yieldToMainThread, type UpstreamEncoding,
} from "./normal-derived-protocol"
import { RAD_TO_DEG } from "./horizon-angle"
import { computeLocalDominanceRows, type LocalDominanceKernelInput } from "./local-dominance-kernel"
import { computeInWorker, rasterComputeInWorker } from "./raster-compute-pool"
import { toTileImage, type TileImage } from "./tile-image"

const LD_URL_RE = /^local-dominance:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?rmin=(\d+)&rmax=(\d+)$/

/** Nearest power-of-two octave exponent for a pixel radius, clamped so the UI's
 *  2..64 px range maps to octaves 1..6. */
function radiusToOctave(radiusPx: number): number {
  return Math.min(6, Math.max(1, Math.round(Math.log2(Math.max(2, radiusPx)))))
}

// minRadiusPx/maxRadiusPx are the inner/outer edges of the viewing annulus in
// native pixels; only their power-of-two octaves actually matter (see above), so
// the UI snaps them to powers of two. Baked into the tile URL so a change forces
// a fresh Source/tile cache (see the keySuffix on LocalDominanceSource).
export function buildLocalDominanceProtocolUrl(
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
  minRadiusPx = 8, maxRadiusPx = 32,
): string {
  return `${buildProtocolUrl("local-dominance", upstreamTileTemplate, encoding, tileSize)}?rmin=${minRadiusPx}&rmax=${maxRadiusPx}`
}

export async function localDominanceProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: TileImage }> {
  const match = params.url.match(LD_URL_RE)
  if (!match) throw new Error(`Invalid Local Dominance protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr, rminStr, rmaxStr] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)
  const signal = abortController.signal

  const octaveMin = radiusToOctave(parseInt(rminStr, 10))
  const octaveMax = Math.max(octaveMin, radiusToOctave(parseInt(rmaxStr, 10)))

  const upstreamUrl = (tz: number, tx: number, ty: number) =>
    upstreamTemplate.replace("{z}", String(tz)).replace("{x}", String(tx)).replace("{y}", String(ty))

  // Mercator-corrected ground size of one native pixel — one 1-pixel step at
  // octave L covers 2^L of these.
  const latDeg = tileRowToLatRad(y + 0.5, z) * RAD_TO_DEG
  const nativeGroundRes = groundResolutionM(latDeg, z, n)

  // Observer elevation is read at full native resolution (its own tile only).
  const centerTilePromise = fetchDecodedTile(sharedTileCache, upstreamUrl(z, x, y), encoding, signal)

  // One coarse ancestor grid per octave level (capped at the world root, like LRM).
  // Each is fetched once via the shared cache and reused across every fine sibling
  // tile that falls within its footprint.
  const levelPromises = []
  for (let L = octaveMin; L <= octaveMax; L++) {
    const levels = Math.min(L, z)
    const scale = 1 << levels
    const ancestorZ = z - levels
    const ancestorX = x >> levels
    const ancestorY = y >> levels
    levelPromises.push(
      fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, ancestorZ, ancestorX, ancestorY, n, signal, 1)
        .then((grid) => ({
          grid,
          scale,
          // This fine tile's position within the ancestor's footprint, in
          // ancestor-tile units — maps a fine pixel into the ancestor's own pixel
          // space below (with LRM's half-pixel box-center recentering).
          xOffsetTiles: x - (ancestorX << levels),
          yOffsetTiles: y - (ancestorY << levels),
          // Ground distance of a 1-coarse-pixel step at this level.
          dist: scale * nativeGroundRes,
        })),
    )
  }

  const centerTile = await centerTilePromise
  if (!centerTile) throw new Error(`Failed to fetch Local Dominance center tile at ${z}/${x}/${y}`)
  const levels = await Promise.all(levelPromises)
  const input: LocalDominanceKernelInput = {
    center: centerTile.data, centerWidth: centerTile.width, n,
    levels: levels.map((level) => ({
      padded: level.grid.padded, stride: level.grid.stride, scale: level.scale,
      xOffsetTiles: level.xOffsetTiles, yOffsetTiles: level.yOffsetTiles, invDist: 1 / level.dist,
    })),
  }

  // Settings → Streaming → Raster Compute in a Worker: the whole tile in the pool.
  if (rasterComputeInWorker()) return { data: await toTileImage(await computeInWorker("localDominance", input), n, n) }

  const outData = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row += YIELD_EVERY_ROWS) {
    if (row > 0) {
      if (signal.aborted) throw new Error("Aborted")
      await yieldToMainThread()
    }
    computeLocalDominanceRows(input, row, Math.min(n, row + YIELD_EVERY_ROWS), outData)
  }

  return { data: await toTileImage(outData, n, n) }
}
