import type React from "react"
import { useState, useCallback, useEffect, useMemo } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Search, Plus, Loader2, ExternalLink, CalendarDays } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"

// STAC search (beta). Three kinds of catalogue are handled:
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
export interface StacPreset {
  id: string
  name: string
  url: string
  kind: "api" | "static" | "discovery"
  /** Which modal offers it: imagery-only catalogues are pointless for terrain. */
  target: "basemap" | "terrain" | "both"
  group: "Imagery" | "Elevation" | "Mixed" | "Registries"
  note?: string
}

export const STAC_PRESETS: StacPreset[] = [
  // Mixed imagery + elevation
  { id: "oam", name: "OpenAerialMap (HOT)", url: "https://api.imagery.hotosm.org/stac", kind: "api", target: "both", group: "Mixed",
    note: "Drone and aerial scenes from OpenAerialMap plus Maxar and Vantor open-data events, NOAA emergency response imagery and Copernicus GLO-30 - all keyless COGs." },
  { id: "earth-search", name: "Earth Search (AWS, Element 84)", url: "https://earth-search.aws.element84.com/v1", kind: "api", target: "both", group: "Mixed",
    note: "Sentinel-2 L2A (use the `visual` asset), Landsat, NAIP, Copernicus DEM - keyless, CORS-open." },
  { id: "eoapi", name: "eoAPI demo (Development Seed)", url: "https://stac.eoapi.dev", kind: "api", target: "both", group: "Mixed",
    note: "Maxar open-data events, OpenAerialMap, LA 2025 wildfires, Sentinel-2 mosaics, Copernicus DEM." },
  { id: "veda", name: "NASA VEDA", url: "https://openveda.cloud/api/stac", kind: "api", target: "both", group: "Mixed",
    note: "NASA's disaster and climate collections, including PlanetScope pre/post event imagery." },
  { id: "geoadmin", name: "swisstopo (data.geo.admin.ch)", url: "https://data.geo.admin.ch/api/stac/v1", kind: "api", target: "both", group: "Mixed",
    note: "SWISSIMAGE orthophotos and swissALTI3D 0.5 m COGs. Assets are in LV95 (EPSG:2056), so they are routed through titiler." },
  { id: "linz-imagery", name: "LINZ New Zealand Imagery", url: "https://nz-imagery.s3.ap-southeast-2.amazonaws.com/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Toitū Te Whenua's aerial imagery archive as COGs (NZTM2000, EPSG:2193 - routed through titiler)." },
  { id: "linz-elevation", name: "LINZ New Zealand Elevation", url: "https://nz-elevation.s3.ap-southeast-2.amazonaws.com/catalog.json", kind: "static", target: "terrain", group: "Elevation",
    note: "1 m LiDAR DEM and DSM tiles (EPSG:2193 - routed through titiler)." },
  // Disaster imagery
  { id: "maxar-opendata", name: "Maxar Open Data - disaster events", url: "https://maxar-opendata.s3.dualstack.us-west-2.amazonaws.com/events/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Pre/post-event 30-50 cm ARD COGs per event (CC BY-NC 4.0). Static catalog: pick an event, items are crawled." },
  { id: "vantor-opendata", name: "Vantor Open Data - disaster events", url: "https://vantor-opendata.s3.amazonaws.com/events/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Maxar's successor programme, 2025 onwards (CC BY-NC 4.0)." },
  { id: "planet-disaster", name: "Planet disaster data releases", url: "https://data.source.coop/planet/disasterdata/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Planet Crisis Response Program imagery for major events, mirrored on Source Cooperative (Portolan registry)." },
  { id: "lgln-dop", name: "Lower Saxony orthophotos (LGLN)", url: "https://dop.stac.lgln.niedersachsen.de", kind: "api", target: "basemap", group: "Imagery",
    note: "Digital orthophotos of Niedersachsen, Germany (EPSG:25832 - routed through titiler)." },
  { id: "spot-canada", name: "SPOT orthoimages of Canada 2005-2010", url: "https://canada-spot-ortho.s3.amazonaws.com/canada_spot_orthoimages/catalog.json", kind: "static", target: "basemap", group: "Imagery" },
  // Elevation
  { id: "pgc", name: "Polar Geospatial Center (ArcticDEM, REMA)", url: "https://stac.pgc.umn.edu/api/v1", kind: "api", target: "terrain", group: "Elevation",
    note: "2 m DEM strips and mosaics, polar stereographic - routed through titiler." },
  { id: "opentopography", name: "OpenTopography raster DEMs", url: "https://portal.opentopography.org/stac/raster_catalog.json", kind: "static", target: "terrain", group: "Elevation",
    note: "OpenTopography-hosted DEM datasets (many are large regional COGs)." },
  // Federated discovery
  { id: "discovery", name: "Federated collection discovery (MAAP)", url: "https://discover-api.dit.maap-project.org", kind: "discovery", target: "both", group: "Registries",
    note: "Development Seed's stac-fastapi-collection-discovery: one collection search across several upstream STAC APIs; items come from the chosen collection's own API." },
]

