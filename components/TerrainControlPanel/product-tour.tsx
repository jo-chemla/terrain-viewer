import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom } from "jotai"
import { Coachmark, useCoachmark } from "coachmark"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  hasSeenTourAtom, isTourOpenAtom, terrainAnalysisAdvancedAtom, reliefVisualizationAdvancedAtom,
  isHillshadeXYPadOpenAtom, type AppMode,
} from "@/lib/settings-atoms"
import { isSidebarOpenAtom, sectionOpenAtom, macroGroupOpenAtom } from "./TerrainControlPanel"
import { colorizeMapBordersAtom, isComparisonMixAdvancedOpenAtom } from "@/lib/layout-constants"

// ─── Step model ─────────────────────────────────────────────────────────────
//
// Every step targets a plain DOM id — either one already present on an
// existing control (e.g. the "hillshade" checkbox's own id) or one added
// alongside this file (see the `id`/`id="tour-..."` props sprinkled through
// general-settings.tsx, hillshade-options-section.tsx, etc.). The one
// exception is the map viewport itself: it isn't a single well-defined
// element (split/grid layouts render several panes), and a full-bleed
// container as an anchor breaks floating-ui's placement math (every side is
// "off target" when the target already fills the viewport). MAP_ANCHOR_ID
// is a small, fixed, invisible marker (rendered below) pinned to the
// viewport center instead, padded out to a generously-sized spotlight — also
// reused by the branch-choice step, which has no single control to point at.
const MAP_ANCHOR_ID = "tour-map-anchor"

// Portaled popup content (Select/Combobox listboxes, color-picker/other
// Popover content, DropdownMenu content) renders to document.body as a
// SIBLING of whatever visually triggered it, not a descendant — so a plain
// DOM-containment check against a step's target element misses clicks on
// this content even when it was opened from inside that target. See
// handleOpenChange's outside-press exemption below.
const PORTAL_CONTENT_SELECTOR = '[data-slot="select-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"]'

type TourBranch = "terrain" | "historical" | null

type TourActions = {
  state: any
  setState: (updates: any) => void
  switchAppMode: (mode: AppMode) => void
  sectionOpen: any
  setSectionOpen: (updater: (prev: any) => any) => void
  macroGroupOpen: any
  setMacroGroupOpen: (updater: (prev: any) => any) => void
  isSidebarOpen: boolean
  setIsSidebarOpen: (open: boolean) => void
  hillshadeXYPadOpen: boolean
  setHillshadeXYPadOpen: (open: boolean) => void
  taAdvanced: boolean
  setTaAdvanced: (v: boolean) => void
  rvAdvanced: boolean
  setRvAdvanced: (v: boolean) => void
  colorizeMapBorders: boolean
  setColorizeMapBorders: (v: boolean) => void
  comparisonMixAdvancedOpen: boolean
  setComparisonMixAdvancedOpen: (v: boolean) => void
}

// Every nuqs `state` key any prepare function below ever writes — snapshotted
// verbatim at tour start and restored verbatim on close, regardless of which
// combination of steps/branches the tour actually visited (including fields
// switchAppMode's own historical-mode nudge touches internally, in
// TerrainControlPanel.tsx's handleSelectMode).
const TOUR_STATE_KEYS = [
  "appMode", "viewMode", "historicalBeta", "showRasterBasemap",
  "showHillshade", "showLightingEffects", "showShadows", "showColorRelief",
  "showTerrainAnalysis", "showReliefVisualization", "showPlaneSlicer", "showTellsDetector",
  "showContoursAndGraticules", "showContours", "showGraticules", "showBackground",
  "showSlope", "showCurvature", "showLrm", "showSvf",
  "basemapSource", "basemapSourceA", "basemapSourceB", "basemapPerView",
  "splitStyle", "gridLayout", "splitBlendModeEnabled", "splitBlendMode", "overlayOpacity",
  "historicalTimelineCollapsed", "historicalControlsExpanded",
] as const

// The map-viewport step's own popup — sidebar and any pre-existing
// split/historical-timeline chrome deliberately CLOSED/cleared here, so its
// full-screen spotlight (see fullScreenSpotlight below) centers on an
// actually-empty viewport instead of fighting whatever panels happened to be
// open when the tour was started. prepareSidepanelIntro (next step) is what
// reopens the sidebar once there's something to point at.
function prepareGeneralIntro(a: TourActions) {
  a.switchAppMode("terrain")
  a.setIsSidebarOpen(false)
  a.setSectionOpen((prev) => ({ ...prev, general: true }))
  a.setState({ splitStyle: "off", basemapSource: "esri", basemapSourceA: "esri" })
}

function prepareSidepanelIntro(a: TourActions) {
  a.setIsSidebarOpen(true)
  a.setSectionOpen((prev) => ({ ...prev, general: true }))
}

// Shared setup for every step in the terrain branch — opens every section/
// macro-group the branch's steps might target and expands both Advanced
// toggles, but deliberately leaves every individual viz mode (Hillshade,
// Hypso, Terrain Analysis, Relief Visualization) untouched: the very first
// terrain step (the Visualization Modes overview) runs this alone, so a
// visitor sees the app's own natural default state rather than everything
// switched on at once. Each later mode-specific step (prepareHillshadeOnly
// etc. below) layers its own isolation on top via `extraState`, MERGED into
// this same single `setState` call rather than a separate one of its own —
// two sequential setState calls in one synchronous onEnter turned out to
// race (see the "back-then-forward" bug this fixed): the second call's
// object doesn't reliably merge with the first's before nuqs's own state
// read settles, so fields from the first call could silently get dropped —
// exactly the mode-toggle fields that gate whether that step's target
// section mounts at all. Also always forces a single unified map (splitStyle
// "off") — a demoed mode is easiest to see on one full map, not split across
// two panes leftover from earlier experimentation (in this tour run or
// before it started).
function prepareTerrainBase(a: TourActions, extraState: Record<string, unknown> = {}) {
  a.switchAppMode("terrain")
  a.setIsSidebarOpen(true)
  a.setSectionOpen((prev) => ({
    ...prev,
    general: true, visualizationModes: true, terrainSource: true, rasterBasemap: true,
    hillshade: true, hypsometricTint: true, terrainAnalysis: true, reliefVisualization: true,
  }))
  a.setMacroGroupOpen((prev) => ({ ...prev, Sources: true, Options: true, Tools: true }))
  a.setHillshadeXYPadOpen(true)
  a.setTaAdvanced(true)
  a.setRvAdvanced(true)
  a.setState({ splitStyle: "off", basemapSource: "esri", basemapSourceA: "esri", ...extraState })
}

// One mode on, the rest off — so each mode-specific step shows exactly what
// that mode controls, instead of a wall of every layer stacked at once.
function prepareHillshadeOnly(a: TourActions) {
  prepareTerrainBase(a, { showHillshade: true, showColorRelief: false, showTerrainAnalysis: false, showReliefVisualization: false })
}

function prepareHypsoOnly(a: TourActions) {
  prepareTerrainBase(a, { showHillshade: false, showColorRelief: true, showTerrainAnalysis: false, showReliefVisualization: false })
}

