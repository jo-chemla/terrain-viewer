#!/usr/bin/env node
// Measures how deep Google's Photorealistic 3D Tiles tree refines at a point.
//
// THIS DOES NOT PRODUCE A COVERAGE MAP, and the file it replaces
// (build-google-3d-coverage.mjs) was wrong to try. The premise there was the
// one that worked for Bing: the tileset's own structure should say where the
// photogrammetry is. For Bing it does - a subtree bitstream is literally a
// list of which tiles have mesh. For Google it does not, and this script is
// what established that, so nobody derives the idea a third time.
//
// What was measured, 2026-09-23, against tile.googleapis.com:
//
//   place              deepest node   geometric error   node span
//   Paris (Eiffel)     depth 20        2 m              50 m
//   Kinshasa           depth 20        2 m              40 m
//   RURAL NEPAL        depth 20        2 m              40 m     <- the problem
//   Sahara             depth 16       32 m             610 m
//
// Rural Nepal refines exactly as deep as central Paris. Google's tileset is
// not "cities plus coarse terrain": it is satellite-derived 3D nearly
// everywhere, and the "2500 cities in 49 countries" figure in Google's
// marketing describes where the *aerial* mesh is, which the tree does not
// distinguish. Only the true deserts stop early.
//
// Two further findings worth keeping:
//
//  - Everything lives in one dataset, `/v1/3dtiles/datasets/CgIYAQ/files/...`,
//    at every depth and in every location probed. There is no dataset id to
//    separate aerial mesh from satellite terrain.
//  - Cost rules it out anyway. Reaching depth 20 over a single 400 m window
//    takes 545 requests (1090 over Nepal). Sub-tileset JSONs sit at depths 4,
//    8, 12, ... so a global crawl costs one request per node at every fourth
//    level: 88 at depth 4, 21 848 at depth 8, and an extrapolated ~3 million
//    at depth 12. A full-globe walk to where the mesh quality shows is not a
//    few hundred requests, it is millions.
//
// The coverage layer Google Earth itself draws when you enable "3D buildings
// where available" is a separate vector layer, requested from
// www.google.com/maps/vt/proto/bpb=<protobuf>, about 142 small requests for
// the whole world. That is the right source. Its protobuf payload could not
// be reconstructed by guessing - every shape tried returns HTTP 400 - so it
// needs one real request captured from a browser's network tab.
//
// Needs VITE_GOOGLE_API_KEY in .env (Map Tiles API enabled). Reads tileset
// metadata only: no mesh, no imagery.
//
//   node docs/scripts/probe-google-3d-detail.mjs 2.2945 48.8584 "Paris"
//   node docs/scripts/probe-google-3d-detail.mjs            # the four places above

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const env = await readFile(resolve(HERE, "../../.env"), "utf8").catch(() => "")
const KEY = (/VITE_GOOGLE_API_KEY=(\S+)/.exec(env) ?? [])[1] ?? process.env.VITE_GOOGLE_API_KEY
if (!KEY) { console.error("No VITE_GOOGLE_API_KEY in .env or the environment"); process.exit(1) }

const API = "https://tile.googleapis.com"
const CONCURRENCY = 12
let session = ""
let requests = 0

async function getJson(uri) {
  const u = new URL(uri.startsWith("http") ? uri : API + uri, API)
  const s = u.searchParams.get("session")
  if (s) session = s
  u.searchParams.set("key", KEY)
  // root.json is what ISSUES a session; handing it one is a 400.
  if (session && !u.pathname.endsWith("root.json")) u.searchParams.set("session", session)
  for (let t = 0; t < 3; t++) {
    requests++
    try {
      const r = await fetch(u)
      if (r.ok) return r.json()
      if (r.status === 404) return null
    } catch { /* connection reset under load - back off */ }
    await new Promise((res) => setTimeout(res, 500 * (t + 1)))
  }
  return null
}

