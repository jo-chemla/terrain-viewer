// Terrain Viewer tile service: the app's rendering as map tiles and as
// pictures of a viewport, over plain HTTP. The app itself draws them, in a
// headless browser (the renderer of the MCP server's `screenshot` tool), so
// every source the app reads and every mode it computes comes out the same.
//
//   GET /terrain-tiles/{source}/{z}/{x}/{y}.*, /basemap-tiles/{source}/{z}/{x}/{y}.*
//                                      the same tiles with a library id in the path
//                                      (sourceInPath); the query forms stay
//   GET /terrain-tiles/{z}/{x}/{y}.png|jpg   one Web Mercator tile (XYZ) of the
//                                      elevation modes, 256 px; {y}@2x or
//                                      tilesize=512 for 512 px
//   GET /terrain-tiles/{z}/{x}/{y}.pbf|mvt   the overlays as a vector tile:
//                                      contours, isoline, moundDetector, graticules
//   GET /terrain-tiles/{z}/{x}/{y}.tif one mode's values, Float32 GeoTIFF
//   GET /basemap-tiles/{z}/{x}/{y}.jpg|png   the imagery: imagerySource,
//                                      imageryDate, imageryUrl, basemap parameters
//   GET /render.png|jpg                a viewport, like a WMS GetMap: lat, lng,
//                                      zoom or bbox=w,s,e,n, width, height
//   GET /bbox/{w},{s},{e},{n}/{width}x{height}.png|jpg|tif   the same, the box in the path
//   GET /quantized-mesh/{source}/layer.json, /quantized-mesh/{source}/{z}/{x}/{y}.terrain
//                                      the source as Cesium terrain (quantized-mesh-1.0,
//                                      geographic TMS; quantized-mesh.mjs)
//   GET <any of these>.stac.json       the export's STAC Item (Processing extension,
//                                      stac.mjs), also named by its Link header
//   GET /openapi.json, /docs           the description, and a page to try it
//   GET /health
//
// Both take the view as query parameters, the vocabulary of url.mjs:
//   terrainSource   a library id or a tile/COG URL (default: the app's own)
//   modes           comma-separated names (slope, contours, svf, ...; see MODES)
//   imageryUrl, imagerySource, imageryDate
//   mapboxKey, maptilerKey, cesiumIonKey   your API key for the Mapbox,
//                   MapTiler and Cesium ion sources (never put in the app's
//                   address: the browser engine gets them as settings)
//   anything else   passed to the app as a URL parameter, as is
// /render also takes viewMode, pitch, bearing, split, terrainSourceB.
//
// titiler's parameter names are read too: `url` for the source,
// `algorithm` for one mode and `tilesize`; its rescale, colormap, bidx and
// expression are not (the app's own parameters set the ramps). Its
// tile addresses (/tiles/WebMercatorQuad/..., /WebMercatorQuad/tilejson.json)
// were removed on 2026-11-25 and answer 404 naming ours; its /bbox/... stays.
//
// Two engines draw. `direct` computes the tile in Node from elevation tiles
// with the app's own code (direct.mjs): every 2D terrain mode and overlay
// on every source it can read (dem.mjs), in a fraction of a second. `browser` opens the app
// in a headless browser: every source, every mode, 3D and split views.
// A tile takes the direct engine when it can (the answer's `x-tv-engine`
// header says which, `x-tv-engine-why` why not); `engine=direct` or
// `engine=browser` forces one. A viewport too: drawn directly it carries
// the source's credit but no scale bar.
//
//   GET /terrain-sources, /terrain-sources/{id}
//                                      the terrain sources, by id
//   GET /colorramps, /colorramps/{id}  the colour ramps, by id; /colorramps/{id}.png|jpg
//                                      a picture of one (width, height, orientation)
//   GET /basemaps                      what /basemap-tiles/{source}/... takes
//   GET /building-sources              what buildingShadowSource takes by id: the Library's
//                                      vector sources with heights (buildings.mjs)
//   GET /algorithms                    the modes, and which engine draws them
//   GET /, /conformance                OGC API Common landing page (JSON) and conformance
//   GET /processes, /processes/{id}    each mode as an OGC API - Processes description
//                                      (processes.mjs); run by asking for its tiles
//   GET /view?<share query>, /view?url=<share link>
//                                      what a share link switches on, for the QGIS plugin
//   GET /tilejson.json                 a TileJSON; tile_format=pbf for the vector tiles
//   GET /qgis.qgz                      a QGIS project of the view: every layer, stacked and
//                                      grouped as the map, the view's ones checked, its
//                                      basemap under them (the app's share query works too)
//
// With the browser, a tile is not rendered alone: the app draws the 2048 px block it belongs
// to in one page, and the block is cut into tiles, all of them cached. The
// first tile of a block takes what a picture takes (seconds), its neighbours
// then answer from the cache.
//
// Environment: PORT (3400), TV_BASE_URL (the app), TILE_CACHE_DIR, CHROME_PATH,
// TV_SOFTWARE_GL, TV_RENDER_CONCURRENCY (2), TV_DIRECT_WORKERS (the cores minus one;
// 0: in the server's thread, TV_DIRECT_CONCURRENCY (4) at a time),
// TV_QUEUE_TIMEOUT (30 s), TV_RENDER_TIMEOUT (90 s), TV_ALLOWED_HOSTS (comma-separated
// host names accepted in the Host header; unset: any), TV_MAPBOX_KEY,
// TV_MAPTILER_KEY, TV_CESIUM_ION_KEY (the operator's keys, used when a
// request gives none: anyone who can reach the service then uses them).
import http from "node:http"
import { AsyncLocalStorage } from "node:async_hooks"
import { qgisProject, readView, viewForPlugin, gdalWmsXml } from "./qgis-project.mjs"
import { readFileSync, readdirSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildViewUrl, queryToView, DEFAULT_BASE_URL, MODE_NAMES, IMAGERY_SOURCES } from "./url.mjs"
import { withSettledPage, closeBrowser } from "./render.mjs"
import { openapi, sourceIds, DOCS_HTML } from "./openapi.mjs"
import { processCatalog, processList, withLinks, landingPage, BASEMAP_PROCESS, CONFORMANCE } from "./processes.mjs"
import { plan, flatView, DIRECT_MODES, VECTOR_MODES, VALUE_MODES, valueUnit, activeLayers, meshLevel, rampImage } from "./direct.mjs"
import { layerJson, requestedExtensions, CONTENT_TYPE as QM_TYPE, EXTENSIONS as QM_EXTENSIONS, MAX_TRIANGLES as QM_MAX_TRIANGLES } from "./quantized-mesh.mjs"
import { gunzipSync, gzip as gzipCb } from "node:zlib"
import { promisify } from "node:util"
const gzipAsync = promisify(gzipCb)
import { runDirect, poolStats, closePool, startPool, POOL_SIZE } from "./direct-pool.mjs"
import { library, whyNotDirect, needsKey, keysOf, KEY_PARAMS } from "./dem.mjs"
import { handleProxy } from "./proxy.mjs"
import { stacItem, STAC_SUFFIX } from "./stac.mjs"
import { handleFiles } from "./files.mjs"
import { geDates, geTile, parseDate as geDate } from "./ge-historical.mjs"

const PORT = Number(process.env.PORT || 3400)
// TV_HOST=127.0.0.1: only this machine (the QGIS plugin's bundled service); unset: every interface.
const HOST = process.env.TV_HOST || undefined
const BASE_URL = process.env.TV_BASE_URL || DEFAULT_BASE_URL
const CACHE_DIR = process.env.TILE_CACHE_DIR || path.join(os.tmpdir(), "terrain-viewer-tiles")
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const CONCURRENCY = Math.max(1, Number(process.env.TV_RENDER_CONCURRENCY || 2))
const BLOCK_PX = 2048
let URL_PARAMS = null
const MAX_ZOOM = 22

/** The view a request describes. titiler's names are read as ours: `url`
 *  is the source, `algorithm` one mode. */
export function viewOf(query) {
  const q = new URLSearchParams(query)
  const alias = (from, to) => { const v = q.get(from); q.delete(from); if (v !== null && !q.has(to)) q.set(to, v) }
  alias("url", "terrainSource"); alias("algorithm", "modes")
  // The app's own names, so the query of a share link can be given as is
  // (the QGIS project of a view, from the app's Share dialog): view A's
  // terrain source, and a source given by URL with its type (a portable
  // link's ?terrainType=) as a configuration.
  alias("terrainSourceA", "terrainSource"); alias("sourceA", "terrainSource")
  const type = q.get("terrainType"), src = q.get("terrainSource")
  if (type && src && /^https?:\/\//i.test(src)) { q.set("terrainSource", JSON.stringify({ url: src, type })); q.delete("terrainType") }
  return queryToView(q)
}

/** Tile x/y/z and its size -> the block rendered for it and where the tile
 *  sits inside. MapLibre's zoom counts 512 px tiles: a 256 px XYZ tile of
 *  zoom z is a 512 px one drawn at zoom z - 1. */
export function blockOf(z, x, y, size) {
  const n = 2 ** z
  const per = Math.min(n, BLOCK_PX / size)
  const bx = Math.floor(x / per), by = Math.floor(y / per)
  const side = per * size
  const cx = (bx * per + per / 2) / n, cy = (by * per + per / 2) / n
  return {
    per, bx, by, side,
    lng: cx * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180) / Math.PI,
    zoom: z - (size === 256 ? 1 : 0),
    col: x - bx * per, row: y - by * per,
  }
}

