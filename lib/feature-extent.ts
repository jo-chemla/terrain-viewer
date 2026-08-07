// Per-feature export bbox for lib/export-multi.ts — nothing in the codebase
// pads a feature's own geographic extent today; the only existing analog
// (TerraDrawLayers' Feature Iterator, components/TerrainControlPanel/
// TerraDrawSystem.tsx ~line 918) pads in SCREEN PIXELS for camera framing,
// not a geographic buffer suitable for a fixed export bbox. Point features
// get a fixed real-world (meters) radius; every other geometry (polygon,
// line, multi-polygon) gets a percent-of-its-own-extent buffer instead,
// per the user's own split.
import bbox from "@turf/bbox"
import type { Feature, Geometry } from "geojson"

export type Bbox4 = [west: number, south: number, east: number, north: number]

const METERS_PER_DEGREE_LAT = 111_320

function metersToDegreesLat(meters: number): number {
  return meters / METERS_PER_DEGREE_LAT
}
function metersToDegreesLng(meters: number, atLatDeg: number): number {
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((atLatDeg * Math.PI) / 180)
  return meters / Math.max(1, metersPerDegreeLng)
}

// Floor for degenerate polygon/line bboxes (perfectly horizontal/vertical, or
// a near-zero-area sliver) — a percentage of a ~zero extent still pads to
// ~zero, which would hand fetchRgbTileMosaic a bbox too thin to resolve a
// sane tile range from. ~50m in degrees-of-latitude terms.
const MIN_PADDING_DEG = 0.00045

export interface PaddedExtent {
  bbox: Bbox4
  /** Short descriptor for filenames — e.g. "pad200m" (point, fixed radius)
   *  or "pad20pct" (polygon/line, percent of its own extent). */
  descriptor: string
}

export interface FeatureExtentOptions {
  /** Point features: fixed real-world radius, in meters. */
  pointPaddingMeters: number
  /** Every other geometry type: percent of the feature's own raw
   *  width/height, applied on each side (so the final bbox is
   *  `1 + 2*percentPadding/100` times as wide/tall as the raw extent). */
  percentPadding: number
}

export function computeFeaturePaddedExtent(feature: Feature<Geometry>, opts: FeatureExtentOptions): PaddedExtent {
  const raw = bbox(feature) as Bbox4
  const [west, south, east, north] = raw

  if (feature.geometry.type === "Point") {
    const [lng, lat] = feature.geometry.coordinates as [number, number]
    const dLat = metersToDegreesLat(opts.pointPaddingMeters)
    const dLng = metersToDegreesLng(opts.pointPaddingMeters, lat)
    return {
      bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat],
      descriptor: `pad${Math.round(opts.pointPaddingMeters)}m`,
    }
  }

  const width = east - west
  const height = north - south
  const padX = Math.max((width * opts.percentPadding) / 100, MIN_PADDING_DEG)
  const padY = Math.max((height * opts.percentPadding) / 100, MIN_PADDING_DEG)
  return {
    bbox: [west - padX, south - padY, east + padX, north + padY],
    descriptor: `pad${Math.round(opts.percentPadding)}pct`,
  }
}
