// Shared N-map grid infrastructure — generalizes what used to be a hardcoded
// map-A/map-B pair (see git history of TerrainViewer.tsx pre this file) into
// up to 8 simultaneous views (A-H), arranged in one of a handful of fixed
// row/column layouts. Per-view state fields (sourceX/basemapSourceX/dateX/
// historicalActiveSourceX/timelineSourcesX) still live in TerrainViewer.tsx's
// QUERY_STATE_PARSERS — this module only defines the *shape* (which letters
// are active for a given layout, in which row) and the naming/lookup rules
// every consumer (TerrainViewer, historical-timeline-panel, the per-section
// source pickers) needs to stay in sync on.
export type ViewId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"
export const VIEW_IDS: ViewId[] = ["A", "B", "C", "D", "E", "F", "G", "H"]

// Ordered single-row layouts first, then two-row — matches
// comparison-mix-section.tsx's GridLayoutPicker, whose own row 0/row 1 button
// cells are exactly this grouping.
export type GridLayoutId = "2x1" | "3x1" | "4x1" | "1x2" | "2x2" | "3x2" | "4x2"
export const GRID_LAYOUT_IDS: GridLayoutId[] = ["2x1", "3x1", "4x1", "1x2", "2x2", "3x2", "4x2"]

// "off": single map, no comparison UI at all. "side-by-side": a flex/grid of
// independent panes (the only style compatible with every GridLayoutId
// above). "overlay": both maps full-bleed-stacked in the same viewport, pane
// B clip-path-cropped + blended over pane A — only ever compares exactly 2
// views, so it always behaves as "2x1" regardless of the user's own
// gridLayout pick (see TerrainViewer.tsx's effectiveGridLayout).
export type SplitStyle = "off" | "overlay" | "side-by-side"
export const SPLIT_STYLES: SplitStyle[] = ["off", "overlay", "side-by-side"]

// Every CSS `mix-blend-mode` keyword (developer.mozilla.org/docs/Web/CSS/
// mix-blend-mode), split into the classic Photoshop-style separable modes
// ("Standard") most imagery A/B comparisons actually reach for, and the
// less commonly useful non-separable HSL modes + compositing operators
// ("Extra") — grouped instead of one long list, see the Select render in
// comparison-mix-section.tsx. "plus-darker" mirrors the reference app this
// feature was ported from (Iconem's historical-satellite viewer's own
// BlendingControl) even though it isn't part of the standardized CSS
// Compositing spec (only "plus-lighter" is) — an unsupported keyword just
// falls back to "normal" (mix-blend-mode degrades silently on an unknown
// value), so keeping it costs nothing and matches that reference exactly.
// The bare keyword list (BLEND_MODES) is what TerrainViewer.tsx's nuqs
// parser validates splitBlendMode against — order there doesn't matter,
// only BLEND_MODE_GROUPS' own order affects the Select's display order.
const BLEND_MODE_LABELS: Record<string, string> = {
  normal: "Normal", multiply: "Multiply", screen: "Screen", overlay: "Overlay",
  darken: "Darken", lighten: "Lighten", "color-dodge": "Color Dodge", "color-burn": "Color Burn",
  "hard-light": "Hard Light", "soft-light": "Soft Light", difference: "Difference", exclusion: "Exclusion",
  hue: "Hue", saturation: "Saturation", color: "Color", luminosity: "Luminosity",
  "plus-darker": "Plus Darker", "plus-lighter": "Plus Lighter",
  "red-cyan": "Two-date composite (bright changes)",
  "red-cyan-dark": "Two-date composite (dark changes)",
  ratio: "Ratio of the two dates",
  edges: "Difference of edges",
}
// Two flat, `as const` value tuples (not one big tuple-of-tuples) — a
// grouped structure built by flatMap-ing an `as const` array of arrays
// makes TS infer each group's `items` as its own distinct literal tuple
// type, which then fails to unify into one common element type for
// BLEND_MODE_OPTIONS/BLEND_MODES (confirmed: tsc rejected the earlier
// version). Deriving the display groups from these instead keeps every
// value a real string-literal member of one shared union throughout.
const STANDARD_BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion"] as const
const EXTRA_BLEND_MODES = ["hue", "saturation", "color", "luminosity", "plus-darker", "plus-lighter"] as const
// Not CSS keywords: the two-date composites of the overlay split, drawn
// with CSS only (blended boxes over each pane, one SVG filter for the
// edges) and repeated on a canvas by a snapshot (controls-utils).
// - "red-cyan", "red-cyan-dark" (names kept from when the tints were
//   fixed): both views desaturated, each tinted (A with its view color, B
//   with the exact complement of A's), B screened over A. What did not
//   change comes out grey, what is brighter in one date takes that view's
//   color. The dark form inverts both views first, so dark features present
//   at one date only (a road cut, a looting pit, a burn scar) take a color.
// - "ratio": both desaturated; A becomes 1 - A/2 (halved, then inverted)
//   and B is burned over it: color-burn gives 1 - (1 - backdrop) / source,
//   that is 1 - A / (2 B). Unchanged ground is mid grey, brighter in B is
//   lighter, darker is darker, and a difference of exposure (B = k A
//   everywhere) only moves the grey, it draws nothing.
// - "edges": each view replaced by its edges (edgeFilterPrimitives), then
//   B over A as difference: an edge present at both dates cancels, one
//   present at one date only stays.
// splitBlendCss gives the CSS mode B is blended with, compositeSteps the
// boxes of each view, compositeUsesEdges whether the views take the filter.
export const COMPOSITE_BLEND_MODES = ["red-cyan", "red-cyan-dark", "ratio", "edges"] as const
export const BLEND_MODES = [...STANDARD_BLEND_MODES, ...EXTRA_BLEND_MODES, ...COMPOSITE_BLEND_MODES] as const
export const isCompositeBlend = (mode: string) => (COMPOSITE_BLEND_MODES as readonly string[]).includes(mode)
/** The composites that tint each view with a color (and so set B's). */
export const isTintedComposite = (mode: string) => mode === "red-cyan" || mode === "red-cyan-dark"
/** Whether the composite replaces each view by its edges first. */
export const compositeUsesEdges = (mode: string) => mode === "edges"
const COMPOSITE_CSS: Record<string, string> = { "red-cyan": "screen", "red-cyan-dark": "screen", ratio: "color-burn", edges: "difference" }
/** The CSS mix-blend-mode a split blend mode is drawn with. */
export function splitBlendCss(mode: string): string {
  return COMPOSITE_CSS[mode] ?? mode
}
/** The canvas globalCompositeOperation of a CSS mix-blend-mode: the same
 *  names, but "normal" and "plus-lighter". */
