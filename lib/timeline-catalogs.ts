// Imagery and old-map catalogs on the historical timeline, picked from the
// panel's "Catalogs" tree rather than one pill each. Every loader takes the
// view's bbox and returns dated ticks; each tick stands for one basemap (a
// COG through titiler, a tile template or an ArcGIS export), registered here
// under an id with a fixed prefix so the timeline knows a view sitting on it
// is on a catalog item and keeps its handle (historical-timeline-panel.tsx).
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
//   OSM Editor Layer Index: its dated layers whose coverage polygon touches
//     the view (lib/eli-timeline.ts); their ids keep ELI's own prefix.
//   National historical layers: IGN Géoplateforme (WMTS capabilities),
//     swisstopo time travel (identify at the view centre), Kartverket.
//   Old Maps Online: listed, disabled - no CORS and a Cloudflare challenge
//     (so are the Georeferencer API, David Rumsey's MapRank and loc.gov).
import type { ViewId } from "./grid-layouts"
import { atom } from "jotai"
import type { FeatureCollection } from "geojson"
import type { CustomBasemapSource } from "./settings-atoms"
import { datedEliLayersInView, eliLayersToTicks } from "./eli-timeline"
import { loadAllmapsCoverage, allmapsMeta } from "./coverage-overlays"

const ALLMAPS_ANNOTATIONS = "https://annotations.allmaps.org"
import { gsdFromZoom } from "./gsd"
import { NATIONAL_SOURCES, NATIONAL_SOURCE_BY_ID, loadNationalLayers, type NatLayer, type NatSource } from "./national-historical"

export const CATALOG_BASEMAP_PREFIX = "custom-basemap-cat-"

/** The footprints of the items the timeline found for the view, for
 *  CatalogFootprintsLayer; null when the picker's footprints switch is off. */
export const catalogFootprintsAtom = atom<FeatureCollection | null>(null)
/** Every catalog item the timeline holds for the view, with its extent,
 *  for the Sources Coverage search results (published by the panel). */
export interface CatalogItem { source: string; label: string; ref: string; dateMs: number; bounds: [number, number, number, number]; meta?: TickMeta }
export const catalogItemsAtom = atom<CatalogItem[]>([])
/** "Put this catalog item on the view" from the map's footprint click or
 *  the search results: the timeline panel owns the ticks and applies it. */
export const catalogPickRequestAtom = atom<{ ref: string; nonce: number; side?: ViewId } | null>(null)

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
  /** The timeline's resolution filter; "vhr" when absent. */
  resClass?: "vhr" | "medium"
  /** Where it has anything: the tree dims it elsewhere. */
  bbox?: [number, number, number, number]
  /** A sub-heading inside the group (the country, for the national archives). */
  region?: string
  /** The national archives' tree: continent, then the country (ISO 3166-1 alpha-3). */
  continent?: string
  iso3?: string
}

/** Country names for the national archives' headings, by ISO alpha-3. */
export const ISO3_NAMES: Record<string, string> = {
  AUT: "Austria", BEL: "Belgium", CHE: "Switzerland", DEU: "Germany", ESP: "Spain", FRA: "France", JPN: "Japan", LUX: "Luxembourg",
  NLD: "Netherlands", NOR: "Norway", PRT: "Portugal", USA: "United States", CAN: "Canada", AUS: "Australia", TWN: "Taiwan", ITA: "Italy", SVN: "Slovenia",
  LTU: "Lithuania", CYP: "Cyprus", SVK: "Slovakia", BRA: "Brazil",
}
const NAT_PLACE: Record<string, [string, string]> = {
  // Europe
  "cat-nat-icgc": ["Europe", "ESP"], "cat-nat-pnoa": ["Europe", "ESP"], "cat-nat-navarra": ["Europe", "ESP"], "cat-nat-balears": ["Europe", "ESP"], "cat-nat-madrid": ["Europe", "ESP"],
  "cat-nat-euskadi": ["Europe", "ESP"], "cat-nat-andalucia": ["Europe", "ESP"], "cat-nat-canarias": ["Europe", "ESP"], "cat-nat-valencia": ["Europe", "ESP"], "cat-nat-galicia": ["Europe", "ESP"],
  "cat-nat-cantabria": ["Europe", "ESP"], "cat-nat-asturias": ["Europe", "ESP"], "cat-nat-aragon": ["Europe", "ESP"], "cat-nat-portugal": ["Europe", "PRT"],
  "cat-nat-nrw": ["Europe", "DEU"], "cat-nat-hamburg": ["Europe", "DEU"], "cat-nat-bayern": ["Europe", "DEU"], "cat-nat-dop1953": ["Europe", "DEU"], "cat-nat-sachsen": ["Europe", "DEU"],
  "cat-nat-niedersachsen": ["Europe", "DEU"], "cat-nat-bw": ["Europe", "DEU"], "cat-nat-rlp": ["Europe", "DEU"], "cat-nat-berlin": ["Europe", "DEU"], "cat-nat-bremen": ["Europe", "DEU"],
  "cat-nat-spw": ["Europe", "BEL"], "cat-nat-vlaanderen": ["Europe", "BEL"], "cat-nat-ngi": ["Europe", "BEL"],
  "cat-nat-pdok": ["Europe", "NLD"], "cat-nat-lu": ["Europe", "LUX"],
  "cat-nat-wien": ["Europe", "AUT"], "cat-nat-tirol": ["Europe", "AUT"], "cat-nat-vorarlberg": ["Europe", "AUT"], "cat-nat-salzburg": ["Europe", "AUT"], "cat-nat-steiermark": ["Europe", "AUT"],
  "cat-nat-geneve": ["Europe", "CHE"], "cat-nat-zuerich": ["Europe", "CHE"], "cat-nat-stadt-zuerich": ["Europe", "CHE"], "cat-nat-basel": ["Europe", "CHE"],
  "cat-nat-slovenija": ["Europe", "SVN"], "cat-nat-lietuva": ["Europe", "LTU"], "cat-nat-cyprus": ["Europe", "CYP"], "cat-nat-slovensko": ["Europe", "SVK"],
  "cat-nat-suedtirol": ["Europe", "ITA"], "cat-nat-sardegna": ["Europe", "ITA"], "cat-nat-toscana": ["Europe", "ITA"], "cat-nat-lombardia": ["Europe", "ITA"], "cat-nat-emilia": ["Europe", "ITA"],
  "cat-nat-piemonte": ["Europe", "ITA"], "cat-nat-liguria": ["Europe", "ITA"],
  "cat-nat-craig": ["Europe", "FRA"], "cat-nat-strasbourg": ["Europe", "FRA"],
  // Elsewhere
  "cat-nat-gsi": ["Asia and Oceania", "JPN"], "cat-nat-nsw": ["Asia and Oceania", "AUS"], "cat-nat-sinica": ["Asia and Oceania", "TWN"], "cat-nat-nlsc": ["Asia and Oceania", "TWN"],
  "cat-nat-nyc": ["North America", "USA"], "cat-nat-toronto": ["North America", "CAN"], "cat-nat-ottawa": ["North America", "CAN"], "cat-nat-kingcounty": ["North America", "USA"],
  "cat-nat-dc": ["North America", "USA"], "cat-nat-massgis": ["North America", "USA"], "cat-nat-ctecco": ["North America", "USA"], "cat-nat-iowa": ["North America", "USA"],
  "cat-nat-chicagoland": ["North America", "USA"], "cat-nat-minnesota": ["North America", "USA"], "cat-nat-chatham": ["North America", "USA"], "cat-nat-florida1940": ["North America", "USA"],
  "cat-nat-saopaulo": ["South America", "BRA"],
  "cat-nat-weld": ["World", "WLD"],
}
const COUNTRY_ISO: Record<string, string> = { Austria: "AUT", Belgium: "BEL", Germany: "DEU", Italy: "ITA", France: "FRA", Switzerland: "CHE", Netherlands: "NLD", Luxembourg: "LUX", Spain: "ESP", Portugal: "PRT", Norway: "NOR", Japan: "JPN", Taiwan: "TWN", Australia: "AUS", Canada: "CAN", Brazil: "BRA", Slovenia: "SVN", Lithuania: "LTU", Cyprus: "CYP", Slovakia: "SVK" }
const natPlace = (s: { id: string; group: string }): { continent: string; iso3: string } => {
  const p = NAT_PLACE[s.id]
  if (p) return { continent: p[0], iso3: p[1] }
  // A source added after this table: its group names the country or the
  // continent; an unknown one lands under its group's name.
  const g = s.group.replace(/^Historical · /, "")
  if (COUNTRY_ISO[g]) return { continent: /Japan|Taiwan|Australia/.test(g) ? "Asia and Oceania" : /Canada/.test(g) ? "North America" : /Brazil/.test(g) ? "South America" : "Europe", iso3: COUNTRY_ISO[g] }
  if (/Asia|Oceania/.test(g)) return { continent: "Asia and Oceania", iso3: "" }
  if (/North America/.test(g)) return { continent: "North America", iso3: "" }
  if (/South America/.test(g)) return { continent: "South America", iso3: "" }
  if (/Global|World/.test(g)) return { continent: "World", iso3: "WLD" }
  return { continent: "Europe", iso3: "" }
}

