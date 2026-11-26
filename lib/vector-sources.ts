// Vector overlays: the Library's vector sources (SAMPLE_VECTOR_SOURCES of
// lib/custom-sources.json, open building footprints first), their one lookup
// by id, the resolver of an address that rotates (Overture), and the MapLibre
// source and layers a source is drawn with. The renderer is
// components/LayersAndSources/VectorOverlayLayers.tsx; the sidebar list is
// components/TerrainControlPanel/vector-overlays-section.tsx.
//
// No MapLibre import and no DOM: the specs are plain objects, so the tests
// run under Node (node scripts/test-lib.mjs lib/vector-sources.test.ts) and
// the tile service can read the same entries later.
import customSources from "./custom-sources.json"
import type { VectorSourceEntry } from "./source-schema"

/** The Library's vector sources, in list order. */
export const VECTOR_LIBRARY: readonly VectorSourceEntry[] = ((customSources as unknown as { SAMPLE_VECTOR_SOURCES?: VectorSourceEntry[] }).SAMPLE_VECTOR_SOURCES ?? [])
  .map((s) => ({ ...s, kind: "vector" as const, section: s.section ?? ("library" as const) }))

const BY_ID = new Map(VECTOR_LIBRARY.map((s) => [s.id, s]))

/** The entry of a vector source id: the user's own, else the Library's. */
export function findVectorSource(id: string | null | undefined, customs: readonly VectorSourceEntry[] = []): VectorSourceEntry | undefined {
  if (!id) return undefined
  return customs.find((s) => s.id === id) ?? BY_ID.get(id)
}

/** The Library's entries followed by the user's own that do not shadow one. */
export function allVectorSources(customs: readonly VectorSourceEntry[] = []): VectorSourceEntry[] {
  return [...VECTOR_LIBRARY, ...customs.filter((s) => !BY_ID.has(s.id))]
}

// ── Style ───────────────────────────────────────────────────────────────────

/** How one vector overlay is drawn; kept per source id in the browser
 *  (vectorOverlayStylesAtom), not in a link. */
export interface VectorOverlayStyle {
  /** "flat": footprints draped on the terrain; "3d": extruded by height. */
  mode: "flat" | "3d"
  colorBy: "single" | "source" | "height"
  /** The single color (hex). */
  color: string
  /** 0..1 */
  opacity: number
  /** Footprint outlines (a line layer). */
  outline: boolean
}

export const VECTOR_STYLE_DEFAULT: VectorOverlayStyle = { mode: "flat", colorBy: "single", color: "#f97316", opacity: 0.7, outline: true }

/** What every vector overlay shares (vectorOverlaySharedAtom): flat or 3D,
 *  and what colors them. "auto" is each source's own best (its categories,
 *  else one color). A source that cannot honor the shared choice (no height,
 *  no category) falls back, as vectorStyleOf does for its own. */
export interface VectorSharedStyle {
  mode: "flat" | "3d"
  colorBy: "auto" | "single" | "source" | "height"
}
export const VECTOR_SHARED_DEFAULT: VectorSharedStyle = { mode: "flat", colorBy: "auto" }

/** Whether the entry has categories to color by (its `categories`, or the
 *  older `sourceField` with `sourceColors`). */
export function hasCategories(entry: VectorSourceEntry): boolean {
  return !!entry.categories?.length || !!entry.sourceField
}

/** An entry's style: the defaults, the entry's own color, the user's choices
 *  for this source, then the shared choices (flat or 3D, color by), with the
 *  choices the entry cannot honor put back (3D or color by height without a
 *  height, color by category without one). */
export function vectorStyleOf(entry: VectorSourceEntry, saved?: Partial<VectorOverlayStyle>, shared?: Partial<VectorSharedStyle>): VectorOverlayStyle {
  const own = hasCategories(entry) ? ("source" as const) : ("single" as const)
  const style = { ...VECTOR_STYLE_DEFAULT, ...(entry.color ? { color: entry.color } : {}), colorBy: own, ...saved }
  if (shared?.mode) style.mode = shared.mode
  if (shared?.colorBy) style.colorBy = shared.colorBy === "auto" ? own : shared.colorBy
  if (!entry.heightField) {
    style.mode = "flat"
    if (style.colorBy === "height") style.colorBy = own
  }
  if (!hasCategories(entry) && style.colorBy === "source") style.colorBy = "single"
  style.opacity = Math.max(0, Math.min(1, Number.isFinite(style.opacity) ? style.opacity : VECTOR_STYLE_DEFAULT.opacity))
  return style
}

