import type { TerrainSource, TerrainSourceConfig } from "./terrain-types"

export const terrainSources: Record<TerrainSource, TerrainSourceConfig> = {
  mapterhorn: {
    name: "Mapterhorn",
    link: "https://mapterhorn.com/",
    description: "Mapterhorn terrain tiles",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],
      tileSize: 256,
      maxzoom: 14,
      encoding: "terrarium",
    },
  },
  mapbox: {
    name: "Mapbox Terrain DEM",
    link: "https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/",
    description: "Mapbox Terrain DEM v1",
    encoding: "terrainrgb",
    sourceConfig: {
      type: "raster-dem",
      tiles: [
        "https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=pk.eyJ1IjoiaWNvbmVtIiwiYSI6ImNpbXJycDBqODAwNG12cW0ydGF1NXZxa2sifQ.hgPcQvgkzpfYkHgfMRqcpw",
      ],
      tileSize: 256,
      maxzoom: 14,
      encoding: "mapbox",
    },
  },
  maptiler: {
    name: "MapTiler TerrainRGB",
    link: "https://www.maptiler.com/terrain/",
    description: "MapTiler terrain tiles with TerrainRGB encoding",
    encoding: "terrainrgb",
    sourceConfig: {
      type: "raster-dem",
      tiles: ["https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=FbPGGTCFE8IRiPECxIrp"],
      tileSize: 256,
      maxzoom: 12,
      encoding: "mapbox",
    },
  },
  mapzen: {
    name: "Mapzen Terrarium",
    link: "https://www.mapzen.com/blog/terrain-tile-service/",
    description: "Mapzen Terrarium terrain tiles hosted on AWS",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 15,
      encoding: "terrarium",
    },
  },
  aws: {
    name: "AWS Elevation Tiles (Mapzen)",
    link: "https://registry.opendata.aws/terrain-tiles/",
    description: "AWS Terrain Tiles - Open Data Registry",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 15,
      encoding: "terrarium",
    },
  },
}
