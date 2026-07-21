// Client-side matcap-shaded tile computation, registered as the `matcap://`
// maplibre custom protocol — a plain `raster` source/layer pair (see
// components/LayersAndSources/MapSources.tsx's MatcapSource / MapLayers.tsx's
// MatcapRasterLayer), draped over 3D terrain AND globe the exact same
// automatic way the raster basemap already is. No custom WebGL layer, no
// hand-rolled mesh, no custom projection matrix: maplibre's own terrain/
// globe renderer already knows how to drape ANY raster tile source, which is
// all this ever needed — a prior hand-written CustomLayerInterface attempt
// needed a full mesh + maplibre's globe-aware `projectTileFor3D` shader
// helper just to reach parity with what this file gets for free.
//
// Reuses lib/normals-protocol.ts's computeNormalPixels for the per-pixel
// surface normal (same upstream DEM fetch/decode every other derived mode in
// this app shares, cached independent of rotation/exaggeration — dragging
// the "Sphere Rotation" slider never re-derives it). The matcap lookup
// itself (rotate the normal's (x, y), use the rotated (x, y) as a UV into
// the matcap material image) runs on the GPU via gpu-matcap-compute.ts —
// this is real per-tile recompute work (MapLibre's raster-source model has
// no live-uniform hook, so every rotation/exaggeration change still costs a
// full tile round-trip through addProtocol → PNG encode → async decode →
// texture upload), so accelerating the actual shading math matters. Falls
// back to an equivalent CPU loop if WebGL2 is ever unavailable.
import { computeNormalPixels } from "./normals-protocol"
import { buildProtocolUrl, type UpstreamEncoding } from "./normal-derived-protocol"
import { computeMatcapPixelsGPU } from "./gpu-matcap-compute"

const MATCAP_URL_RE = /^matcap:\/\/([^/]+)\/(-?[\d.]+)\/(-?[\d.]+)\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildMatcapProtocolUrl(
  matcapUrl: string, rotationDeg: number, exaggeration: number,
  upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
): string {
  const base = buildProtocolUrl("matcap", upstreamTileTemplate, encoding, tileSize)
  // buildProtocolUrl's own scheme://encoding/tileSize/template/{z}/{x}/{y}
  // shape doesn't have room for extra params — splice matcapUrl/rotationDeg/
  // exaggeration in right after the scheme instead of inventing a second URL
  // builder.
  return base.replace("matcap://", `matcap://${encodeURIComponent(matcapUrl)}/${rotationDeg}/${exaggeration}/`)
}

// maplibre's own request layer (util/ajax.ts's makeRequest) calls the
// protocol function directly and applies WHATEVER it resolves with — it
// never checks abortController.signal itself. That alone isn't the whole
// story, though: verified via live instrumentation (timestamped logging per
// call) that when the SOURCE's tiles URL template itself changes (a new
// rotation/exaggeration commit), maplibre does NOT abort tile requests still
// in flight under the OLD template at all — abortController.signal.aborted
// stays false for them the entire time. They just keep running (a real,
// sometimes 1-2 second round-trip) and resolve successfully whenever they
// finish, however much later. Since maplibre's raster tile cache is keyed by
// z/x/y (not the full URL), an old-template result for a z/x/y that ALSO got
// a newer-template request can land in that same slot AFTER the newer one
// already did — repainting it with stale shading. This is the actual "old,
// new, old, new" flicker; no amount of checking abortController.signal
// catches it, because that signal genuinely never flips for this case.
//
// Fixed with an independent staleness guard: __currentParamsKey tracks the
// most recent (matcapUrl, rotationDeg, exaggeration) tuple seen across ALL
// matcap:// calls, regardless of which tile. Multiple concurrent calls for
// different z/x/y under the SAME (current) params are legitimate and never
// flagged stale; a call whose own params have since been superseded by a
// newer tuple is provably outdated and refused right before it would
// otherwise resolve, no matter what maplibre's own AbortController says.
let __currentParamsKey = ""

interface MatcapPixels { data: Uint8ClampedArray; width: number; height: number }

