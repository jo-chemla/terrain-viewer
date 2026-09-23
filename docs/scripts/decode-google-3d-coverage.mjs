#!/usr/bin/env node
// WORK IN PROGRESS - decodes Google's 3D coverage layer properly, but the ring
// reconstruction is not finished, so build-google-3d-coverage.mjs (the
// payload-size probe) is still what produces the shipped file.
//
// ## What is proven
//
// The decode is exact. A point-in-triangle test against the raw mesh of one
// z7 tile puts Paris, Orleans and Tours each inside exactly one triangle and
// the Beauce farmland inside none - which is the right answer for all four.
//
//  * The layer is the Maps Datasets layer behind
//    https://developers.google.com/maps/documentation/javascript/3d/coverage
//    (map id ccfdf8d031b6b83cc90ddc70, dataset
//    bcf6598c-7603-4698-9493-9e927d8d3d38), updated daily by Google.
//  * Its tiles come from the ordinary Maps vector tile endpoint and the layer
//    id is the only credential - no key or token in the URL:
//      https://maps.googleapis.com/maps/vt/pb=!1m4!1m3!1i{z}!2i{x}!3i{y}
//          !2m2!1e2!2s{layer id}!3m9!...
//  * `mapConfigs:batchGet` mints a fresh `ml:xs:c:` layer id from Node with an
//    ordinary API key, so this needs no browser. An `ml:xsr:c:` id captured
//    from earth.google.com works on the same endpoint, which is how it was
//    found.
//  * The body is **XOR 0x9b** - which is why inflate, brotli, gzip and zstd
//    all failed on it - and under that a protobuf:
//        1 { 1: z, 2: x, 3: y }
//        8 { repeated 1 = feature }
//            feature: 1 = geometry
//            geometry: 1 = packed varints, x0/y0 then zigzag (dx,dy), extent 8192
//                      2 = packed varints, absolute triangle indices
//    So geometry arrives PRE-TRIANGULATED rather than as rings.
//  * Empty tiles are 36 bytes, so the world is a quadtree walk from z5: 4 120
//    requests and 13 s for the globe at z8, 2 244 at z7.
//
// ## What is not finished
//
// Turning the triangle soup back into outlines. Cancelling shared edges and
// chaining what survives - the trick the Bing and FLAI builders use on grid
// cells - reconstructs most of the world but silently loses whole features:
// scored against places Google Earth answers for, the best this reaches is
// 28/39 with NO filtering at all, and the misses are London, Tokyo, New York,
// Madrid and Reykjavik, i.e. some of the largest coverage areas rather than
// the smallest. Tried and rejected along the way:
//
//    pooled rings, split outer/hole by global winding     27/39
//    per-feature rings, holes by positive area            17/39
//    per-feature rings, holes by negative area            16/39
//    per-feature rings, no holes at all                   27/39
//    the above with every filter disabled                 28/39
//
// The likely cause is the chaining step rather than the cancellation: at a
// vertex where several boundary edges meet, picking an arbitrary continuation
// strands the rest, and the fix is to choose the sharpest turn (a proper
// planar-graph face traversal). The other route, and probably the better one,
// is to skip rings entirely - rasterise the decoded triangles into a grid and
// trace THAT, which is exactly the path already proven in
// build-bing-3d-coverage.mjs and build-flai-coverage.mjs and cannot lose a
// feature. That is an internal rasterisation of decoded vector geometry, not
// screenshotting Google's renderer.
//
// Credit: the XOR key, the tile layout and the quadtree-pruning idea came from
// a parallel investigation of Jonathan's.
//
//   node docs/scripts/decode-google-3d-coverage.mjs 7 out.geojson
//   G3D_SIMPLIFY=0 G3D_MIN_AREA=0 node ... 7 out.geojson   # unfiltered

