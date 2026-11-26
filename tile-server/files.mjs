// Local raster files as terrain sources: a GeoTIFF (a COG or not) or a GDAL
// VRT on this machine, read by the app's own VRT reader (lib/vrt-protocol.ts:
// any CRS, reprojected with proj4, overviews read by geotiff.js). The reader
// fetches tvfile://<id>/<name> addresses, which this module answers from the
// registered files themselves (installFileFetch: in the server's thread and
// in each direct-engine worker); no file is served over HTTP.
//
// A file is read only once the user has registered it, never from a path in
// a tile address:
//
//   POST /files   {"path": "C:/data/lidar.tif"}   -> {"id", "source": "file:<id>", "name", "type"}
//                 then terrainSource=file:<id> in any tile address
//   DELETE /files/<id>                            forgets it
//
// The rules, so that no request can read a file the user did not hand over:
// - only a request from this machine (a loopback address) with no Origin
//   header (a web page's request always has one) and a JSON body registers
//   (a web page cannot send JSON cross-origin without a preflight, which the
//   service never grants for /files);
// - the path is absolute, resolved through its links (realpath), a regular
//   file whose content starts as a TIFF or a VRT, named .tif, .tiff or .vrt;
//   with TV_FILE_ROOTS set (folders, separated by the platform's path
//   delimiter), it must lie under one of them; TV_LOCAL_FILES=off turns
//   registration off;
// - a VRT's own local sources are checked the same way (one outside the
//   roots refuses the VRT) and read under the VRT's id only; a VRT in a VRT
//   is refused;
// - the id is an HMAC of the real path, size and modification time with a
//   key kept in the cache folder: unguessable, stable while the file is
//   unchanged (its cached tiles stay valid), new when it changes;
// - a read names an id and one of that entry's own file names, never a
//   path; the file is checked unchanged before each read.
//
// A GeoJSON file (.geojson, at most 100 MB) registers the same way, as a
// source of building footprints for the building shadows
// (buildingShadowSource=file:<id>, buildings.mjs); it is no terrain source.
//
// The registry is local-files.json in the cache folder (TILE_CACHE_DIR):
// the workers, separate threads, read it there, and a registration outlives
// a restart while the file is unchanged.
import { createHmac, randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const DIR = process.env.TILE_CACHE_DIR || path.join(os.tmpdir(), "terrain-viewer-tiles")
const KEY_FILE = path.join(DIR, "local-files.key")
const REGISTRY = path.join(DIR, "local-files.json")
/** The registry file (tests). */
export const registryPath = () => REGISTRY
const ID_RE = /^[0-9a-f]{32}$/
export const SOURCE_RE = /^file:([0-9a-f]{32})$/
const EXT_RE = /\.(tif|tiff|vrt|geojson)$/i
const GEOJSON_MAX_BYTES = 100 * 1024 * 1024
const SCHEME = "tvfile://"
export const enabled = () => (process.env.TV_LOCAL_FILES || "").toLowerCase() !== "off"
export const roots = () => (process.env.TV_FILE_ROOTS || "").split(path.delimiter).map((r) => r.trim()).filter(Boolean)
  .map((r) => { try { return fs.realpathSync.native(path.resolve(r)) } catch { return null } }).filter(Boolean)

let key
function secret() {
  if (key) return key
  try { key = fs.readFileSync(KEY_FILE) } catch {
    fs.mkdirSync(DIR, { recursive: true })
    key = randomBytes(32)
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 })
  }
  return key
}

