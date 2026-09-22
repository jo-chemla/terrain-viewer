#!/usr/bin/env node
// Google Photorealistic 3D Tiles coverage, by walking the tileset itself.
//
// Google publishes no machine-readable coverage: the docs page draws blue
// areas from an internal layer and exposes no URL. But the Map Tiles API root
// (tile.googleapis.com/v1/3dtiles/root.json) is an ordinary 3D Tiles 1.0 tree
// whose nodes carry ECEF `box` bounding volumes and whose content is either a
// GLB or a nested tileset JSON. Worldwide there is coarse 3D terrain; where
// Google has photogrammetry ("3D surface data") the tree keeps subdividing to
// metre-level geometric error. So: walk JSON children breadth-first, stop
// expanding once a node's geometricError drops below STOP_GE, and every node
// that reached at or below FINE_GE is "photorealistic here".
//
// Needs an API key (VITE_GOOGLE_API_KEY from .env, or GOOGLE_API_KEY). Google
// bills the ROOT tileset request per session; child tileset/GLB requests inside
// the session are not billed separately, but are rate-limited. The crawl is
// budgeted (MAX_JSON) so a first run measures the tree before anyone commits
// to a full one. Output: public/coverage/google-3d.geojson (boxes of fine
// nodes, dissolved by 1/64-degree cell) plus a depth/GE histogram on stdout.
//
//   node docs/scripts/build-google-3d-coverage.mjs [maxJson=3000] [stopGE=400] [fineGE=2000]

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const MAX_JSON = Number(process.argv[2] ?? 3000)
const STOP_GE = Number(process.argv[3] ?? 400)     // do not expand nodes finer than this
const FINE_GE = Number(process.argv[4] ?? 2000)    // a node at/below this GE counts as photorealistic coverage
const OUT = resolve(HERE, "../../public/coverage/google-3d.geojson")

let key = process.env.GOOGLE_API_KEY ?? process.env.VITE_GOOGLE_API_KEY
if (!key) {
  try {
    const env = await readFile(resolve(HERE, "../../.env"), "utf8")
    key = /^VITE_GOOGLE_API_KEY=(.+)$/m.exec(env)?.[1]?.trim()
  } catch { /* no .env */ }
}
if (!key) throw new Error("No Google API key: set VITE_GOOGLE_API_KEY in .env or GOOGLE_API_KEY in the environment")

const BASE = "https://tile.googleapis.com"
const withKey = (uri) => `${BASE}${uri}${uri.includes("?") ? "&" : "?"}key=${key}`

async function getJson(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    const r = await fetch(url)
    if (r.ok) return r.json()
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 1500 * (t + 1))); continue }
    if (r.status >= 400 && r.status < 500) { const body = await r.text(); throw new Error(`${r.status} ${body.slice(0, 160)}`) }
    await new Promise((res) => setTimeout(res, 500 * (t + 1)))
  }
  return null
}

// ECEF (WGS84) → lon/lat degrees, for an OBB's centre.
function ecefToLonLat([x, y, z]) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f)
  const lon = Math.atan2(y, x)
  const p = Math.hypot(x, y)
  let lat = Math.atan2(z, p * (1 - e2))
  for (let i = 0; i < 5; i++) {
    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2)
    lat = Math.atan2(z + e2 * N * Math.sin(lat), p)
  }
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI]
}
// Half-extent of an OBB projected to ground, in degrees, from its three half-axis vectors.
function boxToBbox(box) {
  const c = box.slice(0, 3)
  const axes = [box.slice(3, 6), box.slice(6, 9), box.slice(9, 12)]
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = [0, 1, 2].map((i) => c[i] + sx * axes[0][i] + sy * axes[1][i] + sz * axes[2][i])
    const [lon, lat] = ecefToLonLat(p)
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  }
  return [minLon, minLat, maxLon, maxLat]
}

const root = await getJson(withKey("/v1/3dtiles/root.json"))
if (!root) throw new Error("root.json failed")

// Breadth-first over inline children; JSON contents are external tilesets to fetch.
const queue = [{ node: root.root, depth: 0 }]
const fine = []                       // bboxes of nodes at/below FINE_GE
const depthHist = new Map()
let jsonFetched = 0, glbNodes = 0, expandedStop = 0
const t0 = Date.now()

async function expand(item) {
  const { node, depth } = item
  depthHist.set(depth, (depthHist.get(depth) ?? 0) + 1)
  const ge = node.geometricError ?? Infinity
  const box = node.boundingVolume?.box
  if (box && ge <= FINE_GE) fine.push({ bbox: boxToBbox(box), ge, depth })
  if (ge <= STOP_GE) { expandedStop++; return }
  const uri = node.content?.uri ?? ""
  if (uri.split("?")[0].endsWith(".json")) {
    if (jsonFetched >= MAX_JSON) return
    jsonFetched++
    let sub = null
    try { sub = await getJson(withKey(uri)) } catch (e) { console.error("  !", uri.slice(0, 60), e.message); return }
    if (sub?.root) queue.push({ node: sub.root, depth: depth + 1 })
    if (jsonFetched % 250 === 0) console.log(`  ${jsonFetched} tilesets, ${fine.length} fine nodes, queue ${queue.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    return
  }
  if (uri) glbNodes++
  for (const c of node.children ?? []) queue.push({ node: c, depth: depth + 1 })
}
const workers = Array.from({ length: 8 }, async () => {
  while (queue.length) { const item = queue.shift(); if (item) await expand(item) }
})
// Queue can refill after a worker drains it; loop until all are idle.
for (;;) {
  await Promise.all(workers.map((w) => w))
  if (!queue.length) break
  await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) { const item = queue.shift(); if (item) await expand(item) } }))
  if (!queue.length) break
}

console.log(`tilesets fetched: ${jsonFetched} (budget ${MAX_JSON}), GLB nodes: ${glbNodes}, stopped at GE<=${STOP_GE}: ${expandedStop}, fine (GE<=${FINE_GE}): ${fine.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
console.log("nodes by depth:", Object.fromEntries([...depthHist.entries()].sort((a, b) => a[0] - b[0])))

// Dissolve fine boxes onto a 1/64-degree grid (~1.7 km) so overlapping OBBs collapse.
const CELL = 1 / 64
const cells = new Set()
for (const f of fine) {
  const [w, s, e, n] = f.bbox
  for (let x = Math.floor(w / CELL); x <= Math.floor(e / CELL); x++)
    for (let y = Math.floor(s / CELL); y <= Math.floor(n / CELL); y++) cells.add(`${x}:${y}`)
}
const features = [...cells].map((k) => {
  const [x, y] = k.split(":").map(Number)
  const w = x * CELL, s = y * CELL, e = w + CELL, n = s + CELL
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }
})
await mkdir(dirname(OUT), { recursive: true })
const body = JSON.stringify({ type: "FeatureCollection", features })
await writeFile(OUT, body)
console.log(`cells: ${features.length}, ${(body.length / 1e6).toFixed(2)} MB → ${OUT}`)
