// Imagery and old-map catalogues on the historical timeline, picked from the
// panel's "Catalogues" tree rather than one pill each. Every loader takes the
// view's bbox and returns dated ticks; each tick stands for one basemap (a
// COG through titiler, a tile template or an ArcGIS export), registered here
// under an id with a fixed prefix so the timeline knows a view sitting on it
// is on a catalogue item and keeps its handle (historical-timeline-panel.tsx).
//
//   HOT STAC (api.imagery.hotosm.org/stac, CORS-open): OpenAerialMap, Maxar
//     and Vantor open data, NOAA emergency response, one search per view.
//   Planet disaster data (Source Cooperative, static): events -> pre/post ->
//     one collection per acquisition with its extent; indexed once per session.
//   Map Warper (mapwarper.net): maps within an area three views wide, so the
//     size follows the zoom; a tick needs a depicted year.
//   ArcGIS Online search: imagery services whose title names a year, sized to
//     the zoom (the search ranks world layers first).
//   Wikimaps Warper (warper.wmflabs.org): the same software and API as Map
//     Warper, over maps on Wikimedia Commons.
//   USGS historical topographic maps (Esri's ImageServer of the ~180,000
//     quads since 1884, US only): every edition covering the view centre,
//     each drawn alone through exportImage with a locked mosaic rule.
//   Old Maps Online: listed, disabled - no CORS and a Cloudflare challenge
//     (so are the Georeferencer API, David Rumsey's MapRank and loc.gov).
import type { CustomBasemapSource } from "./settings-atoms"

export const CATALOG_BASEMAP_PREFIX = "custom-basemap-cat-"

export interface TimelineCatalog {
  id: string
  label: string
  /** Pill and caption text. */
  short: string
  group: string
  color: string
  note: string
  /** Why it cannot be queried from a browser, when it cannot. */
  disabled?: string
}

export const TIMELINE_CATALOGS: TimelineCatalog[] = [
  { id: "cat-oam", label: "OpenAerialMap", short: "OAM", group: "Drone and aerial", color: "#fde68a", note: "Open drone and aerial imagery uploaded to OpenAerialMap, from HOT's STAC API: one tick per upload covering the view, dated by its capture." },
  { id: "cat-maxar", label: "Maxar Open Data", short: "Maxar", group: "Disaster open data", color: "#fecaca", note: "Maxar's pre- and post-event 30-50 cm imagery for disasters (CC BY-NC 4.0), from HOT's STAC API: one tick per acquisition." },
  { id: "cat-vantor", label: "Vantor Open Data", short: "Vantor", group: "Disaster open data", color: "#fbcfe8", note: "Vantor (ex-Maxar) open data programme, 2025 onwards, from HOT's STAC API." },
  { id: "cat-noaa", label: "NOAA emergency response", short: "NOAA", group: "Disaster open data", color: "#bfdbfe", note: "NOAA's aerial imagery after hurricanes, tornadoes and floods, from HOT's STAC API." },
  { id: "cat-planet", label: "Planet disaster data", short: "Planet DD", group: "Disaster open data", color: "#fed7aa", note: "Planet Crisis Response Program releases on Source Cooperative: one tick per pre- or post-event acquisition covering the view." },
  { id: "cat-mapwarper", label: "Map Warper", short: "MapWarper", group: "Old maps", color: "#e9d5ff", note: "Maps georeferenced by volunteers on mapwarper.net, sized to the zoom; only maps with a depicted year get a tick." },
  { id: "cat-wikimaps", label: "Wikimaps Warper", short: "Wikimaps", group: "Old maps", color: "#ddd6fe", note: "Maps from Wikimedia Commons georeferenced on warper.wmflabs.org, sized to the zoom; only maps with a depicted year get a tick." },
  { id: "cat-usgs-topo", label: "USGS historical topo maps", short: "USGS topo", group: "Old maps", color: "#d9f99d", note: "Every USGS topographic quad edition covering the view centre since 1884 (US only), from Esri's historical topo image service; dated by imprint year." },
  { id: "cat-oldmapsonline", label: "Old Maps Online", short: "OMO", group: "Old maps", color: "#e5e7eb", note: "Klokan's search engine over library map collections.", disabled: "Its API sends no CORS header and sits behind a Cloudflare challenge, so a browser cannot query it." },
  { id: "cat-agol", label: "ArcGIS Online imagery", short: "ArcGIS", group: "Imagery services", color: "#a7f3d0", note: "Public ArcGIS image and map services found by ArcGIS Online search over the view, whose title names a year (taken as the capture year), sized to the zoom." },
]
export const TIMELINE_CATALOG_BY_ID = Object.fromEntries(TIMELINE_CATALOGS.map((c) => [c.id, c])) as Record<string, TimelineCatalog>

