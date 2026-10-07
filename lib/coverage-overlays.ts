import { gsdFromGcps } from "./allmaps-gsd"
import { atom } from "jotai"
import { createParser } from "nuqs"
import type { FeatureCollection, Feature, Polygon } from "geojson"
import customSources from "./custom-sources.json"
import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"
import { QMS_API, QMS_SUPPORTED_TYPES, parseQmsExtent, type QmsSearchResult } from "./qms"

/**
 * Coverage overlays (Source Info section): vector footprints of where a
 * source has data, drawn on the map so a blank area can be told apart from a
 * slow one. Independent of what is loaded in the BYOD lists - the whole
 * library and the whole Editor Layer Index are offered, as a tree:
 *
 *   mapterhorn   - Mapterhorn's own coverage vector tiles
 *                  (single-archive-tiles.mapterhorn.com/coverage/{z}/{x}/{y}.mvt,
 *                  layer "coverage", property "source": a national source id,
 *                  or "glo30" for the Copernicus fallback). Rendered straight
 *                  from the tiles, not from GeoJSON.
 *   lib:<id>     - a terrain library entry's declared bounds (whether or not
 *                  it is loaded).
 *   blib:<id>    - a basemap library entry's declared bounds.
 *   eli:<id>     - an OSM Editor Layer Index layer's real coverage polygon
 *                  (loaded from the ELI package). Offered for the layers
 *                  covering the current view when the picker opens.
 *   terrain:<id> / basemap:<id> - a loaded custom source that is not a
 *                  library entry, from its declared bounds (or the ELI polygon
 *                  for a basemap added from the index).
 *
 * The selection is shared state (parseAsCoverageOverlays below). GeoJSON
 * feature properties are flat so the map layer can read them: overlay, label,
 * detail, color, hollow, url.
 */
export const coverageOverlaysAtom = atom<string[]>([])

export const MAPTERHORN_COVERAGE_TILES = "https://single-archive-tiles.mapterhorn.com/coverage/{z}/{x}/{y}.mvt"
export const MAPTERHORN_COVERAGE_LAYER = "coverage"

export interface MapterhornSourceMeta { source: string; name: string; producer: string; resolution: number; website?: string }
let mapterhornMeta: Promise<Record<string, MapterhornSourceMeta>> | null = null
/** Mapterhorn's source catalog (download.mapterhorn.com/attribution.json):
 *  per-source grid resolution, product name and producer, keyed by the
 *  "source" id the coverage tiles carry. Fetched once, on first use. */
export function getMapterhornSourceMeta(): Promise<Record<string, MapterhornSourceMeta>> {
  if (!mapterhornMeta) {
    mapterhornMeta = fetch("https://download.mapterhorn.com/attribution.json").then((r) => r.json()).then((rows: MapterhornSourceMeta[]) =>
      Object.fromEntries(rows.map((r) => [r.source, r]))).catch((e) => { mapterhornMeta = null; throw e })
  }
  return mapterhornMeta
}

export interface CoverageLeaf { id: string; label: string; color: string; detail?: string; /** The dataset's own page (the label links there). */ url?: string; /** [west, south, east, north], for the zoom-to-fit button. */ bounds?: [number, number, number, number] }
export interface CoverageGroup { key: string; label: string; color: string; leaves: CoverageLeaf[]; note?: string; section: "Terrain" | "Basemaps"; parent?: string }

export const OVERLAY_COLORS = { qms: "#0891b2", allmaps: "#d946ef", mapterhorn: "#8b5cf6", library: "#10b981", basemapLibrary: "#f59e0b", eli: "#0ea5e9", yours: "#ec4899", yourBasemaps: "#ef4444", bing3d: "#6366f1", google3d: "#f43f5e", flai: "#14b8a6", esri3d: "#a855f7", otRaster: "#84cc16", otPointCloud: "#eab308" }

/** NextGIS QMS: the services whose declared extent intersects the view, from
 *  the list endpoint's `intersects_extent` filter (the view as a WKT
 *  polygon), working TMS and WMS only. Sized to the zoom like the Allmaps
 *  outlines: services much smaller than the view are left out when zoomed
 *  out, continental and worldwide ones when zoomed in (a national basemap
 *  stays listed over a city). */
