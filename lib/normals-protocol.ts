// Client-side surface-normal tile computation, registered as the `normals://`
// maplibre custom protocol. Reuses lib/normal-derived-protocol.ts's shared
// tile-fetch/neighbor-stitch pipeline and its Horn-kernel gradient (the exact
// same dx/dy every other derived mode — slope, aspect, curvature — already
// computes), but does NOT go through runNormalDerivedProtocol: that helper
// always re-packs its per-pixel scalar as a Terrarium-encoded pseudo-elevation
// (so it can drop into maplibre's raster-dem/color-relief pipeline), which
// isn't what a normal map is — this needs the raw (nx, ny, nz) unit vector
// encoded directly as RGB. Its exported computeNormalPixels() is also the
// shared per-pixel work behind lib/matcap-protocol.ts and lib/phong-protocol.ts,
// which each further transform this same normal data (a matcap lookup, a
// Phong light calculation) into their own final tile — both are themselves
// plain maplibre `raster` sources, draped over 3D terrain the same
// automatic way the raster basemap is, no custom WebGL layer involved.
//
// Encoding: a standard "object-space" normal map (not tangent-space — a
// heightfield has no per-vertex tangent basis ambiguity, its "object" already
// is the flat tile-local XY plane), R/G/B = (nx, ny, nz) * 0.5 + 0.5. nx/ny
// are defined directly along the tile's own column/row pixel axes: nx follows
// the column axis (increasing eastward, standard XYZ tile scheme), ny follows
// the row axis (increasing southward) — i.e. (x=east, y=south, z=up), which
// matcap-protocol.ts/phong-protocol.ts both rely on directly.
import {
  sharedTileCache, fetchPaddedElevationGrid, hornGradient, tileRowToLatRad, groundResolutionM, RAD_TO_DEG,
  buildProtocolUrl, yieldToMainThread, YIELD_EVERY_ROWS,
  type UpstreamEncoding, type ElevationWindow, type PaddedElevationGrid,
} from "./normal-derived-protocol"
import { computeNormalPixelsGPU } from "./gpu-normal-compute"

const NORMALS_URL_RE = /^normals:\/\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildNormalsProtocolUrl(upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number): string {
  return buildProtocolUrl("normals", upstreamTileTemplate, encoding, tileSize)
}

