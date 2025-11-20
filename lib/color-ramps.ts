import type { ColorReliefRamp } from "./terrain-types"
import {cpt_city_views} from "./cpt-city/cpt-city-views"
import type { Scale } from 'chroma-js';

// import { parsePalette, colorRampCanvas } from 'cpt2js';
import {parsePaletteWithStops} from './cpt-city/cpt2js-stops';

export function extractStops(colors: any[]): number[] {
  const stops = []
  // Extract stops at indices 3 += 2
  for (let i = 3; i < colors.length; i += 2) {
    stops.push(colors[i])
  }
  return stops
}
// Utility: Remap stops to custom min/max
export function remapColorRampStops(colors: any[], customMin: Number | undefined, customMax: Number | undefined) {
  const newColors = [...colors]
  const stops = extractStops(colors)
  const rampMin = Math.min(...stops)
  const rampMax = Math.max(...stops)
  if (rampMax === rampMin) return newColors
  const remap = (value: Number): Number => {
    const t = (value - rampMin) / (rampMax - rampMin)
    return customMin + t * (customMax - customMin)
  }
  // Apply remap to stops in-place
  let si = 0
  for (let i = 3; i < newColors.length; i += 2) {
    newColors[i] = remap(stops[si++])
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

function chromajsScaleToMaplibre(paletteScale: Scale, domain: number[]) {
  const domainFixed = fixDomain(domain)
  return [
      "interpolate",
      ["linear"],
      ["elevation"],
      ...domainFixed.flatMap((d: number, i: number) => [d, paletteScale.colors()[i]]) 
      // instead of .map().flat()
  ]
}

function extendCptCity(arr: any[]) {
  return arr.map(
    (cpt: any, idx: number) => {
      const {palette, domain} = parsePaletteWithStops(cpt.content)
      const domainFixed = fixDomain(domain)
      const colors = chromajsScaleToMaplibre(palette, domain)
      return {...cpt, colors, palette, domain, domainFixed} 
    }
  )
}

function cptToObject(cptArray: any[]): Record<ColorReliefRamp, { name: string; colors: any[] }> {
  return Object.fromEntries(
    cptArray
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map((cpt) => [cpt.name.toLowerCase(), {...cpt, name: cpt.name, colors: cpt.colors, }])
  )
}


export const colorRampsClassic: Record<ColorReliefRamp, { name: string; colors: any[] }> = {
  // Original ramps
  dem: {
    name: "DEM",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      400, "rgb(112, 209, 255)",
      494.1176471, "rgb(113, 211, 247)",
      588.2352941, "rgb(114, 212, 234)",
      682.3529412, "rgb(117, 213, 222)",
      776.4705882, "rgb(120, 214, 209)",
      870.5882353, "rgb(124, 215, 196)",
      964.7058824, "rgb(130, 215, 183)",
      1058.823529, "rgb(138, 215, 169)",
      1152.941176, "rgb(149, 214, 155)",
      1247.058824, "rgb(163, 212, 143)",
      1341.176471, "rgb(178, 209, 134)",
      1435.294118, "rgb(193, 205, 127)",
      1529.411765, "rgb(207, 202, 121)",
      1623.529412, "rgb(220, 197, 118)",
      1717.647059, "rgb(233, 193, 118)",
      1811.764706, "rgb(244, 188, 120)",
      1905.882353, "rgb(255, 183, 124)",
      2000, "rgb(255, 178, 129)",
    ],
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
  },
  "hypsometric-simple": {
    name: "Hypsometric Simple",
    colors: ["interpolate", ["linear"], ["elevation"], 0, "rgb(112, 209, 255)", 3724, "rgb(255, 178, 129)"],
  },
  rainbow: {
    name: "Rainbow",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      400, "#F00",
      800, "#AA0",
      1000, "#AF0",
      1200, "#0F0",
      1400, "#0AA",
      1600, "#00F",
      2000, "#C0C",
    ],
  },
  transparent: {
    name: "Transparent Rainbow",
    colors: [
      "interpolate",
      ["linear"],
      ["elevation"],
      400, "#F00C",
      800, "#AA0A",
      1000, "#AF09",
      1200, "#0F08",
      1400, "#0AA7",
      1600, "#00F6",
      2000, "#C0C4",
    ],
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
  },

  // other ramps
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
  },

}

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