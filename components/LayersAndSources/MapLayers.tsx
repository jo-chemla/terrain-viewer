import { memo } from "react"
import { Layer, type MapRef } from "react-map-gl/maplibre"
import { useAtom } from "jotai"
import { highResTerrainAtom } from "@/lib/settings-atoms"

export const LAYER_SLOTS = {
  BACKGROUND: "slot-background",
  BASEMAP: "slot-basemap", 
  COLOR_RELIEF: "slot-color-relief",
  HILLSHADE: "slot-hillshade",
  CONTOURS: "slot-contours",
} as const

// Rendered once, always present, zero visual impact
export const LayerOrderSlots = () => (
  <>
    <Layer id={LAYER_SLOTS.BACKGROUND} type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.BASEMAP}     type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.COLOR_RELIEF}type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.HILLSHADE}   type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.CONTOURS}    type="background" paint={{ "background-opacity": 0 }} />
  </>
)


// Raster Layer
export const RasterLayer = memo(
  ({
    showRasterBasemap,
    rasterBasemapOpacity,
  }: {
    showRasterBasemap: boolean
    rasterBasemapOpacity: number
  }) => {
    return (
      <Layer
        beforeId={LAYER_SLOTS.BASEMAP}   // ← always exists, order is stable
        id="raster-basemap"
        type="raster"
        source="raster-basemap-source"
        paint={{
          "raster-opacity": rasterBasemapOpacity,
        }}
        layout={{
          visibility: showRasterBasemap ? "visible" : "none",
        }}
      />
    )
  },
)
RasterLayer.displayName = "RasterLayer"

// Background Layer
export const BackgroundLayer = memo(
  ({ theme, mapRef }: { theme: "light" | "dark"; mapRef: React.RefObject<MapRef> }) => {
    const getBeforeId = () => {
      for (const layerId of ["raster-basemap", "color-relief", "hillshade"]) {
        if (mapRef?.current?.getLayer(layerId)) {
          return layerId
        }
      }
      return undefined
    }

    return (
      <Layer
        beforeId={LAYER_SLOTS.BACKGROUND}
        id={"background"}
        key={"background" + theme}
        type="background"
        paint={{
          "background-color": theme === "light" ? "#ffffff" : "#000000",
        }}
        // beforeId={getBeforeId()}
      />
    )
  },
)
BackgroundLayer.displayName = "BackgroundLayer"

// Hillshade Layer
export const HillshadeLayer = memo(
  ({
    showHillshade,
    hillshadePaint,
  }: {
    showHillshade: boolean
    hillshadePaint: any
  }) => {
    const [highResTerrain] = useAtom(highResTerrainAtom)

    return (
      <Layer
        beforeId={LAYER_SLOTS.HILLSHADE}   // ← always exists, order is stable
        id="hillshade"
        key={`hillshade-${highResTerrain}`}
        type="hillshade"
        source="hillshadeSource"
        paint={hillshadePaint}
        layout={{
          visibility: showHillshade ? "visible" : "none",
          // 'resampling': 'linear'  // upcoming although should be default: https://github.com/maplibre/maplibre-gl-js/issues/7154
        }}
      />
    )
  },
)
HillshadeLayer.displayName = "HillshadeLayer"

// Color Relief Layer — Hypsometric Tint
export const ColorReliefLayer = memo(
  ({
    showColorRelief,
    colorReliefPaint,
  }: {
    showColorRelief: boolean
    colorReliefPaint: any
  }) => {
    const [highResTerrain] = useAtom(highResTerrainAtom)

    if (!showColorRelief) return null

    return (
      <Layer
        beforeId={LAYER_SLOTS.COLOR_RELIEF}
        id="color-relief"
        key={`color-relief-${highResTerrain}`}
        type="color-relief"
        source="hillshadeSource"
        paint={colorReliefPaint}
        layout={{
          visibility: "visible",
        }}
      />
    )
  },
)
ColorReliefLayer.displayName = "ColorReliefLayer"

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: Number.parseInt(result[1], 16),
        g: Number.parseInt(result[2], 16),
        b: Number.parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}

