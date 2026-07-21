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
  sharedTileCache, fetchDecodedTile, fetchPaddedElevationGrid, bilinearSamplePadded,
  buildProtocolUrl, groundResolutionM, tileRowToLatRad,
  YIELD_EVERY_ROWS, yieldToMainThread, type UpstreamEncoding,
} from "./normal-derived-protocol"
import { elevationToTerrarium } from "./elevation-encoding"
import { RAD_TO_DEG } from "./horizon-angle"

const LD_URL_RE = /^local-dominance:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?rmin=(\d+)&rmax=(\d+)$/

const OBSERVER_HEIGHT_M = 1.6

// 8 compass directions as (dRow, dCol) unit vectors. Fewer than a native-radius
// version would want, because octave sampling already contributes several
// independent rings (one per pyramid level) to the average — the directions
// don't have to carry all the smoothing on their own.
const LD_DIRECTIONS = 8
const DIR_VECTORS: readonly (readonly [number, number])[] = Array.from(
  { length: LD_DIRECTIONS },
  (_, i) => {
    const angle = (2 * Math.PI * i) / LD_DIRECTIONS
    return [Math.sin(angle), Math.cos(angle)] as const
  },
)

/** Nearest power-of-two octave exponent for a pixel radius, clamped so the UI's
 *  2..64 px range maps to octaves 1..6. */
export function radiusToOctave(radiusPx: number): number {
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
): Promise<{ data: Uint8Array }> {
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

  const outData = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    if (row > 0 && row % YIELD_EVERY_ROWS === 0) {
      if (signal.aborted) throw new Error("Aborted")
      await yieldToMainThread()
    }
    for (let col = 0; col < n; col++) {
      const observerElev = centerTile.data[row * centerTile.width + col] + OBSERVER_HEIGHT_M
      let sum = 0
      let count = 0
      for (const level of levels) {
        // Fine (row,col) → this level's coarse pixel coordinate (ancestor pixel
        // i is the box-average of fine pixels centered at i+0.5, hence +0.5/−0.5).
        const pcx = (level.xOffsetTiles * n + col + 0.5) / level.scale - 0.5
        const pcy = (level.yOffsetTiles * n + row + 0.5) / level.scale - 0.5
        const invDist = 1 / level.dist
        for (const [dRow, dCol] of DIR_VECTORS) {
          const terrain = bilinearSamplePadded(level.grid, pcx + dCol, pcy + dRow)
          // atan (not atan2): dist is always positive, so a single-argument atan
          // of the signed height-over-distance ratio gives the right signed angle
          // and is cheaper.
          sum += Math.atan((observerElev - terrain) * invDist)
          count++
        }
      }
      const value = count > 0 ? (sum / count) * RAD_TO_DEG : 0

      const [r, g, b, alpha] = elevationToTerrarium(value)
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
