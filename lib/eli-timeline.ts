// The OSM Editor Layer Index on the historical timeline: about 1,300 ELI
// layers carry a capture date (startDate, often an endDate), from 1840s
// historical maps to recent orthophotos. The "OSM ELI" timeline pill puts a
// tick at each dated layer covering the view; picking one makes that layer
// the view's basemap (the same conversion the coverage modal's "Use as
// basemap" does), under an id with a fixed prefix so the timeline still
// knows the view is on a dated ELI layer and keeps its handle.
import type { CustomBasemapSource } from "./settings-atoms"

export const ELI_BASEMAP_PREFIX = "custom-basemap-eli-"
export const isEliBasemapId = (id: string | undefined | null): boolean => !!id && id.startsWith(ELI_BASEMAP_PREFIX)
export const eliLayerIdOf = (basemapId: string): string => basemapId.slice(ELI_BASEMAP_PREFIX.length)

/** "2014" -> 1 January 2014; "2014-06" -> 1 June; "2014-06-12" -> that day.
 *  A year alone sits at the start of the year, not mid-year. */
export function eliDateMs(s?: string | null): number | null {
  if (!s) return null
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s.trim())
  if (!m) return null
  const y = Number(m[1]), mo = m[2] ? Number(m[2]) - 1 : 0, d = m[3] ? Number(m[3]) : 1
  const t = Date.UTC(y, mo, d)
  return Number.isFinite(t) ? t : null
}

export interface EliTick { source: "eli"; key: number; dateMs: number; label: string; ref: string }

type DatedLayer = { id: string; name: string; category?: string; requiresKeys: string[]; tiles?: string[]; startDate?: string; endDate?: string }

/** Imagery and maps only (not QA or OSM-derived styles), keyless, with a
 *  tile URL and a start date. Ticks keep a unique key: several layers can
 *  share a date, and the key is the list's React key. */
export function eliLayersToTicks(layers: DatedLayer[]): EliTick[] {
  const keep = new Set(["photo", "historicphoto", "map", "historicmap", undefined])
  const rows: EliTick[] = []
  const used = new Set<number>()
  for (const l of layers) {
    if (!keep.has(l.category as any) || l.requiresKeys.length || !l.tiles?.length) continue
    const dateMs = eliDateMs(l.startDate)
    if (dateMs === null) continue
    let key = dateMs
    while (used.has(key)) key += 1
    used.add(key)
    const span = l.endDate && l.endDate !== l.startDate ? `${l.startDate}–${l.endDate}` : l.startDate
    rows.push({ source: "eli", key, dateMs, label: `${l.name} · ${span}`, ref: l.id })
  }
  return rows.sort((a, b) => a.dateMs - b.dateMs)
}

/** The dated ELI layers whose real coverage polygon touches the view. The
 *  index's own viewport query matches bounding boxes, which overshoot: a
 *  national layer with overseas territories (IGN's BD Ortho) has a box that
 *  reaches New York. Undated layers are dropped before any polygon loads. */
export async function datedEliLayersInView(bbox: [number, number, number, number]): Promise<DatedLayer[]> {
  const eli = await import("@osm-editor-kit/maplibre-editor-layer-index")
  const layers = (await eli.loadLayersInViewport(bbox, { includeWorldwide: false })).filter((l) => !!l.startDate)
  if (!layers.length) return []
  const [{ booleanIntersects, bboxPolygon }, fc] = await Promise.all([import("@turf/turf"), eli.loadCoverageFeatures(layers)])
  const view = bboxPolygon(bbox)
  const touching = new Set<string>()
  for (const f of fc.features) {
    if (!f.geometry) continue
    try { if (booleanIntersects(f as any, view)) touching.add(String((f.properties as any)?.id)) } catch { touching.add(String((f.properties as any)?.id)) }
  }
  // A layer with no polygon at all (none in the shard) keeps its box match.
  const withPolygon = new Set(fc.features.map((f) => String((f.properties as any)?.id)))
  return layers.filter((l) => touching.has(l.id) || !withPolygon.has(l.id))
}

/** One ELI layer as a basemap source (the coverage modal's "Use as
 *  basemap", the timeline's ELI ticks). */
export async function eliLayerAsBasemap(layerId: string): Promise<CustomBasemapSource> {
  const eli = await import("@osm-editor-kit/maplibre-editor-layer-index")
  const layer = await eli.getLayerHydrated(layerId)
  if (!layer) throw new Error(`ELI layer ${layerId}: tile URLs could not be loaded`)
  if (layer.requiresKeys.length > 0) throw new Error(`ELI layer ${layerId} needs an API key (${layer.requiresKeys.join(", ")})`)
  const spec = eli.getRasterSourceSpec(layer)
  if (!spec.tiles.length) throw new Error(`ELI layer ${layerId} has no tile URL`)
  const dates = layer.startDate ? ` · ${layer.endDate && layer.endDate !== layer.startDate ? `${layer.startDate}–${layer.endDate}` : layer.startDate}` : ""
  return {
    id: `${ELI_BASEMAP_PREFIX}${layerId}`, name: layer.name, url: spec.tiles[0], type: "tms", scheme: spec.scheme ?? "xyz",
    minzoom: spec.minzoom, maxzoom: spec.maxzoom, role: layer.overlay ? "overlay" : "basemap",
    description: `OSM Editor Layer Index id ${layer.id}${dates}`,
    attribution: layer.attributionText || undefined, licenseUrl: layer.licenseUrl || undefined,
    infoUrl: layer.attributionUrl || "https://osm-editor-kit.github.io/maplibre-editor-layer-index/", provider: "eli",
  }
}
