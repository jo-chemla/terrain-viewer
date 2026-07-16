import { elevationToTerrainrgb } from "./elevation-encoding"
import { cogProtocol } from "@geomatico/maplibre-cog-protocol"
import { float32demProtocol } from "./float32dem-protocol"

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

// Ported from maplibre-gl-js's own `getTileBBox` (the "whoots" WMS-url helper it
// vendors internally to substitute `{bbox-epsg-3857}` for ordinary WMS raster/
// raster-dem Sources) — replicated here because wms-raw's `float32demProtocol` is
// called directly, bypassing maplibre's Source/tile machinery entirely, so nothing
// else performs that substitution for us. Formula: standard Web Mercator tile
// bounds at (x, y, z), XYZ (Google/OSM) scheme.
const MERCATOR_EARTH_RADIUS = 6378137
function tileBBoxEPSG3857(x: number, y: number, z: number): string {
  const size = 1 << z
  const resolution = (2 * Math.PI * MERCATOR_EARTH_RADIUS / 256) / size
  const merc = (px: number) => px * resolution - Math.PI * MERCATOR_EARTH_RADIUS
  const flippedY = size - y - 1
  const minX = merc(x * 256)
  const minY = merc(flippedY * 256)
  const maxX = merc((x + 1) * 256)
  const maxY = merc((flippedY + 1) * 256)
  return `${minX},${minY},${maxX},${maxY}`
}

// COG tiles don't come from a real HTTP endpoint — `cog://` is a maplibre custom
// protocol (see @geomatico/maplibre-cog-protocol, registered via addProtocol in
// TerrainViewer.tsx) that reads GeoTIFF byte ranges directly and renders a
// terrain-rgb-encoded tile in-memory, returned as a ready-to-draw ImageBitmap —
// this is the exact same mechanism the primary elevation/hillshade/hypsometric
// sources use to ingest a COG (see TerrainSources in MapSources.tsx, which also
// registers the per-URL color function this reuses via setColorFunction). Calling
// it directly (instead of only going through maplibre's Source/tile machinery)
// is what lets slope/aspect/TRI/curvature work on COG terrain sources too, not
// just plain terrarium/terrainrgb XYZ tiles.
//
// `float32dem-bbox://` is this file's own pseudo-scheme (not a real maplibre
// protocol) wrapping a wms-raw source's GetMap URL template — since that template
// still has its own unresolved `{bbox-epsg-3857}` placeholder (only ever
// substituted by maplibre itself for ordinary Sources), we substitute it here
// using the tile's own (z, x, y) — encoded as the URL's trailing /{z}/{x}/{y}
// segments by buildWmsRawUpstreamTemplate in MapSources.tsx — before handing the
// resolved GetMap URL to float32demProtocol.
async function loadTileBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  if (url.startsWith("cog://")) {
    const result = await cogProtocol({ url, type: "image" } as any)
    return (result as any).data as ImageBitmap
  }
  if (url.startsWith("float32dem-bbox://")) {
    const match = url.match(/^float32dem-bbox:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/)
    if (!match) return null
    const [, encodedWmsUrl, zStr, xStr, yStr] = match
    const bbox = tileBBoxEPSG3857(Number(xStr), Number(yStr), Number(zStr))
    const resolvedUrl = decodeURIComponent(encodedWmsUrl).replace("{bbox-epsg-3857}", bbox)
    const result = await float32demProtocol({ url: `float32dem://${resolvedUrl}` }, { signal } as AbortController)
    const blob = new Blob([result.data.buffer as ArrayBuffer], { type: "image/png" })
    return createImageBitmap(blob)
  }
  const response = await fetch(url, { signal })
  if (!response.ok) return null
  const blob = await response.blob()
  return createImageBitmap(blob)
}

