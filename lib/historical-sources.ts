// Shared registry of basemap ids that are "historical" (date-driven) sources —
// used to gate the sidebar's "Historical Basemaps" group, the bottom timeline
// panel's visibility, and the minimap's bottom-left offset so they all agree
// on the same definition as new sources (HLS, GE historical) are added.
export const HISTORICAL_BASEMAP_IDS = new Set(["wayback", "hls", "ge-historical", "planet"])

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
  return HISTORICAL_BASEMAP_IDS.has(a ?? "") || (!!dualMode && HISTORICAL_BASEMAP_IDS.has(b ?? ""))
}
