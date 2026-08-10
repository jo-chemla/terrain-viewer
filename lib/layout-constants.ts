// Shared home for the map-viewport layout numbers that used to be duplicated
// independently in TerrainViewer.tsx's mapPadding and LightControlOverlay.tsx
// — the sidebar itself (TerrainControlPanel.tsx) is a floating overlay, not a
// flex sibling, so anything that needs to react to "how much space does it
// currently occupy" has to keep its own copy of these numbers in sync with
// the sidebar Card's own Tailwind classes (w-80 / sm:right-4 sm:w-96).
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import type { ViewId } from "./grid-layouts"

export const SIDEBAR_WIDTH_MOBILE = 320 // w-80
export const SIDEBAR_WIDTH_DESKTOP = 384 // sm:w-96
export const SIDEBAR_GAP_DESKTOP = 16 // sm:right-4
export const SIDEBAR_FOOTPRINT_DESKTOP = SIDEBAR_WIDTH_DESKTOP + SIDEBAR_GAP_DESKTOP

export function getSidebarFootprintPx(isSidebarOpen: boolean, isMobile: boolean): number {
  if (!isSidebarOpen) return 0
  return isMobile ? SIDEBAR_WIDTH_MOBILE : SIDEBAR_FOOTPRINT_DESKTOP
}

// Unified edge margin for MapLibre's own corner controls (nav/geolocate/
// geocoder/minimap/scale) — matches the sidebar/timeline panel's own Tailwind
// `4` spacing step (right-4/left-4/bottom-4/top-4 = 16px) instead of
// maplibre-gl.css's default 10px, so every floating element in the viewport
// reads as one consistent grid.
export const MAP_CTRL_EDGE_MARGIN_PX = 16

// Draggable A/B split-screen divider — persisted (like isSidebarOpenAtom)
// since it's a user layout preference, not per-session UI state. Only ever
// user-adjustable for gridLayout "2x1" (see TerrainViewer.tsx) — every other
// grid layout divides its panes into fixed, equal-width columns instead, by
// deliberate design (the user doesn't get a divider to drag per extra pane).
export const splitRatioAtom = atomWithStorage<number>("splitRatio", 0.5)
export const SPLIT_RATIO_MIN = 0.15
export const SPLIT_RATIO_MAX = 0.85
export const SPLIT_RESIZER_WIDTH_PX = 6

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Per-side color overrides for the grid/overlay comparison UI — defaults to
// lib/grid-layouts.ts's SIDE_COLORS; only the letters a user has actually
// repainted via the Compare and Blend section's color pickers get an entry
// here. Shared by the historical timeline panel's handles/pills and (when
// colorizeMapBordersAtom is on) each map pane's border, so both stay in sync.
export const sideColorOverridesAtom = atomWithStorage<Partial<Record<ViewId, string>>>("sideColorOverrides", {})

// Outlines each active map pane in its resolved side color (SIDE_COLORS,
// overridden by sideColorOverridesAtom) — purely cosmetic, off by default so
// it doesn't surprise anyone not using the comparison/grid features.
export const colorizeMapBordersAtom = atomWithStorage("colorizeMapBorders", false)

// Whether that border sits inset 3px from the pane edge (default, reads as a
// frame) or flush against it — dropping the inset doubles the stroke width
// (border-2 -> border-4) so a flush border doesn't read as thinner/weaker
// than the inset one it replaced.
export const colorizeMapBordersInsetAtom = atomWithStorage("colorizeMapBordersInset", true)

// Compare and Blend section's own "Advanced" (capture date / colorize
// borders / side colors) collapsible — persisted like every other
// section-local collapse toggle (isBasemapByodOpenAtom etc. in
// settings-atoms.ts) so it doesn't silently re-collapse on every reload.
export const isComparisonMixAdvancedOpenAtom = atomWithStorage("isComparisonMixAdvancedOpen", false)

// The historical timeline panel's own measured height (its outer bordered
// box, via ResizeObserver — see historical-timeline-panel.tsx), so
// TerrainViewer.tsx can clear it above the minimap/scale/attribution
// controls exactly, whatever that height actually is — expanded (title bar
// + pills) and minimal (no header row) modes render at genuinely different
// heights, so a single guessed constant was always wrong for one of them.
// Starts at 0 (panel not mounted yet / collapsed); TerrainViewer's own
// consumers fall back to a small static button-clearance value in that case.
export const historicalTimelinePanelHeightAtom = atom(0)
