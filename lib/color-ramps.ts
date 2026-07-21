import {cpt_city_views} from "./cpt-city/cpt-city-views"
import {colorRampsCet} from "./cpt-city/cet-colormaps"
import {colorRampsSdr} from "./cpt-city/sdr-colormaps"
import type { Scale } from 'chroma-js';
import { createParser } from "nuqs"

// import { parsePalette, colorRampCanvas } from 'cpt2js';
import {parsePalette} from './cpt-city/cpt2js-stops';

export function extractStops(colors: any[]): number[] {
  const stops = []
  // Extract stops at indices 3 += 2
  for (let i = 3; i < colors.length; i += 2) {
    stops.push(colors[i])
  }
  return stops
}

export interface CustomRampStop { value: number; color: string }

// Rough, widely-cited construction/vehicle-access slope bands (loosely
// tracking NRCS slope classes) — not an industry-universal standard (that
// varies a lot by jurisdiction/equipment), which is exactly why this is a
// user-editable starting point rather than a fixed preset.
export const DEFAULT_SLOPE_CUSTOM_STOPS: CustomRampStop[] = [
  { value: 0, color: "#2ecc40" },   // flat, standard vehicle access
  { value: 10, color: "#ffdc00" }, // moderate, most equipment fine
  { value: 20, color: "#ff851b" }, // steep, may need specialized equipment/erosion control
  { value: 35, color: "#ff4136" }, // typically excluded from routine construction access
]

// Builds a plain "interpolate" color-relief expression directly from
// user-authored (value, color) stops, same shape every other ramp in this
// file already has — so it flows through computeColorReliefPaint,
// remapColorRampStops (invert), extractStops, and the ramp-picker's own
// gradient-swatch preview unchanged, no special-casing needed downstream.
export function buildCustomRampColors(stops: CustomRampStop[], discrete = false): any[] {
  const sorted = [...stops].sort((a, b) => a.value - b.value)
  // An interpolate expression needs at least 2 (strictly ascending) stops —
  // fall back to the default bands rather than let maplibre's style
  // validator reject a degenerate one-stop (or empty) custom ramp.
  const usable = sorted.length >= 2 ? sorted : DEFAULT_SLOPE_CUSTOM_STOPS
  const colors: any[] = ["interpolate", ["linear"], ["elevation"]]
  if (discrete) {
    // Hard bands: each stop's color holds flat until the next stop's value.
    // color-relief-color only ever evaluates through maplibre's interpolate
    // path (a "step" expression there silently renders transparent — see the
    // note on computePlaneSlicerPaint in MapLayers.tsx), so a stepped look is
    // faked by holding the previous color up to a hair before each boundary and
    // switching in a near-vertical (epsilon-wide) ramp exactly at it. epsilon is
    // kept well under the smallest gap so the injected pair stays strictly
    // ascending, which maplibre's style validator requires.
    let minGap = Infinity
    for (let i = 1; i < usable.length; i++) minGap = Math.min(minGap, usable[i].value - usable[i - 1].value)
    const eps = Number.isFinite(minGap) && minGap > 0 ? Math.min(1e-3, minGap / 1000) : 1e-3
    colors.push(usable[0].value, usable[0].color)
    for (let i = 1; i < usable.length; i++) {
      colors.push(usable[i].value - eps, usable[i - 1].color)
      colors.push(usable[i].value, usable[i].color)
    }
    return colors
  }
  for (const stop of usable) colors.push(stop.value, stop.color)
  return colors
}

// URL-persisted custom stops — same createParser approach as CameraUtilities.tsx's
// parseAsSnapshot (plain JSON round-trip, since {value, color}[] has no binary/precision
// concerns that would justify a denser custom encoding). Falls back to the defaults on
// any malformed/missing query value rather than throwing.
export const parseAsCustomRampStops = createParser({
  parse: (v: string): CustomRampStop[] => {
    try {
      const parsed = JSON.parse(v)
      if (!Array.isArray(parsed)) return DEFAULT_SLOPE_CUSTOM_STOPS
      return parsed
    } catch {
      return DEFAULT_SLOPE_CUSTOM_STOPS
    }
  },
  serialize: (v: CustomRampStop[]) => JSON.stringify(v),
})