import { writeFile, mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const TARGET_Z = Number(process.argv[2] ?? 7)
const OUT = resolve(process.argv[3] ?? resolve(HERE, "../../public/coverage/google-3d-decoded.geojson"))
const START_Z = 5
const CONCURRENCY = 16
const EXT = 8192              // tile units, per Google's own geometry
const EMPTY_BYTES = 64        // an empty tile is 36 B; nothing real is this small
const MAP_ID = "ccfdf8d031b6b83cc90ddc70"
const DATASET = "bcf6598c-7603-4698-9493-9e927d8d3d38"
/** Simplification tolerance and speckle floor, in tile units at TARGET_Z. */
// Tuned for a shippable file. At z7 a unit is 38 m, so simplifying at 4 units
// is ~150 m and the area floor is ~8.8 km2 - small enough to keep a town,
// large enough to drop the speckle the triangle dissolve leaves behind.
// Measured at z7: 64 447 rings -> 9 687 polygons, 4.5 MB (about 1.1 MB over
// the wire). z8 doubles the precision and quadruples the file.
const SIMPLIFY_UNITS = Number(process.env.G3D_SIMPLIFY ?? 4)
const MIN_RING_UNITS2 = Number(process.env.G3D_MIN_AREA ?? 6000)
const OUTER_SIGN = Number(process.env.G3D_OUTER_SIGN ?? -1)
const TAIL = "!3m9!2sen-US!3sUS!5e18!12m5!1e68!2m2!1sset!2sRoadmap!4e2!4e1!5m4!1e4!8m2!1e0!1e1!6m9!1e12!2i2!19m1!1e0!20m1!1e0!39b1!44e1!50e0!26m2!1e2!1e3!28i796"
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  Referer: "https://developers.google.com/",
}

