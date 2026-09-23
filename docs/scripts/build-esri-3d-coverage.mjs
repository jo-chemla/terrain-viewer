#!/usr/bin/env node
// Builds public/coverage/esri-3d.geojson: every public Integrated Mesh scene
// layer on ArcGIS Online, as a footprint.
//
// ## What Esri has, and what it does not
//
// Esri has no global photorealistic mesh. There is no Esri equivalent of
// Google's Photorealistic 3D Tiles or Bing Maps 3D - no single tileset you
// can point a camera at anywhere and get photogrammetry. The two things that
// look like one are not:
//
//  - **Esri 3D Buildings** (basemaps3d.arcgis.com/.../Esri3D_Buildings_v1) is
//    one global I3S layer, but it is MODELLED buildings - TomTom, Vantor,
//    Community Maps and Overture, refreshed quarterly - not imagery-derived
//    mesh. It declares a whole-world extent, so there is nothing to map, and
//    it answers a different question from the one this overlay asks.
//  - **Integrated Mesh** scene layers ARE photogrammetry, and they are
//    published one service per capture: a city, a district, a road corridor,
//    a single drone flight. Those are worth a footprint, and that is this.
//
// ## The single point of entry, and the key that actually works
//
// There is one: ArcGIS Online's public search API. No key, no crawl - the
// item's extent comes back with the search result. The trap is WHICH field
// you match on. The first version of this asked for `tags:"integrated mesh"`
// and found 48 layers, which looked like the whole world's supply and is
// really just the layers whose publisher happened to type that phrase into a
// free-text tag box. `typeKeywords:"IntegratedMesh"` is set by ArcGIS itself
// when an Integrated Mesh scene layer is published, and finds ~10 500.
//
// Search caps any single query at 10 000 items and stops paging there, so
// this splits the query by the item's `modified` year, none of which is
// anywhere near the cap (biggest year so far: ~2 800).
//
// Most of these are small: median extent ~0.02 degrees, about 2 km. That is
// what the data is - drone and aerial captures of a site, not cities. Items
// spanning more than MAX_SPAN_DEG are dropped as mis-tagged indexes.
//
// The overlay cannot RENDER any of it - I3S is Esri's own format and maplibre
// has no reader. It answers "who has photogrammetry here", alongside Bing and
// Google, and clicking a footprint opens that one service in Esri's Scene
// Viewer (see lib/coverage-overlays.ts), which is the only thing that draws
// I3S. Opening the service rather than its item page also means the scene
// contains nothing but the mesh - no 3D Buildings basemap layer to collide
// with it.
//
//   node docs/scripts/build-esri-3d-coverage.mjs

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(process.argv[2] ?? resolve(HERE, "../../public/coverage/esri-3d.geojson"))
const SEARCH = "https://www.arcgis.com/sharing/rest/search"
// A capture is at most a couple of degrees across; anything bigger is a
// global or regional index item wearing the same type keyword.
const MAX_SPAN_DEG = 4
const FIRST_YEAR = 2012

const seen = new Map()
let requests = 0, skippedSpan = 0

async function page(q, start) {
  const u = `${SEARCH}?f=json&num=100&start=${start}&sortField=modified&sortOrder=desc&q=${encodeURIComponent(q)}`
  requests++
  const r = await fetch(u)
  if (!r.ok) return null
  return r.json()
}

const nowYear = new Date().getUTCFullYear()
for (let year = FIRST_YEAR - 1; year <= nowYear; year++) {
  // The first bucket is open-ended downwards, so nothing published before
  // FIRST_YEAR is silently dropped.
  const from = year < FIRST_YEAR ? 0 : Date.UTC(year, 0, 1)
  const to = year < FIRST_YEAR ? Date.UTC(FIRST_YEAR, 0, 1) - 1 : Date.UTC(year + 1, 0, 1) - 1
  const q = `type:"Scene Service" AND typekeywords:"IntegratedMesh" AND access:public AND modified:[${from} TO ${to}]`
  let found = 0
  for (let start = 1; start > 0 && start < 10000;) {
    const j = await page(q, start)
    if (!j || j.error) break
    for (const it of j.results ?? []) {
      if (!it.url || !it.extent || it.extent.length !== 2) continue
      const [[w, s], [e, n]] = it.extent
      if (![w, s, e, n].every(Number.isFinite) || e <= w || n <= s) continue
      if (e - w > MAX_SPAN_DEG || n - s > MAX_SPAN_DEG) { skippedSpan++; continue }
      // Keyed by SERVICE, not item id: the same hosted mesh is routinely
      // registered as several items (a copy per group, per org, per web
      // scene), and those would stack identical rectangles on the map.
      const key = it.url.replace(/\/+$/, "").toLowerCase()
      const prev = seen.get(key)
      if (!prev || (it.modified ?? 0) > (prev.it.modified ?? 0)) seen.set(key, { it, w, s, e, n })
      found++
    }
    start = j.nextStart > 0 ? j.nextStart : -1
    if ((j.total ?? 0) > 9900) console.warn(`  ! ${year} has ${j.total} items, close to the 10 000 search cap - split finer`)
  }
  console.log(`  ${year < FIRST_YEAR ? `<${FIRST_YEAR}` : year}  ${String(found).padStart(5)} results, ${seen.size} distinct services so far`)
}
console.log(`${seen.size} Integrated Mesh services, ${requests} search requests, ${skippedSpan} dropped for spanning > ${MAX_SPAN_DEG} deg`)

const round = (v) => Math.round(v * 1e4) / 1e4
const features = [...seen.values()].map(({ it, w, s, e, n }) => ({
  type: "Feature",
  properties: {
    name: it.title,
    owner: it.owner,
    modified: it.modified ? new Date(it.modified).toISOString().slice(0, 10) : null,
    // The item id is kept only so a reader can reach the item page; the
    // overlay links to the SERVICE, which is what Scene Viewer can open on
    // its own without pulling in a whole web scene's other layers.
    id: it.id,
    service: it.url,
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