function prepareTerrainAnalysisOnly(a: TourActions) {
  prepareTerrainBase(a, {
    showHillshade: false, showColorRelief: false, showReliefVisualization: false,
    showTerrainAnalysis: true, showSlope: true, showCurvature: false,
  })
}

function prepareReliefVisualizationOnly(a: TourActions) {
  prepareTerrainBase(a, {
    showHillshade: false, showColorRelief: false, showTerrainAnalysis: false,
    showReliefVisualization: true, showLrm: true,
  })
}

// Every tool section's own sectionOpen key (TerrainControlPanel.tsx's Tools
// group) — folded (not unmounted: these have no showX gate, just a
// collapsed/expanded header like every other Section) so the Tools step's
// target (the wrapping "tour-tools-group" div around the separator AND every
// section below it) is just a compact stack of titles, letting one spotlight
// cover all of them at once instead of whichever one happened to be expanded
// coming in. Includes terrain-only keys (elevationPicker/animation) even
// though the historical branch's own Tools step never renders those
// sections — an unused sectionOpen key is harmless.
const TOOL_SECTION_KEYS = ["drawing", "elevationPicker", "sunShadowCalculator", "animation", "sourceInfo"] as const

// Every viz mode off — the Tools step isn't about any one of them, so this
// clears the Options group back down to just its own collapsed sections,
// leaving the panel's remaining room to the Tools group below it (already
// forced open by prepareTerrainBase's own setMacroGroupOpen call).
function prepareTerrainTools(a: TourActions) {
  prepareTerrainBase(a, { showHillshade: false, showColorRelief: false, showTerrainAnalysis: false, showReliefVisualization: false })
  a.setSectionOpen((prev) => ({ ...prev, ...Object.fromEntries(TOOL_SECTION_KEYS.map((k) => [k, false])) }))
}

// Same single-setState-call merging as prepareTerrainBase above, via
// `extraState` threaded down through prepareHistoricalGrid.
function prepareHistoricalIntro(a: TourActions, extraState: Record<string, unknown> = {}) {
  a.switchAppMode("historical")
  a.setState({ basemapSource: "historical", basemapSourceA: "historical", ...extraState })
  a.setSectionOpen((prev) => ({ ...prev, comparisonMix: true }))
}

function prepareHistoricalOverlayBlend(a: TourActions) {
  prepareHistoricalIntro(a, { splitStyle: "overlay", splitBlendModeEnabled: true, splitBlendMode: "multiply", overlayOpacity: 0.5 })
}

function prepareHistoricalGrid(a: TourActions, extraState: Record<string, unknown> = {}) {
  prepareHistoricalIntro(a, { splitStyle: "side-by-side", gridLayout: "2x2", basemapPerView: true, basemapSourceB: "historical", ...extraState })
  a.setColorizeMapBorders(true)
  a.setComparisonMixAdvancedOpen(true)
}

// Tools group renders identically regardless of app mode (TerrainControlPanel.tsx
// doesn't gate its MacroSeparator on historicalMode) — only the mode-specific
// content it lists differs (see HISTORICAL_TOOLS_STEP vs TERRAIN_TOOLS_STEP's
// own description). Back to the plain intro state (no grid/timeline) since
// this step isn't about imagery comparison.
function prepareHistoricalTools(a: TourActions) {
  prepareHistoricalIntro(a)
  a.setMacroGroupOpen((prev) => ({ ...prev, Tools: true }))
  a.setSectionOpen((prev) => ({ ...prev, ...Object.fromEntries(TOOL_SECTION_KEYS.map((k) => [k, false])) }))
}

function prepareHistoricalTimeline(a: TourActions) {
  prepareHistoricalGrid(a, { historicalTimelineCollapsed: false, historicalControlsExpanded: true })
}

interface TourStepDef {
  key: string
  domId: string
  title: string
  description: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  spotlightPadding?: number
  spotlightRadius?: number
  onEnter?: (a: TourActions) => void
  // Renders a "pick a path" footer (two choice buttons + Back/Skip) instead
  // of the usual Skip/Back/Next row — see chooseBranch below.
  kind?: "branch"
  // MAP_ANCHOR_ID-targeting steps have no real element to size a spotlight
  // against — spotlightPadding is computed live from the viewport instead
  // (see mapSpotlightPadding below) so the cutout fills as much of the
  // screen as possible on any aspect ratio, not just a fixed square tuned
  // for desktop.
  fullScreenSpotlight?: boolean
  // Overrides which element goToIndex/chooseBranch's own scrollTargetIntoView
  // scrolls to — defaults to this step's own `domId` (the Coachmark target
  // itself) when absent. Used by a step whose most useful scroll destination
  // ISN'T its own target: byod-terrain's target is a button ROW, but
  // scrolling to the section's own TOP shows more of it above that row.
  scrollTargetId?: string
  // Overrides scrollTargetIntoView's own default ("start") for this step —
  // unused today (every step redirecting via scrollTargetId is happy with
  // "start"), kept for the next one that isn't.
  scrollBlock?: ScrollLogicalPosition
  // false disables Coachmark's OWN internal scroll-to-target for this step —
  // needed whenever scrollTargetId redirects OUR OWN scroll elsewhere:
  // without this, Coachmark's internal (separate, less reliable — see
  // scrollTargetIntoView's own comment) attempt still aims at THIS step's own
  // domId and can fight with ours over final scroll position.
  scrollIntoView?: boolean
  // Renders a small "curious about the other mode?" link (below the normal
  // Skip/Back/Finish row) that jumps straight into whichever branch this one
  // ISN'T — set on each branch's own last step (see the render logic's
  // `otherBranch` for how the target branch is derived).
  offerOtherBranch?: boolean
}

// ─── Step groups ────────────────────────────────────────────────────────────
//
// The tour runs GENERAL_STEPS, then BRANCH_STEP (a fork, not a plain step),
// then whichever of TERRAIN_STEPS/HISTORICAL_STEPS the visitor picks — see
// getStepsForBranch. Only the terrain branch ends with a Keyboard Shortcuts
// wrap-up (KEYBOARD_SHORTCUTS_STEP) — those shortcuts are Terrain-mode
// specific, so the Historical branch just ends at its own last step instead.