/** The entry and its companions as entries of their own (one MapLibre
 *  source each), ids suffixed: what the renderer mounts. */
export function vectorParts(entry: VectorSourceEntry): VectorSourceEntry[] {
  const { companions, ...main } = entry
  return [main, ...(companions ?? []).map((c, i) => ({ ...main, resolver: undefined, ...c, id: `${entry.id}--${i + 1}` }))]
}

// ── Address ─────────────────────────────────────────────────────────────────

export const OVERTURE_CATALOG = "https://stac.overturemaps.org/catalog.json"
let overtureRelease: Promise<string | null> | null = null

/** Overture's current release id ("2026-11-18.0"), asked once per session;
 *  null when the catalog does not answer (the next call asks again). */
export function latestOvertureRelease(fetcher: typeof fetch = fetch): Promise<string | null> {
  return (overtureRelease ??= fetcher(OVERTURE_CATALOG)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { latest?: unknown } | null) => (typeof j?.latest === "string" && /^[\w.-]+$/.test(j.latest) ? j.latest : null))
    .catch(() => null)
    .then((release) => { if (!release) overtureRelease = null; return release }))
}

/** For tests: forget the release asked earlier. */
export function resetVectorResolvers() { overtureRelease = null }

/** Whether the address is known without a request. */
export function needsResolving(entry: VectorSourceEntry): boolean {
  return !!entry.resolver && entry.url.includes("{release}")
}

/** The entry's address with its `{release}` filled: the resolver's answer,
 *  else the entry's fallback release; null when neither is known. */
export async function resolveVectorUrl(entry: VectorSourceEntry, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!needsResolving(entry)) return entry.url
  const release = (entry.resolver === "overture" ? await latestOvertureRelease(fetcher) : null) ?? entry.fallbackRelease ?? null
  return release ? entry.url.split("{release}").join(release) : null
}

// ── MapLibre source and layers ──────────────────────────────────────────────

/** Under this zoom the footprints are not drawn: the archives thin them out
 *  there and a tile still weighs hundreds of kilobytes. */
export const VECTOR_FOOTPRINT_MINZOOM = 11

export type VectorSourceSpec = { type: "vector" | "geojson"; tiles?: string[]; url?: string; data?: string; minzoom?: number; maxzoom?: number; bounds?: [number, number, number, number]; attribution?: string }

/** The MapLibre source of an entry at its resolved address. A PMTiles
 *  archive is read through the app's `pmtiles://` protocol, as a tile
 *  template: the zoom range comes from the entry, not from a second request. */
export function vectorSourceSpec(entry: VectorSourceEntry, url: string): VectorSourceSpec {
  const common = { minzoom: entry.minzoom, maxzoom: entry.maxzoom, bounds: entry.bounds, attribution: entry.shortAttribution ?? entry.attribution }
  const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
  if (entry.type === "geojson") return clean({ type: "geojson" as const, data: url, attribution: common.attribution })
  if (entry.type === "tilejson") return clean({ type: "vector" as const, url, attribution: common.attribution })
  const tiles = entry.type === "pmtiles" ? [`pmtiles://${url.replace(/^pmtiles:\/\//, "")}/{z}/{x}/{y}`] : [url]
  return clean({ type: "vector" as const, tiles, ...common })
}

/** Height ramp, metres to color (a house to a tower). */
export const HEIGHT_RAMP: readonly [number, string][] = [[0, "#fde725"], [6, "#90d743"], [12, "#35b779"], [25, "#21918c"], [50, "#31688e"], [100, "#443983"], [200, "#440154"]]
/** Feature without a height, in color by height. */
export const NO_HEIGHT_COLOR = "#9ca3af"
/** Metres per floor, and the height of a feature that states neither. */
export const FLOOR_M = 3.2
export const DEFAULT_HEIGHT_M = 4

type Expr = unknown[]
const num = (field: string): Expr => ["to-number", ["get", field], -1]