// The code that draws the tiles, hashed once at start: it goes into every
// cache key, so a tile drawn by older code (the aspect fix of 2026-11-25 kept
// serving east-west mirrored tiles for a week) is never served by newer code,
// and two services of different versions can share TILE_CACHE_DIR.
export const CODE_REVISION = (() => {
  const h = createHash("sha1")
  const dir = path.dirname(fileURLToPath(import.meta.url))
  for (const sub of ["", "generated"]) {
    let names = []
    try { names = readdirSync(path.join(dir, sub)).filter((n) => n.endsWith(".mjs") && !/test|bench/.test(n)).sort() } catch {}
    for (const n of names) h.update(n).update(readFileSync(path.join(dir, sub, n)))
  }
  return h.digest("hex").slice(0, 12)
})()
const file = (key, ext) => path.join(CACHE_DIR, createHash("sha1").update(CODE_REVISION + "|" + key).digest("hex") + "." + ext)
async function cached(key, ext) {
  try {
    const f = file(key, ext)
    const stat = await fs.stat(f)
    // An empty file is a write cut short (before the atomic store below): a miss.
    return !stat.size || Date.now() - stat.mtimeMs > CACHE_TTL ? null : await fs.readFile(f)
  } catch { return null }
}
/** Written beside, then renamed: a service stopped mid-write (the QGIS plugin
 *  stops its bundled one right after a tile went out) leaves no truncated
 *  file to be served for a week. */
async function store(key, ext, bytes) {
  const f = file(key, ext), tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.part`
  try { await fs.mkdir(CACHE_DIR, { recursive: true }); await fs.writeFile(tmp, bytes); await fs.rename(tmp, f) } catch { fs.rm(tmp, { force: true }).catch(() => {}) }
}
async function sweep() {
  try {
    for (const name of await fs.readdir(CACHE_DIR)) {
      const f = path.join(CACHE_DIR, name)
      const stat = await fs.stat(f).catch(() => null)
      if (stat && Date.now() - stat.mtimeMs > CACHE_TTL) await fs.unlink(f).catch(() => { })
    }
  } catch { /* no cache yet */ }
}

// Load protection. Several QGIS windows ask for hundreds of tiles at once and
// cancel most of them while panning; before this every request was worked
// out in full, the direct engine without any limit on the one thread Node
// has, until /health itself stopped answering (seen 2026-11-23). Now:
// - a request whose client has gone is dropped before its work starts;
// - the browser engine runs TV_RENDER_CONCURRENCY pages at a time (each is
//   a whole app), the direct engine one tile per worker thread
//   (direct-pool.mjs), whose thread a cancelled or timed-out render ends;
// - a request that waited TV_QUEUE_TIMEOUT seconds for its turn gets a 503
//   with Retry-After (QGIS leaves the tile blank and asks again later), one
//   not answered within TV_RENDER_TIMEOUT seconds a 504.
// The request's cancel signal and deadline reach the queues through
// AsyncLocalStorage, so no function in between has to carry them.
const DIRECT_CONCURRENCY = POOL_SIZE || Math.max(1, Number(process.env.TV_DIRECT_CONCURRENCY || 4))
const QUEUE_TIMEOUT = Math.max(1, Number(process.env.TV_QUEUE_TIMEOUT || 30)) * 1000
const RENDER_TIMEOUT = Math.max(5, Number(process.env.TV_RENDER_TIMEOUT || 90)) * 1000
const requestContext = new AsyncLocalStorage()
const status = (code, message, extra = {}) => Object.assign(new Error(message), { status: code, ...extra })

/** n tasks at a time; waiting ones leave the queue when their request is
 *  cancelled or has waited QUEUE_TIMEOUT. `shared`: work several requests
 *  wait on (a browser block), not dropped when the one that started it goes. */
function limiter(n) {
  let running = 0
  const queue = []
  // The releaser counts the waiter as running before waking it: counted on
  // wake-up instead, one release could let several waiters through.
  const next = () => { while (running < n && queue.length) { const w = queue.shift(); if (w.gone) continue; running++; w.go() } }
  const run = async (work, { shared = false } = {}) => {
    const ctx = requestContext.getStore()
    const signal = shared ? undefined : ctx?.signal
    if (signal?.aborted) throw status(499, "client went away")
    if (running < n) running++
    else {
      await new Promise((go, fail) => {
        const w = { go: () => { cleanup(); go() }, gone: false }
        const drop = (e) => { w.gone = true; cleanup(); fail(e) }
        const timer = setTimeout(() => drop(status(503, `busy: waited ${QUEUE_TIMEOUT / 1000} s for a turn, try again`, { retryAfter: 10 })), QUEUE_TIMEOUT)
        const onAbort = () => drop(status(499, "client went away"))
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort) }
        signal?.addEventListener("abort", onAbort, { once: true })
        queue.push(w)
      })
    }
    try { return await work() } finally { running--; next() }
  }
  run.stats = () => ({ running, waiting: queue.filter((w) => !w.gone).length, limit: n })
  return run
}
// A few pages at a time: each one is a whole app.
const slot = limiter(CONCURRENCY)
const directSlot = limiter(DIRECT_CONCURRENCY)
/** A direct render in a worker, its turn taken from directSlot; the
 *  request's cancel (or its timeout) ends the worker. */
const directRun = (op, input, args) => directSlot(() => runDirect(op, input, args, requestContext.getStore()?.signal))

/** The API keys of a request (mapboxKey, maptilerKey, cesiumIonKey), taken
 *  out of its parameters: they go to the direct engine's readers and to
 *  the app's settings, never into the app's address. The operator's keys
 *  (TV_MAPBOX_KEY, ...) where the request gives none. */
const keysFrom = (take) => keysOf(Object.fromEntries(KEY_PARAMS.map((k) => [k, take(k)])))
/** A cache key's part for the keys: a picture made with a key is not
 *  served to a request without it. */
const keyTag = (keys) => (Object.keys(keys).length ? "|k" + createHash("sha1").update(JSON.stringify(keys)).digest("hex").slice(0, 16) : "")

/** The source for the app: an id or an address as it is; a configuration
 *  `{ url, type }` becomes the app's `terrainUrl` and `terrainType`. */
function appSource(view, rest) {
  const s = view.terrainSource
  if (!s || !s.trim().startsWith("{")) return s
  let o
  try { o = JSON.parse(s) } catch { throw Object.assign(new Error("terrainSource is not valid JSON"), { status: 400 }) }
  if (!o.url) throw Object.assign(new Error("A source configuration needs a url"), { status: 400 })
  rest.set("terrainUrl", o.url)
  if (o.type) rest.set("terrainType", o.type)
  return undefined
}

/** The terrain sources, by id: the built-in ones and the app's library.
 *  `engine`: direct when the server reads the source itself (dem.mjs, with
 *  the app's readers), else browser, with why. */
export function sources() {
  const engine = (entry) => {
    const key = needsKey(entry)?.[1]
    if (key) return { engine: "direct", key, why: `read with your API key, given as ${key}` }
    const why = whyNotDirect(entry)
    return why ? { engine: "browser", why } : { engine: "direct" }
  }
  return [
    // The Worldwide Defaults first (section "defaults"), then the library:
    // one list of entries (lib/source-schema.ts).
    ...library().terrain.map((s) => ({ id: s.id, name: s.name, type: s.type, ...(s.section ? { section: s.section } : {}), ...(s.tiles ? { url: s.tiles } : {}), ...rawAddress(s), ...(s.maxzoom != null ? { maxzoom: s.maxzoom } : {}), ...(s.bounds ? { bounds: s.bounds } : {}), ...(s.resolutionM != null ? { resolutionM: s.resolutionM } : {}), ...engine(s) })),
  ]
}
/** `address`: the raw elevation behind a keyless COG, VRT or raw WMS / WCS /
 *  ArcGIS entry (https added where the library leaves it out), with the
 *  fields a reader needs (`tileSize`, `nodataFloor`): what GDAL opens itself
 *  (the QGIS plugin's Python backend: /vsicurl/ for a COG or VRT, a GDAL WMS
 *  description for a WMS GetMap). Pyramids keep `url`, their tile template. */
function rawAddress(s) {
  if (!["cog", "vrt", "wms-raw"].includes(s.type) || s.apiKey || !s.url) return {}
  const u = /^[a-z][a-z0-9+.-]*:\/\//i.test(s.url) ? s.url : `https://${s.url}`
  if (!/^https:\/\//i.test(u)) return {}
  return { address: u, ...(s.tileSize ? { tileSize: s.tileSize } : {}), ...(s.nodataFloor != null ? { nodataFloor: s.nodataFloor } : {}) }
}
let idsPromise // the ids /openapi.json offers for {source}, read once
const SOURCES_NOTE = 'Give an id as terrainSource (or url). A source that is not listed: its tile address (a .tif is read as a COG, a .vrt as a VRT), or a configuration as JSON with the fields of a library entry, {"url": "...", "type": "terrarium" | "terrainrgb" | "cog" | "vrt" | "wms-raw" | "lerc" | "quantized-mesh" | "tilejson", ...}.'

const shot = (ext) => (ext === "png" ? { type: "png" } : { type: "jpeg", quality: 85 })
const blocks = new Map() // block key -> promise, while it renders

async function tile(z, x, y, ext, query, scale = 1) {
  const { view, rest, take } = viewOf(query)
  const keys = keysFrom(take)
  const asked = take("tilesize") ?? take("size")
  const size = Number(asked || 256) * scale
  if (size !== 256 && size !== 512) throw Object.assign(new Error("A tile is 256 px, or 512 px with @2x or tilesize=512"), { status: 400 })
  // The camera of a tile is the tile's: these are not the caller's to set.
  for (const k of ["lat", "lng", "zoom", "pitch", "bearing", "viewMode", "split", "terrainSourceB", "place"]) delete view[k]
  for (const k of ["splitStyle", "width", "height"]) rest.delete(k)
  const engine = take("engine") ?? "auto"
  if (!["auto", "direct", "browser"].includes(engine)) throw Object.assign(new Error("engine is auto, direct or browser"), { status: 400 })
  let why
  if (engine !== "browser") {
    const how = await plan(view, rest, keys)
    if (how.engine === "direct") {
      const key = `direct|${JSON.stringify([how.dem.tiles, how.layers, how.state])}|${size}|${z}/${x}/${y}`
      const have = await cached(key, ext)
      if (have) return { bytes: have, engine: "direct" }
      const bytes = await directRun("tile", { view, rest, keys }, { world: size * 2 ** z, x0: x * size, y0: y * size, width: size, height: size, format: ext, baseUrl: BASE_URL })
      store(key, ext, bytes)
      return { bytes, engine: "direct" }
    }
    if (engine === "direct") throw Object.assign(new Error(`The direct engine cannot draw this: ${how.why}`), { status: 400 })
    why = how.why
  }
  view.terrainSource = appSource(view, rest)
  const b = blockOf(z, x, y, size)
  const params = Object.fromEntries(rest)
  const url = buildViewUrl({ ...view, lat: b.lat, lng: b.lng, zoom: b.zoom, viewMode: "2d", pitch: 0, bearing: 0, params }, { baseUrl: BASE_URL, embed: true })
  const tileKey = (col, row) => `${url}${keyTag(keys)}|${size}|${b.bx * b.per + col}/${b.by * b.per + row}`
  const have = await cached(tileKey(b.col, b.row), ext)
  if (have) return { bytes: have, engine: "browser", why }
  const blockKey = `${url}${keyTag(keys)}|${size}|${ext}`
  if (!blocks.has(blockKey)) {
    const work = slot(() => withSettledPage(url, { width: b.side, height: b.side, bare: true, keys }, async (page) => {
      const out = new Map()
      for (let row = 0; row < b.per; row++) for (let col = 0; col < b.per; col++) {
        const bytes = await page.screenshot({ ...shot(ext), clip: { x: col * size, y: row * size, width: size, height: size } })
        out.set(`${col}/${row}`, bytes)
        store(tileKey(col, row), ext, bytes)
      }
      return out
    }), { shared: true }).finally(() => blocks.delete(blockKey))
    blocks.set(blockKey, work)
  }
  return { bytes: (await blocks.get(blockKey)).get(`${b.col}/${b.row}`), engine: "browser", why }
}

async function picture(ext, query) {
  const { view, rest, take } = viewOf(query)
  const keys = keysFrom(take)
  const num = (k, d) => { const v = take(k); if (v === undefined) return d; const n = Number(v); if (!Number.isFinite(n)) throw Object.assign(new Error(`${k} is not a number`), { status: 400 }); return n }
  const width = Math.min(4096, Math.max(64, Math.round(num("width", 1024)))), height = Math.min(4096, Math.max(64, Math.round(num("height", 640))))
  let { lat, lng, zoom } = view
  const bbox = take("bbox")
  if (bbox) {
    const [w, s, e, n] = bbox.split(",").map(Number)
    if (![w, s, e, n].every(Number.isFinite) || e <= w || n <= s) throw Object.assign(new Error("bbox is west,south,east,north in degrees"), { status: 400 })
    const my = (la) => (1 - Math.asinh(Math.tan((la * Math.PI) / 180)) / Math.PI) / 2
    const cy = (my(n) + my(s)) / 2
    lng = (w + e) / 2
    lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180) / Math.PI
    // The whole box inside the picture.
    zoom = Math.min(Math.log2(width / 512 / ((e - w) / 360)), Math.log2(height / 512 / (my(s) - my(n))))
  }
  if (lat === undefined || lng === undefined) throw Object.assign(new Error("lat and lng, or bbox, are required"), { status: 400 })
  const engine = take("engine") ?? "auto"
  if (!["auto", "direct", "browser"].includes(engine)) throw Object.assign(new Error("engine is auto, direct or browser"), { status: 400 })
  let why
  if (engine !== "browser") {
    const how = flatView(view) ? await plan(view, rest, keys) : { engine: "browser", why: "3D, tilted, rotated or split views are drawn by the app" }
    if (how.engine === "direct") return { bytes: await directRun("viewport", { view, rest, keys }, { lat, lng, zoom: zoom ?? 12, width, height, format: ext, baseUrl: BASE_URL }), engine: "direct" }
    if (engine === "direct") throw Object.assign(new Error(`The direct engine cannot draw this: ${how.why}`), { status: 400 })
    why = how.why
  }
  view.terrainSource = appSource(view, rest)
  const full = { ...view, lat, lng, zoom: zoom ?? 12, params: Object.fromEntries(rest) }
  const url = buildViewUrl(full, { baseUrl: BASE_URL, embed: true })
  const key = `${url}${keyTag(keys)}|${width}x${height}`
  const have = await cached(key, ext)
  if (have) return { bytes: have, engine: "browser", why }
  const bytes = await slot(() => withSettledPage(url, { width, height, keys }, (page) => page.screenshot(shot(ext))))
  store(key, ext, bytes)
  return { bytes, engine: "browser", why }
}

