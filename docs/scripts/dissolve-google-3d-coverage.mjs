#!/usr/bin/env node
// Turns the decoded Google 3D coverage - several zooms' worth of overlapping,
// tile-clipped polygons - into one shippable GeoJSON.
//
// Input is whatever google3d-coverage.ts `decode` wrote for each zoom. The
// zooms are UNIONED because the layer is generalised per zoom and no single
// one is complete (London, New York and Berlin only at z10, Tokyo only at z8,
// Tours only at z9 - see the decoder's header). Three zooms come to 73 317
// polygons and 225 MB, which is why this pass exists.
//
// ## The order matters, and the first version had it wrong
//
// Union first, then generalise - that part was right. What was missing is
// that BOTH steps leave invalid geometry behind, and the output shipped with
// it. Over Paris the first version produced, in one 656 km2 polygon:
//
//   - **30 holes, 26 of them under 1 km2**, most under 0.2 km2. They are not
//     gaps in Google's coverage. The input is a triangulated mesh clipped to
//     tile edges, so the union closes over thousands of shared edges and
//     leaves pinpricks wherever two triangles meet imperfectly. Below the
//     simplification tolerance they are smaller than the error of the outline
//     containing them, and they render as a city peppered with specks.
//   - **7 self-intersections**, made by simplify and truncate, not present in
//     the union. Douglas-Peucker on a ring with thousands of vertices will
//     happily cross it over itself, and then snapping coordinates to 3
//     decimals crosses a few more. A self-intersecting ring is not a closed
//     area, and maplibre's triangulator draws the bowties it implies.
//
// So each merged polygon now goes: drop small holes, simplify, truncate,
// **re-node**, drop small holes again, drop small outer rings.
//
// Re-noding is `union(p, p)`: polygon-clipping is a boolean-op library, so it
// nodes every intersection before it reassembles the output, and a polygon
// unioned with a copy of itself comes back as the same area with no crossings
// left. Measured on that Paris polygon: 7 kinks -> 0, 39 rings -> 31, area
// unchanged (655.9 -> 655.8 km2). Whole world: 11 208 artefact holes dropped,
// self-intersections 10 231 -> 4 103 (the rest are holes that legitimately
// touch their outer ring, which turf.kinks counts), 4.02 MB -> 3.17 MB, and
// total covered area barely moved - 1.074 -> 1.062 Mkm2 - so this removes
// artefacts, not coverage.
//
//   node docs/scripts/dissolve-google-3d-coverage.mjs a.geojson b.geojson ... [--out public/coverage/google-3d.geojson]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as turf from "@turf/turf"

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const outIdx = args.indexOf("--out")
const OUT = resolve(outIdx >= 0 ? args[outIdx + 1] : resolve(HERE, "../../public/coverage/google-3d.geojson"))
const INPUTS = args.filter((a, i) => a !== "--out" && (outIdx < 0 || i !== outIdx + 1))
if (!INPUTS.length) { console.error("give at least one decoded geojson"); process.exit(1) }

// Tunable from the environment because the right values were found by
// measuring, not by reasoning. The first pass at 200 m / 4 decimals / 0.5 km2
// left 27 413 polygons at 112 vertices each and 69 MB - the tile-clipped
// triangle outlines are dense enough that a gentle tolerance removes almost
// nothing. Coverage is a city-scale yes/no; nothing under a kilometre in it
// is information. At 1 km Berlin's test point fell outside its own simplified
// ring, so 500 m is the floor.
const BUCKET_DEG = 5
const SIMPLIFY_DEG = Number(process.env.G3D_SIMPLIFY_DEG ?? 0.005)  // ~500 m
const DECIMALS = Number(process.env.G3D_DECIMALS ?? 3)               // ~110 m
const MIN_KM2 = Number(process.env.G3D_MIN_KM2 ?? 1)
/** Holes below this are union artefacts, not coverage gaps - see the header.
 *  Same threshold as MIN_KM2 by default: a hole too small to be an outer ring
 *  worth keeping is too small to be a gap worth drawing. */
const MIN_HOLE_KM2 = Number(process.env.G3D_MIN_HOLE_KM2 ?? MIN_KM2)
/** A bucket whose union throws is retried in halves, recursively, down to
 *  this many polygons - one bad ring should cost one ring, not a region. */
const MIN_SPLIT = 8

const t0 = Date.now()
let inCount = 0
const buckets = new Map()
for (const f of INPUTS) {
  const fc = JSON.parse(readFileSync(f, "utf8"))
  for (const feat of fc.features) {
    const g = feat.geometry
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue
    inCount++
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates
    for (const rings of polys) {
      const [x, y] = rings[0][0]
      const k = `${Math.floor(x / BUCKET_DEG)},${Math.floor(y / BUCKET_DEG)}`
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(turf.polygon(rings))
    }
  }
}
console.log(`${inCount} input polygons from ${INPUTS.length} file(s) into ${buckets.size} buckets`)