/** The feature's height in metres as an expression: its height, else its
 *  floors, else `fallback`. */
export function heightExpression(entry: VectorSourceEntry, fallback: number = DEFAULT_HEIGHT_M): Expr | number {
  if (!entry.heightField) return fallback
  const byFloors: Expr | number = entry.floorsField
    ? ["case", [">", num(entry.floorsField), 0], ["*", num(entry.floorsField), FLOOR_M], fallback]
    : fallback
  return ["case", [">", num(entry.heightField), 0], num(entry.heightField), byFloors]
}

/** A decoded property as `["to-number", value, -1]` reads it: a number, a
 *  numeric string, 0 for a missing one, -1 for what is not a number. */
export function propertyNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : -1
  if (value === null || value === undefined || value === false || value === "") return 0
  if (value === true) return 1
  const n = Number(value)
  return Number.isFinite(n) ? n : -1
}

/** heightExpression on a decoded feature's properties (the building
 *  shadows' tile reader, lib/building-tiles.ts): its height, else its floors
 *  times FLOOR_M, else `fallback`. Keep the two in step. */
export function featureHeight(entry: VectorSourceEntry, properties: Record<string, unknown>, fallback: number = DEFAULT_HEIGHT_M): number {
  if (!entry.heightField) return fallback
  const h = propertyNumber(properties[entry.heightField])
  if (h > 0) return h
  if (entry.floorsField) {
    const floors = propertyNumber(properties[entry.floorsField])
    if (floors > 0) return floors * FLOOR_M
  }
  return fallback
}

/** The color of a feature by its category, as a MapLibre value: the first
 *  matching category of `categories`, else the `sourceField` match, else
 *  the single color. */
export function categoryExpression(entry: VectorSourceEntry, fallback: string): Expr | string {
  if (entry.categories?.length) {
    const cases: unknown[] = []
    for (const c of entry.categories) {
      const text: Expr = ["to-string", ["get", c.field]]
      const test: Expr = c.value === undefined ? ["!=", text, ""] : Array.isArray(c.value) ? ["in", text, ["literal", c.value]] : ["==", text, c.value]
      cases.push(test, c.color)
    }
    return ["case", ...cases, fallback]
  }
  if (entry.sourceField) {
    const pairs = Object.entries(entry.sourceColors ?? {}).flat()
    return pairs.length ? ["match", ["to-string", ["get", entry.sourceField]], ...pairs, fallback] : fallback
  }
  return fallback
}

/** The fill color of a style as a MapLibre value. */
export function colorExpression(entry: VectorSourceEntry, style: VectorOverlayStyle): Expr | string {
  if (style.colorBy === "source" && hasCategories(entry)) return categoryExpression(entry, style.color)
  if (style.colorBy === "height" && entry.heightField) {
    const h = heightExpression(entry, -1)
    return ["case", ["<", h, 0], NO_HEIGHT_COLOR, ["interpolate", ["linear"], h, ...HEIGHT_RAMP.flat()]]
  }
  return style.color
}

export type VectorLayerSpec = {
  id: string
  type: "fill" | "line" | "fill-extrusion" | "circle"
  /** Absent for a GeoJSON source, which has no layers. */
  "source-layer"?: string
  minzoom: number
  filter?: Expr
  layout?: Record<string, unknown>
  paint: Record<string, unknown>
}

/** A darker shade of a hex color, for the outlines of a single color. */
export function darken(hex: string, by = 0.45): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return "#333333"
  return "#" + m.slice(1).map((c) => Math.round(parseInt(c, 16) * (1 - by)).toString(16).padStart(2, "0")).join("")
}

/** The layers an entry is drawn with, bottom first; ids start with
 *  `prefix`. Flat: a fill and, with outlines, a line per source layer, both
 *  draped by MapLibre when terrain is on. 3D: an extrusion per source layer
 *  (and per part layer, the buildings that have parts left out), with the
 *  outline under it as the footprint on the ground. Polygons only: a point
 *  or a line in the same layer is not drawn. */
