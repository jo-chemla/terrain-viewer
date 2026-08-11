// Client-side histogram matching, ported from Iconem/historical-satellite's
// src/histogram-matching/histogram-utils.js (itself based on scikit-image's
// exposure.match_histograms, BSD3). Two paths:
//  - RGB: a per-channel 0-255 LUT, cheap enough to apply as a live CSS SVG
//    feComponentTransfer filter directly on the map's <canvas> (see
//    HistogramMatchFilter.tsx) — no pixel data is ever rewritten.
//  - HSL/HSV/LAB/LCH: feComponentTransfer only ever operates on raw R/G/B
//    output, so a LUT computed in one of these spaces can't be expressed as
//    a CSS filter — there is no per-channel-independent CSS transform that
//    reproduces "convert to HSL, remap, convert back to RGB". These paths
//    instead convert every pixel, remap each channel by interpolating its
//    own matched CDF (arbitrary [min,max] ranges, not fixed 0-255 bins), and
//    convert back — real per-pixel JS work, applied to a capped-resolution
//    offscreen canvas that's then drawn over the live map canvas. Slower and
//    lower-fidelity than the RGB path by design.
//
//    The conversions are hand-rolled (not chroma-js, despite it already
//    being a project dependency) — chroma()'s per-call Color-object
//    construction/argument-sniffing/method-dispatch overhead is real when
//    called per-pixel across tens of thousands of pixels (measured ~4-5x
//    slower than the plain-number versions below on a 256x256 working
//    canvas). No GPU/shader path: at the capped working resolution this is
//    already comfortably inside the once/second budget, and a texture-based
//    conversion would trade a meaningful complexity jump (shader compile,
//    readback sync) for savings that don't matter at this scale.
// See https://github.com/Iconem/historical-satellite/blob/main/src/histogram-matching/histogram-utils.js

function bincountUint8(arr: Uint8ClampedArray | Uint8Array, stride: number, offset: number, normalize = true) {
  const bins = new Float64Array(256)
  let count = 0
  for (let i = offset; i < arr.length; i += stride) {
    bins[arr[i]]++
    count++
  }
  if (normalize && count > 0) {
    for (let i = 0; i < 256; i++) bins[i] /= count
  }
  return bins
}

function cumsum(arr: Float64Array) {
  const out = new Float64Array(arr.length)
  let sum = 0
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i]
    out[i] = sum
  }
  return out
}

// numpy.interp equivalent: interpolate `x` (here always 0..255) against
// known points (xp, fp), clamping outside xp's range.
function interp(x: Float64Array, xp: Float64Array, fp: number[]) {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    if (xi <= xp[0]) { out[i] = fp[0]; continue }
    if (xi >= xp[xp.length - 1]) { out[i] = fp[fp.length - 1]; continue }
    let j = 1
    while (xi > xp[j]) j++
    const x0 = xp[j - 1], x1 = xp[j]
    const y0 = fp[j - 1], y1 = fp[j]
    const t = x1 === x0 ? 0 : (xi - x0) / (x1 - x0)
    out[i] = y0 + t * (y1 - y0)
  }
  return out
}

const VALUES_0_255 = Array.from({ length: 256 }, (_, i) => i)

// Per-channel LUT (length-256, values 0-255) mapping `source` pixel values
// onto `target`'s cumulative distribution, i.e. matchCdf(source, target).
function matchChannel(source: Uint8ClampedArray | Uint8Array, target: Uint8ClampedArray | Uint8Array, stride: number, offset: number) {
  const srcCdf = cumsum(bincountUint8(source, stride, offset))
  const tgtCdf = cumsum(bincountUint8(target, stride, offset))
  return interp(srcCdf, tgtCdf, VALUES_0_255)
}

export type RgbLut = { r: Float64Array; g: Float64Array; b: Float64Array }

// `source` is the image to be corrected, `target` is the reference whose
// color distribution it should be matched to — both flat RGBA (4 channels/px,
// as returned by CanvasRenderingContext2D#getImageData) Uint8ClampedArrays.
export function computeRgbLut(source: Uint8ClampedArray, target: Uint8ClampedArray): RgbLut {
  return {
    r: matchChannel(source, target, 4, 0),
    g: matchChannel(source, target, 4, 1),
    b: matchChannel(source, target, 4, 2),
  }
}

// ---------------------------------------------------------------------------
// HSL/HSV/LAB/LCH — real per-pixel matching (no CSS-filter equivalent)
// ---------------------------------------------------------------------------

export const COLOR_SPACES = ["rgb", "hsl", "hsv", "lab", "lch"] as const
export type ColorSpaceId = (typeof COLOR_SPACES)[number]

