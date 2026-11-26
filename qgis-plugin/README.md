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

0.10.0 ([the docs](../docs/content/docs/dev/qgis-plugin.mdx); in the
repository, the released zip is 0.9.3): a dock panel with the app's two modes
at its top. **Historical** (a clock, new in 0.10.0): dated imagery, its dates
as steps of QGIS's Temporal Controller ([below](#historical-mode)).
**Terrain**: the groups of the app's sidebar as one modes tree, drawn by the backend
picked at its top (radio buttons): the **Python backend** (numpy in QGIS, no
service, started when picked; every mode, from tile pyramids, COGs, VRTs, raw
WMS and WCS, QGIS raster layers and anything GDAL opens; the default for a new
user), the **Packaged tile server** (a [tile service](../tile-server/README.md)
packaged for QGIS, installed and started from the panel), or a **Remote tile
server** (any tile service's address). Pure Python on QGIS's API, no
dependency; QGIS 3.28 and later, QGIS 4 (Qt 6) included.

## Install

The zips of each version are on a release: [`qgis-plugins-2026-11-26d`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-26d)
(Terrain Viewer 0.9.3, Send2MapApp 0.5.1, the tile service bundles it pins, and `plugins.xml`). Terrain Viewer is one plain zip,
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

- **Plugin repository**: in Plugins > Manage and Install Plugins > Settings,
  Add `https://github.com/Iconem/terrain-viewer/releases/download/qgis-plugins-repository/plugins.xml`
  and tick "Show also experimental plugins". QGIS then lists both plugins and
  offers their updates. `plugins.xml` keys each plugin by `file_name` up to the
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
  one, which the panel never changes.
- A saved project reopens with its layers; on Connect the panel reads their
  addresses back into its checkboxes and settings.

## Historical mode

The app's `appMode=historical`, a first version (0.10.0). The switch at the
top of the panel shows its page instead of the terrain one (the layers of
either mode stay in the project: dated imagery under a hillshade is one
picture).

- **Imagery**: a historical source, **Esri World Imagery Wayback** (the real
  capture dates at the map's centre) or **EOX Sentinel-2 cloudless** (one
  mosaic a year, 2016 to 2025), or one of the worldwide default basemaps (no
  dates: the Basemap row draws it). No key, no tile service: the tiles come
  from the providers, under every backend.
- **The dates** at the map's centre: a list (newest first), ticks on a time
  axis (each at its date; a click picks the nearest), previous and next, the
  current date with who took it and at what resolution. Wayback's are listed
  in a worker thread as Esri answers (the catalog, about 25 tilemap requests,
  then one metadata query per release: 5 to 50 s in all); **Follow the map**
  lists them again when the centre moves to another tile. Zoomed out past
  zoom 10, the newest release alone.
- **QGIS's Temporal Controller**: every date is one XYZ layer of the group
  "Historical imagery" with a fixed temporal range (its capture until the
  next one; a yearly mosaic's year), and the panel sets the controller to
  animated navigation with the step **source timestamps**
  (`QgsTemporalNavigationObject.setAvailableTemporalRanges`, a frame duration
  of one `IrregularStep`): its slider has one stop per real date, stepping or
  playing it swaps the imagery, and the panel follows; picking a date in the
  panel moves the slider. The slider's stops are evenly spaced (QGIS draws no
  tick at a date's place in time: the panel's axis does). With the
  controller turned off, the date's layer alone is checked.
- **Open link** reads a link in the app's historical mode (`appMode=historical`,
  `historicalActiveSourceA`, `dateA`).
- **Not yet**: Google Earth historical (the app's own `gehist://` scheme),
  Planet (a key the panel does not hold), NASA HLS (a monthly cadence, not
  captures), the national series, the STAC catalogs, source coverage, a
  second view. No tile service lists dates, and its `/basemap-tiles` draws
  dated imagery with the browser engine only, which the packaged one lacks.

## Files

| File | Role |
|---|---|
| `terrain_viewer/service.py` | The service's catalogs and the tile addresses (no widget) |
| `terrain_viewer/layers.py` | The layers in the project: the group tree, creation, address rewrite, opacity, blend, vector tile style |
| `terrain_viewer/dock.py` | The panel: the backends, the tree, the rows |
| `terrain_viewer/widgets.py`, `settings_ui.py` | The slider with its box, the light pad, the selects with previews, the foldable section, the backend buttons; the slider ranges and symmetric pairs by parameter name |
| `terrain_viewer/python_backend.py` | The Python backend under the tree: the service's modes, settings and sources mapped onto `live/` |
| `terrain_viewer/assets.py`, `assets/`, `make_assets.py` | The ramp and matcap previews (sprite sheets) and the catalog snapshot, made from a running tile service: `python make_assets.py [http://localhost:3400]` |
| `terrain_viewer/links.py`, `assets/app_defaults.json`, `make_app_defaults.py` | An app link read as the app reads it (its defaults for what it leaves out, the basemap) and the Basemap row's choices: the defaults and built-in basemaps from `docs/src/generated/url-params.json` and `lib/basemap-sources.ts`, `python make_app_defaults.py` |
| `terrain_viewer/historical.py`, `historical_ui.py`, `clock.svg`, `fixtures/wayback_paris.json` | The Historical mode: the dated sources with no QGIS import (Esri Wayback's catalog, walk and capture dates, EOX's years; a port of `lib/wayback.ts` and `lib/dated-imagery.ts`), and its panel (the layers with their temporal ranges, QGIS's temporal navigation); a recorded Wayback session at the Eiffel Tower for the offline tests |
| `test_panel_units.py` | No service, no network: slider ranges, links, the Python mapping, the assets, the light pad, the panel's order and backends, the source groups, the labels, the Basemap row, the raw inputs under the modes, the Historical mode (a recorded Wayback session, the temporal navigation and the Temporal Controller's slider), plugins.xml and an update installed: `QT_QPA_PLATFORM=offscreen python-qgis test_panel_units.py` |
| `test_sources.py` | Network: the library's raw elevation read by the Python backend (NRCan's COG, IGN's raw WMS, a WCS, an ArcGIS image service), the panel drawing them and never Mapterhorn in their place, the raw inputs as QGIS layers, what a tile of NRCan's 84 GB COG reads and its hillshade drawn over the raw layer, Esri Wayback's dates at the Eiffel Tower and a tile of two of them, an EOX tile: `QT_QPA_PLATFORM=offscreen python-qgis test_sources.py` |
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
