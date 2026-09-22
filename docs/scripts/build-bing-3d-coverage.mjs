#!/usr/bin/env node
// Builds public/coverage/bing-3d.geojson: where Bing Maps 3D (the `tf=3dv4`
// photogrammetry behind Bing's 3D cities and Flight Simulator) actually has
// mesh, read from the service's OWN availability data rather than from any
// published list.
//
// Bing serves a standard OGC 3D Tiles 1.1 implicit tileset rooted at the `td1`
// manifest: four web-mercator faces, each a QUADTREE with subtreeLevels 7, whose
// `st{face}-{level}-{x}-{reverseY}` subtree binaries are plain `subt` files.
// Their contentAvailability bitstream (Morton order) says exactly which tiles
// carry a GLB. That IS a coverage map, and it needs no API key. The walk
// mirrors packages/tile-server/bing-live.js in Iconem/3d-tiles-converters,
// which streams the same tileset to Cesium.
//
// Two levels of subtrees are read: the 4 roots (levels 0-6, ~4 KB each), then
// every level-7 subtree the roots say exists (469 at the time of writing,
// ~4 KB each), and content tiles at TARGET_LEVEL are emitted. Adjacent tiles
// are merged into rectangles (horizontal strips, then vertical runs of
// identical strips) so the file is a few hundred KB instead of tens of MB.
//
// Measured 2026-09-22: 469 subtrees, 161 276 content tiles at level 13, in 6 s.
// Bing's licensing is the user's; this reads only tile-availability metadata.
//
//   node docs/scripts/build-bing-3d-coverage.mjs           # writes public/coverage/bing-3d.geojson
//   node docs/scripts/build-bing-3d-coverage.mjs 12 out.geojson

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const G = "15530"
const HOST = "https://t.ssl.ak.tiles.virtualearth.net/tiles/"
const SUBTREE_LEVELS = 7
const TARGET_LEVEL = Number(process.argv[2] ?? 13)      // ~2.4 km cells at 13
const OUT = resolve(process.argv[3] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../public/coverage/bing-3d.geojson"))

const api = (name) => `${HOST}${name}?g=${G}&cmt=cmpr3d&tf=3dv4&n=z&fallback=none`
async function fetchBin(name, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(api(name))
      if (r.status === 404) return null
      if (r.ok) return new Uint8Array(await r.arrayBuffer())
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 500 * (t + 1)))
  }
  return null
}

// `subt` file: magic(4) version(4) jsonByteLength(8) binaryByteLength(8), JSON, pad to 8, binary.
function parseSubtree(buf) {
  if (!buf || String.fromCharCode(...buf.subarray(0, 4)) !== "subt") return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const jl = Number(dv.getBigUint64(8, true))
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(24, 24 + jl)))
  const bin = buf.subarray(24 + jl + ((8 - (jl % 8)) % 8))
  const views = json.bufferViews ?? []
  const view = (i) => (i == null ? null : bin.subarray(views[i].byteOffset, views[i].byteOffset + views[i].byteLength))
  const avail = (a) => ({ bits: view(a?.bitstream), constant: a?.constant ?? 0 })
  return {
    content: avail(json.contentAvailability?.[0]),
    child: avail(json.childSubtreeAvailability),
  }
}
const bit = (a, i) => (a.bits ? (a.bits[i >> 3] >> (i & 7)) & 1 : a.constant ? 1 : 0)
function morton2(x, y) { let m = 0; for (let i = 0; i < 16; i++) m |= ((x >> i) & 1) << (2 * i) | ((y >> i) & 1) << (2 * i + 1); return m }
const reverseY = (level, y) => 2 ** level - 1 - y
const merc = (lat) => Math.asinh(Math.tan(lat))
const invMerc = (m) => Math.atan(Math.sinh(m))
const deg = (r) => Math.round((r * 180) / Math.PI * 1e5) / 1e5

// Lon is linear across a face; lat is web-mercator (MICROSOFT_webmercator_subdivision). y counts from the south.
function tileBox(face, level, x, y) {
  const [fW, fS, fE, fN] = face.region
  const n = 2 ** level
  const mB = merc(fS), mT = merc(fN)
  return {
    w: deg(fW + (fE - fW) * (x / n)), e: deg(fW + (fE - fW) * ((x + 1) / n)),
    s: deg(invMerc(mB + (mT - mB) * (y / n))), n: deg(invMerc(mB + (mT - mB) * ((y + 1) / n))),
  }
}

