// The app's terrain source readers, for Node (re-exported by app-render.ts,
// bundled into generated/app-render.mjs): the tile spec of any source the app
// reads (lib/terrain-tile-spec.ts) and the protocols that read them,
// registered through the app's registry (lib/protocol-registry.ts) as
// TerrainViewer.tsx registers them for the map:
//
//   cog://             a COG read by geotiff.js (geomatico's reader), with the
//                      elevation colour function the map registers
//   vrt://             a GDAL VRT mosaic, its files Range-read by geotiff.js;
//                      also GEM-15, Open Buildings and Meta's canopy height
//   float32dem(-bbox)  a WMS / WCS / ArcGIS exportImage answering Float32 GeoTIFF
//   lerc://            an ArcGIS tiled elevation service (LERC, wasm decoder)
//   quantized-mesh://  Cesium terrain meshes, rasterised
//   demdiff://         the difference of two sources (nDSM, change)
//   pmtiles://         a PMTiles archive
//   epsg3395://        tiles cut in World Mercator
//   epsg4326://        tiles on the geographic WGS84 grid
//
// Plain https pyramids, titiler tiles and TileJSON manifests need no protocol.
// geotiff.js decodes on the calling thread here: the app's own pools only
// start where there is a Worker global, which Node lacks.
import { registerProtocol, dispatchTile, customScheme } from "../lib/protocol-registry"
import { cogProtocol, getCogMetadata, setColorFunction } from "@geomatico/maplibre-cog-protocol"
import { Protocol as PmtilesProtocol } from "pmtiles"
import { float32demProtocol } from "../lib/float32dem-protocol"
import { vrtProtocol, getVrtInfo } from "../lib/vrt-protocol"
import { demDiffProtocol } from "../lib/demdiff-protocol"
import { lercProtocol } from "../lib/lerc-protocol"
import { quantizedMeshProtocol } from "../lib/quantized-mesh-protocol"
import { epsg3395Protocol, epsg4326Protocol } from "../lib/epsg3395-protocol"
import { loadTileBitmap } from "../lib/normal-derived-protocol"
import { zoomRangeFromMetadata } from "../lib/cog-metadata"
import { resolveNodata } from "../lib/nodata"
import { writeTerrarium, writeTerrainrgb } from "../lib/elevation-encoding"
import type { CustomTerrainSource } from "../lib/settings-atoms"
import { terrainTileSpec, terrainTileInputs, terrainTileExtras, makeElevationColorFunction, type TerrainTileSpec, type TilejsonMetadata } from "../lib/terrain-tile-spec"

export { terrainTileSpec, terrainTileInputs, terrainTileExtras, dispatchTile, customScheme, loadTileBitmap }
export type { TerrainTileSpec }

let registered = false
/** Registers the source protocols once, as TerrainViewer.tsx does for the map
 *  (without its result cache: the callers here keep their own). */
export function registerSourceProtocols(): void {
  if (registered) return
  registered = true
  registerProtocol("cog", cogProtocol)
  registerProtocol("float32dem", float32demProtocol)
  registerProtocol("vrt", vrtProtocol)
  registerProtocol("demdiff", demDiffProtocol)
  registerProtocol("lerc", lercProtocol)
  registerProtocol("quantized-mesh", quantizedMeshProtocol)
  registerProtocol("pmtiles", new PmtilesProtocol().tile)
  registerProtocol("epsg3395", epsg3395Protocol)
  registerProtocol("epsg4326", epsg4326Protocol)
  // A WMS GetMap per tile (lib/normal-derived-protocol.ts's pseudo-scheme,
  // which the app's decoders resolve before the registry): registered here
  // too, so that any template a spec returns can be dispatched (contours).
  registerProtocol("float32dem-bbox", async (params, controller) => {
    const data = await loadTileBitmap(params.url, controller.signal)
    if (!data) throw Object.assign(new Error(`no tile: ${params.url.slice(0, 120)}`), { status: 404 })
    return { data }
  })
}

