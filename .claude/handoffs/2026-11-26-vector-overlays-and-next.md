# Handoff 2026-11-26: vector overlays, then RiverREM app mode and a QGIS historical mode

From the long thread that shipped QGIS plugin 0.3 to 0.9.2, the tile service's `/terrain-sources`, building shadows, live GPU shadows and the MapLibre blend-mode PRs. Everything from that thread is fixed or answered. Read `.claude/CLAUDE.md` and `.claude/memory/MEMORY.md` first.

## Working rules the user set (keep them)

- Everything merges straight to `main` (`git push origin main` reaches both remotes). Never push from a clone made before the 2026-11-13 history rewrite.
- Heavy media never goes in git: screenshots on the `docs-media` release (`pnpm docs:media:push`, commit `docs/media.lock`), anything tracked ≤ 600 KB (`node scripts/check-media.mjs`).
- `CHANGELOG.md`: one entry per day with a TL;DR, a `<!-- released: … -->` marker, QGIS bullets in their own "##### QGIS Plugins" group (`.claude/memory/changelog-style.md`, `lib/changelog.test.ts`). If you delegate, subagents don't edit it; you fold their summaries in.
- API keys and tokens (`.env`, QGIS ini files, `EARTHDATA_TOKEN`) are never printed, committed or put in prompts. Never put the user's email in QGIS plugin metadata or any outside request.
- After any QGIS plugin change, install it into both profiles (`%APPDATA%\QGIS\QGIS3\…\plugins` and `QGIS4`), verify with `diff -rq --strip-trailing-cr`. Releases go through `.github/workflows/qgis-plugins.yml` with a new `release_tag` (see `docs/content/docs/dev/releases.mdx`).
- QGIS screenshots are window-only captures, never the full screen.
- "Color", not "colour", in UI and docs.
- One "Open for you / Open for me" list at the end of a reply, after all agents resolve.
- The agent browser does not fire `requestAnimationFrame`: map rendering is checked by the user in a real browser.

## 1. Vector overlays (the main run)

A new `vector` source kind in the Library plus an overlay renderer in the web app (and later the tile service and QGIS plugin), starting with open building footprints:

- Overture Maps buildings (PMTiles / GeoParquet releases), VIDA combined Google + Microsoft open buildings (source.coop), Microsoft Global ML Building Footprints.
- Notes already written: `docs/content/docs/dev/source-schema.mdx` ("Planned: vector overlays"). The source schema is `lib/source-schema.ts`; the Library lists are `lib/custom-sources.json` and `lib/projects.json`; the catalog lookup is `lib/terrain-catalog.ts`.
- Rendering: MapLibre vector layers (fill / line / fill-extrusion), draped on terrain, colored by source or height, with opacity and a layer-blend option (the app already uses `*-layer-blend`). Respect the layer order (`docs/content/docs/dev/layer-order.mdx`) and split views (A–H): one source per view must not remount maps.
- Building heights could feed the existing building shadows (tile service `buildings` path and the QGIS `live/buildings.py`).
- Docs page, CHANGELOG entry, Library entries with licence notes.

## 2. RiverREM as an app mode (later, "an amazing feature")

Port River-REM (`docs/content/docs/features/river-rem.mdx` covers what exists) as an `appMode`, reusing its controls:

- River centerline chosen manually (terra-draw) or automatically from OSM: the longest named river in view, all rivers, a selected river.
- Live only: no Python River-REM backend. Compute the river's trend surface with our approximate algorithms (e.g. inverse-distance interpolation of centerline elevations sampled from the DEM), then detrend the DEM (REM = elevation − trend) as a live protocol with a color ramp.

## 3. A historical mode in the QGIS plugin (later; skip if too complex)

Like the web app's app modes: a historical mode closer to the bottom timeline panel, with sidebar control of the basemap (worldwide defaults, historical sources, eventually catalogs and source coverage). Find how to show the dates as ticks on QGIS's temporal controller / timeline. If it gets too complex, don't do it yet and say why.

## State at handoff

- QGIS plugin 0.9.2 (release `qgis-plugins-2026-11-26c`): Open link reads web-app links over the app's defaults, loads the basemap, light section open, contours black.
- Desktop: the update loop came from the running tile service locking the app folder (fixed in `ae27895`). It reaches users once the Desktop workflow is run by hand.
- MapLibre: maplibre/maplibre-style-spec#2017 and maplibre/maplibre-gl-js#9143 (ten more W3C blend modes; render tests for fill, line, raster). gl-js CI is red until the spec release.
- Known open bug: the tile service's VRT reader reads 3.2 m off and ignores feet units.
