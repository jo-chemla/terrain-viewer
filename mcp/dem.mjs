// Elevation tiles read in Node, without a browser, for every terrain source
// the app reads: the app's own tile spec (lib/terrain-tile-spec.ts) says
// what a source's tiles are, and the app's own readers fetch them
// (mcp/app-sources.ts: COG, VRT, WMS / WCS, LERC, quantized mesh, nDSM
// difference, PMTiles, ...). A plain https pyramid is fetched and decoded by
// sharp (PNG or WebP, the decoder a browser has built in and Node has not).
// The base of the MCP server's elevation tools (data-tools.mjs) and of the
// tile service's direct engine (direct.mjs).
import { readFileSync } from "node:fs"
import sharp from "sharp"
import { installBrowserShim, pixelsOf } from "./browser-shim.mjs"

const AWS_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
const MAPTERHORN_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"
const UA = "terrain-viewer-mcp/0.3 (+https://terrain-viewer.iconem.com)"

let libraryCache
/** The app's terrain library, as written by build.mjs. */
export function library() {
  if (!libraryCache) libraryCache = JSON.parse(readFileSync(new URL("./generated/library.json", import.meta.url), "utf8"))
  return libraryCache
}

let appPromise
/** The app's readers, registered once (generated/app-render.mjs). */
const app = () => (appPromise ??= (installBrowserShim(), import("./generated/app-render.mjs").then((A) => { A.registerSourceProtocols(); return A })))

/** Two plain pyramids, also listed for the in-chat map's CSP (data-tools.mjs). */
export const BUILTIN_DEMS = [
  { id: "mapterhorn", name: "Mapterhorn - Terrarium", tiles: MAPTERHORN_TILES, encoding: "terrarium", tileSize: 512, maxzoom: 17 },
  { id: "aws", name: "AWS Terrain - Terrarium Mapzen", tiles: AWS_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 15 },
]
const BUILTIN_IDS = ["mapterhorn", "esri", "mapbox", "maptiler", "aws", "cesium"]
const NEEDS_KEY = { mapbox: "Mapbox", maptiler: "MapTiler", cesium: "Cesium ion" }
/** The default ceiling of a source with no pyramid of its own (a WMS): the
 *  app's fallback range (zoomRangeFromMetadata in lib/cog-metadata.ts). */
const DEFAULT_MAXZOOM = 20