export async function loadQmsCoverage(bounds: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }, signal?: AbortSignal): Promise<FeatureCollection> {
  const w = Math.max(-180, bounds.getWest()), e = Math.min(180, bounds.getEast())
  const s = Math.max(-85, bounds.getSouth()), n = Math.min(85, bounds.getNorth())
  const areaM2 = (ws: number, ss: number, es: number, ns: number) => Math.abs((es - ws) * 111320 * Math.cos(((ss + ns) / 2) * Math.PI / 180) * (ns - ss) * 110540)
  const viewM2 = areaM2(w, s, e, n)
  const minM2 = viewM2 / 2000, maxM2 = Math.max(viewM2 * 50, 2e12)
  const poly = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`
  const features: Feature[] = []
  let url: string | null = `${QMS_API}?intersects_extent=${encodeURIComponent(poly)}&cumulative_status=works&limit=100`
  for (let page = 0; url && page < 3 && features.length < 150; page++) {
    const res: Response = await fetch(url, { signal })
    if (!res.ok) throw new Error(`QMS ${res.status}`)
    const data = await res.json() as { next?: string | null; results?: QmsSearchResult[] }
    for (const r of data.results ?? []) {
      if (!QMS_SUPPORTED_TYPES.has(r.type)) continue
      const polys = parseQmsExtent(r.extent)
      if (!polys?.length) continue
      const xs = polys.flat(2).map((c) => c[0]), ys = polys.flat(2).map((c) => c[1])
      const a = areaM2(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
      if (a < minM2 || a > maxM2) continue
      const km2 = a / 1e6
      features.push({
        type: "Feature",
        geometry: polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys },
        properties: {
          overlay: `qms:${r.id}`, color: OVERLAY_COLORS.qms, hollow: true, noFill: true, lineWidth: 1, lineOpacity: 0.6,
          label: r.name, detail: `${r.type.toUpperCase()} · ${km2 >= 100 ? `${Math.round(km2).toLocaleString()} km²` : `${km2.toFixed(1)} km²`} · NextGIS QMS`,
          url: `https://qms.nextgis.com/geoservices/${r.id}/`, role: "basemap",
        },
      })
    }
    url = data.next ?? null
  }
  return { type: "FeatureCollection", features }
}

/** Coverage leaves drawn from a per-view query, refetched on moveend
 *  (CoverageOverlayLayer). */
export const VIEW_COVERAGE_LEAVES: Record<string, (bounds: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }, signal?: AbortSignal) => Promise<FeatureCollection>> = {
  allmapsAll: (b, sig) => loadAllmapsCoverage("allmapsAll", b, sig),
  allmapsRumsey: (b, sig) => loadAllmapsCoverage("allmapsRumsey", b, sig),
  qmsAll: (b, sig) => loadQmsCoverage(b, sig),
}

const ELI_ID_RE = /OSM Editor Layer Index id (\S+)/
type Bounded = { id: string; name: string; bounds?: number[]; type?: string; resolutionM?: number; maxzoom?: number; infoUrl?: string }
const TERRAIN_LIB = customSources.SAMPLE_TERRAIN_SOURCES as Bounded[]
const BASEMAP_LIB = customSources.SAMPLE_BASEMAPS_SOURCES as Bounded[]

export interface EliLike { id: string; name: string; category?: string; countryCodes: string[]; infoUrl?: string }

/** Allmaps (annotations.allmaps.org): one endpoint, /maps.geojson, returns
 *  the warped outline of every georeferenced map intersecting a bbox, at most
 *  200 per call, filterable by the IIIF image host (David Rumsey's maps are
 *  in there, imported from his Georeferencer data). The two Allmaps leaves
 *  are drawn from it for the current view (CoverageOverlayLayer refetches on
 *  moveend), not one entry per map. */