// ── Values: a mode's numbers before the colour ramp ──────────────────────

const VALUE_FORMATS = ["tif", "terrarium", "terrainrgb"]
/** The view's request for one mode's values: the mode, the view to plan
 *  (elevation plans as colour relief, its values are the elevation's), the
 *  scale a PNG packing multiplies them by. */
function valueRequest(query) {
  const { view, rest, take } = viewOf(query)
  const keys = keysFrom(take)
  const modes = view.modes ?? []
  if (modes.length !== 1) throw status(400, `Values are for one mode at a time, as modes=slope (modes with values: ${Object.keys(VALUE_MODES).join(", ")})`)
  const mode = modes[0]
  if (!VALUE_MODES[mode]) throw status(400, `No values for ${mode}: it is drawn, not computed as numbers. Modes with values: ${Object.keys(VALUE_MODES).join(", ")}`)
  const raw = take("valueScale")
  const scale = raw === undefined ? 1 : Number(raw)
  if (!Number.isFinite(scale) || scale === 0) throw status(400, "valueScale is a number other than 0")
  const compression = take("compression") ?? "deflate"
  if (compression !== "deflate" && compression !== "none") throw status(400, "compression is deflate (the default) or none")
  for (const k of ["encoding", "background", "engine"]) take(k)
  for (const k of ["pitch", "bearing", "viewMode", "split", "terrainSourceB", "place"]) delete view[k]
  for (const k of ["splitStyle"]) rest.delete(k)
  return { view: { ...view, modes: [mode === "elevation" ? "colorRelief" : mode] }, rest, take, keys, mode, scale, compress: compression === "deflate" }
}

/** The deepest zoom of 256 px tiles worth asking of a source: its own
 *  deepest level, in 256 px tiles. */
const valueLevel = (dem) => Math.min(MAX_ZOOM, dem.maxzoom + Math.max(0, Math.round(Math.log2(dem.tileSize / 256))))

/** One mode's values over a tile (`at`: { z, x, y, scale }) or a viewport
 *  (`at`: null; bbox, or lat, lng, zoom, with width and height), encoded as
 *  `format` (VALUE_FORMATS). */
