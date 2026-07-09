import { memo } from "react"
import { Layer, type MapRef } from "react-map-gl/maplibre"
import { useAtom } from "jotai"
import { highResTerrainAtom } from "@/lib/settings-atoms"
import { colorRampsFlat, remapColorRampStops } from "@/lib/color-ramps"

export const LAYER_SLOTS = {
  BACKGROUND: "slot-background",
  BASEMAP: "slot-basemap",
  OVERLAYS: "slot-overlays",
  COLOR_RELIEF: "slot-color-relief",
  SLOPE: "slot-slope",
  ASPECT: "slot-aspect",
  TRI: "slot-tri",
  CURVATURE: "slot-curvature",
  HILLSHADE: "slot-hillshade",
  CONTOURS: "slot-contours",
} as const

// Rendered once, always present, zero visual impact
export const LayerOrderSlots = () => (
  <>
    <Layer id={LAYER_SLOTS.BACKGROUND} type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.BASEMAP}     type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.OVERLAYS}    type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.COLOR_RELIEF}type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.SLOPE}       type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.ASPECT}      type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.TRI}         type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.CURVATURE}   type="background" paint={{ "background-opacity": 0 }} />
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
          "raster-resampling": 'linear' 
        }}
        layout={{
          visibility: showRasterBasemap ? "visible" : "none",
        }}
      />
    )
  },
)
RasterLayer.displayName = "RasterLayer"

// Overlay Layers — one raster layer per active 'overlay'-role custom basemap
// source (see OverlayBasemapSources in MapSources.tsx), stacked between the
// basemap and every terrain-derived visualization. Opacity is just the viz-mode
// "Raster Basemap" master slider (100% × it) — there's no per-overlay solo slider,
// unlike the single/split basemap layer (see RasterLayer), which additionally
// composites with its own Basemap Opacity slider.
export const OverlayBasemapLayers = memo(({ overlayIds, opacity }: { overlayIds: string[]; opacity: number }) => (
  <>
    {overlayIds.map((id) => (
      <Layer
        key={`overlay-layer-${id}`}
        beforeId={LAYER_SLOTS.OVERLAYS}
        id={`overlay-basemap-${id}`}
        type="raster"
        source={`overlay-basemap-source-${id}`}
        paint={{ "raster-opacity": opacity, "raster-resampling": "linear" }}
      />
    ))}
  </>
))
OverlayBasemapLayers.displayName = "OverlayBasemapLayers"

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

    // When switching between scalar and array paint values (e.g. standard → multidir-colors),
    // MapLibre tries to interpolate mismatched array lengths and throws.
    // Keying on array-mode + length forces a full layer unmount/remount, bypassing interpolation.
    const isArrayMode = Array.isArray(hillshadePaint["hillshade-highlight-color"])
    const arrayLength = isArrayMode
      ? (hillshadePaint["hillshade-highlight-color"] as any[]).length
      : 1

    return (
      <Layer
        beforeId={LAYER_SLOTS.HILLSHADE}
        id="hillshade"
        key={`hillshade-${highResTerrain}-${isArrayMode}-${arrayLength}`}
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

// ─── Slope-angle overlay ───────────────────────────────────────────────────────
//
// Reuses the same `color-relief` layer type as the hypsometric tint above, but
// pointed at a DEM source whose "elevation" band actually encodes slope angle
// in degrees rather than real elevation. PlanTopo's slope tile server (see
// SLOPE_SOURCE_URL in MapSources.tsx) does this server-side: it fetches
// Mapterhorn DEM tiles, computes the per-pixel slope, and re-packs the result
// using the standard Mapbox terrain-rgb formula so any raster-dem consumer
// (including maplibre's color-relief paint) can read it as if it were elevation.
//
// See the comment above SLOPE_SOURCE_URL for how this could instead be computed
// entirely client-side via a custom protocol, without depending on PlanTopo.
//
// The color ramp/opacity/min-max-remap/invert are all just computeColorReliefPaint
// (same function the hypsometric tint above uses) — a color-relief layer's paint
// doesn't care whether "elevation" means meters or degrees of slope, so the same
// classic-ramp machinery works unchanged. See slope-options-section.tsx.
// `showSlopeAndMore` (the master) gates mounting — matches SlopeSource in
// MapSources.tsx, which only exists while the master is on, so this layer can't
// reference a "slopeSource" that isn't there. `showSlope` (the sub-mode checkbox)
// only toggles layout.visibility, not mounting — switching sub-modes on/off while
// the master stays on keeps maplibre's tile cache warm instead of forcing a slow
// re-fetch/re-decode the next time this sub-mode is re-checked.
export const SlopeReliefLayer = memo(({ showSlopeAndMore, showSlope, slopeReliefPaint }: { showSlopeAndMore: boolean; showSlope: boolean; slopeReliefPaint: any }) => {
  if (!showSlopeAndMore) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.SLOPE}
      id="slope-relief"
      type="color-relief"
      source="slopeSource"
      paint={slopeReliefPaint}
      layout={{ visibility: showSlope ? "visible" : "none" }}
    />
  )
})
SlopeReliefLayer.displayName = "SlopeReliefLayer"

