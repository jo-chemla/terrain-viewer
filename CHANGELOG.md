# Changelog — GPU Terrain Shadows, Quantized Mesh, Tile Service on the Desktop

<!-- released: 2026-11-26T13:30 -->

#### TL;DR

- **[River REM mode](/docs/features/river-rem)**: height above the river, computed live in the browser, showing terraces, old channels and meander scars. The river comes from OpenStreetMap (the longest in view, all, or one picked by name) or from a line you draw; ramp, range and log stretch as in RiverREM, hillshade on top, export as GeoTIFF, every setting in the link.

  ![The River REM mode over the Allier upstream of Moulins](/docs/screenshots/river-rem-mode-allier.jpg)
- **[Vector overlays: buildings and heritage](/docs/features/vector-overlays)**: Overture Maps, VIDA's Google + Microsoft + OpenStreetMap merge and OpenStreetMap buildings, flat or in 3D; Heritage Watch AI's heritage map (Wikidata, OpenStreetMap, what OSM marks destroyed or damaged, national inventories) and UNESCO's World Heritage List; OpenStreetMap roads and labels; and your own PMTiles archive, TileJSON, MapLibre style or GeoJSON. One choice per view in a split, under Basemaps and Overlays › Bring Your Own Data › Vector overlays.

  ![Overture Maps buildings over Midtown Manhattan, extruded and colored by height](/docs/screenshots/vector-overlays-overture-nyc-3d.jpg)
