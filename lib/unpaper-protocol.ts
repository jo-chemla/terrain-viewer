// Paper removal for tiled old maps, registered as `unpaper://`: the Allmaps
// "remove background colour" (lib/allmaps-paper.ts) for any raster source,
// Map Warper, Wikimaps, SLUB, USGS topo quads, the national map series. The
// upstream tile is fetched, every pixel within `threshold` of the paper
// colour turns transparent (a smoothstep edge of `hardness`, the same curve
// as Allmaps' shader), and the tile goes back to MapLibre as a bitmap.
//
//   unpaper://<encoded template>/{z}/{x}/{y}?c=<rrggbb|auto>&t=<0..1>&h=<0..1>&g=<gain>&s=<z>/<x>/<y>
//
// `c=auto` reads the paper from the source itself, once per template: the
// sample tile `s` (the source's extent centre at a zoom where a tile holds
// a whole sheet, picked by the caller) goes through the same histogram as
// an Allmaps map; `g` scales the detected threshold like the sidebar's
// slider. The template may hold {z}/{x}/{y} or a WMS {bbox-epsg-3857}.
import { estimateFromPixels, estimatePaper, publishEstimate, type PaperEstimate } from "./allmaps-paper"
import { toTileImage, type TileImage } from "./tile-image"

const UNPAPER_URL_RE = /^unpaper:\/\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)\?c=(auto|[0-9a-f]{6})&t=([\d.]+)&h=([\d.]+)&g=([\d.]+)&s=(\d+)\/(\d+)\/(\d+)$/

export interface UnpaperOptions { color: "auto" | string; threshold: number; hardness: number; gain: number; sample: { z: number; x: number; y: number } }

export function buildUnpaperUrl(template: string, o: UnpaperOptions): string {
  const c = o.color === "auto" ? "auto" : o.color.replace("#", "").toLowerCase().padEnd(6, "0").slice(0, 6)
  return `unpaper://${encodeURIComponent(template)}/{z}/{x}/{y}?c=${c}&t=${o.threshold.toFixed(3)}&h=${o.hardness.toFixed(2)}&g=${o.gain.toFixed(2)}&s=${o.sample.z}/${o.sample.x}/${o.sample.y}`
}

/** The sample tile for a source: its extent's centre at a zoom where one
 *  tile holds a sheet (its min zoom, within 8..12). */
export function sampleTileFor(bounds: [number, number, number, number] | undefined, minzoom: number | undefined): { z: number; x: number; y: number } {
  const z = Math.max(8, Math.min(12, minzoom ?? 10))
  const lng = bounds ? (bounds[0] + bounds[2]) / 2 : 0, lat = bounds ? (bounds[1] + bounds[3]) / 2 : 0
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { z, x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) }
}

const R = 6378137
function tileBbox3857(x: number, y: number, z: number): string {
  const size = 1 << z
  const res = (2 * Math.PI * R / 256) / size
  const merc = (px: number) => px * res - Math.PI * R
  const fy = size - y - 1
  return `${merc(x * 256)},${merc(fy * 256)},${merc((x + 1) * 256)},${merc((fy + 1) * 256)}`
}
const tileUrl = (template: string, z: number, x: number, y: number) =>
  template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)).replace("{-y}", String((1 << z) - 1 - y)).replace("{bbox-epsg-3857}", tileBbox3857(x, y, z))

async function fetchPixels(url: string, signal: AbortSignal): Promise<{ data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } | null> {
  const res = await fetch(url, { signal })
  if (!res.ok) return null
  const bmp = await createImageBitmap(await res.blob())
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: img.data as Uint8ClampedArray<ArrayBuffer>, width: img.width, height: img.height }
}

// One estimate per template, from its sample tile; published for the sidebar.
const estimates = new Map<string, Promise<PaperEstimate | null>>()
function estimateFor(template: string, sample: { z: number; x: number; y: number }, signal: AbortSignal): Promise<PaperEstimate | null> {
  let p = estimates.get(template)
  if (!p) {
    // A map from Allmaps' tile server (allmaps.xyz/...?url=<annotation>):
    // the whole sheet's thumbnail is the sample, as for the in-browser warp;
    // one tile can land on the dense part of a plan and see no paper.
    const allmaps = template.match(/allmaps\.xyz\/.*[?&]url=([^&]+)/)
    p = (allmaps ? estimatePaper(decodeURIComponent(allmaps[1]), signal) : fetchPixels(tileUrl(template, sample.z, sample.x, sample.y), signal)
      .then((px) => (px ? estimateFromPixels(px.data) : null)))
      .catch(() => null)
      .then((e) => { publishEstimate(template, e); return e })
    estimates.set(template, p)
  }
  return p
}

export async function unpaperProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: TileImage }> {
  const m = params.url.match(UNPAPER_URL_RE)
  if (!m) throw new Error(`Invalid unpaper protocol URL: ${params.url}`)
  const [, enc, zStr, xStr, yStr, c, tStr, hStr, gStr, sz, sx, sy] = m
  const template = decodeURIComponent(enc)
  const signal = abortController.signal
  let color = c, threshold = parseFloat(tStr)
  if (c === "auto") {
    const est = await estimateFor(template, { z: +sz, x: +sx, y: +sy }, signal)
    if (!est?.confident) { color = ""; } else { color = est.color.slice(1); threshold = est.threshold * (0.5 + parseFloat(gStr)) }
  }
  const px = await fetchPixels(tileUrl(template, +zStr, +xStr, +yStr), signal)
  if (!px) return { data: await toTileImage(new Uint8ClampedArray(4) as Uint8ClampedArray<ArrayBuffer>, 1) }
  if (color) {
    const pr = parseInt(color.slice(0, 2), 16), pg = parseInt(color.slice(2, 4), 16), pb = parseInt(color.slice(4, 6), 16)
    const hardness = parseFloat(hStr)
    const e0 = threshold - threshold * (1 - hardness)
    const d = px.data
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.hypot(d[i] - pr, d[i + 1] - pg, d[i + 2] - pb) / 255
      if (dist >= threshold) continue
      const x = e0 >= threshold ? 0 : Math.min(1, Math.max(0, (dist - e0) / (threshold - e0)))
      d[i + 3] = Math.round(d[i + 3] * x * x * (3 - 2 * x))
    }
  }
  return { data: await toTileImage(px.data, px.width, px.height) }
}
