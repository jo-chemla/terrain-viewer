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
export const highResTerrainAtom = atomWithStorage("highResTerrain", false)

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


export type RenderQuality = "quick" | "normal" | "hq"

export interface ExportResolution {
  label: string
  width: number
  height: number
}
export const EXPORT_RESOLUTIONS: ExportResolution[] = [
  { label: "Quick 360p 16:9",  width: 640,  height: 360  },
  { label: "720p 16:9",        width: 1280, height: 720  },
  { label: "1080p FHD 16:9",   width: 1920, height: 1080 },
  { label: "4K UHD 16:9",      width: 3840, height: 2160 },
  { label: "Native",           width: 0,    height: 0    },
  { label: "1080×1080 1:1",    width: 1080, height: 1080 },
  { label: "2048×2048 1:1",    width: 2048, height: 2048 },
]
type ExportResolutionLabel = (typeof EXPORT_RESOLUTIONS)[number]['label']

export const resolutionKeyAtom = atomWithStorage<ExportResolutionLabel> ('anim-resolution-key', '1080p FHD 16:9')

export const renderQualityAtom = atomWithStorage<RenderQuality>('anim-render-quality', 'normal')
export const fpsAtom = atomWithStorage('anim-fps', 60)
export const targetSizeMBAtom = atomWithStorage('anim-target-size-mb', '')
