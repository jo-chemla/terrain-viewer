import type React from "react"
import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { STAC_PRESETS, remembered, type StacPreset } from "@/lib/stac-presets"
import { useAtomValue, useAtom } from "jotai"
import { disabledStacPresetsAtom, savedStacCatalogsAtom, type SavedStacCatalog } from "@/lib/settings-atoms"
import { Search, Plus, Check, Loader2, ExternalLink, CalendarDays } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { SegmentedToggle } from "./controls-components"

// STAC search (beta). Three kinds of catalog are handled:
//  - "api": a STAC API - POST {root}/search with bbox / datetime /
//    collections (Earth Search, OpenAerialMap, eoAPI, VEDA, any
//    stac-fastapi / pgstac deployment);
//  - "static": a catalog.json tree of collections and items (Maxar / Vantor
//    Open Data, LINZ, Planet disaster releases). No search endpoint, so the
//    tree is crawled a bounded number of levels down and items are filtered
//    client-side;
//  - "discovery": a collection-search-only federation (Development Seed's
//    stac-fastapi-collection-discovery): collections come from many upstream
//    APIs, and items are fetched from the chosen collection's own OGC
//    Features `items` link with bbox / datetime query parameters.
// Either way the result is the list of COG assets in the matching items,
// each addable as a basemap (RGB) or a terrain (DEM) source.

type StacLink = { rel: string; href: string; type?: string; title?: string }
type StacAsset = { href: string; type?: string; title?: string; roles?: string[]; "proj:epsg"?: number; "proj:code"?: string; "raster:bands"?: unknown[]; "eo:bands"?: unknown[]; bands?: unknown[] }
export type StacItem = { type: "Feature"; id: string; collection?: string; bbox?: number[]; properties: Record<string, unknown>; assets: Record<string, StacAsset>; links?: StacLink[] }
export type StacCollection = { id: string; title?: string; description?: string; links?: StacLink[]; extent?: { spatial?: { bbox?: number[][] } } }

const isCog = (a: StacAsset) => /geotiff|tiff/i.test(a.type ?? "") || /\.tiff?($|\?)/i.test(a.href)
const resolveHref = (base: string, href: string) => { try { return new URL(href, base).toString() } catch { return href } }
const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const parseIso = (s: string) => new Date(`${s}T12:00:00Z`)
const trimSlash = (u: string) => u.replace(/\/$/, "")

/** EPSG code of an item / asset when the projection extension says so. */
function epsgOf(it: StacItem, a: StacAsset): number | undefined {
  const code = a["proj:code"] ?? (it.properties["proj:code"] as string | undefined)
  const fromCode = code && /^EPSG:(\d+)$/i.exec(code)?.[1]
  const epsg = a["proj:epsg"] ?? (it.properties["proj:epsg"] as number | undefined)
  return fromCode ? Number(fromCode) : epsg ?? undefined
}

const DEM_RE = /\b(dem|dsm|dtm|elevation|height|altitude|bare[- ]earth|surface model|ground model|lidar)\b/i
const NOT_DEM_RE = /\b(qa|quality|mask|saturation|occlusion|cloud|aerosol|angle|azimuth|zenith|thumbnail|preview)\b/i
/** Band count when the asset says (raster:bands, eo:bands, STAC 1.1 bands). */
const bandCount = (a: StacAsset) => (a["raster:bands"] ?? a["eo:bands"] ?? a.bands)?.length
/** Terrain wants single-band elevation rasters: drop RGB visuals, multi-band
 *  scenes and thumbnails; keep unknown band counts (many DEM catalogs
 *  carry no band metadata at all). */
function usableForTerrain(key: string, a: StacAsset): boolean {
  if (/^(visual|thumbnail|overview|rendered_preview)$/i.test(key)) return false
  const n = bandCount(a)
  return n === undefined || n === 1
}
/** An asset that reads as an elevation raster: its own key / title says so
 *  (or its collection does, for single-asset items), and nothing marks it as
 *  a quality or mask band. */
