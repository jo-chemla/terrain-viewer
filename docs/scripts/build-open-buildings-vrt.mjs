#!/usr/bin/env node
// Turns a Google Open Buildings 2.5D "temporal" manifest into a GDAL VRT, so
// the building-height band can be read as an elevation source.
//
// Open Buildings 2.5D is the only *periodic* open building-height product
// there is: 2016 through 2023, one raster per year, at 0.5 m. Google publishes
// it as Earth Engine image manifests rather than as anything a map can open:
//
//   https://storage.googleapis.com/open-buildings-temporal-data
//     /v1/manifests/<s2cell>_EPSG_<code>_<year>_06_30.json
//
// 39 S2 cells x 73 UTM zones x 8 years = 1 173 manifests. Each is ~950 KB of
// JSON listing a few thousand tiles with an `affineTransform` and `dimensions`
// apiece - which is exactly a VRT's `<DstRect>`, just spelled differently.
//
// The tiles themselves are real COGs: 25 000 x 25 000 at 0.5 m, three Float32
// bands, 512 px tiles, deflate, fourteen overview levels. Band 2 is
// `building_height` (band 1 is `building_fractional_count`, band 3 is
// `building_presence`), and -99 is nodata.
//
// Two things decide how this has to be wired:
//
//  - **No CORS.** storage.googleapis.com serves these objects publicly and
//    answers Range requests, but sends no `Access-Control-Allow-Origin` even
//    when asked with an Origin - so a browser cannot read them and the source
//    must be pinned to titiler, which fetches server-side. That is what the
//    per-source "Always serve via titiler" switch is for.
//  - `uriPrefix` ends mid-token (`.../v1/geotiffs/00`) and each source uri
//    starts with the rest of it (`9d4_2023_06_30/tile_....tif`), so they
//    concatenate with no separator. Joining them with a slash 404s everything.
//
// The VRT it writes has to be reachable by titiler, i.e. served from the
// deployed site, so these land in public/vrt/ and the library entry points at
// the public URL.
//
//   node docs/scripts/build-open-buildings-vrt.mjs 01_EPSG_32723_2023_06_30
//   node docs/scripts/build-open-buildings-vrt.mjs --list

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const BUCKET = "https://storage.googleapis.com/open-buildings-temporal-data"
const OUT_DIR = resolve(HERE, "../../public/vrt")
/** 1-based, as in a VRT's <SourceBand>. */
const HEIGHT_BAND = 2
const NODATA = -99

if (process.argv[2] === "--list") {
  let token = "", all = []
  for (let i = 0; i < 12; i++) {
    const u = `https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o?prefix=v1/manifests/&maxResults=1000${token ? `&pageToken=${token}` : ""}`
    const j = await (await fetch(u)).json()
    all.push(...(j.items ?? []).map((o) => o.name.split("/").pop()).filter((n) => n.endsWith(".json")))
    if (!j.nextPageToken) break
    token = j.nextPageToken
  }
  console.log(`${all.length} manifests`)
  const byCell = new Map()
  for (const n of all) {
    const m = /^(\w+?)_EPSG_(\d+)_(\d{4})/.exec(n)
    if (!m) continue
    const k = `${m[1]} EPSG:${m[2]}`
    if (!byCell.has(k)) byCell.set(k, [])
    byCell.get(k).push(m[3])
  }
  for (const [k, years] of [...byCell].sort()) console.log(`  ${k.padEnd(18)} ${years.sort().join(" ")}`)
  process.exit(0)
}

const NAME = process.argv[2] ?? "01_EPSG_32723_2023_06_30"
const epsg = Number(/_EPSG_(\d+)_/.exec(NAME)?.[1])
if (!epsg) throw new Error(`cannot read an EPSG code out of "${NAME}"`)

const manifest = await (await fetch(`${BUCKET}/v1/manifests/${NAME}.json`)).json()
const sources = manifest.tilesets?.[0]?.sources ?? []
if (!sources.length) throw new Error("manifest lists no sources")
// uriPrefix deliberately ends mid-token; see the header.
const prefix = manifest.uriPrefix.replace("gs://open-buildings-temporal-data/", "")