export function canvasBlendOp(css: string): string {
  if (!css || css === "normal") return "source-over"
  if (css === "plus-lighter") return "lighter"
  return css
}
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}
const toHex = (rgb: number[]) => "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")
/** A color's hue at full saturation and brightness: the composite stays as
 *  bright as the imagery (a soft UI cyan would dim it). A grey stays grey
 *  (white: no tint). */
export function fullStrength(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const max = Math.max(...rgb), min = Math.min(...rgb)
  if (max === min) return "#ffffff"
  return toHex(rgb.map((c) => ((c - min) * 255) / (max - min)))
}
/** The opposite color: same lightness and saturation, hue turned by half a
 *  circle (in RGB, each channel mirrored within the color's own range:
 *  max + min - c). #0fbdbd gives #bd0f0f. A grey has no opposite. */
export function complementColor(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const max = Math.max(...rgb), min = Math.min(...rgb)
  return toHex(rgb.map((c) => max + min - c))
}
/** Whether the overlay split is showing a tinted two-date composite: then
 *  view B's color is the complement of A's (effectiveSideColor). */
export function tintedCompositeOn(s: { splitStyle?: string; splitBlendModeEnabled?: boolean; splitBlendMode?: string }): boolean {
  return s.splitStyle === "overlay" && !!s.splitBlendModeEnabled && isTintedComposite(s.splitBlendMode ?? "")
}
/** The color a view shows (border, pill, timeline handle, tint): its stored
 *  color, but for B under a tinted composite, which takes the complement of
 *  A's so that unchanged ground is neutral grey whatever A's color is. The
 *  stored color of B is left alone and is back when the mode is off. */
export function effectiveSideColor(side: ViewId, overrides: Partial<Record<ViewId, string>>, tintedComposite: boolean): string {
  if (side === "B" && tintedComposite) return complementColor(overrides.A ?? SIDE_COLORS.A)
  return overrides[side] ?? SIDE_COLORS[side]
}
/** The tint of a view under a tinted composite (hex), or null. `colorA` is
 *  view A's color. A's tint is its hue at full strength; B's is what A's
 *  lacks to make white, channel by channel, so the two always sum to white
 *  (the hue of effectiveSideColor's B, at full strength). */
export function compositeTint(mode: string, side: string, colorA: string): string | null {
  if (!isTintedComposite(mode) || (side !== "A" && side !== "B")) return null
  const a = fullStrength(colorA)
  if (side === "A" || a === "#ffffff") return a
  return toHex(parseHex(a)!.map((c) => 255 - c))
}
export type CompositeStep = { color: string; blend: "difference" | "saturation" | "multiply" }
const DESATURATE: CompositeStep = { color: "#808080", blend: "saturation" }
const INVERT: CompositeStep = { color: "#ffffff", blend: "difference" }
/** The fills blended over a view, in order, before B is blended over A (the
 *  same list drives the boxes on the map and the fills of a snapshot), or
 *  null when the mode is no composite or the view takes no part. `colorA` is
 *  view A's color. */