// ─── Aspect / TRI / Curvature overlays ─────────────────────────────────────────
// Same color-relief-over-a-reinterpreted-DEM trick as SlopeReliefLayer above, one
// per normal-derived attribute (see AspectSource/TriSource/CurvatureSource in
// MapSources.tsx for how each source gets its values).
export const AspectReliefLayer = memo(({ showSlopeAndMore, showAspect, aspectReliefPaint }: { showSlopeAndMore: boolean; showAspect: boolean; aspectReliefPaint: any }) => {
  if (!showSlopeAndMore) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.ASPECT}
      id="aspect-relief"
      type="color-relief"
      source="aspectSource"
      paint={aspectReliefPaint}
      layout={{ visibility: showAspect ? "visible" : "none" }}
    />
  )
})
AspectReliefLayer.displayName = "AspectReliefLayer"

export const TriReliefLayer = memo(({ showSlopeAndMore, showTri, triReliefPaint }: { showSlopeAndMore: boolean; showTri: boolean; triReliefPaint: any }) => {
  if (!showSlopeAndMore) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.TRI}
      id="tri-relief"
      type="color-relief"
      source="triSource"
      paint={triReliefPaint}
      layout={{ visibility: showTri ? "visible" : "none" }}
    />
  )
})
TriReliefLayer.displayName = "TriReliefLayer"

export const CurvatureReliefLayer = memo(({ showSlopeAndMore, showCurvature, curvatureReliefPaint }: { showSlopeAndMore: boolean; showCurvature: boolean; curvatureReliefPaint: any }) => {
  if (!showSlopeAndMore) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.CURVATURE}
      id="curvature-relief"
      type="color-relief"
      source="curvatureSource"
      paint={curvatureReliefPaint}
      layout={{ visibility: showCurvature ? "visible" : "none" }}
    />
  )
})
CurvatureReliefLayer.displayName = "CurvatureReliefLayer"

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

  // NOTE: there is no "resampling" paint property for any layer type (raster layers have
  // "raster-resampling", but hillshade has no equivalent yet — see the maplibre issue linked
  // in HillshadeLayer's layout comment below). A stray `paint["resampling"] = 'linear'` used
  // to live here; the style spec's strict validator rejects unknown paint properties outright
  // (throws on map.addLayer, silently dropping the whole hillshade layer), which is exactly
  // what broke hillshade in production — not a maplibre version issue.
  paint["hillshade-illumination-anchor"] = illumAnchor

  return paint
}

export type ColorReliefConfig = {
  colorRamp?: string
  customHypsoMinMax?: boolean
  minElevation?: number
  maxElevation?: number
  colorReliefOpacity?: number
  invertColorRamp?: boolean
}

export const computeColorReliefPaint = ({
  colorRamp,
  customHypsoMinMax = false,
  minElevation = 0,
  maxElevation = 8100,
  colorReliefOpacity = 1.0,
  invertColorRamp = false,
}: ColorReliefConfig) => {
  const ramp = colorRamp ? colorRampsFlat[colorRamp] : undefined
  if (!ramp) return {}

  const colors = customHypsoMinMax
    ? remapColorRampStops(ramp.colors, minElevation, maxElevation, invertColorRamp)
    : ramp.colors

  return {
    "color-relief-opacity": colorReliefOpacity,
    "color-relief-color": colors,
  }
}