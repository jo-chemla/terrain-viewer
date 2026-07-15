// Resolves a LngLatBounds tuple for the "Map Bounds" settings feature — reuses the
// exact same per-source-type bounds detection as handleFitToBounds in
// terrain-source-section.tsx (static .bounds field, tilejson manifest fetch, COG
// metadata via geomatico's protocol or titiler), but for constraining maplibre's
// `maxBounds` rather than one-shot flying the camera.
import { getCogMetadata } from "@geomatico/maplibre-cog-protocol"
import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"
import { resolveLocalFileUrl, localFileId } from "./local-file-store"

export type MaxBoundsMode = "none" | "terrain" | "raster" | "union" | "custom"
export const MAX_BOUNDS_MODES = ["none", "terrain", "raster", "union", "custom"] as const

export type LngLatBoundsTuple = [west: number, south: number, east: number, north: number]

export function unionBounds(a: LngLatBoundsTuple | null, b: LngLatBoundsTuple | null): LngLatBoundsTuple | null {
  if (!a) return b
  if (!b) return a
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

export function bufferBounds(bounds: LngLatBoundsTuple, bufferDegrees: number): LngLatBoundsTuple {
  const [west, south, east, north] = bounds
  return [
    Math.max(-180, west - bufferDegrees),
    Math.max(-90, south - bufferDegrees),
    Math.min(180, east + bufferDegrees),
    Math.min(90, north + bufferDegrees),
  ]
}

interface ResolveOpts {
  useCogProtocolVsTitiler: boolean
  titilerEndpoint: string
}

/** Best-effort bounds lookup for a custom terrain/basemap source — returns null
 *  (no constraint) rather than throwing when a source has no known/fetchable
 *  extent (e.g. a worldwide built-in source, or a fetch failure). */
export async function resolveCustomSourceBounds(
  source: (CustomTerrainSource | CustomBasemapSource) | undefined,
  opts: ResolveOpts,
): Promise<LngLatBoundsTuple | null> {
  if (!source) return null
  if (source.bounds) return source.bounds

  if (source.type === "tilejson") {
    try {
      const res = await fetch(source.url)
      const data = await res.json()
      if (data.bounds) return data.bounds as LngLatBoundsTuple
    } catch (error) {
      console.error("Failed to fetch TileJSON bounds for max-bounds:", error)
    }
    return null
  }

  if (source.type === "cog-local") {
    const resolvedUrl = resolveLocalFileUrl(localFileId(source.url))
    if (!resolvedUrl) return null // not (re-)picked yet this session
    try {
      const metadata = await getCogMetadata(resolvedUrl)
      if (metadata?.bbox) return metadata.bbox as LngLatBoundsTuple
    } catch (error) {
      console.error("Failed to fetch local COG bounds for max-bounds:", error)
    }
    return null
  }

  if (source.type === "cog" || source.type === "vrt") {
    try {
      if (opts.useCogProtocolVsTitiler) {
        const metadata = await getCogMetadata(source.url)
        if (metadata?.bbox) return metadata.bbox as LngLatBoundsTuple
      } else {
        const infoUrl = `${opts.titilerEndpoint}/cog/info.geojson?url=${encodeURIComponent(source.url)}`
        const res = await fetch(infoUrl)
        const data = await res.json()
        const bbox = data.bbox ?? data.properties?.bounds
        if (bbox) return bbox as LngLatBoundsTuple
      }
    } catch (error) {
      console.error("Failed to fetch COG bounds for max-bounds:", error)
    }
    return null
  }

  // Built-in (non-custom) sources and other custom types (wms/wmts/terrainrgb/
  // terrarium/stac/mosaicjson/wms-raw) have no static bounds field and no cheap
  // metadata fetch here — treated as unbounded (worldwide), same as "none".
  return null
}
