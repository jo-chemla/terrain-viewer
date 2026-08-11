/**
 * Histogram utility functions based on scikit-image and numpy implementations
 */

/**
 * Compute histogram bins for an array
 * @param {Array} arr - Input array
 * @param {number} binCount - Number of bins
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {boolean} normalize - Whether to normalize (default: false)
 * @returns {Uint32Array|Float64Array} Histogram bins
 */
export function bincount(arr, nbins, min, max, normalize = false) {
  if (min === undefined) min = Math.min(...arr);
  if (max === undefined) max = Math.max(...arr);
  const scale = nbins / (max - min)

  // Clamping is needed to avoid overflow when x == max for fixed-width bins
  let bins = new Uint32Array(nbins);
  for (let i = 0; i < arr.length; i++) {
    const bin = Math.min(nbins - 1, Math.floor((arr[i] - min) * scale));
    bins[bin]++;
  }

  if (normalize)
    bins = Float64Array.from(bins, b => b / arr.length);

  return bins;
}

/**
 * Cumulative sum of array
 * @param {Array} arr - Input array
 * @returns {Float64Array} Cumulative sum
 */
export function cumsum(arr) {
  const n = arr.length;
  const out = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += arr[i];
    out[i] = sum;
  }
  return out;
}

/**
 * Linear interpolation (numpy.interp equivalent)
 * @param {Array} x - X coordinates to interpolate
 * @param {Array} xp - Known x coordinates
 * @param {Array} fp - Known y coordinates
 * @returns {Float64Array} Interpolated values
 */
export function interp(x, xp, fp) {
  const out = new Float64Array(x.length);

  for (let i = 0; i < x.length; i++) {
    const xi = x[i];

    // Clamp left of xp[0]
    if (xi <= xp[0]) {
      out[i] = fp[0];
      continue;
    }
    // Clamp right of xp[-1]
    if (xi >= xp[xp.length - 1]) {
      out[i] = fp[fp.length - 1];
      continue;
    }

    // Linear scanning to find when indexed surpasses interpolant
    let j = 1;
    while (xi > xp[j]) j++;

    const x0 = xp[j - 1], x1 = xp[j];
    const y0 = fp[j - 1], y1 = fp[j];
    const t = (xi - x0) / (x1 - x0);
    out[i] = y0 + t * (y1 - y0);
  }

  return out;
}

/**
 * Get normalized CDF Cumulative Distribution Function for uint8 array
 * @param {Uint8Array} arr - Input array
 * @returns {Object} Object with bincounts and cdf properties
 */
export function getNormalizedCdfUint8(arr) {
  const bincounts = bincount(arr, 256, 0, 255, true);
  const cdf = cumsum(bincounts);
  return { bincounts, cdf };
}

/**
 * Compute mapping between source and target by matching CDFs
 * @param {Uint8Array} source - Source channel data
 * @param {Uint8Array} target - Target channel data
 * @returns {Object} Object with mapping, srcHist, and tgtHist
 */
export function matchCdf(source, target) {
  const srcCdf = getNormalizedCdfUint8(source);
  const tgtCdf = getNormalizedCdfUint8(target);
  const values = Array.from({ length: 256 }, (_, i) => i);
  const mapping = interp(srcCdf.cdf, tgtCdf.cdf, values);

  return {
    mapping,
    srcHist: srcCdf.bincounts,
    tgtHist: tgtCdf.bincounts
  };
}

/**
 * High-level, Main histogram matching function for 2 Uint8Arrays
 * @param {Uint8Array} source - Source image array
 * @param {Uint8Array} target - Target image array
 * @param {number} channels - Number of channels (default: 3)
 * @param {string} returnType - 'MAPPING' or 'MATCHED_DATA' (default: 'MATCHED_DATA')
 * @param {number} maxMpx - Max megapixels for downsampling (default: 0, no limit)
 * @returns {Object} Object with mappings and optionally matched data
 */
export function matchHistogramsRGB(source, target, channels = 3, returnType = 'MATCHED_DATA', maxMpx = 0) {
  // Calculate downsampling if needed
  let srcDownsample = 1, tgtDownsample = 1;
  if (maxMpx > 0) {
    srcDownsample = Math.ceil((source.length / channels / 1e6) / maxMpx);
    tgtDownsample = Math.ceil((target.length / channels / 1e6) / maxMpx);
    console.log('Downsampling factors', srcDownsample, tgtDownsample);
  }

  // Process RGB channels
  const mappings = [];
  for (let c = 0; c < Math.min(3, channels); c++) {
    const srcChannel = [];
    const tgtChannel = [];
    for (let i = c; i < source.length; i += channels * srcDownsample) {
      srcChannel.push(source[i]);
    }
    for (let i = c; i < target.length; i += channels * tgtDownsample) {
      tgtChannel.push(target[i]);
    }
    mappings[c] = matchCdf(srcChannel, tgtChannel);
  }

  if (returnType === 'MAPPING') return { mappings };

  // Apply mappings to create matched image
  const out = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i += channels) {
    for (let c = 0; c < 3; c++) {
      out[i + c] = mappings[c].mapping[source[i + c]];
    }
    if (channels === 4) out[i + 3] = source[i + 3]; // keep alpha
  }

  return { mappings, matched: out };
}

