import type React from "react"
import { useState, useCallback, useEffect, useMemo } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Search, Plus, Loader2, ExternalLink, CalendarDays } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"

// STAC search (beta). Two kinds of catalogue are handled:
//  - a STAC API: POST {root}/search with bbox / datetime / collections, the
//    normal case (Earth Search, or any pgstac / stac-fastapi deployment);
//  - a STATIC catalog (a catalog.json tree of collections and items, like
//    Maxar's Open Data): there is no search endpoint, so the tree is crawled
//    a bounded number of levels down and items are filtered client-side.
// Either way the result is the list of COG assets in the matching items,
// each addable as a basemap (RGB) or a terrain (DEM) source.
export interface StacPreset {
  id: string
  name: string
  url: string
  kind: "api" | "static"
  note?: string
}

export const STAC_PRESETS: StacPreset[] = [
  { id: "earth-search", name: "Earth Search (AWS, Element 84)", url: "https://earth-search.aws.element84.com/v1", kind: "api",
    note: "Sentinel-2 L2A COGs, Landsat, Copernicus DEM, NAIP - keyless, CORS-open." },
  { id: "maxar-opendata", name: "Maxar (Vantor) Open Data — disaster events", url: "https://maxar-opendata.s3.amazonaws.com/events/catalog.json", kind: "static",
    note: "Pre/post-event 30-50 cm ARD COGs per event (CC BY-NC 4.0). Static catalog: pick an event, items are crawled." },
  { id: "planetary-computer", name: "Microsoft Planetary Computer", url: "https://planetarycomputer.microsoft.com/api/stac/v1", kind: "api",
    note: "Search works; most asset URLs need a SAS token (signing) before they render." },
]

type StacLink = { rel: string; href: string; type?: string; title?: string }
type StacAsset = { href: string; type?: string; title?: string; roles?: string[]; "raster:bands"?: unknown[]; "eo:bands"?: unknown[] }
type StacItem = { type: "Feature"; id: string; collection?: string; bbox?: number[]; properties: Record<string, unknown>; assets: Record<string, StacAsset>; links?: StacLink[] }
type StacCollection = { id: string; title?: string; description?: string; links?: StacLink[] }

