---
name: terrain-viewer
description: Build links that open Terrain Viewer (terrain-viewer.iconem.com), a free browser viewer for elevation data, on a place and visualization of the user's choice. Use when someone asks to see, explore, visualize, compare or share the terrain, relief or elevation of a place (hillshade, slope, contours, sky-view factor, local relief model, 3D or globe views), or wants to look at a DEM, DTM, DSM or LiDAR file or tile URL (COG, GeoTIFF, Terrarium or Terrain-RGB tiles) without installing GIS software.
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
