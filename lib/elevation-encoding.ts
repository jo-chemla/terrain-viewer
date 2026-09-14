// Shared elevation <-> RGBA packing helpers, factored out of MapSources.tsx so that
// non-component modules (e.g. lib/slope-protocol.ts) can reuse them without importing
// a "use client" react-map-gl component file.
// Inspired by https://github.com/geomatico/maplibre-cog-protocol/blob/main/src/render/renderTerrain.ts

export function elevationToTerrainrgb(elevation: number): [number, number, number, number] {
  const base = -10000
  const interval = 0.1
  const v = (elevation - base) / interval
  return [
    Math.floor(v / 256 / 256) % 256,
    Math.floor(v / 256) % 256,
    Math.floor(v) % 256,
    255,
  ]
}

export function elevationToTerrarium(elevation: number): [number, number, number, number] {
  const v = elevation + 32768
  return [
    Math.floor(v / 256),
    Math.floor(v % 256),
    Math.floor((v - Math.floor(v)) * 256),
    255,
  ]
}

// Inverse of the two encoders above — decodes a rendered tile's RGB back into an
// elevation value, e.g. for client-side DTM export from terrainrgb/terrarium TMS
// tiles (no server-side GDAL/titiler involved).
export function terrainrgbToElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
}

export function terrariumToElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

// ---------------------------------------------------------------------------
// Custom RGB packing (maplibre `encoding: "custom"`)
//
//     elevation = R*redFactor + G*greenFactor + B*blueFactor - baseShift
//
// Read out of maplibre-gl's own source rather than the style spec, which
// documents the four fields but not the formula (and describes baseShift as
// "added" where the implementation subtracts it). These two presets are exactly
// what maplibre uses internally for its named encodings, so they double as the
// sensible fallback when a source overrides only some of the four.
export const TERRARIUM_FACTORS = { redFactor: 256, greenFactor: 1, blueFactor: 1 / 256, baseShift: 32768 } as const
export const TERRAIN_RGB_FACTORS = { redFactor: 6553.6, greenFactor: 25.6, blueFactor: 0.1, baseShift: 10000 } as const

export interface CustomRgbEncoding {
  redFactor?: number
  greenFactor?: number
  blueFactor?: number
  baseShift?: number
}

/**
 * Null unless the source actually overrides something — so a source that sets
 * none of the four keeps its plain "terrarium"/"mapbox" encoding and this stays
 * entirely inert. Unset fields fall back to the Terrain-RGB preset rather than
 * maplibre's raw 1/1/1/0 defaults, because the real-world case is "Terrain-RGB
 * but with a different base" (Mexico's INEGI: baseShift 1000, not 10000).
 */
export function resolveCustomEncoding(c: CustomRgbEncoding): Required<CustomRgbEncoding> | null {
  const { redFactor, greenFactor, blueFactor, baseShift } = c
  if ([redFactor, greenFactor, blueFactor, baseShift].every((v) => v === undefined)) return null
  const out = {
    redFactor: redFactor ?? TERRAIN_RGB_FACTORS.redFactor,
    greenFactor: greenFactor ?? TERRAIN_RGB_FACTORS.greenFactor,
    blueFactor: blueFactor ?? TERRAIN_RGB_FACTORS.blueFactor,
    baseShift: baseShift ?? TERRAIN_RGB_FACTORS.baseShift,
  }
  // A NaN here would silently blank the terrain rather than error, so treat a
  // half-typed value in the modal as "not configured yet".
  return Object.values(out).every((v) => isFinite(v)) ? out : null
}