// Utility: Remap stops to custom min/max
export function remapColorRampStops(
  colors: any[], 
  customMin: number | undefined, 
  customMax: number | undefined, 
  invertColorRamp: boolean = false
) {
  const newColors = [...colors]
  const stops = extractStops(colors)
  const rampMin = Math.min(...stops)
  const rampMax = Math.max(...stops)
  if (rampMax === rampMin) return newColors
  // customMin/customMax can be transiently undefined during initial mount (nuqs
  // hasn't hydrated URL state yet) — falling back to the ramp's own bounds avoids
  // NaN stops, which maplibre's style validator rejects as "not strictly ascending".
  const effectiveMin = Number.isFinite(customMin) ? (customMin as number) : rampMin
  const effectiveMax = Number.isFinite(customMax) ? (customMax as number) : rampMax
  // A degenerate (zero-width) custom range collapses every remapped stop to the same
  // value — maplibre's style validator rejects that as non-ascending, same failure
  // mode as the undefined-bounds case above. Can be reached directly via a hand-edited
  // URL (e.g. curvatureMin=20&curvatureMax=20), not just the clamped UI inputs, so the
  // guard belongs here rather than only where the bounds are set. Fall back to the
  // ramp's own stops rather than crash.
  if (effectiveMax === effectiveMin) return newColors
  const remap = (value: number): number => {
    const t = (value - rampMin) / (rampMax - rampMin)
    return effectiveMin + t * (effectiveMax - effectiveMin)
  }
  // Apply remap to stops in-place
  let si = 0
  for (let i = 3; i < newColors.length; i += 2) {
    newColors[i] = remap(stops[si++])
  }
  
  // Invert colors if requested (swap colors while keeping stops)
  if (invertColorRamp) {
    const numColorPairs = (newColors.length - 3) / 2
    for (let i = 0; i < numColorPairs / 2; i++) {
      const idx1 = 4 + i * 2  // color at position i
      const idx2 = newColors.length - 1 - i * 2  // color at position from end
      const temp = newColors[idx1]
      newColors[idx1] = newColors[idx2]
      newColors[idx2] = temp
    }
  }
  
  return newColors
}

function parseRgbColor(color: string): [number, number, number, number] {
  const match = color.match(/rgba?\(([^)]+)\)/)
  if (!match) return [0, 0, 0, 1]
  const parts = match[1].split(",").map((s) => parseFloat(s.trim()))
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
}

function formatRgbColor([r, g, b, a]: number[]): string {
  const rr = Math.round(r), gg = Math.round(g), bb = Math.round(b)
  return a >= 1 ? `rgb(${rr}, ${gg}, ${bb})` : `rgba(${rr}, ${gg}, ${bb}, ${+a.toFixed(4)})`
}

function lerpRgbColor(c1: number[], c2: number[], t: number): number[] {
  return c1.map((v, i) => v + (c2[i] - v) * t)
}

