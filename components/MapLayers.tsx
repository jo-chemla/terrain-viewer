import { memo } from "react"
import { Layer, type MapRef, type LayerSpecification } from "react-map-gl/maplibre"

// Raster Layer
// export const RasterLayer = memo(
export const RasterLayer =
    ({
        showRasterBasemap,
        rasterBasemapOpacity
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
    }

RasterLayer.displayName = "RasterLayer"

// Background Layer
// export const BackgroundLayer = memo(
export const BackgroundLayer =
    ({ theme, mapRef }: { theme: "light" | "dark"; mapRef: React.RefObject<MapRef> }) => {
        const getBeforeId = () => {
            for (const layerId of ['raster-basemap', 'color-relief', 'hillshade']) {
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
                    'background-color': theme === "light" ? '#ffffff' : "#000000"
                }}
                beforeId={getBeforeId()}
            />
        )
    }
BackgroundLayer.displayName = "BackgroundLayer"

// Hillshade Layer
// export const HillshadeLayer = memo(({
export const HillshadeLayer = ({
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
}
HillshadeLayer.displayName = "HillshadeLayer"

// Color Relief Layer Hypsometric Tint
// export const ColorReliefLayer = memo(({
export const ColorReliefLayer = ({
    showColorRelief,
    colorReliefPaint
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
}
ColorReliefLayer.displayName = "ColorReliefLayer"

// Contour Layers
export const contourLinesLayerDef = (showContours: boolean): LayerSpecification => ({
    id: "contour-lines",
    type: "line",
    source: "contour-source",
    "source-layer": "contours",
    paint: {
        "line-color": "rgba(0,0,0, 50%)",
        "line-width": ["match", ["get", "level"], 1, 1, 0.5],
    },
    layout: {
        visibility: showContours ? "visible" : "none",
    }
})

export const contourLabelsLayerDef = (showContours: boolean): LayerSpecification => ({
    id: "contour-labels",
    type: "symbol",
    source: "contour-source",
    "source-layer": "contours",
    filter: [">", ["get", "level"], 0],
    paint: {
        "text-halo-color": "white",
        "text-halo-width": 1,
    },
    layout: {
        "symbol-placement": "line",
        "text-size": 10,
        "text-field": ["concat", ["number-format", ["get", "ele"], {}], "m"],
        "text-font": ["Noto Sans Bold"],
        visibility: showContours ? "visible" : "none",
    }
})

// export const ContourLayers = memo(({ showContours }: { showContours: boolean }) => {
export const ContourLayers = ({ showContours }: { showContours: boolean }) => {
    return (
        <>
            <Layer {...contourLinesLayerDef(showContours)} />
            <Layer {...contourLabelsLayerDef(showContours)} />
        </>
    )
}
ContourLayers.displayName = "ContourLayers"