/** The picker's three root groups, by sub-group. */
export const CATALOG_ROOTS: Record<string, string> = {
  "Open data for post-crisis response": "Open data for post-crisis response",
  "Community indexes": "Community indexes",
  "Mapping agencies national catalogs": "Mapping agencies national catalogs",
  "Old maps": "Old maps, digitised and warped",
}
/** The roots the Sources Coverage section shows under Basemaps · Historical;
 *  Community indexes (ELI, QMS, ArcGIS Online) sit under Basemaps · Static. */
export const HISTORICAL_TREE_ROOTS = ["Open data for post-crisis response", "Community indexes", "Mapping agencies national catalogs", "Old maps, digitised and warped"]
export const CATALOG_ROOT_ORDER = ["Open data for post-crisis response", "Community indexes", "Mapping agencies national catalogs", "Old maps, digitised and warped"]

export const TIMELINE_CATALOGS: TimelineCatalog[] = [
  { id: "eli", label: "OSM Editor Layer Index (ELI)", short: "ELI", group: "Community indexes", color: "#99f6e4", note: "Dated orthophotos and maps of the OSM Editor Layer Index whose coverage touches the view (about 1,300 layers carry a date); a year-only date sits at 1 January." },
  { id: "cat-oam", label: "OpenAerialMap", short: "OAM", group: "Open data for post-crisis response", color: "#fde68a", note: "Open drone and aerial imagery uploaded to OpenAerialMap, from HOT's STAC API: one tick per upload covering the view, dated by its capture." },
  { id: "cat-maxar", label: "Maxar Open Data", short: "Maxar", group: "Open data for post-crisis response", color: "#fecaca", note: "Maxar's pre- and post-event 30-50 cm imagery for disasters (CC BY-NC 4.0), from HOT's STAC API: one tick per acquisition." },
  { id: "cat-vantor", label: "Vantor Open Data", short: "Vantor", group: "Open data for post-crisis response", color: "#fbcfe8", note: "Vantor (ex-Maxar) open data programme, 2025 onwards, from HOT's STAC API." },
  { id: "cat-noaa", label: "NOAA emergency response", short: "NOAA", group: "Open data for post-crisis response", color: "#bfdbfe", note: "NOAA's aerial imagery after hurricanes, tornadoes and floods, from HOT's STAC API." },
  { id: "cat-planet", label: "Planet disaster data", short: "Planet DD", group: "Open data for post-crisis response", color: "#fed7aa", note: "Planet Crisis Response Program releases on Source Cooperative: one tick per pre- or post-event acquisition covering the view." },
  { id: "cat-mapwarper", label: "Map Warper", short: "MapWarper", group: "Old maps", color: "#e9d5ff", note: "Maps georeferenced by volunteers on mapwarper.net, sized to the zoom; only maps with a depicted year get a tick." },
  { id: "cat-wikimaps", label: "Wikimaps Warper", short: "Wikimaps", group: "Old maps", color: "#ddd6fe", note: "Maps from Wikimedia Commons georeferenced on warper.wmflabs.org, sized to the zoom; only maps with a depicted year get a tick." },
  { id: "cat-slub", label: "SLUB Kartenforum (Germany)", short: "Kartenforum", group: "Old maps", color: "#fde68a", note: "About 9,000 maps georeferenced by the SLUB Dresden Virtuelles Kartenforum (Messtischblätter, topographic maps, city plans), sized to the zoom." },
  { id: "cat-usgs-topo", label: "USGS historical topo maps", short: "USGS topo", group: "Old maps", color: "#d9f99d", note: "Every USGS topographic quad edition covering the view centre since 1884 (US only), from Esri's historical topo image service; dated by imprint year." },
  { id: "cat-oldmapsonline", label: "Old Maps Online", short: "OMO", group: "Old maps", color: "#e5e7eb", note: "Klokan's search engine over library map collections.", disabled: "Its API sends no CORS header and sits behind a Cloudflare challenge, so a browser cannot query it." },
  { id: "cat-corona", label: "CORONA Atlas (declassified satellite, 1963-72)", short: "CORONA", group: "Old maps", color: "#fef3c7", bbox: [20, 10, 75, 48], note: "The CORONA Atlas of the Middle East (CAST, University of Arkansas): 279 georeferenced KH-4 mosaics 1963-1972 over the Middle East, North Africa and Central Asia, served by CAST's GeoServer.", resClass: "vhr" },
  { id: "cat-agol", label: "ArcGIS Online imagery", short: "ArcGIS", group: "Community indexes", color: "#a7f3d0", note: "Public ArcGIS image and map services found by ArcGIS Online search over the view, whose title names a year (taken as the capture year), sized to the zoom." },
  // National and regional archives, last: IGN, swisstopo and Kartverket, then the generated regional series.
  { id: "cat-ign", label: "IGN Remonter le temps (France)", short: "IGN", group: "Mapping agencies national catalogs", region: "France", continent: "Europe", iso3: "FRA", color: "#c7d2fe", note: "IGN Géoplateforme's dated layers covering the view centre: aerial photos 1950-1995 and every year since 2000, SPOT and Pléiades years, Cassini, État-major, the 1950 map, departmental archives." , bbox: [-5.2, 41.3, 9.6, 51.1] },
  { id: "cat-swissimage", label: "swisstopo SWISSIMAGE Zeitreise", short: "SWISSIMAGE", group: "Mapping agencies national catalogs", region: "Switzerland", continent: "Europe", iso3: "CHE", color: "#fecdd3", note: "Swiss aerial imagery since 1926: one tick per flight year with imagery at the view centre." , bbox: [5.9, 45.8, 10.5, 47.85] },
  { id: "cat-swiss-maps", label: "swisstopo Zeitreise maps", short: "swisstopo maps", group: "Mapping agencies national catalogs", region: "Switzerland", continent: "Europe", iso3: "CHE", color: "#fde2e4", note: "Swiss national maps since 1844 (Dufour, Siegfried, Landeskarte): one tick per edition of the sheet at the view centre." , bbox: [5.9, 45.8, 10.5, 47.85] },
  { id: "cat-kartverket", label: "Kartverket Amtskart (Norway)", short: "Kartverket", group: "Mapping agencies national catalogs", region: "Norway", continent: "Europe", iso3: "NOR", color: "#bae6fd", note: "Norway's county maps, 1826-1916, the first regular map series of the country." , bbox: [4.0, 57.9, 31.2, 71.3] },
  // Regional series (lib/national-historical.ts).
  ...NATIONAL_SOURCES.map((s) => ({ id: s.id, label: s.label, short: s.short, group: "Mapping agencies national catalogs", region: s.group.replace(/^Historical · /, ""), ...natPlace(s), color: s.color, note: s.note, resClass: s.resClass, bbox: s.bbox })),
  { id: "cat-allmaps", label: "Allmaps, dated maps in view", short: "Allmaps", group: "Old maps", color: "#d946ef", note: "Georeferenced IIIF maps from the Allmaps annotations API dated by the archive's own record: the IIIF manifest's date (one read per map in view, up to 40), else a historical year in the title; the georeferencing date is never used. One tick per map, draped as an overlay when picked." },
]
export const TIMELINE_CATALOG_BY_ID = Object.fromEntries(TIMELINE_CATALOGS.map((c) => [c.id, c])) as Record<string, TimelineCatalog>

export const isCatalogBasemapId = (id: string | undefined | null): boolean => !!id && id.startsWith(CATALOG_BASEMAP_PREFIX)
/** "custom-basemap-cat-cat-oam--<item>" -> "cat-oam". */
export const catalogOfBasemapId = (id: string): string => id.slice(CATALOG_BASEMAP_PREFIX.length).split("--")[0]

