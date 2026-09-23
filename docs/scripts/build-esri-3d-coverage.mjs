#!/usr/bin/env node
// Builds public/coverage/esri-3d.geojson: the cities Esri publishes as
// photogrammetric Integrated Mesh scene layers.
//
// Esri's 3D story has two halves and only one of them is a coverage question:
//
//  - **Esri 3D Buildings** (basemaps3d.arcgis.com/.../Esri3D_Buildings_v1) is a
//    single global I3S layer of extruded/modelled buildings from TomTom,
//    Vantor, Esri Community Maps and Overture, refreshed quarterly. It
//    declares a whole-world extent, so there is nothing to map - and it is
//    models, not photogrammetry, so it is not the same thing Bing and Google's
//    overlays show.
//  - **Integrated Mesh** scene layers ARE photogrammetry, and they are
//    published one service per city, each with its own extent. Those are worth
//    a footprint, and that is what this collects.
//
// ArcGIS Online's public search API returns the extent with each item, so this
// needs no key and no crawl - one paged query and the geometry comes with it.
// Items are filtered to real Scene Services tagged as integrated mesh, and
// anything declaring a near-global extent is dropped as a mis-tag.
//
// Note these cannot be *rendered* here: I3S is Esri's own format and maplibre
// has no reader for it. The overlay answers "who has photogrammetry here",
// alongside Bing and Google, and links out to the item page.
//
//   node docs/scripts/build-esri-3d-coverage.mjs

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(process.argv[2] ?? resolve(HERE, "../../public/coverage/esri-3d.geojson"))
const SEARCH = "https://www.arcgis.com/sharing/rest/search"
// A city mesh is at most a couple of degrees across; anything bigger is a
// global or regional index item wearing the same tag.
const MAX_SPAN_DEG = 4

const QUERIES = [
  'type:"Scene Service" AND tags:"integrated mesh"',
  'type:"Scene Service" AND tags:"Integrated Mesh" AND access:public',
  'type:"Scene Service" AND title:"Integrated Mesh"',
]

const seen = new Map()
let requests = 0
for (const q of QUERIES) {
  for (let start = 1; start < 400;) {
    const u = `${SEARCH}?f=json&num=100&start=${start}&sortField=numviews&sortOrder=desc&q=${encodeURIComponent(q)}`
    requests++
    const r = await fetch(u)
    if (!r.ok) break
    const j = await r.json()
    for (const it of j.results ?? []) {
      if (!it.extent || it.extent.length !== 2) continue
      const [[w, s], [e, n]] = it.extent
      if (![w, s, e, n].every(Number.isFinite)) continue
      if (e - w > MAX_SPAN_DEG || n - s > MAX_SPAN_DEG || e <= w || n <= s) continue
      if (!seen.has(it.id)) seen.set(it.id, { it, w, s, e, n })
    }
    if (!j.nextStart || j.nextStart < 0) break
    start = j.nextStart
  }
}
console.log(`${seen.size} integrated-mesh scene layers with a city-sized extent, ${requests} search requests`)

const round = (v) => Math.round(v * 1e4) / 1e4
const features = [...seen.values()].map(({ it, w, s, e, n }) => ({
  type: "Feature",
  properties: {
    name: it.title,
    owner: it.owner,
    modified: it.modified ? new Date(it.modified).toISOString().slice(0, 10) : null,
    url: `https://www.arcgis.com/home/item.html?id=${it.id}`,
    service: it.url ?? null,
  },
  geometry: {
    type: "Polygon",
    coordinates: [[[round(w), round(s)], [round(e), round(s)], [round(e), round(n)], [round(w), round(n)], [round(w), round(s)]]],
  },
})).sort((a, b) => a.properties.name.localeCompare(b.properties.name))

await mkdir(dirname(OUT), { recursive: true })
const body = JSON.stringify({ type: "FeatureCollection", features })
await writeFile(OUT, body)
console.log(`${features.length} footprints, ${(body.length / 1024).toFixed(0)} KB -> ${OUT}`)
for (const f of features.slice(0, 12)) console.log(`  ${f.properties.name}  (${f.properties.owner})`)
