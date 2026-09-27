---
name: terrain-viewer
description: Build links that open Terrain Viewer (terrain-viewer.iconem.com), a free browser viewer for elevation data, on a place and visualization of the user's choice, including animations. Use when someone asks to see, explore, visualize, animate, compare or share the terrain, relief or elevation of a place (hillshade, slope, contours, sky-view factor, local relief model, 3D or globe views), or wants to look at a DEM, DTM, DSM or LiDAR file or tile URL (COG, GeoTIFF, Terrarium or Terrain-RGB tiles) without installing GIS software.
---

# Terrain Viewer links

Terrain Viewer is a web app: every setting lives in the URL, so the deliverable is a link the user opens in a browser. Nothing to install, no API key for the default terrain.

Base URL: `https://terrain-viewer.iconem.com/`

## Steps

1. Find the place's latitude and longitude (4 decimals is enough) and pick a zoom: 5 for a country, 9 for a region, 12 for a mountain or valley, 15 for a site.
2. Pick the view: `viewMode=2d` for maps and analysis, `3d` for a tilted landscape (add `pitch=55`), `globe` for continental scale.
3. Turn on the modes that answer the question (table below). Several can be on at once.
4. Pick the terrain source only if the default (Mapterhorn, global, up to about 0.5 m where national LiDAR is open) is not what the user wants.
5. Percent-encode any URL placed inside the query string, and give the user the link with one sentence on what they will see.

## Modes

| Question | Parameters |
|---|---|
| General relief | `showHillshade=true` (on by default) |
| Elevation as colours | `showColorRelief=true` |
| Contour lines | `showContoursAndGraticules=true&showContours=true` |
| Steepness | `showTerrainAnalysis=true&showSlope=true` |
| Which way slopes face | `showTerrainAnalysis=true&showAspect=true` |
| Ridges and valleys | `showTerrainAnalysis=true&showCurvature=true` |
| Subtle features: archaeology, old field systems, landslides | `showReliefVisualization=true&showLrm=true` (local relief model) or `&showSvf=true` (sky-view factor) or `&showOpenness=true` |
| Shaded 3D look | `showLightingEffects=true&showPhong=true` or `&showMatcap=true` |
| Satellite imagery underneath | `showRasterBasemap=true` |

A mode's section switch (`showTerrainAnalysis`, `showReliefVisualization`, `showLightingEffects`) must be on for its modes to show.

## Terrain sources

- `terrainSourceA=mapterhorn` (default, global), `aws` (global, 30 m class).
- National and LiDAR datasets have ids such as `custom-mx-aguadafenix-lidar`; the list with ids is on https://terrain-viewer.iconem.com/docs/features/national-datasets/. Do not invent ids.
- The user's own data: `terrainSourceA=<percent-encoded URL>`. A URL containing `{z}` is read as Terrarium tiles, anything else as a Cloud-Optimized GeoTIFF. Add `terrainType=terrainrgb` for Terrain-RGB tiles. Without `lat`/`lng` the view frames the COG itself. The server must allow cross-origin and range requests; a COG not in Web Mercator needs `viaTitiler=1`.

## Comparing

`splitStyle=side-by-side&terrainSourceB=<id or URL>` shows two sources next to each other; `splitStyle=overlay` stacks them with a slider.

## Light and sun

One light drives hillshade, Phong, Matcap and cast shadows. Three ways to set it:

- **Free direction:** `illuminationDir` is the azimuth the light comes from, in degrees clockwise from north (315, north-west, by default); `illuminationAlt` its height above the horizon, 0 to 90 (45 by default).
- **Attached to the world or to the camera:** `phongLightRelativeToCamera` and `matcapLightRelativeToCamera` (true by default) keep the light at the same angle to the viewer while the map rotates, so shading reads the same from any side; `false` pins it to the compass, like a real sun.
- **From a date and time:** `lightUseDatetime=true` computes the sun's azimuth and height for the map centre from `lightDayOfYear` (1 to 366; 172 is about 21 June) and `lightTimeOfDay` (hours, 15.5 is 15:30). `lightTimeMode=local` (default) reads that hour on the civil clock at the map centre, daylight saving included; `utc` reads it as UTC. Add `showLightingEffects=true&showShadows=true` to cast terrain shadows for that moment.

Example, shadows over the Grand Canyon on a winter afternoon: `https://terrain-viewer.iconem.com/?viewMode=3d&zoom=11&lat=36.10&lng=-112.11&pitch=60&lightUseDatetime=true&lightDayOfYear=355&lightTimeOfDay=15.5&showLightingEffects=true&showShadows=true`

To sweep the light in an animation, put `illuminationDir` or `illuminationAlt` in the poses' `numericState` (see Animation).

## Vector data: points, lines, polygons

- **From a URL, in the link:** `drawingUrl=<percent-encoded URL>` loads GeoJSON, KML, GPX, FlatGeobuf or a Shapefile as a layer, re-fetched on every load and framed unless the link sets its own camera. Several: repeat the parameter, or separate URLs with commas (a comma inside a URL as `%2C`). The server must allow cross-origin requests.
- **In the app, for the user to do:** the Drawing tool (Tools section, `openSections=drawing`) draws points, lines, polygons, rectangles and circles into named layers; **Import** reads a GeoJSON, KML, GPX or FlatGeobuf file from disk, and the arrow next to it reads one from a URL; **Export** saves GeoJSON. Drawings last for the session; **Settings, Browser Local Storage Persistence, Vector Layers** keeps them across reloads, in the user's own browser only.
- A link cannot carry a user's local drawings: to share them, the user exports GeoJSON, puts it online and uses `drawingUrl`.

## Sources, library, bookmarks and panels

