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

export function getSidebarFootprintPx(isSidebarOpen: boolean, isMobile: boolean, isBottomSheet = false): number {
  if (!isSidebarOpen || isBottomSheet) return 0
  return isMobile ? SIDEBAR_WIDTH_MOBILE : SIDEBAR_FOOTPRINT_DESKTOP
}

// Phone in portrait (useIsBottomSheet): the side panel is a bottom sheet.
// Collapsed is isSidebarOpenAtom false (so the map tap that closes the panel,
// the tour that opens it and ?sidebarCollapsed all keep working); open, it
// sits at one of two heights, held here. Ephemeral: every load opens at half.
export type BottomSheetSnap = "half" | "full"
export const bottomSheetSnapAtom = atom<BottomSheetSnap>("half")
/** The open sheet's height as a fraction of the app's height at "half". */
export const BOTTOM_SHEET_HALF_FRACTION = 0.5
/** The map strip left above the sheet at "full", below the top safe area. */
export const BOTTOM_SHEET_FULL_GAP_PX = 64
/** The collapsed sheet's height (grab handle + title row + bottom safe
 *  area), measured by TerrainControlPanel; 0 when there is no sheet. The
 *  sheet is the lowest panel of the bottom stack: this lifts the profile
 *  dock, the timeline panel and every bottom control, the same way
 *  profileDockHeightAtom does, so with the sheet collapsed they sit just
 *  above its bar. An open sheet covers them (it is on top) without moving
 *  them. */
export const bottomSheetBarHeightAtom = atom(0)

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
/** Height of the docked elevation profile (components/ProfileDock.tsx), 0
 *  when not shown: the lowest panel of the bottom stack, which lifts the
 *  timeline panel and every bottom control by this much. */
export const profileDockHeightAtom = atom(0)
/** How far the docked profile lifts the panels and controls above it. */
export const profileDockLiftPx = (heightPx: number, isMobile: boolean): number =>
  heightPx > 0 ? Math.round(heightPx + (isMobile ? 0 : 12)) : 0

// Which view the historical timeline's arrow keys / track clicks act on.
// Shared (it used to be the panel's own useState) so each map pane's letter
// badge in TerrainViewer can show and set it too. `armed` mirrors the
// panel's "last click was on me" gate for the arrow keys: a badge click
// arms it from outside the panel.
export const timelineActiveSideAtom = atom<ViewId>("A")
/** The selected overlay pill on the timeline (a catalog item id) when the
 *  arrow keys should move that overlay rather than the view's handle; null
 *  selects the handle. See historical-timeline-panel.tsx. */
export const timelineActiveOverlayAtom = atom<string | null>(null)
