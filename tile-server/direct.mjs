// The tile service's direct engine: a tile computed in Node from elevation
// tiles, with no browser. It rebuilds the map's layer stack from the app's
// state (the same URL the browser would open) and computes every layer with
// the app's own code, bundled for Node (app-render.ts):
//
//   colour relief, and the 14 derived modes (slope, aspect, TRI, curvature,
//   TPI, LRM, roughness, shape index, blobness, eigen ratio, orientation,
//   sky-view factor, openness, local dominance): the app's tile protocols,
//   coloured with the paint the map computes (lib/layer-paints.ts,
//   lib/mode-relief.ts), interpolated between the stops as MapLibre does
//   hillshade: MapLibre's two shader passes, ported line by line, fed with
//   the paint the map computes (computeHillshadePaint)
//   matcap, phong: the app's live GL layers (its default renderer), their
//   fragment shaders ported line by line (per-pixel Horn normal on the
//   bilinear elevation, Phong's multiply and add passes, the camera-relative
//   matcap lookup); with matcapRenderer or phongRenderer=raster, the app's
//   tile protocols instead
//   cast shadows: the app's tile protocol
//   contours: maplibre-contour, the app's contour library, with the app's
//   options (contours.mjs); no labels on the picture, and /contours serves
//   the vector tiles with `ele` for a client to label
//
// Layers stack in the map's order (LAYER_SLOTS) over its white background.
// Anything else goes to the browser: `plan()` says which engine a request
// gets and why.
import { readFileSync } from "node:fs"
import sharp from "sharp"
import { VectorTile } from "@mapbox/vector-tile"
import { PbfReader } from "pbf"
import { latest as styleSpec, normalizePropertyExpression } from "@maplibre/maplibre-gl-style-spec"
import { contourSvg, contourVectorTile, contourMaxzoom } from "./contours.mjs"
import { readLayers, overzoom, writeTile } from "./mvt.mjs"
import { symbolAnchors } from "./symbols.mjs"
import { resolveDemOrWhy, refusalOf, window as demWindow } from "./dem.mjs"
import { buildViewUrl, DEFAULT_BASE_URL } from "./url.mjs"
import { float32GeoTiff } from "./tiff.mjs"
import { installBrowserShim, pixelsOf } from "./browser-shim.mjs"
import { encodeTile, tileBounds, levelGeometricError } from "./quantized-mesh.mjs"
import { addUndulation, undulation, warmUpGeoid } from "./geoid.mjs"

let appPromise
const app = () => (appPromise ??= (installBrowserShim(), import("./generated/app-render.mjs").then((A) => { A.registerDerivedProtocols(); return A })))

const PI = Math.PI
const EARTH = 2 * PI * 6378137

// ── The app's state ────────────────────────────────────────────────────────

let defaultsCache
/** Every URL parameter of the app with its default and type, from the
 *  generated URL reference (docs/src/generated/url-params.json, copied into
 *  generated/ by build.mjs). */
function paramTable() {
  if (!defaultsCache) {
    const { params } = JSON.parse(readFileSync(new URL("./generated/url-params.json", import.meta.url), "utf8"))
    defaultsCache = new Map(params.map((p) => [p.key, p]))
  }
  return defaultsCache
}

function parseValue(p, raw, A) {
  switch (p.type) {
    case "ramp-stops": return A.parseAsCustomRampStops.parse(raw) ?? undefined
    case "number": case "integer": return Number(raw)
    case "boolean": return raw === "true" || raw === "1"
    case "array": return raw.split(",").filter(Boolean)
    default: return raw
  }
}

/** The state the app would have for this view: its URL's parameters over
 *  the defaults. A default written as a constant's name in the source is
 *  read from the bundle (DEFAULT_MATCAP_ID, the default ramp stops). */
async function stateFor(view, rest) {
  const A = await app()
  const state = {}
  for (const [key, p] of paramTable()) {
    let d = p.default
    if (typeof d === "string" && /^[A-Z][A-Z0-9_]+$/.test(d)) d = A[d]
    if (d !== undefined && d !== null) state[p.stateKey ?? key] = d
  }
  const url = new URL(buildViewUrl({ ...view, lat: 0, lng: 0, params: Object.fromEntries(rest) }, { baseUrl: DEFAULT_BASE_URL }))
  const given = []
  for (const [key, raw] of url.searchParams) {
    const p = paramTable().get(key)
    if (!p) continue
    const v = parseValue(p, raw, A)
    if (v !== undefined) state[p.stateKey ?? key] = v
    given.push(p)
  }
  // The theme is its own URL parameter (useTheme), not in the reference.
  state.theme = url.searchParams.get("theme") === "dark" ? "dark" : "light"
  // The tile service's own: background=none leaves the map's background out,
  // a transparent PNG to stack in a GIS.
  state.transparent = url.searchParams.get("background") === "none"
  return { state, given }
}

// ── Which layers, and can they be drawn here ──────────────────────────────

/** The derived modes, in the map's layer order: state flag, protocol. */
const DERIVED = [
  ["slope", "showSlope", "terrain"], ["aspect", "showAspect", "terrain"], ["tri", "showTri", "terrain"],
  ["curvature", "showCurvature", "terrain"], ["tpi", "showTpi", "terrain"], ["lrm", "showLrm", "relief"],
  ["roughness", "showRoughness", "terrain"], ["shapeIndex", "showShapeIndex", "terrain"], ["blobness", "showBlobness", "terrain"],
  ["eigenRatio", "showEigenRatio", "terrain"], ["orientation", "showOrientation", "terrain"], ["svf", "showSvf", "relief"],
  ["openness", "showOpenness", "relief"], ["localDominance", "showLocalDominance", "relief"],
]
const GROUP = { terrain: "showTerrainAnalysis", relief: "showReliefVisualization" }

/** The layers the map would draw for this state, bottom to top. */
function layersOf(s) {
  const out = []
  if (s.showColorRelief) out.push("colorRelief")
  for (const [m, flag, group] of DERIVED) if (s[GROUP[group]] && s[flag]) out.push(m)
  if (s.showHillshade) out.push("hillshade")
  if (s.showLightingEffects) { if (s.showMatcap) out.push("matcap"); if (s.showPhong) out.push("phong"); if (s.showShadows) out.push("shadows"); if (s.showBuildingShadows) out.push("buildingShadows") }
  // Above the lighting, in the map's order: the iso-line and the graticule
  // (before slot-contours), the mound markers (slot-tells), the plane
  // slicer (slot-plane-slicer), then the contours, added last on top.
  if (s.showContoursAndGraticules && s.showIsoline) out.push("isoline")
  if (s.showContoursAndGraticules && s.showGraticules) out.push("graticules")
  if (s.showTellsDetector && s.tellsMarkersVisible !== false) out.push("tells")
  if (s.showPlaneSlicer) out.push("planeSlicer")
  if (s.showContoursAndGraticules && s.showContours) out.push("contours")
  return out
}

/** What the direct engine does not draw: a state flag and why. */
const BROWSER_ONLY = [
  [(s) => s.showRasterBasemap, "imagery and basemaps are drawn by the app"],
  [(s) => s.showBackground, "the sky and fog background is drawn by the app"],
  [(s) => s.appMode === "historical", "the historical mode is drawn by the app"],
  [(s) => (s.viewMode && s.viewMode !== "2d") || s.pitch || s.bearing, "3D, tilted or rotated views are drawn by the app"],
  [(s) => s.splitStyle && s.splitStyle !== "off", "split views are drawn by the app"],
  [(s) => s.vizViews, "per-view modes are drawn by the app"],
]
const HILLSHADE_METHODS = ["standard", "combined", "igor", "basic", "multidirectional", "multidir-colors", "duotone-nw-ne", "aspect-multidir"]

/** Which engine draws this view: `{ engine: "direct", dem, layers, state }`
 *  or `{ engine: "browser", why }`. `rest` holds the app parameters given,
 *  `keys` the API keys (dem.mjs keysOf). */
export async function plan(view, rest, keys = {}) {
  const no = (why) => ({ engine: "browser", why })
  if (view.imageryUrl || view.imagerySource) return no("imagery is drawn by the app")
  if (view.split || view.terrainSourceB) return no("split views are drawn by the app")
  let source = view.terrainSource
  if (source && source.trim().startsWith("{")) { try { source = JSON.parse(source) } catch { return no("terrainSource is not valid JSON") } }
  const { dem, why } = await resolveDemOrWhy(source, keys)
  if (!dem) return no(why)
  const { state, given } = await stateFor(view, rest)
  for (const [test, why] of BROWSER_ONLY) if (test(state)) return no(why)
  const layers = layersOf(state)
  if (!HILLSHADE_METHODS.includes(state.hillshadeMethod)) return no(`the hillshade method ${state.hillshadeMethod} is not ported`)
  return { engine: "direct", dem, layers, state }
}

/** The layers a view turns on, by the names of url.mjs (the mound detector
 *  as moundDetector), bottom to top, with the state they read: what the
 *  app's URL parameters (or `modes`) switch on, over the app's defaults.
 *  For the QGIS project: which of its layers start checked. */
export async function activeLayers(view, rest) {
  const { state } = await stateFor(view, rest)
  return { layers: layersOf(state).map((l) => (l === "tells" ? "moundDetector" : l)), state }
}

/** The modes the direct engine draws, by the names of url.mjs. */
export const DIRECT_MODES = ["hillshade", "colorRelief", "contours", "slope", "aspect", "tri", "curvature", "tpi", "roughness", "shapeIndex", "blobness", "eigenRatio", "orientation", "lrm", "svf", "openness", "localDominance", "matcap", "phong", "shadows", "buildingShadows", "moundDetector", "isoline", "graticules", "planeSlicer"]

/** The elevation and intervals of the contour lines: the terrain, or with
 *  contourReferenceMode=lrm its local relief model (ContoursLayer.tsx). */
export async function contourSource(dem, s) {
  if (s.contourReferenceMode !== "lrm") return { dem, minor: s.contourMinor, major: s.contourMajor }
  const A = await app()
  return { dem: { ...dem, tiles: A.buildLrmProtocolUrl(dem.tiles, dem.encoding, dem.tileSize, s.lrmRadius), encoding: "terrarium" }, minor: s.contourMinorLrm, major: s.contourMajorLrm }
}

// ── Colours ───────────────────────────────────────────────────────────────

let chromaPromise
const chroma = () => (chromaPromise ??= import("./generated/app-lib.mjs").then((m) => m.chroma))
/** Loads the app's code now rather than on the first tile: a worker that
 *  starts cold would spend its first tile's time budget on it. */
export const warmUp = () => Promise.all([app(), chroma(), warmUpGeoid(), import("./dem.mjs").then((d) => d.warmUp?.())])

/** Any colour MapLibre takes, as premultiplied RGBA 0..1. */
function colour(c, ch, opacity = 1) {
  let r, g, b, a
  const m = /^rgba?\(([^)]+)\)$/i.exec(String(c).trim())
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    ;[r, g, b] = parts.slice(0, 3).map(Number)
    a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : Number(parts[3])
  } else [r, g, b, a] = ch(c).rgba()
  a *= opacity
  return [(r / 255) * a, (g / 255) * a, (b / 255) * a, a]
}