const GENERAL_STEPS: TourStepDef[] = [
  {
    key: "map", domId: MAP_ANCHOR_ID, side: "bottom", align: "center",
    fullScreenSpotlight: true, spotlightRadius: 24,
    title: "The Map Viewport",
    description: "This is your workspace — pan by dragging, zoom with the scroll wheel, and (in 3D/Globe view) rotate and tilt by right-click-dragging. Every visualization mode renders live, directly on this map.",
    onEnter: prepareGeneralIntro,
  },
  {
    key: "sidepanel", domId: "tour-sidepanel", side: "left", align: "start",
    title: "The Control Panel",
    description: "Everything else lives here: general settings, visualization modes, data sources, and every mode's detailed options — grouped into collapsible sections.",
    onEnter: prepareSidepanelIntro,
  },
  {
    key: "general-settings", domId: "tour-general-settings", side: "left", align: "start",
    title: "General Settings",
    description: "Switch between 2D, Globe, and 3D view, adjust terrain exaggeration, and control Split Mode.",
  },
  {
    key: "historical-mode-intro", domId: "tour-mode-label", side: "left", align: "start",
    title: "Terrain vs Historical Satellite Modes",
    description: (
      <>
        <p className="pb-2">Two distinct modes — switch back and forth any time with this arrows icon:</p>
        <ul className="list-disc pl-4 space-y-1.5">
          <li><span className="font-semibold text-foreground">Terrain</span> (default) — live 2D/3D/Globe terrain: hillshade, hypsometric color, terrain analysis (slope, curvature etc), relief visualization, and more.</li>
          <li><span className="font-semibold text-foreground">Historical Satellite</span> — a reworked panel for browsing historical aerial and satellite imagery over time, with a timeline panel and N-grid view.</li>
        </ul>
      </>
    ),
    onEnter: prepareHistoricalIntro,
  },
  {
    key: "settings-persistence", domId: "tour-download-section", side: "left", align: "start",
    title: "Everything is Saved",
    description: (
      <>
        <p className="pb-2"><span className="font-semibold text-foreground">Visual state in URL: </span>The entire view — camera position, every mode, every setting — lives in the URL, so any link is shareable and bookmarkable.</p>
        <p className="pb-2"><span className="font-semibold text-foreground">Local storage persistence: </span>Custom sources, color ramps, API keys, and preferences persist in your browser's local storage; see Settings → Browser Local Storage Persistence to inspect or clear it.</p>
        <p><span className="font-semibold text-foreground">Download and Snapshot: </span>This section covers exporting what you're currently seeing instead — a static image, or the underlying GeoTIFF/GeoJSON data.</p>
      </>
    ),
    onEnter: (a) => { a.setSectionOpen((prev) => ({ ...prev, download: true })) },
  },
]

const BRANCH_STEP: TourStepDef = {
  key: "branch-choice", domId: MAP_ANCHOR_ID, side: "bottom", align: "center",
  fullScreenSpotlight: true, spotlightRadius: 24,
  kind: "branch",
  title: "Where to next?",
  description: "That's the essentials. Want to go deeper on the terrain visualization tools, or jump straight into browsing historical satellite imagery?",
}

// Terrain-only wrap-up — Historical mode has its own dedicated, simplified
// keyboard-shortcut surface (mostly just the timeline's own arrow-key
// stepping), so this Terrain-specific list doesn't apply there.
const KEYBOARD_SHORTCUTS_STEP: TourStepDef = {
  key: "settings-shortcuts", domId: MAP_ANCHOR_ID, side: "bottom", align: "center",
  fullScreenSpotlight: true, spotlightRadius: 24,
  offerOtherBranch: true,
  title: "Keyboard Shortcuts",
  description: (
    <>
      <p className="pb-2">A few handy ones that make switching between visualization modes fast, without ever touching the checkboxes:</p>
      <ul className="list-disc pl-4 space-y-1">
        <li>Shift — peek at the raster basemap</li>
        <li>Ctrl — hide every mode down to just the basemap</li>
        <li>Space — re-toggle whichever mode you last clicked</li>
        <li>L + drag on the map — set the hillshade light direction</li>
        <li>←/→ — step through this tour itself</li>
        <li>Open Settings → Keyboard Shortcuts for the complete list</li>
      </ul>
    </>
  ),
}

const TERRAIN_STEPS: TourStepDef[] = [
  {
    key: "viz-modes", domId: "tour-viz-modes", side: "left", align: "start",
    title: "Visualization Modes",
    description: "Each checkbox turns one layer on or off, with its own opacity slider alongside it. Once a mode is switched on, its detailed options appear in the Options group further down this panel — only available here, in Terrain mode.",
    onEnter: prepareTerrainBase,
  },
  {
    key: "hillshade", domId: "tour-hillshade-section", side: "left", align: "start",
    title: "Hillshade",
    description: "Shades relief from a virtual light source. The method selector above and the light-direction pad below it are both part of this same Hillshade Options block — drag the pad directly (Free mode), or switch to Datetime mode to set a real date, time, and location and derive the azimuth/elevation from the actual sun position instead.",
    onEnter: prepareHillshadeOnly,
  },
  {
    key: "terrain-section", domId: "tour-terrain-section", side: "left", align: "start",
    title: "Terrain Sources",
    description: "Picks the elevation (DEM) data itself — distinct from the raster Basemap imagery next.",
  },
  {
    key: "basemap-section", domId: "tour-basemap-section", side: "left", align: "start",
    title: "Raster Basemap",
    description: "Satellite or aerial imagery draped under your terrain — including Historical Imagery, covered in the other half of this tour.",
  },
  {
    key: "byod-terrain", domId: "tour-byod-terrain-row", side: "left", align: "center",
    title: "Bring Your Own Data",
    description: "Add your own COG, VRT, or WMS terrain source with \"Add Dataset\", batch-edit every source as JSON, or click Sample to load a set of ready-made examples — the same options exist for basemaps too.",
    // Scrolling straight to this button row (its own target) can push the
    // Terrain Sources section's own title off the top of the panel if there's
    // a long list of sources above it. Scrolling the SECTION's top into view
    // instead shows as much of it as fits, title included, even if the
    // button row ends up right at the bottom edge (or just past it) when the
    // list is long.
    scrollTargetId: "tour-terrain-section",
    scrollIntoView: false,
  },
  {
    key: "split-mode", domId: "tour-split-mode", side: "left", align: "center",
    title: "Split / Compare Mode",
    description: "Off, Overlay (two sources blended in place), or Side (two panes side by side) — compare two terrain or basemap sources directly against each other.",
  },
  {
    key: "hypso-section", domId: "tour-hypso-section", side: "left", align: "start",
    title: "Hypsometric Color Ramps",
    description: "Elevation Hypso paints terrain by altitude. Choose from dozens of curated color ramps (Classic, CET, cpt-city, and more) or build a custom one, and check Min/Max below to set a custom elevation range yourself — drag the slider, type exact values, or click the mountain-snow icon to auto-set it from the DEM tiles currently loaded in your viewport.",
    onEnter: prepareHypsoOnly,
  },
  {
    key: "terrain-analysis-section", domId: "tour-terrain-analysis-section", side: "left", align: "start",
    title: "Terrain Analysis",
    description: "Surface derivatives (Slope, Aspect, Curvature) and neighborhood statistics (TPI, TRI, Roughness, and more) — each sub-mode has its own checkbox, and checking one reveals its own color ramp and range options directly beneath it. Slope is switched on here as an example.",
    onEnter: prepareTerrainAnalysisOnly,
  },
  {
    key: "relief-visualization-section", domId: "tour-relief-visualization-section", side: "left", align: "start",
    title: "Relief Visualization",
    description: "Multi-scale relief and visibility modes: Local Relief Model, Sky View Factor, Openness, and Local Dominance — heavier computations that reveal subtle terrain structure standard hillshading misses. LRM (cheap) is switched on here; Sky View Factor and the others are ray-marched and noticeably slower, worth trying once you're exploring your own data.",
    onEnter: prepareReliefVisualizationOnly,
  },
  {
    key: "terrain-tools", domId: "tour-tools-group", side: "left", align: "start",
    title: "Tools",
    description: (
      <>
        <p className="pb-2">A grab bag of map-based utilities, independent of any visualization mode:</p>
        <ul className="list-disc pl-4 space-y-1.5">
          <li><span className="font-semibold text-foreground">Drawing</span> — sketch points, lines, and polygons directly on the map.</li>
          <li><span className="font-semibold text-foreground">Elevation Picker</span> — click anywhere on the terrain to read off its elevation.</li>
          <li><span className="font-semibold text-foreground">Sun/Shadow Calculator</span> <span className="text-muted-foreground/70 italic">(beta)</span> — estimate shadow length and direction for a chosen date, time, and location.</li>
          <li><span className="font-semibold text-foreground">Animation</span> — fly the camera along a scripted path through the scene.</li>
          <li><span className="font-semibold text-foreground">Source Info</span> — provenance and attribution for the active terrain/basemap source.</li>
        </ul>
      </>
    ),
    onEnter: prepareTerrainTools,
  },
  KEYBOARD_SHORTCUTS_STEP,
]

