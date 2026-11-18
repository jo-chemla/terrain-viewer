import type { FeatureCollection } from "geojson"
import * as toGeoJSON from "@tmcw/togeojson"

/**
 * Vector data -> GeoJSON, for the Drawing tool's import (a picked file, a
 * pasted URL, or the drawingUrl state list). Data loading only: whatever
 * styling a KML or a style-carrying GeoJSON declares is ignored, features
 * take the colours of the drawing layer they land in.
 *
 *   geojson / json  JSON.parse
 *   kml / gpx       @tmcw/togeojson (DOM based, already a dependency)
 *   fgb             FlatGeobuf through loaders.gl
 *   shp             Shapefile through loaders.gl - from a URL only, where
 *                   the loader fetches the .dbf / .prj / .shx next to it and
 *                   reprojects to WGS84; a single picked .shp file would
 *                   have neither attributes nor a projection.
 *
 * The loaders.gl modules are imported on demand: they are heavy and most
 * sessions never import anything but GeoJSON.
 */
export type VectorFormat = "geojson" | "kml" | "gpx" | "fgb" | "shp" | "csv"

export const VECTOR_FILE_ACCEPT = ".geojson,.json,.kml,.gpx,.fgb,.csv"

const EXT_FORMAT: Record<string, VectorFormat> = { geojson: "geojson", json: "geojson", kml: "kml", gpx: "gpx", fgb: "fgb", shp: "shp", csv: "csv", tsv: "csv" }

export function vectorFormatFromName(name: string): VectorFormat | null {
  const ext = name.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? ""
  return EXT_FORMAT[ext] ?? null
}

/** No usable extension (an API endpoint, a signed URL): look at the bytes. */
function sniffFormat(data: ArrayBuffer, contentType: string): VectorFormat | null {
  const head = new Uint8Array(data.slice(0, 512))
  if (head[0] === 0x66 && head[1] === 0x67 && head[2] === 0x62) return "fgb" // "fgb" magic
  const text = new TextDecoder().decode(head).trimStart()
  if (text.startsWith("{") || text.startsWith("[") || /json/i.test(contentType)) return "geojson"
  if (/<gpx[\s>]/i.test(text)) return "gpx"
  if (/<kml[\s>]/i.test(text) || (text.startsWith("<") && /kml/i.test(contentType))) return "kml"
  if (/csv/i.test(contentType) || csvPointColumns(splitCsvLine(text.split(/\r?\n/)[0] ?? "", csvDelimiter(text)))) return "csv"
  return null
}

// CSV of points: a header row with a latitude and a longitude column
// (lat / latitude / y, lon / lng / long / longitude / x), one point per row,
// every other column kept as a property (numbers as numbers).
const LAT_NAMES = ["lat", "latitude", "y"], LON_NAMES = ["lon", "lng", "long", "longitude", "x"]
const csvDelimiter = (text: string) => { const h = text.split(/\r?\n/)[0] ?? ""; return h.includes("\t") ? "\t" : h.split(";").length > h.split(",").length ? ";" : "," }
function splitCsvLine(line: string, d: string): string[] {
  if (!line.includes('"')) return line.split(d)
  const out: string[] = []
  let cur = "", quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else quoted = false } else cur += c }
    else if (c === '"') quoted = true
    else if (c === d) { out.push(cur); cur = "" }
    else cur += c
  }
  out.push(cur)
  return out
}
function csvPointColumns(header: string[]): { lat: number; lon: number } | null {
  const names = header.map((h) => h.trim().toLowerCase())
  const find = (wanted: string[]) => { for (const w of wanted) { const i = names.indexOf(w); if (i >= 0) return i } return -1 }
  const lat = find(LAT_NAMES), lon = find(LON_NAMES)
  return lat >= 0 && lon >= 0 ? { lat, lon } : null
}
export function csvToPoints(text: string): FeatureCollection {
  const d = csvDelimiter(text)
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const header = splitCsvLine(lines[0] ?? "", d).map((h) => h.trim())
  const cols = csvPointColumns(header)
  if (!cols) throw new Error("CSV has no latitude and longitude columns (lat / latitude / y and lon / lng / longitude / x expected in the header row)")
  const features: any[] = []
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r].trim()) continue
    const cells = splitCsvLine(lines[r], d)
    const lat = parseFloat(cells[cols.lat]), lon = parseFloat(cells[cols.lon])
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) continue
    const properties: Record<string, unknown> = {}
    header.forEach((h, i) => {
      if (i === cols.lat || i === cols.lon || !h) return
      const v = (cells[i] ?? "").trim()
      properties[h] = v !== "" && Number.isFinite(Number(v)) ? Number(v) : v
    })
    features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } })
  }
  return { type: "FeatureCollection", features }
}

const asCollection = (v: any): FeatureCollection => {
  if (v?.type === "FeatureCollection") return v
  if (v?.type === "Feature") return { type: "FeatureCollection", features: [v] }
  if (Array.isArray(v?.features)) return { type: "FeatureCollection", features: v.features }
  if (Array.isArray(v)) return { type: "FeatureCollection", features: v }
  throw new Error("not GeoJSON (expected a Feature or FeatureCollection)")
}

export async function parseVector(data: ArrayBuffer, format: VectorFormat): Promise<FeatureCollection> {
  if (format === "geojson") return asCollection(JSON.parse(new TextDecoder().decode(data)))
  if (format === "csv") return csvToPoints(new TextDecoder().decode(data))
  if (format === "kml" || format === "gpx") {
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(data), "text/xml")
    if (xml.getElementsByTagName("parsererror").length) throw new Error(`not valid ${format.toUpperCase()} (XML parse error)`)
    return asCollection(format === "kml" ? toGeoJSON.kml(xml) : toGeoJSON.gpx(xml))
  }
  if (format === "fgb") {
    const [{ parse }, { FlatGeobufLoader }] = await Promise.all([import("@loaders.gl/core"), import("@loaders.gl/flatgeobuf")])
    return asCollection(await parse(data, FlatGeobufLoader, { flatgeobuf: { shape: "geojson-table" }, gis: { reproject: true, _targetCrs: "WGS84" } } as any))
  }
  throw new Error("a Shapefile can only be loaded from a URL (its .dbf and .prj are fetched alongside)")
}

/** Layer name for a URL: its file name, without extension or query. */
export function nameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "")
    return last.replace(/\.[^./]+$/, "") || new URL(url).hostname
  } catch { return url }
}

export async function fetchVector(url: string): Promise<{ geojson: FeatureCollection; format: VectorFormat }> {
  if (!/^https?:\/\//i.test(url)) throw new Error("expected an http(s) URL")
  if (vectorFormatFromName(url) === "shp") {
    const [{ load }, { ShapefileLoader }] = await Promise.all([import("@loaders.gl/core"), import("@loaders.gl/shapefile")])
    const out = await load(url, ShapefileLoader, { shapefile: { shape: "geojson-table" }, gis: { reproject: true, _targetCrs: "WGS84" } } as any)
    return { geojson: asCollection(out), format: "shp" }
  }
  let res: Response
  try { res = await fetch(url) } catch { throw new Error("could not be fetched (network error, or the server does not allow cross-origin requests)") }
  if (!res.ok) throw new Error(`could not be fetched (HTTP ${res.status})`)
  const data = await res.arrayBuffer()
  const format = vectorFormatFromName(url) ?? sniffFormat(data, res.headers.get("content-type") ?? "")
  if (!format) throw new Error("is in a format that is not recognised (GeoJSON, KML, GPX, FlatGeobuf, Shapefile or a CSV of points expected)")
  return { geojson: await parseVector(data, format), format }
}
