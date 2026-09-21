// Resolves a LngLatBounds tuple for the "Map Bounds" settings feature — reuses the
// exact same per-source-type bounds detection as handleFitToBounds in
// terrain-source-section.tsx (static .bounds field, tilejson manifest fetch, COG
// metadata via geomatico's protocol or titiler), but for constraining maplibre's
// `maxBounds` rather than one-shot flying the camera.
import { getCogMetadata } from "@geomatico/maplibre-cog-protocol"
import type { CustomTerrainSource, CustomBasemapSource } from "./settings-atoms"
import { resolveLocalFileUrl, localFileId } from "./local-file-store"
import customSources from "./custom-sources.json"

// id -> shipped sample definition, across both terrain and basemap sample lists.
const SAMPLE_SOURCES_BY_ID: Record<string, { bounds?: LngLatBoundsTuple }> = Object.fromEntries(
  [...customSources.SAMPLE_TERRAIN_SOURCES, ...customSources.SAMPLE_BASEMAPS_SOURCES]
    .map((s) => [(s as { id: string }).id, s as { bounds?: LngLatBoundsTuple }]),
)

export type MaxBoundsMode = "none" | "terrain" | "raster" | "union" | "custom"
export const MAX_BOUNDS_MODES = ["none", "terrain", "raster", "union", "custom"] as const

export type LngLatBoundsTuple = [west: number, south: number, east: number, north: number]

/** A source's static extent: its own `bounds`, else the shipped sample with the
 *  same id. Sources are copied into localStorage on first use, so a copy saved
 *  before a sample gained `bounds` would otherwise stay boundless forever —
 *  which made "fit to bounds" do nothing while maxBounds still constrained to
 *  the right country. Both paths must agree, hence one helper. */
export function staticBoundsFor(
  source: { id?: string; bounds?: LngLatBoundsTuple } | undefined,
): LngLatBoundsTuple | null {
  if (!source) return null
  if (source.bounds) return source.bounds
  const sample = source.id ? SAMPLE_SOURCES_BY_ID[source.id] : undefined
  return sample?.bounds ?? null
}

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
  const staticBounds = staticBoundsFor(source)
  if (staticBounds) return staticBounds

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
      // Per-source pin wins (see terrain-source-section.tsx's handleFitToBounds).
      if (opts.useCogProtocolVsTitiler && !("cogViaTitiler" in source && source.cogViaTitiler)) {
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

/** Does `target` fall (even partly) outside the fence currently applied to
 *  `map`? Used to explain a fly-to that will visibly not arrive: maplibre
 *  clamps the camera to `maxBounds` silently, so asking to go somewhere
 *  outside it just leaves you where you were with no reason given. */
export function outsideFence(
  map: { getMaxBounds?: () => { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number } | null } | null | undefined,
  target: LngLatBoundsTuple,
): boolean {
  const fence = map?.getMaxBounds?.()
  if (!fence) return false
  const [west, south, east, north] = target
  // Any overlap at all counts as reachable — a fly-to to a partly-visible
  // extent still lands somewhere useful. Only a target with NO intersection
  // is worth interrupting for.
  return west > fence.getEast() || east < fence.getWest()
    || south > fence.getNorth() || north < fence.getSouth()
}