export function vectorLayerSpecs(entry: VectorSourceEntry, style: VectorOverlayStyle, prefix: string): VectorLayerSpec[] {
  if (entry.type === "style") return []
  const out: VectorLayerSpec[] = []
  const polygon: Expr = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false]
  const color = colorExpression(entry, style)
  // A darker shade of the one color; over a color per feature, a dark line
  // (a shade of each cannot be computed in an expression).
  const lineColor = style.colorBy === "single" ? darken(style.color) : "rgba(0,0,0,0.45)"
  // The Library's footprints wait for zoom 11; a source of your own draws
  // from its own first zoom.
  const footprints = entry.section !== "custom" && entry.libraryGroup === "buildings"
  const minzoom = footprints ? Math.max(VECTOR_FOOTPRINT_MINZOOM, entry.minzoom ?? 0) : (entry.minzoom ?? 0)
  const threeD = style.mode === "3d" && !!entry.heightField
  const geometries = new Set(entry.geometries ?? ["polygon"])
  const lineOpacity = Math.min(1, style.opacity + 0.25)
  // A GeoJSON source has no layers: one nameless one, with no source-layer.
  const sourceLayers = entry.type === "geojson" ? ["data"] : (entry.sourceLayers ?? [])
  const sl = (layer: string) => (entry.type === "geojson" ? {} : { "source-layer": layer })
  for (const layer of sourceLayers) {
    if (geometries.has("polygon")) {
      if (!threeD) {
        out.push({ id: `${prefix}-${layer}-fill`, type: "fill", ...sl(layer), minzoom, filter: polygon,
          paint: { "fill-color": color, "fill-opacity": style.opacity, "fill-antialias": !style.outline } })
      }
      if (style.outline) {
        out.push({ id: `${prefix}-${layer}-line`, type: "line", ...sl(layer), minzoom, filter: polygon, layout: { "line-join": "round" },
          paint: { "line-color": lineColor, "line-opacity": lineOpacity, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 16, 1.2] } })
      }
    }
    // Lines and points of a source of your own, in the fill color.
    if (geometries.has("line")) {
      out.push({ id: `${prefix}-${layer}-path`, type: "line", ...sl(layer), minzoom, filter: ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": color, "line-opacity": lineOpacity, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 16, 2.2] } })
    }
    if (geometries.has("point")) {
      out.push({ id: `${prefix}-${layer}-point`, type: "circle", ...sl(layer), minzoom, filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
        paint: { "circle-color": color, "circle-opacity": lineOpacity, "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.6, 9, 3, 16, 6], "circle-stroke-color": "rgba(255,255,255,0.85)", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0, 10, 0.8] } })
    }
  }
  if (threeD) {
    const extrusion = (layer: string, filter: Expr): VectorLayerSpec => ({
      id: `${prefix}-${layer}-3d`, type: "fill-extrusion", ...sl(layer), minzoom: footprints ? Math.max(minzoom, 13) : minzoom, filter,
      paint: {
        "fill-extrusion-color": color, "fill-extrusion-opacity": style.opacity,
        "fill-extrusion-height": heightExpression(entry),
        "fill-extrusion-base": entry.minHeightField ? ["max", 0, ["to-number", ["get", entry.minHeightField], 0]] : 0,
      },
    })
    const whole: Expr = entry.partLayers?.length && entry.hasPartsField ? ["all", polygon, ["!=", ["get", entry.hasPartsField], true]] : polygon
    for (const layer of sourceLayers) out.push(extrusion(layer, whole))
    for (const layer of entry.partLayers ?? []) out.push(extrusion(layer, polygon))
  }
  return out
}

/** The legend of a style: [label, color] rows, empty for a single color. */
export function vectorLegend(entry: VectorSourceEntry, style: VectorOverlayStyle): [string, string][] {
  if (style.colorBy === "source" && entry.categories?.length) {
    const seen = new Set<string>()
    return [...entry.categories.filter((c) => !seen.has(c.label) && !!seen.add(c.label)).map((c): [string, string] => [c.label, c.color]), ["other", style.color]]
  }
  if (style.colorBy === "source" && entry.sourceColors) return Object.entries(entry.sourceColors)
  if (style.colorBy === "height" && entry.heightField) return [...HEIGHT_RAMP.map(([m, c]): [string, string] => [`${m} m`, c]), ["no height", NO_HEIGHT_COLOR]]
  return []
}
