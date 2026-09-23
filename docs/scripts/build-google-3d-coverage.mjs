#!/usr/bin/env node
// SUPERSEDED as the producer of public/coverage/google-3d.geojson. That file
// now comes from decoding Google's coverage layer outright:
//
//   GOOGLE_KEY=... pnpm google-3d-fetch     # z8, z9 and z10, fetch + decode
//   pnpm google-3d-dissolve                 # union, generalise, re-node
//
// which gives real polygons at ~500 m instead of the ~39 km cells this
// produces. This is kept because it needs NO API key and no decoder: it reads
// the layer through the payload SIZE of Google Earth's own request, and is
// the fallback if the layer id minting ever stops working.
//
// ## Why not the 3D Tiles API
//
// Because it does not know. See docs/scripts/probe-google-3d-detail.mjs: the
// Photorealistic 3D Tiles tree refines to 2 m geometric error over rural Nepal
// exactly as it does over central Paris, everything lives in one dataset id,
// and a global walk would cost millions of requests. The Bing approach - read
// the tileset's own availability - has no counterpart here.
//
// ## What this reads instead
//
// Google Earth requests its coverage layer from
// `www.google.com/maps/vt/proto/bpb=<protobuf>`, which is the same tile
// endpoint as the ordinary `/maps/vt?pb=` raster one but with a different
// request message. Decoded, the payload is:
//
//   1 { 1 { 1: z, 2: x, 3: y }, 25 {} }        tile coordinate
//   2 { 1: 0, 2: "m",              3: <epoch>, 4 { "ndl": "1" } }   base map
//   2 { 1: 2, 2: "ml:xsr:c:<tok>", 3: <epoch>, 4 { "mh":  "1" } }   coverage
//   3 { 2: "en-US", 3: "FR", 5: 3, 12 { 1: 68, 2 { "set": "RoadmapSatellite" } } }
//   4: 1   6 { … client flags … }   23: <4-byte nonce>
//
// Three things make this usable:
//
//  - The `&token=` query parameter is NOT validated. It looked like the
//    anti-abuse checksum that makes these URLs unforgeable; the endpoint
//    answers identically with a wrong token, no token, or token=0.
//  - Only field 1 has to change to move the tile. Everything else is replayed
//    from the captured request byte for byte.
//  - **The response SIZE is the answer**, so the payload never has to be
//    decoded. When the coverage layer is present and empty, the response
//    collapses to a fixed stub - measured 132 bytes at z10, 33 at z12 - and
//    when there is coverage it is thousands of bytes. Counter-intuitively the
//    stub is SMALLER than a base-map-only response for the same tile (Kinshasa
//    z8: 94 bytes with the coverage layer, 2302 without), so the coverage
//    layer suppresses the base map rather than adding to it. That is what
//    makes a size test clean rather than a guess about roads.
//
// Measured z10 transect across the Netherlands and the Ruhr: 16 consecutive
// tiles, 679-4958 bytes, so interiors report data and no flood fill is needed.
// The Sahara returns a flat 132 across a 13-tile transect.
//
// ## Limits, stated plainly
//
//  - Resolution stops at z10, about 39 km at the equator, so the overlay is
//    visibly blockier than Google's own coverage layer and adjacent cities
//    merge. Bing's overlay gets 2.4 km because its subtree bitstream is
//    exact; this is an inference from payload size. See COVERED_BYTES.
//  - The `ml:xsr:c:` layer id is a 149-character opaque token from a captured
//    request. If Google rotates it this script stops working, and the fix is
//    to capture one request from earth.google.com again (network tab, enable
//    "3D buildings where available", copy any bpb= URL).
//  - Nothing here needs an API key, and nothing but tile metadata is read.
//    Google's terms govern what you do with the result.
//
//   node docs/scripts/build-google-3d-coverage.mjs           # -> public/coverage/google-3d.geojson
//   node docs/scripts/build-google-3d-coverage.mjs 9 out.geojson

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const TARGET_ZOOM = Number(process.argv[2] ?? 10)
const OUT = resolve(process.argv[3] ?? resolve(HERE, "../../public/coverage/google-3d.geojson"))
const START_ZOOM = 4          // 256 tiles, enough to prune the oceans cheaply
const CONCURRENCY = 24        // measured 256 req/s here; 48 was no faster
// What the payload size actually measures is HOW MUCH GEOMETRY falls in the
// tile, which is only a proxy for coverage while the polygons are small
// relative to the tile. That holds down to z10 and then stops, and it is worth
// writing down because two different thresholds were tried and both fail.
//
// Calibrated against places Google Earth's own render answers for:
//
//   z10  twelve French cities 1142-4335   nine empty places 132-716
//   z11  covered 170-223   empty 132-179   OVERLAP
//   z12  covered 189-261   empty 132-206   OVERLAP
//   z13  covered 191-254   empty 132-187   gap of 4, i.e. noise
//
// z10 looks separable on that set, and a threshold of 900 does cut the false
// positives by a third - the Morvan (535), Berry (638) and Champagne (716) are
// all empty and all pass at 300. But it then loses London (449), Rome (450),
// Berlin (486) and Vienna (471), which are covered. They are small because
// they sit INSIDE a large polygon: an interior tile has no boundary crossing
// it, so there is almost nothing to encode. Big cities and empty countryside
// are indistinguishable by size, in opposite directions.
//
// So 300 it is: it keeps every city and overstates some countryside, which is
// the better failure for an overlay answering "is there photogrammetry here".
// Finer or more exact needs the geometry itself, and the payload is 7.97
// bits/byte with no standard decompressor touching it. The practical route to
// a sharper map is to rasterise Google's own published coverage layer (a Maps
// JS dataset layer, see the memory note) and vectorise the fill: 64
// screenshots at z6 gives 2.4 km, 256 at z7 gives 1.2 km.
const COVERED_BYTES = () => 300

