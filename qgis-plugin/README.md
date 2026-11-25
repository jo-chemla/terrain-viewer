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

0.8.0 ([the docs](../docs/content/docs/dev/qgis-plugin.mdx)): a dock panel
with the groups of the app's sidebar as one modes tree, drawn by the backend
picked at its top (radio buttons): the **Packaged tile server** (a [tile service](../tile-server/README.md)
packaged for QGIS, installed and started from the panel), a **Remote tile
server** (any tile service's address), or the **Python backend** (experimental: numpy in
QGIS, no service, started when picked; the modes it does not compute greyed out). Pure Python on
QGIS's API, no dependency; QGIS 3.28 and later, QGIS 4 (Qt 6) included.

## Install

The zips of each version are on a release: [`qgis-plugins-2026-11-25f`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-25f)
(Terrain Viewer 0.8.0, Send2MapApp 0.5.1, and the tile service bundles it pins). Terrain Viewer is one plain zip,
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
```

`.github/workflows/qgis-plugins.yml` builds the bundles on demand, starts
each platform's service on its own runner, and with a release tag attaches
them, pins their hashes into the plain zip it then builds, and attaches that
too, with `service_pins.json` (commit it back).

In QGIS: Plugins > Manage and Install Plugins > Install from ZIP. Or, while
working on it, link the folder into the profile's plugins folder (Windows:
`%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\terrain_viewer`; QGIS 4
uses `QGIS4`), then enable it in the plugin manager. `send2map_app` installs
the same way, and replaces an earlier Send2MapApp in place (same folder name).

Without any tile service, the experimental **Python** backend draws 24 of
the tree's 25 modes computed in QGIS with numpy.

## Use

- **Backend** (top of the panel): Packaged tile server, Remote tile server or
  Python backend, each with its options; **Connect** (the two tile servers; the
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
  then **Raster**. Unchecking the last form removes the layers (every layer
  of the mode's key) and the groups left empty. The cog folds out the opacity
  and settings: sliders with number boxes, ramp and matcap selects with
  previews (`assets/colorramps.png`, `assets/matcaps.png`), symmetric ramps
  whose minimum mirrors the maximum. A changed setting rewrites the layer's
  address (half a second after the last change), keeping its style.
- **Light** (folded): a pad and two sliders for the light of hillshade,
  Phong, terrain and building shadows (`illuminationDir`, `illuminationAlt`).
- **Source**, with a zoom to its bounds; **API keys** behind a key icon
  (Mapbox, MapTiler, HERE, Google, Cesium ion, in QGIS's settings
  `terrain_viewer/<key>`): the three the service reads go into every layer's
  address, Mapbox and MapTiler serve the Python backend.
- **Open link**: a share link or its bare query; its modes, settings,
  opacities, source, light and camera. Only the parameters some mode takes go
  into the addresses (not `splitRatio` or the camera).
- **Freeze** copies the layers drawn now into a dated group under the live
  one, which the panel never changes.
- A saved project reopens with its layers; on Connect the panel reads their
  addresses back into its checkboxes and settings.

## Files

| File | Role |
|---|---|
| `terrain_viewer/service.py` | The service's catalogs and the tile addresses (no widget) |
| `terrain_viewer/layers.py` | The layers in the project: the group tree, creation, address rewrite, opacity, blend, vector tile style |
| `terrain_viewer/dock.py` | The panel: the backends, the tree, the rows |
| `terrain_viewer/widgets.py`, `settings_ui.py` | The slider with its box, the light pad, the selects with previews, the foldable section, the backend buttons; the slider ranges and symmetric pairs by parameter name |
| `terrain_viewer/python_backend.py` | The Python backend under the tree: the service's modes, settings and sources mapped onto `live/` |
| `terrain_viewer/assets.py`, `assets/`, `make_assets.py` | The ramp and matcap previews (sprite sheets) and the catalog snapshot, made from a running tile service: `python make_assets.py [http://localhost:3400]` |
| `test_panel_units.py` | No service, no network: slider ranges, links, the Python mapping, the assets, the light pad: `QT_QPA_PLATFORM=offscreen python-qgis test_panel_units.py` |
| `terrain_viewer/local_server.py` | The local tile service (installed, or a `server/` folder): started on 127.0.0.1, stopped on unload or when QGIS goes |
| `terrain_viewer/service_install.py`, `service_pins.json` | The **Install** button: the pinned bundle downloaded through QGIS's network manager, its sha256 checked, unpacked into the plugin's data folder; **Remove** |
| `terrain_viewer/plugin.py`, `__init__.py`, `metadata.txt`, `icon.svg` | The QGIS plugin around it |
| `send2map_app/` | The "Open in" plugin: `destinations.py` (the URL builders, no QGIS import), `send2map_apptool.py` (the canvas as a camera, the map tool, opening a URL or a KML), `send2map_app.py` (toolbar, Web menu, canvas right-click menu) |
| `make_zip.py` | The installable zips, the tile service bundles (`--service-bundle`) and their pins (`--pins`) |
| `test_plugin.py` | A headless check of `terrain_viewer` against a running service: `QT_QPA_PLATFORM=offscreen python-qgis test_plugin.py http://localhost:3400 out/` (on Windows, `python-qgis.bat` in QGIS's `bin`; `python-qgis-ltr.bat` for an LTR) |
| `test_service_paths.py` | The plain zip unzipped into a temporary plugins folder and driven through the panel in headless QGIS: `installed` (Install from a bundle served locally, or the real pinned download; a tampered download refused; Connect, a slope tile, the unresponsive warnings, Remove) or `external` (an address, the desktop app's): `QT_QPA_PLATFORM=offscreen python-qgis test_service_paths.py installed dist/terrain_viewer-<version>.zip [dist/terrain-viewer-tile-service-windows-x64.zip]`, or `... external dist/terrain_viewer-<version>.zip http://localhost:3400 [--stop "<command>"]` |
| `smoke_bundled.py` | A service bundle started without QGIS (the build runners): `python -I smoke_bundled.py dist/terrain-viewer-tile-service-<platform>.zip` |
| `terrain_viewer/live/`, `test_live.py`, `bench_live.py`, `bench_canvas.py`, `live_reference.mjs` | Experimental (the **Python** backend): 16 modes computed with numpy in QGIS (`live/modes.py`; the matcap pictures `live/textures.py`), served from a localhost thread as colored XYZ tiles (Color) and Float32 tiles GDAL reads (Values: QGIS's color ramps, Identify); contour lines as a vector layer for the view (`live/contours.py`). `test_live.py [--service <url>]` scores each mode against the app's kernels in Node, the tile service and gdaldem, and draws every form; `bench_live.py` times the kernels, `bench_canvas.py` a 1920x1080 canvas. Findings: [QGIS Live Compute](../docs/content/docs/dev/qgis-live-compute.mdx) |
| `test_send2map.py` | A headless check of `send2map_app`, no network: `QT_QPA_PLATFORM=offscreen python-qgis test_send2map.py` |
| `test_open_in.py`, `open_in_reference.mjs` | `send2map_app`'s destinations against the web app's (`open-in-links.tsx`, evaluated by Node): `python test_open_in.py`, no QGIS |

Before publishing on plugins.qgis.org, `metadata.txt` needs an `email`.