// Per-channel value ranges used to bin each space's histogram — matches
// chroma-js's own conventions (hsl/hsv saturation+lightness/value are 0-1,
// not 0-100; lab/lch use their usual CIE ranges). RGB isn't listed since it
// uses the fixed-256-bin fast path (matchChannel) instead.
const CHANNEL_RANGES: Record<Exclude<ColorSpaceId, "rgb">, [[number, number], [number, number], [number, number]]> = {
  hsl: [[0, 360], [0, 1], [0, 1]],
  hsv: [[0, 360], [0, 1], [0, 1]],
  lab: [[0, 100], [-100, 100], [-100, 100]],
  lch: [[0, 100], [0, 140], [0, 360]],
}

function bincountFloat(values: Float64Array, binCount: number, min: number, max: number) {
  const bins = new Float64Array(binCount)
  const scale = binCount / ((max - min) || 1)
  for (let i = 0; i < values.length; i++) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((values[i] - min) * scale)))
    bins[idx]++
  }
  const count = values.length || 1
  for (let i = 0; i < binCount; i++) bins[i] /= count
  return bins
}

export type ChannelMapping = { mapping: Float64Array; min: number; max: number; binCount: number }

// Same CDF-matching idea as matchChannel, but for an arbitrary [min,max]
// float range and configurable bin count instead of fixed uint8 0-255.
function matchChannelGeneral(source: Float64Array, target: Float64Array, min: number, max: number, binCount = 64): ChannelMapping {
  const srcCdf = cumsum(bincountFloat(source, binCount, min, max))
  const tgtCdf = cumsum(bincountFloat(target, binCount, min, max))
  const step = (max - min) / (binCount - 1)
  const values = Array.from({ length: binCount }, (_, i) => min + i * step)
  return { mapping: interp(srcCdf, tgtCdf, values), min, max, binCount }
}

function applyChannelMapping({ mapping, min, max, binCount }: ChannelMapping, v: number) {
  const idxFloat = (v - min) * (binCount - 1) / ((max - min) || 1)
  const idx = Math.max(0, Math.min(binCount - 1, Math.round(idxFloat)))
  return mapping[idx]
}

// --- RGB <-> HSL (h: 0-360, s/l: 0-1) ---
function hueToRgbComponent(p: number, q: number, t: number) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}
function rgbToHslInto(r: number, g: number, b: number, out: Float64Array) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0, s = 0
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  out[0] = h; out[1] = s; out[2] = l
}
function hslToRgbInto(h: number, s: number, l: number, out: Float64Array) {
  h = ((h % 360) + 360) % 360
  if (s === 0) { out[0] = out[1] = out[2] = l * 255; return }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hk = h / 360
  out[0] = hueToRgbComponent(p, q, hk + 1 / 3) * 255
  out[1] = hueToRgbComponent(p, q, hk) * 255
  out[2] = hueToRgbComponent(p, q, hk - 1 / 3) * 255
}

// --- RGB <-> HSV (h: 0-360, s/v: 0-1) ---
function rgbToHsvInto(r: number, g: number, b: number, out: Float64Array) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  out[0] = h; out[1] = max === 0 ? 0 : d / max; out[2] = max
}
function hsvToRgbInto(h: number, s: number, v: number, out: Float64Array) {
  h = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v - c
  let rt = 0, gt = 0, bt = 0
  if (h < 60) { rt = c; gt = x; bt = 0 }
  else if (h < 120) { rt = x; gt = c; bt = 0 }
  else if (h < 180) { rt = 0; gt = c; bt = x }
  else if (h < 240) { rt = 0; gt = x; bt = c }
  else if (h < 300) { rt = x; gt = 0; bt = c }
  else { rt = c; gt = 0; bt = x }
  out[0] = (rt + m) * 255; out[1] = (gt + m) * 255; out[2] = (bt + m) * 255
}