/** A color-relief expression (`interpolate` over elevation) as a function
 *  to premultiplied RGBA, as MapLibre's color-relief layer computes it: the
 *  stops are packed in the source's own encoding (packDEMData: rounded to
 *  its step, 1/256 m for Terrarium, 0.1 m for Terrain-RGB), the shader
 *  searches the two stops around the value and samples a colour texture
 *  (8-bit, linear, clamped) at `l + t`. The rounding matters for discrete
 *  ramps, whose stops come in pairs a thousandth apart: 999.999 packs to
 *  1000, so the pair collapses and the class above the last stop is never
 *  reached. */
function rampOf(expr, ch, encoding = "terrarium") {
  const step = encoding === "mapbox" ? 0.1 : 1 / 256, shift = encoding === "mapbox" ? 10000 : 32768
  const stops = [], cols = []
  for (let i = 3; i + 1 < expr.length; i += 2) {
    stops.push(Math.round((Number(expr[i]) + shift) / step) * step - shift)
    cols.push(colour(expr[i + 1], ch).map((c) => Math.round(c * 255) / 255))
  }
  const n = stops.length
  return (v, out) => {
    if (n === 1) { out.set(cols[0]); return }
    let l = 0, r = n - 1
    while (r - l > 1) { const mid = (l + r) >> 1; if (v < stops[mid]) r = mid; else l = mid }
    // 0/0 where two stops pack to the same value: the GPU samples a NaN
    // position, which reads transparent.
    const t = (v - stops[l]) / (stops[r] - stops[l])
    if (Number.isNaN(t)) { out.fill(0); return }
    const p = Math.min(n - 1, Math.max(0, l + t))
    const i = Math.floor(p), f = p - i, a = cols[i], b = cols[Math.min(n - 1, i + 1)]
    out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f; out[3] = a[3] + (b[3] - a[3]) * f
  }
}

/**
 * A colour ramp (an `interpolate` expression of /colorramps/{id}) as a
 * picture: its first stop to its last, coloured by rampOf, the colour relief's
 * own interpolation. Horizontal: the lowest value on the left; vertical: at
 * the bottom. PNG keeps the ramp's transparency, JPEG lays it on white.
 * @returns {Promise<Buffer>}
 */
export async function rampImage(expr, { width = 256, height = 16, orientation = "horizontal", format = "png", reverse = false } = {}) {
  const ramp = rampOf(expr, await chroma())
  const lo = Number(expr[3]), hi = Number(expr[expr.length - 2])
  const vertical = orientation === "vertical"
  const n = vertical ? height : width
  const line = new Uint8Array(n * 4), px = new Float64Array(4)
  for (let i = 0; i < n; i++) {
    // Pixel centres, from the first stop to the last.
    let t = n === 1 ? 0.5 : i / (n - 1)
    if (vertical) t = 1 - t
    if (reverse) t = 1 - t
    ramp(lo + (hi - lo) * t, px)
    const a = px[3]
    if (format === "png") { for (let c = 0; c < 3; c++) line[4 * i + c] = a > 0 ? Math.round((px[c] / a) * 255) : 0; line[4 * i + 3] = Math.round(a * 255) }
    else { for (let c = 0; c < 3; c++) line[4 * i + c] = Math.round((px[c] + (1 - a)) * 255); line[4 * i + 3] = 255 }
  }
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(line.subarray(4 * (vertical ? y : x), 4 * (vertical ? y : x) + 4), 4 * (y * width + x))
  const img = sharp(rgba, { raw: { width, height, channels: 4 } })
  return format === "png" ? img.png().toBuffer() : img.flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer()
}

const rgbaPx = new Float64Array(4)

// Source-over of a premultiplied colour onto the premultiplied canvas.
function over(dst, o, r, g, b, a) {
  const k = 1 - a
  dst[o] = r + dst[o] * k; dst[o + 1] = g + dst[o + 1] * k; dst[o + 2] = b + dst[o + 2] * k; dst[o + 3] = a + dst[o + 3] * k
}

// ── MapLibre's hillshade ──────────────────────────────────────────────────

/** The hillshade uniforms MapLibre derives from the paint the map computes. */
function hillshadeUniforms(paint, ch) {
  const list = (v, d) => (Array.isArray(v) ? v : [v ?? d])
  const dirs = list(paint["hillshade-illumination-direction"], 335)
  const n = dirs.length
  const pad = (arr, d) => Array.from({ length: n }, (_, i) => arr[i] ?? arr[arr.length - 1] ?? d)
  const rad = (d) => (d * PI) / 180
  const u = {
    method: paint["hillshade-method"] ?? "standard",
    exaggeration: paint["hillshade-exaggeration"] ?? 0.5,
    azimuths: dirs.map(rad),
    altitudes: pad(list(paint["hillshade-illumination-altitude"], 45), 45).map(rad),
    shadows: pad(list(paint["hillshade-shadow-color"], "#000000"), "#000000").map((c) => colour(c, ch)),
    highlights: pad(list(paint["hillshade-highlight-color"], "#FFFFFF"), "#FFFFFF").map((c) => colour(c, ch)),
    accent: colour(paint["hillshade-accent-color"] ?? "#000000", ch),
  }
  // The standard method's denominator, the same for every pixel.
  u.scaledDen = Math.pow(1.875 - u.exaggeration * 1.75, 0.5 * PI) - 1
  return u
}

// MapLibre's hillshade fragment shader (maplibre-gl 6, hillshade.fragment.glsl).
// Called for every pixel: no closure, array or object is made here (they
// were half the hillshade's time); the arithmetic is the shader's, in its order.
const shadeAspect = (x, y) => (x !== 0 ? Math.atan2(y, -x) : (PI / 2) * (y > 0 ? 1 : -1))
const shadeMod = (a, n) => a - n * Math.floor(a / n)
function shade(u, dx, dy, out) {
  const ex = u.exaggeration
  const S = u.shadows, H = u.highlights
  if (u.method === "standard") {
    const azimuth = u.azimuths[0] + PI
    const slope = Math.atan(0.625 * Math.hypot(dx, dy))
    const base = 1.875 - ex * 1.75, maxValue = 0.5 * PI
    const scaled = ex !== 0.5 ? ((Math.pow(base, slope) - 1) / u.scaledDen) * maxValue : slope
    const k = Math.min(1, Math.max(0, ex * 2))
    const sh = Math.abs(shadeMod((shadeAspect(dx, dy) + azimuth) / PI + 0.5, 2) - 1)
    const s = Math.sin(scaled) * k
    const S0 = S[0], H0 = H[0], A = u.accent
    const s0 = (S0[0] + (H0[0] - S0[0]) * sh) * s, s1 = (S0[1] + (H0[1] - S0[1]) * sh) * s, s2 = (S0[2] + (H0[2] - S0[2]) * sh) * s, s3 = (S0[3] + (H0[3] - S0[3]) * sh) * s
    const ak = (1 - Math.cos(scaled)) * k * (1 - s3)
    out[0] = A[0] * ak + s0; out[1] = A[1] * ak + s1; out[2] = A[2] * ak + s2; out[3] = A[3] * ak + s3
    return
  }
  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0
  dx *= ex * 2; dy *= ex * 2
  const len = Math.hypot(dx, dy)
  if (u.method === "igor") {
    const azimuth = u.azimuths[0] + PI
    const slopeStrength = (Math.atan(len) * 2) / PI
    const aspectStrength = 1 - Math.abs(shadeMod((shadeAspect(dx, dy) + azimuth) / PI + 0.5, 2) - 1)
    shadeAdd(out, S[0], slopeStrength * aspectStrength); shadeAdd(out, H[0], slopeStrength * (1 - aspectStrength))
  } else if (u.method === "multidirectional") {
    const n = u.azimuths.length
    for (let i = 0; i < n; i++) {
      const cosAlt = Math.cos(u.altitudes[i]), sinAlt = Math.sin(u.altitudes[i]), cosAz = -Math.cos(u.azimuths[i]), sinAz = -Math.sin(u.azimuths[i])
      const s = Math.min(1, Math.max(0, (sinAlt - (dy * cosAz * cosAlt - dx * sinAz * cosAlt)) / Math.sqrt(1 + len * len)))
      if (s > 0.5) shadeAdd(out, H[i], (2 * s - 1) / n); else shadeAdd(out, S[i], (1 - 2 * s) / n)
    }
  } else {
    const azimuth = u.azimuths[0] + PI
    const cosAz = Math.cos(azimuth), sinAz = Math.sin(azimuth), cosAlt = Math.cos(u.altitudes[0]), sinAlt = Math.sin(u.altitudes[0])
    const c = (sinAlt - (dy * cosAz * cosAlt - dx * sinAz * cosAlt)) / Math.sqrt(1 + len * len)
    if (u.method === "basic") {
      const s = Math.min(1, Math.max(0, c))
      if (s > 0.5) shadeAdd(out, H[0], 2 * s - 1); else shadeAdd(out, S[0], 1 - 2 * s)
    } else { // combined
      const cang = Math.min(PI / 2, Math.max(0, Math.acos(Math.min(1, Math.max(-1, c)))))
      const k = (Math.atan(len) * 4) / PI / PI
      shadeAdd(out, S[0], cang * k); shadeAdd(out, H[0], (PI / 2 - cang) * k)
    }
  }
}
function shadeAdd(out, c, k) { out[0] += c[0] * k; out[1] += c[1] * k; out[2] += c[2] * k; out[3] += c[3] * k }

// ── Tiles of the app's protocols ──────────────────────────────────────────

/** The protocol tile template of a derived or lighting layer, and how to read it. */
function protocolOf(A, layer, dem, s, base) {
  const t = dem.tiles, e = dem.encoding, n = dem.tileSize
  switch (layer) {
    case "slope": return { url: A.buildSlopeProtocolUrl(t, e, n), run: A.slopeProtocol, enc: "mapbox" }
    case "aspect": return { url: A.buildAspectProtocolUrl(t, e, n), run: A.aspectProtocol }
    case "tri": return { url: A.buildTriProtocolUrl(t, e, n), run: A.triProtocol }
    case "curvature": return { url: A.buildCurvatureProtocolUrl(t, e, n, s.curvatureMode), run: A.curvatureProtocol }
    case "tpi": return { url: A.buildTpiProtocolUrl(t, e, n), run: A.tpiProtocol }
    case "roughness": return { url: A.buildRoughnessProtocolUrl(t, e, n), run: A.roughnessProtocol }
    case "shapeIndex": return { url: A.buildCurvatureProtocolUrl(t, e, n, "shape-index"), run: A.curvatureProtocol }
    case "blobness": return { url: A.buildBlobnessProtocolUrl(t, e, n, "blobness"), run: A.blobnessProtocol }
    case "eigenRatio": return { url: A.buildBlobnessProtocolUrl(t, e, n, "eigen-ratio"), run: A.blobnessProtocol }
    case "orientation": return { url: A.buildBlobnessProtocolUrl(t, e, n, "orientation"), run: A.blobnessProtocol }
    case "lrm": return { url: A.buildLrmProtocolUrl(t, e, n, s.lrmRadius), run: A.lrmProtocol }
    case "svf": return { url: A.buildSvfProtocolUrl(t, e, n, s.svfRadius, s.svfPrecision), run: A.svfProtocol }
    case "openness": return { url: A.buildOpennessProtocolUrl(t, e, n, s.opennessRadius, s.opennessMode, s.opennessPrecision), run: A.opennessProtocol }
    case "localDominance": return { url: A.buildLocalDominanceProtocolUrl(t, e, n, s.localDominanceMinRadius, s.localDominanceMaxRadius), run: A.localDominanceProtocol }
    case "matcap": {
      const tex = A.MATCAP_TEXTURES.find((x) => x.id === s.matcapTextureId) ?? A.MATCAP_TEXTURES.find((x) => x.id === A.DEFAULT_MATCAP_ID)
      return { url: A.buildMatcapProtocolUrl(new URL(tex.url, base).href, s.matcapRotationDeg, s.exaggeration, t, e, n), run: A.matcapProtocol, rgba: true, opacity: s.matcapOpacity * s.lightingEffectsOpacity }
    }
    case "phong": return { url: A.buildPhongProtocolUrl(s.phongDiffuseStrength, s.phongSpecularStrength, s.illuminationDir, s.illuminationAlt, s.exaggeration, t, e, n, { strength: s.phongFresnelStrength, power: s.phongFresnelPower, dark: s.theme !== "dark" }), run: A.phongProtocol, rgba: true, opacity: s.phongOpacity * s.lightingEffectsOpacity }
    case "shadows": return { url: A.buildShadowProtocolUrl(s.illuminationDir, s.illuminationAlt, s.shadowRadiusPx, t, e, n), run: A.shadowProtocol, rgba: true, opacity: s.lightingEffectsOpacity * s.shadowOpacity }
  }
  return null
}

