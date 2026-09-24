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
  // Esri sits second on purpose. Where Mapterhorn has ingested a national
  // dataset it is the finer of the two, but everywhere else it falls back to
  // GLO-30 and stops serving tiles at z12; Esri's blend keeps going to z15-16
  // there (measured over Turkey: Mapterhorn 404 from z13, Esri real data at
  // z15 in Cappadocia, Ararat and Istanbul). For most of the world it is the
  // better keyless default, so it should be the first alternative offered.
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
      // The bucket stops at z15 (registry.opendata.aws/terrain-tiles); a z16
      // request 404s, and S3's error response carries no CORS header, so it
      // also logged a CORS error on every zoomed-in view.
      maxzoom: 15,
      encoding: "terrarium",
    },
  },
  cesium: {
    name: "Cesium World Terrain - quantized mesh",
    link: "https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/",
    // The only ellipsoidal source among the built-ins.
    datum: "ellipsoidal",
    description: "Cesium ion asset 1, the terrain CesiumJS uses by default, consumed as an ordinary elevation source: the quantized-mesh TIN is rasterised per tile in the browser (see /dev/quantized-mesh-protocol). Heights are ELLIPSOIDAL - measured +48.1 m against an orthometric reference near Innsbruck, the alpine geoid separation - so summits read about 50 m high. Hidden until a Cesium ion token is set in Settings, since every ion asset is 401 without one.",
    encoding: "terrarium",
    sourceConfig: {
      type: "raster-dem",
      // The account token is NOT templated in: it lives in the protocol module
      // (a protocol URL is also the tile cache's key). See setCesiumIonToken.
      tiles: ["quantized-mesh://ion/1/{z}/{x}/{y}"],
      tileSize: 256,
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

/** Compact label for the map pill. Built-in names are "Mapterhorn -
 *  Terrarium" / "Esri World Elevation - LERC": everything before the first
 *  " - " is the part worth reading on a map corner.
 *
 *  A library/BYOD source is named "<ISO> - <dataset> - <transport>"
 *  ("FRA - IGN Lidar HD DTM - WMS raw Float32"). The ISO prefix is redundant
 *  on a map that is already showing that country, and the transport is an
 *  implementation detail, so both ends are trimmed and the middle kept. */
export function terrainShortLabel(
  id: string,
  customSources: readonly { id: string; name: string }[] = [],
): string {
  const builtin = terrainSources[id as TerrainSource]
  if (builtin) return builtin.name.split(" - ")[0]
  const custom = customSources.find((s) => s.id === id)
  if (!custom) return id
  const parts = custom.name.split(" - ").map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1 && /^([A-Z]{3}|Global)$/.test(parts[0])) parts.shift()
  // Trailing transport/encoding segment, e.g. "WCS raw Float32", "ImageServer
  // raw Float32", "Terrain-RGB", "single national COG", "derived", "PMTiles".
  const TRANSPORT = /\b(WMS|WCS|WMTS|TMS|XYZ|COG|VRT|PMTiles|ImageServer|MapServer|Terrain-?RGB|Terrarium|LERC|quantized[- ]mesh|titiler|raw Float32|derived)\b/i
  if (parts.length > 1 && TRANSPORT.test(parts[parts.length - 1])) parts.pop()
  return parts.join(" - ") || custom.name
}
