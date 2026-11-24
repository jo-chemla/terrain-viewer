// The parts of the app's own code the MCP server reuses, bundled for Node by
// `pnpm build` (esbuild) into generated/app-lib.mjs. One source of truth: the
// catalog searches are the ones the timeline runs in the browser.
export { loadCatalogTicks, TIMELINE_CATALOGS, catalogBasemap } from "../lib/timeline-catalogs"
export { NATIONAL_SOURCES } from "../lib/national-historical"
export { stacCatalogId, isStacCatalogId } from "../lib/timeline-catalogs"
// The dated imagery (Wayback, Google Earth historical, EOX, Bing, ...): each
// source's catalog of dates at a place and the tiles of a date
// (lib/dated-imagery.ts), as the map, the timeline and the export read them.
export { DATED_IMAGERY_SOURCES, NATIONAL_DATED_SOURCES, STAC_DATED_SOURCES, ALL_DATED_IMAGERY_SOURCES, findDatedImagery } from "../lib/dated-imagery"
export { nationalLayerBasemapId } from "../lib/national-dated"
export { STAC_DATED_CATALOGS, stacItemHref } from "../lib/stac-dated"
export { TIMELAPSE_FIRST_YEAR, TIMELAPSE_LAST_YEAR } from "../lib/google-timelapse"
// The colour ramps and their rescaling, for the tile service's direct engine
// (direct.mjs), which colours elevation and slope grids without a map.
export { colorRampsFlat, remapColorRampStops } from "../lib/color-ramps"
export { default as chroma } from "chroma-js"