// The protocol tiles computed last, by address (the address holds the
// source, every setting and the tile): a 512 px source tile serves the four
// 256 px tiles inside it, and the neighbours a map asks next, from one run
// of its kernel instead of four. An entry is the tile's values (Float32Array)
// or its RGBA pixels (Uint8ClampedArray), a run under way its promise. Per
// worker, TV_PROTOCOL_CACHE_MB (48) each.
const PROTOCOL_CACHE_BYTES = Math.max(0, Number(process.env.TV_PROTOCOL_CACHE_MB ?? 48)) * 1024 * 1024
const protocolTiles = new Map()
let protocolBytes = 0, protocolRuns = 0, protocolHits = 0
/** The protocol tile cache: kernels run, tiles answered from the cache, entries, bytes (test.mjs). */
export const protocolCacheStats = () => ({ runs: protocolRuns, hits: protocolHits, entries: protocolTiles.size, bytes: protocolBytes })
function protocolTile(p, z, x, y, side) {
  const url = p.url.replace("{z}", z).replace("{x}", x).replace("{y}", y)
  const have = protocolTiles.get(url)
  if (have) { protocolHits++; protocolTiles.delete(url); protocolTiles.set(url, have); return have.promise }
  protocolRuns++
  const promise = (async () => {
    try {
      const r = await p.run({ url }, new AbortController())
      // The protocols built on runNormalDerivedProtocol hand back their
      // values unencoded beside the tile: read those, not the Terrarium
      // packing, which clamps at ±32768 and steps by 1/256.
      if (!p.rgba && r?.values?.length === side * side) return { values: r.values }
      const px = await pixelsOf(r)
      return px.width === side ? { px: px.data } : null
    } catch { return null }
  })()
  const entry = { promise, bytes: 0 }
  protocolTiles.set(url, entry)
  promise.then((t) => {
    if (protocolTiles.get(url) !== entry) return
    if (!t) { protocolTiles.delete(url); return }
    entry.bytes = (t.values ?? t.px).byteLength
    protocolBytes += entry.bytes
    while (protocolBytes > PROTOCOL_CACHE_BYTES && protocolTiles.size) {
      const [k, e] = protocolTiles.entries().next().value
      protocolTiles.delete(k)
      protocolBytes -= e.bytes
    }
  })
  return promise
}

/** A rectangle of a protocol's tiles at zoom z: `channels` floats a pixel
 *  (1: the decoded value, NaN for no data; 4: premultiplied RGBA 0..1).
 *  Every tile the rectangle overlaps is computed whole: callers ask for the
 *  pixels they read (readRange), not a margin. */
async function protocolWindow(p, z, side, x0, y0, w, h) {
  const ch = p.rgba ? 4 : 1
  const out = new Float32Array(w * h * ch).fill(p.rgba ? 0 : NaN)
  const n = 2 ** z
  const jobs = []
  for (let ty = Math.floor(y0 / side); ty <= Math.floor((y0 + h - 1) / side); ty++) for (let tx = Math.floor(x0 / side); tx <= Math.floor((x0 + w - 1) / side); tx++) {
    if (ty < 0 || ty >= n) continue
    const wx = ((tx % n) + n) % n
    jobs.push(protocolTile(p, z, wx, ty, side).then((t) => {
      if (!t) return
      const j0 = Math.max(y0, ty * side), j1 = Math.min(y0 + h, (ty + 1) * side), i0 = Math.max(x0, tx * side), i1 = Math.min(x0 + w, (tx + 1) * side)
      if (t.values) {
        const v = t.values
        for (let j = j0; j < j1; j++) out.set(v.subarray((j - ty * side) * side + (i0 - tx * side), (j - ty * side) * side + (i1 - tx * side)), (j - y0) * w + (i0 - x0))
        return
      }
      const d = t.px, mapbox = p.enc === "mapbox"
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const o = ((j - ty * side) * side + (i - tx * side)) * 4, q = (j - y0) * w + (i - x0)
        if (p.rgba) { const a = d[o + 3] / 255; out[q * 4] = (d[o] / 255) * a; out[q * 4 + 1] = (d[o + 1] / 255) * a; out[q * 4 + 2] = (d[o + 2] / 255) * a; out[q * 4 + 3] = a }
        else if (d[o + 3] !== 0) out[q] = mapbox ? -10000 + (d[o] * 65536 + d[o + 1] * 256 + d[o + 2]) * 0.1 : d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768
      }
    }))
  }
  await Promise.all(jobs)
  return out
}

/** The source pixels a bilinear read at positions F[from..to) touches with
 *  a weight above zero: [lo, hi]. A position on a pixel centre reads that
 *  pixel alone. Reading a protocol over these instead of a margin keeps it
 *  from computing the neighbour tiles the margin reaches into (four 512 px
 *  kernels for one 256 px tile: what made the sky view factor slow). */
function readRange(F, from, to) {
  let lo = Infinity, hi = -Infinity
  for (let i = from; i < to; i++) {
    const a = Math.floor(F[i])
    if (a < lo) lo = a
    const b = F[i] > a ? a + 1 : a
    if (b > hi) hi = b
  }
  return [lo, hi]
}

/** A protocol's values (or RGBA) over the pixels the output reads, as a
 *  clamped sampler in the coordinates of the full window (gx0, gy0). A read
 *  outside lands on the same row or column inside, and is only ever a
 *  zero-weight term of the bilinear: the result is the pixel's own. */
async function protocolSampler(p, z, side, gx0, gy0, [lx, hx], [ly, hy]) {
  const w = hx - lx + 1, h = hy - ly + 1, c = p.rgba ? 4 : 1
  const G = await protocolWindow(p, z, side, gx0 + lx, gy0 + ly, w, h)
  const at = (i, j, q = 0) => G[(Math.min(h - 1, Math.max(0, j - ly)) * w + Math.min(w - 1, Math.max(0, i - lx))) * c + q]
  return { G, at, lx, ly, w, h }
}

/** The bilinear taps of positions F[from..from+count) on a grid whose index
 *  0 is source pixel `lo`, `n` long: per position the two clamped indices
 *  and the weight of the second. Made once a tile per axis, so the pixel
 *  loop reads a grid without a closure, a floor or a clamp (they were most
 *  of a resample's time). The clamping and the weight are bil()'s. */
function taps(F, from, count, lo, n) {
  const I0 = new Int32Array(count), I1 = new Int32Array(count), T = new Float64Array(count)
  for (let k = 0; k < count; k++) {
    const f = F[from + k], a = Math.floor(f)
    T[k] = f - a
    I0[k] = Math.min(n - 1, Math.max(0, a - lo))
    I1[k] = Math.min(n - 1, Math.max(0, a + 1 - lo))
  }
  return { I0, I1, T }
}

/** A grid `w` wide resampled at the taps (bil()'s arithmetic, in its order). */
function resampleTaps(G, w, X, Y) {
  const width = X.T.length, height = Y.T.length, out = new Float32Array(width * height)
  const XI0 = X.I0, XI1 = X.I1, XT = X.T
  for (let j = 0; j < height; j++) {
    const r0 = Y.I0[j] * w, r1 = Y.I1[j] * w, ty = Y.T[j], o = j * width
    for (let i = 0; i < width; i++) {
      const c0 = XI0[i], c1 = XI1[i], tx = XT[i]
      out[o + i] = (G[r0 + c0] * (1 - tx) + G[r0 + c1] * tx) * (1 - ty) + (G[r1 + c0] * (1 - tx) + G[r1 + c1] * tx) * ty
    }
  }
  return out
}

// ── Values ────────────────────────────────────────────────────────────────

// The modes with a value per pixel, before any colour ramp, in natural
// units. The app's protocols carry their values packed into RGB tiles,
// some of them scaled to fit the packing's precision or the ramp's range;
// `to` undoes that: natural = wire * a + b. `unit` and `description` are
// served by /processes and listed in the tile service docs.
const CURV_SCALE = 1000 // lib/curvature-protocol.ts CURVATURE_ENCODE_SCALE, the wire's factor
export const VALUE_MODES = {
  elevation: { unit: "m", description: "Elevation of the terrain source, metres above its datum" },
  colorRelief: { unit: "m", description: "Elevation (the values colour relief colours), metres" },
  slope: { unit: "degree", description: "Slope angle, 0 (flat) to 90 (vertical), Horn's kernel as gdaldem" },
  aspect: { unit: "degree", description: "Direction the slope faces, clockwise from north, 0 to 360 (gdaldem's aspect)" },
  tri: { unit: "m", description: "Terrain Ruggedness Index: mean absolute elevation difference to the 8 neighbours" },
  tpi: { unit: "m", description: "Topographic Position Index: elevation minus the mean of the 8 neighbours" },
  roughness: { unit: "m", description: "Roughness: largest elevation difference in the 3x3 window" },
  curvature: {
    unit: "1/m", description: "Curvature, per curvatureMode: combined (Laplacian), profile, plan and casorati in 1/m; det-hessian in 1/m²; shape-index unitless, -1 to 1",
    to: (s) => {
      const m = s.curvatureMode ?? "combined"
      return { a: m === "shape-index" ? 1 / CURV_SCALE : m === "det-hessian" ? 1 / (CURV_SCALE * 10000) : 1 / (CURV_SCALE * 100), b: 0 }
    },
    unitOf: (s) => ({ "shape-index": "1", "det-hessian": "1/m^2" })[s.curvatureMode ?? "combined"] ?? "1/m",
  },
  shapeIndex: { unit: "1", description: "Shape index (Koenderink and van Doorn): -1 bowl, -0.5 valley, 0 saddle, 0.5 ridge, 1 dome", to: () => ({ a: 1 / CURV_SCALE, b: 0 }) },
  blobness: { unit: "1", description: "Blobness: det/trace of the gradient structure tensor (a squared slope, unitless); the app's ramp reads it ×100", to: () => ({ a: 1 / 100, b: 0 }) },
  eigenRatio: { unit: "1", description: "Eigenvalue ratio λmin/λmax of the gradient structure tensor, 0 (linear: slope, ridge, valley) to 1 (isotropic: peak, pit, saddle); the app's ramp reads it as a percentage", to: () => ({ a: 1 / 100, b: 0 }) },
  orientation: { unit: "degree", description: "Axis of the dominant gradient direction, clockwise from north, 0 to 180" },
  lrm: { unit: "m", description: "Local Relief Model: elevation minus its low-pass trend (lrmRadius)" },
  svf: { unit: "1", description: "Sky View Factor, the visible share of the sky, 0 to 1 (1: flat open ground); the app's ramp reads it as a percentage", to: () => ({ a: 1 / 100, b: 0 }) },
  openness: { unit: "degree", description: "Openness (opennessMode positive or negative): mean zenith angle to the horizon, 90 on flat ground, more on summits (positive) or in valleys (negative); the app's ramp reads it minus 90", to: () => ({ a: 1, b: 90 }) },
  localDominance: { unit: "degree", description: "Local Dominance: mean angle down from an observer to the surrounding terrain, high on mounds, low in hollows" },
}
export const valueUnit = (mode, s = {}) => VALUE_MODES[mode]?.unitOf?.(s) ?? VALUE_MODES[mode]?.unit