export interface CatalogTick { source: string; key: number; dateMs: number; label: string; ref: string; meta?: TickMeta }
/** What a catalog knows about an item beyond its date, for the tick card. */
export interface TickMeta { gsd?: number; date?: string; licence?: string; url?: string; thumb?: string; provider?: string; /** The item's extent when it is not a registered basemap's (ELI). */ bounds?: [number, number, number, number] }

/** The timeline panel's loading state, for the trees in both places. */
export const catalogStatusAtom = atom<{ loading: Record<string, boolean>; counts: Record<string, number>; errors: Record<string, string> }>({ loading: {}, counts: {}, errors: {} })

/** Entries of the historical tree that draw footprints only: their maps
 *  carry no capture date, so no ticks. Toggled in coverageOverlays. */
export const COVERAGE_ONLY_ENTRIES: TimelineCatalog[] = [
  { id: "allmapsAll", label: "Old maps (Allmaps), every collection", short: "Allmaps", group: "Old maps", color: "#d946ef", note: "Georeferenced maps from the Allmaps annotations API: outlines of every map touching the view, no capture dates, click one to drape it." },
  { id: "allmapsRumsey", label: "David Rumsey Map Collection (Allmaps)", short: "Rumsey", group: "Old maps", color: "#d946ef", note: "David Rumsey's maps in Allmaps: outlines, no capture dates." },
  { id: "qmsAll", label: "NextGIS QMS services in view", short: "QMS", group: "Community indexes", color: "#0891b2", note: "Services from NextGIS Quick Map Services whose extent touches the view, sized to the zoom; outlines, no dates." },
]
type Bbox = [number, number, number, number]

const basemaps = new Map<string, CustomBasemapSource>()
/** The basemap a catalog tick stands for (filled while ticks load). */
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

/** Catalogs whose items are scanned map sheets: the paper removal applies. */
const SCANNED_MAP_CATALOGS = new Set(["cat-mapwarper", "cat-wikimaps", "cat-slub", "cat-usgs-topo", "cat-swiss-maps", "cat-kartverket", "cat-nat-ngi", "cat-nat-slovensko", "cat-nat-sinica"])

/** A catalog item without a date (a search hit): its basemap only, no
 *  tick; "Use" adds it to the view through the coverage use request. */
function registerUndated(catalog: string, itemKey: string, source: Omit<CustomBasemapSource, "id">): string {
  const id = `${CATALOG_BASEMAP_PREFIX}${catalog}--${itemKey.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 90)}`
  basemaps.set(id, { ...source, id, transient: true, ...(SCANNED_MAP_CATALOGS.has(catalog) || source.type === "iiif" ? { oldMap: true } : {}) } as CustomBasemapSource)
  return id
}

/** Whether resolveCatalogSourceId can rebuild this id on its own. */
export const isRebuildableCatalogId = (id: string) =>
  /^custom-basemap-allmaps-[0-9a-f]{16}$/.test(id) || /^custom-basemap-cat-cat-allmaps--(rumsey-RUMSEY_[0-9_]+|[0-9a-f]{16})$/.test(id) || /^custom-basemap-cat-(cat-mapwarper|cat-wikimaps)--\d+$/.test(id)

/** A catalog source named in a link but not in this browser's list: its
 *  id says enough to rebuild it for the catalogs whose items are addressed
 *  by one key (an Allmaps map, a David Rumsey sheet through Allmaps, a Map
 *  Warper or Wikimaps map); null for the others (an ArcGIS Online item, a
 *  STAC scene), which a catalog query would have to find again. */
async function sha1Id(s: string) { return sha1IdImpl(s) }
export async function resolveCatalogSourceId(id: string): Promise<CustomBasemapSource | null> {
  const allmapsMap = (mapId: string, name: string, extra: Partial<CustomBasemapSource> = {}): CustomBasemapSource => ({
    id, name, url: `${ALLMAPS_ANNOTATIONS}/maps/${mapId}`, type: "iiif", role: "overlay", stack: "top", provider: "allmaps", oldMap: true,
    description: `Georeferenced IIIF map, Allmaps annotation ${mapId}`, infoUrl: `https://viewer.allmaps.org/?url=${encodeURIComponent(`${ALLMAPS_ANNOTATIONS}/maps/${mapId}`)}`, ...extra,
  } as CustomBasemapSource)
  let m = /^custom-basemap-allmaps-([0-9a-f]{16})$/.exec(id)
  if (m) return allmapsMap(m[1], `Allmaps map ${m[1]}`)
  m = /^custom-basemap-cat-cat-allmaps--rumsey-(RUMSEY_[0-9_]+)$/.exec(id)
  if (m) {
    const luna = m[1].replace(/_/g, "~")
    const image = `https://www.davidrumsey.com/luna/servlet/iiif/${luna}`
    const url = `${ALLMAPS_ANNOTATIONS}/images/${await sha1Id(image)}`
    return { id, name: `David Rumsey ${luna}`, url, type: "iiif", role: "overlay", stack: "top", provider: "allmaps", oldMap: true, description: `David Rumsey Map Collection sheet ${luna}, georeferenced in Allmaps`, infoUrl: `https://www.davidrumsey.com/luna/servlet/detail/${luna}` } as CustomBasemapSource
  }
  m = /^custom-basemap-cat-cat-allmaps--([0-9a-f]{16})$/.exec(id)
  if (m) return allmapsMap(m[1], `Allmaps map ${m[1]}`)
  m = /^custom-basemap-cat-(cat-mapwarper|cat-wikimaps)--(\d+)$/.exec(id)
  if (m) {
    const { host, short } = WARPERS[m[1] as keyof typeof WARPERS]
    return { id, name: `${short} map ${m[2]}`, url: `${host}/maps/tile/${m[2]}/{z}/{x}/{y}.png`, type: "tms", role: "overlay", stack: "top", oldMap: true, description: `${TIMELINE_CATALOG_BY_ID[m[1]].label} map ${m[2]}`, infoUrl: `${host}/maps/${m[2]}`, maxzoom: 20 } as CustomBasemapSource
  }
  return null
}

// Every tick registered this session, by its basemap id: a pick from the
// text search (or a view's item after the search moved on) is found here.
const ticksByRef = new Map<string, CatalogTick>()
export const catalogTick = (ref: string): CatalogTick | undefined => ticksByRef.get(ref)

function register(catalog: string, itemKey: string, dateMs: number, label: string, source: Omit<CustomBasemapSource, "id">, meta?: TickMeta): CatalogTick {
  const id = `${CATALOG_BASEMAP_PREFIX}${catalog}--${itemKey.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 90)}`
  basemaps.set(id, { ...source, id, transient: true, ...(SCANNED_MAP_CATALOGS.has(catalog) || source.type === "iiif" ? { oldMap: true } : {}) } as CustomBasemapSource)
  // No declared resolution: one pixel at the source's max zoom, at its extent's latitude.
  const lat = source.bounds ? (source.bounds[1] + source.bounds[3]) / 2 : 0
  const gsd = meta?.gsd ?? (source.maxzoom ? gsdFromZoom(source.maxzoom, lat, 256) : undefined)
  const tick: CatalogTick = { source: catalog, key: dateMs, dateMs, label, ref: id, meta: { date: new Date(dateMs).toISOString().slice(0, 10), url: source.infoUrl, ...meta, gsd } }
  ticksByRef.set(id, tick)
  return tick
}

const cogSource = (name: string, href: string, bbox: Bbox | undefined, description: string, infoUrl?: string): Omit<CustomBasemapSource, "id"> =>
  // Catalog COGs are mostly in UTM: titiler reprojects them.
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

