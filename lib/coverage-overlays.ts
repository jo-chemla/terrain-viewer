import { atom } from "jotai"
import { createParser } from "nuqs"
import type { FeatureCollection, Feature, Polygon } from "geojson"
import customSources from "./custom-sources.json"
import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"

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

export interface CoverageLeaf { id: string; label: string; color: string; detail?: string }
export interface CoverageGroup { key: string; label: string; color: string; leaves: CoverageLeaf[]; note?: string; section: "Terrain" | "Basemaps" }

export const OVERLAY_COLORS = { mapterhorn: "#8b5cf6", library: "#10b981", basemapLibrary: "#f59e0b", eli: "#0ea5e9", yours: "#ec4899", yourBasemaps: "#ef4444", bing3d: "#6366f1", google3d: "#f43f5e", flai: "#14b8a6", esri3d: "#a855f7" }

const ELI_ID_RE = /OSM Editor Layer Index id (\S+)/
type Bounded = { id: string; name: string; bounds?: number[]; type?: string; resolutionM?: number; maxzoom?: number; infoUrl?: string }
const TERRAIN_LIB = customSources.SAMPLE_TERRAIN_SOURCES as Bounded[]
const BASEMAP_LIB = customSources.SAMPLE_BASEMAPS_SOURCES as Bounded[]

export interface EliLike { id: string; name: string; category?: string; countryCodes: string[] }

