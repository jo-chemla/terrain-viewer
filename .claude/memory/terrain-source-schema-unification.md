---
name: terrain-source-schema-unification
description: To do (Jonathan, 2026-11-21): built-in terrain sources and library entries should share one schema; only which section surfaces them differs
type: project
---

# One schema for built-in and library terrain sources (to do)

Asked by Jonathan on 2026-11-21, "note for later, we'll want to tackle that".

Today `lib/terrain-sources.ts` (Worldwide Defaults: `{ name, link, encoding, sourceConfig: { tiles, tileSize, maxzoom } }`, typed by the `TerrainSource` union) and `lib/custom-sources.json` (`{ id, name, url, type, minzoom, maxzoom, bounds, ... }`, typed `CustomTerrainSource`) are two shapes. Every consumer branches on which one it got: `getTilesUrl` / `getSourceConfig` in `lib/controls-utils.tsx`, `lib/client-export.ts`, `ContoursLayer.tsx` (contours resolve built-ins only, plus a few custom types), `MapSources.tsx`, the info dialog's GDAL commands (`source-info-dialog.tsx`, built-ins only), `docs/scripts/build-stac-catalog.mjs`, and the MCP's `dem.mjs` / tile service `/sources`.

**Why:** GEM-15 was wanted as a Worldwide Default (last, slower) but is a library entry (`gem15://` cell routing, zoom floor, titiler switch). It is shown there as a pinned row (`PINNED_LIBRARY_DEFAULTS` in `terrain-source-section.tsx`) that loads the library entry into Bring Your Own Data and selects it, a workaround. Jonathan prefers a real built-in: same schema, only what each section surfaces differs. He also expects a GDAL WMS XML, contours and export to work for almost every source type, not only built-ins.

**How to apply:** when touching source resolution, move toward one `TerrainSourceEntry` type (the library shape is the richer one) with a `section`/`pinned` field, make built-ins entries of it, and route contours, export and GDAL commands through one resolver. Then drop `PINNED_LIBRARY_DEFAULTS`.
