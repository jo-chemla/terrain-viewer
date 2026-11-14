// Copernicus Data Space Ecosystem (CDSE) helpers for the STAC search panel.
//
// The CDSE STAC API (stac.dataspace.copernicus.eu/v1) is open and CORS-open,
// but none of its data assets can be read anonymously from a browser
// (checked 2026-11-14):
//  - every band / measurement href is `s3://eodata/...`, which needs CDSE S3
//    keys and has no browser scheme handler;
//  - the `alternate.https` copies go through the OData download service
//    (download.dataspace.copernicus.eu), which answers 401 without a
//    Copernicus login token (auth:refs ["oidc"]);
//  - Sentinel-2 bands are JPEG 2000 inside a SAFE product anyway.
// What IS public: the quicklook thumbnails (datahub.creodias.eu 301 ->
// zipper.creodias.eu, 200 with CORS) and the catalog itself. The Copernicus
// DEM GLO-30 / GLO-90 tiles are also published, under the same tile names, on
// AWS Open Data (copernicus-dem-30m / -90m buckets, keyless, Range-capable),
// so those items are rewritten to that copy and stream through titiler.
// Everything else is listed with the reason and a link to the Copernicus
// Browser at that place and date.
import type { StacAsset, StacItem } from "./stac-crawl"

export const CDSE_STAC_URL = "https://stac.dataspace.copernicus.eu/v1"

const COPDEM_RE = /^s3:\/\/eodata\/auxdata\/CopDEM_COG\/copernicus-dem-(30|90)m\/([^/]+)\/([^/]+\.tif)$/i

/** A keyless https copy of an otherwise unreadable asset, when one is known.
 *  Only the Copernicus DEM so far: CDSE's `CopDEM_COG` tiles carry the same
 *  names as the AWS Open Data buckets (the release there may differ). */
export function publicMirrorHref(href: string): string | undefined {
  const m = COPDEM_RE.exec(href)
  if (m) return `https://copernicus-dem-${m[1]}m.s3.amazonaws.com/${m[2]}/${m[3]}`
  return undefined
}

const isMetadata = (a: StacAsset) => (a.roles ?? []).some((r) => r === "metadata" || r === "thumbnail" || r === "overview")
  || /xml|json|text\/plain/i.test(a.type ?? "")

type AuthAsset = StacAsset & { "auth:refs"?: string[]; alternate?: Record<string, { href?: string; "auth:refs"?: string[] }> }

/** An asset a browser cannot read without credentials: an object-store URI
 *  (s3://, gs://, az://), or an https href declared behind an OpenID login. */