// Bounding volumes are oriented boxes in ECEF (centre plus three half-axis
// vectors), never `region`, so a footprint needs the eight corners projected.
const A = 6378137, F = 1 / 298.257223563, B = A * (1 - F)
const E2 = (A * A - B * B) / (A * A), EP2 = (A * A - B * B) / (B * B)
function ecefToLngLat(x, y, z) {
  const p = Math.hypot(x, y)
  const th = Math.atan2(A * z, B * p)
  const lat = Math.atan2(z + EP2 * B * Math.sin(th) ** 3, p - E2 * A * Math.cos(th) ** 3)
  return [(Math.atan2(y, x) * 180) / Math.PI, (lat * 180) / Math.PI]
}
function bboxOf(bv) {
  if (bv?.region) { const d = (r) => (r * 180) / Math.PI; return { w: d(bv.region[0]), s: d(bv.region[1]), e: d(bv.region[2]), n: d(bv.region[3]) } }
  if (!bv?.box) return null
  const b = bv.box
  let w = 180, s = 90, e = -180, n = -90
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const [lng, lat] = ecefToLngLat(
      b[0] + sx * b[3] + sy * b[6] + sz * b[9],
      b[1] + sx * b[4] + sy * b[7] + sz * b[10],
      b[2] + sx * b[5] + sy * b[8] + sz * b[11])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat)
  }
  return e - w > 180 ? null : { w, s, e, n }
}
const spanKm = (bb) => Math.max(
  (bb.e - bb.w) * 111.32 * Math.cos((((bb.s + bb.n) / 2) * Math.PI) / 180),
  (bb.n - bb.s) * 110.57)

const root = await getJson("/v1/3dtiles/root.json")
if (!root) throw new Error("root.json unreachable - is the Map Tiles API enabled for this key?")

async function probe(label, lng, lat, maxDepth = 24) {
  const eps = 0.004                       // a ~400 m window around the point
  const win = { w: lng - eps, e: lng + eps, s: lat - eps, n: lat + eps }
  // The root's four children all carry the SAME whole-Earth box - they are
  // alternate branches, not octants - and those do not project, so the first
  // few levels are followed wholesale and filtering starts below them.
  const hit = (bb, d) => (d < 3 ? true : !!bb && bb.w <= win.e && bb.e >= win.w && bb.s <= win.n && bb.n >= win.s)
  const r0 = requests
  let level = [root.root]
  let depth = 0, lastGe = null, lastSpan = null
  const paths = new Map()
  for (; depth <= maxDepth; depth++) {
    const pending = level.filter((n) => !(n.children ?? []).length && n.content?.uri?.includes(".json"))
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY)
      const subs = await Promise.all(batch.map((n) => getJson(n.content.uri)))
      batch.forEach((n, k) => { if (subs[k]?.root) n.children = subs[k].root.children ?? [] })
    }
    const next = []
    for (const n of level) for (const c of n.children ?? []) if (hit(bboxOf(c.boundingVolume), depth)) next.push(c)
    if (!next.length) break
    level = next
    const bb = bboxOf(level[0].boundingVolume)
    lastGe = level[0].geometricError
    lastSpan = bb ? spanKm(bb) * 1000 : null
    for (const n of level) {
      if (!n.content?.uri) continue
      const path = n.content.uri.split("?")[0].replace(/\/[A-Za-z0-9_-]{40,}\.(glb|json)$/, "/<id>.$1")
      paths.set(path, (paths.get(path) ?? 0) + 1)
    }
  }
  console.log(`${label.padEnd(18)} depth ${String(depth).padStart(2)}  ge ${String(Math.round(lastGe ?? 0)).padStart(6)} m  node ~${lastSpan ? Math.round(lastSpan) : "?"} m  (${requests - r0} requests)`)
  for (const [p, n] of [...paths].sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`   ${String(n).padStart(6)}  ${p}`)
}

const [lngArg, latArg, labelArg] = process.argv.slice(2)
if (lngArg && latArg) {
  await probe(labelArg ?? "point", Number(lngArg), Number(latArg))
} else {
  await probe("Paris (Eiffel)", 2.2945, 48.8584)
  await probe("Sahara", 10.0, 23.0)
  await probe("Rural Nepal", 85.3, 28.0)
  await probe("Kinshasa", 15.3, -4.32)
}
console.log(`\n${requests} requests total`)
