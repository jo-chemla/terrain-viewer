// Client-side matcap-shaded tile computation, registered as the `matcap://`
// maplibre custom protocol — a plain `raster` source/layer pair (see
// components/LayersAndSources/MapSources.tsx's MatcapSource / MapLayers.tsx's
// MatcapRasterLayer), draped over 3D terrain the exact same automatic way
// the raster basemap already is. No custom WebGL layer, no hand-rolled mesh,
// no depth-buffer tricks: maplibre's own terrain renderer already knows how
// to drape ANY raster tile source, which is all this ever needed.
//
// Reuses lib/normals-protocol.ts's computeNormalPixels for the per-pixel
// surface normal (same upstream DEM fetch/decode every other derived mode in
// this app shares), then does the matcap lookup itself on the CPU: rotate
// the normal's (x, y) by the user's "Sphere Rotation" slider, use the
// rotated (x, y) as a UV into the matcap material image, write that pixel.
//
// Static/small, so cached once per matcap URL rather than refetched per
// tile: unlike the DEM tiles a caller picks a handful of materials from a
// fixed curated list (lib/matcap-textures.ts), not different data per z/x/y.
import { computeNormalPixels } from "./normals-protocol"
import { buildProtocolUrl, type UpstreamEncoding } from "./normal-derived-protocol"

const MATCAP_URL_RE = /^matcap:\/\/([^/]+)\/(-?[\d.]+)\/(terrarium|mapbox)\/(\d+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/

export function buildMatcapProtocolUrl(
  matcapUrl: string, rotationDeg: number, upstreamTileTemplate: string, encoding: UpstreamEncoding, tileSize: number,
): string {
  const base = buildProtocolUrl("matcap", upstreamTileTemplate, encoding, tileSize)
  // buildProtocolUrl's own scheme://encoding/tileSize/template/{z}/{x}/{y}
  // shape doesn't have room for extra params — splice matcapUrl/rotationDeg
  // in right after the scheme instead of inventing a second URL builder.
  return base.replace("matcap://", `matcap://${encodeURIComponent(matcapUrl)}/${rotationDeg}/`)
}

interface MatcapPixels { data: Uint8ClampedArray; width: number; height: number }

// One entry per distinct matcap URL — these are a fixed curated list (see
// lib/matcap-textures.ts), so this cache never meaningfully grows; no
// eviction needed the way tile caches elsewhere in this app require.
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

export async function matcapProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: Uint8Array }> {
  const match = params.url.match(MATCAP_URL_RE)
  if (!match) throw new Error(`Invalid matcap protocol URL: ${params.url}`)
  const [, encodedMatcapUrl, rotationDegStr, encodingRaw, tileSizeStr, encodedTemplate, zStr, xStr, yStr] = match
  const matcapUrl = decodeURIComponent(encodedMatcapUrl)
  const rotationRad = (parseFloat(rotationDegStr) * Math.PI) / 180
  const encoding = encodingRaw as UpstreamEncoding
  const n = parseInt(tileSizeStr, 10)
  const upstreamTemplate = decodeURIComponent(encodedTemplate)
  const z = parseInt(zStr, 10), x = parseInt(xStr, 10), y = parseInt(yStr, 10)

  const [{ pixels: normalPixels }, matcap] = await Promise.all([
    computeNormalPixels(upstreamTemplate, encoding, z, x, y, n, abortController.signal),
    loadMatcapPixels(matcapUrl),
  ])
  // maplibre's own request layer (util/ajax.ts's makeRequest) calls this
  // function directly and applies WHATEVER it resolves with — it never
  // checks abortController.signal itself, that's entirely this handler's
  // responsibility. Without this check, a request maplibre has already
  // superseded (e.g. a rotation slider drag firing a newer matcap:// URL for
  // the same tile) still resolves successfully — and since async completion
  // order doesn't match request order, that now-stale result can land AFTER
  // the newer one and get painted over it, then get overtaken again by the
  // next real result: exactly the "old, new, old, new" flicker this fixes.
  if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError")

  const cosR = Math.cos(rotationRad)
  const sinR = Math.sin(rotationRad)
  const out = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const idx = i * 4
    const nx = (normalPixels[idx] / 255) * 2 - 1
    const ny = (normalPixels[idx + 1] / 255) * 2 - 1

    // Same rotation the old GPU shader applied to the matcap lookup UV — see
    // this module's header: only the material's apparent orientation
    // rotates, never the surface geometry itself.
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

  const canvas = new OffscreenCanvas(n, n)
  const ctx = canvas.getContext("2d")!
  ctx.putImageData(new ImageData(out as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  // Re-check after the async PNG encode too — a fast-fire rotation drag can
  // supersede this exact request while convertToBlob was still pending.
  if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError")
  return { data: new Uint8Array(await blob.arrayBuffer()) }
}
