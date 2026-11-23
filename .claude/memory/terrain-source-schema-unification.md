---
name: terrain-source-schema-unification
description: Done 2026-11-23 (branch source-schema): built-in terrain sources, library entries and user sources are one TerrainSourceEntry; one lookup (findTerrainSource) and resolver; GEM-15 a real default
type: project
---

# One schema for built-in and library terrain sources (done 2026-11-23)

Asked by Jonathan on 2026-11-21, "note for later, we'll want to tackle that".

Today `lib/terrain-sources.ts` (Worldwide Defaults: `{ name, link, encoding, sourceConfig: { tiles, tileSize, maxzoom } }`, typed by the `TerrainSource` union) and `lib/custom-sources.json` (`{ id, name, url, type, minzoom, maxzoom, bounds, ... }`, typed `CustomTerrainSource`) are two shapes. Every consumer branches on which one it got: `getTilesUrl` / `getSourceConfig` in `lib/controls-utils.tsx`, `lib/client-export.ts`, `ContoursLayer.tsx` (contours resolve built-ins only, plus a few custom types), `MapSources.tsx`, the info dialog's GDAL commands (`source-info-dialog.tsx`, built-ins only), `docs/scripts/build-stac-catalog.mjs`, and the MCP's `dem.mjs` / tile service `/sources`.

**Why:** GEM-15 was wanted as a Worldwide Default (last, slower) but is a library entry (`gem15://` cell routing, zoom floor, titiler switch). It is shown there as a pinned row (`PINNED_LIBRARY_DEFAULTS` in `terrain-source-section.tsx`) that loads the library entry into Bring Your Own Data and selects it, a workaround. Jonathan prefers a real built-in: same schema, only what each section surfaces differs. He also expects a GDAL WMS XML, contours and export to work for almost every source type, not only built-ins.

**How to apply:** when touching source resolution, move toward one `TerrainSourceEntry` type (the library shape is the richer one) with a `section`/`pinned` field, make built-ins entries of it, and route contours, export and GDAL commands through one resolver. Then drop `PINNED_LIBRARY_DEFAULTS`.

**Step 1 done (2026-11-21):** `lib/terrain-tile-spec.ts` (`terrainTileSpec`, `terrainTileInputs`, `terrainTileExtras`, `builtinTileUrl`, `makeElevationColorFunction`) is the pure resolver for both shapes, used by `useClientDemUpstreamOne` (MapSources.tsx) and by the tile service / MCP in Node (`tile-server/app-sources.ts` `resolveTerrainTiles`, `tile-server/dem.mjs`). `TerrainSources`' own raster-dem config (handed to MapLibre) still has its own branch: titiler flat-nodata, cog:// declared by TileJSON url, wms-raw as a single float32dem:// GetMap template. Next: fold that branch in, then contours, export and GDAL commands.

**Done (2026-11-23, branch `source-schema`):** `lib/source-schema.ts` is the record (`CustomTerrainSource`/`CustomBasemapSource` in settings-atoms are aliases of it). Built-ins are `BUILTIN_TERRAIN_SOURCES` entries (`apiKey` for Mapbox/MapTiler/Cesium, url `ion/1` for Cesium, plain https for Esri LERC). `lib/terrain-catalog.ts`: `WORLDWIDE_DEFAULTS` (built-ins + library entries with `section: "defaults"`, GEM-15), `findTerrainSource(id, customs)` (user copy wins), `withWorldwideDefaults`. Every reader uses that lookup: no built-in branch left in MapSources, ContoursLayer, terrain-tile-spec (`pyramidTileSize` honours an entry's tileSize for plain pyramids), client-export, controls-utils (`gdalTileSource`: GDAL commands for every source GDAL can read). `PINNED_LIBRARY_DEFAULTS` removed. The camera only follows the zoom range of non-built-in entries (`followsSourceRange` in TerrainViewer), so GEM-15 keeps its clamp. Tile service: build.mjs writes built-ins + library into library.json; dem.mjs keys by `apiKey`. Basemaps: `lib/basemap-sources.ts` holds the fixed-address ones; dated imagery and the OSM vector style are not entries. Docs: /dev/source-schema.