const HISTORICAL_STEPS: TourStepDef[] = [
  {
    key: "historical-compare-blend", domId: "tour-historical-compare-blend", side: "left", align: "start",
    title: "Compare and Blend",
    description: "Historical mode's home for every split/grid/blend control — split style, grid layout, blend mode and opacity, and per-view border colorization.",
    onEnter: prepareHistoricalIntro,
  },
  {
    key: "historical-split-mode", domId: "tour-historical-split-mode", side: "left", align: "center",
    title: "Split Mode",
    // Deliberately left at "off" here (prepareHistoricalIntro, not
    // prepareHistoricalOverlayBlend) — the next two steps switch it to
    // Overlay then Side themselves, so this step can explain all three
    // options before any of them jump ahead of the explanation.
    description: "Off, Overlay (two views blended in place), or Side (a full grid of independent panes) — the foundation for everything else in this section.",
    onEnter: prepareHistoricalIntro,
  },
  {
    key: "historical-blend-mode", domId: "tour-historical-split-and-mode", side: "left", align: "center",
    title: "Blend Modes",
    description: "With Overlay active, blend two views together live — e.g. Multiply (shown here), Difference, or Screen — the same compositing modes you'd find in an image editor, applied to two points in time.",
    onEnter: prepareHistoricalOverlayBlend,
  },
  {
    key: "historical-grid-layout", domId: "tour-historical-split-and-mode", side: "left", align: "start",
    title: "Grid Layout & Colored Borders",
    description: "Side mode splits into a full grid — up to 4×2 panes. Each view gets its own colored border, matching the colored handle for that same view on the timeline below.",
    onEnter: prepareHistoricalGrid,
  },
  {
    key: "historical-timeline", domId: "tour-historical-timeline", side: "top", align: "center",
    title: "Historical Imagery Timeline",
    description: "Timeline activates automatically once at least one grid view is set to the Historical Imagery raster basemap source. Aggregates ESRI Wayback, Google Earth Historical, Bing, Planet Monthly, NASA HLS, and EOX Sentinel-2 into one scrubbable timeline. Click any tick to jump that view to its resolved capture date — each view's handle is colored to match its border above. Dates may take a moment to resolve.",
    // Tried scrolling to "tour-basemap-section" (the evidence every view
    // resolved to a historical source) instead of this step's own target —
    // confirmed live it isn't reliably possible: the panel's scroll range
    // is exhausted right around there regardless of "start" vs "center"
    // alignment, and squeezing the basemap section into view left no room
    // above for this step's own `side="top"` popup, which floating-ui then
    // couldn't place on-screen at all. Left at the default (scroll this
    // step's own target) instead.
    onEnter: prepareHistoricalTimeline,
  },
  {
    key: "historical-tools", domId: "tour-tools-group", side: "left", align: "start",
    offerOtherBranch: true,
    title: "Tools",
    description: (
      <>
        <p className="pb-2">Historical mode keeps a smaller subset — just the ones that make sense without a live elevation source:</p>
        <ul className="list-disc pl-4 space-y-1.5">
          <li><span className="font-semibold text-foreground">Drawing</span> — sketch points, lines, and polygons directly on the map.</li>
          <li><span className="font-semibold text-foreground">Sun/Shadow Calculator</span> <span className="text-muted-foreground/70 italic">(beta)</span> — estimate shadow length and direction for a chosen date, time, and location.</li>
          <li><span className="font-semibold text-foreground">Source Info</span> — provenance and attribution for the active historical imagery source.</li>
        </ul>
      </>
    ),
    onEnter: prepareHistoricalTools,
  },
]

// The full union, for building/resolving target refs — every possible step's
// DOM id gets resolved on every transition regardless of which branch is
// actually active (cheap: just N getElementById calls), so switching
// branches (or going Back into one after picking the other) never hits an
// unresolved target.
const ALL_STEPS: TourStepDef[] = [...GENERAL_STEPS, BRANCH_STEP, ...TERRAIN_STEPS, ...HISTORICAL_STEPS]

function getStepsForBranch(branch: TourBranch): TourStepDef[] {
  if (branch === "terrain") return [...GENERAL_STEPS, BRANCH_STEP, ...TERRAIN_STEPS]
  if (branch === "historical") return [...GENERAL_STEPS, BRANCH_STEP, ...HISTORICAL_STEPS]
  return [...GENERAL_STEPS, BRANCH_STEP]
}

// Coachmark.Next's built-in last-step "finish" shortcut closes the popover's
// own internal presentation state directly, without going through
// Popover.Close's real close path — so it never reaches this component's
// controlled onOpenChange (confirmed in coachmark's source: CoachmarkNext's
// onClick is unconditionally context.next, and next() on the last step calls
// an internal finish()/close() that bypasses the Root's onOpenChange wiring
// entirely). Coachmark.Close (a thin Popover.Close wrapper) does go through
// that real path, so the last step renders Close instead of Next.
//
// Both branches also carry a `data-tour-nav` marker the ←/→ keyboard
// shortcut (see the keydown effect below) looks up directly, rather than
// re-deriving "what should Next do" itself.
function NextOrFinishButton({ className }: { className: string }) {
  const { isLastStep } = useCoachmark()
  if (isLastStep) {
    return <Coachmark.Close data-tour-nav="next" className={className}>Finish</Coachmark.Close>
  }
  return <Coachmark.Next data-tour-nav="next" className={className}>Next</Coachmark.Next>
}

