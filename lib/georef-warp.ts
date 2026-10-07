// The bending fits of the Image Georeferencer (polynomial 2, thin plate
// spline), drawn exactly: MapLibre's image source takes four corners and
// maps the image linearly between them, so a fit that bends the inside has
// to be applied to the pixels first. This warps the image into a Web
// Mercator aligned raster (its bbox's corners are then exact for MapLibre),
// through the fit's inverse: every output pixel asks the transformer where
// it comes from in the image. The inverse is evaluated on a grid of every
// 8 output pixels and interpolated between (a thin plate spline through 20
// points costs about a microsecond a call; 4 million calls would not).
//
// Fitted in Mercator metres rather than lng/lat: conformal and locally
// uniform, so a polynomial has nothing to compensate for. The corners and
// residuals in lib/georef.ts stay in lng/lat; the two agree to the fit's
// own precision.
import { GeneralGcpTransformer, type TransformationType } from "@allmaps/transform"
import { completeGcps, minPointsFor, type GeorefGcp, type GeorefType } from "./georef"

const R = 6378137
const toMerc = (lng: number, lat: number): [number, number] => [R * lng * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360))]
const fromMerc = (x: number, y: number): [number, number] => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI]

export interface WarpedImage {
  /** An object URL of the warped PNG: revoke it when replaced. */
  url: string
  /** MapLibre image-source order: top-left, top-right, bottom-right, bottom-left. */
  corners: [[number, number], [number, number], [number, number], [number, number]]
  width: number
  height: number
}

/** Longest side of the warped raster. */
const MAX_SIDE = 2048
const GRID = 8

export async function warpGeorefImage(imageUrl: string, gcps: GeorefGcp[], type: GeorefType, signal?: AbortSignal): Promise<WarpedImage | null> {
  const done = completeGcps(gcps)
  if (done.length < minPointsFor(type)) return null
  let transformer: GeneralGcpTransformer
  try {
    transformer = new GeneralGcpTransformer(
      done.map((g) => ({ source: [g.px, g.py] as [number, number], destination: toMerc(g.lng as number, g.lat as number) })),
      type as TransformationType,
      { differentHandedness: true },
    )
  } catch {
    return null
  }
  const res = await fetch(imageUrl, { signal })
  if (!res.ok) return null
  const bmp = await createImageBitmap(await res.blob())
  const w = bmp.width, h = bmp.height
  if (!w || !h) return null
  const fwd = (x: number, y: number) => transformer.transformForward([x, y]) as [number, number]
  // The image's outline through the fit: the output bbox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const N = 48
  for (let i = 0; i <= N; i++) {
    const t = i / N
    for (const [x, y] of [[t * w, 0], [t * w, h], [0, t * h], [w, t * h]] as [number, number][]) {
      const [mx, my] = fwd(x, y)
      if (!Number.isFinite(mx) || !Number.isFinite(my)) continue
      minX = Math.min(minX, mx); maxX = Math.max(maxX, mx); minY = Math.min(minY, my); maxY = Math.max(maxY, my)
    }
  }
  if (!Number.isFinite(minX + maxX + minY + maxY) || maxX <= minX || maxY <= minY) return null
  // Output resolution: the image's own, measured at its centre, capped.
  const c0 = fwd(w / 2, h / 2), c1 = fwd(w / 2 + 1, h / 2), c2 = fwd(w / 2, h / 2 + 1)
  const mPerPx = Math.max(1e-6, (Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) + Math.hypot(c2[0] - c0[0], c2[1] - c0[1])) / 2)
  let outW = Math.max(16, Math.round((maxX - minX) / mPerPx)), outH = Math.max(16, Math.round((maxY - minY) / mPerPx))
  const shrink = Math.min(1, MAX_SIDE / outW, MAX_SIDE / outH)
  outW = Math.max(16, Math.round(outW * shrink)); outH = Math.max(16, Math.round(outH * shrink))
  const sx = (maxX - minX) / outW, sy = (maxY - minY) / outH
  // The inverse on a coarse grid, interpolated between its nodes.
  const gw = Math.ceil(outW / GRID) + 1, gh = Math.ceil(outH / GRID) + 1
  const gx = new Float64Array(gw * gh), gy = new Float64Array(gw * gh)
  for (let j = 0; j < gh; j++) {
    const my = maxY - j * GRID * sy
    for (let i = 0; i < gw; i++) {
      const mx = minX + i * GRID * sx
      let p: [number, number]
      try { p = transformer.transformBackward([mx, my]) as [number, number] } catch { p = [NaN, NaN] }
      gx[j * gw + i] = p[0]; gy[j * gw + i] = p[1]
    }
    if ((j & 31) === 31) { await new Promise((r) => setTimeout(r, 0)); if (signal?.aborted) return null }
  }
  const src = new OffscreenCanvas(w, h)
  const sctx = src.getContext("2d", { willReadFrequently: true })!
  sctx.drawImage(bmp, 0, 0)
  bmp.close()
  const sd = sctx.getImageData(0, 0, w, h).data
  const out = new ImageData(outW, outH)
  const od = out.data
  for (let oy = 0; oy < outH; oy++) {
    const fy = (oy + 0.5) / GRID, j0 = Math.min(gh - 2, Math.floor(fy)), ty = fy - j0
    for (let ox = 0; ox < outW; ox++) {
      const fx = (ox + 0.5) / GRID, i0 = Math.min(gw - 2, Math.floor(fx)), tx = fx - i0
      const a = j0 * gw + i0, b = a + 1, c = a + gw, d = c + 1
      const px = (gx[a] * (1 - tx) + gx[b] * tx) * (1 - ty) + (gx[c] * (1 - tx) + gx[d] * tx) * ty
      const py = (gy[a] * (1 - tx) + gy[b] * tx) * (1 - ty) + (gy[c] * (1 - tx) + gy[d] * tx) * ty
      const ix = Math.floor(px), iy = Math.floor(py)
      if (!(ix >= 0 && iy >= 0 && ix < w && iy < h)) continue
      const si = (iy * w + ix) * 4, oi = (oy * outW + ox) * 4
      od[oi] = sd[si]; od[oi + 1] = sd[si + 1]; od[oi + 2] = sd[si + 2]; od[oi + 3] = sd[si + 3]
    }
    if ((oy & 127) === 127) { await new Promise((r) => setTimeout(r, 0)); if (signal?.aborted) return null }
  }
  const oc = new OffscreenCanvas(outW, outH)
  oc.getContext("2d")!.putImageData(out, 0, 0)
  const blob = await oc.convertToBlob({ type: "image/png" })
  if (signal?.aborted) return null
  const [west, north] = fromMerc(minX, maxY), [east, south] = fromMerc(maxX, minY)
  return { url: URL.createObjectURL(blob), corners: [[west, north], [east, north], [east, south], [west, south]], width: outW, height: outH }
}
