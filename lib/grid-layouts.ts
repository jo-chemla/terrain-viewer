// Shared N-map grid infrastructure — generalizes what used to be a hardcoded
// map-A/map-B pair (see git history of TerrainViewer.tsx pre this file) into
// up to 6 simultaneous views (A-F), arranged in one of a handful of fixed
// row/column layouts. Per-view state fields (sourceX/basemapSourceX/dateX/
// historicalActiveSourceX/timelineSourcesX) still live in TerrainViewer.tsx's
// QUERY_STATE_PARSERS — this module only defines the *shape* (which letters
// are active for a given layout, in which row) and the naming/lookup rules
// every consumer (TerrainViewer, historical-timeline-panel, the per-section
// source pickers) needs to stay in sync on.
export type ViewId = "A" | "B" | "C" | "D" | "E" | "F"
export const VIEW_IDS: ViewId[] = ["A", "B", "C", "D", "E", "F"]

export type GridLayoutId = "2x1" | "3x1" | "4x1" | "2x2" | "3x2"
export const GRID_LAYOUT_IDS: GridLayoutId[] = ["2x1", "3x1", "4x1", "2x2", "3x2"]

// "off": single map, no comparison UI at all. "side-by-side": a flex/grid of
// independent panes (the only style compatible with every GridLayoutId
// above). "overlay": both maps full-bleed-stacked in the same viewport, pane
// B clip-path-cropped + blended over pane A — only ever compares exactly 2
// views, so it always behaves as "2x1" regardless of the user's own
// gridLayout pick (see TerrainViewer.tsx's effectiveGridLayout).
export type SplitStyle = "off" | "overlay" | "side-by-side"
export const SPLIT_STYLES: SplitStyle[] = ["off", "overlay", "side-by-side"]

// Curated CSS mix-blend-mode keywords relevant to imagery A/B comparison —
// "plus-lighter" is the real CSS keyword for additive blending (there's no
// literal "addition" value). Labels are the Comparison and Mix section's
// own Select options; the bare keyword list is what TerrainViewer.tsx's
// nuqs parser validates against.
export const BLEND_MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "difference", label: "Difference" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "overlay", label: "Overlay" },
  { value: "exclusion", label: "Exclusion" },
  { value: "plus-lighter", label: "Addition" },
] as const
export const BLEND_MODES = BLEND_MODE_OPTIONS.map((o) => o.value)

export interface GridLayoutConfig {
  id: GridLayoutId
  cols: number
  rows: number
  /** Row-major: one ViewId[] per row, each exactly `cols` long. */
  grid: ViewId[][]
}

// Naming is "ColsxRows" throughout (matches the user-facing labels): "3x2" is
// 3 columns, 2 rows, 6 views. Letters are assigned row-major (top-left to
// bottom-right) — view "A" is always the top-left pane, matching today's
// existing 2x1 convention where A is the left (primary) map.
export const GRID_LAYOUTS: Record<GridLayoutId, GridLayoutConfig> = {
  "2x1": { id: "2x1", cols: 2, rows: 1, grid: [["A", "B"]] },
  "3x1": { id: "3x1", cols: 3, rows: 1, grid: [["A", "B", "C"]] },
  "4x1": { id: "4x1", cols: 4, rows: 1, grid: [["A", "B", "C", "D"]] },
  "2x2": { id: "2x2", cols: 2, rows: 2, grid: [["A", "B"], ["C", "D"]] },
  "3x2": { id: "3x2", cols: 3, rows: 2, grid: [["A", "B", "C"], ["D", "E", "F"]] },
}

export const GRID_LAYOUT_LABELS: Record<GridLayoutId, string> = {
  "2x1": "2×1", "3x1": "3×1", "4x1": "4×1", "2x2": "2×2", "3x2": "3×2",
}

/** Row-major flattened list of every view active in a layout, e.g. "3x2" -> [A,B,C,D,E,F]. */
export function activeViews(layout: GridLayoutId): ViewId[] {
  return GRID_LAYOUTS[layout].grid.flat()
}

/** The single primary/top-left view — the one every "only-render-once" control
 *  (Geocoder, Nav/Geolocate, Contours/Graticules, BackgroundLayer, Tells,
 *  Minimap, max-bounds/zoom-range resolution) keys off, same as today's "A". */
export function primaryView(layout: GridLayoutId): ViewId {
  return GRID_LAYOUTS[layout].grid[0][0]
}

/** The bottom-right-most view — where Scale/Attribution mount (the one
 *  corner of the whole grid that's always visually bottom-right, same spot
 *  today's 2-map "whichever pane is rightmost" resolved to). */
export function bottomRightView(layout: GridLayoutId): ViewId {
  const { grid } = GRID_LAYOUTS[layout]
  const lastRow = grid[grid.length - 1]
  return lastRow[lastRow.length - 1]
}

/** The rightmost view in EVERY row — each needs the sidebar-footprint camera
 *  padding correction (map.easeTo({padding})) since the floating sidebar
 *  overlaps the right edge of the viewport across the full height, not just
 *  the bottom row. */
export function rightmostViewsPerRow(layout: GridLayoutId): ViewId[] {
  return GRID_LAYOUTS[layout].grid.map((row) => row[row.length - 1])
}

type PerViewBase = "basemapSource" | "date" | "historicalActiveSource" | "timelineSources"

/** Field-name lookup for the basemap/date/historical-source/timeline-sources
 *  quartet — these have a genuine *shared* (unsuffixed) variant, gated by
 *  `basemapPerView`, that only ever applies to view A (exactly today's
 *  existing `basemapPerView ? state.dateA : state.date`-style ternaries,
 *  centralized here instead of re-derived at each call site). Every other
 *  view (B-F) always uses its own suffixed field, since it can only be
 *  active at all when basemapPerView is already true.
 */
export function viewFieldName(side: ViewId, base: PerViewBase, basemapPerView: boolean): string {
  if (side === "A") return basemapPerView ? `${base}A` : base
  return `${base}${side}`
}

/** Terrain source has no shared/unsuffixed variant at all (unlike basemap) —
 *  every view, including A, always reads its own sourceX field. */
export function sourceFieldName(side: ViewId): string {
  return `source${side}`
}

// Default per-side colors — used by the historical timeline panel's
// draggable handles/pills AND (once colorizeMapBordersAtom is on) each map
// pane's border, so both stay visually consistent. User-overridable via
// lib/layout-constants.ts's sideColorOverridesAtom.
export const SIDE_COLORS: Record<ViewId, string> = {
  A: "#3b82f6", // blue
  B: "#22c55e", // green
  C: "#f59e0b", // amber
  D: "#ef4444", // red
  E: "#a855f7", // purple
  F: "#06b6d4", // cyan
}
