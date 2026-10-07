---
name: terrain-viewer
description: Build links that open Terrain Viewer (terrain-viewer.iconem.com), a free browser viewer for elevation data, on a place and visualization of the user's choice, including animations. Use when someone asks to see, explore, visualize, animate, compare or share the terrain, relief or elevation of a place (hillshade, slope, contours, sky-view factor, local relief model, 3D or globe views), or wants to look at a DEM, DTM, DSM or LiDAR file or tile URL (COG, GeoTIFF, Terrarium or Terrain-RGB tiles) without installing GIS software.
---

# Terrain Viewer links

Terrain Viewer is a web app: every setting lives in the URL, so the deliverable is a link the user opens in a browser. Nothing to install, no API key for the default terrain.

Base URL: `https://terrain-viewer.iconem.com/`

## Steps

1. Find the place's latitude and longitude (4 decimals is enough) and pick a zoom: 5 for a country, 9 for a region, 12 for a mountain or valley, 15 for a site.
2. Pick the view: `viewMode=2d` (top-down) for sites, maps, analysis and anything the user wants to read like a plan; `3d` for a landscape, a valley, a mountain (add `pitch=55` and keep zoom at 13 or less, since a tilted camera close to the ground ends up under the terrain while tiles load); `globe` for continental scale.
3. Turn on the modes that answer the question (table below). Several can be on at once.
4. Pick the terrain source. The default, Mapterhorn, is global but its detail depends on the place: about 0.5 to 2 m where a national LiDAR survey is open (most of Europe, the US, Japan, New Zealand, parts of Canada and Australia), 30 m elsewhere (Copernicus GLO-30). At 30 m a fortress, a field system or a round house is a few pixels: say so, rather than send a link that shows nothing. Where it matters, check the library for a finer dataset (Terrain sources below) or offer `showRasterBasemap=true` imagery with a top-down view, with the caveat that forest hides what is under it.
5. Percent-encode any URL placed inside the query string, and give the user the link with one sentence on what they will see.

## Modes

| Question | Parameters |
|---|---|
| General relief | `showHillshade=true` (on by default); `hillshadeMethod=duotone-nw-ne` gives the two-light LiDAR look (grey north-west light, blue and orange north-east light) used in landscape archaeology; `multidir-colors` colours by aspect |
| Elevation as colours | `showColorRelief=true` |
| Contour lines | `showContoursAndGraticules=true&showContours=true` |
| Steepness | `showTerrainAnalysis=true&showSlope=true` |
| Which way slopes face | `showTerrainAnalysis=true&showAspect=true` |
| Ridges and valleys | `showTerrainAnalysis=true&showCurvature=true` |
| Subtle features: archaeology, old field systems, landslides | `showReliefVisualization=true&showLrm=true` (local relief model) or `&showSvf=true` (sky-view factor) or `&showOpenness=true` |
| Shaded 3D look | `showLightingEffects=true&showPhong=true` or `&showMatcap=true` |
| Satellite imagery underneath | `showRasterBasemap=true` |
| Height of buildings and trees above ground (nDSM, canopy height) | `terrainSourceA=<nDSM id>&showColorRelief=true`, e.g. `custom-fr-ign-lidarhd-nhm` (France), `custom-nl-ahn-nhm` (Netherlands); a 0 to 40 m colour range reads as canopy height |
| Change between two surveys or dates (ground gained or lost) | `terrainSourceA=<change id>&showColorRelief=true`, e.g. `custom-fr-ign-lidarhd-minus-rgealti`; symmetric colour range so gain and loss read as opposite colours. Any two loaded sources can be subtracted in the app (Add Terrain, Difference of two sources), see https://terrain-viewer.iconem.com/docs/features/ndsm-and-comparison/ |

A mode's section switch (`showTerrainAnalysis`, `showReliefVisualization`, `showLightingEffects`) must be on for its modes to show. `place=<name>` labels the view (shown in the geocoder box); `openDataLayers=true` opens the picker that shows every mode with a thumbnail, useful when the user wants to choose for themselves.

## Which modes for which subject