// Circularly rotates a ramp whose domain wraps around (e.g. aspect degrees, where
// domainMin and domainMax represent the same physical value, like 0°/360° north) —
// unlike remapColorRampStops (which rescales the domain), this re-derives the color
// at each raw value v as the ORIGINAL ramp's color at (v + shiftAmount) mod period,
// so the ramp visually "rotates" around the circle instead of stretching/compressing.
// Used for Aspect's shift control (see aspect-options-section.tsx): a shift of k°
// rotates which compass direction gets which hue, wrapping seamlessly at the seam.
export function shiftCyclicRampStops(
  colors: any[],
  shiftAmount: number,
  domainMin: number = 0,
  domainMax: number = 360,
) {
  const period = domainMax - domainMin
  if (!period || !shiftAmount) return colors
  const stops = extractStops(colors)
  const cols = stops.map((_, i) => parseRgbColor(colors[4 + i * 2]))
  const n = stops.length
  if (n < 2) return colors

  const k = ((shiftAmount % period) + period) % period
  // Tile each original vertex 3x (one period earlier/at/later) after subtracting the
  // shift, so the wraparound seam is always covered no matter where it falls once sorted.
  const candidates: { pos: number; color: number[] }[] = []
  for (let i = 0; i < n; i++) {
    const basePos = stops[i] - k
    for (const tile of [-period, 0, period]) {
      candidates.push({ pos: basePos + tile, color: cols[i] })
    }
  }
  candidates.sort((a, b) => a.pos - b.pos)

  const colorAt = (pos: number): number[] => {
    for (let i = 0; i < candidates.length - 1; i++) {
      if (pos >= candidates[i].pos && pos <= candidates[i + 1].pos) {
        const span = candidates[i + 1].pos - candidates[i].pos
        const t = span === 0 ? 0 : (pos - candidates[i].pos) / span
        return lerpRgbColor(candidates[i].color, candidates[i + 1].color, t)
      }
    }
    return candidates[0].color
  }

  const boundaryStart = { pos: domainMin, color: colorAt(domainMin) }
  const boundaryEnd = { pos: domainMax, color: colorAt(domainMax) }
  const inRange = candidates.filter((c) => c.pos > domainMin && c.pos < domainMax)
  const points = [boundaryStart, ...inRange, boundaryEnd]

  // De-dup near-identical positions (float noise from the tiling above).
  const seen = new Set<number>()
  const deduped = points.filter((p) => {
    const key = Math.round(p.pos * 1000)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const newColors: any[] = ["interpolate", ["linear"], ["elevation"]]
  for (const p of deduped) newColors.push(p.pos, formatRgbColor(p.color))
  return newColors
}

function fixDomain(domain: number[]) {
  const domainFixed = [...domain];
  for (let i = 1; i < domain.length - 1; i++) {
    if (domain[i] == domain[i - 1]) {
      domainFixed[i] = domain[i - 1] + 0.01 * (domain[i + 1] - domain[i - 1]);
    } 
  }
  return domainFixed;
}

// chroma-js's own runtime (scale.js) branches on `arguments.length === 0` to
// return the ORIGINAL stop colors unchanged — its own bundled @types declare
// the first param as required (not optional), so tsc rejects a bare `.colors()`
// call even though that's the only call shape that returns the original stops.
// Passing `.colors(undefined)` satisfies tsc but changes `arguments.length` to 1,
// which falls through to a totally different "resample from position" code path
// (wrong colors/order for non-uniform stops) — cast away the arity instead so the
// call truly has zero arguments at runtime.
const scaleOriginalColors = (paletteScale: Scale): string[] => (paletteScale.colors as unknown as () => string[])()

function chromajsScaleToMaplibre(paletteScale: Scale) {
  const colors = scaleOriginalColors(paletteScale)
  const domain = paletteScale.domain()
  const domainFixed = fixDomain(domain)
  return [
      "interpolate",
      ["linear"],
      ["elevation"],
      ...domainFixed.flatMap((d: number, i: number) => [d, colors[i]]) 
  ]
}

// Check if a color ramp is continuous or discrete
function isPaletteContinuous(paletteScale: Scale): boolean {
  const colors = scaleOriginalColors(paletteScale);
  const domain = paletteScale.domain();
  const nColors = colors.length  
  if (nColors <= 2) return true
  
  // Count how many consecutive pairs have the same color at different stops
  let discreteSegments = 0
  for (let i = 0; i < nColors - 1; i++) {
    if (colors[i] === colors[i + 1] && domain[i] !== domain[i + 1]) {
      discreteSegments++
    }
  }

  // If more than 30% of segments are discrete/stepped, mark as discrete
  const discreteRatio = discreteSegments / (nColors - 1)
  return discreteRatio < 0.3
}

function extendCptCity(arr: any[]) {
  return arr.map(
    (cpt: any, idx: number) => {
      const palette = parsePalette(cpt.content)
      const domain = palette.domain()
      const domainFixed = fixDomain(domain)
      const colors = chromajsScaleToMaplibre(palette)
      const continuous = isPaletteContinuous(palette)
      return {...cpt, colors, palette, domain, domainFixed, continuous} 
    }
  )
}

function cptToObject(cptArray: any[]): Record<string, { name: string; colors: any[]; continuous: boolean }> {
  // Sort: continuous first, then discrete; alphabetically within each group
  const sorted = cptArray.sort((a, b) => {
    // First sort by continuous (true before false)
    if (a.continuous !== b.continuous) {
      return a.continuous ? -1 : 1
    }
    // Then alphabetically
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
  
  return Object.fromEntries(
    sorted.map((cpt) => [
      cpt.name.toLowerCase(), 
      {
        ...cpt, 
        name: cpt.name, 
        colors: cpt.colors, 
        continuous: cpt.continuous
      }
    ])
  )
}


export const colorRampsClassic = {
  // Original ramps - all continuous
  "black-and-white": {
    name: "Black-and-White",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      0, "rgb(0, 0, 0)",
      8000, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  "white-and-black": {
    name: "White-and-Black",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      0, "rgb(255, 255, 255)",
      8000, "rgb(0, 0, 0)",
    ],
    continuous: true,
  },
  "hypsometric-simple": {
    name: "Hypsometric Simple",
    colors: ["interpolate", ["linear"], ["elevation"], 0, "rgb(112, 209, 255)", 3724, "rgb(255, 178, 129)"],
    continuous: true,
  },
  hypsometric: {
    name: "Hypsometric",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      0, "rgb(112, 209, 255)",
      12.88581315, "rgb(113, 211, 247)",
      51.5432526, "rgb(114, 212, 234)",
      115.9723183, "rgb(117, 213, 222)",
      206.1730104, "rgb(120, 214, 209)",
      322.1453287, "rgb(124, 215, 196)",
      463.8892734, "rgb(130, 215, 183)",
      631.4048443, "rgb(138, 215, 169)",
      824.6920415, "rgb(149, 214, 155)",
      1043.750865, "rgb(163, 212, 143)",
      1288.581315, "rgb(178, 209, 134)",
      1559.183391, "rgb(193, 205, 127)",
      1855.557093, "rgb(207, 202, 121)",
      2177.702422, "rgb(220, 197, 118)",
      2525.619377, "rgb(233, 193, 118)",
      2899.307958, "rgb(244, 188, 120)",
      3298.768166, "rgb(255, 183, 124)",
      3724, "rgb(255, 178, 129)",
    ],
    continuous: true,
  },
  wiki: {
    name: "Wiki",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      400, "rgb(4, 0, 108)",
      582.35, "rgb(5, 1, 154)",
      764.71, "rgb(10, 21, 189)",
      947.06, "rgb(16, 44, 218)",
      1129.41, "rgb(24, 69, 240)",
      1311.76, "rgb(20, 112, 193)",
      1494.12, "rgb(39, 144, 116)",
      1676.47, "rgb(57, 169, 29)",
      1858.82, "rgb(111, 186, 5)",
      2041.18, "rgb(160, 201, 4)",
      2223.53, "rgb(205, 216, 2)",
      2405.88, "rgb(244, 221, 4)",
      2588.24, "rgb(251, 194, 14)",
      2770.59, "rgb(252, 163, 21)",
      2952.94, "rgb(253, 128, 20)",
      3135.29, "rgb(254, 85, 14)",
      3317.65, "rgb(243, 36, 13)",
      3500, "rgb(215, 5, 13)",
    ],
    continuous: true,
  },
  "gmt-globe": {
    name: "GMT Globe",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      -10000, "rgb(153, 0, 255)",
      -9500, "rgb(153, 0, 255)",
      -9000, "rgb(136, 13, 242)",
      -8500, "rgb(119, 25, 229)",
      -8000, "rgb(102, 38, 217)",
      -7500, "rgb(85, 51, 204)",
      -7000, "rgb(68, 64, 191)",
      -6500, "rgb(51, 76, 179)",
      -6000, "rgb(34, 89, 166)",
      -5500, "rgb(17, 102, 153)",
      -5000, "rgb(0, 115, 140)",
      -4500, "rgb(0, 128, 128)",
      -4000, "rgb(0, 140, 115)",
      -3500, "rgb(0, 153, 102)",
      -3000, "rgb(10, 165, 90)",
      -2500, "rgb(26, 178, 77)",
      -2000, "rgb(42, 191, 64)",
      -1500, "rgb(58, 204, 51)",
      -1000, "rgb(74, 217, 38)",
      -500, "rgb(90, 229, 26)",
      -200, "rgb(106, 242, 13)",
      -20, "rgb(241, 252, 255)",
      -0.1, "rgb(241, 252, 255)",
      0.1, "rgb(51, 102, 0)",
      10, "rgb(51, 204, 102)",
      200, "rgb(85, 255, 0)",
      500, "rgb(120, 255, 0)",
      1000, "rgb(187, 255, 0)",
      1500, "rgb(255, 255, 0)",
      2000, "rgb(255, 234, 0)",
      2500, "rgb(255, 213, 0)",
      3000, "rgb(255, 191, 0)",
      3500, "rgb(255, 170, 0)",
      4000, "rgb(255, 149, 0)",
      4500, "rgb(255, 128, 0)",
      5000, "rgb(255, 106, 0)",
      5500, "rgb(255, 85, 0)",
      6000, "rgb(255, 64, 0)",
      6500, "rgb(255, 42, 0)",
      7000, "rgb(255, 21, 0)",
      7500, "rgb(255, 0, 0)",
      8000, "rgb(229, 0, 0)",
      8500, "rgb(204, 0, 0)",
      9000, "rgb(178, 0, 0)",
      9500, "rgb(153, 0, 0)",
      10000, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  "gmt-relief": {
    name: "GMT Relief",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      -10000, "rgb(0, 0, 0)",
      -8000, "rgb(0, 5, 25)",
      -6000, "rgb(0, 10, 50)",
      -4000, "rgb(0, 25, 100)",
      -2000, "rgb(0, 50, 150)",
      -200, "rgb(86, 197, 184)",
      -0.1, "rgb(172, 245, 168)",
      0.1, "rgb(51, 102, 0)",
      200, "rgb(90, 140, 34)",
      1000, "rgb(160, 190, 80)",
      2000, "rgb(220, 220, 110)",
      3000, "rgb(250, 234, 126)",
      4000, "rgb(252, 210, 126)",
      5000, "rgb(250, 189, 126)",
      6000, "rgb(247, 168, 126)",
      7000, "rgb(244, 146, 126)",
      8000, "rgb(242, 125, 126)",
      9000, "rgb(240, 104, 126)",
      10000, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  "gmt-sealand": {
    name: "GMT Sealand",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      -11000, "rgb(0, 0, 0)",
      -10000, "rgb(0, 5, 10)",
      -9000, "rgb(0, 10, 20)",
      -8000, "rgb(0, 15, 30)",
      -7000, "rgb(0, 20, 40)",
      -6000, "rgb(0, 30, 60)",
      -5000, "rgb(0, 40, 80)",
      -4000, "rgb(0, 50, 100)",
      -3000, "rgb(0, 70, 140)",
      -2000, "rgb(0, 90, 180)",
      -1000, "rgb(0, 120, 240)",
      -200, "rgb(51, 153, 255)",
      -0.1, "rgb(102, 204, 255)",
      0.1, "rgb(0, 128, 0)",
      200, "rgb(51, 153, 0)",
      1000, "rgb(102, 178, 0)",
      2000, "rgb(178, 204, 0)",
      3000, "rgb(229, 229, 0)",
      4000, "rgb(255, 204, 0)",
      5000, "rgb(255, 153, 0)",
      6000, "rgb(255, 102, 0)",
      7000, "rgb(255, 51, 0)",
      8000, "rgb(204, 0, 0)",
      9000, "rgb(153, 0, 0)",
      10000, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  "gmt-topo": {
    name: "GMT Topo",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      -10000, "rgb(153, 0, 255)",
      -8000, "rgb(102, 51, 204)",
      -6000, "rgb(51, 102, 153)",
      -4000, "rgb(0, 153, 102)",
      -2000, "rgb(51, 204, 102)",
      -200, "rgb(153, 255, 204)",
      -0.1, "rgb(204, 255, 204)",
      0.1, "rgb(0, 128, 0)",
      200, "rgb(102, 153, 0)",
      1000, "rgb(204, 204, 0)",
      2000, "rgb(255, 255, 0)",
      3000, "rgb(255, 204, 0)",
      4000, "rgb(255, 153, 0)",
      5000, "rgb(255, 102, 0)",
      6000, "rgb(255, 51, 0)",
      7000, "rgb(204, 0, 0)",
      8000, "rgb(153, 0, 0)",
      9000, "rgb(102, 0, 0)",
      10000, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  "topo-15lev": {
    name: "Topo 15lev",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      -8000, "rgb(0, 0, 128)",
      -6000, "rgb(0, 64, 192)",
      -4000, "rgb(0, 128, 255)",
      -2000, "rgb(64, 192, 255)",
      -1000, "rgb(128, 224, 255)",
      -200, "rgb(170, 240, 255)",
      -0.1, "rgb(204, 255, 255)",
      0.1, "rgb(0, 128, 0)",
      200, "rgb(128, 192, 64)",
      500, "rgb(192, 224, 128)",
      1000, "rgb(224, 240, 192)",
      2000, "rgb(255, 255, 224)",
      3000, "rgb(255, 224, 192)",
      4000, "rgb(255, 192, 128)",
      5000, "rgb(255, 160, 64)",
      6000, "rgb(224, 128, 32)",
      7000, "rgb(192, 96, 0)",
    ],
    continuous: true,
  },
  // https://plantopo.com/map#c=12/44.97009/6.50524&l=default~slope-angle.overlay — degrees of
  // slope, not elevation, but the "elevation" expression in a color-relief layer just reads
  // whatever the DEM source decodes, so this drops straight into the same pipeline as the
  // elevation ramps above when pointed at a slope-angle-encoded source (see SlopeReliefLayer
  // in MapLayers.tsx). Colors kept fully opaque here — like every other ramp — since overall
  // transparency is controlled separately via the layer's color-relief-opacity paint property.
  "slope-plantopo": {
    name: "Slope (PlanTopo)",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      0, "rgba(0, 0, 0, 0)",
      29, "rgba(0, 0, 0, 0)",
      30, "rgb(245, 247, 156)",
      35, "rgb(249, 200, 87)",
      40, "rgb(250, 101, 56)",
      45, "rgb(234, 72, 47)",
      50, "rgb(221, 50, 40)",
      55, "rgb(216, 37, 37)",
    ],
    continuous: true,
  },
  // Compass bearing (0-360°, 0=North) from lib/aspect-protocol.ts — a single hue-wheel
  // cycle, red only at the two endpoints (0° and 360° both mean North, so they must
  // match; every other stop is a distinct hue). Linear ramps can't truly wrap a
  // circular domain, so there's an inherent seam right at that N/N boundary — same
  // caveat most GIS aspect renderers accept.
  "aspect-compass": {
    name: "Aspect (Compass)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      0, "rgb(255, 0, 0)",     // N
      45, "rgb(255, 165, 0)",  // NE
      90, "rgb(255, 255, 0)",  // E
      135, "rgb(0, 255, 0)",   // SE
      180, "rgb(0, 255, 255)", // S
      225, "rgb(0, 0, 255)",   // SW
      270, "rgb(128, 0, 255)", // W
      315, "rgb(255, 0, 255)", // NW
      360, "rgb(255, 0, 0)",   // N (wraps back to the same color as 0°)
    ],
    continuous: true,
  },
  // Terrain Ruggedness Index (meters, Riley et al. 2006) from lib/tri-protocol.ts.
  // Flat ground (0) is fully transparent rather than opaque white, so unrugged
  // terrain doesn't get tinted at all — only the ruggedness itself shows through.
  "tri-default": {
    name: "Terrain Ruggedness",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      0, "rgba(255, 255, 255, 0)",
      5, "rgb(255, 247, 188)",
      15, "rgb(254, 196, 79)",
      30, "rgb(217, 95, 14)",
      50, "rgb(153, 0, 0)",
    ],
    continuous: true,
  },
  // General (Laplacian) curvature from lib/curvature-protocol.ts — negative/convex
  // (ridges) to positive/concave (valleys), diverging around a flat=fully-transparent
  // midpoint rather than opaque white, so flat ground doesn't get tinted at all.
  "curvature-diverging": {
    name: "Curvature (Diverging)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -20, "rgb(178, 24, 43)",
      -5, "rgb(244, 165, 130)",
      0, "rgba(255, 255, 255, 0)",
      5, "rgb(146, 197, 222)",
      20, "rgb(33, 102, 172)",
    ],
    continuous: true,
  },
  // Two monochrome curvature ramps that diverge to the SAME tone at both
  // extremes and fade to fully transparent at flat (0) — so any curved feature
  // (ridge OR valley) is drawn in one ink over an otherwise-untinted surface,
  // rather than a two-color ridge-vs-valley split (that's what curvature-
  // diverging above is for). Pick the one whose ink contrasts your basemap:
  // black-transp-black reads on a light basemap, white-transp-white on a dark
  // one. Conceptually these are the "white-black-white" / "black-white-black"
  // pair with the theme-matching tone taken all the way to transparent, so no
  // separate theme-based colorramp preprocessing is needed here.
  "curvature-mono-black": {
    name: "Curvature (Black on Transparent)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -20, "rgb(0, 0, 0)",
      -5, "rgba(0, 0, 0, 0.5)",
      0, "rgba(0, 0, 0, 0)",
      5, "rgba(0, 0, 0, 0.5)",
      20, "rgb(0, 0, 0)",
    ],
    continuous: true,
  },
  "curvature-mono-white": {
    name: "Curvature (White on Transparent)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -20, "rgb(255, 255, 255)",
      -5, "rgba(255, 255, 255, 0.5)",
      0, "rgba(255, 255, 255, 0)",
      5, "rgba(255, 255, 255, 0.5)",
      20, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  // Topographic Position Index (meters, center minus neighborhood mean) from
  // lib/tpi-protocol.ts — negative/below-neighborhood (valleys/pits) to positive/
  // above-neighborhood (ridges/peaks), diverging around a flat=fully-transparent
  // midpoint rather than opaque white, so mid-slope ground doesn't get tinted at all.
  "tpi-diverging": {
    name: "TPI (Diverging)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -20, "rgb(33, 102, 172)",
      -5, "rgb(146, 197, 222)",
      0, "rgba(255, 255, 255, 0)",
      5, "rgb(253, 174, 97)",
      20, "rgb(178, 24, 43)",
    ],
    continuous: true,
  },
  // Local Relief Model (meters, raw elevation minus a low-pass regional trend) from
  // lib/lrm-protocol.ts — negative/below-trend (valleys relative to the surrounding
  // region) to positive/above-trend (ridges/mounds relative to the surrounding
  // region), diverging around a flat=fully-transparent midpoint, same convention as
  // tpi-diverging above (which is the same idea at a much smaller, fixed 3x3 scale).
  "lrm-diverging": {
    name: "LRM (Diverging)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -20, "rgb(33, 102, 172)",
      -5, "rgb(146, 197, 222)",
      0, "rgba(255, 255, 255, 0)",
      5, "rgb(253, 174, 97)",
      20, "rgb(178, 24, 43)",
    ],
    continuous: true,
  },
  // Roughness (meters, max-min elevation in a 3x3 neighborhood) from
  // lib/roughness-protocol.ts. Flat ground (0) is fully transparent rather than
  // opaque white, matching tri-default, since it's the same "unrugged ground
  // shouldn't get tinted" reasoning.
  "roughness-default": {
    name: "Roughness",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      0, "rgba(255, 255, 255, 0)",
      5, "rgb(224, 236, 244)",
      15, "rgb(158, 188, 218)",
      30, "rgb(140, 107, 177)",
      50, "rgb(110, 1, 107)",
    ],
    continuous: true,
  },
  // Structure-tensor "blobness" (unitless, det(J)/trace(J) rescaled) from
  // lib/blobness-protocol.ts — large at peaks/pits/saddles/knolls where the
  // gradient direction varies across the window, near zero on a uniform slope or
  // straight ridge/valley. Flat/directionally-uniform ground (0) is fully
  // transparent, same "unrugged ground shouldn't get tinted" reasoning as
  // tri-default/roughness-default.
  "blobness-default": {
    name: "Blobness",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      0, "rgba(255, 255, 255, 0)",
      5, "rgb(229, 245, 249)",
      15, "rgb(153, 216, 201)",
      30, "rgb(44, 162, 95)",
      50, "rgb(0, 109, 44)",
    ],
    continuous: true,
  },
  // Sky View Factor (0-100, fraction of sky hemisphere visible ×100) from
  // lib/svf-protocol.ts. Unlike TRI/Roughness/Blobness, every pixel has a
  // meaningful value here (there's no "flat = boring" case to hide) — same
  // always-opaque, dark-to-light convention as a grayscale ambient-occlusion
  // pass: 0 (fully enclosed, e.g. a narrow pit) to 100 (fully open, e.g. a summit).
  "svf-default": {
    name: "Sky View Factor",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      0, "rgb(20, 20, 35)",
      40, "rgb(70, 75, 110)",
      70, "rgb(150, 160, 190)",
      90, "rgb(220, 225, 235)",
      100, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  // Same as svf-default, but the fully-open (100, white) end fades to alpha 0
  // instead of opaque white — open/unremarkable ground disappears entirely and
  // shows the basemap/hillshade underneath, rather than washing it out white.
  "svf-transparent": {
    name: "Sky View Factor (Transparent)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      0, "rgb(20, 20, 35)",
      40, "rgb(70, 75, 110)",
      70, "rgb(150, 160, 190)",
      90, "rgb(220, 225, 235)",
      100, "rgba(255, 255, 255, 0)",
    ],
    continuous: true,
  },
  // Openness (positive or negative, degrees, re-centered so 0 = flat ground) from
  // lib/openness-protocol.ts. Grayscale, always-opaque — the conventional RVT/
  // literature display for Openness (and SVF): dark = enclosed (valley/pit-like),
  // light = open (ridge/summit-like), mid-gray at 0 (flat ground) — same spirit
  // as svf-default's ambient-occlusion-style shading rather than a diverging
  // "tinted overlay on top of the terrain" look.
  "openness-default": {
    name: "Openness",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -15, "rgb(15, 15, 15)",
      -5, "rgb(90, 90, 90)",
      0, "rgb(160, 160, 160)",
      5, "rgb(210, 210, 210)",
      15, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  // Same as openness-default, but the most-open (15, white) end fades to alpha 0
  // instead of opaque white — same reasoning as svf-transparent above.
  "openness-transparent": {
    name: "Openness (Transparent)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -15, "rgb(15, 15, 15)",
      -5, "rgb(90, 90, 90)",
      0, "rgb(160, 160, 160)",
      5, "rgb(210, 210, 210)",
      15, "rgba(255, 255, 255, 0)",
    ],
    continuous: true,
  },
  // Local Dominance (degrees, Hesse 2016) from lib/local-dominance-protocol.ts —
  // mean view-angle down onto the surroundings over a distance annulus. Grayscale,
  // always-opaque, same ambient-occlusion spirit as openness-default: dark = low
  // dominance (enclosed/looked-down-upon depressions), light = high dominance
  // (mounds/ridges that dominate their surroundings). Flat ground sits at a small
  // positive baseline (from the observer's eye height), not zero — hence the
  // asymmetric default stops rather than a diverging-around-0 ramp.
  "local-dominance-default": {
    name: "Local Dominance",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -5, "rgb(20, 20, 35)",
      0, "rgb(85, 88, 100)",
      3, "rgb(150, 152, 160)",
      8, "rgb(215, 218, 222)",
      15, "rgb(255, 255, 255)",
    ],
    continuous: true,
  },
  // Diverging alternative to openness-default, kept selectable for anyone who
  // prefers a tinted overlay (transparent at flat) over the grayscale look.
  "openness-diverging": {
    name: "Openness (Diverging)",
    colors: [
      "interpolate", ["linear"], ["elevation"],
      -15, "rgb(33, 102, 172)",
      -4, "rgb(146, 197, 222)",
      0, "rgba(255, 255, 255, 0)",
      4, "rgb(253, 174, 97)",
      15, "rgb(178, 24, 43)",
    ],
    continuous: true,
  },
  // Discrete ramps
  // None
}