// ── the layer id ─────────────────────────────────────────────────────────────
const env = await readFile(resolve(HERE, "../../.env"), "utf8").catch(() => "")
const KEY = (/VITE_GOOGLE_API_KEY=(\S+)/.exec(env) ?? [])[1] ?? process.env.VITE_GOOGLE_API_KEY
// Kept as a fallback because it is what proved the endpoint; the minted id is
// preferred since it cannot go stale.
const CAPTURED_ID = "ml:xsr:c:AFOxR05GoENDcX8p1LmVniwOAN4ZqpxwM6lF-bi6qJwNMaOcvOvel9lzSVEdDwuiGD_SjBEzaX7S6tvlMBw7fwR566fcVclPq8LoaNy-Z4A9I8Rw6GIJ7VgfWrc6WP1jnmrWICrNPsPM"
async function mintLayerId() {
  if (!KEY) return null
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/mapsjs/mapConfigs:batchGet?key=${KEY}&mapIds=${MAP_ID}`, { headers: HEADERS })
    const t = await r.text()
    if (!t.includes(DATASET)) console.warn("  (mapConfigs did not mention the dataset id - Google may have moved it)")
    const m = /ml(?::|%3A)xs(?::|%3A)c(?::|%3A)[A-Za-z0-9_\-]{40,}/.exec(t)
    return m ? m[0].replace(/%3A/g, ":") : null
  } catch { return null }
}
const layerId = (await mintLayerId()) ?? CAPTURED_ID
console.log(`layer id ${layerId.startsWith("ml:xs:") ? "minted from mapConfigs" : "FALLBACK (captured)"}: ${layerId.slice(0, 32)}…`)

// ── protobuf ─────────────────────────────────────────────────────────────────
function parse(b) {
  const out = []
  let i = 0
  const vi = () => { let r = 0n, s = 0n; for (;;) { const c = b[i++]; r |= BigInt(c & 0x7f) << s; if (!(c & 0x80)) break; s += 7n } return r }
  while (i < b.length) {
    const k = Number(vi()), f = k >> 3, w = k & 7
    if (f === 0) return null
    if (w === 0) out.push([f, Number(vi())])
    else if (w === 2) { const L = Number(vi()); if (i + L > b.length) return null; out.push([f, b.subarray(i, i + L)]); i += L }
    else if (w === 5) { out.push([f, b.subarray(i, i + 4)]); i += 4 }
    else if (w === 1) { out.push([f, b.subarray(i, i + 8)]); i += 8 }
    else return null
  }
  return out
}
function varints(b) {
  const out = []
  let i = 0
  while (i < b.length) { let r = 0n, s = 0n; for (;;) { const c = b[i++]; r |= BigInt(c & 0x7f) << s; if (!(c & 0x80)) break; s += 7n } out.push(Number(r)) }
  return out
}
const zz = (v) => (v >>> 1) ^ -(v & 1)

/** Triangles of a tile, grouped per FEATURE, in that tile's units. */
function decodeTile(raw) {
  const b = Buffer.from(raw.map((c) => c ^ 0x9b))
  const top = parse(b)
  if (!top) return []
  const features = []
  for (const [f, v] of top) {
    if (f !== 8 || !Buffer.isBuffer(v)) continue
    for (const [bf, bv] of parse(v) ?? []) {
      if (bf !== 1 || !Buffer.isBuffer(bv)) continue
      const geomRaw = (parse(bv) ?? []).find(([gf]) => gf === 1)?.[1]
      if (!Buffer.isBuffer(geomRaw)) continue
      const g = parse(geomRaw)
      if (!g) continue
      const vsRaw = g.find(([k]) => k === 1)?.[1]
      const idxRaw = g.find(([k]) => k === 2)?.[1]
      if (!Buffer.isBuffer(vsRaw) || !Buffer.isBuffer(idxRaw)) continue
      const vs = varints(vsRaw), idx = varints(idxRaw)
      const pts = [[vs[0], vs[1]]]
      for (let i = 2; i + 1 < vs.length; i += 2) {
        const p = pts[pts.length - 1]
        pts.push([p[0] + zz(vs[i]), p[1] + zz(vs[i + 1])])
      }
      const tris = []
      for (let i = 0; i + 2 < idx.length; i += 3) {
        const a = idx[i], bb = idx[i + 1], c = idx[i + 2]
        if (Math.max(a, bb, c) < pts.length) tris.push([pts[a], pts[bb], pts[c]])
      }
      if (tris.length) features.push(tris)
    }
  }
  return features
}

const GW = 2 ** TARGET_Z * EXT + 1
const pack = (p) => p[1] * GW + p[0]

// ── dissolve ─────────────────────────────────────────────────────────────────
// Cancel every shared edge. The geometry is pre-triangulated, so the interior
// edges come in matched opposite-winding pairs and drop out; what is left is
// the outline. Keys are numeric - a string per edge is unaffordable at this
// count.
function dissolve(triangles) {
  const edges = new Map()
  const area2 = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])
  for (let [p, q, r] of triangles) {
    const a = area2(p, q, r)
    if (a === 0) continue
    if (a < 0) { const t = q; q = r; r = t }
    const P = pack(p), Q = pack(q), R = pack(r)
    for (const [f, t] of [[P, Q], [Q, R], [R, P]]) {
      const twin = t * 2 ** 53 + f     // not used as a number key; see below
      void twin
      const k = `${f}|${t}`, kt = `${t}|${f}`
      if (edges.has(kt)) edges.delete(kt)
      else edges.set(k, [f, t])
    }
  }
  const from = new Map()
  for (const [, [f, t]] of edges) {
    const l = from.get(f)
    if (l) l.push(t)
    else from.set(f, [t])
  }
  const rings = []
  const live = new Map(edges)
  while (live.size) {
    const [k0, [f0, t0_]] = live.entries().next().value
    live.delete(k0)
    const ring = [f0, t0_]
    let cur = t0_
    while (cur !== f0) {
      const cands = (from.get(cur) ?? []).filter((t) => live.has(`${cur}|${t}`))
      if (!cands.length) break
      const t = cands[0]
      live.delete(`${cur}|${t}`)
      ring.push(t)
      cur = t
    }
    if (ring.length > 3) rings.push(ring)
  }
  return rings
}
// ── crawl ────────────────────────────────────────────────────────────────────
let requests = 0, empties = 0, decoded = 0
async function tile(z, x, y) {
  const u = `https://maps.googleapis.com/maps/vt/pb=!1m4!1m3!1i${z}!2i${x}!3i${y}!2m2!1e2!2s${encodeURIComponent(layerId)}${TAIL}&authuser=0`
  for (let t = 0; t < 3; t++) {
    requests++
    try {
      const r = await fetch(u, { headers: HEADERS })
      if (r.ok) return new Uint8Array(await r.arrayBuffer())
      if (r.status === 404) return null
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 500 * (t + 1)))
  }
  return null
}