export function compositeSteps(mode: string, side: string, colorA: string): CompositeStep[] | null {
  if (!isCompositeBlend(mode) || (side !== "A" && side !== "B")) return null
  if (mode === "ratio") return side === "A" ? [DESATURATE, { color: "#808080", blend: "multiply" }, INVERT] : [DESATURATE]
  if (mode === "edges") return []
  const tint: CompositeStep = { color: compositeTint(mode, side, colorA)!, blend: "multiply" }
  return mode === "red-cyan-dark" ? [INVERT, DESATURATE, tint] : [DESATURATE, tint]
}
/** The SVG filter primitives that replace a picture by its edges, as
 *  markup: grey, then the difference of two Gaussian blurs (a band-pass, the
 *  smooth form of a Laplacian), amplified with a threshold that drops the
 *  faint texture, then a light blur so that an edge a pixel off between the
 *  two dates still cancels. Radii are in CSS pixels times `scale`, so the
 *  edges are as wide on a dense screen as on a plain one (a 3x3 convolution
 *  works on device pixels: half as wide and noisier at a pixel ratio of 2);
 *  a snapshot, drawn in device pixels, passes the pixel ratio. The last
 *  primitive is named "edges". */
export const EDGE_FILTER = { fine: 1.2, coarse: 3, gain: 10, threshold: 0.15, soften: 1.2 } as const
export function edgeFilterPrimitives(scale = 1): string {
  const px = (v: number) => +(v * scale).toFixed(2)
  const fn = (c: string) => `<feFunc${c} type="linear" slope="${EDGE_FILTER.gain}" intercept="${-EDGE_FILTER.threshold}"/>`
  return `<feColorMatrix type="saturate" values="0" result="grey"/>`
    + `<feGaussianBlur in="grey" stdDeviation="${px(EDGE_FILTER.fine)}" result="fine"/>`
    + `<feGaussianBlur in="grey" stdDeviation="${px(EDGE_FILTER.coarse)}" result="coarse"/>`
    + `<feBlend mode="difference" in="fine" in2="coarse" result="band"/>`
    + `<feComponentTransfer in="band" result="strong">${fn("R")}${fn("G")}${fn("B")}</feComponentTransfer>`
    + `<feGaussianBlur in="strong" stdDeviation="${px(EDGE_FILTER.soften)}" result="edges"/>`
}
/** Filter ids: the edges of a whole picture, and of view A right of the
 *  wipe only (TerrainViewer renders both). */
export const EDGE_FILTER_ID = "composite-edges"
export const EDGE_FILTER_A_ID = "composite-edges-a"
export type BlendModeOption = { value: string; label: string }
// BLEND_MODE_LABELS' plain (non-`as const`) Record type is what keeps each
// group's `items` the SAME widened `BlendModeOption[]` shape instead of a
// per-group literal-union tuple — the two groups otherwise infer as
// genuinely incompatible types (Standard's `value` narrowed to its own 12
// members, Extra's to its own 6), which the Select's `items` prop then
// rejects when handed the two side by side.
// The four that get used when comparing two dates lead the list - Normal,
// then Difference (the change), Color Burn (one darkens the other) and Hue
// (one's colours on the other's light) - with the Select's own separator
// after them; the rest follow in the Standard / Extra split.
const FAVOURITE_BLEND_MODES = ["normal", "difference", "color-burn", "hue"] as const
const isFavourite = (v: string) => (FAVOURITE_BLEND_MODES as readonly string[]).includes(v)
export const BLEND_MODE_GROUPS: { label: string; items: BlendModeOption[] }[] = [
  { label: "Favourites", items: FAVOURITE_BLEND_MODES.map((value) => ({ value, label: BLEND_MODE_LABELS[value] })) },
  { label: "Two dates", items: COMPOSITE_BLEND_MODES.map((value) => ({ value, label: BLEND_MODE_LABELS[value] })) },
  { label: "Standard", items: STANDARD_BLEND_MODES.filter((v) => !isFavourite(v)).map((value) => ({ value, label: BLEND_MODE_LABELS[value] })) },
  { label: "Extra", items: EXTRA_BLEND_MODES.filter((v) => !isFavourite(v)).map((value) => ({ value, label: BLEND_MODE_LABELS[value] })) },
]
export const BLEND_MODE_OPTIONS = BLEND_MODE_GROUPS.flatMap((g) => g.items)

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
  "1x2": { id: "1x2", cols: 1, rows: 2, grid: [["A"], ["B"]] },
  "2x2": { id: "2x2", cols: 2, rows: 2, grid: [["A", "B"], ["C", "D"]] },
  "3x2": { id: "3x2", cols: 3, rows: 2, grid: [["A", "B", "C"], ["D", "E", "F"]] },
  "4x2": { id: "4x2", cols: 4, rows: 2, grid: [["A", "B", "C", "D"], ["E", "F", "G", "H"]] },
}

