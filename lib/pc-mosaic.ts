// Scenes mosaicked on the fly by Microsoft Planetary Computer's data API,
// as the two "Historical · Global" catalogs that complement Google Earth
// Timelapse's fixed yearly mosaics (lib/google-timelapse.ts): Landsat
// Collection 2 Level-2 by quarter since 1982, Sentinel-2 L2A by month since
// 2016. The only keyless route to Landsat 4 to 9 scenes before HLS (2013),
// and to Sentinel-2 at any month rather than EOX's one mosaic a year.
//
// Planetary Computer runs a STAC API over its catalog and a data API
// (titiler-pgstac) that tiles a STAC search: POST /mosaic/register with the
// search (collections, datetime, a CQL2 filter, a sort) answers a search id,
// and /mosaic/{id}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png reads the
// scenes' COGs in Azure for that tile. For each pixel it takes the first
// scene in sort order that has data there ("first" pixel selection), so
// with the scenes sorted least cloudy first a tile is a least-cloudy-scene
// mosaic, not a per-pixel composite: seams between neighbouring scenes and
// some residual cloud remain. The API signs the COG reads itself; register
// and tiles answer with an open CORS header, no token.
//
// The registration is a POST, which a MapLibre `tiles` template cannot
// send, hence the protocol:
//
//   pcmosaic://<collection>/{z}/{x}/{y}?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The handler registers the window's search once (cached) and fetches the
// tile. Two searches are kept per window: scenes with at most 10 % cloud
// first, and when no such scene covers the tile (an overcast quarter, a
// rainy month) a second search at 60 % so the tile still draws, cloudier.
// Below a zoom of 8 (Landsat) or 9 (Sentinel-2) the API answers 204, empty,
// so each catalog's layers carry a minzoom.

const PC_DATA_API = "https://planetarycomputer.microsoft.com/api/data/v1"

export const PC_MOSAIC_TILE_SIZE = 256
export const PC_MOSAIC_ATTRIBUTION = "Microsoft Planetary Computer"

const CLOUD_COVER_STRICT = 10
const CLOUD_COVER_LOOSE = 60

interface PcCollection {
  /** Render query of the tiles endpoint: assets and colour. */
  render: string
  minzoom: number
  maxzoom: number
}

export const PC_COLLECTIONS: Record<string, PcCollection> = {
  // Planetary Computer's own Landsat "Natural color" recipe; nodata 0 so
  // scene edges fall through to the next scene. 30 m: zoom 13 is about 19 m
  // a pixel at the equator, MapLibre magnifies past it.
  "landsat-c2-l2": {
    render: new URLSearchParams([
      ["assets", "red"], ["assets", "green"], ["assets", "blue"],
      ["nodata", "0"],
      ["color_formula", "gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55"],
      ["collection", "landsat-c2-l2"],
    ]).toString(),
    minzoom: 8, maxzoom: 13,
  },
  // The L2A product's own true-colour image (TCI), 8-bit, 10 m.
  "sentinel-2-l2a": {
    render: new URLSearchParams([["assets", "visual"], ["nodata", "0"], ["collection", "sentinel-2-l2a"]]).toString(),
    minzoom: 9, maxzoom: 15,
  },
}

/** Landsat 4 TM's first scene in the collection. */
export const PC_LANDSAT_START = Date.UTC(1982, 7, 22)
/** Sentinel-2A's first full year; Level-2A is in the catalog from here. */
export const PC_SENTINEL2_START = Date.UTC(2016, 0, 1)

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function pcMosaicTileUrl(collection: string, fromMs: number, toMs: number): string {
  return `pcmosaic://${collection}/{z}/{x}/{y}?from=${isoDay(fromMs)}&to=${isoDay(toMs)}`
}

export interface PcWindow { fromMs: number; toMs: number; label: string; year: number }

/** One window a quarter from 1982 Q4 to the current quarter. */
export function pcQuarters(): PcWindow[] {
  const out: PcWindow[] = []
  const now = Date.now()
  for (let y = 1982; ; y++) {
    for (let q = 0; q < 4; q++) {
      const fromMs = Date.UTC(y, q * 3, 1), toMs = Date.UTC(y, q * 3 + 3, 0)
      if (fromMs > now) return out
      if (toMs < PC_LANDSAT_START) continue
      out.push({ fromMs, toMs, label: `${y} Q${q + 1}`, year: y })
    }
  }
}

/** One window a month from January 2016 to the current month. */
export function pcMonths(): PcWindow[] {
  const out: PcWindow[] = []
  const now = Date.now()
  for (let y = 2016; ; y++) {
    for (let m = 0; m < 12; m++) {
      const fromMs = Date.UTC(y, m, 1), toMs = Date.UTC(y, m + 1, 0)
      if (fromMs > now) return out
      out.push({ fromMs, toMs, label: `${y}-${String(m + 1).padStart(2, "0")}`, year: y })
    }
  }
}

// ── Search registration ───────────────────────────────────────────────────
const searches = new Map<string, Promise<string>>()

function registerSearch(collection: string, from: string, to: string, maxCloud: number): Promise<string> {
  const key = `${collection}|${from}|${to}|${maxCloud}`
  const hit = searches.get(key)
  if (hit) return hit
  const p = (async () => {
    const res = await fetch(`${PC_DATA_API}/mosaic/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collections: [collection],
        datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
        "filter-lang": "cql2-json",
        filter: { op: "<=", args: [{ property: "eo:cloud_cover" }, maxCloud] },
        sortby: [{ field: "eo:cloud_cover", direction: "asc" }],
      }),
    })
    if (!res.ok) throw new Error(`Planetary Computer mosaic register ${res.status}`)
    const json = (await res.json()) as { searchid?: string; id?: string }
    const id = json.searchid ?? json.id
    if (!id) throw new Error("Planetary Computer mosaic register: no search id")
    return id
  })()
  p.catch(() => searches.delete(key))
  searches.set(key, p)
  return p
}

const URL_RE = /^pcmosaic:\/\/([a-z0-9-]+)\/(\d+)\/(\d+)\/(\d+)\?from=(\d{4}-\d{2}-\d{2})&to=(\d{4}-\d{2}-\d{2})$/

/** One tile as encoded PNG bytes; null when no scene of the window covers it
 *  at either cloud threshold, or the zoom is below the collection's. */
export async function fetchPcMosaicTile(url: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  const m = url.match(URL_RE)
  if (!m) throw new Error(`Invalid pcmosaic protocol URL: ${url}`)
  const [, collection, z, x, y, from, to] = m
  const spec = PC_COLLECTIONS[collection]
  if (!spec) throw new Error(`pcmosaic: unknown collection ${collection}`)
  if (+z < spec.minzoom) return null
  for (const maxCloud of [CLOUD_COVER_STRICT, CLOUD_COVER_LOOSE]) {
    const searchId = await registerSearch(collection, from, to, maxCloud)
    const res = await fetch(`${PC_DATA_API}/mosaic/${searchId}/tiles/WebMercatorQuad/${z}/${x}/${y}@1x.png?${spec.render}`, { signal })
    if (res.status === 204 || res.status === 404) continue
    if (!res.ok) throw new Error(`Planetary Computer tile ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  return null
}

export async function pcMosaicProtocol(params: { url: string }, abortController: AbortController): Promise<{ data: Uint8Array }> {
  const data = await fetchPcMosaicTile(params.url, abortController.signal)
  if (!data) throw new Error(`No scene for ${params.url.slice(0, 80)}`)
  return { data }
}
