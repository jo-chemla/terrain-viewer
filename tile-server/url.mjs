// Builds a Terrain Viewer link from a small, typed description of a view.
// Every setting of the app lives in the URL (see skills/terrain-viewer/SKILL.md,
// the same rules written for a model to follow by hand).

export const DEFAULT_BASE_URL = "https://terrain-viewer.iconem.com/"

/** Mode name -> the URL parameters that switch it on (its group switch included). */
export const MODES = {
  hillshade: { showHillshade: true },
  colorRelief: { showColorRelief: true },
  contours: { showContoursAndGraticules: true, showContours: true },
  slope: { showTerrainAnalysis: true, showSlope: true },
  aspect: { showTerrainAnalysis: true, showAspect: true },
  curvature: { showTerrainAnalysis: true, showCurvature: true },
  tpi: { showTerrainAnalysis: true, showTpi: true },
  roughness: { showTerrainAnalysis: true, showRoughness: true },
  tri: { showTerrainAnalysis: true, showTri: true },
  shapeIndex: { showTerrainAnalysis: true, showShapeIndex: true },
  blobness: { showTerrainAnalysis: true, showBlobness: true },
  eigenRatio: { showTerrainAnalysis: true, showEigenRatio: true },
  orientation: { showTerrainAnalysis: true, showOrientation: true },
  lrm: { showReliefVisualization: true, showLrm: true },
  svf: { showReliefVisualization: true, showSvf: true },
  openness: { showReliefVisualization: true, showOpenness: true },
  localDominance: { showReliefVisualization: true, showLocalDominance: true },
  phong: { showLightingEffects: true, showPhong: true },
  matcap: { showLightingEffects: true, showMatcap: true },
  shadows: { showLightingEffects: true, showShadows: true },
  basemap: { showRasterBasemap: true },
  moundDetector: { showTellsDetector: true },
  isoline: { showContoursAndGraticules: true, showIsoline: true },
  graticules: { showContoursAndGraticules: true, showGraticules: true },
  planeSlicer: { showPlaneSlicer: true },
}
export const MODE_NAMES = Object.keys(MODES)
export const IMAGERY_SOURCES = ["wayback", "ge-historical", "bing", "hls", "eox-s2"]

const round = (n, d) => Number(Number(n).toFixed(d))

/**
 * @param {object} view
 * @param {number} view.lat
 * @param {number} view.lng
 * @param {number} [view.zoom]
 * @param {"2d"|"3d"|"globe"} [view.viewMode]
 * @param {number} [view.pitch]
 * @param {number} [view.bearing]
 * @param {string[]} [view.modes] names from MODES; hillshade is on unless `modes` is given without it
 * @param {string} [view.terrainSource] a library id or a tile/COG URL
 * @param {string} [view.terrainSourceB] second source, shown with `split`
 * @param {"off"|"side-by-side"|"overlay"} [view.split]
 * @param {string} [view.imageryUrl] imagery under the terrain: XYZ tiles ({z}/{x}/{y}) or a COG
 * @param {string} [view.imagerySource] dated imagery built into the app (IMAGERY_SOURCES), with `imageryDate` (YYYY-MM-DD)
 * @param {string} [view.imagerySourceB] the same for a second view, with `imageryDateB`
 * @param {string} [view.place] label shown in the geocoder box
 * @param {Record<string,string|number|boolean>} [view.params] any other URL parameter, as is
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]
 * @param {boolean} [opts.embed] hide the sidebar, for an iframe
 */