async function hotStacTicks(catalog: string, bbox: Bbox, signal?: AbortSignal, range?: [number, number]): Promise<CatalogTick[]> {
  const collection = HOT_COLLECTION[catalog]
  const datetime = range ? `&datetime=${new Date(range[0]).toISOString()}/${new Date(range[1]).toISOString()}` : ""
  const res = await fetch(`${HOT_STAC}/search?collections=${collection}&bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&limit=200${datetime}`, { signal })
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
    const thumb = f.assets?.thumbnail?.href ?? f.assets?.preview?.href
    ticks.push(register(catalog, f.id, dateMs, label, cogSource(`${def.label} · ${title} · ${date}`, href, f.bbox, `${def.label}, ${date}${p.gsd ? `, ${Number(p.gsd).toFixed(2)} m` : ""}`, info),
      { gsd: Number.isFinite(Number(p.gsd)) ? Number(p.gsd) : undefined, thumb, provider: def.label, licence: catalog === "cat-maxar" || catalog === "cat-vantor" ? "CC BY-NC 4.0" : catalog === "cat-oam" ? "CC BY 4.0 (per upload)" : "Public domain (NOAA)" }))
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
    const thumbRel = pick.it.assets?.thumbnail?.href
    ticks.push(register("cat-planet", pick.it.id ?? c.url, dateMs, `Planet DD · ${c.title} · ${date}`, cogSource(`Planet · ${c.title} · ${date}`, hrefAbs, pick.it.bbox, `Planet disaster data, ${c.title}, ${date}`, "https://www.planet.com/disasterdata/"),
      { thumb: thumbRel ? new URL(thumbRel, pick.href).href : undefined, provider: "Planet", licence: "CC BY-NC 4.0", gsd: Number(pick.it.properties?.gsd) || undefined }))
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
  return mapWarperItems(catalog, (await res.json()).data ?? [], bbox)
}
function mapWarperItems(catalog: string, data: any[], bbox: Bbox | null, undated?: CatalogSearchHit[]): CatalogTick[] {
  const { host, short } = WARPERS[catalog]
  const ticks: CatalogTick[] = []
  for (const r of data) {
    const a = r.attributes ?? {}
    if (a.status && a.status !== "warped") continue
    const b = String(a.bbox ?? "").split(",").map(Number) as Bbox
    if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || (bbox && !intersects(b, bbox))) continue
    const year = yearOf(a.date_depicted, a.title)
    if (!year) {
      // A search keeps the undated maps: no tick, but on the view by "Use".
      if (undated) {
        const title = String(a.title ?? r.id).replace(/^File:/, "").replace(/\.(jpe?g|png|tiff?|gif)$/i, "")
        const ref = registerUndated(catalog, String(r.id), { name: title, url: `${host}/maps/tile/${r.id}/{z}/{x}/{y}.png`, type: "tms", role: "basemap", bounds: b, description: `${TIMELINE_CATALOG_BY_ID[catalog].label} map ${r.id}, undated`, infoUrl: `${host}/maps/${r.id}`, maxzoom: 20 } as Omit<CustomBasemapSource, "id">)
        undated.push({ catalog, label: `${short} · ${title}`, detail: "undated · as a basemap, not on the timeline", url: `${host}/maps/${r.id}`, bounds: b, use: `catalog-basemap:${ref}` })
      }
      continue
    }
    const dateMs = Date.UTC(year, 0, 1)
    const title = String(a.title ?? r.id).replace(/^File:/, "").replace(/\.(jpe?g|png|tiff?|gif)$/i, "")
    ticks.push(register(catalog, String(r.id), dateMs, `${short} · ${title} · ${year}`, {
      name: `${title} (${year})`, url: `${host}/maps/tile/${r.id}/{z}/{x}/{y}.png`, type: "tms", role: "basemap", bounds: b,
      description: `${TIMELINE_CATALOG_BY_ID[catalog].label} map ${r.id}, depicting ${year}`, infoUrl: `${host}/maps/${r.id}`, maxzoom: 20,
    } as Omit<CustomBasemapSource, "id">, { thumb: `${host}/maps/thumb/${r.id}`, url: `${host}/maps/${r.id}`, date: String(year), provider: TIMELINE_CATALOG_BY_ID[catalog].label }))
  }
  return ticks
}

// ── SLUB Virtuelles Kartenforum ───────────────────────────────────────────
async function slubTicks(bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1]
  // Maps within an area three views wide, like Map Warper: sheets at street
  // zoom, regional maps zoomed out.
  const region = [Math.max(-180, bbox[0] - w), Math.max(-85, bbox[1] - h), Math.min(180, bbox[2] + w), Math.min(85, bbox[3] + h)]
  const res = await fetch("https://search.kartenforum.slub-dresden.de/vk20/_search", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: 150, query: { bool: { filter: [
      { term: { has_georeference: true } },
      { geo_shape: { geometry: { shape: { type: "envelope", coordinates: [[region[0], region[3]], [region[2], region[1]]] }, relation: "within" } } },
    ] } } }),
  })
  if (!res.ok) throw new Error(`Kartenforum ${res.status}`)
  const d = await res.json()
  const ticks: CatalogTick[] = []
  for (const hit of d.hits?.hits ?? []) {
    const p = hit._source ?? {}
    const tms = p.tms_urls?.[0]
    const when = p.time_published ?? p.time_period_start
    const dateMs = when ? Date.parse(when) : NaN
    if (!tms || !Number.isFinite(dateMs) || !p.geometry) continue
    const pts = (p.geometry.coordinates?.[0] ?? []) as [number, number][]
    const b: Bbox | undefined = pts.length ? [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))] : undefined
    if (b && !intersects(b, bbox)) continue
    const year = String(when).slice(0, 4)
    const title = String(p.title_long ?? p.title ?? p.map_id).replace(/\s+/g, " ").slice(0, 140)
    const id = String(p.map_id ?? p.file_name).split(":").pop()!
    ticks.push(register("cat-slub", id, dateMs, `Kartenforum · ${title} · ${year}`, {
      // TMS tiles: y counted from the south.
      name: `${title} (${year})`, url: `${tms}/{z}/{x}/{y}.png`, type: "tms", scheme: "tms", role: "basemap", bounds: b, maxzoom: 18,
      description: `SLUB Virtuelles Kartenforum, ${p.map_type ?? "map"}${p.map_scale ? ` 1:${Number(p.map_scale).toLocaleString("en-US")}` : ""}, ${year}`,
      infoUrl: p.permalink ?? `https://kartenforum.slub-dresden.de/`,
    } as Omit<CustomBasemapSource, "id">, { thumb: p.thumb_url || undefined, provider: "SLUB Kartenforum", url: p.permalink || undefined }))
  }
  return ticks
}

// ── CORONA Atlas (CAST) ───────────────────────────────────────────────────
// The block index (dates, extents) is baked in: CAST's own list sends no CORS
// header; the WMS does.
import coronaBlocks from "./corona-atlas-blocks.json" with { type: "json" }
function coronaTicks(bbox: Bbox): CatalogTick[] {
  const ticks: CatalogTick[] = []
  for (const b of coronaBlocks as { id: string; date: string | null; bbox: Bbox }[]) {
    if (!b.date || !intersects(b.bbox, bbox)) continue
    ticks.push(register("cat-corona", b.id, Date.parse(b.date), `CORONA · ${b.id} · ${b.date}`, {
      name: `CORONA ${b.id} (${b.date})`,
      url: `https://geoserve.cast.uark.edu/geoserver/wms?service=WMS&version=1.1.1&request=GetMap&layers=corona:${b.id}&styles=&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true`,
      type: "wms", role: "basemap", bounds: b.bbox, maxzoom: 16,
      description: `CORONA KH-4 mosaic ${b.id}, ${b.date}, CORONA Atlas of the Middle East (CAST, University of Arkansas)`, infoUrl: "https://corona.cast.uark.edu/",
    } as Omit<CustomBasemapSource, "id">, { provider: "CORONA Atlas (CAST)", gsd: 2, licence: "CAST terms (USGS public domain imagery)" }))
  }
  return ticks
}

