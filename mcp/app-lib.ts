// The parts of the app's own code the MCP server reuses, bundled for Node by
// `pnpm build` (esbuild) into generated/app-lib.mjs. One source of truth: the
// catalog searches are the ones the timeline runs in the browser.
export { loadCatalogTicks, TIMELINE_CATALOGS, catalogBasemap } from "../lib/timeline-catalogs"
export { NATIONAL_SOURCES } from "../lib/national-historical"
