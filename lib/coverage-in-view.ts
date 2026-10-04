// What the drawn coverage overlays hold for the current view, ranked by how
// well each footprint matches it: CoverageOverlayLayer (view A) publishes the
// list, the Sources Coverage section shows it live, grouped like the overlay
// tree, and the click modal sorts by the same score.
import { atom } from "jotai"
import { area, bboxClip, booleanPointInPolygon, bboxPolygon } from "@turf/turf"
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson"
import { OVERLAY_COLORS } from "./coverage-overlays"

export type ViewBbox = [number, number, number, number]

export interface OverlapStats {
  /** Share of the view the footprint covers, 0-1. */
  cover: number
  /** Share of the footprint inside the view, 0-1. */
  inView: number
  /** Intersection over union with the view: 1 for a footprint the size and
   *  place of the view, near 0 for a world map or a speck. The ranking key. */
  iou: number
  atCentre: boolean
}

export function overlapStats(geometry: Geometry | null | undefined, view: ViewBbox, centre: [number, number]): OverlapStats | null {
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return null
  const f: Feature<Polygon | MultiPolygon> = { type: "Feature", geometry, properties: {} }
  const total = area(f)
  if (!(total > 0)) return null
  const viewArea = area(bboxPolygon(view))
  const inter = area(bboxClip(f, view))
  return {
    cover: Math.min(1, inter / viewArea),
    inView: Math.min(1, inter / total),
    iou: inter / (total + viewArea - inter),
    atCentre: inter > 0 && booleanPointInPolygon(centre, f),
  }
}

/** "covers 80% of the view" / "12% of it in view": the more telling half. */
export function overlapLabel(s: OverlapStats): string {
  const pct = (v: number) => (v >= 0.995 ? "100%" : v < 0.01 ? "<1%" : `${Math.round(v * 100)}%`)
  return s.cover >= s.inView ? `covers ${pct(s.cover)} of the view` : `${pct(s.inView)} of it in view, ${pct(s.cover)} of the view`
}

export interface CoverageInViewItem {
  /** The overlay leaf it was drawn for (lib:..., qmsAll, mapterhorn...). */
  leaf: string
  label: string
  detail: string
  url?: string
  /** What "Use as" puts on the map (coverageUseRequestAtom). */
  overlay?: string
  useAs?: "terrain" | "basemap" | "overlay"
  needsKey?: boolean
  gsdM: number
  stats: OverlapStats
}

export const coverageInViewAtom = atom<{ items: CoverageInViewItem[]; at: number } | null>(null)

/** The overlay tree's group for a leaf id, for headings and colours. */
export function coverageGroupOfLeaf(leaf: string): { key: string; label: string; color: string } {
  if (leaf === "mapterhorn") return { key: "mapterhorn", label: "Mapterhorn", color: OVERLAY_COLORS.mapterhorn }
  if (leaf.startsWith("lib:")) return { key: "library", label: "Terrain library", color: OVERLAY_COLORS.library }
  if (leaf.startsWith("terrain:")) return { key: "yourTerrain", label: "Your terrain sources", color: OVERLAY_COLORS.yours }
  if (leaf.startsWith("basemap:")) return { key: "yourBasemaps", label: "Your basemaps", color: OVERLAY_COLORS.yourBasemaps }
  if (leaf.startsWith("blib:")) return { key: "basemapLibrary", label: "Basemap library", color: OVERLAY_COLORS.basemapLibrary }
  if (leaf.startsWith("eli:")) return { key: "eli", label: "OSM Editor Layer Index", color: OVERLAY_COLORS.eli }
  if (leaf === "qmsAll") return { key: "qms", label: "NextGIS QMS", color: OVERLAY_COLORS.qms }
  if (leaf.startsWith("allmaps")) return { key: "allmaps", label: "Old maps (Allmaps)", color: OVERLAY_COLORS.allmaps }
  if (leaf === "otRaster" || leaf === "otPointCloud") return { key: "opentopo", label: "OpenTopography", color: OVERLAY_COLORS.otRaster }
  return { key: "sources3d", label: "3D and LiDAR coverage", color: OVERLAY_COLORS.bing3d }
}

/** Highest overlap first; resolution breaks ties, finest first. */
export const byOverlap = (a: { stats?: OverlapStats | null; gsdM: number }, b: { stats?: OverlapStats | null; gsdM: number }) =>
  (b.stats?.iou ?? -1) - (a.stats?.iou ?? -1) || (a.gsdM === b.gsdM ? 0 : a.gsdM - b.gsdM)