/** One mode's values over a rectangle of the Web Mercator world (as draw()):
 *  a Float32Array, row by row, NaN where there is no data. */
export async function valuesOf({ dem, state: s }, mode, { world, x0, y0, width, height, baseUrl = DEFAULT_BASE_URL }) {
  const def = VALUE_MODES[mode]
  if (!def) throw Object.assign(new Error(`No values for ${mode}: values are served for ${Object.keys(VALUE_MODES).join(", ")}`), { status: 400 })
  const A = await app()
  const zd = Math.max(0, Math.min(dem.maxzoom, Math.round(Math.log2(world / dem.tileSize))))
  const side = dem.tileSize, k = (side * 2 ** zd) / world
  const gx0 = Math.floor(x0 * k) - 2, gy0 = Math.floor(y0 * k) - 2
  const gw = Math.ceil((x0 + width) * k) + 2 - gx0, gh = Math.ceil((y0 + height) * k) + 2 - gy0
  // Bilinear on the source grid at each output pixel centre, as the map
  // samples a raster-dem (and draw() samples before the ramp). An angle that
  // wraps (aspect, orientation) is taken from the nearest source pixel, so
  // 359° and 1° do not average to 180°.
  const nearest = mode === "aspect" || mode === "orientation"
  const FX = new Float64Array(width), FY = new Float64Array(height)
  for (let i = 0; i < width; i++) FX[i] = (x0 + i + 0.5) * k - 0.5 - gx0
  for (let j = 0; j < height; j++) FY[j] = (y0 + j + 0.5) * k - 0.5 - gy0
  let G, at, lx = 0, ly = 0, w = gw, h = gh
  if (mode === "elevation" || mode === "colorRelief") {
    G = await demWindow(dem, zd, side, gx0, gy0, gw, gh)
    at = (i, j) => G[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))]
  } else {
    // The pixels read (nearest: the ones rounded to), not the margin.
    const range = (F, n) => (nearest ? [Math.round(F[0]), Math.round(F[n - 1])] : readRange(F, 0, n))
    ;({ G, at, lx, ly, w, h } = await protocolSampler(protocolOf(A, mode, dem, s, baseUrl), zd, side, gx0, gy0, range(FX, width), range(FY, height)))
  }
  if (G.every(Number.isNaN)) {
    const refused = refusalOf(dem)
    if (refused) throw Object.assign(new Error(`The source refused the request (HTTP ${refused}): check the API key or its allowed origins`), { status: 502 })
    throw Object.assign(new Error("This source has no data here"), { status: 404 })
  }
  const { a, b } = def.to?.(s) ?? { a: 1, b: 0 }
  const out = new Float32Array(width * height)
  if (!nearest) {
    // bil() through taps made once per column and row (resampleTaps, kept
    // in doubles here: the scaling below comes before the Float32 rounding).
    const X = taps(FX, 0, width, lx, w), Y = taps(FY, 0, height, ly, h)
    for (let j = 0; j < height; j++) {
      const r0 = Y.I0[j] * w, r1 = Y.I1[j] * w, ty = Y.T[j]
      for (let i = 0; i < width; i++) {
        const c0 = X.I0[i], c1 = X.I1[i], tx = X.T[i]
        const v = (G[r0 + c0] * (1 - tx) + G[r0 + c1] * tx) * (1 - ty) + (G[r1 + c0] * (1 - tx) + G[r1 + c1] * tx) * ty
        out[j * width + i] = v * a + b
      }
    }
    return out
  }
  for (let j = 0; j < height; j++) {
    const fy = FY[j]
    for (let i = 0; i < width; i++) out[j * width + i] = at(Math.round(FX[i]), Math.round(fy)) * a + b
  }
  return out
}

/** Values encoded: `tif`, a one-band Float32 GeoTIFF in EPSG:3857 (NaN no
 *  data), deflate with the floating-point predictor unless `compress` is
 *  false (tiff.mjs); `terrarium` or `terrainrgb`, the values times `scale` packed in a
 *  PNG as an elevation would be (lib/elevation-encoding.ts), transparent
 *  where there is no data. */
export async function encodeValues(values, { world, x0, y0, width, height, format = "tif", scale = 1, compress = true }) {
  if (format === "tif") {
    const px = EARTH / world
    // Level 1: within about 10% of level 6's size at half its time (2 to 6 ms
    // a 256 px tile), small beside the tile's own computation.
    return float32GeoTiff(values, { width, height, pixelSize: px, west: -EARTH / 2 + x0 * px, north: EARTH / 2 - y0 * px, compress, level: 1 })
  }
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < values.length; i++) {
    const v = values[i] * scale
    if (!Number.isFinite(v)) continue
    if (format === "terrarium") {
      const t = Math.min(65535.996, Math.max(0, v + 32768)), whole = Math.floor(t)
      rgba[i * 4] = whole >> 8; rgba[i * 4 + 1] = whole & 255; rgba[i * 4 + 2] = Math.floor((t - whole) * 256)
    } else {
      const t = Math.min(16777215, Math.max(0, Math.round((v + 10000) / 0.1)))
      rgba[i * 4] = t >> 16; rgba[i * 4 + 1] = (t >> 8) & 255; rgba[i * 4 + 2] = t & 255
    }
    rgba[i * 4 + 3] = 255
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

/** A rectangle's values, encoded (valuesOf, then encodeValues). */
export async function valueTile(how, mode, args) {
  return encodeValues(await valuesOf(how, mode, args), args)
}

// ── Quantized mesh: the source as Cesium terrain ────────────────────────────

/** The deepest geographic level worth serving for a source: its deepest
 *  level in 256 px Web Mercator tiles, less one (a geographic tile of level
 *  z is as wide as a Mercator tile of level z + 1). */
export const meshLevel = (dem) => Math.max(0, Math.min(21, dem.maxzoom + Math.max(0, Math.round(Math.log2(dem.tileSize / 256)))) - 1)

/** The heights of a geographic tile (TMS, EPSG:4326) on a `size` x `size`
 *  grid, row 0 the north edge: the source's Web Mercator pixels of the
 *  level as wide as the grid, bilinear, read with a border of two pixels so
 *  the edges are interpolated like the inside. NaN where there is no data. */
export async function geographicGrid(dem, z, x, y, size = 257) {
  const b = tileBounds(z, x, y)
  const side = dem.tileSize
  const zd = Math.max(dem.minzoom ?? 0, Math.min(dem.maxzoom, Math.round(z + 1 + Math.log2(256 / side))))
  const W = side * 2 ** zd
  const LAT = 85.0511287798
  const px = (lon) => ((lon + 180) / 360) * W - 0.5
  const py = (lat) => { const l = Math.max(-LAT, Math.min(LAT, lat)) * (PI / 180); return (1 - Math.asinh(Math.tan(l)) / PI) / 2 * W - 0.5 }
  const gx0 = Math.floor(px(b.west)) - 2, gx1 = Math.ceil(px(b.east)) + 2
  const gy0 = Math.max(-2, Math.floor(py(b.north)) - 2), gy1 = Math.min(W + 1, Math.ceil(py(b.south)) + 2)
  const gw = gx1 - gx0 + 1, gh = gy1 - gy0 + 1
  const G = await demWindow(dem, zd, side, gx0, gy0, gw, gh)
  const at = (i, j) => G[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))]
  const out = new Float32Array(size * size)
  const last = size - 1
  const fxs = new Float64Array(size)
  for (let i = 0; i < size; i++) fxs[i] = px(b.west + (i / last) * (b.east - b.west)) - gx0
  for (let j = 0; j < size; j++) {
    const fy = py(b.north - (j / last) * (b.north - b.south)) - gy0
    const jj = Math.floor(fy), ty = fy - jj
    for (let i = 0; i < size; i++) {
      const fx = fxs[i], ii = Math.floor(fx), tx = fx - ii
      const v = (at(ii, jj) * (1 - tx) + at(ii + 1, jj) * tx) * (1 - ty) + (at(ii, jj + 1) * (1 - tx) + at(ii + 1, jj + 1) * tx) * ty
      // A hole beside data: the nearest pixel, as valuesOf would leave it NaN.
      out[j * size + i] = Number.isNaN(v) ? at(Math.round(fx), Math.round(fy)) : v
    }
  }
  return out
}

/** One quantized-mesh-1.0 tile of the source (quantized-mesh.mjs): the
 *  geographic grid, meshed within `errorScale` times Cesium's geometric
 *  error of the level (at least 5 cm). `heights`: "ellipsoidal" (the
 *  default, what Cesium expects: the geoid's undulation added to an
 *  orthometric source, geoid.mjs) or "orthometric" (the source's own
 *  heights above sea level; an ellipsoidal source has the undulation taken
 *  off). A tile with no data is flat at sea level (0 m, or the geoid's height
 *  at its centre when ellipsoidal); a source that refused the request (401,
 *  403) is an error. */