export const isCatalogBasemapId = (id: string | undefined | null): boolean => !!id && id.startsWith(CATALOG_BASEMAP_PREFIX)
/** "custom-basemap-cat-cat-oam--<item>" -> "cat-oam". */
export const catalogOfBasemapId = (id: string): string => id.slice(CATALOG_BASEMAP_PREFIX.length).split("--")[0]

export interface CatalogTick { source: string; key: number; dateMs: number; label: string; ref: string }
type Bbox = [number, number, number, number]

const basemaps = new Map<string, CustomBasemapSource>()
/** The basemap a catalogue tick stands for (filled while ticks load). */
export const catalogBasemap = (id: string): CustomBasemapSource | undefined => basemaps.get(id)

const intersects = (a: Bbox, b: Bbox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
const containsPt = (b: Bbox, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]
const areaKm2 = (b: Bbox) => Math.abs((b[2] - b[0]) * 111.32 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180) * (b[3] - b[1]) * 110.54)
const YEAR_RE = /\b(1[4-9]\d\d|20\d\d)\b/
function yearOf(...texts: (string | undefined | null)[]): number | null {
  const now = new Date().getUTCFullYear()
  for (const t of texts) {
    const m = t ? YEAR_RE.exec(String(t)) : null
    if (m && Number(m[1]) <= now) return Number(m[1])
  }
  return null
}

function register(catalog: string, itemKey: string, dateMs: number, label: string, source: Omit<CustomBasemapSource, "id">): CatalogTick {
  const id = `${CATALOG_BASEMAP_PREFIX}${catalog}--${itemKey.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 90)}`
  basemaps.set(id, { ...source, id } as CustomBasemapSource)
  return { source: catalog, key: dateMs, dateMs, label, ref: id }
}

const cogSource = (name: string, href: string, bbox: Bbox | undefined, description: string, infoUrl?: string): Omit<CustomBasemapSource, "id"> =>
  // Catalogue COGs are mostly in UTM: titiler reprojects them.
  ({ name, url: href, type: "cog", cogViaTitiler: true, role: "basemap", bounds: bbox, description, infoUrl, maxzoom: 21 } as Omit<CustomBasemapSource, "id">)

function cogAssetHref(assets: Record<string, any> | undefined, prefer: string[]): string | null {
  if (!assets) return null
  for (const k of prefer) if (assets[k]?.href) return assets[k].href
  const cog = Object.values(assets).find((a: any) => /cloud-optimized|image\/tiff/.test(String(a?.type ?? "")) && a?.href)
  return (cog as any)?.href ?? null
}

// ── HOT STAC ──────────────────────────────────────────────────────────────
const HOT_STAC = "https://api.imagery.hotosm.org/stac"
const HOT_COLLECTION: Record<string, string> = { "cat-oam": "openaerialmap", "cat-maxar": "maxar-opendata", "cat-vantor": "vantor-opendata", "cat-noaa": "noaa-emergency-response" }

async function hotStacTicks(catalog: string, bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  const collection = HOT_COLLECTION[catalog]
  const res = await fetch(`${HOT_STAC}/search?collections=${collection}&bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&limit=200`, { signal })
  if (!res.ok) throw new Error(`HOT STAC ${res.status}`)
  const d = await res.json()
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2
  // One tick per acquisition: Maxar and Vantor cut a capture into many
  // tiles; the tile under the view centre stands for it.
  const groups = new Map<string, any[]>()
  for (const f of d.features ?? []) {
    const p = f.properties ?? {}
    const dt = p.datetime ?? p.start_datetime ?? p.end_datetime
    if (!dt) continue
    const g = `${String(dt).slice(0, 10)}|${p.catalog_id ?? p.title ?? p.event ?? f.id}`
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(f)
  }
  const def = TIMELINE_CATALOG_BY_ID[catalog]
  const ticks: CatalogTick[] = []
  for (const items of groups.values()) {
    const f = items.find((x) => Array.isArray(x.bbox) && containsPt(x.bbox as Bbox, cx, cy)) ?? items[0]
    const p = f.properties ?? {}
    const href = cogAssetHref(f.assets, ["visual", "cog", "image"])
    if (!href) continue
    const dt = String(p.datetime ?? p.start_datetime ?? p.end_datetime)
    const dateMs = Date.parse(dt)
    if (!Number.isFinite(dateMs)) continue
    const title = p.title ?? p.event ?? f.id
    const date = dt.slice(0, 10)
    const label = `${def.short} · ${title} · ${date}${items.length > 1 ? ` · ${items.length} tiles` : ""}`
    const info = catalog === "cat-oam" ? `${HOT_STAC}/collections/${collection}/items/${encodeURIComponent(f.id)}` : `${HOT_STAC}/collections/${collection}/items/${encodeURIComponent(f.id)}`
    ticks.push(register(catalog, f.id, dateMs, label, cogSource(`${def.label} · ${title} · ${date}`, href, f.bbox, `${def.label}, ${date}${p.gsd ? `, ${Number(p.gsd).toFixed(2)} m` : ""}`, info)))
  }
  return ticks
}

