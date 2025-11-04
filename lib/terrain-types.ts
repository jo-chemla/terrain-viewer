export type TerrainSource = "mapterhorn" | "maptiler" | "aws" | "mapbox" | "mapzen" | "bing" | "google3d"

export type HillshadeMethod = "standard" | "combined" | "igor" | "basic" | "multidirectional"

export type ColorReliefRamp = "hypsometric" | "hypsometric-simple" | "rainbow" | "transparent" | "wiki" | "dem"

export interface TerrainSourceConfig {
  name: string
  link: string
  description: string
  encoding: "terrarium" | "mapbox" | "terrainrgb" | "custom"
  sourceConfig: {
    type: "raster-dem"
    tiles: string[]
    tileSize: number
    maxzoom: number
    encoding: "terrarium" | "mapbox" | "custom"
  }
}
