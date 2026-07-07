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

export type ColorReliefRamp = "hypsometric" | "hypsometric-simple" | "rainbow" | "transparent" | "wiki" | "dem"

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