// ── Planet disaster data (static) ─────────────────────────────────────────
const PLANET_ROOT = "https://data.source.coop/planet/disasterdata/catalog.json"
type PlanetCollection = { url: string; bbox: Bbox; dt: string; title: string; items: string[] }
let planetIndex: Promise<PlanetCollection[]> | null = null
async function json(url: string, signal?: AbortSignal) { const r = await fetch(url, { signal }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json() }
const childHrefs = (d: any, base: string, rel: string): string[] => (d.links ?? []).filter((l: any) => l.rel === rel).map((l: any) => new URL(l.href, base).href)
async function loadPlanetIndex(): Promise<PlanetCollection[]> {
  const root = await json(PLANET_ROOT)
  const out: PlanetCollection[] = []
  for (const ev of childHrefs(root, PLANET_ROOT, "child")) {
    const evCat = await json(ev).catch(() => null)
    if (!evCat) continue
    const phases = childHrefs(evCat, ev, "child")
    await Promise.all(phases.map(async (ph) => {
      const phCat = await json(ph).catch(() => null)
      if (!phCat) return
      await Promise.all(childHrefs(phCat, ph, "child").map(async (col) => {
        const c = await json(col).catch(() => null)
        const b = c?.extent?.spatial?.bbox?.[0] as Bbox | undefined
        const dt = c?.extent?.temporal?.interval?.[0]?.[0]
        if (!c || !b || !dt) return
        const event = ev.split("/").slice(-2, -1)[0]
        const phase = ph.split("/").slice(-2, -1)[0]
        out.push({ url: col, bbox: b, dt, title: `${event} · ${phase} · ${c.id ?? ""}`, items: childHrefs(c, col, "item") })
      }))
    }))
  }
  return out
}
async function planetTicks(bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  if (!planetIndex) planetIndex = loadPlanetIndex().catch((e) => { planetIndex = null; throw e })
  const cols = (await planetIndex).filter((c) => intersects(c.bbox, bbox))
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2
  const ticks: CatalogTick[] = []
  for (const c of cols.slice(0, 30)) {
    // The scene under the view centre, from at most 8 item reads.
    let pick: any = null
    for (const href of c.items.slice(0, 8)) {
      const it = await json(href, signal).catch(() => null)
      if (!it) continue
      if (!pick) pick = { it, href }
      if (Array.isArray(it.bbox) && containsPt(it.bbox as Bbox, cx, cy)) { pick = { it, href }; break }
    }
    if (!pick) continue
    const asset = cogAssetHref(pick.it.assets, ["ortho_visual", "visual", "analytic"])
    if (!asset) continue
    const hrefAbs = new URL(asset, pick.href).href
    const dateMs = Date.parse(c.dt)
    if (!Number.isFinite(dateMs)) continue
    const date = c.dt.slice(0, 10)
    ticks.push(register("cat-planet", pick.it.id ?? c.url, dateMs, `Planet DD · ${c.title} · ${date}`, cogSource(`Planet · ${c.title} · ${date}`, hrefAbs, pick.it.bbox, `Planet disaster data, ${c.title}, ${date}`, "https://www.planet.com/disasterdata/")))
  }
  return ticks
}

// ── Map Warper, Wikimaps Warper ───────────────────────────────────────────
const WARPERS: Record<string, { host: string; short: string }> = {
  "cat-mapwarper": { host: "https://mapwarper.net", short: "MapWarper" },
  "cat-wikimaps": { host: "https://warper.wmflabs.org", short: "Wikimaps" },
}
async function mapWarperTicks(catalog: string, bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  const { host, short } = WARPERS[catalog]
  const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1]
  // Maps WITHIN an area three views wide: city plans zoomed in, regional maps
  // zoomed out, never the world maps an intersects query lists first.
  const region = [Math.max(-180, bbox[0] - w), Math.max(-85, bbox[1] - h), Math.min(180, bbox[2] + w), Math.min(85, bbox[3] + h)]
  const res = await fetch(`${host}/api/v1/maps?bbox=${region.map((v) => v.toFixed(5)).join(",")}&operation=within&per_page=100`, { signal })
  if (!res.ok) throw new Error(`${short} ${res.status}`)
  const d = await res.json()
  const ticks: CatalogTick[] = []
  for (const r of d.data ?? []) {
    const a = r.attributes ?? {}
    if (a.status && a.status !== "warped") continue
    const b = String(a.bbox ?? "").split(",").map(Number) as Bbox
    if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || !intersects(b, bbox)) continue
    const year = yearOf(a.date_depicted, a.title)
    if (!year) continue
    const dateMs = Date.UTC(year, 0, 1)
    const title = String(a.title ?? r.id).replace(/^File:/, "").replace(/\.(jpe?g|png|tiff?|gif)$/i, "")
    ticks.push(register(catalog, String(r.id), dateMs, `${short} · ${title} · ${year}`, {
      name: `${title} (${year})`, url: `${host}/maps/tile/${r.id}/{z}/{x}/{y}.png`, type: "tms", role: "basemap", bounds: b,
      description: `${TIMELINE_CATALOG_BY_ID[catalog].label} map ${r.id}, depicting ${year}`, infoUrl: `${host}/maps/${r.id}`, maxzoom: 20,
    } as Omit<CustomBasemapSource, "id">))
  }
  return ticks
}

