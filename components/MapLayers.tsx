import { memo } from "react"
import { Layer, type MapRef } from "react-map-gl/maplibre"

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
        id={"background"}
        key={"background" + theme}
        type="background"
        paint={{
          "background-color": theme === "light" ? "#ffffff" : "#000000",
        }}
        beforeId={getBeforeId()}
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
    return (
      <Layer
        id="hillshade"
        type="hillshade"
        source="hillshadeSource"
        paint={hillshadePaint}
        layout={{
          visibility: showHillshade ? "visible" : "none",
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
    if (!showColorRelief) return null

    return (
      <Layer
        id="color-relief"
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
