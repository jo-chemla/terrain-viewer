// The parts of the app's own code the MCP server reuses, bundled for Node by
// `pnpm build` (esbuild) into generated/app-lib.mjs. One source of truth: the
// catalog searches are the ones the timeline runs in the browser.
export { loadCatalogTicks, TIMELINE_CATALOGS, catalogBasemap } from "../lib/timeline-catalogs"
export { NATIONAL_SOURCES } from "../lib/national-historical"
export { stacCatalogId, isStacCatalogId } from "../lib/timeline-catalogs"
export { listWaybackTicksInRange } from "../lib/wayback"
export { listGeHistoricalTicksInRange } from "../lib/ge-historical"
export { TIMELAPSE_FIRST_YEAR, TIMELAPSE_LAST_YEAR } from "../lib/google-timelapse"
// The colour ramps and their rescaling, for the tile service's direct engine
// (direct.mjs), which colours elevation and slope grids without a map.
export { colorRampsFlat, remapColorRampStops } from "../lib/color-ramps"
export { default as chroma } from "chroma-js"