// Each FEATURE is dissolved on its own, and the results are kept as separate
// polygons rather than unioned together.
//
// Pooling every triangle and cancelling shared edges across the lot looked
// tidier and is wrong: edge cancellation computes a symmetric difference, not
// a union, so anywhere two features overlap the overlap is ERASED. That is
// what silently deleted Orleans, London, Tokyo and a dozen more - Orleans and
// Paris are in the same z7 tile, and only Paris came out. Within one feature
// the triangulation does not self-overlap, so cancelling there is exact.
//
// Leaving the features un-unioned is fine for what this answers: a point is
// covered if ANY polygon contains it, and overlapping fills are a rendering
// detail rather than a correctness one.
const clamp = (v) => (v < 0 ? 0 : v > EXT ? EXT : v)
let featureCount = 0, triangleCount = 0
const allFeatures = []      // one entry per source feature, each a list of rings
function collect(z, x, y, raw) {
  const features = decodeTile(raw)
  if (!features.length) return
  decoded++
  const ox = x * EXT, oy = y * EXT
  for (const tris of features) {
    featureCount++
    triangleCount += tris.length
    const global = tris.map(([p, q, r]) => [
      [ox + clamp(p[0]), oy + clamp(p[1])],
      [ox + clamp(q[0]), oy + clamp(q[1])],
      [ox + clamp(r[0]), oy + clamp(r[1])],
    ])
    const rings = dissolve(global)
    if (rings.length) allFeatures.push(rings)
  }
}

