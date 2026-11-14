#!/usr/bin/env node
// Builds a VRT over the Kaguya (SELENE) Terrain Camera stereo DTMs that USGS
// Astrogeology published in 2024-2026 (collection
// kaguya_terrain_camera_usgs_dtms_v2_equi, about 10 to 30 m a pixel, Float32
// COGs on the astrogeo-ard S3 bucket, CORS and Range open). It plays the part
// the FlatGeobuf tile index of the August 2026 exploration was meant to play,
// with the machinery main already has: a VRT is the index, and vrt:// reads it
// in the browser.
//
// No header is read: the STAC items carry proj:shape and proj:transform (in
// GDAL GeoTransform order on this API, not rasterio's), so a whole region is a
// few paged searches.
//
// Every equirectangular strip is in IAU:30115, Moon (2015) sphere, clon = 180.
// A VRT in that CRS would put its seam (x = +-pi R) on the prime meridian, in
// the middle of the nearside. The VRT is written in the same projection with
// clon = 0 instead: on a sphere that is a pure shift of pi R in x, so every
// strip keeps its own pixels and only its DstRect moves, and the seam goes to
// the 180th meridian on the farside. A strip that straddles it is cut at the
// edge.
//
// Painting order: coarsest first, finest last (the last source wins where
// strips overlap, as in GDAL), so the sharpest model shows.
//
//   node docs/scripts/build-kaguya-vrt.mjs --bbox 2,24,6,28 --name apollo15 [--res 15] [--out public/vrt]
//
// The output is a built index: it is not committed. Like the Scotland VRTs it
// goes to the dataset-indexes release (pnpm datasets:push public/vrt/<file>),
// see docs/content/docs/dev/dataset-indexes.mdx and the Beta page
// docs/content/docs/beta/moon-lola.mdx.

import { writeFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const STAC = "https://stac.astrogeology.usgs.gov/api"
const COLLECTION = "kaguya_terrain_camera_usgs_dtms_v2_equi"
const R = 1737400
const HALF = Math.PI * R

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const bbox = arg("bbox", "2,24,6,28").split(",").map(Number)
const name = arg("name", "region")
const resArg = arg("res", null)
const OUT = resolve(arg("out", "public/vrt"))
if (bbox.length !== 4 || !bbox.every(Number.isFinite)) throw new Error("--bbox west,south,east,north")

async function search() {
  const items = []
  let req = { url: `${STAC}/search`, body: { collections: [COLLECTION], bbox, limit: 100 } }
  while (req) {
    const r = await fetch(req.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body) })
    if (!r.ok) throw new Error(`STAC search HTTP ${r.status}`)
    const page = await r.json()
    items.push(...page.features)
    const next = page.links?.find((l) => l.rel === "next")
    // An empty page with a next link has been seen on this API: stop there.
    req = next && page.features.length ? { url: next.href, body: next.body ?? { ...req.body, token: next.token } } : null
    console.log(`  ${items.length} items`)
  }
  return items
}

/** proj:transform as a GDAL GeoTransform, whichever order the item uses. */
function geoTransform(t) {
  // GDAL: [x0, px, 0, y0, 0, -py]; rasterio/affine: [px, 0, x0, 0, -py, y0].
  if (t[2] === 0 && t[4] === 0 && t[1] > 0) return t.slice(0, 6)
  return [t[2], t[0], t[1], t[5], t[3], t[4]]
}

const items = (await search()).filter((f) => f.assets?.dtm && f.properties?.["proj:shape"] && f.properties?.["proj:transform"])
const crs = new Set(items.map((f) => /AUTHORITY\["IAU","(\d+)"\]\]$/.exec(f.properties["proj:wkt2"] ?? "")?.[1]))
if (crs.size !== 1 || !crs.has("30115")) throw new Error(`expected every item in IAU:30115, got ${[...crs].join(", ")}`)

const strips = items.map((f) => {
  const [rows, cols] = f.properties["proj:shape"]
  const [x0, px, , y0, , py] = geoTransform(f.properties["proj:transform"])
  const band = f.assets.dtm["raster:bands"]?.[0] ?? {}
  // clon 180 -> clon 0: a shift of half the circumference, back into [-pi R, pi R).
  const x = x0 < 0 ? x0 + HALF : x0 - HALF
  return { id: f.id, href: f.assets.dtm.href, cols, rows, x, y: y0, px, py: Math.abs(py), nodata: band.nodata ?? -32767, valid: band.statistics?.valid_percent ?? 0 }
})
if (!strips.length) throw new Error("no strips in that bbox")

const res = resArg ? Number(resArg) : Math.min(...strips.map((s) => s.px))
let minX = Infinity, maxY = -Infinity, maxX = -Infinity, minY = Infinity
for (const s of strips) {
  minX = Math.min(minX, s.x); maxY = Math.max(maxY, s.y)
  maxX = Math.max(maxX, s.x + s.cols * s.px); minY = Math.min(minY, s.y - s.rows * s.py)
}
strips.sort((a, b) => b.px - a.px || a.valid - b.valid)
const W = Math.round((maxX - minX) / res), H = Math.round((maxY - minY) / res)
const parts = [
  `<!-- Kaguya TC DTMs v2 (USGS Astrogeology, CC0), ${strips.length} strips over bbox ${bbox.join(",")} (lunar lon/lat).`,
  `     Built by docs/scripts/build-kaguya-vrt.mjs from ${STAC} on ${new Date().toISOString().slice(0, 10)}. Heights in metres above the 1737.4 km sphere. -->`,
  `<VRTDataset rasterXSize="${W}" rasterYSize="${H}">`,
  `  <SRS>+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs</SRS>`,
  `  <GeoTransform>${minX}, ${res}, 0, ${maxY}, 0, -${res}</GeoTransform>`,
  `  <VRTRasterBand dataType="Float32" band="1">`,
  `    <NoDataValue>-32767</NoDataValue>`,
  `    <ColorInterp>Gray</ColorInterp>`,
]
for (const s of strips) {
  parts.push(
    `    <ComplexSource>`,
    `      <SourceFilename relativeToVRT="0">${s.href}</SourceFilename>`,
    `      <SourceBand>1</SourceBand>`,
    `      <SourceProperties RasterXSize="${s.cols}" RasterYSize="${s.rows}" DataType="Float32" />`,
    `      <SrcRect xOff="0" yOff="0" xSize="${s.cols}" ySize="${s.rows}" />`,
    `      <DstRect xOff="${Math.round((s.x - minX) / res)}" yOff="${Math.round((maxY - s.y) / res)}" xSize="${Math.round((s.cols * s.px) / res)}" ySize="${Math.round((s.rows * s.py) / res)}" />`,
    `      <NODATA>${s.nodata}</NODATA>`,
    `    </ComplexSource>`,
  )
}
parts.push(`  </VRTRasterBand>`, `</VRTDataset>`, ``)
await mkdir(OUT, { recursive: true })
const file = resolve(OUT, `kaguya-tc-dtm-${name}.vrt`)
await writeFile(file, parts.join("\n"))
const deg = (m) => (m / R) * (180 / Math.PI)
console.log(`wrote ${file}: ${strips.length} sources, ${W} x ${H} px at ${res.toFixed(2)} m`)
console.log(`lunar lon/lat bounds [${[deg(minX), deg(minY), deg(maxX), deg(maxY)].map((v) => v.toFixed(2)).join(", ")}]`)