// A mode-specific step's onEnter doesn't just toggle a boolean — it flips a
// `state.showX` flag that conditionally MOUNTS a whole options section (e.g.
// HillshadeOptionsSection returns null until showHillshade is true), routed
// through nuqs's own URL-driven setState, not a plain useState. That mount is
// necessary but not sufficient: Section's own Collapsible (opened via a
// SEPARATE jotai atom, sectionOpen[key], in the same onEnter) can still be
// collapsed at the exact instant the wrapping element first appears, if that
// atom's update settles on a different render pass than nuqs's. Base UI's
// Collapsible.Panel carries data-open/data-closed specifically so this is
// checkable — waiting for existence alone let Coachmark position/spotlight
// against a collapsed (header-only) rect that then grows a moment later,
// which is what a popup that "quickly pops then leaves" actually was: sized
// and placed correctly for a rect that was about to change size out from
// under it.
function isTargetReady(domId: string): boolean {
  const el = document.getElementById(domId)
  if (!el) return false
  const stillCollapsed = el.querySelector('[data-slot="collapsible-content"][data-closed]')
  return !stillCollapsed
}

// A fixed rAF-frame-count wait (tried first) wasn't reliably long enough for
// either the mount or the collapsible-expand above, and still wasn't at 30
// frames for some steps. A MutationObserver sidesteps the guessing entirely:
// it's a real notification the instant something changes anywhere under
// <body> — both childList (the element mounting) and attributes
// (data-open/data-closed swapping on an already-mounted one) — with no
// dependency on animation-frame cadence, which also makes it immune to the
// frame-rate throttling a backgrounded/busy tab can suffer from. The timeout
// is just a backstop in case the target genuinely never becomes ready (a bad
// domId, or a section that can't actually open), not the normal path.
function waitForTarget(domId: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (isTargetReady(domId)) { resolve(); return }
    const done = () => {
      observer.disconnect()
      clearTimeout(timeout)
      resolve()
    }
    const observer = new MutationObserver(() => {
      if (isTargetReady(domId)) done()
    })
    observer.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ["data-open", "data-closed"],
    })
    const timeout = setTimeout(done, timeoutMs)
  })
}

// Existence + open-state (waitForTarget above) still doesn't guarantee the
// target's actual on-screen RECT has settled — mounting/collapsing a
// completely different section a moment earlier in this same onEnter (e.g.
// switching from Hillshade's section to Hypso's) reflows every sibling below
// it in the scrollable sidebar, which can still be resizing/repositioning
// for a frame or two after the element we care about first satisfies
// isTargetReady. Coachmark measures once, when this promise resolves — if
// that measurement lands mid-reflow, the spotlight/popup are positioned
// against a rect that's about to move, which is exactly what a step whose
// popup "quickly pops then leaves" looks like from the outside. Polling the
// bounding rect across consecutive frames until two in a row agree confirms
// layout has actually stopped moving before committing to it.
// NOTE: verified live that rAF itself can be fully suspended (not just
// slow) whenever the tab loses OS-level window focus — confirmed by a bare
// requestAnimationFrame loop never firing a single callback across 15+
// real seconds in that state, while a plain setTimeout in the same page
// fired right on schedule. The frame-count cap below is USELESS as a
// safety net against that: if rAF never calls back even once, `check` never
// runs again after the first call, and this promise would hang forever —
// exactly the kind of hang that would make the WHOLE tour freeze (not just
// one step) the moment a real user's tab loses focus mid-tour, which is a
// far worse failure mode than the bug this function exists to fix. The
// setTimeout-based `timeoutMs` backstop is what actually guarantees this
// resolves regardless of rAF's state; the frame polling is just how it
// resolves EARLY when rAF is actually running normally.
function waitForStableRect(domId: string, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    let lastRect: DOMRect | null = null
    let settled = false
    function sameRect(a: DOMRect, b: DOMRect) {
      return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
    }
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(finish, timeoutMs)
    function check() {
      if (settled) return
      const el = document.getElementById(domId)
      const rect = el?.getBoundingClientRect() ?? null
      if (rect && lastRect && sameRect(rect, lastRect)) { finish(); return }
      lastRect = rect
      requestAnimationFrame(check)
    }
    check()
  })
}

// Coachmark's own built-in scroll-into-view (triggered internally off the
// `stepIndex` prop, via the native Element.scrollIntoView + a scroll/scrollend
// listener race) turns out to be unreliable for a target buried deep in the
// sidebar's own scroll container: confirmed live that for a target requiring
// a large scroll distance (e.g. Hypsometric/Terrain Analysis/Relief
// Visualization — each progressively further down the Options list than
// Hillshade above them), its internal wait can resolve before the actual
// scroll has gone far enough, leaving the popup positioned against a target
// rect that's still (partly) below the fold — visually indistinguishable
// from "no popup at all", just the dimmed backdrop. This function, awaited
// before a step is ever committed (see goToIndex/chooseBranch), sidesteps
// that race entirely — by the time Coachmark's own attempt runs, the target
// is already in view, so its internal path finds nothing left to do.
// NOTE: tried disabling Coachmark's own scrollIntoView globally (since this
// function makes it redundant) — confirmed live that broke something ELSE:
// its own scroll phase also does some internal re-measurement step this
// codebase doesn't fully understand, and skipping that phase entirely could
// leave a LATER step positioned against a stale/wrong-sized anchor rect even
// once this function's own scroll had already landed correctly. Left at
// Coachmark's own default (true) for that reason — only steps whose
// `scrollTargetId` redirects the scroll elsewhere disable it per-step (see
// `scrollIntoView` on TourStepDef), since leaving Coachmark's own attempt
// aimed at the step's own domId in THOSE cases would fight this one over the
// final scroll position.
// `block: "start"` (not "center"/"nearest") always surfaces the target's OWN
// top edge — for most steps that's simply the more predictable choice, but
// it matters most for a target whose height varies with user data (Raster
// Basemap/Terrain Sources, once BYOD custom sources pile up): "center" tries
// to vertically center the whole (possibly very tall) element, which can
// push its own title — and the section header `side="left" align="start"`
// popups are anchored to — above the top of the viewport, i.e. off-screen,
// even though plenty of the section's OWN content is technically "in view"
// further down. "start" always leaves the title (and as much of what follows
// as fits) visible.
function scrollTargetIntoView(domId: string, block: ScrollLogicalPosition = "start") {
  document.getElementById(domId)?.scrollIntoView({ behavior: "instant", block })
}

interface ProductTourProps {
  state: any
  setState: (updates: any) => void
  switchAppMode: (mode: AppMode) => void
}

