import { atom } from "jotai"
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
 * The selection is session-only (not persisted, not in the URL). GeoJSON
 * feature properties are flat so the map layer can read them: overlay, label,
 * detail, color, hollow, url.
 */
export const coverageOverlaysAtom = atom<string[]>([])

export const MAPTERHORN_COVERAGE_TILES = "https://single-archive-tiles.mapterhorn.com/coverage/{z}/{x}/{y}.mvt"
export const MAPTERHORN_COVERAGE_LAYER = "coverage"

export interface MapterhornSourceMeta { source: string; name: string; producer: string; resolution: number; website?: string }
let mapterhornMeta: Promise<Record<string, MapterhornSourceMeta>> | null = null
/** Mapterhorn's source catalogue (download.mapterhorn.com/attribution.json):
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

export const OVERLAY_COLORS = { mapterhorn: "#8b5cf6", library: "#10b981", basemapLibrary: "#f59e0b", eli: "#0ea5e9", yours: "#ec4899" }

const ELI_ID_RE = /OSM Editor Layer Index id (\S+)/
type Bounded = { id: string; name: string; bounds?: number[]; type?: string; resolutionM?: number; maxzoom?: number; infoUrl?: string }
const TERRAIN_LIB = customSources.SAMPLE_TERRAIN_SOURCES as Bounded[]
const BASEMAP_LIB = customSources.SAMPLE_BASEMAPS_SOURCES as Bounded[]

export interface EliLike { id: string; name: string; category?: string; countryCodes: string[] }

export function coverageGroups(ctx: { terrains: CustomTerrainSource[]; basemaps: CustomBasemapSource[]; eliInView: EliLike[] }): CoverageGroup[] {
  const libIds = new Set([...TERRAIN_LIB, ...BASEMAP_LIB].map((s) => s.id))
  const yourTerrain: CoverageLeaf[] = []
  const yourBasemaps: CoverageLeaf[] = []
  for (const t of ctx.terrains) if (t.bounds && !libIds.has(t.id)) yourTerrain.push({ id: `terrain:${t.id}`, label: t.name, color: OVERLAY_COLORS.yours })
  for (const b of ctx.basemaps) {
    if (libIds.has(b.id)) continue
    const eli = b.provider === "eli" && ELI_ID_RE.test(b.description ?? "")
    if (b.bounds || eli) yourBasemaps.push({ id: `basemap:${b.id}`, label: b.name, color: eli ? OVERLAY_COLORS.eli : OVERLAY_COLORS.yours })
  }
  const groups: CoverageGroup[] = [
    { section: "Terrain", key: "mapterhorn", label: "Mapterhorn", color: OVERLAY_COLORS.mapterhorn, note: "Mapterhorn's own coverage tiles: which national source covers each area, hollow where it falls back to Copernicus GLO-30.",
      leaves: [{ id: "mapterhorn", label: "Mapterhorn coverage", color: OVERLAY_COLORS.mapterhorn }] },
    { section: "Terrain", key: "library", label: "Terrain library", color: OVERLAY_COLORS.library, note: "Declared bounds of every library dataset, loaded or not.",
      leaves: TERRAIN_LIB.filter((s) => s.bounds).map((s) => ({ id: `lib:${s.id}`, label: s.name, color: OVERLAY_COLORS.library })) },
    { section: "Terrain", key: "yourTerrain", label: "Your terrain sources", color: OVERLAY_COLORS.yours, note: "Loaded custom terrain sources that declare bounds and are not library entries.", leaves: yourTerrain },
    { section: "Basemaps", key: "eli", label: "OSM Editor Layer Index", color: OVERLAY_COLORS.eli, note: "Layers whose index footprint touches the current view (worldwide layers have no footprint and are left out).",
      leaves: ctx.eliInView.filter((l) => l.countryCodes.length > 0).map((l) => ({ id: `eli:${l.id}`, label: l.name, color: OVERLAY_COLORS.eli, detail: l.category })) },
    { section: "Basemaps", key: "yourBasemaps", label: "Your basemaps", color: OVERLAY_COLORS.yours, note: "Loaded custom basemaps that declare bounds (or came from the index) and are not library entries.", leaves: yourBasemaps },
    { section: "Basemaps", key: "basemapLibrary", label: "Basemap library", color: OVERLAY_COLORS.basemapLibrary,
      leaves: BASEMAP_LIB.filter((s) => s.bounds).map((s) => ({ id: `blib:${s.id}`, label: s.name, color: OVERLAY_COLORS.basemapLibrary })) },
  ]
  // "Your …" groups stay listed even when empty (the tree shows "None").
  return groups.filter((g) => g.leaves.length > 0 || g.key.startsWith("your"))
}

const rect = (b: number[]): Polygon => ({
  type: "Polygon",
  coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]],
})

const cache = new Map<string, Promise<FeatureCollection>>()

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
      maxzoom: layer.maxzoom, tileSize: layer.tileSize || 256 } }))
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
    return one(id, rect(b.bounds), { color: OVERLAY_COLORS.yours, label: b.name, detail: `Basemap (${b.type}) · declared bounds`, url: b.infoUrl ?? "", maxzoom: b.maxzoom })
  }
  return empty
}
