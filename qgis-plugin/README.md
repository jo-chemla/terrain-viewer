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

Released (0.5.0; [the docs](../docs/content/docs/dev/qgis-plugin.mdx)): a dock
panel with the groups of the app's sidebar, whose checked modes are XYZ
layers of a [tile service](../tile-server/README.md). Pure Python on QGIS's
API, no dependency; QGIS 3.28 and later, QGIS 4 (Qt 6) included.

## Install

The zips of each version are on a release: [`qgis-plugins-2026-11-25d`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-25d)
(Terrain Viewer 0.6.0, Send2MapApp 0.5.1). Terrain Viewer is one plain zip,
pure Python. It needs a tile service: the Terrain Viewer desktop app's (with
Settings > Desktop: local tile service on, `http://localhost:3400`), a local
or hosted one, or one installed from the panel: **Install** downloads this
platform's tile service bundle (Node and the service, about 48 MB) from the
release that `terrain_viewer/service_pins.json` pins, checks its sha256 and
unpacks it into the plugin's data folder; the **Local tile service** box then
enables it, off by default, Connect starts it on 127.0.0.1, unchecking it or
quitting QGIS stops it. No browser engine (flat, north-up tiles only, what
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

Without any tile service, the experimental **compute locally** box at the
top of the panel draws 16 modes computed in QGIS with numpy.

## Use

- **Connect** to the service: the panel is built from its answers, `/sources`
  (the terrain source picker), `/processes` (each mode as an OGC API -
  Processes description: its settings with their types and defaults, its
  panel group; a service older than 2026-11-24 has none: update it) and
  `/colorramps`. Layers ask `/terrain-tiles`. A mode or a setting added to the
  app reaches the panel when the service is updated, with no plugin release.
- **A mode's row**: its checkbox on the left; on the right its forms,
  **Colour** (the mode as the app draws it, an XYZ layer), **Values** (the
  numbers, below) and, for the overlays, **Vector**. Checking the mode turns
  on its Colour layer (the first time; afterwards the forms it had); either
  form or both can be checked, and checking one checks the mode. Each form
  is a layer of the "Terrain Viewer (live)" group, in a subgroup named as the
  app's panel group, stacked as the map stacks them; unchecking removes it,
  and a layer removed by hand unchecks its form. The gear, shown while Colour
  (or Vector) is on, folds out the opacity and settings; a changed setting
  rewrites the layer's address (half a second after the last change),
  keeping the style, opacity and resampling set in its properties.
- **Opacity and blending are QGIS layer settings**: the tiles are asked opaque
  (QGIS draws neighbouring tiles a pixel over each other, so half transparent
  tiles show lines along their edges); the shading modes (hillshade, Phong,
  terrain and building shadows) are multiplied over the layers under them.
- **Overlays** (contours, iso-line, mound candidates, plane slicer, graticule)
  are raster tiles as the app draws them; "vector" also loads the same features
  as vector tiles, styled in QGIS.
- **Values**: the modes computed as numbers (elevation, slope, aspect,
  curvature, TRI, TPI, roughness, LRM, sky view factor, openness, ...) have a
  Values box: the mode's values before the colour ramp, in natural units
  (degrees, metres, ...), as a Float32 raster that GDAL reads from the
  service's `/gdal.xml`, for the raster calculator, zonal statistics or
  Identify. It follows the mode's settings like the coloured layer. It is
  resampled early (by GDAL, bilinear) between zoom levels; see
  [resampling](../docs/content/docs/dev/qgis-live-compute.mdx#resampling-and-tile-zoom).
- **Open from link**: paste a share link; its modes are checked, their settings
  and opacities set, the terrain source picked, the canvas moved to its camera.
  The link's other parameters are kept in every layer's address.
- **Freeze** copies the layers drawn now (the checked ones in the "Terrain
  Viewer (live)" group, the one the panel follows) into a new group right
  under it, named with the date, the time and the canvas centre and zoom
  ("Frozen 2026-11-24 14:05 — 44.51, 4.00 z11"); the live group stays on top.
  It is found by a group property (`terrain_viewer/root`), so renaming it is
  harmless; a project saved before 0.2.1, whose group is "Terrain Viewer", has
  it renamed on Connect. XYZ, vector tile
  and values layers alike keep their address (every setting in it), opacity,
  blending, style and order. The copies are plain QGIS layers: they carry
  `terrain_viewer/frozen` instead of `terrain_viewer/layer`, so the panel never
  rewrites them nor reads them back. Several freezes stack, the newest on top.
- A saved project reopens with its layers; on Connect the panel reads their
  addresses back into its checkboxes and settings.
- Keys (`mapboxKey`, `maptilerKey`, `cesiumIonKey`) are stored in QGIS's
  settings and added to the addresses of every layer: a project saved with a
  keyed source holds the key.

## Files

| File | Role |
|---|---|
| `terrain_viewer/service.py` | The service's catalogs and the tile addresses (no widget) |
| `terrain_viewer/layers.py` | The layers in the project: the group tree, creation, address rewrite, opacity, blend, vector tile style |
| `terrain_viewer/dock.py` | The panel |
| `terrain_viewer/local_server.py` | The local tile service (installed, or a `server/` folder): started on 127.0.0.1, stopped on unload or when QGIS goes |
| `terrain_viewer/service_install.py`, `service_pins.json` | The **Install** button: the pinned bundle downloaded through QGIS's network manager, its sha256 checked, unpacked into the plugin's data folder; **Remove** |
| `terrain_viewer/plugin.py`, `__init__.py`, `metadata.txt`, `icon.svg` | The QGIS plugin around it |
| `send2map_app/` | The "Open in" plugin: `destinations.py` (the URL builders, no QGIS import), `send2map_apptool.py` (the canvas as a camera, the map tool, opening a URL or a KML), `send2map_app.py` (toolbar, Web menu, canvas right-click menu) |
| `make_zip.py` | The installable zips, the tile service bundles (`--service-bundle`) and their pins (`--pins`) |
| `test_plugin.py` | A headless check of `terrain_viewer` against a running service: `QT_QPA_PLATFORM=offscreen python-qgis test_plugin.py http://localhost:3400 out/` (on Windows, `python-qgis.bat` in QGIS's `bin`; `python-qgis-ltr.bat` for an LTR) |
| `test_service_paths.py` | The plain zip unzipped into a temporary plugins folder and driven through the panel in headless QGIS: `installed` (Install from a bundle served locally, or the real pinned download; a tampered download refused; Connect, a slope tile, the unresponsive warnings, Remove) or `external` (an address, the desktop app's): `QT_QPA_PLATFORM=offscreen python-qgis test_service_paths.py installed dist/terrain_viewer-<version>.zip [dist/terrain-viewer-tile-service-windows-x64.zip]`, or `... external dist/terrain_viewer-<version>.zip http://localhost:3400 [--stop "<command>"]` |
| `smoke_bundled.py` | A service bundle started without QGIS (the build runners): `python -I smoke_bundled.py dist/terrain-viewer-tile-service-<platform>.zip` |
| `terrain_viewer/live/`, `test_live.py`, `bench_live.py`, `bench_canvas.py`, `live_reference.mjs` | Experimental, off by default (the **Experimental: compute locally** box at the top of the panel): 16 modes computed with numpy in QGIS (`live/modes.py`; the matcap pictures `live/textures.py`), served from a localhost thread as coloured XYZ tiles (Colour) and Float32 tiles GDAL reads (Values: QGIS's colour ramps, Identify); contour lines as a vector layer for the view (`live/contours.py`). `test_live.py [--service <url>]` scores each mode against the app's kernels in Node, the tile service and gdaldem, and draws every form; `bench_live.py` times the kernels, `bench_canvas.py` a 1920x1080 canvas. Findings: [QGIS Live Compute](../docs/content/docs/dev/qgis-live-compute.mdx) |
| `test_send2map.py` | A headless check of `send2map_app`, no network: `QT_QPA_PLATFORM=offscreen python-qgis test_send2map.py` |
| `test_open_in.py`, `open_in_reference.mjs` | `send2map_app`'s destinations against the web app's (`open-in-links.tsx`, evaluated by Node): `python test_open_in.py`, no QGIS |

Before publishing on plugins.qgis.org, `metadata.txt` needs an `email`.
