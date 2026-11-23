// The paint of the hillshade, colour relief and plane slicer layers, computed
// from the app's state. Pure functions with no React or MapLibre import, so the
// tile service (tile-server/direct.mjs) draws with the same rules as the map.
import { colorRampsFlat, remapColorRampStops, shiftCyclicRampStops, buildCustomRampColors, extractStops, applyBlackWhiteTransparent, DEFAULT_SLOPE_CUSTOM_STOPS, type CustomRampStop, type RampOverride } from "@/lib/color-ramps"

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
  } else if (hillshadeMethod === "duotone-nw-ne") {
    // After Zoran Čučković's two-light LiDAR hillshade
    // (landscapearchaeology.org/2018/lidar-hillshade): a grey north-west
    // light for the relief, and a north-east light whose lit side is cold
    // (blue, slopes leaning north) and whose shaded side is warm (orange,
    // slopes leaning south), so the two models tell their orientations apart
    // instead of stacking the same alignment twice.
    paint["hillshade-method"] = "multidirectional"
    paint["hillshade-highlight-color"] = ["#FFFFFF", "#4A90D9"]
    paint["hillshade-shadow-color"] = ["#000000", "#B8692E"]
    paint["hillshade-illumination-direction"] = [315, 45]
    paint["hillshade-illumination-altitude"] = [35, 35]
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
  // Only used when colorRamp === "custom" — there's no colorRampsFlat entry
  // for it, so its expression is built live from these user-authored stops
  // instead of looked up.
  customStops?: CustomRampStop[]
  customStopsDiscrete?: boolean
  customHypsoMinMax?: boolean
  minElevation?: number
  maxElevation?: number
  colorReliefOpacity?: number
  invertColorRamp?: boolean
  // Circularly rotates the ramp around [minElevation, maxElevation] instead of
  // rescaling it — only meaningful for a wraparound domain like Aspect's compass
  // degrees. See shiftCyclicRampStops in lib/color-ramps.ts.
  shiftDegrees?: number
  // Session-only live tweak of the NAMED ramp `colorRamp` points at (see
  // rampSessionOverridesAtom in lib/color-ramps.ts) — never touches
  // colorRampsFlat itself, so this is purely additive on top of the lookup
  // below. Not meaningful (and ignored) when colorRamp === "custom", which
  // already has its own always-persisted stops via customStops above.
  sessionOverride?: RampOverride
}

export const computeColorReliefPaint = ({
  colorRamp,
  customStops,
  customStopsDiscrete = false,
  customHypsoMinMax = false,
  minElevation = 0,
  maxElevation = 8100,
  colorReliefOpacity = 1.0,
  invertColorRamp = false,
  shiftDegrees = 0,
  sessionOverride,
}: ColorReliefConfig) => {
  if (colorRamp === "custom") {
    // The user's own explicit (value, color) stops ARE the intended values —
    // unlike the named ramps below there's no native range to rescale onto,
    // so customHypsoMinMax/min/maxElevation don't apply here. Invert still
    // makes sense as a pure polarity swap, done by rescaling onto its own
    // existing bounds (a no-op stretch).
    const baseColors = buildCustomRampColors(customStops ?? DEFAULT_SLOPE_CUSTOM_STOPS, customStopsDiscrete)
    const stops = extractStops(baseColors)
    const domainMin = Math.min(...stops)
    const domainMax = Math.max(...stops)
    let colors = invertColorRamp
      ? remapColorRampStops(baseColors, domainMin, domainMax, true)
      : baseColors
    // Aspect's shift is meaningful on a custom ramp too — rotate around the
    // stops' own domain (there's no minElevation/maxElevation to fall back
    // on here, unlike the named-ramp path below).
    if (shiftDegrees) {
      colors = shiftCyclicRampStops(colors, shiftDegrees, domainMin, domainMax)
    }
    return {
      "color-relief-opacity": colorReliefOpacity,
      "color-relief-color": withTopStop(withHoleStop(colors)),
    }
  }

  const ramp = colorRamp ? colorRampsFlat[colorRamp] : undefined
  if (!ramp && !sessionOverride?.stops) return {}

  // A session override's own edited stops replace the registry lookup
  // entirely; otherwise fall back to the real ramp exactly as before.
  const baseColors = sessionOverride?.stops
    ? buildCustomRampColors(sessionOverride.stops, sessionOverride.discrete ?? false)
    : ramp!.colors

  let colors = customHypsoMinMax
    ? remapColorRampStops(baseColors, minElevation, maxElevation, invertColorRamp)
    : baseColors

  if (shiftDegrees) {
    colors = shiftCyclicRampStops(colors, shiftDegrees, minElevation ?? 0, maxElevation ?? 360)
  }

  if (sessionOverride?.transparentBlackWhite) {
    colors = applyBlackWhiteTransparent(colors)
  }

  return {
    "color-relief-opacity": colorReliefOpacity,
    "color-relief-color": withTopStop(withHoleStop(colors)),
  }
}