export async function quantizedMeshTile({ dem }, { z, x, y, size = 257, errorScale = 0.5, normals = false, mesher = "martini", maxTriangles, heights: datum = "ellipsoidal" }) {
  const heights = await geographicGrid(dem, z, x, y, size)
  const bounds = tileBounds(z, x, y)
  if (heights.every(Number.isNaN)) {
    const refused = refusalOf(dem)
    if (refused) throw Object.assign(new Error(`The source refused the request (HTTP ${refused}): check the API key or its allowed origins`), { status: 502 })
    // Flat: one height, so the service sees an empty tile (and keeps it out of its cache).
    if (datum === "ellipsoidal") heights.fill(Math.round((await undulation((bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2)) * 100) / 100)
  } else {
    const from = dem.datum === "ellipsoidal" ? "ellipsoidal" : "orthometric"
    if (from !== datum) await addUndulation(heights, size, bounds, datum === "ellipsoidal" ? 1 : -1)
  }
  return encodeTile({ heights, size, bounds, maxError: Math.max(0.05, levelGeometricError(z) * errorScale), mesher, normals, ...(maxTriangles ? { maxTriangles } : {}) })
}

// ── Drawing ───────────────────────────────────────────────────────────────

/**
 * A rectangle of the Web Mercator world. `world` is the side of the whole
 * world in output pixels (a tile of side S at zoom z: S * 2^z), `x0`, `y0`
 * the rectangle's corner in those pixels.
 * @returns {Promise<Buffer>} PNG or JPEG
 */
export async function draw({ dem, layers, state: s }, { world, x0, y0, width, height, format = "png", baseUrl = DEFAULT_BASE_URL, credit }) {
  const A = await app(), ch = await chroma()
  // The source zoom MapLibre picks: the pyramid's pixels at the output's
  // scale, or its deepest level, overzoomed.
  const zd = Math.max(0, Math.min(dem.maxzoom, Math.round(Math.log2(world / dem.tileSize))))
  const side = dem.tileSize, k = (side * 2 ** zd) / world
  const M = 2
  const gx0 = Math.floor(x0 * k) - M - 1, gy0 = Math.floor(y0 * k) - M - 1
  const gw = Math.ceil((x0 + width) * k) + M + 1 - gx0, gh = Math.ceil((y0 + height) * k) + M + 1 - gy0
  const live = (l) => (l === "matcap" && s.matcapRenderer !== "raster") || (l === "phong" && s.phongRenderer !== "raster")
  const needElevation = layers.some((l) => l === "colorRelief" || l === "hillshade" || live(l) || (l === "planeSlicer" && s.planeSlicerReferenceMode !== "lrm"))
  const E = needElevation ? await demWindow(dem, zd, side, gx0, gy0, gw, gh) : null
  if (E && E.every(Number.isNaN)) {
    const refused = refusalOf(dem)
    if (refused) throw Object.assign(new Error(`The source refused the request (HTTP ${refused}): check the API key or its allowed origins`), { status: 502 })
    throw Object.assign(new Error("This source has no data here"), { status: 404 })
  }
  const clampAt = (G, c = 1) => (i, j, q = 0) => G[(Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))) * c + q]

  // Output pixel centres on the source grid, with a margin for the contours.
  const P = 3, ow = width + 2 * P, oh = height + 2 * P
  const FX = new Float32Array(ow), FY = new Float32Array(oh)
  for (let i = 0; i < ow; i++) FX[i] = (x0 + i - P + 0.5) * k - 0.5 - gx0
  for (let j = 0; j < oh; j++) FY[j] = (y0 + j - P + 0.5) * k - 0.5 - gy0
  // The output pixels' taps on the elevation window, and a grid of it (or of
  // a protocolSampler window) resampled at them.
  let eTaps
  const elevationTaps = () => (eTaps ??= { X: taps(FX, P, width, 0, gw), Y: taps(FY, P, height, 0, gh) })
  const resampleE = (G) => resampleTaps(G, gw, elevationTaps().X, elevationTaps().Y)
  const resampleS = ({ G, lx, ly, w, h }) => resampleTaps(G, w, taps(FX, P, width, lx, w), taps(FY, P, height, ly, h))
  const latOf = (wy) => Math.atan(Math.sinh(PI * (1 - (2 * wy) / world)))
  // The source pixels the output pixels (no margin) read, for the protocols.
  const readX = readRange(FX, P, P + width), readY = readRange(FY, P, P + height)

  // Premultiplied RGBA 0..1, the map's background to start with: white, or
  // black in the dark theme (BackgroundLayer).
  const img = new Float32Array(width * height * 4).fill(s.transparent ? 0 : 1)
  if (s.theme === "dark" && !s.transparent) for (let i = 0; i < img.length; i += 4) { img[i] = 0; img[i + 1] = 0; img[i + 2] = 0 }
  const rect = { world, x0, y0, width, height }
  const paintValues = (values, paint, encoding) => {
    const ramp = rampOf(paint["color-relief-color"], ch, encoding), op = paint["color-relief-opacity"] ?? 1, c = new Float32Array(4)
    for (let i = 0; i < values.length; i++) {
      if (Number.isNaN(values[i])) continue
      ramp(values[i], c)
      over(img, i * 4, c[0] * op, c[1] * op, c[2] * op, c[3] * op)
    }
  }

  for (const layer of layers) {
    if (layer === "colorRelief") {
      paintValues(resampleE(E), A.computeColorReliefPaint({ ...s }), dem.encoding)
    } else if (layer === "hillshade") {
      // MapLibre's prepare pass on the source grid (the Sobel sums, its zoom
      // factor, the 8-bit texture it keeps them in), then its shading pass.
      const at = clampAt(E)
      const factor = zd < 2 ? 0.4 : zd < 4.5 ? 0.35 : 0.3
      const exag = zd < 15 ? (zd - 15) * factor : 0
      const scale = side / Math.pow(2, exag + (28.2562 - zd))
      const q8 = (v) => (Math.round(Math.min(1, Math.max(0, v / 8 + 128 / 255)) * 255) / 255 - 128 / 255) * 8
      const DX = new Float32Array(gw * gh), DY = new Float32Array(gw * gh)
      for (let j = 0; j < gh; j++) {
        const inner = j > 0 && j < gh - 1
        for (let i = 0; i < gw; i++) {
          let a, b, c, d, f, g, h, n
          if (inner && i > 0 && i < gw - 1) {
            // Inside: the 3x3 window read straight, no clamping.
            const o = j * gw + i
            a = E[o - gw - 1]; b = E[o - gw]; c = E[o - gw + 1]; d = E[o - 1]; f = E[o + 1]; g = E[o + gw - 1]; h = E[o + gw]; n = E[o + gw + 1]
          } else {
            a = at(i - 1, j - 1); b = at(i, j - 1); c = at(i + 1, j - 1); d = at(i - 1, j); f = at(i + 1, j); g = at(i - 1, j + 1); h = at(i, j + 1); n = at(i + 1, j + 1)
          }
          DX[j * gw + i] = q8((c + f + f + n - (a + d + d + g)) * scale)
          DY[j * gw + i] = q8((g + h + h + n - (a + b + b + c)) * scale)
        }
      }
      const u = hillshadeUniforms(A.computeHillshadePaint(s), ch), px = [0, 0, 0, 0]
      const { X, Y } = elevationTaps(), XI0 = X.I0, XI1 = X.I1, XT = X.T
      for (let j = 0; j < height; j++) {
        const cosLat = Math.cos(latOf(y0 + j + 0.5))
        const r0 = Y.I0[j] * gw, r1 = Y.I1[j] * gw, ty = Y.T[j]
        for (let i = 0; i < width; i++) {
          // bil() on DX and DY, through the taps.
          const a = r0 + XI0[i], b = r0 + XI1[i], c = r1 + XI0[i], d = r1 + XI1[i], tx = XT[i]
          const dx = ((DX[a] * (1 - tx) + DX[b] * tx) * (1 - ty) + (DX[c] * (1 - tx) + DX[d] * tx) * ty) / cosLat
          const dy = ((DY[a] * (1 - tx) + DY[b] * tx) * (1 - ty) + (DY[c] * (1 - tx) + DY[d] * tx) * ty) / cosLat
          if (Number.isNaN(dx) || Number.isNaN(dy)) continue
          shade(u, dx, dy, px)
          over(img, (j * width + i) * 4, px[0], px[1], px[2], px[3])
        }
      }
    } else if (live(layer)) {
      await liveLighting(layer, s, { E, gw, gh, FX, FY, P, width, height, img, zd, side, gy0, base: baseUrl })
    } else if (layer === "contours") {
      const c = await contourSource(dem, s)
      await overSvg(img, width, height, await contourSvg(c.dem, { minor: c.minor, major: c.major, weight: s.contourWeight, color: s.contourColor, labels: s.showContourLabels, theme: s.theme }, rect))
    } else if (layer === "isoline") {
      await overSvg(img, width, height, await isolineSvg(A, dem, s, rect, baseUrl))
    } else if (layer === "graticules") {
      await overSvg(img, width, height, graticuleSvg(A, s, rect))
    } else if (layer === "buildingShadows") {
      await overSvg(img, width, height, await buildingShadowSvg(A, s, rect))
    } else if (layer === "tells") {
      await overSvg(img, width, height, await tellsSvg(A, dem, s, rect))
    } else if (layer === "planeSlicer") {
      const paint = A.computePlaneSlicerPaint({ value: s.planeSlicerReferenceMode === "lrm" ? s.planeSlicerValueLrm : s.planeSlicerValue, side: s.planeSlicerSide, color: s.planeSlicerColor, opacity: s.planeSlicerOpacity })
      if (s.planeSlicerReferenceMode === "lrm") {
        paintValues(resampleS(await protocolSampler({ url: A.buildLrmProtocolUrl(dem.tiles, dem.encoding, dem.tileSize, s.lrmRadius), run: A.lrmProtocol }, zd, side, gx0, gy0, readX, readY)), paint, "terrarium")
      } else paintValues(resampleE(E), paint, dem.encoding)
    } else {
      const p = protocolOf(A, layer, dem, s, baseUrl)
      const S = await protocolSampler(p, zd, side, gx0, gy0, readX, readY), G = S.G
      if (p.rgba) {
        // bil() on each channel, its four reads and their clamping done once
        // a pixel instead of once a channel.
        const op = p.opacity ?? 1, [lx, hx] = readX, [ly, hy] = readY, w = hx - lx + 1
        const col = (i) => Math.min(w - 1, Math.max(0, i - lx)), row = (j) => Math.min(hy - ly, Math.max(0, j - ly))
        const C0 = new Int32Array(width), C1 = new Int32Array(width), TX = new Float64Array(width)
        for (let i = 0; i < width; i++) { const fx = FX[i + P], ii = Math.floor(fx); TX[i] = fx - ii; C0[i] = col(ii) * 4; C1[i] = col(ii + 1) * 4 }
        for (let j = 0; j < height; j++) {
          const fy = FY[j + P], jj = Math.floor(fy), ty = fy - jj, R0 = row(jj) * w * 4, R1 = row(jj + 1) * w * 4
          for (let i = 0; i < width; i++) {
            const tx = TX[i], a = R0 + C0[i], b = R0 + C1[i], c = R1 + C0[i], d = R1 + C1[i], px = rgbaPx
            for (let q = 0; q < 4; q++) px[q] = ((G[a + q] * (1 - tx) + G[b + q] * tx) * (1 - ty) + (G[c + q] * (1 - tx) + G[d + q] * tx) * ty) * op
            over(img, (j * width + i) * 4, px[0], px[1], px[2], px[3])
          }
        }
      } else {
        paintValues(resampleS(S), A.computeColorReliefPaint(A.MODE_RELIEF[layer](s)), p.enc ?? "terrarium")
      }
    }
  }

  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const alpha = img[i * 4 + 3], a = alpha || 1
    rgba[i * 4] = Math.round(Math.min(1, img[i * 4] / a) * 255); rgba[i * 4 + 1] = Math.round(Math.min(1, img[i * 4 + 1] / a) * 255); rgba[i * 4 + 2] = Math.round(Math.min(1, img[i * 4 + 2] / a) * 255); rgba[i * 4 + 3] = Math.round(Math.min(1, alpha) * 255)
  }
  let out = sharp(rgba, { raw: { width, height, channels: 4 } })
  if (credit) {
    // The source's name, bottom right, as the map's attribution sits.
    const esc = (t) => t.replace(/[<&>]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" })[c])
    const text = esc(credit), tw = Math.min(width - 8, Math.round(text.length * 6.2) + 12)
    out = sharp(await out.png().toBuffer()).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${width - tw}" y="${height - 18}" width="${tw}" height="18" fill="rgba(255,255,255,0.7)"/><text x="${width - 6}" y="${height - 5}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#333" text-anchor="end">${text}</text></svg>`) }])
  }
  // zlib level 3: a third of the default level's time (2.5 ms against 7.5 a
  // 256 px tile), 8 % larger.
  return format === "png" ? out.png({ compressionLevel: 3 }).toBuffer() : out.flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer()
}

