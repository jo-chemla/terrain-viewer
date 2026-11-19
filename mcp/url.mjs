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
  lrm: { showReliefVisualization: true, showLrm: true },
  svf: { showReliefVisualization: true, showSvf: true },
  openness: { showReliefVisualization: true, showOpenness: true },
  localDominance: { showReliefVisualization: true, showLocalDominance: true },
  phong: { showLightingEffects: true, showPhong: true },
  matcap: { showLightingEffects: true, showMatcap: true },
  shadows: { showLightingEffects: true, showShadows: true },
  basemap: { showRasterBasemap: true },
  moundDetector: { showTellsDetector: true },
}
export const MODE_NAMES = Object.keys(MODES)

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

  if (view.terrainSource) p.set("terrainSourceA", view.terrainSource)
  if (view.split && view.split !== "off") p.set("splitStyle", view.split)
  if (view.terrainSourceB) {
    p.set("terrainSourceB", view.terrainSourceB)
    if (!view.split) p.set("splitStyle", "side-by-side")
  }
  if (view.place) p.set("place", view.place)
  for (const [k, v] of Object.entries(view.params ?? {})) p.set(k, String(v))
  if (opts.embed) p.set("sidebarCollapsed", "true")

  // URLSearchParams writes a space as "+": the app's parser reads both, but
  // "%20" survives being pasted into more places.
  return `${base}${base.includes("?") ? "&" : "?"}${p.toString().replace(/\+/g, "%20")}`
}