const looksLikeDem = (it: StacItem, key: string, a: StacAsset) => {
  const own = `${key} ${a.title ?? ""} ${(a.roles ?? []).join(" ")}`
  if (NOT_DEM_RE.test(own)) return false
  if (DEM_RE.test(own)) return true
  const cogs = Object.values(it.assets ?? {}).filter(isCog).length
  return cogs <= 2 && DEM_RE.test(`${it.collection ?? ""} ${it.id}`)
}

// Last search per target survives closing the modal, so re-opening it does
// not throw the results away.

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`)
  return res.json() as Promise<T>
}

/** Follow `next` links of a paginated /collections listing, up to a cap. */
/** Follow `next` links of a paginated /collections listing, handing each
 *  page over as it lands (the MAAP federation takes ~8 s for its first page
 *  and ~2 s per further page: the list fills in instead of blocking). */
async function listCollections(root: string, onPage: (sofar: StacCollection[]) => void, cap = 1200): Promise<StacCollection[]> {
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
const explainFetchError = (e: unknown, fallback: string) => {
  const msg = e instanceof Error ? e.message : fallback
  return /failed to fetch|networkerror|load failed/i.test(msg)
    ? `${msg} - the browser blocked the request. A CORS-overriding extension (e.g. "Allow CORS") breaks catalogs that already send the right headers: disable it for this site. Otherwise the catalog does not allow browser access.`
    : msg
}

/** Bounded crawl of a static catalog: child collections/catalogs to a few
 *  levels, item links collected, then fetched in small batches. */
type StacNode = { links?: StacLink[]; extent?: { spatial?: { bbox?: number[][] } } }
// Catalog / collection documents are immutable enough to keep for the
// session: the second search of OpenTopography's 283 collections is instant.
const nodeCache = new Map<string, Promise<StacNode | null>>()
const fetchNode = (u: string, signal?: AbortSignal) => {
  let p = nodeCache.get(u)
  if (!p) { p = fetchJson<StacNode>(u, { signal }).catch(() => null); nodeCache.set(u, p) }
  return p
}

async function crawlStaticItems(url: string, bbox: number[] | null, limit: number, onProgress?: (msg: string) => void, signal?: AbortSignal): Promise<StacItem[]> {
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
      // Skip whole collections that cannot overlap the viewport.
      const ext = node.extent?.spatial?.bbox?.[0]
      if (bbox && ext && (ext[2] < bbox[0] || ext[0] > bbox[2] || ext[3] < bbox[1] || ext[1] > bbox[3])) return
      for (const l of node.links ?? []) {
        if (l.rel === "item") itemLinks.push(resolveHref(u, l.href))
        else if (l.rel === "child") queue.push({ url: resolveHref(u, l.href), depth: depth + 1 })
      }
    })
  }
  for (let i = 0; i < itemLinks.length && items.length < limit; i += 16) {
    onProgress?.(`Reading items: ${Math.min(i + 16, itemLinks.length)} of ${itemLinks.length}…`)
    const batch = await Promise.all(itemLinks.slice(i, i + 16).map((l) => fetchJson<StacItem>(l, { signal }).catch(() => null)))
    for (const it of batch) {
      if (!it) continue
      if (bbox && it.bbox && (it.bbox[2] < bbox[0] || it.bbox[0] > bbox[2] || it.bbox[3] < bbox[1] || it.bbox[1] > bbox[3])) continue
      for (const a of Object.values(it.assets ?? {})) a.href = resolveHref(itemLinks[i], a.href)
      items.push(it)
    }
  }
  return items
}

export interface StacSaveSource {
  name: string
  url: string
  /** "tms" only for a collection's xyz web-map-link (basemap target). */
  type: "cog" | "tms"
  description?: string
  bounds?: [number, number, number, number]
  /** Set when the asset is known not to be Web Mercator: the in-browser
   *  reader only handles EPSG:3857, titiler reprojects server-side. */
  cogViaTitiler?: boolean
  /** Basemap target only: stack as an overlay instead of replacing the basemap. */
  role?: "basemap" | "overlay"
}

export const StacSearchPanel: React.FC<{
  /** What an added COG becomes: an RGB basemap or an elevation terrain source. */
  target: "basemap" | "terrain"
  onSave: (source: StacSaveSource) => void
  mapRef?: React.RefObject<MapRef | null>
}> = ({ target, onSave, mapRef }) => {
  // Catalogs switched off in the Library's Catalogs section are left out
  // here - that section is where the list is curated. A catalog that is
  // still the remembered choice stays listed even when hidden, so seeding it
  // from a Browse click (or reopening on a stale selection) cannot leave the
  // picker pointing at nothing.
  const disabledStac = useAtomValue(disabledStacPresetsAtom)
  const [savedCatalogs, setSavedCatalogs] = useAtom(savedStacCatalogsAtom)
  const presets = useMemo(() => {
    const off = new Set(disabledStac)
    const all = [...STAC_PRESETS, ...savedCatalogs.map((c) => ({ ...c, group: "Yours" as const, note: "Added by you." }))]
    const kept = all.filter((p) => (p.target === "both" || p.target === target)
      && (!off.has(p.id) || p.id === remembered[target]?.presetId))
    return kept.length ? kept : all.filter((p) => p.target === "both" || p.target === target)
  }, [target, disabledStac, savedCatalogs])
  const prev = remembered[target]
  const [presetId, setPresetId] = useState(prev?.presetId ?? presets[0].id)
  const [customUrl, setCustomUrl] = useState(prev?.customUrl ?? "")
  const catalog = useMemo<StacPreset>(() => presetId === "custom"
    ? { id: "custom", name: "Custom", url: trimSlash(customUrl.trim()), kind: /\.json($|\?)/i.test(customUrl) ? "static" : "api", target: "both", group: "Mixed" }
    : presets.find((p) => p.id === presetId) ?? presets[0], [presetId, customUrl, presets])
  const [collections, setCollections] = useState<StacCollection[]>(prev?.collections ?? [])
  const [collectionId, setCollectionId] = useState<string>(prev?.collectionId ?? "")
  const [startDate, setStartDate] = useState(() => prev?.startDate ?? isoDate(new Date(Date.now() - 3 * 365 * 86_400_000)))
  const [endDate, setEndDate] = useState(() => prev?.endDate ?? isoDate(new Date()))
  const [viewportOnly, setViewportOnly] = useState(prev?.viewportOnly ?? true)
  const [items, setItems] = useState<StacItem[]>(prev?.items ?? [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [added, setAdded] = useState<Set<string>>(() => new Set())
  const [only3857, setOnly3857] = useState(false)
  const [anyDate, setAnyDate] = useState(target === "terrain")
  // Max cloud cover (eo:cloud_cover), basemaps only; null = no filter.
  const [maxCloud, setMaxCloud] = useState<number | null>(null)
  const [role, setRole] = useState<"basemap" | "overlay">("basemap")
  const [collectionFilter, setCollectionFilter] = useState("")
  const [progress, setProgress] = useState("")
  // Results get most of the dialog: once they land, scroll the dialog so the
  // list starts at the top and the catalog / filter header slides away.
  const resultsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (items.length > 0) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [items])
  useEffect(() => { remembered[target] = { presetId, customUrl, collectionId, startDate, endDate, viewportOnly, items, collections } },
    [target, presetId, customUrl, collectionId, startDate, endDate, viewportOnly, items, collections])

  // Collections of the chosen catalog (API / discovery: /collections with
  // paging; static: child links). The first run is skipped when a remembered
  // listing for this catalog exists; otherwise every run (re)fetches and a
  // cleanup only discards a superseded fetch. No "already listed" guard: a
  // guard that survived the cleanup left React's dev double-invocation with
  // a cancelled fetch and a spinner that never stopped.
  const skipFirstListing = useRef(prev?.presetId === presetId && (prev?.collections.length ?? 0) > 0)
  const [listing, setListing] = useState(false)
  useEffect(() => {
    if (skipFirstListing.current) { skipFirstListing.current = false; return }
    setListing(true)
    setCollections([]); setCollectionId(""); setItems([]); setError("")
    if (!catalog.url) return
    let cancelled = false
    ;(async () => {
      try {
        if (catalog.kind === "static") {
          const root = await fetchJson<{ links?: StacLink[] }>(catalog.url)
          const children = (root.links ?? []).filter((l) => l.rel === "child")
          if (!cancelled) setCollections(children.map((l) => ({ id: resolveHref(catalog.url, l.href), title: l.title ?? l.href.replace(/^\.\//, "").replace(/\/(collection|catalog)\.json$/, "") })))
        } else {
          await listCollections(catalog.url, (sofar) => { if (!cancelled) setCollections(sofar) })
        }
      } catch (e) { if (!cancelled) setError(explainFetchError(e, "Could not list collections")) }
      finally { if (!cancelled) setListing(false) }
    })()
    return () => { cancelled = true }
  }, [catalog.url, catalog.kind])
  // web-map-links on the chosen collection: ready-made XYZ tile layers (rare:
  // NASA VEDA and the EOPF explorer publish some) - addable as-is.
  const xyzLinks = useMemo(() => {
    const col = collections.find((c) => c.id === collectionId)
    return (col?.links ?? []).filter((l) => l.rel === "xyz" && /\{z\}/.test(l.href)).map((l) => ({ href: l.href.startsWith("//") ? `https:${l.href}` : l.href, title: l.title || l.href.replace(/^https?:\/\//, "").split(/[/?]/)[0] }))
  }, [collections, collectionId])

  const runSearch = useCallback(async () => {
    setLoading(true); setError(""); setItems([])
    try {
      const map = mapRef?.current?.getMap()
      const b = viewportOnly && map ? map.getBounds() : null
      const bbox = b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null
      const datetime = anyDate ? undefined : `${startDate}T00:00:00Z/${endDate}T23:59:59Z`
      const cloudOk = (it: StacItem) => maxCloud === null || typeof it.properties?.["eo:cloud_cover"] !== "number" || (it.properties["eo:cloud_cover"] as number) <= maxCloud
      if (catalog.kind === "api") {
        const body: Record<string, unknown> = { limit: 50 }
        if (datetime) body.datetime = datetime
        if (bbox) body.bbox = bbox
        if (collectionId) body.collections = [collectionId]
        const post = (b: Record<string, unknown>) => fetchJson<{ features: StacItem[] }>(`${catalog.url}/search`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
        })
        // The query extension is optional: ask the server to filter on cloud
        // cover, fall back to the plain search (filtered here) if it refuses.
        const data = maxCloud === null ? await post(body)
          : await post({ ...body, query: { "eo:cloud_cover": { lte: maxCloud } } }).catch(() => post(body))
        setItems((data.features ?? []).filter(cloudOk))
      } else if (catalog.kind === "discovery") {
        // Collection search only: items live on the upstream API. The
        // collection's `items` link is an OGC Features endpoint that takes
        // bbox / datetime as query parameters.
        const col = collections.find((c) => c.id === collectionId)
        const itemsHref = col?.links?.find((l) => l.rel === "items")?.href
        if (!itemsHref) throw new Error("Pick a collection first: the federation only searches collections, items come from each collection's own API")
        const q = new URLSearchParams({ limit: "50" })
        if (datetime) q.set("datetime", datetime)
        if (bbox) q.set("bbox", bbox.join(","))
        const data = await fetchJson<{ features: StacItem[] }>(`${itemsHref}${itemsHref.includes("?") ? "&" : "?"}${q}`)
        setItems((data.features ?? []).filter(cloudOk))
      } else {
        const start = collectionId || catalog.url
        setItems((await crawlStaticItems(start, bbox, 50, setProgress)).filter(cloudOk))
      }
    } catch (e) {
      setError(explainFetchError(e, "Search failed"))
    } finally {
      setLoading(false)
      setProgress("")
    }
  }, [catalog, collectionId, collections, startDate, endDate, viewportOnly, anyDate, maxCloud, mapRef])

  const cogAssets = (it: StacItem) => {
    let assets = Object.entries(it.assets ?? {}).filter(([key, a]) => isCog(a) && (target !== "terrain" || usableForTerrain(key, a)))
    if (target === "terrain") {
      // A scene split into many single-band rasters (Landsat, Sentinel) is
      // multispectral, not elevation: keep the DEM-looking assets only, and
      // drop the item when it has none but more than three rasters.
      const dems = assets.filter(([k, a]) => looksLikeDem(it, k, a))
      if (dems.length) assets = dems
      else if (assets.length > 3) assets = []
    }
    if (only3857) assets = assets.filter(([, a]) => epsgOf(it, a) === 3857)
    return assets
  }
  // Web Mercator assets first (they stream in-browser), then other known
  // projections (titiler), then assets whose projection is unknown; DEM-looking
  // items first for terrain.
  const rank = (it: StacItem) => {
    const assets = cogAssets(it)
    if (!assets.length) return 99
    const codes = assets.map(([, a]) => epsgOf(it, a))
    const proj = codes.includes(3857) ? 0 : codes.some((c) => c !== undefined) ? 1 : 2
    const dem = target === "terrain" && assets.some(([k, a]) => looksLikeDem(it, k, a)) ? 0 : 1
    return proj * 2 + dem
  }
  const ordered = useMemo(() => items.slice().sort((a, b) => rank(a) - rank(b)), [items, target, only3857]) // eslint-disable-line react-hooks/exhaustive-deps

  const DateButton: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="justify-between cursor-pointer font-normal tabular-nums flex-1">{value}<CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /></Button>} />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" selected={parseIso(value)} defaultMonth={parseIso(value)} captionLayout="dropdown" startMonth={new Date(1990, 0)} endMonth={new Date()} onSelect={(d) => { if (d) onChange(isoDate(d)) }} />
      </PopoverContent>
    </Popover>
  )

  const collectionQuery = collectionFilter.trim().toLowerCase()
  const shownCollections = useMemo(() => (collectionQuery ? collections.filter((c) => `${c.title ?? ""} ${c.id}`.toLowerCase().includes(collectionQuery)) : collections).slice(0, 300), [collections, collectionQuery])
  const allLabel = catalog.kind === "discovery" ? `Pick one of ${collections.length} collections…` : `All collections (${collections.length})`
  const collectionItems = useMemo(() => Object.fromEntries([["__all__", allLabel], ...collections.map((c) => [c.id, c.title || c.id])]), [collections, allLabel])
  const browserUrl = catalog.url ? `https://radiantearth.github.io/stac-browser/#/external/${catalog.url.replace(/^https?:\/\//, "")}` : ""
  const stacMapUrl = catalog.url ? `https://developmentseed.org/stac-map/?href=${encodeURIComponent(catalog.url)}` : ""
  // "Yours" first - a catalog you saved yourself is the one you are most
  // likely reaching for, and leaving it out of this list (as the first version
  // did) filtered saved catalogs out of the picker entirely.
  const groups = ["Yours", "Elevation", "Mixed", "Imagery", "Registries"] as const
  const selectItems = Object.fromEntries([["custom", "Custom catalog URL…"], ...presets.map((p) => [p.id, p.name])])

  return (
    <div className="space-y-3 min-w-0">
      <p className="text-xs text-muted-foreground">
        Beta — search a STAC catalog for Cloud Optimized GeoTIFFs and add any as {target === "terrain" ? "terrain (DEM)" : "basemap"} sources; the dialog stays open so you can add several.
        Web Mercator (3857) assets are listed first{target === "terrain" ? ", single-band elevation rasters only" : ""}; an asset whose catalog declares another projection is pinned to titiler, the rest use the global COG setting.
      </p>
      <Select value={presetId} onValueChange={(v) => v && setPresetId(v)} items={selectItems}>
        <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Other</SelectLabel>
            <SelectItem value="custom">Custom catalog URL…</SelectItem>
          </SelectGroup>
          {groups.map((g) => {
            const rows = presets.filter((p) => p.group === g)
            if (!rows.length) return null
            return (
              <SelectGroup key={g}>
                <SelectLabel>{g}</SelectLabel>
                {rows.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectGroup>
            )
          })}
        </SelectContent>
      </Select>
      {presetId === "custom" && (
        <div className="flex items-center gap-2">
          <Input placeholder="https://…/v1 (API) or https://…/catalog.json (static)" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} className="cursor-text" />
          <Button
            variant="secondary"
            size="sm"
            className="cursor-pointer shrink-0"
            disabled={!customUrl.trim() || savedCatalogs.some((c) => c.url === trimSlash(customUrl.trim()))}
            title="Remember this catalog — it joins this list and the Library's Catalogs section"
            onClick={() => {
              const url = trimSlash(customUrl.trim())
              const entry: SavedStacCatalog = {
                id: `saved:${url}`,
                name: (() => { try { return new URL(url).host } catch { return url } })(),
                url,
                kind: /\.json($|\?)/i.test(url) ? "static" : "api",
                target: "both",
              }
              setSavedCatalogs((prev) => prev.some((c) => c.url === url) ? prev : [...prev, entry])
              setPresetId(entry.id)
            }}
          >
            Save
          </Button>
        </div>
      )}
      {catalog.note && <p className="text-[11px] text-muted-foreground">{catalog.note}</p>}
      {browserUrl && (
        <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3">
          <a href={stacMapUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">Open in stac-map (Development Seed) <ExternalLink className="h-3 w-3" /></a>
          <a href={browserUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">Open in STAC Browser (Radiant Earth) <ExternalLink className="h-3 w-3" /></a>
        </p>
      )}

      {listing && collections.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground h-9"><Loader2 className="h-4 w-4 animate-spin" /> Listing collections…</div>
      )}
      {collections.length > 0 && (
        <div className="flex items-center gap-2">
          {collections.length > 25 && (
            <Input placeholder="Filter collections…" value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} className="cursor-text w-40 shrink-0 h-9" />
          )}
          {listing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
          <Select value={collectionId || "__all__"} onValueChange={(v) => setCollectionId(!v || v === "__all__" ? "" : v)} items={collectionItems}>
            <SelectTrigger className="flex-1 min-w-0 overflow-hidden cursor-pointer"><SelectValue /></SelectTrigger>
            {/* Width pinned to the trigger and titles truncated: 300 long
                titles otherwise widened the popup past the viewport, which
                threw it to the screen corner. */}
            <SelectContent align="center" className="max-h-80 min-w-(--anchor-width) max-w-[min(calc(2*var(--anchor-width)),90vw)]">
              <SelectItem value="__all__"><span className="block truncate">{allLabel}{listing ? " (still listing…)" : ""}</span></SelectItem>
              {shownCollections.map((c) => <SelectItem key={c.id} value={c.id} title={c.title || c.id}><span className="block truncate">{c.title || c.id}</span></SelectItem>)}
              {shownCollections.length < collections.length && <SelectItem value="__more__" disabled>{collections.length - shownCollections.length} more - narrow the filter</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Checkbox id="stac-viewport-only" checked={viewportOnly} onCheckedChange={(v) => setViewportOnly(v === true)} className="cursor-pointer" />
          <Label htmlFor="stac-viewport-only" className="text-xs cursor-pointer">Only items covering the current view</Label>
        </div>
        <div className="flex items-center gap-2" title="Keep only assets the catalog declares as EPSG:3857 - the ones the in-browser reader streams without titiler">
          <Checkbox id="stac-only-3857" checked={only3857} onCheckedChange={(v) => setOnly3857(v === true)} className="cursor-pointer" />
          <Label htmlFor="stac-only-3857" className="text-xs cursor-pointer">Only Web Mercator (3857)</Label>
        </div>
      </div>
      {target === "basemap" && (
        <div className="flex items-center gap-2" title="eo:cloud_cover - sent to the API as a query when it supports it, applied here regardless">
          <Checkbox id="stac-cloud" checked={maxCloud !== null} onCheckedChange={(v) => setMaxCloud(v === true ? 20 : null)} className="cursor-pointer" />
          <Label htmlFor="stac-cloud" className="text-xs cursor-pointer">Max cloud cover</Label>
          {maxCloud !== null && (
            <span className="flex items-center gap-1 text-xs">
              <Input type="number" min={0} max={100} value={maxCloud} onChange={(e) => setMaxCloud(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="h-7 w-16 cursor-text" />%
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 shrink-0" title="Static catalogs are never filtered by date; APIs are, unless this is ticked">
          <Checkbox id="stac-any-date" checked={anyDate} onCheckedChange={(v) => setAnyDate(v === true)} className="cursor-pointer" />
          <Label htmlFor="stac-any-date" className="text-xs cursor-pointer">Any date</Label>
        </div>
        {!anyDate && (
          <>
            <DateButton value={startDate} onChange={setStartDate} />
            <span className="text-xs text-muted-foreground">to</span>
            <DateButton value={endDate} onChange={setEndDate} />
          </>
        )}
        <Button size="sm" className="cursor-pointer ml-auto shrink-0" onClick={runSearch} disabled={loading || !catalog.url}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
        </Button>
      </div>
      {target === "basemap" && (
        <div className="flex items-center gap-2">
          <Label className="text-xs">Add as</Label>
          <SegmentedToggle value={role} onChange={setRole} options={[{ value: "basemap" as const, label: "Basemap" }, { value: "overlay" as const, label: "Overlay" }]} />
        </div>
      )}
      {target === "basemap" && xyzLinks.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">This collection also publishes ready-made tile layers (web-map-links):</p>
          <div className="flex flex-wrap gap-1">
            {xyzLinks.map((l) => (
              <Button key={l.href} size="sm" variant={added.has(l.href) ? "secondary" : "outline"} className="h-7 cursor-pointer text-xs max-w-full min-w-0" disabled={added.has(l.href)} title={l.href}
                onClick={() => { setAdded((st) => new Set(st).add(l.href)); onSave({ name: l.title, url: l.href, type: "tms", description: `STAC ${catalog.name} / ${collectionId} · xyz web-map-link`, role }) }}>
                {added.has(l.href) ? <Check className="h-3 w-3 shrink-0" /> : <Plus className="h-3 w-3 shrink-0" />}<span className="truncate min-w-0">{l.title}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && progress && <p className="text-xs text-muted-foreground">{progress}</p>}

      <div ref={resultsRef} className="max-h-[65vh] overflow-y-auto overflow-x-hidden space-y-1 scroll-mt-2">
        {!loading && items.length === 0 && !error && <p className="text-sm text-muted-foreground py-3 text-center">No results yet.</p>}
        {!loading && items.length > 0 && ordered.every((it) => !cogAssets(it).length) && (
          <p className="text-sm text-muted-foreground py-3 text-center">
            {items.length} items, none with a {target === "terrain" ? "single-band elevation" : "COG"} asset.
            {target === "terrain" && (
              <>
                <br />
                <span className="text-xs">
                  {(() => {
                    // Say WHY, because "none" on a catalog you know has DEMs is
                    // otherwise a dead end. The three reasons are: nothing was a
                    // COG at all, everything was multi-band (an RGB ortho), or
                    // the items carried many rasters and none read as elevation.
                    let cogs = 0, multiband = 0
                    for (const it of items) {
                      for (const [key, a] of Object.entries(it.assets ?? {})) {
                        if (!isCog(a)) continue
                        cogs++
                        if (!usableForTerrain(key, a)) multiband++
                      }
                    }
                    if (!cogs) return "No COG assets at all — this page of results may be quicklooks or archives."
                    if (multiband === cogs) return `All ${cogs} COG assets are multi-band (RGB imagery), so none can be elevation.`
                    return `${cogs} COG assets, but none reads as elevation by key, title or role. A /search across ALL collections returns one page ordered by the API — elevation items may simply be further in, so try the specific collection.`
                  })()}
                </span>
              </>
            )}
          </p>
        )}
        {ordered.map((it) => {
          const assets = cogAssets(it)
          if (!assets.length) return null
          const p = it.properties ?? {}
          const dateOf = (k: string) => (typeof p[k] === "string" ? (p[k] as string).slice(0, 10) : "")
          const when = dateOf("datetime") || dateOf("start_datetime")
          // Human title when the item carries one (OpenAerialMap, VEDA), the
          // id (often a uuid or a tile code) otherwise.
          const title = typeof p.title === "string" && p.title.trim() ? (p.title as string) : it.id
          const gsd = typeof p.gsd === "number" ? (p.gsd < 1 ? `${Math.round(p.gsd * 100)} cm` : `${(p.gsd as number).toFixed(p.gsd < 10 ? 1 : 0)} m`) : ""
          const producer = typeof p["oam:producer_name"] === "string" ? (p["oam:producer_name"] as string) : typeof p.platform === "string" ? (p.platform as string) : ""
          const cloud = typeof p["eo:cloud_cover"] === "number" ? `☁ ${Math.round(p["eo:cloud_cover"] as number)}%` : ""
          return (
            <div key={it.id} className="p-2 rounded-md hover:bg-muted/60 space-y-1">
              <div className="text-sm truncate" title={it.id}>{title}</div>
              <div className="text-[11px] text-muted-foreground truncate">{[it.collection, when, gsd, cloud, producer].filter(Boolean).join(" · ")} · {assets.length} COG asset{assets.length === 1 ? "" : "s"}</div>
              <div className="flex flex-wrap gap-1">
                {assets.slice(0, 12).map(([key, a]) => {
                  const epsg = epsgOf(it, a)
                  // Opt-in: only an asset whose catalog DECLARES another
                  // projection is pinned to titiler; unstated ones stay on the
                  // in-browser reader (the global setting still applies).
                  const viaTitiler = epsg !== undefined && epsg !== 3857
                  const isAdded = added.has(a.href)
                  const dem = target === "terrain" && looksLikeDem(it, key, a)
                  return (
                    <Button key={key} size="sm" variant={isAdded ? "secondary" : "outline"} className="h-7 cursor-pointer text-xs max-w-full min-w-0 justify-start" disabled={isAdded}
                      title={`${a.href}\n${epsg ? `EPSG:${epsg}` : "projection not stated"}${viaTitiler ? " - served through titiler" : ""}${dem ? "\nLooks like an elevation model" : ""}`}
                      onClick={() => { setAdded((s) => new Set(s).add(a.href)); onSave({
                        name: `${when ? `${when} ` : ""}${title === it.id || a.title === title ? `${title}${a.title && a.title !== title ? ` — ${a.title}` : assets.length > 1 ? ` — ${key}` : ""}` : `${title} — ${a.title || key}`}`, url: a.href, type: "cog",
                        description: `STAC ${catalog.name}${it.collection ? ` / ${it.collection}` : ""} · ${it.id}${when ? ` · ${when}` : ""}${gsd ? ` · ${gsd}` : ""}${producer ? ` · ${producer}` : ""}${epsg ? ` · EPSG:${epsg}` : ""}`,
                        bounds: it.bbox && it.bbox.length >= 4 ? [it.bbox[0], it.bbox[1], it.bbox[2], it.bbox[3]] : undefined,
                        cogViaTitiler: viaTitiler || undefined,
                        role: target === "basemap" ? role : undefined,
                      }) }}>
                      {isAdded ? <Check className="h-3 w-3 shrink-0" /> : <Plus className="h-3 w-3 shrink-0" />}
                      <span className="truncate min-w-0">{a.title || key}</span>
                      {dem && <span className="shrink-0 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 text-[10px] font-medium">DEM</span>}
                      {epsg === 3857 && <span className="shrink-0 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 text-[10px] font-medium">3857</span>}
                      {viaTitiler && <span className="shrink-0 rounded-full bg-muted text-muted-foreground px-1.5 text-[10px] font-medium" title="Served through titiler">{epsg}</span>}
                    </Button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
