// The tile service's direct engine: a tile computed in Node from elevation
// tiles, with no browser. For the views it understands it answers in a
// fraction of a second; everything else goes to the browser (render.mjs).
//
// What it draws, in the app's layer order over a white background:
//   colorRelief  the elevation through a ramp of the app (lib/color-ramps.ts)
//   slope        Horn's slope in degrees through a ramp
//   hillshade    MapLibre's own shader, ported line by line (its five
//                methods, and the app's three multi-light presets)
//   contours     marching squares (d3-contour), drawn as an SVG; no labels
//
// What it does not: any other mode, imagery, 3D, split views, a source that
// is not a Terrarium or Terrain-RGB pyramid, custom ramp stops, and any URL
// parameter not listed in DIRECT_PARAMS. `plan()` says which engine a
// request gets and why.
import sharp from "sharp"
import { contours as d3contours } from "d3-contour"
import { resolveDem, window as demWindow } from "./dem.mjs"

let appLibPromise
const appLib = () => (appLibPromise ??= import("./generated/app-lib.mjs"))

export const DIRECT_MODES = ["hillshade", "colorRelief", "slope", "contours"]

/** The app parameters the direct engine reads, with the app's defaults. */
export const DIRECT_PARAMS = {
  hillshadeMethod: "combined", illuminationDir: 315, illuminationAlt: 45, shadowColor: "#000000", highlightColor: "#FFFFFF", accentColor: "#808080", hillshadeExag: 1, hillshadeOpacity: 1,
  colorRamp: "mby", colorReliefOpacity: 0.35, customHypsoMinMax: false, minElevation: 0, maxElevation: 8100, invertColorRamp: false,
  slopeColorRamp: "slope-plantopo", slopeOpacity: 1, slopeMinDegrees: 0, slopeMaxDegrees: 55, slopeInvertColorRamp: false,
  contourMinor: 50, contourMajor: 200, contourWeight: 1, contourColor: "", showContourLabels: true,
}
const HILLSHADE_METHODS = ["standard", "combined", "igor", "basic", "multidirectional", "multidir-colors", "duotone-nw-ne", "aspect-multidir"]

/** Which engine draws this view: `{ engine: "direct", dem, modes, p }` or
 *  `{ engine: "browser", why }`. `rest` holds the app parameters given. */
export async function plan(view, rest) {
  const no = (why) => ({ engine: "browser", why })
  const modes = view.modes ?? ["hillshade"]
  const other = modes.filter((m) => !DIRECT_MODES.includes(m))
  if (other.length) return no(`the mode ${other.join(", ")} is drawn by the app`)
  if (view.imageryUrl || view.imagerySource) return no("imagery is drawn by the app")
  let source = view.terrainSource
  if (source && source.trim().startsWith("{")) { try { source = JSON.parse(source) } catch { return no("terrainSource is not valid JSON") } }
  const dem = resolveDem(source)
  if (!dem) return no("this source is not a Terrarium or Terrain-RGB tile pyramid")
  const p = { ...DIRECT_PARAMS }
  for (const [k, v] of rest) {
    if (!(k in DIRECT_PARAMS)) return no(`the parameter ${k} is read by the app`)
    const d = DIRECT_PARAMS[k]
    p[k] = typeof d === "number" ? Number(v) : typeof d === "boolean" ? v === "true" : v
    if (typeof d === "number" && !Number.isFinite(p[k])) return no(`${k} is not a number`)
  }
  if (!HILLSHADE_METHODS.includes(p.hillshadeMethod)) return no(`the hillshade method ${p.hillshadeMethod} is not ported`)
  const { colorRampsFlat } = await appLib()
  if (modes.includes("colorRelief") && !colorRampsFlat[p.colorRamp]) return no(`the ramp ${p.colorRamp} is not a named ramp`)
  if (modes.includes("slope") && !colorRampsFlat[p.slopeColorRamp]) return no(`the ramp ${p.slopeColorRamp} is not a named ramp`)
  return { engine: "direct", dem, modes, p }
}

const PI = Math.PI
const EARTH = 2 * PI * 6378137