// CPU fallback only (GPU path uploads its own WebGL texture directly, see
// gpu-matcap-compute.ts's getMatcapTexture) — still a fixed curated list
// (lib/matcap-textures.ts), so this cache never meaningfully grows either.
const matcapPixelCache = new Map<string, Promise<MatcapPixels>>()

async function loadMatcapPixels(url: string): Promise<MatcapPixels> {
  const cached = matcapPixelCache.get(url)
  if (cached) return cached
  const promise = (async () => {
    const res = await fetch(url)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { data: imageData.data, width: canvas.width, height: canvas.height }
  })()
  matcapPixelCache.set(url, promise)
  return promise
}

// Only reached if computeMatcapPixelsGPU returns null (no WebGL2) — same
// math, same output layout, just the original per-pixel JS loop.
async function shadeMatcapCPU(
  normalPixels: Uint8ClampedArray, n: number, matcapUrl: string, rotationRad: number, exaggeration: number,
): Promise<Uint8ClampedArray> {
  const matcap = await loadMatcapPixels(matcapUrl)
  const cosR = Math.cos(rotationRad)
  const sinR = Math.sin(rotationRad)
  const out = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const idx = i * 4
    let nx = (normalPixels[idx] / 255) * 2 - 1
    let ny = (normalPixels[idx + 1] / 255) * 2 - 1
    const nz = (normalPixels[idx + 2] / 255) * 2 - 1

    if (exaggeration !== 1) {
      const sx = (nx / nz) * exaggeration
      const sy = (ny / nz) * exaggeration
      const len = Math.sqrt(sx * sx + sy * sy + 1) || 1
      nx = sx / len
      ny = sy / len
    }

    const rx = nx * cosR + ny * sinR
    const ry = -nx * sinR + ny * cosR

    const u = rx * 0.5 + 0.5
    const v = ry * 0.5 + 0.5
    const mx = Math.min(matcap.width - 1, Math.max(0, Math.round(u * (matcap.width - 1))))
    const my = Math.min(matcap.height - 1, Math.max(0, Math.round(v * (matcap.height - 1))))
    const mIdx = (my * matcap.width + mx) * 4

    out[idx] = matcap.data[mIdx]
    out[idx + 1] = matcap.data[mIdx + 1]
    out[idx + 2] = matcap.data[mIdx + 2]
    out[idx + 3] = 255
  }
  return out
}

export async function matcapProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(MATCAP_URL_RE)
  if (!match) throw new Error(`Invalid matcap protocol URL: ${params.url}`)
  const [, encodedMatcapUrl, rotationDegStr, exaggerationStr, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const matcapUrl = decodeURIComponent(encodedMatcapUrl)
  const rotationRad = (parseFloat(rotationDegStr) * Math.PI) / 180
  const exaggeration = parseFloat(exaggerationStr)
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10), x = parseInt(xStr, 10), y = parseInt(yStr, 10)

  // This call's own params tuple, captured now — the shared "latest" tracker
  // may move on to a NEWER tuple while this call is still in flight, but this
  // constant never changes for the lifetime of this call.
  const myParamsKey = `${encodedMatcapUrl}|${rotationDegStr}|${exaggerationStr}`
  __currentParamsKey = myParamsKey

  const { pixels: normalPixels } = await computeNormalPixels(upstreamTemplate, encoding, z, x, y, n, abortController.signal)
  if (abortController.signal.aborted || myParamsKey !== __currentParamsKey) throw new DOMException("Aborted", "AbortError")

  const out = (await computeMatcapPixelsGPU(normalPixels, n, matcapUrl, rotationRad, exaggeration))
    ?? (await shadeMatcapCPU(normalPixels, n, matcapUrl, rotationRad, exaggeration))
  if (abortController.signal.aborted || myParamsKey !== __currentParamsKey) throw new DOMException("Aborted", "AbortError")

  const canvas = new OffscreenCanvas(n, n)
  const ctx = canvas.getContext("2d")!
  ctx.putImageData(new ImageData(out as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  // Re-check after the async PNG encode too — a fast-fire rotation drag can
  // supersede this exact request while convertToBlob was still pending.
  if (abortController.signal.aborted || myParamsKey !== __currentParamsKey) throw new DOMException("Aborted", "AbortError")
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
