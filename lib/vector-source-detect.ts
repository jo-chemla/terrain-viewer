// What a vector source's address is, read from the address itself and one
// request: a PMTiles archive of vector tiles (its header and metadata), a
// TileJSON, an MVT {z}/{x}/{y} template, a whole MapLibre style, or a
// GeoJSON, KML or GPX file of 10 MB at most (KML and GPX are converted to
// GeoJSON by lib/remote-vector.ts, the drawing tools' reader). Returns
// the VectorSourceEntry the Add dialog saves (Bring Your Own Data > Vector
// overlays), with the layers and zoom range the source declares.
//
//   node scripts/test-lib.mjs lib/vector-source-detect.test.ts   (offline)
import { PMTiles } from "pmtiles"
import type { VectorSourceEntry } from "./source-schema"

/** A layer the source declares, with its property names. */
export interface DetectedLayer { id: string; fields: string[] }

export interface DetectedVectorSource {
  entry: VectorSourceEntry
  /** Every layer found (the entry draws them all until the user unticks). */
  layers: DetectedLayer[]
  /** What was recognized, for the dialog. */
  label: string
  note?: string
}

/** The largest GeoJSON file a source may be: it is loaded whole. */
export const GEOJSON_MAX_BYTES = 10e6

const HEIGHT_FIELDS = ["height", "render_height", "Height", "HEIGHT", "building:height", "hauteur"]
const MIN_HEIGHT_FIELDS = ["min_height", "render_min_height"]
const FLOOR_FIELDS = ["num_floors", "building:levels", "levels", "floors"]

type VectorLayerMeta = { id?: unknown; fields?: Record<string, unknown>; minzoom?: unknown; maxzoom?: unknown }

function layersOf(vectorLayers: unknown): DetectedLayer[] {
  if (!Array.isArray(vectorLayers)) return []
  return (vectorLayers as VectorLayerMeta[])
    .filter((l) => typeof l?.id === "string")
    .map((l) => ({ id: l.id as string, fields: Object.keys(l.fields ?? {}) }))
}

/** A stable id from the address: letters, digits and dashes of its host and path. */
export function vectorSourceId(url: string): string {
  const core = url.replace(/^pmtiles:\/\//, "").replace(/^https?:\/\//, "").replace(/\{[^}]*\}/g, "").replace(/\.(pmtiles|json|pbf|mvt|kml|gpx)\b/gi, "")
  const slug = core.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (slug.length <= 48) return `vec-${slug || "source"}`
  // A long address keeps its two ends and a hash of the whole: two archives
  // of one folder (a file per country) differ only at the end.
  let h = 2166136261
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 16777619)
  return `vec-${slug.slice(0, 20).replace(/-+$/, "")}-${(h >>> 0).toString(36)}-${slug.slice(-20).replace(/^-+/, "")}`
}

