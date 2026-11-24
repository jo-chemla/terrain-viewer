// NASA G-LiHT's KMZ elevation pictures, read in place and warped onto Web
// Mercator tiles: the reader behind the `gliht://` protocol
// (lib/gliht-protocol.ts). No DOM, no canvas: fetch and the PNG decoder are
// passed in, so the same code runs in the browser and under node --test
// (lib/gliht-kmz.test.ts).
//
// What a G-LiHT DTM KMZ is (docs/content/docs/dev/g-liht.mdx, measured
// 2026-11-24): a zip of a GDAL KMLSUPEROVERLAY pyramid. `doc.kml` links
// `0/0/0.kml`; every `L/x/y.kml` holds one GroundOverlay (its `L/x/y.png`
// and a `gx:LatLonQuad`, the raster being UTM and so slightly rotated in
// lon/lat) and NetworkLinks to its four children. The tiles are fixed pixel
// blocks of the UTM raster, counted from its south-west corner; level L has
// 2^L x 2^L of them, the last level is the 1 m raster itself. The PNGs are
// NOT a hillshade: they are the elevation, linearly stretched to 8-bit grey
// (0 at the raster's minimum, 255 near its 99.9th percentile; transparent off
// the swath). The stretch is per KMZ and written nowhere in it, so heights
// come back only with the two numbers measured against the GeoTIFF
// (`dem=lo,hi`); without them the grey is still a faithful picture of the
// relief, up to a scale.
//
// Reading one tile: the zip's central directory once per KMZ (two Range
// requests: the end record, then the directory), the root KML and PNG once,
// then for each output tile only the `L/x/y.png` + `L/x/y.kml` pairs of the
// level that matches its resolution. GDAL writes each tile's PNG and KML next
// to each other in the zip, so a pair, and usually a whole row of neighbours,
// is one Range request.
//
// Campaigns come in two layouts (the webmap's map.js getUrl):
//   one KMZ per campaign   lidar/kml/<c>_DTM.kmz            (Kiuic, most)
//   one KMZ per cell       lidar/kml/dtm/<c>_<cell>_DTM.kmz (AMIGA-Carb and
//                          the "KML folder" campaigns), the cells listed with
//                          their footprints in lidar/kml/tiles/<c>_tiles.kmz

