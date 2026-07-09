import { elevationToTerrainrgb } from "./elevation-encoding"

// Shared scaffolding behind the `aspect://`, `tri://` and `curvature://` maplibre
// custom protocols — the same tile-fetch/neighbor-stitch/re-encode pipeline
// lib/slope-protocol.ts already implements, factored out so those three (which only
// differ in the per-pixel formula applied to the 3x3 elevation window) don't each
// duplicate ~200 lines of identical plumbing. slope-protocol.ts itself is left
// untouched — it predates this file and is proven in production, not worth the
// regression risk of migrating it onto a shared abstraction after the fact.
//
// Every derived attribute is re-packed through the same terrainrgb encoding this
// app already uses for elevation (see slope-protocol.ts's header comment for why),
// so it drops into the existing color-relief layer/ramp machinery unchanged — the
// paint layer never needs to know whether "elevation" means meters, degrees, or a
// ruggedness index.

export type UpstreamEncoding = "terrarium" | "mapbox"

export type DecodedTile = { data: Float32Array; width: number; height: number }

// -------------------------
// Decoded-tile LRU cache — shared by every normal-derived protocol (slope, aspect,
// TRI, curvature), since with more than one active at once they're all decoding
// the exact same upstream tiles (same terrain source, same z/x/y neighborhoods).
// One cache means the expensive part (fetch + RGBA-to-elevation decode) happens
// once per tile regardless of how many derived layers are turned on — only the
// cheap per-pixel kernel math (Horn gradient, Laplacian, etc.) repeats per mode.
// -------------------------

const TILE_CACHE_MAX = 400

export function createTileCache() {
  return new Map<string, Promise<DecodedTile | null>>()
}

/** Single instance shared across slope/aspect/tri/curvature-protocol.ts. */
export const sharedTileCache = createTileCache()