let failed = 0
/** Union a list of polygon features; on failure split and union the halves,
 *  so one invalid ring does not send a whole 5x5 degree bucket out raw. */
function unionAll(polys) {
  if (polys.length === 1) return [polys[0]]
  try {
    // turf 7's union takes a FeatureCollection of polygons in one go.
    const u = turf.union(turf.featureCollection(polys))
    return u ? [u] : []
  } catch {
    if (polys.length <= MIN_SPLIT) { failed++; return polys }
    const mid = polys.length >> 1
    return [...unionAll(polys.slice(0, mid)), ...unionAll(polys.slice(mid))]
  }
}

const km2 = (ring) => {
  try { return turf.area(turf.polygon([ring])) / 1e6 } catch { return 0 }
}
/** Outer ring kept as-is, holes below the threshold dropped. */
function dropSmallHoles(rings, stats) {
  if (rings.length < 2) return rings
  const kept = [rings[0]]
  for (const hole of rings.slice(1)) {
    if (hole.length >= 4 && km2(hole) >= MIN_HOLE_KM2) kept.push(hole)
    else stats.holes++
  }
  return kept
}
const asPolygonList = (geom) => (geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates])

/** union(p, p): makes polygon-clipping re-node the ring, which is what
 *  removes the self-intersections simplify and truncate introduce. Returns
 *  the input untouched if the clipper refuses it - a kinked ring still draws
 *  something, an exception drops a city. */
function renode(feature, stats) {
  try {
    const copy = { type: "Feature", properties: {}, geometry: JSON.parse(JSON.stringify(feature.geometry)) }
    const u = turf.union(turf.featureCollection([feature, copy]))
    if (u) return u
  } catch { /* fall through */ }
  stats.renodeFailed++
  return feature
}

const out = []
const stats = { holes: 0, renodeFailed: 0, kinksBefore: 0, kinksAfter: 0 }
let done = 0
for (const [, polys] of buckets) {
  for (const merged of unionAll(polys)) {
    // 1. Small holes are union artefacts; drop them before generalising, or
    //    Douglas-Peucker spends vertices describing specks.
    const deholed = asPolygonList(merged.geometry).map((rings) => dropSmallHoles(rings, stats)).filter((r) => r[0]?.length >= 4)
    if (!deholed.length) continue
    const cleaned = turf.multiPolygon(deholed)
    // 2-3. Generalise, then snap coordinates. Both can cross a ring.
    const simple = turf.simplify(cleaned, { tolerance: SIMPLIFY_DEG, highQuality: false })
    const trunc = turf.truncate(simple, { precision: DECIMALS, coordinates: 2, mutate: true })
    try { stats.kinksBefore += turf.kinks(trunc).features.length } catch { /* diagnostic only */ }
    // 4. Re-node, which is the whole point of this pass.
    const fixed = renode(trunc, stats)
    try { stats.kinksAfter += turf.kinks(fixed).features.length } catch { /* diagnostic only */ }
    // 5-6. Simplification opens new pinpricks; sweep once more, then drop
    //      slivers that are not worth an outer ring.
    for (const rings of asPolygonList(fixed.geometry)) {
      const kept = dropSmallHoles(rings, stats)
      if (!kept[0] || kept[0].length < 4) continue
      const poly = turf.polygon(kept)
      if (turf.area(poly) / 1e6 < MIN_KM2) continue
      out.push(poly)
    }
  }
  if (++done % 50 === 0) console.log(`  ${done}/${buckets.size} buckets, ${out.length} polygons, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

const fc = turf.featureCollection(out.map((p) => ({ ...p, properties: {} })))
mkdirSync(dirname(OUT), { recursive: true })
const body = JSON.stringify(fc)
writeFileSync(OUT, body)
const verts = out.reduce((n, p) => n + p.geometry.coordinates.reduce((m, r) => m + r.length, 0), 0)
console.log(`${inCount} -> ${out.length} polygons, ${verts} vertices, ${(body.length / 1e6).toFixed(2)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${OUT}`)
console.log(`  ${stats.holes} artefact holes dropped, self-intersections ${stats.kinksBefore} -> ${stats.kinksAfter}` +
  `${stats.renodeFailed ? `, ${stats.renodeFailed} polygons the clipper refused to re-node` : ""}` +
  `${failed ? `, ${failed} small groups left un-unioned` : ""}`)