// ── USGS historical topographic maps ──────────────────────────────────────
const USGS_TOPO = "https://historical1.arcgis.com/arcgis/rest/services/USA_Historical_Topographic_Maps/ImageServer"
async function usgsTopoTicks(bbox: Bbox | null, signal?: AbortSignal, text?: string): Promise<CatalogTick[]> {
  // Quads under the view centre (Category 1: primary rasters, not footprints);
  // a whole-view query over a state would list thousands. A text search:
  // the quads whose name holds the words, anywhere.
  const cx = bbox ? (bbox[0] + bbox[2]) / 2 : 0, cy = bbox ? (bbox[1] + bbox[3]) / 2 : 0
  const where = text ? `Category=1 AND UPPER(Map_Name) LIKE '%${text.toUpperCase().replace(/'/g, "''")}%'` : "Category=1"
  const q = new URLSearchParams({
    where, ...(text ? {} : { geometry: `${cx.toFixed(5)},${cy.toFixed(5)}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects" }),
    outFields: "OBJECTID,Map_Name,Date_On_Map,Imprint_Year,Map_Scale,State",
    returnGeometry: "true", outSR: "4326", resultRecordCount: text ? "100" : "300", f: "json",
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

// ── National historical layers ────────────────────────────────────────────
// Fixed, dated layers from national mapping agencies rather than searchable
// catalogs: a tick per layer (or per time value) whose extent covers the view.

// IGN Géoplateforme (France): the WMTS capabilities list every dated layer
// (annual orthophotos since 2000, the 1950-1995 historical aerial mosaics,
// SPOT and Pléiades years, Cassini, État-major, the 1950 SCAN 50, regional
// archives); read once per session (250 KB gzipped), filtered by extent.
type IgnLayer = { id: string; title: string; year: number; span: string; bbox: Bbox; format: string; style: string; tms: string; minzoom: number; maxzoom: number }
let ignIndex: Promise<IgnLayer[]> | null = null
const IGN_WMTS = "https://data.geopf.fr/wmts"
const IGN_UNDATED: Record<string, [number, string]> = { CASSINI: [1756, "1756-1815"] }
async function loadIgnIndex(): Promise<IgnLayer[]> {
  const res = await fetch(`${IGN_WMTS}?SERVICE=WMTS&REQUEST=GetCapabilities`)
  if (!res.ok) throw new Error(`IGN ${res.status}`)
  const doc = new DOMParser().parseFromString(await res.text(), "application/xml")
  const out: IgnLayer[] = []
  const now = new Date().getUTCFullYear()
  for (const layer of Array.from(doc.getElementsByTagName("Layer"))) {
    const id = layer.getElementsByTagName("ows:Identifier")[0]?.textContent ?? ""
    // Imagery and historical maps only: no infrared, admin, cadastre, topo.
    if (!/^(ORTHOIMAGERY\.ORTHO|orthophoto_|POC_ORTHOS|GEOGRAPHICALGRIDSYSTEMS\.)|CASSINI/.test(id) || /IRC|PLANIGN|\.MAPS$|MAPS\.(BDUNI|OVERVIEW)|SCAN-EXPRESS|SCAN(25|100|OACI|REG)/i.test(id)) continue
    const title = layer.getElementsByTagName("ows:Title")[0]?.textContent ?? id
    const m = /\b(1[5-9]\d\d|20\d\d)(?:\s*[-–]\s*(1[5-9]\d\d|20\d\d))?/.exec(`${title} ${id}`)
    const undated = Object.entries(IGN_UNDATED).find(([k]) => id.includes(k))?.[1]
    const year = m ? Number(m[1]) : undated?.[0]
    if (!year || year > now) continue
    const span = m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : undated![1]
    const lo = layer.getElementsByTagName("ows:LowerCorner")[0]?.textContent?.split(/\s+/).map(Number)
    const hi = layer.getElementsByTagName("ows:UpperCorner")[0]?.textContent?.split(/\s+/).map(Number)
    if (!lo || !hi) continue
    const tms = layer.getElementsByTagName("TileMatrixSet")[0]?.textContent ?? "PM"
    const z = /_(\d+)_(\d+)$/.exec(tms)
    const style = layer.getElementsByTagName("Style")[0]?.getElementsByTagName("ows:Identifier")[0]?.textContent ?? "normal"
    out.push({ id, title, year, span, bbox: [lo[0], lo[1], hi[0], hi[1]], format: layer.getElementsByTagName("Format")[0]?.textContent ?? "image/jpeg", style, tms, minzoom: z ? Number(z[1]) : 0, maxzoom: z ? Number(z[2]) : 19 })
  }
  return out
}
const ignTileUrl = (l: IgnLayer) =>
  `${IGN_WMTS}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(l.id)}&STYLE=${encodeURIComponent(l.style)}&FORMAT=${encodeURIComponent(l.format)}&TILEMATRIXSET=${encodeURIComponent(l.tms)}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
const ignProbe = new Map<string, Promise<boolean>>()
async function ignTicks(bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  if (!ignIndex) ignIndex = loadIgnIndex().catch((e) => { ignIndex = null; throw e })
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2
  // The layer must cover the view centre. Its extent says so for regional
  // archives; the yearly orthophotos span France but each year flies a third
  // of the departments, so one z14 tile at the centre is asked for (404 where
  // that year has no photo), a few at a time, remembered for the session.
  const candidates = (await ignIndex).filter((l) => containsPt(l.bbox, cx, cy))
  const z = 14, n = 2 ** z
  const tx = Math.floor(((cx + 180) / 360) * n)
  const lat = (cy * Math.PI) / 180
  const ty = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n)
  const covered = new Map<string, boolean>()
  const queue = [...candidates]
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      if (z < l.minzoom || z > l.maxzoom) { covered.set(l.id, true); continue }
      const key = `${l.id}/${tx}/${ty}`
      let p = ignProbe.get(key)
      if (!p) {
        p = fetch(ignTileUrl(l).replace("{z}", String(z)).replace("{x}", String(tx)).replace("{y}", String(ty)), { signal }).then((r) => r.ok, () => true)
        ignProbe.set(key, p)
      }
      covered.set(l.id, await p)
    }
  }))
  return candidates.filter((l) => covered.get(l.id)).map((l) =>
    register("cat-ign", l.id, Date.UTC(l.year, 0, 1), `IGN · ${l.title} · ${l.span}`, {
      name: `IGN ${l.title}`,
      url: ignTileUrl(l),
      type: "tms", role: "basemap", bounds: l.bbox, minzoom: l.minzoom, maxzoom: l.maxzoom,
      description: `IGN Géoplateforme layer ${l.id}, ${l.span}`, infoUrl: "https://remonterletemps.ign.fr/",
    } as Omit<CustomBasemapSource, "id">))
}

// swisstopo (Switzerland): the time-travel WMTS layers take a time value per
// edition; the geo.admin.ch identify service lists the editions covering a
// point, so only years with imagery or a map there get a tick.
const CH_BBOX: Bbox = [5.9, 45.8, 10.5, 47.85]
async function swisstopoTicks(catalog: "cat-swissimage" | "cat-swiss-maps", bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2
  if (!containsPt(CH_BBOX, cx, cy)) return []
  const layer = catalog === "cat-swissimage" ? "ch.swisstopo.swissimage-product.metadata" : "ch.swisstopo.zeitreihen"
  const identify = async (timeInstant?: number) => {
    const res = await fetch(`https://api3.geo.admin.ch/rest/services/all/MapServer/identify?layers=all:${layer}&geometry=${cx.toFixed(5)},${cy.toFixed(5)}&geometryType=esriGeometryPoint&sr=4326&returnGeometry=false&tolerance=0&limit=500${timeInstant ? `&timeInstant=${timeInstant}` : ""}`, { signal })
    if (!res.ok) throw new Error(`swisstopo ${res.status}`)
    return ((await res.json()).results ?? []) as any[]
  }
  // Without a time the map series answers from 1954 on only: the Dufour and
  // Siegfried editions (1844-1953) are asked for every sixth year.
  const eras = catalog === "cat-swiss-maps" ? Array.from({ length: 19 }, (_, i) => 1845 + i * 6) : []
  // One after the other: a burst of parallel calls is queued server-side
  // (30 s), in sequence each answers in about 0.1 s.
  const results = await identify()
  for (const y of eras) results.push(...(await identify(y).catch(() => [])))
  const d = { results }
  // Several time values show the same edition (a sheet stays current for
  // years; a flight year feeds several yearly mosaics): one tick per edition,
  // drawn at the first time value that shows it.
  const editions = new Map<number, { time: number; props: any; products: Set<string> }>()
  for (const r of d.results ?? []) {
    const p = r.properties ?? r.attributes ?? {}
    const edition = Number(catalog === "cat-swissimage" ? p.flightyear : p.release_year || p.years)
    const time = Number(catalog === "cat-swissimage" ? p.bgdi_flugjahr : p.years)
    if (!edition || !time) continue
    const e = editions.get(edition) ?? { time, props: p, products: new Set<string>() }
    if (time < e.time) { e.time = time; e.props = p }
    if (p.produkt) e.products.add(String(p.produkt).replace(/^lk/i, "LK ").replace(/^ta/i, "Siegfried 1:").replace(/^tk/i, "Dufour 1:").replace(/1:(\d+)$/, (_m, n) => `1:${n}'000`))
    editions.set(edition, e)
  }
  const ticks: CatalogTick[] = []
  for (const [year, { time, props: p, products }] of editions) {
    if (catalog === "cat-swissimage") {
      ticks.push(register(catalog, String(year), Date.UTC(year, 0, 1), `SWISSIMAGE · flown ${year}${p.colormode ? ` · ${p.colormode}` : ""}${p.gsd ? ` · ${p.gsd}` : ""}`, {
        name: `SWISSIMAGE Zeitreise ${year}`, url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product/default/${time}/3857/{z}/{x}/{y}.jpeg`,
        type: "tms", role: "basemap", bounds: CH_BBOX, maxzoom: 20,
        description: `swisstopo SWISSIMAGE Zeitreise, flown ${year} (mosaic ${time})`, infoUrl: "https://map.geo.admin.ch/?layers=ch.swisstopo.swissimage-product",
      } as Omit<CustomBasemapSource, "id">))
    } else {
      const series = [...products].sort().join(" / ")
      ticks.push(register(catalog, String(year), Date.UTC(year, 0, 1), `swisstopo maps · ${series} · ${p.kbbez ?? ""} · edition ${year}`, {
        name: `swisstopo Zeitreise ${year}`, url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.zeitreihen/default/${time}1231/3857/{z}/{x}/{y}.png`,
        type: "tms", role: "basemap", bounds: CH_BBOX, maxzoom: 18,
        description: `swisstopo Zeitreise map series (${series}), sheet ${p.kbbez ?? p.kbnum ?? ""}, edition ${year}; the scale follows the zoom`, infoUrl: "https://map.geo.admin.ch/?layers=ch.swisstopo.zeitreihen",
      } as Omit<CustomBasemapSource, "id">))
    }
  }
  return ticks
}