// ── the captured request ─────────────────────────────────────────────────────
const CAPTURED = "CgsKBggBEAAYAMoBABIVCAASAW0Yv4KF_AIiCAoDbmRsEgExEqkBCAISlQFtbDp4c3I6YzpBRk94UjA1R29FTkRjWDhwMUxtVm5pd09BTjRacXB4d002bEYtYmk2cUp3Tk1hT2N2T3ZlbDlselNWRWREd3VpR0RfU2pCRXphWDdTNnR2bE1Cdzdmd1I1NjZmY1ZjbFBxOExvYU55LVo0QTlJOFJ3NkdJSjdWZ2ZXcmM2V1Axam5tcldJQ3JOUHNQTRi_goX8AiIHCgJtaBIBMRoqEgVlbi1VUxoCRlIoA2IbCEQSFwoDc2V0EhBSb2FkbWFwU2F0ZWxsaXRlIAEyGSgBWAO4AgHYAgHgAgToAgG4AwHQAwHYBQG6AQTpjrQW"
const raw = Buffer.from(CAPTURED.replace(/-/g, "+").replace(/_/g, "/"), "base64")

const varint = (n) => {
  const out = []
  let v = BigInt(n)
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b) } while (v)
  return Buffer.from(out)
}
const tag = (f, w) => varint((f << 3) | w)
const lenField = (f, p) => Buffer.concat([tag(f, 2), varint(p.length), p])

/** Top-level fields of the captured message, so field 1 can be swapped out. */
function splitFields(buf) {
  const parts = []
  let i = 0
  const vi = () => { let v = 0n, s = 0n; for (;;) { const b = buf[i++]; v |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) break; s += 7n } return v }
  while (i < buf.length) {
    const start = i
    const key = Number(vi()), wire = key & 7
    // Deliberately a temporary: `i += Number(vi())` reads i BEFORE vi() has
    // advanced it, which silently truncates every length-delimited field by
    // the size of its own length varint.
    if (wire === 2) { const len = Number(vi()); i += len }
    else if (wire === 0) vi()
    else if (wire === 5) i += 4
    else if (wire === 1) i += 8
    parts.push({ field: key >> 3, bytes: buf.subarray(start, i) })
  }
  return parts
}
const TAIL = splitFields(raw).filter((p) => p.field !== 1).map((p) => p.bytes)

