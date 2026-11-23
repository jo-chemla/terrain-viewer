// The Worldwide Defaults: the global elevation services the app ships with,
// as entries of the shared source schema (lib/source-schema.ts), the same
// record a library entry or a saved source is. The ids are the URL's
// (?terrainSourceA=mapterhorn) and never change. lib/terrain-catalog.ts adds
// the library entries marked `section: "defaults"` (GEM-15) and is the one
// lookup the map, the contours, the exports and the tile service go through.
//
// Types only, no other import: Node imports this file without a bundler
// (docs/scripts/build-stac-catalog.mjs, tile-server/build.mjs).
import type { TerrainSourceEntry } from "./source-schema"

export const BUILTIN_TERRAIN_SOURCES: TerrainSourceEntry[] = [
  {
    id: "mapterhorn",
    name: "Mapterhorn - Terrarium",
    kind: "terrain",
    section: "defaults",
    type: "terrarium",
    url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
    tileSize: 512,
    maxzoom: 18,
    infoUrl: "https://mapterhorn.com/",
    description: "Mapterhorn terrain tiles with Terrarium encoding",
  },
  // Esri sits second on purpose. Where Mapterhorn has ingested a national
  // dataset it is the finer of the two, but everywhere else it falls back to
  // GLO-30 and stops serving tiles at z12; Esri's blend keeps going to z15-16
  // there (measured over Turkey: Mapterhorn 404 from z13, Esri real data at
  // z15 in Cappadocia, Ararat and Istanbul). For most of the world it is the
  // better keyless default, so it should be the first alternative offered.
  {
    id: "esri",
    name: "Esri World Elevation - LERC",
    kind: "terrain",
    section: "defaults",
    type: "lerc",
    // The tile pyramid, NOT exportImage: that endpoint only answers
    // anonymously from a ~2.5 km overview. ArcGIS orders the placeholders
    // z/y/x, which maplibre substitutes the same as any other order.
    url: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/TopoBathy3D/ImageServer/tile/{z}/{y}/{x}",
    tileSize: 256,
    // The service declares LOD 16; past that every pixel comes back masked,
    // so maplibre should overzoom the last real parent instead.
    maxzoom: 16,
    infoUrl: "https://www.arcgis.com/home/item.html?id=0c69ba5a5d254118841d43f03aa3e97d",
    description: "Esri's global best-available blend (Vantor, Airbus DS, USGS, NGA, NASA, CGIAR, GEBCO, LINZ, Ordnance Survey and others), TopoBathy variant: land AND seafloor as one continuous surface, so a hypsometric ramp or a 3D view reads across a coastline instead of stopping at it. Served as LERC - Esri's own float raster codec - and decoded in the browser by lerc:// (see /dev/lerc-protocol). Orthometric, keyless, CORS-open; check Esri's Terms of Use before publishing with it.",
  },
  {
    id: "mapbox",
    name: "Mapbox - TerrainRGB",
    kind: "terrain",
    section: "defaults",
    type: "terrainrgb",
    url: "https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.png?access_token={API_KEY}",
    apiKey: "mapboxKey",
    tileSize: 256,
    maxzoom: 14,
    infoUrl: "https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/",
    description: "Mapbox Terrain DEM v1 with TerrainRGB encoding",
  },
  {
    id: "maptiler",
    name: "MapTiler - TerrainRGB",
    kind: "terrain",
    section: "defaults",
    type: "terrainrgb",
    url: "https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key={API_KEY}",
    apiKey: "maptilerKey",
    tileSize: 512,
    maxzoom: 12,
    infoUrl: "https://www.maptiler.com/terrain/",
    description: "MapTiler terrain tiles with TerrainRGB encoding",
  },
  {
    id: "aws",
    name: "AWS Terrain - Terrarium Mapzen",
    kind: "terrain",
    section: "defaults",
    type: "terrarium",
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    tileSize: 256,
    // The bucket stops at z15 (registry.opendata.aws/terrain-tiles); a z16
    // request 404s, and S3's error response carries no CORS header, so it
    // also logged a CORS error on every zoomed-in view.
    maxzoom: 15,
    infoUrl: "https://registry.opendata.aws/terrain-tiles/",
    description: "AWS Terrain Tiles - Open Data Registry (Mapzen Terrarium encoding)",
  },
  {
    id: "cesium",
    name: "Cesium World Terrain - quantized mesh",
    kind: "terrain",
    section: "defaults",
    type: "quantized-mesh",
    // Cesium ion asset 1. The account token is NOT templated in: it lives in
    // the protocol module (a protocol URL is also the tile cache's key), see
    // setCesiumIonToken; the tile service adds it as `t` in Node.
    url: "ion/1",
    apiKey: "cesiumIonKey",
    // The only ellipsoidal source among the built-ins.
    datum: "ellipsoidal",
    tileSize: 256,
    maxzoom: 16,
    infoUrl: "https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/",
    description: "Cesium ion asset 1, the terrain CesiumJS uses by default, consumed as an ordinary elevation source: the quantized-mesh TIN is rasterised per tile in the browser (see /dev/quantized-mesh-protocol). Heights are ELLIPSOIDAL - measured +48.1 m against an orthometric reference near Innsbruck, the alpine geoid separation - so summits read about 50 m high. Hidden until a Cesium ion token is set in Settings, since every ion asset is 401 without one.",
  },
  // Removed: Mapzen (the service was discontinued; the same tiles are AWS's
  // above) and Google 3D Tiles (not a raster-dem; reachable through the
  // "Google Maps 3D" / "Google Earth 3D (web)" Open-In destinations instead,
  // see open-in-links.tsx).
]

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
  customSources: readonly { id: string; name: string; shortName?: string }[] = [],
): string {
  const builtin = BUILTIN_TERRAIN_SOURCES.find((s) => s.id === id)
  if (builtin) return builtin.name.split(" - ")[0]
  const custom = customSources.find((s) => s.id === id)
  if (!custom) return id
  if (custom.shortName) return custom.shortName
  const parts = custom.name.split(" - ").map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1 && /^([A-Z]{3}|Global)$/.test(parts[0])) parts.shift()
  // Trailing transport/encoding segment, e.g. "WCS raw Float32", "ImageServer
  // raw Float32", "Terrain-RGB", "single national COG", "derived", "PMTiles".
  const TRANSPORT = /\b(WMS|WCS|WMTS|TMS|XYZ|COG|VRT|PMTiles|ImageServer|MapServer|Terrain-?RGB|Terrarium|LERC|quantized[- ]mesh|titiler|raw Float32|derived)\b/i
  if (parts.length > 1 && TRANSPORT.test(parts[parts.length - 1])) parts.pop()
  return parts.join(" - ") || custom.name
}