type StacLink = { rel: string; href: string; type?: string; title?: string }
type StacAsset = { href: string; type?: string; title?: string; roles?: string[]; "proj:epsg"?: number; "proj:code"?: string }
type StacItem = { type: "Feature"; id: string; collection?: string; bbox?: number[]; properties: Record<string, unknown>; assets: Record<string, StacAsset>; links?: StacLink[] }
type StacCollection = { id: string; title?: string; description?: string; links?: StacLink[]; extent?: { spatial?: { bbox?: number[][] } } }

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`)
  return res.json() as Promise<T>
}

/** Follow `next` links of a paginated /collections listing, up to a cap. */
async function listCollections(root: string, cap = 600): Promise<StacCollection[]> {
  const out: StacCollection[] = []
  let url: string | undefined = `${trimSlash(root)}/collections?limit=200`
  for (let i = 0; url && i < 6 && out.length < cap; i++) {
    const page: { collections?: StacCollection[]; links?: StacLink[] } = await fetchJson(url)
    out.push(...(page.collections ?? []))
    url = page.links?.find((l) => l.rel === "next")?.href
  }
  return out
}

/** Bounded crawl of a static catalog: child collections/catalogs to a few
 *  levels, item links collected, then fetched in small batches. */
async function crawlStaticItems(url: string, bbox: number[] | null, limit: number, signal?: AbortSignal): Promise<StacItem[]> {
  const items: StacItem[] = []
  const queue: { url: string; depth: number }[] = [{ url, depth: 0 }]
  const itemLinks: string[] = []
  const seen = new Set<string>()
  while (queue.length && itemLinks.length < limit * 4) {
    const { url: u, depth } = queue.shift()!
    if (seen.has(u) || depth > 4) continue
    seen.add(u)
    let node: { links?: StacLink[]; extent?: { spatial?: { bbox?: number[][] } } }
    try { node = await fetchJson(u, { signal }) } catch { continue }
    // Skip whole collections that cannot overlap the viewport.
    const ext = node.extent?.spatial?.bbox?.[0]
    if (bbox && ext && (ext[2] < bbox[0] || ext[0] > bbox[2] || ext[3] < bbox[1] || ext[1] > bbox[3])) continue
    for (const l of node.links ?? []) {
      if (l.rel === "item") itemLinks.push(resolveHref(u, l.href))
      else if (l.rel === "child") queue.push({ url: resolveHref(u, l.href), depth: depth + 1 })
    }
  }
  for (let i = 0; i < itemLinks.length && items.length < limit; i += 8) {
    const batch = await Promise.all(itemLinks.slice(i, i + 8).map((l) => fetchJson<StacItem>(l, { signal }).catch(() => null)))
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
  type: "cog"
  description?: string
  bounds?: [number, number, number, number]
  /** Set when the asset is known not to be Web Mercator: the in-browser
   *  reader only handles EPSG:3857, titiler reprojects server-side. */
  cogViaTitiler?: boolean
}

export const StacSearchPanel: React.FC<{
  /** What an added COG becomes: an RGB basemap or an elevation terrain source. */
  target: "basemap" | "terrain"
  onSave: (source: StacSaveSource) => void
  mapRef?: React.RefObject<MapRef | null>
}> = ({ target, onSave, mapRef }) => {
  const presets = useMemo(() => STAC_PRESETS.filter((p) => p.target === "both" || p.target === target), [target])
  const [presetId, setPresetId] = useState(presets[0].id)
  const [customUrl, setCustomUrl] = useState("")
  const catalog = useMemo<StacPreset>(() => presetId === "custom"
    ? { id: "custom", name: "Custom", url: trimSlash(customUrl.trim()), kind: /\.json($|\?)/i.test(customUrl) ? "static" : "api", target: "both", group: "Mixed" }
    : presets.find((p) => p.id === presetId) ?? presets[0], [presetId, customUrl, presets])
  const [collections, setCollections] = useState<StacCollection[]>([])
  const [collectionId, setCollectionId] = useState<string>("")
  const [startDate, setStartDate] = useState(() => isoDate(new Date(Date.now() - 3 * 365 * 86_400_000)))
  const [endDate, setEndDate] = useState(() => isoDate(new Date()))
  const [viewportOnly, setViewportOnly] = useState(true)
  const [items, setItems] = useState<StacItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Collections of the chosen catalogue (API / discovery: /collections with
  // paging; static: child links).
  useEffect(() => {
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
          const list = await listCollections(catalog.url)
          if (!cancelled) setCollections(list)
        }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not list collections") }
    })()
    return () => { cancelled = true }
  }, [catalog.url, catalog.kind])

  const runSearch = useCallback(async () => {
    setLoading(true); setError(""); setItems([])
    try {
      const map = mapRef?.current?.getMap()
      const b = viewportOnly && map ? map.getBounds() : null
      const bbox = b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null
      const datetime = `${startDate}T00:00:00Z/${endDate}T23:59:59Z`
      if (catalog.kind === "api") {
        const body: Record<string, unknown> = { limit: 50, datetime }
        if (bbox) body.bbox = bbox
        if (collectionId) body.collections = [collectionId]
        const data = await fetchJson<{ features: StacItem[] }>(`${catalog.url}/search`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        })
        setItems(data.features ?? [])
      } else if (catalog.kind === "discovery") {
        // Collection search only: items live on the upstream API. The
        // collection's `items` link is an OGC Features endpoint that takes
        // bbox / datetime as query parameters.
        const col = collections.find((c) => c.id === collectionId)
        const itemsHref = col?.links?.find((l) => l.rel === "items")?.href
        if (!itemsHref) throw new Error("Pick a collection first: the federation only searches collections, items come from each collection's own API")
        const q = new URLSearchParams({ limit: "50", datetime })
        if (bbox) q.set("bbox", bbox.join(","))
        const data = await fetchJson<{ features: StacItem[] }>(`${itemsHref}${itemsHref.includes("?") ? "&" : "?"}${q}`)
        setItems(data.features ?? [])
      } else {
        const start = collectionId || catalog.url
        setItems(await crawlStaticItems(start, bbox, 50))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed")
    } finally {
      setLoading(false)
    }
  }, [catalog, collectionId, collections, startDate, endDate, viewportOnly, mapRef])

  const cogAssets = (it: StacItem) => Object.entries(it.assets ?? {}).filter(([, a]) => isCog(a))

  const DateButton: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="justify-between cursor-pointer font-normal tabular-nums flex-1">{value}<CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /></Button>} />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" selected={parseIso(value)} defaultMonth={parseIso(value)} captionLayout="dropdown" startMonth={new Date(1990, 0)} endMonth={new Date()} onSelect={(d) => { if (d) onChange(isoDate(d)) }} />
      </PopoverContent>
    </Popover>
  )

  const browserUrl = catalog.url ? `https://radiantearth.github.io/stac-browser/#/external/${catalog.url.replace(/^https?:\/\//, "")}` : ""
  const stacMapUrl = catalog.url ? `https://developmentseed.org/stac-map/?href=${encodeURIComponent(catalog.url)}` : ""
  const groups = ["Mixed", "Imagery", "Elevation", "Registries"] as const
  const selectItems = Object.fromEntries([...presets.map((p) => [p.id, p.name]), ["custom", "Custom catalogue URL…"]])

  return (
    <div className="space-y-3 min-w-0">
      <p className="text-xs text-muted-foreground">
        Beta — search a STAC catalogue for Cloud Optimized GeoTIFFs and add one as a {target === "terrain" ? "terrain (DEM)" : "basemap"} source.
        Assets that are not Web Mercator are routed through titiler automatically when the catalogue says so.
      </p>
      <Select value={presetId} onValueChange={(v) => v && setPresetId(v)} items={selectItems}>
        <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
        <SelectContent>
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
          <SelectGroup>
            <SelectLabel>Other</SelectLabel>
            <SelectItem value="custom">Custom catalogue URL…</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {presetId === "custom" && (
        <Input placeholder="https://…/v1 (API) or https://…/catalog.json (static)" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} className="cursor-text" />
      )}
      {catalog.note && <p className="text-[11px] text-muted-foreground">{catalog.note}</p>}
      {browserUrl && (
        <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3">
          <a href={stacMapUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">Open in stac-map (Development Seed) <ExternalLink className="h-3 w-3" /></a>
          <a href={browserUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">Open in STAC Browser (Radiant Earth) <ExternalLink className="h-3 w-3" /></a>
        </p>
      )}

      {collections.length > 0 && (
        <Select value={collectionId || "__all__"} onValueChange={(v) => setCollectionId(!v || v === "__all__" ? "" : v)} items={Object.fromEntries([["__all__", "All collections"], ...collections.map((c) => [c.id, c.title || c.id])])}>
          <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{catalog.kind === "discovery" ? "Pick a collection…" : `All collections (${collections.length})`}</SelectItem>
            {collections.slice(0, 600).map((c) => <SelectItem key={c.id} value={c.id}>{c.title || c.id}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-2">
        <DateButton value={startDate} onChange={setStartDate} />
        <span className="text-xs text-muted-foreground">to</span>
        <DateButton value={endDate} onChange={setEndDate} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox id="stac-viewport-only" checked={viewportOnly} onCheckedChange={(v) => setViewportOnly(v === true)} className="cursor-pointer" />
          <Label htmlFor="stac-viewport-only" className="text-xs cursor-pointer">Only items covering the current view</Label>
        </div>
        <Button size="sm" className="cursor-pointer" onClick={runSearch} disabled={loading || !catalog.url}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
        </Button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="max-h-72 overflow-y-auto overflow-x-hidden space-y-1">
        {!loading && items.length === 0 && !error && <p className="text-sm text-muted-foreground py-3 text-center">No results yet.</p>}
        {items.map((it) => {
          const assets = cogAssets(it)
          if (!assets.length) return null
          const when = typeof it.properties?.datetime === "string" ? (it.properties.datetime as string).slice(0, 10) : ""
          return (
            <div key={it.id} className="p-2 rounded-md hover:bg-muted/60 space-y-1">
              <div className="text-sm truncate" title={it.id}>{it.id}</div>
              <div className="text-[11px] text-muted-foreground truncate">{[it.collection, when].filter(Boolean).join(" · ")} · {assets.length} COG asset{assets.length === 1 ? "" : "s"}</div>
              <div className="flex flex-wrap gap-1">
                {assets.slice(0, 12).map(([key, a]) => {
                  const epsg = epsgOf(it, a)
                  const viaTitiler = epsg !== undefined && epsg !== 3857
                  return (
                    <Button key={key} size="sm" variant="outline" className="h-7 cursor-pointer text-xs" title={`${a.href}${epsg ? `\nEPSG:${epsg}${viaTitiler ? " - served through titiler" : ""}` : ""}`}
                      onClick={() => onSave({
                        name: `${it.id} — ${a.title || key}`, url: a.href, type: "cog",
                        description: `STAC ${catalog.name}${it.collection ? ` / ${it.collection}` : ""}${when ? ` · ${when}` : ""}${epsg ? ` · EPSG:${epsg}` : ""}`,
                        bounds: it.bbox && it.bbox.length >= 4 ? [it.bbox[0], it.bbox[1], it.bbox[2], it.bbox[3]] : undefined,
                        cogViaTitiler: viaTitiler || undefined,
                      })}>
                      <Plus className="h-3 w-3" /> {a.title || key}{epsg && viaTitiler ? <span className="text-muted-foreground"> · {epsg}</span> : null}
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