/** Any colour MapLibre takes, as premultiplied RGBA 0..1. */
function colour(c, chroma, opacity = 1) {
  let r, g, b, a
  const m = /^rgba?\(([^)]+)\)$/i.exec(String(c).trim())
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    ;[r, g, b] = parts.slice(0, 3).map(Number)
    a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : Number(parts[3])
  } else [r, g, b, a] = chroma(c).rgba()
  a *= opacity
  return [(r / 255) * a, (g / 255) * a, (b / 255) * a, a]
}

/** A MapLibre `interpolate` expression over elevation, as a 1024-entry table
 *  of premultiplied RGBA (MapLibre also draws from a table of the stops). */
function rampTable(expr, chroma) {
  const stops = [], cols = []
  for (let i = 3; i + 1 < expr.length; i += 2) { stops.push(Number(expr[i])); cols.push(colour(expr[i + 1], chroma)) }
  const lo = stops[0], hi = stops[stops.length - 1], N = 1024
  const table = new Float32Array(N * 4)
  let k = 1
  for (let n = 0; n < N; n++) {
    const v = lo + ((hi - lo) * n) / (N - 1)
    while (k < stops.length - 1 && stops[k] < v) k++
    const t = Math.min(1, Math.max(0, (v - stops[k - 1]) / (stops[k] - stops[k - 1] || 1)))
    for (let c = 0; c < 4; c++) table[n * 4 + c] = cols[k - 1][c] + (cols[k][c] - cols[k - 1][c]) * t
  }
  return { lo, hi, N, table }
}

// Source-over of a premultiplied colour onto the premultiplied canvas.
function over(dst, o, r, g, b, a) {
  const k = 1 - a
  dst[o] = r + dst[o] * k; dst[o + 1] = g + dst[o + 1] * k; dst[o + 2] = b + dst[o + 2] * k; dst[o + 3] = a + dst[o + 3] * k
}

function paintRamp(dst, values, ramp, opacity) {
  const { lo, hi, N, table } = ramp, scale = (N - 1) / (hi - lo || 1)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) continue
    const n = Math.min(N - 1, Math.max(0, Math.round((v - lo) * scale))) * 4
    over(dst, i * 4, table[n] * opacity, table[n + 1] * opacity, table[n + 2] * opacity, table[n + 3] * opacity)
  }
}

/** MapLibre's hillshade uniforms from the app's parameters (the app's
 *  computeHillshadePaint, components/LayersAndSources/MapLayers.tsx). */
function hillshadeUniforms(p, chroma) {
  const rad = (d) => (d * PI) / 180
  const multi = (highlights, shadows, dirs, alts) => ({ method: "multidirectional", highlights: highlights.map((c) => colour(c, chroma)), shadows: shadows.map((c) => colour(c, chroma)), azimuths: dirs.map(rad), altitudes: alts.map(rad) })
  if (p.hillshadeMethod === "multidir-colors") return multi(["#FF4000", "#FFFF00", "#40ff00", "#00FF80"], ["#00bfff", "#0000ff", "#bf00ff", "#FF0080"], [270, 315, 0, 45], [30, 30, 30, 30])
  if (p.hillshadeMethod === "duotone-nw-ne") return multi(["#FFFFFF", "#4A90D9"], ["#000000", "#B8692E"], [315, 45], [35, 35])
  if (p.hillshadeMethod === "aspect-multidir") return multi(["#CC0000", "#0000CC"], ["#00CCCC", "#CCCC00"], [0, 270], [30, 30])
  if (p.hillshadeMethod === "multidirectional") return multi(["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF"], ["#000000", "#000000", "#000000", "#000000"], [270, 315, 0, 45], [45, 45, 45, 45])
  // The altitude only reaches the two methods that read it; `basic` gets
  // the app's correction.
  const alt = p.hillshadeMethod === "basic" ? 90 - (90 - p.illuminationAlt) / 6.28 : p.hillshadeMethod === "combined" ? p.illuminationAlt : 45
  return {
    method: p.hillshadeMethod, exaggeration: p.hillshadeExag,
    azimuths: [rad(p.illuminationDir)], altitudes: [rad(alt)],
    shadows: [colour(p.shadowColor, chroma, p.hillshadeOpacity)], highlights: [colour(p.highlightColor, chroma, p.hillshadeOpacity)],
    accent: colour(p.accentColor, chroma),
  }
}