function nameOf(url: string): string {
  try {
    const u = new URL(url.replace(/^pmtiles:\/\//, "").replace(/\{[^}]*\}/g, "x"))
    const last = u.pathname.split("/").filter((p) => p && !/^x(\.\w+)?$/.test(p)).pop()?.replace(/\.(pmtiles|geojson|json|pbf|mvt|kml|gpx)$/i, "")
    return last ? `${last} (${u.hostname})` : u.hostname
  } catch { return url }
}

/** The height, base and floor fields among the chosen layers' properties. */
export function heightFieldsOf(layers: DetectedLayer[]): Pick<VectorSourceEntry, "heightField" | "minHeightField" | "floorsField"> {
  const fields = new Set(layers.flatMap((l) => l.fields))
  const first = (names: string[]) => names.find((n) => fields.has(n))
  const heightField = first(HEIGHT_FIELDS)
  return heightField ? { heightField, minHeightField: first(MIN_HEIGHT_FIELDS), floorsField: first(FLOOR_FIELDS) } : {}
}

const base = (url: string, type: VectorSourceEntry["type"], name?: string): VectorSourceEntry => ({
  id: vectorSourceId(url), name: name?.trim() || nameOf(url), kind: "vector", section: "custom", type, url,
  geometries: ["polygon", "line", "point"],
})

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T
const zoom = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const bounds4 = (b: unknown) => (Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number" && Number.isFinite(n)) ? (b as [number, number, number, number]) : undefined)

/** KML or GPX text to GeoJSON features (the browser's reader by default,
 *  lib/remote-vector.ts, which needs a DOM; a test passes its own). */
export type XmlVectorParser = (text: string, format: "kml" | "gpx") => Promise<{ features: { properties?: Record<string, unknown> | null }[] }>
const parseXmlVector: XmlVectorParser = async (text, format) => {
  const { parseVector } = await import("./remote-vector")
  return parseVector(new TextEncoder().encode(text).buffer as ArrayBuffer, format)
}

/** KML or GPX, by the address's extension, else by the first tag. */
export function xmlVectorFormat(url: string, text: string): "kml" | "gpx" | null {
  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase()
  const head = text.slice(0, 600)
  if (!head.trimStart().startsWith("<")) return null
  if (ext === "gpx" || /<gpx[\s>]/i.test(head)) return "gpx"
  if (ext === "kml" || /<kml[\s>]/i.test(head)) return "kml"
  return null
}

/** A reader of a PMTiles archive's header and metadata (the pmtiles package
 *  by default; a test passes its own). */
export type PmtilesProbe = (url: string) => Promise<{ header: { tileType: number; minZoom: number; maxZoom: number; minLon: number; minLat: number; maxLon: number; maxLat: number }; metadata: unknown }>
const probePmtiles: PmtilesProbe = async (url) => {
  const archive = new PMTiles(url)
  return { header: await archive.getHeader(), metadata: await archive.getMetadata() }
}

/**
 * The entry for an address, or an Error saying what the address is not.
 * Order: a PMTiles archive by its name, an MVT template by its {z}, else
 * the JSON behind the address (a MapLibre style or a TileJSON).
 */
export async function detectVectorSource(raw: string, opts: { fetcher?: typeof fetch; pmtiles?: PmtilesProbe; xml?: XmlVectorParser } = {}): Promise<DetectedVectorSource> {
  const fetcher = opts.fetcher ?? fetch
  const url = raw.trim()
  if (!/^(https?|pmtiles):\/\//i.test(url)) throw new Error("An https address is needed: a .pmtiles archive, a TileJSON, a {z}/{x}/{y} tile template or a MapLibre style.")

  if (/^pmtiles:\/\//i.test(url) || /\.pmtiles($|[?#])/i.test(url)) {
    const https = url.replace(/^pmtiles:\/\//i, "")
    const { header, metadata } = await (opts.pmtiles ?? probePmtiles)(https)
    // 1 is MVT in the PMTiles spec (2 PNG, 3 JPEG, 4 WebP, 5 AVIF).
    if (header.tileType !== 1) throw new Error("This PMTiles archive holds raster tiles: add it as a basemap or a terrain source instead.")
    const meta = (metadata ?? {}) as { vector_layers?: unknown; name?: unknown; attribution?: unknown; description?: unknown }
    const layers = layersOf(meta.vector_layers)
    const entry = clean({
      ...base(https, "pmtiles", typeof meta.name === "string" ? meta.name : undefined),
      minzoom: header.minZoom, maxzoom: header.maxZoom,
      bounds: bounds4([header.minLon, header.minLat, header.maxLon, header.maxLat]),
      sourceLayers: layers.map((l) => l.id),
      attribution: typeof meta.attribution === "string" ? meta.attribution.replace(/<[^>]+>/g, "") : undefined,
      description: typeof meta.description === "string" ? meta.description : undefined,
      ...heightFieldsOf(layers),
    })
    return { entry, layers, label: "PMTiles archive of vector tiles", note: layers.length ? undefined : "The archive lists no layers: type their names." }
  }

  if (/\{z\}/.test(url)) {
    return { entry: base(url, "mvt"), layers: [], label: "Vector tile template", note: "A template does not say which layers its tiles hold: type their names." }
  }

  const res = await fetcher(url)
  if (!res.ok) throw new Error(`The address answered ${res.status}.`)
  // A GeoJSON file is loaded whole, so it is capped (the header when the
  // host states it, the text otherwise).
  const declared = Number(res.headers?.get?.("content-length") ?? 0)
  const tooBig = (bytes: number) => new Error(`This file is ${Math.round(bytes / 1e6)} MB: a GeoJSON, KML or GPX source is loaded whole and capped at ${GEOJSON_MAX_BYTES / 1e6} MB. Make vector tiles of it (tippecanoe to PMTiles) instead.`)
  if (declared > GEOJSON_MAX_BYTES) throw tooBig(declared)
  const text = await res.text()
  if (text.length > GEOJSON_MAX_BYTES) throw tooBig(text.length)

  // KML and GPX: converted once here to count the features and find the
  // fields, and again by the map when the source is drawn.
  const xml = xmlVectorFormat(url, text)
  if (xml) {
    let features: { properties?: Record<string, unknown> | null }[]
    try { features = (await (opts.xml ?? parseXmlVector)(text, xml)).features ?? [] } catch (e) { throw new Error(`This ${xml.toUpperCase()} file could not be read: ${e instanceof Error ? e.message : "not valid XML"}.`) }
    if (!features.length) throw new Error(`This ${xml.toUpperCase()} file holds no feature.`)
    const fields = [...new Set(features.slice(0, 200).flatMap((f) => Object.keys(f?.properties ?? {})))]
    return { entry: clean({ ...base(url, "geojson"), format: xml, ...heightFieldsOf([{ id: "data", fields }]) }), layers: [], label: `${xml.toUpperCase()} file, ${features.length} feature${features.length === 1 ? "" : "s"}`, note: "Converted to GeoJSON in your browser and read whole, not as tiles: fine up to a few megabytes." }
  }

  let json: Record<string, unknown>
  try { json = JSON.parse(text) } catch { throw new Error("The address is neither a PMTiles archive, a tile template, JSON (a TileJSON, a MapLibre style, GeoJSON) nor a KML or GPX file.") }

  if (json.type === "FeatureCollection" || json.type === "Feature") {
    const features = (json.type === "Feature" ? [json] : Array.isArray(json.features) ? json.features : []) as { properties?: Record<string, unknown> | null }[]
    const fields = [...new Set(features.slice(0, 200).flatMap((f) => Object.keys(f?.properties ?? {})))]
    return { entry: clean({ ...base(url, "geojson"), ...heightFieldsOf([{ id: "data", fields }]) }), layers: [], label: `GeoJSON file, ${features.length} feature${features.length === 1 ? "" : "s"}`, note: "Read whole, not as tiles: fine up to a few megabytes." }
  }
  if (Array.isArray(json.layers) && json.sources && typeof json.sources === "object") {
    return { entry: clean({ ...base(url, "style", typeof json.name === "string" ? json.name : undefined), geometries: undefined }), layers: [], label: "MapLibre style", note: "Drawn with the style's own layers and colors; only the opacity is yours." }
  }
  if (Array.isArray(json.tiles) || Array.isArray(json.vector_layers)) {
    const layers = layersOf(json.vector_layers)
    if (json.format && json.format !== "pbf" && json.format !== "mvt" && !layers.length) throw new Error("This TileJSON describes raster tiles: add it as a basemap or a terrain source instead.")
    const entry = clean({
      ...base(url, "tilejson", typeof json.name === "string" ? json.name : undefined),
      minzoom: zoom(json.minzoom), maxzoom: zoom(json.maxzoom), bounds: bounds4(json.bounds),
      sourceLayers: layers.map((l) => l.id),
      attribution: typeof json.attribution === "string" ? json.attribution.replace(/<[^>]+>/g, "") : undefined,
      description: typeof json.description === "string" ? json.description : undefined,
      ...heightFieldsOf(layers),
    })
    return { entry, layers, label: "TileJSON of vector tiles", note: layers.length ? undefined : "The TileJSON lists no layers: type their names." }
  }
  throw new Error("This JSON is neither a TileJSON (tiles, vector_layers), a MapLibre style (sources, layers) nor GeoJSON.")
}
