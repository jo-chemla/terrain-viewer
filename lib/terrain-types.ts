// "mapzen" (commented out in terrain-sources.ts — the service was discontinued)
// and "bing" (never had a terrain/elevation entry, unlike the unrelated "bing"
// raster *basemap* imagery option) were never actually populated in
// terrainSources below — narrowed to match reality instead of the two ghost
// members Record<TerrainSource, TerrainSourceConfig> silently never enforced.
export type TerrainSource = "mapterhorn" | "maptiler" | "aws" | "mapbox" | "google3dtiles"


export const HILLSHADE_METHODS = [
  "standard",
  "combined",
  "igor",
  "basic",
  "aspect-multidir",
  "multidir-colors"
] as const

// export type HillshadeMethod = "standard" | "combined" | "igor" | "basic" | "multidirectional"
export type HillshadeMethod = typeof HILLSHADE_METHODS[number]

// Derived from the real ramp keys instead of hand-listed, so it can never drift out
// of sync with lib/color-ramps.ts again (it used to be a hardcoded literal union that
// only covered a handful of the ~40 actual ramps, throwing TS7053/TS2353 everywhere
// a newer ramp key like "slope-plantopo" or "aspect-compass" got used).
import type { colorRampsClassic } from "./color-ramps"
export type ColorReliefRamp = keyof typeof colorRampsClassic

export interface TerrainSourceConfig {
  name: string
  link: string
  description: string
  encoding: "terrarium" | "terrainrgb" | "3dtiles" | "custom" 
  sourceConfig: {
    type: "raster-dem" | "3dtiles"
    tiles?: string[]
    url?: string
    // Not meaningful for a 3dtiles entry (google3dtiles below omits both) — there's
    // no maplibre raster-dem tile pyramid behind it, just a Cesium 3D Tiles root.
    tileSize?: number
    maxzoom?: number
    encoding: "terrarium" | "mapbox"| "3dtiles" | "custom"
  }
}