// Union extent and the pixel size, straight off the affine transforms.
let minX = Infinity, maxY = -Infinity, maxX = -Infinity, minY = Infinity, scale = 0
for (const s of sources) {
  const a = s.affineTransform, d = s.dimensions
  scale = a.scaleX
  minX = Math.min(minX, a.translateX)
  maxY = Math.max(maxY, a.translateY)
  maxX = Math.max(maxX, a.translateX + d.width * a.scaleX)
  minY = Math.min(minY, a.translateY + d.height * a.scaleY)
}
const width = Math.round((maxX - minX) / scale)
const height = Math.round((maxY - minY) / scale)
console.log(`${NAME}: ${sources.length} tiles, EPSG:${epsg}, ${scale} m, ${width} x ${height} px`)
console.log(`  extent ${Math.round(minX)}, ${Math.round(minY)} .. ${Math.round(maxX)}, ${Math.round(maxY)}`)

// Print the lng/lat bounds too. Guessing them from the UTM numbers by eye put
// the first library entry 1.5 degrees west of the data, so the entry looked
// broken over Sao Paulo when the cell actually starts at Rio.
try {
  const proj4 = (await import("proj4")).default
  const def = (await (await fetch(`https://epsg.io/${epsg}.proj4`)).text()).trim()
  const to = proj4(def, "WGS84")
  let w = 180, s2 = 90, e = -180, n = -90
  for (const [cx, cy] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]) {
    const [lng, lat] = to.forward([cx, cy])
    w = Math.min(w, lng); e = Math.max(e, lng); s2 = Math.min(s2, lat); n = Math.max(n, lat)
  }
  const r = (v) => Math.round(v * 100) / 100
  console.log(`  bounds for the library entry: [${r(w)}, ${r(s2)}, ${r(e)}, ${r(n)}]`)
} catch (err) { console.log(`  (could not reproject the extent: ${err.message})`) }

const parts = [
  `<VRTDataset rasterXSize="${width}" rasterYSize="${height}">`,
  `  <SRS>EPSG:${epsg}</SRS>`,
  `  <GeoTransform>${minX}, ${scale}, 0, ${maxY}, 0, -${scale}</GeoTransform>`,
  `  <VRTRasterBand dataType="Float32" band="1">`,
  `    <NoDataValue>${NODATA}</NoDataValue>`,
  `    <ColorInterp>Gray</ColorInterp>`,
]
for (const s of sources) {
  const a = s.affineTransform, d = s.dimensions
  const url = `${BUCKET}/${prefix}${s.uris[0]}`
  const dstX = Math.round((a.translateX - minX) / scale)
  const dstY = Math.round((maxY - a.translateY) / scale)
  parts.push(
    `    <ComplexSource>`,
    `      <SourceFilename relativeToVRT="0">/vsicurl/${url}</SourceFilename>`,
    `      <SourceBand>${HEIGHT_BAND}</SourceBand>`,
    `      <SourceProperties RasterXSize="${d.width}" RasterYSize="${d.height}" DataType="Float32" BlockXSize="512" BlockYSize="512" />`,
    `      <SrcRect xOff="0" yOff="0" xSize="${d.width}" ySize="${d.height}" />`,
    `      <DstRect xOff="${dstX}" yOff="${dstY}" xSize="${d.width}" ySize="${d.height}" />`,
    `      <NODATA>${NODATA}</NODATA>`,
    `    </ComplexSource>`,
  )
}
parts.push(`  </VRTRasterBand>`, `</VRTDataset>`, "")

const out = resolve(OUT_DIR, `open-buildings-${NAME}.vrt`)
await mkdir(OUT_DIR, { recursive: true })
const body = parts.join("\n")
await writeFile(out, body)
console.log(`  -> ${out} (${(body.length / 1024).toFixed(0)} KB)`)
