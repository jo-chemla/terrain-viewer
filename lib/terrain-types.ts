export type TerrainSource = "mapterhorn" | "maptiler" | "aws" | "mapbox" | "mapzen" | "bing" | "google3dtiles"

export type HillshadeMethod = "standard" | "combined" | "igor" | "basic" | "multidirectional"

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
