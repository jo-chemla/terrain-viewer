// STAC catalogs as dated imagery sources of the shared schema
// (DatedImagerySource in lib/source-schema.ts), beside Wayback, HLS, Google
// Earth historical, Planet, EOX, Bing (lib/dated-imagery.ts) and the
// national series (lib/national-dated.ts). One adapter, configured per
// catalog (StacCatalogConfig): an API root or a static catalog.json, its
// collections, the asset to drape, whether its hrefs need signing, and the
// ceiling when items state no GSD. OpenAerialMap and Maxar Open Data (both
// through HOT's STAC API) are presets, with Vantor, NOAA and Planetary
// Computer's Sentinel-2.
//
//   dates at a place  a STAC item search over a box around the point (pages
//                     followed up to a cap), the items grouped by UTC day of
//                     acquisition: one tick a day;
//   tiles of a date   that day's COGs: one alone through titiler, several
//                     mosaicked by lib/capture-mosaic.ts (capture://), with
//                     the union of their footprints as the bounds;
//   ceiling           the zoom whose pixel matches the day's finest item GSD.
//
// What differs from the global sources: a date covers only the items'
// footprints (the tiles' bounds), a date is often several items (a satellite
// pass cut into 5 km COGs, two drone flights the same day), and Planetary
// Computer's hrefs need a SAS token (fetched per collection, kept until it
// expires; tiles() returns null until one is held). The COGs go through
// titiler rather than the in-browser cog:// protocol because most are in UTM,
// which that protocol does not reproject (as the timeline's catalog COGs).
//
// The search and the asset choice are shared with the timeline's STAC
// catalogs (stacTicks in lib/timeline-catalogs.ts), which list the same items
// one tick per acquisition with a card each; the STAC search panel
// (stac-search-panel.tsx) is the manual search, one page at a time, and
// opens the preset's catalog (presetId).
//
// Ids (stac-oam, stac-maxar...) never change.
import { getDefaultStore } from "jotai"
import type { DatedImagerySource, DatedImageryPlace, DatedImageryTick, DatedImageryTiles } from "./source-schema"
import { fetchJson, crawlStaticItems, trimSlash, authHeaders, type StacItem, type StacLink, type StacAsset } from "./stac-crawl"
import { captureTileUrl, updateCapture, fetchCaptureTileBlob } from "./capture-mosaic"
import { buildRasterTileSource } from "./source-builder"
import { titilerEndpointAtom } from "./settings-atoms"

export type Bbox = [west: number, south: number, east: number, north: number]

/** One STAC catalog as a dated source. */
export interface StacCatalogConfig {
  /** The dated source's id. */
  id: string
  name: string
  shortName: string
  description: string
  infoUrl?: string
  /** A STAC API root (one /search per place) or a static catalog.json (crawled). */
  endpoint: string
  kind: "api" | "static"
  /** API: the collection ids searched (all when unset). Static: a child
   *  catalog URL to start the crawl from instead of the root. */
  collections?: string[]
  /** The item's asset to drape, tried in order before the defaults (visual,
   *  cog, image, the visual role, the first GeoTIFF). */
  assetKeys?: string[]
  /** "planetary-computer": asset hrefs on Azure Blob need a SAS token from
   *  Planetary Computer's token endpoint (CORS-open, about 45 min). */
  signing?: "planetary-computer"
  licence?: string
  /** The source's ceiling, and a day's when its items state no GSD. */
  maxzoom: number
  /** Items read per place at most (default 300). */
  maxItems?: number
  /** STAC query extension (API only, sent as a POST), e.g. cloud cover. */
  query?: Record<string, unknown>
  /** The STAC search panel's catalog for the same items (STAC_PRESETS id). */
  presetId?: string
  /** The timeline catalog that reads the same items (lib/timeline-catalogs.ts). */
  timelineCatalog?: string
}

const HOT_STAC = "https://api.imagery.hotosm.org/stac"
const PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"

/** The presets: HOT's collections (OpenAerialMap, Maxar, Vantor, NOAA) and
 *  Planetary Computer's Sentinel-2 L2A true colour (signed). */