export const ALLMAPS_API = "https://annotations.allmaps.org"
export const ALLMAPS_VIEW_LEAVES: Record<string, { domain?: string }> = {
  allmapsAll: {},
  allmapsRumsey: { domain: "www.davidrumsey.com" },
}
export interface AllmapsLike { id: string; label: string; detail: string; annotationUrl: string; pageUrl: string; /** Metres per pixel, from the control points. */ gsd?: number; bounds?: [number, number, number, number]; /** The IIIF canvas or manifest label. */ title?: string; /** The IIIF manifest it comes from. */ manifest?: string; providerLabel?: string; /** A year in the title. */ year?: number }
const allmapsMetaCache = new Map<string, AllmapsLike>()
export function allmapsMeta(id: string): AllmapsLike | undefined { return allmapsMetaCache.get(id) }
const RUMSEY_IIIF_RE = /davidrumsey\.com\/luna\/servlet\/iiif\/([^/]+)/
function allmapsLikeOf(p: Record<string, any>): AllmapsLike {
  const id = String(p.id ?? "").split("/").pop() ?? ""
  // Metres per pixel from the control points; the API's _allmaps.scale
  // (pixels per metre) when they are not in the record.
  const gsd = Array.isArray(p.gcps) && p.gcps.length >= 2 ? gsdFromGcps(p.gcps) : (Number(p._allmaps?.scale) > 0 ? 1 / Number(p._allmaps.scale) : undefined)
  const provider = p.resource?.provider?.[0]
  const providerLabel: string | undefined = provider?.label ? (Object.values(provider.label as Record<string, string[]>)[0] ?? [])[0] : undefined
  const resourceId: string = p.resource?.id ?? ""
  const segs = resourceId.split("/").filter(Boolean)
  const last = decodeURIComponent(segs.pop() ?? id)
  // "f1", "default"... say nothing on their own: keep the segment before.
  const imageName = last.length <= 4 && segs.length ? `${decodeURIComponent(segs.pop()!)}/${last}` : last
  const label = providerLabel ? `${providerLabel} · ${imageName}` : imageName
  const areaKm2 = Number(p._allmaps?.area) / 1e6
  const area = Number.isFinite(areaKm2) ? (areaKm2 >= 100 ? `${Math.round(areaKm2).toLocaleString()} km²` : `${areaKm2.toFixed(1)} km²`) : ""
  const detail = [area, `georeferenced ${String(p.modified ?? p.created ?? "").slice(0, 10)}`].filter(Boolean).join(" · ")
  const annotationUrl = `${ALLMAPS_API}/maps/${id}`
  // The holding institution's own page when its pattern is known (David
  // Rumsey's LUNA detail page), otherwise the map in the Allmaps viewer.
  const rumsey = resourceId.match(RUMSEY_IIIF_RE)
  const pageUrl = rumsey ? `https://www.davidrumsey.com/luna/servlet/detail/${rumsey[1]}` : `https://viewer.allmaps.org/?url=${encodeURIComponent(annotationUrl)}`
  // The canvas and the manifest the image belongs to: a title, and where a date may be.
  const firstLabel = (l: any): string | undefined => (l && typeof l === "object" ? (Object.values(l as Record<string, string[]>)[0] ?? [])[0] : typeof l === "string" ? l : undefined)
  const canvas = p.resource?.partOf?.[0]
  const manifestEntry = canvas?.type === "Manifest" ? canvas : canvas?.partOf?.find?.((x: any) => x?.type === "Manifest")
  const title = firstLabel(canvas?.label) ?? firstLabel(manifestEntry?.label)
  const manifest: string | undefined = manifestEntry?.id
  const now = new Date().getUTCFullYear()
  const ym = title ? /\b(1[4-9]\d\d|20\d\d)\b/.exec(title) : null
  const year = ym && Number(ym[1]) <= now ? Number(ym[1]) : undefined
  return { id, label: title ? (providerLabel ? `${providerLabel} · ${title}` : title) : label, detail, annotationUrl, pageUrl, title, manifest, providerLabel, year, gsd }
}
/** Every map outline in the view, as coverage features. The area window
 *  keeps the 200 that matter at this scale: city plans when zoomed in,
 *  regional maps when zoomed out, and no world map tinting a street view.
 *  The upper bound never drops below 2,000 km²: zoomed into a street, the
 *  city plans (Paris is 105 km²) must stay. */
export async function loadAllmapsCoverage(leafId: string, bounds: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }, signal?: AbortSignal): Promise<FeatureCollection> {
  const w = Math.max(-180, bounds.getWest()), e = Math.min(180, bounds.getEast())
  const s = Math.max(-85, bounds.getSouth()), n = Math.min(85, bounds.getNorth())
  const midLat = ((s + n) / 2) * Math.PI / 180
  const viewM2 = Math.abs((e - w) * 111320 * Math.cos(midLat) * (n - s) * 110540)
  // Latitude first: the API reads the box as minLat,minLng,maxLat,maxLng (a
  // longitude-first box lands somewhere else entirely and returns only the
  // world maps that happen to cover both places).
  const q = new URLSearchParams({ intersects: [s, w, n, e].map((v) => v.toFixed(4)).join(","), limit: "200", minArea: String(Math.round(viewM2 / 500)), maxArea: String(Math.round(Math.max(viewM2 * 200, 2e9))) })
  const domain = ALLMAPS_VIEW_LEAVES[leafId]?.domain
  if (domain) q.set("imageServiceDomain", domain)
  const res = await fetch(`${ALLMAPS_API}/maps.geojson?${q}`, { signal })
  if (!res.ok) throw new Error(`Allmaps ${res.status}`)
  const fc = (await res.json()) as FeatureCollection
  const features: Feature[] = []
  for (const f of fc.features) {
    const meta = allmapsLikeOf((f.properties ?? {}) as Record<string, any>)
    if (!meta.id || !f.geometry) continue
    const pts: [number, number][] = []
    const walk = (c: any) => { if (typeof c[0] === "number") pts.push(c as [number, number]); else c.forEach(walk) }
    walk((f.geometry as any).coordinates)
    if (pts.length) meta.bounds = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))]
    allmapsMetaCache.set(meta.id, meta)
    features.push({ type: "Feature", geometry: f.geometry, properties: {
      // Outlines only: a city has hundreds of overlapping maps, and filled
      // they stacked into one opaque sheet hiding the map underneath.
      overlay: `allmaps:${meta.id}`, color: OVERLAY_COLORS.allmaps, hollow: true, noFill: true, lineWidth: 1, lineOpacity: 0.45,
      label: meta.label, detail: `${meta.detail} · Allmaps`, url: meta.pageUrl, role: "overlay",
    } })
  }
  return { type: "FeatureCollection", features }
}