// ── The live Phong and matcap layers ──────────────────────────────────────

const matcapImages = new Map()
async function matcapImage(url) {
  if (!matcapImages.has(url)) matcapImages.set(url, (async () => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`The matcap ${url} answered ${res.status}`)
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { w: info.width, h: info.height, d: data }
  })().catch((e) => { matcapImages.delete(url); throw e }))
  return matcapImages.get(url)
}

const hexRgb01 = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? "")); const n = m ? parseInt(m[1], 16) : 0xffffff; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] }

/** lib/phong-live-gl-layer.ts and lib/matcap-live-gl-layer.ts, per output
 *  pixel, for a flat view (bearing and pitch 0: the camera-relative light
 *  and matcap basis reduce to fixed vectors). */
async function liveLighting(layer, s, { E, gw, gh, FX, FY, P, width, height, img, zd, side, gy0, base }) {
  const A = await app()
  const ex = s.exaggeration
  // DEM_NORMAL_GLSL: Horn on the bilinear elevation, one source pixel either
  // side, the hornGradient signs (dx west − east), no /8; the ground
  // resolution of the source tile the pixel falls in.
  // The nine bilinear reads of a pixel share their weights (a whole pixel
  // apart, fx ± 1 has fx's fraction) and their rows: per pixel, the 4x4
  // source pixels around it, lerped across once per row (12 lerps, not 18),
  // then down. Columns and rows (clamped as the window's reads are), weights
  // and the ground resolution are made once a tile. Same arithmetic, in the
  // same order, as bil() at fx + dx, fy + dy: the same pixels.
  const CX = new Int32Array(width * 4), TX = new Float64Array(width)
  for (let i = 0; i < width; i++) {
    const fx = FX[i + P], a = Math.floor(fx)
    TX[i] = fx - a
    for (let q = 0; q < 4; q++) CX[i * 4 + q] = Math.min(gw - 1, Math.max(0, a - 1 + q))
  }
  const RY = new Int32Array(height * 4), TY = new Float64Array(height), INV = new Float64Array(height)
  for (let j = 0; j < height; j++) {
    const fy = FY[j + P], a = Math.floor(fy)
    TY[j] = fy - a
    for (let q = 0; q < 4; q++) RY[j * 4 + q] = Math.min(gh - 1, Math.max(0, a - 1 + q)) * gw
    const row = Math.floor((gy0 + fy + 0.5) / side)
    const lat = Math.atan(Math.sinh(PI * (1 - (2 * (row + 0.5)) / 2 ** zd)))
    INV[j] = 1 / ((EARTH * Math.cos(lat)) / (side * 2 ** zd))
  }
  const L = new Float64Array(12)
  const normal = (i, j, out) => {
    const tx = TX[i], ux = 1 - tx, c0 = CX[i * 4], c1 = CX[i * 4 + 1], c2 = CX[i * 4 + 2], c3 = CX[i * 4 + 3]
    for (let q = 0; q < 4; q++) {
      const o = RY[j * 4 + q], e0 = E[o + c0], e1 = E[o + c1], e2 = E[o + c2], e3 = E[o + c3]
      L[q * 3] = e0 * ux + e1 * tx; L[q * 3 + 1] = e1 * ux + e2 * tx; L[q * 3 + 2] = e2 * ux + e3 * tx
    }
    const ty = TY[j], uy = 1 - ty
    const a0 = L[0] * uy + L[3] * ty, a1 = L[1] * uy + L[4] * ty, a2 = L[2] * uy + L[5] * ty
    const a3 = L[3] * uy + L[6] * ty, a5 = L[5] * uy + L[8] * ty
    const a6 = L[6] * uy + L[9] * ty, a7 = L[7] * uy + L[10] * ty, a8 = L[8] * uy + L[11] * ty
    const inv = INV[j]
    const gx = (a0 + a3 + a3 + a6 - (a2 + a5 + a5 + a8)) * inv, gy = (a6 + a7 + a7 + a8 - (a0 + a1 + a1 + a2)) * inv
    const nx = -gx * ex, ny = -gy * ex, len = Math.hypot(nx, ny, 1)
    out[0] = nx / len; out[1] = ny / len; out[2] = 1 / len
  }
  const n = new Float64Array(3)
  if (layer === "phong") {
    const toLight = (dir, alt) => { const az = (dir * PI) / 180, el = (alt * PI) / 180; return [-Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)] }
    const lights = [{ v: toLight(s.illuminationDir, s.illuminationAlt), c: hexRgb01(s.phongLight1Color) },
      ...[[s.phongLight2Dir, s.phongLight2Alt, s.phongLight2Color], [s.phongLight3Dir, s.phongLight3Alt, s.phongLight3Color]].slice(0, Math.max(0, Math.min(3, s.phongLightCount) - 1)).map(([d, a, c]) => ({ v: toLight(d, a), c: hexRgb01(c) }))]
    const H = lights.map(({ v }) => { const h = [v[0], v[1], v[2] + 1], l = Math.hypot(...h); return h.map((x) => x / l) })
    // The lights flat, read by index in the pixel loop (no closure per pixel).
    const LV = Float64Array.from(lights.flatMap((l) => l.v)), LC = Float64Array.from(lights.flatMap((l) => l.c)), LH = Float64Array.from(H.flat())
    const AMBIENT = 0.35, SHININESS = 32, count = lights.length, op = s.phongOpacity * s.lightingEffectsOpacity
    const kd = s.phongDiffuseStrength, ks = s.phongSpecularStrength, fs = s.phongFresnelStrength, fp = s.phongFresnelPower, dark = s.theme !== "dark" ? 1 : 0
    const diff = new Float64Array(3)
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      normal(i, j, n)
      if (Number.isNaN(n[0])) continue
      diff[0] = 0; diff[1] = 0; diff[2] = 0
      let spec = 0
      for (let q = 0; q < count; q++) {
        const v = q * 3
        const d = Math.max(n[0] * LV[v] + n[1] * LV[v + 1] + n[2] * LV[v + 2], 0)
        diff[0] += LC[v] * d; diff[1] += LC[v + 1] * d; diff[2] += LC[v + 2] * d
        spec += Math.pow(Math.max(n[0] * LH[v] + n[1] * LH[v + 1] + n[2] * LH[v + 2], 0), SHININESS)
      }
      const rim = fs * Math.pow(1 - Math.min(1, Math.max(0, n[2])), fp)
      const add = Math.min(1, Math.max(0, ((ks * spec) / count + (1 - dark) * rim) * op))
      const o = (j * width + i) * 4
      let darkSum = 0
      for (let c = 0; c < 3; c++) {
        const intensity = Math.min(1, Math.max(0, (AMBIENT + (kd * diff[c]) / count) / (AMBIENT + kd)))
        const shade = 1 + (intensity * (1 - dark * Math.min(1, Math.max(0, rim))) - 1) * op
        img[o + c] = img[o + c] * shade
        darkSum += 1 - shade
      }
      const da = darkSum / 3
      img[o + 3] = da + img[o + 3] * (1 - da)
      if (ks > 0 || (fs > 0 && !dark)) { img[o] += add; img[o + 1] += add; img[o + 2] += add }
    }
  } else {
    const tex = A.MATCAP_TEXTURES.find((x) => x.id === s.matcapTextureId) ?? A.MATCAP_TEXTURES.find((x) => x.id === A.DEFAULT_MATCAP_ID)
    const m = await matcapImage(new URL(tex.url, base).href)
    const rot = (s.matcapRotationDeg * PI) / 180, cb = Math.cos(rot), sb = Math.sin(rot), op = s.matcapOpacity * s.lightingEffectsOpacity
    const D = m.d, mw = m.w, mh = m.h, relative = s.matcapLightRelativeToCamera !== false
    // The texture's bilinear, a channel at a time (texel / 255, as before).
    const tap = (o00, o10, o01, o11, c, tx, ty) => ((D[o00 + c] / 255) * (1 - tx) + (D[o10 + c] / 255) * tx) * (1 - ty) + ((D[o01 + c] / 255) * (1 - tx) + (D[o11 + c] / 255) * tx) * ty
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      normal(i, j, n)
      if (Number.isNaN(n[0])) continue
      const rx = n[0] * cb + n[1] * sb, ry = -n[0] * sb + n[1] * cb
      // Camera basis at bearing 0, pitch 0: right (1, 0, 0), up (0, -1, 0).
      const u = relative ? 0.5 - 0.5 * rx : rx * 0.5 + 0.5, v = relative ? 0.5 + 0.5 * ry : ry * 0.5 + 0.5
      const px = u * mw - 0.5, py = v * mh - 0.5, x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0
      const xa = Math.min(mw - 1, Math.max(0, x0)), xb = Math.min(mw - 1, Math.max(0, x0 + 1))
      const ya = Math.min(mh - 1, Math.max(0, y0)) * mw, yb = Math.min(mh - 1, Math.max(0, y0 + 1)) * mw
      const o00 = (ya + xa) * 4, o10 = (ya + xb) * 4, o01 = (yb + xa) * 4, o11 = (yb + xb) * 4
      over(img, (j * width + i) * 4, tap(o00, o10, o01, o11, 0, tx, ty) * op, tap(o00, o10, o01, o11, 1, tx, ty) * op, tap(o00, o10, o01, o11, 2, tx, ty) * op, op)
    }
  }
}

// ── Overlays: vector tiles and lines, drawn as SVG ────────────────────────

/** Source-over of an SVG (the picture's size) onto the premultiplied canvas. */
async function overSvg(img, width, height, svg) {
  if (!svg) return
  // unlimited: dense contours at a small scale make SVGs of many megabytes.
  const { data } = await sharp(Buffer.from(svg), { unlimited: true }).resize(width, height).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    const a = data[o + 3] / 255
    if (a > 0) over(img, o, (data[o] / 255) * a, (data[o + 1] / 255) * a, (data[o + 2] / 255) * a, a)
  }
}

