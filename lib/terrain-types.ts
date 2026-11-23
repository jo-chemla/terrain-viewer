// The ids of the built-in Worldwide Defaults (BUILTIN_TERRAIN_SOURCES in
// lib/terrain-sources.ts). Any other terrain source id is a string.
export type TerrainSource = "mapterhorn" | "maptiler" | "aws" | "mapbox" | "esri" | "cesium"


export const HILLSHADE_METHODS = [
  "standard",
  "combined",
  "igor",
  "basic",
  "aspect-multidir",
  "multidir-colors",
  "duotone-nw-ne"
] as const

// export type HillshadeMethod = "standard" | "combined" | "igor" | "basic" | "multidirectional"
type HillshadeMethod = typeof HILLSHADE_METHODS[number]

// Derived from the real ramp keys instead of hand-listed, so it can never drift out
// of sync with lib/color-ramps.ts again (it used to be a hardcoded literal union that
// only covered a handful of the ~40 actual ramps, throwing TS7053/TS2353 everywhere
// a newer ramp key like "slope-plantopo" or "aspect-compass" got used).
import type { colorRampsClassic } from "./color-ramps"
type ColorReliefRamp = keyof typeof colorRampsClassic

