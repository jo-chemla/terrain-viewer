# Send2MapApp: "Open in" for QGIS

Opens the place shown or clicked in QGIS in another viewer, at the same
place and scale: Terrain Viewer, Google Earth (web, historical and 3D, and
Google Earth Pro on the desktop), Google Maps 3D, Bing Maps 3D, ESRI Wayback,
ShadeMap, LiDAR Lens and others. QGIS 3.22 to 4.x (Qt 5 and Qt 6).

## Lineage

This plugin started as **Send2GE** (`send2google_earth`) by Maxim Dubinin
and NextGIS, 2013 to 2018: a map tool that takes the point clicked, writes it
to a KML file and opens it in Google Earth
([plugins.qgis.org/plugins/send2google_earth](https://plugins.qgis.org/plugins/send2google_earth/),
[github.com/nextgis/qgis_send2google_earth](https://github.com/nextgis/qgis_send2google_earth)),
licensed under the GNU GPL v2 or later.

Jonathan Chemla (Iconem) made it **Send2MapApp** in 2025: a toolbar dropdown
of web destinations (Iconem Historical, Maxar, ESRI Wayback, Google Earth web)
next to Google Earth Pro. In 2026 it moved into the Terrain Viewer repository
and gained every "Open in" destination of the Terrain Viewer web app, the
canvas right-click menu, the current view (not only a click) and QGIS 4.

It stays under the GNU GPL v2 or later (`LICENSE`), with the original
copyright lines kept in each source file; the rest of the Terrain Viewer
repository is MIT, which is why this is its own plugin folder rather than
part of `terrain_viewer`.

## Use

- **Toolbar button**: its arrow lists the destinations; picking one opens the
  current view there and remembers it. The button itself turns on a map tool:
  a click on the map opens the point clicked in the remembered destination.
- **Right click on the map**: "Open in", every destination at the point
  clicked.
- **Web > Send2MapApp**: the same list for the current view.

The camera follows the canvas: the centre (or the point clicked), the zoom
whose 512 px tiles have the canvas's ground resolution there (the web app's
zoom), and the heading from the canvas rotation. Any project CRS works. A
destination with limited coverage (LiDAR Lens: Britain and Ireland) is greyed
out elsewhere.

## Destinations

| Id | Destination | From |
|---|---|---|
| `terrain-viewer` | Terrain Viewer | plugin |
| `iconem-historical` | Iconem Historical Satellite (Terrain Viewer's historical mode) | plugin |
| `iconem-river-rem` | Iconem River-REM | web app |
| `iconem-search-eo` | Iconem Search-EO | web app |
| `esri-wayback` | ESRI Wayback Machine | web app |
| `google-maps-3d` | Google Maps 3D | web app |
| `google-earth-web` | Google Earth Historical (web) | web app |
| `google-earth-web-3d` | Google Earth 3D (web) | web app |
| `bing-maps-3d` | Bing Maps 3D | web app |
| `shademap` | ShadeMap (sun and shadows) | web app |
| `lidarlens` | LiDAR Lens (Britain and Ireland) | web app |
| `bbbike-mapcompare` | BBBike MapCompare | web app |
| `maxar` | Maxar (pro.maxar.com) | plugin |
| `google-earth-pro` | Google Earth Pro (desktop), through a KML file | plugin |

The "web app" rows are a Python port of `OPEN_IN_DESTINATIONS` in
`components/TerrainControlPanel/open-in-links.tsx`; `qgis-plugin/test_open_in.py`
runs the TypeScript builders under Node and fails when an id, a label, an
availability or a URL differs, so a destination added to the app fails the test
until it is added here.