export function coverageGroups(ctx: { terrains: CustomTerrainSource[]; basemaps: CustomBasemapSource[]; eliInView: EliLike[] }): CoverageGroup[] {
  const yourTerrain: CoverageLeaf[] = []
  const yourBasemaps: CoverageLeaf[] = []
  // Loaded library entries are listed here as well (they are the user's
  // sources now); the library groups keep listing them whether loaded or not.
  for (const t of ctx.terrains) if (t.bounds) yourTerrain.push({ id: `terrain:${t.id}`, label: t.name, color: OVERLAY_COLORS.yours, url: t.infoUrl, bounds: t.bounds })
  for (const b of ctx.basemaps) {
    if (b.transient) continue
    const eli = b.provider === "eli" && ELI_ID_RE.test(b.description ?? "")
    if (b.bounds || eli) yourBasemaps.push({ id: `basemap:${b.id}`, label: b.name, color: eli ? OVERLAY_COLORS.eli : OVERLAY_COLORS.yourBasemaps, url: b.infoUrl, bounds: b.bounds })
  }
  const groups: CoverageGroup[] = [
    { section: "Terrain", key: "mapterhorn", label: "Mapterhorn", color: OVERLAY_COLORS.mapterhorn, note: "Mapterhorn's own coverage tiles: which national source covers each area, hollow where it falls back to Copernicus GLO-30.",
      leaves: [{ id: "mapterhorn", label: "Mapterhorn coverage", color: OVERLAY_COLORS.mapterhorn, url: "https://mapterhorn.com/" }] },
    // One group, because they answer one question: "is there something better
    // than a global DEM here, and of what kind?" Three very different reads
    // underneath - Bing's own availability bitstream, Google's published
    // coverage layer decoded, and each FLAI survey's COPC octree - but a user
    // comparing them wants them on one switch, not three.
    { section: "Terrain", key: "sources3d", label: "3D and LiDAR coverage", color: OVERLAY_COLORS.bing3d,
      note: "Where somebody has photogrammetry, mesh or a point cloud, as opposed to a gridded DEM. Bing and Google are city-scale photorealistic 3D, Esri's are Integrated Mesh scene layers published one service per capture - a city, a district or a single drone flight - and FLAI is open airborne LiDAR. Only Esri publishes a list; the rest are read from the provider's own data.",
      leaves: [
        { id: "bing3d", label: "Bing Maps 3D", color: OVERLAY_COLORS.bing3d, detail: "photogrammetry mesh, ~2.4 km" },
        { id: "google3d", label: "Google photorealistic 3D", color: OVERLAY_COLORS.google3d, detail: "decoded from Google's layer" },
        { id: "esri3d", label: "Esri Integrated Mesh", color: OVERLAY_COLORS.esri3d, detail: "open I3S, \u2265 5 km\u00b2" },
        { id: "flai", label: "FLAI open LiDAR", color: OVERLAY_COLORS.flai, detail: "114 open COPC surveys" },
      ] },
    { section: "Terrain", key: "opentopo", parent: "sources3d", label: "OpenTopography", color: OVERLAY_COLORS.otRaster,
      note: "Datasets hosted on OpenTopography (opentopography.org): gridded DEMs, and the LiDAR point clouds many were made from. Global rasters (SRTM, GLO-30, ALOS...) are left out, continental ones drawn hollow. Click a footprint for the dataset page and its DOI.",
      leaves: [
        { id: "otRaster", label: "Rasters (DEMs)", color: OVERLAY_COLORS.otRaster, detail: "hosted, ~675 datasets" },
        { id: "otPointCloud", label: "Point clouds", color: OVERLAY_COLORS.otPointCloud, detail: "hosted LiDAR, 841 datasets" },
      ] },
    { section: "Terrain", key: "library", label: "Terrain library", color: OVERLAY_COLORS.library, note: "Declared bounds of every library dataset, loaded or not.",
      leaves: TERRAIN_LIB.filter((s) => s.bounds).map((s) => ({ id: `lib:${s.id}`, label: s.name, color: OVERLAY_COLORS.library, url: s.infoUrl, bounds: s.bounds as [number, number, number, number] })) },
    { section: "Terrain", key: "yourTerrain", label: "Your terrain sources", color: OVERLAY_COLORS.yours, note: "Every loaded terrain source that declares bounds, library entries included.", leaves: yourTerrain },
    { section: "Basemaps", key: "eli", label: "ELI coverage (footprints)", color: OVERLAY_COLORS.eli, note: "Layers whose index footprint touches the current view (worldwide layers have no footprint and are left out). The index's dated layers, NextGIS QMS and ArcGIS Online are the Community indexes of the historical tree.",
      leaves: ctx.eliInView.filter((l) => l.countryCodes.length > 0).map((l) => ({ id: `eli:${l.id}`, label: l.name, color: OVERLAY_COLORS.eli, detail: l.category, url: l.infoUrl })) },
    { section: "Basemaps", key: "qms", label: "NextGIS QMS", color: OVERLAY_COLORS.qms,
      note: "Services from NextGIS Quick Map Services whose declared extent touches the view (working TMS and WMS only), from the catalog's intersects query, sized to the zoom: tiny services are left out when zoomed out, continental and worldwide ones when zoomed in. Click an outline for its catalog page and to use it as the basemap.",
      leaves: [{ id: "qmsAll", label: "QMS services in view", color: OVERLAY_COLORS.qms, detail: "TMS and WMS, sized to the zoom", url: "https://qms.nextgis.com/" }] },
    { section: "Basemaps", key: "allmaps", label: "Old maps (Allmaps)", color: OVERLAY_COLORS.allmaps,
      note: "Georeferenced historical maps from the Allmaps annotations API: every map whose outline touches the view, up to 200, sized to the zoom. David Rumsey's collection is in there too. Click an outline for its page and to drape it as an overlay.",
      leaves: [
        { id: "allmapsAll", label: "All georeferenced maps", color: OVERLAY_COLORS.allmaps, detail: "every collection, per view", url: "https://allmaps.org/" },
        { id: "allmapsRumsey", label: "David Rumsey Map Collection", color: OVERLAY_COLORS.allmaps, detail: "its maps in Allmaps", url: "https://www.davidrumsey.com/" },
      ] },
    { section: "Basemaps", key: "yourBasemaps", label: "Your basemaps", color: OVERLAY_COLORS.yourBasemaps, note: "Every loaded basemap that declares bounds or came from the index, library entries included.", leaves: yourBasemaps },
    { section: "Basemaps", key: "basemapLibrary", label: "Basemap library", color: OVERLAY_COLORS.basemapLibrary,
      leaves: BASEMAP_LIB.filter((s) => s.bounds).map((s) => ({ id: `blib:${s.id}`, label: s.name, color: OVERLAY_COLORS.basemapLibrary, url: s.infoUrl, bounds: s.bounds as [number, number, number, number] })) },
  ]
  // "Your …" groups stay listed even when empty (the tree shows "None").
  // The ELI group stays listed empty: its leaves only load once it is opened.
  return groups.filter((g) => g.leaves.length > 0 || g.key.startsWith("your") || g.key === "eli")
}