- **[QGIS plugin 0.9.3, and 0.10.0 in the repository](/docs/dev/qgis-plugin)**: Basemap is a row of the modes tree, with a select for its source; a hillshade over a raw COG such as Canada's NRCan now shows. 0.10.0 adds a Historical mode (clock): Esri Wayback's capture dates at the map's centre and EOX's yearly Sentinel-2 mosaics, stepped by QGIS's own Temporal Controller. It updates itself (from its own plugin repository, or a button in the panel); the Python backend comes first and reads any elevation GDAL opens, including WMS and COG Library sources such as France's IGN LiDAR HD or Canada's MRDEM; sources grouped, opacity in each row, modes reordered.
- **[Two-date composite](/docs/features/split-modes#two-date-composite)**: two new blend modes of the Overlay split. Both dates in grey, each tinted with its view's color (cyan and red), added: what did not change is grey, what is only in one date takes its color. One for bright changes, one for dark ones.
- **Also**: blobness orientation gives the direction a feature runs (a north-south ridge reads 0°); new in the Library, the Holmul lidar DEM (Guatemala), Pennsylvania's PAMAP hillshade and Sardinia's 1 m and 10 m hillshades.

#### Details

##### QGIS Plugins

- **0.10.0** (in the repository, not on a release yet): a Terrain / Historical switch at the top of the panel. Historical lists Esri Wayback's real capture dates at the canvas centre and EOX Sentinel-2 cloudless by year, under every backend (the dates are a Python port, `terrain_viewer/historical.py`; the tile service lists none). Each date is an XYZ layer with a fixed temporal range in a "Historical imagery" group, and the canvas's temporal navigation is set to the irregular "source timestamps" step, so the Temporal Controller's slider has one stop per capture and stays in step with the panel's list and time axis. Open link reads `appMode=historical`. Not yet: Google Earth historical, Planet, HLS, the catalogs.
- **0.9.3** (release [`qgis-plugins-2026-11-26d`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-26d)): Basemap is a row of the modes tree under Elevation Hypso (checkbox, opacity, a source select under the cog: the app's built-in basemaps, the keyed ones once their key is set), for every backend; Open link drives the same row. Fix: a raw elevation input hid the modes ("Raw elevation inputs" now stays under "Terrain Viewer (live)" and its grey follows the view), so a hillshade on NRCan's 84 GB COG shows. The Python backend reads 256 px windows from the overviews, never the whole file (28 to 40 tiles for a canvas). Tile service bundle for Linux arm64.
- **0.9.2** (`8556b4b`, release [`qgis-plugins-2026-11-26c`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-26c)): Open link reads a link as the web app does (the app's defaults for what the link leaves out, any address or a bare query), loads the basemap, keeps the project's CRS; the Light section is open by default; contours are black.
- **0.9.1** (`cbfcdaf`, release [`qgis-plugins-2026-11-26b`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-26b)): blobness orientation as in the web app, bundles rebuilt.
- **0.9.0** (`9f5f902`, `2176473`, release [`qgis-plugins-2026-11-26`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-26)): updates through a QGIS plugin repository (`plugins.xml` at `https://github.com/Iconem/terrain-viewer/releases/download/qgis-plugins-repository/plugins.xml`, add it once in Plugin Manager › Settings) and an "Update to x.y.z" button in the panel (daily check, sha256, reload); the first mode in a fresh project sets EPSG:3857 and the whole world, later ones keep the canvas; opacity slider in each mode row; Hillshade above Elevation Hypso, overlays ordered Contours, Iso-line, Plane slicer, Graticule, Mound candidates; backends ordered Python (default for new users), Packaged, Remote; the light pad redraws as fast as the canvas does; COG, VRT, raw Float32 WMS, WCS and ArcGIS image Library sources read by the Python backend (IGN LiDAR HD, NRCan MRDEM, AHN, 3DEP tested), and a source it can't read draws nothing instead of Mapterhorn; sources grouped (QGIS elevation layers, Worldwide defaults, Terrain library) with a button adding the raw input to a "Raw elevation inputs" group; only contours labelled, at half the size; the Python server binds its port exclusively.

##### River REM, vector overlays

- River REM (`3930264`, `ac7c1fb`, `d9ec472`): `appMode=rem`. OSM ways of one name joined and cut at the view (Overpass, several mirrors, the first answer taken); the DEM read at 1000 points along the line; the profile cleaned downstream (running minimum, monotone fit or off); the trend by inverse-distance weighting over the k nearest samples on a 256-cell grid (RiverREM's defaults: power 1, k from the sinuosity); REM = elevation − trend as a `riverrem://` protocol in a `RIVER_REM` slot. Against RiverREM: a coarse trend grid, Web Mercator distances, view A's terrain source on every view. "Longest named river" is RiverREM's rule and can pick a winding tributary: pick by name then.
- Vector overlays (`bb12c99`, `c6d710d`): a third source kind, `vector`, in `lib/source-schema.ts`; four entries in `SAMPLE_VECTOR_SOURCES` (Overture's release read from its STAC catalog, since old releases answer 410); `lib/vector-sources.ts` builds the MapLibre source and its fill, line and fill-extrusion layers; a `VECTOR_OVERLAYS` slot above the shading and under the contours, and an `OVERLAYS_TOP` slot for raster overlays set to "On top"; `vectorOverlayIds` (and `B` to `H`) in the link, the style kept in the browser. Microsoft's footprints have no entry of their own (files, not tiles; both archives carry them). Not yet: your own vector sources, a blend mode per overlay, shadows from these heights.
- Your own vector sources: `lib/vector-source-detect.ts` reads a PMTiles header and metadata, a TileJSON, a tile template or a MapLibre style into a `VectorSourceEntry` kept in `customVectorSourcesAtom`; polygons, lines and points are drawn, from the source's own first zoom.
- Red / Cyan composite: `splitBlendMode=red-cyan`, drawn as `screen` with two blended boxes over each pane (a grey one as `saturation`, the tint as `multiply`), so no SVG filter; the snapshot repeats the two fills on the canvases. The TODO note is gone with it.
- EOX Sentinel-2 cloudless: 2016 answered 404 (its layer has no year in its name) and 2017 was missing from the list; both fixed in `lib/eox-s2-cloudless.ts`.
- Vector overlays, second pass: `categories` (color by origin, kind or condition; one color per publisher on every source), `companions` (a points archive and a shapes archive under one switch), a `geojson` transport; flat or 3D and color by are shared by every overlay; a Vector library dialog; the section is "Basemaps and Overlays". View colors: A is cyan and B red by default (they were blue and green, now F's and D's), which the composite uses as its tints.

##### Tile Service, Library, Docs

- `/sources` removed (`/terrain-sources` only); `/terrain-sources` lists an `address` for COG, VRT and raw WMS/WCS entries.
- `epsg4326://` (`a22cf0a`): plate carrée tiles resampled to Web Mercator, used by the Holmul DEM (Tulane, a grey picture of the 1 m DEM; about h ≈ 0.75 × grey + 120 m, not a terrain); PAMAP and Sardinia hillshades (licences not stated); El Pilar's bare-earth hillshade checked.
- Blobness orientation `180 − θ` mod 180 in `lib/blobness-protocol.ts` and the Python port, cyclic ramp (`bbf787e`); the tile service and QGIS agree on 99.999 % of pixels.
- The G-LiHT slide and page show a real Kiuic render (`48c9f1f`); `qgis-plugin/out/` is no longer tracked (a 985 KB test picture failed the deploy's media check).
- Tools & Integrations is a section of Features, between Tools and Other (`5601d7f`); the QGIS screenshots retaken on 0.9.1: slope with contours, then sky view factor and curvature with their settings open (`633922a`).
- MapLibre: ten more W3C blend modes (difference, exclusion, soft-light, hard-light, darken, lighten, color-dodge, color-burn, hue, saturation) for `fill-`, `line-` and `raster-layer-blend`, proposed upstream in [maplibre-style-spec#2017](https://github.com/maplibre/maplibre-style-spec/pull/2017) and [maplibre-gl-js#9143](https://github.com/maplibre/maplibre-gl-js/pull/9143) (render tests for all three layer types).


<!-- released: 2026-11-25T23:55 -->

#### TL;DR

- **[Live GPU terrain shadows](/docs/dev/lighting-effects)**: shadows follow the sun in real time, come from relief tens of kilometres away with the Earth's curvature, and have soft edges.
- **Search catalogs and coverage**: one forgiving search across Sources Coverage (terrain, basemaps, historical catalogs: "lidr" finds LiDAR), and one in the timeline's Catalogs picker.
- **[Terrain as quantized mesh](/docs/dev/tile-service#quantized-mesh)**: the tile service streams any terrain source as Cesium terrain at true heights, for CesiumJS or Blender, and its relief tiles are 3 to 80 times faster.
- **[Tile service in the desktop app](/docs/features/advanced/desktop#local-tile-service)**: one switch in Settings runs it on your computer, with addresses to copy for QGIS, Blender or Cesium. The app now finds updates while open and shows download progress.
- **[QGIS plugin 0.8.0](/docs/dev/qgis-plugin)**: pick a packaged tile server (installed in one click), a remote one, or the Python backend; Python computes all 25 terrain modes in QGIS itself from any elevation GDAL opens, a raster layer of your project included, with the app's color ramps, sliders, a light pad and the sun at a date and time.

#### Details

##### Night of 2026-11-25

- **Late** (`a194a76`, `1619432`, `93aed9f`, `ac442b4`, `9022ec3`, `f7c70db`, `5c5b233`, `c434d51`): `/terrain-sources` (and `/{id}`) open the Terrain tiles group in Scalar, `/sources` kept as a deprecated alias; building shadow roofs lit where building parts overlap (nonzero fill; Midtown 59–73 % → 100 % of roofs lit) and only the buildings that reach a tile drawn (one Midtown tile 115 s → 1.4 s); sky view factor and openness 15–35 % faster, the QGIS local dominance, openness and sky view factor up to twice as fast at 512 px. Docs: Tools & Integrations right after the Overview, in the order desktop, River-REM, QGIS, live compute, tile service, its API; the desktop page downloads the light build first; real QGIS screenshots in the docs and the tools slides; PACUNAM's public layers (Tulane's hillshades, SVF and local dominance; no elevation values) and the El Pilar bare-earth hillshade in the Library; a planned vector overlays note (Overture, VIDA, Microsoft buildings).
- **Tile service** (`f122546`, `d6a7c14`): `/basemaps` opens the Basemap tiles group in Scalar, and `{source}` offers the library ids while taking any string; `/view` also takes a bare query or an unencoded link. Vector tiles (contours, iso-lines) written 2 to 3 times faster, live building shadow geometry twice as fast; same bytes.
- **Web app** (`d21d858`): the G-LiHT proxy sits in Settings > API Keys, its explanation on hover, with an arrow to restore the default. Cesium World Terrain streams once a Cesium ion token is set.
- **Desktop** (`25000ee`, `9b71aba`): the tile service reads `EARTHDATA_TOKEN` from the environment or a `tile-service.env` file for G-LiHT; macOS gets a re-signed app and a `.pkg` installer, checked from a quarantined copy in CI.
- **Docs** (`836ad9a`, `6cac682`, `3283d76`, `42bb421`): a Tools & Integrations group (tile service and its API side by side, QGIS, desktop, River-REM) with buttons to the API, releases and winget; a CORS extension rule for one host at a time; the Po plain shadow under a higher sun; the height references diagram; Moon and Mars terrain notes; PACUNAM's DTM is not public; blobness orientation described as the axis across a feature (values unchanged).

##### QGIS Plugins

- **QGIS plugin 0.8.0** (`12431a5`, `98662fb`, `9b175db`, `fc5bc98`, release [`qgis-plugins-2026-11-25f`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-25f), tile service bundles rebuilt): backends as radio buttons named Packaged tile server, Remote tile server and Python backend (no Connect for Python); Color everywhere; no zoom-out to the world when every mode is unchecked; sun at a date and time (date-time picker, day-of-year and hour sliders, the app's solar model) beside the free light pad; pointing-hand cursor on rows and buttons; QGIS labels on contours, iso-lines, plane slicer and graticule (black with a white buffer); switching backend no longer drops a checked mode's layer.
- **Python backend parity**: every color ramp and mode setting applies as in the tile service (88 cases, 100 % of pixels within 3 levels; all eight hillshade methods, fast sky view factor), the hypsometric tint no longer clamped to 0–1 and its Values layer styled with the same ramp; any GDAL elevation as source (a project raster layer, local COG or VRT, `/vsicurl/`, WCS: one warp per zoom, 6–14 ms a tile warm); the mound detector ported (same points as the service), so all 25 modes run in Python.
- **Local files for the tile server**: the plugin registers a raster layer's file with a tile server on this machine (`POST /files`, an HMAC id, never a path in a tile address, `TV_FILE_ROOTS`, `TV_LOCAL_FILES=off`).
- **QGIS plugin 0.7.0** (`f0f2629`, `f078f69`, `f97cf9b`, release [`qgis-plugins-2026-11-25e`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-25e)): three backends picked at the top (Local service installed and started by Connect, Remote service by address, experimental Python); one modes tree for all three, modes Python cannot draw greyed out, Values only where a mode has values; a click anywhere on a row toggles it; colour ramp and matcap selects with previews (sprite sheets packaged, `make_assets.py`); symmetric ramps mirror Min from Max; slider plus number box for every numeric setting; a light pad shared by hillshade, Phong and both shadows; unchecking removes all of a mode's layers and empty groups; overlays default to vector (Vector box first); zoom to the source's bounds; API keys behind a key icon; Open link takes a full link or a bare query, checks the service once, picks the link's source and keeps app-only parameters out of tiles.
- **Python compute, 24 of 25 modes** (`f078f69`): shape index, blobness, eigenvalue ratio, orientation, RVT local dominance, building shadows (OpenFreeMap footprints burnt with GDAL), iso-line, graticule and plane slicer, as colours, values and vector layers, matching the tile service (99 to 100 % of pixels); only the mound detector is left. The Python backend reads Terrarium and Terrain-RGB pyramids and follows a change of source; COG, VRT, LERC and quantized mesh need a tile service. Timings in [QGIS Live Compute](/docs/dev/qgis-live-compute).
- **QGIS plugin 0.6.0** (`b88d9a6`): Colour / Values boxes per mode that add and remove their layers; local Phong, matcap and live contour lines; values layers resampled bilinear; Earthdata field removed.
- **QGIS plugin 0.5.0** (`1adf3ba`): one plain plugin with **Install** (the per-platform tile service downloaded from the release, version and sha256 pinned); compute locally first in the panel, 14 modes checked against the service and gdaldem, served as Float32 values QGIS styles with its ramps, a full-HD canvas in 0.2 to 0.5 s.
- **QGIS plugin 0.4.0**: the bundled tile service is **off by default** and only starts when you check **Local bundled tile service** and press Connect. If the tile service does not answer (at Connect, or later), the panel and QGIS's message bar say so, and for a local address suggest starting the desktop app with its tile service on (or the bundled one). Both variants stay: the 20 KB plain zip and the platform zips with the service inside, about 3 MB smaller now. Release: [`qgis-plugins-2026-11-25b`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-25b).
- **No browser for the plugin**: QGIS asks for flat, north-up tiles only, so the service inside the plugin and the desktop app ships without playwright-core and never looks for Chrome or Edge; a 3D, tilted or split view answers 501.
- **The QGIS plugin works on its own**: Terrain Viewer 0.3.0 for QGIS comes as one zip per platform (Windows, macOS, Linux) with the tile service inside. Install it from ZIP and the terrain layers work with nothing else running. See [QGIS Plugin](/docs/dev/qgis-plugin#the-bundled-tile-service).

- Former TL;DR: **Terrain Viewer 0.3.0 for QGIS, with the tile service bundled**: one zip per platform (Windows x64, macOS arm64 and x64, Linux x64, 50 to 62 MB) carries Node 22, the tile service and its dependencies with that platform's sharp binaries. Install it from ZIP and it works with nothing running: the panel's **Local bundled tile service** box (checked by default) starts the service on `127.0.0.1` when the panel connects and stops it when QGIS quits, the plugin unloads, or QGIS crashes. An optional **Earthdata token** field passes `EARTHDATA_TOKEN` to it for G-LiHT; no token ships. The plain zip (pure Python, a service to connect to) stays. Release: [`qgis-plugins-2026-11-25`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-25), with Send2MapApp 0.5.1 (destinations in the web app's order).
- `qgis-plugin/make_zip.py --bundled [platform]` builds any platform from any host: Node from nodejs.org checked against `SHASUMS256.txt`, tile-server's production dependencies installed flat (`node-linker=hoisted`) with pnpm's `supportedArchitectures`, source maps and type declarations left out. `.github/workflows/qgis-plugins.yml` (on demand) builds each platform on its own runner, starts its service there (`qgis-plugin/smoke_bundled.py`), and with `release_tag` attaches the zips to a release.
- `qgis-plugin/terrain_viewer/local_server.py`: port 3410, or a free one when it is taken (a saved project's layers follow the port on Connect); `CREATE_NO_WINDOW` on Windows; the executable bit set again on macOS and Linux (QGIS's zip installer drops it); no `.env` read. `qgis-plugin/test_bundled.py` unzips a platform zip into a temporary folder and drives it through the panel in headless QGIS (3.44 LTR and 4.2 on Windows: started in about 4 s, `/processes` and a slope tile answered, gone after unload).
- **Experiment: the QGIS plugin can compute hillshade, sky view factor and terrain shadows itself**, in QGIS's Python with numpy, from Mapterhorn elevation tiles, with no tile service. It is off by default: check **Experimental: compute locally** in the Terrain Viewer panel and a "Terrain Viewer (local compute)" group appears; uncheck it and the group goes away. The shadows match the app's pixel for pixel, the sky view factor to 0.004 %.
- **Fast enough**: 1 to 15 ms a tile on one CPU core, 5 to 100 times faster end to end than the same tiles from the tile service. The GPU (cupy) is slower than the CPU for tiles this small. Timings, the four ways to plug it into QGIS and next steps: [QGIS Live Compute](/docs/dev/qgis-live-compute).

- `qgis-plugin/terrain_viewer/live/`: `dem.py` (Terrarium WebP/PNG through `QImage`, 256 px tiles from 512 px sources, padded 3×3 grid, LRU cache with in-flight de-duplication), `kernels.py` (Horn hillshade and slope, the "precise" sky view factor of `lib/horizon-kernel.ts`, the shadow-height sweep of `lib/shadow-kernel.ts` vectorised as one gather and two block-wise cumulative maxima; numpy or cupy), `kernels_numba.py` (the same kernels as loops, used only if numba imports), `server.py` (a `ThreadingHTTPServer` on 127.0.0.1 serving `/{mode}/{z}/{x}/{y}.png`), `layers.py` (the group of XYZ layers). `dock.py` only gains the checkbox.
- `qgis-plugin/test_live.py` compares the numpy kernels with the TypeScript ones (`live_reference.mjs`, Node with `--experimental-strip-types`), compares numba with numpy, renders each mode through `QgsMapRendererParallelJob` and checks the checkbox. It passes in QGIS 4.2 and 3.44. `bench_live.py` times numpy (1 and 8 threads), numba, cupy, Node and the tile service.
- A Python `QgsRasterDataProvider` was probed and works in 3.44 and 4.2, provided `capabilities()` returns `Qgis.RasterInterfaceCapability` flags (otherwise 3.44 exits without a traceback). It is the planned way to serve Float32 values with no service.
- `qgis-plugin/test_service_paths.py` replaces `test_bundled.py`: the bundled service, or an external address, driven through the panel in headless QGIS (Connect, processes, a slope layer, a tile, a dead local address, the service going away while connected). Run on Windows in QGIS 4.2 and 3.44 LTR for the three paths: the bundled service, the packaged desktop app's service (light build made locally, started at launch with the setting on; the Node child exits by itself when the app is killed), and the plain plugin against `node tile-server/server.mjs` on another port.

##### Evening of 2026-11-25

- **Tile service** (`63bd534`, `50d994b`): quantized mesh meshed by martini by default (delatin with `?mesher=delatin`) and on the WGS84 ellipsoid (EGM96 geoid added, `?heights=orthometric` to opt out); `/terrain-tiles/{source}/…` and `/basemap-tiles/{source}/…` path forms, `/basemaps` list; colour ramps as pictures (`/colorramps/{id}.png`); `/view?url=` takes a whole share link; Scalar tag "Visualization modes (OGC API – Processes)", copyable wrapping quick start, full-width page at `/docs/api/tile-service/`. The drawing code's hash is in every cache key, so tiles drawn by older code are never served (shown in `/health`). Matcap and Phong 2 to 3.5 times faster, hillshade and others 15 to 35 % (`40a92e8`, no per-pixel allocation).
- **Desktop** (`0d9b7c3`): checks for updates every hour while open, download progress with time left, quick start in its own fold.
- **Library** (`42b0600`): Wales 1 m DTM and DSM hillshades, DSM and nDSM; Iceland's hillshade and TPI; [Research lidar endpoints](/docs/dev/research-lidar-endpoints) lists what can and can't be streamed.
- **Docs** (`61f866c`, `f17f080`): the QGIS page describes the released plugins, the Po plain shadow picture, checked references on six pages, slides for the tile service, QGIS, shadows, relief and G-LiHT; TRI, Laplacian and Casorati wording corrected.

##### Later on 2026-11-25

- **Tile service** (`e3afb0d`, `b7c3996`): the API page opens on a quick start of addresses to copy, every group open; Blender and CesiumJS how-tos and martini vs delatin in the docs. First tile about 0.5 s instead of 4 s, cached terrain tiles five times faster, a `maxTriangles` cap. Relief tiles 3 to 4 times faster alone and 10 to 80 times for neighbours (each tile no longer runs its kernel on four whole source tiles; computed tiles kept per worker, `TV_PROTOCOL_CACHE_MB`; PNG level 3). Same pixels.
- **Desktop** (`2ba6460`): Restart and install / Check for updates in About; the light build's window reads "Terrain Viewer Light"; the tile service section has a status dot, its address and API reference, addresses to copy, and folds with Fold all.
- **Shadow docs** (`6bb1f62`): far field, curvature and when the soft edge shows, in the user docs; soft edge measured (+0.1 ms in the Alps); related work in Shadow Renderers.

##### Tile Cache and Service Fixes

- **Fix**: a tile could stay blank for a week when the tile service was stopped right after drawing it.
- **Tile service**: the browser engine falls back to Microsoft Edge when Chrome is not installed, and with neither answers `501` with a message instead of an error trace; `TV_HOST` (listen on one interface) and `TV_EXIT_WITH_STDIN` (stop when the parent goes) are new.
- **Tile cache**: a service stopped right after answering could leave an empty cache file, served as an empty tile for a week. Tiles are now written beside and renamed, and an empty file counts as a miss.

##### Aspect: east and west no longer swapped

- The Aspect mode read an east-facing slope as west-facing (270° instead of 90°): `lib/aspect-protocol.ts`'s Horn `dx` is west minus east, so GDAL's `atan2(dy, -dx)` becomes `atan2(dy, dx)` here. Found by the QGIS plugin's comparison with gdaldem; `lib/aspect-protocol.test.ts`.

##### Lighter Imagery Footprints, Every Entry Dated

- **Imagery footprints load faster**: showing the footprint of an OSM Editor Layer Index source now downloads only that source's outline, usually under a kilobyte, instead of the outlines of a whole continent (more than half a megabyte for Europe).
- **One search in Sources Coverage**: the historical catalogs no longer have a second filter box of their own there; the box at the top of the section covers them. The timeline's Catalogs picker keeps its own.
- **What's new is in order again**: the latest changes show as new and are listed newest first.

- ELI sizes, measured 2026-11-25. osmlab/editor-layer-index publishes the whole index only: `imagery.geojson` 6.7 MB (1.33 MB gzip from GitHub Pages, which serves no brotli; 1.24 MB brotli from jsDelivr), `imagery.json` 6.5 MB (1.31 MB gzip), `imagery.xml` 10.2 MB (1.27 MB gzip); no geometry-free or per-region file. Its `sources/` tree has one unminified GeoJSON per source (4 to 50 kB each) but no list to find them by id. `@osm-editor-kit/maplibre-editor-layer-index` 1.0.2, which the app uses, already splits it: a locator without polygons (names, boxes, countries, dates; 579 kB raw, 78 kB gzip, 61 kB brotli) that the coverage group and the search load, details per continent (tile URLs; Europe 766 kB raw, 69 kB gzip) and polygons per continent (Europe 1.6 MB raw, 580 kB gzip; North America 609 / 198 kB; Asia 850 / 210 kB). The "14 MB" in the coverage section's comment was stale.
- The polygons now come one per file: the `eli-geometries` plugin in `vite.config.ts` writes the package's 998 polygons to `eli-geometries/<geometryId>.json` at build time (3.5 MB raw, 1.1 MB gzip in all; median 0.3 kB gzip, 95 % under 4 kB, the largest 177 kB) and serves them from the package in dev, so nothing is tracked or put on a release and the files always match the installed locator. `lib/eli-geometry.ts` (`loadEliCoverageFeatures`, same collection as the package's `loadCoverageFeatures`) fetches and caches them, falling back to the continent shard when a file is missing; used by the coverage footprints, the timeline's dated ELI layers and "Use as basemap".
- `historical-catalog-tree.tsx`: `compact` (the coverage section) hides the tree's own search box; the section's top search passes its matches down as `filter`.
- Changelog: the entries of 2026-11-24 and 2026-11-25 got their `<!-- released -->` markers (time suffixes from their commits) and TL;DRs for end users, with the former TL;DRs moved under Details. The two shadow entries are one, and three tile-service and dependency entries have no TL;DR (developer notes, left out of the app). `lib/changelog.test.ts` (`node scripts/test-lib.mjs lib/changelog.test.ts`) fails when an entry has no marker, two share one, or the file is not newest first.

##### Cesium Terrain From Any Source, Box Pictures by Address

- **Any terrain source as a 3D globe in Cesium and Blender**: the tile service now serves every terrain it reads (Mapterhorn, AWS, Mapbox, MapTiler, Esri, national lidar, GEM-15...) in Cesium's terrain format, so CesiumJS, Cesium for Unreal or Unity and Blender add-ons that read Cesium terrain load it as a globe, with smooth shading. Docs: [Tile service, Quantized mesh](/docs/dev/tile-service#quantized-mesh).
- **Pictures of a box by address again**: a picture or the values of a box can be asked with the box and the size in the address, as before yesterday, now documented.

- Endpoints: `/quantized-mesh/{source}/layer.json` and `/quantized-mesh/{source}/{z}/{x}/{y}.terrain` (quantized-mesh-1.0, geographic TMS, octvertexnormals, gzip, CORS, cached a week except empty tiles), for every source whose `/sources` engine is `direct`, with the same keys as `/terrain-tiles`; `error` (0.5, a share of Cesium's level geometric error), `mesher` (`delatin` or `martini`), `extensions`. An `OPTIONS` preflight now answers 204. `/bbox/{w},{s},{e},{n}/{width}x{height}.png|jpg|tif` answers what `/render` with `bbox`, `width` and `height` answers (one handler), with its `.stac.json` Item and `Link` header, in OpenAPI under Viewport; titiler's `/tiles/WebMercatorQuad/...` and `/WebMercatorQuad/tilejson.json` stay removed.
- `tile-server/quantized-mesh.mjs` is standalone (a height grid in, a tile out, no server). Delatin by default: on Mapterhorn around the Matterhorn, levels 10 to 14, it makes about 45 % fewer triangles than martini for the same error in about three times the time (16 to 24 ms a tile at the default error, against 6 to 7). `direct.mjs` `geographicGrid` resamples the source's Web Mercator pixels of the matching zoom to a 257 × 257 geographic grid with a two-pixel border; the meshing runs in the direct engine's workers.
- Tests: a synthetic surface served by a stubbed fetch, decoded by the module's decoder and by HERE's `@here/quantized-mesh-decoder` field by field, checked against the surface and the spec's invariants (index order, winding, edge lists, bounding sphere, normals); over HTTP, a Mapterhorn tile in the Alps, and `/bbox` drawing byte for byte what `/render?bbox` draws. Next: a water mask, the metadata extension for sparse sources, a STAC Item for `.terrain`.

##### Desktop App Runs the Tile Service for QGIS; Bundled Service Off by Default

- **The desktop app can serve tiles to QGIS**: **Settings > Desktop: local tile service** (desktop app only, never on the website) runs the tile service on this computer (off by default, port 3400 unless you change it). Turn it on, then press Connect in the QGIS plugin with its default address. It starts with the app while the setting is on and stops when the app closes. Docs: [Desktop App, local tile service](/docs/features/advanced/desktop#local-tile-service).

- `desktop/src/bun/tile-service.ts` starts the shipped Node on `Resources/app/tile-service/server.mjs` as a child process (`TV_HOST=127.0.0.1`, `TV_EXIT_WITH_STDIN`, `TV_NO_BROWSER`, no `.env`), keeps the setting in `tile-service.json` and logs to `tile-service.log` next to `updater.log`; a port already answered by another tile service or program is reported, not fought over. Not inside the main process: Cottontail runs the service with sharp but drew a slope tile in 57 s where Node takes 5. `ci-bundle.sh` stages the service with `qgis-plugin/make_zip.py --server-dir <platform>`, `gen-config.mjs --tile-service=required` copies it, `desktop.yml` installs and builds tile-server first. The installers grow by about 30 MB (light Windows Setup 67 MB, full 252 MB; built on all three platforms by run 45590628336). The page's side: `lib/desktop-bridge.ts` (`tile-service-status`, `tile-service-set`, the `tv-desktop-tile-service` event), `components/TerrainControlPanel/desktop-tile-service-section.tsx`.
- `tile-server/render.mjs`: `TV_NO_BROWSER=1`, or playwright-core missing, makes the browser engine a 501 with a message.

##### Live Shadows Reach Far: Far-Field Relief, Earth Curvature, Soft Edges

- **Long shadows from far away**: live terrain shadows now also come from relief tens of kilometres beyond the view (a second, coarser elevation mosaic around it), with the ground lowered by the Earth's curvature on long rays. At sunrise over Mont Blanc (sun 2°) the match with a long-reach reference goes from 0.96 to 0.999 (IoU); over the Po plain east of Turin at a 1.5° sunset, where the Alps' shadow comes from 60 to 100 km away, from 0.86 to 0.98. A frame costs 2 to 4 ms per megapixel on a laptop GPU.
- **Soft shadow edges**: the penumbra of the sun's disc, wider the farther the ridge casting it (Lighting Effects > Shadows > **Edge: Soft / Hard**, on by default).
- **Clearer names**: the shadow toggle is **Terrain (+ buildings if DSM)**: a terrain model such as Mapterhorn has no buildings, and its slopes cast long shadows only under a low sun (the outer rim of the light pad). The renderer switch reads **Live (GPU) / Tiles (CPU)**.
- **Exports**: the Snapshot captures the live shadows as you see them; per-mode exports and the Iso-line use the shadow tiles. How both renderers work: [Shadow Renderers](/docs/dev/shadow-renderers).

- `lib/shadow-live-math.ts`: the fragment shader is now generated there (`shadowFragmentShader`) next to its line-by-line CPU twin `sunVisibilityCpu`: highest horizon angle over the view mosaic, then over the far mosaic from where the ray leaves the view mosaic; ground drop `d² (1 − k) / 2R` with k = 0.13 (`curvatureDrop`, `CURVATURE_PER_M2`); metres per texel from the Mercator scale (`texelGroundMeters`); soft edge as a smoothstep of the angular margin over the sun's 0.2665° radius. `chooseFarLayout` (three zooms coarser, up to three coarse tiles a side, at most 36 tiles), `farTransform`, `boxExitDistance`.
- `lib/shadow-live-gl-layer.ts`: a `MosaicTexture` per mosaic (view and far field) sharing the decoded-tile cache; the far mosaic is kept while it holds a one-tile margin around the view mosaic.
- `lib/shadow-live-math.test.ts`: synthetic cliffs through the shader's math: shadow length h / tan(alt) in metres for 5 azimuths × 4 altitudes, the Mercator scale, 115 km flat vs 86 km curved for a 2 000 m ridge under a 1° sun, a ridge beyond the view mosaic found through the far field at the right distance, the soft edge, and the tile kernel on the same cliff (same conventions).
- `scripts/bench-shadow.mjs`: the live renderer's accuracy (CPU twin against a reference reaching up to 170 km toward the sun) and the shader's draw time in headless Chrome (same pixels as the twin); the third-party comparison is gone. `--tiles-only`, `--live-only`.
- The tile kernel is unchanged: its sliding maximum needs a ray rising linearly with the distance, so no curvature (under 1 m within its radius at z13 and finer) and no far field.
- Live shadows draw in every view of a split, as live Phong.

##### Live Terrain Shadows That Reach Farther

- **Terrain shadows move live**: Hard Shadows are now drawn by the graphics card. Dragging the sun, changing the hour or using the Sun Shadow Calculator moves the mountains' shadows in real time, and long shadows reach across the whole view. On a device that cannot run it, the app goes back to the tile shadows by itself (Lighting Effects > Shadows > Renderer).
- **Tile shadows reach eight times farther**, at about the same speed: long shadows under a low sun are no longer cut short. Exports use them. Links that set a search radius keep it.

- Former TL;DR (live): **Hard Shadows draw live on the GPU** ([Shadow Renderers](/docs/dev/shadow-renderers#live-renderer)): every pixel marches its own ray toward the sun over a Float32 mosaic of the view's DEM tiles. The sun pad, the Datetime hours and the Sun Shadow Calculator now move terrain shadows in real time, and shadows reach the edge of the view plus a tile, with no Search Radius and no height tolerance (low plateau edges are kept). Mercator, globe and 3D terrain.
- **Renderer: Live / Tiles** under Lighting Effects, Shadows (advanced; `shadowRenderer`, default `live`). Tiles is the `shadow://` pipeline with its Search Radius; exports and the Iso-line always use it, and it takes over by itself when the GPU layer cannot run on the device.
- `lib/shadow-live-gl-layer.ts` (custom layer: R32F mosaic of up to 48 tiles from the shared decoded-tile cache, tiles uploaded as they arrive, `render` through MapLibre's projection prelude, `renderToTerrainTile` with terrain on), `lib/shadow-live-math.ts` (sun step vector, step schedule: one texel for 40 then 1/40 of the distance, mosaic layout, a CPU twin of the march), `lib/shadow-live-math.test.ts` (`node scripts/test-lib.mjs lib/shadow-live-math.test.ts`), `components/LayersAndSources/ShadowLiveGlLayer.tsx`, `shadowLiveUnsupportedAtom` for the fallback. `lib/live-dem-gl-layer.ts` exports its program helpers. The CPU kernel is untouched.
- Limits: a wide or strongly pitched view gets a coarser mosaic; a shadow cast from beyond the one-tile margin is missed; no exaggeration (as the tiles).
- Former TL;DR (sweep, commit of 2026-11-25 01:42, merged here): **Terrain shadows reach eight times farther for about the same cost**: the Search Radius defaults to 256 px (it was 32) and goes up to 512 (it was 64). In the Alps under a 15° sun the old default found half the mountain shadows a long reference finds (IoU 0.55); 256 finds 0.75, 512 finds 0.90. On gentle relief (Seine cliffs, z15) 256 is exact where 32 missed 6 %. Same for the tiles, exports, split views and the Iso-line's hard-shadow measure. Links that set `shadowRadiusPx` keep their value.
- **How**: the per-pixel ray march became a shadow-height sweep, a sliding maximum along the lines toward the sun whose work per sample does not depend on the radius. Radius 256 takes 4.6 ms a tile in Chamonix against 4.0 for the old march at 32, and 3.0 against 5.4 at Les Andelys; at equal radius it gives the march's pixels, faster. Every pixel reaches the same distance, so tiles agree at their seams, and the reach stops, exactly, where nothing ahead can be high enough.
- **[Shadow Renderers](/docs/dev/shadow-renderers)** (new page): the tile kernel's timings on real tiles against a long-radius reference, and the improvements that led to the sweep; a live GPU shadow layer is in progress separately.
- `lib/shadow-kernel.ts`: `computeShadowTile` (the sweep: the grid sheared along the sun's minor axis, van Herk / Gil-Werman over windows of `radius / hypot(1, b)` steps, two row-by-row passes, the window maximum interpolated between the pixel's two lines); the march stays as `computeShadowRowsMarch`, with the exact per-ray early exit, as the reference. `SHADOW_RADIUS_DEFAULT_PX` / `SHADOW_RADIUS_MAX_PX` in `lib/shadow-protocol.ts`, which caps the radius at two tiles.
- `fetchPaddedElevationGrid` (`lib/normal-derived-protocol.ts`) takes as many rings of same-zoom neighbours as the halo needs (one up to a tile, as before; two above, 25 tiles). Why not a lower zoom for the far part: [Shadow Renderers](/docs/dev/shadow-renderers#tiles-the-shadow-height-sweep).
- `lib/shadow-kernel.test.ts` (offline, `node --test lib/shadow-kernel.test.ts`): a cone and a cliff under eight suns against a continuous ray (sweep IoU 0.989 to 1, the old march 0.807 to 1: its nearest-pixel steps shadowed lit flanks at oblique azimuths), the cliff's shadow length, the same cut for every column, sun overhead, flat ground, sun below the horizon.
- `scripts/bench-shadow.mjs`: the old march (radius 32, 64) against the sweep (32 to 768), best of `REPS` runs per tile; numbers in the benchmark page.

##### One Fuzzy Search for Sources Coverage, Quieter Attribution Button

- **One search box for Sources Coverage**: the filter at the top of the section searches terrain, basemaps and the historical catalogs at once, and forgives typos ("lidr" finds the LiDAR coverage). Groups with a match open, the others hide.
- **Quieter credits button**: hovering the map's ⓘ no longer fills it with colour.

- Former TL;DR: **Sources Coverage has one search for everything it lists**: a filter box at the top of the section now covers Terrain (Mapterhorn, 3D and LiDAR, OpenTopography, the terrain library, your sources), Basemaps · Static (ELI, your basemaps, the basemap library) and the historical catalogs, instead of the historical catalogs alone. It is typo-tolerant, using the Library's matcher ("lidr" finds the LiDAR coverage, "swistopo" the swisstopo datasets). Groups with a match open, the others hide, and "Nothing matches" says when nothing does.
- **Catalog search sized like its dialog**: the filter box in the timeline's Catalogs picker uses the dialog's 12px text, is 28px high and has a 12px icon (it was 14px text in a 36px box).
- **Attribution (i)**: hovering no longer fills the button with a block of colour, only the pointer cursor shows. The keyboard focus ring stays.
- `historical-catalog-tree.tsx`: `useCatalogEntries` and `catalogSearchText` exported; a `filter` prop (`{ query, ids }`) takes a search run elsewhere and hides the tree's own box. `SourceInfoSection.tsx` runs `searchLibrary` once over every coverage leaf (with its section and group names), every group that has no leaves yet (ELI before it loads; a match loads it) and every historical catalog, so exact matches win across the whole list before any near miss. While searching, the folds are forced open but not stored, and Expand all is disabled.
- The `Input`s also get `md:text-xs`: without it the primitive's `md:text-sm` won on wide screens (this also fixes the coverage panel's Search by name field).

##### Tile Service Without titiler's Addresses

- **Tile service: titiler's addresses are removed**, like `/tiles/{z}/{x}/{y}` and `/modes` the day before: `/tiles/WebMercatorQuad/{z}/{x}/{y}`, `/WebMercatorQuad/tilejson.json` and `/bbox/{w},{s},{e},{n}/{width}x{height}.{format}` answer 404 naming `/terrain-tiles`, `/tilejson.json` and `/render.{format}?bbox=…&width=…&height=…` (which draws exactly what `/bbox` drew). Nothing in the repository called them (app, QGIS plugins, MCP server, scripts, desktop). titiler's parameter names `url`, `algorithm` and `tilesize` are still read.
- `tile-server/server.mjs` and `stac.mjs`: the alias patterns are gone, so neither a `.stac.json` Item nor a `Link` header is made for them; `openapi.mjs` (and `docs/public/tile-service-openapi.json`), the tile-server README and [Tile service](/docs/dev/tile-service#removed-addresses) say so; `test.mjs` checks the three 404s.

##### G-LiHT Through the Local Proxy by Default, CORS Extensions Fixed, Stretch Measured on Eight Campaigns

- **NASA G-LiHT lidar loads more reliably**: when the local tile service runs, G-LiHT goes through it by default; when it does not, the app says so and reads NASA's files directly. Browser extensions that unblock cross-site requests now work with it too.
- **Kiuic terrain a little more accurate**: the conversion from the grey pictures back to heights was measured on eight campaigns, and the Kiuic Library entries use the refined values.

- Former TL;DR: **G-LiHT reads through the local tile service by default**: **Settings > G-LiHT address** starts at `http://localhost:3400/proxy/gliht` (an https page may reach `http://localhost`; Chrome asks once for local network access). When the service does not answer, a message says so and the KMZs are read from NASA's host directly; the field can still be cleared for NASA's host only, or set to any proxy.
- **CORS-unblocking extensions work now**: the map stayed empty with one because the reader's first request was a suffix `Range` (`bytes=-65557`), which needs a preflight the extensions do not approve, so the real request was never sent. On NASA's host the reader now asks a `HEAD` for the length, then `bytes=start-end` only, and never reads `Content-Range` (hidden behind an extension). Details: [NASA G-LiHT, CORS](/docs/dev/g-liht#cors-why-an-unblocking-extension-showed-nothing).
- **The KMZ grey-to-metres stretch, measured on eight campaigns** against their Float32 GeoTIFFs: linear, one stretch per KMZ, decoded at the 8-bit step (0.01-0.2 m RMS, 0.9 m at El Yunque). White is the 99.9th percentile; black is the minimum on some campaigns and a little above it on others, and nothing in the KMZ gives it: [table](/docs/dev/g-liht#the-pngs-against-the-geotiff). The Kiuic 1 and 3 library entries take the refined values (a few centimetres).
- `lib/gliht-kmz.ts`: `openZip` places the tail from the end record (directory offset + size), `headSize`, `GLIHT_DEFAULT_BASE`; `lib/gliht-protocol.ts`: the proxy-down fallback (retried every 30 s) and two one-time toasts; `tile-server/proxy.mjs`: `Access-Control-Allow-Private-Network: true` on preflights. `lib/gliht-kmz.test.ts` now replays a browser behind an extension (suffix range refused, no `Content-Range`).
- `scripts/gliht-stretch.py <c>_DTM.tif <c>_DTM.kmz`: fits `lo`/`hi`, RMSE, per-tile spread and linearity (numpy, rasterio, Pillow; data downloaded outside the repository).

##### Transparency in the Edit Dialog, Catalog Search, Library Tidy

- **Transparency moved to the edit dialog**: how an overlay blends (as served, opaque, dark over, light over) is now set in its edit dialog, under Opacity. The button it replaces could crash the site.
- **Search the historical catalogs**: the timeline's Catalogs picker has a filter box that finds catalogs by name, provider or country, typos forgiven.
- **Library tidied**: smaller tabs; Load all and Clear all are gone (add or remove by row or by section).

- Former TL;DR: **Transparency moves to the edit dialog**: an overlay's alpha mode (as served, opaque, dark over, light over) is now a **Transparency** field under Opacity in the source's edit dialog, instead of a button on every row. The row button crashed the deployed site when clicked ("Base UI error #31": its menu heading was a group label outside a menu group). Stored choices and the Library defaults (light over for the Maya local dominance layers) are unchanged; an untouched source keeps following its Library default.
- **Search the catalogs**: the historical catalogs list (the timeline's Catalogs picker and the Sources Coverage panel) has a filter box: name, description, provider (the STAC host), group and country, with the Library's typo-tolerant matcher. Groups with a match open, the others hide.
- **Library**: the Terrain / Basemap tabs a little smaller; **Load all** and **Clear all** removed (per-row and per-section add and remove stay).
- **Attribution (i)**: no focus ring after a click; with the keyboard the ring goes around the whole box, with its radius.
- **Open In**: a shadow gallery that opens at its own place removed (it was no hand-off). Same in the QGIS plugin.
- `components/TerrainControlPanel/alpha-mode-menu.tsx` deleted; the field is in `custom-basemap-modal.tsx` (written as `alphaMode` only once the user picks one). Checked every `DropdownMenuLabel` / `SelectLabel`: no other one sits outside its group; both primitives now say so in a comment (Select's equivalent is error #56).
- Attribution: the vendor CSS glows on any `:focus` of the button; `src/index.css` clears it and puts a `--ring` shadow on the box under `:has(:focus-visible)`.

##### geotiff.js 3

- **geotiff.js 2.1.3 → 3.0.5** in the app, as the tile service, the MCP server and `@geomatico/maplibre-cog-protocol` already had: one copy in the main chunk instead of two. Main chunk 6,467 → 6,428 kB (gzip 1,881 → 1,869 kB); `dist/assets` 192 kB smaller. No change to what the app shows.
- 3.0's breaking changes met: IFD tags are read with `getValue()` / `loadValueIndexed()` (the offset and byte-count arrays are lazy), `getGDALMetadata()` is async (the local COG check read `STATISTICS_MINIMUM` from a promise and would have lost it silently), `Pool.decode()` is gone (we only pass the pool to `readRasters`). The decoder worker is still an inline blob, so nothing changes in Vite.
- `readRastersSparse` (`lib/float32dem-protocol.ts`) stays: 3.0 now synthesises a block whose byte count is 0, but fills it with `GDAL_NODATA || 0`, so a float hole tagged `nan` read as 0 m. It now looks up each block's offset and count lazily.
- `lib/float-geotiff.test.ts` (offline): a Float32 and an RGBA GeoTIFF from our writer decode with geotiff 3 (values, NaN, bbox, CRS), and a sparse strip reads as NaN. `node scripts/test-lib.mjs lib/float-geotiff.test.ts`.

##### Tile Service: STAC Provenance, API Reference Order

- **[A STAC Item for each export](/docs/dev/tile-service#provenance-a-stac-item-for-each-export)** (proof of concept): every raster the tile service answers (value TIFFs and PNGs, rendered tiles and pictures, basemap tiles) has a STAC 1.1.0 Item with the Processing extension at its address plus `.stac.json`, named by a `Link: <…>; rel="describedby"` header on the answer: footprint, the terrain source it was derived from, the process and parameters as executed (`processing:expression`), a lineage sentence, the software version. Worked out from the address, nothing drawn, API keys left out.
- **API reference order**: `/docs` lists OGC API - Processes first (it lists the modes), then Terrain tiles and Basemap tiles, Catalogs, Viewport, Values, Service. The "titiler addresses" group is gone: its tile and bbox operations duplicated `/terrain-tiles` and `/render` (still answered, named in their descriptions) and the TileJSON is listed as `/tilejson.json` under Terrain tiles.
- `tile-server/stac.mjs`; the tests check every item against a vendored copy of the extension's schema (`tile-server/schemas/stac-processing-v1.2.0.json`) with a small offline validator, and the tag order.

# Changelog — Pre-rendered Relief, One Library Dialog, QGIS Plugins

<!-- released: 2026-11-24T17:04 -->

#### TL;DR

- **[Pre-rendered relief](/docs/features/basemaps#pre-rendered-relief) in the basemap Library**: 76 relief maps rendered by their publishers in about 30 countries (national lidar hillshades, Japan's red relief map, Maya lidar), each with its credit. Handy for archaeology.
- **[Library](/docs/features/national-datasets) in one dialog**: Terrain and Basemap tabs, one filter beside them, and a search that finds little in one tab points to the other.
- **[QGIS plugins](/docs/dev/qgis-plugin)**: Terrain Viewer and Send2MapApp for QGIS 3 and 4, installed from ZIP.

#### Details

##### NASA G-LiHT KMZs, CORS Proxy, Earthdata

- **NASA G-LiHT lidar on the map**: any G-LiHT campaign's 1 m terrain can be drawn as an overlay from its footprint's **Use as overlay**, read straight from NASA's files.
- **Kiuic, Yucatán, as terrain**: three lidar blocks covering 93 km² of the Puuc hills, missing from OpenTopography, are in the Library as terrain and as overlays.

- Former TL;DR: **NASA G-LiHT in the app**: the coverage popup's **Use as overlay** draws any G-LiHT campaign's 1 m DTM KMZ, read in place by a new `gliht://` protocol (HTTP Range: the zip directory, then only the tiles a map tile needs). The pictures turn out to be the elevation stretched to grey, not a hillshade: measured against the GeoTIFFs, they decode back to 0.06-0.2 m.
- **Kiuic as terrain**: the three wall-to-wall Kiuic blocks (93 km² of the Puuc, Yucatan, absent from OpenTopography) are in the Library as terrain, decoded from NASA's KMZ with their measured stretch, and as greyscale overlays.
- **[CORS proxy](/docs/dev/tile-service#cors-proxy-for-nasa-g-liht) in the tile service**: `/proxy/gliht` (glihtdata's KMZs only) and `/proxy/earthdata` (LP DAAC's G-LiHT GeoTIFFs, with an Earthdata token kept on the server, plus a VRT for the in-browser reader). **Settings > G-LiHT address** points the app at it; without it a CORS-unblocking browser extension works.
- `lib/gliht-kmz.ts` (reader, tested offline on 230 kB of recorded KMZ subsets against GeoTIFF heights), `lib/gliht-protocol.ts`, `tile-server/proxy.mjs` (allow-list, one Range of at most 16 MiB, whole files under 64 MiB, 16 upstream reads at a time, the token never sent to S3; `proxy-test.mjs`). `EARTHDATA_TOKEN` is read from the environment or the repository's `.env`. Findings and setup: [NASA G-LiHT](/docs/dev/g-liht).

##### Overlay Transparency, Hidden Sources, MERRA-2 by Month

- **[Blend overlays with the imagery](/docs/features/basemaps#transparency)**: an overlay can be drawn as served, opaque, **dark over** (it shades the imagery, like a relief render) or **light over**. The Maya local dominance layers now use light over, so they no longer cover the map with a black sheet.
- **Overlays show in the Simple basemap mode too**, not only with per-view basemaps.
- **Hidden layers stop downloading**: unchecked overlays, views that hide the basemap and the minimized minimap no longer fetch anything in the background.
- **NASA MERRA-2 month by month on the timeline**: air temperature, wind speed, dust, aerosols and ozone, one map a month since January 1980.
- **Featured bookmark**: the Cévennes, on the Ardèche–Lozère border, in a black-and-white slope.

- Former TL;DR: **[Transparency per overlay](/docs/features/basemaps#transparency)**: a button beside each tiled or WMS overlay's opacity sets what its tiles' alpha becomes: as served, opaque, **dark over** (a multiply: a grey relief render shades the imagery) or **light over** (a screen). Kept with the overlay; the Library gives the default. The Maya local dominance layers now default to light over: their ground is dark and the mounds bright, so drawn opaque they were a black sheet with white specks.
- **Overlays draw in the Simple basemap mode too**: a checked overlay drew nothing unless the basemaps were per view (Split).
- **Hidden means no requests**: unchecking an overlay with the Basemap section off no longer switches the section back on (which reloaded every other overlay and the basemap); overlays are not mounted in a split view that hides the basemap (an image overlay downloaded its picture there); an Allmaps overlay at opacity 0 is removed (its warped layer kept fetching); the minimized minimap loads no imagery; the Wayback, Esri, Bing and Google Earth date lookups run only where a shown view or the open timeline needs them (they ran on every move whatever basemap was picked).
- **NASA MERRA-2 month by month on the timeline**: the five MERRA-2 climate fields (2 m air temperature, wind speed, dust, aerosol optical thickness, ozone at 50 hPa) are timeline catalogs, one map a month from January 1980 to two months ago, from NASA GIBS. The Library overlays stay at GIBS's latest month.
- **Open In**: LiDAR Lens moves to the end of the list (Britain and Ireland only: its terrain is fixed at build time, no URL takes another DEM).
- Sources: `alphaMode` (`served`, `opaque`, `multiply`, `screen`) replaces `forceOpaque` in the Library (still read on stored sources, as `opaque`); the order is the user's choice, then the Library entry's, then `forceOpaque` (`resolveAlphaMode`, `lib/source-alpha.ts`). `tiletx://`'s `o=` is the mode's index. Multiply is black with alpha 255 minus the Rec. 709 luminance, screen white with alpha the luminance; alpha 0 stays 0.
- `useResolvedWaybackRelease`, `useEsriLiveCaptureDate`, `useBingCaptureDate`, `useGeHistoricalDates` and `useWaybackDynamicAttribution` take an `enabled` flag.
- MERRA-2 series: `MERRA2_LAYERS` in `lib/national-historical.ts` (months GIBS lacks for a layer left out); not in the STAC catalog build.
- Open In: the QGIS plugin's list follows (`qgis-plugin/send2map_app/destinations.py`).

##### One Library Dialog, Short Credits

- **[Library](/docs/features/national-datasets) in one dialog**: the Terrain and Basemap tabs switch the list inside the same dialog, and the filter sits beside the tabs.
- **Credits stay folded**: the map's credits open only when you click the ⓘ, and no longer spread across the map on their own.
- **[Short credits on the map](/docs/features/byod#editing-the-lists)**: sources from the same publisher share one short credit line (seventeen Maya renders read as one); the full credit stays in Source Info.

- Former TL;DR: **[Library](/docs/features/national-datasets) in one dialog**: the Terrain and Basemap tabs now swap the list inside the same dialog, with no fade out and in. The tabs are larger and the filter sits at the right of the tab row (under it on a narrow screen), with Load all and Clear all below.
- **Attribution stays folded**: the map's credits open only when you click the ⓘ. They used to open by themselves when the sources changed or the layout moved the control, and with the Maya renders on the box spread a paragraph across the whole map. Opened, it is a card with the theme's corners and padding, at most 32 rem wide, scrolling past 40% of the screen.
- **Short credits on the map**: a Library entry with a long credit carries a short one for the map line (`shortAttribution`: publisher and licence code, "MARI-GISLAB (Tulane), CC BY-NC-SA"), linked to the licence. Entries of one publisher then give the same line, shown once: seventeen Maya renders read as one credit. The full credit stays in Source Info. Set on 53 entries, the pre-rendered relief overlays with long credits and the Chaco Canyon lidar.
- The marker was `2026-11-24`, the same as Library Tabs' (two entries with one key); `T16:47` is this entry's commit time.
- MapLibre's `AttributionControl._updateCompact` opens the box the first time credits arrive, and this app re-creates the control when the bottom-right view changes; the credits were computed while its container was still detached, out of reach of the MutationObserver that folded it. `components/MapControls/AttributionControlCollapsed.tsx` replaces both: it overrides `_updateCompact` (keep compact, close unless the user opened it) and `_updateCompactMinimize` (a drag folds the box and closes the `<details>` too, which the vendor leaves out of step).
- A source added from the Library before it had a short credit takes the Library's (same id), unless its credit was edited since.
- Opening a library from a link (`?openLibrary=`) or the tour unfolds its sidebar section, where the list lives.

##### QGIS Plugins Release, Drag-to-Install DMG

- **[QGIS plugins](/docs/dev/qgis-plugin) to download**: Terrain Viewer and Send2MapApp for QGIS 3.22 to 4.x, installed from ZIP. Send2MapApp now sits on the Web toolbar and behaves like a QGIS map tool.
- **The macOS app installs by dragging**: the disk image opens on the usual drag-to-Applications window, and the [desktop page](/docs/features/advanced/desktop#opening-the-macos-build) explains how to open an app that is not notarized.

- Former TL;DR: **QGIS plugins on a release**: [`qgis-plugins-2026-11-24`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-24) holds Terrain Viewer 0.2.2 and Send2MapApp 0.5.0 as zips to install in QGIS 3.22 to 4.x (Plugins > Manage and Install Plugins > Install from ZIP).
- **Send2MapApp behaves like a QGIS tool**: its button is on the Web toolbar, its map tool has a crosshair cursor with an "open elsewhere" badge and unchecks itself when another map tool is picked, and its icons are QGIS-style SVGs (QGIS's own 3D globe for Google Maps 3D and Bing Maps 3D).
- **The macOS disk image opens on a drag-to-install window**: the app, a shortcut to Applications and an arrow between them. The desktop page explains the first launch of an app that is not notarized (System Settings > Privacy & Security > Open Anyway) and what signing and notarizing would take.
- **Tile service: `/tiles/{z}/{x}/{y}` and `/modes` are removed**, a few hours after being deprecated: `/terrain-tiles`, `/basemap-tiles`, `/processes` and `/view` replace them, and the old addresses answer 404 naming the new ones. titiler's `/tiles/WebMercatorQuad/...` still answers.
- QGIS plugins: both `metadata.txt` carry the homepage, tracker, repository, tags and an SVG icon (Terrain Viewer's is the app's favicon), `hasProcessingProvider=no` and `server=False`; an `email`, required by plugins.qgis.org, is still to be added. Terrain Viewer 0.2.2 drops its fallback to `/modes` and `/tiles` (a service from before 2026-11-24 is refused with a message to update it) and moves its button to the Web toolbar.
- Send2MapApp 0.5.0: the map tool is a `QgsMapToolEmitPoint`; the destination is kept under `plugins/send2map_app/destination` (0.4.0's `send2map_app/destination` is still read). The headless test checks the cursor, the icons, the tool unchecking on Pan, and a right click opening nothing.
- Desktop: `desktop/dmg-settings.py` lays out the dmg with dmgbuild (Finder's layout written without Finder, so it works on a CI runner); without dmgbuild, hdiutil packs the app and the Applications link in Finder's default layout.

##### Pre-rendered Relief Library

- **[Pre-rendered relief](/docs/features/basemaps#pre-rendered-relief) in the basemap Library**: 76 shaded and enhanced relief maps already rendered by their publishers, from about 30 countries and regions (national lidar hillshades of England, France, Germany, Japan's red relief map, the United States and more), each with its credit and licence. Handy for archaeology.
- **More Maya lidar**: blocks and transects over Campeche and Yucatán, and NASA strips across Campeche and Quintana Roo.
- **Maya layers fixed**: the sky view factor and local dominance layers are no longer half transparent, and they no longer vanish when you zoom out.

- Former TL;DR: **Pre-rendered relief in the basemap Library**: a section of its own, folded at first, for shaded and enhanced relief already rendered by a publisher, with archaeology in mind: 76 new overlays from about 30 countries and regions, among them the national and regional lidar hillshades of England, Ireland, the Netherlands, Flanders (with a 25 cm sky view factor), Wallonia, Luxembourg, Norway, Sweden, Finland, Germany (basemap.de and nine Länder), Austria, Switzerland, Czechia, Slovakia, Poland, France (IGN LiDAR HD), Spain, Portugal, South Tyrol, the US (3DEP), Canada, Mexico, Japan (GSI's red relief map and hypsometric tints, CS立体図), New Zealand and Australia. Each carries its publisher's credit and licence. The twelve Maya lidar renders and the Antarctic hillshade moved into it.
- **More Maya lidar**: the Alianza M-REDD+ blocks and transects (Campeche and Yucatán, 2014) and the NASA G-LiHT strips across Campeche and Quintana Roo, from Tulane's MARI-GISLAB (CC BY-NC-SA 4.0, non-commercial); `?project=maya-lidar-campeche` opens them with Chactun.
- **The Maya sky view factor and local dominance layers are opaque**: their tiles carry an alpha of about one half on every pixel, so even at 100 % they showed half the map through. They are drawn opaque now, no-data left transparent.
- **The Maya layers no longer vanish when zooming out**: the services have no tiles under zoom 11 or 12 (15 for Chactun's sky view factor); the three levels below are assembled from those tiles.
- Library: a source's `libraryGroup` (a key of `lib/library-groups.ts`) lists it in a thematic section after the scope sections; the search reads the group's title and keywords with each row. Adding a group is one record.
- Sources: `forceOpaque` and `underzoom` (1 to 3 levels; only the tiles inside `bounds` are fetched, at most 64 per tile) are read through a new `tiletx://` protocol (`lib/tile-transform-protocol.ts`), for any tiled or WMS raster source. A source added before the Library gave it either field gets it from the Library entry with the same id. Chactun's sky view factor goes to zoom 20, as its service does.

##### Library Tabs, Credits on the Map

- **[Library](/docs/features/national-datasets) tabs**: the Library has a Terrain and a Basemap tab. Your filter carries over, and a search that finds little in one tab points to the other.
- **[Credits on the map](/docs/features/byod#editing-the-lists)**: overlays, Library basemaps and the terrain source now show their credit in the map's attribution while they are drawn.
- **Hidden basemaps stop loading tiles**: a basemap or overlay at opacity 0 no longer downloads tiles.

- Former TL;DR: **Library tabs**: the Library has a Terrain and a Basemap tab. The filter carries over, each tab shows its matches while you type, and a search that finds little in one tab offers the other ("4 matches in Basemaps"). It opens on the tab of the section it was opened from, and an entry goes to that tab's list.
- **Credits on the map**: overlays, your own and Library basemaps and the terrain source now put their credit in the map's attribution (their `attribution`, else their name, linked to their page), only while drawn, each line once.
- **Hidden basemaps stop loading tiles**: a raster basemap or an overlay at opacity 0 was still downloading every tile in view; it is now hidden, so it loads nothing until shown again, from its kept cache. The OpenStreetMap vector basemap likewise stops where a split view does not draw the basemap.
- Tile loading: MapLibre requests tiles for every source a visible layer uses, whatever the layer's opacity (`StyleLayer.isHidden` reads only zoom range and visibility; `TileManager.update` asks for no tile when the source is unused). Switched off, unchecked, and views outside the layout were already free: a switched-off basemap's layer is `visibility: none`, an unchecked overlay and the overlays of a switched-off basemap are unmounted, and only the views of the current layout are mounted.
- Open In: Aguacero WX and Senter Farms' CutSheetRX read no location from their URL (saved-item ids, local storage, a preset place), so neither can be a destination; [Related Work](/docs/resources/related-work) says so for each.

# Changelog — Tile Service, Terrain Viewer in Claude, Land Cover

<!-- released: 2026-11-21 -->

#### TL;DR

- **[Tile service](/docs/dev/tile-service)**: what the app draws, as XYZ tiles, pictures of a viewport and vector tiles of the overlays, from a Docker image (`ghcr.io/iconem/terrain-viewer-tiles`). Every 2D terrain mode, and the overlays (contours with their labels, the iso-line, the mound detector, the plane slicer, the graticule, the dark theme), is computed in the server by the app's own code in a fraction of a second, from every kind of source the app reads, matching the app's tiles within a level or two out of 255; 3D, imagery and split views are drawn by the app in a headless browser. `/sources`, `/colorramps` and `/algorithms` name what can be asked for, titiler's addresses work, and a Scalar page tries it all.
- **[Terrain Viewer in Claude](/docs/features/mcp-server)**: the MCP server shows the app itself in the conversation, interactive with every mode asked for, and a picture of the exact view when the host will not run it. It installs from a Claude Code prompt, with or without Docker (`ghcr.io/iconem/terrain-viewer-mcp`), and its elevations and pictures of flat views need no browser.
- **Maya lowlands lidar renders in the Library**: Tikal, Holmul, La Corona (PACUNAM Lidar Initiative, 1 m) and Chactun (0.5 m), each as a multi-direction hillshade, a sky view factor and a local dominance overlay, from the public tiles of the Middle American Research Institute GIS Lab (MARI-GISLAB) at Tulane University, credited as each item states (Estrada-Belli et al. 2023, the La Corona and Holmul projects, Ivan Šprajc / ZRC SAZU for Chactun), CC BY-NC-SA 4.0; used in Estrada-Belli, Canuto, Šprajc and Fernandez-Diaz (2025), doi:10.1016/j.jasrep.2025.105288. Renders only: the elevation itself is not shared. `?project=maya-lidar` opens all twelve at once as overlays over Tikal. A link or project that names overlays (`overlayBasemapIds`) now loads them from the Library for a visitor who has never added them.
- **Land cover in the Library**: ESA WorldCover, Esri 10 m, MODIS, Corine 2018, NLCD 2021, IGN OCS GE (cover and use) and CoSIA, Copernicus 100 m (2015, 2019) and the Copernicus 10 m LCM-10 map of 2020. A Library search ignores hyphens and spaces and tolerates typos ("landcover", "land-use").
- **New terrain**: Meta/WRI canopy height v2 (1 m, global), and Google GEM-15 DTM as the last of the Worldwide Defaults.
- **Copy snapshot** copies the link of the view first, then the picture, so a clipboard history holds both.

#### Details

- Tile service: the QGIS project and the plugin's share links put a mode's opacity times its panel group's (Terrain Analysis, Relief Visualization, Lighting Effects) on the QGIS layer and ask its tiles opaque. The group's opacity stayed in every tile address and was drawn into the pixels, so a Relief Visualization at 60 % gave sky view factor tiles 60 % transparent behind a QGIS layer at 100 %; shading layers counted their opacity twice. In the API reference, several `modes` are sent comma-separated (Scalar sent `modes=a&modes=b` and only the first was drawn). The docs list what a public deployment needs in front of the service (rate and concurrency limits, an allow list or sign-in, a cache).
- Tile service: the direct engine rebuilds the map's layer stack from the app's URL parameters and computes each layer with the app's protocols and paint functions (moved to `lib/layer-paints.ts` and `lib/mode-relief.ts` so the map and the server share them); the hillshade is MapLibre's shader rewritten in JavaScript. `node tile-server/compare-engines.mjs` compares the two engines tile by tile.
- Tile service: a source can be named by id or given whole as a JSON configuration; `x-tv-engine` and `x-tv-engine-why` say which engine drew an answer and why not the direct one.
- MCP server: the view loads the app's script and stylesheets from its address and runs it in the conversation (Claude refuses to frame a site for a custom connector); every host of the built-in terrain and raster lists is declared. The app's own stylesheets from other hosts (MapLibre, the geocoder, the fonts) are loaded, and the view's styles no longer reach the app.
- MCP server: in a stack with the tile service it asks it for the pictures it cannot draw itself (`TV_RENDER_URL`); both images are rebuilt by a GitHub workflow on each change.
- Copy snapshot: both clipboard writes start inside the click, so Safari accepts the second one.
- Library: class rasters (the Copernicus 100 m maps) are read with nearest neighbour, where bilinear blended class codes along every edge.
- Asking for one mode of a group (aspect, sky-view factor, matcap, the iso-line, the graticule) through the MCP server or the tile service no longer also shows the group's default mode (slope, LRM, Phong, the contours).
- Discrete colour ramps: the class above the last stop drew transparent (shape index's domes, any value at or past the top of a custom discrete ramp). MapLibre packs the stops in the elevation's encoding, so the last pair of stops, a thousandth apart, became one value and the shader divided 0 by 0; a last stop beyond the encoding's step keeps them apart.
- Tile service: the direct engine reads the colour ramps as MapLibre does (stops rounded to the encoding's step, an 8-bit colour texture), and draws the overlays as the map stacks them: iso-line and graticule, mound markers, plane slicer, then the contours and their labels on top. `/contours` follows `contourReferenceMode=lrm`.
- Tile service: `/tiles/{z}/{x}/{y}.pbf` (the tile address, the extension choosing raster or vector) serves the contours, the iso-line (band, line, cliff edge), the mound candidates and the graticule as vector tiles, with a TileJSON; the raster tiles of these overlays are drawn from the same features.
- Tile service: its own package, `tile-server/`, with its own Dockerfile; the MCP server (`mcp/`) imports the link builder, the engines and the elevation reader from it.
- Tile service: `/qgis.qgz` is the project of a view (the query of a share link works as is): every layer stacked as the map and grouped as its panel, the view's layers checked and configured, its basemap and overlays under them. **Share** offers it as **Export QGIS project** when a tile service is set in **Settings > Tile Service**.
- Tile service: the QGIS project shows no line along tile edges: each layer asks for opaque tiles and carries the view's opacity as a QGIS layer setting, and the shading layers (hillshade, Phong, shadows) are multiplied over the layers under them.
- Tile service: the QGIS project's vector tile layers (contours, graticule, iso-line, mound candidates, plane slicer) open instead of being reported unavailable, each styled (QGIS refuses a vector tile layer with no style), and fetch their tiles (the project wrote their "?" encoded, which QGIS sent as is; the service now also reads that form).
- Tile service: holds up under several QGIS windows: a tile whose client has gone is dropped before it is drawn, the direct engine draws in worker threads (one per core but one, at most 8, each loading the app code as it starts), so the server keeps answering while sky view factor or openness tiles render, and a cancelled or timed-out tile has its worker ended, which stops the work; a request waiting over 30 s gets a 503 with Retry-After (90 s unanswered: 504). `/health` shows each engine's queue and the workers. The service's root address opens its Scalar page (`/docs`); a client asking for JSON still gets the index.
- Tile service: [values, not colours](/docs/dev/tile-service#values-not-colours): a mode's numbers before its ramp, in natural units (slope and aspect in degrees, TRI, TPI, roughness and LRM in metres, sky view factor 0 to 1, openness in degrees, curvature per metre, the source's elevation in metres), as Float32 GeoTIFF tiles (`/tiles/{z}/{x}/{y}.tif?modes=slope`), over a box (`/render.tif?bbox=...`, like a WCS), packed in a PNG for a web map (`.png?encoding=terrarium`), and as one GDAL raster (`/gdal.xml?modes=slope`, opened by gdalinfo, rasterio and QGIS). The GeoTIFFs are deflate-compressed with the floating-point predictor (lossless, 2 to 6 ms a tile; `compression=none` skips it). The values are read before the app's internal RGB packing, so curvature is no longer clamped at ±0.33 1/m nor rounded to its step. The QGIS project has a Values group with one such layer per mode, and the plugin a "values" box per mode.
- Tile service: the API reference (`/docs`) moves to Scalar 1.77, which shows a test request's image (1.25 answered "Preview unavailable" for every PNG).
- **[QGIS plugin](/docs/dev/qgis-plugin)** (experimental, `qgis-plugin/`): a panel with the app's sidebar groups in QGIS 3.28+ and 4; each checked mode is a tile service layer, its settings rewrite the layer's address, overlays also as vector tiles, and **Open from link** loads a share link's layers. The tile service's new `/modes` lists the modes with their settings, for it.
- QGIS plugin: **Freeze** (0.2.0) copies the layers drawn now into a new group named with the time and the place ("Frozen 14:32 — 44.51, 4.00 z11"), XYZ, vector tile and values layers alike, every setting in their addresses, with their opacity, blending, style and order; the panel never changes the copies, so several freezes compare settings side by side.
- QGIS plugin (0.2.1): the group the panel follows is "Terrain Viewer (live)" and the frozen ones carry the date ("Frozen 2026-11-24 14:05 — 44.51, 4.00 z11"), the live group on top. It is found by a group property, so renaming it is harmless; a project saved with a "Terrain Viewer" group has it renamed.
- **QGIS "Open in" plugin** (`qgis-plugin/send2map_app/`, Send2MapApp 0.4.0): the view or the point clicked in QGIS opened in Terrain Viewer, its historical mode, and every destination of the app's "Open in" list (Google Earth web and 3D, Google Maps 3D, Bing Maps 3D, ESRI Wayback, ShadeMap, LiDAR Lens, Iconem River-REM and Search-EO, BBBike MapCompare), plus Maxar and Google Earth Pro, from a toolbar dropdown, a map tool and the canvas's right-click menu, at the canvas's scale and rotation, in QGIS 3.22 to 4.x. It descends from NextGIS's Send2GE (`send2google_earth`, Maxim Dubinin), GPL v2 or later, kept with its credits. `qgis-plugin/test_open_in.py` checks its URLs against the app's.
- Tile service: the elevation modes are at `/terrain-tiles/{z}/{x}/{y}` and the imagery at `/basemap-tiles/{z}/{x}/{y}` (`imagerySource`, `imageryDate`, `imageryUrl` and the basemap parameters). Each mode is described as an [OGC API - Processes](/docs/dev/tile-service#ogc-api---processes) process at `/processes/{id}`: its settings as inputs with their JSON Schema, its PNG and GeoTIFF outputs, and `x-tv-` properties for its panel group, opacity parameters, stacking rank and values' unit and range; `/` and `/conformance` follow OGC API Common, and the processes run by linking their tiles. The old `/tiles/{z}/{x}/{y}` and `/modes` still answer, with a `Deprecation` header and a `Link` to their successor. The QGIS project and the plugin ask the new addresses (the plugin reads `/processes`, and `/modes` from an older service). The API reference explains how several `modes` stack: their order, how a mode's opacity and its group's multiply, the blending, and what is refused together.
- Tile service: building shadows are drawn by the direct engine (the OpenStreetMap footprints swept as the map's layer does); the plane slicer is served as vector tiles (`plane-slicer`).
- [One source schema](/docs/dev/source-schema): the built-in terrain sources, the Library and your own sources are one record type, looked up by id in one place (`lib/terrain-catalog.ts`); the map, the derived modes, contours, exports, the GDAL commands and the tile service read a built-in the same way as any other source. GEM-15 DTM is a real Worldwide Default (picking it no longer copies it into Bring Your Own Data). The GDAL commands now cover your own and Library sources too, COG, VRT and raw WMS through titiler. The fixed-address basemaps (Google, Bing, Esri, Mapbox, MapTiler, HERE) are entries of the same schema.
- [Dated imagery schema](/docs/dev/source-schema#dated-imagery): Esri Wayback, NASA HLS, Google Earth historical, Planet, EOX Sentinel-2 and Bing are entries of one dated schema (`lib/dated-imagery.ts`: the dates at a place, the tiles of a date, the ceiling). The map's basemap, the multi-date export, the timeline's fixed date lists and the MCP server read them through it; `imagery_dates` now also lists EOX's years and Bing's capture date.
- Dated imagery schema: the national and regional series (about seventy agencies' historical orthophotos, Google Earth Timelapse, Landsat WELD, Planetary Computer's mosaics) are dated sources of the same schema (`lib/national-dated.ts`). The MCP server's `imagery_dates` lists the ones covering the place, each year with the layer `open_view` shows (PNOA's years in Madrid, PDOK's in Amsterdam).
- Dated imagery schema: STAC catalogs are dated sources too, through one adapter configured per catalog (`lib/stac-dated.ts`: endpoint, collections, asset, signing, ceiling), with OpenAerialMap, Maxar, Vantor and NOAA open data (HOT's STAC API) and Planetary Computer's Sentinel-2 scenes as presets. A date is a day of acquisition at the place, its items mosaicked over their footprints, its ceiling from their GSD; Planetary Computer's assets are signed with its SAS token. `imagery_dates` lists them, each day with its footprint and a COG to show; the timeline's HOT catalogs share the adapter's search, which now follows `next` pages.
- Tile service: the Mapbox, MapTiler and Cesium ion sources are drawn with the caller's own key (`mapboxKey`, `maptilerKey`, `cesiumIonKey`), by both engines; a key the provider refuses gives an error that says so.
- Tile service: contour labels and cliff teeth are placed as MapLibre places line symbols (per tile, its spacing and offsets, its 45° bend limit, its tile order for collisions), and mound rings are drawn as MapLibre's circle shader draws them; against the app, the mound detector went from 11 to 2, the cliff teeth from 13.6 to 5.2, the local relief contours from 13.1 to 8.5. The image carries Noto Sans, the font of the map's labels.
- Tile service: `/qgis.qgz`, a QGIS project with every mode as a layer, grouped as the app's panel, unchecked, over a Google hybrid basemap; `background=none` gives transparent tiles to stack (a pixel left empty was written opaque black, now transparent).
- Tile service: the engine comparison leaves contour labels out.
- Tile service: the browser engine waits for the map to stay idle twice, so a layer that adds its source after the first idle (the contours) is in the picture.
- Coverage: **NASA G-LiHT airborne LiDAR** joins the 3D and LiDAR coverage overlays: the 1 521 campaigns of NASA Goddard's G-LiHT (2011-2026, 68 850 cells, Alaska, Puerto Rico, Florida, the eastern US, Mexico) from the webmap's own index, each with its date, strips or wall-to-wall block, the size of its DTM and canopy height downloads, and whether it can be streamed. [NASA G-LiHT](/docs/dev/g-liht) has the tests: glihtdata.gsfc.nasa.gov sends no CORS header, its GeoTIFFs are stripped Float32 inside gzip, its KMZs are hillshade pictures and LP DAAC's copy needs Earthdata Login, so only the Yucatan transects OpenTopography re-hosts can be drawn; the Kiuic blocks (93 km² wall to wall in the Puuc) and the canopy height models would need re-hosting.
- Library: **USA - Chaco Canyon NCALM 2016 LiDAR DTM 0.5m** (543 km² over Chaco Culture NHP, OpenTopography, CC BY 4.0), through titiler from z14: its COGs carry no overviews.

# Changelog — Faster Terrain Analysis, Native Draping

<!-- released: 2026-11-17 -->

#### TL;DR

- **Much faster terrain analysis**: every relief mode computes its tiles several times faster, with exactly the same pixels (measured times below). A difference between a fine and a coarse DEM no longer asks the coarse one for tiles it does not have, which cost 0.1 to 0.3 s on every tile.
- **Off the main thread**: contours and the heavy relief modes (Sky View Factor, Openness, Local Dominance, Hard Shadows) are computed in background workers, several tiles at once. A screenful of those relief tiles lands 3 to 4 times sooner and the page no longer freezes while it computes; contours land about 30% sooner now that MapLibre runs four workers instead of one.
- **Tools on every view**: in a split or grid, drawing, the Elevation Picker, the Sun Shadow Calculator and the mound candidates work on whichever view you click, not only on view A.
- **Live Phong and Matcap draped by MapLibre**: on 3D terrain they are drawn into MapLibre's terrain tiles only when something changes, instead of every frame.

| Time per tile | Before (ms) | Now (ms) | Gain |
|---|---|---|---|
| DEM difference, 512 px (256 px) | 35.5 (8.4) | 7.4 (1.6) | 4.8x (5.4x) |
| Local Relief Model, radius 16 (64) | 22.8 (22.3) | 2.5 (2.6) | 9.1x (8.7x) |
| Slope | 22.5 | 8.8 | 2.6x |
| Curvature | 25.4 | 6.0 | 4.2x |
| Sky View Factor, radius 8 (32) | 928 (2936) | 116 (242) | 8.0x (12x) |
| Openness, radius 8 (32) | 894 (2898) | 94 (218) | 9.5x (13x) |
| Hard Shadows, radius 16 (64) | 297 (712) | 12.6 (37.6) | 24x (19x) |
| Local Dominance | 474 | 262 | 1.8x |
| Blobness | 212 | 8.0 | 26x |
| Aspect | 32.6 | 12.1 | 2.7x |

#### Details

- Hypsometric range: the range button has three states. Off keeps the ramp's own bounds, one click sets the range once from the terrain in view, a second makes it follow the view (the 1st to 99th percentile of the elevations on screen, re-read when the map settles, `hypsoAutoRange` in the link), a third goes back to off.
- Drawing works on every view of a split, not only on view A: draw, select, move a vertex or delete on any view, and start a shape on one view to finish it on another. Selection handles and the shape in progress show on all views. With a large layer loaded (32,751 points on four views), moving the pointer while drawing a line cost about 25 ms of store copying plus 64 ms of redrawing per move; it is now under 1 ms and 2 ms. The opacity slider multiplies each layer's own opacity instead of replacing it.
- Drawing: nothing can be drawn into a layer that is not shown. The drawing modes are disabled while the active layer is hidden or "Show drawings" is off, and a mode in progress goes back to Select.
- Elevation Picker and Sun Shadow Calculator: a click on any view of a split places the point, and the markers, the profile line and the shadow line are drawn on all of them. Each point's elevation is read from the terrain source of the view it was clicked on (the same spot clicked on two views compares two DEMs), and the profile follows the view of the last point. The profile chart also draws the same line on the other views' terrain sources, each in its view's colour, to compare a surface model with a ground model or two surveys.
- The profile's line of sight (the dashed sight line, the terrain above it in red, the Clear or Blocked verdict, the mast height) is a switch, off by default. The chart has a regular grid with round steps on both axes and states its vertical exaggeration.
- Fixed: on a dataset whose tiles are 512 px but declared 256 (Open Waters Seascape, the Spanish IDEE Terrain-RGB, Re:Earth), slope, sky-view factor and the other computed modes, and the Iso-line at a value, were drawn at twice their size from each tile's corner.
- Sliders: hold Ctrl or Shift while dragging to move the value by the distance travelled instead of to the cursor, twenty times slower and in steps twenty times finer. The key can be pressed before the press or in the middle of a drag.
- Fixed: with the side panel closed on load, the view opened about 430 px east and 200 px south of the link's centre (and a 2D project such as Dura wrote that wrong centre back into the link). Two animations that changed nothing were started before the map had its real size.
- Elevation profile: one line per view, also when two views show the same source, and the lines are read again when a view's terrain source changes or a view is added.
- A saved snapshot carries the link of the view and the data credits in its file: EXIF in a JPEG (ImageDescription, Copyright, Software, DateTime), text chunks in a PNG (Description, Source, Copyright, Software).
- The Dura project opens with its basemap at 90% opacity, centred on the frescoes. A second project, `?project=dura-walls`, shows the four walls of the synagogue in one view (the 2 mm mosaic).
- MCP server: the picture shows the maps without the search box and buttons; a ? under the view says which display was chosen and what the host allows. A picture is rendered once for the assistant and the conversation, starts rendering as soon as the view is asked for, and is taken as soon as the maps have finished drawing instead of after fixed pauses.
- The app runs inside a frame that has no origin of its own (some chat hosts frame an MCP App that way): settings stay in memory for the visit, and the map's workers start through a script the frame makes itself. It stayed blank there before.
- Mound candidates are computed and drawn on every view, each from that view's terrain source (two DEMs side by side show two sets of candidates), and a click on a candidate opens its values on the view clicked. Views that share a terrain source compute each tile once. Freeze and the export still read view A.
- Timeline: the catalog search covers what all the views show, and a pick is framed on the view it went to.
- Drawing: a CSV of points imports like any vector file, from a file, a URL or `drawingUrl`. It needs a header row with a latitude and a longitude column (lat, latitude or y; lon, lng, longitude or x); the other columns become properties.
- `scrollTo=featureIterator` in a link opens the Drawing section and starts the Feature Iterator on the layer the link loaded. The iterator has an **Order** select: the file's own order, or any numeric property, highest first (`iteratorSort=<property>` in a link), with the current feature's value shown beside it, and a **Filter** select: one value of a text property that takes few distinct values, with its count (`iteratorFilter=<property>:<value>`). The feature the iterator is on is ringed in the selection colour on every view, a link that starts the iterator no longer fits the whole layer first, and the empty "Layer 1" is not listed beside a linked layer.
- Moving the view more than 0.1 degree no longer rebuilds the terrain and hillshade sources twice (the probed maximum zoom was reset, then set again), which blanked the view on every Feature Iterator step and on long pans.
- A **Crater candidates** entry in the Featured bookmarks: four views (hillshade, hypso and slope; Google imagery; Phong; sky-view factor), a remote CSV of detections and the Feature Iterator sorted by quality, opened as a link.
- The Feature Iterator panel is one grid (Feature, Filter, Order, Zoom) with every control the same height. A linked layer is listed by name with a spinner while its file loads.
- Colour ramp tabs: the tab is derived from the stored tab and the ramp instead of being corrected by an effect, and the ramp select ignores the empty value it reported while the list changed. Clicking a tab no longer sends the ramp back to mby in Top Qgs.
- The ramp tab is now in the link with the ramp (`colorRampTab`), both written in one step, so a click on a tab cannot be read back as another tab that has the same ramp. The tab strip's background spans all the tabs.
- The Feature Iterator's Order has a direction button: highest or lowest first (`iteratorSort=<property>:asc` in a link).
- A linked drawing layer is remembered across reloads: its URL goes back into `drawingUrl` and the file is fetched again, until the layer is deleted. Hiding the layer the Feature Iterator walks also hides the ring around the current feature, and the Drawings opacity slider applies to it.
- Split view pills read "A: Hillshade" where they read "AHillshade" when only the modes are named.
- Iso-line at a value: a **Smoothing** slider (0 to 16 px, `isolineSmooth`) blurs the measure before the line and its fill are traced, so the line follows the shape of an area rather than every pixel. Cliff teeth keep their own 4 px minimum.
- Elevation picker in LRM: a point and a path are now read at the zoom the map is drawn at. Before, a point read the finest zoom and a path a zoom picked from its length, and since the LRM radius is in pixels the same summit read 145 m as a point and 394 m on a long path. A path stays 160 evenly spaced samples.
- The Contours in a Worker and Raster Compute in a Worker switches are gone from Settings: both are always on.
- Timeline: picking a year of a global yearly mosaic (Google Earth Timelapse, the Planetary Computer Landsat and Sentinel-2 series) replaces the year already on the view instead of stacking a layer per year, and a pick already in the stack comes back on top. Before, stepping back to a year seen earlier changed nothing, and every year visited kept loading.
- Kernels: ray offsets and distances built once per tile, one atan per direction (none for Hard Shadows, which compares slopes to tan(sun altitude) and stops at the first obstruction), nothing allocated per pixel. The padded elevation grid every mode starts from resolves its nine tiles once instead of a string-keyed lookup per pixel (about 44 ms per tile).
- MapLibre's worker pool is raised from one worker (its default on Chrome, Edge and Firefox) to cores minus 2, at most four, the same rule as the raster pool. Contours are traced there, so a screenful of ten contour tiles lands sooner: Mapterhorn contours 560 to 440 ms, Local Relief Model contours 1.5 to 0.9 s (two workers already give 450 ms and 1.1 s).
- Contours in a Worker and Raster Compute in a Worker (Settings, Streaming) are on by default. Contours run inside MapLibre's own workers with maplibre-contour; Sky View Factor, Openness, Local Dominance and Hard Shadows run in one pool of up to four workers, shared by every mode and every view. The DEM is still read on the main thread, so every terrain source works. Turn either off to go back to the main thread.
- What the pool alone buys, twelve tiles asked at once, switch off against on: Sky View Factor radius 8 1415 to 407 ms (radius 32: 2982 to 970), Openness 1152 to 334, Local Dominance 3128 to 825, Hard Shadows radius 64 766 to 252. One tile alone takes the same time. On the main thread the page missed 34 to 155 frames in freezes of about 100 ms; with the pool it misses none. Slope, Aspect, Curvature, Blobness and Local Relief Model stay on the main thread: twelve tiles take 31 to 141 ms in all and miss no frame.
- VRT mosaics read in the browser decompress their GeoTIFF blocks in workers (same switch): twelve tiles of a file already open 600 to 200 ms, 23 frames missed to none. A warm tile was 46 ms, 31 of them decompression.
- DEM difference remembers where a source stops: a tile found missing above an ancestor that exists is not asked for again, nor anything below it, for ten minutes. It applies when the source declares no maxzoom (the URL carries none): one failed request per level for the first tile of an area, none for its neighbours.
- Fixed: with Contours in a Worker off, Local Relief Model contours came back empty, and Local Relief Model point and path sampling read nothing. Both wrapped the tile, a bitmap since the encode change, as if it were PNG bytes.
- Tile seams: panning cancelled the shared fetch of a neighbour tile that visible tiles were still waiting on, so they drew an edge band as wide as their search radius, or failed. A shared fetch now stops only when every tile waiting on it is gone, and a cancelled tile never produces a result.
- Native Terrain Draping (Settings, Streaming, on by default) uses MapLibre's experimental renderToTerrainTile for live Phong and Matcap. Turn it off to go back to the previous drape, where the app builds its own terrain mesh every frame.
- Contours: minor lines are drawn from tile zoom 6 instead of 10. A tilted view loads lower-zoom tiles toward the horizon, which used to show major lines only there. The globe view still shows major lines only.
- The TL;DR table: one tile (Mapterhorn, z12, Alps; 512 px unless said), caches warm, in Chrome 158 on a 20-core desktop with nothing else running: the commit before the first speed pass (7156dfd) and this release, loaded in the same page and run in four passes of every case on the old build, then every case on the new one. Each figure is the median of the four passes (each the median of 20 runs, 2 to 8 for tiles over 200 ms); the passes agree within 3% and the pixels are identical. Sky View Factor, Openness and Local Dominance run in a worker in this release. An earlier table here, measured in a throttled preview browser, read 3 to 4 times slower for both builds, with similar gains. The app draws the table as bars, one row per setting, each scaled to its own Before, with the gain beside it.
- Imagery protocols: Google Earth Timelapse decodes each video frame once and crops every map tile from it (a year change over 16 tiles 205 to 80 ms, going back to a year already seen 208 to 1 ms, same pixels); paper removal compares squared distances instead of calling `Math.hypot` per pixel (the pixel loop of a 256 px tile 2.2 to 0.5 ms in Chrome, the whole tile about 14 to 9 ms, same pixels); a capture tile that overlaps several COGs goes back as a bitmap instead of being encoded to PNG and decoded again (14 to 3 ms for a 256 px tile over two COGs).
- A third pass on tile speed, same pixels: Blobness computes its gradients once per cell, not nine times per pixel; DEM difference and LRM use per-row and per-column bilinear tables; Slope uses the shared stitch. Two causes shared by every mode: writing a pixel as four clamped bytes (now one 32-bit store), and yielding with `setTimeout(0)`, which browsers clamp to 4 ms, so a tile waited about 130 ms doing nothing (now `scheduler.yield()`).
- DEM difference: the URL carries each operand's maxzoom, so a coarse operand is read straight from the deepest tile it has. Before, every tile tried each zoom in turn (one failed request per level, never cached) and gave up past 6 levels: a warm tile took 103 ms one level past the coarse maxzoom, 196 ms at two, 284 ms at three, now 6 to 10 ms. Exporting a difference whose operands have larger tiles no longer fails on the URL.
- Iso-band smoothing uses a running sum: 84 to 38 ms per tile at radius 4, 202 to 45 at radius 16. About half the tiles are byte-identical, the others move a few vertices by 1/4096 of a tile.
- Contours: the Minor slider starts at Off, which draws major lines only, with the Major slider then picking an interval in metres (`contourMinor=0`).
- Add basemap: the WMS layer list, QuickMapServices and the Editor Layer Index tabs have the same Basemap / Overlay choice as the manual form, WMTS and the catalogue search, so a layer can join the overlays when it is added instead of through Edit afterwards. The Editor Layer Index defaults to As listed (the index marks some layers as overlays).
- The hourglass marks on Sky View Factor, Openness, Local Dominance and terrain Shadows are gone.

# Changelog — Smoother Terrain, Links That Hold

<!-- released: 2026-11-16 -->

#### Details

- VRT reader: bilinear sampling in the composite step when upsampling, falling back to nearest next to a nodata hole, with a one-pixel read margin so tiles meet without a seam.
- Coverage and drawing links: the URL and the sidebar state synced in both directions and could swap lists forever (React error 185); one two-way sync now settles after one round.
- Esri Wayback: date lookups go through a queue of four, the releases that can hold the asked date jump ahead of it, and a view falls back to the nearest release date after 12 s.
- Drawing: "Keep in the link" is ticked by default in Import from a URL, a linked layer says it is read-only, and deleting the only layer leaves an empty Layer 1 ([issue 31](https://github.com/Iconem/terrain-viewer/issues/31)).
- URL parameters for links from the docs: `openDialog=addTerrain|dataLayers` opens a dialog once, `timelineWindow=1984,2026` sets the timeline's range, `timelineSources=none` shows only the sources a link names.
- The repository's history was rewritten to drop about 450 MB of old media: a clone is now about 15 MB, and a check in the deploy keeps heavy media out.

# Changelog — Copernicus Data Space and WMTS

<!-- released: 2026-11-14 -->

#### TL;DR

- **Copernicus Data Space in the catalogue search**: Sentinel-2 L2A and L1C scenes by date, drawn on the map in true colour through your own free Sentinel Hub configuration (its instance id goes in Settings, API Keys). The Copernicus DEM GLO-30 and GLO-90 load as terrain without an account. Every other scene is listed with its quicklook, footprint and a link to the Copernicus Browser at that place and day.
- **WMTS sources**: paste any WMTS capabilities URL in Add Basemap and pick a layer, with its style, format and date. Your Sentinel Hub configuration's layers come in one click: true and false colour, NDVI and other indices, single bands. Tested on NASA GIBS, IGN France, PNOA and swisstopo; WMTS links in catalogue results get a button too.
- **Library Browse**: datasets that are only a catalogue collection, such as the EarthDEM, ArcticDEM and REMA strips, NRCan HRDEM, LidarBC and swissALTI3D tiles, open the catalogue search on their collection over your view.
- **API keys page**: every key the app accepts, what it unlocks and where to create it. Keys stay in your browser, and saved or shared layers carry a placeholder instead.

# Changelog — Multi-asset Mosaics: Indexes and VRTs

<!-- released: 2026-11-13 -->

#### TL;DR

- **Google GEM-15**: the near-global 15 m bare-earth and surface models of October 2026 are terrain sources, plus their difference as a canopy and building height. One COG per 1° cell in its own UTM zone, about 13 500 cells, found and read per tile in the browser with no index at all.
- **Open Buildings 2.5D, whole**: Google's yearly building heights at 0.5 m, 2016 to 2023, anywhere in the Global South, and 2023 minus 2016 as building growth. An 80 KB ledger routes each tile to the right manifest among 1 173.
- **Scotland LiDAR**: 0.5 m DTM, DSM and their difference from about 9 600 files per product that had no index: the VRTs are built here and kept on a GitHub release.
- **Global 30 m models side by side**: Copernicus GLO-30, NASADEM, SRTM GL1, GEDTM30, EU DTM and SRTM15+ with the sea floor, from OpenTopography's own VRTs, next to AW3D30.
- **For GDAL and QGIS too**: every index is a plain VRT or COG URL. See [Dataset indexes](https://terrain-viewer.iconem.com/docs/dev/dataset-indexes) for resolutions, extents and sizes.

#### Details

- Google Cloud Storage buckets send no CORS header on their plain URLs; the JSON API media endpoint (`/storage/v1/b/<bucket>/o/<object>?alt=media`) serves the same bytes with CORS and Range. That one URL shape is what makes GEM-15 and Open Buildings readable in a browser, and it works for any public bucket as a plain COG source. See [Cell-routed sources](https://terrain-viewer.iconem.com/docs/dev/cell-routed-sources).
- GEM-15's surface model holds five bands in one file, so it reads about three times slower than the terrain model. It stays in the browser by default; switch the source to titiler for about a second a tile.
- The VRT reader resolves a CRS from a built-in table, then from the whole EPSG registry bundled as a 309 KB file, then from epsg.io. British National Grid used to fail on a grid-shift file the browser cannot load, and a failed projection no longer fences the camera to a point.
- The docs' screenshots, about 170 MB, moved out of the repository to a release; `pnpm docs` fetches them. The two Brazilian sample VRTs of Open Buildings are gone, replaced by the ledger.

# Changelog — Lidar Under the Canopy, Colour on the Sea

<!-- released: 2026-11-12 -->

#### TL;DR

- **New sources**: NASA G-LiHT 2013 lidar over the Maya lowlands, as two terrain sources, Yucatán West and East: 0.5 m bare earth under the forest canopy, read straight from OpenTopography's VRTs (narrow flight swaths, the terrain reads 0 between them). In the basemap **Library**, four Copernicus Marine overlays, sea surface temperature, chlorophyll, surface currents and sea ice, drawn by the service's own tile server at its latest date. See [Copernicus Marine](https://terrain-viewer.iconem.com/docs/dev/copernicus-marine).
- **Under the hood**: the app runs on React 19, and docs, slides and the theme editor are packages of one pnpm workspace, so a single install at the root covers them all with one lockfile.

# Changelog — Esri Wayback Holds Still

<!-- released: 2026-11-04 -->

#### TL;DR

- **ESRI Wayback fixes**: Esri Wayback on the timeline loads faster and stops jumping. Ticks stay dashed at the mosaic layer's release date, become plain only once the real imagery capture date has resolved, and move once to that date. Eight walks at once find a place's releases about 2.6 times faster, and a tick appears only once its release is sure to stay. See [how it works](https://terrain-viewer.iconem.com/docs/dev/esri-wayback#showing-a-place-quickly).
- **Planet BYOK**: you enter your own Planet key in Settings, and no build ships one. Month changes are debounced by 800 ms instead of 150 ms, so stepping through 12 months at 600 ms a step costs 45 tiles instead of 540; a counter on the timeline stops at 500 tiles until you allow more.
- **STAC COG Mosaics**: a Maxar, Vantor or NOAA tick draws the whole capture, by mosaicking up to 25 COGs of that capture from the same STAC collection within the viewport, instead of one 5 km cell. A tick also shows the capture's time when the catalog has one, in UTC.
- **Export buttons**: Snapshot has an arrow to switch between download and copy to clipboard, remembered. GeoTIFF is now **Elevation DEM**, **Layers** has its own button, and the layers export can zip its files into one download. See [Export & Share](https://terrain-viewer.iconem.com/docs/features/export-and-share).

#### Details

- Esri Wayback walk: each tilemap answer names the release to ask next, so a single walk runs in order. Eight now start across the catalog, stop where they meet, and the final list is rebuilt from the newest release, the same releases as one walk at all 14 places tested, in 15.6 s against 40.8 s, for 330 requests against 226. Same-size neighbours count as one image, kept at the oldest, so a release gets a tick once the next older one has answered differently: a place with 13 releases used to show 30 ticks on load, most hopping or vanishing. Dates now belong to a place, so a new place's ticks never start at the previous place's dates. Esri's metadata has holes, so up to three finer levels are asked before a tick stays dashed and says Esri gives no date. Walks and dates are kept in local storage, 300 places at most.
- Timeline: while ESRI loads, the handle stays on its date and the axis keeps its range until you click it, zoom it or change a pill, so ticks outside that range stay hidden until then. The track shows a plain cursor except on a tick; a click anywhere on it still picks the nearest tick.
- Planet: ticks are computed from 2020-01 to two months ago rather than asked of the Basemaps API on each load, which also stops the export offering 2016 to 2019 mosaics that do not exist. CI fails any build holding a Planet key.
- Captures: one catalog id is one satellite pass cut into COGs about 5 km across; a `capture://` source draws up to 25 of them, the nearest to the view. Midnight, within 2 minutes, stays a plain day, and the tick card also gives the local time at the item's centre.
- Desktop: a winget or portable copy skips the self-update it cannot do, which reported an error at every launch, and keeps its files in its own folder; uninstalling leaves nothing behind. An MIT LICENSE file joins the repository.
- Projects: the Image Georeferencer is hidden in dura, example-embed and mapterhorn-globe; dura gets Relief Visualization and Terrain Analysis back, with the Mound Detector hidden; mapterhorn-globe defaults to the GMT Globe ramp. "Suggest a new terrain source" opens [issue 29](https://github.com/Iconem/terrain-viewer/issues/29). The docs' national and regional dataset tables gain a licence column.

# Changelog — Four Decades a Year at a Time

<!-- released: 2026-10-21 -->

#### TL;DR

- **The app**: Google Earth Timelapse joins the timeline's global catalogs: one cloud-free mosaic a year from 1984 to 2022, 30 m then about 19 m, under the Medium res pill, read from the viewer's own video tiles by a new `gtimelapse://` protocol.
- **The app**: two more World catalogs next to Timelapse, Landsat a quarter at a time since 1982 and Sentinel-2 a month at a time since 2016, the window's least cloudy scenes mosaicked on the fly by Microsoft Planetary Computer, no key, through a `pcmosaic://` protocol.
- **The docs**: a dev page on the Timelapse protocol and on how Google builds the mosaics, another on the two on-the-fly tilers (NASA VEDA's titiler-cmr behind the HLS pill, Planetary Computer behind the new catalogs), and the NASA Ames Stereo Pipeline and Geopera Parallax noted for making a DEM from stereo imagery.

#### Details

- Google Earth Timelapse: Google published the annual mosaics behind its Timelapse viewer in the Earth Engine Data Catalog under CC BY 4.0, but Earth Engine only serves tiles to a signed-in project. The viewer itself reads one VP9 WebM video per tile from a public bucket, 512 px, five frames a second, a frame per year from 1984. The `gtimelapse://` protocol fetches the video of a tile once, seeks a video element to the year's frame and hands MapLibre a quadrant of it as a 256 px tile, so changing the year re-seeks cached videos and fetches nothing. The catalog, under Historical · Global next to Landsat WELD, gives a tick per year everywhere; every layer covers the globe, so no tile is probed at the view's centre. The bucket is the viewer's, not a documented endpoint, and the mosaics are balanced for the eye, not radiometric; before 1999 a gap in the archive is interpolated between the neighbouring years, so a sudden change inside a gap looks gradual. See [Google Earth Timelapse](https://terrain-viewer.iconem.com/docs/dev/google-timelapse).
- Planetary Computer catalogs: Microsoft Planetary Computer's data API tiles any STAC search over its catalog, keyless, once the search is registered with a POST. The `pcmosaic://` protocol registers one search per window, scenes with at most 10 % cloud sorted least cloudy first, and a second at 60 % for the tiles no clean scene covers, then fetches tiles by search id. Two catalogs under Catalogs › World, next to Google Earth Timelapse: Landsat 4 to 9 Collection 2, a layer a quarter from 1982 Q4 (30 m, tiles from zoom 8), and Sentinel-2 L2A true colour, a layer a month from January 2016 (10 m, from zoom 9). For each pixel the API draws the first scene in sort order that has data there, so scene seams and some cloud remain, unlike Timelapse's median mosaics. The NASA HLS pill, which has composited Harmonized Landsat Sentinel-2 granules through NASA VEDA's titiler-cmr since it was added, is documented on the same page: a 30 day window around a monthly tick, from 2016. See [On-the-fly mosaics](https://terrain-viewer.iconem.com/docs/dev/on-the-fly-mosaics).
- Docs: [Compared with other tools](https://terrain-viewer.iconem.com/docs/resources/compared-with-other-tools) gains a note on making a DEM from stereo satellite pairs with the NASA Ames Stereo Pipeline, and on Geopera Parallax, a neural matcher that replaces its dense-matching step.

# Changelog — COG Sources End Where the File Does

<!-- released: 2026-10-20 -->

#### TL;DR

- **The app**: a COG streamed in the browser lets the protocol's own TileJSON declare its finest level, so MapLibre stretches the last real tile past it instead of the protocol upsampling blocks; applies to terrain, basemap and overlay COGs alike.

#### Details

- COG sources (geomatico protocol): the Source was declared by its `cog://` URL, which makes the protocol answer a TileJSON with the file's finest level as maxzoom, but an explicit maxzoom was passed alongside it, 22 for a basemap, 19 for an overlay, the detected level for the terrain, and an explicit value overrides the TileJSON. Past the finest level MapLibre then asked the protocol for tiles it had to upsample, drawing flat blocks with rings in the hillshade and seams at tile borders. The explicit value is dropped for cog:// sources, as Oscar Fonts explained on [maplibre-cog-protocol issue 56](https://github.com/geomatico/maplibre-cog-protocol/issues/56#issuecomment-6285706300): MapLibre now reuses the finest tile and magnifies it on the GPU, as it does for every Terrain-RGB tileset. A Max Zoom typed in the source's Advanced fields still wins, and a centimetre file whose finest level lies past z22 keeps that ceiling, below MapLibre's z25 tile limit. The camera's own zoom cap is unchanged.

# Changelog — Google Earth Dates Follow the Zoom

<!-- released: 2026-10-19 -->

#### TL;DR

- **The app**: a Google Earth Historical view zoomed in from a yearly Landsat mosaic now moves its date to the sharp capture drawn, instead of upscaling the mosaic; its tiles are built one level finer into 512 px images (HiDPI Google Earth Tiles, on by default in Streaming Settings), so they are no longer stretched vertically away from the equator.
- **The docs**: a note on vertical references atop Terrain Sources (orthometric heights everywhere, the ellipsoid conversion from cesium-mapterhorn-provider), and a section on which Google Earth date is drawn as you zoom.

#### Details

- Google Earth Historical: the date lists are per tile and per level, yearly Landsat / Copernicus mosaics at low zooms, the sharp captures from about level 14. The tiles still draw the exact date, climbing to a coarser node when this level does not list it, so a mosaic picked at a low zoom was upscaled on zooming in with sharp captures a tick away. Once the camera settles, a date listed only by an ancestor moves to this level's newest capture on or before it, Google Earth's own "as of" rule; a sharp capture's date is kept at low zooms, where the tiles show the newest mosaic on or before it and the handle sits on that mosaic's tick, so repeated zooms never drift. The handle of a Google Earth view sits on the newest tick on or before its date rather than the nearest. The date list is read at the level the tiles are built from (one above the viewport zoom, two with HiDPI tiles), so the ticks switch from the mosaics to the captures where the tiles do.
- Google Earth Historical tiles were built from the Keyhole level matching the Mercator zoom, which is exact across but, the Keyhole grid being plate carrée, stretched down by 1 / cos(latitude): 1.5× at Paris, 2× at 60°. HiDPI Google Earth Tiles in Streaming Settings, on by default, builds each tile from one level finer into a 512 px image (a downsample below 60°, and a 2× image on HiDPI screens), for four times the Keyhole fetches; the finished-tile cache is bounded in bytes. The protocol page's Tile resolution section has the arithmetic.
- Terrain Sources: a note that every built-in DEM is orthometric, how far the WGS84 ellipsoid sits from it, where the offset bites (ellipsoidal sources in a Difference), and Bert Temme's EGM2008 conversion in cesium-mapterhorn-provider PR 3 as the reference method. The Esri World Elevation section had been nested inside the Sources Coverage callout; it stands on its own again.

# Changelog — Shadows on Terrain, the Docs Home and Demo Videos

<!-- released: 2026-10-15 -->

#### TL;DR

- **The app**: building shadows drape on 3D terrain (MapLibre 6.13's new per-tile hook), OSM 3D buildings as a checkbox at the end of the basemap list that draws them over any basemap (off by default) with a cog for their colour, opacity and footprint outlines, an icon per fit in the Image Georeferencer, B toggles the Overlay blend, a Bookmarks row in the storage settings, the see-through panel keeps the held control on its own band, a bottom sheet on phones, nine event DEMs and the Kilauea lidar in the library, the desktop launcher takes a project file.
- **The docs**: a real home page with the demo embedded, a Demo videos page (the narrated cut, the three takes, one of them a declarative JSON take played by a generic runner), Fumadocs Studio for visual editing with an Edit in Studio button, Fumadocs 16.17.3 with the stock page actions back, diagrams rendered at build time, app buttons in the header and the sidebar, short sidebar titles.

#### Details

In short, since October 8: the hard building shadows follow the relief, and the docs site got a front door and a video page.

- Building shadows on terrain: the layer implements MapLibre 6.13's experimental `renderToTerrainTile`, drawing its mask per terrain tile so MapLibre drapes it; the sweep length stays the flat-ground one. The footprints come from z14 OpenFreeMap tiles the layer fetches itself for the viewport widened by the longest shadow, so a tower just off screen still casts in. Sun Position documents it.
- OSM 3D buildings over any basemap: the 3D switch that sat on the OpenStreetMap row is now a checkbox at the end of the basemap list, off by default, which installs OpenFreeMap Liberty's extrusion layer alone above Google, Esri or a terrain-only view, instead of only with the OSM basemap. A cog beside it sets their look: Liberty's grey, white, black or a custom colour, the opacity, and footprint outlines (a line under each base; MapLibre's extrusions have no edges of their own).
- Image Georeferencer: an icon per fit in the Transform select, a square for similarity, a parallelogram for affine, a trapezoid for projective, a bending curve for the two non-rigid fits.
- B toggles the Blend Mode effect of the Overlay split (the picked mode stays); the switch tooltip and the Keyboard Shortcuts page say so.
- Settings, Browser Local Storage Persistence: a Bookmarks row with the count, the views, the stored size and a Clear (confirmed), beside the two OPFS stores.
- See-through panel: the held slider or pad keeps a band of its own while the card drops to 8%; the macro-group rows fade with the rest. Phone portrait: the side panel is a bottom sheet, the timeline floats over it, 8 px margins everywhere.
- Library: nine event DEMs from OpenTopography (landslides, eruptions, floods) through titiler, and the Kilauea 2018 lower East Rift Zone lidar with its lava-thickness difference. Titiler: no per-view maxzoom probe, the host as a cache key, the nodata value encoded, VRTs too. Local COG files list every problem of a file.
- Desktop: `launcher.exe C:pathproject.json` imports a project (Windows reads the launcher's own command line); an AppUserModelID; web app manifests per host (Add to Home Screen); the light build has its pictures again.
- Docs home: the Sky-View Factor picture as the hero, Launch the app and Read the docs side by side, quick links, the narrated demo embedded, feature cards of one aspect ratio.
- Demo videos page: the 145 s narrated cut, the two takes it was cut from (re-recorded after the see-through fix) and a third take, the Sharjah coast at Al Hamriyah with the 2013 and 2022 shorelines traced over Google Earth and Bing, streamed from the demo-takes release behind poster frames; the release keeps the current files only. That third take is declarative: a JSON of steps (captions, pointer moves, clicks on real controls, divider drags, camera moves, drawn vertices by longitude and latitude) played by a generic runner over agent-browser and the DevTools protocol, replacing a Playwright script; Making the demo videos documents the format.
- Fumadocs Studio: `pnpm docs` starts the visual editor beside Next; a config draws our components (Gallery from its literal, the data tables as cards) in visual mode and serves the screenshots; an Edit in Studio button appears on a localhost docs server when a Studio answers.
- Fumadocs 16.17.3: the stock page actions are back, since Next 16.3's Turbopack gives them the base path (our copy had started doubling it). Diagrams render at build time with beautiful-mermaid, no Mermaid runtime in the browser, readable in both colour schemes. A `sidebarTitle` field gives seventeen pages a short sidebar name. The Setup page moved to `/dev/setup`; `/dev` is a landing of the developer section. A mountain button in the header and before the sidebar title opens the app.
- Analytics and search: Umami reports from the real hostnames only with the website id from the build environment, the early-October spike explained (a local clone); a Bing Webmaster script; page titles rewritten for search; the historical host gets its own title and Open Graph tags.

# Changelog — Yandex, Historical Imagery Out of Beta, Guarded Match Colors

<!-- released: 2026-10-08 -->

#### TL;DR

- **Yandex Satellite in the library**: Yandex cuts its tiles in World Mercator (EPSG:3395, the ellipsoid), a dozen kilometres off Web Mercator at mid latitudes. A new `epsg3395://` protocol resamples each tile's rows onto Web Mercator in the browser, no titiler. Often the sharpest free capture over Russia, Central Asia, the Caucasus and Türkiye.
- **Match Colors guarded**: skipped while View A (or the matched view) is mostly blank or white (Esri placeholder tiles, a sheet margin, unloaded tiles), and softened when the match would shift colours by more than a quarter of the range on average. No more washed-out view B over a white A.
- **Defaults tidied**: views C to H default to Mapterhorn like A (B stays AWS, keyless), so "every view on Mapterhorn" no longer writes four URL params and a keyless visitor's grid never asks for a MapTiler key. A split divider dropped a pixel off centre snaps back to the middle, so `splitRatio=0.499` no longer sticks in the URL. The Yandex entry is just "Yandex". A hypsometric ramp tab switch wrote the ramp's name instead of its key (29 Classic ramps differ), which sent the tab elsewhere: fixed.
- **Historical imagery out of beta**: the sources and the timeline are always on, no switch in Settings (a browser that had the old switch off saw the Historical entry vanish from Worldwide Defaults). The Drawings panel's show toggle and opacity apply to every view. The Image Georeferencer's fit select names its choice. The research deck cites its papers on each slide, with a references page.
- **Historical export, fixed and cropped, in your CRS**: the output is the AOI at a ground sample distance with the width × height it gives (edit any of the three; a warning past 4096 px a side, a cap at 8192), cropped to each feature with the polygon as an alpha mask, one folder per source in the zip with a manifest. An Output CRS (3857, 4326, the UTM zone of each AOI or one fixed zone, any EPSG code) applied to the georeferencing only, the pixels staying the Web Mercator mosaic, the residual at the corners noted and a warning past 20 px; the same CRS choice on the layer exports, the DEM GeoTIFF and the snapshot world file. Before an export, one tile per source at the AOI centre tells which sources serve the requested resolution there, and the export uses the best zoom that answers. The dialog: dates can be typed, the picked day is the day picked, the dropdowns follow the theme, the capture count follows Wayback dates as they resolve. Selects and dialogs no longer overflow (fixed in the primitives). The timeline toggle shows for a historical basemap on any view of a grid.
- **Your STAC catalogs on the timeline**: a new My STAC catalogs group in the Catalogs picker takes any STAC API or static catalog.json (one collection or all), through the loader that serves the HOT catalogs: Add a catalog… in the picker, Add to the timeline on the STAC search, or a link (the id carries the endpoint, so it resolves anywhere, with a Keep button). Shipped there and in the library: Planet's Eyes on Heritage 2026 release (145 SkySat and PlanetScope scenes over eight sites). The VHR and Medium res pills judge a STAC tick by its own gsd (1 m/px is the line). [Docs](https://terrain-viewer.iconem.com/docs/features/historical-sources/#my-stac-catalogs).

#### Details

In short, since October 8: STAC catalogs on the timeline with Planet's heritage release; the historical export in any CRS with width × height and an availability check; the Umami spike found (an old clone on localhost) and the website id moved to the build environment, with tags and an owner tag; the Search Console and Bing scripts, three page titles rewritten, the historical host's own search metadata and sitemap; the toolbox embed fixes; a MapLibre version guard and pre-bundled shims on the dev server; the coverage tree, toast and switch fixes; Bing's date as one truth; the desktop pin, update size, pictures, env step and command-line arguments; Add to Home Screen; the local COG warnings and toast; the screencast pipeline with its takes and cuts.

- `lib/epsg3395-protocol.ts`: the two grids share their columns, so a Web Mercator tile reads the one or two EPSG:3395 tiles of the same x and interpolates between rows. Checked headless against Esri World Imagery on four tiles (Moscow z11 and z14, Istanbul z12, Tashkent z9): zero residual row shift, normalised cross-correlation 0.62 to 0.82, where the raw tile scores about 0.
- Library entry only (`basemap-yandex-sat`, not loaded with the samples); the Add Source modal does not offer the type. Docs: Custom Protocols lists the scheme.
- A terrain source just added (the modal, the Library, a project file) flies the map to it once, as the pin does: a local COG used to sit blank until the pin was clicked.
- Local COG files: the Add Terrain modal lists every problem of a file (its projection and its layout, where the strip warning used to hide the projection one), and a selected file the in-browser reader cannot draw (a UTM or a geographic file, the reader draws EPSG:3857 only) says so in a toast with the gdalwarp line instead of a silent blank map or a flight to null island.
- Add to Home Screen: the website installs on a phone, a tablet or a desktop from the browser (a web app manifest and icons, no service worker, nothing cached), Terrain Viewer with the mountain icon and Historical Sat with the clock. [Docs](https://terrain-viewer.iconem.com/docs/features/advanced/desktop/#on-a-phone-or-tablet-add-to-the-home-screen).
- Light desktop build: the changelog's figures and the Data layers picker's pictures show again (the build ships no docs folder; the thumbnails now ride along, under a megabyte, and any other docs picture loads from the website on a miss).
- Bing's date is one everywhere: the view pill now shows the live capture date of the tile under the view's centre, as the timeline tick and the sidebar do (it showed the date stored when the view was set, at another place or zoom: 2011 on the pill, 2021 on the timeline). Toasts: the text is selectable, the cross dismisses. Desktop: the update notice sizes the download per variant (about 37 MB light, 220 MB full) and then from the release's asset size; the taskbar pin targets launcher.exe (an AppUserModelID on the process and the shortcuts) instead of the runtime.
- Desktop command line: `launcher.exe "?lat=45.92&lng=7.03&zoom=11&viewMode=3d"` (or a full link) opens on that state, and `launcher.exe C:\path\project.json` (a project export, .json or .zip up to 50 MB, or a plain list of sources) imports it as General Settings' Import does, with a toast after the reload; both can be given. The query argument's parsing had lost its backslashes and stopped the main process from loading: fixed. Import also takes a plain sources list now. [Docs](https://terrain-viewer.iconem.com/docs/features/advanced/desktop/#command-line).
- Analytics: the Umami website id comes from the build environment, not the source, and the tracker only reports from the real hostnames (a clone run elsewhere stays silent); loads are tagged web, embed, desktop or, once `?umamiTag=owner` was opened in a browser, owner; the source-add event says whether a source came from the library or a pasted URL.
- Sources coverage: the ELI coverage group's box can be ticked while folded (the index loads for the view and every listed layer is selected); the three roots are parted by a heavier rule than the historical tree's own groups, which are dashed. A `?coverageOverlays=` link no longer forces Source Info open on every load (the fold looked unsaved; `?openSections=sourceInfo` does that on purpose); the coverage picker's switches forward their ref (a React warning on load); embedded in the HeritageWatch or Anchise toolbox, the wrapper's theme toggle now switches the app live through a `meta-app:theme` message instead of reloading the iframe (lib/embed-bridge.ts onEmbedTheme).

# Changelog — The Weekend: Historical Catalogs, National Archives, Old Maps

<!-- released: 2026-10-06 -->

#### TL;DR

- **Historical catalogs on the timeline**: every item covering the view is a tick; pick it as a view's basemap or keep it as an overlay. Open data after a disaster (OpenAerialMap, Maxar and Vantor, NOAA, Planet), community indexes (OSM ELI, ArcGIS Online, NextGIS QMS), about 70 national archives, and old maps (Allmaps, David Rumsey, Wikimaps, Map Warper, SLUB, USGS topo, CORONA). Search by name across them all.
- **Sources Coverage and Auto**: one coverage tree with footprints on the map; paste any URL in Add Basemap or Add Terrain and its type is found (tiles, WMS, COG, STAC, Allmaps, IIIF, a Rumsey or Source Cooperative page).
- **Old maps drawn well**: Remove paper on every scanned map; Allmaps maps from their tile server, tilted and draped; the Image Georeferencer's non-rigid fits (beta); one overlay stack for all.
- **Iso-line on any measure** with an exact fill and cliff teeth; building shadows; modes per view; WMS zoom ranges found by asking the server.
- **Slide decks**: five presentations, live with a presenter view and as PDFs, [on the docs](https://terrain-viewer.iconem.com/docs/features/slide-decks/).
  ![The title slide of the Terrain Viewer deck](/docs/screenshots/slides/terrain-viewer-title.jpg)

#### Details

- Timeline: overlay pills per view on a tick (drag to swap, a lock per overlay, the arrow keys move the selected one); every tick takes a view's handle; pressing a handle selects the view on the map.
- Sources: dialogs with a fixed footer; the info dialog no longer overflows; tooltips, tick cards and the sources list show GSD, date, source and licence; thumbnails on Allmaps, Map Warper, Wikimaps and ArcGIS Online ticks; BRGM geology in the library.
- Links: catalog items travel by URL with their extent (a Planet key never does); beta flags are local settings, switched on with a toast when a link needs them.
- STAC: Planet's Data API as a catalog; the catalog picker is a combobox; a dev page on the search internals.
- Fixed: the timeline panel crash in a split; a pasted WMS GetMap in another CRS; a switched-off overlay moved the camera; Allmaps maps while tilted.
- Desktop: the light build updates itself. Docs: pages renamed, the Dev group folded, the embed example on Mapterhorn.

# Changelog — Catalogs on the Timeline, Building Shadows, National Archives

<!-- released: 2026-10-05 -->

#### TL;DR
- **Catalogs on the historical timeline.** A tree next to the source pills: OSM Editor Layer Index, OpenAerialMap, Maxar and Vantor Open Data, NOAA, Planet disaster data (HOT STAC and source.coop), Map Warper, Wikimaps Warper, SLUB Kartenforum, USGS historical topo maps, ArcGIS Online, and about seventy national, regional and city archives (IGN Remonter le temps, swisstopo, Catalonia, Spain, the German Länder, Austria, Swiss cantons, Belgium's NGI maps 1860-1994, Slovenia, Italian and Spanish regions, Toronto, Ottawa, Seattle, Washington DC, New South Wales, Taiwan...). Items covering the view become ticks; picking one makes it the view's basemap and keeps its handle.
- **Building shadows** (Lighting Effects → Shadows → Buildings): OpenStreetMap buildings' shadows swept on flat ground on the GPU, live with the sun.
- **Sources Coverage** lists live what the shown overlays hold for the view, ranked by overlap; the click list is ranked the same way.
- **STAC catalog of every source** at `/docs/stac/catalog.json` (eight collections, about 3,500 items).

### Features
- Catalogs picker: fold or expand all, item footprints on the map, a filter by the timeline's window; a national group that opens by itself where its sources cover the view, sources that miss the view dimmed; tick tooltips name the source, its date and the item.
- Every source pill can be off, leaving the catalogs alone; a catalog item much smaller than the view is framed when picked; every item picked joins Your basemaps in the coverage tree with a zoom-to-fit button.
- Basemap library: Esri World Imagery Clarity, basemap.at, ČÚZK and Geoportal.gov.pl current orthophotos, the 1966 and 1969 CORONA satellite photographs of Taiwan.
- Overlays: an opacity pill per overlay and one for all (a vertical slider opens on the pill).
- 2D mode: a right-drag shows why the view does not tilt, with a Switch to 3D button.
- A map click while the elevation picker, the sun calculator or a drawing tool is active no longer opens the coverage list.
- The coverage tree is always open in Sources Coverage (Terrain, Basemaps · Static, Basemaps · Historical, the last one being the timeline's catalogs tree, Allmaps and QMS as footprint-only rows), with a master switch and a **Follow the view** switch; a tick's hover card names the item, its resolution and licence, shows a thumbnail where the catalog has one, and puts it on any view as basemap or overlay, or keeps it among your sources (picked items are transient otherwise).
- **Iso-line**, the third group of Contours & GeoGrid: a line from **any measure** (the elevation, every terrain-analysis and relief-visualization mode with its own settings, the Phong, Matcap and shadow brightness) **at a value** (an iso-slope at 30°, a sky-view factor of 0.8, a flood level), with a raster fill of the area above that stops at the line, or **every interval** of the measure (contours of the slope every 10°); the slider sized to the measure's unit; works on every terrain source, the WMS ones included.
- Source lists: a reading mode with an info button (every field, fit to extent) and the overlay's opacity pill at the right; the pencil switches the edit mode on (edit, delete, Batch edit JSON, Ctrl+Enter saves). The coverage tree's roots: post-crisis open data, community indexes, national catalogs, old maps; outlines-only footprints; the coverage and source-info parts fold.
- The coverage tree starts folded (only Terrain, Basemaps · Static and Basemaps · Historical open) and remembers what you open, in the section and the timeline's Catalogs select alike; **Expand all** and **Within the timeline window** sit above the tree with the other switches; the switches ask the catalogs again. Community indexes (ELI, QMS, ArcGIS Online) sit under Basemaps · Static, 3D and LiDAR second under Terrain, the national catalogs under a continent then a country (ISO alpha-3), the old maps flat with Allmaps and Rumsey first.
- **Search results** under the picker: one foldable, single-scroll tree of everything the overlays and the checked catalogs hold for the view, catalog items with their dates and resolutions, each with a Use button; the historical items' footprints on the map (Map Warper, the archives) are hovered and clicked like the overlays.
- **Allmaps, dated maps in view**: a catalog that dates Allmaps' maps from their IIIF title or manifest and puts them on the timeline; Allmaps footprints no longer vanish when zoomed into a city (the area window keeps city plans).
- Source rows: a hover card with the type, the index it came from, the ground resolution (declared, or estimated from the max zoom), attribution and description; the resolution after the name and in every metadata dialog; the Source info part splits into Basemap (above) and Terrain, each basemap row with its provider prefix, type and resolution and an info button to the full metadata dialog (long URLs no longer overflow it).
- Tick card: one view grid (basemap, or overlay for a warped map), a frame-extent button; the arrows walk every tick on the axis from the one the view shows, and a view keeps its item when the catalogs' answer for a new place no longer lists it.
- Batch edit is a braces button left of the pencil; the overlay opacity pill sits right after the view buttons, rounder and taller.
- Iso-line, second pass: the fill and the line are one set of polygons (marching squares on the measure tiles, `isoband://`), so the fill stops exactly on the line; the tiles follow the terrain source's zoom (a WMS DSM to zoom 19, as sharp as the shading); the measure menu shows names; the Phong measure takes the sidebar's strengths and Fresnel rim (the raster Phong tiles draw the rim now too); the slow horizon modes are out.
- Historical tree: Community indexes (the Editor Layer Index first, ArcGIS Online, NextGIS QMS) are one root shared by the sidebar and the timeline's select; the ELI footprints group is back under Basemaps · Static; ELI items have footprints on the map.
- **Remove paper**: a scanned map's paper turns transparent, warped Allmaps maps and tiled old maps alike (`unpaper://` on Map Warper, Wikimaps, SLUB, USGS and the national map series); each map's paper colour and threshold come from its own image (masked luminance histogram, Otsu split, the paper peak in colour-distance space); maps without light paper are left alone; the slider scales every detected threshold.
- Allmaps dated maps: the archive's own date (IIIF manifest first, a pre-1950 title year else), never the georeferencing's; **Remove the maps' paper** turns a warped map's background transparent (threshold, colour).
- Tick card: Fit and Keep side by side, Keep also puts the item on the view; **Picks join my sources** switch (off by default); **Active sources' extents** draws the sources on the views as dashed outlines and the rows show z≥N below their min zoom; every list and card prefixes where an item comes from (FLAI, OpenTopography, the libraries, QMS…) and shows its resolution, estimated from the max zoom when not declared.
- CORONA Atlas of the Middle East (CAST, 1963-1972) on the timeline; resolution pills default to VHR; the per-overlay opacity pill drags from the first press; the elevation profile's wheel no longer scrolls the sidebar; the coverage tree's rows and Allmaps maps have extents for zoom-to-fit; the IoU shown in the coverage lists.
- Allmaps maps drawn at the right place with a padded camera (the sidebar's): @allmaps/maplibre patched to take the canvas centre, not the padded one.
- Docs: which services can be added and which cannot, with the reason; the advocacy page gains the communities beyond OSM and GIS, the FATMAP alternatives and a #30DayMapChallenge plan; the STAC catalog opens in STAC Map and STAC Browser; an ELI contribution prepared by licence class.

# Changelog — Old Maps, QMS Coverage, Docked Profile

<!-- released: 2026-10-04 -->

#### TL;DR
- **Old maps (Allmaps).** A coverage overlay draws every georeferenced historical map in the view (Allmaps, David Rumsey included), and any of them drapes as an overlay, warped from its IIIF Georeference Annotation. The Add Basemap dialog takes such an annotation URL too.
- **NextGIS QMS coverage.** The catalog's services whose extent touches the view, sized to the zoom, each one click from being the basemap. The list under a clicked point has a filter.
- **Elevation profile.** Hover the chart for the point on the map, zoom and pan it, dock it as a bottom panel; the picker now works on phones.
- **Split pills** name the terrain, basemap or viz modes If differs, Always or Never; **Sources Coverage** sits under Terrain and Basemap; **Fresnel rim** in Phong; **threshold outlines** in contours (beta).

# Changelog — Modes per View, Image Georeferencer, Desktop Apps

<!-- released: 2026-10-02 -->

#### TL;DR
- **Modes per view.** In a split or grid, switch **Sync viz modes across views** off and every mode and sub-mode checkbox becomes the view grid: slope on C, contours on B, matcap on D. Clicking the name of a mode, or of a terrain, basemap or overlay source, switches it on for every view at once, and off everywhere when it already is on all of them; a sub-mode brings its group along; swapping views keeps the assignment. The pill under each view names only what sets it apart (its terrain or basemap when the views differ, its modes), and **clicking a pill selects that view**: every grid in the sidebar collapses to that one letter, so a mode or source then applies to the selected view only (Esc, the pill or its x deselects). Contours and graticules now draw on every view. [Split modes](/docs/features/split-modes).
- **Image Georeferencer.** Place a plain PNG or JPEG, a figure or a scan, on the map from point pairs clicked on the image and on the map in any order, in a floating window; similarity, affine or projective fit with residuals; drag the points; world file export; save the result as a basemap overlay, local pictures included, and reopen it to edit. Built on Allmaps' transform library; switch it on under Settings → Beta.
- **Desktop apps.** Windows, macOS and Linux bundles (Electrobun) built weekly on the [desktop-latest release](https://github.com/Iconem/terrain-viewer/releases/tag/desktop-latest): a self-contained Setup per platform plus a portable folder, each with the documentation bundled or online; the installed full build updates itself. [Desktop](/docs/features/advanced/desktop).
- **Phong with up to three coloured lights.** Light 1 is the app light; lights 2 and 3 have their own direction and colour, drag as pills of their colour on the light pad, and default to blue from the north-east and orange from the south-east. A **Fresnel Rim** slider adds the view-dependent grazing-angle glow on slopes that turn away from the camera (live renderer).
- **Threshold outlines** (beta): a third contour reference draws one vector outline where the terrain crosses a value, 1.5 m on an nDSM for canopy and buildings, a flood level on a DEM; exports as GeoJSON like contours.

### Features
- **Duotone NW/NE** hillshade method (grey north-west light, blue and orange north-east light, after Čučković's LiDAR hillshade) and a matching **Duotone Sphere** matcap.
- **Overlays per view and stacking.** With per-view basemaps on, each overlay row gets the view grid; an overlay can draw under the relief layers, over the hypsometric tint, or on top of everything (Edit Basemap → Draw it).
- **OpenTopography coverage** overlays (rasters and point clouds, DOI links) nested under 3D and LiDAR coverage.
- A terrain or basemap picked with the split off is set on every view, so a later split opens on it; in a split, clicking a terrain source's name sets it on every view.
- Walkthrough: a **Data Layers** step and a **Modes per View** step; the Terrain Analysis step lists its three groups.
- **Relief Green-Red** hypsometric ramp (the archaeological LiDAR palette) in the Classic tab; Mean/Combined curvature opens at ±1.
- The About section shows the build day and commit, and **Is this the latest version?** compares them with the newest commit and the desktop release; Source Info waits for zoom 5 before listing datasets.
- Share: **Name my sources by URL** writes your own remote terrain, basemap and overlay sources into the link by URL and type, with their names, so the recipient's app loads them without having them in its library (local files and entries needing more than a URL stay by id, and the dialog says which).
- COGs read in the browser are resampled bilinearly when a tile is upsampled from a coarser overview (a patched geomatico reader), instead of the nearest-neighbour blocks a 10 cm DSM showed between overview levels.
- Docs: [Research References](/docs/resources/research-references) with the table, [Post-Crisis Response](/docs/dev/post-crisis-response), [Advocacy and Community](/docs/dev/advocacy); the Geopera Bhotekoshi surveys are named as such in the library.

### Fixes
- Hypsometric ramp tabs no longer jump or go blank when a ramp name exists in several collections, or after a tab click.
- No more z13–18 404s from Mapterhorn at a world view: the per-location coverage probe waits until the view is close enough for it to matter.
- Local pictures saved as overlays are restored from browser storage after a reload, like local COGs.

# Changelog — MapLibre 6, and Compare and Blend Everywhere

<!-- released: 2026-09-25 -->

#### TL;DR
- **MapLibre GL JS 6.** The renderer under everything moves from 5.24 to 6.11: a rebuilt terrain render‑to‑texture cache, less DEM allocation, one projection upload per frame, mipmapped draping at high pitch — most modes simply feel faster. The port took namespace imports, a worker URL for Vite, an accessor for the transform that `Map` no longer exposes, and three real fixes: sources with an undefined `minzoom` were rejected and every derived layer vanished; a shared link could land at a different zoom and centre than it asked for, one load in three, because the padding ease re‑solved the camera from a zero elevation whenever DEM tiles beat it; and the live Matcap and Phong layers showed MapLibre's terrain skirts as white dashes along every tile seam on the globe — they now draw their own skirts, the same construction MapLibre uses. MapLibre 6.10 also fixed the half-pixel offset between 3D terrain and hillshade built from the same DEM ([#8420](https://github.com/maplibre/maplibre-gl-js/pull/8420)): both now sample cells at their centres, so relief and mesh line up. Verified against a 5.24 baseline on 82 headless scenarios. What changed and why is on the [tech stack](/docs/dev/tech-stack), [camera sync](/docs/dev/camera-sync) and [lighting effects](/docs/dev/lighting-effects) pages.
- **Compare and Blend in terrain mode too.** Split style, the grid picker up to 4×2, blend mode and opacity, Match Colors, border colours and Capture Date, below Visualization Modes; General Settings loses its lone Split Mode toggle. A header button cycles Off, Overlay and Side without unfolding the section, and the Terrain and Basemap rows show one pill per view for whatever grid is picked.
- **Protocol registry: every mode on every source.** One protocol registry now dispatches every custom tile scheme to every consumer, so each viz mode, the mound detector, contours, the GeoTIFF export and the 2D elevation picker work on every terrain source type: VRT mosaics, ArcGIS LERC, Cesium quantized mesh, WMS float32, TileJSON and differences (nDSMs). How it works is on the new [custom protocols](/docs/dev/custom-protocols) page.
- **Undo and redo.** `Ctrl+Z` and `Ctrl+Shift+Z` walk every setting back and forth, and the camera too when it had been still for a minute.
- **Export what you see, layer by layer.** The GeoTIFF button gets a menu. **Visible layers…** opens a tree of everything on the map, visible and not, each branch or group ticked or unticked at once: contour lines and mound candidates as GeoJSON; the DEM; every Terrain Analysis and Relief Visualization mode as its raw values (slope and aspect in degrees, LRM in metres...) in float32; hillshade, hypso, lighting, the basemap and the coloured modes as rendered RGBA; and the whole composite. Exports come out at exactly the view, at the screen's own size or a custom longest edge; values can be raw, coloured through the mode's ramp, or both; images can be GeoTIFF, PNG or JPEG with world files. A Screen resolution reads the tiles already cached and takes seconds, the DEM included, which was slow because it always fetched up to the 4096 px Max Resolution. The DEM GeoTIFF itself was broken until now: the library writing it stored one byte per value, and GDAL could not open the file.
- **Libraries.** react-map-gl 8.1.3 for MapLibre 6; the COG reader 0.8 to 0.10, with GDAL-style transparency and alpha bands, fast reads of LERC- and WebP-compressed COGs, a NaN nodata fix and batched range requests; maplibre-contour 0.1.1, which fixes contour tiles in MapLibre Native (a protobuf tag error) and adds a default export.
- **Camera animation that keeps its word.** A pose now records the camera target's elevation and playback interpolates it with the rest — centre, zoom, pitch, bearing, roll, field of view — so a flight from a summit pose to a valley pose no longer bobs over every ridge or holds the start height. Poses captured before this keep the old behaviour until re‑set.

### Features
- **nDSM operands are searchable.** The First and Second source pickers of a difference source are comboboxes: type part of a name (lidar hd dtm) instead of scrolling fifty entries.
- **Bookmarks: Featured open on a first visit.** The Featured and Your Bookmarks folds start open and remember how you left them.
- **Built-in terrain rows as tight as your own.** The info button on a built-in terrain source was 36 px where every other row button is 32; the list had a looser rhythm than Bring Your Own Data.
- **The WMS queue widens for HTTP/2 hosts.** Six GetMaps at a time is the browser's HTTP/1.1 rule; once a host answers over HTTP/2 or 3, up to 24 go out together.
- **Slope, aspect and the relief modes over a WMS fetch one GetMap per tile.** The kernel's halo used to mean the tile plus its eight neighbours; a WMS answers any bbox, so the tile is asked with its margin in one request. Aspect over IGN LiDAR HD in a 2 × 2 view: 4 GetMaps instead of 16.
- **Bookmarks open like links.** Middle-click, Ctrl-click or Cmd-click a bookmark, in the list or the gallery, to open its view in a new tab; a plain click restores it in place as before. The gallery button works before you have saved anything, since the Featured views are in it.
- **Filter your own sources.** With more than five sources under Bring Your Own Data, a filter box at the top of the terrain and basemap lists narrows them by name or description. It is not saved in the link.
- **nDSM and change get their own library category.** Height-above-ground differences and the six before/after events, with the surveys they need, now sit together in the terrain library instead of being graded against Mapterhorn, where most of them landed in the folded "not better" list.
- **Compare dates from the timeline.** A button at the left of the timeline's header puts historical imagery on every view, syncs the source pills, and switches the split between side by side and overlay; each view keeps its own date.
- **IGN LiDAR HD in 1024 px tiles.** A WMS source can set its tile size (`tileSize`, default 512); the IGN LiDAR HD terrain and surface models now ask for 1026 px GetMaps, which IGN answers in 0.8 to 1.7 s where four 514 px ones took 3.9 to 4.8 s, one slow tile of four setting the pace. The difference reads a larger-tiled operand from its parent tile at the same pixel density, and its zooms are counted in its own tiles.
- **Google Earth's newest capture.** A view asked for a date past the newest Google Earth capture at its place (a link saying "today") resolves to that capture once the dates are in, so the timeline shows the real date of the imagery.
- **Endless middle-drag on the timeline.** Panning the zoomed-in timeline with the middle button now locks the pointer, Blender style: the cursor hides and the drag goes on past the screen edge until the button is released.
- **Documentation from the sidebar.** A book button in the sidebar header, next to the layers and settings buttons, opens the docs; there and in the Settings dialog, middle-click opens them in a new tab.
- **`?place=` names the view.** A link can set a place name, shown expanded in the search box as its placeholder; the docs' Research References links use it, with the minimap open, so an opened study says where it is.
- **Six events, before and after.** The library gains surveys from before and after the Kaikōura 2016 earthquake (LINZ lidar, +0.8 m of coastal uplift), the Kīlauea 2018 lava, the first weeks of Fagradalsfjall 2021 and Columbia Glacier 2012–2021 (ArcticDEM strips), the Chamoli 2021 rock and ice avalanche (2 m composites, −90 m at the scar) and the Ridgecrest 2019 earthquakes (stereo DSMs), each with its difference. The [Research References](/docs/resources/research-references) page opens them on a diverging ramp from the studies of each event.
- **Exports read areas, not tiles, where a source allows it.** WMS, VRT and difference sources register region readers in the protocol registry: the IGN LiDAR nDSM now exports in two WMS requests and seconds. The export dialog says what a batch will read, once, under the resolution. Matcap, Phong and hard shadows export from their own tiles at any size and in any view.
- Graticule labels in every view mode, 2D, 3D and globe, while the view is not tilted: tilted, they pile up and drift off their lines, so they hide until the camera levels out.
- **Map libraries.** Alongside MapLibre 6: **react-map-gl 8.1.3**, which adds MapLibre 6 support, fixes an app-wide crash when terrain properties are undefined, and sets zoom and pitch constraints in a valid order. **maplibre-cog-protocol 0.8 to 0.10**: transparency that follows GDAL's rules, with alpha and internal mask bands honoured; fast reads for aligned, LERC- and WebP-compressed COGs; a nodata guard that handles a NaN `GDAL_NODATA`; COG reads batched through 64 KB blocks instead of one range request per tile read; clipping to a GeoJSON mask. **maplibre-contour 0.1.1**: a protobuf fix for MapLibre Native, a default export and dependency upgrades; no API change.
- **Export, 2D picker and contours on every source.** The GeoTIFF export, the 2D elevation picker and profile, and the contours layer now resolve a source through the same client upstream the visualization modes read, so VRT, LERC, quantized-mesh, difference (nDSM), WMS and TileJSON sources export, sample and contour like a plain tile source. Contours over one of the app's own tile schemes run on the main thread; a remote COG read in the browser contours in the same worker a local COG file uses, no titiler.
- **Undo and redo, app-wide.** `Ctrl+Z` walks back any setting change and `Ctrl+Shift+Z` (or `Ctrl+Y`) forward: visualization modes, ramps, sources, split layout, the timeline date, detector thresholds. A camera move is a step only after a minute of stillness, so a run of pans never buries a setting; a slider drag counts as one step.
- **Mound detector: pits too.** A Mounds, Pits, Both toggle in Mound Candidates. One pass over the relief signal finds both: its maxima are mounds, its minima pits (quarries, sinkholes, craters, cisterns), drawn in their own colour, blue by default, beside the red mounds. Nodata is now excluded, so the edge of a LiDAR block no longer reads as a cliff lined with false mounds inside and giant false pits outside.
- One handler run per tile URL in flight: when two sources or two modes ask a custom protocol for the same tile at the same moment, the second waits for the first and gets a clone, instead of decoding or reprojecting twice.
- Drawn features show a hand cursor on hover in select mode, and the detector and coverage overlays no longer wipe Terra Draw's cursor on every mouse move.
- In a split layout, clicking a terrain source's name sets view A to it and zooms there, as it already did with split off.
- The stalled-tiles toast fires after 20 seconds instead of a minute, carries a **Reload** button, and now also fires when the very first load wedges: it used to be installed only after MapLibre's `load` event, which a stuck tile queue never reaches.
- VRT mosaics: a range read that times out or drops gets five attempts over about six seconds, and a tile that still fails is reported as failed instead of drawn with a hole. The hole used to stay cached for the session, which left blank bands in derived modes and straight "0 m" contour edges that never healed. A source file that is really gone still reads as a hole.
- Nepal's four Bhotekoshi COGs read straight from NextGIS in the browser now that the server exposes `Content-Range`; their titiler pins are gone.
- Hypsometric tint: two generic diverging ramps near the top of the classic list, blue‑white‑red and blue‑transparent‑red, for nDSMs and change layers; **Set from viewport** waits for a slow source's tiles to decode and says so if none arrive.
- Graticule auto spacing halves with every zoom level, so each zoom's lines nest inside the next.
- Contours + GeoGrid and Background + Fog/Sky rows get the same go‑to arrow as the other modes.
- Planet monthly mosaics offer only the months the key can see, read from the Basemaps API (a 2020‑onward grant no longer shows 2016 ticks that 404).
- Strava's global heatmap as an overlay in the Library, through a public CORS proxy, capped at z11.
- A shared link seeds a derived source's operands even when the derived entry is already in the browser.
- FLAI's coverage footprints are simplified at 20 m: 270 KB on the wire instead of 480.

### Fixes
- **Google Earth Historical keeps the date you set.** A view set to 2010 used to jump to newer imagery on zooming in: finer tiles have their own capture lists, and the nearest date to 2010 in one of them could be 2012. A tile now shows its newest capture on or before the date, and only falls forward when it has nothing that old.
- **Split views stay in sync under constraints.** The zoom range and the map-bounds fence used to come from view A alone, while each view's MapLibre clamped the camera the sync handed it: a view whose own source stopped earlier, or a narrower pane under the same fence, ended at another zoom or centre. Every active view's sources now set one shared range (the tightest) and one shared fence (their overlap, or their union when they do not overlap); a source click fences every view before flying; and the idle reconcile, when a view could not follow, pulls the others to it instead of fighting every idle.
- **Export project: the whole row toggles the box.** The count line under a category name is part of its label now.
- **Esri imagery shows the parent tile where it runs out.** Esri World Imagery answered tiles past its imagery with a grey "Map data not yet available" JPEG; asked with `blankTile=false` it returns a 404, and MapLibre shows the lower-resolution tile enlarged instead.
- **Fewer stalled IGN tiles.** A WMS GetMap that has not answered in 25 s is asked again, up to three times (IGN often returns the same tile at once the second time), and GetMaps queue six at a time per host so a request waiting its turn is not counted as hung.
- **3D terrain comes on while slow sources are still loading.** Each view's setup waited for MapLibre's `load`, which only fires once every tile of every source has arrived: with the IGN nDSM, whose WMS takes up to minutes a tile, it never came and the view stayed flat. It now starts as soon as the style is in, and terrain fills in tile by tile.
- **Wayback shows the date asked for from the first paint.** A view opened on a date picked its release by release date before the real capture dates had arrived, then held that pick until all of them had: at Palmyra, 2014 showed 2009 imagery. Only releases with a known capture date are picked now, and a clearly closer one replaces the held pick. While a new place's releases and dates load after a pan or zoom, the imagery on screen stays as a placeholder instead of the layer going blank.
- **No more spikes along the edges of the IGN nDSM.** The difference read its WMS operands without the sources' nodata settings, so the -9999 sentinel's reprojection smear counted as ground and DSM minus DTM stood up in spikes of up to 1000 m along coastlines and coverage edges. The operands now carry the settings, and the WMS reader marks its holes as nodata (the fill height stays for 3D terrain), so differences, derived modes and exports skip them; an export writes them as nodata instead of 0 m.
- Curvature and shape index exports were 1000 times too large: their tiles store the value ×1000, and the export now divides it back out.
- COG DEM exports were always square, whatever the view's shape; they now match the view.
- The Data layers picker: a card with a one‑line blurb drew a band above its thumbnail; turning off a group's last card turns the group off.
- The ESRI Wayback pill kept spinning after it was switched off.
- The symmetric hypsometric range snapped back to a value the user had not set: the auto range re‑ran on its own state write.
- The 360° orbit eased in for a second and straight out again.
- Switching 3D to globe with graticules threw inside geogrid, which reads a transform MapLibre 6 removed.
- The built‑in AWS terrarium source asked for z16 tiles that do not exist.

---

# Changelog — Data Layers as Pictures, and Shortcuts on Section Headers

<!-- released: 2026-09-24 -->

#### TL;DR
- **A Data layers picker: every visualization mode as a card with its picture.** Google Earth’s layer panel, for terrain — hillshade, hypsometric tint, contours, basemap imagery, slope, aspect, curvature, TPI, local relief, sky‑view factor, openness, matcap, phong and hard shadows — each a thumbnail of the same Matterhorn view with only the rendering changed, one click to turn it on or off. A Tools row opens Draw, Elevation picker, Sun shadow and Animation in the sidebar. Reached from the panel title bar or next to the Visualization Modes pin.
  ![The Data layers picker: every visualization mode as a card of the same Matterhorn view](/docs/screenshots/data-layers-picker.jpg)
- **Quick buttons on the foldable section headers.** Home on General Settings, the Gallery on Bookmarks, Snapshot on Download and Snapshot, the Data layers picker on Visualization Modes — whose fold, expand and pin are now one three‑state control instead of a chevron beside a pin.

---

# Changelog — VRT Mosaics in the Browser, Twenty New Sources, and Where 3D Exists

<!-- released: 2026-09-23 -->

#### TL;DR
- **GDAL VRT mosaics now stream in the browser**, no titiler needed. A `.vrt` is an XML index over many COGs, and the browser can already Range-read COGs — what was missing was GDAL's bookkeeping. IGN's RGE ALTI 1 m over France is 93 COGs behind a 40 KB index; a tile over Montparnasse takes 0.43 s. Any CRS, not just the easy two.
- **Twenty new elevation sources**, every endpoint verified live before it was added: Hawaii's 1 m and Maui's 0.3 m LiDAR as LERC tiles, New Brunswick and Alaska IfSAR (DTM *and* DSM, so 3DEP finally has a surface-model counterpart), South Australia's 0.5 m River Murray LiDAR, Hong Kong, New York, Dar es Salaam's 0.5 m, JAXA's global AW3D30, and the Aguada Fenix Maya survey's canopy surface. Seven of them are ready-made **nDSMs** that pull their own operands in.
- **A slow terrain tile no longer freezes the basemap.** MapLibre queues every raster load through one budget of 16, and a custom protocol holds its slot for the whole handler — so sixteen VRT or sky-view-factor tiles left the map grey.
- **Four coverage overlays for 3D and LiDAR: Google photorealistic 3D, Bing Maps 3D, Esri Integrated Mesh and FLAI open LiDAR.** None of the four publishes a footprint you can download, so each is read from the provider’s own data — Google’s from the coverage layer behind its docs page, decoded from Maps vector tiles; Bing’s from its 3D Tiles subtree availability bitstream; Esri’s from ArcGIS Online’s search API, kept to open services of 5 km² or more; FLAI’s from every survey’s COPC octree over range requests. Click a footprint to open that provider’s own 3D view there. How each is built is on the [coverage overlays](/docs/features/coverage-overlays) page.
  ![The four 3D and LiDAR coverage overlays over Europe: Bing, Google, Esri Integrated Mesh and FLAI](/docs/screenshots/coverage-3d-lidar-europe.jpg)

---

# Changelog — Esri & Cesium Global Terrain, Faster Tiles
<!-- released: 2026-09-20 -->

#### TL;DR
- **Esri World Elevation** is now a built-in terrain source — land *and* seafloor as one continuous surface, so a hypsometric ramp reads across a coastline instead of stopping at it. The second built-in with real bathymetry. Keyless, orthometric, and streamed as LERC (Esri's float raster codec) decoded in the browser. A land-only twin, with the ocean flat at 0 m, is in the Library.
- **Cesium World Terrain** joins the Library through a new quantized-mesh reader: the triangle mesh is rasterised per tile into an ordinary elevation source, so 3D terrain and every visualization mode treat it like any other DEM. Needs a Cesium ion token (Settings → API Keys); its heights are ellipsoidal, about +48 m in the Alps.
- **Tiles render around 10× faster.** Every custom protocol now hands MapLibre an `ImageBitmap` instead of a PNG it immediately decoded again — 99 ms median down to 0.1 ms on the encode alone. This is not specific to the new sources: hillshade, LRM, SVF, the difference source and the WMS elevation services all got it.

### Features
- The **Library** lists catalogs beside datasets. **Browse** opens the catalog search on that endpoint, and a **+/−** on each row decides whether the search offers it at all.
- **Settings → API Keys** gains a Cesium ion token and a terrain-detail control for it.
- Docs: new dev pages for [LERC](/docs/dev/lerc-protocol), [quantized mesh](/docs/dev/quantized-mesh-protocol), [derived terrain](/docs/dev/demdiff-protocol), [tile caches](/docs/dev/tile-caches), [PMTiles & COG contours](/docs/dev/vendored-protocols), [camera sync](/docs/dev/camera-sync), [map bounds](/docs/dev/map-bounds-and-underzoom), [the product tour](/docs/dev/product-tour) and [layer order](/docs/dev/layer-order), plus a [Settings](/docs/features/settings) page.

### Fixes
- A Library LERC or quantized-mesh source was decoded with the wrong encoding, reading 832 354 m in the elevation picker with the hillshade and hypsometric ramp wrecked to match.
- Cesium terrain fetched one level too coarse, which showed as large flat facets: a mesh is adaptively tessellated, so matching the tile width alone left 436 vertices for 65 536 pixels.
- Tour Back/Next arrow keys did nothing on the Library step — the dialog swallowed the keypress before the tour saw it.
- The walkthrough no longer leaves its demonstration coverage footprints on the map.

---

# Changelog — Catalog Search, Coverage Overlays & OSM Vector
<!-- released: 2026-09-16 -->

#### TL;DR
- **Coverage overlays** (Source Info): see where sources have data before loading them — Mapterhorn's own per-country coverage tiles with each source's resolution on hover, the whole terrain and basemap libraries, OSM Editor Layer Index footprints, your own sources. Tree picker, drawn on every view; hover lists what covers a point, click links each dataset and can select it for view A.

  ![Coverage overlays over Europe with the hover list](/docs/screenshots/coverage-overlays.jpg)
- **STAC search** (beta, Settings → Beta) in both Add dialogs: OpenAerialMap, Earth Search, eoAPI, NASA VEDA, swisstopo, LINZ, OpenTopography, polar DEMs, Maxar / Vantor open-data events, Planet disaster releases, a federated collection search, or any catalog URL. Date range, current view, cloud cover, Web Mercator first, non-Mercator assets pinned to titiler, terrain limited to single-band elevation rasters, add as basemap or overlay.

  ![STAC search: Vantor open-data scenes over the 2026 Nepal flooding](/docs/screenshots/stac-search.jpg)
- **Basemap catalog search**: NextGIS QMS and the OSM Editor Layer Index (bundled, bumped weekly), with licence and attribution carried into Source Info and permalinks into their browsers.
- **OpenStreetMap is now OpenFreeMap's Liberty vector style** instead of raster tiles, with a 3D buildings toggle, following the basemap visibility and opacity controls.

  ![OSM 3D buildings from OpenFreeMap Liberty over a Vantor post-event overlay](/docs/screenshots/osm-liberty-3d.jpg)
- Source Info card for custom terrain sources; COG viewer links (source.coop, GeoLibre); "None" basemap, always offered; per-source titiler pin for non-Mercator COGs on basemaps too.

### Features
- Scrolling over the split gutter or its pill zooms the map underneath instead of doing nothing.
- The automatic map-bounds fence is never tighter than about a degree: a single survey's own footprint stopped zoom-out four times too early and pinned panning to the site.
- Coverage overlays are now part of the shared link (`coverageOverlays`), folded to group keys: a wholly-ticked group travels as `library` rather than as the 45 ids it stands for, and spills back out when one is unticked. `?openLibrary=terrain|basemap` opens the dataset Library. The product tour gained a step for each, and no longer leaves its demonstration footprints on the map when it moves on.
- Two keyless global relief basemaps from DLR's TanDEM-X: the 90 m radar DEM rendered as topography worldwide, and a multidirectional hillshade of PolarDEM Antarctica — the one continent with no usable optical backdrop.
- Titiler-served terrain no longer decodes and re-encodes every tile in the browser: titiler flattens nodata itself (`nodata_height`), which also drops the alpha channel — same flat holes, ~9% smaller tiles, one decode instead of three.
- The walkthrough no longer starts by itself over a shared link: a visitor who followed a link came for that view, not a tour.
- **Derived terrain: DSM − DTM** (docs: [nDSM and Comparison](/docs/features/ndsm-and-comparison)). Add Terrain gains a "Difference of two sources" type: two loaded terrain sources subtracted tile by tile into a normalised height model (canopy, buildings, or change between two dates), usable as terrain and by every viz mode like any elevation source.
- Hypsometric tint: **Symmetric Range** (one magnitude, Min = −Max) with the same controls as the curvature ramp, for height-above-ground and elevation-change grids.
- The difference source takes an optional vertical offset (metres added to every difference), a co-registration knob for references that sit above or below the finer source.
- The difference source's zoom ceiling is the finer operand's declared max zoom plus two levels (titiler-pinned operands used to contribute no range at all, so the coarser operand set the cap).
- Map bounds: a source footprint under one degree across is padded by its own extent on every side before it fences the camera, so a single survey can still be seen in context (Settings → Map Bounds → None removes the fence entirely, and `maxBoundsMode=none` in a link).
- Client-computed viz modes and the difference source honour a source's titiler pin (they tried the in-browser reader on pinned files and got nothing), and pass the source's nodata to titiler.
- Titiler-served terrain no longer shows 10 km cliffs and pits along nodata edges: its tiles pass through a small fix-up that refills transparent (nodata) pixels as flat 0 m, flagged so the app's own decoders still see holes.
- In-browser COG reader: nodata cells are marked (alpha 254, value unchanged) so the difference source treats a local COG's holes as holes instead of 0 m.
- GEDTM30 no longer crashes the map: a footprint spanning the full 360° of longitude reached MapLibre's max-bounds through the map's own prop and threw (reproduced on the served bundle); every max-bounds value is sanitised now. The difference source writes 0 where either side has no data (flagged for the app's own decoders), and the hypsometric tint paints the DEM floor transparent.
- The difference source's zoom range is now the finer operand's, so the upsampling of the coarser one actually engages; the symmetric hypsometric slider shows its 0 / max bounds; native title tooltips from the last days (date pill, swap arrows, 3D badge, coverage button, file name) are proper tooltips.
- The difference source upsamples the coarser operand from its nearest ancestor tile (bilinear, up to 6 levels), so a 30 m DEM under a 0.5 m DSM keeps working past the DEM's own max zoom; a footprint that pokes past the world (GEDTM30) no longer crashes max-bounds.
- `pmtiles://` tile archives as terrain/basemap tiles, and a first library entry using it: Smart Maps GEL, NASADEM 30 m as CC0 Terrain-RGB. Library entries already added to a browser now follow the shipped library's fixes on load (a GEDTM30 added before its nodata fix stayed broken).
- Library: derived height-above-ground entries for France (IGN Lidar HD DSM − DTM) and the Netherlands (AHN DSM − DTM), which bring their operands along; and the Bhotekoshi 2026 flood reconstruction (geo-pera): post-event 0.5 m DSMs and 2 m elevation-change rasters for the Rasuwagadhi-Timure and Syabrubesi reaches, a ready-made before/after case, plus derived "post-event DSM − Mapterhorn" entries computed live in the browser. The difference source ignores nodata pixels on either side instead of turning them into 30 km spikes.
- A titiler-pinned COG in another CRS (UTM, 4326) no longer fits to the wrong place or gets a wrong max-bounds box: its footprint is asked from titiler even when the global setting is the in-browser reader.
- Titiler-served terrain (non-Mercator COGs, VRTs, WMS) is now reprojected bilinearly instead of nearest-neighbour: a 30 m DEM no longer draws as a cross-hatched staircase when zoomed in.
- **Split views**: each pane's date pill names its view ("B: Bing · 1999-01-15"). Clicking the label picks the view the timeline's arrow keys act on (bold label, an extra circle around its timeline handle); the small arrows after the label swap that view with A, where drawing and most tools work. In the two-view layouts (overlay, 2x1) view A carries the arrows too. None of the letter, the bold, the arrows or the timeline handle's circle appear in snapshots. A new timeline button reorders the views chronologically, undated basemaps last.
- **Remote data in links and iframes**: any view's terrain or basemap can be a URL (`?sourceB=https://…/dem.tif`, `?basemapSourceC=…`), and `?drawingUrl=` (repeatable) loads remote vector data into the Drawing tool. Drawing import also takes a URL (the chevron next to Import; "Keep in the link" writes it as `drawingUrl=` and marks the layer as linked), `addTerrainUrl=` / `addBasemapUrl=` register sources without selecting them, and the docs gain an [Embedding & URL parameters](/docs/features/embedding) page with a live iframe and a link builder. Import now reads GPX, FlatGeobuf and (from a URL) Shapefile besides GeoJSON and KML.
- **URL keys**: the terrain source of a view is now `terrainSourceA`…`terrainSourceH` in the address bar, matching `basemapSourceA`…; old `sourceA=` links and saved bookmarks still work. New `sidebarCollapsed` state (mirrors the panel, so a link or an iframe can carry it closed) and the one-shot `scrollTo=<section>`; `addOverlayUrl=` registers overlays and `overlayBasemapIds=` may name URLs directly. The Share dialog offers an iframe snippet with a hide-side-panel switch.
- Docs: the Embedding page has a builder that can start from a pasted link and a recap of every non-state parameter; new developer pages: a generated State reference (URL and storage), the URL as an OpenAPI document browsed with Scalar, and the Fumadocs customization notes; the project preset interface is rendered from source. `drawingUrl` is now a state list (comma-separated), and the Drawing panel's clear-all button is gone (layers are deleted individually).
- A fullscreen button under the geolocate control (whole app, side panel included; mainly for embeds; `hideMapControls: ["fullscreen"]` removes it), `bookmarksUrl=` loads a bookmarks JSON from a link and `bookmarksGallery=true` opens the gallery on arrival. Docs: features grouped into Introduction, Sources, Tools and Advanced.
- Coverage overlays: sources under the cursor are listed finest resolution first.

### Bug Fixes
- Synced views no longer stay apart after a layout change in 2D historical mode (2x1 to 4x2): the idle reconcile was skipped whenever a view had no terrain.
- Picking, restyling, adding or stacking a basemap while the Basemap viz mode is off now turns it on, so the change is visible at once (the add paths already did; the pickers, opacity and overlay toggles did not).
- The `Shift` / `Ctrl` tap toggles only fire on a quick tap (under half a second), so a modifier held while deciding what to do no longer toggles anything on release.
- The side panel no longer stays transparent after a fast slider drag released off the slider (seen on Firefox / macOS).
- **Snapshot / Copy / Share capture every view**, not just view A: side-by-side, grid and overlay layouts are composited as shown on screen (wipe position, blend mode, opacity and colour matching included), with date pills, coloured borders, the scale bar and attribution (no geocoder, zoom, compass or geolocate buttons), never the side panel. The strips under the open side panel and the historical timeline are cropped off, so the subject stays centred; "Include the timeline in snapshots", in the new **Export settings** fold of Download and Snapshot (with the download resolution cap), keeps the timeline in the picture instead. The 2D world file is written only when the image is a single extent (single view or overlay).
- Drawing: click tolerance down from terra-draw's 40 px default to 8 px, so vertices can be placed close together when tracing fine features; the cursor turns into a pointer over the point that finishes the shape.
- Editor Layer Index layers flagged as overlays now land on the overlay stack when added from the coverage click modal or the Add Basemap dialog, instead of being selected as a basemap the picker could not show; key-gated layers are greyed out in the modal and failures are logged rather than swallowed.

# Changelog — National Terrain Library & Historical Export
<!-- released: 2026-09-14 -->

#### TL;DR
- **Library** replaces Sample: a curated set of high-resolution terrain and basemap sources from national mapping agencies, global products and sub-national surveys — Norway, USGS 3DEP, Netherlands AHN, England, Finland, Estonia, Tirol, Czechia, Italy, Japan, Mexico, Spain, Uruguay, Canada, Faroe, France overseas, ArcticDEM / REMA, GEDTM30, EMODnet — each verified against a known summit, graded against Mapterhorn by API-served and best bulk-download grid, filterable, picked one at a time or all at once. Selecting one pins the map to the country.

  ![The terrain dataset library](/docs/screenshots/terrain-library.jpg)
- **Docs page** listing every national dataset with a coverage choropleth, resolution, endpoint and licence.
- **Decoding fixes** that made these services usable: no-data floors and fills (sentinels, NaN, WMS reprojection fringes), sparse ArcGIS TIFFs, WCS 2.0, custom RGB encodings, COGs pinned to titiler when not in Web Mercator.
- **Export Multi (Historical)**: calendar pickers synced to the timeline, every current basemap as one picker, capture counts per source, Wayback dedup, zoom step-down retries, clean provider-named files, Google Earth frames fetched in-process.
- **Drawing layers**: per-layer visibility, export scopes (flat, per layer, selected), drawings mirrored on every view.
- Whole-world default view, self-healing synced views, zoom-dependent timeline marks, foldable Terrain Analysis sub-groups, MapTiler Satellite basemap.

# Changelog — Live Lighting Rework: Native-Sharpness Phong & Matcap
<!-- released: 2026-08-21 -->

#### TL;DR
- **Live Phong/Matcap rework** (renderers now labeled **Live** vs **Legacy**): per-fragment normals straight from the float DEM on MapLibre's own 128×128 drape mesh — native-hillshade sharpness. Phong composites true albedo over the basemap/hypso stack (hidden surfaces handled, specular-only no longer dims the map) with a camera-headlamp light anchor; Matcap gets correct camera anchoring at every bearing and per-fragment depth (no more summits flickering behind neighboring tiles). Also fixed: tile-seam streaks, high-pitch near-camera tile dropouts, endless tile refetch on hi-dpi. New featured bookmarks (Amazon Rivers, Willamette River) with fresh thumbnails.
- **Shareable BYOD links** — a URL referencing a sample-library source id (e.g. `?sourceB=custom-ign-lidarhd-dtm-wms-raw`) now auto-adds it to a fresh visitor's Bring-Your-Own-Data list instead of showing an empty pane, and the new `?addSources=id1,id2` param prepopulates several terrain/basemap samples at once without selecting any of them.

# Changelog — Historical Fixes, Matcap Rework, Docs Restructure
<!-- released: 2026-08-20 -->

#### TL;DR
- **Bug fixes** — historical-satellite whole-earth default camera now applies; terrain mode gates the timeline to the Raster Basemap viz mode being active; matcap's screen-locked bright blob replaced by a proper view-space lookup; endless lighting-tile refetch on hi-dpi viewports fixed (dpr-aware tile selection).
- Match Colors re-applies instantly in RGB; Bookmarks gets list/grid toggles (sidebar + gallery modal); the guided tour now wraps up with Keyboard Shortcuts and docs links.
- **Docs** — new Export & Share, Projects, Open In, Streaming & Storage Settings, and River-REM pages; nav regrouped (Features vs Advanced Features; Dev gets Custom Protocols + Historical groups).

# Changelog — Docs Site Expansion and Open-In Additions
<!-- released: 2026-08-19 -->

#### TL;DR
- **Docs site expansion** — dozens of new or re-shot real screenshots across Visualization Modes, the full guided-tour Walkthrough, Split & Compare, and more; new user-facing pages (Walkthrough, Tools, Frescoes & Artifact Scans) in the Features guide; new developer documentation (Lighting Effects, Terrain Analysis Pipeline, ESRI Wayback).
- New **Open In** destinations (Iconem River-REM, Google Maps 3D, Google Earth Historical/3D), a `?startTour=true` deep link to launch the guided tour directly, plus assorted fixes (lightbox caption links, changelog date-key collisions, KaTeX formula layout).

### Features
- **Docs site** — Visualization Modes, Walkthrough, Split & Compare, Basemaps & Historical, Sources, Tools, Frescoes & Artifact Scans, and several Dev pages substantially expanded with real app screenshots, reproduction URLs, and clarifying prose.
- **Open In** — Iconem River-REM, Google Maps 3D, and separate Google Earth Historical (web) / Google Earth 3D (web) destinations; ESRI Wayback Machine moved to the top of the list.
- `?startTour=true` URL param launches the guided product tour directly, independent of first-visit state.

### Bug Fixes
- Docs lightbox: a caption link followed by trailing text (e.g. a parenthetical note) no longer gets pushed past the title bar's truncation, hiding the actual clickable link.
- Changelog: two entries sharing the same release date collided on the same React key — a browser console warning explains it, but see the fix in this entry's own `<!-- released -->` marker for the general pattern.
- Terrain Source "Google 3D Tiles (via DeckGL only)" removed from Worldwide Defaults — the same experience is reachable via the Google Maps 3D / Google Earth 3D (web) Open-In destinations instead.

# Changelog — Terrain Camera Fixes, Terrain Sources Docs, and Favicon Polish
<!-- released: 2026-08-16T17:00 -->

#### TL;DR
- **Camera sync fixes** — DEM tiles arriving after terrain turns on, pane resizes, and the padding `easeTo` all leave the elevation reference stale. Re-anchored on `idle` via `recalculateZoomAndCenter` (holds camera position, solves for the new center/zoom — nothing moves on screen), guarded by a 1 m epsilon so padding changes and mode switches don't nudge the focus point. The view you last touched is authoritative; the others are copied wholesale from it.
- **Elevation is now a synced camera parameter** — a terrain camera has a sixth parameter beyond center/zoom/bearing/pitch/roll (the elevation of the point it looks at), and it wasn't being forwarded in split/overlay. MapLibre freezes it for the whole drag on the moved view while re-resolving it live on every `jumpTo` to the others, so the panes drifted vertically apart for the duration of a drag and snapped back on release. The moved view's elevation is now forwarded explicitly.
- **Fixed several camera-reset edge cases**: MapLibre's `easeTo` leaves `_elevationFreeze` stuck on unless `freezeElevation` is passed (suppressing per-frame reclamp and leaving panes in asymmetric internal state after whichever one you'd last dragged); ground-clamping bookkeeping was keyed by view id which outlives the map instance (a remounted pane stayed permanently clamped); programmatic camera commands now stand down while a pointer is held (previously `jumpTo`/`easeTo`'s `Map#stop()` silently ate a press-and-hold gesture).
- Panel open/close now animated (padding, pane rects, gutter, borders ease over 200ms); sidebar/timeline avoidance padding extended to lone view, single-row/column grids, and Overlay panes; Map B defaults to **AWS terrain** (no API key); new **Terrain Sources** docs page; favicon shape reactive to live app mode.

### Features
- **Terrain Sources docs page** (`docs/content/docs/features/terrain-sources.mdx`) — one-paragraph summary of each built-in terrain source (Mapterhorn's coverage page, Mapbox's SDK-only + compression, MapTiler's companion Ocean RGB bathymetry tileset, AWS's genuine ETOPO1 ocean bathymetry blending), linked from Sources → Terrain → ⓘ (`source-info-dialog.tsx`) as "Compare all built-in terrain sources →".
- Docs: Features sidebar group now expanded by default; homepage feature-card order now matches Terrain Visualization Modes → Light-Direction XYPad → Historical Imagery → Split Screen & N-Map Compare.

### Bug Fixes
- **Camera/focus-point shift on init** — the padding is what keeps the focus point centered in the part of a pane that isn't covered by the sidebar or timeline panel, so it belongs on every pane those overlap: each row's rightmost, the last row's, the lone non-split view (trivially both), and both full-bleed Overlay panes. It's now also seeded into each view's `initialViewState`, so a view is *built* with its vanishing point already shifted clear rather than rendering centered on the full canvas for a frame and then sliding across — that slide was the actual "shift on init". An interim version of this fix instead gated the padding on the grid having more than one row/column, on the theory that it only mattered for aligning vanishing points between side-by-side panes; that was wrong, and left a lone pane's focus point sitting under the sidebar.
- **Split-view pan/drag desync, requiring an extra manual pan to resync** — the cross-view sync handler's re-entrancy guard (needed because `jumpTo()` fires `move` events synchronously, which would otherwise recurse) was being released on a 50ms `setTimeout` instead of immediately after the synchronous re-entrant call already returned. Since real drag frames fire roughly every 16ms, that 50ms window silently dropped ~2 of every 3 legitimate frames from propagating to the other view(s) — including, sometimes, the drag's very last frame, leaving the passive view a few frames behind until nudged. Fixed by releasing the guard synchronously right after the sync loop, instead of on a timer.
- **Terrain camera mis-centering, on load and on every split-mode switch** ("the Matterhorn summit sits a bit low") — root-caused live via `map.project(map.getCenter())`, watched across the actual load/interaction timeline rather than guessed from docs. `setTerrain()` is applied the moment the terrain source object exists, before that view's actual DEM tiles for the current viewport have fetched/decoded, so the camera's aim elevation gets computed from nothing yet — confirmed: the projected center sat well off true screen-middle the entire time terrain was active, snapping back to dead-center immediately after re-calling `setTerrain()` a second time once `idle`. But that alone wasn't enough: the same off-centering kept recurring on every subsequent Off/Overlay/Side toggle too, each time from a *different* culprit — the padding effect's own `easeTo(duration:0)` call, that `easeTo` in turn firing a `move` event the cross-view sync handler propagated onward via `jumpTo()`, and `resize()` (each pane's own pixel dimensions changing between Overlay's full-width and Side's half-width panes) — every one of which independently resets the same elevation reference, confirmed live one at a time. The deeper cause turned out to be MapLibre's own `easeTo`: `_prepareElevation` sets `Map#_elevationFreeze` unconditionally, but `_finalizeElevation` — the only thing that clears it — runs only when `freezeElevation` is passed. So the padding `easeTo` left that flag stuck on, which suppresses MapLibre's own per-frame reclamp, and the only other thing that ever cleared it was completing an interactive drag *on that map*. That also explains why the very first drag after load jumped, and why one pane could follow the terrain while the other was panned. Passing `freezeElevation` fixes the flag; a cheap `idle` listener re-anchors the height when it's genuinely stale (see the entry above); and the padding effect's own `easeTo` is guarded against triggering a cross-view sync jump. An interim version re-affirmed the whole of `setTerrain()` on every idle instead, which worked but rebuilt Terrain + RenderToTexture each time — see the blinking entry above.
- **"Weird follow-terrain" while dragging, inconsistent between split views** — MapLibre's `centerClampedToGround` (on by default) continuously re-resolves the center point's elevation live, every frame, while panning/zooming — the bob/climb effect, and a source of cross-view inconsistency since two views on different DEM providers each resolve elevation independently a moment apart. This file's keyframe-recording animation already disabled this same flag for its own one map instance; now every split view disables it too, right after its own terrain has settled (order matters — disabling before that settle would freeze the wrong, pre-terrain elevation guess instead of the correct one; confirmed live both ways). Read from the map's own `getCenterClampedToGround()` rather than remembered per view id: a view id outlives the map behind it, so an id-keyed "already done" flag left a rebuilt pane (view B, after a split off/on cycle) permanently ground-clamped.
- Default terrain source for split mode's Map B changed from MapTiler to **AWS** — MapTiler (and Mapbox) require an API key a fresh visitor won't have configured, so Map B previously rendered blank by default.
- Default initial viewport recentered to `lat=45.9788, lng=7.674, zoom=12.37` (also updated in the camera-keyframe tool's own fallback pose, which mirrors this default by convention).
- `beta.historical-satellite.iconem.com` not defaulting to Historical mode despite a correct favicon — an effect-ordering race (the appMode-persistence effect ran before the first-visit hostname-default check on the very first render, so it always looked like a returning visitor). Fixed by snapshotting whether `appMode` was already stored *before* any effect runs.
- `jo-chemla.github.io` not defaulting to the blue/prod mountain favicon, and docs-in-dev not showing the purple book-open icon — both hostname-detection helpers now recognize `jo-chemla.github.io` as a real prod deploy, and the docs favicon-swap script's logic was flipped from "swap away from prod unless proven dev" to "swap up to prod only once confirmed" (safe default either way, since the previous logic could race Next's `beforeInteractive` script queuing).
- App favicon *shape* (mountain vs. clock) now reactive to the live app mode, not just the hostname — switching modes mid-session (or a first-visit guess that turns out wrong) now updates it instead of leaving it stuck at whatever `index.html`'s inline pre-mount script guessed.
- Docs: XYPad demo video 404 (`visualization-modes.mdx`'s `<video src>` was missing the `/docs` base-path prefix).

# Changelog — Guided Product Tour
<!-- released: 2026-08-16T09:00 -->

#### TL;DR
- New **guided product tour** (Compass icon in Settings, or auto-starts on first visit): a branching walkthrough covering the shared basics, then either the Terrain visualization tools or Historical Satellite imagery mode, chosen at a fork partway through.
- Each branch ends with a **Tools** step listing that mode's map-based utilities (Drawing, Elevation Picker, Sun/Shadow Calculator beta, Animation, Source Info — the historical branch's subset excludes the terrain-only ones).

### Features
- **Guided product tour** (`components/TerrainControlPanel/product-tour.tsx`, built on the `coachmark` library) — walks through the map viewport, control panel, general settings, and Terrain-vs-Historical mode switch, then forks into either the Terrain tools (Hillshade, Hypsometric Color, Terrain Analysis, Relief Visualization, Sources, BYOD, Split Mode, Tools, Keyboard Shortcuts) or Historical Satellite imagery (Compare and Blend, Split Mode, Blend Modes, Grid Layout, Timeline, Tools) branch. Each step temporarily forces whatever sidebar/section/mode state its target needs to exist, and everything is snapshotted at tour start and restored verbatim on close/finish, regardless of which steps were actually visited.
- **Tools step** (one per branch) — a bulleted rundown of that mode's Tools group, with every tool section folded and the whole group (separator + all tool titles) spotlighted together as one block.

### Bug Fixes
- **Popup silently not appearing for several steps** (Hypsometric, Terrain Analysis, Relief Visualization — Hillshade, near the top of the panel, was unaffected) — root cause: Coachmark's own built-in scroll-into-view could resolve before the actual scroll distance was covered for a target further down the sidebar's scroll container, leaving the popup positioned against a target rect still (partly) below the fold — visually indistinguishable from no popup at all, just the dimmed backdrop. Fixed by having the tour scroll its own target into view itself (instant, before Coachmark's own step-change effect ever runs), so Coachmark's internal attempt finds nothing left to do.
- **Raster Basemap / Terrain Sources steps** could scroll the section's own title off-screen once enough BYOD custom sources were added to make the section unusually tall — switched the tour's default scroll alignment from centering the (possibly very tall) target to anchoring its top edge instead, so the title stays visible with as much of the rest as fits below it.
- Terrain Analysis step was switching on both Slope and Curvature as its demo; now just Slope, matching its own description text.
- The "Curious about the other mode? Take that tour instead" link could overflow its popup at typical widths — shortened and restyled as a proper full-width button.

# Changelog — Docs Site, Featured Bookmarks, and Tells Freeze Fixes
<!-- released: 2026-08-14 -->

#### TL;DR
- Added a [documentation site](/docs), live-linked from the app general settings.
- **Featured bookmarks**: a curated "Featured" strip of starter viewpoints (different terrain shapes, visualization combinations, and a historical-imagery example) now sits above your own saved bookmark list.
- **Mound detector (Tells)**: new Frozen/Live toggle — pin the currently-detected candidates in place so panning/zooming doesn't keep re-querying and recomputing them.
- Visiting historical-satellite.iconem.com now lands you straight in **Historical Imagery mode**, with its own clock-shaped favicon (matching the timeline toggle's own icon) instead of the terrain mountain.
- In split/grid compare mode, clicking a basemap's **name** (not just its per-view toggle) now sets that source on every active view at once.

### Features
- **Documentation site** (`docs/`) — a separate Fumadocs (Next.js) app, deployed alongside the main app and proxied at `/docs` in dev, covering Overview, Visualization Modes (a shared markdown source also rendered inline in Settings → Visualization Modes, so both stay in sync), Keyboard Shortcuts, Changelog (renders the same TL;DRs shown in-app, sourced straight from this file), Resources and Inspiration (MapLibre features, geomorphometry/hydrology literature, credits), and a Dev page (structure, architecture, running the app). Homepage and docs images open in a lightbox on click.
- **Featured bookmarks** (`lib/preset-bookmarks.ts`) — a small, read-only set of curated viewpoints shipped with the app, separate from the user's own `bookmarksAtom`-backed list: restoring one never edits or removes it, and an app update to this set never touches anyone's own saved bookmarks.
- **Tells Frozen/Live toggle** — "Frozen" snapshots the currently-rendered mound candidates (via `querySourceFeatures` off the live vector tiles) into a static geojson source, so panning/zooming stops triggering new `tells://` tile fetches and recomputation; "Live" (the default) resumes the normal fetch-as-you-pan behavior and forces an immediate tile reload for wherever you'd panned to while frozen, rather than waiting for the next pan.
- **Historical hostname auto-routing** — a first-ever visit to historical-satellite.iconem.com (no `?appMode=` in the URL, no locally-stored preference yet) now opens in Historical mode by default instead of the app's normal Terrain default; any other/unknown hostname is unaffected.
- **Click a basemap's label to sync it everywhere** — in split/N-grid compare mode, clicking a basemap's name now applies it to every currently active view, not just the row it was clicked from.

### Bug Fixes
- **Tells freeze — three real, distinct bugs**:
  - `Error: can't serialize object of unregistered class nf` — `querySourceFeatures()` returns MapLibre's internal feature-wrapper instances, not plain objects; handing those straight to a new geojson `<Source>` failed MapLibre's worker-side structured-clone step. Fixed by round-tripping through `JSON.parse(JSON.stringify(...))` first.
  - `DataCloneError: ArrayBuffer ... already detached` — root cause was actually in the shared finished-tile LRU cache (`lib/tile-result-cache.ts`, used by every "Slope and More" derivative — Slope/Curvature/TPI/Roughness/LRM/SVF/Openness and more, not just Tells): it handed out the exact same underlying `ArrayBuffer` on every cache hit, and MapLibre detaches a tile response's buffer when transferring it to a worker — so a second request for an already-cached tile tried to transfer an already-dead buffer. Fixed by always storing and returning independent copies.
  - Unfreezing (back to Live) didn't recompute for wherever the view had panned to while frozen, until an extra pan/zoom — MapLibre only fetches a source's tiles when a visible layer references it, and no layer referenced the live vector source while frozen, so tiles for a newly-panned-to area were never requested. Fixed by forcing a tile reload (`source.setTiles(...)`) the moment Live resumes.
  - The frozen geojson source also now mounts under its own id instead of swapping the live vector source's type in place under the same one, avoiding a MapLibre worker-teardown race when a tile request was still in flight the instant Frozen flipped on.
- **Historical mode wiping Terrain-mode visualization settings** — switching into Historical mode used to force roughly a dozen viz-mode flags (Hillshade, Lighting, Shadows, Color Relief, Terrain Analysis, Relief Visualization, Plane Slicer, Tells, Contours/Graticules, Background) to off, destroying whatever a visitor had set in Terrain mode. Every one of those is now instead gated on "not Historical mode" directly at render time, so the underlying settings are preserved and simply resume when switching back.
- **Historical timeline zoom-out over-padding** — the zoom-out limit and pan-gutter extent padded a flat 10% of the full date range past each real end, which for a very long outlier range (e.g. an 80-year span) let the zoomed-out view pan years past either real boundary. Now capped at 6 months per side, whichever of the two is smaller.
- **Changelog image lightbox** — was rendering far too small with no dimmed background, then (once resized correctly) showed black letterbox bars whenever an image's aspect ratio didn't match a fixed 90vw×90vh box, and outside-click/Escape didn't reliably close it due to a Base UI nested-dialog dismiss quirk (confirmed: Escape closed it while a real backdrop click did not, and a naive workaround ended up closing the Settings dialog behind it too). Rebuilt as a plain, correctly-dimmed overlay that shrink-wraps to the image's own aspect ratio (never upscaling past it), with its own outside-click/Escape handling scoped to just the lightbox.
- **`@tanstack/devtools-vite`'s dev-tooling breaking MapLibre sources** — its "click to open in editor" `data-tsd-source` attribute, injected onto every JSX element in dev, was landing on react-map-gl's `<Source>`/`<Layer>` components, which spread all received props straight into `map.addSource()`/`addLayer()` — tripping MapLibre's schema validator ("unknown property") whenever such a source/layer mounted fresh at runtime. Scoped out via the plugin's own `injectSource.ignore.components` option.

# Changelog — Histogram Color Matching in Compare and Blend
<!-- released: 2026-08-11 -->

#### TL;DR
- **Match Colors via Histogram Matching**: automatically recolors every other view onto View A's color histogram, so two different imagery sources (or two dates of the same source) no longer look noticeably darker/bluer/warmer next to each other when compared or blended.
- Five color spaces to choose from: RGB is instant (a live CSS filter); HSL/HSV/LAB/LCH are slower but can match more subtle color differences. Ported from Iconem/historical-satellite's standalone [histogram-matching demo](/histogram-matching-example/histogram-matching.html).

### Features
- **Match Colors, in Compare and Blend** — TL;DR: automatically recolors the other view(s) to match View A, so two different imagery sources — or two different dates of the same source — line up visually instead of one looking noticeably darker/bluer/warmer than the other when compared or blended. A new "Color Space" picker lets you choose how thorough the match is; the default (RGB) is instant, the others are slower but can match more subtle color differences.
  *Implementation, for developers:* new "Match Colors" collapsible (folded by default, persisted like the existing "Advanced" one) at the bottom of Compare and Blend, gated on `isSplit` (works in both Overlay and grid/side-by-side). `state.matchColorsToA` (bool) and `state.matchColorsColorSpace` (`"rgb" | "hsl" | "hsv" | "lab" | "lch"`) are both nuqs/URL state. One `HistogramMatchFilter` instance is mounted per non-A active view (overlay: just B; grid: each of B..H independently), always matched onto A as the reference — see `components/MapControls/HistogramMatchFilter.tsx` and the algorithm in `lib/histogram-matching.ts`.
  Two paths, chosen per color space:
  - **RGB** (fast): computes a per-channel 256-entry lookup table (via exact empirical-CDF histogram matching — see the Bug Fixes entry below) and applies it as a live CSS SVG `feComponentTransfer` filter directly on the target's `<canvas>`. No pixel data is ever touched; GPU-composited every frame for free.
  - **HSL / HSV / LAB / LCH** (slower, flagged with an hourglass in the picker): `feComponentTransfer` can only ever transform raw R/G/B output independently, so a mapping computed in one of these spaces can't be expressed as a CSS filter. Instead: hand-rolled sRGB↔space conversions (not chroma-js — its per-call Color-object construction/dispatch overhead is real at pixel-loop scale, measured ~4-5x slower) convert a small 96×96 sample of each view to the target color space, compute the matching per channel, then a coarse 25³-point 3D color LUT (the same technique real color-grading tools use — DaVinci Resolve/Lightroom camera profiles, `.cube` LUT files) is built once from that mapping and applied to the target's *own native canvas resolution* via trilinear interpolation — cheap per pixel (8 LUT reads + weighted blends, no transcendental math), which is what makes native-resolution output affordable at all (a naive full per-pixel conversion measured 0.5-0.9s at typical/high-DPI canvas sizes; the LUT approach is 100-400ms for the same sizes). Result is drawn onto a `pointer-events-none` overlay canvas stacked on the target's own live canvas (which stays interactive underneath), faded to `opacity:0` on either map's `movestart` and back to `1` once the next recompute lands, so a pan/zoom gesture always shows the live map moving instead of a stale, non-updating overlay sitting on top of it with no feedback.
  - Both paths re-sample on `idle` (either the reference or the target map), debounced to at most once/second.
  - Also vendors Iconem/historical-satellite's original standalone [histogram-matching demo](/histogram-matching-example/histogram-matching.html) (`public/histogram-matching-example/`) for reference — the algorithm this whole feature is ported from.

### Bug Fixes
- **LAB/LCH histogram matching producing wildly wrong colors** — root cause: the CDF matching binned each channel into a *fixed grid spanning its theoretical range* (e.g. LAB's a/b as ±100, later widened to ±128 as a first attempted fix — still wrong). Any low-variance sample (a flat-colored tile — open water, snow, a cloud deck) has almost all its mass in one or two bins, and the standard CDF-inversion boundary handling (`x <= xp[0]` / `x >= xp[last]`) then snaps those bins straight to the array's *theoretical* min/max the instant a query's cumulative fraction hits exactly 0 or 1 — which happens far more often than it sounds, not just at the sample's true extremes. For RGB that clamped to plain black/white (usually visually benign by luck); for LAB it clamped to wildly saturated colors that never appeared anywhere in either image. Fixed by replacing the fixed-bin approach with an exact empirical CDF (ECDF) over each channel's actually-observed values — sorted + deduplicated real samples, matching what scikit-image's own `exposure.match_histograms` does (`np.unique` + cumulative counts) — so both the lookup arrays and their boundary clamps are always real data points, never a synthetic range edge. Applied to the RGB path too (same root cause, just visually subtler). Verified against the exact degenerate case that exposed it (a perfectly flat-colored source/target pair, which used to land on arbitrary extreme colors) now matching exactly; realistic noisy-sample correctness and native-resolution LUT performance both reconfirmed unaffected (ECDF construction adds ~7-9ms on top of the existing 60-210ms LUT-apply cost).

# Changelog — N-Map Grid, Overlay blend, and export historical imagery
<!-- released: 2026-08-10 -->

#### TL;DR
- **N-Map Grid mode**: in addition to 2x1, can now also do 3x1, 4x1, or 2 rows, 2x2 up to 4x2. Gains a **Grid** shape, now supporting up to 8 synced map views, not just a 2-way split.

  ![Comparing basemap sources side-by-side in grid mode](/docs/screenshots/n-grid.jpg)
- **Compare and Blend's Split Mode: Off/Side/Overlay**, where gutter can be horizontally dragged for clip ratio, or the pill vertical position controls map view B transparency
- **Blend Mode for overlaid Map View**: Multiply, Difference, Soft-Light etc. Dropdown now exposes every CSS blend mode, not just a curated handful.
- **Export historical GeoTIFFs** across a date range, with an option to generate ready-to-run `gdal_translate` scripts.
- Optional colored map borders and a capture-date pill make it easy to tell which pane is which.

### Features
- **N-map grid & overlay comparison mode** — Compare and Blend's Split Mode gains a third shape alongside Off/Overlay: a full grid (2×1/3×1/4×1/2×2/3×2/4×2, up to 8 simultaneous views A–H), each with its own basemap source, driven by a shared `GRID_LAYOUTS` registry (`lib/grid-layouts.ts`) rather than a hardcoded A/B pair. Every pane is absolutely positioned off one shared layout pass so switching shapes never remounts a `<Map>` instance (keeps its WebGL context/tile cache). The last row absorbs whatever height the historical timeline panel actually eats into, so its own *visible* portion still matches every other row instead of a naive equal split leaving it visibly squished. Switching back to Terrain mode forces the shape back to plain 2×1 and re-derives the timeline's own grid layout to match — it previously kept showing all 8 A–H pills even after the map itself had collapsed back down. Inspired by Capturing Reality's RealityScan multi-view comparison grid and BBBike's MapCompare side-by-side.
- **Visual grid-layout picker** — Grid Layout's text SegmentedToggle replaced with a borderless 2-row × 4-col "table size picker" (same convention as the ABCDEF basemap-source toggle / color swatches, no per-cell text): the selected NxM shape lights up in solid primary, hovering a different valid cell previews the resulting shape in a lighter primary before committing. Every cell is a real, wired-up layout up to 4×2 (8 views, A–H) except the top-left 1×1 cell (a single unsplit view, meaningless as a grid-layout choice), which stays disabled rather than hidden so the control still reads as a clean fixed rectangle.
- **Per-side colored map borders** — an optional colored border per view (Compare and Blend → Advanced → Colorize Map Borders), toggle between a 3px-inset frame or a flush, thicker one. In overlay mode each side's border is drawn independently (not clipped from one shared rect) and split exactly at the drag pill's own position; in every mode borders clamp to the actually-*visible* edge instead of running under the floating sidebar or the historical timeline panel. The flush (no-inset) mode also avoids rounded corners and halves each side's stroke width exactly where it's shared with a neighboring pane's border, so a seam between two panes reads as one continuous stroke instead of visibly doubled. Borders now render as their own layer instead of nested inside the blended overlay pane, so an Overlay-mode mix-blend-mode (e.g. Difference/Exclusion) no longer discolors the border itself.
- **Capture-date pill** — a small floating pill per pane showing that view's real capture date, off by default, with an off/date-only/source+date 3-way toggle. Placement is sidebar- and timeline-aware (centers on the actually-visible width, not the full DOM box that intentionally extends underneath either), and in overlay mode centers each pane's pill in its own visible half of the split rather than stacking both at the shared left edge. Shows the source's short name instead of a fabricated "Unknown" when no real per-tile date is available (e.g. a static basemap), rather than disappearing entirely.
- **Split gutter / drag pill** — the 2×1 overlay divider is now a circle pill (drag = ratio + opacity together) sitting on a wider invisible gutter strip (drag = ratio only, `cursor-col-resize`), so grabbing near-but-not-exactly-on the pill no longer silently changes blend opacity too.
- **Ctrl+drag group-move for timeline handles** — holding Ctrl (or Cmd) while dragging a per-view handle now sweeps every other handle on one side of it by the same number of tick-marks, all measured in one flattened, all-sources index space so "N marks" reads as the same visual distance for every handle regardless of which source it's actually on. Which side is swept is decided once, from each handle's position relative to the dragged one plus the first real pointer-movement direction, so a handle dragged past the anchor mid-gesture stays swept; dragging back to the exact start position resets every swept handle too.
- **Multi-feature historical export** (`Export Multi (Historical)`, new dialog) — one GeoTIFF per export target × selected historical source × real capture date in a picked range, bundled into a `.zip`. Target is either **Viewport** (the current map view, nothing needs to be drawn) or **Per-Feature** (every currently-drawn TerraDraw feature, independently padded — a fixed meters radius for points, a percent-of-own-extent buffer for polygons/lines). An **Include gdal_translate script** option additionally writes one `.bat` per target with a ready-to-run `gdal_translate` command for every capture whose source exposes a real fetchable tile URL — Wayback/HLS/Planet/EOX Sentinel-2 via a `GDAL_WMS` TMS mini-driver (same technique as Iconem's prior historical-satellite export tooling), Bing via `GDAL_WMS`'s dedicated VirtualEarth service (quadkey-addressed, not `{z}/{x}/{y}`) — only Google Earth Historical is REM-commented out instead, since it has no public tile URL at all (this app resolves it internally against Google's own encrypted `dbRoot`).
- **Blend modes** — Overlay's Blend Mode dropdown now exposes every CSS `mix-blend-mode` keyword, not a curated handful, grouped into "Standard" (normal/multiply/screen/overlay/darken/lighten/color-dodge/color-burn/hard-light/soft-light/difference/exclusion) and "Extra" (hue/saturation/color/luminosity/plus-darker/plus-lighter).
- **Compare and Blend sidebar section** (renamed from "Comparison and Mix") split out of General Settings, with an "Advanced" sub-section (capture-date pill, border colorization + side colors) collapsed by default, its own collapsed/expanded state now persisted like every other sidebar section instead of resetting on reload. The "Open In…" launcher (Google Earth Web/ESRI Wayback/BBBike/etc.) lives in this section for Compare and Blend; in Terrain mode (which doesn't show this section at all) it lives instead in the historical timeline panel's own A/B caption row, centered between the two dates.
- **Historical mode defaults** — entering Historical Imagery mode (Mode Picker, or a direct `?appMode=historical` link) now also forces `showHillshade` off, so only the raster basemap actually renders — previously the one terrain-mode viz toggle that still defaulted on.
- Historical timeline's default (non-zoomed) view no longer stretches all the way back to a single old outlier tick (Google Earth Historical often has one isolated ~1945 capture for well-covered cities) — floored at 2010 by default unless every available tick genuinely predates that.
- Timeline per-view handle chips/side-picker/A-B captions fall back to a plain primary-colored look instead of each view's own hue when Colorize Map Borders is off, since that per-side color coding is meaningless once nothing on the map actually shows it — the same neutral fallback now also applies automatically in Terrain mode, which forces colored borders off but doesn't expose the toggle to reflect that.
- Source Info's per-view basemap attribution list no longer merges two views that share a source but resolved to a *different* real attribution (e.g. two views both on Google Earth Historical at different dates, different actual imagery provider) into one row showing only the first view's text — dedup now compares the resolved text itself, not just the source id.
- **ESRI World Imagery (live basemap) capture-date pill** now resolves a real per-tile date via the newest local Wayback release instead of always showing "Unknown," and shows that date next to its label in the basemap picker the same way Bing already did. ESRI Wayback's own Source Info attribution now reads a short "Provider (Source)" label (e.g. "Maxar (WV03_VNIR)") resolved from wayback-core's real per-release metadata, instead of sharing the live basemap's location-only, always-current contributor-coverage feed.
- **Chevron off-screen handle click** now zooms out 20% toward that handle's date instead of recentering exactly on it, so the timeline between "here" and "there" stays visible instead of jumping straight to the target.
- Historical-only keyboard shortcuts (L-hold lighting, Ctrl-tap viz-mode toggle, Shift-tap basemap toggle) are now disabled in Historical Satellite mode, where they don't apply; Ctrl+K and Space stay universal. These, plus arrow-key stepping and the timeline's Ctrl+drag behavior, are now documented in Settings → Keyboard Shortcuts.
- Terrain mode's description in the Mode Picker now specifically names Relief Visualization alongside hillshade/lighting/contours/terrain analysis.
- "Export Multi (Historical)" renamed to "Export Historical GeoTiffs" and moved above the Max Download Resolution input it shares a section with, instead of below it.

### Bug Fixes
- **Split-gutter drag drift** — the pill's horizontal drag read the small ~32px gutter strip's own (ratio-dependent, moving) bounding rect instead of the true split container's, so dragging the pill (as opposed to the surrounding gutter) silently drifted from the cursor. Fixed by reading the gutter's parent rect for both.
- **Historical timeline panel height/desync** — its `ResizeObserver` was attached once at first mount and never reattached after the panel unmounted and remounted (collapsing/re-expanding the floating timeline), silently freezing the reported height forever after the first such cycle. This fed the map borders' bottom clamp, the minimap's offset, and the scale/attribution clearance, so a stale height desynced all of them at once — e.g. a colored border landing behind the timeline panel after toggling it off and back on. Replaced the effect with a callback ref that reattaches on every real mount.
- **Minimap flush against the expanded timeline panel** — its clearance formula added the panel's own 16px `bottom-4` anchor offset and the intended 16px visual gap as if they were the same 16px, leaving zero actual margin whenever the full (non-collapsed) panel was showing; the collapsed-to-icon case already accounted for both separately. Now adds both.
- **AttributionControl force-opening itself** — a real MapLibre `attribution_control.ts` quirk: `compact` mode force-opens the `<details>` the first time real attribution content resolves while the map's canvas is ≤640px wide (true for most split panes), and never auto-collapses again. Worked around with a capture-phase click listener (to still respect a genuine user click) plus a `MutationObserver` that immediately re-collapses any *other* `open` addition.
- Bottom-row capture-date pills now anchor to that row's own true bottom (clearing the timeline) instead of the seam with the row above, now that the border/timeline clamping they share is correct — previously both rows' pills crowded onto the same middle seam.
- **Arrow-key timeline stepping vs. Blend Mode dropdown** — arrowing through an open Blend Mode `<Select>` also stepped the historical date underneath it, since the timeline's own arrow handler wasn't scoped to whether the timeline panel was actually the last thing clicked. Now gated on that.
- **Year-gridline UTC bug** — the gridline generator compared a local-time year against a UTC-floored boundary, silently dropping the "2010" floor label for anyone in a UTC+ timezone.
- **Pan gutter / wheel-pan gating** — both the horizontal pan gutter and wheel-driven horizontal pan were gated on `viewWindow` being set rather than on a real hidden range actually existing, so e.g. re-toggling a source pill back on (which can only become reachable via the 2010 default-view floor, not an actual zoom/pan) left the gutter transparent/inert. Wheel gestures also now lock to pan-or-zoom for the gesture's full duration (trackpad swipes rarely produce pure `deltaX`, so switching mode per-event read as stutter), and wheel-driven `viewWindow` updates coalesce to one per animation frame instead of one per wheel event, since momentum-decay tails can fire well past 60fps.
- **Ctrl+drag handle index math** — iterated from each handle scrubbing by nearest-pixel (reading as time-distance rather than a clean N-marks shift when sources differ in tick density) to indexing within its own source's list, to its final form: indexing within the flattened, all-sources list, so "N marks" is the same visual distance for the dragged handle and every swept handle alike, regardless of source.

# Changelog — Historical Satellite Imagery Timeline, Terrain vs Historical Mode Picker
<!-- released: 2026-08-07 -->

#### TL;DR
- **New "Historical Imagery" mode**: scrub a real per-tile capture-date timeline bottom panel, across **[ESRI Wayback](https://livingatlas.arcgis.com/wayback/), [Google Earth Historical](https://github.com/Iconem/GE_TimeMachine)**, [Landsat/Sentinel (HLS)](https://hls.gsfc.nasa.gov/), [Planet](https://www.planet.com/products/basemap/), and [Bing](https://www.bing.com/maps/aerial).

  ![Scrubbing the historical timeline across capture dates](/docs/screenshots/historical-timeline.jpg)
- **Mode Picker: Terrain vs Historical** switches the whole sidebar between Terrain Viewer and a simplified Historical Imagery layout.
- Every historical basemap source feeds real attribution, including dynamically-resolved provider/date info for Wayback, Google Earth Historical, and Bing.
- **The light-direction XY pad itself gained a full bidirectional datetime binding**: drag it and it back-solves the closest matching day-of-year/time-of-day (and the sliders still drive it forward as before), hatching every position the sun can't physically reach at the current latitude (a real day/night-boundary constraint).
- Sun Shadow Calculator: new **Reverse** mode: click a shadow to back-solve the light direction and time of day, knowing building height. Also see the standalone [sun-position estimator](/sun-position-estimator.html) tool.

### Features
- **Historical satellite imagery basemaps + timeline scrubber** — five date-driven basemap sources (ESRI Wayback, NASA HLS Landsat/Sentinel, Google Earth Historical via a reverse-engineered `gehist://` MapLibre protocol (scaffolded from [Iconem/GE_TimeMachine](https://github.com/Iconem/GE_TimeMachine)), Planet Monthly Mosaics behind an API key, and Bing's single current mosaic), consolidated into one "Historical Imagery" sidebar entry rather than five separate rows (which underlying source is active per side is a separate `historicalActiveSource(A/B)` field). A bottom timeline panel shows per-source colored pills (toggle which sources' ticks are shown, filterable by VHR/medium resolution) and a scrubbable track of real per-tile capture dates — not each source's own catalog-wide "release date." Split-screen/per-view mode gets a sync toggle (single chain icon) to move both sides' scrub position together or independently via an A/B picker. Off-screen A/B handles collapse into a rounded chevron chip ("A>"/"<B") that recenters the view on click instead of colliding with the round in-view handle. A "Open in…" launcher opens the current view in BBBike MapCompare or similar external tools.
- **Real per-tile capture dates, not catalog metadata** — Wayback resolves via its own metadata endpoint (deduped by resolved real date, since distinct releases commonly share one — the earlier culprit behind ticks piling onto one pixel), Bing reads a deliberately CORS-exposed `X-VE-TILEMETA-CaptureDatesRange` response header (undocumented but confirmed live to vary genuinely by location/zoom), GE Historical decodes Google's own encrypted `dbRoot`/quadtree-packet protocol.
- **Mode Picker** — clicking the sidebar title ("Terrain Viewer" / "Historical Sat") opens a dialog to switch the app's meta-mode between **Terrain** (the full toolset, unchanged) and **Historical Imagery** (a deliberately stripped-down 2D-only sidebar: no View Mode toggle, no Visualization Modes/Options/Detectors groups, no Elevation Picker, just General Settings, Bookmarks, Download, an ungrouped Basemap picker, and Tools). Settings dialog hides what's terrain-only in this mode too (the Visualization Modes reference section, Tells/Mound-detector beta toggle, high-precision Terrarium-vs-TerrainRGB toggle, MapTiler API key). `appMode` is nuqs/URL state (sorted right after `project` in the URL's own param order), not a local-only setting, and persists its last value across a fresh session like the existing beta-gate flags.
- **Basemap attribution** — every basemap source now feeds MapLibre's attribution control (previously only terrain sources did). Static per-provider strings for OSM/Mapbox/HERE/Bing/Google/Planet/HLS/EOX Sentinel-2-cloudless; genuinely dynamic, current-view-resolved attribution for Esri/Wayback (Esri's public contributor-coverage feed, `static.arcgis.com/attribution/World_Imagery`), Google Earth Historical (the real per-tile capturing provider, decoded straight from Google's own `dbRoot` — a `providerId → copyright` table shipped in the same response already fetched for other purposes, reverse-engineered against Open GEE's `dbroot_v2.proto` and cross-checked against CesiumJS's own `GoogleEarthEnterpriseMetadata`), and Bing (real per-tile capture-date range, see above). The corner `AttributionControl` shows a short static pointer for the three dynamic sources ("see dynamic source attribution in sidebar source panel") since a `<Source>`'s `attribution` prop can never be live-updated post-mount (react-map-gl's own reconciler has no case for it) — but is *also* pushed the real resolved text directly via the underlying MapLibre `Map` instance plus a synthetic `sourcedata` event (`Map.fire`, fully public API, no private methods), so the corner control shows it live too. The sidebar's Source Info section lists every historical source's attribution (dynamic + static) and works in both Terrain and Historical app modes — a raster basemap can be active in either.
- **Inverse solar-position lookup + shadow-based light estimator** (`debeea8`, refined `09f3803`) — the light-direction XY pad (Hillshade/Phong native + Sun Shadow Calculator) is now a full bidirectional binding in Datetime mode: dragging it back-solves the closest matching day-of-year + time-of-day (closed-form, picking whichever of the two annually-recurring declination solutions is nearer the day already set) and updates the Date/Time sliders, while the sliders still drive the pad forward as before. Free mode shows the same back-solved day/time as a "closest match" caption. The pad hatches every position the sun can never reach at the current latitude (a closed-form spherical-astronomy inequality, not a restrictive tint) and its drag pill turns destructive-red in real time outside that region. Sun Shadow Calculator gains a **Reverse** mode: click an object's base, then its real shadow tip as seen in the imagery, and the shadow's length/bearing plus the object's height back-solve a light direction (and closest-matching day/time) instead of the other way around. A standalone prototype of the forward solve — pick a date/time/location, see the resulting sun position and shadow length — ships alongside it as a mini tool (`bba319b`): [sun-position-estimator.html](/sun-position-estimator.html).

### Bug Fixes
- **Ghost/duplicate timeline marks** — root-caused to distinct Wayback releases resolving to an identical real capture date, which collided on both the tick list's React key and the tick-position map's key, causing React to reuse/misplace DOM nodes (worse after repeated zooming). Fixed by deduplicating Wayback ticks by resolved date at the source, not by trying to visually nudge duplicates apart.
- **Handle-to-mark exact-match jump bug** — the timeline handle resolved which tick was "active" via exact floating-point/timestamp equality, which is fragile across independent data-refresh cycles; switched to nearest-match resolution.
- **Timeline mousewheel zoom/pan stale-closure bug** — the wheel-handler's own `useEffect` depended on values that changed on every tick, causing listener teardown/re-add churn that showed up as occasional freezes/stale positions during fast horizontal scrolling.
- **A/B handle collision** — an off-screen handle previously rendered both the clamped round handle pinned at the track edge *and* a separate off-screen chevron indicator simultaneously; now mutually exclusive.
- Split-mode centering, per-map sidebar padding, minimap/attribution-corner layout regressions, and pastel per-source tick colors derived from each provider's own brand color, from the historical-timeline work above.

# Changelog — Draw export split, Colorramp Editor, Bookmarks Gallery
<!-- released: 2026-07-31 -->

#### TL;DR
- **TerraDraw export split mode**: button with a "split by layer" option.
- **Colorramp editor**: A live session-only for quick, non-persisted ramp-stop edits.
- **Bookmarks gallery** now flattens into one continuous grid by default.

### Features
- **Bookmarks gallery** — flatten toggle (now default-on) shows every view as one continuous grid with two-line "Project" / "View" labels, instead of one grid per project leaving empty slots when a project isn't a multiple of 3 or has just one view.
- **Live colorramp session editor** — a pencil next to every named-ramp picker opens a live stops editor (same alpha-aware color picker as layer colors) for the currently selected ramp; edits are session-only (a plain jotai atom, never persisted to localStorage or the URL) and revert on reload. A Paintbrush toggle next to it swaps the ramp's (near-)black or white stop to transparent, no-op if it has neither.
- **TerraDraw export** — now a split button: the main button exports immediately with the last-used setting; its chevron opens a small popover with a "split export by layer" toggle (one `.geojson` per layer, bundled into a `.zip`, instead of every layer flattened into one file). Import/Clear resized to match (Import/Export at a 2:3 flex ratio, Clear an icon-only button matching their height).
- **Expanding-search geocoder** — collapses to just the search icon until clicked, focused, or typed into (and stays expanded once it has text or a picked result); `Ctrl+G` expands/focuses it alongside the existing `Ctrl+K`. The collapsed icon now matches the other native maplibre controls exactly (size, background, border ring, centering). Enter without arrow-key navigation now commits the top suggestion *and* closes the dropdown, matching arrow+Enter/click behavior. Per-result pin icons removed from the suggestions list.
- **MapLibre native controls (zoom/compass/geolocate) restyled** — their vendor icons were background-image data URIs with a hardcoded gray fill and no theming hook (previously patched over with a blanket CSS `invert()` filter); replaced with real lucide-react icons that follow the theme's foreground color automatically in light and dark, with geolocate's active/error tracking states keeping fixed status colors. Compass now correctly points north (was a diagonal, off-center default icon shape). Both the control group and the geocoder now read the active color preset's card background and corner radius (`--card`/`--radius`) instead of a hardcoded white/fixed radius — switching to a very square (neo-brutalism) or very round preset now visibly carries over to these controls too.
- **`<Select>` keyboard nav** — Left/Right arrow keys now cycle the trigger's value directly without opening the popup (Down/Up still open + navigate it as before), for every existing select in the app with no call-site changes.
- **Mapbox/MapTiler terrain sources** are now hidden from the picker until their API key is set, matching the existing Mapbox/HERE basemap gating.
- **shadcn/ui** — `components.json` style moved to `base-vega` (Base UI's renamed "classic" preset); `package.json` gained a `shadcn:add` script pinned to `-b base` so the CLI can't silently fall back to Radix.

### Bug Fixes
- **Beta toggle persistence** — the Tells and Sun Shadow beta gates were URL-only (nuqs), with no localStorage backing, so they silently reset to off on every reload without an explicit `?tellsBeta=`/`?sunShadowBeta=` param. Fixed by mirroring the last value into a small `atomWithStorage` and restoring it on first load unless the URL already overrides it — the two-system split (nuqs for the shareable gate, jotai for "what I last had it set to") is a bit of an odd shape, but keeps `?tellsBeta=true` links working exactly as before while fixing the reload case.
- **Geocoder dark mode** — the suggestions dropdown background stayed vendor-white (its dark override targeted a BEM class this geocoder version never actually renders) and the clear (X) button stayed a bright white square with a dark icon; both now follow the theme correctly. A stray `overflow: hidden` on the base (not collapsed-only) rule had also been clipping the suggestions dropdown even while expanded.
- **Phong/Matcap tile redraw churn** — the "Terrain Exaggeration" slider (and, less visibly, `matcapRotationDeg`/`phongDiffuseStrength`/`phongSpecularStrength`) fed straight into the `matcap://`/`phong://` tile URL undebounced, so dragging it re-fetched every visible raster tile on every animation frame. All four now go through the same read-side debounce already used for light direction (0ms in the GPU-uniform "live" renderer, 150ms in "raster").
- **Openness/SVF tiles not caching on toggle** — their ray-marched compute yields to the main thread for responsiveness, and the yield point doubled as an abort checkpoint: toggling the mode off mid-tile threw the in-flight result away instead of caching it, which fast (never-yielding) modes never hit. Removed the abort-throw so an already-fetched tile's remaining (bounded) CPU work always finishes and lands in the cache.
- **Bookmark deletion** now cascades to a project's children instead of leaving them orphaned.
- **Copy-template button** (TMS/WMS URL hint) shows a checkmark instead of the green copy icon for 1s after clicking.
- **Sky/horizon/fog colors** moved from an entirely unpersisted plain jotai atom (lost on every reload) to URL/nuqs state, consistent with every other viz-mode setting — also makes them shareable via URL/bookmark like everything else, not just locally remembered.
- Keyframes "Complete vs Smooth" toggle now uses the app's default small `Switch` instead of a custom oversized one.
- Export modal shows a count of local BYOD COG sources next to "Include local COG files".

# Changelog — COG GSD surfacing & Foldable Bookmarks Tree 
<!-- released: 2026-07-30 -->

#### TL;DR
- COG sources now auto-show their inferred native resolution and ground-sample distance.
- Bookmarks: drag-and-drop reordering, collapsible project folders, fold/expand-all, and an edit mode to keep the everyday view uncluttered.

### Features
- **Foldable bookmarks tree** — project (root) bookmarks collapse/expand their child views, file-tree style; a collapsed project shows a stand-in thumbnail (its first child's, by current order, or a placeholder), which hides once expanded since the children show their own.
- **Drag-and-drop reordering for bookmarks** — drag a project to reorder among projects, or a child view to reorder among its own project's siblings; a highlighted line under the target row shows where it'll land instead of outlining the row. Dragging a project only targets other projects (never children), dragging a child only targets siblings of the same project, and dropping over an *expanded* project lands the indicator below its last child rather than right under the header.
- **Fold-all / expand-all** and an **Edit mode toggle** (same convention as the Drawing panel's own layer-edit toggle) for the bookmarks list — rename/delete stay hidden until switched on, so the everyday view is just thumbnails, names, and add-child.
- **Bookmarks gallery** now groups view cards under their parent project's name instead of showing the parent as its own card.
- Clicking a project now restores (and highlights) its first child *by current display order* — reordering children changes what a project click shows, instead of always the originally-created child.
- **Project export**: local COG files now bundle into a `local-cogs/` subfolder inside the export zip instead of the zip root; a new "Bookmark thumbnails as a .zip" option (independent of "Include local COG files") externalizes thumbnails into `bookmarks_thumbs/` on request. Sub-options now sit directly under the category they modify (local COGs under Sources, thumbnails-in-zip under Bookmarks) instead of all at the bottom, and View & Viz State moved to the top of the list.
- **Basemap/terrain source modals** — a copy-to-clipboard icon next to the `{z}/{x}/{y}` / bbox template hint.
- **HERE Maps satellite** added as a builtin basemap provider, key-gated (hidden from the picker until a HERE API key is set, in Settings or `VITE_HERE_API_KEY`) — reordered the builtin basemap picker to Google Hybrid, Bing, Esri, Mapbox, HERE, Google Sat, OSM.
- **BYOD basemap sources** gain user-settable Min/Max Zoom (previously only BYOD terrain sources had this).
- **COG native-resolution inference** — the Add/Edit Terrain/Basemap modals now show the geomatico-inferred native-resolution zoom and mean ground-sample-distance (GSD) for COG/local-COG sources, with Min/Max Zoom as an explicit override; a permanently failed fetch (e.g. CORS) now shows a clear message instead of "Detecting…" forever.
- **BYOD modal rework** — field order is now Name → Type → URL; Advanced now leads with Description and Min/Max Zoom ahead of Linked Source/Bounds and only auto-expands for a non-default value in one of those (not Description alone); COG file requirements are now a "Must be:" bullet list below the file picker.
- Mapbox/MapTiler/Google/HERE API keys moved out of committed source into a local, gitignored `.env`; the Settings batch-edit textarea now uses the same `MAPBOX_ACCESS_TOKEN`-style names (just add/remove `VITE_` to copy between the two).
- **react-scan** added for local dev (dead-code-eliminated from production builds) — outline-rerenders off by default, toggle via its own toolbar.

### Bug Fixes
- **Elevation Picker / Sun-Shadow Calculator** — toggling back to "Select" after drawing something could permanently disable the picker toggle; both now track the shared draw-mode state directly instead of a stale local mirror that only updated on feature edits.
- **Basemap source modal** — pasting a URL containing `{z}/{x}/{y}` while the source type is WMS no longer corrupts the braces into percent-encoded characters (a `new URL()` round-trip was re-encoding the *entire* URL, not just the bbox param it was meant to normalize).
- **Project export** — a plain export (no local COGs) that still had bookmark thumbnails was silently producing real zip bytes labeled and downloaded as `.json`; it now stays a genuine bare JSON document unless a zip is actually requested.
- **Umami analytics** — the `options-relief-visualization` event fired on almost every render instead of only on an actual toggle: the tracked snapshot never stored `svfPrecision`/`opennessPrecision`, so the diff check compared a real value against permanently-`undefined`. Dropped the broken tracking for those two settings.
- **Esri/Bing/Google Satellite maxzoom** corrected (Esri 19, Bing/Google Sat 21) and Bing's hardcoded-token tile URL replaced with the public quadkey endpoint.
- **Color-ramp `<Select>`** — the gradient swatch stopped showing in the closed trigger after the radix→base-ui migration (base-ui's `SelectValue` only renders plain text by default); fixed via its render-prop.
- **Symmetric-range sliders** (Curvature, LRM, Shape Index, Openness, Local Dominance, TPI) could be dragged to a degenerate zero-width range at their minimum; each now floors at its own step instead of 0. TRI/Roughness max range 500→250, TPI max range 100→50.
- **Basemap source-info section** now always renders in the sidebar (matching Terrain), instead of only when Raster Basemap is toggled on.

# Changelog — Whole-Project Export, Hard Shadows & Sun Shadow Calculator
<!-- released: 2026-07-28T17:41 -->

#### TL;DR
- **Whole-project import/export** in one file (terrain/basemap sources, bookmarks, drawings, settings, with zip to embed vector drawings/local COGs as an option).
- **Hard Shadows**: a new visualization mode casting real hard shadows from the shared light direction, independent of the Sun Shadow Calculator tool.
- **Sun Shadow Calculator**: pick a point + an object's height, get its shadow at the current sun position.
- SVF/Openness gain faster precision, plus a new Principal Components (PCA) relief-mode family (Blobness, Eigenvalue Ratio, Dominant Orientation, Shape Index).
- Terrain Analysis's Settings description split into 3 subheadings (Surface derivatives, Neighborhood statistics, Principal Components) to match.

### Features
- **Whole-project import/export** (`587a436`) — sources, bookmarks, drawings, and settings in one file.
- **Hard Shadows visualization mode** (`203c844`) — hard cast shadows from the shared light direction, as its own toggleable layer independent of the Sun Shadow Calculator tool.
- **Sun Shadow Calculator** (`1464502`) — pick a point and an object height, get its shadow at the current sun position; gated behind Beta (`afa8203`).
- **SVF/Openness/PCA relief-mode family** (`72ac062`) — faster precision plus Principal Components siblings (Blobness, Eigenvalue Ratio, Dominant Orientation) and a standalone Shape Index (`348fea0`).
- **Terrain Analysis Settings description split into Surface derivatives / Neighborhood statistics / Principal Components subheadings** (`94e4752`) — matching the PCA family's arrival above; also documents Shadows.

# Changelog — Bookmarks & Feature Iterator
<!-- released: 2026-07-28T09:20 -->

#### TL;DR
- **View bookmarks**: save/restore full viewport + viz state, sidebar list + gallery.
- **Feature Iterator**: step through a drawn/imported layer's features one at a time (select, delete, arrow-key nav, fly-to-next).
- A compute-time estimate now shows for slow modes (SVF, Openness, Local Dominance) while their tiles are still loading.

### Features
- **View bookmarks** (`75c9c2f`) — save/restore full viewport + viz state, sidebar list + gallery; reorder/hierarchy and geocoded names followed within days (`ba6bf1f`).
- **Feature Iterator** (`0af1d68`) — step through a TerraDraw layer's features one at a time; select/delete/arrow-key nav and fly-to-next-on-delete followed the same session (`64668d3`, `d9bd5b4`, `1c6fe3a`).
- **Compute-time estimate for slow modes** (`fd4458b`) — SVF/Openness/Local Dominance now show an estimated time-remaining while their ray-marched tiles are still computing, based on an empirically-tracked concurrency rather than a naive sequential assumption.

# Changelog — Linked Terrain/Basemap Sources & Non-Geo Mode
<!-- released: 2026-07-28T01:32 -->

#### TL;DR
**Linked terrain/basemap source pairing**: for paired datasets like a fresco's DTM plus its own albedo photo, picking one auto-selects the other. Part of this app's non-geo mode, a **complementary** viewer to RTI/PTM tools like [OpenLime](https://github.com/cnr-isti-vclab/openlime) (not a replacement) for viewing normal-map/albedo photogrammetry data as if it were terrain. See [issue #1](https://github.com/Iconem/terrain-viewer/issues/1) for the feature-parity tracker, and a real example on [OpenLime itself](https://3d.iconem.com/syria/DuraEuropos_Synagogue/index-openlime.html) for comparison.

### Features
- **Linked terrain/basemap source pairing** (`eb95bfd`) — for paired datasets like a fresco's DTM + albedo photo, picking one auto-selects the other; fixed for real the next morning — imperative resolution, folded link UI, extended to split-view B side (`aae9e27`, `574990c`). The mechanism behind this app's non-geo mode: a complementary viewer to RTI/PTM tools like OpenLime (not a replacement), for viewing normal-map/albedo photogrammetry data as if it were terrain — see issue #1 for the feature-parity tracker, and a real example on OpenLime itself for comparison.

# Changelog — Contours extended, Local Persistence, Routing & New Tools
<!-- released: 2026-07-27T20:31 -->

#### TL;DR
- Contours extended to local/BYOD COG sources via a dedicated worker, plus line-weight and color controls.
- Local COG files and vector layers now survive a reload via OPFS persistence.
- **Routing mode for Elevation Picker**: a BRouter/Valhalla road-following route (foot/cycle/vehicle profiles) between two picked points instead of a straight line, with a routed elevation profile along it.
- New tools: Source Info panel (states which underlying provider a composited Mapterhorn/AWS tile actually came from, not just the mosaic's name), Plane Slicer (choose Local Relief Model or raw altitude as the reference plane; Contours share the same choice), Local Dominance relief mode (later sped up via pyramid octaves).
- Shared custom colorramp editor extended across every viz mode.
- A cancel button for DTM export appears after ~1.5s if the export is still running.

### Features
- **Routing mode for Elevation Picker** (`7e81dbf`) — a BRouter/Valhalla road-following route between two picked points (foot/cycle/vehicle profiles) instead of a straight line, with a routed elevation profile along it.
- **Source Info panel** (`2a64eb1`) — per-tile data-provenance display: for a composited/mosaicked source like AWS Terrain Tiles or Mapterhorn, states which underlying provider tile a given viewport area actually came from, instead of just naming the mosaic itself.
- **Plane Slicer** (`f580e9b`) under Elevation Picker — like Contours, lets you choose whether the slicing/height reference is raw altitude or the Local Relief Model (`planeSlicerReferenceMode`).
- **Local Dominance relief mode** (`5bb2154`) — sped up via pyramid octaves (`b59f49d`) — plus a point-to-point profile/line-of-sight tool.
- **Contours extended to local/BYOD COG sources** (`66900d4`, verified working `3172583`) via a dedicated worker — previously contours only worked against the builtin tiled sources (see the Nov 2025/Feb 2026 contours history further down). Gained a line-weight control (1×/2×/4×, `3979286`) and dedicated color pickers (`0134732`); a mount-order race that could drop the layer on a fresh page load was fixed the same week (`cc05ae8`).
- **OPFS persistence** for local COG files (`ae53d68`) and drawn/imported vector layers (`8667bf3`) — both now survive a reload.
- **Shared custom colorramp editor** extended across every viz mode (`1c95167`, `8553877`).
- **Cancel button for DTM export** (`90f0367`) — appears after ~1.5s if the export is still running (most finish faster, so the affordance only shows up when it's actually worth using).

# Changelog — RiverREM
<!-- released: 2026-07-27T12:03 -->

#### TL;DR
The footer's "Also see" links now explicitly describe **[RiverREM](https://rem.prod.heritagewatch.ai/)** ([repo](https://github.com/Iconem/RiverREM_UI)), a separate app built for a similar use case, on rivers instead of terrain: draw or import a river centerline (or fetch one from OSM via Overpass/QLever, the longest named waterway, or all matches), smooth/interpolate its water-surface elevation (WSE) along that line, then de-trend the DEM against it (`REM = DEM − WSE`) to get a Relative Elevation Model highlighting fluvial terraces a flat elevation map hides, pure client-side, or server-based via OpenTopography's Python `RiverREM`.

### Features
- **RiverREM footer link** (`a2c30ea`) — the same commit that added the shared hillshade/Phong datetime light (see the historical-satellite entry above) also added this app's own footer link to RiverREM, a separate Iconem app for the analogous river-relative-elevation-model use case.

# Changelog — Matcap/Phong Lighting Rebuilt as Live WebGL Shaders
<!-- released: 2026-07-22T15:26 -->

#### TL;DR
Matcap/Phong lighting was rebuilt as live WebGL shaders, then reverted the same morning to a GPU-accelerated raster-tile approach after the WebGL version proved unstable; native MapLibre Hillshade was restored as its own mode alongside it.

### Features
- **Matcap/Phong Lighting rebuilt as live WebGL shaders, then reverted to GPU-accelerated raster tiles** — Lighting Effects was first redesigned around local-file/COG basemap sources (`718b12a`), then rebuilt as custom WebGL layers with live shader uniforms less than 20 minutes later (`bf4977d`). After native MapLibre Hillshade was restored as its own mode alongside it (`1c81439`) and a globe-rendering fix was attempted (`6ebdb49`), the WebGL rebuild proved unstable and was reverted back to plain raster-tile protocols the same morning (`e62d58b`), which then got GPU-accelerated instead (`a53f734`), the version that stuck. An RTI-style hold-L light-control overlay for quick relighting had landed a few days earlier (`07a0d70`). An absolute/camera-relative light-mode toggle (`521a07d`) and, the next day, camera-attached live light plus a no-debounce "2D Fast" mode (`dabc03a`) rounded it out.

# Changelog — Theme Editor
<!-- released: 2026-07-21T23:14 -->

#### TL;DR
New standalone **Theme Editor**: live Tailwind v4/shadcn theming with tweakcn/shadcnstudio presets.

### Features
- **Theme Editor** (`f1b6049`, presets `23c09ea`/`c73983b`, Basic mode `bc2b082`) — a standalone, drop-in live Tailwind v4/shadcn theme editor with HSL adjustment/randomize and localStorage-saved custom themes (`34e9bf4`), plus themux/shadcnstudio preset packs; later moved into Settings (`ff19946`).

### Bug Fixes
- `20b9822` fixed the Theme Editor's fonts never actually applying.

# Changelog — Relief Visualization Split & Sidebar Labels
<!-- released: 2026-07-18T19:05 -->

#### TL;DR
- **Relief Visualization** split into its own separate group (**Sky View Factor SVF, Openness**) from **Terrain-analysis (Curvature, TPI, Roughness, Det-Hessian, Blobness)**.

  ![Sky-View Factor relief visualization](/docs/screenshots/viz-modes/svf.jpg)
- Relief Visualization and Terrain Analysishave a Basic/Advanced collapse toggle to either just activate/deactivate the additional sub-modes, or go further and edit their symbology.
- **Keyboard shortcuts**: Shift-tap to peek at the raster basemap, Ctrl-tap to hide every overlay down to just the basemap. See all keyboard shortcuts in the dedicated section of General Settings modal. 
- **Labeled Sources / Options / Detectors / Tools sidebar dividers** for scanning a long control panel.

### Features
- **Terrain Analysis / Relief Visualization split into separate groups** (`22c828e`) — same commit also added the Shift-tap basemap-peek shortcut and macro-group separators.
- **Basic / Advanced mode toggle** — Terrain Analysis and Relief Visualization sections collapse to just checkbox + opacity slider, hiding sub-mode options until wanted.
- **Keyboard shortcuts** — Shift-tap to peek at the raster basemap; Ctrl-tap to hide every overlay down to just the basemap, tap again to restore.
- **Labeled sidebar dividers** (`1304271`) — Sources / Options / Detectors / Tools section breaks for scanning a long control panel; pinned open + reordered a day later (`b9eaa6f`).
- **Same source on both A/B** — split-screen source pickers only ever showed one side as selected, even when both used the same source; fixed to show both independently.

### Bug Fixes
- **Sidebar scroll/header glitches** — corner-rounding squaring off, button group shifting, fast-scroll jitter.
- **Overlays ignoring their own max zoom** — hardcoded limit overrode a source's real tile pyramid (e.g. NASA GIBS), causing tile-request errors.
- **2D Elevation Picker freeze** on large COG files.

# Changelog — TerraDraw Multi-Layer Drawing
<!-- released: 2026-07-18T12:12 -->

#### TL;DR
TerraDraw becomes multi-layer: drawing and GeoJSON import now target whichever layer is active.

### Features
- **Multi-layer TerraDraw** (`d6ac682`) — drawing and importing GeoJSON now target a specific layer instead of one implicit layer (GeoJSON import itself dates back to TerraDrawSystem's original introduction, Feb 2026 — see further down); the same commit also fixed a TerraDraw cold-start delay.

# Changelog — Local COG (BYOD) Terrain Sources
<!-- released: 2026-07-15 -->

#### TL;DR
- **Local COG (BYOD) terrain sources**: load a `.cog.tif` straight off disk, no upload.
- **Viz-mode tile caching**: an LRU of finished viz-mode tile bytes that makes re-toggling a mode instant instead of recomputing it.

### Features
- **Local COG (BYOD) terrain sources** (`a852466`) — pick a `.tif` off disk, no upload, with CRS/tiling validation.
- **Viz-mode tile caching** (`cacheVizTiles`, same commit `a852466`, later touched again `587a436`) — an LRU of finished viz-mode tile bytes that makes re-toggling a mode instant instead of recomputing it.

# Changelog — Mound Local Tops Detector Beta
<!-- released: 2026-07-12 -->

#### TL;DR
Experimental **"Tells" archaeological mound detector**, gated behind a Beta toggle: flags candidate mounds by finding local extrema/maxima of the LRM, then veto-filters them by Blobness, Plan Curvature/Divergence, and Det-Hessian to reject saddles and ridges.

### Features
- **Archaeological mound detection ("Tells")** (`135311a` protocol, gated `0bc1f84`, explainer `8d35e2f`) — experimental detector flags candidate mounds from curvature/blobness; own section, color-by ramps, export, explainer, beta toggle.

# Changelog — Terrain Analysis: Curvature Suite Expanded
<!-- released: 2026-07-11 -->

#### TL;DR
**Terrain-analysis suite**: **Profile curvature** (rate of slope change along the steepest-descent direction, i.e. flow acceleration) and **Plan curvature** (rate of aspect change across contours, i.e. flow convergence/divergence), plus **TPI and Roughness; Det-Hessian and Blobness** followed.

### Features
- **Curvature/TPI/Roughness terrain-analysis suite** (`476a963`) — Profile curvature and Plan curvature (defined in the TL;DR above), TPI, and Roughness; the 3×3-neighborhood default and the profile/plan split were documented in Settings the same day (`9f94b8a`).
- **Det-Hessian curvature mode and Blobness structure-tensor sub-mode** (`10c51cd`) — added a day later.
- **Higher-precision terrain-derived tiles** — curvature, aspect, TRI, roughness, openness, blobness, and LRM now wire-encode ~25x finer, cutting visible banding.

### Bug Fixes
- **TerraDraw**: init race, GeoJSON import double-counting, Fast-Refresh break.
- **Minimap**: cold-start delay and resize bug.
- **TypeScript errors cleared to zero**.

# Changelog — Local Relief Model (LRM) Relative Elevation to neighborhood
<!-- released: 2026-07-10T12:41 -->

#### TL;DR
**Local Relief Model (LRM)**: a new relief mode isolating local bumps from the regional trend. This is compute-optimized by subtracting the elevation tiles altitude at native viewport resolution from the bi-linearly interpolated trend, requested from a lower resolution version of the pyramid. User can control how many levels lower, and sees the resulting gaussian mean scale he chooses.

### Features
- **Local Relief Model (LRM)** (`be5606f`) — multi-scale relief mode isolating local bumps from the regional trend.

# Changelog — Client-Side DSM Export, Project Presets, Basemap Overlays & Elevation Picker
<!-- released: 2026-07-09T22:52 -->

#### TL;DR
- **Client-side GeoTIFF export** without Titiler, and shareable per-project embed configs.
- **Project embed presets**: `?project=` links can seed a fully preconfigured view: 
   - **[Mapterhorn Globe](/?project=mapterhorn-globe)** (zoomed-out world view, Mapterhorn-only, source pickers hidden), 
   - **[Dura Frescoes Viewer](/?project=dura)** (fixed 2D non-geo fresco view, most terrain-analysis tooling hidden), 
   - and a minimal **[Example Embed](/?project=example-embed)**, see [lib/projects.json](https://github.com/Iconem/terrain-viewer/blob/main/lib/projects.json).
- **Basemap overlays** (samples ships demo radar, trails, stamen watercolor) that layer on top of any basemap instead of replacing it.
- **Elevation Picker**: click-to-sample elevation at point or delta between two-points

### Features
- **Client-side DTM export & project embed system** (`ad210af`) — export GeoTIFF from the browser without Titiler; per-project embed/URL config; a WMS layer picker for BYOD WMS sources.
- **Project embed presets** (`5507f7f`) — `?project=` presets can seed custom sources, auto-zoom to a source's real (COG-read) bounds, override the sidebar title, and are exportable via a "Save Project Preset" tool in Settings. Shipped with: **Mapterhorn Globe** and **Dura Frescoes Viewer** presets (`lib/projects.json`), each simplifying the sidebar to just what that site needs — Dura hides contours/Terrain-Analysis/Relief-Visualization/split-screen/elevation-picker entirely and disables the globe view mode, Mapterhorn Globe hides every source picker and opens straight into a zoomed-out globe.
- **Elevation Picker** (`5507f7f`) — click-to-sample elevation (3D/globe via `queryTerrainElevation`, 2D via client-side tile fetch/decode), two-point delta, auto-deactivates during TerraDraw drawing modes.
- **Basemap overlays** (`5507f7f`) — role (basemap/overlay) on custom basemap sources, multi-select overlay checklist, stacked rendering, sample overlays (Stadia Watercolor, Waymarked Trails, OpenWeatherMap radar), shared basemap opacity slider.

### Bug Fixes
- **Slope-and-More now supports all source types**, project embed polish, several stale-state fixes (`0853d53`).

# Changelog — Slope Visualization Mode 
<!-- released: 2026-07-08T17:14 -->

#### TL;DR
**Slope visualization mode**: launched as a PlanTopo server-hosted overlay (computed offline from Mapterhorn), upgraded to a client-side "Slope and More" v2: a custom MapLibre protocol computed directly from whichever terrain source is active (BYOD included), rather than PlanTopo's own fixed dataset. Later grew into the full curvature/TPI/roughness/LRM/Tells suite above.

![Slope-angle visualization mode](/docs/screenshots/viz-modes/slope.jpg)

### Features
- **Slope viz mode** (`fd46090`) — a PlanTopo-hosted server overlay (their own precomputed slope-angle raster); upgraded the same day (`542d49f`) to a client-side custom MapLibre protocol computed from whichever terrain source is active ("Slope and More" v2) — the same viz mode that later grew into the full curvature/TPI/roughness/LRM/Tells suite (see the Jul 10–12 entries above).

# Changelog — NextGIS QMS, Photon Geocoder, Animation Pose via URL & TileJSON
<!-- released: 2026-07-07T23:39 -->

#### TL;DR
- **NextGIS QMS search**: search and add basemaps directly from [NextGIS QuickMapServices](https://qms.nextgis.com/) public catalog; 
- Switched search location geocoder to **Photon geocoder**.
- Camera/animation poses are now URL-shareable.
- Added TileJSON data source type
- Added new colorramps CET/SDR ramps 

### Features
- **Camera/animation pose rework** (`3c4b95b`) — URL-shareable camera state (nuqs, deltas between pose1/pose2 rather than compressed absolutes); Home now correctly resets saved poses.
- **NextGIS QMS search** (`a939f7d`, overflow/templating fix `0924c29`) — search and add basemaps directly from NextGIS's public QuickMapServices catalog.
- **More data sources** — TileJSON, CET/SDR ramps, WMS-raw, Photon geocoder.

# Changelog — Light-Direction Spherical Control via XYPad
<!-- released: 2026-02-19T14:24 -->

#### TL;DR
Light-direction control for Hillshade via XYPad: drag a 2D pad to set illumination azimuth/elevation, instead of two separate sliders.

![Dragging the XYPad to set light azimuth/elevation](/docs/screenshots/hillshade-direction.webp)

### Features
- **XYPad for 2D illumination-direction selection** (`ce3077e`) — drag a pad to set Hillshade/Phong light azimuth+elevation together; gained real angular constraints (can't drag past the sun's physically reachable range) five days later (`8f53c63`). The *true* bidirectional datetime binding (drag the pad, back-solve the closest matching day/time; day/night-boundary hatching) came much later — see the Aug 7 entry above (`debeea8`, `09f3803`).

# Changelog — Animation, Video Export & Minimap
<!-- released: 2026-02-19T10:30 -->

#### TL;DR
- **Animation Capabilities**, with keyframe-based (Complete vs Smooth) video export.
- **Video export** tries **MediaBunny** first (real muxed MP4/H.264 via WebCodecs), falling back to raw **WebCodecs** (H.264, no muxing) if MediaBunny throws, then all the way to **MediaRecorder** (WebM) if the browser lacks WebCodecs entirely.
- **Minimap** with main viewport footprint/frustum bbox shown, fully configurable.
- Finer Terrarium quantization (4mm vs. TerrainRGB 10cm) shipped as a High-Precision toggle.

### Features
- **Minimap with footprint and frustum** (`7d30ba7`, preceded by WIP passes `ef7c28f`/`7c88ec3`).
- **Animation Capabilities** (`d2477d1`) — keyframe poses, Complete (interpolates every numeric setting) vs Smooth (camera-only) modes; native share for mobile (`e550416`, `6a0fb68`).
- **Video export overhaul** (`6496178`, superseding earlier attempts `8a88d18`/`14ca0a9`) — three-tier fallback chain: **MediaBunny** (`41b3f1a`) first, a real muxed MP4/H.264 via WebCodecs under the hood, no per-browser codec-support roulette; falls back to raw **WebCodecs** (H.264-ish, no muxing) if MediaBunny itself throws; falls all the way back to **MediaRecorder** (WebM, VP9/VP8) if the browser has no WebCodecs `VideoEncoder` at all. Restored/hardened in July (`f66564a`).
- **High-Precision Elevation Quantization** (`abcc7b9`) — finer Terrarium encoding (3.9mm steps) as an alternative to TerrainRGB (10cm steps) via the Geomatico COG-protocol middleware, with a same-day fix for reset/layer state on high-res-quantized COGs (`69d19ca`).

# Changelog — Drawing Tools via TerraDraw, Sources Samples & Contours Consolidation
<!-- released: 2026-02-18 -->

#### TL;DR
- **Drawing Tools** via TerraDraw: draw shapes, points, and more; import/export geojson features.
- **Load Sample buttons** added to the terrain/basemap source pickers with a variety of nation-wide sources.
- **Contours** reworked and consolidated into their own "Contours & GeoGrid" section.
- Fold/expand-all for every sidebar section, with collapsed state now persisted via jotai atomWithStorage.

### Features
- **TerraDrawSystem** (`f6ea69c`) — the drawing-tools system (shapes, points, GeoJSON import/export), alongside a rework of the main terrain-viewer component; reworked again the next day (`d93a2fc`).
- **Contours reworked** (`2c7dc79`, `e2e3e37`) — restructured into their own "Contours & GeoGrid" section (color pickers/line-weight controls followed later, July 2026 — see above).
- **Fold/expand-all for sidebar sections** (`f5be22c`) — every section's collapsed/expanded state now persists via `atomWithStorage`, alongside a broader foldable-sections rework.
- Custom terrain/basemap samples added to the BYOD modals (`2e937bd`).
- **"Load Sample" buttons** on the terrain/basemap source pickers — likely also originate here (`2e937bd`), though not confirmed by a distinct commit citing that exact label; flagged as unconfirmed rather than guessed further.

# Changelog — BYOD Basemaps & WMS/DTM-DSM Sources
<!-- released: 2026-02-13 -->

#### TL;DR
- **BYOD basemaps** TMS, WMS, COG, finalized as their own custom-source type via custom protocol, alongside the existing BYOD terrain sources.
- **WMS raw-elevation support** (e.g. IGN France) now stream as MapLibre raster-dem via a custom MapLibre protocol. Standalone demo: [maplibre-raster-dem-wms-float32-generic.html](/maplibre-raster-dem-wms-float32-generic.html).
- DTM-DSM LidarHD selector in samples
- Graticule layer
- Share section

### Features
- **BYOD Basemaps finalized** (`0ab0d6e` prepare Feb 2, `671bd0b` finalize Feb 3) — custom basemap sources alongside the existing BYOD terrain-source support from Nov 2025.
- **IGN France WMS raster-DEM example** (`5d6dc9e`) — a real WMS raw-elevation source wired up as a MapLibre raster-dem terrain source.
- **WMS-raw elevation as raster-dem, generalized** (`102bd40`) — generalized the IGN France example above into a reusable **MapLibre custom protocol** (not a one-off fetch/transform) that decodes raw Float32 WMS elevation responses into MapLibre's raster-dem tile format directly. Standalone demo: [maplibre-raster-dem-wms-float32-generic.html](/maplibre-raster-dem-wms-float32-generic.html).
- **Graticule layer** (`adde771`), **Share section** (`6dc1410`), **DTM-DSM LidarHD selector** (`394b143`).
- `TerrainControlPanel` exploded into one-file-per-section sub-components (`7d32a95`) — the sidebar's file structure since.

# Changelog — cpt-city Colorramp Library
<!-- released: 2025-11-18 -->

#### TL;DR
Adding a large open-license colorramp library, [cpt-city](https://phillips.shef.ac.uk/pub/cpt-city/), with classic, topo, topobath, top qgis, and temp groups.

### Features
- **cpt-city colorramp pipeline** (`d154d5c`): a large open-license colorramp library parsed via a new `cpt2js`-based pipeline, a standalone cpt-city archive-parser mini-app to harvest it (`3e146d9`), topobath ramps (`aad2438`), and a further significant expansion (`185670e`).

# Changelog — Geomatico COG Protocol vs. Titiler
<!-- released: 2025-11-14 -->

#### TL;DR
Offer the choice to stream COG via **Geomatico's native MapLibre COG-protocol vs. Titiler**. The direct client protocol avoids Titiler's rate limiting and is faster (no middleware hop), but is less permissive: it only reads COGs already in Web Mercator (EPSG:3857), where Titiler can reproject on the fly server-side.

### Features
- **Geomatico COG Protocol introduced alongside Titiler** (`bfa9d11`, toggle `0d2a8a4`). Direct client-side COG consumption as an alternative to the Titiler middleware: no server-side hop means no Titiler rate-limiting and lower latency, at the cost of only handling COGs already tiled in Web Mercator (EPSG:3857) — Titiler can reproject arbitrary source CRS on the fly, this can't. The toggle between them (`useCogProtocolVsTitiler`) is still in Settings → Streaming today.

# Changelog — BYOD (Bring Your Own Data) Terrain Sources
<!-- released: 2025-11-07 -->

#### TL;DR
**Bring Your Own Data (BYOD) Terrain** sources let users import their own TMS, COG remote endpoint terrain sources.

### Features
- **BYOD (Bring Your Own Data) terrain sources** (`f24c1bc`): the initial scaffold's `terrain-types.ts` already had a placeholder `"custom"` encoding value, but the real user-facing feature (Add Custom Terrain Source modal, wiring it up like any other source) landed 3 days later, in `f24c1bc`.

# Changelog — Initial Launch, Viz Modes, Shareable URLs & Split Mode
<!-- released: 2025-11-04 -->

#### TL;DR
- **Initial launch** with all user-controls on one foldable, sidebar control panel. UI transparency on slider change enables better-feedback, 2D/3D/Globe map projection modes.
- **Terrain visualization modes**: Hillshade (Combined, Standard, Aspect Multidir colors, Igor, Basic), Hypsometric color-relief, Raster Basemap
- **Sources for Terrain** (Terrarium /TerrainRGB): [Mapterhorn](https://mapterhorn.com/), [Mapbox](https://www.mapbox.com/), [Maptiler](https://www.maptiler.com/). [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
- Source for Raster Basemaps: [Google](https://mapsplatform.google.com/), [Bing](https://www.bing.com/maps/aerial), [ESRI](https://www.esri.com/en-us/arcgis/products/arcgis-image/services/world-imagery), [Mapbox](https://www.mapbox.com/), [Here](https://www.here.com/), [OSM](https://www.openstreetmap.org/)
- **Shareable URLs**, State persisted to URL via nuqs so any shared url results in visually the exact same map.
- **Split Mode**: A/B side-by-side comparison, originally built for comparing the same location's resolution/quality across different terrain sources (Mapterhorn vs. Mapbox/MapLibre terrain-RGB vs. AWS Terrain Tiles).

### Features
- **Initial launch** (`29ced9e`, `1e12655`, `535bb2a`, `c4d067f`) — the app's first version already had Hillshade, hypsometric tint (color-relief), a raster basemap, split-screen A/B comparison, and a UI-transparency option, all driven from the sidebar control panel (`components/terrain-controls.tsx`, `components/terrain-viewer.tsx`, `components/ui/sidebar.tsx`) — contours were present too, stabilized two days later (`069570e`).
- **Split Mode (A/B side-by-side comparison)** — built to compare the same location across different terrain sources at various resolutions/qualities (e.g. Mapterhorn vs. Mapbox/MapLibre terrain-RGB vs. AWS Terrain Tiles), not just different imagery. The later Overlay (blend-mode compositing) and Grid (up to 8 views) shapes both grew out of this original two-way split — see July/August 2026 above.