export const GLIHT_ORIGIN = "https://glihtdata.gsfc.nasa.gov"

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>
export type DecodedImage = { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export type PngDecoder = (bytes: Uint8Array) => Promise<DecodedImage>
export type Env = { fetch: Fetcher; decodePng: PngDecoder; signal?: AbortSignal }

/** Where a glihtdata path is fetched from. `base` empty: the host itself
 *  (works only with a CORS-unblocking browser extension, the host sends no
 *  Access-Control-Allow-Origin); a base URL (the tile service's
 *  `<server>/proxy/gliht`): the path is appended; a template with `{url}`
 *  (a generic CORS proxy, `https://corsproxy.example/?url={url}`): the full
 *  glihtdata URL goes in, encoded. */
export function glihtUrl(path: string, base = ""): string {
  const b = base.trim()
  if (!b) return GLIHT_ORIGIN + path
  if (b.includes("{url}")) return b.replace("{url}", encodeURIComponent(GLIHT_ORIGIN + path))
  return b.replace(/\/+$/, "") + path
}

export type Campaign = { id: string; cells: boolean }

export const campaignKmzPath = (c: string) => `/files/G-LiHT/${c}/lidar/kml/${c}_DTM.kmz`
export const cellKmzPath = (c: string, cell: string) => `/files/G-LiHT/${c}/lidar/kml/dtm/${c}_${cell}_DTM.kmz`
export const cellIndexPath = (c: string) => `/files/G-LiHT/${c}/lidar/kml/tiles/${c}_tiles.kmz`

// ─── Zip over HTTP Range ────────────────────────────────────────────────────

type Entry = { name: string; method: number; csize: number; usize: number; offset: number; end: number }
export type Zip = { url: string; size: number; entries: Map<string, Entry> }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

async function rangeGet(env: Env, url: string, range: string): Promise<{ bytes: Uint8Array; total: number; whole: boolean }> {
  const res = await env.fetch(url, { headers: { Range: `bytes=${range}` }, signal: env.signal })
  if (!res.ok) throw new Error(`G-LiHT ${url}: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (res.status === 206) {
    const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")
    return { bytes, total: m ? Number(m[1]) : NaN, whole: false }
  }
  // A server (or proxy) that ignores Range sends the whole file: still usable.
  return { bytes, total: bytes.length, whole: true }
}

/** The end-of-central-directory record is in the last 22 + 65535 bytes. */
const TAIL = 65557

export async function openZip(env: Env, url: string): Promise<Zip> {
  const tail = await rangeGet(env, url, `-${TAIL}`)
  const size = tail.whole ? tail.bytes.length : tail.total
  const t = tail.bytes
  const tailStart = size - t.length
  let eocd = -1
  for (let i = t.length - 22; i >= 0; i--) if (u32(t, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error(`G-LiHT ${url}: not a zip (no end record)`)
  const count = u16(t, eocd + 10)
  const cdSize = u32(t, eocd + 12)
  const cdOffset = u32(t, eocd + 16)
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error(`G-LiHT ${url}: zip64 is not supported`)
  let cd: Uint8Array
  if (tail.whole) cd = t.subarray(cdOffset, cdOffset + cdSize)
  else if (cdOffset >= tailStart) cd = t.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize)
  else cd = (await rangeGet(env, url, `${cdOffset}-${cdOffset + cdSize - 1}`)).bytes
  const list: Entry[] = []
  for (let p = 0; p + 46 <= cd.length && u32(cd, p) === 0x02014b50;) {
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32)
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen))
    list.push({ name, method: u16(cd, p + 10), csize: u32(cd, p + 20), usize: u32(cd, p + 24), offset: u32(cd, p + 42), end: cdOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  // An entry's bytes end where the next one starts: the local header's extra
  // field can differ from the directory's, so its exact length is known only
  // once the header is read.
  const byOffset = [...list].sort((a, b) => a.offset - b.offset)
  for (let i = 0; i < byOffset.length - 1; i++) byOffset[i].end = byOffset[i + 1].offset
  return { url, size, entries: new Map(list.map((e) => [e.name, e])) }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Requests closer than this are merged into one Range: one round trip beats
 *  skipping a few kilobytes. */
const MERGE_GAP = 32 * 1024
const MERGE_MAX = 4 * 1024 * 1024

/** The named entries, uncompressed; absent names are left out. */
export async function readEntries(env: Env, zip: Zip, names: string[]): Promise<Map<string, Uint8Array>> {
  const wanted = names.map((n) => zip.entries.get(n)).filter((e): e is Entry => !!e).sort((a, b) => a.offset - b.offset)
  const groups: Entry[][] = []
  for (const e of wanted) {
    const g = groups[groups.length - 1]
    if (g && e.offset - g[g.length - 1].end <= MERGE_GAP && e.end - g[0].offset <= MERGE_MAX) g.push(e)
    else groups.push([e])
  }
  const out = new Map<string, Uint8Array>()
  await Promise.all(groups.map(async (g) => {
    const start = g[0].offset, end = g[g.length - 1].end
    const { bytes, whole } = await rangeGet(env, zip.url, `${start}-${end - 1}`)
    const base = whole ? 0 : start
    for (const e of g) {
      const o = e.offset - base
      if (u32(bytes, o) !== 0x04034b50) throw new Error(`G-LiHT ${zip.url}: bad local header for ${e.name}`)
      const data = bytes.subarray(o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28)).subarray(0, e.csize)
      out.set(e.name, e.method === 0 ? data : e.method === 8 ? await inflateRaw(data) : (() => { throw new Error(`G-LiHT: zip method ${e.method}`) })())
    }
  }))
  return out
}

// ─── KML ────────────────────────────────────────────────────────────────────

/** Four corners, lon/lat, counter-clockwise from the lower left: the order of
 *  gx:LatLonQuad, and of the image's corners (lower left, lower right, upper
 *  right, upper left). */
export type Quad = [[number, number], [number, number], [number, number], [number, number]]
export type Box = { n: number; s: number; e: number; w: number }
export type Overlay = { href: string; quad: Quad }
export type KmlDoc = { overlays: Overlay[]; links: { href: string; box?: Box }[] }

const block = (tag: string) => new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g")
const first = (xml: string, tag: string) => new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(xml)?.[1]?.trim()
const num = (xml: string, tag: string) => { const v = first(xml, tag); return v === undefined ? NaN : Number(v) }
const boxOf = (xml: string): Box | undefined => {
  const b = { n: num(xml, "north"), s: num(xml, "south"), e: num(xml, "east"), w: num(xml, "west") }
  return Object.values(b).every(Number.isFinite) ? b : undefined
}

export function parseKml(xml: string): KmlDoc {
  const overlays: Overlay[] = []
  for (const [, go] of xml.matchAll(block("GroundOverlay"))) {
    const href = first(first(go, "Icon") ?? go, "href")
    if (!href) continue
    const coords = first(first(go, "LatLonQuad") ?? "", "coordinates")
    if (coords) {
      const pts = coords.split(/\s+/).filter(Boolean).map((t) => t.split(",").map(Number) as [number, number])
      if (pts.length >= 4) { overlays.push({ href, quad: [pts[0], pts[1], pts[2], pts[3]].map(([x, y]) => [x, y]) as Quad }); continue }
    }
    const llb = first(go, "LatLonBox")
    const b = llb ? boxOf(llb) : undefined
    if (!b) continue
    // LatLonBox rotation: degrees anticlockwise about the box centre.
    const rot = ((llb && num(llb, "rotation")) || 0) * Math.PI / 180
    const cx = (b.e + b.w) / 2, cy = (b.n + b.s) / 2, k = Math.cos(cy * Math.PI / 180)
    const turn = ([x, y]: [number, number]): [number, number] => {
      const dx = (x - cx) * k, dy = y - cy
      return [cx + (dx * Math.cos(rot) - dy * Math.sin(rot)) / k, cy + dx * Math.sin(rot) + dy * Math.cos(rot)]
    }
    overlays.push({ href, quad: [turn([b.w, b.s]), turn([b.e, b.s]), turn([b.e, b.n]), turn([b.w, b.n])] })
  }
  const links: KmlDoc["links"] = []
  for (const [, nl] of xml.matchAll(block("NetworkLink"))) {
    const href = first(first(nl, "Link") ?? first(nl, "Url") ?? "", "href")
    if (!href) continue
    const lab = first(first(nl, "Region") ?? "", "LatLonAltBox")
    links.push({ href, box: lab ? boxOf(lab) : undefined })
  }
  return { overlays, links }
}

/** Cell footprints of a `<campaign>_tiles.kmz`: one Placemark per cell. */
export function parseCellIndex(xml: string): { name: string; box: Box }[] {
  const out: { name: string; box: Box }[] = []
  for (const [, pm] of xml.matchAll(block("Placemark"))) {
    const name = first(pm, "name")
    const ring = first(first(pm, "Polygon") ?? "", "coordinates")
    if (!name || !ring) continue
    const pts = ring.split(/\s+/).filter(Boolean).map((t) => t.split(",").map(Number))
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    out.push({ name, box: { w: Math.min(...xs), e: Math.max(...xs), s: Math.min(...ys), n: Math.max(...ys) } })
  }
  return out
}

const quadBox = (q: Quad): Box => ({ w: Math.min(...q.map((p) => p[0])), e: Math.max(...q.map((p) => p[0])), s: Math.min(...q.map((p) => p[1])), n: Math.max(...q.map((p) => p[1])) })
const meets = (a: Box, b: Box) => a.w < b.e && b.w < a.e && a.s < b.n && b.s < a.n

/** (u, v) in the quad, u along the bottom edge, v up the left one, by Newton
 *  on the bilinear map (exact for a parallelogram after one step). */
export function quadUv(q: Quad, x: number, y: number): [number, number] {
  const [A, B, C, D] = q
  let u = 0.5, v = 0.5
  for (let i = 0; i < 6; i++) {
    const px = (1 - u) * (1 - v) * A[0] + u * (1 - v) * B[0] + u * v * C[0] + (1 - u) * v * D[0] - x
    const py = (1 - u) * (1 - v) * A[1] + u * (1 - v) * B[1] + u * v * C[1] + (1 - u) * v * D[1] - y
    const ux = (1 - v) * (B[0] - A[0]) + v * (C[0] - D[0]), uy = (1 - v) * (B[1] - A[1]) + v * (C[1] - D[1])
    const vx = (1 - u) * (D[0] - A[0]) + u * (C[0] - B[0]), vy = (1 - u) * (D[1] - A[1]) + u * (C[1] - B[1])
    const det = ux * vy - uy * vx
    if (!det) break
    const du = (px * vy - py * vx) / det, dv = (ux * py - uy * px) / det
    u -= du; v -= dv
    if (Math.abs(du) < 1e-10 && Math.abs(dv) < 1e-10) break
  }
  return [u, v]
}

// ─── One KMZ: the pyramid ───────────────────────────────────────────────────

export type Pyramid = {
  zip: Zip
  /** GDAL layout: L/x/y.png + L/x/y.kml. Otherwise `flat` holds every
   *  GroundOverlay of doc.kml, drawn as they are. */
  maxLevel: number
  tileW: number
  tileH: number
  root: Quad
  box: Box
  flat?: Overlay[]
}

export async function openPyramid(env: Env, url: string): Promise<Pyramid> {
  const zip = await openZip(env, url)
  if (zip.entries.has("0/0/0.kml") && zip.entries.has("0/0/0.png")) {
    const got = await readEntries(env, zip, ["0/0/0.kml", "0/0/0.png"])
    const root = parseKml(new TextDecoder().decode(got.get("0/0/0.kml")!)).overlays[0]
    const png = got.get("0/0/0.png")!
    if (!root || u32(png, 12) !== 0x52444849) throw new Error(`G-LiHT ${url}: no root overlay`)
    // IHDR: width and height, big-endian, at bytes 16 and 20.
    const be = (o: number) => ((png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3]) >>> 0
    let maxLevel = 0
    for (const n of zip.entries.keys()) { const m = /^(\d+)\/\d+\/\d+\.png$/.exec(n); if (m) maxLevel = Math.max(maxLevel, Number(m[1])) }
    return { zip, maxLevel, tileW: be(16), tileH: be(20), root: root.quad, box: quadBox(root.quad) }
  }
  const doc = await readEntries(env, zip, ["doc.kml"])
  const flat = parseKml(new TextDecoder().decode(doc.get("doc.kml") ?? new Uint8Array())).overlays
  if (!flat.length) throw new Error(`G-LiHT ${url}: neither a GDAL super-overlay nor GroundOverlays in doc.kml`)
  const all = flat.flatMap((o) => o.quad)
  const box = quadBox(all as unknown as Quad)
  return { zip, maxLevel: 0, tileW: 0, tileH: 0, root: flat[0].quad, box, flat }
}

/** The level whose pixels are no larger than the output's (the finest the
 *  KMZ has when the output is finer still). */
export function levelFor(p: Pyramid, outPixDeg: number): number {
  const latSpan = p.box.n - p.box.s
  const L = Math.ceil(Math.log2(latSpan / (p.tileH * outPixDeg)) - 1e-9)
  return Math.max(0, Math.min(p.maxLevel, L))
}

/** The tiles of level L that can touch `box`: the box's corners mapped into
 *  the root quad give a range of tile columns and rows, widened by one for
 *  the tiles' own rounding. */
export function tilesFor(p: Pyramid, L: number, box: Box): [number, number][] {
  const n = 2 ** L
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (const [x, y] of [[box.w, box.s], [box.e, box.s], [box.e, box.n], [box.w, box.n], [(box.w + box.e) / 2, box.s], [(box.w + box.e) / 2, box.n], [box.w, (box.s + box.n) / 2], [box.e, (box.s + box.n) / 2]]) {
    const [u, v] = quadUv(p.root, x, y)
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
  }
  const out: [number, number][] = []
  const x0 = Math.max(0, Math.floor(u0 * n) - 1), x1 = Math.min(n - 1, Math.floor(u1 * n) + 1)
  const y0 = Math.max(0, Math.floor(v0 * n) - 1), y1 = Math.min(n - 1, Math.floor(v1 * n) + 1)
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (p.zip.entries.has(`${L}/${x}/${y}.png`)) out.push([x, y])
  return out
}

// ─── Web Mercator tiles ─────────────────────────────────────────────────────

export function tileBox(z: number, x: number, y: number): Box {
  const n = 2 ** z
  const lat = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * t / n))) * 180 / Math.PI
  return { w: x / n * 360 - 180, e: (x + 1) / n * 360 - 180, n: lat(y), s: lat(y + 1) }
}

type Placed = { quad: Quad; box: Box; img: DecodedImage }

/** Samples the placed images into a grey grid over `box` (Web Mercator rows),
 *  NaN where none covers. Bilinear inside an image, nearest at its swath edge
 *  (a transparent neighbour would otherwise darken the border). */
export function warp(placed: Placed[], box: Box, size: number): Float32Array {
  const out = new Float32Array(size * size).fill(NaN)
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
  const m0 = merc(box.n), m1 = merc(box.s)
  const lats = Array.from({ length: size }, (_, j) => Math.atan(Math.sinh(m0 + (j + 0.5) / size * (m1 - m0))) * 180 / Math.PI)
  for (const { quad, box: qb, img } of placed) {
    const { width: w, height: h, data } = img
    const grey = (i: number, j: number) => data[(j * w + i) * 4]
    const alpha = (i: number, j: number) => data[(j * w + i) * 4 + 3]
    // Half a source pixel of slack at the image's edge closes the seam
    // between neighbouring tiles.
    const su = 0.5 / w, sv = 0.5 / h
    for (let j = 0; j < size; j++) {
      const lat = lats[j]
      if (lat < qb.s - 1e-7 || lat > qb.n + 1e-7) continue
      for (let i = 0; i < size; i++) {
        const k = j * size + i
        if (!Number.isNaN(out[k])) continue
        const lon = box.w + (i + 0.5) / size * (box.e - box.w)
        if (lon < qb.w - 1e-7 || lon > qb.e + 1e-7) continue
        const [u, v] = quadUv(quad, lon, lat)
        if (u < -su || u > 1 + su || v < -sv || v > 1 + sv) continue
        const fx = Math.min(w - 1, Math.max(0, u * w - 0.5)), fy = Math.min(h - 1, Math.max(0, (1 - v) * h - 0.5))
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
        const ax = fx - x0, ay = fy - y0
        if (alpha(x0, y0) && alpha(x1, y0) && alpha(x0, y1) && alpha(x1, y1)) {
          out[k] = (grey(x0, y0) * (1 - ax) + grey(x1, y0) * ax) * (1 - ay) + (grey(x0, y1) * (1 - ax) + grey(x1, y1) * ax) * ay
        } else {
          const nx = Math.round(fx), ny = Math.round(fy)
          if (alpha(nx, ny)) out[k] = grey(nx, ny)
        }
      }
    }
  }
  return out
}

// ─── Caches and the tile read ───────────────────────────────────────────────

class Lru<V> {
  private m = new Map<string, V>()
  constructor(private max: number) {}
  get(k: string) { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v) } return v }
  set(k: string, v: V) { this.m.delete(k); this.m.set(k, v); if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!) }
  delete(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
const pyramids = new Lru<Promise<Pyramid | null>>(256)
const cellLists = new Lru<Promise<{ name: string; box: Box }[]>>(64)
const tilesCache = new Lru<Promise<Placed | null>>(512)

export function clearGlihtCaches() { pyramids.clear(); cellLists.clear(); tilesCache.clear() }

/** A cache entry that failed is dropped, so the next tile tries again (an
 *  aborted request, a proxy not running yet). A KMZ that answers 404 stays
 *  null: a cell listed in the index without a KMZ. */
function cached<V>(lru: Lru<Promise<V>>, key: string, make: () => Promise<V>): Promise<V> {
  const hit = lru.get(key)
  if (hit) return hit
  const p = make().catch((e) => { lru.delete(key); throw e })
  lru.set(key, p)
  return p
}

// Cached reads run detached from the tile that started them (a neighbour
// shares the result): its abort must not cancel them.
const detached = (env: Env): Env => ({ ...env, signal: undefined })

function pyramid(env: Env, url: string) {
  return cached(pyramids, url, () => openPyramid(detached(env), url).catch((e) => {
    if (/HTTP 404/.test(String(e))) return null
    throw e
  }))
}

function cellList(env: Env, campaign: string, base: string) {
  const url = glihtUrl(cellIndexPath(campaign), base)
  return cached(cellLists, url, async () => {
    const zip = await openZip(detached(env), url)
    const kml = [...zip.entries.keys()].find((n) => n.endsWith(".kml"))
    if (!kml) return []
    const got = await readEntries(detached(env), zip, [kml])
    return parseCellIndex(new TextDecoder().decode(got.get(kml)!))
  })
}

/** The KMZs of a campaign that can touch `box`. */
async function kmzsFor(env: Env, c: Campaign, base: string, box: Box): Promise<string[]> {
  if (!c.cells) return [glihtUrl(campaignKmzPath(c.id), base)]
  const cells = await cellList(env, c.id, base)
  return cells.filter((cell) => meets(cell.box, box)).map((cell) => glihtUrl(cellKmzPath(c.id, cell.name), base))
}

/** Tiles of one level for one output tile: about 4 to 20 when the level
 *  matches the resolution. Past this the request is a mistake (a level
 *  chosen on a degenerate box): refuse rather than download a pyramid. */
const MAX_TILES_PER_KMZ = 64

/** The grey of one Web Mercator tile (NaN off the data), or null when no KMZ
 *  of the campaign touches it. */
export async function readGreyTile(env: Env, c: Campaign, base: string, z: number, x: number, y: number, size = 256): Promise<Float32Array | null> {
  const box = tileBox(z, x, y)
  const outPixDeg = (box.n - box.s) / size
  const placed: Placed[] = []
  for (const url of await kmzsFor(env, c, base, box)) {
    const p = await pyramid(env, url)
    if (!p || !meets(p.box, box)) continue
    if (p.flat) {
      // Flat KMZs: few, large overlays.
      for (const o of p.flat) {
        const key = `${url}#${o.href}`
        const t = await cached(tilesCache, key, async () => {
          const got = await readEntries(detached(env), p.zip, [o.href])
          const bytes = got.get(o.href)
          return bytes ? { quad: o.quad, box: quadBox(o.quad), img: await env.decodePng(bytes) } : null
        })
        if (t && meets(t.box, box)) placed.push(t)
      }
      continue
    }
    const L = levelFor(p, outPixDeg)
    const tiles = tilesFor(p, L, box)
    if (tiles.length > MAX_TILES_PER_KMZ) throw new Error(`G-LiHT: ${tiles.length} tiles of level ${L} for one tile`)
    // Not cached yet: read in one batch, so neighbours in the zip share a Range.
    const missing = tiles.filter(([tx, ty]) => !tilesCache.get(`${url}#${L}/${tx}/${ty}`))
    if (missing.length) {
      const batch = readEntries(detached(env), p.zip, missing.flatMap(([tx, ty]) => [`${L}/${tx}/${ty}.png`, `${L}/${tx}/${ty}.kml`]))
      for (const [tx, ty] of missing) {
        const name = `${L}/${tx}/${ty}`
        cached(tilesCache, `${url}#${name}`, async () => {
          const got = await batch
          const kml = got.get(`${name}.kml`), png = got.get(`${name}.png`)
          const o = kml && parseKml(new TextDecoder().decode(kml)).overlays[0]
          if (!o || !png) return null
          return { quad: o.quad, box: quadBox(o.quad), img: await env.decodePng(png) }
        }).catch(() => {})
      }
    }
    // Each is in the cache now (just registered, or from an earlier tile); a
    // failed read throws here, so MapLibre retries the tile later instead of
    // keeping it blank.
    for (const [tx, ty] of tiles) {
      const t = await tilesCache.get(`${url}#${L}/${tx}/${ty}`)
      if (t && meets(t.box, box)) placed.push(t)
    }
  }
  if (env.signal?.aborted) throw new DOMException("aborted", "AbortError")
  return placed.length ? warp(placed, box, size) : null
}