export const STAC_DATED_CATALOGS: readonly StacCatalogConfig[] = [
  { id: "stac-oam", name: "OpenAerialMap", shortName: "OAM", endpoint: HOT_STAC, kind: "api", collections: ["openaerialmap"],
    description: "Open drone, aerial and satellite scenes uploaded to OpenAerialMap, from HOT's STAC API: one date per day of capture, that day's uploads mosaicked over their footprints.",
    infoUrl: "https://openaerialmap.org/", licence: "CC BY 4.0 (per upload)", maxzoom: 22, presetId: "oam", timelineCatalog: "cat-oam" },
  { id: "stac-maxar", name: "Maxar Open Data", shortName: "Maxar", endpoint: HOT_STAC, kind: "api", collections: ["maxar-opendata"],
    description: "Maxar's pre- and post-event 30-50 cm imagery of disasters, from HOT's STAC API: one date per day of acquisition, the pass's COGs mosaicked.",
    infoUrl: "https://www.maxar.com/open-data", licence: "CC BY-NC 4.0", maxzoom: 19, presetId: "oam", timelineCatalog: "cat-maxar" },
  { id: "stac-vantor", name: "Vantor Open Data", shortName: "Vantor", endpoint: HOT_STAC, kind: "api", collections: ["vantor-opendata"],
    description: "Vantor (ex-Maxar) open data programme, 2025 onwards, from HOT's STAC API.",
    infoUrl: "https://vantor.com/", licence: "CC BY-NC 4.0", maxzoom: 19, presetId: "oam", timelineCatalog: "cat-vantor" },
  { id: "stac-noaa", name: "NOAA emergency response", shortName: "NOAA", endpoint: HOT_STAC, kind: "api", collections: ["noaa-emergency-response"],
    description: "NOAA's aerial imagery after hurricanes, tornadoes and floods, from HOT's STAC API: one date per flight day.",
    infoUrl: "https://storms.ngs.noaa.gov/", licence: "Public domain (NOAA)", maxzoom: 20, presetId: "oam", timelineCatalog: "cat-noaa" },
  { id: "stac-pc-s2", name: "Sentinel-2 L2A scenes (Planetary Computer)", shortName: "S2 scenes", endpoint: PC_STAC, kind: "api", collections: ["sentinel-2-l2a"],
    description: "Every Sentinel-2 L2A acquisition under 20 % cloud at the place, from Microsoft Planetary Computer's STAC API: its true-colour COG (visual), signed with a Planetary Computer SAS token.",
    infoUrl: "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a", licence: "Copernicus Sentinel data terms", maxzoom: 14,
    assetKeys: ["visual"], signing: "planetary-computer", query: { "eo:cloud_cover": { lt: 20 } }, maxItems: 200 },
]

// ── Search ──────────────────────────────────────────────────────────────────

export interface StacSearchSpec { endpoint: string; kind: "api" | "static"; collections?: string[]; query?: Record<string, unknown> }

/** Items of a catalog over a box: an API's /search (GET, or POST when the
 *  server refuses GET or a query is set), `next` pages followed until
 *  `maxItems`; a static tree crawled (lib/stac-crawl.ts). */