// MapLibre's hillshade fragment shader (maplibre-gl 6, hillshade.fragment.glsl).
function shade(u, dx, dy, out) {
  const ex = u.exaggeration ?? 1
  const aspect = (x, y) => (x !== 0 ? Math.atan2(y, -x) : (PI / 2) * (y > 0 ? 1 : -1))
  const mod = (a, n) => a - n * Math.floor(a / n)
  const S = u.shadows, H = u.highlights
  let r = 0, g = 0, b = 0, a = 0
  const add = (c, k) => { r += c[0] * k; g += c[1] * k; b += c[2] * k; a += c[3] * k }
  if (u.method === "standard") {
    const azimuth = u.azimuths[0] + PI
    const slope = Math.atan(0.625 * Math.hypot(dx, dy))
    const base = 1.875 - ex * 1.75, maxValue = 0.5 * PI
    const scaled = ex !== 0.5 ? ((Math.pow(base, slope) - 1) / (Math.pow(base, maxValue) - 1)) * maxValue : slope
    const k = Math.min(1, Math.max(0, ex * 2))
    const sh = Math.abs(mod((aspect(dx, dy) + azimuth) / PI + 0.5, 2) - 1)
    const s = Math.sin(scaled) * k
    const sc = [0, 1, 2, 3].map((c) => (S[0][c] + (H[0][c] - S[0][c]) * sh) * s)
    const ak = (1 - Math.cos(scaled)) * k * (1 - sc[3])
    r = u.accent[0] * ak + sc[0]; g = u.accent[1] * ak + sc[1]; b = u.accent[2] * ak + sc[2]; a = u.accent[3] * ak + sc[3]
  } else {
    dx *= ex * 2; dy *= ex * 2
    const len = Math.hypot(dx, dy)
    if (u.method === "igor") {
      const azimuth = u.azimuths[0] + PI
      const slopeStrength = (Math.atan(len) * 2) / PI
      const aspectStrength = 1 - Math.abs(mod((aspect(dx, dy) + azimuth) / PI + 0.5, 2) - 1)
      add(S[0], slopeStrength * aspectStrength); add(H[0], slopeStrength * (1 - aspectStrength))
    } else if (u.method === "multidirectional") {
      const n = u.azimuths.length
      for (let i = 0; i < n; i++) {
        const cosAlt = Math.cos(u.altitudes[i]), sinAlt = Math.sin(u.altitudes[i]), cosAz = -Math.cos(u.azimuths[i]), sinAz = -Math.sin(u.azimuths[i])
        const s = Math.min(1, Math.max(0, (sinAlt - (dy * cosAz * cosAlt - dx * sinAz * cosAlt)) / Math.sqrt(1 + len * len)))
        if (s > 0.5) add(H[i], (2 * s - 1) / n); else add(S[i], (1 - 2 * s) / n)
      }
    } else {
      const azimuth = u.azimuths[0] + PI
      const cosAz = Math.cos(azimuth), sinAz = Math.sin(azimuth), cosAlt = Math.cos(u.altitudes[0]), sinAlt = Math.sin(u.altitudes[0])
      const c = (sinAlt - (dy * cosAz * cosAlt - dx * sinAz * cosAlt)) / Math.sqrt(1 + len * len)
      if (u.method === "basic") {
        const s = Math.min(1, Math.max(0, c))
        if (s > 0.5) add(H[0], 2 * s - 1); else add(S[0], 1 - 2 * s)
      } else { // combined
        const cang = Math.min(PI / 2, Math.max(0, Math.acos(Math.min(1, Math.max(-1, c)))))
        const k = (Math.atan(len) * 4) / PI / PI
        add(S[0], cang * k); add(H[0], (PI / 2 - cang) * k)
      }
    }
  }
  out[0] = r; out[1] = g; out[2] = b; out[3] = a
}

