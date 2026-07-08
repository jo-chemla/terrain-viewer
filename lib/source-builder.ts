// Shared tile-source URL/config builder for both terrain (raster-dem) and basemap
// (raster) sources, given a source `type`. Consolidates what used to be two
// independently-drifting implementations: the terrain-only `cogTileUrl` and an inline
// COG-vs-titiler branch duplicated in RasterBasemapSource.
export type RasterSourceType =
  | "cog"
  | "vrt"
  | "tilejson"
  | "terrarium"
  | "terrainrgb"
  | "tms"
  | "wms"
  | "wmts"
  | "wms-raw"

export function buildRasterTileSource(params: {
  url: string
  type: RasterSourceType
  useCogProtocol: boolean
  titilerEndpoint: string
  scheme?: "xyz" | "tms"
  /** Elevation (raster-dem) sources need titiler's terrainrgb algorithm + the
   *  cog:// protocol's "#dem" hash (selects the DEM color function); plain
   *  raster imagery sources need neither. */
  isDem?: boolean
}): { url: string } | { tiles: string[]; scheme?: "xyz" | "tms" } {
  const { url, type, useCogProtocol, titilerEndpoint, scheme, isDem } = params

  switch (type) {
    case "tilejson":
      // MapLibre natively fetches and parses the TileJSON manifest (tiles array,
      // minzoom/maxzoom) — no protocol or titiler involvement needed.
      return { url }

    case "cog":
      return useCogProtocol
        ? { url: `cog://${url}${isDem ? "#dem" : ""}` }
        : {
            tiles: [
              isDem
                ? `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=0&resampling=bilinear&algorithm=terrainrgb&url=${encodeURIComponent(url)}`
                : `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(url)}`,
            ],
          }

    case "vrt":
      if (useCogProtocol) {
        console.warn("Warning, VRT can only work with TiTiler COG streaming")
        return { tiles: [url] }
      }
      return {
        tiles: [
          `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=-999&resampling=bilinear&algorithm=terrainrgb&url=vrt:///vsicurl/${encodeURIComponent(url)}`,
        ],
      }

    case "wms-raw":
      // A WMS GetMap URL returning a raw Float32 GeoTIFF — decoded by float32demProtocol.
      return { tiles: [`float32dem://${url.replace(/^https?:\/\//, "")}`] }

    // terrarium / terrainrgb / tms / wms / wmts: already a plain XYZ/WMS tile
    // template — nothing to route through titiler or a custom protocol.
    default:
      return { tiles: [url], ...(scheme === "tms" ? { scheme } : {}) }
  }
}
