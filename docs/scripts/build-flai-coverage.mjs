#!/usr/bin/env node
// Builds public/coverage/flai-open-lidar.geojson: the open LiDAR point clouds
// FLAI publishes at hub.flai.ai, as a real footprint per dataset.
//
// ## Where the geometry is (not in the API)
//
// FLAI's public API lists 114 datasets and carries no geometry whatsoever -
// no `geometry`, `bbox` or `extent` field, `?decorators=geometry` is ignored,
// and the only match for /polygon/i in the whole 268 KB response is the field
// name `poi_polygons_dataset_id`, which is null on every entry. The hub map's
// own frontend bundle says how it does it: "Show COPC file extents". It reads
// the data.
//
// So does this. Each dataset has an `overview` COPC on a public S3 bucket that
// honours Range requests, and a COPC is an octree with a published index:
//
//   - LAS 1.4 public header, 375 bytes, uncompressed even in a LAZ.
//   - The `copc info` VLR - 54-byte VLR header at 375, 160-byte payload at
//     429 - carrying the octree centre, halfsize, and the offset/size of the
//     root hierarchy page.
//   - Hierarchy entries, 32 bytes each: level/x/y/z as four int32, offset as
//     uint64, byteSize and pointCount as int32. pointCount -1 means the entry
//     points at a child PAGE rather than a node.
//
// Occupied nodes at a given level ARE the footprint, the same way Bing's
// subtree bitstream is (see build-bing-3d-coverage.mjs, whose dissolve this
// reuses). France comes out at 5 387 of 16 384 possible level-7 cells, 33% of
// its bounding box - and France is 337 000 km² inside a 1 057 × 1 065 km box,
// which is 30%. The shape is right.
//
// One trap worth stating: only nodes at or BELOW the target level may be
// counted. A COPC keeps a coarse sample at every ancestor, so a level-0 node
// exists for the whole dataset, and projecting ancestors downward fills the
// entire square - every dataset then reports 100% coverage of its own bbox,
// which looks plausible and is meaningless.
//
// Footprints are reprojected from each dataset's own CRS with proj4, resolving
// SRIDs through epsg.io the way lib/vrt-protocol.ts does.
//
//   node docs/scripts/build-flai-coverage.mjs        # -> public/coverage/flai-open-lidar.geojson
//   node docs/scripts/build-flai-coverage.mjs 8      # finer cells, more requests

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import proj4 from "proj4"

const HERE = dirname(fileURLToPath(import.meta.url))
const TARGET_LEVEL = Number(process.argv[2] ?? 7)
const OUT = resolve(process.argv[3] ?? resolve(HERE, "../../public/coverage/flai-open-lidar.geojson"))
const API = "https://api.flai.ai/public/datasets/open-data?order_by=start_acquisition_date&order_direction=desc"
const CONCURRENCY = 8

// ── projections ──────────────────────────────────────────────────────────────
const defs = new Map([["4326", "WGS84"], ["3857", "EPSG:3857"]])
// epsg.io hands out `+nadgrids=<file>.tif` for a few national grids - OSGB36
// (EPSG:27700) is the one here - and proj4js cannot load a grid file, so every
// UK dataset reprojected to NaN. Dropping the grid and falling back to the
// published Helmert parameters costs about a metre.
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

// ── COPC reading ─────────────────────────────────────────────────────────────
async function range(url, from, to) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } })
      if (r.ok || r.status === 206) return Buffer.from(await r.arrayBuffer())
      if (r.status === 403 || r.status === 404) return null
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 400 * (t + 1)))
  }
  return null
}