const isCog = (a: StacAsset) => /geotiff|tiff/i.test(a.type ?? "") || /\.tiff?($|\?)/i.test(a.href)
const resolveHref = (base: string, href: string) => { try { return new URL(href, base).toString() } catch { return href } }
const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const parseIso = (s: string) => new Date(`${s}T12:00:00Z`)

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`)
  return res.json() as Promise<T>
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

export const StacSearchPanel: React.FC<{
  /** What an added COG becomes: an RGB basemap or an elevation terrain source. */
  target: "basemap" | "terrain"
  onSave: (source: { name: string; url: string; type: "cog"; description?: string; bounds?: [number, number, number, number] }) => void
  mapRef?: React.RefObject<MapRef | null>
}> = ({ target, onSave, mapRef }) => {
  const [presetId, setPresetId] = useState(STAC_PRESETS[0].id)
  const [customUrl, setCustomUrl] = useState("")
  const catalog = useMemo<StacPreset>(() => presetId === "custom"
    ? { id: "custom", name: "Custom", url: customUrl.trim(), kind: /\.json($|\?)/i.test(customUrl) ? "static" : "api" }
    : STAC_PRESETS.find((p) => p.id === presetId)!, [presetId, customUrl])
  const [collections, setCollections] = useState<StacCollection[]>([])
  const [collectionId, setCollectionId] = useState<string>("")
  const [startDate, setStartDate] = useState(() => isoDate(new Date(Date.now() - 365 * 86_400_000)))
  const [endDate, setEndDate] = useState(() => isoDate(new Date()))
  const [viewportOnly, setViewportOnly] = useState(true)
  const [items, setItems] = useState<StacItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Collections of the chosen catalogue (API: /collections; static: child links).
  useEffect(() => {
    setCollections([]); setCollectionId(""); setItems([])
    if (!catalog.url) return
    let cancelled = false
    ;(async () => {
      try {
        if (catalog.kind === "api") {
          const data = await fetchJson<{ collections: StacCollection[] }>(`${catalog.url.replace(/\/$/, "")}/collections?limit=500`)
          if (!cancelled) setCollections(data.collections ?? [])
        } else {
          const root = await fetchJson<{ links?: StacLink[] }>(catalog.url)
          const children = (root.links ?? []).filter((l) => l.rel === "child")
          if (!cancelled) setCollections(children.map((l) => ({ id: resolveHref(catalog.url, l.href), title: l.title ?? l.href.replace(/^\.\//, "").replace(/\/collection\.json$/, "") })))
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
      if (catalog.kind === "api") {
        const body: Record<string, unknown> = { limit: 50, datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z` }
        if (bbox) body.bbox = bbox
        if (collectionId) body.collections = [collectionId]
        const data = await fetchJson<{ features: StacItem[] }>(`${catalog.url.replace(/\/$/, "")}/search`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        })
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
  }, [catalog, collectionId, startDate, endDate, viewportOnly, mapRef])

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

  return (
    <div className="space-y-3 min-w-0">
      <p className="text-xs text-muted-foreground">
        Beta — search a STAC catalogue for Cloud Optimized GeoTIFFs and add one as a {target === "terrain" ? "terrain (DEM)" : "basemap"} source.
      </p>
      <div className="flex items-center gap-2">
        <Select value={presetId} onValueChange={(v) => v && setPresetId(v)} items={Object.fromEntries([...STAC_PRESETS.map((p) => [p.id, p.name]), ["custom", "Custom catalogue URL…"]])}>
          <SelectTrigger className="flex-1 min-w-0 cursor-pointer"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STAC_PRESETS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            <SelectItem value="custom">Custom catalogue URL…</SelectItem>
          </SelectContent>
        </Select>
        {browserUrl && (
          <>
            <a href={browserUrl} target="_blank" rel="noopener noreferrer" title="Open in STAC Browser (Radiant Earth / Element 84)" className="shrink-0 text-muted-foreground hover:text-foreground"><ExternalLink className="h-4 w-4" /></a>
            <a href={stacMapUrl} target="_blank" rel="noopener noreferrer" title="Open in stac-map (Development Seed)" className="shrink-0 text-xs underline text-muted-foreground hover:text-foreground">map</a>
          </>
        )}
      </div>
      {presetId === "custom" && (
        <Input placeholder="https://…/v1 (API) or https://…/catalog.json (static)" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} className="cursor-text" />
      )}
      {catalog.note && <p className="text-[11px] text-muted-foreground">{catalog.note}</p>}

      {collections.length > 0 && (
        <Select value={collectionId || "__all__"} onValueChange={(v) => setCollectionId(!v || v === "__all__" ? "" : v)} items={Object.fromEntries([["__all__", "All collections"], ...collections.map((c) => [c.id, c.title || c.id])])}>
          <SelectTrigger className="w-full cursor-pointer"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All collections ({collections.length})</SelectItem>
            {collections.slice(0, 300).map((c) => <SelectItem key={c.id} value={c.id}>{c.title || c.id}</SelectItem>)}
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
                {assets.slice(0, 12).map(([key, a]) => (
                  <Button key={key} size="sm" variant="outline" className="h-7 cursor-pointer text-xs" title={a.href}
                    onClick={() => onSave({
                      name: `${it.id} — ${a.title || key}`, url: a.href, type: "cog",
                      description: `STAC ${catalog.name}${it.collection ? ` / ${it.collection}` : ""}${when ? ` · ${when}` : ""}`,
                      bounds: it.bbox && it.bbox.length >= 4 ? [it.bbox[0], it.bbox[1], it.bbox[2], it.bbox[3]] : undefined,
                    })}>
                    <Plus className="h-3 w-3" /> {a.title || key}
                  </Button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
