import { atom } from "jotai"
import type { FeatureCollection, Feature, Polygon } from "geojson"
import customSources from "./custom-sources.json"
import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"

/**
 * Coverage overlays (Source Info section): vector footprints of where a
 * source actually has data, drawn on the map so a blank area can be told
 * apart from a slow one. Three families:
 *
 *   mapterhorn      - the built-in terrain's per-country ingestion list
 *                     (MAPTERHORN_BEST_RESOLUTION_M in custom-sources.json)
 *                     painted on Natural Earth 110m country polygons;
 *                     countries with no national source are the GLO-30
 *                     fallback and drawn hollow.
 *   terrain:<id>    - a custom terrain source's declared bounds rectangle.
 *   basemap:<id>    - a custom basemap's declared bounds rectangle, or, for
 *                     one added from the OSM Editor Layer Index, the index's
 *                     real coverage polygon (loaded from the ELI package).
 *
 * The selection is session-only (not persisted, not in the URL). Feature
 * properties are flat so the map layer can read them: overlay, label,
 * detail, color, hollow.
 */
export const coverageOverlaysAtom = atom<string[]>([])

export interface CoverageOverlayOption {
  id: string
  label: string
  color: string
  kind: "mapterhorn" | "terrain" | "basemap"
}

export const OVERLAY_COLORS = { mapterhorn: "#8b5cf6", terrain: "#10b981", basemap: "#f59e0b", eli: "#0ea5e9" }

const ELI_ID_RE = /OSM Editor Layer Index id (\S+)/

export function coverageOverlayOptions(terrains: CustomTerrainSource[], basemaps: CustomBasemapSource[]): CoverageOverlayOption[] {
  const out: CoverageOverlayOption[] = [{ id: "mapterhorn", label: "Mapterhorn (national sources by country)", color: OVERLAY_COLORS.mapterhorn, kind: "mapterhorn" }]
  for (const t of terrains) if (t.bounds) out.push({ id: `terrain:${t.id}`, label: t.name, color: OVERLAY_COLORS.terrain, kind: "terrain" })
  for (const b of basemaps) {
    const eli = b.provider === "eli" && ELI_ID_RE.test(b.description ?? "")
    if (b.bounds || eli) out.push({ id: `basemap:${b.id}`, label: b.name, color: eli ? OVERLAY_COLORS.eli : OVERLAY_COLORS.basemap, kind: "basemap" })
  }
  return out
}

const rect = (b: [number, number, number, number]): Polygon => ({
  type: "Polygon",
  coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]],
})

const cache = new Map<string, Promise<FeatureCollection>>()

/** Features for one overlay id; cached per session (bounds rarely change,
 *  and the caller passes a fresh id when they do via the source's own id). */
export function loadCoverageFeatures(id: string, terrains: CustomTerrainSource[], basemaps: CustomBasemapSource[]): Promise<FeatureCollection> {
  const key = id === "mapterhorn" ? id : `${id}:${JSON.stringify((id.startsWith("terrain:") ? terrains : basemaps).find((s) => id.endsWith(s.id))?.bounds ?? null)}`
  let p = cache.get(key)
  if (!p) {
    p = build(id, terrains, basemaps).catch((e) => { cache.delete(key); throw e })
    cache.set(key, p)
  }
  return p
}

async function build(id: string, terrains: CustomTerrainSource[], basemaps: CustomBasemapSource[]): Promise<FeatureCollection> {
  const empty: FeatureCollection = { type: "FeatureCollection", features: [] }
  if (id === "mapterhorn") {
    // Same Natural Earth 110m polygons the docs coverage map uses (built by
    // docs/scripts/build-world-110m.mjs), loaded on demand: 80 KB.
    // Rings are flat [x0,y0,x1,y1,...] integer arrays in tenths of a degree,
    // outer rings only (one per polygon part).
    const world = (await import("../docs/src/components/world-110m.json")).default as { iso: string; name: string; rings: number[][] }[]
    const ring = (flat: number[]) => {
      const pts: number[][] = []
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i] / 10, flat[i + 1] / 10])
      if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0])
      return pts
    }
    const best: Record<string, number | undefined> = customSources.MAPTERHORN_BEST_RESOLUTION_M
    const features: Feature[] = world.map((c) => {
      const res = best[c.iso]
      const national = res !== undefined && res < (best.GLOBAL ?? 30)
      return {
        type: "Feature",
        geometry: { type: "MultiPolygon", coordinates: c.rings.map((r) => [ring(r)]) },
        properties: {
          overlay: id, color: OVERLAY_COLORS.mapterhorn, hollow: !national,
          label: `Mapterhorn - ${c.name}`,
          detail: national ? `National source ingested at ${res} m` : "No national source: Copernicus GLO-30 fallback (30 m)",
        },
      }
    })
    return { type: "FeatureCollection", features }
  }
  if (id.startsWith("terrain:")) {
    const t = terrains.find((s) => `terrain:${s.id}` === id)
    if (!t?.bounds) return empty
    return { type: "FeatureCollection", features: [{ type: "Feature", geometry: rect(t.bounds), properties: {
      overlay: id, color: OVERLAY_COLORS.terrain, hollow: false, label: t.name,
      detail: `Terrain source (${t.type})${t.resolutionM !== undefined ? ` · ${t.resolutionM} m` : ""} · declared bounds`, url: t.infoUrl ?? "",
    } }] }
  }
  if (id.startsWith("basemap:")) {
    const b = basemaps.find((s) => `basemap:${s.id}` === id)
    if (!b) return empty
    const eliId = b.provider === "eli" ? ELI_ID_RE.exec(b.description ?? "")?.[1] : undefined
    if (eliId) {
      try {
        const eli = await import("@osm-editor-kit/maplibre-editor-layer-index")
        const layer = eli.getLayer(eliId)
        if (layer) {
          const fc = await eli.loadCoverageFeatures([layer])
          const features = fc.features.map((f) => ({ ...f, properties: { ...f.properties,
            overlay: id, color: OVERLAY_COLORS.eli, hollow: false, label: b.name,
            detail: "OSM Editor Layer Index coverage polygon", url: b.infoUrl ?? "" } }))
          if (features.length) return { type: "FeatureCollection", features }
        }
      } catch { /* fall through to the bounds rectangle */ }
    }
    if (!b.bounds) return empty
    return { type: "FeatureCollection", features: [{ type: "Feature", geometry: rect(b.bounds), properties: {
      overlay: id, color: OVERLAY_COLORS.basemap, hollow: false, label: b.name,
      detail: `Basemap (${b.type}) · declared bounds`, url: b.infoUrl ?? "",
    } }] }
  }
  return empty
}
