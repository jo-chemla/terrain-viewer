---
name: url-loaded-data
description: How remote data enters through URL params (URL-as-source-id on any view, drawingUrl) and the split-view badge / swap / sort helpers — design choices and what is unverified
type: project
---

Added 2026-09-17, amended 2026-09-19 (see [[handoff-2026-09-19]] for the later state: terrainSourceA..H URL keys, sidebarCollapsed, scrollTo, bookmarksUrl).

**URL as a view's source.** `?sourceB=https://…tif`, `?basemapSourceC=…`, `?basemapSource=…` work on every view. The URL *is* the custom source's id (reactive effect `urlSourceKey` in `TerrainViewer.tsx`), so links are self-contained and every `find((s) => s.id === …)` resolver is untouched. `{z}` means terrarium / tms, anything else a COG; `terrainType` / `basemapType` override; one-shot `viaTitiler=1` sets `cogViaTitiler`. `terrainUrl` / `basemapUrl` (view A only, fixed `__embed_*__` id) predate this and were left alone.

**Why:** an id that only exists in the sender's localStorage makes a shared or iframed link render blank (terrain) or Google (basemap) for everyone else.

**`drawingUrl`** became a nuqs list field (comma-separated; legacy repeated params are migrated in `lib/url-keys.ts`), mirrored into `drawingUrlsAtom` for the drawing system by `TerrainControlPanel`. Layers it creates carry `DrawLayer.sourceUrl`; they are skipped by OPFS hydration and persistence and refilled (same layer id, so name and colours survive) on every load. A URL pasted in the Drawing panel is a one-off copy, persisted like a file import.

**Parsing** lives in `lib/remote-vector.ts`: GeoJSON, KML and GPX via `@tmcw/togeojson`, FlatGeobuf and Shapefile via loaders.gl with dynamic imports. Both loaders were verified in Node only. `TerraDrawSystem.tsx` still carries an old comment that loaders.gl breaks Vite's dev server; if the dynamic imports fail in dev, add the two packages to `optimizeDeps.exclude` in `vite.config.ts` like core and geopackage. The dead commented-out GeoPackage import was removed with the `importFile` rewrite (git history has it).

**Split-view helpers.** `permuteViewsUpdates` in `lib/grid-layouts.ts` moves a view's whole content (terrain source plus the basemap / date / historicalActiveSource / timelineSources quartet, the quartet only while `basemapPerView`). It backs both the pane badge's swap-with-A and the timeline's sort-by-date. `timelineActiveSideAtom` (`lib/layout-constants.ts`) replaced the timeline panel's local `activeSide` state so each pane's date pill can set it (the first version used coloured letter badges on the panes; the user found them too heavy, so selection lives in the pill label, uncoloured, bold when selected, with the swap arrows after it, and both are stripped from snapshots via `data-snapshot-plain` / `data-snapshot-ignore`); a pill click counts as "in the panel" for the arrow-key gate through `data-timeline-side-select`.

**How to apply:** none of this was exercised in a real browser when written. See [[handoff-catalogue-search]] for the other open verification items.
