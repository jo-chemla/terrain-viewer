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
// ## Two bugs, both of which shipped
//
// **The union silently did not union.** `turf.union` (polygon-clipping)
// throws "Unable to complete output ring" on this input - raw decoded
// coordinates are full-precision doubles and the mesh has near-coincident
// vertices everywhere, which is exactly what its ring assembly cannot close.
// The old fallback caught that, split the group in half, unioned each half
// and returned BOTH - never unioning the halves with each other. So the
// output kept every overlap the union was there to remove. Over Paris that
// meant the three zooms' outlines shipped stacked on top of one another:
// 2 110 km2 of polygons for 1 346 km2 of coverage, 69 polygons with 89
// intersecting pairs, drawn as a red crosshatch.
//
// Two changes fix it:
//
//  - **Snap before unioning.** Truncating each input ring to PRE_DECIMALS and
//    running cleanCoords removes the near-duplicate vertices the clipper
//    chokes on. Measured on the Paris window: full precision throws, 5
//    decimals (~1 m) unions 484 polygons in 1.0 s. That is the whole fix for
//    the failure itself.
//  - **Never return unmerged partial unions.** Groups are unioned in chunks
//    and the chunk results are then tree-merged pairwise until nothing
//    merges, rotating the pairing each pass so a pair that cannot combine
//    gets a different partner rather than blocking forever. Anything still
//    unmerged at the end is COUNTED AND PRINTED, because silence is what let
//    the first version look finished.
//
// **Generalising leaves its own rubbish.** Both simplify and truncate make
// invalid geometry. Over Paris the first version produced, in one 656 km2
// polygon:
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
// So each merged polygon goes: drop small holes, simplify, truncate,
// **re-node**, drop small holes again, drop small outer rings.
//
// Re-noding is `union(p, p)`: polygon-clipping nodes every intersection
// before it reassembles the output, so a polygon unioned with a copy of
// itself comes back as the same area with no crossings left. Measured on that
// Paris polygon: 7 kinks -> 0, 39 rings -> 31, area unchanged.
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
/** Decimals every input ring is snapped to BEFORE the union. ~1 m. Without
 *  this the clipper throws on near-coincident vertices; see the header. */
const PRE_DECIMALS = Number(process.env.G3D_PRE_DECIMALS ?? 5)
/** Inputs smaller than this are dropped before the union - they are single
 *  mesh triangles that cannot survive a 500 m generalisation anyway, and
 *  every one of them is another chance for the clipper to fail. */
const MIN_INPUT_M2 = 1000
/** Polygons per polygon-clipping call. Chunking keeps any one failure local. */
const CHUNK = 400

/** Snap to PRE_DECIMALS, drop repeated vertices, reject what is left of a
 *  ring that was only a sliver. Both halves matter: the snap is what stops
 *  polygon-clipping throwing, and cleanCoords is what stops the snap from
 *  leaving zero-length segments behind. */
function prepare(rings) {
  let p
  try { p = turf.polygon(JSON.parse(JSON.stringify(rings))) } catch { return null }
  turf.truncate(p, { precision: PRE_DECIMALS, coordinates: 2, mutate: true })
  try { p = turf.cleanCoords(p, { mutate: true }) } catch { return null }
  const outer = p.geometry.coordinates[0]
  if (!outer || outer.length < 4) return null
  try { if (turf.area(p) < MIN_INPUT_M2) return null } catch { return null }
  return p
}

const t0 = Date.now()
let inCount = 0, dropped = 0
const buckets = new Map()
for (const f of INPUTS) {
  const fc = JSON.parse(readFileSync(f, "utf8"))
  for (const feat of fc.features) {
    const g = feat.geometry
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue
    inCount++
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates
    for (const rings of polys) {
      const poly = prepare(rings)
      if (!poly) { dropped++; continue }
      const [x, y] = poly.geometry.coordinates[0][0]
      const k = `${Math.floor(x / BUCKET_DEG)},${Math.floor(y / BUCKET_DEG)}`
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(poly)
    }
  }
}
console.log(`${inCount} input polygons from ${INPUTS.length} file(s) into ${buckets.size} buckets (${dropped} slivers dropped before the union)`)

let unmerged = 0
const unionPair = (a, b) => {
  try { return turf.union(turf.featureCollection([a, b])) ?? null } catch { return null }
}
/** One polygon-clipping call over the whole list, halving on failure. */
function unionGroup(list) {
  if (list.length <= 1) return list
  try {
    // turf 7's union takes a FeatureCollection of polygons in one go.
    const u = turf.union(turf.featureCollection(list))
    if (u) return [u]
  } catch { /* fall through to halving */ }
  if (list.length === 2) return list
  const mid = list.length >> 1
  return [...unionGroup(list.slice(0, mid)), ...unionGroup(list.slice(mid))]
}
/** Union a bucket. Chunk, then TREE-MERGE the chunk results until nothing
 *  merges - the old version stopped after the split and returned overlapping
 *  halves, which is the bug this file's header is mostly about. */
function unionAll(polys) {
  if (polys.length <= 1) return polys
  let parts = []
  for (let i = 0; i < polys.length; i += CHUNK) parts.push(...unionGroup(polys.slice(i, i + CHUNK)))
  for (let pass = 0; parts.length > 1 && pass < 24; pass++) {
    // Offset the pairing on odd passes so a pair that refuses to combine is
    // offered a different partner instead of blocking the whole bucket.
    const offset = pass % 2
    const next = offset ? [parts[0]] : []
    let merged = 0
    for (let i = offset; i < parts.length; i += 2) {
      if (i + 1 >= parts.length) { next.push(parts[i]); break }
      const u = unionPair(parts[i], parts[i + 1])
      if (u) { next.push(u); merged++ } else next.push(parts[i], parts[i + 1])
    }
    if (!merged) break
    parts = next
  }
  if (parts.length > 1) unmerged += parts.length
  return parts
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
  `${unmerged ? `, ${unmerged} partial unions left unmerged - THEY MAY OVERLAP` : ""}`)