/** The LAS public header's own extent, the fallback when there is no octree. */
function headerExtent(head) {
  const maxX = head.readDoubleLE(179), minX = head.readDoubleLE(187)
  const maxY = head.readDoubleLE(195), minY = head.readDoubleLE(203)
  if (![maxX, minX, maxY, minY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return null
  // One cell covering the whole box, so the caller's dissolve path is unchanged.
  return { cells: [[0, 0]], size: Math.max(maxX - minX, maxY - minY), minX, minY, pages: 1, approximate: true }
}

async function copcCells(url, level) {
  const head = await range(url, 0, 700)
  if (!head || head.length < 600 || head.subarray(0, 4).toString("ascii") !== "LASF") return null
  // A few overviews are plain LAZ with no `copc` VLR and so no octree; their
  // bounding box is all there is, and a rectangle beats dropping the dataset.
  if (head.subarray(377, 377 + 4).toString("ascii") !== "copc") return headerExtent(head)
  const info = head.subarray(429)
  const centerX = info.readDoubleLE(0), centerY = info.readDoubleLE(8)
  const halfsize = info.readDoubleLE(24)
  const rootOffset = Number(info.readBigUInt64LE(40)), rootSize = Number(info.readBigUInt64LE(48))
  if (!(halfsize > 0) || !(rootSize > 0)) return headerExtent(head)

  const nodes = []
  let pages = 0
  async function readPage(offset, size, depth) {
    if (depth > 8 || size <= 0 || size > 8e6 || pages > 4000) return
    pages++
    const buf = await range(url, offset, offset + size - 1)
    if (!buf) return
    for (let i = 0; i + 32 <= buf.length; i += 32) {
      const lvl = buf.readInt32LE(i)
      const x = buf.readInt32LE(i + 4), y = buf.readInt32LE(i + 8)
      const childOffset = Number(buf.readBigUInt64LE(i + 16))
      const byteSize = buf.readInt32LE(i + 24)
      const pointCount = buf.readInt32LE(i + 28)
      if (pointCount === -1) {
        // One level past the target is enough: a deeper page can only refine
        // cells this one already reports.
        if (lvl <= level + 1) await readPage(childOffset, byteSize, depth + 1)
      } else if (pointCount > 0 && lvl >= level) {
        const f = 2 ** (lvl - level)
        nodes.push([Math.floor(x / f), Math.floor(y / f)])
      }
    }
  }
  await readPage(rootOffset, rootSize, 0)
  if (!nodes.length) return headerExtent(head)
  const cells = new Set(nodes.map(([x, y]) => `${x},${y}`))
  return {
    cells: [...cells].map((k) => k.split(",").map(Number)),
    size: (halfsize * 2) / 2 ** level,
    minX: centerX - halfsize,
    minY: centerY - halfsize,
    pages,
  }
}

// ── dissolve (from build-bing-3d-coverage.mjs) ───────────────────────────────
function traceRings(cells) {
  const edges = new Map()
  const key = (a, b) => `${a[0]},${a[1]}|${b[0]},${b[1]}`
  for (const [x, y] of cells) {
    for (const [a, b] of [[[x, y], [x + 1, y]], [[x + 1, y], [x + 1, y + 1]], [[x + 1, y + 1], [x, y + 1]], [[x, y + 1], [x, y]]]) {
      const twin = key(b, a)
      if (edges.has(twin)) edges.delete(twin)
      else edges.set(key(a, b), [a, b])
    }
  }
  const from = new Map()
  for (const [, [a, b]] of edges) {
    const k = `${a[0]},${a[1]}`
    if (!from.has(k)) from.set(k, [])
    from.get(k).push(b)
  }
  const rings = []
  const live = new Map(edges)
  while (live.size) {
    const [k0, [a0, b0]] = live.entries().next().value
    live.delete(k0)
    const ring = [a0, b0]
    let cur = b0
    while (cur[0] !== a0[0] || cur[1] !== a0[1]) {
      const cands = (from.get(`${cur[0]},${cur[1]}`) ?? []).filter((b) => live.has(key(cur, b)))
      if (!cands.length) break
      const b = cands[0]
      live.delete(key(cur, b))
      ring.push(b)
      cur = b
    }
    rings.push(ring)
  }
  return rings
}
const signedArea = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2 }
function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ── build ────────────────────────────────────────────────────────────────────
const res = await fetch(API)
if (!res.ok) throw new Error(`${res.status} from the FLAI API`)
const items = (await res.json()).items ?? []
console.log(`${items.length} open datasets listed`)

const features = []
const failures = []
let requests = 0
const t0 = Date.now()
const queue = [...items]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const it = queue.shift()
    if (!it) return
    const overview = it.overview ?? (it.path ? `${it.path}/overview/overview.copc.laz` : null)
    if (!overview || !it.datasource_url) { failures.push(`${it.dataset_name}: no overview path`); continue }
    const url = `${it.datasource_url.replace(/\/$/, "")}/${overview}`
    try {
      const got = await copcCells(url, TARGET_LEVEL)
      if (!got) { failures.push(`${it.dataset_name}: no readable COPC hierarchy`); continue }
      requests += got.pages + 1
      const to = await projFor(it.srid)
      const toLngLat = ([cx, cy]) => {
        const [lng, lat] = to.forward([got.minX + cx * got.size, got.minY + cy * got.size])
        return [Math.round(lng * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]
      }
      const rings = traceRings(got.cells)
      const geo = rings.map((r) => ({ ring: r.map(toLngLat), area: signedArea(r) }))
        .filter((g) => g.ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90))
      if (!geo.length) { failures.push(`${it.dataset_name}: EPSG:${it.srid} gave non-finite corners`); continue }
      const sign = Math.sign(geo.reduce((acc, g) => (Math.abs(g.area) > Math.abs(acc.area) ? g : acc), geo[0]).area) || 1
      const outers = geo.filter((g) => Math.sign(g.area) === sign).sort((a, b) => Math.abs(a.area) - Math.abs(b.area))
      const holes = geo.filter((g) => Math.sign(g.area) !== sign)
      const polys = outers.map((o) => [o.ring])
      for (const h of holes) {
        const i = outers.findIndex((o) => pointInRing(h.ring[0], o.ring))
        if (i >= 0) polys[i].push(h.ring)
      }
      features.push({
        type: "Feature",
        properties: {
          name: it.dataset_name,
          datasetId: it.id,
          year: (it.start_acquisition_date ?? "").slice(0, 4),
          endYear: (it.end_acquisition_date ?? "").slice(0, 4),
          density: it.pointcloud_dataset_point_density ? Math.round(it.pointcloud_dataset_point_density * 10) / 10 : null,
          areaKm2: it.pointcloud_dataset_area ? Math.round(it.pointcloud_dataset_area / 1e6) : null,
          srid: it.srid,
          approximate: got.approximate ?? false,
          licence: it.licences ?? null,
          url: it.url ?? null,
        },
        geometry: { type: "MultiPolygon", coordinates: polys },
      })
    } catch (e) { failures.push(`${it.dataset_name}: ${e.message}`) }
  }
}))

features.sort((a, b) => (b.properties.year ?? "").localeCompare(a.properties.year ?? ""))
await mkdir(dirname(OUT), { recursive: true })
const body = JSON.stringify({ type: "FeatureCollection", features })
await writeFile(OUT, body)
const rings = features.reduce((n, f) => n + f.geometry.coordinates.length, 0)
console.log(`${features.length} footprints (${rings} polygons), ${failures.length} skipped, ${requests} range requests, ${((Date.now() - t0) / 1000).toFixed(0)} s, ${(body.length / 1024).toFixed(0)} KB -> ${OUT}`)
for (const f of failures.slice(0, 20)) console.log(`  skipped ${f}`)
