import { useCallback } from "react"
import { useAtom } from "jotai"
import { terrainSources } from "@/lib/terrain-sources"
import {
  mapboxKeyAtom, googleKeyAtom, maptilerKeyAtom, titilerEndpointAtom, 
  customTerrainSourcesAtom, customBasemapSourcesAtom, themeAtom
} from "@/lib/settings-atoms"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource, CustomBasemapSource } from "@/lib/settings-atoms"

export interface SourceConfig {
  encoding: string
  tileUrl: string
  tileSize: number
}

export type Bounds = { west: number; east: number; north: number; south: number }

export const useTheme = () => {
  const [theme, setTheme] = useAtom(themeAtom)
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

  const getCustomSourceUrl = useCallback((source: CustomTerrainSource): string => {
    if (source.type === "cog") {
      return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(source.url)}&algorithm=terrarium`
    }
    return source.url
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
    if (customSource) {
      const encoding = customSource.type === "terrainrgb" ? "terrainrgb" : "terrarium"
      const tileUrl = getCustomSourceUrl(customSource)
      return { encoding, tileUrl, tileSize: 256 }
    }
    return null
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
