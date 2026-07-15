import { memo, useEffect, useRef, type RefObject } from "react"
import { Layer, type MapRef } from "react-map-gl/maplibre"
import maplibregl, { type MapMouseEvent } from "maplibre-gl"
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
  TPI: "slot-tpi",
  LRM: "slot-lrm",
  ROUGHNESS: "slot-roughness",
  BLOBNESS: "slot-blobness",
  HILLSHADE: "slot-hillshade",
  CONTOURS: "slot-contours",
  TELLS: "slot-tells",
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
    <Layer id={LAYER_SLOTS.TPI}         type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.LRM}         type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.ROUGHNESS}   type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.BLOBNESS}    type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.HILLSHADE}   type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.CONTOURS}    type="background" paint={{ "background-opacity": 0 }} />
    <Layer id={LAYER_SLOTS.TELLS}       type="background" paint={{ "background-opacity": 0 }} />
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

export const TpiReliefLayer = memo(({ showSlopeAndMore, showTpi, tpiReliefPaint }: { showSlopeAndMore: boolean; showTpi: boolean; tpiReliefPaint: any }) => {
  if (!showSlopeAndMore) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.TPI}
      id="tpi-relief"
      type="color-relief"
      source="tpiSource"
      paint={tpiReliefPaint}
      layout={{ visibility: showTpi ? "visible" : "none" }}
    />
  )
})
TpiReliefLayer.displayName = "TpiReliefLayer"

export const LrmReliefLayer = memo(({ showSlopeAndMore, showLrm, lrmReliefPaint }: { showSlopeAndMore: boolean; showLrm: boolean; lrmReliefPaint: any }) => {
  if (!showSlopeAndMore) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.LRM}
      id="lrm-relief"
      type="color-relief"
      source="lrmSource"
      paint={lrmReliefPaint}
      layout={{ visibility: showLrm ? "visible" : "none" }}
    />
  )
})
LrmReliefLayer.displayName = "LrmReliefLayer"

export const RoughnessReliefLayer = memo(({ showSlopeAndMore, showRoughness, roughnessReliefPaint }: { showSlopeAndMore: boolean; showRoughness: boolean; roughnessReliefPaint: any }) => {
  if (!showSlopeAndMore) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.ROUGHNESS}
      id="roughness-relief"
      type="color-relief"
      source="roughnessSource"
      paint={roughnessReliefPaint}
      layout={{ visibility: showRoughness ? "visible" : "none" }}
    />
  )
})
RoughnessReliefLayer.displayName = "RoughnessReliefLayer"

export const BlobnessReliefLayer = memo(({ showSlopeAndMore, showBlobness, blobnessReliefPaint }: { showSlopeAndMore: boolean; showBlobness: boolean; blobnessReliefPaint: any }) => {
  if (!showSlopeAndMore) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.BLOBNESS}
      id="blobness-relief"
      type="color-relief"
      source="blobnessSource"
      paint={blobnessReliefPaint}
      layout={{ visibility: showBlobness ? "visible" : "none" }}
    />
  )
})
BlobnessReliefLayer.displayName = "BlobnessReliefLayer"

// ─── Tells (mound candidate) markers ────────────────────────────────────────
// Point features from the tells:// MVT source (see TellsSource in MapSources.tsx
// and lib/tells-protocol.ts) — one marker per surviving candidate. `enabled` is
// the mount gate (mirrors the Relief-layer master/per-mode split elsewhere in this
// file: showSlopeAndMore && state.tellsBeta); `style` — including "hidden" — only
// ever toggles layout.visibility/paint, so cycling styles never unmounts this
// Layer or the vector source underneath it, meaning hiding the markers can't
// force maplibre to re-fetch/recompute tells:// tiles on reactivation.
export type TellsMarkerStyle =
  | "hidden" | "purple" | "outline"
  | "byBlobness" | "byPlan" | "byDetHessian" | "byLrm"

const TELLS_CIRCLE_RADIUS = ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 7] as const
// "outline" (red-stroke, no-fill) markers are drawn 2x the radius of every other
// style, purely as a visual distinguisher when both styles' underlying candidate
// sets overlap on screen.
const TELLS_CIRCLE_RADIUS_OUTLINE = ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 14] as const

// Color-by-attribute ramps for the tells markers, keyed by TellsMarkerStyle.
// These intentionally reuse the same color families as the equivalent
// Slope-and-More visualization (see lib/color-ramps.ts's blobness-default,
// tri-default, curvature-diverging, lrm-diverging), but with the numeric domain
// rescaled down to the tells veto's own "coarse" (lowpass-smoothed) value ranges,
// empirically calibrated in tells-options-section.tsx's slider ranges (blobness/
// det-Hessian ~0-0.5, plan convexity ~0-100). Reusing Slope-and-More's literal
// domain numbers (calibrated against raw/native-resolution pixel formulas) would
// make every tells marker fall in the ramp's first, near-zero stop — which is
// exactly the "all points are blue" bug this replaces.
const TELLS_COLOR_BY_PAINT: Record<string, any> = {
  // Matches lib/color-ramps.ts's "blobness-default" palette (white->teal->green).
  byBlobness: [
    "interpolate", ["linear"], ["get", "blobness"],
    0, "rgba(255, 255, 255, 0)",
    0.05, "rgb(229, 245, 249)",
    0.15, "rgb(153, 216, 201)",
    0.3, "rgb(44, 162, 95)",
    0.5, "rgb(0, 109, 44)",
  ],
  // Matches "curvature-diverging"'s convex/ridge (red) half — plan is already
  // stored as outward convexity (-plan clipped positive, see tells-protocol.ts),
  // so only the single-direction "more convex" ramp applies here.
  byPlan: [
    "interpolate", ["linear"], ["get", "plan"],
    0, "rgba(255, 255, 255, 0)",
    25, "rgb(244, 165, 130)",
    100, "rgb(178, 24, 43)",
  ],
  // Matches "tri-default"'s palette (white->yellow->orange->red).
  byDetHessian: [
    "interpolate", ["linear"], ["get", "detHessian"],
    0, "rgba(255, 255, 255, 0)",
    0.05, "rgb(255, 247, 188)",
    0.15, "rgb(254, 196, 79)",
    0.3, "rgb(217, 95, 14)",
    0.5, "rgb(153, 0, 0)",
  ],
  // Matches "lrm-diverging"'s positive (above-background) half — the tells `a`
  // tag is itself a meters-based DoG relief quantity in the same units, so this
  // domain is reused literally rather than rescaled.
  byLrm: [
    "interpolate", ["linear"], ["get", "a"],
    0, "rgba(255, 255, 255, 0)",
    5, "rgb(253, 174, 97)",
    20, "rgb(178, 24, 43)",
  ],
}