/** MapLibre packs color-relief stops in the DEM's own encoding (steps of
 *  1/256 m for Terrarium, 0.1 m for Terrain-RGB), so a discrete ramp's pair
 *  of stops a hair apart (buildCustomRampColors) collapses into one value.
 *  Inside the ramp that is harmless, but when it is the last pair the
 *  shader divides 0 by 0 for every value at or above it and samples a NaN
 *  position: the top class drew transparent (shape index's domes, any value
 *  past a discrete ramp's last stop). One more stop with the last colour,
 *  beyond the coarsest step, keeps the last pair apart. */
function withTopStop(colors: any[]): any[] {
  if (!Array.isArray(colors) || colors[0] !== "interpolate" || colors.length < 7) return colors
  const last = colors[colors.length - 2], before = colors[colors.length - 4]
  if (typeof last !== "number" || typeof before !== "number" || last - before >= 0.25) return colors
  return [...colors, last + 0.25, colors[colors.length - 1]]
}

/** Terrain-RGB's floor, -10000 m: what a transparent (nodata) DEM pixel
 *  decodes to, whether titiler wrote it or the difference source did. No
 *  real elevation is anywhere near it (the Dead Sea is -430 m). */
export const DEM_HOLE_M = -10000

/** Paints the DEM floor transparent so nodata reads as a hole in the
 *  hypsometric tint instead of the ramp's lowest colour: two stops are
 *  prepended (hole, then the same colour as the first real stop just above
 *  it) when the ramp does not already reach down there. */
function withHoleStop(colors: any[]): any[] {
  if (!Array.isArray(colors) || colors[0] !== "interpolate" || colors.length < 7) return colors
  const firstValue = colors[3]
  if (typeof firstValue !== "number" || firstValue <= DEM_HOLE_M + 1) return colors
  const firstColor = colors[4]
  return [...colors.slice(0, 3), DEM_HOLE_M, "rgba(0, 0, 0, 0)", DEM_HOLE_M + 0.5, firstColor, ...colors.slice(3)]
}

export type PlaneSlicerConfig = {
  value?: number
  side?: "above" | "below"
  color?: string
  opacity?: number
}

// Half a meter either side of the threshold — imperceptibly thin against
// both an absolute-elevation domain (meters, up to thousands) and an LRM
// domain (typically ±tens of meters), but still wide enough to stay a
// genuine (non-degenerate) ascending "interpolate" pair. color-relief-color
// only ever evaluates through maplibre's interpolate codepath — see
// buildCustomRampColors above — so faking a hard cutoff this way is the only
// option; a "step" expression here would silently render fully transparent.
const PLANE_SLICER_EPSILON = 0.5

export const computePlaneSlicerPaint = ({
  value = 0,
  side = "below",
  color = "#3388ff",
  opacity = 0.6,
}: PlaneSlicerConfig) => {
  const transparent = "rgba(0, 0, 0, 0)"
  const colors = side === "below"
    ? ["interpolate", ["linear"], ["elevation"], value - PLANE_SLICER_EPSILON, color, value + PLANE_SLICER_EPSILON, transparent]
    : ["interpolate", ["linear"], ["elevation"], value - PLANE_SLICER_EPSILON, transparent, value + PLANE_SLICER_EPSILON, color]
  return {
    "color-relief-opacity": opacity,
    "color-relief-color": colors,
  }
}