/** The groups whose membership is fixed at build time, so a pure parser can
 *  fold them: these are the two that would otherwise bury a link, the terrain
 *  library being 45 footprints and 1.3 kB of ids on its own. Must stay in step
 *  with the leaf ids coverageGroups() builds for the same two groups. The
 *  other three groups (eli, yourTerrain, yourBasemaps) name sources that only
 *  exist in this session, so there is nothing stable to fold them into and
 *  their leaf ids are what a link has to carry; TerrainViewer's arrival effect
 *  still accepts their group keys on the way in, where the runtime list is
 *  known. */
const STATIC_GROUP_LEAVES: Record<string, string[]> = {
  library: TERRAIN_LIB.filter((s) => s.bounds).map((s) => `lib:${s.id}`),
  basemapLibrary: BASEMAP_LIB.filter((s) => s.bounds).map((s) => `blib:${s.id}`),
  // opentopo before sources3d, its parent: serialize folds in this order,
  // so a wholly selected parent wins over the child key inside it.
  opentopo: ["otRaster", "otPointCloud"],
  sources3d: ["bing3d", "google3d", "esri3d", "flai", "otRaster", "otPointCloud"],
}

/** Coverage overlays in the URL, folded to group keys wherever a group is
 *  wholly selected: ?coverageOverlays=mapterhorn,library rather than the 45
 *  lib: ids it stands for. Round-trips - ticking the Terrain library's own
 *  checkbox puts `library` in the link, unticking one entry spills the other
 *  44 out - so a hand-written link and one the app produced read the same. */
export const parseAsCoverageOverlays = createParser<string[]>({
  parse(value) {
    const out: string[] = []
    for (const token of value.split(",").map((t) => t.trim()).filter(Boolean)) {
      for (const id of STATIC_GROUP_LEAVES[token] ?? [token]) if (!out.includes(id)) out.push(id)
    }
    return out
  },
  serialize(ids) {
    const have = new Set(ids)
    // leaf id -> the group key standing in for it. A group key takes the
    // position of the group's first leaf rather than being hoisted to the
    // front, so parse(serialize(x)) is x itself and not a reordering of it -
    // otherwise nuqs's eq sees a change on every round trip through the URL.
    const folded = new Map<string, string>()
    for (const [key, leaves] of Object.entries(STATIC_GROUP_LEAVES)) {
      if (leaves.length && leaves.every((l) => have.has(l))) for (const l of leaves) folded.set(l, key)
    }
    const out: string[] = []
    for (const id of ids) {
      const key = folded.get(id)
      if (!key) out.push(id)
      else if (!out.includes(key)) out.push(key)
    }
    return out.join(",")
  },
  // Arrays are rebuilt on every parse, so nuqs's default identity check would
  // see every read as a change and loop against the mirror in
  // TerrainControlPanel.
  eq: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
}).withDefault([])

