// Per-view visualization modes. By default every view in a split or grid
// layout draws the same modes ("sync", `vizSync`). With sync off, each mode
// and submode is drawn only on the views listed for it in `vizViews`, a
// compact URL string like "showSlope:AC;showLrm:B". A key that is not
// listed is drawn on every view; a key listed with no views is off there
// (the mode's own switch then reads as off). The sidebar replaces each
// mode's checkbox with the view-grid toggle (SourceGridToggle) while sync is
// off and a split layout is on. Tells stay on view A (their inspect popup,
// frozen snapshot and export are built around the primary map).
import { activeViews, type GridLayoutId, type ViewId } from "./grid-layouts"

export type VizViews = Record<string, ViewId[]>

/** A submode's group switch: turning slope on for a view also needs the
 *  Terrain Analysis group on that view, or nothing shows there. */
export const VIZ_GROUP_OF: Record<string, string> = {
  showSlope: "showTerrainAnalysis", showAspect: "showTerrainAnalysis", showTri: "showTerrainAnalysis", showCurvature: "showTerrainAnalysis",
  showTpi: "showTerrainAnalysis", showRoughness: "showTerrainAnalysis", showShapeIndex: "showTerrainAnalysis", showBlobness: "showTerrainAnalysis",
  showEigenRatio: "showTerrainAnalysis", showOrientation: "showTerrainAnalysis",
  showLrm: "showReliefVisualization", showSvf: "showReliefVisualization", showOpenness: "showReliefVisualization", showLocalDominance: "showReliefVisualization",
  showPhong: "showLightingEffects", showMatcap: "showLightingEffects", showShadows: "showLightingEffects",
}

/** Short names for the pill under each view. Groups are not listed: their
 *  submodes are. */
export const VIZ_MODE_LABELS: Record<string, string> = {
  showHillshade: "Hillshade", showColorRelief: "Hypso", showRasterBasemap: "Basemap", showContoursAndGraticules: "Contours", backgroundLayerActive: "Background",
  showSlope: "Slope", showAspect: "Aspect", showTri: "TRI", showCurvature: "Curvature", showTpi: "TPI", showRoughness: "Roughness",
  showShapeIndex: "Shape index", showBlobness: "Blobness", showEigenRatio: "Eigen ratio", showOrientation: "Orientation",
  showLrm: "LRM", showSvf: "SVF", showOpenness: "Openness", showLocalDominance: "Local dominance",
  showPhong: "Phong", showMatcap: "Matcap", showShadows: "Shadows",
}

/** The modes `side` draws that some other active view does not. */
export function distinctModeLabels(state: Record<string, any>, side: ViewId, views: ViewId[]): string[] {
  const v = parseVizViews(state.vizViews || "")
  const drawn = (key: string, s: ViewId) => {
    if (!state[key]) return false
    const group = VIZ_GROUP_OF[key]
    if (group && !(state[group] && viewDrawsMode(v, group, s))) return false
    return viewDrawsMode(v, key, s)
  }
  return Object.entries(VIZ_MODE_LABELS)
    .filter(([key]) => drawn(key, side) && views.some((s) => s !== side && !drawn(key, s)))
    .map(([, label]) => label)
}

export function parseVizViews(s: string): VizViews {
  const out: VizViews = {}
  if (!s) return out
  for (const part of s.split(";")) {
    const [key, views = ""] = part.split(":")
    if (!key) continue
    out[key] = views.split("").filter((c): c is ViewId => /^[A-H]$/.test(c))
  }
  return out
}

export function serializeVizViews(v: VizViews): string {
  return Object.entries(v).map(([k, views]) => `${k}:${views.join("")}`).join(";")
}

/** Whether `side` draws the mode `key`: unlisted means everywhere. */
export function viewDrawsMode(v: VizViews, key: string, side: ViewId): boolean {
  const views = v[key]
  return views == null || views.includes(side)
}

/** The mode is on AND drawn by at least one view of the current grid: the
 *  gate for a sub-mode's options, so a mode kept on a view outside a smaller
 *  grid (matcap on D in a 2x1) does not open its options. */
export function modeOnVisibleView(state: Record<string, any>, key: string): boolean {
  if (!state[key]) return false
  if (state.splitStyle === "off" || state.vizSync !== false) return true
  const v = parseVizViews(state.vizViews || "")
  return activeViews(effectiveGridLayout(state)).some((s) => viewDrawsMode(v, key, s))
}

/** The effective grid in the panel: overlay split is two views side by side. */
export function effectiveGridLayout(state: { splitStyle?: string; gridLayout?: GridLayoutId }): GridLayoutId {
  return state.splitStyle === "overlay" ? "2x1" : (state.gridLayout ?? "2x1")
}

/** What a view-grid cell click does for one mode: toggles that view in the
 *  mode's list. The mode's own switch follows: on when any view is listed,
 *  off when none. Unlisted (everywhere) starts from the active views. */
export function toggleModeView(state: Record<string, any>, key: string, side: ViewId): Record<string, any> {
  const v = parseVizViews(state.vizViews || "")
  const all = activeViews(effectiveGridLayout(state))
  const current: ViewId[] = state[key] ? (v[key] ?? all) : []
  const turningOn = !current.includes(side)
  const next = turningOn ? [...current, side] : current.filter((s) => s !== side)
  const patch: Record<string, any> = {}
  if (next.length === 0) { delete v[key]; patch[key] = false }
  else if (all.every((s) => next.includes(s))) { delete v[key]; patch[key] = true }
  else { v[key] = all.filter((s) => next.includes(s)); patch[key] = true }
  // A submode switched on for a view brings its group along on that view.
  const group = VIZ_GROUP_OF[key]
  if (turningOn && group) {
    const gViews: ViewId[] = state[group] ? (v[group] ?? all) : []
    if (!gViews.includes(side)) {
      const g = [...gViews, side]
      if (all.every((s) => g.includes(s))) delete v[group]; else v[group] = all.filter((s) => g.includes(s))
      patch[group] = true
    }
  }
  patch.vizViews = serializeVizViews(v)
  return patch
}

/** The label click: the mode on every view (the group too, for a submode);
 *  when it already is on every active view, off everywhere instead. */
export function modeOnAllViews(state: Record<string, any>, key: string): Record<string, any> {
  const v = parseVizViews(state.vizViews || "")
  const all = activeViews(effectiveGridLayout(state))
  const everywhere = !!state[key] && all.every((s) => viewDrawsMode(v, key, s))
  delete v[key]
  if (everywhere) return { [key]: false, vizViews: serializeVizViews(v) }
  const patch: Record<string, any> = { [key]: true }
  const group = VIZ_GROUP_OF[key]
  if (group) { delete v[group]; patch[group] = true }
  patch.vizViews = serializeVizViews(v)
  return patch
}

/** Builds the `perView` prop for CheckboxWithSlider rows, or undefined when
 *  checkboxes should stay (sync on, or no split). */
export function perViewProps(state: Record<string, any>, setState: (u: Record<string, any>) => void) {
  const split = state.splitStyle && state.splitStyle !== "off"
  if (state.vizSync !== false || !split) return (_key: string) => undefined
  const v = parseVizViews(state.vizViews || "")
  const gridLayout = effectiveGridLayout(state)
  return (key: string) => ({
    gridLayout,
    isActive: (side: ViewId) => !!state[key] && viewDrawsMode(v, key, side),
    onSelect: (side: ViewId) => setState(toggleModeView(state, key, side)),
    onAll: () => setState(modeOnAllViews(state, key)),
  })
}
