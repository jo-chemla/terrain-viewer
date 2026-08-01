// Shared registry of basemap ids that are "historical" (date-driven, archival)
// sources — used to gate the sidebar's "Historical Basemaps" group, the
// historicalBeta toggle's tile-fetch gate (MapSources.tsx), and which options
// count as "historical" for RasterBasemapSection's split/non-split lists.
// Bing is deliberately NOT included here: it has no browsable archive (just
// one live mosaic) and stays a plain, always-available "Other Basemaps" entry
// alongside Google/HERE/Mapbox/ESRI — see TIMELINE_SOURCE_IDS below for where
// it's still included.
export const HISTORICAL_BASEMAP_IDS = new Set(["wayback", "hls", "ge-historical", "planet"])

// Superset of HISTORICAL_BASEMAP_IDS that also includes Bing — used only for
// "should the bottom timeline panel/minimap-offset react to this basemap
// selection", since Bing's real (if singular) capture date still deserves a
// spot on the timeline even though it's not beta-gated or sidebar-grouped
// with the others.
export const TIMELINE_SOURCE_IDS = new Set([...HISTORICAL_BASEMAP_IDS, "bing"])

export function isHistoricalSourceActive(state: {
  basemapPerView?: boolean
  splitScreen?: boolean
  basemapSource?: string
  basemapSourceA?: string
  basemapSourceB?: string
}): boolean {
  const a = state.basemapPerView ? state.basemapSourceA : state.basemapSource
  const b = state.basemapPerView ? state.basemapSourceB : state.basemapSource
  const dualMode = state.basemapPerView && state.splitScreen
  return TIMELINE_SOURCE_IDS.has(a ?? "") || (!!dualMode && TIMELINE_SOURCE_IDS.has(b ?? ""))
}