What published studies use, from the 120-study [Research References](https://terrain-viewer.iconem.com/docs/resources/research-references/) (counts in the [table](https://terrain-viewer.iconem.com/docs/resources/research-references-table/), which filters by field and mode and opens each study area in the app). Start with the first two modes of a row; add the others when the first do not show the feature.

| Subject | Modes most used | Parameters |
|---|---|---|
| Settlements, earthworks and roads under forest | hillshade, LRM, SVF | `showReliefVisualization=true&showLrm=true&showSvf=true` |
| Mounds, tells, barrows, field systems | mound detector, LRM, hillshade, TPI | `showTellsDetector=true&showReliefVisualization=true&showLrm=true` (the mound detector is a beta mode; a link that uses it switches the beta on in the reader's browser when opened, with a notice; it then stays on, Settings → Beta turns it off) |
| Karst dolines, pits, bomb craters, trenches | mound detector, SVF, hillshade | `showReliefVisualization=true&showSvf=true` |
| Faults, scarps and earthquake ruptures | hillshade, slope, SVF, DEM difference | `showTerrainAnalysis=true&showSlope=true` and a low sun (`illuminationAlt=20`) across the fault |
| Landslides and mass movements | hillshade, slope, SVF, curvature, roughness, DEM difference | `showTerrainAnalysis=true&showSlope=true&showCurvature=true` |
| Glaciers, moraines, glacial landforms | hillshade, SVF, slope, DEM difference, contours | `showReliefVisualization=true&showSvf=true&showContoursAndGraticules=true&showContours=true` |
| Volcanoes, dunes, coasts, permafrost | DEM difference first, then hillshade, roughness, TPI | a change source (see above) with `showColorRelief=true` |
| Rivers, floodplains, palaeochannels | hillshade, REM (height above the river), TPI, LRM | `showReliefVisualization=true&showLrm=true`; the river REM is in the app's Tools, see https://terrain-viewer.iconem.com/docs/features/river-rem/ |
| Soils, ecology, habitat | slope, TPI, hillshade, curvature, roughness | `showTerrainAnalysis=true&showSlope=true&showTpi=true` |
| Mining, quarries, historic industry | hillshade, slope, LRM | `showTerrainAnalysis=true&showSlope=true&showReliefVisualization=true&showLrm=true` |
| Relief visualization methods, general geomorphometry | SVF, LRM, openness, slope, aspect, curvature | compare them side by side, `splitStyle=side-by-side` |
| Looting, site damage, Google Earth prospection, declassified imagery | historical imagery rather than terrain | `appMode=historical&basemapSourceA=ge-historical` or `wayback`, see Sources below |

## Terrain sources

- `terrainSourceA=mapterhorn` (default, global), `aws` (global, 30 m class).
- National and LiDAR datasets have ids such as `custom-mx-aguadafenix-lidar`; the list with ids is on https://terrain-viewer.iconem.com/docs/features/national-datasets/. Do not invent ids.
- The user's own data: `terrainSourceA=<percent-encoded URL>`. A URL containing `{z}` is read as Terrarium tiles, anything else as a Cloud-Optimized GeoTIFF. Add `terrainType=terrainrgb` for Terrain-RGB tiles. Without `lat`/`lng` the view frames the COG itself. The server must allow cross-origin and range requests; a COG not in Web Mercator needs `viaTitiler=1`.

## National dataset or Mapterhorn?

Mapterhorn already ingests most open national LiDAR, so for a place in Europe, the US, Japan or New Zealand the default source is usually the fine one. Use a library id instead when the study needs a dataset Mapterhorn does not have or has coarser; in the research references these are the entries with a `library_id`, today Mexico (`custom-mx-aguadafenix-lidar` for the Aguada Fénix survey, `custom-mx-inegi-cem` nationwide at 15 m), the Netherlands (`custom-nl-ahn-dtm`, 0.5 m, finer than Mapterhorn's 5 m there), Queensland (`custom-au-qld-dem`) and Czechia (`custom-cz-cuzk-dmr5g`, 2 m). The [National Datasets](https://terrain-viewer.iconem.com/docs/features/national-datasets/) page lists every id grouped as finer than, same as, or absent from Mapterhorn; its "vs Mapterhorn" links are side-by-side comparisons ready to copy.

## Worked examples

From the research references, each the study's own area and the modes it used:

- Monumental Maya architecture under forest (Inomata et al. 2020): Aguada Fénix LiDAR, hillshade plus local relief model, top-down. https://terrain-viewer.iconem.com/?viewMode=2d&zoom=15&lat=17.7338&lng=-91.2886&terrainSourceA=custom-mx-aguadafenix-lidar&showReliefVisualization=true&showLrm=true&place=Aguada%20F%C3%A9nix
- Barrows and Celtic fields found by machine learning (Verschoof-van der Vaart et al. 2019): Veluwe, AHN 0.5 m, hillshade with the mound detector. https://terrain-viewer.iconem.com/?viewMode=2d&zoom=14&lat=52.2&lng=5.85&terrainSourceA=custom-nl-ahn-dtm&showTellsDetector=true&showReliefVisualization=true&showLrm=true&place=Veluwe
- The 2014 Oso landslide (Iverson et al. 2015): Mapterhorn (Washington 3DEP LiDAR), slope and sky-view factor over hillshade. https://terrain-viewer.iconem.com/?viewMode=2d&zoom=14&lat=48.2826&lng=-121.848&showTerrainAnalysis=true&showSlope=true&showReliefVisualization=true&showSvf=true&place=Oso%20landslide
- Drumlins (Yu, Eyles and Sookhan 2015): Wadena drumlin field, Minnesota, curvature plus local relief model in 3D at a landscape zoom. https://terrain-viewer.iconem.com/?viewMode=3d&zoom=11&lat=46.4425&lng=-95.1361&pitch=50&showTerrainAnalysis=true&showCurvature=true&showReliefVisualization=true&showLrm=true&place=Wadena%20drumlins

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

- **Terrain or basemap from a URL:** `terrainSourceA=<URL>` (see Terrain sources); `basemapSource=<id or URL>` with `showRasterBasemap=true` for imagery underneath (`{z}` in the URL means XYZ tiles, otherwise a COG). A WMS GetMap URL with `{bbox-epsg-3857}` in place of the BBOX works as tiles; in the app, the Auto field of Add Basemap reads any pasted URL (tiles, WMS, WMTS, COG, STAC, Allmaps, IIIF, Source Cooperative) and finds a WMS layer's zoom range by asking the server.
- **Make sources available without activating them:** `addSources=id1,id2` (library ids), `addTerrainUrl=`, `addBasemapUrl=`, `addOverlayUrl=` (repeatable). `overlayBasemapIds=` turns overlays on.
- **Open a dialog on arrival:** `openLibrary=terrain` or `openLibrary=basemap` (the library of national and global datasets), `openDataLayers=true` (the data layers picker), `bookmarksGallery=true` (the user's bookmarks).
- **Bookmarks** live in the user's browser. A bookmark to share is simply the link; bookmark lists move between browsers through the Bookmarks section's JSON export and import.
- **Files on the user's disk:** a local COG can be added in the app (Terrain, add a source, local file); it stays in the browser and cannot travel in a link.
- **A plain image placed on the map** (a figure, a scan): `georefImage=<percent-encoded image URL>&georefGcps=px,py,lng,lat;px,py,lng,lat&georefType=helmert` draws it from control points (pixel x, pixel y from the top-left; two pairs for `helmert`, three for `polynomial1`, four for `projective`); `georefOpacity=0.7`. In the app the user picks the points by clicking (Tools, Image Georeferencer).
- **Historical imagery:** `appMode=historical&basemapSourceA=historical&historicalActiveSourceA=wayback` (also `ge-historical`, `bing`, `hls`, `eox-s2`) with `dateA=<epoch milliseconds>`; see Historical imagery and catalogs below.
- **Panels:** `openSections=animation,drawing` and `closeSections=` fold or unfold sidebar sections; `sidebarCollapsed=true` hides the panel, for embeds; `project=<name>` loads a preset.

## Historical imagery and catalogs

`appMode=historical` shows dated imagery under the terrain, with a timeline at the bottom: one tick per date of each source on it. A view's handle sits on a tick; the arrow keys step through every tick, whatever its source.

- **Providers:** `timelineSources=wayback,ge-historical,bing,hls,eox-s2` picks which contribute ticks (Esri Wayback since 2014, Google Earth historical, Bing, NASA HLS and Sentinel-2 at medium resolution). `historicalActiveSourceA=<id>` and `dateA=<epoch ms>` put view A on one of them at a date.
- **Catalogs:** `timelineCatalogs=<ids>` adds every item of a catalog covering the view as a tick: `cat-oam` (OpenAerialMap), `cat-maxar`, `cat-vantor`, `cat-noaa`, `cat-planet` (post-crisis open data), `eli` (OSM Editor Layer Index), `cat-agol` (ArcGIS Online), `cat-allmaps`, `cat-mapwarper`, `cat-wikimaps`, `cat-slub`, `cat-usgs-topo`, `cat-corona` (old maps), and about 70 national archives such as `cat-ign` (France), `cat-swissimage` and `cat-swiss-maps` (Switzerland), `cat-kartverket` (Norway). The full id list is on https://terrain-viewer.iconem.com/docs/features/historical-imagery/. Items are found at open time, so a link carries the catalog, not the item.
- **Before and after:** `splitStyle=side-by-side&basemapSourceB=historical&historicalActiveSourceB=wayback&dateB=<epoch ms>` puts a second date next to the first.
- **Old maps on 3D terrain:** an Allmaps Georeference Annotation URL (`https://annotations.allmaps.org/maps/<id>`) in `addOverlayUrl=` drapes the map as an overlay; a David Rumsey detail page URL works too. Tilted views draw it from Allmaps' tile server, flat views warp it in the browser.
- **Which datasets cover a place:** `coverageOverlays=library` draws the footprints of every terrain dataset of the library on the map (`mapterhorn` for Mapterhorn's sources, `basemapLibrary` for basemaps, `allmaps` for the old maps in view); Sources Coverage in the sidebar lists them ranked by overlap with the view. See https://terrain-viewer.iconem.com/docs/features/coverage-overlays/.

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

## More parameters

- **Several modes in a split:** `vizSync=false&vizViews=…` lets each view keep its own modes; `splitRatio=0.5`; `matchColorsToA=true` matches a view's colours to A.
- **Colour relief range:** `customHypsoMinMax=true&minElevation=0&maxElevation=40` (metres), `colorRamp=<name>`, `invertColorRamp=true`; each mode has its own `…ColorRamp`, `…Min`, `…Max`, `…InvertColorRamp` (`slopeMinDegrees`, `lrmMin`, `svfMax`…).
- **More modes:** `showTri=true` (ruggedness), `showRoughness=true`, `showLocalDominance=true`, `showShapeIndex=true`, `showBlobness=true` (section switch `showTerrainAnalysis` or `showReliefVisualization` as for the others); `showBuildingShadows=true` casts building shadows with the sun; `showPlaneSlicer=true&planeSlicerValue=<m>` floods below an elevation.
- **Contours:** `contourMinor=10&contourMajor=50` (metres), `showContourLabels=true`; `showGraticules=true` for a lat/lng grid.
- **Pills and chrome:** `showCaptureDatePill=true` dates each view; `pillTerrain`, `pillBasemap`, `pillModes` choose what the pill says; `minimapMinimized=true`; `showBackground=false` hides the sky.
- **Fence the map:** `maxBoundsMode=view&maxBoundsBuffer=0.2` keeps the camera near the place.
- **Opacity:** `basemapSourceOpacity`, `overlaysOpacity`, each mode's `…Opacity` (0 to 1).

## Reference

- Every parameter, with types and defaults: https://terrain-viewer.iconem.com/docs/openapi.json and https://terrain-viewer.iconem.com/docs/dev/url-api/
- What each mode shows: https://terrain-viewer.iconem.com/docs/features/visualization-modes/
- Historical imagery, the timeline and its catalogs: https://terrain-viewer.iconem.com/docs/features/historical-imagery/
- Bring your own data (tiles, WMS, COG, STAC, old maps): https://terrain-viewer.iconem.com/docs/features/byod/
- Which modes published studies use, by subject and with the study areas as links: https://terrain-viewer.iconem.com/docs/resources/research-references-table/
- nDSM, canopy height and change between surveys: https://terrain-viewer.iconem.com/docs/features/ndsm-and-comparison/
- The whole documentation for agents: https://terrain-viewer.iconem.com/llms.txt
- In the app, the GeoTIFF button's menu exports the DEM and any mode as a georeferenced file.
