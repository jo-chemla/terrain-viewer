// Terrain Viewer tile service: the app's rendering as map tiles and as
// pictures of a viewport, over plain HTTP. The app itself draws them, in a
// headless browser (the renderer of the MCP server's `screenshot` tool), so
// every source the app reads and every mode it computes comes out the same.
//
//   GET /tiles/{z}/{x}/{y}.png|jpg     one Web Mercator tile (XYZ), 256 px;
//                                      {y}@2x or tilesize=512 for 512 px
//   GET /tiles/{z}/{x}/{y}.pbf|mvt     the same overlays as a vector tile:
//                                      contours, isoline, moundDetector, graticules
//   GET /render.png|jpg                a viewport, like a WMS GetMap: lat, lng,
//                                      zoom or bbox=w,s,e,n, width, height
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
// The addresses of titiler are answered too, so a client written for it
// needs few changes: /tiles/WebMercatorQuad/{z}/{x}/{y}[@2x].png,
// /WebMercatorQuad/tilejson.json, /bbox/{w},{s},{e},{n}/{width}x{height}.png,
// with `url` for the source, `algorithm` for one mode and `tilesize`. Only
// Web Mercator; titiler's rescale, colormap, bidx and expression are not
// read (the app's own parameters set the ramps).
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
//   GET /sources, /sources/{id}        the terrain sources, by id
//   GET /colorramps, /colorramps/{id}  the colour ramps, by id
//   GET /algorithms                    the modes, and which engine draws them
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
// TV_SOFTWARE_GL, TV_RENDER_CONCURRENCY (2), TV_ALLOWED_HOSTS (comma-separated
// host names accepted in the Host header; unset: any), TV_MAPBOX_KEY,
// TV_MAPTILER_KEY, TV_CESIUM_ION_KEY (the operator's keys, used when a
// request gives none: anyone who can reach the service then uses them).
import http from "node:http"
import { qgisProject, readView } from "./qgis-project.mjs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildViewUrl, queryToView, DEFAULT_BASE_URL, MODE_NAMES } from "./url.mjs"
import { withSettledPage, closeBrowser } from "./render.mjs"
import { openapi, DOCS_HTML } from "./openapi.mjs"
import { plan, draw, drawViewport, flatView, DIRECT_MODES, VECTOR_MODES, vectorTile, activeLayers } from "./direct.mjs"
import { library, BUILTIN_DEMS, whyNotDirect, needsKey, keysOf, KEY_PARAMS } from "./dem.mjs"

const PORT = Number(process.env.PORT || 3400)
const BASE_URL = process.env.TV_BASE_URL || DEFAULT_BASE_URL
const CACHE_DIR = process.env.TILE_CACHE_DIR || path.join(os.tmpdir(), "terrain-viewer-tiles")
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const CONCURRENCY = Math.max(1, Number(process.env.TV_RENDER_CONCURRENCY || 2))
const BLOCK_PX = 2048
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

const file = (key, ext) => path.join(CACHE_DIR, createHash("sha1").update(key).digest("hex") + "." + ext)
async function cached(key, ext) {
  try {
    const f = file(key, ext)
    const stat = await fs.stat(f)
    return Date.now() - stat.mtimeMs > CACHE_TTL ? null : await fs.readFile(f)
  } catch { return null }
}
async function store(key, ext, bytes) {
  try { await fs.mkdir(CACHE_DIR, { recursive: true }); await fs.writeFile(file(key, ext), bytes) } catch { /* a cache */ }
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

// A few pages at a time: each one is a whole app.
let running = 0
const waiting = []
async function slot(work) {
  if (running >= CONCURRENCY) await new Promise((go) => waiting.push(go))
  running++
  try { return await work() } finally { running--; waiting.shift()?.() }
}

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
    ...BUILTIN_DEMS.map((d) => ({ id: d.id, name: d.name, type: d.encoding === "mapbox" ? "terrainrgb" : "terrarium", url: d.tiles, maxzoom: d.maxzoom, engine: "direct" })),
    { id: "esri", name: "Esri World Elevation - LERC", type: "lerc", maxzoom: 16, engine: "direct" },
    ...["mapbox", "maptiler", "cesium"].map((id) => ({ id, type: id === "cesium" ? "quantized-mesh" : "terrainrgb", ...engine({ id }) })),
    ...library().terrain.map((s) => ({ id: s.id, name: s.name, type: s.type, ...(s.tiles ? { url: s.tiles } : {}), ...(s.maxzoom != null ? { maxzoom: s.maxzoom } : {}), ...(s.bounds ? { bounds: s.bounds } : {}), ...(s.resolutionM != null ? { resolutionM: s.resolutionM } : {}), ...engine(s) })),
  ]
}
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
      const bytes = await draw(how, { world: size * 2 ** z, x0: x * size, y0: y * size, width: size, height: size, format: ext, baseUrl: BASE_URL })
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
    })).finally(() => blocks.delete(blockKey))
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
    if (how.engine === "direct") return { bytes: await drawViewport(how, { lat, lng, zoom: zoom ?? 12, width, height, format: ext, baseUrl: BASE_URL }), engine: "direct" }
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