// Regional series (lib/national-historical.ts): layers whose extent holds
// the view centre, then the agency's flight index or a tile probe.
const natProbe = new Map<string, Promise<string | null>>()
function natTileAt(l: NatLayer, lng: number, lat: number): string {
  const z = Math.min(l.maxzoom ?? 18, 15), n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  if (l.type === "tms") return l.url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
  const size = 40075016.686 / n, minX = -20037508.34 + x * size, maxY = 20037508.34 - y * size
  // The tile as drawn: a smaller image would ask for a smaller scale, and
  // scale-limited WMS layers answer those blank.
  return l.url.replace("{bbox-epsg-3857}", `${minX},${maxY - size},${minX + size},${maxY}`)
}
/** True when the tile holds a picture: not an error, not one flat colour. */
/** The tile's picture, summarised: null when missing or one flat colour,
 *  else a fingerprint (two layers giving the same one show the same image). */
async function tilePicture(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith("image/") || blob.size < 200) return null
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(16, 16)
    const ctx = c.getContext("2d")!
    ctx.drawImage(bmp, 0, 0, 16, 16)
    const d = ctx.getImageData(0, 0, 16, 16).data
    // Sums of three channels, so 0..765.
    let lo = 765, hi = 0, opaque = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue
      opaque++
      const v = d[i] + d[i + 1] + d[i + 2]
      lo = Math.min(lo, v); hi = Math.max(hi, v)
    }
    if (opaque <= 8 || hi - lo <= 6) return null
    let sum = 0
    for (let i = 0; i < d.length; i++) sum = (sum * 31 + d[i]) >>> 0
    return `${blob.size}:${sum}`
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e
    return null
  }
}
async function nationalTicks(src: NatSource, bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2
  if (!containsPt(src.bbox, cx, cy)) return []
  const candidates = (await loadNationalLayers(src)).filter((l) => !l.bbox || containsPt(l.bbox, cx, cy))
  // Exact flight dates per layer, when the agency publishes a flight index.
  let dates: Record<string, string[]> | null = null
  if (src.dates) dates = await src.dates(cx, cy, signal).catch(() => null)
  let kept: NatLayer[]
  if (dates) kept = candidates.filter((l) => dates![l.key]?.length)
  else {
    const picture = new Map<string, string | null>()
    const queue = [...candidates]
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let l = queue.shift(); l; l = queue.shift()) {
        const url = natTileAt(l, cx, cy)
        let p = natProbe.get(url)
        if (!p) { p = tilePicture(url, signal); natProbe.set(url, p); p.catch(() => natProbe.delete(url)) }
        picture.set(l.key, await p)
      }
    }))
    // The same picture under several layers is one capture: a map sheet that
    // did not change between editions (NGI), or a time-enabled WMS showing the
    // latest flight up to the year asked (Baden-Württemberg, Hamburg). Only
    // the earliest layer showing it is kept.
    const firstOf = new Set<string>()
    kept = [...candidates].sort((x, y) => x.year - y.year).filter((l) => {
      const f = picture.get(l.key)
      if (!f || firstOf.has(f)) return false
      firstOf.add(f)
      return true
    })
  }
  return kept.map((l) => {
    const flown = dates?.[l.key]?.[0]
    const dateMs = flown ? Date.parse(flown) : Date.UTC(l.year, 0, 1)
    const when = flown && !flown.endsWith("-01-01") ? flown : l.endYear ? `${l.year}-${l.endYear}` : String(l.year)
    const gsdM = /(\d+(?:[.,]\d+)?)\s*cm/i.exec(l.label) ? Number(/(\d+(?:[.,]\d+)?)\s*cm/i.exec(l.label)![1].replace(",", ".")) / 100 : /(\d+(?:[.,]\d+)?)\s*m\b/i.exec(l.label) ? Number(/(\d+(?:[.,]\d+)?)\s*m\b/i.exec(l.label)![1].replace(",", ".")) : undefined
    return register(src.id, l.key, dateMs, `${src.short} · ${l.label} · ${when}`, {
      name: `${src.label}: ${l.label}`, url: l.url, type: l.type, role: "basemap", bounds: l.bbox ?? src.bbox, maxzoom: l.maxzoom, minzoom: l.minzoom,
      description: `${src.label}, ${l.label}${flown ? `, flown ${flown}` : ""}. ${src.licence}.`, infoUrl: src.infoUrl,
    } as Omit<CustomBasemapSource, "id">, { licence: src.licence, provider: src.label, gsd: gsdM, date: flown })
  })
}

// Kartverket (Norway): the county maps (amtskart, 1826-1916), the one dated
// layer its historical-maps WMS serves without a map id.
const NO_BBOX: Bbox = [4.0, 57.9, 31.2, 71.3]
function kartverketTicks(bbox: Bbox): CatalogTick[] {
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2
  if (!containsPt(NO_BBOX, cx, cy)) return []
  return [register("cat-kartverket", "amt1", Date.UTC(1826, 0, 1), "Kartverket · Amtskart (county maps) · 1826-1916", {
    name: "Kartverket Amtskart 1826-1916",
    url: "https://wms.geonorge.no/skwms1/wms.historiskekart?service=WMS&version=1.3.0&request=GetMap&layers=amt1&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true",
    type: "wms", role: "basemap", bounds: NO_BBOX,
    description: "Kartverket historical county maps (amtskart), the first regular map series of Norway, 1826-1916", infoUrl: "https://data.norge.no/en/datasets/41e7c19b-d3c0-37b1-b773-ebb1c852e19a/historiske-kart",
  } as Omit<CustomBasemapSource, "id">)]
}