let cache = { mtime: -1, data: { files: {} } }
function load() {
  try {
    const st = fs.statSync(REGISTRY)
    if (st.mtimeMs !== cache.mtime) cache = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(REGISTRY, "utf8")) }
  } catch { /* none yet */ }
  return cache.data
}
function save(data) {
  fs.mkdirSync(DIR, { recursive: true })
  const tmp = `${REGISTRY}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1))
  fs.renameSync(tmp, REGISTRY)
  cache = { mtime: fs.statSync(REGISTRY).mtimeMs, data }
}

const refuse = (status, message) => Object.assign(new Error(message), { status })

function inside(p, root) {
  const rel = path.relative(root, p)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/** A path checked by the rules above: its real path, stat and kind. */
function checked(given, what = "file") {
  if (typeof given !== "string" || !given || given.includes("\0")) throw refuse(400, `${what}: give an absolute path`)
  if (!path.isAbsolute(given)) throw refuse(400, `${what}: ${given} is not an absolute path`)
  let real
  try { real = fs.realpathSync.native(given) } catch { throw refuse(404, `${what}: no such file: ${given}`) }
  const st = fs.statSync(real)
  if (!st.isFile()) throw refuse(400, `${what}: not a file: ${given}`)
  if (!EXT_RE.test(real)) throw refuse(400, `${what}: ${path.basename(real)} is not a .tif, .tiff, .vrt or .geojson`)
  const r = roots()
  if (r.length && !r.some((root) => inside(real, root))) throw refuse(403, `${what}: ${real} is outside the folders this service may read (TV_FILE_ROOTS)`)
  const head = Buffer.alloc(512)
  const fd = fs.openSync(real, "r")
  const n = fs.readSync(fd, head, 0, 512, 0)
  fs.closeSync(fd)
  const magic = head.subarray(0, 4).toString("latin1")
  const tiff = ["II*\0", "MM\0*", "II+\0", "MM\0+"].includes(magic)
  const vrt = /^\s*(<\?xml[^>]*\?>\s*)?<VRTDataset[\s>]/.test(head.subarray(0, n).toString("utf8").replace(/^\uFEFF/, ""))
  // A GeoJSON by its name and its first character (a JSON object): building
  // footprints, parsed when a tile asks for them.
  const geojson = !tiff && !vrt && /\.geojson$/i.test(real) && /^\s*\{/.test(head.subarray(0, n).toString("utf8").replace(/^\uFEFF/, ""))
  if (geojson && st.size > GEOJSON_MAX_BYTES) throw refuse(413, `${what}: ${path.basename(real)} is over 100 MB`)
  if (!tiff && !vrt && !geojson) throw refuse(400, `${what}: ${path.basename(real)} is neither a TIFF, a VRT nor a GeoJSON`)
  return { real, st, type: tiff ? "tiff" : vrt ? "vrt" : "geojson" }
}

const stamp = (st) => `${st.size}:${Math.round(st.mtimeMs)}`
const unescapeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")

/** The sources a registered VRT names: each local one checked and named
 *  <n>.tif; remote ones (https, /vsicurl/) left to the reader. */
function vrtSources(real) {
  const xml = fs.readFileSync(real, "utf8")
  const files = {}
  let i = 0
  const re = /<SourceFilename([^>]*)>([^<]*)<\/SourceFilename>/g
  for (let m; (m = re.exec(xml));) {
    const raw = unescapeXml(m[2].trim())
    if (/^(\/vsicurl\/)?https?:\/\//i.test(raw)) continue
    const rel = /relativeToVRT\s*=\s*"1"/.test(m[1])
    const c = checked(rel ? path.resolve(path.dirname(real), raw) : raw, `the VRT's source ${raw}`)
    if (c.type !== "tiff") throw refuse(400, `the VRT's source ${raw} is not a GeoTIFF (a VRT in a VRT is not read)`)
    if (!Object.values(files).some((f) => f.path === c.real)) files[`${i++}.tif`] = { path: c.real, stamp: stamp(c.st), raw }
  }
  return files
}

/**
 * Registers a local file (the rules above): `{ id, source, name, type }`.
 * Throws an error with `status` when refused.
 */