const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_")
function urlFor(z, x, y) {
  const coords = Buffer.concat([
    Buffer.concat([tag(1, 0), varint(z)]),
    Buffer.concat([tag(2, 0), varint(x)]),
    Buffer.concat([tag(3, 0), varint(y)]),
  ])
  const f1 = lenField(1, Buffer.concat([lenField(1, coords), lenField(25, Buffer.alloc(0))]))
  return `https://www.google.com/maps/vt/proto/bpb=${b64url(Buffer.concat([f1, ...TAIL]))}`
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  Referer: "https://earth.google.com/",
}
let requests = 0
async function tileBytes(z, x, y) {
  for (let t = 0; t < 3; t++) {
    requests++
    try {
      const r = await fetch(urlFor(z, x, y), { headers: HEADERS })
      if (r.ok) return (await r.arrayBuffer()).byteLength
      if (r.status === 400) return 0
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 400 * (t + 1)))
  }
  return 0
}

// Sanity check before spending an hour: the rebuilt z1/0/0 request must be
// byte-identical to the captured one.
if (urlFor(1, 0, 0) !== `https://www.google.com/maps/vt/proto/bpb=${CAPTURED}`) {
  throw new Error("request rebuild does not match the captured URL - the template was edited")
}

// ── hierarchical crawl ───────────────────────────────────────────────────────
// A covered tile's parent is always covered too (the parent's geometry
// contains it), so only covered tiles need their four children tested.
async function testAll(tiles) {
  const covered = []
  const queue = [...tiles]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const t = queue.pop()
      if (!t) return
      if (await tileBytes(t[0], t[1], t[2]) >= COVERED_BYTES()) covered.push(t)
    }
  }))
  return covered
}

const t0 = Date.now()
let level = []
for (let x = 0; x < 2 ** START_ZOOM; x++) for (let y = 0; y < 2 ** START_ZOOM; y++) level.push([START_ZOOM, x, y])
for (let z = START_ZOOM; z <= TARGET_ZOOM; z++) {
  const covered = await testAll(level)
  console.log(`  z${z}: ${covered.length} / ${level.length} covered, ${requests} requests, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (z === TARGET_ZOOM) { level = covered; break }
  level = covered.flatMap(([, x, y]) => [
    [z + 1, x * 2, y * 2], [z + 1, x * 2 + 1, y * 2],
    [z + 1, x * 2, y * 2 + 1], [z + 1, x * 2 + 1, y * 2 + 1],
  ])
}
console.log(`${level.length} covered tiles at z${TARGET_ZOOM}, ${requests} requests, ${((Date.now() - t0) / 1000).toFixed(0)} s`)

// ── dissolve ─────────────────────────────────────────────────────────────────
// Boundary tracing, the same as build-bing-3d-coverage.mjs: emit the four unit
// edges of every cell with consistent winding, cancel each edge against its
// twin, chain what survives into closed rings. One ring per contiguous area
// plus its holes, instead of one outline per cell rendering as hatching.
function traceRings(cells) {
  const edges = new Map()
  const key = (a, b) => `${a[0]},${a[1]}|${b[0]},${b[1]}`
  for (const [x, y] of cells) {
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

const n = 2 ** TARGET_ZOOM
const deg = (v) => Math.round(v * 1e5) / 1e5
const cornerToLngLat = ([cx, cy]) => [
  deg((cx / n) * 360 - 180),
  deg((Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / n))) * 180) / Math.PI),
]

const rings = traceRings(level.map(([, x, y]) => [x, y]))
const geo = rings.map((r) => ({ ring: r.map(cornerToLngLat), area: signedArea(r) }))
const sign = Math.sign(geo.reduce((acc, g) => (Math.abs(g.area) > Math.abs(acc.area) ? g : acc), geo[0] ?? { area: 0 }).area) || 1
const outers = geo.filter((g) => Math.sign(g.area) === sign).sort((a, b) => Math.abs(a.area) - Math.abs(b.area))
const holes = geo.filter((g) => Math.sign(g.area) !== sign)
const polys = outers.map((o) => [o.ring])
for (const h of holes) {
  const i = outers.findIndex((o) => pointInRing(h.ring[0], o.ring))
  if (i >= 0) polys[i].push(h.ring)
}
const features = polys.map((coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates } }))

await mkdir(dirname(OUT), { recursive: true })
const body = JSON.stringify({ type: "FeatureCollection", features })
await writeFile(OUT, body)
console.log(`${level.length} cells -> ${rings.length} rings -> ${features.length} polygons, ${(body.length / 1e6).toFixed(2)} MB -> ${OUT}`)