// Compute hillshade paint with useMemo to prevent recalculation
export type HillshadeConfig = {
  hillshadeMethod?: string
  illuminationDir?: number
  illuminationAlt?: number
  hillshadeOpacity?: number
  shadowColor?: string
  highlightColor?: string
  hillshadeExag?: number
  accentColor?: string
  illumAnchor?: string
}
export const computeHillshadePaint = ({
  hillshadeMethod = "standard",
  illuminationDir = 315,
  illuminationAlt = 45,
  hillshadeOpacity = 1.0,
  shadowColor = "#000000",
  highlightColor = "#FFFFFF",
  hillshadeExag = 1.0,
  accentColor = "#808080",
  illumAnchor = "map",
}: HillshadeConfig) => {
  const paint: any = {}

  const supportsIlluminationDirection = ["standard", "combined", "igor", "basic"].includes(hillshadeMethod)
  const supportsIlluminationAltitude = ["combined", "basic"].includes(hillshadeMethod)
  const supportsShadowColor = ["standard", "combined", "igor", "basic"].includes(hillshadeMethod)
  const supportsHighlightColor = ["standard", "combined", "igor", "basic"].includes(hillshadeMethod)
  const supportsAccentColor = hillshadeMethod === "standard"
  // const supportsExaggeration = ["standard", "combined", "igor"].includes(hillshadeMethod)
  const supportsExaggeration = true

  if (hillshadeMethod === "multidir-colors") {
    paint["hillshade-method"] = "multidirectional"
    paint["hillshade-highlight-color"] = ["#FF4000", "#FFFF00", "#40ff00", "#00FF80"]
    paint["hillshade-shadow-color"] = ["#00bfff", "#0000ff", "#bf00ff", "#FF0080"]
    paint["hillshade-illumination-direction"] = [270, 315, 0, 45]
    paint["hillshade-illumination-altitude"] = [30, 30, 30, 30]
  } else if (hillshadeMethod === "aspect-multidir") {
    paint["hillshade-method"] = "multidirectional"
    paint["hillshade-highlight-color"] = ["#CC0000", "#0000CC"]
    paint["hillshade-shadow-color"] = ["#00CCCC", "#CCCC00"]
    paint["hillshade-illumination-direction"] = [0, 270]
    paint["hillshade-illumination-altitude"] = [30, 30]
  } else {
    if (supportsIlluminationDirection) paint["hillshade-illumination-direction"] = illuminationDir
    if (supportsShadowColor) {
      const shadowRgb = hexToRgb(shadowColor)
      paint["hillshade-shadow-color"] = `rgba(${shadowRgb.r}, ${shadowRgb.g}, ${shadowRgb.b}, ${hillshadeOpacity})`
    }
    if (supportsHighlightColor) {
      const highlightRgb = hexToRgb(highlightColor)
      paint["hillshade-highlight-color"] = `rgba(${highlightRgb.r}, ${highlightRgb.g}, ${highlightRgb.b}, ${hillshadeOpacity})`
    }
    if (supportsIlluminationAltitude) paint["hillshade-illumination-altitude"] = illuminationAlt
    // Fix something that looks like a bug on mapillary side
    if (supportsIlluminationAltitude && hillshadeMethod === "basic") paint["hillshade-illumination-altitude"] = 90 - (90 - illuminationAlt) / 6.28
    if (supportsExaggeration) paint["hillshade-exaggeration"] = hillshadeExag
    if (supportsAccentColor) paint["hillshade-accent-color"] = accentColor
    if (hillshadeMethod !== "standard") paint["hillshade-method"] = hillshadeMethod
  }

  // paint["resampling"] = 'linear' 
  paint["hillshade-illumination-anchor"] = illumAnchor

  return paint
}