export async function fetchDecodedTile(
  cache: Map<string, Promise<DecodedTile | null>>,
  url: string,
  encoding: UpstreamEncoding,
  signal: AbortSignal,
): Promise<DecodedTile | null> {
  const cached = cacheGet(cache, url)
  if (cached) return cached

  const decode = async (): Promise<DecodedTile | null> => {
    const bitmap = await loadTileBitmap(url, signal)
    if (!bitmap) return null
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
  }

  const promise = (async (): Promise<DecodedTile | null> => {
    try {
      return await decode()
    } catch {
      // A tile fetch/decode failure is often transient — a rate-limited WMS
      // endpoint (some, like IGN's, cap at 1 req/sec while the Horn kernel fires 9
      // concurrent neighbor requests per output tile) or a momentary COG
      // byte-range read blip. One short-delayed retry clears most of these
      // without letting a single bad tile block the whole neighborhood — the
      // caller (runNormalDerivedProtocol) still falls back gracefully to
      // neighboring/center data if this second attempt also fails.
      if (signal.aborted) return null
      await new Promise((resolve) => setTimeout(resolve, 400))
      if (signal.aborted) return null
      try {
        return await decode()
      } catch {
        return null
      }
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

export function tileRowToLatRad(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z)
  return Math.atan(Math.sinh(n))
}

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137
export const RAD_TO_DEG = 180 / Math.PI

/** Web Mercator meters-per-pixel at a given latitude/zoom — same formula the
 *  protocols use internally, exposed for UI display (e.g. showing a px-based
 *  radius/window control's real-world size at the viewport center). */
export function groundResolutionM(latDeg: number, zoom: number, tileSize = 256): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(latDeg / RAD_TO_DEG)) / (tileSize * Math.pow(2, zoom))
}

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

export interface PaddedElevationGrid {
  /** (n+2*halo)x(n+2*halo) elevation grid: the tile's own n x n pixels plus a
   *  halo-pixel border sampled from its 8 same-zoom neighbors (edge/world-boundary
   *  pixels repeat the nearest neighbor's edge — see sampleElevation's row/col
   *  clamp below). No extra tile fetches are needed for halo > 1 since each
   *  same-zoom neighbor is already fetched in full — a wider halo just reads
   *  further into data that's already resolved. */
  padded: Float32Array
  stride: number
  centerTile: DecodedTile
}

/** Fetches a tile's 8 same-zoom neighbors (via the shared decoded-tile cache) and
 *  stitches all 9 into one padded elevation grid — the piece every normal-derived
 *  protocol (slope/aspect/TRI/curvature/TPI/roughness/blobness) needs at the tile's
 *  own zoom, and LRM (lib/lrm-protocol.ts) additionally needs one level further, at
 *  a lower zoom to fetch its already-downsampled ancestor tile as the low-pass
 *  component. `halo` defaults to 1 (a 3x3 window, what every mode except blobness
 *  uses) — blobness-protocol.ts passes 2 for the wider 5x5 window its structure
 *  tensor needs (a 3x3 grid of Horn gradients, each itself needing a 3x3 neighborhood). */
export async function fetchPaddedElevationGrid(
  cache: Map<string, Promise<DecodedTile | null>>,
  upstreamTemplate: string,
  encoding: UpstreamEncoding,
  z: number,
  x: number,
  y: number,
  n: number,
  abortSignal: AbortSignal,
  halo = 1,
): Promise<PaddedElevationGrid> {
  const worldSize = 1 << z

  const upstreamUrl = (tx: number, ty: number) =>
    upstreamTemplate.replace("{z}", String(z)).replace("{x}", String(tx)).replace("{y}", String(ty))

  const tilePromises = new Map<string, Promise<DecodedTile | null>>()
  for (let tdy = -1; tdy <= 1; tdy++) {
    const ty = y + tdy
    if (ty < 0 || ty >= worldSize) continue
    for (let tdx = -1; tdx <= 1; tdx++) {
      const tx = wrapTileX(x + tdx, z)
      tilePromises.set(`${tdx},${tdy}`, fetchDecodedTile(cache, upstreamUrl(tx, ty), encoding, abortSignal))
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

  const stride = n + 2 * halo
  const padded = new Float32Array(stride * stride)
  for (let pr = 0; pr < stride; pr++) {
    const globalRow = pr - halo
    const tdy = globalRow < 0 ? -1 : globalRow >= n ? 1 : 0
    const srcRow = globalRow - tdy * n
    for (let pc = 0; pc < stride; pc++) {
      const globalCol = pc - halo
      const tdx = globalCol < 0 ? -1 : globalCol >= n ? 1 : 0
      const srcCol = globalCol - tdx * n
      padded[pr * stride + pc] = sampleElevation(tdx, tdy, srcRow, srcCol)
    }
  }

  return { padded, stride, centerTile }
}

/** Bilinearly samples a PaddedElevationGrid at a fractional (px, py) given in the
 *  tile's own *unpadded* pixel space (0..n, y-down) — used by LRM to read the coarse
 *  ancestor grid at a fine-tile pixel's mapped coordinate without boxy edges. */
export function bilinearSamplePadded(grid: PaddedElevationGrid, px: number, py: number): number {
  const { padded, stride } = grid
  const gx = px + 1
  const gy = py + 1
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const clamp = (v: number) => Math.min(Math.max(v, 0), stride - 1)
  const x0c = clamp(x0), x1c = clamp(x0 + 1), y0c = clamp(y0), y1c = clamp(y0 + 1)
  const v00 = padded[y0c * stride + x0c]
  const v10 = padded[y0c * stride + x1c]
  const v01 = padded[y1c * stride + x0c]
  const v11 = padded[y1c * stride + x1c]
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy
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

  const { padded, stride } = await fetchPaddedElevationGrid(
    cache, upstreamTemplate, encoding, z, x, y, n, abortController.signal,
  )

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

export interface RunWindowedProtocolParams {
  url: string
  urlRegex: RegExp
  abortController: AbortController
  cache: Map<string, Promise<DecodedTile | null>>
  /** Border width (in pixels) needed around each output pixel — see fetchPaddedElevationGrid. */
  halo: number
  /** Called once per output pixel. `sample(dr, dc)` reads the elevation at
   *  (row+dr, col+dc) relative to the pixel, for |dr|,|dc| <= halo — the
   *  arbitrary-window equivalent of runNormalDerivedProtocol's fixed ElevationWindow,
   *  for modes (currently only blobness) whose kernel doesn't fit in a 3x3 window. */
  computeValue: (sample: (dr: number, dc: number) => number, groundResolutionM: number) => number
}

// Hands control back to the browser's main-thread event loop (a macrotask, not
// just a microtask — a plain `await Promise.resolve()` wouldn't let a queued
// click/input event run first). addProtocol handlers execute on the main
// thread, not a worker, so a large enough halo (SVF/Openness's ray-marched
// search radius, an order of magnitude more per-pixel work than every other
// mode's fixed 3x3/5x5 window) can block the thread long enough that a
// checkbox click sits queued behind the whole tile's computation instead of
// registering immediately. Yielding every YIELD_EVERY_ROWS rows interleaves
// this work with the rest of the event loop without changing its total cost.
const YIELD_EVERY_ROWS = 16
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Same URL scheme and tile-fetch pipeline as runNormalDerivedProtocol, generalized
 *  to an arbitrary halo instead of always fetching/exposing a fixed 3x3 window. */
export async function runWindowedProtocol(
  params: RunWindowedProtocolParams,
): Promise<{ data: Uint8Array }> {
  const { url, urlRegex, abortController, cache, halo, computeValue } = params
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

  const { padded, stride } = await fetchPaddedElevationGrid(
    cache, upstreamTemplate, encoding, z, x, y, n, abortController.signal, halo,
  )

  const groundResolutionM = EARTH_CIRCUMFERENCE_M / (n * worldSize)
  const latCenterRad = tileRowToLatRad(y + 0.5, z)
  const scale = Math.cos(latCenterRad)
  const scaledGroundResolutionM = groundResolutionM * scale

  const outData = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    if (row > 0 && row % YIELD_EVERY_ROWS === 0) {
      if (abortController.signal.aborted) throw new Error("Aborted")
      await yieldToMainThread()
    }
    const pr = row + halo
    for (let col = 0; col < n; col++) {
      const pc = col + halo
      const sample = (dr: number, dc: number) => padded[(pr + dr) * stride + (pc + dc)]

      const [r, g, b, alpha] = elevationToTerrainrgb(computeValue(sample, scaledGroundResolutionM))
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