- **Terrain or basemap from a URL:** `terrainSourceA=<URL>` (see Terrain sources); `basemapSource=<id or URL>` with `showRasterBasemap=true` for imagery underneath (`{z}` in the URL means XYZ tiles, otherwise a COG).
- **Make sources available without activating them:** `addSources=id1,id2` (library ids), `addTerrainUrl=`, `addBasemapUrl=`, `addOverlayUrl=` (repeatable). `overlayBasemapIds=` turns overlays on.
- **Open a dialog on arrival:** `openLibrary=terrain` or `openLibrary=basemap` (the library of national and global datasets), `openDataLayers=true` (the data layers picker), `bookmarksGallery=true` (the user's bookmarks).
- **Bookmarks** live in the user's browser. A bookmark to share is simply the link; bookmark lists move between browsers through the Bookmarks section's JSON export and import.
- **Files on the user's disk:** a local COG can be added in the app (Terrain, add a source, local file); it stays in the browser and cannot travel in a link.
- **Historical imagery:** `appMode=historical&basemapSourceA=wayback` (also `ge-historical`, `bing`, `hls`, `eox-s2`) with `dateA=<epoch milliseconds>`.
- **Panels:** `openSections=animation,drawing` and `closeSections=` fold or unfold sidebar sections; `sidebarCollapsed=true` hides the panel, for embeds; `project=<name>` loads a preset.

## Animation

A link can play an animation on open: the camera flies between two poses while any numeric setting moves with it, such as the light's azimuth for a sweeping sun, one mode fading out while another fades in, or terrain exaggeration growing.

- `animPose1Delta`: the start, as JSON `{"pose": {...}, "numericState": {...}}`. `pose` must list all of `lat`, `lng`, `zoom`, `pitch`, `bearing`, `roll`, `vfov`, `refWidth` (use `roll` 0, `vfov` 36.869898, `refWidth` 1400); a missing field falls back to the world view. `numericState` holds the settings to animate with their start values.
- `animPose2Delta`: the end, as the DIFFERENCE from the start, same shape, every pose field present (0 when unchanged). A key in its `numericState` is the change of that setting, e.g. `illuminationDir: -180` sweeps the light half-way round.
- `animDuration` in seconds, `animLoopMode` `none`, `forward` or `bounce`.
- `animSmoothCamera=false` to animate the settings too; `true` moves the camera only.
- `animPlaying=true` starts playback on open, and `openSections=animation` shows the Animation panel, which runs it.
- `animPlaying360=true` instead orbits the camera around the view's centre.

Settings that animate well: `illuminationDir` (light azimuth, degrees), `illuminationAlt` (sun height), `exaggeration`, and every mode's opacity (`hillshadeOpacity`, `slopeOpacity`, `colorReliefOpacity`, `rasterBasemapOpacity`, `lightingEffectsOpacity`...). A faded mode must still be switched on (`showSlope=true`...). Percent-encode the JSON.

Example, flying 90 degrees round the Matterhorn while the light swings and slope fades in:

https://terrain-viewer.iconem.com/?viewMode=3d&lat=45.9763&lng=7.6586&zoom=12.5&pitch=55&showTerrainAnalysis=true&showSlope=true&animPose1Delta=%7B%22pose%22%3A%7B%22lat%22%3A45.9763%2C%22lng%22%3A7.6586%2C%22zoom%22%3A12.5%2C%22pitch%22%3A55%2C%22bearing%22%3A0%2C%22roll%22%3A0%2C%22vfov%22%3A36.869898%2C%22refWidth%22%3A1400%7D%2C%22numericState%22%3A%7B%22illuminationDir%22%3A315%2C%22slopeOpacity%22%3A0%7D%7D&animPose2Delta=%7B%22pose%22%3A%7B%22lat%22%3A0%2C%22lng%22%3A0%2C%22zoom%22%3A0.5%2C%22pitch%22%3A0%2C%22bearing%22%3A90%2C%22roll%22%3A0%2C%22vfov%22%3A0%2C%22refWidth%22%3A0%7D%2C%22numericState%22%3A%7B%22illuminationDir%22%3A-180%2C%22slopeOpacity%22%3A1%7D%7D&animDuration=6&animLoopMode=bounce&animSmoothCamera=false&animPlaying=true&openSections=animation

In the app, the Animation panel's Export Video button records it as an MP4.

## Examples

- Slope around the Matterhorn in 3D: https://terrain-viewer.iconem.com/?viewMode=3d&zoom=13&lat=45.9763&lng=7.6586&pitch=55&showTerrainAnalysis=true&showSlope=true
- Contours over a Maya LiDAR survey: https://terrain-viewer.iconem.com/?viewMode=2d&zoom=15&lat=17.7338&lng=-91.2886&terrainSourceA=custom-mx-aguadafenix-lidar&showContoursAndGraticules=true&showContours=true
- Local relief model for spotting earthworks: https://terrain-viewer.iconem.com/?viewMode=2d&zoom=15&lat=<lat>&lng=<lng>&showReliefVisualization=true&showLrm=true
- A COG the user shared: https://terrain-viewer.iconem.com/?terrainSourceA=https%3A%2F%2Fexample.com%2Fdem.tif&showHillshade=true

## Reference

- Every parameter, with types and defaults: https://terrain-viewer.iconem.com/docs/openapi.json and https://terrain-viewer.iconem.com/docs/dev/url-api/
- What each mode shows: https://terrain-viewer.iconem.com/docs/features/visualization-modes/
- The whole documentation for agents: https://terrain-viewer.iconem.com/llms.txt
- In the app, the GeoTIFF button's menu exports the DEM and any mode as a georeferenced file.
