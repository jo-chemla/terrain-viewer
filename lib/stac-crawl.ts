// STAC reading shared by the STAC search panel (components/TerrainControlPanel/
// stac-search-panel.tsx, lazy-loaded) and the historical timeline's catalog
// loaders (lib/timeline-catalogs.ts, in the initial bundle): the item and
// collection types, fetch with the catalog's auth header, the paged
// /collections listing, and the bounded crawl of a static catalog.json tree
// with an extent filter on the way down and a date window on the items.
import { getDefaultStore } from "jotai"
import { STAC_PRESETS } from "./stac-presets"
import { planetAccessTokenAtom } from "./settings-atoms"

export type StacLink = { rel: string; href: string; type?: string; title?: string }
export type StacAsset = { href: string; type?: string; title?: string; roles?: string[]; "proj:epsg"?: number; "proj:code"?: string; "raster:bands"?: unknown[]; "eo:bands"?: unknown[]; bands?: unknown[] }
export type StacItem = { type: "Feature"; id: string; collection?: string; bbox?: number[]; properties: Record<string, unknown>; assets: Record<string, StacAsset>; links?: StacLink[] }
export type StacCollection = { id: string; title?: string; description?: string; links?: StacLink[]; extent?: { spatial?: { bbox?: number[][] } } }
export type StacNode = { links?: StacLink[]; extent?: { spatial?: { bbox?: number[][] }; temporal?: { interval?: (string | null)[][] } } }

export const resolveHref = (base: string, href: string) => { try { return new URL(href, base).toString() } catch { return href } }
export const trimSlash = (u: string) => u.replace(/\/$/, "")

/** Headers a catalog's requests need (StacPreset.auth): Planet's token,
 *  read from the same atom as the Historical timeline's Planet mosaics. */