// --- RGB <-> LAB/LCH (sRGB, D65 white point — same conventions chroma-js uses) ---
function srgbToLinear(c: number) {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function linearToSrgb(c: number) {
  return (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255
}
const D65_X = 0.95047, D65_Y = 1, D65_Z = 1.08883
function labF(t: number) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116 }
function labFInv(t: number) { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787 }
function rgbToLabInto(r: number, g: number, b: number, out: Float64Array) {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b)
  const fx = labF((rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / D65_X)
  const fy = labF((rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / D65_Y)
  const fz = labF((rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / D65_Z)
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz)
}
function labToRgbInto(l: number, a: number, b: number, out: Float64Array) {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200
  const x = labFInv(fx) * D65_X, y = labFInv(fy) * D65_Y, z = labFInv(fz) * D65_Z
  out[0] = linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314)
  out[1] = linearToSrgb(x * -0.9692660 + y * 1.8760108 + z * 0.0415560)
  out[2] = linearToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252)
}
function rgbToLchInto(r: number, g: number, b: number, out: Float64Array) {
  rgbToLabInto(r, g, b, out)
  const l = out[0], a = out[1], lb = out[2]
  let h = Math.atan2(lb, a) * 180 / Math.PI
  if (h < 0) h += 360
  out[0] = l; out[1] = Math.sqrt(a * a + lb * lb); out[2] = h
}
function lchToRgbInto(l: number, c: number, h: number, out: Float64Array) {
  const hr = h * Math.PI / 180
  labToRgbInto(l, c * Math.cos(hr), c * Math.sin(hr), out)
}

// Writes into a caller-provided scratch buffer (no per-pixel allocation) —
// the hot loops in computeColorSpaceMapping/applyColorSpaceMapping reuse the
// same Float64Array(3) across every pixel.
function rgbToSpaceInto(r: number, g: number, b: number, space: Exclude<ColorSpaceId, "rgb">, out: Float64Array) {
  if (space === "hsl") rgbToHslInto(r, g, b, out)
  else if (space === "hsv") rgbToHsvInto(r, g, b, out)
  else if (space === "lab") rgbToLabInto(r, g, b, out)
  else rgbToLchInto(r, g, b, out)
  // Hue is undefined (and left at whatever the formula above produces, which
  // can be 0/NaN-adjacent) for achromatic pixels — clamp defensively so it
  // never poisons the histogram/interpolation.
  const hueIndex = space === "lch" ? 2 : 0
  if (!Number.isFinite(out[hueIndex])) out[hueIndex] = 0
}
function spaceToRgbInto(a: number, b: number, c: number, space: Exclude<ColorSpaceId, "rgb">, out: Float64Array) {
  if (space === "hsl") hslToRgbInto(a, b, c, out)
  else if (space === "hsv") hsvToRgbInto(a, b, c, out)
  else if (space === "lab") labToRgbInto(a, b, c, out)
  else lchToRgbInto(a, b, c, out)
}

export type ColorSpaceMapping = { colorSpace: Exclude<ColorSpaceId, "rgb">; channels: [ChannelMapping, ChannelMapping, ChannelMapping] }

// `source`/`target` are flat RGBA Uint8ClampedArrays, same convention as
// computeRgbLut — source gets corrected onto target's distribution.
export function computeColorSpaceMapping(source: Uint8ClampedArray, target: Uint8ClampedArray, colorSpace: Exclude<ColorSpaceId, "rgb">): ColorSpaceMapping {
  const ranges = CHANNEL_RANGES[colorSpace]
  const pixelCountSrc = source.length / 4
  const pixelCountTgt = target.length / 4
  const srcChannels: [Float64Array, Float64Array, Float64Array] = [new Float64Array(pixelCountSrc), new Float64Array(pixelCountSrc), new Float64Array(pixelCountSrc)]
  const tgtChannels: [Float64Array, Float64Array, Float64Array] = [new Float64Array(pixelCountTgt), new Float64Array(pixelCountTgt), new Float64Array(pixelCountTgt)]
  const scratch = new Float64Array(3)
  for (let i = 0, p = 0; i < source.length; i += 4, p++) {
    rgbToSpaceInto(source[i], source[i + 1], source[i + 2], colorSpace, scratch)
    srcChannels[0][p] = scratch[0]; srcChannels[1][p] = scratch[1]; srcChannels[2][p] = scratch[2]
  }
  for (let i = 0, p = 0; i < target.length; i += 4, p++) {
    rgbToSpaceInto(target[i], target[i + 1], target[i + 2], colorSpace, scratch)
    tgtChannels[0][p] = scratch[0]; tgtChannels[1][p] = scratch[1]; tgtChannels[2][p] = scratch[2]
  }
  return {
    colorSpace,
    channels: [0, 1, 2].map((ch) => matchChannelGeneral(srcChannels[ch], tgtChannels[ch], ranges[ch][0], ranges[ch][1])) as [ChannelMapping, ChannelMapping, ChannelMapping],
  }
}

