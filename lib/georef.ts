// Georeferencing a plain image (PNG, JPEG, a scan, a figure) from ground
// control points: pixel positions in the image paired with map positions.
// The fit comes from @allmaps/transform (the maths behind allmaps.org,
// used here without IIIF); the result is drawn with MapLibre's `image`
// source, which takes the image's four corners in lng/lat. That makes
// anything up to an affine fit exact on screen (a quadrilateral drawn
// perspective-correct), and bending fits (polynomial2, thin plate spline)
// correct at the corners only. See docs/content/docs/features/georeference.mdx.
import { GeneralGcpTransformer, type TransformationType } from "@allmaps/transform"
import { distance as turfDistance } from "@turf/turf"

export type GeorefGcp = {
  id: number
  /** Image pixel, x to the right, y DOWN from the top-left corner. */
  px: number
  py: number
  /** Map position; null while the pair is half placed. */
  lng: number | null
  lat: number | null
}

export type GeorefType = "helmert" | "polynomial1" | "polynomial2" | "thinPlateSpline" | "projective"

export const GEOREF_TYPES: { value: GeorefType; label: string; minPoints: number; hint: string }[] = [
  { value: "helmert", label: "Similarity (2+)", minPoints: 2, hint: "Move, scale, rotate. Shapes kept. The usual choice for a map figure or a drawn plan." },
  { value: "polynomial1", label: "Affine (3+)", minPoints: 3, hint: "Adds shear and different scales in x and y. Still exact on screen." },
  { value: "projective", label: "Projective (4+)", minPoints: 4, hint: "A photograph of a flat map taken at an angle." },
  { value: "polynomial2", label: "Polynomial 2 (6+)", minPoints: 6, hint: "Gentle bending. Only the four corners are exact on screen." },
  { value: "thinPlateSpline", label: "Thin plate spline (3+)", minPoints: 3, hint: "Rubber sheet through every point. Only the four corners are exact on screen." },
]

export const GEOREF_TYPE_IDS = GEOREF_TYPES.map((t) => t.value) as GeorefType[]

export type GeorefFit = {
  type: GeorefType
  /** MapLibre image-source order: top-left, top-right, bottom-right, bottom-left. */
  corners: [[number, number], [number, number], [number, number], [number, number]]
  /** Per-GCP residual in metres (fitted position vs the map position given). */
  residualsM: number[]
  rmseM: number
  toGeo: (px: number, py: number) => [number, number]
}

export function completeGcps(gcps: GeorefGcp[]): GeorefGcp[] {
  return gcps.filter((g) => g.lng != null && g.lat != null)
}

export function minPointsFor(type: GeorefType): number {
  return GEOREF_TYPES.find((t) => t.value === type)?.minPoints ?? 3
}

/** Fits the transform, or returns null when there are too few complete pairs
 *  or the solver throws (collinear points for an affine, say). */
export function fitGeoref(gcps: GeorefGcp[], type: GeorefType, imageWidth: number, imageHeight: number): GeorefFit | null {
  const done = completeGcps(gcps)
  if (done.length < minPointsFor(type)) return null
  try {
    const transformer = new GeneralGcpTransformer(
      done.map((g) => ({ source: [g.px, g.py] as [number, number], destination: [g.lng as number, g.lat as number] as [number, number] })),
      type as TransformationType,
      // Pixel y points down, latitude points up: tell the joint (Helmert)
      // solver so it does not fit a mirror image.
      { differentHandedness: true },
    )
    const toGeo = (px: number, py: number) => transformer.transformForward([px, py]) as [number, number]
    const corners: GeorefFit["corners"] = [toGeo(0, 0), toGeo(imageWidth, 0), toGeo(imageWidth, imageHeight), toGeo(0, imageHeight)]
    if (corners.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > 89.9)) return null
    const residualsM = done.map((g) => turfDistance(toGeo(g.px, g.py), [g.lng as number, g.lat as number], { units: "meters" }))
    const rmseM = Math.sqrt(residualsM.reduce((a, r) => a + r * r, 0) / residualsM.length)
    return { type, corners, residualsM, rmseM, toGeo }
  } catch {
    return null
  }
}

/** ESRI world file (.pgw / .jgw) for the fit, in lng/lat (EPSG:4326): the
 *  affine that maps pixel centres to map positions. Exact for similarity and
 *  affine fits; for the others it is the affine through the image corners,
 *  which is what a world file can hold. */
export function worldFile(fit: GeorefFit, imageWidth: number, imageHeight: number): string {
  const [tl, tr, , bl] = fit.corners
  const a = (tr[0] - tl[0]) / imageWidth   // x change per column
  const d = (tr[1] - tl[1]) / imageWidth   // y change per column
  const b = (bl[0] - tl[0]) / imageHeight  // x change per row
  const e = (bl[1] - tl[1]) / imageHeight  // y change per row (negative: north up)
  // World files place the first pixel's CENTRE: shift half a pixel in.
  const cx = tl[0] + a * 0.5 + b * 0.5
  const cy = tl[1] + d * 0.5 + e * 0.5
  return [a, d, b, e, cx, cy].map((v) => v.toPrecision(12)).join("\n") + "\n"
}

/** Bounding box of the drawn image, [west, south, east, north]. */
export function fitBounds(fit: GeorefFit): [number, number, number, number] {
  const xs = fit.corners.map((c) => c[0]); const ys = fit.corners.map((c) => c[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Compact URL form of the control points: "px,py,lng,lat;px,py,lng,lat". */
export function gcpsToParam(gcps: GeorefGcp[]): string {
  return completeGcps(gcps).map((g) => [g.px, g.py, g.lng, g.lat].map((v) => Number((v as number).toFixed(6))).join(",")).join(";")
}

export function gcpsFromParam(s: string): GeorefGcp[] {
  if (!s) return []
  return s.split(";").map((row, i) => {
    const [px, py, lng, lat] = row.split(",").map(Number)
    return { id: i + 1, px, py, lng, lat }
  }).filter((g) => [g.px, g.py, g.lng, g.lat].every((v) => Number.isFinite(v)))
}
