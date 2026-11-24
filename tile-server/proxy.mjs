// A CORS pass-through for the two NASA hosts the app cannot read directly,
// restricted to the files it needs. Registered in server.mjs as `/proxy/`.
//
//   GET /proxy/gliht/files/G-LiHT/<campaign>/lidar/kml/...kmz
//       glihtdata.gsfc.nasa.gov: no CORS header on anything. The app's
//       gliht:// protocol reads the DTM KMZs by Range (Settings > G-LiHT
//       address = <server>/proxy/gliht). KMZ, and the GeoTIFF archives for
//       a script; nothing else of the host.
//   GET /proxy/earthdata/lp-prod-(protected|public)/GL<product>.001/<granule>/<file>
//       LP DAAC's Earthdata Cloud copy of G-LiHT (GLDTMT DTM, GLDSMT DSM,
//       GLCHMT CHM and their KMZ collections): an Earthdata login, no CORS.
//       The server holds the token (EARTHDATA_TOKEN, never sent to the
//       browser), follows the redirect to the signed S3 address itself and
//       streams the bytes. A token-less request would land on the Earthdata
//       login page: answered 401 here, with what to set.
//   GET /proxy/earthdata/vrt/<same path>.tif
//       A VRT over that GeoTIFF, for the app's in-browser vrt:// reader
//       (custom terrain source, type VRT): the granules are plain stripped
//       Float32 TIFFs with no overviews, so the VRT cuts them into 512 px
//       sources, which makes the reader refuse zooms where a tile would read
//       tens of megabytes.
//
// Range requests pass through (one range; at most TV_PROXY_MAX_RANGE bytes),
// a whole-file GET only below TV_PROXY_MAX_FULL, and TV_PROXY_CONCURRENCY
// upstream reads at a time. Answers carry Access-Control-Allow-Origin: *
// and the headers a Range reader needs (Content-Range, Accept-Ranges, ETag).
// The Earthdata route serves login-protected data to whoever reaches the
// server: on a public host put it behind authentication (tile-service.mdx,
// On a public server).
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Readable } from "node:stream"

const MiB = 1024 * 1024
const MAX_RANGE = Number(process.env.TV_PROXY_MAX_RANGE || 16 * MiB)
const MAX_FULL = Number(process.env.TV_PROXY_MAX_FULL || 64 * MiB)
const CONCURRENCY = Math.max(1, Number(process.env.TV_PROXY_CONCURRENCY || 16))
const TIMEOUT = Number(process.env.TV_PROXY_TIMEOUT || 60_000)

/** EARTHDATA_TOKEN from the environment, else from the repository's .env
 *  (that one key only: the file holds the app's keys too). Read per request,
 *  so a token pasted into .env works without a restart. */
export function earthdataToken() {
  if (process.env.EARTHDATA_TOKEN) return process.env.EARTHDATA_TOKEN.trim()
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const text = readFileSync(process.env.TV_ENV_FILE || path.join(here, "..", ".env"), "utf8")
    const m = /^\s*EARTHDATA_TOKEN\s*=\s*["']?([^"'\r\n#]+)/m.exec(text)
    return m ? m[1].trim() : ""
  } catch { return "" }
}

const NAME = "[A-Za-z0-9_.-]+"
export const ROUTES = {
  gliht: {
    origin: process.env.TV_PROXY_GLIHT_ORIGIN || "https://glihtdata.gsfc.nasa.gov",
    allow: new RegExp(`^/files/G-LiHT/${NAME}/lidar/(kml|geotiff)/(${NAME}/)?${NAME}\\.(kmz|tif\\.gz|tar\\.gz)$`),
    cache: "public, max-age=604800",
  },
  earthdata: {
    origin: process.env.TV_PROXY_EARTHDATA_ORIGIN || "https://data.lpdaac.earthdatacloud.nasa.gov",
    allow: new RegExp(`^/lp-prod-(protected|public)/GL(DTM|DSM|CHM)[TK]\\.001/${NAME}/${NAME}\\.(tif|kmz|png|cmr\\.xml)$`),
    cache: "private, max-age=3600",
    token: true,
  },
}

/** The route and upstream path of a /proxy/ request, or why not. */
export function resolve(pathname) {
  const m = /^\/proxy\/(gliht|earthdata)(\/vrt)?(\/.*)$/.exec(pathname)
  if (!m) return { error: 404, why: "Not a proxied route: /proxy/gliht/files/G-LiHT/... or /proxy/earthdata/lp-prod-protected/GL....001/..." }
  const [, name, vrt, rest] = m
  if (vrt && name !== "earthdata") return { error: 404, why: "VRTs are made for /proxy/earthdata only" }
  if (rest.includes("..") || rest.includes("//") || rest.includes("%")) return { error: 400, why: "Bad path" }
  const route = ROUTES[name]
  if (!route.allow.test(rest)) return { error: 403, why: `Not on the allow-list of /proxy/${name}` }
  if (vrt && !rest.endsWith(".tif")) return { error: 400, why: "A VRT is made over a .tif" }
  return { name, route, rest, vrt: !!vrt }
}

