import type React from "react"
import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { STAC_PRESETS, remembered, type StacPreset } from "@/lib/stac-presets"
import { fetchJson, listCollections, crawlStaticItems, explainFetchError, resolveHref, trimSlash, type StacLink, type StacAsset, type StacItem, type StacCollection } from "@/lib/stac-crawl"
import { customTimelineCatalogsAtom, type CustomTimelineCatalog } from "@/lib/settings-atoms"
import { stacCatalogId } from "@/lib/timeline-catalogs"
import { pushToast } from "@/components/ui/toast"
import { Combobox } from "@base-ui/react/combobox"
import { cn } from "@/lib/utils"
import { formatUtcDate, isoFromUtcMs, parseUtcMs } from "@/lib/date-input"
import { planetKeyAtom, sentinelHubInstanceIdAtom } from "@/lib/settings-atoms"
import { maskKeys, SH_INSTANCE_PLACEHOLDER } from "@/lib/key-placeholders"
import { useAtomValue, useAtom, getDefaultStore } from "jotai"
import { disabledStacPresetsAtom, savedStacCatalogsAtom, type SavedStacCatalog } from "@/lib/settings-atoms"
import { Search, Plus, Check, Loader2, ExternalLink, ChevronDown, History } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select"
import { DateField } from "@/components/ui/date-field"
import { SegmentedToggle } from "./controls-components"
import { stacWmtsRefs, resolveStacWmts, type StacWmtsRef } from "@/lib/wmts-client"
import { publicMirrorHref, blockedReason, allDataCredentialed, isCredentialed, publicThumbnail, cdseBrowserUrl } from "@/lib/cdse"

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

// The STAC types and the readers live in lib/stac-crawl.ts (the timeline's
// catalog loaders share them); re-exported for lib/stac-presets.ts.
export type { StacItem, StacCollection }

const isCog = (a: StacAsset) => /geotiff|tiff/i.test(a.type ?? "") || /\.tiff?($|\?)/i.test(a.href)
/** An `s3://` href is a real asset a browser cannot fetch - no scheme handler,
 *  and usually a credentialed bucket behind it (NASA CSDA's Vantor and Airbus
 *  DEM collections are both like this). Worth naming in the empty state rather
 *  than letting the item look like it has no data. */
const isUnfetchable = (a: StacAsset) => /^(s3|gs|az):\/\//i.test(a.href)
// Default range only (a timestamp, read in UTC); the fields themselves keep "YYYY-MM-DD" strings, see DateField.
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/** The view as a STAC bbox. Zoomed out, or panned across the antimeridian,
 *  MapLibre's bounds run past ±180 (205.9 east at zoom 1.5), and strict
 *  servers refuse the whole search: PGC answers 400, "Bounding box must be
 *  within (-180, -90, 180, 90)". Longitudes are wrapped back; a view that
 *  spans the globe or still crosses the antimeridian becomes every
 *  longitude, wider than the view but accepted everywhere, which a
 *  west > east box (and the static crawl's extent test) is not. */
function wrapSearchBbox(west: number, south: number, east: number, north: number): number[] {
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180
  const s = Math.max(-90, south), n = Math.min(90, north)
  if (east - west >= 360) return [-180, s, 180, n]
  const w = wrap(west), e = wrap(east) === -180 ? 180 : wrap(east)
  return w <= e ? [w, s, e, n] : [-180, s, 180, n]
}

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
/*  `elevationCatalog`: a catalog whose every collection is elevation (group
 *  "Elevation" in STAC_PRESETS), where `visual` is not the RGB marker it is
 *  elsewhere: LINZ's nz-elevation names each DEM and DSM COG `visual`, with
 *  nothing else on the item to say so, and listed none before this. */
