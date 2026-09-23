#!/usr/bin/env node
// Builds public/coverage/flai-open-lidar.geojson: the open LiDAR point clouds
// FLAI publishes at hub.flai.ai, as one footprint per dataset.
//
// FLAI's public API lists the datasets but carries NO geometry - there is no
// `geometry`, `bbox` or `extent` field, `?decorators=geometry` is ignored, and
// the hub map itself only declares two MapTiler basemaps. The footprint has to
// come from the data.
//
// Each dataset has an `overview` COPC (`.../overview/overview.copc.laz`) on a
// public S3 bucket that honours Range requests. A COPC is a LAZ file, and a
// LAZ file starts with an UNCOMPRESSED LAS 1.4 public header, whose bytes
// 179-227 are max/min X, Y and Z as little-endian doubles. So one 512-byte
// range request per dataset gives its full extent, in the dataset's own CRS,
// without downloading any points - the Slovenia overview is 22 GB and this
// reads half a kilobyte of it.
//
// Extents are then reprojected to WGS84 with proj4, resolving each SRID
// through epsg.io the same way lib/vrt-protocol.ts does.
//
// A bounding box is an honest overstatement: Finland's national survey is a
// rectangle here, and that rectangle clips Sweden and Russia. The overlay
// draws these hollow for exactly that reason. Reading real occupancy would
// mean walking each COPC's octree hierarchy, which is a much larger job for a
// layer whose question is "is there open LiDAR near here at all".
//
//   node docs/scripts/build-flai-coverage.mjs

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import proj4 from "proj4"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(process.argv[2] ?? resolve(HERE, "../../public/coverage/flai-open-lidar.geojson"))
const API = "https://api.flai.ai/public/datasets/open-data?order_by=start_acquisition_date&order_direction=desc"
const CONCURRENCY = 12

const defs = new Map([["4326", "WGS84"], ["3857", "EPSG:3857"]])
// epsg.io hands out `+nadgrids=<file>.tif` for a few national grids - OSGB36
// (EPSG:27700) is the one here - and proj4js cannot load a grid file, so every
// UK dataset reprojected to NaN. Dropping the grid and falling back to the
// published Helmert parameters costs about a metre, against a footprint that
// is a country-sized rectangle.
const HELMERT = { 27700: "+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489" }
async function projFor(srid) {
  const key = String(srid)
  if (!defs.has(key)) {
    const r = await fetch(`https://epsg.io/${key}.proj4`)
    if (!r.ok) throw new Error(`no proj4 definition for EPSG:${key}`)
    let def = (await r.text()).trim()
    if (/\+nadgrids=/.test(def)) {
      def = def.replace(/\+nadgrids=\S+\s*/g, "")
      if (HELMERT[srid] && !/\+towgs84=/.test(def)) def += ` ${HELMERT[srid]}`
    }
    defs.set(key, def)
  }
  return proj4(defs.get(key), "WGS84")
}

/** max/min X and Y out of a LAS 1.4 public header. */
function extentFromLasHeader(b) {
  if (b.length < 227 || b.subarray(0, 4).toString("ascii") !== "LASF") return null
  const maxX = b.readDoubleLE(179), minX = b.readDoubleLE(187)
  const maxY = b.readDoubleLE(195), minY = b.readDoubleLE(203)
  if (![maxX, minX, maxY, minY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return null
  return { minX, minY, maxX, maxY }
}

const res = await fetch(API)
if (!res.ok) throw new Error(`${res.status} from the FLAI API`)
const items = (await res.json()).items ?? []
console.log(`${items.length} open datasets listed`)

const features = []
const failures = []
const queue = [...items]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const it = queue.shift()
    if (!it) return
    const overview = it.overview ?? (it.path ? `${it.path}/overview/overview.copc.laz` : null)
    if (!overview || !it.datasource_url) { failures.push(`${it.dataset_name}: no overview path`); continue }
    const url = `${it.datasource_url.replace(/\/$/, "")}/${overview}`
    try {
      const r = await fetch(url, { headers: { Range: "bytes=0-511" } })
      if (!r.ok) { failures.push(`${it.dataset_name}: HTTP ${r.status}`); continue }
      const ext = extentFromLasHeader(Buffer.from(await r.arrayBuffer()))
      if (!ext) { failures.push(`${it.dataset_name}: unreadable LAS header`); continue }
      const to = await projFor(it.srid)
      // All four corners, not two: a projected grid's edges bow in lng/lat.
      const corners = [[ext.minX, ext.minY], [ext.maxX, ext.minY], [ext.maxX, ext.maxY], [ext.minX, ext.maxY]]
        .map(([x, y]) => to.forward([x, y]))
      if (!corners.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90)) {
        failures.push(`${it.dataset_name}: EPSG:${it.srid} gave a non-finite corner`)
        continue
      }
      const ring = [...corners, corners[0]].map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5])
      const year = (it.start_acquisition_date ?? "").slice(0, 4)
      features.push({
        type: "Feature",
        properties: {
          name: it.dataset_name,
          year,
          density: it.pointcloud_dataset_point_density ? Math.round(it.pointcloud_dataset_point_density * 10) / 10 : null,
          srid: it.srid,
          licence: it.licences ?? null,
          url: it.url ?? null,
        },
        geometry: { type: "Polygon", coordinates: [ring] },
      })
    } catch (e) { failures.push(`${it.dataset_name}: ${e.message}`) }
  }
}))

features.sort((a, b) => (b.properties.year ?? "").localeCompare(a.properties.year ?? ""))
await mkdir(dirname(OUT), { recursive: true })
const body = JSON.stringify({ type: "FeatureCollection", features })
await writeFile(OUT, body)
console.log(`${features.length} footprints, ${failures.length} skipped, ${(body.length / 1024).toFixed(0)} KB -> ${OUT}`)
for (const f of failures.slice(0, 20)) console.log(`  skipped ${f}`)
