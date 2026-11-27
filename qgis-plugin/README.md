# QGIS plugins

Two plugins live here:

- **`terrain_viewer/`**, Terrain Viewer's modes as QGIS layers (below). MIT,
  as the rest of the repository.
- **`send2map_app/`**, "Open in": the place shown or clicked in QGIS opened in
  Terrain Viewer, Google Earth, Bing Maps 3D, ShadeMap and the other
  destinations of the web app's "Open in" list. It descends from NextGIS's
  Send2GE (`send2google_earth`) and keeps its licence, GPL v2 or later; see
  [its README](send2map_app/README.md) for the lineage and the destinations.

Both support QGIS 3 and QGIS 4 (Qt 5 and Qt 6), and are checked headless in
both (see Files).

## Terrain Viewer

0.12.0 in the repository, 0.11.0 released ([the docs](../docs/content/docs/dev/qgis-plugin.mdx)): a dock panel with the app's two modes
at its top. 0.12.0: Freeze writes every parameter on its copies, a setup is
saved to a folder and loaded back, the app's Vector library adds its entries
as QGIS layers, and the plugin is no longer marked experimental. 0.11.0: the Temporal Controller's default step is one week, the
backend control shows on the Historical page while a source needs a tile
server, and the building shadows take their buildings from any vector source
with heights or a polygon layer of the project ([below](#building-shadows-buildings-from)). **Historical** (a clock, new in 0.10.0; its own toolbar button
since 0.10.1): dated imagery, its dates as steps of QGIS's Temporal
Controller ([below](#historical-mode)).
**Terrain**: the groups of the app's sidebar as one modes tree, drawn by the backend
picked at its top (radio buttons): the **Python backend** (numpy in QGIS, no
service, started when picked; every mode, from tile pyramids, COGs, VRTs, raw
WMS and WCS, QGIS raster layers and anything GDAL opens; the default for a new
user), the **Packaged tile server** (a [tile service](../tile-server/README.md)
packaged for QGIS, installed and started from the panel), or a **Remote tile
server** (any tile service's address). Pure Python on QGIS's API, no
dependency; QGIS 3.28 and later, QGIS 4 (Qt 6) included.

## Install

0.12.0 is in the repository, 0.11.0 is the released version.

**From the plugin repository (preferred: QGIS then updates the plugins by
itself).** Once, in Plugins > Manage and Install Plugins > Settings: under
Plugin Repositories press Add, name it (Terrain Viewer), give the URL

```text
https://github.com/Iconem/terrain-viewer/releases/download/qgis-plugins-repository/plugins.xml
```

and tick "Check for Updates on Startup". Then install Terrain Viewer (author:
Iconem) and Send2MapApp from the All tab; new versions show under
Upgradeable. Or, for the Add step, one line in QGIS's Python console
(Plugins > Python Console), checked in QGIS 4.2 and 3.44:

```python
from qgis.core import QgsSettings; import pyplugin_installer; QgsSettings().setValue("app/plugin_repositories/Terrain Viewer/url", "https://github.com/Iconem/terrain-viewer/releases/download/qgis-plugins-repository/plugins.xml"); pyplugin_installer.instance().reloadAndExportData()
```

No link can do it: QGIS registers no URL scheme and no file type that adds a
repository or installs a plugin. Two cautions:

- While 0.11.0 is the released version, also tick "Show also Experimental
  Plugins" (QGIS 4 hides 0.11.0 otherwise). 0.12.0 is `experimental=False`
  and needs no tick; `plugins.xml` takes the flag from `metadata.txt`.
- plugins.qgis.org lists an unrelated plugin (Terrain Viewer by LiDARgeek,
  1.3.1, QGIS 3.40 to 3.99) with the same folder name, `terrain_viewer`. QGIS
  keys plugins by folder name across repositories: in QGIS 3.40 to 3.x the
  Plugin Manager can show that one in place of this one, or offer it as an
  upgrade. Check the author (Iconem) before installing or upgrading there;
  the panel's own Update button reads this project's `plugins.xml` alone.
  QGIS 4 is not concerned.

**From a zip.** The zips of each version are on a release: [`qgis-plugins-2026-11-26f`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-26f)
(Terrain Viewer 0.11.0, Send2MapApp 0.5.1, the tile service bundles it pins, and `plugins.xml`). Terrain Viewer is one plain zip,
pure Python. It needs a tile service: the Terrain Viewer desktop app's (with
Settings > Desktop: local tile service on, `http://localhost:3400`), a local
or hosted one, or one installed from the panel: **Install** downloads this
platform's tile service bundle (Node and the service, about 48 MB) from the
release that `terrain_viewer/service_pins.json` pins, checks its sha256 and
unpacks it into the plugin's data folder; with **Packaged tile server** picked,
Connect installs it the first time and starts it on 127.0.0.1, picking another
backend or quitting QGIS stops it. No browser engine (flat, north-up tiles only, what
QGIS asks for). See [the docs](../docs/content/docs/dev/qgis-plugin.mdx#the-local-tile-service-installed-from-the-panel).
To build them:

```bash
python make_zip.py                              # dist/terrain_viewer-<version>.zip and dist/send2map_app-<version>.zip
python make_zip.py --service-bundle [platform]  # dist/terrain-viewer-tile-service-<platform>.zip, all four when none is named
python make_zip.py --pins <release-tag> dist    # terrain_viewer/service_pins.json from those bundles
python make_zip.py --plugins-xml <release-tag>  # dist/plugins.xml, the QGIS plugin repository of that release (after the zips)
```

`.github/workflows/qgis-plugins.yml` builds the bundles on demand, starts
each platform's service on its own runner, and with a release tag attaches
them, pins their hashes into the plain zip it then builds, and attaches that
too, with `service_pins.json` (commit it back) and `plugins.xml`, which it also
copies to the fixed release `qgis-plugins-repository`.

## Updates

No plugins.qgis.org (it requires an email in `metadata.txt`, which the project
does not publish): two ways from the GitHub releases instead.

- **Plugin repository** (added as under Install): QGIS lists both plugins
  and offers their updates. The address is a fixed
  release whose `plugins.xml` each release replaces: nothing to change after
  a release. QGIS 3.44 and 4.2 have no interval to set: at start, when the
  last check is three days old or more, and whenever the Plugin Manager is
  opened. The Upgradeable tab shows only while an installed plugin has a
  newer version in an enabled repository (hidden otherwise). `plugins.xml` keys each plugin by `file_name` up to the
  first dot (`terrain_viewer.0.9.0.zip`), downloads `download_url` (the dated
  release's zip), and carries a `sha256` element of ours.
- **The panel**: once a day it reads the same `plugins.xml` in the background
  (`terrain_viewer/updates.py`); a newer version shows "Update to x.y.z":
  downloaded, sha256 checked, unpacked over the plugin's folder, the plugin
  reloaded. Never over a development copy (a link, a folder in a git
  checkout). Off with the QGIS setting `terrain_viewer/checkUpdates=false`.

In QGIS: Plugins > Manage and Install Plugins > Install from ZIP. Or, while
working on it, link the folder into the profile's plugins folder (Windows:
`%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\terrain_viewer`; QGIS 4
uses `QGIS4`), then enable it in the plugin manager. `send2map_app` installs
the same way, and replaces an earlier Send2MapApp in place (same folder name).

Without any tile service, the **Python** backend draws all 25 of the tree's
modes computed in QGIS with numpy.

## Use

- **Backend** (top of the panel): Python backend (the default for a new
  user), Packaged tile server or Remote tile server, each with its options; **Connect** (the two tile servers; the
  Python backend starts when picked) asks `/health` first (one message when
  nothing answers, no layer made). Picking another backend re-points the
  checked modes' layers to it.
- **The tree** comes from the service's `/processes` (each mode as an OGC
  API Processes description), or from `terrain_viewer/assets/catalog.json` (a
  snapshot made by `make_assets.py`) before a service answers and for the
  Python backend. Under Python, the modes and settings it does not handle are
  greyed out, and only the forms it makes show.
- **A mode's row**: a click anywhere on it toggles the mode; its forms on the
  right, **Color** (an XYZ layer), **Values** (a Float32 raster from
  `/gdal.xml`, for analysis) and, for the overlays, **Vector** (the default)
  then **Raster**, and its opacity (a short slider between the name and the
  forms). Unchecking the last form removes the layers (every layer of the
  mode's key) and the groups left empty. The cog folds out the settings: sliders with number boxes, ramp and matcap selects with
  previews (`assets/colorramps.png`, `assets/matcaps.png`), symmetric ramps
  whose minimum mirrors the maximum. A changed setting rewrites the layer's
  address (half a second after the last change), keeping its style.
- **Basemap**, a row of the tree under Elevation Hypso (0.9.3): its checkbox
  adds or removes one XYZ layer under every mode, its opacity in the row, and
  under the cog its source, one of the app's built-in basemaps (Google Hybrid,
  Bing Aerial, ESRI World Imagery by default, Google Satellite; Mapbox,
  MapTiler and HERE once their key is set). Every backend; Open link drives
  the same row.
- **Light** (open): a pad and two sliders for the light of hillshade,
  Phong, terrain and building shadows (`illuminationDir`, `illuminationAlt`).
- **Source**, in groups (QGIS elevation layers, Worldwide defaults, Terrain
  library), with a zoom to its bounds and a button that adds a library COG,
  VRT or raw WMS as a QGIS layer ("Raw elevation inputs", kept under the modes,
  its grey stretched to the view: above them it hid a hillshade, 0.9.2); **API keys** behind a key icon
  (Mapbox, MapTiler, HERE, Google, Cesium ion, in QGIS's settings
  `terrain_viewer/<key>`): the three the service reads go into every layer's
  address, Mapbox and MapTiler serve the Python backend.
- **Open link**: a share link (any address, the desktop app's `views://...`
  too) or its bare query, read as the app reads it: a parameter it leaves out
  takes the app's default (`showTerrainAnalysis=true` alone is the slope);
  its modes, settings, opacities, source, light and camera (an extent in the
  project's CRS), and with `showRasterBasemap=true` the view's basemap
  through the Basemap row. Only the parameters some mode takes go into the
  addresses (not `splitRatio` or the camera).
- **Freeze** copies the layers drawn now into a dated group under the live
  one, which the panel never changes. 0.12.0: each copy carries its
  parameters (custom properties `terrain_viewer/params`, `terrain_viewer/link`;
  its abstract and metadata, shown when the layer is hovered and under Layer
  Properties > Information), and the menu on the button's arrow keeps a setup
  outside the project:
  - **Save setup to folder...**: a new dated subfolder (never over an earlier
    one) with `setup.json` (the setup as an app link, the format the web app
    and Open link read, plus the panel's own: backend, source, light, each
    mode's forms, opacity and every setting; no API key), `layers.qlr` (the
    layers as plain layers, for any project) and `vectors.gpkg` (the Python
    backend's lines and areas, which live in memory).
  - **Save setup and GeoTIFFs to folder...**: the same, with each raster
    layer for the map's extent at the map's pixel size (4096 px at most) in
    `rasters/`: Color forms as RGBA, Values forms as Float32, read through the
    layer's own provider, so with every backend.
  - **Load setup...**: a `setup.json` read back into the panel.
  A frozen or `.qlr` layer still asks its backend for tiles (frozen settings,
  not frozen pixels: the GeoTIFFs are the pixels), and its address holds a
  keyed source's key, as in a saved project.
- **Vector library** (0.12.0, folded): the app's vector overlays (buildings,
  heritage, land cover, a roads and labels reference) added as QGIS layers of
  their own in "Vector overlays (library)", colored by their categories, with
  their attribution: vector tile layers for `{z}/{x}/{y}` templates, TileJSON
  and a MapLibre style (imported by QGIS, cut to lines and labels), vector
  layers through GDAL for GeoJSON and for PMTiles over https (QGIS's own
  vector tile layer opens PMTiles from disk only), and for Overture's
  archives, whose host refuses GDAL's requests (HTTP 400), vector tiles from
  the plugin's own 127.0.0.1 server (`/pmtiles/{z}/{x}/{y}.pbf`, read by
  `live/pmtiles.py`; drawn while the panel is open). The panel does not
  change them afterwards. All 14 entries open and draw in QGIS 4.2 and 3.44
  (`test_overlays_live.py`).
- A saved project reopens with its layers; on Connect the panel reads their
  addresses back into its checkboxes and settings.

## Historical mode

The app's `appMode=historical` (0.10.0, extended in 0.10.1). The switch at
the top of the panel shows its page instead of the terrain one, and a second
button on the Web toolbar (a clock) opens the panel straight in it. The
layers of either mode stay in the project: dated imagery under a hillshade
is one picture.

- **Imagery**: a historical source, or one of the worldwide default basemaps
  (no dates: the Basemap row draws it).

  | Source | Dates | Needs |
  |---|---|---|
  | Esri World Imagery Wayback | The real capture dates at the map's centre | Nothing |
  | Google Earth historical | Every dated capture at the map's centre | A tile server backend connected (Packaged or Remote, a service from 2026-11-26 on), from this page since 0.11.0 |
  | Planet monthly, Planet quarterly | Every mosaic, computed as the app does (2020-01 on; 2016 Q1 on) | A Planet key (**API keys**, folded, on the page) |
  | NASA HLS | A monthly cadence from 2016, not captures at the place | Nothing (a public demonstration server) |
  | EOX Sentinel-2 cloudless | One mosaic a year, 2016 to 2025 | Nothing |

  A source that waits for a key is greyed out with its reason.
- **Where the tiles come from** (one line under the select): the providers'
  own XYZ addresses, read by QGIS itself; those sources need no backend and
  say so. Google Earth historical is the exception: its tiles are not Web
  Mercator, so a tile server lists its dates and reprojects its tiles
  (`/imagery-dates/ge-historical`, `/basemap-tiles/ge-historical`).
- **The backend control on the page** (0.11.0): while Google Earth
  historical is picked, the panel's backend control (the three radio
  buttons, Connect, the status line) shows under the select. It is the
  Terrain page's own widget, moved: one setting, one connection, one tile
  server. Esri Wayback is not routed through a tile server: 12 s against 15
  to 29 s for a first listing, but no dates arriving one by one, no release
  to read tiles from, and a requirement more.
- **The dates** at the map's centre: a list (newest first), ticks on a time
  axis (each at its date; a click picks the nearest), previous and next, the
  current date with who took it and at what resolution.
- **Esri Wayback's listing** runs in a worker thread: the catalog, about 25
  tilemap requests that keep the 10 to 30 releases whose imagery changed at
  the place (of some 200), then one metadata query per kept release, six at
  a time. Measured at the Eiffel Tower: the first date after 5 s, all nine
  after 25 s. The dates are added to the list, the axis and the layer group
  as they answer, the releases that can hold the date asked for first; what
  was found is kept between sessions (`<profile>/terrain_viewer/wayback-dates.json`),
  so a place seen before costs one request (under a second).
- **Notices** above the dates: *the map moved: these dates are of the
  previous place, updating (3 of 14 releases dated)* after a pan or a zoom
  to another tile (the layers on screen stay until the new list is whole);
  *zoom in to see the capture dates* when the view is too wide (Esri Wayback
  dates a place from zoom 10 on, with the scale that is here; until then the
  newest release alone).
- **QGIS's Temporal Controller**: every date is one XYZ layer of the group
  "Historical imagery", named with its true date, with a fixed temporal
  range (its true capture date until the next capture's; a mosaic's month,
  quarter or year). The **Temporal Controller** button shows QGIS's panel,
  and **step** picks how its slider divides time:
  - **Day, week (the default since 0.11.0), month, year**: frames of equal
    duration from the start of the first date's, so the slider's position
    is the date. Each frame draws the latest capture at or before its end;
    most frames change nothing, as time passes between captures (14 years:
    5600 days, 800 weeks, 187 months, 16 years), and two captures within
    one frame share it, the newer drawn. A line under the dates says both:
    "Controller: week of 2019-06-03. Imagery: captured 2018-09-11, the
    latest at or before it."
  - **Source timestamps** (0.10.1's default): one stop per date
    (`setAvailableTemporalRanges`, a frame of one `IrregularStep`). Every
    step changes the imagery and the controller's date is the capture's;
    the stops are evenly spaced, whatever the time between them.
  With the controller turned off, the date's layer alone is checked.
- **Open link** reads a link in the app's historical mode (`appMode=historical`,
  `historicalActiveSourceA`, `dateA`).
- **Not yet**: the national series, the STAC catalogs, source coverage, a
  second view.

## Building shadows: Buildings from

0.11.0. Under the Building shadows row's cog, with every backend:

- **Library**: the app's vector sources with heights (OpenStreetMap
  buildings from OpenFreeMap, the default; Overture Maps buildings, a
  PMTiles archive; the others of `lib/custom-sources.json`).
- **Custom address**: a PMTiles archive, a TileJSON or a `{z}/{x}/{y}`
  vector tile template, with its layer and its height field.
- **QGIS layer**: any polygon layer of the project, with its height field,
  metres per unit (3.2 for floors) and a height for the buildings without
  one, or one height for all.

A QGIS layer is written to a GeoJSON in the profile
(`terrain_viewer/buildings/`): the Python backend burns it as it burns a
tile's buildings, a tile server on this machine reads it once registered
(`POST /files`, `buildingShadowSource=file:<id>`; a service that answers
`/building-sources`). A layer over 50 000 features is read for the map's extent. PMTiles are
read in plain Python (`live/pmtiles.py`). The tile service's side:
[its docs](../docs/content/docs/dev/tile-service.mdx#building-shadows-where-the-buildings-come-from).

## Files

| File | Role |
|---|---|
| `terrain_viewer/service.py` | The service's catalogs and the tile addresses (no widget) |
| `terrain_viewer/layers.py` | The layers in the project: the group tree, creation, address rewrite, opacity, blend, vector tile style |
| `terrain_viewer/dock.py` | The panel: the backends, the tree, the rows |
| `terrain_viewer/widgets.py`, `settings_ui.py` | The slider with its box, the light pad, the selects with previews, the foldable section, the backend buttons; the slider ranges and symmetric pairs by parameter name |
| `terrain_viewer/python_backend.py` | The Python backend under the tree: the service's modes, settings and sources mapped onto `live/` |
| `terrain_viewer/assets.py`, `assets/`, `make_assets.py` | The ramp and matcap previews (sprite sheets) and the catalog snapshot, made from a running tile service: `python make_assets.py [http://localhost:3400]` |
| `terrain_viewer/links.py`, `assets/app_defaults.json`, `make_app_defaults.py` | An app link read as the app reads it (its defaults for what it leaves out, the basemap), the Basemap row's choices and the Library's building sources: the defaults, built-in basemaps and vector sources with heights from `docs/src/generated/url-params.json`, `lib/basemap-sources.ts` and `lib/custom-sources.json`, `python make_app_defaults.py` |
| `terrain_viewer/historical.py`, `historical_ui.py`, `clock.svg`, `fixtures/wayback_paris.json`, `fixtures/ge_dates_paris.json` | The Historical mode: the dated sources with no QGIS import (Esri Wayback's catalog, walk and capture dates, Google Earth's dates from a tile service, Planet's and HLS's months, EOX's years; a port of `lib/wayback.ts`, `lib/planet.ts`, `lib/hls.ts` and `lib/dated-imagery.ts`), and its panel (the layers with their temporal ranges, QGIS's temporal navigation and its step, the frame line, the backend control when a source needs it, the notices, the Planet key); a recorded Wayback session and a tile service's Google Earth answer at the Eiffel Tower for the offline tests |
| `test_panel_units.py` | No service, no network: slider ranges, links, the Python mapping, the assets, the light pad, the panel's order and backends, the source groups, the labels, the Basemap row, the raw inputs under the modes, the Historical mode (`panel_historical_checks.py`, run by it: a recorded Wayback session, the temporal navigation, the Temporal Controller's slider and its steps, the notices, Planet and HLS against the app's TypeScript, Google Earth from a recorded answer, the toolbar buttons, a layer's symbology playing no part in the elevation), plugins.xml and an update installed: `QT_QPA_PLATFORM=offscreen python-qgis test_panel_units.py` |
| `test_sources.py` | Network: the library's raw elevation read by the Python backend (NRCan's COG, IGN's raw WMS, a WCS, an ArcGIS image service), the panel drawing them and never Mapterhorn in their place, the raw inputs as QGIS layers, what a tile of NRCan's 84 GB COG reads and its hillshade drawn over the raw layer, Esri Wayback's dates at the Eiffel Tower (how long, one by one, again from the kept file) and a tile of two of them, an EOX tile, an HLS tile, Google Earth's dates and two tiles through a tile service (`TERRAIN_VIEWER_SERVICE=http://localhost:3400`), Planet with `PLANET_API_KEY`: `QT_QPA_PLATFORM=offscreen python-qgis test_sources.py` |
| `test_app_window.py` | Inside the QGIS application itself, offscreen, in a throwaway profile (`qgis --code test_app_window.py`, see its header): the two toolbar buttons, the clock opening the Historical mode, the Temporal Controller button showing QGIS's own panel |
| `terrain_viewer/buildings_ui.py`, `live/buildings.py`, `live/pmtiles.py`, `panel_buildings_checks.py`, `test_buildings_live.py` | The building shadows' buildings: the "Buildings from" choice (the Library's sources, an address, a polygon layer written as GeoJSON), the footprints read from vector tiles (TileJSON, MVT template, PMTiles in plain Python) or from that file and burnt with their heights; offline checks (run by `test_panel_units.py`: an archive written by the test, the choice, a layer written and burnt) and the network ones (both backends compared tile by tile): `TERRAIN_VIEWER_SERVICE=http://localhost:3400 QT_QPA_PLATFORM=offscreen python-qgis test_buildings_live.py` |
| `test_temporal_live.py` | Network: the Temporal Controller under the default week step with Esri Wayback and, through a tile service connected from the Historical page, Google Earth historical: the capture named and drawn at a sample of frames, the picture changing with the capture: `TERRAIN_VIEWER_SERVICE=http://localhost:3400 QT_QPA_PLATFORM=offscreen python-qgis test_temporal_live.py` |
| `terrain_viewer/setups.py`, `panel_setup_checks.py`, `test_setup_live.py` | A setup kept (0.12.0): the panel's state as an app link and the panel's own, a frozen layer's parameters written on it, Save setup to a folder (`setup.json`, `layers.qlr`, `vectors.gpkg`, GeoTIFFs), Load setup; offline checks (run by `test_panel_units.py`) and, network, a setup of the Python backend saved with its GeoTIFFs and reopened: `QT_QPA_PLATFORM=offscreen python-qgis test_setup_live.py` |
| `terrain_viewer/vector_library.py`, `panel_overlay_checks.py`, `test_overlays_live.py` | The app's Vector library as QGIS layers (0.12.0): which layer each entry becomes, its categories as QGIS rules, its attribution; offline checks (run by `test_panel_units.py`) and, network, every entry added and drawn: `QT_QPA_PLATFORM=offscreen python-qgis test_overlays_live.py` |
| `terrain_viewer/updates.py` | Updates: `plugins.xml` read, a zip checked and unpacked over the plugin (the panel's Update button) |
| `terrain_viewer/local_server.py` | The local tile service (installed, or a `server/` folder): started on 127.0.0.1, stopped on unload or when QGIS goes |
| `terrain_viewer/service_install.py`, `service_pins.json` | The **Install** button: the pinned bundle downloaded through QGIS's network manager, its sha256 checked, unpacked into the plugin's data folder; **Remove** |
| `terrain_viewer/plugin.py`, `__init__.py`, `metadata.txt`, `icon.svg` | The QGIS plugin around it |
| `send2map_app/` | The "Open in" plugin: `destinations.py` (the URL builders, no QGIS import), `send2map_apptool.py` (the canvas as a camera, the map tool, opening a URL or a KML), `send2map_app.py` (toolbar, Web menu, canvas right-click menu) |
| `make_zip.py` | The installable zips, the tile service bundles (`--service-bundle`), their pins (`--pins`) and the plugin repository (`--plugins-xml`) |
| `test_plugin.py` | A headless check of `terrain_viewer` against a running service: `QT_QPA_PLATFORM=offscreen python-qgis test_plugin.py http://localhost:3400 out/` (on Windows, `python-qgis.bat` in QGIS's `bin`; `python-qgis-ltr.bat` for an LTR) |
| `test_service_paths.py` | The plain zip unzipped into a temporary plugins folder and driven through the panel in headless QGIS: `installed` (Install from a bundle served locally, or the real pinned download; a tampered download refused; Connect, a slope tile, the unresponsive warnings, Remove) or `external` (an address, the desktop app's): `QT_QPA_PLATFORM=offscreen python-qgis test_service_paths.py installed dist/terrain_viewer-<version>.zip [dist/terrain-viewer-tile-service-windows-x64.zip]`, or `... external dist/terrain_viewer-<version>.zip http://localhost:3400 [--stop "<command>"]` |
| `smoke_bundled.py` | A service bundle started without QGIS (the build runners): `python -I smoke_bundled.py dist/terrain-viewer-tile-service-<platform>.zip` |
| `terrain_viewer/live/`, `test_live.py`, `bench_live.py`, `bench_canvas.py`, `live_reference.mjs` | Experimental (the **Python** backend): 16 modes computed with numpy in QGIS (`live/modes.py`; the matcap pictures `live/textures.py`), served from a localhost thread as colored XYZ tiles (Color) and Float32 tiles GDAL reads (Values: QGIS's color ramps, Identify); contour lines as a vector layer for the view (`live/contours.py`). `test_live.py [--service <url>]` scores each mode against the app's kernels in Node, the tile service and gdaldem, and draws every form; `bench_live.py` times the kernels, `bench_canvas.py` a 1920x1080 canvas. Findings: [QGIS Live Compute](../docs/content/docs/dev/qgis-live-compute.mdx) |
| `test_send2map.py` | A headless check of `send2map_app`, no network: `QT_QPA_PLATFORM=offscreen python-qgis test_send2map.py` |
| `test_open_in.py`, `open_in_reference.mjs` | `send2map_app`'s destinations against the web app's (`open-in-links.tsx`, evaluated by Node): `python test_open_in.py`, no QGIS |

Not published on plugins.qgis.org, which requires an `email` in `metadata.txt`: updates come from the project's own plugin repository (above).
