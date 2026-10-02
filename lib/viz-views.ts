// Per-view visualization modes. By default every view in a split or grid
// layout draws the same modes ("sync", `vizSync`). With sync off, each mode
// and submode is drawn only on the views listed for it in `vizViews`, a
// compact URL string like "showSlope:AC;showLrm:B". A key that is not
// listed is drawn on every view; a key listed with no views is off there
// (the mode's own switch then reads as off). The sidebar replaces each
// mode's checkbox with the view-grid toggle (SourceGridToggle) while sync is
// off and a split layout is on. Tells, contours and graticules stay on view
// A: they are primary-only layers.
import { activeViews, type GridLayoutId, type ViewId } from "./grid-layouts"

export type VizViews = Record<string, ViewId[]>

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
  const next = current.includes(side) ? current.filter((s) => s !== side) : [...current, side]
  if (next.length === 0) { delete v[key]; return { vizViews: serializeVizViews(v), [key]: false } }
  if (all.every((s) => next.includes(s))) { delete v[key]; return { vizViews: serializeVizViews(v), [key]: true } }
  v[key] = all.filter((s) => next.includes(s))
  return { vizViews: serializeVizViews(v), [key]: true }
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
  })
}