const isHttps = (u) => /^https:\/\//i.test(u)
// A library url may leave out https:// (wms-raw, quantized mesh) or carry one
// of the app's prefixes before it (pmtiles://, epsg3395://).
const bareUrl = (u) => (u ?? "").replace(/^(pmtiles|epsg3395):\/\//i, "")
// gem15://, openbuildings://, metachm://: the VRT reader's cell-routed mosaics.
const schemeOk = (u) => isHttps(u) || /^(gem15|openbuildings|metachm):\/\//i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)
const hostOf = (u) => { try { const b = bareUrl(u); return new URL(isHttps(b) ? b : `https://${b}`).hostname } catch { return undefined } }

/** Why a source, by its entry, cannot be read here; null when it can. Read
 *  from the entry alone (no request), for listings (/sources). */
export function whyNotDirect(entry) {
  if (!entry) return "unknown terrain source: see /sources"
  if (NEEDS_KEY[entry.id]) return `${NEEDS_KEY[entry.id]} needs an API key, which the tile service does not hold`
  if (entry.type === "stac" || entry.type === "mosaicjson") return "STAC and MosaicJSON sources are read by the app alone"
  if (entry.type === "cog-local") return "a local file exists only in the browser that opened it"
  if (entry.type === "quantized-mesh" && /^ion\//.test(entry.url ?? "")) return "Cesium ion assets need an API key, which the tile service does not hold"
  if (entry.type !== "dem-diff" && entry.url != null && !schemeOk(bareUrl(entry.url))) return "the source's address is not https"
  return null
}

/** The library or built-in entry of an id, or a configuration as an entry. */
function entryOf(source) {
  if (!source) return { id: "mapterhorn", builtin: true }
  if (typeof source === "object") {
    const url = String(source.url ?? "")
    const type = source.type ?? (/\.tiff?(\?|$)/i.test(url) ? "cog" : /\.vrt(\?|$)/i.test(url) ? "vrt" : /\{z\}/.test(url) ? "terrarium" : null)
    return { ...source, id: source.id ?? url, name: source.name, url, type, external: true }
  }
  if (BUILTIN_IDS.includes(source)) return { id: source, builtin: true }
  const lib = library().terrain.find((s) => s.id === source)
  if (lib) return lib
  // A tile address: a Terrarium pyramid unless it says otherwise (a COG or a VRT).
  if (isHttps(source)) return entryOf({ url: source })
  return null
}

/** A source as `{ dem }` (`{ id, name, tiles, encoding, tileSize, minzoom?,
 *  maxzoom, bounds?, customEncoding? }`, tiles being the template the
 *  app's decoders read, possibly one of its schemes) or `{ why }`. `source`:
 *  a built-in or library id, a tile address (https, with {z}/{x}/{y}; a .tif
 *  is a COG, a .vrt a VRT), or a configuration `{ url, type, ... }` with
 *  the fields of a library entry. */
export async function resolveDemOrWhy(source, settings = {}) {
  const entry = entryOf(source)
  if (!entry) return { why: `unknown terrain source "${String(source).slice(0, 80)}": see /sources` }
  const why = whyNotDirect(entry)
  if (why) return { why }
  if (!entry.builtin && !entry.type) return { why: "a source configuration needs a type" }
  const A = await app()
  const lookup = (id) => { const e = entryOf(id); return e && !e.builtin ? e : undefined }
  let spec
  try {
    spec = await A.resolveTerrainTiles(entry.id, entry.builtin ? undefined : entry, lookup, settings)
  } catch (e) {
    return { why: `this source could not be read here: ${e.message}` }
  }
  if (!spec) {
    return { why: entry.type === "cog" ? "this COG could not be read here (not Web Mercator, or no answer): the browser reads it through titiler"
      : entry.type === "dem-diff" ? "an operand of this difference cannot be read here"
      : "this source could not be read here" }
  }
  const builtin = BUILTIN_DEMS.find((d) => d.id === entry.id)
  return {
    dem: {
      id: entry.id,
      name: entry.name ?? builtin?.name ?? A.terrainSources[entry.id]?.name ?? hostOf(entry.url),
      tiles: spec.template,
      encoding: spec.encoding,
      tileSize: spec.tileSize,
      ...(spec.minzoom != null ? { minzoom: spec.minzoom } : {}),
      // Mapterhorn declares z18 but most places stop at z15-17: the map
      // probes each place (lib/tile-max-zoom.ts), the ceiling here stays z17.
      // A tile address given without a maxzoom keeps the z14 it always had here.
      maxzoom: builtin?.maxzoom ?? spec.maxzoom ?? (entry.external && /\{z\}/.test(spec.template) && isHttps(spec.template) ? 14 : DEFAULT_MAXZOOM),
      ...(spec.bounds ? { bounds: spec.bounds } : {}),
      ...(spec.customEncoding ? { customEncoding: spec.customEncoding } : {}),
      ...(entry.external ? { external: true } : {}),
    },
  }
}

/** A source as tiles that can be decoded here, or null (see resolveDemOrWhy). */
export async function resolveDem(source, settings) {
  return (await resolveDemOrWhy(source, settings)).dem ?? null
}

// Decoded tiles, newest last: a Float32 grid each (NaN where there is no data).
const tiles = new Map()
const MAX_TILES = 160
const ORIGIN = 20037508.342789244

/** The tile's address: {z}/{x}/{y}, and the bbox of a WMS template. */
function tileUrl(template, z, x, y) {
  const span = (2 * ORIGIN) / 2 ** z
  return template.replace("{z}", z).replace("{x}", x).replace("{y}", y)
    .replace("{bbox-epsg-3857}", [-ORIGIN + x * span, ORIGIN - (y + 1) * span, -ORIGIN + (x + 1) * span, ORIGIN - y * span].join(","))
}

/** RGBA to elevations, with the source's packing. `holeBelow`: alpha under
 *  which a pixel is a hole (the app's protocols write holes with 254). */
function decode(data, n, dem, holeBelow) {
  const out = new Float32Array(n)
  const c = dem.customEncoding, mapbox = dem.encoding === "mapbox"
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const r = data[o], g = data[o + 1], b = data[o + 2]
    const v = c ? r * c.redFactor + g * c.greenFactor + b * c.blueFactor - c.baseShift
      : mapbox ? -10000 + (r * 65536 + g * 256 + b) * 0.1 : r * 256 + g + b / 256 - 32768
    out[i] = data[o + 3] < holeBelow || v < -12000 ? NaN : v
  }
  return out
}

/** A grid resampled to `side` over the same extent (a 514 px WMS answer for
 *  a 512 px tile, a 512 px PMTiles tile declared 256), bilinear where the
 *  four neighbours have data, nearest otherwise. */
function resampleTo(src, w, h, side) {
  const out = new Float32Array(side * side)
  for (let j = 0; j < side; j++) {
    const fy = Math.min(h - 1, Math.max(0, ((j + 0.5) * h) / side - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0
    for (let i = 0; i < side; i++) {
      const fx = Math.min(w - 1, Math.max(0, ((i + 0.5) * w) / side - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0
      const a = src[y0 * w + x0], b = src[y0 * w + x1], c = src[y1 * w + x0], d = src[y1 * w + x1]
      const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
      out[j * side + i] = Number.isNaN(v) ? src[Math.round(fy) * w + Math.round(fx)] : v
    }
  }
  return out
}

/** One tile as elevations: `{ side, data: Float32Array }`, side being the
 *  source's tile size, or null when the tile does not exist. */
export function loadTile(dem, z, x, y) {
  const n = 2 ** z
  if (y < 0 || y >= n || z < 0) return Promise.resolve(null)
  x = ((x % n) + n) % n
  const key = `${dem.tiles}|${z}/${x}/${y}`
  const have = tiles.get(key)
  if (have) { tiles.delete(key); tiles.set(key, have); return have }
  const promise = (async () => {
    const url = tileUrl(dem.tiles, z, x, y)
    let data, width, height, holeBelow
    if (/^https?:\/\//.test(url)) {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) })
      if (!res.ok) return null
      const r = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      data = r.data; width = r.info.width; height = r.info.height; holeBelow = 1
    } else {
      // One of the app's schemes, through its own reader (lib/normal-derived-protocol.ts).
      const A = await app()
      const bitmap = await A.loadTileBitmap(url, AbortSignal.timeout(60000))
      if (!bitmap) return null
      const px = await pixelsOf({ data: bitmap })
      data = px.data; width = px.width; height = px.height; holeBelow = 255
    }
    let out = decode(data, width * height, dem, holeBelow)
    const side = dem.tileSize ?? width
    if (width !== side || height !== side) out = resampleTo(out, width, height, side)
    return { side, data: out }
  })().catch(() => null)
  tiles.set(key, promise)
  promise.then((t) => { if (!t) tiles.delete(key) })
  while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value)
  return promise
}

/** The elevations of a rectangle of the pyramid's own pixels at zoom `z`:
 *  columns x0 .. x0+w-1 and rows y0 .. y0+h-1 of the world grid, where a
 *  tile is `side` pixels. NaN where there is no data. */
export async function window(dem, z, side, x0, y0, w, h) {
  const out = new Float32Array(w * h).fill(NaN)
  const jobs = []
  for (let ty = Math.floor(y0 / side); ty <= Math.floor((y0 + h - 1) / side); ty++) for (let tx = Math.floor(x0 / side); tx <= Math.floor((x0 + w - 1) / side); tx++) {
    jobs.push(loadTile(dem, z, tx, ty).then((t) => {
      if (!t || t.side !== side) return
      const j0 = Math.max(y0, ty * side), j1 = Math.min(y0 + h, (ty + 1) * side), i0 = Math.max(x0, tx * side), i1 = Math.min(x0 + w, (tx + 1) * side)
      for (let j = j0; j < j1; j++) out.set(t.data.subarray((j - ty * side) * side + (i0 - tx * side), (j - ty * side) * side + (i1 - tx * side)), (j - y0) * w + (i0 - x0))
    }))
  }
  await Promise.all(jobs)
  return out
}

/** The side of the pyramid's tiles, from a first tile at or above `z` over
 *  the given world position (0..1): `{ z, side }`, or null. */
export async function probe(dem, z, wx, wy) {
  for (; z >= 0; z--) {
    const n = 2 ** z
    const t = await loadTile(dem, z, Math.floor(wx * n), Math.floor(wy * n))
    if (t) return { z, side: t.side }
  }
  return null
}
