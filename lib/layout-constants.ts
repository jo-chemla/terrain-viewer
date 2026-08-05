// Shared home for the map-viewport layout numbers that used to be duplicated
// independently in TerrainViewer.tsx's mapPadding and LightControlOverlay.tsx
// — the sidebar itself (TerrainControlPanel.tsx) is a floating overlay, not a
// flex sibling, so anything that needs to react to "how much space does it
// currently occupy" has to keep its own copy of these numbers in sync with
// the sidebar Card's own Tailwind classes (w-80 / sm:right-4 sm:w-96).
import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

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
// since it's a user layout preference, not per-session UI state.
export const splitRatioAtom = atomWithStorage<number>("splitRatio", 0.5)
export const SPLIT_RATIO_MIN = 0.15
export const SPLIT_RATIO_MAX = 0.85
export const SPLIT_RESIZER_WIDTH_PX = 6

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// The historical timeline panel's own measured height (its outer bordered
// box, via ResizeObserver — see historical-timeline-panel.tsx), so
// TerrainViewer.tsx can clear it above the minimap/scale/attribution
// controls exactly, whatever that height actually is — expanded (title bar
// + pills) and minimal (no header row) modes render at genuinely different
// heights, so a single guessed constant was always wrong for one of them.
// Starts at 0 (panel not mounted yet / collapsed); TerrainViewer's own
// consumers fall back to a small static button-clearance value in that case.
export const historicalTimelinePanelHeightAtom = atom(0)