async function valuesFor(format, query, at) {
  const r = valueRequest(query)
  const { view, rest, take, keys, mode, scale, compress } = r
  const num = (k, d) => { const v = take(k); if (v === undefined) return d; const n = Number(v); if (!Number.isFinite(n)) throw status(400, `${k} is not a number`); return n }
  let rect
  if (at) {
    const asked = take("tilesize") ?? take("size")
    const size = Number(asked || 256) * at.scale
    if (size !== 256 && size !== 512) throw status(400, "A tile is 256 px, or 512 px with @2x or tilesize=512")
    rect = { world: size * 2 ** at.z, x0: at.x * size, y0: at.y * size, width: size, height: size }
    for (const k of ["lat", "lng", "zoom"]) delete view[k]
    take("width"); take("height")
  } else {
    const my = (la) => (1 - Math.asinh(Math.tan((la * Math.PI) / 180)) / Math.PI) / 2
    const bbox = take("bbox")
    if (bbox) {
      // The box exactly: `width` pixels across it, the height that keeps
      // the pixels square in Web Mercator (at most 4096 a side).
      const [w, s, e, n] = bbox.split(",").map(Number)
      if (![w, s, e, n].every(Number.isFinite) || e <= w || n <= s) throw status(400, "bbox is west,south,east,north in degrees")
      let width = Math.round(num("width", 1024))
      const fx = (e - w) / 360, fy = my(s) - my(n)
      if (width * (fy / fx) > 4096) width = Math.floor(4096 * (fx / fy))
      width = Math.min(4096, Math.max(16, width))
      const world = width / fx
      take("height")
      rect = { world, x0: ((w + 180) / 360) * world, y0: my(n) * world, width, height: Math.max(16, Math.round(fy * world)) }
    } else {
      const { lat, lng } = view
      if (lat === undefined || lng === undefined) throw status(400, "lat and lng, or bbox, are required")
      const width = Math.min(4096, Math.max(16, Math.round(num("width", 1024)))), height = Math.min(4096, Math.max(16, Math.round(num("height", 640))))
      const world = 512 * 2 ** (view.zoom ?? 12)
      rect = { world, x0: ((lng + 180) / 360) * world - width / 2, y0: my(lat) * world - height / 2, width, height }
    }
    for (const k of ["lat", "lng", "zoom"]) delete view[k]
  }
  const how = await plan(view, rest, keys)
  if (how.engine !== "direct") throw status(400, `The values cannot be computed here: ${how.why}`)
  const unit = valueUnit(mode, how.state)
  const key = `values|${JSON.stringify([how.dem.tiles, mode, how.state])}|${format}${format === "tif" && !compress ? "-raw" : ""}|${scale}|${JSON.stringify(rect)}`
  const ext = format === "tif" ? "tif" : "png"
  let bytes = await cached(key, ext)
  if (!bytes) {
    bytes = await directRun("values", { view, rest, keys }, { ...rect, mode, format, scale, compress, baseUrl: BASE_URL })
    store(key, ext, bytes)
  }
  return { bytes, unit, mode, scale, type: format === "tif" ? "image/tiff" : "image/png" }
}
// ── Quantized mesh: a source as Cesium terrain ────────────────────────────

const MESHERS = ["martini", "delatin"]
const HEIGHTS = ["ellipsoidal", "orthometric"]
/** /quantized-mesh/{source}/layer.json (`tile` null) or one .terrain tile
 *  (`tile` [z, x, y]): `{ json }` or `{ bytes, type }`. Read with the same
 *  source lookup and keys as /terrain-tiles; `error` scales Cesium's
 *  geometric error of the level into the mesh's error (0.5), `mesher` is
 *  martini (the default since 2026-11-25) or delatin, `maxTriangles` caps
 *  delatin's mesh, `heights` is ellipsoidal (the default: what Cesium reads,
 *  the geoid added, geoid.mjs) or orthometric (the source's heights above sea
 *  level), `extensions` (or the Accept header) asks for the vertex normals. */
async function quantizedMesh(source, tile, search, headers) {
  const q = new URLSearchParams(search)
  if (source !== "custom") { q.delete("url"); q.delete("terrainSourceA"); q.set("terrainSource", source) }
  const { view, take } = viewOf(q)
  const keys = keysFrom(take)
  const raw = take("error")
  const errorScale = raw === undefined ? 0.5 : Number(raw)
  if (!(errorScale > 0) || errorScale > 16) throw status(400, "error is a positive number (at most 16): the share of Cesium's geometric error of the level allowed in the mesh, 0.5 by default")
  const mesher = take("mesher") ?? "martini"
  if (!MESHERS.includes(mesher)) throw status(400, `mesher is ${MESHERS.join(" or ")}`)
  const capRaw = take("maxTriangles")
  const maxTriangles = capRaw === undefined ? QM_MAX_TRIANGLES : Number(capRaw)
  if (!Number.isInteger(maxTriangles) || maxTriangles < 2 || maxTriangles > 262144) throw status(400, `maxTriangles is a whole number from 2 to 262144 (delatin stops refining there; ${QM_MAX_TRIANGLES} by default)`)
  const heights = take("heights") ?? "ellipsoidal"
  if (!HEIGHTS.includes(heights)) throw status(400, "heights is ellipsoidal (the default: above the WGS84 ellipsoid, what Cesium expects) or orthometric (above sea level, the source's own)")
  const how = await plan({ terrainSource: view.terrainSource }, new URLSearchParams(), keys)
  if (how.engine !== "direct") throw status(400, `This source cannot be read here: ${how.why}`)
  const maxzoom = meshLevel(how.dem)
  if (!tile) {
    const entry = library().terrain.find((s) => s.id === how.dem.id)
    const qs = new URLSearchParams(search).toString()
    return {
      json: layerJson({
        name: how.dem.name ?? how.dem.id, description: `${how.dem.name ?? how.dem.id}, from the Terrain Viewer tile service; heights ${heights === "ellipsoidal" ? "above the WGS84 ellipsoid (the EGM96 geoid added to an orthometric source)" : "above sea level (orthometric)"}`,
        attribution: entry?.attribution ?? how.dem.name ?? "", tiles: [`{z}/{x}/{y}.terrain${qs ? "?" + qs : ""}`],
        maxzoom, bounds: how.dem.bounds, extensions: QM_EXTENSIONS,
      }),
    }
  }
  const [z, x, y] = tile
  if (z > 21 || x >= 2 ** (z + 1) || y >= 2 ** z) throw status(404, "No such tile: level z has 2^(z+1) x 2^z tiles (geographic TMS)")
  const normals = requestedExtensions(headers.accept, take("extensions")).includes("octvertexnormals")
  const key = `mesh|${how.dem.tiles}|${errorScale}|${mesher}${mesher === "delatin" && maxTriangles !== QM_MAX_TRIANGLES ? ":" + maxTriangles : ""}|${normals ? "n" : ""}|${heights === "ellipsoidal" ? "e" : "o"}|${z}/${x}/${y}`
  // Kept gzipped: compressed once, in the thread pool (10 ms for a 220 kB
  // tile at level 6), and a cached tile goes out as it is read.
  let gz = await cached(key, "terrain.gz")
  if (!gz) {
    const bytes = Buffer.from(await directRun("mesh", { view: { terrainSource: view.terrainSource }, rest: new URLSearchParams(), keys }, { z, x, y, errorScale, mesher, normals, maxTriangles, heights }))
    gz = await gzipAsync(bytes, { level: 6 })
    // A tile with no data (flat: two triangles at one height, sea level) is
    // not kept: outside the source it costs nothing to make again, and a
    // source that failed for a moment would otherwise leave a hole for a week.
    const empty = bytes.length < 256 && bytes.readFloatLE(24) === bytes.readFloatLE(28)
    if (!empty) store(key, "terrain.gz", gz)
  }
  return { gz, type: normals ? `${QM_TYPE};extensions=octvertexnormals` : QM_TYPE }
}

const valueHeaders = (made) => ({
  "cache-control": "public, max-age=86400", "x-tv-engine": "direct", "x-tv-value-mode": made.mode, "x-tv-value-unit": made.unit, "x-tv-value-scale": String(made.scale),
  "access-control-expose-headers": "x-tv-engine, x-tv-value-mode, x-tv-value-unit, x-tv-value-scale, link",
})

/** The export's STAC Item (stac.mjs), named in its answer: its address
 *  plus `.stac.json`, the caller's API keys left out. */
const describedBy = (self, u) => {
  const q = new URLSearchParams(u.search)
  for (const k of KEY_PARAMS) q.delete(k)
  const qs = q.toString()
  return { link: `<${self}${u.pathname}${STAC_SUFFIX}${qs ? "?" + qs : ""}>; rel="describedby"; type="application/geo+json"` }
}
const EXPOSED = "x-tv-engine, x-tv-engine-why, link"

const TYPES = { png: "image/png", jpg: "image/jpeg" }
const allowedHosts = (process.env.TV_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)

const urlParams = () => (URL_PARAMS ??= JSON.parse(readFileSync(new URL("./generated/url-params.json", import.meta.url), "utf8")).params)
let CATALOG = null
const catalog = () => (CATALOG ??= processCatalog(urlParams(), VALUE_MODES))
const findProcess = (id) => [...catalog().processes, BASEMAP_PROCESS].find((x) => x.id === id)
const NO_SUCH_PROCESS = JSON.stringify({ type: "http://www.opengis.net/def/exceptions/ogcapi-processes-1/1.0/no-such-process", title: "No such process: see /processes", status: 404 })

