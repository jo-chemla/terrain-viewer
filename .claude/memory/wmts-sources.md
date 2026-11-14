---
name: wmts-sources
description: WMTS capabilities parsed in lib/wmts-client.ts; a matrix set qualifies by its numbers (CRS, corner, scales, power-of-two widths), not its name; what is unverified in a real browser
type: project
---

# WMTS sources (2026-11-14)

- `lib/wmts-client.ts` parses GetCapabilities with DOMParser (local names, namespace-blind) and builds a `{z}/{x}/{y}` template; saved as a custom basemap of type `wmts` (the source builder passes it through like `tms`). Picker: `wmts-picker-panel.tsx` (Add Basemap, type `wmts-picker`). STAC: `stacWmtsRefs` / `resolveStacWmts`, buttons in `stac-search-panel.tsx` (basemap target only).
- Do not trust matrix set names: IGN France calls its Google grid `PM_*`, swisstopo `3857_*`, GIBS `GoogleMapsCompatible_LevelN`, PNOA has both `GoogleMapsCompatible` and `EPSG:3857` and writes the corner rounded to `2.0037508E7` (20 m tolerance needed). z = log2(MatrixWidth); identifiers map to z through one `{prefix}{z}{suffix}` pattern (PNOA's 4326 set uses `EPSG:4326:5`).
- swisstopo's REST template is `{TileCol}/{TileRow}` (x before y) and hardcodes `3857` instead of `{TileMatrixSet}`; GIBS lists two templates per format, with and without `{Time}`: pick the one carrying the dimension.
- All four reference services (GIBS, IGN France, PNOA, swisstopo) send `Access-Control-Allow-Origin: *` on capabilities and tiles. `npx tsx scripts/wmts-check.ts` re-checks them (Node DOMParser shim inside).
- Unverified in a real browser: the picker UI, drawing the saved layers, the STAC WMTS buttons in VEDA, the Auto switch. Not done: dimension values are frozen at save time (not tied to the timeline date); attribution is stored, not shown in the map control. Details: docs/content/docs/dev/wmts.mdx.