export function ProductTour({ state, setState, switchAppMode }: ProductTourProps) {
  const [hasSeenTour, setHasSeenTour] = useAtom(hasSeenTourAtom)
  const [isTourRequested, setIsTourRequested] = useAtom(isTourOpenAtom)
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom)
  const [sectionOpen, setSectionOpen] = useAtom(sectionOpenAtom)
  const [macroGroupOpen, setMacroGroupOpen] = useAtom(macroGroupOpenAtom)
  const [hillshadeXYPadOpen, setHillshadeXYPadOpen] = useAtom(isHillshadeXYPadOpenAtom)
  const [taAdvanced, setTaAdvanced] = useAtom(terrainAnalysisAdvancedAtom)
  const [rvAdvanced, setRvAdvanced] = useAtom(reliefVisualizationAdvancedAtom)
  const [colorizeMapBorders, setColorizeMapBorders] = useAtom(colorizeMapBordersAtom)
  const [comparisonMixAdvancedOpen, setComparisonMixAdvancedOpen] = useAtom(isComparisonMixAdvancedOpenAtom)

  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  // null until the branch-choice step is answered — see chooseBranch/BRANCH_STEP.
  const [branch, setBranch] = useState<TourBranch>(null)
  const activeSteps = useMemo(() => getStepsForBranch(branch), [branch])

  // Live viewport size — drives both the MAP_ANCHOR_ID steps' spotlight size
  // (mapSpotlightPadding, below) and a narrow-viewport override of every
  // side="left"/"right" step's placement (isNarrowViewport): on a narrow
  // portrait phone the sidebar panel spans nearly the full screen width, so
  // "position the popup to the left of the target" has nowhere on-screen to
  // put it — it ends up mostly off-screen. Falling back to side="bottom"
  // there keeps the popup fully visible regardless of how wide its target is.
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }))
  useEffect(() => {
    const update = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  // Half the LARGER viewport dimension (plus a small buffer): expanding a
  // spotlight by this much in every direction from a centered point always
  // covers the full screen on any aspect ratio, portrait or landscape, rather
  // than a fixed padding tuned for one desktop size that leaves bands
  // uncovered on a tall/narrow phone.
  const mapSpotlightPadding = Math.max(viewportSize.width, viewportSize.height) / 2 + 40
  const isNarrowViewport = viewportSize.width < 640

  // Always-latest snapshot of everything a step's onEnter/restore might read
  // or call — updated every render (a plain assignment, not an effect) so
  // the async goToIndex/close handlers below never close over stale props or
  // atom values, without needing a sprawling useCallback dependency array.
  const actionsRef = useRef<TourActions>(null as any)
  actionsRef.current = {
    state, setState, switchAppMode,
    sectionOpen, setSectionOpen, macroGroupOpen, setMacroGroupOpen,
    isSidebarOpen, setIsSidebarOpen,
    hillshadeXYPadOpen, setHillshadeXYPadOpen,
    taAdvanced, setTaAdvanced, rvAdvanced, setRvAdvanced,
    colorizeMapBorders, setColorizeMapBorders,
    comparisonMixAdvancedOpen, setComparisonMixAdvancedOpen,
  }

  // One stable ref-shaped object per step (across every branch — see
  // ALL_STEPS), populated by resolveAllRefs below right before Coachmark is
  // allowed to render/reposition against it — a plain mutable `{ current }`
  // object (not a real useRef, since building N real refs would need N hook
  // calls) structurally satisfies Coachmark's RefObject<HTMLElement | null>
  // target.
  const targets = useMemo(() => {
    const map: Record<string, { current: HTMLElement | null }> = {}
    for (const step of ALL_STEPS) map[step.key] = { current: null }
    return map
  }, [])

  const resolveAllRefs = useCallback(() => {
    for (const step of ALL_STEPS) {
      targets[step.key].current = document.getElementById(step.domId)
    }
  }, [targets])

  // Snapshot taken once, at the very start of a tour run — restored verbatim
  // on close so a user who takes the tour lands back exactly where they
  // started (sidebar/section/macro-group open state, every forced-on
  // visualization mode, and whichever app mode they were actually in) —
  // regardless of which branch they ended up exploring.
  const snapshotRef = useRef<null | {
    isSidebarOpen: boolean
    sectionOpen: Record<string, boolean>
    macroGroupOpen: Record<string, boolean>
    hillshadeXYPadOpen: boolean
    taAdvanced: boolean
    rvAdvanced: boolean
    colorizeMapBorders: boolean
    comparisonMixAdvancedOpen: boolean
    stateFields: Record<string, unknown>
  }>(null)

  // Guards goToIndex/chooseBranch's async prepare chain against overlapping
  // calls — e.g. Next clicked again before the previous transition's own
  // wait finished, or Coachmark's own internal transition (which runs BEFORE
  // ever calling onStepChange, i.e. before goToIndex even starts) takes long
  // enough that a second call starts in the meantime. Confirmed live: without
  // this, a slower stale chain resolving AFTER a newer one already committed
  // could call setStepIndex with ITS OWN (now stale) index, silently
  // reverting the visible step while the app state a differently-ordered
  // onEnter left behind stays put — stepper and panel state visibly
  // disagreeing on which step is "current". Each call stamps its own
  // generation; only the chain whose generation is still current when its
  // wait resolves is allowed to actually commit.
  const transitionGenerationRef = useRef(0)

  // Moves to `newIndex` within the CURRENT branch's step list: runs that
  // step's own onEnter (forcing whatever sidebar/section/mode state its
  // target needs to exist), waits for that to actually land in the DOM,
  // re-resolves every step's target fresh, then commits the index (and, the
  // very first time, opens the tour) so Coachmark only ever positions
  // against an already-settled DOM.
  const goToIndex = useCallback((newIndex: number) => {
    const step = activeSteps[newIndex]
    if (!step) return
    const generation = ++transitionGenerationRef.current
    step.onEnter?.(actionsRef.current)
    void waitForTarget(step.domId).then(() => {
      scrollTargetIntoView(step.scrollTargetId ?? step.domId, step.scrollBlock)
    }).then(() => waitForStableRect(step.domId)).then(() => {
      if (transitionGenerationRef.current !== generation) return
      resolveAllRefs()
      setStepIndex(newIndex)
      setOpen(true)
    })
  }, [activeSteps, resolveAllRefs])

  // The branch-choice step's two buttons — unlike goToIndex, this can't rely
  // on `activeSteps` (still the pre-choice list until React re-renders with
  // the new `branch` state), so it computes the post-choice list directly.
  const chooseBranch = useCallback((next: "terrain" | "historical") => {
    const steps = getStepsForBranch(next)
    const targetIndex = GENERAL_STEPS.length + 1
    const step = steps[targetIndex]
    const generation = ++transitionGenerationRef.current
    setBranch(next)
    step?.onEnter?.(actionsRef.current)
    void waitForTarget(step?.domId ?? "").then(() => {
      if (step) scrollTargetIntoView(step.scrollTargetId ?? step.domId, step.scrollBlock)
    }).then(() => waitForStableRect(step?.domId ?? "")).then(() => {
      if (transitionGenerationRef.current !== generation) return
      resolveAllRefs()
      setStepIndex(targetIndex)
    })
  }, [resolveAllRefs])

  const start = useCallback(() => {
    if (snapshotRef.current) return
    const a = actionsRef.current
    snapshotRef.current = {
      isSidebarOpen: a.isSidebarOpen,
      sectionOpen: a.sectionOpen,
      macroGroupOpen: a.macroGroupOpen,
      hillshadeXYPadOpen: a.hillshadeXYPadOpen,
      taAdvanced: a.taAdvanced,
      rvAdvanced: a.rvAdvanced,
      colorizeMapBorders: a.colorizeMapBorders,
      comparisonMixAdvancedOpen: a.comparisonMixAdvancedOpen,
      stateFields: Object.fromEntries(TOUR_STATE_KEYS.map((k) => [k, a.state[k]])),
    }
    setBranch(null)
    goToIndex(0)
  }, [goToIndex])

  const handleStepChange = useCallback((newIndex: number) => {
    goToIndex(newIndex)
  }, [goToIndex])

  const closeAndRestore = useCallback(() => {
    setOpen(false)
    const snap = snapshotRef.current
    const a = actionsRef.current
    if (snap) {
      a.setState(snap.stateFields)
      a.setSectionOpen(() => snap.sectionOpen)
      a.setMacroGroupOpen(() => snap.macroGroupOpen)
      a.setIsSidebarOpen(snap.isSidebarOpen)
      a.setHillshadeXYPadOpen(snap.hillshadeXYPadOpen)
      a.setTaAdvanced(snap.taAdvanced)
      a.setRvAdvanced(snap.rvAdvanced)
      a.setColorizeMapBorders(snap.colorizeMapBorders)
      a.setComparisonMixAdvancedOpen(snap.comparisonMixAdvancedOpen)
      snapshotRef.current = null
    }
    setStepIndex(0)
    setBranch(null)
    setIsTourRequested(false)
    setHasSeenTour(true)
  }, [setIsTourRequested, setHasSeenTour])

  // Coachmark's spotlight cutout lets clicks reach the actual live control
  // underneath it (that's the whole point of a spotlight) — but that control
  // is a real, unrelated part of the app's own DOM, not part of the popover
  // itself, so Base UI's dismiss-on-outside-press logic can't tell it apart
  // from clicking anywhere else and closes the tour. A press that lands
  // inside the CURRENT step's own target element, or inside some OTHER
  // portaled popup content it opened (a Select/Combobox/color-picker
  // dropdown renders to document.body, a sibling of the target, not a
  // descendant of it, hence the separate check), is treated as "interacting
  // with the lesson", not "leaving it".
  //
  // NOTE: this is a best-effort mitigation, not a full fix. Coachmark's own
  // internal `presentedOpen` state is already set false, synchronously,
  // before this callback ever runs (confirmed in its source) — even when we
  // return here without closing, Coachmark's own layout effect has to notice
  // the resulting resolvedOpen/presentedOpen mismatch and re-run its full
  // "preparing-open" sequence to bring the popup back, which can still be
  // visible as a brief interruption rather than a perfectly seamless
  // no-op. A guaranteed fix would mean patching coachmark's own dismiss
  // wiring, not something achievable through its public props.
  //
  // Plain DOM containment (checked directly below) covers checkboxes/sliders
  // reliably, but not every interaction: a native <button>'s own click can
  // still register as "outside" in some cases, and picking a Select item
  // definitely does (the listbox closes and, depending on timing, floating-ui
  // may evaluate the outside-press check against state that no longer shows
  // it as live-target-contained). lastLiveInteractionAtRef (kept warm by the
  // pointerdown listener effect just below) is a time-windowed backstop for
  // exactly those cases — "a press inside our own territory JUST happened"
  // is treated as still part of that same interaction for a short while
  // after, even if this particular dismiss-triggering event's own target
  // can't be pinned down as contained.
  const lastLiveInteractionAtRef = useRef(0)
  const isWithinLiveTerritory = useCallback((target: EventTarget | null) => {
    const currentStep = activeSteps[stepIndex]
    const liveTarget = currentStep ? targets[currentStep.key]?.current : null
    const withinLiveTarget = target instanceof Node && liveTarget?.contains(target)
    const withinPortaledControl = target instanceof Element && target.closest(PORTAL_CONTENT_SELECTOR)
    return Boolean(withinLiveTarget || withinPortaledControl)
  }, [activeSteps, stepIndex, targets])

  // Passive observer only — never prevents/stops anything, so it can't
  // interfere with the click actually reaching the control it's on (unlike
  // trying to intercept the SAME event to cancel Coachmark's own dismiss,
  // which would also have to block React's own delegated handling of it).
  // Listens on several event types since it's not certain which one actually
  // precedes a given control's own dismiss-triggering behavior — pointerdown
  // covers the common press-and-release case, focusin also catches a
  // keyboard-activated (Enter/Space) button that never fires a pointer event
  // at all.
  useEffect(() => {
    if (!open) return
    const markInteraction = (e: Event) => {
      if (isWithinLiveTerritory(e.target)) lastLiveInteractionAtRef.current = Date.now()
    }
    const events = ["pointerdown", "focusin", "click"] as const
    events.forEach((type) => document.addEventListener(type, markInteraction, true))
    return () => events.forEach((type) => document.removeEventListener(type, markInteraction, true))
  }, [open, isWithinLiveTerritory])

  const handleOpenChange = useCallback((nextOpen: boolean, eventDetails?: { reason?: string; event?: Event }) => {
    if (nextOpen) return // this component only ever opens via start()
    if (eventDetails?.reason === "outside-press") {
      const recentLiveInteraction = Date.now() - lastLiveInteractionAtRef.current < 1500
      if (isWithinLiveTerritory(eventDetails.event?.target ?? null) || recentLiveInteraction) return
    }
    closeAndRestore()
  }, [isWithinLiveTerritory, closeAndRestore])

  // External "please open" signal — the sidebar header button and Settings
  // dialog's "Take the Tour" entry both just flip isTourOpenAtom; this is
  // the one place that actually starts the (possibly async) prepare sequence.
  useEffect(() => {
    if (isTourRequested && !open && !snapshotRef.current) start()
  }, [isTourRequested, open, start])

  // Auto-start once, ever, on first visit — hasSeenTour flips true right away
  // (not just on finish) so a visitor who reloads mid-tour isn't re-prompted.
  // The delay lets the app's own URL-restored state/map settle first.
  //
  // Depends on `hasSeenTour` itself (not an empty array) deliberately:
  // atomWithStorage can render its default value on the very first tick
  // before syncing in the real persisted value from localStorage. An empty
  // dependency array would capture whatever `hasSeenTour` happened to be at
  // that first tick and never look again — if it started as the default
  // `false` and only became `true` a moment later, this effect would already
  // have queued its timer and would never notice the real value settling,
  // re-showing the tour on every reload despite it being marked seen.
  // Depending on the real value lets the effect re-run (and its cleanup
  // cancel the stale timer) the moment the persisted value actually arrives.
  useEffect(() => {
    if (hasSeenTour) return
    const t = setTimeout(() => {
      setHasSeenTour(true)
      setIsTourRequested(true)
    }, 1500)
    return () => clearTimeout(t)
  }, [hasSeenTour, setHasSeenTour, setIsTourRequested])

  // ←/→ step through the tour the same way clicking Back/Next would — looks
  // up the actual rendered button rather than re-deriving "what should Next
  // do" (last-step Finish vs. plain Next, first-step disabled Back), so this
  // can never drift out of sync with the click path. Ignored while typing in
  // any real input, so it doesn't hijack e.g. the search box or a text field.
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target
      const isTyping = el instanceof HTMLElement && (
        el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable
      )
      if (isTyping) return
      if (e.key === "ArrowRight") {
        const btn = document.querySelector('[data-tour-nav="next"]')
        if (btn instanceof HTMLElement) { e.preventDefault(); btn.click() }
      } else if (e.key === "ArrowLeft") {
        const btn = document.querySelector('[data-tour-nav="previous"]')
        if (btn instanceof HTMLElement && !btn.hasAttribute("disabled")) { e.preventDefault(); btn.click() }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open])

  const buttonBase = "cursor-pointer"
  // Whichever branch this ISN'T — drives the "curious about the other
  // mode?" suggestion on each branch's own last step (offerOtherBranch).
  const otherBranch: "terrain" | "historical" | null = branch === "terrain" ? "historical" : branch === "historical" ? "terrain" : null

  return (
    <>
      {/* Small fixed, invisible anchor for the "map viewport" and
          branch-choice steps — see MAP_ANCHOR_ID's comment above for why a
          real map-pane element doesn't work as either step's target. */}
      <div id={MAP_ANCHOR_ID} className="pointer-events-none fixed left-1/2 top-1/2 h-px w-px -translate-x-1/2 -translate-y-1/2" aria-hidden />
      <Coachmark.Root
        open={open}
        onOpenChange={handleOpenChange}
        stepIndex={stepIndex}
        onStepChange={handleStepChange}
        modal={false}
        // Left at Coachmark's own default (true) here — goToIndex's own
        // scrollTargetIntoView (see its comment) is the RELIABLE one and
        // always runs regardless, but disabling this globally turned out to
        // have its own cost: confirmed live it also skips some internal
        // re-measurement Coachmark does as part of its own scroll phase,
        // occasionally leaving a step positioned against a stale/wrong-sized
        // anchor rect even once our own scroll had already landed correctly.
        // Only individual steps whose scrollTargetId redirects OUR scroll
        // elsewhere disable this (scrollIntoView: false on their own
        // TourStepDef, below) — those are exactly the ones where leaving
        // Coachmark's own attempt aimed at the step's own domId would fight
        // with ours over the final scroll position.
        scrollIntoView
      >
      <Coachmark.Backdrop className="fixed inset-0 z-[60] bg-black/50 transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0" />
      {activeSteps.map((step) => {
        const flipToBottom = isNarrowViewport && (step.side === "left" || step.side === "right")
        const side = flipToBottom ? "bottom" : (step.side ?? "bottom")
        const align = flipToBottom ? "center" : (step.align ?? "center")
        const spotlightPadding = step.fullScreenSpotlight ? mapSpotlightPadding : (step.spotlightPadding ?? 8)
        return (
          <Coachmark.Step
            key={step.key}
            target={targets[step.key]}
            spotlightPadding={spotlightPadding}
            spotlightRadius={step.spotlightRadius ?? 8}
            scrollIntoView={step.scrollIntoView}
          >
            <Coachmark.Positioner
              side={side}
              align={align}
              sideOffset={step.fullScreenSpotlight ? 0 : 12}
              className={cn(
                "z-[70]",
                // fullScreenSpotlight steps have no real element to anchor
                // to — floating-ui's own side/align math positions off a
                // single centered point, but that's an edge (where the
                // popup's TOP lands), not the popup's own center, and a
                // post-hoc CSS shift to compensate doesn't reliably survive
                // floating-ui's own collision-avoidance pass (which only
                // knows about ITS un-shifted math, not a transform layered
                // on after). Overriding straight to a plain `inset + margin:
                // auto` box sidesteps floating-ui's placement entirely —
                // that CSS trick centers a fixed element of unknown size
                // perfectly on both axes, with no measurement or transform
                // math needed, immune to content length.
                step.fullScreenSpotlight && "!fixed !inset-4 !m-auto !h-fit !w-fit !transform-none",
              )}
            >
              <Coachmark.Popup
                className={cn(
                  "relative box-border flex w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]",
                  "origin-(--transform-origin) flex-col gap-3 rounded-md border bg-popover p-4",
                  "text-popover-foreground shadow-lg outline-hidden transition-[transform,opacity]",
                  "data-starting-style:scale-95 data-starting-style:opacity-0",
                  "data-ending-style:scale-95 data-ending-style:opacity-0",
                  // Belt-and-suspenders alongside the Positioner override
                  // above: caps how tall the popup can get so it can never
                  // exceed the `inset-4` frame it's centered within,
                  // scrolling its own content instead.
                  step.fullScreenSpotlight && "max-h-[calc(100vh-4rem)] overflow-y-auto",
                )}
              >
                <Coachmark.Stepper className="text-[0.68rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {({ stepIndex: i, stepCount }) => `Step ${i + 1} of ${stepCount}`}
                </Coachmark.Stepper>
                <div className="space-y-1.5">
                  <Coachmark.Title className="text-base font-semibold">{step.title}</Coachmark.Title>
                  {/* render={<div/>}: Popover.Description defaults to a <p>,
                      which can't legally contain the <ul> some step
                      descriptions (e.g. Keyboard Shortcuts) use. */}
                  <Coachmark.Description render={<div />} className="text-sm leading-5 text-muted-foreground">
                    {step.description}
                  </Coachmark.Description>
                </div>
                {step.kind === "branch" ? (
                  <div className="flex flex-col gap-2 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => chooseBranch("terrain")}
                        className={cn(buttonVariants({ variant: "default", size: "sm" }), buttonBase, "w-full")}
                      >
                        Terrain Tools
                      </button>
                      <button
                        type="button"
                        onClick={() => chooseBranch("historical")}
                        className={cn(buttonVariants({ variant: "default", size: "sm" }), buttonBase, "w-full")}
                      >
                        Historical Imagery
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Coachmark.Close className={cn(buttonVariants({ variant: "ghost", size: "sm" }), buttonBase)}>
                        Skip
                      </Coachmark.Close>
                      <Coachmark.Previous data-tour-nav="previous" keepMounted className={cn(buttonVariants({ variant: "outline", size: "sm" }), buttonBase)}>
                        Back
                      </Coachmark.Previous>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 pt-1">
                    {step.offerOtherBranch && otherBranch && (
                      <button
                        type="button"
                        onClick={() => chooseBranch(otherBranch)}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), buttonBase, "w-full h-auto whitespace-normal py-1.5 text-center leading-snug")}
                      >
                        Continue to {otherBranch === "historical" ? "Historical Satellite mode" : "the Terrain tools"} →
                      </button>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <Coachmark.Close className={cn(buttonVariants({ variant: "ghost", size: "sm" }), buttonBase)}>
                        Skip
                      </Coachmark.Close>
                      <div className="flex items-center gap-1.5">
                        <Coachmark.Previous data-tour-nav="previous" keepMounted className={cn(buttonVariants({ variant: "outline", size: "sm" }), buttonBase)}>
                          Back
                        </Coachmark.Previous>
                        <NextOrFinishButton className={cn(buttonVariants({ variant: "default", size: "sm" }), buttonBase)} />
                      </div>
                    </div>
                  </div>
                )}
              </Coachmark.Popup>
            </Coachmark.Positioner>
          </Coachmark.Step>
        )
      })}
      </Coachmark.Root>
    </>
  )
}