/** The modes of a tile request (modes, or titiler's algorithm). */
const modesOf = (search) => { const q = new URLSearchParams(search); return (q.get("modes") ?? q.get("algorithm") ?? "").split(",").map((s) => s.trim()).filter(Boolean) }
/** A /basemap-tiles query as the tile engine reads it: the basemap mode
 *  alone; a terrain mode is refused. */
export function basemapQuery(search) {
  const q = new URLSearchParams(search)
  const asked = modesOf(search).filter((m) => m !== "basemap")
  if (asked.length) throw status(400, `/basemap-tiles draws the imagery only; ask /terrain-tiles for ${asked.join(", ")}`)
  q.delete("algorithm"); q.set("modes", "basemap")
  return q
}

/** What /basemap-tiles/{source}/... takes in the path: the dated imagery
 *  (imagerySource, with imageryDate) and the app's built-in basemaps with a
 *  fixed address (basemapSource). "bing" is both: dated with an imageryDate,
 *  Bing Aerial without. */
export async function basemaps() {
  const { BUILTIN_BASEMAP_SOURCES } = await import("./generated/app-lib.mjs")
  return [
    ...IMAGERY_SOURCES.map((id) => ({ id, kind: "dated", param: "imagerySource", note: "with imageryDate=YYYY-MM-DD" })),
    ...BUILTIN_BASEMAP_SOURCES.map((s) => ({ id: s.id, name: s.name, kind: "static", param: "basemapSource", ...(s.maxzoom != null ? { maxzoom: s.maxzoom } : {}), ...(s.apiKey ? { key: s.apiKey } : {}) })),
  ]
}

/** The dated sources whose dates at a place /imagery-dates lists. Google
 *  Earth's are read here (ge-historical.mjs); the others through the app's
 *  own listing (lib/dated-imagery.ts listDates), as the MCP server's
 *  imagery_dates does. Planet needs a key the service does not hold. */
export const IMAGERY_DATE_SOURCES = ["ge-historical", "wayback", "eox-s2", "hls", "bing"]

/** /imagery-dates/{source}: the dates at lat, lng and a tile zoom, newest
 *  first, with the tile template that draws one ({date} to fill in). */
export async function imageryDates(self, id, q) {
  if (!IMAGERY_DATE_SOURCES.includes(id)) throw status(404, `No dated source "${id}": ${IMAGERY_DATE_SOURCES.join(", ")}`)
  const num = (k, lo, hi, fallback) => {
    const raw = q.get(k)
    if (raw == null || raw === "") { if (fallback != null) return fallback; throw status(400, `${k} is required: /imagery-dates/${id}?lat=..&lng=..&zoom=..`) }
    const v = Number(raw)
    if (!Number.isFinite(v) || v < lo || v > hi) throw status(400, `${k} must be a number from ${lo} to ${hi}`)
    return v
  }
  const lat = num("lat", -85.06, 85.06), lng = num("lng", -180, 180), zoom = num("zoom", 0, 23, 16)
  const tiles = `${self}/basemap-tiles/${id}/{z}/{x}/{y}.jpg?imageryDate={date}`
  if (id === "ge-historical") {
    const { level, dates, current } = await geDates({ lat, lng, zoom })
    return {
      source: id, lat, lng, zoom, level, dates, tiles, engine: "direct",
      note: dates.length
        ? "Google Earth's dated captures of the Keyhole node at this place and level, newest first. A tile of a date draws the newest capture on or before it."
        : current ? "Google Earth lists no dated capture here at this level, only its current imagery: ask a coarser zoom, or the tiles without imageryDate." : "Google Earth has no imagery here at this level.",
    }
  }
  const { findDatedImagery } = await import("./generated/app-lib.mjs")
  const from = q.get("from") ? Date.parse(q.get("from")) : -8.64e15, to = q.get("to") ? Date.parse(q.get("to")) : Date.now()
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw status(400, "from and to are dates (YYYY-MM-DD)")
  const ticks = await findDatedImagery(id).listDates({ lat, lng, zoom }, from, to, {})
  return {
    source: id, lat, lng, zoom, tiles, engine: "browser",
    dates: ticks.map((t) => ({ date: new Date(t.dateMs).toISOString().slice(0, 10), dateMs: t.dateMs, ...(t.label ? { label: t.label } : {}) })).reverse(),
    note: "Listed by the app's own code (lib/dated-imagery.ts). The tiles of these sources are drawn by the browser engine; a client can also read them from the provider.",
  }
}

/** A Google Earth historical tile, kept a week when it is of a date (a
 *  capture does not change; the newest one does). */
async function geHistoricalTile(z, x, y, dateText, size, ext) {
  const date = geDate(dateText)
  const key = date ? `ge-historical|${date.year}-${date.month}-${date.day}|${size}|${ext}|${z}/${x}/${y}` : null
  if (key) for (const e of ext === "jpg" ? ["jpg", "png"] : ["png"]) {
    const have = await cached(key, e)
    if (have) return { bytes: have, type: TYPES[e] }
  }
  const made = await geTile(z, x, y, { date, size, format: ext })
  if (made && key) store(key, made.type === "image/png" ? "png" : "jpg", made.bytes)
  return made
}

/** The path forms with a source id, `/terrain-tiles/{source}/{z}/{x}/{y}.*`
 *  and `/basemap-tiles/{source}/{z}/{x}/{y}.*` (the scheme of
 *  /quantized-mesh/{source}/...), as the query forms every handler reads:
 *  `{ pathname, search }`, or null when the address is not one. `custom`
 *  keeps the source the query gives (an address, a COG, a JSON
 *  configuration). An unknown id is a 404. Also with `.stac.json` after. */
export async function sourceInPath(pathname, search) {
  const m = pathname.match(/^\/(terrain-tiles|basemap-tiles)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)((?:@[12]x)?\.[a-z]+(?:\.stac\.json)?)$/)
  if (!m) return null
  const [, endpoint, rawId, z, x, y, tail] = m
  const id = decodeURIComponent(rawId)
  const q = new URLSearchParams(search)
  if (id !== "custom") {
    if (endpoint === "terrain-tiles") {
      if (!sources().some((s) => s.id === id)) throw status(404, `No terrain source "${id}": see /terrain-sources (an address, a COG or a JSON configuration goes in the query: /terrain-tiles/{z}/{x}/{y}.png?terrainSource=...)`)
      for (const k of ["url", "terrainSourceA", "sourceA"]) q.delete(k)
      q.set("terrainSource", id)
    } else {
      const known = await basemaps()
      const dated = known.some((b) => b.id === id && b.kind === "dated"), fixed = known.some((b) => b.id === id && b.kind === "static")
      if (!dated && !fixed) throw status(404, `No basemap "${id}": see /basemaps (an XYZ or COG address goes in the query: /basemap-tiles/{z}/{x}/{y}.jpg?imageryUrl=...)`)
      q.delete("imageryUrl")
      if (dated && (q.has("imageryDate") || !fixed)) { q.set("imagerySource", id); q.delete("basemapSource") }
      else { q.set("basemapSource", id); q.delete("imagerySource"); q.delete("imageryDate") }
    }
  }
  const qs = q.toString()
  return { pathname: `/${endpoint}/${z}/${x}/${y}${tail}`, search: qs ? "?" + qs : "" }
}

/** /view's query, from any of:
 *  - a share link's query as is: `/view?zoom=12&lat=...`;
 *  - `url` = the whole link (`https://...?zoom=12...`), or only its query
 *    (`?zoom=12...` or `zoom=12...`), URL-encoded or not;
 *  - the whole link pasted after `/view?` without encoding
 *    (`/view?https://terrain-viewer.iconem.com/?zoom=12&lat=...`), which a
 *    query parser reads as a first key `https://...?zoom`.
 *  The address before `?` and a `#...` are ignored; the link's own values
 *  win over parameters given beside it. */
