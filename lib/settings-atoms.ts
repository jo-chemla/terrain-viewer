import { atomWithStorage } from "jotai/utils"
import { atom } from "jotai"

export const mapboxKeyAtom = atomWithStorage("mapboxKey", "pk.eyJ1IjoiaWNvbmVtIiwiYSI6ImNpbXJycDBqODAwNG12cW0ydGF1NXZxa2sifQ.hgPcQvgkzpfYkHgfMRqcpw")
export const googleKeyAtom = atomWithStorage("googleKey", "AIzaSyAo6DIOnhYdywBidl4clsPZPkQkXfq6QhI")
export const mapzenKeyAtom = atomWithStorage("mapzenKey", "mapzen-xxxxxxx")
export const maptilerKeyAtom = atomWithStorage("maptilerKey", "FbPGGTCFE8IRiPECxIrp")
export const titilerEndpointAtom = atomWithStorage("titilerEndpoint", "https://titiler.xyz")
export const maxResolutionAtom = atomWithStorage("maxResolution", 1024)
export const themeAtom = atomWithStorage<"light" | "dark">("theme", "light")

export const useCogProtocolVsTitilerAtom = atomWithStorage("useCogProtocolVsTitiler", true)
export const colorRampTypeAtom = atomWithStorage('colorRampType', 'classic')
export const licenseFilterAtom = atomWithStorage('licenseFilter', 'open-distribute' )

type SkyConfig = {
  skyColor: string
  skyHorizonBlend: number
  horizonColor: string
  horizonFogBlend: number
  fogColor: string
  fogGroundBlend: number
  matchThemeColors: boolean
  backgroundLayerActive: boolean
}

export const skyConfigAtom = atom<SkyConfig>({
  skyColor: '#80ccff',
  skyHorizonBlend: 0.5,
  horizonColor: '#ccddff',
  horizonFogBlend: 0.5,
  fogColor: '#fcf0dd',
  fogGroundBlend: 0.2,
  matchThemeColors: false,
  backgroundLayerActive: true,
})

export interface CustomTerrainSource {
  id: string
  name: string
  url: string
  type: "cog" | "terrainrgb" | "terrarium" | "vrt" | 'stac' | 'mosaicjson'
  description?: string
}

export const customTerrainSourcesAtom = atomWithStorage<CustomTerrainSource[]>("customTerrainSources", [])
export const isByodOpenAtom = atomWithStorage("isByodOpen", true)
export interface CustomBasemapSource {
  id: string
  name: string
  url: string
  type: "cog" | "tms" | "wms" | "wmts"
  description?: string
}

export const customBasemapSourcesAtom = atomWithStorage<CustomBasemapSource[]>("customBasemapSources", [])
export const isBasemapByodOpenAtom = atomWithStorage("isBasemapByodOpen", true)
export const isHillshadeXYPadOpenAtom = atomWithStorage("isHillshadeXYPadOpen", true)

export const transparentUiAtom = atomWithStorage("isTransparentUi", true)
export const activeSliderAtom = atom<string | null>(null)