function usableForTerrain(key: string, a: StacAsset, elevationCatalog = false): boolean {
  if (/^(thumbnail|overview|rendered_preview)$/i.test(key) || (!elevationCatalog && /^visual$/i.test(key))) return false
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

/** The catalog picker: type to find one of the presets ("planet" lists both
 *  Planet entries), or paste a URL, which becomes the custom catalog. */
type CatalogItem = { value: string; label: string; group: string }
const CatalogCombobox: React.FC<{ presets: StacPreset[]; value: string; customUrl: string; onPick: (id: string) => void; onUrl: (url: string) => void }> = ({ presets, value, customUrl, onPick, onUrl }) => {
  const items = useMemo<CatalogItem[]>(() => [
    { value: "custom", label: customUrl.trim() ? `Custom: ${customUrl.trim()}` : "Custom catalog URL…", group: "Other" },
    ...(["Yours", "Elevation", "Mixed", "Imagery", "Registries"] as const).flatMap((g) => presets.filter((p) => p.group === g).map((p) => ({ value: p.id, label: p.name, group: g }))),
  ], [presets, customUrl])
  const selected = items.find((i) => i.value === value) ?? items[0]
  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(v) => { const it = v as CatalogItem | null; if (it) onPick(it.value) }}
      itemToStringLabel={(i) => (i as CatalogItem).label}
      onInputValueChange={(text) => { if (/^https?:\/\/\S+/i.test(text.trim())) onUrl(text.trim()) }}
    >
      <div className="relative flex w-full min-w-0 items-center">
        <Combobox.Input placeholder="Type a catalog's name, or paste its URL" className={cn("border-input dark:bg-input/30 placeholder:text-muted-foreground h-9 w-full min-w-0 rounded-md border bg-transparent py-1 pl-3 pr-9 text-sm shadow-xs outline-none", "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] cursor-text")} />
        <Combobox.Trigger aria-label="Open the list" className="absolute right-1 cursor-pointer rounded-sm p-1 text-muted-foreground hover:text-foreground"><ChevronDown className="size-4 opacity-70" /></Combobox.Trigger>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-[60] w-[var(--anchor-width)] max-w-[calc(100vw-2rem)]">
          <Combobox.Popup className="bg-popover text-popover-foreground max-h-80 overflow-y-auto rounded-md border p-1 shadow-md outline-none">
            <Combobox.Empty className="px-2 py-1.5 text-sm text-muted-foreground">No catalog of that name; paste a URL to search it.</Combobox.Empty>
            <Combobox.List>
              {(item: CatalogItem) => (
                <Combobox.Item key={item.value} value={item} className="relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
                  <span className="truncate">{item.label}</span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{item.group}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

/** An item's footprint (filled) against the view that was searched (dashed),
 *  for rows the map behind the dialog cannot show. Equirectangular with a
 *  cos(latitude) squeeze, which is all a 48 px glyph needs. */
const FootprintGlyph: React.FC<{ it: StacItem; view: number[] | null }> = ({ it, view }) => {
  const geom = (it as { geometry?: { type?: string; coordinates?: unknown } }).geometry
  let rings: number[][][] = geom?.type === "Polygon" ? (geom.coordinates as number[][][])
    : geom?.type === "MultiPolygon" ? (geom.coordinates as number[][][][]).flat() : []
  const b = it.bbox
  if (!rings.length && b && b.length >= 4) rings = [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]
  if (!rings.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  for (const r of rings) for (const [x, y] of r) grow(x, y)
  if (view && view.length >= 4) { grow(view[0], view[1]); grow(view[2], view[3]) }
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180) || 1
  const S = 48, pad = 4
  const span = Math.max((x1 - x0) * k, y1 - y0, 1e-9)
  const sc = (S - 2 * pad) / span
  const ox = (S - (x1 - x0) * k * sc) / 2, oy = (S - (y1 - y0) * sc) / 2
  const px = (x: number) => ox + (x - x0) * k * sc, py = (y: number) => S - oy - (y - y0) * sc
  const d = rings.map((r) => r.map(([x, y], i) => `${i ? "L" : "M"}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join("") + "Z").join("")
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="h-12 w-12 shrink-0 rounded bg-muted" aria-hidden>
      <title>Footprint (green) against the searched view (dashed)</title>
      {view && view.length >= 4 && (
        <rect x={px(view[0])} y={py(view[3])} width={Math.max(1, px(view[2]) - px(view[0]))} height={Math.max(1, py(view[1]) - py(view[3]))}
          fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="2 2" className="text-muted-foreground" />
      )}
      <path d={d} fillRule="evenodd" className="fill-emerald-500/25 stroke-emerald-600 dark:stroke-emerald-400" strokeWidth={1} />
    </svg>
  )
}

export interface StacSaveSource {
  name: string
  url: string
  /** "tms" only for a collection's xyz web-map-link, "wmts" for a WMTS
   *  link resolved through lib/wmts-client.ts (basemap target). */
  type: "cog" | "tms" | "wmts"
  attribution?: string
  minzoom?: number
  description?: string
  bounds?: [number, number, number, number]
  /** Set when the asset is known not to be Web Mercator: the in-browser
   *  reader only handles EPSG:3857, titiler reprojects server-side. */
  cogViaTitiler?: boolean
  /** Basemap target only: stack as an overlay instead of replacing the basemap. */
  role?: "basemap" | "overlay"
  /** The service's native maximum zoom (tiles beyond it are overzoomed). */
  maxzoom?: number
}

export const StacSearchPanel: React.FC<{
  /** What an added COG becomes: an RGB basemap or an elevation terrain source. */
  target: "basemap" | "terrain"
  onSave: (source: StacSaveSource) => void
  mapRef?: React.RefObject<MapRef | null>
  /** A catalog URL found by the dialog's Auto type: opened as a custom catalog. */
  initialUrl?: string
  /** Basemap target: a WMTS link whose layer is not named, or failed to
   *  resolve, opens the dialog's WMTS picker on its capabilities. */
  onOpenWmts?: (href: string, layer?: string) => void
}> = ({ target, onSave, mapRef, initialUrl, onOpenWmts }) => {
  // Catalogs switched off in the Library's Catalogs section are left out
  // here - that section is where the list is curated. A catalog that is
  // still the remembered choice stays listed even when hidden, so seeding it
  // from a Browse click (or reopening on a stale selection) cannot leave the
  // picker pointing at nothing.
  const disabledStac = useAtomValue(disabledStacPresetsAtom)
  const [savedCatalogs, setSavedCatalogs] = useAtom(savedStacCatalogsAtom)
  const [timelineCatalogs, setTimelineCatalogs] = useAtom(customTimelineCatalogsAtom)
  const presets = useMemo(() => {
    const off = new Set(disabledStac)
    const all = [...STAC_PRESETS, ...savedCatalogs.map((c) => ({ ...c, group: "Yours" as const, note: "Added by you." }))]
    const kept = all.filter((p) => (p.target === "both" || p.target === target)
      && (!off.has(p.id) || p.id === remembered[target]?.presetId))
    return kept.length ? kept : all.filter((p) => p.target === "both" || p.target === target)
  }, [target, disabledStac, savedCatalogs])
  const prev = remembered[target]
  const [presetId, setPresetId] = useState(initialUrl ? "custom" : prev?.presetId ?? presets[0].id)
  const [customUrl, setCustomUrl] = useState(initialUrl ?? prev?.customUrl ?? "")
  const catalog = useMemo<StacPreset>(() => presetId === "custom"
    ? { id: "custom", name: "Custom", url: trimSlash(customUrl.trim()), kind: /\.json($|\?)/i.test(customUrl) ? "static" : "api", target: "both", group: "Mixed" }
    : presets.find((p) => p.id === presetId) ?? presets[0], [presetId, customUrl, presets])
  const [collections, setCollections] = useState<StacCollection[]>(prev?.collections ?? [])
  const [collectionId, setCollectionId] = useState<string>(prev?.collectionId ?? "")
  const [startDate, setStartDate] = useState(() => prev?.startDate ?? isoDate(new Date(Date.now() - 3 * 365 * 86_400_000)))
  const [endDate, setEndDate] = useState(() => prev?.endDate ?? isoDate(new Date()))
  const [viewportOnly, setViewportOnly] = useState(prev?.viewportOnly ?? true)
  const [items, setItems] = useState<StacItem[]>(prev?.items ?? [])
  // A STAC /search answers one page. Asking for "all collections" therefore
  // returns whichever 50 items the server ordered first, which over a mixed
  // catalog is usually imagery - the elevation items exist but are further in.
  // Keeping the `next` link lets the visitor page through instead of
  // concluding the catalog has none.
  const [nextPage, setNextPage] = useState<StacLink | null>(null)
  const [paging, setPaging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [added, setAdded] = useState<Set<string>>(() => new Set())
  const [only3857, setOnly3857] = useState(false)
  const [anyDate, setAnyDate] = useState(target === "terrain")
  // Max cloud cover (eo:cloud_cover), basemaps only; null = no filter.
  const [maxCloud, setMaxCloud] = useState<number | null>(null)
  const [role, setRole] = useState<"basemap" | "overlay">("basemap")
  const shInstanceId = useAtomValue(sentinelHubInstanceIdAtom)
  // A WMTS link: its capabilities are read (cached per URL) and the named
  // layer added with the link's dimension values; without a layer name, or
  // when it does not resolve, the dialog's WMTS picker opens on it.
  const [wmtsBusy, setWmtsBusy] = useState<string | null>(null)
  const addWmts = useCallback(async (ref: StacWmtsRef, layerId: string | undefined, key: string, context: string, bbox?: number[]) => {
    if (!layerId) { onOpenWmts?.(ref.href); return }
    setWmtsBusy(key)
    try {
      const { caps, layer, source } = await resolveStacWmts(ref, layerId)
      setAdded((st) => new Set(st).add(key))
      const time = Object.entries(source.dimensions).find(([k]) => /^time$/i.test(k))?.[1]
      onSave({
        name: `${layer.title}${time ? ` (${time})` : ""}`,
        url: maskKeys(source.url),
        type: "wmts",
        description: [`STAC ${catalog.name}`, context, `WMTS ${caps.title ?? new URL(caps.url).host}`, layer.identifier, source.matrixSet].filter(Boolean).join(" · "),
        bounds: source.bounds ?? (bbox && bbox.length >= 4 ? [bbox[0], bbox[1], bbox[2], bbox[3]] : undefined),
        minzoom: source.minzoom,
        maxzoom: source.maxzoom,
        attribution: source.attribution,
        role,
      })
    } catch (e) {
      pushToast({ key: "stac-wmts", title: "Could not add the WMTS layer", body: (e as Error).message, duration: 8000 })
      if (onOpenWmts) onOpenWmts(ref.href, layerId)
    } finally {
      setWmtsBusy(null)
    }
  }, [catalog.name, onSave, onOpenWmts, role])
  const wmtsButtons = (refs: StacWmtsRef[], context: string, bbox?: number[]) => refs.flatMap((ref) => (ref.layers.length ? ref.layers : [undefined]).map((layerId) => {
    const key = `${ref.href}#${layerId ?? ""}`
    const isAdded = added.has(key)
    return (
      <Button key={key} size="sm" variant={isAdded ? "secondary" : "outline"} className="h-7 cursor-pointer text-xs max-w-full min-w-0 justify-start" disabled={isAdded || wmtsBusy === key || (!layerId && !onOpenWmts)}
        title={[ref.href, layerId ? `Layer ${layerId}` : "No layer named: lists the service's layers", ref.dimensions ? Object.entries(ref.dimensions).map(([k, v]) => `${k}=${v}`).join(", ") : ""].filter(Boolean).join("\n")}
        onClick={() => addWmts(ref, layerId, key, context, bbox)}>
        {wmtsBusy === key ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : isAdded ? <Check className="h-3 w-3 shrink-0" /> : <Plus className="h-3 w-3 shrink-0" />}
        <span className="truncate min-w-0">{layerId ?? ref.title ?? "WMTS layers…"}</span>
        <span className="shrink-0 rounded-full bg-muted text-muted-foreground px-1.5 text-[10px] font-medium">WMTS</span>
      </Button>
    )
  }))
  const [collectionFilter, setCollectionFilter] = useState("")
  const [progress, setProgress] = useState("")
  // The view the last search covered, drawn behind each footprint glyph.
  const [searchBbox, setSearchBbox] = useState<number[] | null>(null)
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
  const skipFirstListing = useRef(prev?.presetId === presetId && (prev?.collections.length ?? 0) > 0 && (!initialUrl || prev?.customUrl === initialUrl))
  // The collection this mount was opened on (a Library Browse seeds one, and
  // so does reopening): kept through the catalog's first listing, which used
  // to blank it, so a seeded collection never reached the picker. Keyed by
  // catalog URL rather than consumed, as React's dev double-run of the effect
  // would otherwise blank it on the second pass. Another catalog falls back
  // to its preset's own collection (the NASA CSDA pair), else all of them.
  const seededCollection = useRef({ url: catalog.url, collection: prev?.presetId === presetId ? prev?.collectionId ?? "" : "" })
  const [listing, setListing] = useState(false)
  useEffect(() => {
    if (skipFirstListing.current) { skipFirstListing.current = false; return }
    setListing(true)
    const seed = seededCollection.current
    setCollections([]); setCollectionId((seed.url === catalog.url && seed.collection) || catalog.collection || ""); setItems([]); setError("")
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
  // WMTS links on the chosen collection (web-map-links rel "wmts", as NASA
  // VEDA publishes for its GIBS layers, or a WMTS-typed asset).
  const collectionWmts = useMemo(() => target === "basemap" ? stacWmtsRefs(collections.find((c) => c.id === collectionId) as Parameters<typeof stacWmtsRefs>[0]) : [], [collections, collectionId, target])

  /** Fetch the next page and append it. `untilUsable` keeps going until the
   *  page yields something this target can actually add, or the cap is hit -
   *  which is the difference between "this catalog has no DEMs" and "the DEMs
   *  are on page 4". */
  const planetTilesRef = useRef(false)
  const loadMore = useCallback(async (untilUsable = false) => {
    setPaging(true)
    try {
      let link: StacLink | null = nextPage
      for (let page = 0; link && page < 12; page++) {
        const asAny = link as StacLink & { method?: string; body?: unknown }
        const data: { features?: StacItem[]; links?: StacLink[] } = asAny.method === "POST"
          ? await fetchJson(asAny.href, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(asAny.body ?? {}) })
          : await fetchJson(asAny.href)
        const fresh = data.features ?? []
        setItems((prev) => [...prev, ...fresh])
        link = data.links?.find((l) => l.rel === "next") ?? null
        setNextPage(link)
        if (!untilUsable) break
        if (planetTilesRef.current || fresh.some((it) => cogAssetsRef.current(it).length)) break
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPaging(false)
    }
  }, [nextPage])

  const runSearch = useCallback(async () => {
    // CDSE answers a search with no collection with a bare 400; say why
    // before asking it.
    if ((catalog as { requiresCollection?: boolean }).requiresCollection && !collectionId) {
      setItems([]); setNextPage(null)
      setError(`${catalog.name} only searches one collection at a time: pick a collection above (Sentinel-2 L2A, Sentinel-1 GRD, the Copernicus DEM…).`)
      return
    }
    setLoading(true); setError(""); setItems([]); setNextPage(null)
    try {
      const map = mapRef?.current?.getMap()
      const b = viewportOnly && map ? map.getBounds() : null
      const bbox = b ? wrapSearchBbox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()) : null
      setSearchBbox(bbox)
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
        setNextPage((data as { links?: StacLink[] }).links?.find((l) => l.rel === "next") ?? null)
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
        // The date window applies here too: a static catalog has no server
        // to pass it to, so collections outside it are skipped by their
        // temporal extent and items by their datetime.
        const window = datetime ? { from: Date.parse(`${startDate}T00:00:00Z`), to: Date.parse(`${endDate}T23:59:59Z`) } : undefined
        setItems((await crawlStaticItems(start, bbox, 50, setProgress, undefined, window)).filter(cloudOk))
      }
    } catch (e) {
      setError(explainFetchError(e, "Search failed"))
    } finally {
      setLoading(false)
      setProgress("")
    }
  }, [catalog, collectionId, collections, startDate, endDate, viewportOnly, anyDate, maxCloud, mapRef])

  // A Library dataset's Browse (seedStacPreset with search) searches the
  // current view once, on this mount: API and static searches need only the
  // seeded collection id, not the listing. Declared after the listing effect
  // so that one's reset of the results runs first. The ref, not the
  // remembered flag, is what survives React's dev double-run: the persist
  // effect above has already rewritten `remembered` without the flag.
  const autoSearchOnMount = useRef(!initialUrl && !!prev?.autoSearch && prev.presetId === presetId)
  useEffect(() => {
    if (!autoSearchOnMount.current) return
    autoSearchOnMount.current = false
    void runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Held in a ref so the pager below can ask "was this page usable" without
  // depending on a function that is redefined every render.
  const cogAssetsRef = useRef<(it: StacItem) => [string, StacAsset][]>(() => [])
  // Planet's items carry a thumbnail only; the scene is served as XYZ tiles
  // by tiles.planet.com, signed with the API key (not the access token).
  const planetTiles = catalog.auth === "planet" && target === "basemap"
  planetTilesRef.current = planetTiles
  // The key is a placeholder, filled with this browser's own key when the
  // tiles are requested (lib/key-placeholders.ts): never saved, never shared.
  const planetTileUrl = (it: StacItem) => `https://tiles.planet.com/data/v1/${it.collection}/${it.id}/{z}/{x}/{y}.png?api_key={planetKey}`
  /** WMTS links and assets of an item (basemap target only: pictures). */
  const itemWmts = (it: StacItem) => (target === "basemap" ? stacWmtsRefs(it as Parameters<typeof stacWmtsRefs>[0]) : [])
  const cogAssets = (it: StacItem) => {
    // A credentialed href with a known keyless copy (CDSE's Copernicus DEM ->
    // AWS Open Data) is swapped for the copy; `mirrorOf` keeps the original.
    let assets = Object.entries(it.assets ?? {})
      .map(([key, a]): [string, StacAsset] => {
        const mirror = isUnfetchable(a) ? publicMirrorHref(a.href) : undefined
        return mirror ? [key, { ...a, href: mirror, mirrorOf: a.href } as StacAsset] : [key, a]
      })
      .filter(([key, a]) => isCog(a) && !isCredentialed(a) && (target !== "terrain" || usableForTerrain(key, a, catalog.group === "Elevation")))
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
  cogAssetsRef.current = cogAssets
  /** Why an item with nothing addable is still listed (its data exists but a
   *  browser cannot read it), or null to leave it out. Listed on catalogs
   *  that declare an item viewer (CDSE) and wherever every data asset sits
   *  behind credentials; on the terrain target only elevation-looking items. */
  const catalogOnly = (it: StacItem): string | null => {
    if (planetTiles || cogAssets(it).length) return null
    if (!catalog.itemViewer && !allDataCredentialed(it)) return null
    if (target === "terrain" && !DEM_RE.test(`${it.collection ?? ""} ${String(it.properties?.title ?? "")}`)
      && !Object.entries(it.assets ?? {}).some(([k, a]) => looksLikeDem(it, k, a))) return null
    return blockedReason(it)
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

  return (
    <div className="space-y-3 min-w-0">
      <p className="text-xs text-muted-foreground">
        Beta — search a STAC catalog for Cloud Optimized GeoTIFFs and add any as {target === "terrain" ? "terrain (DEM)" : "basemap"} sources; the dialog stays open so you can add several.
        Web Mercator (3857) assets are listed first{target === "terrain" ? ", single-band elevation rasters only" : ""}; an asset whose catalog declares another projection is pinned to titiler, the rest use the global COG setting.
      </p>
      <CatalogCombobox
        presets={presets}
        value={presetId}
        customUrl={customUrl}
        onPick={(id) => setPresetId(id)}
        onUrl={(u) => { setPresetId("custom"); setCustomUrl(u) }}
      />
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
      {target === "basemap" && catalog.kind !== "discovery" && !catalog.itemViewer && /^https?:\/\/\S+/.test(catalog.url) && (() => {
        // The catalog (and its chosen collection) as a historical timeline
        // catalog: one tick per item covering the view, under My catalogs.
        const spec = { endpoint: trimSlash(catalog.url), kind: catalog.kind as "api" | "static", collection: collectionId || undefined }
        const id = stacCatalogId(spec)
        const onTimeline = timelineCatalogs.some((c) => c.id === id)
        const colTitle = collectionId ? (collections.find((c) => c.id === collectionId)?.title || collectionId) : ""
        return (
          <Button variant="outline" size="sm" className="cursor-pointer" disabled={onTimeline}
            title={onTimeline ? "Already on the historical timeline (Catalogs → My STAC catalogs)" : "Attach this catalog to the historical timeline's Catalogs picker, under My STAC catalogs: its items covering the view become ticks"}
            onClick={() => {
              // A pasted URL is named by its host, not "Custom".
              const base = catalog.id === "custom" ? (() => { try { return new URL(catalog.url).host } catch { return catalog.url } })() : catalog.name
              const label = colTitle ? `${base} · ${colTitle}` : base
              const words = (colTitle || base).replace(/\(.*?\)/g, "").trim().split(/\s+/)
              let short = ""
              for (const w of words) { if ((short + " " + w).trim().length > 14) break; short = (short + " " + w).trim() }
              const entry: CustomTimelineCatalog = { id, label, short: short || label.slice(0, 14), ...spec, color: ["#a3e635", "#f472b6", "#38bdf8", "#fb923c", "#c084fc", "#2dd4bf", "#facc15", "#f87171"].find((c) => !timelineCatalogs.some((t) => t.color === c)) ?? "#a3e635" }
              setTimelineCatalogs((prev) => (prev.some((c) => c.id === id) ? prev : [...prev, entry]))
              pushToast({ key: "stac-timeline", title: "Added to the historical timeline", body: `${label} sits under Catalogs → My STAC catalogs; tick it there to see its items as ticks.`, duration: 6000 })
            }}>
            <History className="h-3.5 w-3.5" /> {onTimeline ? "On the timeline" : "Add to the timeline"}
          </Button>
        )
      })()}
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
            <DateField value={startDate} onChange={setStartDate} size="sm" className="flex-1" startMonth={new Date(1990, 0)} aria-label="Start date" />
            <span className="text-xs text-muted-foreground">to</span>
            <DateField value={endDate} onChange={setEndDate} size="sm" className="flex-1" startMonth={new Date(1990, 0)} aria-label="End date" />
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

      {collectionWmts.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">This collection is also published as a WMTS layer:</p>
          <div className="flex flex-wrap gap-1">{wmtsButtons(collectionWmts, collectionId)}</div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && progress && <p className="text-xs text-muted-foreground">{progress}</p>}

      <div ref={resultsRef} className="max-h-[65vh] overflow-y-auto overflow-x-hidden space-y-1 scroll-mt-2">
        {!loading && items.length === 0 && !error && <p className="text-sm text-muted-foreground py-3 text-center">No results yet.</p>}
        {!loading && items.length > 0 && !planetTiles && ordered.every((it) => !cogAssets(it).length && !itemWmts(it).length && !catalogOnly(it)) && (
          <p className="text-sm text-muted-foreground py-3 text-center">
            {items.length} items, none with a {target === "terrain" ? "single-band elevation" : "COG"} asset.
            {target === "terrain" && (
              <>
                <br />
                <span className="text-xs">
                  {(() => {
                    // Say WHY, because "none" on a catalog you know has DEMs is
                    // otherwise a dead end. Beyond the reason, show what the
                    // page actually WAS — the collections it came from and the
                    // media types of its assets. On a mixed catalog the whole
                    // answer is usually "page 1 is 100% one non-raster
                    // collection", and nothing short of naming it makes that
                    // visible.
                    let cogs = 0, multiband = 0, unfetchable = 0
                    const byCollection = new Map<string, number>()
                    const byType = new Map<string, number>()
                    for (const it of items) {
                      const c = it.collection ?? "—"
                      byCollection.set(c, (byCollection.get(c) ?? 0) + 1)
                      for (const [key, a] of Object.entries(it.assets ?? {})) {
                        // Normalise "image/tiff; application=geotiff; ..." to its
                        // media type; the parameters are noise in a tally.
                        const t = (a.type ?? "no media type").split(";")[0].trim()
                        byType.set(t, (byType.get(t) ?? 0) + 1)
                        if (isUnfetchable(a)) unfetchable++
                        if (!isCog(a)) continue
                        cogs++
                        if (!usableForTerrain(key, a, catalog.group === "Elevation")) multiband++
                      }
                    }
                    const top = (m: Map<string, number>, n: number) =>
                      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v}× ${k}`).join(", ")

                    const reason = unfetchable > 0 && !cogs
                      ? `${unfetchable} assets on this page are s3:// URIs, which a browser cannot fetch - this catalog indexes data held in a credentialed bucket. Use it to find what exists, then request the scene from the provider.`
                      : !cogs
                      ? "No COG assets on this page at all."
                      : multiband === cogs
                        ? `All ${cogs} COG assets on this page are multi-band (RGB imagery), so none can be elevation.`
                        : `${cogs} COG assets on this page, but none reads as elevation by key, title or role.`

                    return (
                      <>
                        {reason}
                        <br />
                        This page came from: {top(byCollection, 4)}
                        {byType.size > 0 && <>; its assets are {top(byType, 4)}.</>}
                      </>
                    )
                  })()}
                </span>
              </>
            )}
            {nextPage && (
              <>
                <br />
                <span className="text-xs">
                  This is <b>one page</b> of results — a search across all collections returns whatever the
                  server ordered first, which on a mixed catalog is usually imagery. Elevation items may simply
                  be further in. Page on, or pick the specific collection.
                </span>
                <span className="mt-2 flex items-center justify-center gap-2">
                  <Button size="sm" variant="outline" className="cursor-pointer" disabled={paging} onClick={() => loadMore(false)}>
                    {paging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Load next page
                  </Button>
                  <Button size="sm" variant="secondary" className="cursor-pointer" disabled={paging} onClick={() => loadMore(true)}>
                    {paging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Keep loading until a match
                  </Button>
                </span>
              </>
            )}
          </p>
        )}
        {ordered.map((it) => {
          const assets = cogAssets(it)
          const wmts = itemWmts(it)
          const blocked = catalogOnly(it)
          if (!assets.length && !planetTiles && !wmts.length && !blocked) return null
          const p = it.properties ?? {}
          const whenMs = [p.datetime, p.start_datetime].map((v) => (typeof v === "string" ? parseUtcMs(v) : NaN)).find(Number.isFinite)
          const when = whenMs === undefined ? "" : isoFromUtcMs(whenMs)
          // Human title when the item carries one (OpenAerialMap, VEDA), the
          // id (often a uuid or a tile code) otherwise.
          const title = typeof p.title === "string" && p.title.trim() ? (p.title as string) : it.id
          const gsd = typeof p.gsd === "number" ? (p.gsd < 1 ? `${Math.round(p.gsd * 100)} cm` : `${(p.gsd as number).toFixed(p.gsd < 10 ? 1 : 0)} m`) : ""
          const producer = typeof p["oam:producer_name"] === "string" ? (p["oam:producer_name"] as string) : typeof p.platform === "string" ? (p.platform as string) : ""
          const cloud = typeof p["eo:cloud_cover"] === "number" ? `☁ ${Math.round(p["eo:cloud_cover"] as number)}%` : ""
          if (blocked) {
            // Listed, not addable: quicklook (when public), footprint, the
            // reason, and the provider's own viewer at that place and date.
            const thumb = publicThumbnail(it)
            const viewer = catalog.itemViewer === "cdse" ? cdseBrowserUrl(it) : undefined
            return (
              <div key={it.id} className="p-2 rounded-md hover:bg-muted/60 flex gap-2 min-w-0">
                {/* No link around it: CDSE serves quicklooks as
                    application/octet-stream, so opening one downloads it. A
                    catalog thumbnail that fails (CDSE's Landsat mosaic ones
                    ask its thumbnail WMS for a size it refuses) is hidden. */}
                {thumb && (
                  <img src={thumb} alt="" title="Quicklook" loading="lazy" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded object-cover bg-muted"
                    onError={(e) => { e.currentTarget.style.display = "none" }} />
                )}
                <FootprintGlyph it={it} view={searchBbox} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="text-sm truncate" title={it.id}>{title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{[it.collection, whenMs === undefined ? "" : formatUtcDate(whenMs), gsd, cloud, producer].filter(Boolean).join(" · ")}</div>
                  <div className="text-[11px] text-amber-700 dark:text-amber-400 break-words">Not loadable: {blocked}</div>
                  {viewer && (
                    <a href={viewer} target="_blank" rel="noopener noreferrer" className="text-[11px] underline inline-flex items-center gap-0.5">
                      Open in Copernicus Browser at this place and date <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {catalog.itemViewer === "cdse" && /^sentinel-2/i.test(it.collection ?? "") && whenMs !== undefined && (() => {
                    // The same scene drawn by the visitor's own Sentinel Hub
                    // configuration: its TRUE_COLOR layer limited to the
                    // acquisition day. MAXCC=100, or a configuration's cloud
                    // limit (often 20 %) returns empty tiles for a cloudy
                    // scene. The instance id stays a placeholder in the saved
                    // URL (lib/key-placeholders.ts).
                    const day = isoFromUtcMs(whenMs).slice(0, 10)
                    const href = `https://sh.dataspace.copernicus.eu/ogc/wmts/${SH_INSTANCE_PLACEHOLDER}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=TRUE_COLOR&STYLE=default&TILEMATRIXSET=PopularWebMercator256&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fpng&TIME=${day}%2F${day}&MAXCC=100`
                    const isAdded = added.has(href)
                    return (
                      <div className="pt-0.5">
                        <Button size="sm" variant={isAdded ? "secondary" : "outline"} className="h-7 cursor-pointer text-xs max-w-full min-w-0 justify-start" disabled={isAdded || !shInstanceId.trim()}
                          title={shInstanceId.trim() ? "True colour of this day from your Copernicus Sentinel Hub configuration (its TRUE_COLOR layer)" : "Needs your Copernicus Sentinel Hub instance id (Settings → API Keys)"}
                          onClick={() => { setAdded((s) => new Set(s).add(href)); onSave({
                            name: `${day} Sentinel-2 true colour (CDSE)`, url: href, type: "wmts",
                            description: `STAC ${catalog.name} / ${it.collection} · ${it.id} · Sentinel Hub TRUE_COLOR, ${day}, your configuration`,
                            bounds: it.bbox && it.bbox.length >= 4 ? [it.bbox[0], it.bbox[1], it.bbox[2], it.bbox[3]] : undefined,
                            minzoom: 6, maxzoom: 16, attribution: "Copernicus Sentinel data, Sentinel Hub (CDSE)", role,
                          }) }}>
                          {isAdded ? <Check className="h-3 w-3 shrink-0" /> : <Plus className="h-3 w-3 shrink-0" />}
                          <span className="truncate min-w-0">True colour via your Sentinel Hub</span>
                        </Button>
                        {!shInstanceId.trim() && <span className="ml-2 text-[11px] text-muted-foreground">needs your instance id in Settings → API Keys</span>}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          }
          return (
            <div key={it.id} className="p-2 rounded-md hover:bg-muted/60 space-y-1">
              <div className="text-sm truncate" title={it.id}>{title}</div>
              <div className="text-[11px] text-muted-foreground truncate">{[it.collection, whenMs === undefined ? "" : formatUtcDate(whenMs), gsd, cloud, producer].filter(Boolean).join(" · ")} · {planetTiles && !assets.length ? "tiles from tiles.planet.com" : `${assets.length} COG asset${assets.length === 1 ? "" : "s"}`}</div>
              <div className="flex flex-wrap gap-1">
                {planetTiles && !assets.length && (() => {
                  const href = planetTileUrl(it)
                  const hasKey = !!getDefaultStore().get(planetKeyAtom).trim()
                  const isAdded = added.has(href)
                  return (
                    <Button size="sm" variant={isAdded ? "secondary" : "outline"} className="h-7 cursor-pointer text-xs max-w-full min-w-0 justify-start" disabled={isAdded || !hasKey}
                      title={hasKey ? "XYZ tiles of this scene from tiles.planet.com, signed with your Planet API key" : "Needs your Planet API key (Settings → API Keys): the tiles are signed with it"}
                      onClick={() => { setAdded((s) => new Set(s).add(href)); onSave({
                        name: `${when ? `${when} ` : ""}${title}`, url: href, type: "tms",
                        description: `STAC ${catalog.name}${it.collection ? ` / ${it.collection}` : ""} · ${it.id}${when ? ` · ${when}` : ""}${gsd ? ` · ${gsd}` : ""} · tiles.planet.com, signed with your Planet API key`,
                        bounds: it.bbox && it.bbox.length >= 4 ? [it.bbox[0], it.bbox[1], it.bbox[2], it.bbox[3]] : undefined,
                        // The Tile Service serves a compressed visual preview, to
                        // z17 for SkySat and z15 for the rest; beyond, the tile is
                        // overzoomed rather than asked for.
                        maxzoom: /skysat/i.test(it.collection ?? "") ? 17 : 15,
                        role,
                      }) }}>
                      {isAdded ? <Check className="h-3 w-3 shrink-0" /> : <Plus className="h-3 w-3 shrink-0" />}
                      <span className="truncate min-w-0">Scene tiles</span>
                    </Button>
                  )
                })()}
                {wmtsButtons(wmts, `${it.collection ? `${it.collection} / ` : ""}${it.id}`, it.bbox)}
                {assets.slice(0, 12).map(([key, a]) => {
                  const epsg = epsgOf(it, a)
                  // Opt-in: only an asset whose catalog DECLARES another
                  // projection is pinned to titiler; unstated ones stay on the
                  // in-browser reader (the global setting still applies).
                  const viaTitiler = epsg !== undefined && epsg !== 3857
                  const isAdded = added.has(a.href)
                  const dem = target === "terrain" && looksLikeDem(it, key, a)
                  const mirrorOf = (a as StacAsset & { mirrorOf?: string }).mirrorOf
                  return (
                    <Button key={key} size="sm" variant={isAdded ? "secondary" : "outline"} className="h-7 cursor-pointer text-xs max-w-full min-w-0 justify-start" disabled={isAdded}
                      title={`${a.href}\n${epsg ? `EPSG:${epsg}` : "projection not stated"}${viaTitiler ? " - served through titiler" : ""}${dem ? "\nLooks like an elevation model" : ""}${mirrorOf ? `\nThe catalog's copy (${mirrorOf}) needs credentials: this is the identically named keyless copy on AWS Open Data` : ""}`}
                      onClick={() => { setAdded((s) => new Set(s).add(a.href)); onSave({
                        name: `${when ? `${when} ` : ""}${title === it.id || a.title === title ? `${title}${a.title && a.title !== title ? ` — ${a.title}` : assets.length > 1 ? ` — ${key}` : ""}` : `${title} — ${a.title || key}`}`, url: a.href, type: "cog",
                        description: `STAC ${catalog.name}${it.collection ? ` / ${it.collection}` : ""} · ${it.id}${when ? ` · ${when}` : ""}${gsd ? ` · ${gsd}` : ""}${producer ? ` · ${producer}` : ""}${epsg ? ` · EPSG:${epsg}` : ""}${mirrorOf ? " · read from the AWS Open Data copy" : ""}`,
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