export async function searchStacItems(spec: StacSearchSpec, bbox: Bbox, opts: { range?: [number, number]; signal?: AbortSignal; maxItems?: number; pageSize?: number } = {}): Promise<StacItem[]> {
  const { range, signal } = opts
  const maxItems = opts.maxItems ?? 300
  if (spec.kind === "static") {
    return crawlStaticItems(spec.collections?.[0] ?? spec.endpoint, bbox, maxItems, undefined, signal, range ? { from: range[0], to: range[1] } : undefined)
  }
  const base = trimSlash(spec.endpoint)
  const limit = Math.min(opts.pageSize ?? 100, maxItems)
  const datetime = range ? `${new Date(Math.max(0, range[0])).toISOString()}/${new Date(range[1]).toISOString()}` : undefined
  const body: Record<string, unknown> = { bbox, limit, ...(spec.collections?.length ? { collections: spec.collections } : {}), ...(datetime ? { datetime } : {}), ...(spec.query ? { query: spec.query } : {}) }
  const post = (b: Record<string, unknown>, url = `${base}/search`) =>
    fetchJson<{ features?: StacItem[]; links?: StacLink[] }>(url, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(b) })
  let page: { features?: StacItem[]; links?: StacLink[] }
  if (spec.query) page = await post(body)
  else {
    const q = new URLSearchParams({ bbox: bbox.map((v) => v.toFixed(6)).join(","), limit: String(limit) })
    if (spec.collections?.length) q.set("collections", spec.collections.join(","))
    if (datetime) q.set("datetime", datetime)
    const res = await fetch(`${base}/search?${q}`, { signal, headers: authHeaders(base) })
    if (res.ok) page = await res.json()
    // A server that refuses GET (405, or a 400 on the query form) takes the same search as a POST body.
    else if (res.status === 405 || res.status === 400) page = await post(body)
    else throw new Error(`STAC ${res.status} from ${new URL(base).host}`)
  }
  const items: StacItem[] = [...(page.features ?? [])]
  let lastBody = body
  for (let i = 0; i < 10 && items.length < maxItems && page.features?.length; i++) {
    const next = page.links?.find((l) => l.rel === "next") as (StacLink & { method?: string; body?: Record<string, unknown>; merge?: boolean }) | undefined
    if (!next?.href) break
    if ((next.method ?? "GET").toUpperCase() === "POST") {
      lastBody = next.merge ? { ...lastBody, ...next.body } : next.body ?? lastBody
      page = await post(lastBody, next.href)
    } else page = await fetchJson(next.href, { signal })
    items.push(...(page.features ?? []))
  }
  return items.slice(0, maxItems)
}

/** The item's asset to drape: the catalog's keys, then visual / cog / image,
 *  then an asset with the visual role, then the first GeoTIFF that is not a
 *  mask or metadata. */
export function stacAssetHref(assets: Record<string, StacAsset> | undefined, prefer?: string[]): string | null {
  if (!assets) return null
  for (const k of prefer ?? []) if (assets[k]?.href) return assets[k].href
  for (const k of ["visual", "ortho_visual", "cog", "image"]) if (assets[k]?.href) return assets[k].href
  const visual = Object.values(assets).find((a) => a?.href && (a.roles ?? []).includes("visual"))
  if (visual) return visual.href
  const tiff = Object.values(assets).find((a) => a?.href && /cloud-optimized|image\/tiff/.test(String(a?.type ?? "")) && !(a.roles ?? []).some((r) => /mask|metadata|thumbnail|overview/.test(r)))
  return tiff?.href ?? null
}

/** An item's acquisition time: its datetime, else the start (or end) of its interval. */
export function stacItemDateMs(it: StacItem): number {
  const p = it.properties ?? {}
  const v = p.datetime ?? p.start_datetime ?? p.end_datetime
  return typeof v === "string" ? Date.parse(v) : NaN
}

// ── Grouping ────────────────────────────────────────────────────────────────

export interface StacDayItem { id: string; collection?: string; href: string; bbox: Bbox; gsd?: number; title?: string; thumb?: string; licence?: string }
/** One date of a STAC source: the items acquired that UTC day over the place. */
export interface StacDay {
  dayMs: number
  label: string
  items: StacDayItem[]
  /** The finest GSD the items state, in metres. */
  gsd?: number
  /** The union of the items' footprints. */
  bounds: Bbox
  /** The box the search covered, for the mosaic. */
  searched: Bbox
}