const RANGE_RE = /^bytes=(\d*)-(\d*)$/
/** Bytes a Range header asks for (Infinity for an open end), or an error. */
export function rangeSize(header) {
  if (!header) return { size: Infinity, whole: true }
  const m = RANGE_RE.exec(header.trim())
  if (!m || (m[1] === "" && m[2] === "")) return { error: "one byte range, bytes=start-end or bytes=-suffix" }
  if (m[1] === "") return { size: Number(m[2]) }
  if (m[2] === "") return { size: Infinity }
  const size = Number(m[2]) - Number(m[1]) + 1
  return size > 0 ? { size } : { error: "end before start" }
}

let active = 0
const waiting = []
async function slot(signal) {
  if (active < CONCURRENCY) { active++; return }
  if (waiting.length >= CONCURRENCY * 8) throw Object.assign(new Error("proxy busy"), { status: 503, retryAfter: 2 })
  await new Promise((ok, ko) => {
    const w = { ok, ko }
    waiting.push(w)
    signal.addEventListener("abort", () => { const i = waiting.indexOf(w); if (i >= 0) waiting.splice(i, 1); ko(Object.assign(new Error("client gone"), { status: 499 })) }, { once: true })
  })
  active++
}
function release() { active--; const w = waiting.shift(); if (w) w.ok() }

// TEA (the Earthdata download app) answers a token holder with a redirect to
// a signed S3/CloudFront address, valid an hour: kept 30 minutes, so the
// Range reads of one file skip the login round trip.
const signed = new Map()

async function upstream(name, route, rest, headers, signal) {
  const url = route.origin + rest
  if (!route.token) return fetch(url, { headers, signal, redirect: "follow" })
  const hit = signed.get(rest)
  if (hit && hit.until > Date.now()) {
    const r = await fetch(hit.url, { headers, signal, redirect: "follow" })
    if (r.status !== 403) return r
    signed.delete(rest)
  }
  const token = earthdataToken()
  if (!token && rest.startsWith("/lp-prod-protected/")) throw Object.assign(new Error("EARTHDATA_TOKEN is not set on the tile service: generate a token at https://urs.earthdata.nasa.gov (Generate Token) and put EARTHDATA_TOKEN=<token> in the server's environment or the repository's .env"), { status: 401 })
  // Manual redirects: the token goes to the Earthdata host only, never to S3.
  let r = await fetch(url, { headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal, redirect: "manual" })
  for (let hops = 0; r.status >= 300 && r.status < 400 && hops < 4; hops++) {
    const loc = r.headers.get("location")
    if (!loc) break
    const next = new URL(loc, url)
    if (next.hostname === "urs.earthdata.nasa.gov") throw Object.assign(new Error("Earthdata refused the token (expired or wrong, or the account has not accepted the LP DAAC data use): generate a new one at https://urs.earthdata.nasa.gov"), { status: 401 })
    if (next.hostname.endsWith("earthdatacloud.nasa.gov")) {
      r = await fetch(next, { headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal, redirect: "manual" })
      continue
    }
    signed.set(rest, { url: next.toString(), until: Date.now() + 30 * 60_000 })
    r = await fetch(next, { headers, signal, redirect: "follow" })
  }
  return r
}

const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "content-range, content-length, accept-ranges, etag, last-modified",
}

