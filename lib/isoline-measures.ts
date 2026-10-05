// The measures the Iso-line (Contours & GeoGrid) can trace: the elevation,
// every derived viz mode (each a client protocol writing its measure as a
// Terrarium or Terrain-RGB scalar, see lib/*-protocol.ts) and the lighting
// tiles through their luminance (luma://). Each entry knows its unit, the
// slider's range and how the number the user types maps to the value the
// tiles carry (slope in degrees as is, curvature ×100, the sky-view factor
// 0–1 ×100, …), so the threshold and the contour interval are typed in the
// mode's own units.
import type { ClientDemUpstream, DerivedModeParams, LightingParams } from "@/components/LayersAndSources/MapSources"
import { derivedModeTemplate, lightingTemplate } from "@/components/LayersAndSources/MapSources"
import { buildLumaProtocolUrl } from "./threshold-protocol"

export const ISOLINE_MEASURE_IDS = [
  "elevation", "slope", "aspect", "tri", "tpi", "roughness", "curvature", "shapeIndex",
  "blobness", "eigenRatio", "orientation", "lrm", "svf", "openness", "localDominance",
  "phong", "matcap", "shadow",
] as const
export type IsolineMeasureId = (typeof ISOLINE_MEASURE_IDS)[number]

export interface IsolineMeasure {
  id: IsolineMeasureId
  label: string
  group: "Terrain" | "Terrain analysis" | "Relief visualization" | "Lighting"
  /** Shown after the value; "" for a ratio. */
  unit: string
  min: number
  max: number
  step: number
  defaultValue: number
  defaultInterval: number
  /** The tiles carry shown × scale (a derived mode's bake-in). */
  scale: (p: DerivedModeParams) => number
  /** The derived source behind it (derivedModeTemplate's id), or a light. */
  sourceId?: string
  light?: "phong" | "matcap" | "shadow"
}

const one = () => 1
const hundred = () => 100

export const ISOLINE_MEASURES: IsolineMeasure[] = [
  { id: "elevation", label: "Elevation", group: "Terrain", unit: "m", min: -500, max: 9000, step: 1, defaultValue: 1000, defaultInterval: 100, scale: one },
  { id: "slope", label: "Slope", group: "Terrain analysis", unit: "°", min: 0, max: 90, step: 1, defaultValue: 30, defaultInterval: 10, scale: one, sourceId: "slopeSource" },
  { id: "aspect", label: "Aspect", group: "Terrain analysis", unit: "°", min: 0, max: 360, step: 1, defaultValue: 180, defaultInterval: 45, scale: one, sourceId: "aspectSource" },
  { id: "tri", label: "Ruggedness (TRI)", group: "Terrain analysis", unit: "m", min: 0, max: 200, step: 0.5, defaultValue: 10, defaultInterval: 5, scale: one, sourceId: "triSource" },
  { id: "tpi", label: "Position index (TPI)", group: "Terrain analysis", unit: "m", min: -100, max: 100, step: 0.5, defaultValue: 0, defaultInterval: 5, scale: one, sourceId: "tpiSource" },
  { id: "roughness", label: "Roughness", group: "Terrain analysis", unit: "m", min: 0, max: 200, step: 0.5, defaultValue: 10, defaultInterval: 5, scale: one, sourceId: "roughnessSource" },
  { id: "curvature", label: "Curvature", group: "Terrain analysis", unit: "", min: -10, max: 10, step: 0.1, defaultValue: 0, defaultInterval: 1, scale: (p) => (p.curvatureMode === "det-hessian" ? 10000 : p.curvatureMode === "shape-index" ? 1 : 100), sourceId: "curvatureSource" },
  { id: "shapeIndex", label: "Shape index", group: "Terrain analysis", unit: "", min: -1, max: 1, step: 0.05, defaultValue: 0, defaultInterval: 0.25, scale: one, sourceId: "shapeIndexSource" },
  { id: "blobness", label: "Blobness", group: "Terrain analysis", unit: "", min: -10, max: 10, step: 0.1, defaultValue: 1, defaultInterval: 1, scale: hundred, sourceId: "blobnessSource" },
  { id: "eigenRatio", label: "Eigen ratio", group: "Terrain analysis", unit: "%", min: 0, max: 100, step: 1, defaultValue: 50, defaultInterval: 10, scale: one, sourceId: "eigenRatioSource" },
  { id: "orientation", label: "Orientation", group: "Terrain analysis", unit: "°", min: -90, max: 90, step: 1, defaultValue: 0, defaultInterval: 15, scale: one, sourceId: "orientationSource" },
  { id: "lrm", label: "Local relief (LRM)", group: "Relief visualization", unit: "m", min: -50, max: 50, step: 0.1, defaultValue: 0, defaultInterval: 2, scale: one, sourceId: "lrmSource" },
  { id: "svf", label: "Sky-view factor", group: "Relief visualization", unit: "", min: 0, max: 1, step: 0.01, defaultValue: 0.9, defaultInterval: 0.05, scale: hundred, sourceId: "svfSource" },
  { id: "openness", label: "Openness", group: "Relief visualization", unit: "°", min: 0, max: 100, step: 1, defaultValue: 80, defaultInterval: 5, scale: one, sourceId: "opennessSource" },
  { id: "localDominance", label: "Local dominance", group: "Relief visualization", unit: "°", min: -30, max: 30, step: 0.5, defaultValue: 0, defaultInterval: 2, scale: one, sourceId: "localDominanceSource" },
  { id: "phong", label: "Phong shading (128 neutral)", group: "Lighting", unit: "", min: 0, max: 255, step: 1, defaultValue: 128, defaultInterval: 32, scale: one, light: "phong" },
  { id: "matcap", label: "Matcap shading", group: "Lighting", unit: "", min: 0, max: 255, step: 1, defaultValue: 128, defaultInterval: 32, scale: one, light: "matcap" },
  { id: "shadow", label: "Hard shadow (0 shaded, 128 lit)", group: "Lighting", unit: "", min: 0, max: 128, step: 1, defaultValue: 64, defaultInterval: 64, scale: one, light: "shadow" },
]

export const ISOLINE_MEASURE_GROUPS = ["Terrain", "Terrain analysis", "Relief visualization", "Lighting"] as const

export const isolineMeasure = (id: string): IsolineMeasure => ISOLINE_MEASURES.find((m) => m.id === id) ?? ISOLINE_MEASURES[0]

export interface IsolineDem { template: string; encoding: "terrarium" | "mapbox"; tileSize: number; maxzoom?: number }

/** The measure's tiles over the terrain upstream, as a DEM-shaped template
 *  the threshold and the contour engine read: the terrain itself, a derived
 *  mode's tiles, or a light's tiles through luma://. */
export function isolineMeasureDem(id: IsolineMeasureId, up: ClientDemUpstream, derived: DerivedModeParams, lighting: LightingParams): IsolineDem | null {
  const m = isolineMeasure(id)
  if (m.light) {
    const lt = lightingTemplate(m.light, up, lighting)
    return { template: buildLumaProtocolUrl(lt.template, lt.tileSize), encoding: "terrarium", tileSize: lt.tileSize, maxzoom: lt.maxzoom }
  }
  if (m.sourceId) return derivedModeTemplate(m.sourceId, up, derived)
  return { template: up.template, encoding: up.encoding, tileSize: up.tileSize, maxzoom: up.maxzoom }
}

export const formatIsolineValue = (m: IsolineMeasure, v: number) => `${Number.isFinite(v) ? +v.toFixed(2) : 0}${m.unit === "°" || m.unit === "%" ? m.unit : m.unit ? ` ${m.unit}` : ""}`