const svgOf = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`
const attr = (v) => String(v).replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" })[c])
const pathOf = (rings) => rings.map((r) => "M" + r.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")).join("")

/** The features of a vector tile source over a rectangle: the tiles the map
 *  would load at this scale (512 px each, a vector source's size, at most
 *  `maxzoom`), fetched through the app's registry. Geometry in the
 *  picture's pixels. */
async function vectorFeatures(A, template, maxzoom, { world, x0, y0, width, height }, pad = 0) {
  const zv = Math.max(0, Math.min(maxzoom, Math.floor(Math.log2(world / 512) + 1e-9)))
  const n = 2 ** zv, tilePx = world / n
  const layers = {}
  const jobs = []
  for (let ty = Math.floor((y0 - pad) / tilePx); ty <= Math.floor((y0 + height + pad - 1) / tilePx); ty++) for (let tx = Math.floor((x0 - pad) / tilePx); tx <= Math.floor((x0 + width + pad - 1) / tilePx); tx++) {
    if (ty < 0 || ty >= n) continue
    const url = template.replace("{z}", zv).replace("{x}", ((tx % n) + n) % n).replace("{y}", ty)
    jobs.push((async () => {
      const r = await A.dispatchAppTile(url, undefined, "arrayBuffer")
      const bytes = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data)
      const vt = new VectorTile(new PbfReader(bytes))
      for (const [name, layer] of Object.entries(vt.layers)) {
        const k = tilePx / layer.extent, ox = tx * tilePx - x0, oy = ty * tilePx - y0
        const list = (layers[name] ??= [])
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i)
          // MapLibre reads a tile's geometry at an extent of 8192, rounded.
          const r = 8192 / layer.extent
          list.push({ type: f.type, properties: f.properties, tile: { ox, oy, unit: tilePx / 8192 }, rings: f.loadGeometry().map((ring) => ring.map((p) => [ox + Math.round(p.x * r) * (tilePx / 8192), oy + Math.round(p.y * r) * (tilePx / 8192)])) })
        }
      }
    })().catch((e) => { if (process.env.TV_DEBUG) console.error("vector tile", url.slice(0, 100), e.message) }))
  }
  await Promise.all(jobs)
  return { zv, mapZoom: Math.log2(world / 512), layers }
}

/** The iso-line (IsolineLayers.tsx): at a value, the isoband:// tiles of the
 *  measure (a fill and its boundary, cliff teeth on a slope); every
 *  interval, the contour engine over the measure's own tiles. */
/** The iso-line's sources (IsolineLayers.tsx): the measure's tiles, and at
 *  a value the isoband:// templates of the band and of the cliff edge;
 *  null when the measure cannot be computed here. */
function isolineSetup(A, dem, s, baseUrl) {
  const up = { template: dem.tiles, encoding: dem.encoding, tileSize: dem.tileSize, maxzoom: dem.maxzoom }
  const derived = {
    curvatureMode: s.curvatureMode, lrmRadius: s.lrmRadius, svfRadius: s.svfRadius, svfPrecision: s.svfPrecision,
    opennessRadius: s.opennessRadius, opennessMode: s.opennessMode, opennessPrecision: s.opennessPrecision,
    localDominanceMinRadius: s.localDominanceMinRadius, localDominanceMaxRadius: s.localDominanceMaxRadius,
  }
  const tex = A.MATCAP_TEXTURES.find((t) => t.id === s.matcapTextureId) ?? A.MATCAP_TEXTURES.find((t) => t.id === A.DEFAULT_MATCAP_ID)
  const lighting = {
    matcapUrl: new URL(tex.url, baseUrl).href, matcapRotationDeg: s.matcapRotationDeg,
    phongDiffuse: s.phongDiffuseStrength, phongSpecular: s.phongSpecularStrength,
    phongFresnelStrength: s.phongFresnelStrength, phongFresnelPower: s.phongFresnelPower, phongFresnelDark: s.theme !== "dark",
    lightDir: s.illuminationDir, lightAlt: s.illuminationAlt, exaggeration: s.exaggeration, shadowRadiusPx: s.shadowRadiusPx,
  }
  const m = A.isolineMeasure(s.isolineMeasure)
  const md = A.isolineMeasureDem(s.isolineMeasure, up, derived, lighting)
  if (!md) return null
  const scale = m.scale(derived)
  const maxzoom = Math.min(md.maxzoom ?? 19, 19)
  const smooth = Math.max(0, Math.min(16, Math.round(s.isolineSmooth) || 0))
  return {
    maxzoom, value: s.isolineMode === "value",
    measureDem: { tiles: md.template, encoding: md.encoding, tileSize: md.tileSize, maxzoom },
    step: Math.max(1e-6, s.isolineInterval * scale),
    band: A.buildIsobandProtocolUrl(md.template, md.encoding, md.tileSize, s.isolineValue * scale, { smooth }),
    cliff: s.isolineCliff && s.isolineMeasure === "slope"
      ? A.buildIsobandProtocolUrl(md.template, md.encoding, md.tileSize, s.isolineValue * scale, { smooth: Math.max(4, smooth), minLength: 40 }) : null,
  }
}

async function isolineSvg(A, dem, s, rect, baseUrl) {
  const iso = isolineSetup(A, dem, s, baseUrl)
  if (!iso) return ""
  const { maxzoom } = iso
  const color = s.isolineColor || "#ef4444", weight = s.isolineWeight
  const { width, height } = rect
  if (!iso.value) return contourSvg(iso.measureDem, { minor: iso.step, major: iso.step, weight, color, labels: false, theme: s.theme }, rect)
  const cliff = !!iso.cliff
  const band = await vectorFeatures(A, iso.band, maxzoom, rect)
  let body = ""
  if (s.isolineFill) body += `<path fill="${attr(color)}" fill-opacity="${s.isolineFillOpacity}" fill-rule="evenodd" d="${(band.layers.isoband ?? []).map((f) => pathOf(f.rings)).join("")}"/>`
  body += `<path fill="none" stroke="${attr(color)}" stroke-opacity="${cliff ? 0.35 : 0.9}" stroke-width="${weight}" stroke-linejoin="round" stroke-linecap="round" d="${(band.layers.isoline ?? []).map((f) => pathOf(f.rings)).join("")}"/>`
  if (cliff) {
    // The simplified edge, a tooth every 28 px hanging 8 px off it on the
    // steep side (the icon's offset [0, 8], rotated with the line).
    const edge = await vectorFeatures(A, iso.cliff, maxzoom, rect, 20)
    const lines = (edge.layers.isoline ?? []).flatMap((f) => f.rings)
    body += `<path fill="none" stroke="${attr(color)}" stroke-opacity="0.95" stroke-width="${weight + 0.5}" stroke-linejoin="round" stroke-linecap="round" d="${pathOf(lines)}"/>`
    // Where MapLibre puts them: per tile, along each line clipped to it,
    // the 18 px icon on a 28 px spacing (symbolAnchors).
    const overscaling = 2 ** Math.max(0, Math.floor(edge.mapZoom + 1e-9) - edge.zv)
    const teeth = []
    for (const f of edge.layers.isoline ?? []) {
      const { ox, oy, unit } = f.tile
      const inTile = f.rings.map((ring) => ring.map(([x, y]) => [Math.round((x - ox) / unit), Math.round((y - oy) / unit)]))
      for (const { x: ux, y: uy, angle } of symbolAnchors(inTile, { spacingPx: 28, shapedLength: 18, overscaling })) {
        const x = ox + ux * unit, y = oy + uy * unit, c = Math.cos(angle), sn = Math.sin(angle)
        const pt = ([u, v]) => `${(x + u * c - v * sn).toFixed(2)},${(y + u * sn + v * c).toFixed(2)}`
        teeth.push(`M${pt([-9, 1])}L${pt([9, 1])}L${pt([0, 15])}Z`)
      }
    }
    body += `<path fill="${attr(color)}" fill-opacity="0.9" d="${teeth.join("")}"/>`
  }
  return svgOf(width, height, body)
}

/** The building shadows (BuildingShadowLayer.tsx), the same flat-ground
 *  sweep as the map's GPU layer: OpenFreeMap's z14 building footprints
 *  (lib/building-tiles.ts), each wall swept away from the sun by
 *  min(render_height, 600 m) / tan(altitude), the roof outline at the tip,
 *  the union of the sweeps in black at the layer's opacity (overlaps never
 *  darken twice), the footprints cut back out (roofs stay lit). Nothing
 *  below map zoom 13, as in the map. */
const BUILDING_OWNER = {}
async function buildingShadowSvg(A, s, { world, x0, y0, width, height }) {
  if (Math.log2(world / 512) < 12.5) return ""
  const Z = A.BUILDING_TILE_ZOOM, n = 2 ** Z, C = 40075016.686
  const alt = Math.max(1, Number(s.illuminationAlt ?? 45)), az = Number(s.illuminationDir ?? 315)
  const kTan = 1 / Math.tan((alt * PI) / 180), away = ((az + 180) * PI) / 180
  // Away from the sun, per unit of sweep (Web Mercator, y down).
  const dir = [Math.sin(away) * kTan, -Math.cos(away) * kTan]
  const latC = Math.atan(Math.sinh(PI * (1 - (2 * (y0 + height / 2)) / world)))
  // The z14 tiles whose buildings can shade the rectangle: widened by the
  // longest shadow at this sun height (3 km at most, as the map).
  const reach = Math.min(3000, 600 * kTan) / (C * Math.cos(latC))
  const clamp = (v) => Math.min(n - 1, Math.max(0, v))
  const tx0 = clamp(Math.floor((x0 / world - reach) * n)), tx1 = clamp(Math.floor(((x0 + width) / world + reach) * n))
  const ty0 = clamp(Math.floor((y0 / world - reach) * n)), ty1 = clamp(Math.floor(((y0 + height) / world + reach) * n))
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) return ""
  const jobs = []
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push(A.requestBuildingTile(tx, ty, BUILDING_OWNER))
  const tiles = (await Promise.all(jobs)).filter(Boolean)
  // The tiles' clip lines (a z14 tile edge plus its buffer) are not walls.
  const onCut = (v) => { const u = v * n, d = Math.abs(u - Math.round(u)); return d < 1e-3 || Math.abs(d - A.BUILDING_TILE_BUFFER) < 1e-3 }
  const isClipEdge = (ax, ay, bx, by) => (ax === bx && onCut(ax)) || (ay === by && onCut(ay))
  const px = (x, y, sw = 0) => [(x + sw * dir[0]) * world - x0, (y + sw * dir[1]) * world - y0]
  const pt = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`
  let walls = "", tips = "", feet = ""
  const seen = new Set()
  for (const tile of tiles) for (const { rings, height: h } of tile) {
    // A building inside two tiles' buffers comes whole from both.
    const key = `${rings[0][0][0].toFixed(9)},${rings[0][0][1].toFixed(9)},${rings[0].length},${h}`
    if (seen.has(key)) continue
    seen.add(key)
    const cosLat = 1 / Math.cosh(PI * (1 - 2 * rings[0][0][1]))
    const sw = Math.min(600, h) / (C * cosLat)
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[i + 1]
        if ((ax === bx && ay === by) || isClipEdge(ax, ay, bx, by)) continue
        // One quad per wall, all wound the same way so nonzero filling unions them.
        let q = [px(ax, ay), px(bx, by), px(bx, by, sw), px(ax, ay, sw)]
        const area = q.reduce((a, [x, y], j) => { const [x2, y2] = q[(j + 1) % 4]; return a + x * y2 - x2 * y }, 0)
        if (area < 0) q = q.reverse()
        walls += `M${q.map(pt).join("L")}Z`
      }
    }
    tips += rings.map((r) => "M" + r.map(([x, y]) => pt(px(x, y, sw))).join("L") + "Z").join("")
    feet += rings.map((r) => "M" + r.map(([x, y]) => pt(px(x, y))).join("L") + "Z").join("")
  }
  if (!walls && !tips) return ""
  const opacity = (s.lightingEffectsOpacity ?? 1) * (s.buildingShadowOpacity ?? 0.5)
  return svgOf(width, height, `<defs><mask id="b" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><path fill="#fff" fill-rule="nonzero" d="${walls}"/><path fill="#fff" fill-rule="evenodd" d="${tips}"/><path fill="#000" fill-rule="evenodd" d="${feet}"/></mask></defs><rect width="${width}" height="${height}" fill="#000" fill-opacity="${opacity}" mask="url(#b)"/>`)
}

/** The graticule (GraticuleLayer.tsx, geogrid): meridians and parallels
 *  every `graticuleDensity` degrees, or the app's spacing for the zoom. Its
 *  labels sit on the edges of the screen, so a tile has none. */