// ---------------------------------------------------------------------------
// 3D color LUT — makes native-resolution output affordable
// ---------------------------------------------------------------------------
// Running the full rgbToSpace -> remap -> spaceToRgb conversion per pixel is
// what a real color-grading tool would call "too slow to preview live" —
// measured ~0.2-0.9s at a single map pane's native canvas resolution
// (1024x768 to 2000x1200), well past the 1s budget, especially for LAB/LCH
// (each pixel does 2 full conversions, each with several Math.pow/cbrt
// calls). The fix is the same one every real color pipeline uses (DaVinci
// Resolve/Lightroom "camera profiles", .cube LUT files): build a coarse 3D
// lookup table ONCE (convert a small RxGxB grid — 25^3 = 15625 points, a
// couple ms even doing the expensive per-point conversion) and apply it to
// every actual pixel via trilinear interpolation (cheap: a handful of array
// reads + weighted sums, no transcendental math) instead of re-running the
// conversion per pixel. Same accuracy for anything on the grid, smoothly
// interpolated in between — this is the standard technique, not an
// approximation invented for this feature.
const LUT_GRID_SIZE = 25

function buildColorSpaceLut(mapping: ColorSpaceMapping, gridSize: number): Float32Array {
  const { colorSpace, channels } = mapping
  const lut = new Float32Array(gridSize * gridSize * gridSize * 3)
  const step = 255 / (gridSize - 1)
  const scratch = new Float64Array(3)
  let idx = 0
  for (let ri = 0; ri < gridSize; ri++) {
    const r = ri * step
    for (let gi = 0; gi < gridSize; gi++) {
      const g = gi * step
      for (let bi = 0; bi < gridSize; bi++) {
        rgbToSpaceInto(r, g, bi * step, colorSpace, scratch)
        scratch[0] = applyChannelMapping(channels[0], scratch[0])
        scratch[1] = applyChannelMapping(channels[1], scratch[1])
        scratch[2] = applyChannelMapping(channels[2], scratch[2])
        spaceToRgbInto(scratch[0], scratch[1], scratch[2], colorSpace, scratch)
        lut[idx++] = scratch[0]; lut[idx++] = scratch[1]; lut[idx++] = scratch[2]
      }
    }
  }
  return lut
}

// Mutates `imageData` in place, remapping every pixel's RGB via a 3D LUT
// built from `mapping`. Alpha is left untouched. This is the hot loop (full
// native canvas resolution, see HistogramMatchFilter.tsx) — building the LUT
// is cheap (grid-sized, not image-sized); applying it per pixel is 8 LUT
// reads + linear blends, no per-pixel colorspace conversion.
export function applyColorSpaceMapping(imageData: ImageData, mapping: ColorSpaceMapping) {
  const gridSize = LUT_GRID_SIZE
  const lut = buildColorSpaceLut(mapping, gridSize)
  const data = imageData.data
  const scale = (gridSize - 1) / 255
  const gridSize2 = gridSize * gridSize
  const maxIndex = gridSize - 2 // so index+1 never overflows the grid

  for (let i = 0; i < data.length; i += 4) {
    const rf = data[i] * scale, gf = data[i + 1] * scale, bf = data[i + 2] * scale
    const ri0 = Math.min(maxIndex, rf | 0), gi0 = Math.min(maxIndex, gf | 0), bi0 = Math.min(maxIndex, bf | 0)
    const rt = rf - ri0, gt = gf - gi0, bt = bf - bi0
    const ri1 = ri0 + 1, gi1 = gi0 + 1, bi1 = bi0 + 1

    const i000 = (ri0 * gridSize2 + gi0 * gridSize + bi0) * 3
    const i100 = (ri1 * gridSize2 + gi0 * gridSize + bi0) * 3
    const i010 = (ri0 * gridSize2 + gi1 * gridSize + bi0) * 3
    const i110 = (ri1 * gridSize2 + gi1 * gridSize + bi0) * 3
    const i001 = (ri0 * gridSize2 + gi0 * gridSize + bi1) * 3
    const i101 = (ri1 * gridSize2 + gi0 * gridSize + bi1) * 3
    const i011 = (ri0 * gridSize2 + gi1 * gridSize + bi1) * 3
    const i111 = (ri1 * gridSize2 + gi1 * gridSize + bi1) * 3

    for (let c = 0; c < 3; c++) {
      const c00 = lut[i000 + c] * (1 - rt) + lut[i100 + c] * rt
      const c10 = lut[i010 + c] * (1 - rt) + lut[i110 + c] * rt
      const c01 = lut[i001 + c] * (1 - rt) + lut[i101 + c] * rt
      const c11 = lut[i011 + c] * (1 - rt) + lut[i111 + c] * rt
      const c0 = c00 * (1 - gt) + c10 * gt
      const c1 = c01 * (1 - gt) + c11 * gt
      data[i + c] = c0 * (1 - bt) + c1 * bt
    }
  }
}
