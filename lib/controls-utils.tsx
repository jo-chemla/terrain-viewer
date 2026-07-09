import { useCallback } from "react"
import { useAtom } from "jotai"
import { useQueryState, parseAsStringLiteral } from "nuqs"
import { terrainSources } from "@/lib/terrain-sources"
import { buildRasterTileSource } from "@/lib/source-builder"
import {
  mapboxKeyAtom, googleKeyAtom, maptilerKeyAtom, titilerEndpointAtom,
  customTerrainSourcesAtom, customBasemapSourcesAtom
} from "@/lib/settings-atoms"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource, CustomBasemapSource } from "@/lib/settings-atoms"

export interface SourceConfig {
  encoding: string
  tileUrl: string
  tileSize: number
  /** True when this source type can't produce a {z}/{x}/{y} tile pyramid for
   *  buildGdalWmsXml to wrap (wms-raw's float32 GetMap URL, tilejson's manifest
   *  link) — titiler DTM export isn't possible for it. */
  unsupported?: boolean
}

export type Bounds = { west: number; east: number; north: number; south: number }

/** Whether "fit to bounds" should actually move the camera: only when the target
 *  bounds are fully inside the current viewport (zooming in on something already
 *  visible), or fully disjoint from it (nothing in common, worth flying there) —
 *  never when the target only partially overlaps the viewport, or fully contains
 *  it (e.g. a world-covering basemap), since either would yank the user's context
 *  away from where they're already looking. */
export function shouldZoomToBounds(viewport: Bounds, target: Bounds): boolean {
  const fullyWithin =
    target.west >= viewport.west && target.east <= viewport.east &&
    target.south >= viewport.south && target.north <= viewport.north
  const disjoint =
    target.east < viewport.west || target.west > viewport.east ||
    target.north < viewport.south || target.south > viewport.north
  return fullyWithin || disjoint
}

export const useTheme = () => {
  const [theme, setTheme] = useQueryState(
    "theme",
    parseAsStringLiteral(["light", "dark"] as const).withDefault("light"),
  )
  const toggleTheme = useCallback(() => setTheme(theme === "light" ? "dark" : "light"), [theme, setTheme])
  return { theme, toggleTheme }
}

