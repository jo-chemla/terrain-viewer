// NextGIS Quick Map Services (qms.nextgis.com): the shapes the search panel
// and the coverage overlay share, and the one conversion from a service's
// detail record to a basemap source.
import type { CustomBasemapSource } from "./settings-atoms"

export const QMS_API = "https://qms.nextgis.com/api/v1/geoservices/"

/** Only these QMS service types map onto a MapLibre raster source directly. */
export const QMS_SUPPORTED_TYPES = new Set(["tms", "wms"])

export interface QmsSearchResult {
  id: number | string
  name: string
  desc: string
  type: string
  cumulative_status: string
  /** "SRID=4326;POLYGON ((...))", or null for a worldwide service. */
  extent?: string | null
}

export interface QmsDetail extends QmsSearchResult {
  url: string
  z_min: number
  z_max: number
  y_origin_top: boolean
  copyright_text?: string
  copyright_url?: string
  license_name?: string
  license_url?: string
  terms_of_use_url?: string
}

// QMS URLs use a few placeholder conventions MapLibre doesn't understand:
// - Bing-style quadkey tiles use {q}, MapLibre expects {quadkey}
// - Leaflet-style subdomain load-balancing ({s}) isn't supported at all — MapLibre has no
//   equivalent, so pin it to a single subdomain (functional, just no round-robin balancing)
export const normalizeQmsUrl = (url: string): string =>
  url.replace(/\{q\}/g, "{quadkey}").replace(/\{s\}/g, "a")

export function qmsDetailToBasemap(detail: QmsDetail): Omit<CustomBasemapSource, "id"> {
  return {
    name: detail.name,
    url: normalizeQmsUrl(detail.url),
    type: detail.type === "wms" ? "wms" : "tms",
    description: [detail.copyright_text, detail.desc].filter(Boolean).join(" — "),
    scheme: detail.y_origin_top === false ? "tms" : "xyz",
    minzoom: detail.z_min,
    maxzoom: detail.z_max,
    attribution: detail.copyright_text || undefined,
    licenseName: detail.license_name || undefined,
    licenseUrl: detail.license_url || detail.terms_of_use_url || detail.copyright_url || undefined,
    infoUrl: `https://qms.nextgis.com/geoservices/${detail.id}/`,
    provider: "qms",
  }
}

/** QMS extents are EWKT: "SRID=4326;POLYGON ((x y, ...))" or MULTIPOLYGON. */
export function parseQmsExtent(ewkt: string | null | undefined): number[][][][] | null {
  if (!ewkt) return null
  const wkt = ewkt.replace(/^SRID=\d+;/, "").trim()
  const rings = (body: string): number[][][] =>
    body.split(/\)\s*,\s*\(/).map((ring) => ring.replace(/[()]/g, "").split(",").map((pt) => pt.trim().split(/\s+/).map(Number)).filter((c) => c.length >= 2 && c.every(Number.isFinite)))
  if (/^POLYGON/i.test(wkt)) return [rings(wkt.replace(/^POLYGON\s*\(/i, "").replace(/\)\s*$/, ""))]
  if (/^MULTIPOLYGON/i.test(wkt)) {
    const inner = wkt.replace(/^MULTIPOLYGON\s*\(/i, "").replace(/\)\s*$/, "")
    return inner.split(/\)\s*\)\s*,\s*\(\s*\(/).map((poly) => rings(poly.replace(/^\(+/, "").replace(/\)+$/, "")))
  }
  return null
}