export function registerFile(given) {
  if (!enabled()) throw refuse(403, "local files are turned off on this service (TV_LOCAL_FILES=off)")
  const { real, st, type } = checked(given)
  const files = type === "tiff" ? { "0.tif": { path: real, stamp: stamp(st) } } : type === "geojson" ? { "0.geojson": { path: real, stamp: stamp(st) } } : vrtSources(real)
  if (type === "vrt" && !Object.keys(files).length && !/https?:\/\//i.test(fs.readFileSync(real, "utf8"))) throw refuse(400, "the VRT names no source file")
  const id = createHmac("sha256", secret()).update(`${real}\n${stamp(st)}\n${Object.values(files).map((f) => f.stamp).join(",")}`).digest("hex").slice(0, 32)
  const data = load()
  save({ ...data, files: { ...(data.files || {}), [id]: { path: real, stamp: stamp(st), type, name: path.basename(real), files, at: new Date().toISOString() } } })
  return { id, source: `file:${id}`, name: path.basename(real), type }
}

/** Forgets a registered file; true when it was registered. */
export function unregisterFile(id) {
  const data = load()
  if (!ID_RE.test(id) || !data.files?.[id]) return false
  const files = { ...data.files }
  delete files[id]
  save({ ...data, files })
  return true
}

/** A registered entry, null when unknown or when its file changed since. */
export function lookupFile(id) {
  if (!ID_RE.test(String(id))) return null
  const e = load().files?.[id]
  if (!e) return null
  try { if (stamp(fs.statSync(e.path)) !== e.stamp) return null } catch { return null }
  return e
}

/** The terrain source entry of `file:<id>` (dem.mjs), or null. */
export function fileSourceEntry(source) {
  const m = SOURCE_RE.exec(String(source ?? ""))
  const e = m && lookupFile(m[1])
  if (!e || e.type === "geojson") return null // footprints, not elevation
  return { id: source, name: e.name, type: "vrt", url: `${SCHEME}${m[1]}/source.vrt`, local: true }
}

const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" })[c])
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The VRT the reader opens for an entry: a GeoTIFF's one-source VRT from
 *  its header (size, geotransform, EPSG code, no data), or the registered
 *  VRT with its local sources re-pointed to tvfile:// names. */
export async function vrtOf(id, e) {
  if (e.type === "vrt") {
    let xml = fs.readFileSync(e.path, "utf8")
    for (const [name, f] of Object.entries(e.files)) {
      xml = xml.replace(new RegExp(`<SourceFilename([^>]*)>\\s*${reEsc(esc(f.raw)).replace(/&amp;/g, "&(?:amp;)?")}\\s*</SourceFilename>`, "g"),
        `<SourceFilename relativeToVRT="0">${SCHEME}${id}/${name}</SourceFilename>`)
    }
    return xml
  }
  const { fromFile } = await import("geotiff")
  const tiff = await fromFile(e.path)
  try {
    const img = await tiff.getImage(0)
    const w = img.getWidth(), h = img.getHeight()
    const keys = img.getGeoKeys() || {}
    const fd = img.getFileDirectory()
    if (fd.ModelTransformation && !fd.ModelTiepoint) throw refuse(422, `${e.name}: a rotated GeoTIFF (ModelTransformation) is not read`)
    let [ox, oy] = img.getOrigin()
    const [rx, ry] = img.getResolution()
    if (keys.GTRasterTypeGeoKey === 2) { ox -= rx / 2; oy -= ry / 2 } // PixelIsPoint
    const code = keys.ProjectedCSTypeGeoKey && keys.ProjectedCSTypeGeoKey !== 32767 ? keys.ProjectedCSTypeGeoKey
      : keys.GeographicTypeGeoKey && keys.GeographicTypeGeoKey !== 32767 ? keys.GeographicTypeGeoKey : null
    if (!code) throw refuse(422, `${e.name}: its CRS has no EPSG code (a user-defined CRS): save it with one, or use the Python backend`)
    const nodata = img.getGDALNoData()
    return `<VRTDataset rasterXSize="${w}" rasterYSize="${h}"><SRS>EPSG:${code}</SRS>` +
      `<GeoTransform>${ox}, ${rx}, 0, ${oy}, 0, ${ry}</GeoTransform><VRTRasterBand dataType="Float32" band="1">` +
      (nodata !== null && nodata !== undefined && Number.isFinite(Number(nodata)) ? `<NoDataValue>${Number(nodata)}</NoDataValue>` : "") +
      `<SimpleSource><SourceFilename relativeToVRT="0">${SCHEME}${id}/0.tif</SourceFilename><SourceBand>1</SourceBand>` +
      `<SrcRect xOff="0" yOff="0" xSize="${w}" ySize="${h}"/><DstRect xOff="0" yOff="0" xSize="${w}" ySize="${h}"/></SimpleSource>` +
      `</VRTRasterBand></VRTDataset>`
  } finally {
    tiff.close?.()
  }
}

/** A tvfile://<id>/<name> read as fetch() answers: the VRT, or a file's
 *  bytes (one Range at a time, 206). */
async function fileResponse(url, init = {}) {
  const m = /^tvfile:\/\/([0-9a-f]{32})\/([0-9a-z.]+)$/.exec(url)
  const e = m && lookupFile(m[1])
  if (!e) return new Response("not registered, or changed since: register it again", { status: 404 })
  if (m[2] === "source.vrt") {
    try { return new Response(await vrtOf(m[1], e), { status: 200, headers: { "content-type": "application/xml" } }) } catch (err) {
      return new Response(err.message, { status: err.status || 500 })
    }
  }
  const f = e.files[m[2]]
  if (!f) return new Response("no such file", { status: 404 })
  const st = fs.statSync(f.path)
  if (stamp(st) !== f.stamp) return new Response("changed since it was registered", { status: 404 })
  const headers = new Headers(init.headers || (init instanceof Request ? init.headers : undefined))
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(headers.get("range") || "").trim())
  let start = 0, end = st.size - 1, status = 200
  if (range) {
    if (range[1] === "") start = Math.max(0, st.size - Number(range[2]))
    else { start = Number(range[1]); if (range[2] !== "") end = Math.min(st.size - 1, Number(range[2])) }
    if (start > end || start >= st.size) return new Response("", { status: 416, headers: { "content-range": `bytes */${st.size}` } })
    status = 206
  }
  const buf = Buffer.alloc(end - start + 1)
  const fd = await fs.promises.open(f.path, "r")
  try { await fd.read(buf, 0, buf.length, start) } finally { await fd.close() }
  return new Response(buf, { status, headers: { "content-type": "image/tiff", "accept-ranges": "bytes", "content-length": String(buf.length),
    ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${st.size}` } : {}) } })
}

let installed = false
/** Makes fetch() answer tvfile:// addresses (once per thread). */
export function installFileFetch() {
  if (installed) return
  installed = true
  const base = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url
    if (typeof url === "string" && url.startsWith(SCHEME)) return fileResponse(url, init ?? (input instanceof Request ? input : {}))
    return base(input, init)
  }
}

const isLoopback = (a) => /^(127\.|::1$|::ffff:127\.)/.test(String(a ?? ""))

async function body(req, limit = 65536) {
  const chunks = []
  let n = 0
  for await (const c of req) { n += c.length; if (n > limit) throw refuse(413, "body too large"); chunks.push(c) }
  return Buffer.concat(chunks).toString("utf8")
}

/** The /files endpoints (POST, DELETE). Returns true when it answered. */
export async function handleFiles(req, res, url) {
  if (url.pathname !== "/files" && !url.pathname.startsWith("/files/")) return false
  const send = (status, type, data) => { if (!res.headersSent) { res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(data) } }
  try {
    if (!isLoopback(req.socket.remoteAddress)) throw refuse(403, "files are registered from this machine only")
    if (req.headers.origin) throw refuse(403, "files are not registered from a web page")
    if (url.pathname === "/files") {
      if (req.method !== "POST") throw refuse(405, "POST {\"path\": \"<absolute path>\"} registers a file")
      if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) throw refuse(415, "send JSON: {\"path\": \"<absolute path>\"}")
      let parsed
      try { parsed = JSON.parse(await body(req)) } catch (e) { throw e.status ? e : refuse(400, "not JSON") }
      return send(200, "application/json", JSON.stringify(registerFile(parsed?.path))), true
    }
    const m = url.pathname.match(/^\/files\/([0-9a-f]{32})$/)
    if (!m || req.method !== "DELETE") throw refuse(404, "DELETE /files/<id> forgets a file; nothing else is served here")
    return send(unregisterFile(m[1]) ? 204 : 404, "text/plain", ""), true
  } catch (e) {
    send(e.status || 500, "application/json", JSON.stringify({ error: e.message }))
    return true
  }
}
