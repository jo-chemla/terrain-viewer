// NASA Goddard's G-LiHT (LiDAR, Hyperspectral and Thermal imager) catalog as
// a coverage overlay (Source Info > Coverage > 3D and LiDAR coverage):
// 1 521 campaigns, 68 850 cells, 2011-2026, Alaska to Yucatan.
//
//   node scripts/build-gliht-coverage.mjs
//   pnpm datasets:push public/coverage/gliht.geojson   # then commit the lock
//
// Why a baked file and not a live read: glihtdata.gsfc.nasa.gov sends no
// Access-Control-Allow-Origin header (tested 2026-11-24 on .kmz, .tar.gz and
// the index below, GET and OPTIONS), so a browser on another origin cannot
// read anything there. Its own webmap reads one index, DATA/flightData.js
// (23 MB, `var flightData = {...}`: per campaign the date, bounds, file sizes
// and every cell's corner quad). Node has no CORS, so it is read here, as
// JSON text (never evaluated), and reduced to one MultiPolygon per campaign.
//
// What the popup says about each campaign comes from that index and from
// the format tests written up in docs/content/docs/dev/g-liht.mdx: the
// elevation itself is only in gzip archives (not range-readable), the KMZ
// files hold a pre-rendered greyscale hillshade, and OpenTopography re-hosts
// the 2013 Yucatan transects as COGs (the two G-LiHT library entries).
import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, "..", "public", "coverage")
mkdirSync(out, { recursive: true })

const BASE = "https://glihtdata.gsfc.nasa.gov"
const res = await fetch(`${BASE}/DATA/flightData.js`)
if (!res.ok) throw new Error(`flightData.js: HTTP ${res.status}`)
const text = await res.text()
const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))

// The 2013 AMIGA-Carb Yucatan transects Britton et al. re-classified and
// OpenTopography hosts as 0.5 m COGs (MX13E_Britton / MX13W_Britton, whose
// VRTs list these folders: Yuc_Norte, Yuc_North2, Yuc_Centro, Yuc_South,
// Yuc_Out_Yuc, Yuc_Campeche, Yuc_Chiaps1).
const ON_OT = /^AMIGACarb_(Yuc_(Norte|North_2|Centro|South)|Out_of_the_Yuc|Chiap_Campeche|Chiaps_1)_(GLAS|NFI)_/

const R = 6371008.8, rad = Math.PI / 180
// Three decimals (~100 m, what build-opentopo-coverage simplifies to) is
// plenty for a footprint: 5.6 MB (1 MB gzipped) against 7.6 MB at five.
const round = (v) => Math.round(v * 1e3) / 1e3
function quadKm2(b) {
  const lat0 = b[0] * rad
  const p = []
  for (let i = 0; i < b.length; i += 2) p.push([b[i + 1] * rad * R * Math.cos(lat0), b[i] * rad * R])
  let a = 0
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1 }
  return Math.abs(a) / 2 / 1e6
}

const features = []
let cells = 0, km2 = 0
for (const [id, c] of Object.entries(data)) {
  const polys = []
  let area = 0, strips = 0
  // Grid cells (cXrY, 1 km tiles of a block) are merged along each row:
  // a run of adjacent columns becomes one quad from the first cell's west
  // corners to the last one's east corners.
  // Strip cells (lNsM) stay one quad each:
  // consecutive segments of a line do not share an edge.
  const grid = new Map() // row -> Map(col -> bounds)
  let n = 0
  for (const [name, cell] of Object.entries(c.cells ?? {})) {
    const b = cell.bounds // [lat, lon] x 4 corners, counter-clockwise from south-west
    if (!Array.isArray(b) || b.length < 8) continue
    n++
    area += quadKm2(b)
    if (/^l\d+s\d+$/.test(name)) strips++
    const g = /^c(\d+)r(\d+)$/.exec(name)
    if (g) {
      const row = grid.get(+g[2]) ?? new Map()
      row.set(+g[1], b)
      grid.set(+g[2], row)
      continue
    }
    const ring = []
    for (let i = 0; i < 8; i += 2) ring.push([round(b[i + 1]), round(b[i])])
    ring.push(ring[0])
    polys.push([ring])
  }
  for (const row of grid.values()) {
    const cols = [...row.keys()].sort((a, z) => a - z)
    for (let i = 0; i < cols.length;) {
      let j = i
      while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++
      const w = row.get(cols[i]), e = row.get(cols[j])
      // corners: 0 south-west, 1 south-east, 2 north-east, 3 north-west
      const ring = [[w[1], w[0]], [e[3], e[2]], [e[5], e[4]], [w[7], w[6]]].map(([x, y]) => [round(x), round(y)])
      ring.push(ring[0])
      polys.push([ring])
      i = j + 1
    }
  }
  if (!polys.length) continue
  cells += n
  km2 += area
  const fs = c.file_sizes ?? {}
  const mb = (kb) => (typeof kb === "number" && kb > 0 ? Math.round(kb / 1024) : undefined)
  // Cell names tell the layout: lNsM is flight line N, segment M (a strip
  // a few hundred metres wide); cXrY is a 1 km grid tile of a block flown
  // wall to wall (a forest plot, a watershed, a whole settlement zone).
  const block = strips < n / 2
  // AMIGA-Carb and the newer "kml folder" campaigns ship one .tar.gz of
  // per-cell GeoTIFFs and one KMZ per cell; the rest one .tif.gz mosaic and
  // one KMZ for the campaign (map.js getUrl()).
  const perCell = id.startsWith("AMIGACarb") || c.hasKMLFolder
  features.push({ type: "Feature", geometry: { type: "MultiPolygon", coordinates: polys }, properties: {
    id, date: typeof c.date === "string" ? c.date : undefined, cells: n, km2: Math.round(area * 10) / 10,
    layout: block ? "block" : "strips",
    dtmMB: mb(fs.dtm_tif), chmMB: mb(fs.chm_tif), dtmKmzMB: mb(fs.dtm_kml),
    archive: perCell ? "tar.gz" : "tif.gz",
    ot: ON_OT.test(id) || undefined,
  } })
}
const geojson = { type: "FeatureCollection", features }
const json = JSON.stringify(geojson)
writeFileSync(join(out, "gliht.geojson"), json)
console.log(`gliht.geojson: ${features.length} campaigns, ${cells} cells, ${Math.round(km2)} km2 of cell footprints, ${features.filter((f) => f.properties.layout === "block").length} wall-to-wall blocks, ${(json.length / 1024 / 1024).toFixed(1)} MB`)
