#!/usr/bin/env node
// Simplifies a coverage GeoJSON in place: Douglas-Peucker on every ring at a
// tolerance in degrees, then coordinates rounded to 5 decimals (~1 m). Rings
// that collapse below 4 points are dropped, and a polygon with no outer ring
// left is dropped with them. Properties are untouched.
//
// Written for public/coverage/flai-open-lidar.geojson, whose survey footprints
// came out of a COPC octree walk at far more vertices than a country-scale
// overlay can show. Usage:
//
//   node docs/scripts/simplify-coverage.mjs public/coverage/flai-open-lidar.geojson [tolerance-degrees] [--dry]
//
// Default tolerance 0.0002 (about 20 m at the equator). --dry reports the
// before/after counts and writes nothing.

import { readFile, writeFile } from "node:fs/promises"

const [, , path, tolArg, ...flags] = process.argv
if (!path) { console.error("usage: simplify-coverage.mjs <file.geojson> [tolerance] [--dry]"); process.exit(2) }
const TOL = Number(tolArg ?? 0.0002)
const DRY = flags.includes("--dry")

const round = (v) => Math.round(v * 1e5) / 1e5

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function dp(points, tol) {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(points[i], points[s], points[e])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]) }
  }
  return points.filter((_, i) => keep[i])
}

function simplifyRing(ring) {
  // A closed ring's first and last point are the same; DP keeps both ends,
  // so the ring stays closed. Split at the farthest point from the start so
  // a ring does not simplify to a line through its own start vertex.
  const open = ring.slice(0, -1)
  if (open.length < 3) return null
  // Three or four distinct vertices is already as simple as a ring gets, and
  // a ring not much bigger than the tolerance (a placeholder speck of a few
  // tens of metres) would only be distorted by it: both pass through rounded.
  const xs = open.map((p) => p[0]), ys = open.map((p) => p[1])
  const tiny = Math.max(...xs) - Math.min(...xs) < 10 * TOL && Math.max(...ys) - Math.min(...ys) < 10 * TOL
  if (open.length <= 4 || tiny) return [...open.map(([x, y]) => [round(x), round(y)]), [round(open[0][0]), round(open[0][1])]]
  let far = 0, farD = 0
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1])
    if (d > farD) { farD = d; far = i }
  }
  const a = dp(open.slice(0, far + 1), TOL)
  const b = dp(open.slice(far), TOL)
  const out = [...a.slice(0, -1), ...b].map(([x, y]) => [round(x), round(y)])
  // Drop consecutive duplicates that rounding can create.
  const dedup = out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1])
  if (dedup.length < 3) return null
  dedup.push(dedup[0])
  return dedup
}

function simplifyPolygon(rings) {
  const out = []
  for (let i = 0; i < rings.length; i++) {
    const r = simplifyRing(rings[i])
    if (i === 0 && !r) return null
    if (r) out.push(r)
  }
  return out
}

const countVerts = (g) => (typeof g[0] === "number" ? 1 : g.reduce((n, c) => n + countVerts(c), 0))

const src = await readFile(path, "utf8")
const fc = JSON.parse(src)
let before = 0, after = 0, dropped = 0
const features = []
for (const f of fc.features) {
  const g = f.geometry
  before += countVerts(g.coordinates)
  let coords
  if (g.type === "Polygon") coords = simplifyPolygon(g.coordinates)
  else if (g.type === "MultiPolygon") {
    coords = g.coordinates.map(simplifyPolygon).filter(Boolean)
    if (!coords.length) coords = null
  } else coords = g.coordinates
  if (!coords) { dropped++; continue }
  after += countVerts(coords)
  features.push({ ...f, geometry: { ...g, coordinates: coords } })
}
const out = JSON.stringify({ ...fc, features })
console.log(`${path}: ${fc.features.length} -> ${features.length} features (${dropped} dropped), ${before} -> ${after} vertices, ${src.length} -> ${out.length} bytes, tolerance ${TOL}`)
if (!DRY) await writeFile(path, out)