export const GRID_LAYOUT_LABELS: Record<GridLayoutId, string> = {
  "2x1": "2×1", "3x1": "3×1", "4x1": "4×1", "1x2": "1×2", "2x2": "2×2", "3x2": "3×2", "4x2": "4×2",
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
 *  view (B-H) always uses its own suffixed field, since it can only be
 *  active at all when basemapPerView is already true.
 */
export function viewFieldName(side: ViewId, base: PerViewBase, basemapPerView: boolean): string {
  if (side === "A") return basemapPerView ? `${base}A` : base
  return `${base}${side}`
}

const PER_VIEW_BASES: PerViewBase[] = ["basemapSource", "date", "historicalActiveSource", "timelineSources"]

/** URL-state updates that move what view `from[i]` shows into view `to[i]`
 *  (a swap is from=[X,"A"], to=["A",X]; a reorder passes the sorted order
 *  as `from` and the layout order as `to`). "What a view shows" is its
 *  terrain source plus the basemap / date / historical-source / timeline-
 *  sources quartet - the quartet only while basemapPerView is on, since
 *  otherwise every view shares view A's unsuffixed fields and there is
 *  nothing per-view to move. Everything is read before anything is written. */
export function permuteViewsUpdates(state: Record<string, any>, from: ViewId[], to: ViewId[]): Record<string, unknown> {
  const perView = !!state.basemapPerView
  const overlayField = (side: ViewId) => (side === "A" ? "overlayBasemapIds" : `overlayBasemapIds${side}`)
  const vectorField = (side: ViewId) => (side === "A" ? "vectorOverlayIds" : `vectorOverlayIds${side}`)
  const contents = from.map((side) => ({
    source: state[sourceFieldName(side)],
    bases: perView ? PER_VIEW_BASES.map((b) => state[viewFieldName(side, b, true)]) : null,
    overlays: perView ? (state[overlayField(side)] ?? []) : null,
    vectors: perView ? (state[vectorField(side)] ?? []) : null,
  }))
  const updates: Record<string, unknown> = {}
  to.forEach((side, i) => {
    if (side === from[i]) return
    updates[sourceFieldName(side)] = contents[i].source
    contents[i].bases?.forEach((v, j) => { updates[viewFieldName(side, PER_VIEW_BASES[j], true)] = v })
    if (contents[i].overlays) updates[overlayField(side)] = contents[i].overlays
    if (contents[i].vectors) updates[vectorField(side)] = contents[i].vectors
  })
  // Per-view visualization modes (lib/viz-views.ts, "showSlope:AC;..."):
  // the letters move with the views.
  if (typeof state.vizViews === "string" && state.vizViews) {
    const map: Partial<Record<ViewId, ViewId>> = {}
    from.forEach((f, i) => { map[f] = to[i] })
    const order = VIEW_IDS
    updates.vizViews = state.vizViews.split(";").map((part: string) => {
      const [key, views = ""] = part.split(":")
      const moved = views.split("").map((c) => map[c as ViewId] ?? c)
      return `${key}:${order.filter((v) => moved.includes(v)).join("")}`
    }).join(";")
  }
  return updates
}

/** With no split on screen, a source picked for "the" view is put on every
 *  view, so a later split or grid does not open views still on the old
 *  source. A patch with sourceA fans out to sourceA..H; one with
 *  basemapSource / basemapSourceA fans out to the single field and every
 *  per-view field. In a split the patch is left alone. */
export function fanOutWhenSingle(state: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  if (state.splitStyle && state.splitStyle !== "off") return patch
  const out = { ...patch }
  if ("sourceA" in patch) for (const side of VIEW_IDS) out[sourceFieldName(side)] = patch.sourceA
  const basemap = patch.basemapSourceA ?? patch.basemapSource
  if (basemap !== undefined) {
    out.basemapSource = basemap
    for (const side of VIEW_IDS) out[viewFieldName(side, "basemapSource", true)] = basemap
  }
  return out
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
  // A cyan and B red since 2026-11-26: complementary, so the two-date
  // composite (compositeTint) comes out grey where nothing changed. They
  // were blue and green, now D's and F's.
  A: "#0fbdbd", // cyan (hue 180, the exact opposite of B's red)
  B: "#ef4444", // red
  C: "#f59e0b", // amber
  D: "#22c55e", // green
  E: "#a855f7", // purple
  F: "#3b82f6", // blue
  G: "#ec4899", // pink
  H: "#84cc16", // lime
}
