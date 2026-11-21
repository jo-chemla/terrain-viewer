// Terrain Viewer tile service: the app's rendering as map tiles and as
// pictures of a viewport, over plain HTTP. The app itself draws them, in a
// headless browser (the renderer of the MCP server's `screenshot` tool), so
// every source the app reads and every mode it computes comes out the same.
//
//   GET /tiles/{z}/{x}/{y}.png|jpg     one Web Mercator tile (XYZ), 256 px;
//                                      {y}@2x or tilesize=512 for 512 px
//   GET /render.png|jpg                a viewport, like a WMS GetMap: lat, lng,
//                                      zoom or bbox=w,s,e,n, width, height
//   GET /openapi.json, /docs           the description, and a page to try it
//   GET /health
//
// Both take the view as query parameters, the vocabulary of url.mjs:
//   terrainSource   a library id or a tile/COG URL (default: the app's own)
//   modes           comma-separated names (slope, contours, svf, ...; see MODES)
//   imageryUrl, imagerySource, imageryDate
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
// A tile is not rendered alone: the app draws the 2048 px block it belongs
// to in one page, and the block is cut into tiles, all of them cached. The
// first tile of a block takes what a picture takes (seconds), its neighbours
// then answer from the cache.
//
// Environment: PORT (3400), TV_BASE_URL (the app), TILE_CACHE_DIR, CHROME_PATH,
// TV_SOFTWARE_GL, TV_RENDER_CONCURRENCY (2), TV_ALLOWED_HOSTS (comma-separated
// host names accepted in the Host header; unset: any).
import http from "node:http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildViewUrl, queryToView, DEFAULT_BASE_URL, MODE_NAMES } from "./url.mjs"
import { withSettledPage, closeBrowser } from "./render.mjs"
import { openapi, DOCS_HTML } from "./tile-openapi.mjs"

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

const shot = (ext) => (ext === "png" ? { type: "png" } : { type: "jpeg", quality: 85 })
const blocks = new Map() // block key -> promise, while it renders

async function tile(z, x, y, ext, query, scale = 1) {
  const { view, rest, take } = viewOf(query)
  const asked = take("tilesize") ?? take("size")
  const size = Number(asked || 256) * scale
  if (size !== 256 && size !== 512) throw Object.assign(new Error("A tile is 256 px, or 512 px with @2x or tilesize=512"), { status: 400 })
  // The camera of a tile is the tile's: these are not the caller's to set.
  for (const k of ["lat", "lng", "zoom", "pitch", "bearing", "viewMode", "split", "terrainSourceB", "place"]) delete view[k]
  for (const k of ["splitStyle", "width", "height"]) rest.delete(k)
  const b = blockOf(z, x, y, size)
  const params = Object.fromEntries(rest)
  const url = buildViewUrl({ ...view, lat: b.lat, lng: b.lng, zoom: b.zoom, viewMode: "2d", pitch: 0, bearing: 0, params }, { baseUrl: BASE_URL, embed: true })
  const tileKey = (col, row) => `${url}|${size}|${b.bx * b.per + col}/${b.by * b.per + row}`
  const have = await cached(tileKey(b.col, b.row), ext)
  if (have) return have
  const blockKey = `${url}|${size}|${ext}`
  if (!blocks.has(blockKey)) {
    const work = slot(() => withSettledPage(url, { width: b.side, height: b.side, bare: true }, async (page) => {
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
  return (await blocks.get(blockKey)).get(`${b.col}/${b.row}`)
}

async function picture(ext, query) {
  const { view, rest, take } = viewOf(query)
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
  const full = { ...view, lat, lng, zoom: zoom ?? 12, params: Object.fromEntries(rest) }
  const url = buildViewUrl(full, { baseUrl: BASE_URL, embed: true })
  const key = `${url}|${width}x${height}`
  const have = await cached(key, ext)
  if (have) return have
  const bytes = await slot(() => withSettledPage(url, { width, height }, (page) => page.screenshot(shot(ext))))
  store(key, ext, bytes)
  return bytes
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
        docs: "/docs", openapi: "/openapi.json",
        tiles: "/tiles/{z}/{x}/{y}.png?modes=slope&terrainSource=<id or URL>",
        render: "/render.jpg?lat=45.83&lng=6.86&zoom=11&width=1024&height=640&modes=hillshade,contours",
        modes: MODE_NAMES, app: BASE_URL,
      }, null, 2))
      const self = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`
      if (u.pathname === "/openapi.json") return send(200, "application/json", JSON.stringify(openapi(self), null, 2))
      if (u.pathname === "/docs") return send(200, "text/html; charset=utf-8", DOCS_HTML)
      const t = u.pathname.match(/^\/tiles\/(?:WebMercatorQuad\/)?(\d+)\/(\d+)\/(\d+)(@[12]x)?\.(png|jpg|jpeg)$/)
      if (t) {
        const [z, x, y] = t.slice(1, 4).map(Number)
        const ext = t[5] === "png" ? "png" : "jpg"
        if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return send(404, "text/plain", "No such tile")
        return send(200, TYPES[ext], await tile(z, x, y, ext, u.search, t[4] === "@2x" ? 2 : 1), { "cache-control": "public, max-age=86400" })
      }
      if (u.pathname === "/WebMercatorQuad/tilejson.json" || u.pathname === "/tilejson.json") {
        const q = new URLSearchParams(u.search)
        const fmt = q.get("tile_format") === "jpg" || q.get("tile_format") === "jpeg" ? "jpg" : "png"; q.delete("tile_format")
        const scale = q.get("tile_scale") === "2" ? "@2x" : ""; q.delete("tile_scale")
        const qs = q.toString()
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
        return send(200, TYPES[ext], await picture(ext, q), { "cache-control": "public, max-age=86400" })
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