const union = (bs: Bbox[]): Bbox => bs.reduce<Bbox>((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [...bs[0]] as Bbox)

/** Items grouped by UTC day of acquisition, oldest first. Items without a
 *  date, a footprint or a COG to drape are dropped; an href found twice is
 *  kept once. */
export function groupStacItemsByDay(items: StacItem[], searched: Bbox, assetKeys?: string[]): StacDay[] {
  const days = new Map<number, StacDayItem[]>()
  const seen = new Set<string>()
  for (const it of items) {
    const t = stacItemDateMs(it)
    const href = stacAssetHref(it.assets, assetKeys)
    if (!Number.isFinite(t) || !href || seen.has(href) || !Array.isArray(it.bbox) || it.bbox.length < 4) continue
    seen.add(href)
    // A 3D bbox is [w, s, zmin, e, n, zmax].
    const b = (it.bbox.length >= 6 ? [it.bbox[0], it.bbox[1], it.bbox[3], it.bbox[4]] : it.bbox.slice(0, 4)) as Bbox
    const d = new Date(t)
    const dayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    const p = it.properties ?? {}
    const gsd = Number(p.gsd)
    const list = days.get(dayMs) ?? []
    list.push({
      id: it.id, collection: it.collection, href, bbox: b,
      gsd: Number.isFinite(gsd) && gsd > 0 ? gsd : undefined,
      title: typeof p.title === "string" ? p.title : undefined,
      thumb: it.assets?.thumbnail?.href ?? it.assets?.preview?.href ?? it.assets?.rendered_preview?.href,
      licence: typeof p.license === "string" ? p.license : undefined,
    })
    days.set(dayMs, list)
  }
  return [...days].sort((a, b) => a[0] - b[0]).map(([dayMs, list]) => {
    const gsds = list.map((x) => x.gsd).filter((g): g is number => g !== undefined)
    return { dayMs, label: new Date(dayMs).toISOString().slice(0, 10), items: list, gsd: gsds.length ? Math.min(...gsds) : undefined, bounds: union(list.map((x) => x.bbox)), searched }
  })
}

/** The deepest zoom worth asking for a GSD: the first whose pixel is no
 *  larger than it, at a latitude, capped. */
export function maxzoomForGsd(gsdM: number, latDeg = 0, cap = 22): number {
  const z = Math.ceil(Math.log2((40075016.686 * Math.cos((latDeg * Math.PI) / 180)) / (256 * gsdM)))
  return Math.max(0, Math.min(cap, z))
}

/** The box searched around a place: about two tiles of its zoom across
 *  (at least 20 m), so the items found are the ones under the view's centre. */
export function bboxAround({ lat, lng, zoom }: DatedImageryPlace): Bbox {
  const half = Math.max(0.0002, 360 / 2 ** Math.max(0, zoom))
  const halfLat = Math.min(half * Math.cos((lat * Math.PI) / 180), 10)
  return [Math.max(-180, lng - half), Math.max(-85, lat - halfLat), Math.min(180, lng + half), Math.min(85, lat + halfLat)]
}

// ── Signing (Planetary Computer) ────────────────────────────────────────────

const PC_TOKEN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/token"
const pcTokens = new Map<string, { token: string; expiresMs: number }>()
const pcPending = new Map<string, Promise<void>>()

/** A Planetary Computer SAS token for a collection, fetched when none is
 *  held or it has less than five minutes left. */
export function ensurePcToken(collection: string, signal?: AbortSignal): Promise<void> {
  const held = pcTokens.get(collection)
  if (held && held.expiresMs - Date.now() > 5 * 60_000) return Promise.resolve()
  let p = pcPending.get(collection)
  if (!p) {
    p = fetchJson<{ token: string; "msft:expiry": string }>(`${PC_TOKEN_URL}/${encodeURIComponent(collection)}`, { signal })
      .then((r) => { pcTokens.set(collection, { token: r.token, expiresMs: Date.parse(r["msft:expiry"]) || Date.now() + 30 * 60_000 }) })
      .finally(() => pcPending.delete(collection))
    pcPending.set(collection, p)
  }
  return p
}

/** An Azure Blob href with the collection's token; null when no token is
 *  held yet. Other hosts are returned as they are. */
export function signPcHref(href: string, collection: string | undefined): string | null {
  if (!/\.blob\.core\.windows\.net\//.test(href)) return href
  const held = collection ? pcTokens.get(collection) : undefined
  if (!held) return null
  if (held.expiresMs < Date.now() && collection) void ensurePcToken(collection).catch(() => {})
  return `${href.split("?")[0]}?${held.token}`
}

// ── The source ──────────────────────────────────────────────────────────────

/** An item's COG address as a client can read it (signed for Planetary
 *  Computer; null until a token is held). */
export function stacItemHref(cfg: Pick<StacCatalogConfig, "signing">, item: StacDayItem): string | null {
  return cfg.signing === "planetary-computer" ? signPcHref(item.href, item.collection) : item.href
}

/** The tiles of one day: a lone COG through titiler, several mosaicked. */
export function stacDayTiles(cfg: StacCatalogConfig, day: StacDay): DatedImageryTiles | null {
  const cogs: { href: string; bbox: Bbox }[] = []
  for (const it of day.items) {
    const href = stacItemHref(cfg, it)
    if (!href) return null
    cogs.push({ href, bbox: it.bbox })
  }
  if (!cogs.length) return null
  const lat = (day.bounds[1] + day.bounds[3]) / 2
  const maxzoom = day.gsd ? maxzoomForGsd(day.gsd, lat, 22) : cfg.maxzoom
  const titilerEndpoint = getDefaultStore().get(titilerEndpointAtom)
  if (cogs.length === 1) {
    const src = buildRasterTileSource({ url: cogs[0].href, type: "cog", useCogProtocol: false, titilerEndpoint }) as { tiles: string[] }
    return { tiles: src.tiles, urlTemplate: src.tiles[0], tileSize: 256, maxzoom, bounds: day.bounds }
  }
  const id = `${cfg.id}|${day.label}`
  updateCapture(id, cogs, day.searched)
  return { tiles: [captureTileUrl(id)], fetchTileBlob: (z, x, y, signal) => fetchCaptureTileBlob(id, z, x, y, signal), tileSize: 256, maxzoom, bounds: day.bounds }
}

const gsdText = (g: number) => (g < 1 ? `${Math.round(g * 100)} cm` : `${+g.toFixed(1)} m`)

/** A catalog as a dated source. */
export function stacDatedSource(cfg: StacCatalogConfig): DatedImagerySource {
  // The days of the last listing, so that a date alone names its tiles.
  const lastDays = new Map<number, StacDay>()
  return {
    id: cfg.id, name: cfg.name, shortName: cfg.shortName, kind: "raster", section: "catalog",
    description: cfg.description, infoUrl: cfg.infoUrl,
    granularity: "capture", realDates: true, historicalEntry: false,
    tileSize: 256, maxzoom: cfg.maxzoom,
    attribution: `${cfg.name}${cfg.licence ? `, ${cfg.licence}` : ""}`, licence: cfg.licence,
    fileStem: cfg.id, exportLabel: cfg.shortName,
    listDates: async (place, startMs, endMs) => {
      const searched = bboxAround(place)
      const items = await searchStacItems(cfg, searched, { range: [startMs, endMs], maxItems: cfg.maxItems })
      const days = groupStacItemsByDay(items, searched, cfg.assetKeys).filter((d) => d.dayMs + 86_400_000 > startMs && d.dayMs <= endMs)
      if (cfg.signing === "planetary-computer") {
        const cols = new Set(days.flatMap((d) => d.items.map((x) => x.collection).filter((c): c is string => !!c)))
        await Promise.all([...cols].map((c) => ensurePcToken(c)))
      }
      lastDays.clear()
      for (const d of days) lastDays.set(d.dayMs, d)
      return days.map((d): DatedImageryTick => ({
        dateMs: d.dayMs, label: d.label, ref: d,
        title: `${d.items.length} item${d.items.length > 1 ? "s" : ""}${d.gsd ? `, ${gsdText(d.gsd)}` : ""}${d.items.length === 1 && d.items[0].title ? `: ${d.items[0].title}` : ""}`,
      }))
    },
    tiles: ({ dateMs, ref }) => {
      const d = new Date(dateMs)
      const day = (ref as StacDay | undefined) ?? lastDays.get(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      return day ? stacDayTiles(cfg, day) : null
    },
  }
}

/** Every STAC preset, as dated sources. */
export const STAC_DATED_SOURCES: readonly DatedImagerySource[] = STAC_DATED_CATALOGS.map(stacDatedSource)
