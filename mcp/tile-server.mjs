// Terrain Viewer tile service: the app's rendering as map tiles and as
// pictures of a viewport, over plain HTTP. The app itself draws them, in a
// headless browser (the renderer of the MCP server's `screenshot` tool), so
// every source the app reads and every mode it computes comes out the same.
//
//   GET /tiles/{z}/{x}/{y}.png|jpg   one Web Mercator tile (XYZ)
//   GET /render.png|jpg              a viewport: lat, lng, zoom or bbox=w,s,e,n
//   GET /health
//
// Both take the view as query parameters, the vocabulary of url.mjs:
//   terrainSource   a library id or a tile/COG URL (default: the app's own)
//   modes           comma-separated names (slope, contours, svf, ...; see MODES)
//   imageryUrl, imagerySource, imageryDate
//   size            tiles: 256 (default) or 512; render: width, height
//   anything else   passed to the app as a URL parameter, as is
// /render also takes viewMode, pitch, bearing, split, terrainSourceB.
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
import { buildViewUrl, DEFAULT_BASE_URL, MODE_NAMES } from "./url.mjs"
import { withSettledPage, closeBrowser } from "./tools.mjs"

const PORT = Number(process.env.PORT || 3400)
const BASE_URL = process.env.TV_BASE_URL || DEFAULT_BASE_URL
const CACHE_DIR = process.env.TILE_CACHE_DIR || path.join(os.tmpdir(), "terrain-viewer-tiles")
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const CONCURRENCY = Math.max(1, Number(process.env.TV_RENDER_CONCURRENCY || 2))
const BLOCK_PX = 2048
const MAX_ZOOM = 22

/** The view a request describes, without its camera. */
export function viewOf(query) {
  const q = new URLSearchParams(query)
  const take = (k) => { const v = q.get(k); q.delete(k); return v ?? undefined }
  const view = {
    terrainSource: take("terrainSource"),
    imageryUrl: take("imageryUrl"),
    imagerySource: take("imagerySource"),
    imageryDate: take("imageryDate"),
  }
  const modes = take("modes")
  if (modes !== undefined) view.modes = modes.split(",").map((s) => s.trim()).filter(Boolean)
  return { view, rest: q, take }
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

async function tile(z, x, y, ext, query) {
  const { view, rest, take } = viewOf(query)
  const size = Number(take("size") || 256)
  if (size !== 256 && size !== 512) throw Object.assign(new Error("size is 256 or 512"), { status: 400 })
  // The camera of a tile is the tile's: these are not the caller's to set.
  for (const k of ["lat", "lng", "zoom", "pitch", "bearing", "viewMode", "split", "splitStyle", "terrainSourceB", "width", "height"]) rest.delete(k)
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
  let lat = num("lat"), lng = num("lng"), zoom = num("zoom")
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
  const full = {
    ...view, lat, lng, zoom: zoom ?? 12,
    viewMode: take("viewMode"), pitch: num("pitch"), bearing: num("bearing"), split: take("split"), terrainSourceB: take("terrainSourceB"),
  }
  full.params = Object.fromEntries(rest)
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
        tiles: "/tiles/{z}/{x}/{y}.png?modes=slope&terrainSource=<id or URL>&size=256",
        render: "/render.jpg?lat=45.83&lng=6.86&zoom=11&width=1024&height=640&modes=hillshade,contours",
        modes: MODE_NAMES, app: BASE_URL,
      }, null, 2))
      const t = u.pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.(png|jpg)$/)
      if (t) {
        const [z, x, y] = t.slice(1, 4).map(Number)
        if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return send(404, "text/plain", "No such tile")
        return send(200, TYPES[t[4]], await tile(z, x, y, t[4], u.search), { "cache-control": "public, max-age=86400" })
      }
      const r = u.pathname.match(/^\/render\.(png|jpg)$/)
      if (r) return send(200, TYPES[r[1]], await picture(r[1], u.search), { "cache-control": "public, max-age=86400" })
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