/**
 * A rectangle of the Web Mercator world drawn from elevation tiles.
 * `world` is the side of the whole world in output pixels (a tile of side S
 * at zoom z: S * 2^z), `x0`, `y0` the rectangle's corner in those pixels.
 * @returns {Promise<Buffer>} PNG or JPEG
 */
export async function draw({ dem, modes, p }, { world, x0, y0, width, height, format = "png" }) {
  const { colorRampsFlat, remapColorRampStops, chroma } = await appLib()
  // The pyramid zoom whose pixels are the output's, or the deepest there is.
  const zd = Math.max(0, Math.min(dem.maxzoom, Math.round(Math.log2(world / dem.tileSize))))
  const side = dem.tileSize, demWorld = side * 2 ** zd, k = demWorld / world
  // Elevations on the pyramid's own grid, two pixels wider than the output on each side.
  const M = 2
  const gx0 = Math.floor(x0 * k) - M - 1, gy0 = Math.floor(y0 * k) - M - 1
  const gw = Math.ceil((x0 + width) * k) + M + 1 - gx0, gh = Math.ceil((y0 + height) * k) + M + 1 - gy0
  const E = await demWindow(dem, zd, side, gx0, gy0, gw, gh)
  if (E.every(Number.isNaN)) throw Object.assign(new Error("This source has no data here"), { status: 404 })
  const at = (i, j) => E[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))]

  // The output pixels' elevations, read bilinearly from that grid.
  const P = 3 // a margin, for the contours to close outside the picture
  const ow = width + 2 * P, oh = height + 2 * P
  const elev = new Float32Array(ow * oh), FX = new Float32Array(ow), FY = new Float32Array(oh)
  for (let i = 0; i < ow; i++) FX[i] = (x0 + i - P + 0.5) * k - 0.5 - gx0
  for (let j = 0; j < oh; j++) FY[j] = (y0 + j - P + 0.5) * k - 0.5 - gy0
  const bil = (G, fx, fy) => {
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j
    const a = G(i, j), b = G(i + 1, j), c = G(i, j + 1), d = G(i + 1, j + 1)
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) elev[j * ow + i] = bil(at, FX[i], FY[j])
  const inner = (G) => { const out = new Float32Array(width * height); for (let j = 0; j < height; j++) out.set(G.subarray((j + P) * ow + P, (j + P) * ow + P + width), j * width); return out }
  const latOf = (wy) => Math.atan(Math.sinh(PI * (1 - (2 * wy) / world)))

  // Premultiplied RGBA 0..1, white to start with (the app's light background).
  const img = new Float32Array(width * height * 4).fill(1)

  if (modes.includes("colorRelief")) {
    const base = colorRampsFlat[p.colorRamp].colors
    const expr = p.customHypsoMinMax || p.invertColorRamp ? remapColorRampStops(base, p.customHypsoMinMax ? p.minElevation : undefined, p.customHypsoMinMax ? p.maxElevation : undefined, p.invertColorRamp) : base
    paintRamp(img, inner(elev), rampTable(expr, chroma), p.colorReliefOpacity)
  }

  if (modes.includes("slope")) {
    // Horn's kernel on the output grid, the ground distance corrected for latitude.
    const slope = new Float32Array(width * height)
    for (let j = 0; j < height; j++) {
      const res = (EARTH * Math.cos(latOf(y0 + j + 0.5))) / world
      for (let i = 0; i < width; i++) {
        const o = (j + P) * ow + i + P
        const a = elev[o - ow - 1], b = elev[o - ow], c = elev[o - ow + 1], d = elev[o - 1], f = elev[o + 1], g = elev[o + ow - 1], h = elev[o + ow], n = elev[o + ow + 1]
        const dzdx = (c + 2 * f + n - (a + 2 * d + g)) / (8 * res), dzdy = (g + 2 * h + n - (a + 2 * b + c)) / (8 * res)
        slope[j * width + i] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / PI
      }
    }
    const expr = remapColorRampStops(colorRampsFlat[p.slopeColorRamp].colors, p.slopeMinDegrees, p.slopeMaxDegrees, p.slopeInvertColorRamp)
    paintRamp(img, slope, rampTable(expr, chroma), p.slopeOpacity)
  }

  if (modes.includes("hillshade")) {
    // MapLibre's prepare pass on the pyramid's grid (the Sobel sums, its zoom
    // factor, the 8-bit texture it stores them in), then its shading pass.
    const factor = zd < 2 ? 0.4 : zd < 4.5 ? 0.35 : 0.3
    const exag = zd < 15 ? (zd - 15) * factor : 0
    const scale = side / Math.pow(2, exag + (28.2562 - zd))
    const q = (v) => (Math.round(Math.min(1, Math.max(0, v / 8 + 128 / 255)) * 255) / 255 - 128 / 255) * 8
    const DX = new Float32Array(gw * gh), DY = new Float32Array(gw * gh)
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const a = at(i - 1, j - 1), b = at(i, j - 1), c = at(i + 1, j - 1), d = at(i - 1, j), f = at(i + 1, j), g = at(i - 1, j + 1), h = at(i, j + 1), n = at(i + 1, j + 1)
      DX[j * gw + i] = q((c + f + f + n - (a + d + d + g)) * scale)
      DY[j * gw + i] = q((g + h + h + n - (a + b + b + c)) * scale)
    }
    const gdx = (i, j) => DX[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))]
    const gdy = (i, j) => DY[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))]
    const u = hillshadeUniforms(p, chroma), px = [0, 0, 0, 0]
    for (let j = 0; j < height; j++) {
      const cosLat = Math.cos(latOf(y0 + j + 0.5))
      for (let i = 0; i < width; i++) {
        if (Number.isNaN(elev[(j + P) * ow + i + P])) continue
        const dx = bil(gdx, FX[i + P], FY[j + P]) / cosLat, dy = bil(gdy, FX[i + P], FY[j + P]) / cosLat
        if (Number.isNaN(dx) || Number.isNaN(dy)) continue
        shade(u, dx, dy, px)
        over(img, (j * width + i) * 4, px[0], px[1], px[2], px[3])
      }
    }
  }

  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const a = img[i * 4 + 3] || 1
    rgba[i * 4] = Math.round(Math.min(1, img[i * 4] / a) * 255); rgba[i * 4 + 1] = Math.round(Math.min(1, img[i * 4 + 1] / a) * 255); rgba[i * 4 + 2] = Math.round(Math.min(1, img[i * 4 + 2] / a) * 255); rgba[i * 4 + 3] = Math.round(Math.min(1, a) * 255)
  }
  let picture = sharp(rgba, { raw: { width, height, channels: 4 } })

  if (modes.includes("contours")) {
    // The app's intervals: major lines alone below zoom 6, then minor and major.
    const z256 = Math.log2(world / 256)
    const minor = z256 < 6 || !(p.contourMinor > 0) ? p.contourMajor : p.contourMinor, major = p.contourMajor
    let lo = Infinity, hi = -Infinity
    for (const v of elev) if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v }
    const levels = []
    for (let v = Math.ceil(lo / minor) * minor; v <= hi && levels.length < 400; v += minor) levels.push(v)
    const filled = Float64Array.from(elev, (v) => (Number.isNaN(v) ? -1e9 : v))
    const stroke = p.contourColor || "rgba(0,0,0,0.5)"
    const paths = { 0: [], 1: [] }
    for (const c of d3contours().size([ow, oh]).thresholds(levels)(filled)) {
      const d = c.coordinates.map((poly) => poly.map((ring) => "M" + ring.map(([x, y]) => `${(x - P).toFixed(2)},${(y - P).toFixed(2)}`).join("L") + "Z").join("")).join("")
      if (d) paths[Math.abs(c.value / major - Math.round(c.value / major)) < 1e-9 ? 1 : 0].push(d)
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="none" stroke="${stroke}" stroke-linejoin="round"><path stroke-width="${0.5 * p.contourWeight}" d="${paths[0].join("")}"/><path stroke-width="${p.contourWeight}" d="${paths[1].join("")}"/></g></svg>`
    picture = picture.composite([{ input: Buffer.from(svg) }])
  }
  return format === "png" ? picture.png().toBuffer() : picture.flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer()
}
