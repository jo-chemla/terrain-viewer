import { atomWithStorage } from "jotai/utils"

export const mapboxKeyAtom = atomWithStorage("mapboxKey", "pk.eyJ1IjoiaWNvbmVtIiwiYSI6ImNpbXJycDBqODAwNG12cW0ydGF1NXZxa2sifQ.hgPcQvgkzpfYkHgfMRqcpw")
export const googleKeyAtom = atomWithStorage("googleKey", "AIzaSyAo6DIOnhYdywBidl4clsPZPkQkXfq6QhI")
export const mapzenKeyAtom = atomWithStorage("mapzenKey", "mapzen-xxxxxxx")
export const maptilerKeyAtom = atomWithStorage("maptilerKey", "FbPGGTCFE8IRiPECxIrp")
export const titilerEndpointAtom = atomWithStorage("titilerEndpoint", "https://titiler.xyz")
export const maxResolutionAtom = atomWithStorage("maxResolution", 1024)
export const themeAtom = atomWithStorage<"light" | "dark">("theme", "light")

export const isGeneralOpenAtom = atomWithStorage("isGeneralOpen", true)
export const isTerrainSourceOpenAtom = atomWithStorage("isTerrainSourceOpen", true)
export const isVizModesOpenAtom = atomWithStorage("isVizModesOpen", true)
export const isHillshadeOpenAtom = atomWithStorage("isHillshadeOpen", true)
export const isTerrainRasterOpenAtom = atomWithStorage("isTerrainRasterOpen", true)
export const isHypsoOpenAtom = atomWithStorage("isHypsoOpen", true)
export const isContoursOpenAtom = atomWithStorage("isContoursOpen", true)
export const isDownloadOpenAtom = atomWithStorage("isDownloadOpen", true)
export const useCogProtocolVsTitilerAtom = atomWithStorage("useCogProtocolVsTitiler", true)
export const isBackgroundOpenAtom  = atomWithStorage("isBackgroundOpen", true)
export const colorRampTypeAtom = atomWithStorage('colorRampType', 'classic')
export const licenseFilterAtom = atomWithStorage('licenseFilter', 'all' )

export interface CustomTerrainSource {
  id: string
  name: string
  url: string
  type: "cog" | "terrainrgb" | "terrarium" | "vrt" | 'stac' | 'mosaicjson'
  description?: string
}

export const customTerrainSourcesAtom = atomWithStorage<CustomTerrainSource[]>("customTerrainSources", [])
export const isByodOpenAtom = atomWithStorage("isByodOpen", true)