/** gliht://<campaign>/{z}/{x}/{y}?cells=1&dem=lo,hi */
export type GlihtTileUrl = { campaign: Campaign; z: number; x: number; y: number; dem?: [number, number] }
const URL_RE = /^gliht:\/\/([A-Za-z0-9_.-]+)\/(\d+)\/(\d+)\/(\d+)(?:\.png)?(?:\?(.*))?$/

export function parseGlihtUrl(url: string): GlihtTileUrl | null {
  const m = URL_RE.exec(url)
  if (!m) return null
  const q = new URLSearchParams(m[5] ?? "")
  const dem = q.get("dem")?.split(",").map(Number)
  return {
    campaign: { id: m[1], cells: q.get("cells") === "1" || (!q.has("cells") && m[1].startsWith("AMIGACarb")) },
    z: Number(m[2]), x: Number(m[3]), y: Number(m[4]),
    dem: dem && dem.length === 2 && dem.every(Number.isFinite) && dem[1] > dem[0] ? [dem[0], dem[1]] : undefined,
  }
}

/** The tile template of a campaign. */
export function glihtTemplate(campaign: string, opts: { cells?: boolean; dem?: [number, number] } = {}): string {
  const q = [opts.cells ? "cells=1" : null, opts.dem ? `dem=${opts.dem.join(",")}` : null].filter(Boolean).join("&")
  return `gliht://${campaign}/{z}/{x}/{y}${q ? `?${q}` : ""}`
}

/** Heights from grey: the KMZ's linear stretch, `lo` at 0 and `hi` at 255. */
export const greyToMetres = (g: number, [lo, hi]: [number, number]) => lo + (g / 255) * (hi - lo)