function graticuleSvg(A, s, { world, x0, y0, width, height }) {
  const mapZoom = Math.log2(world / 512)
  const step = s.graticuleDensity || A.niceGraticuleDensity(mapZoom)
  const color = s.graticuleColor || (s.theme === "dark" ? "#fff" : "#000")
  const lngOf = (px) => (px / world) * 360 - 180
  const latOf = (py) => (Math.atan(Math.sinh(PI * (1 - (2 * py) / world))) * 180) / PI
  const xOf = (lng) => ((lng + 180) / 360) * world - x0
  const yOf = (lat) => ((1 - Math.asinh(Math.tan((lat * PI) / 180)) / PI) / 2) * world - y0
  let d = ""
  for (let lng = Math.ceil(lngOf(x0) / step) * step; lng <= lngOf(x0 + width); lng += step) d += `M${xOf(lng).toFixed(2)},0V${height}`
  for (let lat = Math.ceil(latOf(y0 + height) / step) * step; lat <= latOf(y0); lat += step) d += `M0,${yOf(lat).toFixed(2)}H${width}`
  return svgOf(width, height, `<path fill="none" stroke="${attr(color)}" stroke-width="${s.graticuleWidth ?? 1}" d="${d}"/>`)
}

const expressionOf = (value, prop) => normalizePropertyExpression(value, prop, styleSpec.paint_circle[prop])
const cssColor = (c) => `rgba(${Math.round((c.r / (c.a || 1)) * 255)},${Math.round((c.g / (c.a || 1)) * 255)},${Math.round((c.b / (c.a || 1)) * 255)},${c.a})`
const latOfView = ({ world, y0, height }) => (Math.atan(Math.sinh(PI * (1 - (2 * (y0 + height / 2)) / world))) * 180) / PI

/** The mound detector's markers (TellsSource, TellsMarkersLayer): the
 *  tells:// vector tiles on the terrain, a circle per candidate with the
 *  app's radius and colours. */
/** The mound detector's tells:// template (TellsSource), its tiles made up
 *  to TELLS_MAXZOOM and overzoomed past it. */
const TELLS_MAXZOOM = 15
function tellsTemplate(A, dem, s) {
  return A.buildTellsProtocolUrl(dem.tiles, dem.encoding, dem.tileSize, {
    tellSizeMeters: s.tellSize, radiusPx: s.tellRadius, minReliefMeters: s.tellMinRelief, blobnessMin: s.tellBlobnessMin,
    planMin: s.tellPlanMin, detHessianMin: s.tellDetHessianMin, measureScale: s.tellMeasureScale, vetoResolution: s.tellVetoResolution, polarity: s.tellsPolarity,
  })
}

async function tellsSvg(A, dem, s, rect) {
  const { mapZoom, layers } = await vectorFeatures(A, tellsTemplate(A, dem, s), TELLS_MAXZOOM, rect, 60)
  const colorBy = {
    byBlobness: A.computePropertyRampExpression(s.blobnessColorRamp, s.blobnessMin, s.blobnessMax, s.blobnessInvertColorRamp, "blobness"),
    byPlan: A.computePropertyRampExpression(s.curvatureColorRamp, s.curvatureMin, s.curvatureMax, !s.curvatureInvertColorRamp, "plan"),
    byDetHessian: A.computePropertyRampExpression(s.curvatureColorRamp, s.curvatureMin, s.curvatureMax, s.curvatureInvertColorRamp, "detHessian"),
    byLrm: A.computePropertyRampExpression(s.lrmColorRamp, s.lrmMin, s.lrmMax, s.lrmInvertColorRamp, "a"),
  }[s.tellsStyle]
  // tellsMeasuredScaleRadius uses the view's latitude (state.lat).
  const mPerPxZ0 = 156543.03392 * Math.cos((latOfView(rect) * PI) / 180), REF = 18
  const radiusM = ["*", ["coalesce", ["get", "scaleM"], 50], s.tellsScaleMultiplier / 2]
  const radius = s.tellMeasureScale && s.tellsScaleMarkers
    ? ["interpolate", ["exponential", 2], ["zoom"], 0, ["/", radiusM, mPerPxZ0], REF, ["/", radiusM, mPerPxZ0 / 2 ** REF]]
    : ["interpolate", ["linear"], ["zoom"], 10, 12, 16, 28]
  const outline = s.tellsStyle === "outline" || !colorBy
  const R = expressionOf(radius, "circle-radius")
  const fill = outline ? null : expressionOf(colorBy, "circle-color")
  const stroke = outline ? expressionOf(["case", ["==", ["coalesce", ["get", "pit"], 0], 1], s.tellsPitColor, s.tellsOutlineColor], "circle-stroke-color") : null
  const seen = new Set()
  const circles = []
  for (const f of layers.tells ?? []) {
    for (const [x, y] of f.rings.flat()) {
      // A point in a tile's buffer comes again in its neighbour.
      const key = `${Math.round(x * 4)},${Math.round(y * 4)}`
      if (seen.has(key)) continue
      seen.add(key)
      const g = { zoom: mapZoom }, feat = { properties: f.properties }
      // The stroke lies outside the radius: a 2 px ring from r to r + 2.
      circles.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(R.evaluate(g, feat) + 0.5).toFixed(2)}" fill="${outline ? "none" : cssColor(fill.evaluate(g, feat))}" stroke="${outline ? cssColor(stroke.evaluate(g, feat)) : "#000000"}" stroke-width="2"/>`)
    }
  }
  return svgOf(rect.width, rect.height, circles.join(""))
}

// ── Vector tiles (/tiles/{z}/{x}/{y}.pbf) ────────────────────────────────────────────────

/** The modes served in .pbf tiles, as layers: contours (`contours`: ele, level),
 *  the iso-line (`isoband` polygons and `isoline` lines at a value, with
 *  `isoline-cliff` for the cliff edge; `isoline` lines every interval),
 *  the mound detector (`tells` points with their measures), the plane
 *  slicer (`plane-slicer`: the polygons at or above its value, on the
 *  terrain or its local relief model; the map fills the side
 *  planeSlicerSide names) and the graticule (`graticule` lines: kind
 *  meridian or parallel, deg). */
export const VECTOR_MODES = ["contours", "isoline", "moundDetector", "planeSlicer", "graticules"]

/** One vector tile (MVT bytes) of the modes asked for, at z/x/y of 512 px
 *  tiles as the map loads them: the same features its layers draw. */
export async function vectorTile({ dem, state: s }, modes, z, x, y, baseUrl = DEFAULT_BASE_URL) {
  const A = await app()
  const out = []
  // A tile of a source, from its deepest zoom past it.
  const mvt = async (template, maxzoom) => {
    const dz = Math.max(0, z - maxzoom)
    const url = template.replace("{z}", z - dz).replace("{x}", x >> dz).replace("{y}", y >> dz)
    const r = await A.dispatchAppTile(url, undefined, "arrayBuffer")
    return overzoom(readLayers(r.data), dz, x, y)
  }
  const contours = async (src, minor, major) => {
    const dz = Math.max(0, z - contourMaxzoom(src))
    return overzoom(readLayers(await contourVectorTile(src, { minor, major }, z - dz, x >> dz, y >> dz)), dz, x, y)
  }
  const named = (layers, names) => layers.filter((l) => names[l.name]).map((l) => ({ ...l, name: names[l.name] }))
  const jobs = []
  if (modes.includes("contours")) jobs.push(contourSource(dem, s).then((c) => contours(c.dem, c.minor, c.major)).then((l) => named(l, { contours: "contours" })))
  if (modes.includes("isoline")) {
    const iso = isolineSetup(A, dem, s, baseUrl)
    if (iso && !iso.value) jobs.push(contours(iso.measureDem, iso.step, iso.step).then((l) => named(l, { contours: "isoline" })))
    if (iso?.value) jobs.push(mvt(iso.band, iso.maxzoom).then((l) => named(l, { isoband: "isoband", isoline: "isoline" })))
    if (iso?.cliff) jobs.push(mvt(iso.cliff, iso.maxzoom).then((l) => named(l, { isoline: "isoline-cliff" })))
  }
  if (modes.includes("moundDetector")) jobs.push(mvt(tellsTemplate(A, dem, s), TELLS_MAXZOOM).then((l) => named(l, { tells: "tells" })))
  if (modes.includes("planeSlicer")) {
    const lrm = s.planeSlicerReferenceMode === "lrm"
    const t = lrm ? A.buildLrmProtocolUrl(dem.tiles, dem.encoding, dem.tileSize, s.lrmRadius) : dem.tiles
    const value = lrm ? s.planeSlicerValueLrm : s.planeSlicerValue
    jobs.push(mvt(A.buildIsobandProtocolUrl(t, lrm ? "terrarium" : dem.encoding, dem.tileSize, value), Math.min(dem.maxzoom ?? 19, 19))
      .then((l) => named(l, { isoband: "plane-slicer" }).map((layer) => ({ ...layer, features: layer.features.map((f) => ({ ...f, properties: { ...f.properties, value, side: s.planeSlicerSide ?? "below" } })) }))))
  }
  if (modes.includes("graticules")) out.push(graticuleLayer(A, s, z, x, y))
  for (const layers of await Promise.all(jobs)) out.push(...layers)
  return writeTile(out)
}

/** The graticule's lines over one tile, as a layer (extent 4096, 64 units
 *  of buffer). */
function graticuleLayer(A, s, z, x, y) {
  const E = 4096, B = 64, world = E * 2 ** z, x0 = x * E, y0 = y * E
  const step = s.graticuleDensity || A.niceGraticuleDensity(z)
  const lngOf = (px) => (px / world) * 360 - 180
  const latOf = (py) => (Math.atan(Math.sinh(PI * (1 - (2 * py) / world))) * 180) / PI
  const features = []
  for (let lng = Math.ceil(lngOf(x0 - B) / step) * step; lng <= lngOf(x0 + E + B); lng += step) {
    const px = ((lng + 180) / 360) * world - x0
    features.push({ type: 2, properties: { kind: "meridian", deg: +lng.toFixed(10) }, geometry: [[[px, -B], [px, E + B]]] })
  }
  for (let lat = Math.ceil(latOf(y0 + E + B) / step) * step; lat <= latOf(y0 - B); lat += step) {
    const py = ((1 - Math.asinh(Math.tan((lat * PI) / 180)) / PI) / 2) * world - y0
    features.push({ type: 2, properties: { kind: "parallel", deg: +lat.toFixed(10) }, geometry: [[[-B, py], [E + B, py]]] })
  }
  return { name: "graticule", extent: E, features }
}

/** A flat, unrotated viewport (MapLibre's zoom, 512 px tiles), with the
 *  source credited bottom right. */
export function drawViewport(how, { lat, lng, zoom = 12, width, height, format = "jpg", baseUrl }) {
  const world = 512 * 2 ** zoom
  const cx = ((lng + 180) / 360) * world, cy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * world
  const credit = `Terrain Viewer · ${how.dem.name ?? new URL(how.dem.tiles.replace(/[{}]/g, "")).hostname}`
  return draw(how, { world, x0: Math.round(cx - width / 2), y0: Math.round(cy - height / 2), width, height, format, baseUrl, credit })
}

/** Whether a view can be a direct viewport: flat, unrotated, single. */
export const flatView = (v) => (!v.viewMode || v.viewMode === "2d") && !v.pitch && !v.bearing && (!v.split || v.split === "off") && !v.terrainSourceB