export const TellsMarkersLayer = memo(({ enabled, style }: { enabled: boolean; style: TellsMarkerStyle }) => {
  if (!enabled) return null
  const colorByPaint = TELLS_COLOR_BY_PAINT[style]
  const paint =
    style === "outline"
      ? {
          "circle-radius": TELLS_CIRCLE_RADIUS_OUTLINE,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#ef4444",
          "circle-stroke-width": 2,
        }
      : colorByPaint
      ? {
          "circle-radius": TELLS_CIRCLE_RADIUS,
          "circle-color": colorByPaint,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        }
      : {
          "circle-radius": TELLS_CIRCLE_RADIUS,
          "circle-color": "#a855f7",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        }
  return (
    <Layer
      beforeId={LAYER_SLOTS.TELLS}
      id="tells-markers"
      type="circle"
      source="tellsSource"
      source-layer="tells"
      layout={{ visibility: style === "hidden" ? "none" : "visible" }}
      paint={paint as any}
    />
  )
})

// MapLibre only fetches a vector source's tiles if some *visible* layer in the
// style references it — a Source with no layer (or only layout.visibility:none
// layers) never loads, regardless of the source's own mount state. Confirmed
// empirically: a visibility:none loader layer left tellsSourceUnfiltered's tiles
// permanently unrequested. tellsSourceUnfiltered (see TellsSource's "unfiltered"
// variant in MapSources.tsx) exists purely for the Export button's
// querySourceFeatures call, so this stays layout-visible but paints fully
// transparent/zero-radius to have no visual effect on the map.
export const TellsUnfilteredLoaderLayer = memo(({ enabled }: { enabled: boolean }) => {
  if (!enabled) return null
  return (
    <Layer
      beforeId={LAYER_SLOTS.TELLS}
      id="tells-markers-unfiltered-loader"
      type="circle"
      source="tellsSourceUnfiltered"
      source-layer="tells"
      paint={{ "circle-radius": 0, "circle-opacity": 0, "circle-stroke-width": 0 }}
    />
  )
})
TellsUnfilteredLoaderLayer.displayName = "TellsUnfilteredLoaderLayer"
TellsMarkersLayer.displayName = "TellsMarkersLayer"

// Click-to-inspect popup for a Tells marker — surfaces the same A/D/C/F values
// tells-protocol.ts already computes per-candidate (see its `tags` object) but
// which otherwise never leave the vector tile. Layer-scoped listeners are guarded
// by an explicit getLayer() check rather than relying on maplibre's own delegated
// binding, since TellsMarkersLayer only mounts once showSlopeAndMore/state.tellsBeta
// are both on and querying a not-yet-mounted layer throws rather than silently
// no-op-ing. A "hidden" style still passes this guard (the layer stays mounted)
// but layout.visibility:"none" makes queryRenderedFeatures return nothing anyway.
export const TellsInspectPopup = memo(({ mapRef, active }: { mapRef: RefObject<MapRef>; active: boolean }) => {
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !active) return

    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "220px" })

    const handleClick = (e: MapMouseEvent) => {
      if (!map.getLayer("tells-markers")) return
      const [feature] = map.queryRenderedFeatures(e.point, { layers: ["tells-markers"] })
      if (!feature) return
      const tags = feature.properties as Record<string, number>
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-size:12px;line-height:1.6">` +
          `<div style="font-weight:600;margin-bottom:2px">Tell candidate</div>` +
          `<div>DoG relief (A): <b>${tags.a} m</b></div>` +
          `<div>Blobness (D): <b>${tags.blobness}</b></div>` +
          `<div>Plan curvature (C): <b>${tags.plan}</b></div>` +
          `<div>Det-Hessian (F): <b>${tags.detHessian}</b></div>` +
          `</div>`,
        )
        .addTo(map)
    }
    // Plain "mousemove" + a manual getLayer() guard, rather than maplibre's
    // layer-scoped on("mouseenter"/"mouseleave", layerId, ...) overload — that
    // overload queries the named layer internally on every map pointer move, which
    // throws (rather than no-op-ing) if the layer isn't mounted yet.
    const handleMove = (e: MapMouseEvent) => {
      const hit = map.getLayer("tells-markers") && map.queryRenderedFeatures(e.point, { layers: ["tells-markers"] }).length > 0
      map.getCanvas().style.cursor = hit ? "pointer" : ""
    }

    map.on("click", handleClick)
    map.on("mousemove", handleMove)
    return () => {
      map.off("click", handleClick)
      map.off("mousemove", handleMove)
      map.getCanvas().style.cursor = ""
      popup.remove()
    }
  }, [mapRef, active])
  return null
})
TellsInspectPopup.displayName = "TellsInspectPopup"

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