// ── USGS historical topographic maps ──────────────────────────────────────
const USGS_TOPO = "https://historical1.arcgis.com/arcgis/rest/services/USA_Historical_Topographic_Maps/ImageServer"
async function usgsTopoTicks(bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  // Quads under the view centre (Category 1: primary rasters, not footprints);
  // a whole-view query over a state would list thousands.
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2
  const q = new URLSearchParams({
    where: "Category=1", geometry: `${cx.toFixed(5)},${cy.toFixed(5)}`, geometryType: "esriGeometryPoint", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "OBJECTID,Map_Name,Date_On_Map,Imprint_Year,Map_Scale,State",
    returnGeometry: "true", outSR: "4326", resultRecordCount: "300", f: "json",
  })
  const res = await fetch(`${USGS_TOPO}/query?${q}`, { signal })
  if (!res.ok) throw new Error(`USGS topo ${res.status}`)
  const d = await res.json()
  if (d.error) throw new Error(`USGS topo: ${d.error.message ?? "query failed"}`)
  const ticks: CatalogTick[] = []
  for (const f of d.features ?? []) {
    const a = f.attributes ?? {}
    // The imprint year dates the edition (photorevisions reprint an old survey).
    const year = Number(a.Imprint_Year) || Number(a.Date_On_Map)
    if (!year || year < 1800) continue
    const pts = (f.geometry?.rings ?? []).flat() as [number, number][]
    const b: Bbox | undefined = pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] : undefined
    const scale = a.Map_Scale ? `1:${Number(a.Map_Scale).toLocaleString("en-US")}` : ""
    const survey = a.Date_On_Map && Number(a.Date_On_Map) !== year ? `, map dated ${a.Date_On_Map}` : ""
    const mosaic = encodeURIComponent(JSON.stringify({ mosaicMethod: "esriMosaicLockRaster", lockRasterIds: [a.OBJECTID] }))
    ticks.push(register("cat-usgs-topo", String(a.OBJECTID), Date.UTC(year, 0, 1), `USGS topo · ${a.Map_Name} ${scale} · ${year}${survey}`, {
      name: `USGS ${a.Map_Name} ${scale} (${year})`,
      url: `${USGS_TOPO}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&mosaicRule=${mosaic}&f=image`,
      type: "wms", role: "basemap", bounds: b,
      description: `USGS historical topographic map, ${a.Map_Name}${a.State ? `, ${a.State}` : ""}, ${scale}, printed ${year}${survey}`,
      infoUrl: "https://livingatlas.arcgis.com/topomapexplorer/",
    } as Omit<CustomBasemapSource, "id">))
  }
  return ticks
}

