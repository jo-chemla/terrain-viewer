import type { Feature, FeatureCollection, Geometry } from "geojson"
import type { EliLayer, EliLocatorLayer } from "@osm-editor-kit/maplibre-editor-layer-index"

type Row = EliLocatorLayer | EliLayer

// ELI coverage polygons, one file per geometry. The package
// (@osm-editor-kit/maplibre-editor-layer-index) ships its polygons as one
// shard per continent: showing a single French footprint loaded all of
// Europe's (1.6 MB raw, 580 kB gzip). The `eli-geometries` plugin in
// vite.config.ts writes each of its 998 polygons to
// eli-geometries/<geometryId>.json (median 0.3 kB gzip, 95 % under 4 kB,
// the largest 177 kB), from the installed package, so the files match its
// locator and stay out of git; the dev server serves them the same way.
// When a file cannot be fetched (the tile service bundles this module
// without the files), the package's continent shard is the fallback.

const cache = new Map<string, Promise<Geometry | null>>()

const baseUrl = (): string => (import.meta.env?.BASE_URL as string | undefined) ?? "/"

async function fetchGeometry(layer: Row): Promise<Geometry | null> {
  const res = await fetch(`${baseUrl()}eli-geometries/${encodeURIComponent(layer.geometryId)}.json`)
  if (!res.ok) throw new Error(`eli geometry ${layer.geometryId}: HTTP ${res.status}`)
  return (await res.json()) as Geometry
}

async function fallbackGeometry(layer: Row): Promise<Geometry | null> {
  const eli = await import("@osm-editor-kit/maplibre-editor-layer-index")
  return ((await eli.getGeometry(layer)) as Geometry | undefined) ?? null
}

function geometryOf(layer: Row): Promise<Geometry | null> {
  let p = cache.get(layer.geometryId)
  if (!p) {
    p = fetchGeometry(layer).catch(() => fallbackGeometry(layer)).catch(() => null)
    cache.set(layer.geometryId, p)
  }
  return p
}

/** The same collection as the package's loadCoverageFeatures (one feature per
 *  layer with a polygon, id/name/type/category properties; worldwide layers
 *  have none), each polygon fetched on its own. */
export async function loadEliCoverageFeatures(layers: Row[]): Promise<FeatureCollection> {
  const rows = layers.filter((l) => l.geometryId !== "world")
  const geometries = await Promise.all(rows.map(geometryOf))
  const features: Feature[] = []
  rows.forEach((layer, i) => {
    const geometry = geometries[i]
    if (!geometry) return
    features.push({ type: "Feature", id: layer.id, geometry,
      properties: { id: layer.id, name: layer.name, type: layer.type, ...(layer.category ? { category: layer.category } : {}) } })
  })
  return { type: "FeatureCollection", features }
}
