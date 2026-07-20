// Fetches per-tile data-provenance info for the two open elevation sources
// that expose it: AWS Terrain Tiles (an S3 object-metadata header preserving
// the old Mapzen `X-Imagery-Sources` header) and Mapterhorn (a separate
// per-tile "coverage" vector tile joined against a static attribution table).
// Both endpoints were confirmed live to send `Access-Control-Allow-Origin: *`
// (S3 additionally sends `Access-Control-Expose-Headers:
// x-amz-meta-x-imagery-sources`, without which fetch() couldn't read it even
// cross-origin-permitted) — so both are plain-fetchable from the browser,
// no proxy needed.
import Pbf from "pbf"
import { VectorTile } from "@mapbox/vector-tile"

export type ProvenanceSourceKind = "aws" | "mapterhorn"

export interface TileCoords {
  z: number
  x: number
  y: number
}

export interface AwsSourceEntry {
  /** Human-readable dataset name, resolved from the file's folder prefix (see AWS_SOURCE_PREFIXES). Falls back to the raw prefix (e.g. "ned13") if unrecognized — never the full filename. */
  name: string
  resolutionM: number | null
}

export interface AwsProvenanceResult {
  kind: "aws"
  tile: TileCoords
  /** Deduplicated by dataset name, sorted by resolution ascending (finest first; unknown resolution sorts last). */
  sources: AwsSourceEntry[]
}

export interface MapterhornAttribution {
  source: string
  name: string
  website: string
  license: string
  producer: string
  resolution: number
  access_year: number
}

export interface MapterhornProvenanceResult {
  kind: "mapterhorn"
  tile: TileCoords
  /** One entry per distinct source code found among the coverage tile's features, joined against attribution.json (undefined attribution if the code isn't listed there). */
  sources: Array<{ code: string; attribution?: MapterhornAttribution }>
}

export type ProvenanceResult = AwsProvenanceResult | MapterhornProvenanceResult

/** Standard slippy-map tile containing (lng, lat) at the given integer zoom. */
export function lngLatToTile(lng: number, lat: number, z: number): TileCoords {
  const n = 2 ** z
  const clampedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878)
  const latRad = (clampedLat * Math.PI) / 180
  const x = Math.floor(((lng + 180) / 360) * n)
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { z, x: Math.min(Math.max(x, 0), n - 1), y: Math.min(Math.max(y, 0), n - 1) }
}

// Folder-prefix -> dataset mapping for AWS/Mapzen Terrain Tiles' x-amz-meta-x-imagery-sources
// header (each entry is "prefix/filename.tif"). Names/resolutions per
// https://github.com/tilezen/joerd/blob/master/docs/data-sources.md, cross-
// checked by fetching real tiles across each source's home region (srtm,
// gmted, ned13, ned_topobathy, etopo1 prefixes additionally confirmed against
// joerd's own source modules, which hardcode these exact folder names).
const AWS_SOURCE_PREFIXES: Record<string, { name: string; resolutionM: number | null }> = {
  srtm: { name: "SRTM", resolutionM: 30 },
  eudem: { name: "EU-DEM (Europe)", resolutionM: 30 },
  ned13: { name: "USGS 3DEP / NED (USA)", resolutionM: 10 },
  ned_topobathy: { name: "USGS NED Topobathy (USA coastal)", resolutionM: 3 },
  uk_lidar: { name: "UK Environment Agency LIDAR Composite DTM", resolutionM: 2 },
  austria: { name: "Austria DGM (data.gv.at)", resolutionM: 10 },
  kartverket: { name: "Norway Digital Terrain Model (Kartverket)", resolutionM: 10 },
  nzlinz: { name: "New Zealand DEM (LINZ)", resolutionM: 8 },
  geoscience_au: { name: "Geoscience Australia DEM (coastal)", resolutionM: 5 },
  pgdc_5m: { name: "ArcticDEM (Polar Geospatial Center)", resolutionM: 5 },
  mx_lidar: { name: "Mexico LIDAR (INEGI)", resolutionM: null },
  etopo1: { name: "ETOPO1 (global bathymetry)", resolutionM: 1850 },
}

// GMTED2010 is distributed at three fixed arc-second resolutions, encoded
// directly in its filename (e.g. "..._gmted_mea075.tif") — parsed here rather
// than left as a single vague "GMTED2010" entry, since the exact figure is
// actually available for the taking.
const GMTED_ARCSEC_TO_METERS: Record<string, number> = { "075": 231, "150": 463, "300": 926 }