export function authHeaders(url: string): Record<string, string> {
  const preset = STAC_PRESETS.find((p) => p.auth && url.startsWith(p.url))
  if (preset?.auth === "planet") {
    // api.planet.com/x/data only lists an OpenID scheme: it takes the access
    // token of `planet auth print-access-token` (a JWT) as a Bearer; a PLAK…
    // API key answers 401 there (it still works on the legacy Data API v1).
    const token = getDefaultStore().get(planetAccessTokenAtom).trim()
    if (!token) throw new Error("Planet's STAC needs an access token: Settings → API Keys → Planet access token (planet auth print-access-token)")
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...authHeaders(url), ...(init?.headers as Record<string, string> | undefined) } })
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`)
  return res.json() as Promise<T>
}

/** Whether an item's datetime (or start/end interval) overlaps a window. */
export function withinDatetime(it: StacItem, from?: number, to?: number): boolean {
  if (from === undefined && to === undefined) return true
  const p = it.properties ?? {}
  const t = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN)
  const start = t(p.start_datetime) || t(p.datetime)
  const end = t(p.end_datetime) || t(p.datetime)
  if (Number.isNaN(start) && Number.isNaN(end)) return true // undated: kept
  const s = Number.isNaN(start) ? end : start, e = Number.isNaN(end) ? start : end
  return (from === undefined || e >= from) && (to === undefined || s <= to)
}

/** Follow `next` links of a paginated /collections listing, handing each
 *  page over as it lands (the MAAP federation takes ~8 s for its first page
 *  and ~2 s per further page: the list fills in instead of blocking). */
export async function listCollections(root: string, onPage: (sofar: StacCollection[]) => void, cap = 1200): Promise<StacCollection[]> {
  const out: StacCollection[] = []
  let url: string | undefined = `${trimSlash(root)}/collections?limit=200`
  for (let i = 0; url && i < 8 && out.length < cap; i++) {
    const page: { collections?: StacCollection[]; links?: StacLink[] } = await fetchJson(url)
    out.push(...(page.collections ?? []))
    onPage(out.slice())
    url = page.links?.find((l) => l.rel === "next")?.href
  }
  return out
}

/** "Failed to fetch" is all the browser says for a blocked request; a CORS
 *  override extension ("Allow CORS" and the like) is the usual culprit when
 *  a catalog that normally works suddenly does not. */
export const explainFetchError = (e: unknown, fallback: string) => {
  const msg = e instanceof Error ? e.message : fallback
  return /failed to fetch|networkerror|load failed/i.test(msg)
    ? `${msg} - the browser blocked the request. A CORS-overriding extension (e.g. "Allow CORS") breaks catalogs that already send the right headers: disable it for this site. Otherwise the catalog does not allow browser access.`
    : msg
}

// Catalog / collection documents are immutable enough to keep for the
// session: the second search of OpenTopography's 283 collections is instant.
// Items too: the timeline crawls the same static catalog on every view move.
const nodeCache = new Map<string, Promise<StacNode | null>>()
export const fetchNode = (u: string, signal?: AbortSignal) => {
  let p = nodeCache.get(u)
  if (!p) { p = fetchJson<StacNode>(u, { signal }).catch(() => null); nodeCache.set(u, p) }
  return p
}
const itemCache = new Map<string, Promise<StacItem | null>>()
const fetchItem = (u: string, signal?: AbortSignal) => {
  let p = itemCache.get(u)
  if (!p) {
    p = fetchJson<StacItem>(u, { signal }).then((it) => {
      // Asset hrefs made absolute once, against the item's own URL.
      for (const a of Object.values(it.assets ?? {})) a.href = resolveHref(u, a.href)
      return it
    }).catch(() => null)
    itemCache.set(u, p)
    // A failed read (an abort, a hiccup) is not kept: the next crawl retries it.
    p.then((it) => { if (!it) itemCache.delete(u) })
  }
  return p
}

/** Bounded crawl of a static catalog: child collections/catalogs to a few
 *  levels, item links collected, then fetched in small batches. Whole
 *  collections that cannot overlap `bbox` or `window` (their extents) are
 *  skipped; items are filtered by bbox and datetime. */
export async function crawlStaticItems(url: string, bbox: number[] | null, limit: number, onProgress?: (msg: string) => void, signal?: AbortSignal, window?: { from: number; to: number }): Promise<StacItem[]> {
  const items: StacItem[] = []
  const queue: { url: string; depth: number }[] = [{ url, depth: 0 }]
  const itemLinks: string[] = []
  const seen = new Set<string>()
  let visited = 0
  // Children are fetched sixteen at a time: OpenTopography's root alone has
  // 283 collections, which took minutes one by one.
  while (queue.length && itemLinks.length < limit * 4) {
    const batch: { url: string; depth: number }[] = []
    while (queue.length && batch.length < 16) {
      const next = queue.shift()!
      if (seen.has(next.url) || next.depth > 4) continue
      seen.add(next.url)
      batch.push(next)
    }
    const nodes = await Promise.all(batch.map(({ url: u }) => fetchNode(u, signal)))
    visited += batch.length
    onProgress?.(`Crawling the catalog: ${visited} read, ${queue.length} queued, ${itemLinks.length} items found…`)
    nodes.forEach((node, i) => {
      if (!node) return
      const { url: u, depth } = batch[i]
      // Skip whole collections that cannot overlap the viewport, or the
      // date window (a collection's temporal extent; an open end is null).
      const ext = node.extent?.spatial?.bbox?.[0]
      if (bbox && ext && (ext[2] < bbox[0] || ext[0] > bbox[2] || ext[3] < bbox[1] || ext[1] > bbox[3])) return
      const temporal = node.extent?.temporal?.interval?.[0]
      if (window && temporal) {
        const s = temporal[0] ? Date.parse(temporal[0]) : -Infinity, e = temporal[1] ? Date.parse(temporal[1]) : Infinity
        if (e < window.from || s > window.to) return
      }
      for (const l of node.links ?? []) {
        if (l.rel === "item") itemLinks.push(resolveHref(u, l.href))
        else if (l.rel === "child") queue.push({ url: resolveHref(u, l.href), depth: depth + 1 })
      }
    })
  }
  for (let i = 0; i < itemLinks.length && items.length < limit; i += 16) {
    if (signal?.aborted) break
    onProgress?.(`Reading items: ${Math.min(i + 16, itemLinks.length)} of ${itemLinks.length}…`)
    const batch = await Promise.all(itemLinks.slice(i, i + 16).map((l) => fetchItem(l, signal)))
    for (const it of batch) {
      if (!it) continue
      if (bbox && it.bbox && (it.bbox[2] < bbox[0] || it.bbox[0] > bbox[2] || it.bbox[3] < bbox[1] || it.bbox[1] > bbox[3])) continue
      if (window && !withinDatetime(it, window.from, window.to)) continue
      items.push(it)
    }
  }
  return items
}
