import type { TerrainSource, TerrainSourceConfig } from "./terrain-types"

export const terrainSources: Record<TerrainSource, TerrainSourceConfig> = {
  mapterhorn: {
    name: "Mapterhorn Terrarium",
    link: "https://mapterhorn.com/",
    description: "Mapterhorn terrain tiles with Terrarium encoding",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],
      tileSize: 512,
      maxzoom: 14,
      encoding: "terrarium",
    },
  },
  mapbox: {
    name: "Mapbox TerrainRGB",
    link: "https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/",
    description: "Mapbox Terrain DEM v1 with TerrainRGB encoding",
    encoding: "terrainrgb",
    sourceConfig: {
      type: "raster-dem",
      tiles: [
        "https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.png?access_token={API_KEY}",
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
      tiles: ["https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key={API_KEY}"],
      tileSize: 512,
      maxzoom: 12,
      encoding: "mapbox",
    },
  },
  aws: {
    name: "AWS Elevation Tiles (Mapzen Terrarium)",
    link: "https://registry.opendata.aws/terrain-tiles/",
    description: "AWS Terrain Tiles - Open Data Registry (Mapzen Terrarium encoding)",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 15,
      encoding: "terrarium",
    },
  },
  // mapzen: {
  //   name: "Mapzen Terrarium (also on AWS, discontinued on mapzen)",
  //   link: "https://www.mapzen.com/blog/terrain-tile-service/",
  //   description: "AWS Terrain Tiles - Open Data Registry (Mapzen Terrarium encoding)",
  //   encoding: "terrarium",
  //   sourceConfig: {
  //     type: "raster-dem",
  //     tiles: ["https://tile.mapzen.com/mapzen/terrain/v1/terrarium/{z}/{x}/{y}.png?api_key={API_KEY}"],
  //     tileSize: 256,
  //     maxzoom: 15,
  //     encoding: "terrarium",
  //   },
  // },
  google3dtiles: {
    name: "Google 3D Tiles (via DeckGL only)",
    link: "https://goo.gle/3d-area-explorer-admin#camera.orbitType=fixed-orbit&location.coordinates.lat={LAT}&location.coordinates.lng={LNG}",
    description: "Google 3D Cities not available, 3D-tiles tileset are not compatible with Maplibre GL JS without Deck.gl. See https://mapsplatform.google.com/demos/3d-maps and https://developers.google.com/maps/architecture/3d-area-explorer",
    encoding: "3dtiles",
    sourceConfig: {
      type: "3dtiles",
      tiles: ["https://tile.googleapis.com/v1/3dtiles/root.json?key={API_KEY}"],
      encoding: "3dtiles",
    },
  },
}