// Apply Histogram Matching not only in RGB color space, but also other supported by mapbox/rio-hist
// Imported by full CDN URL (not the bare "color-convert" specifier) so this
// standalone static page — served straight from public/, not bundled by
// Vite — doesn't need an import map, and Vite's dependency scanner (which
// crawls every HTML file's <script type=module> reachable from the project,
// including ones under public/) treats it as an external URL instead of
// trying to resolve/pre-bundle it as a node_modules package.
import convert from 'https://esm.sh/color-convert@3.1.0';
export const COLOR_SPACE = {
  RGB: 'rgb',
  HSL: 'hsl',
  HSV: 'hsv',
  XYZ: 'xyz',
  LAB: 'lab',
  LCH: 'lch',
};

// Fixed scales per color space (not exposed by color-convert, taken from docs/specs)
export const COLOR_SCALES = {
  rgb: {
    0: { min: 0, max: 255, name: 'r' },
    1: { min: 0, max: 255, name: 'g' },
    2: { min: 0, max: 255, name: 'b' },
  },
  hsl: {
    0: { min: 0, max: 360, name: 'h' },
    1: { min: 0, max: 100, name: 's' },
    2: { min: 0, max: 100, name: 'l' },
  },
  hsv: {
    0: { min: 0, max: 360, name: 'h' },
    1: { min: 0, max: 100, name: 's' },
    2: { min: 0, max: 100, name: 'v' },
  },
  xyz: {
    0: { min: 0, max: 95.047, name: 'x' },
    1: { min: 0, max: 100, name: 'y' },
    2: { min: 0, max: 108.883, name: 'z' },
  },
  lab: {
    0: { min: 0, max: 100, name: 'l' },
    1: { min: -127, max: 127, name: 'a' },
    2: { min: -127, max: 127, name: 'b' },
  },
  lch: {
    0: { min: 0, max: 100, name: 'l' },
    1: { min: 0, max: 131, name: 'c' },
    2: { min: 0, max: 360, name: 'h' },
  },
};

// convert an RGB input triplet to passed colorspace. Use raw converters to avoid clamping output triplet to integer value
function rgbToColorspace(rgb, colorspace = COLOR_SPACE.RGB) {
  switch (colorspace) {
    case COLOR_SPACE.RGB: return rgb;
    case COLOR_SPACE.HSL: return convert.rgb.hsl.raw(rgb);
    case COLOR_SPACE.HSV: return convert.rgb.hsv.raw(rgb);
    case COLOR_SPACE.XYZ: return convert.rgb.xyz.raw(rgb);
    case COLOR_SPACE.LAB: return convert.rgb.lab.raw(rgb);
    case COLOR_SPACE.LCH: return convert.rgb.lch.raw(rgb);
    default:
      throw new Error(`Unsupported color space: ${colorspace}`);
  }
}
// convert an input triplet from passed colorspace to RGB
function colorspaceToRGB(color, colorspace = COLOR_SPACE.RGB) {
  switch (colorspace) {
    case COLOR_SPACE.RGB: return color;
    case COLOR_SPACE.HSL: return convert.hsl.rgb(color);
    case COLOR_SPACE.HSV: return convert.hsv.rgb(color);
    case COLOR_SPACE.XYZ: return convert.xyz.rgb(color);
    case COLOR_SPACE.LAB: return convert.lab.rgb(color);
    case COLOR_SPACE.LCH: return convert.lch.rgb(color);
    default:
      throw new Error(`Unsupported color space: ${colorspace}`);
  }
}


// Match CDF using fixed channel scales (from COLOR_SCALES)
export function matchCdfGeneral(sourceVals, targetVals, binCount=256, { min, max }) {
  const srcBins = bincount(sourceVals, binCount, min, max, true);
  const tgtBins = bincount(targetVals, binCount, min, max, true);
  const srcCdf = cumsum(srcBins);
  const tgtCdf = cumsum(tgtBins);

  // Remap values to min/max for interp sampling points
  const step = (max - min) / (binCount - 1);
  const values = Float64Array.from({ length: binCount }, (_, i) => min + i * step);
  const mapping = interp(srcCdf, tgtCdf, values);
  return {
    mapping,
    srcHist: srcBins,
    tgtHist: tgtBins,
    min, max, binCount,
  };
}

