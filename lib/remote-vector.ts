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
export type VectorFormat = "geojson" | "kml" | "gpx" | "fgb" | "shp"

export const VECTOR_FILE_ACCEPT = ".geojson,.json,.kml,.gpx,.fgb"

const EXT_FORMAT: Record<string, VectorFormat> = { geojson: "geojson", json: "geojson", kml: "kml", gpx: "gpx", fgb: "fgb", shp: "shp" }

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
  return null
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
  if (!format) throw new Error("is in a format that is not recognised (GeoJSON, KML, GPX, FlatGeobuf or Shapefile expected)")
  return { geojson: await parseVector(data, format), format }
}
