// Region readers: the schemes that can deliver an export's whole area in a
// few requests instead of one tile per 256 or 512 px (see "Region reads" in
// lib/protocol-registry.ts). Imported once, for its side effect, by
// TerrainViewer.tsx next to the tile protocol registrations.

import { registerRegionReader, type RegionRaster } from "./protocol-registry"
import { fetchFloat32Raster } from "./float32dem-protocol"
import { readVrtRegion } from "./vrt-protocol"
import { readRegionGrid, describeRegionRead } from "./client-export"
import { isSentinel } from "./nodata"

const R = 6378137
const mercX = (lon: number) => (R * lon * Math.PI) / 180
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

// ─── WMS float32: GetMap takes any bbox and size ────────────────────────────
// The template carries `{bbox-epsg-3857}` and a WIDTH/HEIGHT, either as
// `float32dem://host/path?...` or wrapped as `float32dem-bbox://<encoded>/{z}/{x}/{y}`
// (a difference's operand). One GetMap per chunk: most servers cap a
// request's size (IGN at 4096, many at 2048), so 2048 is the safe chunk.
const WMS_CHUNK = 2048

function wmsUrlOf(template: string): string | null {
  const wrapped = template.match(/^float32dem-bbox:\/\/(.+)\/\{z\}\/\{x\}\/\{y\}$/)
  if (wrapped) return decodeURIComponent(wrapped[1])
  if (template.startsWith("float32dem://")) return template.slice("float32dem://".length)
  return null
}

const chunkCount = (w: number, h: number) => Math.ceil(w / WMS_CHUNK) * Math.ceil(h / WMS_CHUNK)

const wmsReader = {
  describe: (_t: string, w: number, h: number) => { const n = chunkCount(w, h); return `${n} WMS request${n > 1 ? "s" : ""}` },
  read: async (template: string, bbox: [number, number, number, number], W: number, H: number, signal?: AbortSignal): Promise<RegionRaster> => {
    const base = wmsUrlOf(template)
    if (!base || !base.includes("{bbox-epsg-3857}")) throw new Error("WMS template has no {bbox-epsg-3857}")
    const [w, s, e, n] = bbox
    const x0 = mercX(w), x1 = mercX(e), y1 = mercY(n), y0 = mercY(s)
    const out = new Float32Array(W * H).fill(NaN)
    const jobs: [number, number][] = []
    for (let cy = 0; cy < H; cy += WMS_CHUNK) for (let cx = 0; cx < W; cx += WMS_CHUNK) jobs.push([cx, cy])
    await Promise.all(jobs.map(async ([cx, cy]) => {
      const cw = Math.min(WMS_CHUNK, W - cx), ch = Math.min(WMS_CHUNK, H - cy)
      const minx = x0 + ((x1 - x0) * cx) / W, maxx = x0 + ((x1 - x0) * (cx + cw)) / W
      const maxy = y1 - ((y1 - y0) * cy) / H, miny = y1 - ((y1 - y0) * (cy + ch)) / H
      const url = base.replace("{bbox-epsg-3857}", `${minx},${miny},${maxx},${maxy}`)
        .replace(/([?&]WIDTH=)\d+/i, `$1${cw}`).replace(/([?&]HEIGHT=)\d+/i, `$1${ch}`)
      const r = await fetchFloat32Raster(`float32dem://${url}`, signal)
      // A server may answer at another size; nearest-resize onto the chunk.
      for (let j = 0; j < ch; j++) {
        const sj = Math.min(r.height - 1, Math.floor(((j + 0.5) * r.height) / ch))
        for (let i = 0; i < cw; i++) {
          const si = Math.min(r.width - 1, Math.floor(((i + 0.5) * r.width) / cw))
          const v = r.data[sj * r.width + si]
          // A masked hole (sentinel, below the floor, or its smear fringe) is
          // nodata in the export, not the fill height.
          out[(cy + j) * W + cx + i] = Number.isFinite(v) && !isSentinel(v) && !r.hole?.[sj * r.width + si] ? v : NaN
        }
      }
    }))
    return { data: out, width: W, height: H, bbox, grid: "mercator" }
  },
}
registerRegionReader("float32dem", wmsReader)
registerRegionReader("float32dem-bbox", wmsReader)

// ─── VRT: each source file read once over the area ──────────────────────────
registerRegionReader("vrt", {
  describe: () => "one read per source file",
  read: async (template, bbox, W, H, signal) => {
    const m = template.match(/^vrt:\/\/(.+)\/\{z\}\/\{x\}\/\{y\}$/)
    if (!m) throw new Error("not a vrt:// template")
    const data = await readVrtRegion(decodeURIComponent(m[1]), bbox, W, H, signal ?? new AbortController().signal)
    return { data, width: W, height: H, bbox, grid: "mercator" }
  },
})

// ─── Difference: the difference of the two operands' areas ──────────────────
const DEMDIFF_TEMPLATE_RE = /^demdiff:\/\/(terrarium|mapbox)\/(terrarium|mapbox)\/(\d+)\/(-?[\d.]+)\/([^/]+)\/([^/]+)\/\{z\}\/\{x\}\/\{y\}$/

registerRegionReader("demdiff", {
  describe: (template, w, h) => {
    const m = template.match(DEMDIFF_TEMPLATE_RE)
    if (!m) return "tiles"
    const n = parseInt(m[3], 10)
    // Operand bbox unknown here; describeRegionRead only needs it for tile
    // counts, which a region-read operand does not use.
    const world: [number, number, number, number] = [-1, -1, 1, 1]
    return `${describeRegionRead(decodeURIComponent(m[5]), n, 20, world, w, h)} + ${describeRegionRead(decodeURIComponent(m[6]), n, 20, world, w, h)}`
  },
  read: async (template, bbox, W, H, signal) => {
    const m = template.match(DEMDIFF_TEMPLATE_RE)
    if (!m) throw new Error("not a demdiff:// template")
    const [, encA, encB, size, offset, tplA, tplB] = m
    const n = parseInt(size, 10)
    const [a, b] = await Promise.all([
      readRegionGrid(decodeURIComponent(tplA), encA as "terrarium" | "mapbox", n, 20, bbox, W, H, { signal }),
      readRegionGrid(decodeURIComponent(tplB), encB as "terrarium" | "mapbox", n, 20, bbox, W, H, { signal }),
    ])
    const off = parseFloat(offset) || 0
    const data = new Float32Array(W * H)
    for (let i = 0; i < data.length; i++) data[i] = a.data[i] - b.data[i] + off // NaN on either side stays NaN
    return { data, width: W, height: H, bbox, grid: "mercator" }
  },
})
