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

// ── dissolve: a true union, by tracing the boundary of the tile set ──────────
// Merging into rectangles (tried first) is the wrong shape of answer: a greedy
// maximal-rectangle cover only got 161 276 tiles down to 2 827 pieces against
// 2 857 for strips, and either way every piece draws its own outline, so the
// shared internal edges render as dense hatching at low zoom. Tracing the union
// boundary instead drops it to ~407 rings — one outer ring per contiguous area
// plus its holes — and no internal edge exists to be drawn.
//
// The trace: emit the four unit edges of every cell with consistent winding; an
// edge shared by two cells cancels its twin and is dropped; whatever survives is
// the boundary, chained head-to-tail into closed rings.
function traceRings(cells) {
  const edges = new Map()
  const key = (a, b) => `${a[0]},${a[1]}|${b[0]},${b[1]}`
  for (const c of cells) {
    const [x, y] = c
    for (const [a, b] of [[[x, y], [x + 1, y]], [[x + 1, y], [x + 1, y + 1]], [[x + 1, y + 1], [x, y + 1]], [[x, y + 1], [x, y]]]) {
      const twin = key(b, a)
      if (edges.has(twin)) edges.delete(twin)
      else edges.set(key(a, b), [a, b])
    }
  }
  const from = new Map()
  for (const [, [a, b]] of edges) {
    const k = `${a[0]},${a[1]}`
    if (!from.has(k)) from.set(k, [])
    from.get(k).push(b)
  }
  const rings = []
  const live = new Map(edges)
  while (live.size) {
    const [k0, [a0, b0]] = live.entries().next().value
    live.delete(k0)
    const ring = [a0, b0]
    let cur = b0
    while (cur[0] !== a0[0] || cur[1] !== a0[1]) {
      const cands = (from.get(`${cur[0]},${cur[1]}`) ?? []).filter((b) => live.has(key(cur, b)))
      if (!cands.length) break
      const b = cands[0]
      live.delete(key(cur, b))
      ring.push(b)
      cur = b
    }
    rings.push(ring)
  }
  return rings
}
const signedArea = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2 }
function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const byFace = new Map()
for (const t of tiles) {
  if (!byFace.has(t.face.face)) byFace.set(t.face.face, { face: t.face, cells: [] })
  byFace.get(t.face.face).cells.push([t.x, t.y])
}
const features = []
let ringCount = 0
for (const { face, cells } of byFace.values()) {
  const rings = traceRings(cells)
  ringCount += rings.length
  // A cell's corner (cx, cy) in tile space maps to the corner of tile (cx, cy).
  const toLonLat = ([cx, cy]) => { const b = tileBox(face, TARGET_LEVEL, cx, cy); return [b.w, b.n] }
  const geo = rings.map((r) => ({ ring: r.map(toLonLat), area: signedArea(r) }))
  // Outer rings wind one way, holes the other. Each hole goes to the smallest
  // outer ring that contains it.
  const sign = Math.sign(geo.reduce((acc, g) => (Math.abs(g.area) > Math.abs(acc.area) ? g : acc), geo[0] ?? { area: 0 }).area) || 1
  const outers = geo.filter((g) => Math.sign(g.area) === sign).sort((a, b) => Math.abs(a.area) - Math.abs(b.area))
  const holes = geo.filter((g) => Math.sign(g.area) !== sign)
  const polys = outers.map((o) => [o.ring])
  for (const h of holes) {
    const i = outers.findIndex((o) => pointInRing(h.ring[0], o.ring))
    if (i >= 0) polys[i].push(h.ring)
  }
  for (const rings2 of polys) features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: rings2 } })
}

await mkdir(dirname(OUT), { recursive: true })
const body = JSON.stringify({ type: "FeatureCollection", features })
await writeFile(OUT, body)
console.log(`tiles ${tiles.length} → ${ringCount} boundary rings → ${features.length} polygons, ${(body.length / 1e6).toFixed(2)} MB → ${OUT}`)
