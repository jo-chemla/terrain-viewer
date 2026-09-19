import type { TerrainSource, TerrainSourceConfig } from "./terrain-types"

export const terrainSources: Record<TerrainSource, TerrainSourceConfig> = {
  mapterhorn: {
    name: "Mapterhorn - Terrarium",
    link: "https://mapterhorn.com/",
    description: "Mapterhorn terrain tiles with Terrarium encoding",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],
      tileSize: 512,
      maxzoom: 18,
      encoding: "terrarium",
    },
  },
  mapbox: {
    name: "Mapbox - TerrainRGB",
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
    name: "MapTiler - TerrainRGB",
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
    name: "AWS Terrain - Terrarium Mapzen",
    link: "https://registry.opendata.aws/terrain-tiles/",
    description: "AWS Terrain Tiles - Open Data Registry (Mapzen Terrarium encoding)",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 16,
      encoding: "terrarium",
    },
  },
  esri: {
    name: "Esri World Elevation - LERC",
    link: "https://www.arcgis.com/home/item.html?id=0c69ba5a5d254118841d43f03aa3e97d",
    description: "Esri's global best-available blend (Vantor, Airbus DS, USGS, NGA, NASA, CGIAR, GEBCO, LINZ, Ordnance Survey and others), TopoBathy variant: land AND seafloor as one continuous surface, so a hypsometric ramp or a 3D view reads across a coastline instead of stopping at it. Served as LERC - Esri's own float raster codec - and decoded in the browser by lerc:// (see /dev/lerc-protocol). Orthometric, keyless, CORS-open; check Esri's Terms of Use before publishing with it.",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      // The tile pyramid, NOT exportImage: that endpoint only answers
      // anonymously from a ~2.5 km overview. ArcGIS orders the placeholders
      // z/y/x, which maplibre substitutes the same as any other order.
      tiles: ["lerc://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/TopoBathy3D/ImageServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      // The service declares LOD 16; past that every pixel comes back masked,
      // so maplibre should overzoom the last real parent instead.
      maxzoom: 16,
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
  // Removed from Worldwide Defaults — this experience is now reachable via
  // the "Google Maps 3D" / "Google Earth 3D (web)" Open-In destinations
  // instead (see open-in-links.tsx), which don't need Deck.gl at all.
  // google3dtiles: {
  //   name: "Google 3D Tiles (via DeckGL only)",
  //   link: "https://goo.gle/3d-area-explorer-admin#camera.orbitType=fixed-orbit&location.coordinates.lat={LAT}&location.coordinates.lng={LNG}",
  //   description: "Google 3D Cities not available, 3D-tiles tileset are not compatible with Maplibre GL JS without Deck.gl. See https://mapsplatform.google.com/demos/3d-maps and https://developers.google.com/maps/architecture/3d-area-explorer",
  //   encoding: "3dtiles",
  //   sourceConfig: {
  //     type: "3dtiles",
  //     tiles: ["https://tile.googleapis.com/v1/3dtiles/root.json?key={API_KEY}"],
  //     encoding: "3dtiles",
  //   },
  // },
}
