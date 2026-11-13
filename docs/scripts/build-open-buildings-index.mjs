#!/usr/bin/env node
// Builds public/open-buildings/index.json: one row per Open Buildings 2.5D
// manifest (1 173 of them: 46 S2 cells x UTM zones x 8 years, about 950 KB
// each, 1.8 GB in all) with the manifest's name and its lon/lat bounds, so
// the `openbuildings://<year>` reader (lib/vrt-protocol.ts) can tell which
// one or two manifests a tile touches without fetching any of them. The
// bounds are the union of the tiles' footprints, reprojected from the UTM
// zone named in the manifest; the zone's proj4 string follows from the EPSG
// code, so no epsg.io lookup. Run once (about 10 min, the manifests are
// fetched through the Cloud Storage JSON API with 12 in flight), and again
// when Google adds a year:
//
//   node docs/scripts/build-open-buildings-index.mjs
//
// Output rows: [name, west, south, east, north, tiles], rounded to 1e-4
// degrees; a 60 KB file that is committed.

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import proj4 from "proj4"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, "../../public/open-buildings/index.json")
const API = "https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o"
const media = (object) => `${API}/${encodeURIComponent(object)}?alt=media`
const CONCURRENCY = 12

let token = ""
const names = []
for (let i = 0; i < 12; i++) {
  const j = await (await fetch(`${API}?prefix=v1/manifests/&maxResults=1000&fields=nextPageToken,items(name)${token ? `&pageToken=${token}` : ""}`)).json()
  names.push(...(j.items ?? []).map((o) => o.name).filter((n) => n.endsWith(".json")))
  if (!j.nextPageToken) break
  token = j.nextPageToken
}
names.sort()
console.log(`${names.length} manifests`)

const utm = (epsg) => `+proj=utm +zone=${epsg % 100}${epsg >= 32700 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`
const r4 = (v) => Math.round(v * 1e4) / 1e4

async function one(object) {
  const name = object.split("/").pop().replace(/\.json$/, "")
  const epsg = Number(/_EPSG_(\d+)_/.exec(name)?.[1])
  let manifest
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(media(object))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      manifest = await res.json()
      break
    } catch (e) {
      if (attempt >= 4) throw new Error(`${name}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  const sources = manifest.tilesets?.[0]?.sources ?? []
  let minX = Infinity, maxY = -Infinity, maxX = -Infinity, minY = Infinity
  for (const s of sources) {
    const a = s.affineTransform, d = s.dimensions
    minX = Math.min(minX, a.translateX)
    maxY = Math.max(maxY, a.translateY)
    maxX = Math.max(maxX, a.translateX + d.width * a.scaleX)
    minY = Math.min(minY, a.translateY + d.height * a.scaleY)
  }
  const to = proj4(utm(epsg), "WGS84")
  let w = 180, s = 90, e = -180, n = -90
  // Edges bow in a projected CRS: sample the boundary, not only the corners.
  const N = 8
  for (let i = 0; i <= N; i++) {
    for (const [x, y] of [[minX + ((maxX - minX) * i) / N, minY], [minX + ((maxX - minX) * i) / N, maxY], [minX, minY + ((maxY - minY) * i) / N], [maxX, minY + ((maxY - minY) * i) / N]]) {
      const [lng, lat] = to.forward([x, y])
      w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat)
    }
  }
  return [name, r4(w), r4(s), r4(e), r4(n), sources.length]
}

const rows = []
let next = 0, done = 0
const t0 = Date.now()
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < names.length) {
    const object = names[next++]
    rows.push(await one(object))
    done++
    if (done % 100 === 0) console.log(`  ${done}/${names.length} in ${Math.round((Date.now() - t0) / 1000)} s`)
  }
}))
rows.sort((a, b) => (a[0] < b[0] ? -1 : 1))
await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), rows }))
console.log(`wrote ${OUT}: ${rows.length} rows, ${rows.reduce((a, r) => a + r[5], 0)} tiles, ${Math.round((Date.now() - t0) / 1000)} s`)
