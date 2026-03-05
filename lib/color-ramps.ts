import type { ColorReliefRamp } from "./terrain-types"
import {cpt_city_views} from "./cpt-city/cpt-city-views"
import type { Scale } from 'chroma-js';

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
  const remap = (value: number): number => {
    const t = (value - rampMin) / (rampMax - rampMin)
    return customMin + t * (customMax - customMin)
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

function fixDomain(domain: number[]) {
  const domainFixed = [...domain];
  for (let i = 1; i < domain.length - 1; i++) {
    if (domain[i] == domain[i - 1]) {
      domainFixed[i] = domain[i - 1] + 0.01 * (domain[i + 1] - domain[i - 1]);
    } 
  }
  return domainFixed;
}

function chromajsScaleToMaplibre(paletteScale: Scale) {
  const colors = paletteScale.colors()
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
  const colors = paletteScale.colors();
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

function cptToObject(cptArray: any[]): Record<ColorReliefRamp, { name: string; colors: any[]; continuous: boolean }> {
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


export const colorRampsClassic: Record<ColorReliefRamp, { name: string; colors: any[]; continuous: boolean }> = {
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

export {colorRamps}

export const colorRampsFlat = Object.assign({}, ...Object.values(colorRamps));

// Test
// const cpt = colorRampsFlat['arctic'].content
// const {palette, domain} = parsePaletteWithStops(cpt);
// const colors = chromajsScaleToMaplibre(palette, domain)
// console.log({cpt, palette, domain, colors})

export const COLOR_RAMP_IDS = Object.keys(colorRampsFlat) 
export type ColorRampId = keyof typeof colorRampsFlat