// Utility to extract bands array in colorspace from rgb of interleaved input array
function getCsBandsArr(bixs, interleavedRgb, stride, colorSpace) {
  const colorspaceBands = [[], [], []];
  for (let i = 0; i < interleavedRgb.length; i += stride) {
    const rgb = interleavedRgb.slice(i, i + 3)
    const colorspaced = rgbToColorspace(rgb, colorSpace);
    for (const bi of bixs)
      colorspaceBands[bi].push(colorspaced[bi])
  }
  return colorspaceBands
}

/**
 * Match histograms with optional color-space + selected bands (Mapbox rio-hist style).
 * Only specified bands are matched; non-selected bands are copied from source.
 *
 * @param {Uint8Array} source - flat RGB interleaved 1/3/4 channels (Uint8)
 * @param {Uint8Array} target - flat RGB interleaved 1/3/4 channels (Uint8)
 * @param {number} channels - Number of channels (default: 3)
 * @param {{ returnType?: string, maxMpx?: Number, colorSpace?: keyof typeof COLOR_SPACE, bands?: number[], binCount?: number }} options
 *        returnType 'MAPPING' or 'MATCHED_DATA' (default: 'MATCHED_DATA')
 *        maxMpx - Max megapixels threshold for downsampling (default 0: off)
 *        colorSpace - Color space for matching from COLOR_SPACE enum (default: COLOR_SPACE.RGB)
 *        bands - Bands to process, 1-based indices in that color space (1-indexed, default: [1, 2, 3])
 *        binCount - number of bins to do the histogram binning (default 256)
 * @returns {{mappings: any[], matched?: Uint8Array}}
 */
export function matchHistogramsColorspaces(
  source,
  target,
  channels = 3,
  {
    returnType = 'MATCHED_DATA',
    maxMpx = 0,
    colorSpace = COLOR_SPACE.RGB,
    bands = [1, 2, 3],
    binCount = 256,
  } = {}
) {
  if (!Object.values(COLOR_SPACE).includes(colorSpace)) {
    throw new Error(`Unsupported color space: ${colorSpace}. Supported: ${Object.values(COLOR_SPACE).join(', ')}`);
  }
   // Downsample source and target arrays in case they exceed user-defined maxMpx param
   let srcDownsample = 1, tgtDownsample = 1;
   if (maxMpx > 0) {
     srcDownsample = Math.ceil((source.length / channels / 1e6) / maxMpx)
     tgtDownsample = Math.ceil((source.length / channels / 1e6) / maxMpx)
     console.log('Downsampling factors', srcDownsample, tgtDownsample)
   }

  // Build per-band arrays in requested color space (from RGB)
  // bands indices are 1-based to match rio / rio-hist convention
  const bixs = bands.map(b => b - 1).filter(b => b >= 0 && b < channels);
  if (bixs.length === 0) {
    throw new Error('No valid bands specified');
  }
  const srcBands = getCsBandsArr(bixs, source, channels * srcDownsample, colorSpace)
  const tgtBands = getCsBandsArr(bixs, target, channels * tgtDownsample, colorSpace)

  const mappings = new Array(3).fill(null);
  for (const bi of bixs) {
    const scale = COLOR_SCALES[colorSpace][bi];
    mappings[bi] = matchCdfGeneral(
      srcBands[bi],
      tgtBands[bi],
      binCount,
      { min: scale.min, max: scale.max }
    );
  }
  console.log('mappings', mappings)

  if (returnType === 'MAPPING') return {mappings};

  // Apply LUTs ONLY to selected bands in CS; keep others from source
  const out = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i += channels) {
    const rgb = source.slice(i, i + 3),
      alpha = channels === 4 ? source[i + 3] : 255;
    let csTriplet = rgbToColorspace(rgb, colorSpace);
    // apply per selected band
    for (const bi of bixs) {
      const map = mappings[bi];
      if (!map) continue;
      // compute source bin index for this band using the same [min,max] & binCount
      const { min, max, binCount: B } = map;
      const v = csTriplet[bi];
      const idxFloat = (v - min) * (B - 1) / (max - min || 1);
      const idx = Math.max(0, Math.min(B - 1, Math.floor(idxFloat)));
      const mappedVal = map.mapping[idx];
      csTriplet[bi] = mappedVal;
    }
    const [nr, ng, nb] = colorspaceToRGB(csTriplet, colorSpace);
    out[i] = Math.max(0, Math.min(255, Math.round(nr)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(ng)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(nb)));
    if (channels === 4) out[i + 3] = alpha; // keep alpha
  }
  return { mappings, matched: out };
}