/** The settings the map would use, with the app's defaults. */
export interface SourceSettings {
  titilerEndpoint?: string
  useCogProtocol?: boolean
  highResTerrain?: boolean
  cesiumDetailOffset?: number
  /** API keys, by the app's setting names: filled into Mapbox's and
   *  MapTiler's tile addresses, and Cesium ion's token into the
   *  quantized-mesh address (the `t` parameter, read in Node only). */
  mapboxKey?: string
  maptilerKey?: string
  cesiumIonKey?: string
}

/** A resolved source: the spec, plus what the map registers on the side. */
export type ResolvedTerrainTiles = TerrainTileSpec

const tilejsonCache = new Map<string, Promise<TilejsonMetadata | null>>()
const colorFunctionSet = new Set<string>()

/**
 * The tile spec of a terrain source, fetching first what the map's hooks wait
 * for (a TileJSON manifest, a COG header, a VRT index, the two operands of a
 * difference). `custom` is the source's entry (a Worldwide Default, a
 * library entry, a configuration); undefined, `id` is looked up among the
 * Worldwide Defaults. `lookup` finds the entry of a difference's operand.
 * null when the source cannot be read here: a 3D tiles, STAC or MosaicJSON
 * entry, a local file, a COG the in-browser reader refuses (not Web
 * Mercator), or a manifest that does not answer.
 */
export async function resolveTerrainTiles(
  id: string,
  custom: CustomTerrainSource | undefined,
  lookup: (id: string) => CustomTerrainSource | undefined,
  settings: SourceSettings = {},
  nested = false,
): Promise<ResolvedTerrainTiles | null> {
  const ctx = {
    titilerEndpoint: settings.titilerEndpoint ?? "https://titiler.xyz",
    useCogProtocol: settings.useCogProtocol ?? true,
    highResTerrain: settings.highResTerrain ?? true,
    cesiumDetailOffset: settings.cesiumDetailOffset ?? 1,
    mapboxKey: settings.mapboxKey,
    maptilerKey: settings.maptilerKey,
  }
  if (custom?.type === "cog-local") return null
  const inputs = terrainTileInputs(custom, ctx.useCogProtocol)

  let tilejson: TilejsonMetadata | null = null
  if (inputs.tilejsonUrl) {
    const url = inputs.tilejsonUrl
    if (!tilejsonCache.has(url)) tilejsonCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null))
    tilejson = await tilejsonCache.get(url)!
  }

  let cogZoomRange: { minzoom: number; maxzoom: number } | null = null
  if (inputs.cogUrl) {
    const url = inputs.cogUrl
    const meta = await getCogMetadata(url).catch(() => null)
    if (!meta) return null
    cogZoomRange = zoomRangeFromMetadata(meta)
    // The colour function TerrainSources registers for the map's COG: it
    // decodes the file's values (scale, offset, nodata) into the tile's
    // RGB packing, so the spec's encoding is what cog:// returns.
    const key = `${url}|${ctx.highResTerrain}`
    if (!colorFunctionSet.has(key)) {
      colorFunctionSet.add(key)
      setColorFunction(url, makeElevationColorFunction(ctx.highResTerrain ? writeTerrarium : writeTerrainrgb, meta.scale ?? 1, meta.offset ?? 0, meta.noData, resolveNodata(custom ?? {})))
    }
  }

  const vrtInfo = inputs.vrtUrl ? await getVrtInfo(inputs.vrtUrl).catch(() => null) : null
  if (inputs.vrtUrl && !vrtInfo) return null

  let diffOperands: [TerrainTileSpec, TerrainTileSpec] | null = null
  if (inputs.diff) {
    if (nested) return null
    const ops = await Promise.all(inputs.diff.map((opId) => resolveTerrainTiles(opId, lookup(opId), lookup, settings, true)))
    if (!ops[0] || !ops[1]) return null
    diffOperands = [ops[0], ops[1]]
  }

  const spec = terrainTileSpec(id, custom, { ...ctx, tilejson, cogZoomRange, vrtInfo, diffOperands })
  if (!spec) return null
  if (settings.cesiumIonKey && spec.template.startsWith("quantized-mesh://ion/")) {
    spec.template += `${spec.template.includes("?") ? "&" : "?"}t=${encodeURIComponent(settings.cesiumIonKey)}`
  }
  return { ...spec, ...terrainTileExtras(custom, { tilejson, vrtInfo }) }
}