// ── manifest ─────────────────────────────────────────────────────────────────
const tdRaw = await fetchBin("td1")
if (!tdRaw) throw new Error("td1 manifest unreachable")
const td = JSON.parse(new TextDecoder("utf-8").decode(tdRaw).replace(/^﻿/, ""))
const faces = td.root.children.map((c) => ({ face: Number(/mtx(\d+)-/.exec(c.content.uri)[1]), region: c.boundingVolume.region }))

// ── roots → which level-7 subtrees exist ─────────────────────────────────────
const jobs = []
for (const face of faces) {
  const st = parseSubtree(await fetchBin(`st${face.face}-0-0-0`))
  if (!st) continue
  const n = 2 ** SUBTREE_LEVELS
  for (let ly = 0; ly < n; ly++) for (let lx = 0; lx < n; lx++) if (bit(st.child, morton2(lx, ly))) jobs.push({ face, sx: lx, sy: ly })
}
console.log(`level-${SUBTREE_LEVELS} subtrees: ${jobs.length}`)

// ── level-7 subtrees → content tiles at TARGET_LEVEL ─────────────────────────
const d = TARGET_LEVEL - SUBTREE_LEVELS
const baseIdx = (4 ** d - 1) / 3
const span = 2 ** d
const tiles = []   // { face, x, y }
let done = 0
const t0 = Date.now()
const worker = async () => {
  for (;;) {
    const job = jobs.shift()
    if (!job) return
    const st = parseSubtree(await fetchBin(`st${job.face.face}-${SUBTREE_LEVELS}-${job.sx}-${reverseY(SUBTREE_LEVELS, job.sy)}`))
    if (st) for (let ly = 0; ly < span; ly++) for (let lx = 0; lx < span; lx++) {
      if (bit(st.content, baseIdx + morton2(lx, ly))) tiles.push({ face: job.face, x: job.sx * span + lx, y: job.sy * span + ly })
    }
    if (++done % 100 === 0) console.log(`  ${done} subtrees…`)
  }
}
await Promise.all(Array.from({ length: 12 }, worker))
console.log(`content tiles at level ${TARGET_LEVEL}: ${tiles.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)

// ── dissolve: horizontal strips, then vertical runs of identical strips ───────
const rows = new Map()
for (const t of tiles) {
  const k = `${t.face.face}:${t.y}`
  if (!rows.has(k)) rows.set(k, { face: t.face, y: t.y, xs: [] })
  rows.get(k).xs.push(t.x)
}
const strips = []   // { face, y, x0, x1 }
for (const row of rows.values()) {
  row.xs.sort((a, b) => a - b)
  let cur = null
  for (const x of row.xs) {
    if (cur && x === cur.x1 + 1) cur.x1 = x
    else { if (cur) strips.push(cur); cur = { face: row.face, y: row.y, x0: x, x1: x } }
  }
  if (cur) strips.push(cur)
}
const bySpan = new Map()
for (const s of strips) {
  const k = `${s.face.face}:${s.x0}-${s.x1}`
  if (!bySpan.has(k)) bySpan.set(k, { face: s.face, x0: s.x0, x1: s.x1, ys: [] })
  bySpan.get(k).ys.push(s.y)
}
const rects = []
for (const g of bySpan.values()) {
  g.ys.sort((a, b) => a - b)
  let cur = null
  for (const y of g.ys) {
    if (cur && y === cur.y1 + 1) cur.y1 = y
    else { if (cur) rects.push(cur); cur = { face: g.face, x0: g.x0, x1: g.x1, y0: y, y1: y } }
  }
  if (cur) rects.push(cur)
}
const features = rects.map((r) => {
  const a = tileBox(r.face, TARGET_LEVEL, r.x0, r.y0), b = tileBox(r.face, TARGET_LEVEL, r.x1, r.y1)
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[a.w, a.s], [b.e, a.s], [b.e, b.n], [a.w, b.n], [a.w, a.s]]] } }
})
await mkdir(dirname(OUT), { recursive: true })
const body = JSON.stringify({ type: "FeatureCollection", features })
await writeFile(OUT, body)
console.log(`tiles ${tiles.length} → strips ${strips.length} → rects ${rects.length}, ${(body.length / 1e6).toFixed(2)} MB → ${OUT}`)