export function isCredentialed(a: StacAsset): boolean {
  if (/^(s3|gs|az):\/\//i.test(a.href)) return true
  return ((a as AuthAsset)["auth:refs"] ?? []).includes("oidc")
}

/** Every data asset of the item is behind credentials (NASA CSDA's DEMs,
 *  all of CDSE): worth listing as "exists, cannot stream" rather than hiding. */
export function allDataCredentialed(it: StacItem): boolean {
  const data = Object.values(it.assets ?? {}).filter((a) => !isMetadata(a))
  return data.length > 0 && data.every(isCredentialed)
}

/** Why none of an item's data assets can be added, in one sentence; null when
 *  the item has no data asset at all (nothing worth explaining). Phrased for
 *  any catalog, with the CDSE specifics named when the hrefs are CDSE's. */
export function blockedReason(it: StacItem): string | null {
  const data = Object.values(it.assets ?? {}).filter((a) => !isMetadata(a))
  if (!data.length) return null
  const kinds = new Set<string>()
  for (const a of data) {
    const t = `${a.type ?? ""} ${a.href}`
    if (/jp2|jpeg2000/i.test(t)) kinds.add("JPEG 2000 bands")
    else if (/netcdf|\.nc($|\?)/i.test(t)) kinds.add("netCDF files")
    else if (/x-hdf|\.hdf($|\?)/i.test(t)) kinds.add("HDF files")
    else if (/cloud-optimized/i.test(t)) kinds.add("Cloud Optimized GeoTIFFs")
    else if (/tiff/i.test(t)) kinds.add("GeoTIFFs")
    else if (/zip/i.test(t)) kinds.add("a zipped product")
  }
  const what = kinds.size ? [...kinds].join(", ") : "data files"
  const cdse = data.some((a) => /^s3:\/\/eodata\//i.test(a.href) || /dataspace\.copernicus\.eu/i.test(a.href))
  const hasLoginAlternate = data.some((a) => Object.values((a as AuthAsset).alternate ?? {}).some((alt) => alt["auth:refs"]?.includes("oidc")))
  if (cdse) {
    return `${what[0].toUpperCase()}${what.slice(1)} on CDSE's S3 store (s3://eodata, needs S3 keys)${hasLoginAlternate ? " or its download service (needs a Copernicus login)" : ""}: a browser cannot read them anonymously.`
  }
  if (data.every(isCredentialed)) return `${what[0].toUpperCase()}${what.slice(1)} held in a credentialed bucket (s3:// or a login): discoverable here, not streamable.`
  if (kinds.has("JPEG 2000 bands") || kinds.has("netCDF files") || kinds.has("HDF files") || kinds.has("a zipped product")) return `${what[0].toUpperCase()}${what.slice(1)}: no in-browser reader for this format.`
  return null
}

/** The item's quicklook when it is a plain public https image. */
export function publicThumbnail(it: StacItem): string | undefined {
  for (const [key, a] of Object.entries(it.assets ?? {})) {
    if (!((a.roles ?? []).includes("thumbnail") || key === "thumbnail")) continue
    if (/^https:\/\//i.test(a.href) && !isCredentialed(a)) return a.href
  }
  return undefined
}

// Copernicus Browser dataset / layer ids, from its own reference
// (github.com/eu-cdse/copernicus-browser public/datasets.txt). An unknown id
// makes the Browser fall back to Sentinel-2 with an error, so collections
// without a known match link to the place and date only.
const S1_MODES = new Set(["IW", "EW", "SM"])
const S1_POLS = new Set(["VV", "VVVH", "HH", "HHHV"])
const S5P_GASES: Record<string, string> = { "aer-ai": "S5_AER_AI_CDAS", ch4: "S5_CH4_CDAS", cloud: "S5_CLOUD_CDAS", co: "S5_CO_CDAS", hcho: "S5_HCHO_CDAS", no2: "S5_NO2_CDAS", o3: "S5_O3_CDAS", so2: "S5_SO2_CDAS" }

export function cdseBrowserDataset(it: StacItem): { datasetId: string; layerId?: string; timeless?: boolean } | undefined {
  const c = (it.collection ?? "").toLowerCase()
  const p = it.properties ?? {}
  if (c.startsWith("sentinel-2-l2a")) return { datasetId: "S2_L2A_CDAS", layerId: "1_TRUE_COLOR" }
  if (c === "sentinel-2-l1c") return { datasetId: "S2_L1C_CDAS", layerId: "1_TRUE_COLOR" }
  if (c === "sentinel-1-grd") {
    const mode = String(p["sar:instrument_mode"] ?? "").toUpperCase()
    const pols = Array.isArray(p["sar:polarizations"]) ? (p["sar:polarizations"] as string[]).join("").toUpperCase() : ""
    if (S1_MODES.has(mode) && S1_POLS.has(pols)) return { datasetId: `S1_CDAS_${mode}_${pols}`, layerId: pols === "VVVH" && mode === "IW" ? "ENHANCED-VISUALIZATION-ORTHORECTIFIED" : undefined }
    return undefined
  }
  if (c.startsWith("cop-dem-glo-30")) return { datasetId: "DEM_COPERNICUS_30_CDAS", layerId: "1_TOPOGRAPHIC", timeless: true }
  if (c.startsWith("cop-dem-glo-90")) return { datasetId: "DEM_COPERNICUS_90_CDAS", layerId: "1_TOPOGRAPHIC", timeless: true }
  if (c.startsWith("sentinel-3-olci-1-")) return { datasetId: "S3OLCI_CDAS", layerId: "1_TRUE_COLOR" }
  if (/^sentinel-3-olci-2-l(fr|rr)/.test(c)) return { datasetId: "S3OLCIL2_LAND" }
  if (/^sentinel-3-olci-2-w(fr|rr)/.test(c)) return { datasetId: "S3OLCIL2_WATER" }
  if (c.startsWith("sentinel-3-sl-1-rbt")) return { datasetId: "S3SLSTR_CDAS" }
  if (c.startsWith("sentinel-3-sl-2-")) return { datasetId: "S3SLSTRL2_CDAS" }
  if (c.startsWith("sentinel-3-syn-2-syn")) return { datasetId: "S3SYNERGY_L2_SYN", layerId: "TRUE-COLOR" }
  if (c.startsWith("sentinel-3-syn-2-v10")) return { datasetId: "S3SYNERGY_L2_V10" }
  if (c.startsWith("sentinel-3-syn-2-vg1")) return { datasetId: "S3SYNERGY_L2_VG1" }
  if (c.startsWith("landsat-c2-l1-")) return { datasetId: "CDAS_L8_L9_LOTL1", layerId: "1_TRUE_COLOR" }
  if (c.startsWith("opengeohub-landsat-bimonthly-mosaic")) return { datasetId: "CDAS_LANDSAT_MOSAIC", layerId: "1-TRUE-COLOUR" }
  const s5p = /^sentinel-5p-l2-(aer-ai|ch4|cloud|co|hcho|no2|o3|so2)(-nrti|-offl|-rpro)?$/.exec(c)
  if (s5p) return { datasetId: S5P_GASES[s5p[1]] }
  return undefined
}

/** The Copernicus Browser at the item's place and day, on its dataset when
 *  the collection has a known Browser id. */
export function cdseBrowserUrl(it: StacItem): string {
  const b = it.bbox && it.bbox.length >= 4 ? it.bbox : undefined
  const lng = b ? (b[0] + b[2]) / 2 : 0
  const lat = b ? (b[1] + b[3]) / 2 : 0
  const span = b ? Math.max(b[2] - b[0], b[3] - b[1], 0.01) : 360
  const zoom = Math.max(3, Math.min(14, Math.round(Math.log2(360 / span))))
  const q = new URLSearchParams({ zoom: String(zoom), lat: lat.toFixed(5), lng: lng.toFixed(5) })
  const ds = cdseBrowserDataset(it)
  if (ds) {
    q.set("themeId", "DEFAULT-THEME")
    q.set("datasetId", ds.datasetId)
    if (ds.layerId) q.set("layerId", ds.layerId)
  }
  const p = it.properties ?? {}
  const when = [p.datetime, p.start_datetime].find((v) => typeof v === "string") as string | undefined
  if (!ds?.timeless && when && !Number.isNaN(Date.parse(when))) {
    const day = new Date(when).toISOString().slice(0, 10)
    q.set("fromTime", `${day}T00:00:00.000Z`)
    q.set("toTime", `${day}T23:59:59.999Z`)
  }
  return `https://browser.dataspace.copernicus.eu/?${q}`
}