// ── ArcGIS Online search ──────────────────────────────────────────────────
async function agolTicks(bbox: Bbox | null, signal?: AbortSignal, text?: string): Promise<CatalogTick[]> {
  // A text search looks for the words anywhere in the world; the view query
  // for imagery keywords over the view.
  const q = text
    ? `(type:"Image Service" OR type:"Map Service") AND (${text})`
    : '(type:"Image Service" OR type:"Map Service") AND (orthophoto OR orthophotos OR orthoimagery OR orthofoto OR orthophotographie OR luchtfoto OR "aerial photography" OR "aerial imagery" OR "historical imagery")'
  const viewKm2 = bbox ? areaKm2(bbox) : 0
  // National services stay listed over a city (the Netherlands is ~80,000 km2);
  // continental and world layers do not.
  const minKm2 = viewKm2 / 2000, maxKm2 = Math.max(viewKm2 * 2000, 1_000_000)
  const ticks: CatalogTick[] = []
  const candidates: { r: any; b: Bbox; year: number; base: string }[] = []
  let start = 1
  for (let page = 0; page < 3 && start > 0; page++) {
    const res = await fetch(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q)}${bbox ? `&bbox=${bbox.map((v) => v.toFixed(5)).join(",")}` : ""}&num=100&start=${start}&f=json`, { signal })
    if (!res.ok) throw new Error(`ArcGIS Online ${res.status}`)
    const d = await res.json()
    for (const r of d.results ?? []) {
      const ext = r.extent as [[number, number], [number, number]] | undefined
      if (!r.url || !ext?.length) continue
      const b: Bbox = [ext[0][0], ext[0][1], ext[1][0], ext[1][1]]
      const a = areaKm2(b)
      if (bbox && (a < minKm2 || a > maxKm2 || !intersects(b, bbox))) continue
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
    // Resolution: the finest cache level's, or the image service's pixel size.
    const lods: any[] = info.tileInfo?.lods ?? []
    const finest = lods.length ? Math.min(...lods.map((l: any) => Number(l.resolution)).filter(Number.isFinite)) : undefined
    const px = Number(info.pixelSizeX)
    const gsd = finest ?? (Number.isFinite(px) && px > 0 ? px : undefined)
    ticks.push(register("cat-agol", r.id, Date.UTC(year, 0, 1), `ArcGIS · ${r.title} · ${year} · ${r.owner}`, {
      name: `${r.title}`, url, type, role: "basemap", bounds: b,
      description: `ArcGIS Online ${r.type}, ${r.owner}, title year ${year}`, infoUrl: `https://www.arcgis.com/home/item.html?id=${r.id}`,
    } as Omit<CustomBasemapSource, "id">, { gsd, provider: `ArcGIS Online (${r.owner})`, licence: r.licenseInfo ? String(r.licenseInfo).replace(/<[^>]+>/g, "").slice(0, 120) : undefined, thumb: r.thumbnail ? `https://www.arcgis.com/sharing/rest/content/items/${r.id}/info/${r.thumbnail}` : undefined, url: `https://www.arcgis.com/home/item.html?id=${r.id}` }))
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

// ── Allmaps: dated maps ──────────────────────────────────────────────────
// The annotations API has no dates; the map's title often names a year, and
// the IIIF manifest it comes from (resource.partOf) may carry one in its
// metadata (BnF's "Date", Rumsey's "Pub Date") or a navDate. One manifest
// read per undated map in view, cached, at most 40 per load.
const manifestYearCache = new Map<string, Promise<number | null>>()
function manifestYear(url: string, signal?: AbortSignal): Promise<number | null> {
  let p = manifestYearCache.get(url)
  if (!p) {
    p = fetch(url, { signal }).then((r) => (r.ok ? r.json() : null)).then((m) => {
      if (!m) return null
      const texts: string[] = []
      if (typeof m.navDate === "string") texts.push(m.navDate)
      for (const row of m.metadata ?? []) {
        const label = typeof row.label === "string" ? row.label : Object.values(row.label ?? {}).flat().join(" ")
        if (!/\bdate\b|année|annee|\byear\b|jahr|datum|pub\.? date|publication|publié|erschienen/i.test(String(label))) continue
        const value = typeof row.value === "string" ? row.value : Object.values(row.value ?? {}).flat().join(" ")
        texts.push(String(value).replace(/<[^>]+>/g, " "))
      }
      // The earliest plausible year named ("1850 [reprint 1920]" is 1850).
      const years = texts.flatMap((t) => [...String(t).matchAll(/\b(1[4-9]\d\d|20\d\d)\b/g)].map((m) => Number(m[1]))).filter((y) => y <= new Date().getUTCFullYear())
      return years.length ? Math.min(...years) : null
    }).catch(() => null)
    manifestYearCache.set(url, p)
  }
  return p
}
async function allmapsTicks(bbox: Bbox, signal?: AbortSignal): Promise<CatalogTick[]> {
  const bounds = { getWest: () => bbox[0], getSouth: () => bbox[1], getEast: () => bbox[2], getNorth: () => bbox[3] }
  const fc = await loadAllmapsCoverage("allmapsAll", bounds, signal)
  const ticks: CatalogTick[] = []
  let reads = 0
  await Promise.all(fc.features.map(async (f) => {
    const id = String((f.properties as any)?.overlay ?? "").replace(/^allmaps:/, "")
    const meta = allmapsMeta(id)
    if (!meta) return
    // The archive's own date, never the georeferencing's: the IIIF manifest
    // first (BnF's "Date", Rumsey's "Pub Date", a navDate), then a year in
    // the title when it is plainly historical (before 1950; a later year in
    // a title is as often the scan's or the edition's).
    let year: number | null = null
    if (meta.manifest && reads < 40) { reads += 1; year = await manifestYear(meta.manifest, signal) }
    if (!year && meta.year && meta.year < 1950) year = meta.year
    if (!year) return
    ticks.push(register("cat-allmaps", id, Date.UTC(year, 0, 1), `Allmaps · ${meta.title ?? meta.label} · ${year}`, {
      name: meta.title ?? meta.label, url: meta.annotationUrl, type: "iiif", role: "overlay", stack: "top", resolutionM: meta.gsd,
      description: `Georeferenced IIIF map, Allmaps annotation ${id} · ${meta.detail}`, infoUrl: meta.pageUrl, provider: "allmaps", bounds: meta.bounds,
    } as Omit<CustomBasemapSource, "id">, { provider: meta.providerLabel ?? "Allmaps", url: meta.pageUrl, gsd: meta.gsd, thumb: meta.thumb, date: String(year) }))
  }))
  return ticks
}

// ── Text search across the checked catalogs, anywhere ─────────────────────
/** One hit of the text search. `ref` when it is a catalog item (picking puts
 *  it on the view like a tick); `use` when it goes through the coverage
 *  "Use" path (a QMS service); neither when it can only be looked at. */
export interface CatalogSearchHit { catalog: string; label: string; detail: string; url?: string; bounds?: Bbox; ref?: string; use?: string; dateMs?: number }
export interface CatalogSearchResult { hits: CatalogSearchHit[]; searched: string[]; unsupported: string[]; errors: Record<string, string>; notes: string[] }

const tickHit = (t: CatalogTick, detail?: string): CatalogSearchHit => {
  const src = basemaps.get(t.ref)
  const gsd = t.meta?.gsd ? (t.meta.gsd < 1 ? `${Math.round(t.meta.gsd * 100)} cm` : `${+t.meta.gsd.toFixed(1)} m`) : null
  return { catalog: t.source, label: t.label, detail: detail ?? [t.meta?.date, gsd].filter(Boolean).join(" · "), url: t.meta?.url, bounds: src?.bounds, ref: t.ref, dateMs: t.dateMs }
}
const sha1IdImpl = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16)

/** David Rumsey's own catalog search, kept to the maps Allmaps has
 *  georeferenced (an Allmaps image id is the first 16 hex of the SHA-1 of
 *  the IIIF image address): those drape as overlays, dated by Rumsey. */
async function rumseyAllmapsSearch(text: string, signal?: AbortSignal): Promise<{ hits: CatalogSearchHit[]; notGeoreferenced: number; total: number }> {
  const res = await fetch(`https://www.davidrumsey.com/luna/servlet/as/search?q=${encodeURIComponent(text)}&os=0&bs=60`, { signal })
  if (!res.ok) throw new Error(`David Rumsey ${res.status}`)
  const d = await res.json()
  const results: any[] = d.results ?? []
  const field = (r: any, name: string): string | undefined => { for (const f of r.fieldValues ?? []) if (f[name]) return String(f[name][0]); return undefined }
  let notGeoreferenced = 0
  const hits: CatalogSearchHit[] = []
  const queue = [...results]
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const image = `https://www.davidrumsey.com/luna/servlet/iiif/${r.id}`
      const annotationUrl = `${ALLMAPS_ANNOTATIONS}/images/${await sha1Id(image)}`
      const a = await fetch(annotationUrl, { signal }).then((x) => (x.ok ? x.json() : null)).catch(() => null)
      if (!a) { notGeoreferenced++; continue }
      const pts: [number, number][] = []
      for (const item of a.items ?? []) for (const f of item.body?.features ?? []) { const c = f.geometry?.coordinates; if (Array.isArray(c)) pts.push([c[0], c[1]]) }
      const bounds: Bbox | undefined = pts.length > 1 ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] : undefined
      const title = field(r, "Short Title") ?? r.displayName ?? r.id
      const year = yearOf(field(r, "Date"), field(r, "Full Title"), title)
      const info = `https://www.davidrumsey.com/luna/servlet/detail/${r.id}`
      if (!year) { hits.push({ catalog: "cat-allmaps", label: `Rumsey · ${title}`, detail: "undated · georeferenced in Allmaps", url: info, bounds }); continue }
      const t = register("cat-allmaps", `rumsey-${r.id}`, Date.UTC(year, 0, 1), `Allmaps · Rumsey: ${title} · ${year}`, {
        name: `${title} (${year}, David Rumsey)`, url: annotationUrl, type: "iiif", role: "overlay", stack: "top", provider: "allmaps", bounds,
        description: `David Rumsey Map Collection ${r.id}, ${field(r, "Full Title") ?? title}, georeferenced in Allmaps`, infoUrl: info,
      } as Omit<CustomBasemapSource, "id">, { provider: "David Rumsey Map Collection", url: info })
      hits.push(tickHit(t, [String(year), field(r, "Attributed Author") ?? field(r, "Author"), "David Rumsey via Allmaps"].filter(Boolean).join(" · ")))
    }
  }))
  return { hits, notGeoreferenced, total: Number(d.totalResults) || results.length }
}

