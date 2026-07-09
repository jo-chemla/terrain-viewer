// Thin wrapper around @loaders.gl/wms's WMSImageSource — delegates the fiddly WMS
// spec quirks (1.1.1 vs 1.3.0 param naming, EPSG:4326 axis flip, CRS substitution)
// to the SDK instead of hand-parsing GetCapabilities XML or hand-building GetMap
// URLs, as this app previously required users to do themselves (see the "wms"/
// "wms-raw" URL placeholders in custom-basemap-modal.tsx / custom-terrain-source-modal.tsx).

import { WMSImageSource } from "@loaders.gl/wms"
import type { WMSCapabilities, WMSLayer } from "@loaders.gl/wms"

export type { WMSCapabilities, WMSLayer }

export interface FlatWmsLayer {
  name: string
  title: string
  abstract?: string
  geographicBoundingBox?: [min: [number, number], max: [number, number]]
}

function flattenLayers(layers: WMSLayer[] | undefined, out: FlatWmsLayer[] = []): FlatWmsLayer[] {
  for (const layer of layers || []) {
    if (layer.name) {
      out.push({
        name: layer.name,
        title: layer.title || layer.name,
        abstract: layer.abstract,
        geographicBoundingBox: layer.geographicBoundingBox,
      })
    }
    if (layer.layers?.length) flattenLayers(layer.layers, out)
  }
  return out
}

export interface WmsServiceInfo {
  source: WMSImageSource
  capabilities: WMSCapabilities
  layers: FlatWmsLayer[]
}

/** Fetches and parses a WMS endpoint's GetCapabilities document, returning a flat
 *  (sub-layers inlined) list of renderable layers alongside the underlying
 *  WMSImageSource — reuse `source.getMapURL(...)` (via buildWmsTileUrl below) to
 *  build a GetMap URL for a selected layer without re-deriving WMS version/CRS/
 *  axis-order quirks. */
export async function fetchWmsService(baseUrl: string): Promise<WmsServiceInfo> {
  const source = new WMSImageSource(baseUrl, {
    // fast-xml-parser (used internally by @loaders.gl/xml) caps total entity
    // references at 1000 by default as a billion-laughs guard. Large government
    // WMS capabilities documents (e.g. IGN's data.geopf.fr/wms-r, with thousands
    // of layers each carrying "&amp;"-style entities in their titles/abstracts)
    // blow past that on legitimate documents, throwing "Entity expansion limit
    // exceeded" — raise the cap rather than disable the guard outright.
    loadOptions: {
      wms: {
        xml: {
          _fastXML: {
            processEntities: { enabled: true, maxTotalExpansions: 100_000 },
          },
        },
      },
    },
  })
  const capabilities = await source.getCapabilities()
  return { source, capabilities, layers: flattenLayers(capabilities.layers) }
}

export interface BuildWmsTileUrlParams {
  source: WMSImageSource
  layerName: string
  tileSize?: number
  crs?: string
  format?: string
  transparent?: boolean
}

/** Builds a `{bbox-epsg-3857}`-templated GetMap URL for a layer — the placeholder
 *  convention this app's raster sources already expect for hand-entered "wms"/
 *  "wms-raw" sources (see lib/source-builder.ts, which passes such URLs straight
 *  through to MapLibre's raster tile source, itself resolving that placeholder). */
export function buildWmsTileUrl({
  source,
  layerName,
  tileSize = 256,
  crs = "EPSG:3857",
  format = "image/png",
  transparent = true,
}: BuildWmsTileUrlParams): string {
  const url = source.getMapURL({
    layers: [layerName],
    crs,
    bbox: [0, 0, 0, 0],
    width: tileSize,
    height: tileSize,
    format: format as "image/png",
    transparent,
  })
  // getMapURL always upper-cases the BBOX key regardless of WMS version — safe to
  // regex out its placeholder value since it's the only BBOX= occurrence in the URL.
  return url.replace(/BBOX=[^&]*/i, "BBOX={bbox-epsg-3857}")
}