export const useSourceConfig = () => {
  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)
  const [googleKey] = useAtom(googleKeyAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)

  const getTilesUrl = useCallback((key: TerrainSource): string => {
    const source = (terrainSources as any)[key]
    if (!source) return ""
    let tileUrl = source.sourceConfig.tiles[0] || ""
    if (key === "mapbox") tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
    else if (key === "maptiler") tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")
    else if (key === "google3dtiles") tileUrl = tileUrl.replace("{API_KEY}", googleKey || "")
    return tileUrl
  }, [mapboxKey, maptilerKey, googleKey])

  // Titiler DTM export always needs a real {z}/{x}/{y} tile template to wrap in a
  // GDAL WMS descriptor — never the cog:// pseudo-protocol MapLibre uses for live
  // rendering — so useCogProtocol is hardcoded false here regardless of the user's
  // live-map rendering preference (useCogProtocolVsTitilerAtom).
  const getCustomSourceUrl = useCallback((source: CustomTerrainSource): string => {
    const built = buildRasterTileSource({
      url: source.url,
      // 'stac'/'mosaicjson' aren't real RasterSourceType members (they're not even
      // selectable in custom-terrain-source-modal.tsx) and callers already route
      // those, along with wms-raw/tilejson, away from this function — see the
      // `unsupported` branch in getSourceConfig below.
      type: source.type as Parameters<typeof buildRasterTileSource>[0]["type"],
      useCogProtocol: false,
      titilerEndpoint,
      isDem: true,
    })
    return "tiles" in built ? built.tiles[0] : built.url
  }, [titilerEndpoint])

  const getCustomBasemapUrl = useCallback((source: CustomBasemapSource): string => {
    if (source.type === "cog") {
      return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(source.url)}`
    }
    return source.url
  }, [titilerEndpoint])

  const getBasemapSourceConfig = useCallback((sourceKey: string): SourceConfig | null => {
    const customSource = customBasemapSources.find((s) => s.id === sourceKey)
    if (customSource) {
      const tileUrl = getCustomBasemapUrl(customSource)
      return {
        encoding: customSource.type === "cog" ? "cog" : "tms",
        tileUrl,
        tileSize: 256
      }
    }
    return null
  }, [customBasemapSources, getCustomBasemapUrl])

  const getSourceConfig = useCallback((sourceKey: string): SourceConfig | null => {
    if ((terrainSources as any)[sourceKey]) {
      const source = (terrainSources as any)[sourceKey]
      return { encoding: source.encoding, tileUrl: getTilesUrl(sourceKey as TerrainSource), tileSize: source.sourceConfig.tileSize || 256 }
    }
    const customSource = customTerrainSources.find((s) => s.id === sourceKey)
    if (!customSource) return null

    if (customSource.type === "wms-raw" || customSource.type === "tilejson" || customSource.type === "stac" || customSource.type === "mosaicjson") {
      // wms-raw's float32 GetMap URL and tilejson's manifest link are not
      // {z}/{x}/{y} tile pyramids buildGdalWmsXml can wrap; stac/mosaicjson need
      // server-side GDAL mosaicking this app doesn't build a URL for at all.
      return { encoding: "terrainrgb", tileUrl: "", tileSize: 256, unsupported: true }
    }
    // cog/vrt always come back from titiler already re-encoded as terrainrgb
    // (source-builder's isDem branch hardcodes algorithm=terrainrgb); terrainrgb/
    // terrarium/stac/mosaicjson custom sources are used as-is, in their own encoding.
    const encoding = customSource.type === "cog" || customSource.type === "vrt" ? "terrainrgb" : customSource.type
    const tileUrl = getCustomSourceUrl(customSource)
    return { encoding, tileUrl, tileSize: 256 }
  }, [customTerrainSources, getTilesUrl, getCustomSourceUrl])

  return { getTilesUrl, getSourceConfig, getCustomSourceUrl, getCustomBasemapUrl, getBasemapSourceConfig }
}

export const getGradientColors = (colors: any[]): string => {
  const colorValues: string[] = []
  for (let i = 4; i < colors.length; i += 2) {
    if (i < colors.length) colorValues.push(colors[i])
  }
  if (colorValues.length < 2) colorValues.push(colorValues[0] || "#000000")
  return colorValues.join(", ")
}

export const templateLink = (link: string, lat: string, lng: string): string => link.replace("{LAT}", lat).replace("{LNG}", lng)

export const copyToClipboard = (text: string) => navigator.clipboard.writeText(text)

import { domToBlob } from "modern-screenshot"
import type { MapRef } from "react-map-gl/maplibre"

export type ImageFormat = "png" | "jpeg"

/**
 * Captures the map canvas as an image Blob
 * @param format - 'png' (lossless, default) or 'jpeg' (lossy, faster, smaller)
 */
export async function captureMapScreenshot(
  mapRef: React.RefObject<MapRef>,
  format: ImageFormat = "png"
): Promise<Blob | null> {
  if (!mapRef.current) return null

  try {
    const canvas = mapRef.current.getMap().getCanvas()
    const { clientWidth: width, clientHeight: height } = canvas
    const dpr = window.devicePixelRatio

    // domToBlob accepts type option for both PNG and JPEG
    const blob = await domToBlob(canvas, {
      width,
      height,
      scale: dpr,
      type: format === "jpeg" ? "image/jpeg" : "image/png",
      quality: format === "jpeg" ? 0.95 : undefined, // Quality only for JPEG
    })

    return blob
  } catch (error) {
    console.error("Failed to capture map screenshot:", error)
    return null
  }
}

/**
 * Copies a Blob to the system clipboard
 */
export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ])
}

/**
 * Captures the map canvas and copies it to clipboard
 * Uses PNG for clipboard (better compatibility, supports transparency)
 */
export async function captureAndCopyMapToClipboard(
  mapRef: React.RefObject<MapRef>
): Promise<boolean> {
  try {
    // Use PNG for clipboard (better compatibility, supports transparency)
    const blob = await captureMapScreenshot(mapRef, "png")
    if (!blob) return false

    await copyBlobToClipboard(blob)
    return true
  } catch (error) {
    console.error("Failed to copy map screenshot to clipboard:", error)
    return false
  }
}