// Shared tile-source URL/config builder for both terrain (raster-dem) and basemap
// (raster) sources, given a source `type`. Consolidates what used to be two
// independently-drifting implementations: the terrain-only `cogTileUrl` and an inline
// COG-vs-titiler branch duplicated in RasterBasemapSource.
import { appendNodataMarkers, type NodataConfig } from "./nodata"
import { buildDemFixUrl } from "./demfix-protocol"

export type RasterSourceType =
  | "dem-diff"
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
  /** Out-of-coverage floor/fill in metres (lib/nodata.ts). Only the float32dem
   *  branch consumes these — the cog:// branch carries them via the protocol's
   *  color function instead, since a `cog://` URL is just the file's address. */
  nodata?: NodataConfig
  /** titiler `nodata=` override for the cog/vrt titiler branches; see
   *  CustomTerrainSource.titilerNodata. Unset keeps the historical defaults. */
  titilerNodata?: number
}): { url: string } | { tiles: string[]; scheme?: "xyz" | "tms" } {
  const { url, type, useCogProtocol, titilerEndpoint, scheme, isDem, nodata, titilerNodata } = params

  switch (type) {
    case "tilejson":
      // MapLibre natively fetches and parses the TileJSON manifest (tiles array,
      // minzoom/maxzoom) — no protocol or titiler involvement needed.
      return { url }

    case "cog":
      // reproject=bilinear: titiler's `resampling` only covers the read (overview
      // decimation); the warp from the file's CRS to Web Mercator has its own
      // kernel, `reproject`, and it defaults to nearest - which drew every 30 m
      // cell of an EPSG:4674/4326 DEM as a cross-hatched staircase at z13+
      // (measured: second-difference roughness 2.6 m nearest vs 0.27 m bilinear).
      return useCogProtocol
        ? { url: `cog://${url}${isDem ? "#dem" : ""}` }
        : {
            tiles: [
              isDem
                ? // encodeURIComponent: a float32 sentinel like 3.4e38 stringifies as
                  // "3.4e+38", and a raw "+" in a query string is a space.
                  buildDemFixUrl(`${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=${encodeURIComponent(String(titilerNodata ?? 0))}&resampling=bilinear&reproject=bilinear&algorithm=terrainrgb&url=${encodeURIComponent(url)}`)
                : `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?resampling=bilinear&reproject=bilinear&url=${encodeURIComponent(url)}`,
            ],
          }

    case "vrt":
      if (useCogProtocol) {
        console.warn("Warning, VRT can only work with TiTiler COG streaming")
        return { tiles: [url] }
      }
      return {
        tiles: [
          buildDemFixUrl(`${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=${titilerNodata ?? -999}&resampling=bilinear&reproject=bilinear&algorithm=terrainrgb&url=vrt:///vsicurl/${encodeURIComponent(url)}`),
        ],
      }

    case "wms-raw":
      if (useCogProtocol) {
        // geomatico's cogProtocol reads a real COG file directly — it can't stream a
        // live WMS endpoint, so geomatico mode always goes through the client-side
        // float32dem:// protocol (decoded by float32demProtocol), regardless of what
        // FORMAT the source's own GetMap URL requests.
        // The nodata pair rides along as URL markers — float32demProtocol gets a
        // URL and nothing else — and is stripped again before the GetMap goes out.
        return { tiles: [appendNodataMarkers(`float32dem://${url.replace(/^https?:\/\//, "")}`, nodata ?? {})] }
      }
      // Titiler mode: GDAL's WMS minidriver (the `WMS:` connection-string prefix)
      // lets titiler/GDAL treat the live WMS service as a single addressable raster
      // dataset — the same trick the VRT case below uses (vrt:///vsicurl/) — so
      // titiler handles reprojection/windowing server-side per z/x/y tile instead of
      // this app hand-rolling per-tile GetMap+bbox requests itself.
      return {
        tiles: [
          buildDemFixUrl(`${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=0&resampling=bilinear&reproject=bilinear&algorithm=terrainrgb&url=${encodeURIComponent(`WMS:${url}`)}`),
        ],
      }

    // terrarium / terrainrgb / tms / wms / wmts: already a plain XYZ/WMS tile
    // template — nothing to route through titiler or a custom protocol.
    default:
      return { tiles: [url], ...(scheme === "tms" ? { scheme } : {}) }
  }
}
