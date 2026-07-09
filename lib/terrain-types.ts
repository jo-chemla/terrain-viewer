export type TerrainSource = "mapterhorn" | "maptiler" | "aws" | "mapbox" | "mapzen" | "bing" | "google3dtiles"


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
    type: "raster-dem"
    tiles?: string[]
    url?: string
    tileSize: number
    maxzoom: number
    encoding: "terrarium" | "mapbox"| "3dtiles" | "custom"
  }
}
