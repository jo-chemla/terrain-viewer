// Titiler-independent DTM export. Runs entirely in the browser: COGs are read via
// direct HTTP range requests (geotiff.js), TMS terrainrgb/terrarium sources are
// mosaicked from individually-fetched tiles (lib/tile-mosaic.ts). This bypasses
// titiler's server-side canvas/timeout limits, so it's the path to use for exports
// larger than the "maxResolution" setting the titiler pipeline is comfortable with.
//
// Deliberately narrow in scope: per-project decision, only cog/terrainrgb/terrarium
// are supported here (vrt/stac/mosaicjson need server-side GDAL mosaicking; wms-raw
// and tilejson are low-value enough to not justify a bespoke client path). Those
// types keep working through the existing titiler export in download-section.tsx.

import { terrainrgbToElevation, terrariumToElevation } from "./elevation-encoding"
import { fetchTileMosaic, pickZoomForResolution } from "./tile-mosaic"
import { terrainSources } from "./terrain-sources"
import type { TerrainSource } from "./terrain-types"
import type { CustomTerrainSource } from "./settings-atoms"
import { resolveLocalFileUrl, localFileId } from "./local-file-store"

export type ClientExportableType = "cog" | "terrainrgb" | "terrarium"

export interface ClientExportSource {
  type: ClientExportableType
  url: string
  tileSize: number
  maxzoom: number
}

export function isClientExportSupported(type: string | undefined): type is ClientExportableType | "cog-local" {
  return type === "cog" || type === "cog-local" || type === "terrainrgb" || type === "terrarium"
}

/** Resolves a sourceA key (built-in or custom) into the raw, un-wrapped tile/COG URL
 *  this module needs — i.e. never a `cog://` or titiler-proxied URL, since both the
 *  range-read and the tile-mosaic paths fetch the origin server directly. Returns
 *  null for a "cog-local" source that hasn't been (re-)picked this session, same
 *  "not ready" shape as an unsupported type. */
export function getClientExportSource(
  sourceKey: string,
  customTerrainSources: CustomTerrainSource[],
  getTilesUrl: (key: TerrainSource) => string,
): ClientExportSource | null {
  const builtin = (terrainSources as any)[sourceKey]
  if (builtin) {
    if (!isClientExportSupported(builtin.encoding)) return null
    return {
      type: builtin.encoding,
      url: getTilesUrl(sourceKey as TerrainSource),
      tileSize: builtin.sourceConfig.tileSize || 256,
      maxzoom: builtin.sourceConfig.maxzoom || 20,
    }
  }

  const custom = customTerrainSources.find((s) => s.id === sourceKey)
  if (!custom || !isClientExportSupported(custom.type)) return null
  if (custom.type === "cog-local") {
    const resolvedUrl = resolveLocalFileUrl(localFileId(custom.url))
    if (!resolvedUrl) return null
    return { type: "cog", url: resolvedUrl, tileSize: 256, maxzoom: custom.maxzoom || 22 }
  }
  return {
    type: custom.type,
    url: custom.url,
    tileSize: 256,
    maxzoom: custom.maxzoom || (custom.type === "cog" ? 22 : 20),
  }
}

export interface ClientExportResult {
  data: Float32Array
  width: number
  height: number
  bbox: [west: number, south: number, east: number, north: number]
}

function lonLatToWebMercator(lon: number, lat: number): [number, number] {
  const R = 6378137
  const x = (R * (lon * Math.PI)) / 180
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return [x, y]
}

export async function exportCogWindow(
  url: string,
  bbox: [number, number, number, number],
  width: number,
  height: number,
): Promise<ClientExportResult> {
  const { fromUrl } = await import("geotiff")
  const tiff = await fromUrl(url)
  const image = await tiff.getImage()

  // COGs store raw altitude per pixel already — no terrainrgb/terrarium decoding
  // needed, just a windowed read at the requested bbox/resolution.
  const rasterBbox = image.getBoundingBox() as [number, number, number, number]
  const isGeographic = rasterBbox.every((v, i) => Math.abs(v) <= (i % 2 === 0 ? 180 : 90))
  const [west, south, east, north] = bbox
  const reqBbox: [number, number, number, number] = isGeographic
    ? [west, south, east, north]
    : (() => {
        const [minX, minY] = lonLatToWebMercator(west, south)
        const [maxX, maxY] = lonLatToWebMercator(east, north)
        return [minX, minY, maxX, maxY]
      })()

  const rasters = await image.readRasters({ bbox: reqBbox, width, height, resampleMethod: "bilinear" })
  const data = Float32Array.from(rasters[0] as ArrayLike<number>)
  return { data, width, height, bbox }
}

export interface ExportElevationClientSideParams {
  source: ClientExportSource
  bbox: [number, number, number, number]
  /** Sizing hint (e.g. the existing maxResolution setting) — for tile sources this
   *  picks a zoom level whose native tile grid meets or exceeds it; for cog it's used
   *  directly as the output width/height. */
  targetResolution: number
  onProgress?: (fraction: number) => void
}

export async function exportElevationClientSide(
  params: ExportElevationClientSideParams,
): Promise<ClientExportResult> {
  const { source, bbox, targetResolution, onProgress } = params

  if (source.type === "cog") {
    onProgress?.(0)
    const result = await exportCogWindow(source.url, bbox, targetResolution, targetResolution)
    onProgress?.(1)
    return result
  }

  const zoom = pickZoomForResolution(bbox, targetResolution, targetResolution, source.tileSize, source.maxzoom)
  const decodePixel = source.type === "terrainrgb" ? terrainrgbToElevation : terrariumToElevation
  return fetchTileMosaic({ tileUrlTemplate: source.url, tileSize: source.tileSize, bbox, zoom, decodePixel, onProgress })
}