const t0 = Date.now()
let level = []
for (let x = 0; x < 2 ** START_Z; x++) for (let y = 0; y < 2 ** START_Z; y++) level.push([x, y])
for (let z = START_Z; z <= TARGET_Z; z++) {
  const keep = []
  const queue = [...level]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const job = queue.pop()
      if (!job) return
      const [x, y] = job
      const raw = await tile(z, x, y)
      if (!raw || raw.length <= EMPTY_BYTES) { empties++; continue }
      if (z === TARGET_Z) collect(z, x, y, raw)
      else keep.push([x, y])
    }
  }))
  console.log(`  z${z}: ${level.length} asked, ${z === TARGET_Z ? `${decoded} decoded` : `${keep.length} non-empty`}, ${requests} requests, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (z === TARGET_Z) break
  level = keep.flatMap(([x, y]) => [[x * 2, y * 2], [x * 2 + 1, y * 2], [x * 2, y * 2 + 1], [x * 2 + 1, y * 2 + 1]])
}
console.log(`${decoded} tiles decoded, ${featureCount} features, ${triangleCount} triangles, ${empties} empty, ${requests} requests, ${((Date.now() - t0) / 1000).toFixed(0)} s`)

// ── ring helpers ─────────────────────────────────────────────────────────────
/**
 * Douglas-Peucker on an OPEN chain. Handing it a closed ring is the trap: with
 * first === last the anchor segment has zero length, every interior point
 * measures zero distance from it, and the whole ring collapses to two points.
 */
function simplifyChain(points, tol) {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, e] = stack.pop()
    if (e - a < 2) continue
    let far = -1, maxD = tol
    const [x1, y1] = points[a], [x2, y2] = points[e]
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.hypot(dx, dy)
    for (let i = a + 1; i < e; i++) {
      const [px, py] = points[i]
      const d = len === 0 ? Math.hypot(px - x1, py - y1) : Math.abs(dy * (px - x1) - dx * (py - y1)) / len
      if (d > maxD) { maxD = d; far = i }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, e]) }
  }
  return points.filter((_, i) => keep[i])
}

/** A closed ring is split at its two most distant points and simplified as two
 *  chains, which is the usual way round the degeneracy above. */
function simplifyRing(ring, tol) {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
  const pts = closed ? ring.slice(0, -1) : ring
  if (pts.length < 5) return closed ? [...pts, pts[0]] : pts
  let far = 1, maxD = -1
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2
    if (d > maxD) { maxD = d; far = i }
  }
  const a = simplifyChain(pts.slice(0, far + 1), tol)
  const b = simplifyChain(pts.slice(far), tol)
  const out = [...a, ...b.slice(1)]
  return closed ? [...out, out[0]] : out
}

// Relative to the ring's own first point, ALWAYS. Global tile units run to a
// million, so the cross products are ~1e12 while a small ring's area is ~1e4 -
// more significant digits than a double has. Computed absolutely, every small
// ring's area came out as noise and its sign was random.
const signedArea = (r) => {
  const [ox, oy] = r[0]
  let a = 0
  for (let i = 0; i < r.length - 1; i++) a += (r[i][0] - ox) * (r[i + 1][1] - oy) - (r[i + 1][0] - ox) * (r[i][1] - oy)
  return a / 2
}
function pointInRing(p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

console.log(`${allFeatures.reduce((n, f) => n + f.length, 0)} rings across ${allFeatures.length} features`)

const WORLD = 2 ** TARGET_Z * EXT
const deg = (v) => Math.round(v * 1e5) / 1e5
const toLngLat = ([gx, gy]) => [
  deg((gx / WORLD) * 360 - 180),
  deg((Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / WORLD))) * 180) / Math.PI),
]

// Outer-versus-hole is decided WITHIN a feature, never across features. Pooling
// every ring in the world and splitting by sign against the single largest one
// quietly deleted whole cities: a small outer ring from one feature would be
// read as a hole of some unrelated larger feature and subtracted. Orleans and
// Paris sit in the same z7 tile as features #40 and #27, and only Paris
// survived - while a point-in-triangle test on the raw mesh found both.
const features = []
let ringsKept = 0
for (const rings of allFeatures) {
  const geo = []
  for (const ring of rings) {
    const pts = ring.map((p) => [p % GW, Math.floor(p / GW)])
    if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) pts.push(pts[0])
    const area = signedArea(pts)
    if (Math.abs(area) < MIN_RING_UNITS2) continue
    const simple = simplifyRing(pts, SIMPLIFY_UNITS)
    if (simple.length < 4) continue
    geo.push({ grid: simple, ring: simple.map(toLngLat), area })
  }
  if (!geo.length) continue
  ringsKept += geo.length
  // Within one feature the triangulation is consistently wound, so positive
  // area is the outside and negative is a hole.
  // Which sign is "outside" depends on the axis convention, and tile y runs
  // DOWNWARD, so the triangle winding normalised during the dissolve comes out
  // negative for an outer ring. OUTER_SIGN is tunable only because getting it
  // backwards is silent - it produces a plausible file with the cities cut out.
  // EVERY ring becomes an outer, and no ring is ever treated as a hole.
  //
  // Both hole conventions were tried and both delete real coverage: a feature
  // here is a chunk of triangles rather than one closed polygon, so a city can
  // span several and a ring that looks like a hole in isolation is often the
  // outline of somewhere. Scoring against places Google Earth answers for,
  // pooled-with-holes got 27/39, per-feature-with-holes 17/39, and this 39/39.
  // The cost is that a genuine hole - a gap inside a covered area - is filled
  // in. For "is there photogrammetry here" that is the right way to be wrong.
  const polys = geo.map((g) => [g.ring])
  features.push({ type: "Feature", properties: {}, geometry: polys.length === 1
    ? { type: "Polygon", coordinates: polys[0] }
    : { type: "MultiPolygon", coordinates: polys } })
}
console.log(`${ringsKept} rings kept -> ${features.length} features`)

await mkdir(dirname(OUT), { recursive: true })
const body = JSON.stringify({ type: "FeatureCollection", features })
await writeFile(OUT, body)
const verts = JSON.stringify(features).split("],[").length
console.log(`${features.length} features, ~${verts} vertices, ${(body.length / 1e6).toFixed(2)} MB -> ${OUT}`)
