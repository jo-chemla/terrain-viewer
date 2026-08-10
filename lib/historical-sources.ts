import { GRID_LAYOUTS, viewFieldName, type GridLayoutId } from "./grid-layouts"

// Shared registry of basemap ids that are "historical" (date-driven, archival)
// sources — used to gate the historicalBeta toggle's tile-fetch gate
// (MapSources.tsx) and to resolve the sidebar's single combined "historical"
// basemap entry down to a concrete underlying source id.
// Bing is deliberately NOT included here: it has no browsable archive (just
// one live mosaic) and stays a plain, always-available "Other Basemaps" entry
// alongside Google/HERE/Mapbox/ESRI — see TIMELINE_SOURCE_IDS below for where
// it's still included (its pill still works inside the combined historical
// entry's timeline, it just isn't itself one of the 4 nested sources).
export const HISTORICAL_BASEMAP_IDS = new Set(["wayback", "hls", "ge-historical", "planet", "eox-s2"])

// Superset of HISTORICAL_BASEMAP_IDS that also includes Bing — used only for
// "should the bottom timeline panel/minimap-offset react to this basemap
// selection", since Bing's real (if singular) capture date still deserves a
// spot on the timeline even though it's not one of the nested sources.
export const TIMELINE_SOURCE_IDS = new Set([...HISTORICAL_BASEMAP_IDS, "bing"])

// The sidebar exposes exactly one "Historical Imagery" basemap entry
// (basemapSource === "historical") instead of 4 separate rows. Which concrete
// underlying source (wayback/hls/ge-historical/planet) actually renders for a
// given side is tracked separately (state.historicalActiveSource(A/B),
// TerrainViewer.tsx) — this resolves the two into the concrete id everything
// downstream (RasterBasemapSource, the timeline panel) already expects. Bing
// bypasses this entirely: picking a Bing tick sets basemapSource(A/B) =
// "bing" directly, never "historical".
export function resolveActiveHistoricalSource(rawBasemapSource: string, historicalActiveSource: string): string {
  return rawBasemapSource === "historical" ? historicalActiveSource : rawBasemapSource
}

export function isHistoricalSourceActive(state: {
  basemapPerView?: boolean
  splitStyle?: string
  gridLayout?: GridLayoutId
  appMode?: string
  basemapSource?: string
  [key: string]: any
}): boolean {
  const isActive = (v?: string) => v === "historical" || TIMELINE_SOURCE_IDS.has(v ?? "")
  const isSplit = state.splitStyle !== "off"
  // Per-view basemap AND split both on ("dual mode", historical-timeline-
  // panel.tsx's own name for this) — the timeline panel's own showFor now
  // requires each view to ACTUALLY be on a historical source (no more
  // proposed/preview pill for a view that isn't), so this checks the same
  // thing here: true the moment ANY currently-active view is historical, not
  // unconditionally. Mirrors TerrainViewer.tsx's own effectiveGridLayout for
  // which views count as "active" (overlay split, or outside Historical
  // appMode, is always just the 2x1 A/B pair regardless of state.gridLayout).
  if (state.basemapPerView && isSplit) {
    const layout: GridLayoutId = (state.splitStyle === "overlay" || state.appMode !== "historical") ? "2x1" : (state.gridLayout ?? "2x1")
    return GRID_LAYOUTS[layout].grid.flat().some((side) => isActive(state[viewFieldName(side, "basemapSource", true)]))
  }
  // No per-view basemap at all: only the one shared field can ever be active,
  // regardless of split/grid state.
  if (!state.basemapPerView) return isActive(state.basemapSource)
  // Per-view but NOT split: same single-view semantics as the timeline
  // panel's own non-dual-mode showFor, just for view A's own suffixed field.
  return isActive(state[viewFieldName("A", "basemapSource", true)])
}
