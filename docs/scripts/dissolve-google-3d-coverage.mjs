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
// Four steps, each measured on the world:
//
//  1. Union, per 5x5 degree bucket. One global union of 73k polygons is
//     quadratic and does not finish; per bucket it is seconds. Seams between
//     buckets survive as a shared edge, which a fill layer does not show.
//     @turf/turf's union is polygon-clipping underneath, so no new dependency.
//  2. Simplify (Douglas-Peucker, ~200 m). Tile-clipped triangle outlines carry
//     vertices every few metres that describe nothing at coverage scale.
//  3. Truncate coordinates to 4 decimals, about 11 m. Sixteen-digit doubles
//     were roughly half the file for no information.
//  4. Drop rings under MIN_KM2. Sub-kilometre slivers along tile seams are
//     artefacts of the clip, not coverage.
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
// is information.
const BUCKET_DEG = 5
const SIMPLIFY_DEG = Number(process.env.G3D_SIMPLIFY_DEG ?? 0.005)  // ~500 m
const DECIMALS = Number(process.env.G3D_DECIMALS ?? 3)               // ~110 m
const MIN_KM2 = Number(process.env.G3D_MIN_KM2 ?? 1)
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

const out = []
let done = 0
for (const [k, polys] of buckets) {
  for (const merged of unionAll(polys)) {
    const simple = turf.simplify(merged, { tolerance: SIMPLIFY_DEG, highQuality: false })
    const trunc = turf.truncate(simple, { precision: DECIMALS, coordinates: 2, mutate: true })
    const geoms = trunc.geometry.type === "MultiPolygon" ? trunc.geometry.coordinates : [trunc.geometry.coordinates]
    for (const rings of geoms) {
      if (!rings?.[0] || rings[0].length < 4) continue
      const poly = turf.polygon(rings)
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
console.log(`${inCount} -> ${out.length} polygons (${failed} small groups left un-unioned), ${verts} vertices, ${(body.length / 1e6).toFixed(2)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${OUT}`)
