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

Step 1 of the [plugin plan](../docs/content/docs/dev/qgis-plugin.mdx): a dock
panel with the groups of the app's sidebar, whose checked modes are XYZ
layers of a [tile service](../tile-server/README.md). Pure Python on QGIS's
API, no dependency; QGIS 3.28 and later, QGIS 4 (Qt 6) included.

## Install

The zips of each version are on a release: [`qgis-plugins-2026-11-25b`](https://github.com/Iconem/terrain-viewer/releases/tag/qgis-plugins-2026-11-25b)
(Terrain Viewer 0.4.0, Send2MapApp 0.5.1). Terrain Viewer comes plain (pure
Python, a tile service to connect to: the Terrain Viewer desktop app's, with
Settings > Desktop: local tile service on, is `http://localhost:3400`) or
bundled, one zip per platform (`-windows-x64`, `-macos-arm64`, `-macos-x64`,
`-linux-x64`, 48 to 60 MB) with the tile service inside, off by default:
checking "Local bundled tile service" in the panel enables it, Connect starts
it on 127.0.0.1, unchecking it or quitting QGIS stops it. It has no browser
engine (flat, north-up tiles only, what QGIS asks for). A service that does
not answer is warned about in the panel and the message bar; see
[the docs](../docs/content/docs/dev/qgis-plugin.mdx#the-bundled-tile-service).
To build them:

```bash
python make_zip.py                      # dist/terrain_viewer-<version>.zip and dist/send2map_app-<version>.zip
python make_zip.py --bundled [platform] # dist/terrain_viewer-<version>-<platform>.zip, all four when none is named
```

`.github/workflows/qgis-plugins.yml` builds them all on demand, starts each
platform's service on its own runner, and attaches the zips to a release.

In QGIS: Plugins > Manage and Install Plugins > Install from ZIP. Or, while
working on it, link the folder into the profile's plugins folder (Windows:
`%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\terrain_viewer`; QGIS 4
uses `QGIS4`), then enable it in the plugin manager. `send2map_app` installs
the same way, and replaces an earlier Send2MapApp in place (same folder name).

The plain zip needs a tile service: a local one (`cd tile-server && pnpm
start`, then `http://localhost:3400`) or a hosted one. A platform zip has its
own.

## Use

- **Connect** to the service: the panel is built from its answers, `/sources`
  (the terrain source picker), `/processes` (each mode as an OGC API -
  Processes description: its settings with their types and defaults, its
  panel group; a service older than 2026-11-24 has none: update it) and
  `/colorramps`. Layers ask `/terrain-tiles`. A mode or a setting added to the
  app reaches the panel when the service is updated, with no plugin release.
- **Check a mode**: a layer is added to the "Terrain Viewer (live)" group, in a
  subgroup named as the app's panel group, stacked as the map stacks them.
  The gear button shows its opacity and settings; a changed setting rewrites
  the layer's address (half a second after the last change).
- **Opacity and blending are QGIS layer settings**: the tiles are asked opaque
  (QGIS draws neighbouring tiles a pixel over each other, so half transparent
  tiles show lines along their edges); the shading modes (hillshade, Phong,
  terrain and building shadows) are multiplied over the layers under them.
- **Overlays** (contours, iso-line, mound candidates, plane slicer, graticule)
  are raster tiles as the app draws them; "vector" also loads the same features
  as vector tiles, styled in QGIS.
- **Values**: the modes computed as numbers (elevation, slope, aspect,
  curvature, TRI, TPI, roughness, LRM, sky view factor, openness, ...) have a
  "values" box: it adds the mode's values before the colour ramp, in natural
  units (degrees, metres, ...), as a Float32 raster that GDAL reads from the
  service's `/gdal.xml`, for the raster calculator, zonal statistics or
  Identify. It follows the mode's settings like the coloured layer.
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
| `terrain_viewer/local_server.py` | The bundled tile service (platform zips, `server/`): started on 127.0.0.1, stopped on unload or when QGIS goes |
| `terrain_viewer/plugin.py`, `__init__.py`, `metadata.txt`, `icon.svg` | The QGIS plugin around it |
| `send2map_app/` | The "Open in" plugin: `destinations.py` (the URL builders, no QGIS import), `send2map_apptool.py` (the canvas as a camera, the map tool, opening a URL or a KML), `send2map_app.py` (toolbar, Web menu, canvas right-click menu) |
| `make_zip.py` | The installable zips, plain and `--bundled` per platform |
| `test_plugin.py` | A headless check of `terrain_viewer` against a running service: `QT_QPA_PLATFORM=offscreen python-qgis test_plugin.py http://localhost:3400 out/` (on Windows, `python-qgis.bat` in QGIS's `bin`; `python-qgis-ltr.bat` for an LTR) |
| `test_service_paths.py` | A zip unzipped into a temporary plugins folder and driven through the panel in headless QGIS, for the bundled service or an external address (the desktop app's): Connect, processes, a slope layer, a tile, the unresponsive warnings: `QT_QPA_PLATFORM=offscreen python-qgis test_service_paths.py bundled dist/terrain_viewer-<version>-windows-x64.zip`, or `... external dist/terrain_viewer-<version>.zip http://localhost:3400 [--stop "<command>"]` |
| `smoke_bundled.py` | The same without QGIS (the build runners): `python -I smoke_bundled.py <zip>` |
| `test_send2map.py` | A headless check of `send2map_app`, no network: `QT_QPA_PLATFORM=offscreen python-qgis test_send2map.py` |
| `test_open_in.py`, `open_in_reference.mjs` | `send2map_app`'s destinations against the web app's (`open-in-links.tsx`, evaluated by Node): `python test_open_in.py`, no QGIS |

Before publishing on plugins.qgis.org, `metadata.txt` needs an `email`.
