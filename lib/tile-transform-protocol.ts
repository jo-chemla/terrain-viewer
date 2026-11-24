// Per-source tile fixes for plain raster tile services, registered as
// `tiletx://`. Two of them, both declared on the source record
// (RasterSourceEntry.forceOpaque / .underzoom in lib/source-schema.ts):
//
// - forceOpaque: every pixel with any alpha becomes fully opaque, a fully
//   transparent one (no data) stays transparent. ArcGIS Online publishes an
//   8-bit single-band layer (a sky view factor, a local dominance) as RGBA
//   PNG tiles with the alpha baked in at about half (127-132 on every
//   pixel), so at 100 % opacity the layer still showed half the map through.
//
// - underzoom: a service that only has tiles from zoom 12 vanished when the
//   view zoomed out to 11 (MapLibre draws nothing of a raster source below
//   its minzoom). For 1 to 3 zoom levels under the source's own minzoom the
//   tile is put together from its 4, 16 or 64 children at that minzoom,
//   downsampled by successive halvings (a box filter, so a line of mounds
//   averages to grey instead of aliasing). Only the children inside the
//   source's bounds are fetched: a survey a few kilometres across costs a
//   handful of requests at any zoom, and the cap of 3 levels bounds the rest.
//
//   tiletx://<encoded template>/{z}/{x}/{y}?o=<0|1>&mz=<native minzoom>&uz=<0..3>&s=<xyz|tms>[&b=<w,s,e,n>]
//
// The template takes {z}/{x}/{y} (or {-y}) or a WMS {bbox-epsg-3857}; `s=tms`
// says its {y} counts from the bottom (the caller hands MapLibre an xyz
// source, the flip happens here).
import { toTileImage, type TileImage } from "./tile-image"

const TILETX_URL_RE = /^tiletx:\/\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?o=([01])&mz=(\d+)&uz=(\d)&s=(xyz|tms)(?:&b=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+))?$/

/** The most zoom levels a tile is synthesised under the native minzoom: 3
 *  is 64 child tiles per tile, the most worth a request burst. */
export const MAX_UNDERZOOM = 3

export interface TileTransformOptions {
  forceOpaque?: boolean
  /** Levels under `minzoom` synthesised from children (clamped to 0..3). */
  underzoom?: number
  /** The service's own lowest zoom. */
  minzoom?: number
  bounds?: [number, number, number, number]
  scheme?: "xyz" | "tms"
}

/** Whether a source asks for any tile transform. */
export function wantsTileTransform(o: TileTransformOptions): boolean {
  return !!o.forceOpaque || (clampUnderzoom(o.underzoom, o.minzoom) > 0)
}

function clampUnderzoom(underzoom: number | undefined, minzoom: number | undefined): number {
  if (!underzoom || !minzoom) return 0
  return Math.max(0, Math.min(MAX_UNDERZOOM, Math.floor(underzoom), minzoom))
}

/** The tiletx:// template for a source, and the minzoom MapLibre should use. */
export function buildTileTransformUrl(template: string, o: TileTransformOptions): { url: string; minzoom: number | undefined } {
  const uz = clampUnderzoom(o.underzoom, o.minzoom)
  const b = o.bounds && o.bounds.length === 4 ? `&b=${o.bounds.map((v) => +v.toFixed(5)).join(",")}` : ""
  return {
    url: `tiletx://${encodeURIComponent(template)}/{z}/{x}/{y}?o=${o.forceOpaque ? 1 : 0}&mz=${o.minzoom ?? 0}&uz=${uz}&s=${o.scheme === "tms" ? "tms" : "xyz"}${b}`,
    minzoom: o.minzoom != null ? o.minzoom - uz : undefined,
  }
}

const R = 6378137
function tileBbox3857(x: number, y: number, z: number): string {
  const size = 1 << z
  const span = (2 * Math.PI * R) / size
  const west = x * span - Math.PI * R, north = Math.PI * R - y * span
  return `${west},${north - span},${west + span},${north}`
}

function tileUrl(template: string, z: number, x: number, y: number, tms: boolean): string {
  const yy = tms ? (1 << z) - 1 - y : y
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(yy))
    .replace("{-y}", String((1 << z) - 1 - y)).replace("{bbox-epsg-3857}", tileBbox3857(x, y, z))
}

const lngOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180
const latOf = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI

/** Whether tile z/x/y overlaps [w, s, e, n]. */
export function tileIntersects(z: number, x: number, y: number, b: readonly number[] | null): boolean {
  if (!b) return true
  const w = lngOf(x, z), e = lngOf(x + 1, z), n = latOf(y, z), s = latOf(y + 1, z)
  return w < b[2] && e > b[0] && s < b[3] && n > b[1]
}

/** The children of z/x/y at zoom z + k that overlap the bounds, with their
 *  offset (in child tiles) inside the parent. */
export function childTiles(z: number, x: number, y: number, k: number, bounds: readonly number[] | null): { z: number; x: number; y: number; dx: number; dy: number }[] {
  const n = 2 ** k
  const out: { z: number; x: number; y: number; dx: number; dy: number }[] = []
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
    const cx = x * n + dx, cy = y * n + dy
    if (tileIntersects(z + k, cx, cy, bounds)) out.push({ z: z + k, x: cx, y: cy, dx, dy })
  }
  return out
}

async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { signal })
    // Not `^image/`: ArcGIS Online answers its tiles as application/octet-stream.
    // An error page (JSON, HTML, XML) is the only thing to skip.
    if (!res.ok || /json|html|xml|text\//.test(res.headers.get("content-type") ?? "")) return null
    return await createImageBitmap(await res.blob())
  } catch (e) {
    if (signal.aborted) throw e
    return null
  }
}

const empty = () => toTileImage(new Uint8ClampedArray(4) as Uint8ClampedArray<ArrayBuffer>, 1)

/** Alpha above 0 to 255, in place. */
export function makeOpaque(d: Uint8ClampedArray): void {
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) d[i] = 255
}

export async function tileTransformProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: TileImage }> {
  const m = params.url.match(TILETX_URL_RE)
  if (!m) throw new Error(`Invalid tiletx protocol URL: ${params.url}`)
  const [, enc, zs, xs, ys, o, mzs, uzs, s, bw, bs, be, bn] = m
  const template = decodeURIComponent(enc)
  const z = +zs, x = +xs, y = +ys, mz = +mzs, uz = +uzs
  const tms = s === "tms"
  const opaque = o === "1"
  const bounds = bw != null ? [+bw, +bs, +be, +bn] : null
  const signal = abortController.signal

  let canvas: OffscreenCanvas
  if (z >= mz || uz === 0) {
    const bmp = await fetchBitmap(tileUrl(template, z, x, y, tms), signal)
    if (!bmp) return { data: await empty() }
    canvas = new OffscreenCanvas(bmp.width, bmp.height)
    canvas.getContext("2d")!.drawImage(bmp, 0, 0)
    bmp.close()
  } else {
    // Under the native minzoom: assemble the children at minzoom.
    const k = Math.min(mz - z, MAX_UNDERZOOM)
    const kids = childTiles(z, x, y, k, bounds)
    if (!kids.length) return { data: await empty() }
    const bitmaps = await Promise.all(kids.map((c) => fetchBitmap(tileUrl(template, c.z, c.x, c.y, tms), signal)))
    const size = bitmaps.find(Boolean)?.width ?? 256
    if (!bitmaps.some(Boolean)) return { data: await empty() }
    canvas = new OffscreenCanvas(size << k, size << k)
    const ctx = canvas.getContext("2d")!
    kids.forEach((c, i) => {
      const bmp = bitmaps[i]
      if (!bmp) return
      ctx.drawImage(bmp, c.dx * size, c.dy * size, size, size)
      bmp.close()
    })
    // Successive halvings: each a 2x2 average with smoothing on.
    for (let level = 0; level < k; level++) {
      const half = new OffscreenCanvas(canvas.width / 2, canvas.height / 2)
      const hctx = half.getContext("2d")!
      hctx.imageSmoothingEnabled = true
      hctx.imageSmoothingQuality = "high"
      hctx.drawImage(canvas, 0, 0, half.width, half.height)
      canvas = half
    }
  }
  if (opaque) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    makeOpaque(img.data)
    return { data: await toTileImage(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height) }
  }
  return { data: canvas.transferToImageBitmap() }
}