const rect = (b: number[]): Polygon => ({
  type: "Polygon",
  coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]],
})

const cache = new Map<string, Promise<FeatureCollection>>()

/** Ground sample distance in metres, for ordering (coverageGsd below is the
 *  label): declared resolution, else one pixel at the max zoom. */
export function coverageGsdMeters(p: { resolutionM?: number; maxzoom?: number; tileSize?: number }, lat: number): number | null {
  if (typeof p.resolutionM === "number") return p.resolutionM
  if (typeof p.maxzoom !== "number") return null
  return 40075016.686 * Math.cos((lat * Math.PI) / 180) / ((p.tileSize || 256) * 2 ** p.maxzoom)
}

/** "0.5 m" from a native grid, or the ground size of one pixel at the
 *  source's max zoom at this latitude ("z19 ≈ 30 cm/px") - the only GSD a
 *  tile service or an ELI entry can offer. */
export function coverageGsd(p: { resolutionM?: number; maxzoom?: number; tileSize?: number }, lat: number): string | null {
  if (typeof p.resolutionM === "number") return `${p.resolutionM} m`
  if (typeof p.maxzoom !== "number") return null
  const m = 40075016.686 * Math.cos((lat * Math.PI) / 180) / ((p.tileSize || 256) * 2 ** p.maxzoom)
  return `z${p.maxzoom} ≈ ${m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(m < 10 ? 1 : 0)} m`}/px`
}

/** Features for one overlay id (never "mapterhorn": that one is vector
 *  tiles); cached per session, keyed on the bounds so an edit refreshes. */
export function loadCoverageFeatures(id: string, ctx: { terrains: CustomTerrainSource[]; basemaps: CustomBasemapSource[] }): Promise<FeatureCollection> {
  const own = id.startsWith("terrain:") ? ctx.terrains.find((s) => `terrain:${s.id}` === id)?.bounds
    : id.startsWith("basemap:") ? ctx.basemaps.find((s) => `basemap:${s.id}` === id)?.bounds : null
  const key = `${id}:${JSON.stringify(own ?? null)}`
  let p = cache.get(key)
  if (!p) {
    p = build(id, ctx).catch((e) => { cache.delete(key); throw e })
    cache.set(key, p)
  }
  return p
}

const one = (id: string, geometry: Polygon, props: Record<string, unknown>): FeatureCollection =>
  ({ type: "FeatureCollection", features: [{ type: "Feature", geometry, properties: { overlay: id, hollow: false, ...props } }] })

async function eliFeatures(id: string, layerId: string, label: string, url: string): Promise<FeatureCollection | null> {
  try {
    const eli = await import("@osm-editor-kit/maplibre-editor-layer-index")
    const layer = eli.getLayer(layerId)
    if (!layer) return null
    const fc = await eli.loadCoverageFeatures([layer])
    const features: Feature[] = fc.features.map((f) => ({ ...f, properties: { ...f.properties,
      overlay: id, color: OVERLAY_COLORS.eli, hollow: false, opacity: 0.07, label, detail: "OSM Editor Layer Index footprint", url,
      maxzoom: layer.maxzoom, tileSize: layer.tileSize || 256,
      role: layer.overlay ? "overlay" : "basemap", needsKey: layer.requiresKeys.length > 0 } }))
    return features.length ? { type: "FeatureCollection", features } : null
  } catch { return null }
}

async function build(id: string, ctx: { terrains: CustomTerrainSource[]; basemaps: CustomBasemapSource[] }): Promise<FeatureCollection> {
  const empty: FeatureCollection = { type: "FeatureCollection", features: [] }
  const [kind, ...rest] = id.split(":")
  const key = rest.join(":")
  if (kind === "lib" || kind === "blib") {
    const s = (kind === "lib" ? TERRAIN_LIB : BASEMAP_LIB).find((x) => x.id === key)
    if (!s?.bounds) return empty
    return one(id, rect(s.bounds), { color: kind === "lib" ? OVERLAY_COLORS.library : OVERLAY_COLORS.basemapLibrary, label: s.name,
      detail: `${kind === "lib" ? "Terrain library" : "Basemap library"} (${s.type}) · declared bounds`, url: s.infoUrl ?? "",
      resolutionM: s.resolutionM, maxzoom: s.maxzoom })
  }
  // Every static coverage file is fetched with cache: "no-cache" - it costs
  // one conditional request per toggle, and it is what stopped a regenerated
  // file from showing last week's polygons until a hard reload.
  if (kind === "bing3d") {
    // A static file built by docs/scripts/build-bing-3d-coverage.mjs: 2 857
    // merged rectangles (0.5 MB) from 161 276 level-13 content tiles. Fetched
    // relative to BASE_URL so the /terrain-viewer/ subpath deploy finds it.
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/bing-3d.geojson`, { cache: "no-cache" })
      if (!res.ok) return empty
      const fc = (await res.json()) as FeatureCollection
      const features: Feature[] = fc.features.map((f) => ({ ...f, properties: { ...f.properties,
        overlay: id, color: OVERLAY_COLORS.bing3d, hollow: false, opacity: 0.12,
        label: "Bing Maps 3D", detail: "photogrammetry mesh (tf=3dv4) · from the tileset's subtree availability, level 13 · click to open Bing's own 3D view here",
        urlTemplate: "https://www.bing.com/maps?cp={lat}~{lng}&lvl={zoom}&style=3d&eh={eh}&pi={pitch}&dir={bearing}" } }))
      return { type: "FeatureCollection", features }
    } catch { return empty }
  }
  if (kind === "google3d") {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/google-3d.geojson`, { cache: "no-cache" })
      if (!res.ok) return empty
      const fc = (await res.json()) as FeatureCollection
      const features: Feature[] = fc.features.map((f) => ({ ...f, properties: { ...f.properties,
        overlay: id, color: OVERLAY_COLORS.google3d, hollow: false, opacity: 0.12,
        label: "Google 3D", detail: "photorealistic mesh · decoded from Google's own coverage layer, unioned across three zooms, ~500 m · click to open Google Earth here",
        urlTemplate: "https://earth.google.com/web/@{lat},{lng},0a,{gealt}d,35y,{bearing}h,{pitch}t,0r" } }))
      return { type: "FeatureCollection", features }
    } catch { return empty }
  }
  if (kind === "flai") {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/flai-open-lidar.geojson`, { cache: "no-cache" })
      if (!res.ok) return empty
      const fc = (await res.json()) as FeatureCollection
      const features: Feature[] = fc.features.map((f) => {
        const p = (f.properties ?? {}) as {
          name?: string; datasetId?: string; year?: string; endYear?: string
          density?: number; areaKm2?: number; approximate?: boolean; licence?: string
        }
        const years = p.year && p.endYear && p.endYear !== p.year ? `${p.year}–${p.endYear}` : p.year
        const bits = [
          years,
          p.density ? `${p.density} pts/m²` : null,
          p.areaKm2 ? `${p.areaKm2.toLocaleString()} km²` : null,
          p.approximate ? "bounding box only" : null,
        ].filter(Boolean).join(" · ")
        return { ...f, properties: { ...f.properties,
          overlay: id, color: OVERLAY_COLORS.flai, hollow: false, opacity: 0.15,
          label: p.name ?? "FLAI open LiDAR",
          detail: `open LiDAR point cloud (COPC)${bits ? ` · ${bits}` : ""} · click to open it in FLAI Hub here`,
          // hub.flai.ai reads its camera from ?c=<mercator x>,<mercator y>&z=,
          // so the deep link lands on the same view rather than the dataset's
          // default framing.
          urlTemplate: p.datasetId
            ? `https://hub.flai.ai/dataset/${p.datasetId}?c={mercX},{mercY}&z={zoom}`
            : "https://hub.flai.ai/" } }
      })
      return { type: "FeatureCollection", features }
    } catch { return empty }
  }
  // OpenTopography's hosted catalog (scripts/build-opentopo-coverage.mjs):
  // rasters are the gridded DEMs a BYOD entry could point at (many are the
  // library's own sources), point clouds the LiDAR they were made from.
  // The popup opens the dataset page, where the tiles and the DOI are.
  if (kind === "otRaster" || kind === "otPointCloud") {
    const raster = kind === "otRaster"
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/${raster ? "opentopo-raster" : "opentopo-pointcloud"}.geojson`, { cache: "no-cache" })
      if (!res.ok) return empty
      const fc = (await res.json()) as FeatureCollection
      // Footprint size decides the drawing: the global rasters (SRTM, GLO-30,
      // ALOS World 3D, GEBCO...) would tint the whole map and are dropped,
      // continental ones (a whole country's LiDAR) are outlined only, the
      // rest filled faintly. The DOI is the link - it lands on the dataset
      // page for rasters and point clouds alike, where the
      // datasetMetadata?otCollectionID= form only knows rasters.
      const span = (g: Feature["geometry"]): number => {
        let w = -Infinity, e = Infinity, sN = -Infinity, sS = Infinity
        const walk = (c: unknown) => {
          if (typeof (c as number[])[0] === "number") { const [x, y] = c as number[]; w = Math.max(w, x); e = Math.min(e, x); sN = Math.max(sN, y); sS = Math.min(sS, y) }
          else for (const k of c as unknown[]) walk(k)
        }
        walk((g as Polygon).coordinates)
        return Math.max(w - e, sN - sS)
      }
      const features: Feature[] = fc.features.flatMap((f) => {
        const p = (f.properties ?? {}) as { name?: string; otId?: string; short?: string; doi?: string; created?: string; temporal?: string; keywords?: string }
        const extent = span(f.geometry)
        if (raster && extent >= 300) return []
        const continental = extent > 25
        const bits = [p.temporal ?? p.created, p.keywords].filter(Boolean).join(" · ")
        return [{ ...f, properties: { ...f.properties,
          overlay: id, color: raster ? OVERLAY_COLORS.otRaster : OVERLAY_COLORS.otPointCloud, hollow: !raster || continental, opacity: raster ? 0.08 : 0.35,
          label: p.name ?? (raster ? "OpenTopography raster" : "OpenTopography point cloud"),
          detail: `${raster ? "hosted DEM" : "hosted point cloud"}${p.short ? ` (${p.short})` : ""}${bits ? ` · ${bits}` : ""} · click to open the dataset on OpenTopography`,
          url: p.doi ?? (p.otId ? `https://portal.opentopography.org/datasetMetadata?otCollectionID=${p.otId}` : "https://portal.opentopography.org/dataCatalog") } }]
      })
      return { type: "FeatureCollection", features }
    } catch { return empty }
  }
  if (kind === "esri3d") {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/esri-3d.geojson`, { cache: "no-cache" })
      if (!res.ok) return empty
      const fc = (await res.json()) as FeatureCollection
      const features: Feature[] = fc.features.map((f) => {
        const p = (f.properties ?? {}) as { name?: string; owner?: string; modified?: string; id?: string; service?: string }
        return { ...f, properties: { ...f.properties,
          overlay: id, color: OVERLAY_COLORS.esri3d, hollow: true, opacity: 0.4,
          label: p.name ?? "Esri Integrated Mesh",
          detail: `photogrammetric mesh (I3S)${p.owner ? ` \u00b7 ${p.owner}` : ""}${p.modified ? ` \u00b7 ${p.modified}` : ""} \u00b7 not renderable here, click to open it in Esri's Scene Viewer`,
          // ?url=<service> opens that ONE service in a scene of its own -
          // documented, and the reason to prefer it over the item page or
          // over ?layers=<itemid>: the scene then holds the mesh and nothing
          // else, so Esri's own 3D Buildings basemap layer is not there to
          // z-fight with the photogrammetry. Scene Viewer has no URL
          // parameter that would switch that layer off had it been present.
          // viewpoint=cam: is the CAMERA position and an absolute height -
          // {esriX}/{esriY}/{esriZ} back it off from the clicked point along
          // the reverse heading (see esriCamera in CoverageOverlayLayer.tsx).
          urlTemplate: p.service
            ? `https://www.arcgis.com/home/webscene/viewer.html?url=${encodeURIComponent(p.service)}&viewpoint=cam:{esriX},{esriY},{esriZ};{bearing},{pitch}`
            : p.id
              ? `https://www.arcgis.com/home/item.html?id=${p.id}`
              : "https://www.arcgis.com/" } }
      })
      return { type: "FeatureCollection", features }
    } catch { return empty }
  }
  if (kind === "eli") {
    const eli = await import("@osm-editor-kit/maplibre-editor-layer-index")
    const layer = eli.getLayer(key)
    return (layer && await eliFeatures(id, key, layer.name, "https://osm-editor-kit.github.io/maplibre-editor-layer-index/")) ?? empty
  }
  if (kind === "terrain") {
    const t = ctx.terrains.find((s) => s.id === key)
    if (!t?.bounds) return empty
    return one(id, rect(t.bounds), { color: OVERLAY_COLORS.yours, label: t.name,
      detail: `Terrain source (${t.type}) · declared bounds`, url: t.infoUrl ?? "", resolutionM: t.resolutionM, maxzoom: t.maxzoom })
  }
  if (kind === "basemap") {
    const b = ctx.basemaps.find((s) => s.id === key)
    if (!b) return empty
    const eliId = b.provider === "eli" ? ELI_ID_RE.exec(b.description ?? "")?.[1] : undefined
    if (eliId) {
      const fc = await eliFeatures(id, eliId, b.name, b.infoUrl ?? "")
      if (fc) return fc
    }
    if (!b.bounds) return empty
    return one(id, rect(b.bounds), { color: OVERLAY_COLORS.yourBasemaps, label: b.name, detail: `${b.role === "overlay" ? "Overlay" : "Basemap"} (${b.type}) · declared bounds`, url: b.infoUrl ?? "", maxzoom: b.maxzoom, role: b.role ?? "basemap" })
  }
  return empty
}
