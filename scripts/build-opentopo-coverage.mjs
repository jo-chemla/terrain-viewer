// OpenTopography's public catalog as two coverage overlays (Source Info >
// Coverage > 3D and LiDAR coverage): rasters (DEMs, "2.5D") and point clouds
// (airborne / terrestrial LiDAR, photogrammetry). The catalog API answers
// with CORS but weighs 2-4 MB per product type, mostly HTML descriptions,
// so the footprints are baked here into public/coverage/ with only what the
// popup shows. Run by hand when the catalog has moved on:
//
//   node scripts/build-opentopo-coverage.mjs
//
// Hosted datasets only (include_federated=false): the federated ones are
// USGS 3DEP and NOAA, which have coverage of their own elsewhere.
import { writeFileSync, mkdirSync } from "node:fs"
import { simplify, truncate } from "@turf/turf"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, "..", "public", "coverage")
mkdirSync(out, { recursive: true })

const API = "https://portal.opentopography.org/API/otCatalog"

async function build(productFormat, file) {
  const url = `${API}?productFormat=${productFormat}&minx=-180&miny=-90&maxx=180&maxy=90&detail=true&outputFormat=json&include_federated=false`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${productFormat}: HTTP ${res.status}`)
  const { Datasets } = await res.json()
  const features = []
  let boxes = 0
  for (const { Dataset: d } of Datasets) {
    const fc = d.spatialCoverage?.geo?.geojson
    const geoms = (fc?.features ?? []).map((f) => f.geometry).filter(Boolean)
    if (!geoms.length) continue
    const otId = d.identifier?.value
    const props = {
      name: d.name,
      otId,
      short: d.alternateName || undefined,
      doi: d.url,
      created: d.dateCreated,
      temporal: d.temporalCoverage || undefined,
      keywords: (d.keywords || "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 6).join(", ") || undefined,
    }
    for (const g of geoms) {
      // Most footprints are the dataset's bounding box (5 vertices); a few are
      // real outlines. Nothing to tell the popup beyond that count.
      if (g.type === "Polygon" && g.coordinates[0]?.length === 5) boxes++
      // Outlines traced at survey precision are several hundred kB each;
      // ~100 m and four decimals is plenty for a footprint on a map.
      let geometry = g
      try { geometry = truncate(simplify({ type: "Feature", geometry: g, properties: {} }, { tolerance: 0.001, highQuality: false }), { precision: 4, coordinates: 2 }).geometry } catch {}
      features.push({ type: "Feature", geometry, properties: props })
    }
  }
  const geojson = { type: "FeatureCollection", features }
  writeFileSync(join(out, file), JSON.stringify(geojson))
  console.log(`${file}: ${features.length} footprints from ${Datasets.length} datasets (${boxes} boxes), ${(JSON.stringify(geojson).length / 1024).toFixed(0)} kB`)
}

await build("Raster", "opentopo-raster.geojson")
await build("PointCloud", "opentopo-pointcloud.geojson")