/** The checked catalogs searched for `text`, wherever their items are:
 *  Map Warper and Wikimaps (title search), David Rumsey through Allmaps,
 *  ArcGIS Online, NextGIS QMS, the USGS quads (name), IGN Remonter le temps
 *  and the national catalogs (their layer names). The rest cannot search by
 *  text and are listed as such. */
export async function searchCatalogs(ids: string[], text: string, signal?: AbortSignal): Promise<CatalogSearchResult> {
  const q = text.trim()
  const out: CatalogSearchResult = { hits: [], searched: [], unsupported: [], errors: {}, notes: [] }
  if (q.length < 2) return out
  const lower = q.toLowerCase()
  const jobs: Promise<void>[] = []
  const run = (id: string, label: string, job: () => Promise<CatalogSearchHit[]>) => {
    out.searched.push(label)
    jobs.push(job().then((h) => { out.hits.push(...h) }, (e) => { if (!signal?.aborted) out.errors[label] = String(e?.message ?? e) }))
  }
  const set = new Set(ids)
  for (const id of ids) {
    if (id in WARPERS) {
      run(id, TIMELINE_CATALOG_BY_ID[id].short, async () => {
        const res = await fetch(`${WARPERS[id].host}/api/v1/maps?field=title&query=${encodeURIComponent(q)}&per_page=60`, { signal })
        if (!res.ok) throw new Error(`${WARPERS[id].short} ${res.status}`)
        const undated: CatalogSearchHit[] = []
        const dated = mapWarperItems(id, (await res.json()).data ?? [], null, undated).map((t) => tickHit(t))
        return [...dated, ...undated]
      })
    } else if (id === "cat-agol") {
      run(id, "ArcGIS Online", async () => (await agolTicks(null, signal, q)).map((t) => tickHit(t)))
    } else if (id === "cat-usgs-topo") {
      run(id, "USGS topo", async () => (await usgsTopoTicks(null, signal, q)).map((t) => tickHit(t)))
    } else if (id === "cat-ign") {
      run(id, "IGN", async () => {
        if (!ignIndex) ignIndex = loadIgnIndex().catch((e) => { ignIndex = null; throw e })
        return (await ignIndex).filter((l) => `${l.title} ${l.id}`.toLowerCase().includes(lower)).slice(0, 60).map((l) => tickHit(register("cat-ign", l.id, Date.UTC(l.year, 0, 1), `IGN · ${l.title} · ${l.span}`, {
          name: `IGN ${l.title}`, url: ignTileUrl(l), type: "tms", role: "basemap", bounds: l.bbox, minzoom: l.minzoom, maxzoom: l.maxzoom,
          description: `IGN Géoplateforme layer ${l.id}, ${l.span}`, infoUrl: "https://remonterletemps.ign.fr/",
        } as Omit<CustomBasemapSource, "id">)))
      })
    } else if (id in NATIONAL_SOURCE_BY_ID) {
      const src = NATIONAL_SOURCE_BY_ID[id]
      run(id, src.short, async () => (await loadNationalLayers(src)).filter((l) => `${src.label} ${l.label}`.toLowerCase().includes(lower)).slice(0, 40).map((l) => tickHit(register(src.id, l.key, Date.UTC(l.year, 0, 1), `${src.short} · ${l.label} · ${l.endYear ? `${l.year}-${l.endYear}` : l.year}`, {
        name: `${src.label}: ${l.label}`, url: l.url, type: l.type, role: "basemap", bounds: l.bbox ?? src.bbox, maxzoom: l.maxzoom, minzoom: l.minzoom,
        description: `${src.label}, ${l.label}. ${src.licence}.`, infoUrl: src.infoUrl,
      } as Omit<CustomBasemapSource, "id">, { licence: src.licence, provider: src.label }))))
    } else if (id === "qmsAll") {
      run(id, "QMS", async () => {
        const res = await fetch(`https://qms.nextgis.com/api/v1/geoservices/?search=${encodeURIComponent(q)}&cumulative_status=works&limit=40`, { signal })
        if (!res.ok) throw new Error(`QMS ${res.status}`)
        const d = await res.json()
        return (d.results ?? d ?? []).filter((s: any) => s.type === "tms" || s.type === "wms").map((s: any) => ({
          catalog: "qmsAll", label: `QMS · ${s.name}`, detail: `${String(s.type).toUpperCase()} · undated`, url: `https://qms.nextgis.com/geoservices/${s.id}/`, use: `qms:${s.id}`,
        }))
      })
    } else if (id !== "allmapsAll" && id !== "allmapsRumsey" && id !== "cat-allmaps") {
      out.unsupported.push(TIMELINE_CATALOG_BY_ID[id]?.short ?? COVERAGE_ONLY_ENTRIES.find((e) => e.id === id)?.short ?? id)
    }
  }
  // Allmaps has no text search; David Rumsey's catalog does, and its maps
  // georeferenced in Allmaps drape.
  if (set.has("cat-allmaps") || set.has("allmapsAll") || set.has("allmapsRumsey")) {
    out.searched.push("David Rumsey (Allmaps)")
    jobs.push(rumseyAllmapsSearch(q, signal).then((r) => {
      out.hits.push(...r.hits)
      if (r.notGeoreferenced) out.notes.push(`${r.notGeoreferenced} of the first ${Math.min(60, r.total)} David Rumsey matches (${r.total} in all) are not georeferenced in Allmaps yet, so they cannot drape; Allmaps itself has no text search.`)
    }, (e) => { if (!signal?.aborted) out.errors["David Rumsey"] = String(e?.message ?? e) }))
  }
  await Promise.all(jobs)
  out.hits.sort((a, b) => (a.dateMs ?? Infinity) - (b.dateMs ?? Infinity))
  return out
}

/** Ticks for one catalog over the view; keys made unique per catalog
 *  (several items can share a date, and the key is the list's React key). */
export async function loadCatalogTicks(catalog: string, bbox: Bbox, signal?: AbortSignal, range?: [number, number]): Promise<CatalogTick[]> {
  let ticks: CatalogTick[] = []
  if (catalog === "eli") ticks = eliLayersToTicks(await datedEliLayersInView(bbox))
  else if (catalog in HOT_COLLECTION) ticks = await hotStacTicks(catalog, bbox, signal, range)
  else if (catalog === "cat-ign") ticks = await ignTicks(bbox, signal)
  else if (catalog === "cat-swissimage" || catalog === "cat-swiss-maps") ticks = await swisstopoTicks(catalog, bbox, signal)
  else if (catalog === "cat-kartverket") ticks = kartverketTicks(bbox)
  else if (catalog in NATIONAL_SOURCE_BY_ID) ticks = await nationalTicks(NATIONAL_SOURCE_BY_ID[catalog], bbox, signal)
  else if (catalog === "cat-planet") ticks = await planetTicks(bbox, signal)
  else if (catalog in WARPERS) ticks = await mapWarperTicks(catalog, bbox, signal)
  else if (catalog === "cat-usgs-topo") ticks = await usgsTopoTicks(bbox, signal)
  else if (catalog === "cat-slub") ticks = await slubTicks(bbox, signal)
  else if (catalog === "cat-corona") ticks = coronaTicks(bbox)
  else if (catalog === "cat-agol") ticks = await agolTicks(bbox, signal)
  else if (catalog === "cat-allmaps") ticks = await allmapsTicks(bbox, signal)
  // The timeline's window, when the picker asks for it (STAC searches
  // already asked the server; the rest is filtered here).
  if (range) ticks = ticks.filter((t) => t.dateMs >= range[0] && t.dateMs <= range[1])
  const used = new Set<number>()
  for (const t of ticks.sort((a, b) => a.dateMs - b.dateMs)) {
    while (used.has(t.key)) t.key += 1
    used.add(t.key)
  }
  return ticks
}