function cacheGet(cache: Map<string, Promise<DecodedTile | null>>, key: string) {
  const value = cache.get(key)
  if (value) {
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

function cacheSet(cache: Map<string, Promise<DecodedTile | null>>, key: string, value: Promise<DecodedTile | null>) {
  if (cache.size >= TILE_CACHE_MAX) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, value)
}

export async function fetchDecodedTile(
  cache: Map<string, Promise<DecodedTile | null>>,
  url: string,
  encoding: UpstreamEncoding,
  signal: AbortSignal,
): Promise<DecodedTile | null> {
  const cached = cacheGet(cache, url)
  if (cached) return cached

  const promise = (async (): Promise<DecodedTile | null> => {
    try {
      const response = await fetch(url, { signal })
      if (!response.ok) return null
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(bitmap, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

      const elevations = new Float32Array(width * height)
      for (let i = 0; i < width * height; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
        elevations[i] = encoding === "terrarium"
          ? (r * 256 + g + b / 256) - 32768
          : -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
      }
      return { data: elevations, width, height }
    } catch {
      return null
    }
  })()

  cacheSet(cache, url, promise)
  promise.then((result) => { if (!result) cache.delete(url) })
  return promise
}

// -------------------------
// Tile math helpers
// -------------------------

function wrapTileX(x: number, z: number): number {
  const size = 1 << z
  return ((x % size) + size) % size
}

function tileRowToLatRad(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z)
  return Math.atan(Math.sinh(n))
}

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137
export const RAD_TO_DEG = 180 / Math.PI

// -------------------------
// Shared 3x3 window passed to each protocol's compute function
// -------------------------

export interface ElevationWindow {
  /** Indexed 0 1 2 / 3 4 5 / 6 7 8, matching GDAL's convention — a4 is the center pixel. */
  a0: number; a1: number; a2: number
  a3: number; a4: number; a5: number
  a6: number; a7: number; a8: number
  /** 1 / (ground resolution in meters, Mercator-corrected) — multiply a raw elevation
   *  difference by this to get "per meter of ground distance". */
  invEwresXscale: number
  invNsresYscale: number
  /** Ground resolution in meters (Mercator-corrected) — the reciprocal of the above,
   *  handed over pre-computed for formulas (e.g. curvature) that want distance
   *  rather than inverse-distance. */
  groundResolutionM: number
}

export interface RunNormalDerivedProtocolParams {
  url: string
  urlRegex: RegExp
  abortController: AbortController
  cache: Map<string, Promise<DecodedTile | null>>
  computeValue: (window: ElevationWindow) => number
}

/** Parses a `{proto}://{encoding}/{tileSize}/{encodedTemplate}/{z}/{x}/{y}` URL (the
 *  same scheme buildSlopeProtocolUrl uses), fetches the center tile + 8 neighbors,
 *  and calls `computeValue` once per output pixel. */
export async function runNormalDerivedProtocol(
  params: RunNormalDerivedProtocolParams,
): Promise<{ data: Uint8Array }> {
  const { url, urlRegex, abortController, cache, computeValue } = params
  const match = url.match(urlRegex)
  if (!match) throw new Error(`Invalid normal-derived protocol URL: ${url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)
  const worldSize = 1 << z

  const upstreamUrl = (tx: number, ty: number) =>
    upstreamTemplate.replace("{z}", String(z)).replace("{x}", String(tx)).replace("{y}", String(ty))

  const tilePromises = new Map<string, Promise<DecodedTile | null>>()
  for (let tdy = -1; tdy <= 1; tdy++) {
    const ty = y + tdy
    if (ty < 0 || ty >= worldSize) continue
    for (let tdx = -1; tdx <= 1; tdx++) {
      const tx = wrapTileX(x + tdx, z)
      tilePromises.set(`${tdx},${tdy}`, fetchDecodedTile(cache, upstreamUrl(tx, ty), encoding, abortController.signal))
    }
  }

  const resolved = new Map<string, DecodedTile | null>()
  await Promise.all(
    Array.from(tilePromises.entries()).map(async ([key, promise]) => {
      resolved.set(key, await promise)
    }),
  )

  const centerTile = resolved.get("0,0")
  if (!centerTile) throw new Error(`Failed to fetch center tile at ${z}/${x}/${y}`)

  const sampleElevation = (tdx: number, tdy: number, row: number, col: number): number => {
    const tile = resolved.get(`${tdx},${tdy}`)
    const source = tile ?? centerTile
    const r = Math.min(Math.max(row, 0), source.height - 1)
    const c = Math.min(Math.max(col, 0), source.width - 1)
    return source.data[r * source.width + c]
  }

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

  const groundResolutionM = EARTH_CIRCUMFERENCE_M / (n * worldSize)
  const latCenterRad = tileRowToLatRad(y + 0.5, z)
  const scale = Math.cos(latCenterRad)
  const scaledGroundResolutionM = groundResolutionM * scale
  const invEwresXscale = 1 / scaledGroundResolutionM
  const invNsresYscale = 1 / scaledGroundResolutionM

  const outData = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    const pr = row + 1
    for (let col = 0; col < n; col++) {
      const pc = col + 1
      const window: ElevationWindow = {
        a0: padded[(pr - 1) * stride + (pc - 1)],
        a1: padded[(pr - 1) * stride + pc],
        a2: padded[(pr - 1) * stride + (pc + 1)],
        a3: padded[pr * stride + (pc - 1)],
        a4: padded[pr * stride + pc],
        a5: padded[pr * stride + (pc + 1)],
        a6: padded[(pr + 1) * stride + (pc - 1)],
        a7: padded[(pr + 1) * stride + pc],
        a8: padded[(pr + 1) * stride + (pc + 1)],
        invEwresXscale,
        invNsresYscale,
        groundResolutionM: scaledGroundResolutionM,
      }

      const [r, g, b, alpha] = elevationToTerrainrgb(computeValue(window))
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

/** Ported from lib/slope-protocol.ts's Horn-kernel dx/dy — shared by aspect (which
 *  needs the same gradient, just fed through atan2 instead of atan(sqrt(dx²+dy²))). */
export function hornGradient(w: ElevationWindow): { dx: number; dy: number } {
  const dx = (w.a0 + w.a3 + w.a3 + w.a6 - (w.a2 + w.a5 + w.a5 + w.a8)) * w.invEwresXscale
  const dy = (w.a6 + w.a7 + w.a7 + w.a8 - (w.a0 + w.a1 + w.a1 + w.a2)) * w.invNsresYscale
  return { dx, dy }
}

export function buildProtocolUrl(
  scheme: string,
  upstreamTileTemplate: string,
  encoding: UpstreamEncoding,
  tileSize: number,
): string {
  return `${scheme}://${encoding}/${tileSize}/${encodeURIComponent(upstreamTileTemplate)}/{z}/{x}/{y}`
}