// ── ArcGIS Online search ──────────────────────────────────────────────────
async function agolTicks(bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  const q = '(type:"Image Service" OR type:"Map Service") AND (orthophoto OR orthophotos OR orthoimagery OR orthofoto OR orthophotographie OR luchtfoto OR "aerial photography" OR "aerial imagery" OR "historical imagery")'
  const viewKm2 = areaKm2(bbox)
  // National services stay listed over a city (the Netherlands is ~80,000 km2);
  // continental and world layers do not.
  const minKm2 = viewKm2 / 2000, maxKm2 = Math.max(viewKm2 * 2000, 1_000_000)
  const ticks: CatalogTick[] = []
  const candidates: { r: any; b: Bbox; year: number; base: string }[] = []
  let start = 1
  for (let page = 0; page < 3 && start > 0; page++) {
    const res = await fetch(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q)}&bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&num=100&start=${start}&f=json`, { signal })
    if (!res.ok) throw new Error(`ArcGIS Online ${res.status}`)
    const d = await res.json()
    for (const r of d.results ?? []) {
      const ext = r.extent as [[number, number], [number, number]] | undefined
      if (!r.url || !ext?.length) continue
      const b: Bbox = [ext[0][0], ext[0][1], ext[1][0], ext[1][1]]
      const a = areaKm2(b)
      if (a < minKm2 || a > maxKm2 || !intersects(b, bbox)) continue
      const year = yearOf(r.title)
      if (!year) continue
      const base = String(r.url).replace(/\/+$/, "")
      candidates.push({ r, b, year, base })
    }
    start = d.nextStart ?? -1
  }
  // How each service can be drawn, from its own description: tiles when it
  // is tiled in Web Mercator, /export or /exportImage when the server can
  // render (it reprojects), nothing for tiles-only services in another grid
  // (the Dutch Luchtfoto layers are EPSG:28992: MapLibre cannot draw them).
  await Promise.all(candidates.map(async ({ r, b, year, base }) => {
    const info = await serviceInfo(base, signal)
    if (!info) return
    const isImage = r.type === "Image Service"
    const caps = String(info.capabilities ?? "")
    const tileWkid = info.tileInfo?.spatialReference?.latestWkid ?? info.tileInfo?.spatialReference?.wkid
    const mercatorTiles = !isImage && !!info.tileInfo && [3857, 102100, 102113].includes(Number(tileWkid))
    const tilesOnly = /TilesOnly/i.test(caps)
    let url: string, type: "tms" | "wms"
    if (mercatorTiles) { url = `${base}/tile/{z}/{y}/{x}`; type = "tms" }
    else if (tilesOnly) return
    else if (isImage) { url = `${base}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image`; type = "wms" }
    else { url = `${base}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`; type = "wms" }
    ticks.push(register("cat-agol", r.id, Date.UTC(year, 0, 1), `ArcGIS · ${r.title} · ${year} · ${r.owner}`, {
      name: `${r.title}`, url, type, role: "basemap", bounds: b,
      description: `ArcGIS Online ${r.type}, ${r.owner}, title year ${year}`, infoUrl: `https://www.arcgis.com/home/item.html?id=${r.id}`,
    } as Omit<CustomBasemapSource, "id">))
  }))
  return ticks
}

const serviceInfoCache = new Map<string, Promise<any | null>>()
function serviceInfo(base: string, signal?: AbortSignal): Promise<any | null> {
  let p = serviceInfoCache.get(base)
  if (!p) {
    const timeout = AbortSignal.timeout(5000)
    const sig = signal && "any" in AbortSignal ? (AbortSignal as any).any([signal, timeout]) : timeout
    p = fetch(`${base}?f=json`, { signal: sig }).then((res) => (res.ok ? res.json() : null)).then((d) => (d && !d.error ? d : null)).catch(() => null)
    serviceInfoCache.set(base, p)
  }
  return p
}

/** Ticks for one catalogue over the view; keys made unique per catalogue
 *  (several items can share a date, and the key is the list's React key). */
export async function loadCatalogTicks(catalog: string, bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  let ticks: CatalogTick[] = []
  if (catalog in HOT_COLLECTION) ticks = await hotStacTicks(catalog, bbox, signal)
  else if (catalog === "cat-planet") ticks = await planetTicks(bbox, signal)
  else if (catalog in WARPERS) ticks = await mapWarperTicks(catalog, bbox, signal)
  else if (catalog === "cat-usgs-topo") ticks = await usgsTopoTicks(bbox, signal)
  else if (catalog === "cat-agol") ticks = await agolTicks(bbox, signal)
  const used = new Set<number>()
  for (const t of ticks.sort((a, b) => a.dateMs - b.dateMs)) {
    while (used.has(t.key)) t.key += 1
    used.add(t.key)
  }
  return ticks
}