const TYPES = { png: "image/png", jpg: "image/jpeg" }
const allowedHosts = (process.env.TV_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)

export function start(port = PORT) {
  sweep(); setInterval(sweep, 6 * 60 * 60 * 1000).unref()
  return http.createServer(async (req, res) => {
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", ...extra }); res.end(body) }
    try {
      const host = (req.headers.host || "").replace(/:\d+$/, "")
      if (allowedHosts.length && !["localhost", "127.0.0.1", "[::1]", ...allowedHosts].includes(host)) return send(403, "text/plain", "Host not allowed")
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain", "GET only")
      const u = new URL(req.url, "http://x")
      if (u.pathname === "/health") return send(200, "application/json", JSON.stringify({ ok: true, app: BASE_URL }))
      if (u.pathname === "/") return send(200, "application/json", JSON.stringify({
        docs: "/docs", openapi: "/openapi.json", sources: "/sources", colorramps: "/colorramps", algorithms: "/algorithms",
        tiles: "/tiles/{z}/{x}/{y}.png?modes=slope&terrainSource=<id or URL>",
        vectorTiles: "/tiles/{z}/{x}/{y}.pbf?modes=contours,moundDetector",
        render: "/render.jpg?lat=45.83&lng=6.86&zoom=11&width=1024&height=640&modes=hillshade,contours",
        modes: MODE_NAMES, app: BASE_URL,
      }, null, 2))
      const self = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`
      if (u.pathname === "/qgis.qgz") {
        const { view, rest } = viewOf(u.search)
        return send(200, "application/zip", qgisProject(self, await readView(view, rest, activeLayers)), { "content-disposition": 'attachment; filename="terrain-viewer.qgz"' })
      }
      if (u.pathname === "/openapi.json") return send(200, "application/json", JSON.stringify(openapi(self), null, 2))
      if (u.pathname === "/docs") return send(200, "text/html; charset=utf-8", DOCS_HTML)
      if (u.pathname === "/sources") return send(200, "application/json", JSON.stringify({ sources: sources(), note: SOURCES_NOTE }))
      const one = u.pathname.match(/^\/sources\/([^/]+)$/)
      if (one) {
        const id = decodeURIComponent(one[1])
        const found = sources().find((x) => x.id === id)
        if (!found) return send(404, "text/plain", "No such source: see /sources")
        return send(200, "application/json", JSON.stringify({ ...found, description: library().terrain.find((x) => x.id === id)?.description }))
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
        note: "A tile is computed directly when every mode asked for is `direct` and the source can be read in the server (see /sources): the app's own code, run in the server, reads the same URL parameters as the app. 3D, tilted and split views, imagery and basemaps, the sky background and the historical mode go to the browser.",
      }))
      // Vector tiles: the same address, .pbf or .mvt, with modes among
      // direct.mjs VECTOR_MODES (unset: contours).
      const v = u.pathname.match(/^\/tiles\/(?:WebMercatorQuad\/)?(\d+)\/(\d+)\/(\d+)\.(pbf|mvt)$/)
      if (v) {
        const [z, x, y] = v.slice(1, 4).map(Number)
        if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return send(404, "text/plain", "No such tile")
        const { view, rest, take } = viewOf(u.search)
        const modes = view.modes?.length ? view.modes : ["contours"]
        const wrong = modes.filter((m) => !VECTOR_MODES.includes(m))
        if (wrong.length) return send(400, "text/plain", `Not served as vector tiles, ask for .png or .jpg: ${wrong.join(", ")} (vector modes: ${VECTOR_MODES.join(", ")})`)
        const how = await plan({ terrainSource: view.terrainSource, modes }, rest, keysFrom(take))
        if (how.engine !== "direct") return send(400, "text/plain", `Vector tiles cannot be made here: ${how.why}`)
        const key = `vector|${JSON.stringify([how.dem.tiles, modes, how.state])}|${z}/${x}/${y}`
        let bytes = await cached(key, "pbf")
        if (!bytes) { bytes = await vectorTile(how, modes, z, x, y, BASE_URL); store(key, "pbf", bytes) }
        return send(200, "application/vnd.mapbox-vector-tile", bytes, { "cache-control": "public, max-age=86400" })
      }
      const t = u.pathname.match(/^\/tiles\/(?:WebMercatorQuad\/)?(\d+)\/(\d+)\/(\d+)(@[12]x)?\.(png|jpg|jpeg)$/)
      if (t) {
        const [z, x, y] = t.slice(1, 4).map(Number)
        const ext = t[5] === "png" ? "png" : "jpg"
        if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return send(404, "text/plain", "No such tile")
        const made = await tile(z, x, y, ext, u.search, t[4] === "@2x" ? 2 : 1)
        return send(200, TYPES[ext], made.bytes, { "cache-control": "public, max-age=86400", "x-tv-engine": made.engine, ...(made.why ? { "x-tv-engine-why": made.why } : {}), "access-control-expose-headers": "x-tv-engine, x-tv-engine-why" })
      }
      if (u.pathname === "/WebMercatorQuad/tilejson.json" || u.pathname === "/tilejson.json") {
        const q = new URLSearchParams(u.search)
        const asked = q.get("tile_format"); q.delete("tile_format")
        const scale = q.get("tile_scale") === "2" ? "@2x" : ""; q.delete("tile_scale")
        const qs = q.toString()
        if (asked === "pbf" || asked === "mvt") {
          const modes = (q.get("modes") || "contours").split(",").filter(Boolean)
          const layers = { contours: ["contours"], isoline: ["isoband", "isoline", "isoline-cliff"], moundDetector: ["tells"], graticules: ["graticule"] }
          return send(200, "application/json", JSON.stringify({
            tilejson: "3.0.0", name: "Terrain Viewer vector layers", scheme: "xyz", minzoom: 0, maxzoom: MAX_ZOOM, bounds: [-180, -85.0511, 180, 85.0511],
            tiles: [`${self}/tiles/WebMercatorQuad/{z}/{x}/{y}.${asked}${qs ? "?" + qs : ""}`],
            vector_layers: modes.flatMap((m) => (layers[m] ?? []).map((id) => ({ id, fields: {} }))),
          }))
        }
        const fmt = asked === "jpg" || asked === "jpeg" ? "jpg" : "png"
        return send(200, "application/json", JSON.stringify({
          tilejson: "2.2.0", name: "Terrain Viewer", scheme: "xyz", minzoom: 0, maxzoom: MAX_ZOOM, bounds: [-180, -85.0511, 180, 85.0511],
          tiles: [`${self}/tiles/WebMercatorQuad/{z}/{x}/{y}${scale}.${fmt}${qs ? "?" + qs : ""}`],
        }))
      }
      const bb = u.pathname.match(/^\/bbox\/([-\d.,]+)\/(\d+)x(\d+)\.(png|jpg|jpeg)$/)
      const r = u.pathname.match(/^\/render\.(png|jpg|jpeg)$/)
      if (bb || r) {
        const q = new URLSearchParams(u.search)
        if (bb) { q.set("bbox", bb[1]); q.set("width", bb[2]); q.set("height", bb[3]) }
        const ext = (bb ? bb[4] : r[1]) === "png" ? "png" : "jpg"
        const made = await picture(ext, q)
        return send(200, TYPES[ext], made.bytes, { "cache-control": "public, max-age=86400", "x-tv-engine": made.engine, ...(made.why ? { "x-tv-engine-why": made.why } : {}), "access-control-expose-headers": "x-tv-engine, x-tv-engine-why" })
      }
      send(404, "text/plain", "Not found: see /")
    } catch (e) {
      send(e?.status || 500, "text/plain", String(e?.message ?? e))
    }
  }).listen(port, () => console.error(`terrain-viewer tiles on http://localhost:${port}/ (app: ${BASE_URL})`))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = start()
  const stop = () => { server.close(); closeBrowser().finally(() => process.exit(0)) }
  process.on("SIGTERM", stop); process.on("SIGINT", stop)
}