function classifyAwsFile(file: string): { name: string; resolutionM: number | null } {
  const [prefix, filename = ""] = file.split("/")
  const key = prefix.toLowerCase()
  if (key === "gmted") {
    const match = filename.match(/mea(\d{3})/i)
    const resolutionM = match ? GMTED_ARCSEC_TO_METERS[match[1]] ?? null : null
    return { name: "GMTED2010 (coarse, low-zoom global fill)", resolutionM }
  }
  return AWS_SOURCE_PREFIXES[key] ?? { name: prefix, resolutionM: null }
}

const MAX_ZOOM_STEP_DOWN = 8

/** Both endpoints 404 above their own max zoom (which isn't published, and
 *  differs by location for Mapterhorn's per-source coverage) — rather than
 *  hard-coding a ceiling, start at the requested zoom and step down on 404
 *  until a tile actually exists. */
async function fetchWithZoomFallback(
  lng: number,
  lat: number,
  startZoom: number,
  buildUrl: (tile: TileCoords) => string,
): Promise<{ tile: TileCoords; res: Response }> {
  let lastStatus = 0
  for (let step = 0; step <= MAX_ZOOM_STEP_DOWN; step++) {
    const z = Math.max(startZoom - step, 0)
    const tile = lngLatToTile(lng, lat, z)
    const res = await fetch(buildUrl(tile))
    if (res.ok) return { tile, res }
    lastStatus = res.status
    if (z === 0) break
  }
  throw new Error(`No tile available down to zoom 0 (last status ${lastStatus})`)
}

function byResolutionAscending<T extends { resolutionM: number | null }>(a: T, b: T): number {
  if (a.resolutionM === null) return b.resolutionM === null ? 0 : 1
  if (b.resolutionM === null) return -1
  return a.resolutionM - b.resolutionM
}

export async function fetchAwsProvenance(lng: number, lat: number, startZoom: number): Promise<AwsProvenanceResult> {
  const { tile, res } = await fetchWithZoomFallback(
    lng, lat, startZoom,
    (t) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${t.z}/${t.x}/${t.y}.png`,
  )
  const header = res.headers.get("x-amz-meta-x-imagery-sources")
  const files = header ? header.split(",").map((s) => s.trim()).filter(Boolean) : []

  const byName = new Map<string, AwsSourceEntry>()
  for (const file of files) {
    const entry = classifyAwsFile(file)
    if (!byName.has(entry.name)) byName.set(entry.name, entry)
  }
  const sources = [...byName.values()].sort(byResolutionAscending)
  return { kind: "aws", tile, sources }
}

let attributionCache: Promise<MapterhornAttribution[]> | null = null
function fetchAttributionTable(): Promise<MapterhornAttribution[]> {
  if (!attributionCache) {
    attributionCache = fetch("https://download.mapterhorn.com/attribution.json")
      .then((res) => {
        if (!res.ok) throw new Error(`Mapterhorn attribution.json fetch failed (${res.status})`)
        return res.json()
      })
      .catch((err) => {
        attributionCache = null // allow retry on the next call rather than caching a failure forever
        throw err
      })
  }
  return attributionCache
}

export async function fetchMapterhornProvenance(lng: number, lat: number, startZoom: number): Promise<MapterhornProvenanceResult> {
  const [{ tile, res }, attribution] = await Promise.all([
    fetchWithZoomFallback(
      lng, lat, startZoom,
      (t) => `https://single-archive-tiles.mapterhorn.com/coverage/${t.z}/${t.x}/${t.y}.mvt`,
    ),
    fetchAttributionTable(),
  ])
  const buf = new Uint8Array(await res.arrayBuffer())
  const vt = new VectorTile(new Pbf(buf))
  const layer = vt.layers["coverage"]

  const codes = new Set<string>()
  if (layer) {
    for (let i = 0; i < layer.length; i++) {
      const code = layer.feature(i).properties["source"]
      if (typeof code === "string") codes.add(code)
    }
  }

  const byCode = new Map(attribution.map((a) => [a.source, a]))
  const sources = [...codes]
    .map((code) => ({ code, attribution: byCode.get(code) }))
    .sort((a, b) => byResolutionAscending(
      { resolutionM: a.attribution?.resolution ?? null },
      { resolutionM: b.attribution?.resolution ?? null },
    ))
  return { kind: "mapterhorn", tile, sources }
}

export async function fetchSourceProvenance(kind: ProvenanceSourceKind, lng: number, lat: number, startZoom: number): Promise<ProvenanceResult> {
  return kind === "aws" ? fetchAwsProvenance(lng, lat, startZoom) : fetchMapterhornProvenance(lng, lat, startZoom)
}
