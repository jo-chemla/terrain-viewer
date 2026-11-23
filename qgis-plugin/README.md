# Terrain Viewer QGIS plugin

Step 1 of the [plugin plan](../docs/content/docs/dev/qgis-plugin.mdx): a dock
panel with the groups of the app's sidebar, whose checked modes are XYZ
layers of a [tile service](../tile-server/README.md). Pure Python on QGIS's
API, no dependency; QGIS 3.28 and later, QGIS 4 (Qt 6) included.

## Install

```bash
python make_zip.py          # dist/terrain_viewer-<version>.zip
```

In QGIS: Plugins > Manage and Install Plugins > Install from ZIP. Or, while
working on it, link the folder into the profile's plugins folder (Windows:
`%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\terrain_viewer`; QGIS 4
uses `QGIS4`), then enable it in the plugin manager.

It needs a tile service: a local one (`cd tile-server && pnpm start`, then
`http://localhost:3400`) or a hosted one.

## Use

- **Connect** to the service: the panel is built from its answers, `/sources`
  (the terrain source picker), `/modes` (the groups, each mode's settings with
  their types and defaults) and `/colorramps`. A mode or a setting added to the
  app reaches the panel when the service is updated, with no plugin release.
- **Check a mode**: a layer is added to the "Terrain Viewer" group, in a
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
- **Open from link**: paste a share link; its modes are checked, their settings
  and opacities set, the terrain source picked, the canvas moved to its camera.
  The link's other parameters are kept in every layer's address.
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
| `terrain_viewer/plugin.py`, `__init__.py`, `metadata.txt`, `icon.png` | The QGIS plugin around it |
| `make_zip.py` | The installable zip |
| `test_plugin.py` | A headless check against a running service: `QT_QPA_PLATFORM=offscreen python-qgis test_plugin.py http://localhost:3400 out/` (on Windows, `python-qgis.bat` in QGIS's `bin`) |

Before publishing on plugins.qgis.org, `metadata.txt` needs an `email`.