async function computeNormalPixelsUncached(
  upstreamTemplate: string, encoding: UpstreamEncoding, z: number, x: number, y: number, n: number, signal: AbortSignal,
): Promise<{ pixels: Uint8ClampedArray; grid: PaddedElevationGrid }> {
  const grid = await fetchPaddedElevationGrid(sharedTileCache, upstreamTemplate, encoding, z, x, y, n, signal)
  const { padded, stride } = grid

  const latCenterDeg = tileRowToLatRad(y + 0.5, z) * RAD_TO_DEG
  const groundResM = groundResolutionM(latCenterDeg, z, n)
  const invScale = 1 / groundResM

  // GPU path: one WebGL2 draw call does every pixel's Horn-gradient +
  // normalize + encode at once, instead of a JS loop doing a sqrt and
  // several multiplies per pixel — see gpu-normal-compute.ts's header for
  // why this is correct (row-order, texel addressing) and how it was
  // verified against this exact CPU loop. Falls through to CPU if WebGL2
  // isn't available for any reason (old browser, context creation failure).
  const gpuPixels = computeNormalPixelsGPU(padded, stride, n, invScale)
  if (gpuPixels) return { pixels: gpuPixels, grid }

  const pixels = new Uint8ClampedArray(n * n * 4)
  for (let row = 0; row < n; row++) {
    // See normal-derived-protocol.ts's runWindowedProtocol for why this
    // matters: addProtocol handlers (and this direct-call equivalent) run on
    // the main thread, and a matcap/Phong layer can need several new tiles
    // computed back-to-back right when the user zooms/pans — without
    // yielding, that's one long uninterrupted synchronous burst per tile.
    if (row > 0 && row % YIELD_EVERY_ROWS === 0) {
      if (signal.aborted) throw new Error("Aborted")
      await yieldToMainThread()
    }
    const pr = row + 1
    for (let col = 0; col < n; col++) {
      const pc = col + 1
      const window: ElevationWindow = {
        a0: padded[(pr - 1) * stride + (pc - 1)], a1: padded[(pr - 1) * stride + pc], a2: padded[(pr - 1) * stride + (pc + 1)],
        a3: padded[pr * stride + (pc - 1)], a4: padded[pr * stride + pc], a5: padded[pr * stride + (pc + 1)],
        a6: padded[(pr + 1) * stride + (pc - 1)], a7: padded[(pr + 1) * stride + pc], a8: padded[(pr + 1) * stride + (pc + 1)],
        invEwresXscale: invScale,
        invNsresYscale: invScale,
        groundResolutionM: groundResM,
      }

      // Standard heightfield-to-normal formula: a surface z = f(col, row) has
      // (unnormalized) normal (-dz/dcol, -dz/drow, 1); dx/dy from hornGradient
      // already are dz/d(ground distance) along those two pixel axes.
      const { dx, dy } = hornGradient(window)
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + 1)
      const nx = -dx * invLen
      const ny = -dy * invLen
      const nz = invLen

      const idx = (row * n + col) * 4
      pixels[idx] = Math.round((nx * 0.5 + 0.5) * 255)
      pixels[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      pixels[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      pixels[idx + 3] = 255
    }
  }

  return { pixels, grid }
}

// Cache keyed WITHOUT any matcap/phong-specific parameter (rotation, light
// direction, diffuse/specular strength) — matcap-protocol.ts and
// phong-protocol.ts both call computeNormalPixels with the exact same
// (upstreamTemplate, encoding, z, x, y, n) regardless of their own params, so
// caching at this level means dragging a rotation or light-direction slider
// reuses the already-computed normal map and only redoes that protocol's own
// cheap final per-pixel step (a matcap lookup, or a light dot-product),
// instead of re-fetching/re-decoding the DEM and rerunning Horn-gradient math
// on every slider tick.
const NORMAL_PIXELS_CACHE_MAX = 200
interface NormalPixelsCacheEntry {
  promise: Promise<{ pixels: Uint8ClampedArray; grid: PaddedElevationGrid }>
  /** This entry's OWN AbortController — never the same object as any single
   *  caller's signal, so one caller's cancellation can't poison the entry
   *  for others sharing it (see computeNormalPixels's doc comment). */
  controller: AbortController
  /** How many callers currently await this entry — the shared computation
   *  is only aborted once this reaches zero. */
  refCount: number
}
const normalPixelsCache = new Map<string, NormalPixelsCacheEntry>()

/** The shared per-pixel work behind normalsProtocol (PNG bytes, for the
 *  `normals://` addProtocol registration / debug-via-raster-Source path) and
 *  the matcap:// / phong:// protocols (lib/matcap-protocol.ts,
 *  lib/phong-protocol.ts), which reuse this directly (no PNG round-trip
 *  needed — they read the encoded (nx,ny,nz) bytes straight out of `pixels`)
 *  since their own final tile is a further per-pixel transform of the same
 *  normal data (a matcap lookup, or a Phong light calculation) rather than
 *  the normal map itself. One upstream fetch produces both the encoded-
 *  normal data and (via the returned grid) whatever elevation samples a
 *  caller separately needs, instead of fetching twice.
 *
 *  `signal` is the CALLING protocol invocation's own AbortSignal — it is
 *  deliberately NOT the signal used for the underlying (possibly shared,
 *  cached) computation below. Dragging the matcap rotation slider or the
 *  Phong light-direction pad fires a new matcap:// / phong:// URL per commit,
 *  each with the SAME (upstreamTemplate, z, x, y) but a different rotation/
 *  light param; maplibre cancels the now-superseded PREVIOUS request's
 *  AbortController as soon as a newer one supersedes it. If that cancelled
 *  caller's own signal were what drove the shared cache entry, its abort
 *  would reject the cache entry's promise — poisoning it for every OTHER
 *  concurrent caller reusing that same entry, even ones whose own request
 *  was never cancelled. That was causing a visible flicker: some commits'
 *  tiles would silently fail to update (still showing the previous rotation/
 *  light state) while others succeeded, alternating unpredictably as
 *  cancellations raced the cache. Each cache entry gets its own internal
 *  AbortController instead, aborted only if EVERY caller interested in it
 *  has gone away (refcounted below), never by a single caller's own cancel. */
export function computeNormalPixels(
  upstreamTemplate: string, encoding: UpstreamEncoding, z: number, x: number, y: number, n: number, signal: AbortSignal,
): Promise<{ pixels: Uint8ClampedArray; grid: PaddedElevationGrid }> {
  const key = `${upstreamTemplate}|${encoding}|${z}|${x}|${y}|${n}`
  let entry = normalPixelsCache.get(key)
  if (!entry) {
    const internalController = new AbortController()
    const promise = computeNormalPixelsUncached(upstreamTemplate, encoding, z, x, y, n, internalController.signal)
    entry = { promise, controller: internalController, refCount: 0 }
    // A rejected promise (internal abort, network failure) shouldn't poison
    // the cache for a subsequent, potentially-successful retry of the same tile.
    promise.catch(() => normalPixelsCache.delete(key))
    if (normalPixelsCache.size >= NORMAL_PIXELS_CACHE_MAX) {
      const oldestKey = normalPixelsCache.keys().next().value
      if (oldestKey !== undefined) normalPixelsCache.delete(oldestKey)
    }
    normalPixelsCache.set(key, entry)
  } else {
    // Bump to most-recently-used (Map preserves insertion order, so
    // delete+re-set moves this key to the end).
    normalPixelsCache.delete(key)
    normalPixelsCache.set(key, entry)
  }

  entry.refCount++
  const onCallerAbort = () => {
    entry!.refCount--
    // Only abort the shared computation once NO caller (across matcap,
    // phong, normals, or a future consumer) is still waiting on it.
    if (entry!.refCount <= 0) entry!.controller.abort()
  }
  if (signal.aborted) onCallerAbort()
  else signal.addEventListener("abort", onCallerAbort, { once: true })

  return entry.promise
}

export async function normalsProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(NORMALS_URL_RE)
  if (!match) throw new Error(`Invalid normals protocol URL: ${params.url}`)
  const [, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10)
  const x = parseInt(xStr, 10)
  const y = parseInt(yStr, 10)

  const { pixels } = await computeNormalPixels(upstreamTemplate, encoding, z, x, y, n, abortController.signal)
  // See matcap-protocol.ts / phong-protocol.ts's identical check: maplibre's
  // own request layer never checks abortController.signal itself, so a
  // superseded request would otherwise still resolve and could be applied
  // out of order.
  if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError")

  const canvas = new OffscreenCanvas(n, n)
  const ctx = canvas.getContext("2d")!
  // Cast: this TS lib version's ImageData overload wants Uint8ClampedArray<ArrayBuffer>
  // specifically, not the more general <ArrayBufferLike> a fresh typed array
  // is inferred as — a real ArrayBuffer backs it either way at runtime.
  ctx.putImageData(new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError")
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}

