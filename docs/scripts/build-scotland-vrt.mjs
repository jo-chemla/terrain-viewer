#!/usr/bin/env node
// Builds the Scotland LiDAR VRTs from the Scottish Remote Sensing Portal's
// open S3 bucket (srsp-open-data, CORS-open, Range-capable): one VRT per
// product (DTM, DSM) over every gridded Float32 COG of the LiDAR phases 1 to
// 6, the National LiDAR Programme, Orkney and the Outer Hebrides, in
// EPSG:27700 at 0.5 m (the 1 m files of phases 1 and 2 are placed at twice
// their size), newest campaign painted last so it wins where they overlap.
// There is no VRT on the bucket and no listing of extents: each file's
// header is read once here (width, height, tiepoint, pixel scale, nodata,
// overview count), 24 in flight, about 8 000 files per product.
//
// The files of phases 1 and 2 carry no overviews, which the in-browser
// reader refuses below the zoom where a tile would decode more than 8 Mpx
// of one file; so a second pair of VRTs holds only the files with
// overviews, and the library entries use those for the map and the full
// ones through titiler.
//
//   node docs/scripts/build-scotland-vrt.mjs [outDir]   (default .cache/scotland)
//
// The VRTs (3 to 4 MB each) are not committed: they go to the datasets-2026-11-13
// GitHub release, and the Pages deploy copies them into dist/vrt/.

import { writeFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { fromUrl } from "geotiff"

const BUCKET = "https://srsp-open-data.s3.eu-west-2.amazonaws.com"
const OUT = resolve(process.argv[2] ?? ".cache/scotland")
const CONCURRENCY = 24
// Painting order: oldest first, newest last.
const CAMPAIGNS = [
  ["phase-1", "2011-2012"], ["phase-2", "2012-2014"], ["phase-3", "2015-2016"], ["phase-4", "2017-2018"],
  ["phase-5", "2019-2020"], ["outer-hebrides", "2019"], ["phase-6", "2020-2022"],
  ["orkney-islands-council-23", "2023"], ["national-lidar-programme", "2021-2024"],
]

async function listKeys(prefix) {
  const keys = []
  let token = ""
  for (;;) {
    const u = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ""}`
    const xml = await (await fetch(u)).text()
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) if (m[1].endsWith(".tif")) keys.push(m[1])
    const next = /<NextContinuationToken>([^<]+)</.exec(xml)
    if (!next) break
    token = next[1].replace(/&amp;/g, "&")
  }
  return keys
}

async function header(key) {
  const url = `${BUCKET}/${key}`
  for (let attempt = 0; ; attempt++) {
    try {
      const tiff = await fromUrl(url)
      const img = await tiff.getImage(0)
      const fd = img.fileDirectory
      const [sx, sy] = img.getResolution()
      const [ox, oy] = img.getOrigin()
      const nd = fd.GDAL_NODATA != null ? Number(String(fd.GDAL_NODATA).replace(/\0/g, "")) : null
      const levels = await tiff.getImageCount()
      return { key, url, w: img.getWidth(), h: img.getHeight(), sx: Math.abs(sx), sy: Math.abs(sy), ox, oy, nd, levels }
    } catch (e) {
      if (attempt >= 3) { console.warn(`  skip ${key}: ${e.message}`); return null }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    }
  }
}

async function product(kind) {
  const files = []
  for (const [campaign, years] of CAMPAIGNS) {
    // Every campaign keeps the same layout: lidar/<campaign>/<dtm|dsm>/27700/gridded/*.tif
    const keys = await listKeys(`lidar/${campaign}/${kind}/27700/gridded/`)
    console.log(`${kind} ${campaign} (${years}): ${keys.length} files`)
    for (const key of keys) files.push({ key, campaign, years })
  }
  const heads = new Array(files.length)
  let next = 0, done = 0
  const t0 = Date.now()
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < files.length) {
      const i = next++
      heads[i] = await header(files[i].key)
      if (++done % 500 === 0) console.log(`  ${done}/${files.length} headers in ${Math.round((Date.now() - t0) / 1000)} s`)
    }
  }))
  const ok = heads.map((h, i) => h && { ...h, ...files[i] }).filter(Boolean)
  const scale = 0.5
  let minX = Infinity, maxY = -Infinity, maxX = -Infinity, minY = Infinity
  for (const f of ok) {
    minX = Math.min(minX, f.ox); maxY = Math.max(maxY, f.oy)
    maxX = Math.max(maxX, f.ox + f.w * f.sx); minY = Math.min(minY, f.oy - f.h * f.sy)
  }
  const write = async (name, subset) => {
    const W = Math.round((maxX - minX) / scale), H = Math.round((maxY - minY) / scale)
    const parts = [
      `<VRTDataset rasterXSize="${W}" rasterYSize="${H}">`,
      `  <SRS>EPSG:27700</SRS>`,
      `  <GeoTransform>${minX}, ${scale}, 0, ${maxY}, 0, -${scale}</GeoTransform>`,
      `  <VRTRasterBand dataType="Float32" band="1">`,
      `    <NoDataValue>-9999</NoDataValue>`,
      `    <ColorInterp>Gray</ColorInterp>`,
    ]
    for (const f of subset) {
      parts.push(
        `    <ComplexSource>`,
        `      <SourceFilename relativeToVRT="0">${f.url}</SourceFilename>`,
        `      <SourceBand>1</SourceBand>`,
        `      <SourceProperties RasterXSize="${f.w}" RasterYSize="${f.h}" DataType="Float32" />`,
        `      <SrcRect xOff="0" yOff="0" xSize="${f.w}" ySize="${f.h}" />`,
        `      <DstRect xOff="${Math.round((f.ox - minX) / scale)}" yOff="${Math.round((maxY - f.oy) / scale)}" xSize="${Math.round((f.w * f.sx) / scale)}" ySize="${Math.round((f.h * f.sy) / scale)}" />`,
        `      <NODATA>${f.nd ?? -9999}</NODATA>`,
        `    </ComplexSource>`,
      )
    }
    parts.push(`  </VRTRasterBand>`, `</VRTDataset>`, ``)
    await writeFile(resolve(OUT, name), parts.join("\n"))
    console.log(`wrote ${name}: ${subset.length} sources, ${W} x ${H} px`)
  }
  await write(`scotland-${kind}.vrt`, ok)
  await write(`scotland-${kind}-overviews.vrt`, ok.filter((f) => f.levels > 1))
  const byCampaign = {}
  for (const f of ok) { const k = `${f.campaign} ${f.years}`; byCampaign[k] ??= { files: 0, noOverviews: 0, res: new Set() }; byCampaign[k].files++; if (f.levels <= 1) byCampaign[k].noOverviews++; byCampaign[k].res.add(f.sx) }
  console.log(kind, JSON.stringify(Object.fromEntries(Object.entries(byCampaign).map(([k, v]) => [k, { ...v, res: [...v.res] }]))))
  // lon/lat bounds for the library entry, EPSG:27700 -> WGS84
  const proj4 = (await import("proj4")).default
  const to = proj4("+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs", "WGS84")
  let w = 180, s = 90, e = -180, n = -90
  for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]) { const [lng, lat] = to.forward([x, y]); w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat) }
  console.log(`${kind} bounds [${[w, s, e, n].map((v) => Math.round(v * 100) / 100).join(", ")}], ${ok.length} files, ${Math.round((Date.now() - t0) / 1000)} s`)
}

await mkdir(OUT, { recursive: true })
await product("dtm")
await product("dsm")
