// Lookups that return numbers and files rather than a view: elevations and
// profiles read from the tiles themselves, a GeoTIFF of an area, the dates
// of the app's built-in dated imagery, a search of any STAC catalog.
import { appLib, browser, catalogItems, library } from "./tools.mjs"

const AWS_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
const MAPTERHORN_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"

/** A terrain source as tiles the server can decode and the in-chat map can
 *  draw, or null: a COG, WMS, VRT or mesh dataset is read by the app alone. */
export function resolveDem(source) {
  if (!source || source === "mapterhorn") return { id: "mapterhorn", tiles: MAPTERHORN_TILES, encoding: "terrarium", tileSize: 512, maxzoom: 17 }
  if (source === "aws") return { id: "aws", tiles: AWS_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 15 }
  const lib = library().terrain.find((s) => s.id === source)
  if (lib) return lib.tiles ? { id: lib.id, tiles: lib.tiles, encoding: lib.type === "terrainrgb" ? "mapbox" : "terrarium", tileSize: 256, maxzoom: lib.maxzoom ?? 14 } : null
  if (/^https:\/\/.+\{z\}.+\{x\}.+\{y\}/.test(source)) return { id: source, tiles: source, encoding: "terrarium", tileSize: 256, maxzoom: 14, external: true }
  return null
}
/** Hosts of every tile source the in-chat map may read (for the view's CSP). */
export function demOrigins() {
  const urls = [MAPTERHORN_TILES, AWS_TILES, ...library().terrain.map((s) => s.tiles).filter(Boolean)]
  return [...new Set(urls.map((u) => new URL(u.replace(/[{}]/g, "")).origin))]
}
const notTiles = (source) => new Error(`"${source}" is not a plain tile dataset (it is a COG, a WMS, a VRT or a mesh), so only the app can read it: use open_view. Values can be read from "mapterhorn" (default), "aws", a Terrarium tile URL, or a library dataset of type terrarium or terrainrgb.`)

let samplerPagePromise
async function samplerPage() {
  if (!samplerPagePromise) {
    samplerPagePromise = (async () => {
      const b = await browser()
      const ctx = await b.newContext()
      const page = await ctx.newPage()
      // A real https origin, so the tile hosts' CORS headers apply to fetch.
      await page.route("https://sampler.invalid/", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>sampler</title>" }))
      await page.goto("https://sampler.invalid/")
      return page
    })().catch((e) => { samplerPagePromise = undefined; throw e })
  }
  return samplerPagePromise
}

// Runs in the page: decodes the tiles under the points and reads them
// bilinearly, or copies a rectangle of pixels (`grid`). null where there is
// no tile or the pixel is a hole.
const SAMPLE_IN_PAGE = async ({ tiles, encoding, zoom, points, grid }) => {
  const cache = new Map()
  const load = (z, x, y) => {
    const key = z + "/" + x + "/" + y
    if (!cache.has(key)) cache.set(key, (async () => {
      const n = 2 ** z
      if (y < 0 || y >= n) return null
      const r = await fetch(tiles.replace("{z}", z).replace("{x}", ((x % n) + n) % n).replace("{y}", y))
      if (!r.ok) return null
      const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" })
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext("2d", { willReadFrequently: true })
      g.drawImage(bmp, 0, 0)
      return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data }
    })().catch(() => null))
    return cache.get(key)
  }
  const decode = (t, i, j) => {
    const o = (j * t.w + i) * 4
    if (t.d[o + 3] === 0) return null
    const v = encoding === "mapbox" ? -10000 + (t.d[o] * 65536 + t.d[o + 1] * 256 + t.d[o + 2]) * 0.1 : t.d[o] * 256 + t.d[o + 1] + t.d[o + 2] / 256 - 32768
    return v < -12000 ? null : v
  }
  const project = (lng, lat, z) => {
    const n = 2 ** z
    return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n]
  }
  // The tile side comes from a first tile; the zoom steps down while that tile is missing.
  let z = zoom, side = 0
  for (; z >= 0; z -= 1) {
    const [x, y] = project(points[0][0], points[0][1], z)
    const t = await load(z, Math.floor(x), Math.floor(y))
    if (t) { side = t.w; break }
  }
  if (!side) return { zoom: null, values: points.map(() => null) }
  if (grid) {
    const rect = (zz) => {
      const [a, b] = project(grid.west, grid.north, zz), [c, d] = project(grid.east, grid.south, zz)
      const x0 = Math.floor(a * side), y0 = Math.floor(b * side)
      return { x0, y0, w: Math.max(1, Math.ceil(c * side) - x0), h: Math.max(1, Math.ceil(d * side) - y0) }
    }
    let { x0, y0, w, h } = rect(z)
    while (Math.max(w, h) > grid.maxSide && z > 0) { z -= 1; ({ x0, y0, w, h } = rect(z)) }
    const out = new Float32Array(w * h).fill(-9999)
    const wanted = []
    for (let ty = Math.floor(y0 / side); ty <= Math.floor((y0 + h - 1) / side); ty++) for (let tx = Math.floor(x0 / side); tx <= Math.floor((x0 + w - 1) / side); tx++) wanted.push([tx, ty])
    await Promise.all(wanted.map(async ([tx, ty]) => {
      const t = await load(z, tx, ty)
      if (!t) return
      for (let j = Math.max(y0, ty * side); j < Math.min(y0 + h, (ty + 1) * side); j++) for (let i = Math.max(x0, tx * side); i < Math.min(x0 + w, (tx + 1) * side); i++) {
        const v = decode(t, i - tx * side, j - ty * side)
        if (v !== null) out[(j - y0) * w + (i - x0)] = v
      }
    }))
    let bin = ""
    const u8 = new Uint8Array(out.buffer)
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
    return { zoom: z, side, x0, y0, w, h, b64: btoa(bin) }
  }
  // Global pixel (a tile's pixels are cell centres) at zoom z.
  const at = async (gx, gy) => {
    const px = Math.floor(gx), py = Math.floor(gy)
    const t = await load(z, Math.floor(px / side), Math.floor(py / side))
    return t ? decode(t, ((px % side) + side) % side, ((py % side) + side) % side) : null
  }
  const values = []
  for (const [lng, lat] of points) {
    const [x, y] = project(lng, lat, z)
    const gx = x * side - 0.5, gy = y * side - 0.5, fx = gx - Math.floor(gx), fy = gy - Math.floor(gy)
    const [v00, v10, v01, v11] = await Promise.all([at(gx, gy), at(gx + 1, gy), at(gx, gy + 1), at(gx + 1, gy + 1)])
    values.push([v00, v10, v01, v11].some((v) => v === null) ? (v00 ?? v10 ?? v01 ?? v11) : (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy)
  }
  return { zoom: z, side, values }
}