/** Answers a /proxy/ request; `self` is the server's own base URL. */
export async function handleProxy(req, res, self) {
  const fail = (status, text, extra = {}) => { if (res.headersSent) return res.destroy(); res.writeHead(status, { "content-type": "text/plain", ...CORS, ...extra }); res.end(text) }
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...CORS, "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "range, if-none-match, if-modified-since", "access-control-max-age": "86400" })
    return res.end()
  }
  if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "GET, HEAD or OPTIONS")
  const u = new URL(req.url, "http://x")
  const r = resolve(u.pathname)
  if (r.error) return fail(r.error, r.why)
  const range = rangeSize(req.headers.range)
  if (range.error) return fail(416, `Range: ${range.error}`)
  if (!range.whole && range.size > MAX_RANGE) return fail(416, `Range: at most ${MAX_RANGE} bytes per request (TV_PROXY_MAX_RANGE)`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  res.on("close", () => { clearTimeout(timer); if (!res.writableFinished) controller.abort() })
  try {
    if (r.vrt) {
      // The header is read over loopback: the public address may sit behind
      // an authenticating proxy the server cannot pass.
      const xml = await vrtFor(r.rest, self, controller.signal, `http://127.0.0.1:${req.socket.localPort}`)
      res.writeHead(200, { "content-type": "application/xml", ...CORS, "cache-control": "private, max-age=3600" })
      return res.end(xml)
    }
    await slot(controller.signal)
    let up
    try {
      const headers = { "user-agent": "terrain-viewer-tile-service" }
      if (req.headers.range) headers.range = req.headers.range
      if (req.headers["if-none-match"]) headers["if-none-match"] = req.headers["if-none-match"]
      if (req.headers["if-modified-since"]) headers["if-modified-since"] = req.headers["if-modified-since"]
      up = await upstream(r.name, r.route, r.rest, headers, controller.signal)
      const len = Number(up.headers.get("content-length"))
      if (up.status === 200 && Number.isFinite(len) && len > MAX_FULL && req.method === "GET") {
        up.body?.cancel()
        return fail(413, `${len} bytes: ask for byte ranges (at most ${MAX_RANGE}); whole files are served up to ${MAX_FULL} bytes (TV_PROXY_MAX_FULL)`)
      }
      const out = { ...CORS, "cache-control": up.ok || up.status === 304 ? r.route.cache : "no-store" }
      for (const h of PASS) { const v = up.headers.get(h); if (v) out[h] = v }
      // An S3 error is XML: say which side refused.
      if (!up.ok && up.status !== 304) out["x-tv-upstream-status"] = String(up.status)
      res.writeHead(up.status, out)
      if (req.method === "HEAD" || !up.body) { up.body?.cancel(); return res.end() }
      // Counted on the way, so a server that sends more than it announced
      // (or no length at all) is still cut at the limit.
      let sent = 0
      const cap = range.whole ? MAX_FULL : MAX_RANGE
      for await (const chunk of Readable.fromWeb(up.body)) {
        sent += chunk.length
        if (sent > cap) { res.destroy(); return }
        if (!res.write(chunk)) await new Promise((ok) => res.once("drain", ok))
      }
      res.end()
    } finally { release() }
  } catch (e) {
    if (e?.status === 499 || controller.signal.aborted && res.destroyed) return
    if (e?.name === "AbortError") return fail(504, `upstream did not answer within ${TIMEOUT / 1000} s`)
    fail(e?.status || 502, String(e?.message ?? e), e?.retryAfter ? { "retry-after": String(e.retryAfter) } : {})
  } finally { clearTimeout(timer) }
}

// ─── The VRT over an Earthdata GeoTIFF ──────────────────────────────────────

const SOURCE_PX = 512
const vrtCache = new Map()

/** Reads the TIFF's header through this same proxy (so the token and the
 *  redirect are handled once, in one place) and writes a VRT whose sources
 *  are 512 px windows of it, all pointing at the proxied file. */
export async function vrtFor(rest, self, signal, loopback = self) {
  const key = `${self}${rest}`
  const hit = vrtCache.get(key)
  if (hit) return hit
  const fileUrl = `${self}/proxy/earthdata${rest}`
  const { fromUrl } = await import("geotiff")
  const tiff = await fromUrl(`${loopback}/proxy/earthdata${rest}`, { allowFullFile: false }, signal)
  const img = await tiff.getImage(0)
  const W = img.getWidth(), H = img.getHeight()
  const [ox, oy] = img.getOrigin(), [sx, sy] = img.getResolution()
  const geo = img.getGeoKeys() ?? {}
  const epsg = geo.ProjectedCSTypeGeoKey ?? geo.GeographicTypeGeoKey
  if (!epsg || epsg === 32767) throw Object.assign(new Error("the GeoTIFF names no EPSG code"), { status: 502 })
  const fmt = img.getSampleFormat?.() ?? 3
  const bits = img.getBitsPerSample?.() ?? 32
  const type = fmt === 3 ? (bits === 64 ? "Float64" : "Float32") : fmt === 2 ? `Int${bits}` : bits === 8 ? "Byte" : `UInt${bits}`
  const nodata = img.getGDALNoData()
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  const sources = []
  for (let y = 0; y < H; y += SOURCE_PX) for (let x = 0; x < W; x += SOURCE_PX) {
    const w = Math.min(SOURCE_PX, W - x), h = Math.min(SOURCE_PX, H - y)
    sources.push(`    <SimpleSource><SourceFilename relativeToVRT="0">${esc(fileUrl)}</SourceFilename><SourceBand>1</SourceBand><SrcRect xOff="${x}" yOff="${y}" xSize="${w}" ySize="${h}"/><DstRect xOff="${x}" yOff="${y}" xSize="${w}" ySize="${h}"/></SimpleSource>`)
  }
  const xml = `<VRTDataset rasterXSize="${W}" rasterYSize="${H}">
  <SRS>EPSG:${epsg}</SRS>
  <GeoTransform>${ox}, ${sx}, 0, ${oy}, 0, ${sy}</GeoTransform>
  <VRTRasterBand dataType="${type}" band="1">
${nodata != null && Number.isFinite(nodata) ? `    <NoDataValue>${nodata}</NoDataValue>\n` : ""}${sources.join("\n")}
  </VRTRasterBand>
</VRTDataset>
`
  vrtCache.set(key, xml)
  if (vrtCache.size > 256) vrtCache.delete(vrtCache.keys().next().value)
  return xml
}