export function coverageGroups(ctx: { terrains: CustomTerrainSource[]; basemaps: CustomBasemapSource[]; eliInView: EliLike[] }): CoverageGroup[] {
  const yourTerrain: CoverageLeaf[] = []
  const yourBasemaps: CoverageLeaf[] = []
  // Loaded library entries are listed here as well (they are the user's
  // sources now); the library groups keep listing them whether loaded or not.
  for (const t of ctx.terrains) if (t.bounds) yourTerrain.push({ id: `terrain:${t.id}`, label: t.name, color: OVERLAY_COLORS.yours })
  for (const b of ctx.basemaps) {
    const eli = b.provider === "eli" && ELI_ID_RE.test(b.description ?? "")
    if (b.bounds || eli) yourBasemaps.push({ id: `basemap:${b.id}`, label: b.name, color: eli ? OVERLAY_COLORS.eli : OVERLAY_COLORS.yourBasemaps })
  }
  const groups: CoverageGroup[] = [
    { section: "Terrain", key: "mapterhorn", label: "Mapterhorn", color: OVERLAY_COLORS.mapterhorn, note: "Mapterhorn's own coverage tiles: which national source covers each area, hollow where it falls back to Copernicus GLO-30.",
      leaves: [{ id: "mapterhorn", label: "Mapterhorn coverage", color: OVERLAY_COLORS.mapterhorn }] },
    { section: "Terrain", key: "library", label: "Terrain library", color: OVERLAY_COLORS.library, note: "Declared bounds of every library dataset, loaded or not.",
      leaves: TERRAIN_LIB.filter((s) => s.bounds).map((s) => ({ id: `lib:${s.id}`, label: s.name, color: OVERLAY_COLORS.library })) },
    { section: "Terrain", key: "yourTerrain", label: "Your terrain sources", color: OVERLAY_COLORS.yours, note: "Every loaded terrain source that declares bounds, library entries included.", leaves: yourTerrain },
    // One group, because they answer one question: "is there something better
    // than a global DEM here, and of what kind?" Three very different reads
    // underneath - Bing's own availability bitstream, Google's published
    // coverage layer decoded, and each FLAI survey's COPC octree - but a user
    // comparing them wants them on one switch, not three.
    { section: "Terrain", key: "sources3d", label: "3D and LiDAR coverage", color: OVERLAY_COLORS.bing3d,
      note: "Where somebody has photogrammetry, mesh or a point cloud, as opposed to a gridded DEM. Bing and Google are city-scale photorealistic 3D, Esri's are Integrated Mesh scene layers published one service per city, and FLAI is open airborne LiDAR. Only Esri publishes a list; the rest are read from the provider's own data.",
      leaves: [
        { id: "bing3d", label: "Bing Maps 3D", color: OVERLAY_COLORS.bing3d, detail: "photogrammetry mesh, ~2.4 km" },
        { id: "google3d", label: "Google photorealistic 3D", color: OVERLAY_COLORS.google3d, detail: "decoded from Google's own coverage layer" },
        { id: "flai", label: "FLAI open LiDAR", color: OVERLAY_COLORS.flai, detail: "114 open COPC surveys" },
        { id: "esri3d", label: "Esri Integrated Mesh", color: OVERLAY_COLORS.esri3d, detail: "city photogrammetry published as I3S" },
      ] },
    { section: "Basemaps", key: "eli", label: "OSM Editor Layer Index", color: OVERLAY_COLORS.eli, note: "Layers whose index footprint touches the current view (worldwide layers have no footprint and are left out).",
      leaves: ctx.eliInView.filter((l) => l.countryCodes.length > 0).map((l) => ({ id: `eli:${l.id}`, label: l.name, color: OVERLAY_COLORS.eli, detail: l.category })) },
    { section: "Basemaps", key: "yourBasemaps", label: "Your basemaps", color: OVERLAY_COLORS.yourBasemaps, note: "Every loaded basemap that declares bounds or came from the index, library entries included.", leaves: yourBasemaps },
    { section: "Basemaps", key: "basemapLibrary", label: "Basemap library", color: OVERLAY_COLORS.basemapLibrary,
      leaves: BASEMAP_LIB.filter((s) => s.bounds).map((s) => ({ id: `blib:${s.id}`, label: s.name, color: OVERLAY_COLORS.basemapLibrary })) },
  ]
  // "Your …" groups stay listed even when empty (the tree shows "None").
  return groups.filter((g) => g.leaves.length > 0 || g.key.startsWith("your"))
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
  sources3d: ["bing3d", "google3d", "flai", "esri3d"],
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
  if (kind === "bing3d") {
    // A static file built by docs/scripts/build-bing-3d-coverage.mjs: 2 857
    // merged rectangles (0.5 MB) from 161 276 level-13 content tiles. Fetched
    // relative to BASE_URL so the /terrain-viewer/ subpath deploy finds it.
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/bing-3d.geojson`)
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
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/google-3d.geojson`)
      if (!res.ok) return empty
      const fc = (await res.json()) as FeatureCollection
      const features: Feature[] = fc.features.map((f) => ({ ...f, properties: { ...f.properties,
        overlay: id, color: OVERLAY_COLORS.google3d, hollow: false, opacity: 0.12,
        label: "Google 3D", detail: "photorealistic mesh · from Google Earth's own coverage layer, ~39 km cells · click to open Google Earth here",
        urlTemplate: "https://earth.google.com/web/@{lat},{lng},0a,{gealt}d,35y,{bearing}h,{pitch}t,0r" } }))
      return { type: "FeatureCollection", features }
    } catch { return empty }
  }
  if (kind === "flai") {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/flai-open-lidar.geojson`)
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
  if (kind === "esri3d") {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}coverage/esri-3d.geojson`)
      if (!res.ok) return empty
      const fc = (await res.json()) as FeatureCollection
      const features: Feature[] = fc.features.map((f) => {
        const p = (f.properties ?? {}) as { name?: string; owner?: string; modified?: string; url?: string }
        return { ...f, properties: { ...f.properties,
          overlay: id, color: OVERLAY_COLORS.esri3d, hollow: true, opacity: 0.4,
          label: p.name ?? "Esri Integrated Mesh",
          detail: `photogrammetric mesh (I3S)${p.owner ? ` \u00b7 ${p.owner}` : ""}${p.modified ? ` \u00b7 ${p.modified}` : ""} \u00b7 not renderable here, click for the item page`,
          url: p.url ?? "https://www.arcgis.com/" } }
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
