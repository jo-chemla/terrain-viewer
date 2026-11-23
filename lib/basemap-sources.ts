// The built-in imagery basemaps with a fixed tile address, as entries of the
// shared source schema (lib/source-schema.ts), the record a basemap library
// entry or a user's own basemap is. Their ids are the URL's
// (?basemapSourceA=google) and never change. A keyed one names its key
// (`apiKey`) and is offered once that key is set.
//
// Not here, because their tiles are made at run time rather than read from
// one address: the dated imagery (wayback, hls, ge-historical, planet,
// eox-s2: lib/historical-sources.ts), OpenFreeMap Liberty's vector style
// ("osm") and "none".
//
// maxzoom values mirror https://github.com/Iconem/historical-satellite/blob/main/src/utilities.tsx
import type { RasterSourceEntry } from "./source-schema"

export const BUILTIN_BASEMAP_SOURCES: RasterSourceEntry[] = [
  { id: "google", name: "Google Hybrid", shortName: "Google", kind: "raster", section: "defaults", type: "tms", url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", tileSize: 256, maxzoom: 21 },
  // Public quadkey endpoint (no session token to expire), same one historical-satellite uses.
  { id: "bing", name: "Bing Aerial", shortName: "Bing", kind: "raster", section: "defaults", type: "tms", url: "https://t.ssl.ak.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=14603&n=z&prx=1", tileSize: 256, maxzoom: 21 },
  // blankTile=false: past its imagery, Esri answers a 404 instead of a 200
  // "Map data not yet available" placeholder JPEG, so MapLibre shows the
  // parent tile enlarged rather than drawing the placeholder.
  { id: "esri", name: "ESRI World Imagery", shortName: "ESRI", kind: "raster", section: "defaults", type: "tms", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}.jpg?blankTile=false", tileSize: 256, maxzoom: 19 },
  { id: "mapbox", name: "Mapbox Satellite", shortName: "Mapbox", kind: "raster", section: "defaults", type: "tms", url: "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token={API_KEY}", apiKey: "mapboxKey", tileSize: 256, maxzoom: 22 },
  { id: "maptiler", name: "MapTiler Satellite", shortName: "MapTiler", kind: "raster", section: "defaults", type: "tms", url: "https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={API_KEY}", apiKey: "maptilerKey", tileSize: 256, maxzoom: 20 },
  { id: "here", name: "HERE Satellite", shortName: "HERE", kind: "raster", section: "defaults", type: "tms", url: "https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?style=satellite.day&apiKey={API_KEY}", apiKey: "hereKey", tileSize: 256, maxzoom: 20 },
  { id: "googlesat", name: "Google Satellite", shortName: "Google Sat", kind: "raster", section: "defaults", type: "tms", url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", tileSize: 256, maxzoom: 21 },
]

const BY_ID = new Map(BUILTIN_BASEMAP_SOURCES.map((s) => [s.id, s]))

/** A built-in basemap's entry by id, or undefined (a dated, vector or user source). */
export function builtinBasemap(id: string | null | undefined): RasterSourceEntry | undefined {
  return id ? BY_ID.get(id) : undefined
}