export function buildViewUrl(view, opts = {}) {
  const base = opts.baseUrl || DEFAULT_BASE_URL
  const p = new URLSearchParams()
  const viewMode = view.viewMode || "2d"
  p.set("viewMode", viewMode)
  // A tilted camera close to the ground ends under the terrain while tiles
  // load: the skill caps 3D links at zoom 13.
  let zoom = view.zoom ?? 12
  if (viewMode === "3d" && zoom > 13) zoom = 13
  p.set("zoom", String(round(zoom, 2)))
  p.set("lat", String(round(view.lat, 5)))
  p.set("lng", String(round(view.lng, 5)))
  if (viewMode === "3d") p.set("pitch", String(round(view.pitch ?? 55, 1)))
  else if (view.pitch != null) p.set("pitch", String(round(view.pitch, 1)))
  if (view.bearing != null) p.set("bearing", String(round(view.bearing, 1)))

  const modes = view.modes ?? []
  const unknown = modes.filter((m) => !(m in MODES))
  if (unknown.length) throw new Error(`Unknown mode(s): ${unknown.join(", ")}. Known: ${MODE_NAMES.join(", ")}`)
  // Hillshade is on by default in the app: only say so when it is switched off.
  if (view.modes && !modes.includes("hillshade")) p.set("showHillshade", "false")
  for (const m of modes) {
    if (m === "hillshade") continue
    for (const [k, v] of Object.entries(MODES[m])) p.set(k, String(v))
  }
  // One mode of each group is on by default in the app (slope, the local
  // relief model, Phong, the contours): switching a group on for another
  // mode would show that one too.
  for (const [group, mode, flag] of [["showTerrainAnalysis", "slope", "showSlope"], ["showReliefVisualization", "lrm", "showLrm"], ["showLightingEffects", "phong", "showPhong"], ["showContoursAndGraticules", "contours", "showContours"]]) {
    if (p.get(group) === "true" && !modes.includes(mode)) p.set(flag, "false")
  }

  if (view.terrainSource) p.set("terrainSourceA", view.terrainSource)
  if (view.split && view.split !== "off") p.set("splitStyle", view.split)
  if (view.terrainSourceB) {
    p.set("terrainSourceB", view.terrainSourceB)
    if (!view.split) p.set("splitStyle", "side-by-side")
  }
  if (view.imageryUrl) { p.set("basemapSource", view.imageryUrl); p.set("showRasterBasemap", "true") }
  // Dated imagery built into the app (Esri Wayback, Google Earth historical,
  // Bing, HLS, EOX Sentinel-2), per view. With no terrain mode asked for, the
  // app opens in its historical mode (imagery and timeline, no shading).
  const dated = (side, source, date) => {
    if (!source) return
    if (!IMAGERY_SOURCES.includes(source)) throw new Error(`Unknown imagerySource "${source}". Known: ${IMAGERY_SOURCES.join(", ")}`)
    p.set(`basemapSource${side}`, "historical")
    p.set(`historicalActiveSource${side}`, source)
    if (date) {
      const ms = typeof date === "number" ? date : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date)
      if (!Number.isFinite(ms)) throw new Error(`imageryDate "${date}" is not a date (YYYY-MM-DD).`)
      p.set(`date${side}`, String(ms))
    }
    p.set("showRasterBasemap", "true")
    if (!view.modes?.length) p.set("appMode", "historical")
  }
  dated("A", view.imagerySource, view.imageryDate)
  if (view.imagerySourceB) {
    dated("B", view.imagerySourceB, view.imageryDateB)
    if (!view.split) p.set("splitStyle", "side-by-side")
  }
  if (view.place) p.set("place", view.place)
  for (const [k, v] of Object.entries(view.params ?? {})) p.set(k, String(v))
  if (opts.embed) p.set("sidebarCollapsed", "true")

  // URLSearchParams writes a space as "+": the app's parser reads both, but
  // "%20" survives being pasted into more places.
  return `${base}${base.includes("?") ? "&" : "?"}${p.toString().replace(/\+/g, "%20")}`
}

// A view as query parameters and back: what the tile service takes
// (server.mjs) and what the MCP server sends it.
const VIEW_NUMBERS = ["lat", "lng", "zoom", "pitch", "bearing"]
const VIEW_STRINGS = ["viewMode", "split", "terrainSource", "terrainSourceB", "imageryUrl", "imagerySource", "imageryDate", "imagerySourceB", "imageryDateB", "place"]

/** @returns {URLSearchParams} */
export function viewToQuery(view) {
  const q = new URLSearchParams()
  for (const k of [...VIEW_NUMBERS, ...VIEW_STRINGS]) if (view[k] != null) q.set(k, String(view[k]))
  if (view.modes) q.set("modes", view.modes.join(","))
  for (const [k, v] of Object.entries(view.params ?? {})) q.set(k, String(v))
  return q
}

/** The view a query describes; every parameter that is not a view field is
 *  left in `rest`, for the app as it is. */
export function queryToView(query) {
  const rest = new URLSearchParams(query)
  const take = (k) => { const v = rest.get(k); rest.delete(k); return v ?? undefined }
  const view = {}
  for (const k of VIEW_NUMBERS) {
    const v = take(k)
    if (v === undefined || v === "") continue
    if (!Number.isFinite(Number(v))) throw Object.assign(new Error(`${k} is not a number`), { status: 400 })
    view[k] = Number(v)
  }
  for (const k of VIEW_STRINGS) { const v = take(k); if (v !== undefined) view[k] = v }
  const modes = take("modes")
  if (modes !== undefined) view.modes = modes.split(",").map((s) => s.trim()).filter(Boolean)
  return { view, rest, take }
}