export function viewQuery(search) {
  const linkQuery = (s) => {
    s = s.trim().replace(/#.*$/, "")
    const at = s.indexOf("?")
    if (at >= 0) return s.slice(at + 1)
    // No `?`: a bare query (`zoom=12&lat=...`), or an address without one.
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || !s.includes("=") ? "" : s
  }
  let raw = String(search ?? "").replace(/^\?/, "")
  // A link pasted unencoded after /view?: its first key holds the address.
  const first = raw.split("&", 1)[0]
  if (/^[a-z][a-z0-9+.-]*(:|%3A)/i.test(first) && /\?|%3F/i.test(first.split("=", 1)[0])) {
    const decoded = (() => { try { return decodeURIComponent(first) } catch { return first } })()
    raw = linkQuery(decoded) + raw.slice(first.length)
  }
  const q = new URLSearchParams(raw)
  if (!q.has("url")) return q
  const inner = new URLSearchParams(linkQuery(q.get("url")))
  q.delete("url")
  for (const [k, v] of q) if (!inner.has(k)) inner.set(k, v)
  return inner
}

/** /view's `tiles`: the addresses that draw what a share link shows, its
 *  terrain modes stacked in one XYZ template (the source in the path when it
 *  is a library id) and, when the link shows imagery, its basemap's. */
export function viewTiles(self, read) {
  const params = { ...(read.params ?? {}) }
  const src = params.terrainSource
  delete params.terrainSource
  const modes = (read.active ?? []).filter((m) => m !== "basemap")
  const byId = src && sources().some((s) => s.id === src)
  const q = new URLSearchParams({ ...(modes.length ? { modes: modes.join(",") } : {}), ...(src && !byId ? { terrainSource: src } : {}), ...params })
  const qs = q.toString().replace(/%2C/g, ",")
  const bq = new URLSearchParams(params).toString().replace(/%2C/g, ",")
  return {
    terrain: `${self}/terrain-tiles/${byId ? encodeURIComponent(src) + "/" : ""}{z}/{x}/{y}.png${qs ? "?" + qs : ""}`,
    ...((read.active ?? []).includes("basemap") ? { basemap: `${self}/basemap-tiles/{z}/{x}/{y}.jpg${bq ? "?" + bq : ""}` } : {}),
  }
}

export function start(port = PORT) {
  sweep(); setInterval(sweep, 6 * 60 * 60 * 1000).unref()
  return http.createServer((req, res) => {
    // Cancelled when the client goes before the answer (QGIS cancels the
    // tiles it no longer shows): queued work for it is dropped.
    const controller = new AbortController()
    res.on("close", () => { if (!res.writableFinished) controller.abort() })
    const timer = setTimeout(() => {
      if (res.headersSent) return
      res.writeHead(504, { "content-type": "text/plain", "access-control-allow-origin": "*" }); res.end(`not drawn within ${RENDER_TIMEOUT / 1000} s`)
      controller.abort()
    }, RENDER_TIMEOUT)
    res.on("close", () => clearTimeout(timer))
    requestContext.run({ signal: controller.signal }, () => handle(req, res))
  }).listen(port, HOST, () => {
    console.error(`terrain-viewer tiles on http://${HOST || "localhost"}:${port}/ (app: ${BASE_URL})`)
    // The direct engine's workers and the app's code, loaded now rather than
    // by the first tile (about 3 s).
    startPool()
    import("./direct.mjs").then((d) => d.warmUp()).catch(() => {})
  })
}

async function handle(req, res) {
    const send = (status, type, body, extra = {}) => { if (res.headersSent || res.destroyed) return; res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", ...extra }); res.end(body) }
    try {
      const host = (req.headers.host || "").replace(/:\d+$/, "")
      if (allowedHosts.length && !["localhost", "127.0.0.1", "[::1]", ...allowedHosts].includes(host)) return send(403, "text/plain", "Host not allowed")
      // CORS pass-through to NASA G-LiHT and Earthdata, allow-listed (proxy.mjs).
      if (req.url.startsWith("/proxy/")) return handleProxy(req, res, `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`)
      // Local raster files, registered from this machine (files.mjs).
      if (req.url === "/files" || req.url.startsWith("/files/") || req.url.startsWith("/files?")) {
        if (await handleFiles(req, res, new URL(req.url, "http://x"))) return
      }
      const exec = req.url.match(/^\/processes\/([^/?]+)\/execution(?:\?|$)/)
      if (exec) {
        // The standard's execution: the modes are run by asking for their
        // tiles instead (processes.mjs), named in the answer.
        const p = findProcess(decodeURIComponent(exec[1]))
        if (!p) return send(404, "application/json", NO_SUCH_PROCESS)
        const self = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`
        return send(501, "application/json", JSON.stringify({ type: "about:blank", title: "Not implemented: run a process by asking for its tiles", status: 501, detail: "This service has no jobs and no POST execution. Each process links its tile endpoints (rel http://www.opengis.net/def/rel/ogc/1.0/execute, templated).", links: withLinks(self, p).links }))
      }
      // A CORS preflight (a web client that sets a header, such as Cesium's
      // Accept for the quantized-mesh extensions, on some browsers).
      if (req.method === "OPTIONS") return send(204, "text/plain", "", { "access-control-allow-methods": "GET, HEAD", "access-control-allow-headers": req.headers["access-control-request-headers"] || "*", "access-control-max-age": "86400" })
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain", "GET only")
      // QGIS's vector tile layer sends the query's "?" percent-encoded when
      // its source has it so (projects written before 2026-11-23): read it
      // as the query.
      const u = new URL(!req.url.includes("?") && /%3F/i.test(req.url) ? req.url.replace(/%3F/i, "?") : req.url, "http://x")
      // A source id in the path: read as the query form.
      const inPath = await sourceInPath(u.pathname, u.search)
      if (inPath) { u.pathname = inPath.pathname; u.search = inPath.search }
      if (u.pathname === "/health") return send(200, "application/json", JSON.stringify({ ok: true, app: BASE_URL, codeRevision: CODE_REVISION, browser: slot.stats(), direct: { ...directSlot.stats(), ...poolStats() } }))
      // A browser goes to the page to try the service; a client that asks
      // for JSON gets the index of addresses.
      const self = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`
      // The OGC landing page: JSON to a client that asks for it (Accept or
      // ?f=json), the docs page to a browser.
      const wantsJson = u.searchParams.get("f") === "json" || /application\/json/.test(req.headers.accept || "")
      // An export's STAC Item (Processing extension): its address plus
      // .stac.json, the same query. Computed from the address, nothing drawn.
      if (u.pathname.endsWith(STAC_SUFFIX)) {
        const item = stacItem(self, u.pathname.slice(0, -STAC_SUFFIX.length), u.search, { sources })
        if (!item) return send(404, "text/plain", "A STAC Item describes a raster export: /terrain-tiles/{z}/{x}/{y}.png|jpg|tif, /basemap-tiles/..., /render.*, plus .stac.json")
        return send(200, "application/geo+json", JSON.stringify(item, null, 2), { "cache-control": "no-store" })
      }
      if (u.pathname === "/" && !wantsJson) return send(302, "text/plain", "See /docs", { location: "/docs" })
      if (u.pathname === "/") return send(200, "application/json", JSON.stringify(landingPage(self, {
        docs: "/docs", quickStart: "/docs#description/quick-start", openapi: "/openapi.json", conformance: "/conformance", processes: "/processes", sources: "/terrain-sources", colorramps: "/colorramps", algorithms: "/algorithms",
        terrainTiles: "/terrain-tiles/{source}/{z}/{x}/{y}.png?modes=slope",
        terrainTilesByQuery: "/terrain-tiles/{z}/{x}/{y}.png?modes=slope&terrainSource=<id, URL or JSON>",
        vectorTiles: "/terrain-tiles/{z}/{x}/{y}.pbf?modes=contours,moundDetector",
        basemapTiles: "/basemap-tiles/{source}/{z}/{x}/{y}.jpg (an id of /basemaps)",
        basemapTilesByQuery: "/basemap-tiles/{z}/{x}/{y}.jpg?imageryUrl=<XYZ or COG address>",
        basemaps: "/basemaps", colorrampImage: "/colorramps/{id}.png?width=256&height=16",
        render: "/render.jpg?lat=45.83&lng=6.86&zoom=11&width=1024&height=640&modes=hillshade,contours",
        quantizedMesh: "/quantized-mesh/{source}/layer.json",
        modes: MODE_NAMES, app: BASE_URL,
      }), null, 2))
      if (u.pathname === "/conformance") return send(200, "application/json", JSON.stringify({ conformsTo: CONFORMANCE }, null, 2))
      if (u.pathname === "/processes") return send(200, "application/json", JSON.stringify(processList(self, catalog(), u.searchParams.get("expand") === "true")))
      const proc = u.pathname.match(/^\/processes\/([^/]+)$/)
      if (proc) {
        const p = findProcess(decodeURIComponent(proc[1]))
        if (!p) return send(404, "application/json", NO_SUCH_PROCESS)
        return send(200, "application/json", JSON.stringify(withLinks(self, p), null, 2))
      }
      if (u.pathname === "/view") {
        const { view, rest } = viewOf(viewQuery(u.search))
        const read = viewForPlugin(await readView(view, rest, activeLayers))
        return send(200, "application/json", JSON.stringify({ ...read, tiles: viewTiles(self, read) }))
      }
      if (u.pathname === "/qgis.qgz") {
        const { view, rest, take } = viewOf(u.search)
        const read = await readView(view, rest, activeLayers)
        // The values group's deepest zoom: the view's source's.
        const how = await plan({ terrainSource: view.terrainSource, modes: ["colorRelief"] }, new URLSearchParams(), keysFrom(take)).catch(() => null)
        if (how?.engine === "direct") read.valueLevel = valueLevel(how.dem)
        return send(200, "application/zip", qgisProject(self, read), { "content-disposition": 'attachment; filename="terrain-viewer.qgz"' })
      }
      // A mode's values as one GDAL raster: the Float32 GeoTIFF tiles,
      // described for GDAL's WMS driver (TMS). gdalinfo, gdal_translate,
      // rasterio and QGIS open it (QGIS: Layer > Add Raster Layer, or this
      // XML as the source).
      if (u.pathname === "/gdal.xml") {
        const r = valueRequest(u.search)
        const how = await plan(r.view, r.rest, r.keys)
        if (how.engine !== "direct") return send(400, "text/plain", `The values cannot be computed here: ${how.why}`)
        const q = new URLSearchParams(u.search)
        for (const k of ["modes", "algorithm", "encoding", "compression", "background", "engine", "lat", "lng", "zoom", "width", "height", "bbox"]) q.delete(k)
        return send(200, "application/xml", gdalWmsXml(self, r.mode, q.toString(), valueLevel(how.dem)), { "content-disposition": `inline; filename="terrain-viewer-${r.mode}.xml"` })
      }
      if (u.pathname === "/openapi.json") return send(200, "application/json", JSON.stringify(openapi(self, await (idsPromise ??= sourceIds())), null, 2))
      if (u.pathname === "/docs") return send(200, "text/html; charset=utf-8", DOCS_HTML)
      if (u.pathname === "/terrain-sources") return send(200, "application/json", JSON.stringify({ sources: sources(), note: SOURCES_NOTE }))
      const one = u.pathname.match(/^\/terrain-sources\/([^/]+)$/)
      if (one) {
        const id = decodeURIComponent(one[1])
        const found = sources().find((x) => x.id === id)
        if (!found) return send(404, "text/plain", "No such source: see /terrain-sources")
        return send(200, "application/json", JSON.stringify({ ...found, description: library().terrain.find((x) => x.id === id)?.description }))
      }
      const idates = u.pathname.match(/^\/imagery-dates\/([^/]+)$/)
      if (idates) return send(200, "application/json", JSON.stringify(await imageryDates(self, decodeURIComponent(idates[1]), u.searchParams), null, 2), { "cache-control": "public, max-age=3600" })
      if (u.pathname === "/imagery-dates") return send(200, "application/json", JSON.stringify({ sources: IMAGERY_DATE_SOURCES, note: "The dates of a source at a place: /imagery-dates/{source}?lat=..&lng=..&zoom=.. (zoom: the Web Mercator tile zoom of the 256 px tiles drawn)." }))
      if (u.pathname === "/building-sources") {
        const [A, { buildingSources }] = await Promise.all([import("./generated/app-render.mjs"), import("./buildings.mjs")])
        return send(200, "application/json", JSON.stringify({ sources: buildingSources(A), note: "What buildingShadowSource takes by id (modes=buildingShadows). It also takes an https address (a .pmtiles archive, a {z}/{x}/{y} vector tile template, a TileJSON) with buildingShadowLayer and buildingShadowHeightField, or file:<id> for a GeoJSON registered with POST /files: see /processes/buildingShadows." }, null, 2))
      }
      if (u.pathname === "/basemaps") return send(200, "application/json", JSON.stringify({ basemaps: await basemaps(), note: "Give an id in the path: /basemap-tiles/{id}/{z}/{x}/{y}.jpg (a dated one with imageryDate). An XYZ or COG address: /basemap-tiles/{z}/{x}/{y}.jpg?imageryUrl=..." }))
      // A ramp as a picture: the app's interpolation (MapLibre's colour
      // relief), horizontal by default.
      const rampPic = u.pathname.match(/^\/colorramps\/([^/]+)\.(png|jpg|jpeg)$/)
      if (rampPic) {
        const { colorRampsFlat } = await import("./generated/app-lib.mjs")
        const id = decodeURIComponent(rampPic[1])
        const ramp = colorRampsFlat[id]
        if (!ramp) return send(404, "text/plain", "No such ramp: see /colorramps")
        const p = u.searchParams
        const orientation = p.get("orientation") ?? "horizontal"
        if (orientation !== "horizontal" && orientation !== "vertical") return send(400, "text/plain", "orientation is horizontal (the default: the lowest value on the left) or vertical (the lowest at the bottom)")
        const dim = (k, d) => { const v = p.get(k); if (v === null) return d; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 4096) throw status(400, `${k} is a whole number from 1 to 4096`); return n }
        const width = dim("width", orientation === "vertical" ? 16 : 256), height = dim("height", orientation === "vertical" ? 256 : 16)
        const ext = rampPic[2] === "png" ? "png" : "jpg"
        const bytes = await rampImage(ramp.colors, { width, height, orientation, format: ext, reverse: p.get("reverse") === "true" })
        return send(200, TYPES[ext], bytes, { "cache-control": "public, max-age=86400" })
      }
      if (u.pathname === "/colorramps" || u.pathname.startsWith("/colorramps/")) {
        const { colorRampsFlat } = await import("./generated/app-lib.mjs")
        if (u.pathname === "/colorramps") return send(200, "application/json", JSON.stringify({ colorramps: Object.entries(colorRampsFlat).map(([id, r]) => ({ id, name: r.name ?? id })), note: "Give an id as colorRamp (colour relief) or slopeColorRamp (slope)." }))
        const id = decodeURIComponent(u.pathname.slice(12))
        const ramp = colorRampsFlat[id]
        if (!ramp) return send(404, "text/plain", "No such ramp: see /colorramps")
        return send(200, "application/json", JSON.stringify({ id, name: ramp.name, colors: ramp.colors }))
      }
      if (u.pathname === "/algorithms") return send(200, "application/json", JSON.stringify({
        algorithms: MODE_NAMES.map((id) => ({ id, engine: DIRECT_MODES.includes(id) ? "direct" : "browser" })),
        note: "A tile is computed directly when every mode asked for is `direct` and the source can be read in the server (see /terrain-sources): the app's own code, run in the server, reads the same URL parameters as the app. 3D, tilted and split views, imagery and basemaps, the sky background and the historical mode go to the browser.",
      }))
      // Vector tiles: the same address, .pbf or .mvt, with modes among
      // direct.mjs VECTOR_MODES (unset: contours).
      const v = u.pathname.match(/^\/terrain-tiles\/(\d+)\/(\d+)\/(\d+)\.(pbf|mvt)$/)
      if (v) {
        const [z, x, y] = v.slice(1, 4).map(Number)
        if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return send(404, "text/plain", "No such tile")
        const { view, rest, take } = viewOf(u.search)
        const modes = view.modes?.length ? view.modes : ["contours"]
        const wrong = modes.filter((m) => !VECTOR_MODES.includes(m))
        if (wrong.length) return send(400, "text/plain", `Not served as vector tiles, ask for .png or .jpg: ${wrong.join(", ")} (vector modes: ${VECTOR_MODES.join(", ")})`)
        const input = { view: { terrainSource: view.terrainSource, modes }, rest, keys: keysFrom(take) }
        const how = await plan(input.view, input.rest, input.keys)
        if (how.engine !== "direct") return send(400, "text/plain", `Vector tiles cannot be made here: ${how.why}`)
        const key = `vector|${JSON.stringify([how.dem.tiles, modes, how.state])}|${z}/${x}/${y}`
        let bytes = await cached(key, "pbf")
        if (!bytes) { bytes = await directRun("vector", input, { modes, z, x, y, baseUrl: BASE_URL }); store(key, "pbf", bytes) }
        return send(200, "application/vnd.mapbox-vector-tile", bytes, { "cache-control": "public, max-age=86400" })
      }
      // The source as Cesium terrain (quantized-mesh-1.0, geographic TMS):
      // its layer.json and its .terrain tiles, meshed in a worker
      // (quantized-mesh.mjs). {source} is a library id, or "custom" with the
      // source as terrainSource (or url) in the query.
      const qm = u.pathname.match(/^\/quantized-mesh\/([^/]+)\/(?:layer\.json|(\d+)\/(\d+)\/(\d+)\.terrain)$/)
      if (qm) {
        const made = await quantizedMesh(decodeURIComponent(qm[1]), qm[2] === undefined ? null : qm.slice(2, 5).map(Number), u.search, req.headers)
        if (made.json) return send(200, "application/json", JSON.stringify(made.json, null, 2), { "cache-control": "public, max-age=3600" })
        const gzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "")
        return send(200, made.type, gzip ? made.gz : gunzipSync(made.gz), {
          "cache-control": "public, max-age=86400", vary: "Accept, Accept-Encoding", ...(gzip ? { "content-encoding": "gzip" } : {}),
          "x-tv-engine": "direct", "access-control-expose-headers": EXPOSED,
        })
      }
      if (/^\/quantized-mesh\//.test(u.pathname)) return send(404, "text/plain", "Quantized mesh is /quantized-mesh/{source}/layer.json and /quantized-mesh/{source}/{z}/{x}/{y}.terrain")
      const bt = u.pathname.match(/^\/basemap-tiles\/(\d+)\/(\d+)\/(\d+)(@[12]x)?\.(png|jpg|jpeg)$/)
      if (bt) {
        const [z, x, y] = bt.slice(1, 4).map(Number)
        if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return send(404, "text/plain", "No such tile")
        const ext = bt[5] === "png" ? "png" : "jpg"
        const bq = basemapQuery(u.search)
        // Google Earth historical: built here (ge-historical.mjs), no browser.
        if (bq.get("imagerySource") === "ge-historical" && bq.get("engine") !== "browser") {
          const size = Number(bq.get("tilesize") ?? bq.get("size") ?? 256) * (bt[4] === "@2x" ? 2 : 1)
          if (size !== 256 && size !== 512) return send(400, "text/plain", "A tile is 256 px, or 512 px with @2x or tilesize=512")
          const made = await geHistoricalTile(z, x, y, bq.get("imageryDate"), size, ext)
          if (!made) return send(404, "text/plain", "Google Earth has no imagery at this tile for that date")
          return send(200, made.type, made.bytes, { "cache-control": "public, max-age=86400", "x-tv-engine": "direct", "access-control-expose-headers": EXPOSED })
        }
        const made = await tile(z, x, y, ext, bq, bt[4] === "@2x" ? 2 : 1)
        return send(200, TYPES[ext], made.bytes, { "cache-control": "public, max-age=86400", "x-tv-engine": made.engine, ...(made.why ? { "x-tv-engine-why": made.why } : {}), "access-control-expose-headers": EXPOSED, ...describedBy(self, u) })
      }
      if (/^\/basemap-tiles\//.test(u.pathname)) return send(404, "text/plain", "Basemap tiles are /basemap-tiles/{source}/{z}/{x}/{y}.jpg (an id of /basemaps) or /basemap-tiles/{z}/{x}/{y}.jpg?imageryUrl=..., .jpg or .png (imagery has neither values nor vector tiles)")
      const t = u.pathname.match(/^\/terrain-tiles\/(\d+)\/(\d+)\/(\d+)(@[12]x)?\.(png|jpg|jpeg|tif|tiff)$/)
      if (t) {
        const [z, x, y] = t.slice(1, 4).map(Number)
        if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return send(404, "text/plain", "No such tile")
        const modes = modesOf(u.search)
        if (modes.includes("basemap")) return send(400, "text/plain", "/terrain-tiles draws the elevation modes; ask /basemap-tiles for the imagery (imagerySource, imageryDate, imageryUrl) and stack the two in the client")
        // A mode's values: a Float32 GeoTIFF (.tif), or packed in a PNG
        // (.png?encoding=terrarium|terrainrgb).
        const packing = new URLSearchParams(u.search).get("encoding")
        if (t[5].startsWith("tif") || packing) {
          const format = t[5].startsWith("tif") ? "tif" : packing
          if (!VALUE_FORMATS.includes(format) || (format === "tif") !== t[5].startsWith("tif")) return send(400, "text/plain", "Values come as .tif (Float32 GeoTIFF) or as .png?encoding=terrarium or terrainrgb")
          const made = await valuesFor(format, u.search, { z, x, y, scale: t[4] === "@2x" ? 2 : 1 })
          return send(200, made.type, made.bytes, { ...valueHeaders(made), ...describedBy(self, u) })
        }
        const ext = t[5] === "png" ? "png" : "jpg"
        const made = await tile(z, x, y, ext, u.search, t[4] === "@2x" ? 2 : 1)
        return send(200, TYPES[ext], made.bytes, { "cache-control": "public, max-age=86400", "x-tv-engine": made.engine, ...(made.why ? { "x-tv-engine-why": made.why } : {}), "access-control-expose-headers": EXPOSED, ...describedBy(self, u) })
      }
      if (u.pathname === "/tilejson.json") {
        const q = new URLSearchParams(u.search)
        const asked = q.get("tile_format"); q.delete("tile_format")
        const scale = q.get("tile_scale") === "2" ? "@2x" : ""; q.delete("tile_scale")
        const qs = q.toString()
        if (asked === "pbf" || asked === "mvt") {
          const modes = (q.get("modes") || "contours").split(",").filter(Boolean)
          const layers = { contours: ["contours"], isoline: ["isoband", "isoline", "isoline-cliff"], moundDetector: ["tells"], graticules: ["graticule"] }
          return send(200, "application/json", JSON.stringify({
            tilejson: "3.0.0", name: "Terrain Viewer vector layers", scheme: "xyz", minzoom: 0, maxzoom: MAX_ZOOM, bounds: [-180, -85.0511, 180, 85.0511],
            tiles: [`${self}/terrain-tiles/{z}/{x}/{y}.${asked}${qs ? "?" + qs : ""}`],
            vector_layers: modes.flatMap((m) => (layers[m] ?? []).map((id) => ({ id, fields: {} }))),
          }))
        }
        const fmt = asked === "jpg" || asked === "jpeg" ? "jpg" : "png"
        const modes = modesOf(qs)
        const basemap = modes.length > 0 && modes.every((m) => m === "basemap")
        return send(200, "application/json", JSON.stringify({
          tilejson: "2.2.0", name: "Terrain Viewer", scheme: "xyz", minzoom: 0, maxzoom: MAX_ZOOM, bounds: [-180, -85.0511, 180, 85.0511],
          tiles: [`${self}/${basemap ? "basemap-tiles" : "terrain-tiles"}/{z}/{x}/{y}${scale}.${fmt}${qs ? "?" + qs : ""}`],
        }))
      }
      // A viewport: /render centred (lat, lng, zoom) or on a bbox, and
      // /bbox/{w},{s},{e},{n}/{width}x{height}.{format}, the same answer
      // with the box and the size in the path.
      const r = u.pathname.match(/^\/render\.(png|jpg|jpeg|tif|tiff)$/)
      const bb = !r && u.pathname.match(/^\/bbox\/([^/]+)\/(\d+)x(\d+)\.(png|jpg|jpeg|tif|tiff)$/)
      if (/^\/bbox\//.test(u.pathname) && !bb) return send(404, "text/plain", "A box is /bbox/{west},{south},{east},{north}/{width}x{height}.png|jpg|tif")
      if (r || bb) {
        const q = new URLSearchParams(u.search)
        if (bb) { q.set("bbox", decodeURIComponent(bb[1])); q.set("width", bb[2]); q.set("height", bb[3]); for (const k of ["lat", "lng", "zoom"]) q.delete(k) }
        const asked = r ? r[1] : bb[4]
        if (asked.startsWith("tif") || q.get("encoding")) {
          const format = asked.startsWith("tif") ? "tif" : q.get("encoding")
          if (!VALUE_FORMATS.includes(format) || (format === "tif") !== asked.startsWith("tif")) return send(400, "text/plain", "Values come as .tif (Float32 GeoTIFF) or as .png?encoding=terrarium or terrainrgb")
          const made = await valuesFor(format, q, null)
          return send(200, made.type, made.bytes, { ...valueHeaders(made), ...describedBy(self, u) })
        }
        const ext = asked === "png" ? "png" : "jpg"
        const made = await picture(ext, q)
        return send(200, TYPES[ext], made.bytes, { "cache-control": "public, max-age=86400", "x-tv-engine": made.engine, ...(made.why ? { "x-tv-engine-why": made.why } : {}), "access-control-expose-headers": EXPOSED, ...describedBy(self, u) })
      }
      // Removed on 2026-11-24 (deprecated the same day): say where they went.
      if (/^\/tiles\/\d/.test(u.pathname)) return send(404, "text/plain", "/tiles/{z}/{x}/{y} is removed: ask /terrain-tiles/{z}/{x}/{y} for the elevation modes and /basemap-tiles/{z}/{x}/{y} for the imagery")
      if (u.pathname === "/modes") return send(404, "text/plain", "/modes is removed: see /processes (each mode and its settings) and /view?<share query>")
      // titiler's tile addresses, removed on 2026-11-25 (its /bbox stays, above).
      if (/^\/tiles\/WebMercatorQuad\//.test(u.pathname)) return send(404, "text/plain", "titiler's /tiles/WebMercatorQuad/{z}/{x}/{y} is removed: ask /terrain-tiles/{z}/{x}/{y}")
      if (u.pathname === "/WebMercatorQuad/tilejson.json") return send(404, "text/plain", "/WebMercatorQuad/tilejson.json is removed: ask /tilejson.json")
      send(404, "text/plain", "Not found: see /")
    } catch (e) {
      if (e?.status === 499) return // the client went away: nobody to answer
      send(e?.status || 500, "text/plain", String(e?.message ?? e), e?.retryAfter ? { "retry-after": String(e.retryAfter) } : {})
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = start()
  const stop = () => { server.close(); closePool(); closeBrowser().finally(() => process.exit(0)) }
  process.on("SIGTERM", stop); process.on("SIGINT", stop)
  // TV_EXIT_WITH_STDIN=1: stop when the standard input closes, i.e. when the
  // process that started it (the QGIS plugin) is gone, even after a crash.
  if (process.env.TV_EXIT_WITH_STDIN) { process.stdin.on("end", stop); process.stdin.on("error", stop); process.stdin.resume() }
}