const R = 6378137
const haversine = (a, b) => {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const metresPerPixel = (lat, zoom, side) => (2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / (side * 2 ** zoom)

/** Elevations of points, or a profile along the line through them, on one
 *  or several terrain sources. */
export async function elevation({ points, profile = false, samples = 64, sources, zoom }) {
  const page = await samplerPage()
  let coords = points.map((p) => [p.lng, p.lat])
  let distances = null
  if (profile) {
    if (coords.length < 2) throw new Error("A profile needs at least two points.")
    const legs = coords.slice(1).map((c, i) => haversine(coords[i], c))
    const total = legs.reduce((a, b) => a + b, 0)
    const out = [], dist = []
    for (let k = 0; k < samples; k++) {
      let d = (total * k) / (samples - 1), i = 0
      while (i < legs.length - 1 && d > legs[i]) { d -= legs[i]; i++ }
      const t = legs[i] ? Math.min(1, d / legs[i]) : 0
      out.push([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t])
      dist.push((total * k) / (samples - 1))
    }
    coords = out; distances = dist
  }
  const result = {}
  for (const source of sources?.length ? sources : ["mapterhorn"]) {
    const dem = resolveDem(source)
    if (!dem) { result[source] = { error: notTiles(source).message }; continue }
    const r = await page.evaluate(SAMPLE_IN_PAGE, { tiles: dem.tiles, encoding: dem.encoding, zoom: Math.min(zoom ?? (profile ? 13 : 14), dem.maxzoom), points: coords })
    const vals = r.values.map((v) => (v === null ? null : Math.round(v * 10) / 10))
    const got = vals.filter((v) => v !== null)
    const entry = { tileZoom: r.zoom, groundResolutionM: r.zoom === null ? null : Math.round(metresPerPixel(coords[0][1], r.zoom, r.side) * 10) / 10 }
    if (profile) {
      let gain = 0, loss = 0
      for (let i = 1; i < vals.length; i++) if (vals[i] !== null && vals[i - 1] !== null) { const d = vals[i] - vals[i - 1]; if (d > 0) gain += d; else loss -= d }
      Object.assign(entry, { lengthM: Math.round(distances[distances.length - 1]), minM: got.length ? Math.min(...got) : null, maxM: got.length ? Math.max(...got) : null, gainM: Math.round(gain), lossM: Math.round(loss), samples: vals.map((v, i) => ({ distanceM: Math.round(distances[i]), elevationM: v })) })
    } else {
      entry.points = points.map((p, i) => ({ lat: p.lat, lng: p.lng, elevationM: vals[i] }))
    }
    result[source] = entry
  }
  return result
}

/** A Float32 GeoTIFF (EPSG:3857) of the elevation over a box, written to a
 *  file. Tile datasets only, at most `maxSide` pixels a side. */
export async function exportGeotiff({ bbox, source, maxSide = 1024 }) {
  const dem = resolveDem(source)
  if (!dem) throw notTiles(source)
  const [west, south, east, north] = bbox
  if (!(east > west && north > south)) throw new Error("bbox is [west, south, east, north] in degrees.")
  const page = await samplerPage()
  const r = await page.evaluate(SAMPLE_IN_PAGE, { tiles: dem.tiles, encoding: dem.encoding, zoom: dem.maxzoom, points: [[(west + east) / 2, (south + north) / 2]], grid: { west, south, east, north, maxSide: Math.min(2048, maxSide) } })
  if (r.zoom === null || !r.b64) throw new Error("No tile of this dataset covers the box.")
  const bytes = Buffer.from(r.b64, "base64")
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice()
  const px = (2 * Math.PI * R) / (r.side * 2 ** r.zoom)
  const originX = -Math.PI * R + r.x0 * px, originY = Math.PI * R - r.y0 * px
  const { writeArrayBuffer } = await import("geotiff")
  const tiff = await writeArrayBuffer(values, {
    width: r.w, height: r.h, BitsPerSample: [32], SampleFormat: [3], SamplesPerPixel: 1,
    ModelPixelScale: [px, px, 0], ModelTiepoint: [0, 0, 0, originX, originY, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 3857, GDAL_NODATA: "-9999",
  })
  const { mkdirSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = join(tmpdir(), EXPORT_DIR_NAME)
  mkdirSync(dir, { recursive: true })
  const name = `dem-${String(dem.external ? "tiles" : dem.id).replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}-z${r.zoom}-${Date.now().toString(36)}.tif`
  const path = join(dir, name)
  writeFileSync(path, Buffer.from(tiff))
  let min = Infinity, max = -Infinity, holes = 0
  for (const v of values) { if (v === -9999) { holes++; continue } if (v < min) min = v; if (v > max) max = v }
  return {
    path, name, widthPx: r.w, heightPx: r.h, crs: "EPSG:3857", tileZoom: r.zoom,
    pixelSizeM: Math.round(px * 100) / 100,
    groundResolutionM: Math.round(px * Math.cos((((south + north) / 2) * Math.PI) / 180) * 100) / 100,
    minM: Number.isFinite(min) ? Math.round(min * 10) / 10 : null, maxM: Number.isFinite(max) ? Math.round(max * 10) / 10 : null,
    noDataShare: Math.round((holes / values.length) * 1000) / 1000, bytes: tiff.byteLength,
  }
}
export const EXPORT_DIR_NAME = "terrain-viewer-mcp"

/** Dates of the dated imagery built into the app, at a place, newest first. */
export async function imageryDates({ lat, lng, zoom = 16, from, to }) {
  const lib = await appLib()
  const start = from ? Date.parse(from) : 0, end = to ? Date.parse(to) : Date.now()
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${ms / 1000} s`)), ms))])
  const run = async (fn) => {
    try { return { dates: (await withTimeout(fn(), 45000)).map((t) => new Date(t.dateMs).toISOString().slice(0, 10)).reverse() } } catch (e) { return { error: String(e?.message ?? e) } }
  }
  const [wayback, ge] = await Promise.all([run(() => lib.listWaybackTicksInRange(lat, lng, zoom, start, end)), run(() => lib.listGeHistoricalTicksInRange(lat, lng, zoom, start, end))])
  return {
    wayback: { name: "Esri World Imagery Wayback", note: "The dates the imagery at this spot was actually captured, one per distinct capture.", ...wayback },
    "ge-historical": { name: "Google Earth historical imagery", note: "Every dated capture Google Earth holds here.", ...ge },
    timelapse: { name: "Google Earth Timelapse", note: `One cloud-free mosaic per year from ${lib.TIMELAPSE_FIRST_YEAR} to ${lib.TIMELAPSE_LAST_YEAR}, about 30 m (Landsat, Sentinel-2): change over decades, not detail.` },
    howToShow: "open_view or compare_sources with imagerySource (wayback or ge-historical) and imageryDate (a date from this list).",
  }
}

/** Items of any STAC API or static catalog over a box, through the app's own STAC reader. */
export async function searchStac({ endpoint, collection, kind, bbox, from, to, limit }) {
  const lib = await appLib()
  const k = kind ?? (/\.json($|\?)/.test(endpoint) ? "static" : "api")
  const id = lib.stacCatalogId({ endpoint, kind: k, collection })
  const out = await catalogItems({ bbox, catalogs: [id], from, to, limit })
  return { endpoint, collection: collection ?? null, kind: k, ...out[id] }
}