// Sort colorRampsClassic: continuous first, discrete last
const sortedClassicEntries = Object.entries(colorRampsClassic).sort((a, b) => {
  const [, aRamp] = a
  const [, bRamp] = b
  // First sort by continuous (true before false)
  if (aRamp.continuous !== bRamp.continuous) {
    return aRamp.continuous ? -1 : 1
  }
  // Then alphabetically
  return aRamp.name.toLowerCase().localeCompare(bRamp.name.toLowerCase())
})

const colorRampsClassicSorted = Object.fromEntries(sortedClassicEntries)

const colorRamps = Object.fromEntries(
  Object.entries(cpt_city_views).map(
    ([key, value]) => {
      const extended = extendCptCity(value)
      const obj = cptToObject(extended)
      return [key, obj]
    }
  )
)
colorRamps['classic'] = colorRampsClassic;
colorRamps['cet'] = colorRampsCet;
colorRamps['sdr'] = colorRampsSdr;

export {colorRamps}

export const colorRampsFlat = Object.assign({}, ...Object.values(colorRamps));

// Test
// const cpt = colorRampsFlat['arctic'].content
// const {palette, domain} = parsePaletteWithStops(cpt);
// const colors = chromajsScaleToMaplibre(palette, domain)
// console.log({cpt, palette, domain, colors})

export const COLOR_RAMP_IDS = Object.keys(colorRampsFlat)
export type ColorRampId = keyof typeof colorRampsFlat

/** Data-driven (feature-property) variant of the color-relief ramp remap: the
 *  same ramp/min/max/invert treatment computeColorReliefPaint applies, but with
 *  the ["elevation"] input swapped for ["get", property] so the identical ramp
 *  state can drive e.g. the tells markers' circle-color. Returns undefined when
 *  the ramp id is unknown (caller falls back to a flat color). */
export function computePropertyRampExpression(
  colorRamp: string | undefined,
  min: number | undefined,
  max: number | undefined,
  invertColorRamp: boolean,
  property: string,
): any[] | undefined {
  const ramp = colorRamp ? (colorRampsFlat as Record<string, { colors: any[] }>)[colorRamp] : undefined
  if (!ramp) return undefined
  const expr = [...remapColorRampStops(ramp.colors, min, max, invertColorRamp)]
  if (expr[0] === "interpolate") expr[2] = ["get", property]
  else if (expr[0] === "step") expr[1] = ["get", property]
  return expr
}