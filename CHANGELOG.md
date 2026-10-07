# Changelog — The Weekend: Historical Catalogs, National Archives, Old Maps

<!-- released: 2026-10-05 -->

New between Friday 2 and Sunday 5 October 2026; details in the entries below.

- **Historical catalogs on the timeline**: every item covering the view becomes a tick; pick it as the view's basemap, or keep it.
  - **Post-crisis open data**: OpenAerialMap, Maxar and Vantor, NOAA, Planet.
  - **Community indexes**: OSM Editor Layer Index, ArcGIS Online, NextGIS QMS.
  - **National mapping agencies**: about 70 archives by continent and country (IGN, swisstopo, Kartverket, German and Austrian Länder, Spanish and Italian regions…).
  - **Old maps**: Allmaps, David Rumsey, Wikimaps, Map Warper, SLUB, USGS topo, CORONA.
- **Remove paper**: scanned maps lose their sheet, colour detected per map.
- **Sources Coverage**: one tree, footprints on the map, results ranked by overlap.
- **Search by name** across the checked catalogs, anywhere: "Cassini" finds the Rumsey sheets georeferenced in Allmaps, IGN's Cassini map, Map Warper's sheets.
- **Out of beta**: the Sun Shadow Calculator and the STAC catalog search are always on. "Georeference Image" is now **Image Georeferencer** (still a beta).
- **Search by name** hits take the place of the view's rows (fold per catalog, Fit); **Use** adds the map as an overlay on the basemap.
- The timeline's **Catalogs** picker opens on its four groups.
- **Auto** in Add Basemap and Add Terrain: paste any URL (tiles, WMS, COG, STAC, Allmaps, IIIF…), the type is found and filled in.
  - Allmaps viewer links, signed URLs (`.tif?sig=…`), and URLs without an extension (headers, then the first bytes; never the whole file); a map pasted in Add Terrain offers to open Add Basemap with it.
- **STAC**: Planet's Data API as a catalog: the access token (Settings → API Keys) to search, and each scene added as XYZ tiles from tiles.planet.com signed with the API key (items carry only a thumbnail); static catalogs filtered by the date range too. A dev page on the search internals and why it uses no client library.
- **Auto** also takes links to pages about the data: Source Cooperative repositories, stac-map and STAC Browser links.
- **Timeline picks** join your sources as overlays and go on the view as one (on by default; off, a pick is the view's transient basemap); scrubbing and arrow keys still swap the basemap; a kept tick is an overlay; overlays show as grey marks on their ticks.
- **Search results** in a split: a view grid per row puts a hit on any view of the layout.
- **Timeline overlay pills**: one per view on an overlay's tick (tinted with the view's colour when borders are coloured); drag one onto another tick to swap that view's overlay.
- **Allmaps maps** can be drawn from Allmaps' tile server (Draw it, in their dialog): cached, faster on slow image servers, and they tilt and drape; tilted views switch to it by themselves instead of hiding the map. A David Rumsey link starts there.
- **National datasets** also as a tablecn data table, next to the original, for comparison.
- **Beta flags** are local settings, not URL parameters: a link does not switch them and Home does not clear them.
- **Iso-line, slope at a value**: Cliff teeth, on a simplified outline of the steep areas (the slope blurred over 4 px, specks under 40 px dropped), one tooth every 28 px.
- **WMS zoom ranges, found by asking the server**: adding a WMS layer from the list, or pasting a WMS URL, probes the zooms it draws at (one tile per zoom, empty images ignored) and fills Min and Max Zoom, still editable; a Detect button redoes it at the map's centre. Beyond those zooms the map overzooms real pixels instead of showing nothing.
- **Library**: BRGM's geological maps of France, the scanned sheets (1:1M to 1:50k, one scale-dependent service) and the harmonised 1:50k vector map, as overlays with their zoom ranges.
- **Timeline**: every tick is a place for a view's handle, providers and catalog items alike; the view stays on Historical Imagery and the tick becomes its source (a SWISSIMAGE flight, a Map Warper sheet, a Wayback release). The full-colour handle is the view's basemap; the lighter pills are its overlays, and dragging one swaps that view's overlay, replacing the old item in your sources when no other view uses it. The active view's handle is ringed in every layout; pressing a handle or a pill selects its view.
- Fixed: the timeline panel crashed the app (\"Rendered fewer hooks than expected\") when a view in a split switched to a non-historical basemap while an overlay drag state existed.
- A pasted WMS GetMap in another CRS (Lambert-93, a national portal's copy) is asked in EPSG:3857 with one tile's size, so it draws instead of staying blank.
- A toast says when a tilted view switches Allmaps maps to the tile server.
- **Timeline overlay pills** are bigger, centred on their tick and in front of it; the tick a dragged pill would land on is ringed; every dated overlay on a view gets a tick, found by the catalogs or not.
- **Shared links** carry catalog items (ArcGIS Online, STAC, Planet scenes, national layers) by URL with their extent and zooms; a Planet key never travels (`{planetKey}` placeholder, filled by the recipient's key).
- **Image Georeferencer**: a Fit button in the image window's title bar brings the whole image back.
- **Overlays order**: in edit mode, drag the handles; the first of the list draws on top.
- **Shared links** rebuild the catalog overlays they name (Allmaps maps, David Rumsey sheets, Map Warper and Wikimaps maps) on the recipient's side.
- **STAC catalog picker** is a combobox: type a name ("planet"), or paste a URL for a custom catalog.
- **Auto** reads a David Rumsey detail page: Allmaps' cached tiles of the sheet when it is georeferenced (Rumsey's own IIIF server can take minutes per tile).
- Switching an overlay off from its label no longer moves the camera. Allmaps overlays hide while the view is tilted (the layer draws flat only) instead of landing in the wrong place.
- **Desktop**: the light build updates itself too, from its own `desktop-latest-light` feed (the two builds could not share one release). **About**: the version answer scrolls into view. **Slides**: screenshots are no longer cropped (a cropped one keeps the side panel); on localhost the Slide decks page links the editor too.
- **Docs**: Tools, Embedding / iframe, nDSM / Comparison renamed; the Dev group starts folded; the embed example on Mapterhorn; no redirect pages for old addresses.
- **Sources Coverage**: Controls, Catalogs and Search results as three folds; a box on Terrain, Basemaps · Static and Basemaps · Historical takes the whole section; a row with a thumbnail shows it on hover.
- **Iso-line** on any measure, with an exact fill.
- **Building shadows**, **modes per view**, **Image Georeferencer**, a **STAC catalog** of every source.
- **Slide decks**: five presentations, live and as PDFs.

# Changelog — Catalogs on the Timeline, Building Shadows, National Archives

<!-- released: 2026-10-05 -->

#### TL;DR
- **Catalogs on the historical timeline.** A tree next to the source pills: OSM Editor Layer Index, OpenAerialMap, Maxar and Vantor Open Data, NOAA, Planet disaster data (HOT STAC and source.coop), Map Warper, Wikimaps Warper, SLUB Kartenforum, USGS historical topo maps, ArcGIS Online, and about seventy national, regional and city archives (IGN Remonter le temps, swisstopo, Catalonia, Spain, the German Länder, Austria, Swiss cantons, Belgium's NGI maps 1860-1994, Slovenia, Italian and Spanish regions, Toronto, Ottawa, Seattle, Washington DC, New South Wales, Taiwan...). Items covering the view become ticks; picking one makes it the view's basemap and keeps its handle.
- **Building shadows** (Lighting Effects → Shadows → Buildings): OpenStreetMap buildings' shadows swept on flat ground on the GPU, live with the sun.
- **Sources Coverage** lists live what the shown overlays hold for the view, ranked by overlap; the click list is ranked the same way.
- **STAC catalog of every source** at `/docs/stac/catalog.json` (eight collections, about 3,500 items).

### Features
- Catalogs picker: fold or expand all, item footprints on the map, a filter by the timeline's window; a national group that opens by itself where its sources cover the view, sources that miss the view dimmed; tick tooltips name the source, its date and the item.
- Every source pill can be off, leaving the catalogs alone; a catalog item much smaller than the view is framed when picked; every item picked joins Your basemaps in the coverage tree with a zoom-to-fit button.
- Basemap library: Esri World Imagery Clarity, basemap.at, ČÚZK and Geoportal.gov.pl current orthophotos, the 1966 and 1969 CORONA satellite photographs of Taiwan.
- Overlays: an opacity pill per overlay and one for all (a vertical slider opens on the pill).
- 2D mode: a right-drag shows why the view does not tilt, with a Switch to 3D button.
- A map click while the elevation picker, the sun calculator or a drawing tool is active no longer opens the coverage list.
- The coverage tree is always open in Sources Coverage (Terrain, Basemaps · Static, Basemaps · Historical, the last one being the timeline's catalogs tree, Allmaps and QMS as footprint-only rows), with a master switch and a **Follow the view** switch; a tick's hover card names the item, its resolution and licence, shows a thumbnail where the catalog has one, and puts it on any view as basemap or overlay, or keeps it among your sources (picked items are transient otherwise).
- **Iso-line**, the third group of Contours & GeoGrid: a line from **any measure** (the elevation, every terrain-analysis and relief-visualization mode with its own settings, the Phong, Matcap and shadow brightness) **at a value** (an iso-slope at 30°, a sky-view factor of 0.8, a flood level), with a raster fill of the area above that stops at the line, or **every interval** of the measure (contours of the slope every 10°); the slider sized to the measure's unit; works on every terrain source, the WMS ones included.
- Source lists: a reading mode with an info button (every field, fit to extent) and the overlay's opacity pill at the right; the pencil switches the edit mode on (edit, delete, Batch edit JSON, Ctrl+Enter saves). The coverage tree's roots: post-crisis open data, community indexes, national catalogs, old maps; outlines-only footprints; the coverage and source-info parts fold.
- The coverage tree starts folded (only Terrain, Basemaps · Static and Basemaps · Historical open) and remembers what you open, in the section and the timeline's Catalogs select alike; **Expand all** and **Within the timeline window** sit above the tree with the other switches; the switches ask the catalogs again. Community indexes (ELI, QMS, ArcGIS Online) sit under Basemaps · Static, 3D and LiDAR second under Terrain, the national catalogs under a continent then a country (ISO alpha-3), the old maps flat with Allmaps and Rumsey first.
- **Search results** under the picker: one foldable, single-scroll tree of everything the overlays and the checked catalogs hold for the view, catalog items with their dates and resolutions, each with a Use button; the historical items' footprints on the map (Map Warper, the archives) are hovered and clicked like the overlays.
- **Allmaps, dated maps in view**: a catalog that dates Allmaps' maps from their IIIF title or manifest and puts them on the timeline; Allmaps footprints no longer vanish when zoomed into a city (the area window keeps city plans).
- Source rows: a hover card with the type, the index it came from, the ground resolution (declared, or estimated from the max zoom), attribution and description; the resolution after the name and in every metadata dialog; the Source info part splits into Basemap (above) and Terrain, each basemap row with its provider prefix, type and resolution and an info button to the full metadata dialog (long URLs no longer overflow it).
- Tick card: one view grid (basemap, or overlay for a warped map), a frame-extent button; the arrows walk every tick on the axis from the one the view shows, and a view keeps its item when the catalogs' answer for a new place no longer lists it.
- Batch edit is a braces button left of the pencil; the overlay opacity pill sits right after the view buttons, rounder and taller.
- Iso-line, second pass: the fill and the line are one set of polygons (marching squares on the measure tiles, `isoband://`), so the fill stops exactly on the line; the tiles follow the terrain source's zoom (a WMS DSM to zoom 19, as sharp as the shading); the measure menu shows names; the Phong measure takes the sidebar's strengths and Fresnel rim (the raster Phong tiles draw the rim now too); the slow horizon modes are out.
- Historical tree: Community indexes (the Editor Layer Index first, ArcGIS Online, NextGIS QMS) are one root shared by the sidebar and the timeline's select; the ELI footprints group is back under Basemaps · Static; ELI items have footprints on the map.
- **Remove paper**: a scanned map's paper turns transparent, warped Allmaps maps and tiled old maps alike (`unpaper://` on Map Warper, Wikimaps, SLUB, USGS and the national map series); each map's paper colour and threshold come from its own image (masked luminance histogram, Otsu split, the paper peak in colour-distance space); maps without light paper are left alone; the slider scales every detected threshold.
- Allmaps dated maps: the archive's own date (IIIF manifest first, a pre-1950 title year else), never the georeferencing's; **Remove the maps' paper** turns a warped map's background transparent (threshold, colour).
- Tick card: Fit and Keep side by side, Keep also puts the item on the view; **Picks join my sources** switch (off by default); **Active sources' extents** draws the sources on the views as dashed outlines and the rows show z≥N below their min zoom; every list and card prefixes where an item comes from (FLAI, OpenTopography, the libraries, QMS…) and shows its resolution, estimated from the max zoom when not declared.
- CORONA Atlas of the Middle East (CAST, 1963-1972) on the timeline; resolution pills default to VHR; the per-overlay opacity pill drags from the first press; the elevation profile's wheel no longer scrolls the sidebar; the coverage tree's rows and Allmaps maps have extents for zoom-to-fit; the IoU shown in the coverage lists.
- Allmaps maps drawn at the right place with a padded camera (the sidebar's): @allmaps/maplibre patched to take the canvas centre, not the padded one.
- Docs: which services can be added and which cannot, with the reason; the advocacy page gains the communities beyond OSM and GIS, the FATMAP alternatives and a #30DayMapChallenge plan; the STAC catalog opens in STAC Map and STAC Browser; an ELI contribution prepared by licence class.

# Changelog — Old Maps, QMS Coverage, Docked Profile

<!-- released: 2026-10-04 -->

#### TL;DR
- **Old maps (Allmaps).** A coverage overlay draws every georeferenced historical map in the view (Allmaps, David Rumsey included), and any of them drapes as an overlay, warped from its IIIF Georeference Annotation. The Add Basemap dialog takes such an annotation URL too.
- **NextGIS QMS coverage.** The catalog's services whose extent touches the view, sized to the zoom, each one click from being the basemap. The list under a clicked point has a filter.
- **Elevation profile.** Hover the chart for the point on the map, zoom and pan it, dock it as a bottom panel; the picker now works on phones.
- **Split pills** name the terrain, basemap or viz modes If differs, Always or Never; **Sources Coverage** sits under Terrain and Basemap; **Fresnel rim** in Phong; **threshold outlines** in contours (beta).

# Changelog — Modes per View, Image Georeferencer, Desktop Apps

<!-- released: 2026-10-02 -->

#### TL;DR
- **Modes per view.** In a split or grid, switch **Sync viz modes across views** off and every mode and sub-mode checkbox becomes the view grid: slope on C, contours on B, matcap on D. Clicking the name of a mode, or of a terrain, basemap or overlay source, switches it on for every view at once, and off everywhere when it already is on all of them; a sub-mode brings its group along; swapping views keeps the assignment. The pill under each view names only what sets it apart (its terrain or basemap when the views differ, its modes), and **clicking a pill selects that view**: every grid in the sidebar collapses to that one letter, so a mode or source then applies to the selected view only (Esc, the pill or its x deselects). Contours and graticules now draw on every view. [Split modes](/docs/features/split-modes).
- **Image Georeferencer.** Place a plain PNG or JPEG, a figure or a scan, on the map from point pairs clicked on the image and on the map in any order, in a floating window; similarity, affine or projective fit with residuals; drag the points; world file export; save the result as a basemap overlay, local pictures included, and reopen it to edit. Built on Allmaps' transform library; switch it on under Settings → Beta.
- **Desktop apps.** Windows, macOS and Linux bundles (Electrobun) built weekly on the [desktop-latest release](https://github.com/Iconem/terrain-viewer/releases/tag/desktop-latest): a self-contained Setup per platform plus a portable folder, each with the documentation bundled or online; the installed full build updates itself. [Desktop](/docs/features/advanced/desktop).
- **Phong with up to three coloured lights.** Light 1 is the app light; lights 2 and 3 have their own direction and colour, drag as pills of their colour on the light pad, and default to blue from the north-east and orange from the south-east. A **Fresnel Rim** slider adds the view-dependent grazing-angle glow on slopes that turn away from the camera (live renderer).
- **Threshold outlines** (beta): a third contour reference draws one vector outline where the terrain crosses a value, 1.5 m on an nDSM for canopy and buildings, a flood level on a DEM; exports as GeoJSON like contours.

### Features
- **Duotone NW/NE** hillshade method (grey north-west light, blue and orange north-east light, after Čučković's LiDAR hillshade) and a matching **Duotone Sphere** matcap.
- **Overlays per view and stacking.** With per-view basemaps on, each overlay row gets the view grid; an overlay can draw under the relief layers, over the hypsometric tint, or on top of everything (Edit Basemap → Draw it).
- **OpenTopography coverage** overlays (rasters and point clouds, DOI links) nested under 3D and LiDAR coverage.
- A terrain or basemap picked with the split off is set on every view, so a later split opens on it; in a split, clicking a terrain source's name sets it on every view.
- Walkthrough: a **Data Layers** step and a **Modes per View** step; the Terrain Analysis step lists its three groups.
- **Relief Green-Red** hypsometric ramp (the archaeological LiDAR palette) in the Classic tab; Mean/Combined curvature opens at ±1.
- The About section shows the build day and commit, and **Is this the latest version?** compares them with the newest commit and the desktop release; Source Info waits for zoom 5 before listing datasets.
- Share: **Name my sources by URL** writes your own remote terrain, basemap and overlay sources into the link by URL and type, with their names, so the recipient's app loads them without having them in its library (local files and entries needing more than a URL stay by id, and the dialog says which).
- COGs read in the browser are resampled bilinearly when a tile is upsampled from a coarser overview (a patched geomatico reader), instead of the nearest-neighbour blocks a 10 cm DSM showed between overview levels.
- Docs: [Research References](/docs/resources/research-references) with the table, [Post-Crisis Response](/docs/dev/post-crisis-response), [Advocacy and Community](/docs/dev/advocacy); the Geopera Bhotekoshi surveys are named as such in the library.

### Fixes
- Hypsometric ramp tabs no longer jump or go blank when a ramp name exists in several collections, or after a tab click.
- No more z13–18 404s from Mapterhorn at a world view: the per-location coverage probe waits until the view is close enough for it to matter.
- Local pictures saved as overlays are restored from browser storage after a reload, like local COGs.

# Changelog — MapLibre 6, and Compare and Blend Everywhere

<!-- released: 2026-09-25 -->

#### TL;DR
- **MapLibre GL JS 6.** The renderer under everything moves from 5.24 to 6.11: a rebuilt terrain render‑to‑texture cache, less DEM allocation, one projection upload per frame, mipmapped draping at high pitch — most modes simply feel faster. The port took namespace imports, a worker URL for Vite, an accessor for the transform that `Map` no longer exposes, and three real fixes: sources with an undefined `minzoom` were rejected and every derived layer vanished; a shared link could land at a different zoom and centre than it asked for, one load in three, because the padding ease re‑solved the camera from a zero elevation whenever DEM tiles beat it; and the live Matcap and Phong layers showed MapLibre's terrain skirts as white dashes along every tile seam on the globe — they now draw their own skirts, the same construction MapLibre uses. MapLibre 6.10 also fixed the half-pixel offset between 3D terrain and hillshade built from the same DEM ([#8420](https://github.com/maplibre/maplibre-gl-js/pull/8420)): both now sample cells at their centres, so relief and mesh line up. Verified against a 5.24 baseline on 82 headless scenarios. What changed and why is on the [tech stack](/docs/dev/tech-stack), [camera sync](/docs/dev/camera-sync) and [lighting effects](/docs/dev/lighting-effects) pages.
- **Compare and Blend in terrain mode too.** Split style, the grid picker up to 4×2, blend mode and opacity, Match Colors, border colours and Capture Date, below Visualization Modes; General Settings loses its lone Split Mode toggle. A header button cycles Off, Overlay and Side without unfolding the section, and the Terrain and Basemap rows show one pill per view for whatever grid is picked.
- **Protocol registry: every mode on every source.** One protocol registry now dispatches every custom tile scheme to every consumer, so each viz mode, the mound detector, contours, the GeoTIFF export and the 2D elevation picker work on every terrain source type: VRT mosaics, ArcGIS LERC, Cesium quantized mesh, WMS float32, TileJSON and differences (nDSMs). How it works is on the new [custom protocols](/docs/dev/custom-protocols) page.
- **Undo and redo.** `Ctrl+Z` and `Ctrl+Shift+Z` walk every setting back and forth, and the camera too when it had been still for a minute.
- **Export what you see, layer by layer.** The GeoTIFF button gets a menu. **Visible layers…** opens a tree of everything on the map, visible and not, each branch or group ticked or unticked at once: contour lines and mound candidates as GeoJSON; the DEM; every Terrain Analysis and Relief Visualization mode as its raw values (slope and aspect in degrees, LRM in metres...) in float32; hillshade, hypso, lighting, the basemap and the coloured modes as rendered RGBA; and the whole composite. Exports come out at exactly the view, at the screen's own size or a custom longest edge; values can be raw, coloured through the mode's ramp, or both; images can be GeoTIFF, PNG or JPEG with world files. A Screen resolution reads the tiles already cached and takes seconds, the DEM included, which was slow because it always fetched up to the 4096 px Max Resolution. The DEM GeoTIFF itself was broken until now: the library writing it stored one byte per value, and GDAL could not open the file.
- **Libraries.** react-map-gl 8.1.3 for MapLibre 6; the COG reader 0.8 to 0.10, with GDAL-style transparency and alpha bands, fast reads of LERC- and WebP-compressed COGs, a NaN nodata fix and batched range requests; maplibre-contour 0.1.1, which fixes contour tiles in MapLibre Native (a protobuf tag error) and adds a default export.
- **Camera animation that keeps its word.** A pose now records the camera target's elevation and playback interpolates it with the rest — centre, zoom, pitch, bearing, roll, field of view — so a flight from a summit pose to a valley pose no longer bobs over every ridge or holds the start height. Poses captured before this keep the old behaviour until re‑set.

### Features
- **nDSM operands are searchable.** The First and Second source pickers of a difference source are comboboxes: type part of a name (lidar hd dtm) instead of scrolling fifty entries.
- **Bookmarks: Featured open on a first visit.** The Featured and Your Bookmarks folds start open and remember how you left them.
- **Built-in terrain rows as tight as your own.** The info button on a built-in terrain source was 36 px where every other row button is 32; the list had a looser rhythm than Bring Your Own Data.
- **The WMS queue widens for HTTP/2 hosts.** Six GetMaps at a time is the browser's HTTP/1.1 rule; once a host answers over HTTP/2 or 3, up to 24 go out together.
- **Slope, aspect and the relief modes over a WMS fetch one GetMap per tile.** The kernel's halo used to mean the tile plus its eight neighbours; a WMS answers any bbox, so the tile is asked with its margin in one request. Aspect over IGN LiDAR HD in a 2 × 2 view: 4 GetMaps instead of 16.
- **Bookmarks open like links.** Middle-click, Ctrl-click or Cmd-click a bookmark, in the list or the gallery, to open its view in a new tab; a plain click restores it in place as before. The gallery button works before you have saved anything, since the Featured views are in it.
- **Filter your own sources.** With more than five sources under Bring Your Own Data, a filter box at the top of the terrain and basemap lists narrows them by name or description. It is not saved in the link.
- **nDSM and change get their own library category.** Height-above-ground differences and the six before/after events, with the surveys they need, now sit together in the terrain library instead of being graded against Mapterhorn, where most of them landed in the folded "not better" list.
- **Compare dates from the timeline.** A button at the left of the timeline's header puts historical imagery on every view, syncs the source pills, and switches the split between side by side and overlay; each view keeps its own date.
- **IGN LiDAR HD in 1024 px tiles.** A WMS source can set its tile size (`tileSize`, default 512); the IGN LiDAR HD terrain and surface models now ask for 1026 px GetMaps, which IGN answers in 0.8 to 1.7 s where four 514 px ones took 3.9 to 4.8 s, one slow tile of four setting the pace. The difference reads a larger-tiled operand from its parent tile at the same pixel density, and its zooms are counted in its own tiles.
- **Google Earth's newest capture.** A view asked for a date past the newest Google Earth capture at its place (a link saying "today") resolves to that capture once the dates are in, so the timeline shows the real date of the imagery.
- **Endless middle-drag on the timeline.** Panning the zoomed-in timeline with the middle button now locks the pointer, Blender style: the cursor hides and the drag goes on past the screen edge until the button is released.
- **Documentation from the sidebar.** A book button in the sidebar header, next to the layers and settings buttons, opens the docs; there and in the Settings dialog, middle-click opens them in a new tab.
- **`?place=` names the view.** A link can set a place name, shown expanded in the search box as its placeholder; the docs' Research References links use it, with the minimap open, so an opened study says where it is.
- **Six events, before and after.** The library gains surveys from before and after the Kaikōura 2016 earthquake (LINZ lidar, +0.8 m of coastal uplift), the Kīlauea 2018 lava, the first weeks of Fagradalsfjall 2021 and Columbia Glacier 2012–2021 (ArcticDEM strips), the Chamoli 2021 rock and ice avalanche (2 m composites, −90 m at the scar) and the Ridgecrest 2019 earthquakes (stereo DSMs), each with its difference. The [Research References](/docs/resources/research-references) page opens them on a diverging ramp from the studies of each event.
- **Exports read areas, not tiles, where a source allows it.** WMS, VRT and difference sources register region readers in the protocol registry: the IGN LiDAR nDSM now exports in two WMS requests and seconds. The export dialog says what a batch will read, once, under the resolution. Matcap, Phong and hard shadows export from their own tiles at any size and in any view.
- Graticule labels in every view mode, 2D, 3D and globe, while the view is not tilted: tilted, they pile up and drift off their lines, so they hide until the camera levels out.
- **Map libraries.** Alongside MapLibre 6: **react-map-gl 8.1.3**, which adds MapLibre 6 support, fixes an app-wide crash when terrain properties are undefined, and sets zoom and pitch constraints in a valid order. **maplibre-cog-protocol 0.8 to 0.10**: transparency that follows GDAL's rules, with alpha and internal mask bands honoured; fast reads for aligned, LERC- and WebP-compressed COGs; a nodata guard that handles a NaN `GDAL_NODATA`; COG reads batched through 64 KB blocks instead of one range request per tile read; clipping to a GeoJSON mask. **maplibre-contour 0.1.1**: a protobuf fix for MapLibre Native, a default export and dependency upgrades; no API change.
- **Export, 2D picker and contours on every source.** The GeoTIFF export, the 2D elevation picker and profile, and the contours layer now resolve a source through the same client upstream the visualization modes read, so VRT, LERC, quantized-mesh, difference (nDSM), WMS and TileJSON sources export, sample and contour like a plain tile source. Contours over one of the app's own tile schemes run on the main thread; a remote COG read in the browser contours in the same worker a local COG file uses, no titiler.
- **Undo and redo, app-wide.** `Ctrl+Z` walks back any setting change and `Ctrl+Shift+Z` (or `Ctrl+Y`) forward: visualization modes, ramps, sources, split layout, the timeline date, detector thresholds. A camera move is a step only after a minute of stillness, so a run of pans never buries a setting; a slider drag counts as one step.
- **Mound detector: pits too.** A Mounds, Pits, Both toggle in Mound Candidates. One pass over the relief signal finds both: its maxima are mounds, its minima pits (quarries, sinkholes, craters, cisterns), drawn in their own colour, blue by default, beside the red mounds. Nodata is now excluded, so the edge of a LiDAR block no longer reads as a cliff lined with false mounds inside and giant false pits outside.
- One handler run per tile URL in flight: when two sources or two modes ask a custom protocol for the same tile at the same moment, the second waits for the first and gets a clone, instead of decoding or reprojecting twice.
- Drawn features show a hand cursor on hover in select mode, and the detector and coverage overlays no longer wipe Terra Draw's cursor on every mouse move.
- In a split layout, clicking a terrain source's name sets view A to it and zooms there, as it already did with split off.
- The stalled-tiles toast fires after 20 seconds instead of a minute, carries a **Reload** button, and now also fires when the very first load wedges: it used to be installed only after MapLibre's `load` event, which a stuck tile queue never reaches.
- VRT mosaics: a range read that times out or drops gets five attempts over about six seconds, and a tile that still fails is reported as failed instead of drawn with a hole. The hole used to stay cached for the session, which left blank bands in derived modes and straight "0 m" contour edges that never healed. A source file that is really gone still reads as a hole.
- Nepal's four Bhotekoshi COGs read straight from NextGIS in the browser now that the server exposes `Content-Range`; their titiler pins are gone.
- Hypsometric tint: two generic diverging ramps near the top of the classic list, blue‑white‑red and blue‑transparent‑red, for nDSMs and change layers; **Set from viewport** waits for a slow source's tiles to decode and says so if none arrive.
- Graticule auto spacing halves with every zoom level, so each zoom's lines nest inside the next.
- Contours + GeoGrid and Background + Fog/Sky rows get the same go‑to arrow as the other modes.
- Planet monthly mosaics offer only the months the key can see, read from the Basemaps API (a 2020‑onward grant no longer shows 2016 ticks that 404).
- Strava's global heatmap as an overlay in the Library, through a public CORS proxy, capped at z11.
- A shared link seeds a derived source's operands even when the derived entry is already in the browser.
- FLAI's coverage footprints are simplified at 20 m: 270 KB on the wire instead of 480.

### Fixes
- **Google Earth Historical keeps the date you set.** A view set to 2010 used to jump to newer imagery on zooming in: finer tiles have their own capture lists, and the nearest date to 2010 in one of them could be 2012. A tile now shows its newest capture on or before the date, and only falls forward when it has nothing that old.
- **Split views stay in sync under constraints.** The zoom range and the map-bounds fence used to come from view A alone, while each view's MapLibre clamped the camera the sync handed it: a view whose own source stopped earlier, or a narrower pane under the same fence, ended at another zoom or centre. Every active view's sources now set one shared range (the tightest) and one shared fence (their overlap, or their union when they do not overlap); a source click fences every view before flying; and the idle reconcile, when a view could not follow, pulls the others to it instead of fighting every idle.
- **Export project: the whole row toggles the box.** The count line under a category name is part of its label now.
- **Esri imagery shows the parent tile where it runs out.** Esri World Imagery answered tiles past its imagery with a grey "Map data not yet available" JPEG; asked with `blankTile=false` it returns a 404, and MapLibre shows the lower-resolution tile enlarged instead.
- **Fewer stalled IGN tiles.** A WMS GetMap that has not answered in 25 s is asked again, up to three times (IGN often returns the same tile at once the second time), and GetMaps queue six at a time per host so a request waiting its turn is not counted as hung.
- **3D terrain comes on while slow sources are still loading.** Each view's setup waited for MapLibre's `load`, which only fires once every tile of every source has arrived: with the IGN nDSM, whose WMS takes up to minutes a tile, it never came and the view stayed flat. It now starts as soon as the style is in, and terrain fills in tile by tile.
- **Wayback shows the date asked for from the first paint.** A view opened on a date picked its release by release date before the real capture dates had arrived, then held that pick until all of them had: at Palmyra, 2014 showed 2009 imagery. Only releases with a known capture date are picked now, and a clearly closer one replaces the held pick. While a new place's releases and dates load after a pan or zoom, the imagery on screen stays as a placeholder instead of the layer going blank.
- **No more spikes along the edges of the IGN nDSM.** The difference read its WMS operands without the sources' nodata settings, so the -9999 sentinel's reprojection smear counted as ground and DSM minus DTM stood up in spikes of up to 1000 m along coastlines and coverage edges. The operands now carry the settings, and the WMS reader marks its holes as nodata (the fill height stays for 3D terrain), so differences, derived modes and exports skip them; an export writes them as nodata instead of 0 m.
- Curvature and shape index exports were 1000 times too large: their tiles store the value ×1000, and the export now divides it back out.
- COG DEM exports were always square, whatever the view's shape; they now match the view.
- The Data layers picker: a card with a one‑line blurb drew a band above its thumbnail; turning off a group's last card turns the group off.
- The ESRI Wayback pill kept spinning after it was switched off.
- The symmetric hypsometric range snapped back to a value the user had not set: the auto range re‑ran on its own state write.
- The 360° orbit eased in for a second and straight out again.
- Switching 3D to globe with graticules threw inside geogrid, which reads a transform MapLibre 6 removed.
- The built‑in AWS terrarium source asked for z16 tiles that do not exist.

---

# Changelog — Data Layers as Pictures, and Shortcuts on Section Headers

<!-- released: 2026-09-24 -->

#### TL;DR
- **A Data layers picker: every visualization mode as a card with its picture.** Google Earth’s layer panel, for terrain — hillshade, hypsometric tint, contours, basemap imagery, slope, aspect, curvature, TPI, local relief, sky‑view factor, openness, matcap, phong and hard shadows — each a thumbnail of the same Matterhorn view with only the rendering changed, one click to turn it on or off. A Tools row opens Draw, Elevation picker, Sun shadow and Animation in the sidebar. Reached from the panel title bar or next to the Visualization Modes pin.
  ![The Data layers picker: every visualization mode as a card of the same Matterhorn view](/docs/screenshots/data-layers-picker.jpg)
- **Quick buttons on the foldable section headers.** Home on General Settings, the Gallery on Bookmarks, Snapshot on Download and Snapshot, the Data layers picker on Visualization Modes — whose fold, expand and pin are now one three‑state control instead of a chevron beside a pin.

---

# Changelog — VRT Mosaics in the Browser, Twenty New Sources, and Where 3D Exists

<!-- released: 2026-09-23 -->

#### TL;DR
- **GDAL VRT mosaics now stream in the browser**, no titiler needed. A `.vrt` is an XML index over many COGs, and the browser can already Range-read COGs — what was missing was GDAL's bookkeeping. IGN's RGE ALTI 1 m over France is 93 COGs behind a 40 KB index; a tile over Montparnasse takes 0.43 s. Any CRS, not just the easy two.
- **Twenty new elevation sources**, every endpoint verified live before it was added: Hawaii's 1 m and Maui's 0.3 m LiDAR as LERC tiles, New Brunswick and Alaska IfSAR (DTM *and* DSM, so 3DEP finally has a surface-model counterpart), South Australia's 0.5 m River Murray LiDAR, Hong Kong, New York, Dar es Salaam's 0.5 m, JAXA's global AW3D30, and the Aguada Fenix Maya survey's canopy surface. Seven of them are ready-made **nDSMs** that pull their own operands in.
- **A slow terrain tile no longer freezes the basemap.** MapLibre queues every raster load through one budget of 16, and a custom protocol holds its slot for the whole handler — so sixteen VRT or sky-view-factor tiles left the map grey.
- **Four coverage overlays for 3D and LiDAR: Google photorealistic 3D, Bing Maps 3D, Esri Integrated Mesh and FLAI open LiDAR.** None of the four publishes a footprint you can download, so each is read from the provider’s own data — Google’s from the coverage layer behind its docs page, decoded from Maps vector tiles; Bing’s from its 3D Tiles subtree availability bitstream; Esri’s from ArcGIS Online’s search API, kept to open services of 5 km² or more; FLAI’s from every survey’s COPC octree over range requests. Click a footprint to open that provider’s own 3D view there. How each is built is on the [coverage overlays](/docs/features/coverage-overlays) page.
  ![The four 3D and LiDAR coverage overlays over Europe: Bing, Google, Esri Integrated Mesh and FLAI](/docs/screenshots/coverage-3d-lidar-europe.jpg)

---

# Changelog — Esri & Cesium Global Terrain, Faster Tiles
<!-- released: 2026-09-20 -->

#### TL;DR
- **Esri World Elevation** is now a built-in terrain source — land *and* seafloor as one continuous surface, so a hypsometric ramp reads across a coastline instead of stopping at it. The second built-in with real bathymetry. Keyless, orthometric, and streamed as LERC (Esri's float raster codec) decoded in the browser. A land-only twin, with the ocean flat at 0 m, is in the Library.
- **Cesium World Terrain** joins the Library through a new quantized-mesh reader: the triangle mesh is rasterised per tile into an ordinary elevation source, so 3D terrain and every visualization mode treat it like any other DEM. Needs a Cesium ion token (Settings → API Keys); its heights are ellipsoidal, about +48 m in the Alps.
- **Tiles render around 10× faster.** Every custom protocol now hands MapLibre an `ImageBitmap` instead of a PNG it immediately decoded again — 99 ms median down to 0.1 ms on the encode alone. This is not specific to the new sources: hillshade, LRM, SVF, the difference source and the WMS elevation services all got it.

### Features
- The **Library** lists catalogs beside datasets. **Browse** opens the catalog search on that endpoint, and a **+/−** on each row decides whether the search offers it at all.
- **Settings → API Keys** gains a Cesium ion token and a terrain-detail control for it.
- Docs: new dev pages for [LERC](/docs/dev/lerc-protocol), [quantized mesh](/docs/dev/quantized-mesh-protocol), [derived terrain](/docs/dev/demdiff-protocol), [tile caches](/docs/dev/tile-caches), [PMTiles & COG contours](/docs/dev/vendored-protocols), [camera sync](/docs/dev/camera-sync), [map bounds](/docs/dev/map-bounds-and-underzoom), [the product tour](/docs/dev/product-tour) and [layer order](/docs/dev/layer-order), plus a [Settings](/docs/features/settings) page.

### Fixes
- A Library LERC or quantized-mesh source was decoded with the wrong encoding, reading 832 354 m in the elevation picker with the hillshade and hypsometric ramp wrecked to match.
- Cesium terrain fetched one level too coarse, which showed as large flat facets: a mesh is adaptively tessellated, so matching the tile width alone left 436 vertices for 65 536 pixels.
- Tour Back/Next arrow keys did nothing on the Library step — the dialog swallowed the keypress before the tour saw it.
- The walkthrough no longer leaves its demonstration coverage footprints on the map.

---

# Changelog — Catalog Search, Coverage Overlays & OSM Vector
<!-- released: 2026-09-16 -->

#### TL;DR
- **Coverage overlays** (Source Info): see where sources have data before loading them — Mapterhorn's own per-country coverage tiles with each source's resolution on hover, the whole terrain and basemap libraries, OSM Editor Layer Index footprints, your own sources. Tree picker, drawn on every view; hover lists what covers a point, click links each dataset and can select it for view A.

  ![Coverage overlays over Europe with the hover list](/docs/screenshots/coverage-overlays.jpg)
- **STAC search** (beta, Settings → Beta) in both Add dialogs: OpenAerialMap, Earth Search, eoAPI, NASA VEDA, swisstopo, LINZ, OpenTopography, polar DEMs, Maxar / Vantor open-data events, Planet disaster releases, a federated collection search, or any catalog URL. Date range, current view, cloud cover, Web Mercator first, non-Mercator assets pinned to titiler, terrain limited to single-band elevation rasters, add as basemap or overlay.

  ![STAC search: Vantor open-data scenes over the 2026 Nepal flooding](/docs/screenshots/stac-search.jpg)
- **Basemap catalog search**: NextGIS QMS and the OSM Editor Layer Index (bundled, bumped weekly), with licence and attribution carried into Source Info and permalinks into their browsers.
- **OpenStreetMap is now OpenFreeMap's Liberty vector style** instead of raster tiles, with a 3D buildings toggle, following the basemap visibility and opacity controls.

  ![OSM 3D buildings from OpenFreeMap Liberty over a Vantor post-event overlay](/docs/screenshots/osm-liberty-3d.jpg)
- Source Info card for custom terrain sources; COG viewer links (source.coop, GeoLibre); "None" basemap, always offered; per-source titiler pin for non-Mercator COGs on basemaps too.

### Features
- Scrolling over the split gutter or its pill zooms the map underneath instead of doing nothing.
- The automatic map-bounds fence is never tighter than about a degree: a single survey's own footprint stopped zoom-out four times too early and pinned panning to the site.
- Coverage overlays are now part of the shared link (`coverageOverlays`), folded to group keys: a wholly-ticked group travels as `library` rather than as the 45 ids it stands for, and spills back out when one is unticked. `?openLibrary=terrain|basemap` opens the dataset Library. The product tour gained a step for each, and no longer leaves its demonstration footprints on the map when it moves on.
- Two keyless global relief basemaps from DLR's TanDEM-X: the 90 m radar DEM rendered as topography worldwide, and a multidirectional hillshade of PolarDEM Antarctica — the one continent with no usable optical backdrop.
- Titiler-served terrain no longer decodes and re-encodes every tile in the browser: titiler flattens nodata itself (`nodata_height`), which also drops the alpha channel — same flat holes, ~9% smaller tiles, one decode instead of three.
- The walkthrough no longer starts by itself over a shared link: a visitor who followed a link came for that view, not a tour.
- **Derived terrain: DSM − DTM** (docs: [nDSM and Comparison](/docs/features/ndsm-and-comparison)). Add Terrain gains a "Difference of two sources" type: two loaded terrain sources subtracted tile by tile into a normalised height model (canopy, buildings, or change between two dates), usable as terrain and by every viz mode like any elevation source.
- Hypsometric tint: **Symmetric Range** (one magnitude, Min = −Max) with the same controls as the curvature ramp, for height-above-ground and elevation-change grids.
- The difference source takes an optional vertical offset (metres added to every difference), a co-registration knob for references that sit above or below the finer source.
- The difference source's zoom ceiling is the finer operand's declared max zoom plus two levels (titiler-pinned operands used to contribute no range at all, so the coarser operand set the cap).
- Map bounds: a source footprint under one degree across is padded by its own extent on every side before it fences the camera, so a single survey can still be seen in context (Settings → Map Bounds → None removes the fence entirely, and `maxBoundsMode=none` in a link).
- Client-computed viz modes and the difference source honour a source's titiler pin (they tried the in-browser reader on pinned files and got nothing), and pass the source's nodata to titiler.
- Titiler-served terrain no longer shows 10 km cliffs and pits along nodata edges: its tiles pass through a small fix-up that refills transparent (nodata) pixels as flat 0 m, flagged so the app's own decoders still see holes.
- In-browser COG reader: nodata cells are marked (alpha 254, value unchanged) so the difference source treats a local COG's holes as holes instead of 0 m.
- GEDTM30 no longer crashes the map: a footprint spanning the full 360° of longitude reached MapLibre's max-bounds through the map's own prop and threw (reproduced on the served bundle); every max-bounds value is sanitised now. The difference source writes 0 where either side has no data (flagged for the app's own decoders), and the hypsometric tint paints the DEM floor transparent.
- The difference source's zoom range is now the finer operand's, so the upsampling of the coarser one actually engages; the symmetric hypsometric slider shows its 0 / max bounds; native title tooltips from the last days (date pill, swap arrows, 3D badge, coverage button, file name) are proper tooltips.
- The difference source upsamples the coarser operand from its nearest ancestor tile (bilinear, up to 6 levels), so a 30 m DEM under a 0.5 m DSM keeps working past the DEM's own max zoom; a footprint that pokes past the world (GEDTM30) no longer crashes max-bounds.
- `pmtiles://` tile archives as terrain/basemap tiles, and a first library entry using it: Smart Maps GEL, NASADEM 30 m as CC0 Terrain-RGB. Library entries already added to a browser now follow the shipped library's fixes on load (a GEDTM30 added before its nodata fix stayed broken).
- Library: derived height-above-ground entries for France (IGN Lidar HD DSM − DTM) and the Netherlands (AHN DSM − DTM), which bring their operands along; and the Bhotekoshi 2026 flood reconstruction (geo-pera): post-event 0.5 m DSMs and 2 m elevation-change rasters for the Rasuwagadhi-Timure and Syabrubesi reaches, a ready-made before/after case, plus derived "post-event DSM − Mapterhorn" entries computed live in the browser. The difference source ignores nodata pixels on either side instead of turning them into 30 km spikes.
- A titiler-pinned COG in another CRS (UTM, 4326) no longer fits to the wrong place or gets a wrong max-bounds box: its footprint is asked from titiler even when the global setting is the in-browser reader.
- Titiler-served terrain (non-Mercator COGs, VRTs, WMS) is now reprojected bilinearly instead of nearest-neighbour: a 30 m DEM no longer draws as a cross-hatched staircase when zoomed in.
- **Split views**: each pane's date pill names its view ("B: Bing · 1999-01-15"). Clicking the label picks the view the timeline's arrow keys act on (bold label, an extra circle around its timeline handle); the small arrows after the label swap that view with A, where drawing and most tools work. In the two-view layouts (overlay, 2x1) view A carries the arrows too. None of the letter, the bold, the arrows or the timeline handle's circle appear in snapshots. A new timeline button reorders the views chronologically, undated basemaps last.
- **Remote data in links and iframes**: any view's terrain or basemap can be a URL (`?sourceB=https://…/dem.tif`, `?basemapSourceC=…`), and `?drawingUrl=` (repeatable) loads remote vector data into the Drawing tool. Drawing import also takes a URL (the chevron next to Import; "Keep in the link" writes it as `drawingUrl=` and marks the layer as linked), `addTerrainUrl=` / `addBasemapUrl=` register sources without selecting them, and the docs gain an [Embedding & URL parameters](/docs/features/embedding) page with a live iframe and a link builder. Import now reads GPX, FlatGeobuf and (from a URL) Shapefile besides GeoJSON and KML.
- **URL keys**: the terrain source of a view is now `terrainSourceA`…`terrainSourceH` in the address bar, matching `basemapSourceA`…; old `sourceA=` links and saved bookmarks still work. New `sidebarCollapsed` state (mirrors the panel, so a link or an iframe can carry it closed) and the one-shot `scrollTo=<section>`; `addOverlayUrl=` registers overlays and `overlayBasemapIds=` may name URLs directly. The Share dialog offers an iframe snippet with a hide-side-panel switch.
- Docs: the Embedding page has a builder that can start from a pasted link and a recap of every non-state parameter; new developer pages: a generated State reference (URL and storage), the URL as an OpenAPI document browsed with Scalar, and the Fumadocs customization notes; the project preset interface is rendered from source. `drawingUrl` is now a state list (comma-separated), and the Drawing panel's clear-all button is gone (layers are deleted individually).
- A fullscreen button under the geolocate control (whole app, side panel included; mainly for embeds; `hideMapControls: ["fullscreen"]` removes it), `bookmarksUrl=` loads a bookmarks JSON from a link and `bookmarksGallery=true` opens the gallery on arrival. Docs: features grouped into Introduction, Sources, Tools and Advanced.
- Coverage overlays: sources under the cursor are listed finest resolution first.

### Bug Fixes
- Synced views no longer stay apart after a layout change in 2D historical mode (2x1 to 4x2): the idle reconcile was skipped whenever a view had no terrain.
- Picking, restyling, adding or stacking a basemap while the Basemap viz mode is off now turns it on, so the change is visible at once (the add paths already did; the pickers, opacity and overlay toggles did not).
- The `Shift` / `Ctrl` tap toggles only fire on a quick tap (under half a second), so a modifier held while deciding what to do no longer toggles anything on release.
- The side panel no longer stays transparent after a fast slider drag released off the slider (seen on Firefox / macOS).
- **Snapshot / Copy / Share capture every view**, not just view A: side-by-side, grid and overlay layouts are composited as shown on screen (wipe position, blend mode, opacity and colour matching included), with date pills, coloured borders, the scale bar and attribution (no geocoder, zoom, compass or geolocate buttons), never the side panel. The strips under the open side panel and the historical timeline are cropped off, so the subject stays centred; "Include the timeline in snapshots", in the new **Export settings** fold of Download and Snapshot (with the download resolution cap), keeps the timeline in the picture instead. The 2D world file is written only when the image is a single extent (single view or overlay).
- Drawing: click tolerance down from terra-draw's 40 px default to 8 px, so vertices can be placed close together when tracing fine features; the cursor turns into a pointer over the point that finishes the shape.
- Editor Layer Index layers flagged as overlays now land on the overlay stack when added from the coverage click modal or the Add Basemap dialog, instead of being selected as a basemap the picker could not show; key-gated layers are greyed out in the modal and failures are logged rather than swallowed.

# Changelog — National Terrain Library & Historical Export
<!-- released: 2026-09-14 -->

#### TL;DR
- **Library** replaces Sample: a curated set of high-resolution terrain and basemap sources from national mapping agencies, global products and sub-national surveys — Norway, USGS 3DEP, Netherlands AHN, England, Finland, Estonia, Tirol, Czechia, Italy, Japan, Mexico, Spain, Uruguay, Canada, Faroe, France overseas, ArcticDEM / REMA, GEDTM30, EMODnet — each verified against a known summit, graded against Mapterhorn by API-served and best bulk-download grid, filterable, picked one at a time or all at once. Selecting one pins the map to the country.

  ![The terrain dataset library](/docs/screenshots/terrain-library.jpg)
- **Docs page** listing every national dataset with a coverage choropleth, resolution, endpoint and licence.
- **Decoding fixes** that made these services usable: no-data floors and fills (sentinels, NaN, WMS reprojection fringes), sparse ArcGIS TIFFs, WCS 2.0, custom RGB encodings, COGs pinned to titiler when not in Web Mercator.
- **Export Multi (Historical)**: calendar pickers synced to the timeline, every current basemap as one picker, capture counts per source, Wayback dedup, zoom step-down retries, clean provider-named files, Google Earth frames fetched in-process.
- **Drawing layers**: per-layer visibility, export scopes (flat, per layer, selected), drawings mirrored on every view.
- Whole-world default view, self-healing synced views, zoom-dependent timeline marks, foldable Terrain Analysis sub-groups, MapTiler Satellite basemap.

# Changelog — Live Lighting Rework: Native-Sharpness Phong & Matcap
<!-- released: 2026-08-21 -->

#### TL;DR
- **Live Phong/Matcap rework** (renderers now labeled **Live** vs **Legacy**): per-fragment normals straight from the float DEM on MapLibre's own 128×128 drape mesh — native-hillshade sharpness. Phong composites true albedo over the basemap/hypso stack (hidden surfaces handled, specular-only no longer dims the map) with a camera-headlamp light anchor; Matcap gets correct camera anchoring at every bearing and per-fragment depth (no more summits flickering behind neighboring tiles). Also fixed: tile-seam streaks, high-pitch near-camera tile dropouts, endless tile refetch on hi-dpi. New featured bookmarks (Amazon Rivers, Willamette River) with fresh thumbnails.
- **Shareable BYOD links** — a URL referencing a sample-library source id (e.g. `?sourceB=custom-ign-lidarhd-dtm-wms-raw`) now auto-adds it to a fresh visitor's Bring-Your-Own-Data list instead of showing an empty pane, and the new `?addSources=id1,id2` param prepopulates several terrain/basemap samples at once without selecting any of them.

# Changelog — Historical Fixes, Matcap Rework, Docs Restructure
<!-- released: 2026-08-20 -->

#### TL;DR
- **Bug fixes** — historical-satellite whole-earth default camera now applies; terrain mode gates the timeline to the Raster Basemap viz mode being active; matcap's screen-locked bright blob replaced by a proper view-space lookup; endless lighting-tile refetch on hi-dpi viewports fixed (dpr-aware tile selection).
- Match Colors re-applies instantly in RGB; Bookmarks gets list/grid toggles (sidebar + gallery modal); the guided tour now wraps up with Keyboard Shortcuts and docs links.
- **Docs** — new Export & Share, Projects, Open In, Streaming & Storage Settings, and River-REM pages; nav regrouped (Features vs Advanced Features; Dev gets Custom Protocols + Historical groups).

# Changelog — Docs Site Expansion and Open-In Additions
<!-- released: 2026-08-19 -->

#### TL;DR
- **Docs site expansion** — dozens of new or re-shot real screenshots across Visualization Modes, the full guided-tour Walkthrough, Split & Compare, and more; new user-facing pages (Walkthrough, Tools, Frescoes & Artifact Scans) in the Features guide; new developer documentation (Lighting Effects, Terrain Analysis Pipeline, ESRI Wayback).
- New **Open In** destinations (Iconem River-REM, Google Maps 3D, Google Earth Historical/3D), a `?startTour=true` deep link to launch the guided tour directly, plus assorted fixes (lightbox caption links, changelog date-key collisions, KaTeX formula layout).

### Features
- **Docs site** — Visualization Modes, Walkthrough, Split & Compare, Basemaps & Historical, Sources, Tools, Frescoes & Artifact Scans, and several Dev pages substantially expanded with real app screenshots, reproduction URLs, and clarifying prose.
- **Open In** — Iconem River-REM, Google Maps 3D, and separate Google Earth Historical (web) / Google Earth 3D (web) destinations; ESRI Wayback Machine moved to the top of the list.
- `?startTour=true` URL param launches the guided product tour directly, independent of first-visit state.

### Bug Fixes
- Docs lightbox: a caption link followed by trailing text (e.g. a parenthetical note) no longer gets pushed past the title bar's truncation, hiding the actual clickable link.
- Changelog: two entries sharing the same release date collided on the same React key — a browser console warning explains it, but see the fix in this entry's own `<!-- released -->` marker for the general pattern.
- Terrain Source "Google 3D Tiles (via DeckGL only)" removed from Worldwide Defaults — the same experience is reachable via the Google Maps 3D / Google Earth 3D (web) Open-In destinations instead.

# Changelog — Terrain Camera Fixes, Terrain Sources Docs, and Favicon Polish
<!-- released: 2026-08-16T17:00 -->

#### TL;DR
- **Camera sync fixes** — DEM tiles arriving after terrain turns on, pane resizes, and the padding `easeTo` all leave the elevation reference stale. Re-anchored on `idle` via `recalculateZoomAndCenter` (holds camera position, solves for the new center/zoom — nothing moves on screen), guarded by a 1 m epsilon so padding changes and mode switches don't nudge the focus point. The view you last touched is authoritative; the others are copied wholesale from it.
- **Elevation is now a synced camera parameter** — a terrain camera has a sixth parameter beyond center/zoom/bearing/pitch/roll (the elevation of the point it looks at), and it wasn't being forwarded in split/overlay. MapLibre freezes it for the whole drag on the moved view while re-resolving it live on every `jumpTo` to the others, so the panes drifted vertically apart for the duration of a drag and snapped back on release. The moved view's elevation is now forwarded explicitly.
- **Fixed several camera-reset edge cases**: MapLibre's `easeTo` leaves `_elevationFreeze` stuck on unless `freezeElevation` is passed (suppressing per-frame reclamp and leaving panes in asymmetric internal state after whichever one you'd last dragged); ground-clamping bookkeeping was keyed by view id which outlives the map instance (a remounted pane stayed permanently clamped); programmatic camera commands now stand down while a pointer is held (previously `jumpTo`/`easeTo`'s `Map#stop()` silently ate a press-and-hold gesture).
- Panel open/close now animated (padding, pane rects, gutter, borders ease over 200ms); sidebar/timeline avoidance padding extended to lone view, single-row/column grids, and Overlay panes; Map B defaults to **AWS terrain** (no API key); new **Terrain Sources** docs page; favicon shape reactive to live app mode.

### Features
- **Terrain Sources docs page** (`docs/content/docs/features/terrain-sources.mdx`) — one-paragraph summary of each built-in terrain source (Mapterhorn's coverage page, Mapbox's SDK-only + compression, MapTiler's companion Ocean RGB bathymetry tileset, AWS's genuine ETOPO1 ocean bathymetry blending), linked from Sources → Terrain → ⓘ (`source-info-dialog.tsx`) as "Compare all built-in terrain sources →".
- Docs: Features sidebar group now expanded by default; homepage feature-card order now matches Terrain Visualization Modes → Light-Direction XYPad → Historical Imagery → Split Screen & N-Map Compare.

### Bug Fixes
- **Camera/focus-point shift on init** — the padding is what keeps the focus point centered in the part of a pane that isn't covered by the sidebar or timeline panel, so it belongs on every pane those overlap: each row's rightmost, the last row's, the lone non-split view (trivially both), and both full-bleed Overlay panes. It's now also seeded into each view's `initialViewState`, so a view is *built* with its vanishing point already shifted clear rather than rendering centered on the full canvas for a frame and then sliding across — that slide was the actual "shift on init". An interim version of this fix instead gated the padding on the grid having more than one row/column, on the theory that it only mattered for aligning vanishing points between side-by-side panes; that was wrong, and left a lone pane's focus point sitting under the sidebar.
- **Split-view pan/drag desync, requiring an extra manual pan to resync** — the cross-view sync handler's re-entrancy guard (needed because `jumpTo()` fires `move` events synchronously, which would otherwise recurse) was being released on a 50ms `setTimeout` instead of immediately after the synchronous re-entrant call already returned. Since real drag frames fire roughly every 16ms, that 50ms window silently dropped ~2 of every 3 legitimate frames from propagating to the other view(s) — including, sometimes, the drag's very last frame, leaving the passive view a few frames behind until nudged. Fixed by releasing the guard synchronously right after the sync loop, instead of on a timer.
- **Terrain camera mis-centering, on load and on every split-mode switch** ("the Matterhorn summit sits a bit low") — root-caused live via `map.project(map.getCenter())`, watched across the actual load/interaction timeline rather than guessed from docs. `setTerrain()` is applied the moment the terrain source object exists, before that view's actual DEM tiles for the current viewport have fetched/decoded, so the camera's aim elevation gets computed from nothing yet — confirmed: the projected center sat well off true screen-middle the entire time terrain was active, snapping back to dead-center immediately after re-calling `setTerrain()` a second time once `idle`. But that alone wasn't enough: the same off-centering kept recurring on every subsequent Off/Overlay/Side toggle too, each time from a *different* culprit — the padding effect's own `easeTo(duration:0)` call, that `easeTo` in turn firing a `move` event the cross-view sync handler propagated onward via `jumpTo()`, and `resize()` (each pane's own pixel dimensions changing between Overlay's full-width and Side's half-width panes) — every one of which independently resets the same elevation reference, confirmed live one at a time. The deeper cause turned out to be MapLibre's own `easeTo`: `_prepareElevation` sets `Map#_elevationFreeze` unconditionally, but `_finalizeElevation` — the only thing that clears it — runs only when `freezeElevation` is passed. So the padding `easeTo` left that flag stuck on, which suppresses MapLibre's own per-frame reclamp, and the only other thing that ever cleared it was completing an interactive drag *on that map*. That also explains why the very first drag after load jumped, and why one pane could follow the terrain while the other was panned. Passing `freezeElevation` fixes the flag; a cheap `idle` listener re-anchors the height when it's genuinely stale (see the entry above); and the padding effect's own `easeTo` is guarded against triggering a cross-view sync jump. An interim version re-affirmed the whole of `setTerrain()` on every idle instead, which worked but rebuilt Terrain + RenderToTexture each time — see the blinking entry above.
- **"Weird follow-terrain" while dragging, inconsistent between split views** — MapLibre's `centerClampedToGround` (on by default) continuously re-resolves the center point's elevation live, every frame, while panning/zooming — the bob/climb effect, and a source of cross-view inconsistency since two views on different DEM providers each resolve elevation independently a moment apart. This file's keyframe-recording animation already disabled this same flag for its own one map instance; now every split view disables it too, right after its own terrain has settled (order matters — disabling before that settle would freeze the wrong, pre-terrain elevation guess instead of the correct one; confirmed live both ways). Read from the map's own `getCenterClampedToGround()` rather than remembered per view id: a view id outlives the map behind it, so an id-keyed "already done" flag left a rebuilt pane (view B, after a split off/on cycle) permanently ground-clamped.
- Default terrain source for split mode's Map B changed from MapTiler to **AWS** — MapTiler (and Mapbox) require an API key a fresh visitor won't have configured, so Map B previously rendered blank by default.
- Default initial viewport recentered to `lat=45.9788, lng=7.674, zoom=12.37` (also updated in the camera-keyframe tool's own fallback pose, which mirrors this default by convention).
- `beta.historical-satellite.iconem.com` not defaulting to Historical mode despite a correct favicon — an effect-ordering race (the appMode-persistence effect ran before the first-visit hostname-default check on the very first render, so it always looked like a returning visitor). Fixed by snapshotting whether `appMode` was already stored *before* any effect runs.
- `jo-chemla.github.io` not defaulting to the blue/prod mountain favicon, and docs-in-dev not showing the purple book-open icon — both hostname-detection helpers now recognize `jo-chemla.github.io` as a real prod deploy, and the docs favicon-swap script's logic was flipped from "swap away from prod unless proven dev" to "swap up to prod only once confirmed" (safe default either way, since the previous logic could race Next's `beforeInteractive` script queuing).
- App favicon *shape* (mountain vs. clock) now reactive to the live app mode, not just the hostname — switching modes mid-session (or a first-visit guess that turns out wrong) now updates it instead of leaving it stuck at whatever `index.html`'s inline pre-mount script guessed.
- Docs: XYPad demo video 404 (`visualization-modes.mdx`'s `<video src>` was missing the `/docs` base-path prefix).

# Changelog — Guided Product Tour
<!-- released: 2026-08-16T09:00 -->

#### TL;DR
- New **guided product tour** (Compass icon in Settings, or auto-starts on first visit): a branching walkthrough covering the shared basics, then either the Terrain visualization tools or Historical Satellite imagery mode, chosen at a fork partway through.
- Each branch ends with a **Tools** step listing that mode's map-based utilities (Drawing, Elevation Picker, Sun/Shadow Calculator beta, Animation, Source Info — the historical branch's subset excludes the terrain-only ones).

### Features
- **Guided product tour** (`components/TerrainControlPanel/product-tour.tsx`, built on the `coachmark` library) — walks through the map viewport, control panel, general settings, and Terrain-vs-Historical mode switch, then forks into either the Terrain tools (Hillshade, Hypsometric Color, Terrain Analysis, Relief Visualization, Sources, BYOD, Split Mode, Tools, Keyboard Shortcuts) or Historical Satellite imagery (Compare and Blend, Split Mode, Blend Modes, Grid Layout, Timeline, Tools) branch. Each step temporarily forces whatever sidebar/section/mode state its target needs to exist, and everything is snapshotted at tour start and restored verbatim on close/finish, regardless of which steps were actually visited.
- **Tools step** (one per branch) — a bulleted rundown of that mode's Tools group, with every tool section folded and the whole group (separator + all tool titles) spotlighted together as one block.

### Bug Fixes
- **Popup silently not appearing for several steps** (Hypsometric, Terrain Analysis, Relief Visualization — Hillshade, near the top of the panel, was unaffected) — root cause: Coachmark's own built-in scroll-into-view could resolve before the actual scroll distance was covered for a target further down the sidebar's scroll container, leaving the popup positioned against a target rect still (partly) below the fold — visually indistinguishable from no popup at all, just the dimmed backdrop. Fixed by having the tour scroll its own target into view itself (instant, before Coachmark's own step-change effect ever runs), so Coachmark's internal attempt finds nothing left to do.
- **Raster Basemap / Terrain Sources steps** could scroll the section's own title off-screen once enough BYOD custom sources were added to make the section unusually tall — switched the tour's default scroll alignment from centering the (possibly very tall) target to anchoring its top edge instead, so the title stays visible with as much of the rest as fits below it.
- Terrain Analysis step was switching on both Slope and Curvature as its demo; now just Slope, matching its own description text.
- The "Curious about the other mode? Take that tour instead" link could overflow its popup at typical widths — shortened and restyled as a proper full-width button.

# Changelog — Docs Site, Featured Bookmarks, and Tells Freeze Fixes
<!-- released: 2026-08-14 -->

#### TL;DR
- Added a [documentation site](/docs), live-linked from the app general settings.
- **Featured bookmarks**: a curated "Featured" strip of starter viewpoints (different terrain shapes, visualization combinations, and a historical-imagery example) now sits above your own saved bookmark list.
- **Mound detector (Tells)**: new Frozen/Live toggle — pin the currently-detected candidates in place so panning/zooming doesn't keep re-querying and recomputing them.
- Visiting historical-satellite.iconem.com now lands you straight in **Historical Imagery mode**, with its own clock-shaped favicon (matching the timeline toggle's own icon) instead of the terrain mountain.
- In split/grid compare mode, clicking a basemap's **name** (not just its per-view toggle) now sets that source on every active view at once.

### Features
- **Documentation site** (`docs/`) — a separate Fumadocs (Next.js) app, deployed alongside the main app and proxied at `/docs` in dev, covering Overview, Visualization Modes (a shared markdown source also rendered inline in Settings → Visualization Modes, so both stay in sync), Keyboard Shortcuts, Changelog (renders the same TL;DRs shown in-app, sourced straight from this file), Resources and Inspiration (MapLibre features, geomorphometry/hydrology literature, credits), and a Dev page (structure, architecture, running the app). Homepage and docs images open in a lightbox on click.
- **Featured bookmarks** (`lib/preset-bookmarks.ts`) — a small, read-only set of curated viewpoints shipped with the app, separate from the user's own `bookmarksAtom`-backed list: restoring one never edits or removes it, and an app update to this set never touches anyone's own saved bookmarks.
- **Tells Frozen/Live toggle** — "Frozen" snapshots the currently-rendered mound candidates (via `querySourceFeatures` off the live vector tiles) into a static geojson source, so panning/zooming stops triggering new `tells://` tile fetches and recomputation; "Live" (the default) resumes the normal fetch-as-you-pan behavior and forces an immediate tile reload for wherever you'd panned to while frozen, rather than waiting for the next pan.
- **Historical hostname auto-routing** — a first-ever visit to historical-satellite.iconem.com (no `?appMode=` in the URL, no locally-stored preference yet) now opens in Historical mode by default instead of the app's normal Terrain default; any other/unknown hostname is unaffected.
- **Click a basemap's label to sync it everywhere** — in split/N-grid compare mode, clicking a basemap's name now applies it to every currently active view, not just the row it was clicked from.

### Bug Fixes
- **Tells freeze — three real, distinct bugs**:
  - `Error: can't serialize object of unregistered class nf` — `querySourceFeatures()` returns MapLibre's internal feature-wrapper instances, not plain objects; handing those straight to a new geojson `<Source>` failed MapLibre's worker-side structured-clone step. Fixed by round-tripping through `JSON.parse(JSON.stringify(...))` first.
  - `DataCloneError: ArrayBuffer ... already detached` — root cause was actually in the shared finished-tile LRU cache (`lib/tile-result-cache.ts`, used by every "Slope and More" derivative — Slope/Curvature/TPI/Roughness/LRM/SVF/Openness and more, not just Tells): it handed out the exact same underlying `ArrayBuffer` on every cache hit, and MapLibre detaches a tile response's buffer when transferring it to a worker — so a second request for an already-cached tile tried to transfer an already-dead buffer. Fixed by always storing and returning independent copies.
  - Unfreezing (back to Live) didn't recompute for wherever the view had panned to while frozen, until an extra pan/zoom — MapLibre only fetches a source's tiles when a visible layer references it, and no layer referenced the live vector source while frozen, so tiles for a newly-panned-to area were never requested. Fixed by forcing a tile reload (`source.setTiles(...)`) the moment Live resumes.
  - The frozen geojson source also now mounts under its own id instead of swapping the live vector source's type in place under the same one, avoiding a MapLibre worker-teardown race when a tile request was still in flight the instant Frozen flipped on.
- **Historical mode wiping Terrain-mode visualization settings** — switching into Historical mode used to force roughly a dozen viz-mode flags (Hillshade, Lighting, Shadows, Color Relief, Terrain Analysis, Relief Visualization, Plane Slicer, Tells, Contours/Graticules, Background) to off, destroying whatever a visitor had set in Terrain mode. Every one of those is now instead gated on "not Historical mode" directly at render time, so the underlying settings are preserved and simply resume when switching back.
- **Historical timeline zoom-out over-padding** — the zoom-out limit and pan-gutter extent padded a flat 10% of the full date range past each real end, which for a very long outlier range (e.g. an 80-year span) let the zoomed-out view pan years past either real boundary. Now capped at 6 months per side, whichever of the two is smaller.
- **Changelog image lightbox** — was rendering far too small with no dimmed background, then (once resized correctly) showed black letterbox bars whenever an image's aspect ratio didn't match a fixed 90vw×90vh box, and outside-click/Escape didn't reliably close it due to a Base UI nested-dialog dismiss quirk (confirmed: Escape closed it while a real backdrop click did not, and a naive workaround ended up closing the Settings dialog behind it too). Rebuilt as a plain, correctly-dimmed overlay that shrink-wraps to the image's own aspect ratio (never upscaling past it), with its own outside-click/Escape handling scoped to just the lightbox.
- **`@tanstack/devtools-vite`'s dev-tooling breaking MapLibre sources** — its "click to open in editor" `data-tsd-source` attribute, injected onto every JSX element in dev, was landing on react-map-gl's `<Source>`/`<Layer>` components, which spread all received props straight into `map.addSource()`/`addLayer()` — tripping MapLibre's schema validator ("unknown property") whenever such a source/layer mounted fresh at runtime. Scoped out via the plugin's own `injectSource.ignore.components` option.

# Changelog — Histogram Color Matching in Compare and Blend
<!-- released: 2026-08-11 -->

#### TL;DR
- **Match Colors via Histogram Matching**: automatically recolors every other view onto View A's color histogram, so two different imagery sources (or two dates of the same source) no longer look noticeably darker/bluer/warmer next to each other when compared or blended.
- Five color spaces to choose from: RGB is instant (a live CSS filter); HSL/HSV/LAB/LCH are slower but can match more subtle color differences. Ported from Iconem/historical-satellite's standalone [histogram-matching demo](/histogram-matching-example/histogram-matching.html).

### Features
- **Match Colors, in Compare and Blend** — TL;DR: automatically recolors the other view(s) to match View A, so two different imagery sources — or two different dates of the same source — line up visually instead of one looking noticeably darker/bluer/warmer than the other when compared or blended. A new "Color Space" picker lets you choose how thorough the match is; the default (RGB) is instant, the others are slower but can match more subtle color differences.
  *Implementation, for developers:* new "Match Colors" collapsible (folded by default, persisted like the existing "Advanced" one) at the bottom of Compare and Blend, gated on `isSplit` (works in both Overlay and grid/side-by-side). `state.matchColorsToA` (bool) and `state.matchColorsColorSpace` (`"rgb" | "hsl" | "hsv" | "lab" | "lch"`) are both nuqs/URL state. One `HistogramMatchFilter` instance is mounted per non-A active view (overlay: just B; grid: each of B..H independently), always matched onto A as the reference — see `components/MapControls/HistogramMatchFilter.tsx` and the algorithm in `lib/histogram-matching.ts`.
  Two paths, chosen per color space:
  - **RGB** (fast): computes a per-channel 256-entry lookup table (via exact empirical-CDF histogram matching — see the Bug Fixes entry below) and applies it as a live CSS SVG `feComponentTransfer` filter directly on the target's `<canvas>`. No pixel data is ever touched; GPU-composited every frame for free.
  - **HSL / HSV / LAB / LCH** (slower, flagged with an hourglass in the picker): `feComponentTransfer` can only ever transform raw R/G/B output independently, so a mapping computed in one of these spaces can't be expressed as a CSS filter. Instead: hand-rolled sRGB↔space conversions (not chroma-js — its per-call Color-object construction/dispatch overhead is real at pixel-loop scale, measured ~4-5x slower) convert a small 96×96 sample of each view to the target color space, compute the matching per channel, then a coarse 25³-point 3D color LUT (the same technique real color-grading tools use — DaVinci Resolve/Lightroom camera profiles, `.cube` LUT files) is built once from that mapping and applied to the target's *own native canvas resolution* via trilinear interpolation — cheap per pixel (8 LUT reads + weighted blends, no transcendental math), which is what makes native-resolution output affordable at all (a naive full per-pixel conversion measured 0.5-0.9s at typical/high-DPI canvas sizes; the LUT approach is 100-400ms for the same sizes). Result is drawn onto a `pointer-events-none` overlay canvas stacked on the target's own live canvas (which stays interactive underneath), faded to `opacity:0` on either map's `movestart` and back to `1` once the next recompute lands, so a pan/zoom gesture always shows the live map moving instead of a stale, non-updating overlay sitting on top of it with no feedback.
  - Both paths re-sample on `idle` (either the reference or the target map), debounced to at most once/second.
  - Also vendors Iconem/historical-satellite's original standalone [histogram-matching demo](/histogram-matching-example/histogram-matching.html) (`public/histogram-matching-example/`) for reference — the algorithm this whole feature is ported from.

### Bug Fixes
- **LAB/LCH histogram matching producing wildly wrong colors** — root cause: the CDF matching binned each channel into a *fixed grid spanning its theoretical range* (e.g. LAB's a/b as ±100, later widened to ±128 as a first attempted fix — still wrong). Any low-variance sample (a flat-colored tile — open water, snow, a cloud deck) has almost all its mass in one or two bins, and the standard CDF-inversion boundary handling (`x <= xp[0]` / `x >= xp[last]`) then snaps those bins straight to the array's *theoretical* min/max the instant a query's cumulative fraction hits exactly 0 or 1 — which happens far more often than it sounds, not just at the sample's true extremes. For RGB that clamped to plain black/white (usually visually benign by luck); for LAB it clamped to wildly saturated colors that never appeared anywhere in either image. Fixed by replacing the fixed-bin approach with an exact empirical CDF (ECDF) over each channel's actually-observed values — sorted + deduplicated real samples, matching what scikit-image's own `exposure.match_histograms` does (`np.unique` + cumulative counts) — so both the lookup arrays and their boundary clamps are always real data points, never a synthetic range edge. Applied to the RGB path too (same root cause, just visually subtler). Verified against the exact degenerate case that exposed it (a perfectly flat-colored source/target pair, which used to land on arbitrary extreme colors) now matching exactly; realistic noisy-sample correctness and native-resolution LUT performance both reconfirmed unaffected (ECDF construction adds ~7-9ms on top of the existing 60-210ms LUT-apply cost).

# Changelog — N-Map Grid, Overlay blend, and export historical imagery
<!-- released: 2026-08-10 -->

#### TL;DR
- **N-Map Grid mode**: in addition to 2x1, can now also do 3x1, 4x1, or 2 rows, 2x2 up to 4x2. Gains a **Grid** shape, now supporting up to 8 synced map views, not just a 2-way split.

  ![Comparing basemap sources side-by-side in grid mode](/docs/screenshots/n-grid.jpg)
- **Compare and Blend's Split Mode: Off/Side/Overlay**, where gutter can be horizontally dragged for clip ratio, or the pill vertical position controls map view B transparency
- **Blend Mode for overlaid Map View**: Multiply, Difference, Soft-Light etc. Dropdown now exposes every CSS blend mode, not just a curated handful.
- **Export historical GeoTIFFs** across a date range, with an option to generate ready-to-run `gdal_translate` scripts.
- Optional colored map borders and a capture-date pill make it easy to tell which pane is which.

### Features
- **N-map grid & overlay comparison mode** — Compare and Blend's Split Mode gains a third shape alongside Off/Overlay: a full grid (2×1/3×1/4×1/2×2/3×2/4×2, up to 8 simultaneous views A–H), each with its own basemap source, driven by a shared `GRID_LAYOUTS` registry (`lib/grid-layouts.ts`) rather than a hardcoded A/B pair. Every pane is absolutely positioned off one shared layout pass so switching shapes never remounts a `<Map>` instance (keeps its WebGL context/tile cache). The last row absorbs whatever height the historical timeline panel actually eats into, so its own *visible* portion still matches every other row instead of a naive equal split leaving it visibly squished. Switching back to Terrain mode forces the shape back to plain 2×1 and re-derives the timeline's own grid layout to match — it previously kept showing all 8 A–H pills even after the map itself had collapsed back down. Inspired by Capturing Reality's RealityScan multi-view comparison grid and BBBike's MapCompare side-by-side.
- **Visual grid-layout picker** — Grid Layout's text SegmentedToggle replaced with a borderless 2-row × 4-col "table size picker" (same convention as the ABCDEF basemap-source toggle / color swatches, no per-cell text): the selected NxM shape lights up in solid primary, hovering a different valid cell previews the resulting shape in a lighter primary before committing. Every cell is a real, wired-up layout up to 4×2 (8 views, A–H) except the top-left 1×1 cell (a single unsplit view, meaningless as a grid-layout choice), which stays disabled rather than hidden so the control still reads as a clean fixed rectangle.
- **Per-side colored map borders** — an optional colored border per view (Compare and Blend → Advanced → Colorize Map Borders), toggle between a 3px-inset frame or a flush, thicker one. In overlay mode each side's border is drawn independently (not clipped from one shared rect) and split exactly at the drag pill's own position; in every mode borders clamp to the actually-*visible* edge instead of running under the floating sidebar or the historical timeline panel. The flush (no-inset) mode also avoids rounded corners and halves each side's stroke width exactly where it's shared with a neighboring pane's border, so a seam between two panes reads as one continuous stroke instead of visibly doubled. Borders now render as their own layer instead of nested inside the blended overlay pane, so an Overlay-mode mix-blend-mode (e.g. Difference/Exclusion) no longer discolors the border itself.
- **Capture-date pill** — a small floating pill per pane showing that view's real capture date, off by default, with an off/date-only/source+date 3-way toggle. Placement is sidebar- and timeline-aware (centers on the actually-visible width, not the full DOM box that intentionally extends underneath either), and in overlay mode centers each pane's pill in its own visible half of the split rather than stacking both at the shared left edge. Shows the source's short name instead of a fabricated "Unknown" when no real per-tile date is available (e.g. a static basemap), rather than disappearing entirely.
- **Split gutter / drag pill** — the 2×1 overlay divider is now a circle pill (drag = ratio + opacity together) sitting on a wider invisible gutter strip (drag = ratio only, `cursor-col-resize`), so grabbing near-but-not-exactly-on the pill no longer silently changes blend opacity too.
- **Ctrl+drag group-move for timeline handles** — holding Ctrl (or Cmd) while dragging a per-view handle now sweeps every other handle on one side of it by the same number of tick-marks, all measured in one flattened, all-sources index space so "N marks" reads as the same visual distance for every handle regardless of which source it's actually on. Which side is swept is decided once, from each handle's position relative to the dragged one plus the first real pointer-movement direction, so a handle dragged past the anchor mid-gesture stays swept; dragging back to the exact start position resets every swept handle too.
- **Multi-feature historical export** (`Export Multi (Historical)`, new dialog) — one GeoTIFF per export target × selected historical source × real capture date in a picked range, bundled into a `.zip`. Target is either **Viewport** (the current map view, nothing needs to be drawn) or **Per-Feature** (every currently-drawn TerraDraw feature, independently padded — a fixed meters radius for points, a percent-of-own-extent buffer for polygons/lines). An **Include gdal_translate script** option additionally writes one `.bat` per target with a ready-to-run `gdal_translate` command for every capture whose source exposes a real fetchable tile URL — Wayback/HLS/Planet/EOX Sentinel-2 via a `GDAL_WMS` TMS mini-driver (same technique as Iconem's prior historical-satellite export tooling), Bing via `GDAL_WMS`'s dedicated VirtualEarth service (quadkey-addressed, not `{z}/{x}/{y}`) — only Google Earth Historical is REM-commented out instead, since it has no public tile URL at all (this app resolves it internally against Google's own encrypted `dbRoot`).
- **Blend modes** — Overlay's Blend Mode dropdown now exposes every CSS `mix-blend-mode` keyword, not a curated handful, grouped into "Standard" (normal/multiply/screen/overlay/darken/lighten/color-dodge/color-burn/hard-light/soft-light/difference/exclusion) and "Extra" (hue/saturation/color/luminosity/plus-darker/plus-lighter).
- **Compare and Blend sidebar section** (renamed from "Comparison and Mix") split out of General Settings, with an "Advanced" sub-section (capture-date pill, border colorization + side colors) collapsed by default, its own collapsed/expanded state now persisted like every other sidebar section instead of resetting on reload. The "Open In…" launcher (Google Earth Web/ESRI Wayback/BBBike/etc.) lives in this section for Compare and Blend; in Terrain mode (which doesn't show this section at all) it lives instead in the historical timeline panel's own A/B caption row, centered between the two dates.
- **Historical mode defaults** — entering Historical Imagery mode (Mode Picker, or a direct `?appMode=historical` link) now also forces `showHillshade` off, so only the raster basemap actually renders — previously the one terrain-mode viz toggle that still defaulted on.
- Historical timeline's default (non-zoomed) view no longer stretches all the way back to a single old outlier tick (Google Earth Historical often has one isolated ~1945 capture for well-covered cities) — floored at 2010 by default unless every available tick genuinely predates that.
- Timeline per-view handle chips/side-picker/A-B captions fall back to a plain primary-colored look instead of each view's own hue when Colorize Map Borders is off, since that per-side color coding is meaningless once nothing on the map actually shows it — the same neutral fallback now also applies automatically in Terrain mode, which forces colored borders off but doesn't expose the toggle to reflect that.
- Source Info's per-view basemap attribution list no longer merges two views that share a source but resolved to a *different* real attribution (e.g. two views both on Google Earth Historical at different dates, different actual imagery provider) into one row showing only the first view's text — dedup now compares the resolved text itself, not just the source id.
- **ESRI World Imagery (live basemap) capture-date pill** now resolves a real per-tile date via the newest local Wayback release instead of always showing "Unknown," and shows that date next to its label in the basemap picker the same way Bing already did. ESRI Wayback's own Source Info attribution now reads a short "Provider (Source)" label (e.g. "Maxar (WV03_VNIR)") resolved from wayback-core's real per-release metadata, instead of sharing the live basemap's location-only, always-current contributor-coverage feed.
- **Chevron off-screen handle click** now zooms out 20% toward that handle's date instead of recentering exactly on it, so the timeline between "here" and "there" stays visible instead of jumping straight to the target.
- Historical-only keyboard shortcuts (L-hold lighting, Ctrl-tap viz-mode toggle, Shift-tap basemap toggle) are now disabled in Historical Satellite mode, where they don't apply; Ctrl+K and Space stay universal. These, plus arrow-key stepping and the timeline's Ctrl+drag behavior, are now documented in Settings → Keyboard Shortcuts.
- Terrain mode's description in the Mode Picker now specifically names Relief Visualization alongside hillshade/lighting/contours/terrain analysis.
- "Export Multi (Historical)" renamed to "Export Historical GeoTiffs" and moved above the Max Download Resolution input it shares a section with, instead of below it.

### Bug Fixes
- **Split-gutter drag drift** — the pill's horizontal drag read the small ~32px gutter strip's own (ratio-dependent, moving) bounding rect instead of the true split container's, so dragging the pill (as opposed to the surrounding gutter) silently drifted from the cursor. Fixed by reading the gutter's parent rect for both.
- **Historical timeline panel height/desync** — its `ResizeObserver` was attached once at first mount and never reattached after the panel unmounted and remounted (collapsing/re-expanding the floating timeline), silently freezing the reported height forever after the first such cycle. This fed the map borders' bottom clamp, the minimap's offset, and the scale/attribution clearance, so a stale height desynced all of them at once — e.g. a colored border landing behind the timeline panel after toggling it off and back on. Replaced the effect with a callback ref that reattaches on every real mount.
- **Minimap flush against the expanded timeline panel** — its clearance formula added the panel's own 16px `bottom-4` anchor offset and the intended 16px visual gap as if they were the same 16px, leaving zero actual margin whenever the full (non-collapsed) panel was showing; the collapsed-to-icon case already accounted for both separately. Now adds both.
- **AttributionControl force-opening itself** — a real MapLibre `attribution_control.ts` quirk: `compact` mode force-opens the `<details>` the first time real attribution content resolves while the map's canvas is ≤640px wide (true for most split panes), and never auto-collapses again. Worked around with a capture-phase click listener (to still respect a genuine user click) plus a `MutationObserver` that immediately re-collapses any *other* `open` addition.
- Bottom-row capture-date pills now anchor to that row's own true bottom (clearing the timeline) instead of the seam with the row above, now that the border/timeline clamping they share is correct — previously both rows' pills crowded onto the same middle seam.
- **Arrow-key timeline stepping vs. Blend Mode dropdown** — arrowing through an open Blend Mode `<Select>` also stepped the historical date underneath it, since the timeline's own arrow handler wasn't scoped to whether the timeline panel was actually the last thing clicked. Now gated on that.
- **Year-gridline UTC bug** — the gridline generator compared a local-time year against a UTC-floored boundary, silently dropping the "2010" floor label for anyone in a UTC+ timezone.
- **Pan gutter / wheel-pan gating** — both the horizontal pan gutter and wheel-driven horizontal pan were gated on `viewWindow` being set rather than on a real hidden range actually existing, so e.g. re-toggling a source pill back on (which can only become reachable via the 2010 default-view floor, not an actual zoom/pan) left the gutter transparent/inert. Wheel gestures also now lock to pan-or-zoom for the gesture's full duration (trackpad swipes rarely produce pure `deltaX`, so switching mode per-event read as stutter), and wheel-driven `viewWindow` updates coalesce to one per animation frame instead of one per wheel event, since momentum-decay tails can fire well past 60fps.
- **Ctrl+drag handle index math** — iterated from each handle scrubbing by nearest-pixel (reading as time-distance rather than a clean N-marks shift when sources differ in tick density) to indexing within its own source's list, to its final form: indexing within the flattened, all-sources list, so "N marks" is the same visual distance for the dragged handle and every swept handle alike, regardless of source.

# Changelog — Historical Satellite Imagery Timeline, Terrain vs Historical Mode Picker
<!-- released: 2026-08-07 -->

#### TL;DR
- **New "Historical Imagery" mode**: scrub a real per-tile capture-date timeline bottom panel, across **[ESRI Wayback](https://livingatlas.arcgis.com/wayback/), [Google Earth Historical](https://github.com/Iconem/GE_TimeMachine)**, [Landsat/Sentinel (HLS)](https://hls.gsfc.nasa.gov/), [Planet](https://www.planet.com/products/basemap/), and [Bing](https://www.bing.com/maps/aerial).

  ![Scrubbing the historical timeline across capture dates](/docs/screenshots/historical-timeline.jpg)
- **Mode Picker: Terrain vs Historical** switches the whole sidebar between Terrain Viewer and a simplified Historical Imagery layout.
- Every historical basemap source feeds real attribution, including dynamically-resolved provider/date info for Wayback, Google Earth Historical, and Bing.
- **The light-direction XY pad itself gained a full bidirectional datetime binding**: drag it and it back-solves the closest matching day-of-year/time-of-day (and the sliders still drive it forward as before), hatching every position the sun can't physically reach at the current latitude (a real day/night-boundary constraint).
- Sun Shadow Calculator: new **Reverse** mode: click a shadow to back-solve the light direction and time of day, knowing building height. Also see the standalone [sun-position estimator](/sun-position-estimator.html) tool.

### Features
- **Historical satellite imagery basemaps + timeline scrubber** — five date-driven basemap sources (ESRI Wayback, NASA HLS Landsat/Sentinel, Google Earth Historical via a reverse-engineered `gehist://` MapLibre protocol (scaffolded from [Iconem/GE_TimeMachine](https://github.com/Iconem/GE_TimeMachine)), Planet Monthly Mosaics behind an API key, and Bing's single current mosaic), consolidated into one "Historical Imagery" sidebar entry rather than five separate rows (which underlying source is active per side is a separate `historicalActiveSource(A/B)` field). A bottom timeline panel shows per-source colored pills (toggle which sources' ticks are shown, filterable by VHR/medium resolution) and a scrubbable track of real per-tile capture dates — not each source's own catalog-wide "release date." Split-screen/per-view mode gets a sync toggle (single chain icon) to move both sides' scrub position together or independently via an A/B picker. Off-screen A/B handles collapse into a rounded chevron chip ("A>"/"<B") that recenters the view on click instead of colliding with the round in-view handle. A "Open in…" launcher opens the current view in BBBike MapCompare or similar external tools.
- **Real per-tile capture dates, not catalog metadata** — Wayback resolves via its own metadata endpoint (deduped by resolved real date, since distinct releases commonly share one — the earlier culprit behind ticks piling onto one pixel), Bing reads a deliberately CORS-exposed `X-VE-TILEMETA-CaptureDatesRange` response header (undocumented but confirmed live to vary genuinely by location/zoom), GE Historical decodes Google's own encrypted `dbRoot`/quadtree-packet protocol.
- **Mode Picker** — clicking the sidebar title ("Terrain Viewer" / "Historical Sat") opens a dialog to switch the app's meta-mode between **Terrain** (the full toolset, unchanged) and **Historical Imagery** (a deliberately stripped-down 2D-only sidebar: no View Mode toggle, no Visualization Modes/Options/Detectors groups, no Elevation Picker, just General Settings, Bookmarks, Download, an ungrouped Basemap picker, and Tools). Settings dialog hides what's terrain-only in this mode too (the Visualization Modes reference section, Tells/Mound-detector beta toggle, high-precision Terrarium-vs-TerrainRGB toggle, MapTiler API key). `appMode` is nuqs/URL state (sorted right after `project` in the URL's own param order), not a local-only setting, and persists its last value across a fresh session like the existing beta-gate flags.
- **Basemap attribution** — every basemap source now feeds MapLibre's attribution control (previously only terrain sources did). Static per-provider strings for OSM/Mapbox/HERE/Bing/Google/Planet/HLS/EOX Sentinel-2-cloudless; genuinely dynamic, current-view-resolved attribution for Esri/Wayback (Esri's public contributor-coverage feed, `static.arcgis.com/attribution/World_Imagery`), Google Earth Historical (the real per-tile capturing provider, decoded straight from Google's own `dbRoot` — a `providerId → copyright` table shipped in the same response already fetched for other purposes, reverse-engineered against Open GEE's `dbroot_v2.proto` and cross-checked against CesiumJS's own `GoogleEarthEnterpriseMetadata`), and Bing (real per-tile capture-date range, see above). The corner `AttributionControl` shows a short static pointer for the three dynamic sources ("see dynamic source attribution in sidebar source panel") since a `<Source>`'s `attribution` prop can never be live-updated post-mount (react-map-gl's own reconciler has no case for it) — but is *also* pushed the real resolved text directly via the underlying MapLibre `Map` instance plus a synthetic `sourcedata` event (`Map.fire`, fully public API, no private methods), so the corner control shows it live too. The sidebar's Source Info section lists every historical source's attribution (dynamic + static) and works in both Terrain and Historical app modes — a raster basemap can be active in either.
- **Inverse solar-position lookup + shadow-based light estimator** (`a43a99f`, refined `09f3803`) — the light-direction XY pad (Hillshade/Phong native + Sun Shadow Calculator) is now a full bidirectional binding in Datetime mode: dragging it back-solves the closest matching day-of-year + time-of-day (closed-form, picking whichever of the two annually-recurring declination solutions is nearer the day already set) and updates the Date/Time sliders, while the sliders still drive the pad forward as before. Free mode shows the same back-solved day/time as a "closest match" caption. The pad hatches every position the sun can never reach at the current latitude (a closed-form spherical-astronomy inequality, not a restrictive tint) and its drag pill turns destructive-red in real time outside that region. Sun Shadow Calculator gains a **Reverse** mode: click an object's base, then its real shadow tip as seen in the imagery, and the shadow's length/bearing plus the object's height back-solve a light direction (and closest-matching day/time) instead of the other way around. A standalone prototype of the forward solve — pick a date/time/location, see the resulting sun position and shadow length — ships alongside it as a mini tool (`bba319b`): [sun-position-estimator.html](/sun-position-estimator.html).

### Bug Fixes
- **Ghost/duplicate timeline marks** — root-caused to distinct Wayback releases resolving to an identical real capture date, which collided on both the tick list's React key and the tick-position map's key, causing React to reuse/misplace DOM nodes (worse after repeated zooming). Fixed by deduplicating Wayback ticks by resolved date at the source, not by trying to visually nudge duplicates apart.
- **Handle-to-mark exact-match jump bug** — the timeline handle resolved which tick was "active" via exact floating-point/timestamp equality, which is fragile across independent data-refresh cycles; switched to nearest-match resolution.
- **Timeline mousewheel zoom/pan stale-closure bug** — the wheel-handler's own `useEffect` depended on values that changed on every tick, causing listener teardown/re-add churn that showed up as occasional freezes/stale positions during fast horizontal scrolling.
- **A/B handle collision** — an off-screen handle previously rendered both the clamped round handle pinned at the track edge *and* a separate off-screen chevron indicator simultaneously; now mutually exclusive.
- Split-mode centering, per-map sidebar padding, minimap/attribution-corner layout regressions, and pastel per-source tick colors derived from each provider's own brand color, from the historical-timeline work above.

# Changelog — Draw export split, Colorramp Editor, Bookmarks Gallery
<!-- released: 2026-07-31 -->

#### TL;DR
- **TerraDraw export split mode**: button with a "split by layer" option.
- **Colorramp editor**: A live session-only for quick, non-persisted ramp-stop edits.
- **Bookmarks gallery** now flattens into one continuous grid by default.

### Features
- **Bookmarks gallery** — flatten toggle (now default-on) shows every view as one continuous grid with two-line "Project" / "View" labels, instead of one grid per project leaving empty slots when a project isn't a multiple of 3 or has just one view.
- **Live colorramp session editor** — a pencil next to every named-ramp picker opens a live stops editor (same alpha-aware color picker as layer colors) for the currently selected ramp; edits are session-only (a plain jotai atom, never persisted to localStorage or the URL) and revert on reload. A Paintbrush toggle next to it swaps the ramp's (near-)black or white stop to transparent, no-op if it has neither.
- **TerraDraw export** — now a split button: the main button exports immediately with the last-used setting; its chevron opens a small popover with a "split export by layer" toggle (one `.geojson` per layer, bundled into a `.zip`, instead of every layer flattened into one file). Import/Clear resized to match (Import/Export at a 2:3 flex ratio, Clear an icon-only button matching their height).
- **Expanding-search geocoder** — collapses to just the search icon until clicked, focused, or typed into (and stays expanded once it has text or a picked result); `Ctrl+G` expands/focuses it alongside the existing `Ctrl+K`. The collapsed icon now matches the other native maplibre controls exactly (size, background, border ring, centering). Enter without arrow-key navigation now commits the top suggestion *and* closes the dropdown, matching arrow+Enter/click behavior. Per-result pin icons removed from the suggestions list.
- **MapLibre native controls (zoom/compass/geolocate) restyled** — their vendor icons were background-image data URIs with a hardcoded gray fill and no theming hook (previously patched over with a blanket CSS `invert()` filter); replaced with real lucide-react icons that follow the theme's foreground color automatically in light and dark, with geolocate's active/error tracking states keeping fixed status colors. Compass now correctly points north (was a diagonal, off-center default icon shape). Both the control group and the geocoder now read the active color preset's card background and corner radius (`--card`/`--radius`) instead of a hardcoded white/fixed radius — switching to a very square (neo-brutalism) or very round preset now visibly carries over to these controls too.
- **`<Select>` keyboard nav** — Left/Right arrow keys now cycle the trigger's value directly without opening the popup (Down/Up still open + navigate it as before), for every existing select in the app with no call-site changes.
- **Mapbox/MapTiler terrain sources** are now hidden from the picker until their API key is set, matching the existing Mapbox/HERE basemap gating.
- **shadcn/ui** — `components.json` style moved to `base-vega` (Base UI's renamed "classic" preset); `package.json` gained a `shadcn:add` script pinned to `-b base` so the CLI can't silently fall back to Radix.

### Bug Fixes
- **Beta toggle persistence** — the Tells and Sun Shadow beta gates were URL-only (nuqs), with no localStorage backing, so they silently reset to off on every reload without an explicit `?tellsBeta=`/`?sunShadowBeta=` param. Fixed by mirroring the last value into a small `atomWithStorage` and restoring it on first load unless the URL already overrides it — the two-system split (nuqs for the shareable gate, jotai for "what I last had it set to") is a bit of an odd shape, but keeps `?tellsBeta=true` links working exactly as before while fixing the reload case.
- **Geocoder dark mode** — the suggestions dropdown background stayed vendor-white (its dark override targeted a BEM class this geocoder version never actually renders) and the clear (X) button stayed a bright white square with a dark icon; both now follow the theme correctly. A stray `overflow: hidden` on the base (not collapsed-only) rule had also been clipping the suggestions dropdown even while expanded.
- **Phong/Matcap tile redraw churn** — the "Terrain Exaggeration" slider (and, less visibly, `matcapRotationDeg`/`phongDiffuseStrength`/`phongSpecularStrength`) fed straight into the `matcap://`/`phong://` tile URL undebounced, so dragging it re-fetched every visible raster tile on every animation frame. All four now go through the same read-side debounce already used for light direction (0ms in the GPU-uniform "live" renderer, 150ms in "raster").
- **Openness/SVF tiles not caching on toggle** — their ray-marched compute yields to the main thread for responsiveness, and the yield point doubled as an abort checkpoint: toggling the mode off mid-tile threw the in-flight result away instead of caching it, which fast (never-yielding) modes never hit. Removed the abort-throw so an already-fetched tile's remaining (bounded) CPU work always finishes and lands in the cache.
- **Bookmark deletion** now cascades to a project's children instead of leaving them orphaned.
- **Copy-template button** (TMS/WMS URL hint) shows a checkmark instead of the green copy icon for 1s after clicking.
- **Sky/horizon/fog colors** moved from an entirely unpersisted plain jotai atom (lost on every reload) to URL/nuqs state, consistent with every other viz-mode setting — also makes them shareable via URL/bookmark like everything else, not just locally remembered.
- Keyframes "Complete vs Smooth" toggle now uses the app's default small `Switch` instead of a custom oversized one.
- Export modal shows a count of local BYOD COG sources next to "Include local COG files".

# Changelog — COG GSD surfacing & Foldable Bookmarks Tree 
<!-- released: 2026-07-30 -->

#### TL;DR
- COG sources now auto-show their inferred native resolution and ground-sample distance.
- Bookmarks: drag-and-drop reordering, collapsible project folders, fold/expand-all, and an edit mode to keep the everyday view uncluttered.

### Features
- **Foldable bookmarks tree** — project (root) bookmarks collapse/expand their child views, file-tree style; a collapsed project shows a stand-in thumbnail (its first child's, by current order, or a placeholder), which hides once expanded since the children show their own.
- **Drag-and-drop reordering for bookmarks** — drag a project to reorder among projects, or a child view to reorder among its own project's siblings; a highlighted line under the target row shows where it'll land instead of outlining the row. Dragging a project only targets other projects (never children), dragging a child only targets siblings of the same project, and dropping over an *expanded* project lands the indicator below its last child rather than right under the header.
- **Fold-all / expand-all** and an **Edit mode toggle** (same convention as the Drawing panel's own layer-edit toggle) for the bookmarks list — rename/delete stay hidden until switched on, so the everyday view is just thumbnails, names, and add-child.
- **Bookmarks gallery** now groups view cards under their parent project's name instead of showing the parent as its own card.
- Clicking a project now restores (and highlights) its first child *by current display order* — reordering children changes what a project click shows, instead of always the originally-created child.
- **Project export**: local COG files now bundle into a `local-cogs/` subfolder inside the export zip instead of the zip root; a new "Bookmark thumbnails as a .zip" option (independent of "Include local COG files") externalizes thumbnails into `bookmarks_thumbs/` on request. Sub-options now sit directly under the category they modify (local COGs under Sources, thumbnails-in-zip under Bookmarks) instead of all at the bottom, and View & Viz State moved to the top of the list.
- **Basemap/terrain source modals** — a copy-to-clipboard icon next to the `{z}/{x}/{y}` / bbox template hint.
- **HERE Maps satellite** added as a builtin basemap provider, key-gated (hidden from the picker until a HERE API key is set, in Settings or `VITE_HERE_API_KEY`) — reordered the builtin basemap picker to Google Hybrid, Bing, Esri, Mapbox, HERE, Google Sat, OSM.
- **BYOD basemap sources** gain user-settable Min/Max Zoom (previously only BYOD terrain sources had this).
- **COG native-resolution inference** — the Add/Edit Terrain/Basemap modals now show the geomatico-inferred native-resolution zoom and mean ground-sample-distance (GSD) for COG/local-COG sources, with Min/Max Zoom as an explicit override; a permanently failed fetch (e.g. CORS) now shows a clear message instead of "Detecting…" forever.
- **BYOD modal rework** — field order is now Name → Type → URL; Advanced now leads with Description and Min/Max Zoom ahead of Linked Source/Bounds and only auto-expands for a non-default value in one of those (not Description alone); COG file requirements are now a "Must be:" bullet list below the file picker.
- Mapbox/MapTiler/Google/HERE API keys moved out of committed source into a local, gitignored `.env`; the Settings batch-edit textarea now uses the same `MAPBOX_ACCESS_TOKEN`-style names (just add/remove `VITE_` to copy between the two).
- **react-scan** added for local dev (dead-code-eliminated from production builds) — outline-rerenders off by default, toggle via its own toolbar.

### Bug Fixes
- **Elevation Picker / Sun-Shadow Calculator** — toggling back to "Select" after drawing something could permanently disable the picker toggle; both now track the shared draw-mode state directly instead of a stale local mirror that only updated on feature edits.
- **Basemap source modal** — pasting a URL containing `{z}/{x}/{y}` while the source type is WMS no longer corrupts the braces into percent-encoded characters (a `new URL()` round-trip was re-encoding the *entire* URL, not just the bbox param it was meant to normalize).
- **Project export** — a plain export (no local COGs) that still had bookmark thumbnails was silently producing real zip bytes labeled and downloaded as `.json`; it now stays a genuine bare JSON document unless a zip is actually requested.
- **Umami analytics** — the `options-relief-visualization` event fired on almost every render instead of only on an actual toggle: the tracked snapshot never stored `svfPrecision`/`opennessPrecision`, so the diff check compared a real value against permanently-`undefined`. Dropped the broken tracking for those two settings.
- **Esri/Bing/Google Satellite maxzoom** corrected (Esri 19, Bing/Google Sat 21) and Bing's hardcoded-token tile URL replaced with the public quadkey endpoint.
- **Color-ramp `<Select>`** — the gradient swatch stopped showing in the closed trigger after the radix→base-ui migration (base-ui's `SelectValue` only renders plain text by default); fixed via its render-prop.
- **Symmetric-range sliders** (Curvature, LRM, Shape Index, Openness, Local Dominance, TPI) could be dragged to a degenerate zero-width range at their minimum; each now floors at its own step instead of 0. TRI/Roughness max range 500→250, TPI max range 100→50.
- **Basemap source-info section** now always renders in the sidebar (matching Terrain), instead of only when Raster Basemap is toggled on.

# Changelog — Whole-Project Export, Hard Shadows & Sun Shadow Calculator
<!-- released: 2026-07-28T17:41 -->

#### TL;DR
- **Whole-project import/export** in one file (terrain/basemap sources, bookmarks, drawings, settings, with zip to embed vector drawings/local COGs as an option).
- **Hard Shadows**: a new visualization mode casting real hard shadows from the shared light direction, independent of the Sun Shadow Calculator tool.
- **Sun Shadow Calculator**: pick a point + an object's height, get its shadow at the current sun position.
- SVF/Openness gain faster precision, plus a new Principal Components (PCA) relief-mode family (Blobness, Eigenvalue Ratio, Dominant Orientation, Shape Index).
- Terrain Analysis's Settings description split into 3 subheadings (Surface derivatives, Neighborhood statistics, Principal Components) to match.

### Features
- **Whole-project import/export** (`138d369`) — sources, bookmarks, drawings, and settings in one file.
- **Hard Shadows visualization mode** (`f802f12`) — hard cast shadows from the shared light direction, as its own toggleable layer independent of the Sun Shadow Calculator tool.
- **Sun Shadow Calculator** (`fc00c4d`) — pick a point and an object height, get its shadow at the current sun position; gated behind Beta (`3ac9196`).
- **SVF/Openness/PCA relief-mode family** (`5806ea9`) — faster precision plus Principal Components siblings (Blobness, Eigenvalue Ratio, Dominant Orientation) and a standalone Shape Index (`d16b23e`).
- **Terrain Analysis Settings description split into Surface derivatives / Neighborhood statistics / Principal Components subheadings** (`b303d9b`) — matching the PCA family's arrival above; also documents Shadows.

# Changelog — Bookmarks & Feature Iterator
<!-- released: 2026-07-28T09:20 -->

#### TL;DR
- **View bookmarks**: save/restore full viewport + viz state, sidebar list + gallery.
- **Feature Iterator**: step through a drawn/imported layer's features one at a time (select, delete, arrow-key nav, fly-to-next).
- A compute-time estimate now shows for slow modes (SVF, Openness, Local Dominance) while their tiles are still loading.

### Features
- **View bookmarks** (`4f7970e`) — save/restore full viewport + viz state, sidebar list + gallery; reorder/hierarchy and geocoded names followed within days (`122a57f`).
- **Feature Iterator** (`46ff80c`) — step through a TerraDraw layer's features one at a time; select/delete/arrow-key nav and fly-to-next-on-delete followed the same session (`26b8670`, `72f3c07`, `82c1668`).
- **Compute-time estimate for slow modes** (`37cd729`) — SVF/Openness/Local Dominance now show an estimated time-remaining while their ray-marched tiles are still computing, based on an empirically-tracked concurrency rather than a naive sequential assumption.

# Changelog — Linked Terrain/Basemap Sources & Non-Geo Mode
<!-- released: 2026-07-28T01:32 -->

#### TL;DR
**Linked terrain/basemap source pairing**: for paired datasets like a fresco's DTM plus its own albedo photo, picking one auto-selects the other. Part of this app's non-geo mode, a **complementary** viewer to RTI/PTM tools like [OpenLime](https://github.com/cnr-isti-vclab/openlime) (not a replacement) for viewing normal-map/albedo photogrammetry data as if it were terrain. See [issue #1](https://github.com/Iconem/terrain-viewer/issues/1) for the feature-parity tracker, and a real example on [OpenLime itself](https://3d.iconem.com/syria/DuraEuropos_Synagogue/index-openlime.html) for comparison.

### Features
- **Linked terrain/basemap source pairing** (`e63746f`) — for paired datasets like a fresco's DTM + albedo photo, picking one auto-selects the other; fixed for real the next morning — imperative resolution, folded link UI, extended to split-view B side (`971d813`, `17fb8fb`). The mechanism behind this app's non-geo mode: a complementary viewer to RTI/PTM tools like OpenLime (not a replacement), for viewing normal-map/albedo photogrammetry data as if it were terrain — see issue #1 for the feature-parity tracker, and a real example on OpenLime itself for comparison.

# Changelog — Contours extended, Local Persistence, Routing & New Tools
<!-- released: 2026-07-27T20:31 -->

#### TL;DR
- Contours extended to local/BYOD COG sources via a dedicated worker, plus line-weight and color controls.
- Local COG files and vector layers now survive a reload via OPFS persistence.
- **Routing mode for Elevation Picker**: a BRouter/Valhalla road-following route (foot/cycle/vehicle profiles) between two picked points instead of a straight line, with a routed elevation profile along it.
- New tools: Source Info panel (states which underlying provider a composited Mapterhorn/AWS tile actually came from, not just the mosaic's name), Plane Slicer (choose Local Relief Model or raw altitude as the reference plane; Contours share the same choice), Local Dominance relief mode (later sped up via pyramid octaves).
- Shared custom colorramp editor extended across every viz mode.
- A cancel button for DTM export appears after ~1.5s if the export is still running.

### Features
- **Routing mode for Elevation Picker** (`214e8df`) — a BRouter/Valhalla road-following route between two picked points (foot/cycle/vehicle profiles) instead of a straight line, with a routed elevation profile along it.
- **Source Info panel** (`81617b1`) — per-tile data-provenance display: for a composited/mosaicked source like AWS Terrain Tiles or Mapterhorn, states which underlying provider tile a given viewport area actually came from, instead of just naming the mosaic itself.
- **Plane Slicer** (`53b5c32`) under Elevation Picker — like Contours, lets you choose whether the slicing/height reference is raw altitude or the Local Relief Model (`planeSlicerReferenceMode`).
- **Local Dominance relief mode** (`22daa85`) — sped up via pyramid octaves (`5c04c82`) — plus a point-to-point profile/line-of-sight tool.
- **Contours extended to local/BYOD COG sources** (`0bb59df`, verified working `1896cfd`) via a dedicated worker — previously contours only worked against the builtin tiled sources (see the Nov 2025/Feb 2026 contours history further down). Gained a line-weight control (1×/2×/4×, `8a6dc12`) and dedicated color pickers (`40a5bb3`); a mount-order race that could drop the layer on a fresh page load was fixed the same week (`8ad313d`).
- **OPFS persistence** for local COG files (`c8948b2`) and drawn/imported vector layers (`00de93b`) — both now survive a reload.
- **Shared custom colorramp editor** extended across every viz mode (`3fab95a`, `9d69b46`).
- **Cancel button for DTM export** (`6798152`) — appears after ~1.5s if the export is still running (most finish faster, so the affordance only shows up when it's actually worth using).

# Changelog — RiverREM
<!-- released: 2026-07-27T12:03 -->

#### TL;DR
The footer's "Also see" links now explicitly describe **[RiverREM](https://rem.prod.heritagewatch.ai/)** ([repo](https://github.com/Iconem/RiverREM_UI)), a separate app built for a similar use case, on rivers instead of terrain: draw or import a river centerline (or fetch one from OSM via Overpass/QLever, the longest named waterway, or all matches), smooth/interpolate its water-surface elevation (WSE) along that line, then de-trend the DEM against it (`REM = DEM − WSE`) to get a Relative Elevation Model highlighting fluvial terraces a flat elevation map hides, pure client-side, or server-based via OpenTopography's Python `RiverREM`.

### Features
- **RiverREM footer link** (`115d789`) — the same commit that added the shared hillshade/Phong datetime light (see the historical-satellite entry above) also added this app's own footer link to RiverREM, a separate Iconem app for the analogous river-relative-elevation-model use case.

# Changelog — Matcap/Phong Lighting Rebuilt as Live WebGL Shaders
<!-- released: 2026-07-22T15:26 -->

#### TL;DR
Matcap/Phong lighting was rebuilt as live WebGL shaders, then reverted the same morning to a GPU-accelerated raster-tile approach after the WebGL version proved unstable; native MapLibre Hillshade was restored as its own mode alongside it.

### Features
- **Matcap/Phong Lighting rebuilt as live WebGL shaders, then reverted to GPU-accelerated raster tiles** — Lighting Effects was first redesigned around local-file/COG basemap sources (`674103f`), then rebuilt as custom WebGL layers with live shader uniforms less than 20 minutes later (`e047058`). After native MapLibre Hillshade was restored as its own mode alongside it (`5619d6c`) and a globe-rendering fix was attempted (`7153d02`), the WebGL rebuild proved unstable and was reverted back to plain raster-tile protocols the same morning (`d2833b0`), which then got GPU-accelerated instead (`6ef0651`), the version that stuck. An RTI-style hold-L light-control overlay for quick relighting had landed a few days earlier (`3f941c0`). An absolute/camera-relative light-mode toggle (`5367e36`) and, the next day, camera-attached live light plus a no-debounce "2D Fast" mode (`3067467`) rounded it out.

# Changelog — Theme Editor
<!-- released: 2026-07-21T23:14 -->

#### TL;DR
New standalone **Theme Editor**: live Tailwind v4/shadcn theming with tweakcn/shadcnstudio presets.

### Features
- **Theme Editor** (`690fa35`, presets `35ba71c`/`a6ea8e8`, Basic mode `42e9c16`) — a standalone, drop-in live Tailwind v4/shadcn theme editor with HSL adjustment/randomize and localStorage-saved custom themes (`ed4f502`), plus themux/shadcnstudio preset packs; later moved into Settings (`b9b6622`).

### Bug Fixes
- `7579f06` fixed the Theme Editor's fonts never actually applying.

# Changelog — Relief Visualization Split & Sidebar Labels
<!-- released: 2026-07-18T19:05 -->

#### TL;DR
- **Relief Visualization** split into its own separate group (**Sky View Factor SVF, Openness**) from **Terrain-analysis (Curvature, TPI, Roughness, Det-Hessian, Blobness)**.

  ![Sky-View Factor relief visualization](/docs/screenshots/svf.jpg)
- Relief Visualization and Terrain Analysishave a Basic/Advanced collapse toggle to either just activate/deactivate the additional sub-modes, or go further and edit their symbology.
- **Keyboard shortcuts**: Shift-tap to peek at the raster basemap, Ctrl-tap to hide every overlay down to just the basemap. See all keyboard shortcuts in the dedicated section of General Settings modal. 
- **Labeled Sources / Options / Detectors / Tools sidebar dividers** for scanning a long control panel.

### Features
- **Terrain Analysis / Relief Visualization split into separate groups** (`34065c4`) — same commit also added the Shift-tap basemap-peek shortcut and macro-group separators.
- **Basic / Advanced mode toggle** — Terrain Analysis and Relief Visualization sections collapse to just checkbox + opacity slider, hiding sub-mode options until wanted.
- **Keyboard shortcuts** — Shift-tap to peek at the raster basemap; Ctrl-tap to hide every overlay down to just the basemap, tap again to restore.
- **Labeled sidebar dividers** (`8e8d71a`) — Sources / Options / Detectors / Tools section breaks for scanning a long control panel; pinned open + reordered a day later (`7e2069d`).
- **Same source on both A/B** — split-screen source pickers only ever showed one side as selected, even when both used the same source; fixed to show both independently.

### Bug Fixes
- **Sidebar scroll/header glitches** — corner-rounding squaring off, button group shifting, fast-scroll jitter.
- **Overlays ignoring their own max zoom** — hardcoded limit overrode a source's real tile pyramid (e.g. NASA GIBS), causing tile-request errors.
- **2D Elevation Picker freeze** on large COG files.

# Changelog — TerraDraw Multi-Layer Drawing
<!-- released: 2026-07-18T12:12 -->

#### TL;DR
TerraDraw becomes multi-layer: drawing and GeoJSON import now target whichever layer is active.

### Features
- **Multi-layer TerraDraw** (`2218813`) — drawing and importing GeoJSON now target a specific layer instead of one implicit layer (GeoJSON import itself dates back to TerraDrawSystem's original introduction, Feb 2026 — see further down); the same commit also fixed a TerraDraw cold-start delay.

# Changelog — Local COG (BYOD) Terrain Sources
<!-- released: 2026-07-15 -->

#### TL;DR
- **Local COG (BYOD) terrain sources**: load a `.cog.tif` straight off disk, no upload.
- **Viz-mode tile caching**: an LRU of finished viz-mode tile bytes that makes re-toggling a mode instant instead of recomputing it.

### Features
- **Local COG (BYOD) terrain sources** (`a0c9da3`) — pick a `.tif` off disk, no upload, with CRS/tiling validation.
- **Viz-mode tile caching** (`cacheVizTiles`, same commit `a0c9da3`, later touched again `138d369`) — an LRU of finished viz-mode tile bytes that makes re-toggling a mode instant instead of recomputing it.

# Changelog — Mound Local Tops Detector Beta
<!-- released: 2026-07-12 -->

#### TL;DR
Experimental **"Tells" archaeological mound detector**, gated behind a Beta toggle: flags candidate mounds by finding local extrema/maxima of the LRM, then veto-filters them by Blobness, Plan Curvature/Divergence, and Det-Hessian to reject saddles and ridges.

### Features
- **Archaeological mound detection ("Tells")** (`125edbb` protocol, gated `76c55f5`, explainer `3bada59`) — experimental detector flags candidate mounds from curvature/blobness; own section, color-by ramps, export, explainer, beta toggle.

# Changelog — Terrain Analysis: Curvature Suite Expanded
<!-- released: 2026-07-11 -->

#### TL;DR
**Terrain-analysis suite**: **Profile curvature** (rate of slope change along the steepest-descent direction, i.e. flow acceleration) and **Plan curvature** (rate of aspect change across contours, i.e. flow convergence/divergence), plus **TPI and Roughness; Det-Hessian and Blobness** followed.

### Features
- **Curvature/TPI/Roughness terrain-analysis suite** (`ca3b679`) — Profile curvature and Plan curvature (defined in the TL;DR above), TPI, and Roughness; the 3×3-neighborhood default and the profile/plan split were documented in Settings the same day (`5d0c200`).
- **Det-Hessian curvature mode and Blobness structure-tensor sub-mode** (`23f6079`) — added a day later.
- **Higher-precision terrain-derived tiles** — curvature, aspect, TRI, roughness, openness, blobness, and LRM now wire-encode ~25x finer, cutting visible banding.

### Bug Fixes
- **TerraDraw**: init race, GeoJSON import double-counting, Fast-Refresh break.
- **Minimap**: cold-start delay and resize bug.
- **TypeScript errors cleared to zero**.

# Changelog — Local Relief Model (LRM) Relative Elevation to neighborhood
<!-- released: 2026-07-10T12:41 -->

#### TL;DR
**Local Relief Model (LRM)**: a new relief mode isolating local bumps from the regional trend. This is compute-optimized by subtracting the elevation tiles altitude at native viewport resolution from the bi-linearly interpolated trend, requested from a lower resolution version of the pyramid. User can control how many levels lower, and sees the resulting gaussian mean scale he chooses.

### Features
- **Local Relief Model (LRM)** (`d45a4ae`) — multi-scale relief mode isolating local bumps from the regional trend.

# Changelog — Client-Side DSM Export, Project Presets, Basemap Overlays & Elevation Picker
<!-- released: 2026-07-09T22:52 -->

#### TL;DR
- **Client-side GeoTIFF export** without Titiler, and shareable per-project embed configs.
- **Project embed presets**: `?project=` links can seed a fully preconfigured view: 
   - **[Mapterhorn Globe](/?project=mapterhorn-globe)** (zoomed-out world view, Mapterhorn-only, source pickers hidden), 
   - **[Dura Frescoes Viewer](/?project=dura)** (fixed 2D non-geo fresco view, most terrain-analysis tooling hidden), 
   - and a minimal **[Example Embed](/?project=example-embed)**, see [lib/projects.json](https://github.com/Iconem/terrain-viewer/blob/main/lib/projects.json).
- **Basemap overlays** (samples ships demo radar, trails, stamen watercolor) that layer on top of any basemap instead of replacing it.
- **Elevation Picker**: click-to-sample elevation at point or delta between two-points

### Features
- **Client-side DTM export & project embed system** (`57c3d7a`) — export GeoTIFF from the browser without Titiler; per-project embed/URL config; a WMS layer picker for BYOD WMS sources.
- **Project embed presets** (`a1d8ab8`) — `?project=` presets can seed custom sources, auto-zoom to a source's real (COG-read) bounds, override the sidebar title, and are exportable via a "Save Project Preset" tool in Settings. Shipped with: **Mapterhorn Globe** and **Dura Frescoes Viewer** presets (`lib/projects.json`), each simplifying the sidebar to just what that site needs — Dura hides contours/Terrain-Analysis/Relief-Visualization/split-screen/elevation-picker entirely and disables the globe view mode, Mapterhorn Globe hides every source picker and opens straight into a zoomed-out globe.
- **Elevation Picker** (`a1d8ab8`) — click-to-sample elevation (3D/globe via `queryTerrainElevation`, 2D via client-side tile fetch/decode), two-point delta, auto-deactivates during TerraDraw drawing modes.
- **Basemap overlays** (`a1d8ab8`) — role (basemap/overlay) on custom basemap sources, multi-select overlay checklist, stacked rendering, sample overlays (Stadia Watercolor, Waymarked Trails, OpenWeatherMap radar), shared basemap opacity slider.

### Bug Fixes
- **Slope-and-More now supports all source types**, project embed polish, several stale-state fixes (`dd2f462`).

# Changelog — Slope Visualization Mode 
<!-- released: 2026-07-08T17:14 -->

#### TL;DR
**Slope visualization mode**: launched as a PlanTopo server-hosted overlay (computed offline from Mapterhorn), upgraded to a client-side "Slope and More" v2: a custom MapLibre protocol computed directly from whichever terrain source is active (BYOD included), rather than PlanTopo's own fixed dataset. Later grew into the full curvature/TPI/roughness/LRM/Tells suite above.

![Slope-angle visualization mode](/docs/screenshots/slope.jpg)

### Features
- **Slope viz mode** (`ba51907`) — a PlanTopo-hosted server overlay (their own precomputed slope-angle raster); upgraded the same day (`8612990`) to a client-side custom MapLibre protocol computed from whichever terrain source is active ("Slope and More" v2) — the same viz mode that later grew into the full curvature/TPI/roughness/LRM/Tells suite (see the Jul 10–12 entries above).

# Changelog — NextGIS QMS, Photon Geocoder, Animation Pose via URL & TileJSON
<!-- released: 2026-07-07T23:39 -->

#### TL;DR
- **NextGIS QMS search**: search and add basemaps directly from [NextGIS QuickMapServices](https://qms.nextgis.com/) public catalog; 
- Switched search location geocoder to **Photon geocoder**.
- Camera/animation poses are now URL-shareable.
- Added TileJSON data source type
- Added new colorramps CET/SDR ramps 

### Features
- **Camera/animation pose rework** (`ca16705`) — URL-shareable camera state (nuqs, deltas between pose1/pose2 rather than compressed absolutes); Home now correctly resets saved poses.
- **NextGIS QMS search** (`517898a`, overflow/templating fix `a2e24cd`) — search and add basemaps directly from NextGIS's public QuickMapServices catalog.
- **More data sources** — TileJSON, CET/SDR ramps, WMS-raw, Photon geocoder.

# Changelog — Light-Direction Spherical Control via XYPad
<!-- released: 2026-02-19T14:24 -->

#### TL;DR
Light-direction control for Hillshade via XYPad: drag a 2D pad to set illumination azimuth/elevation, instead of two separate sliders.

![Dragging the XYPad to set light azimuth/elevation](/docs/screenshots/hillshade-direction.webp)

### Features
- **XYPad for 2D illumination-direction selection** (`07fc46e`) — drag a pad to set Hillshade/Phong light azimuth+elevation together; gained real angular constraints (can't drag past the sun's physically reachable range) five days later (`3b85160`). The *true* bidirectional datetime binding (drag the pad, back-solve the closest matching day/time; day/night-boundary hatching) came much later — see the Aug 7 entry above (`a43a99f`, `09f3803`).

# Changelog — Animation, Video Export & Minimap
<!-- released: 2026-02-19T10:30 -->

#### TL;DR
- **Animation Capabilities**, with keyframe-based (Complete vs Smooth) video export.
- **Video export** tries **MediaBunny** first (real muxed MP4/H.264 via WebCodecs), falling back to raw **WebCodecs** (H.264, no muxing) if MediaBunny throws, then all the way to **MediaRecorder** (WebM) if the browser lacks WebCodecs entirely.
- **Minimap** with main viewport footprint/frustum bbox shown, fully configurable.
- Finer Terrarium quantization (4mm vs. TerrainRGB 10cm) shipped as a High-Precision toggle.

### Features
- **Minimap with footprint and frustum** (`96d8b04`, preceded by WIP passes `349785e`/`1c0e656`).
- **Animation Capabilities** (`40b32c7`) — keyframe poses, Complete (interpolates every numeric setting) vs Smooth (camera-only) modes; native share for mobile (`a00f613`, `cd90bb3`).
- **Video export overhaul** (`93cbc77`, superseding earlier attempts `3b88d97`/`878fb70`) — three-tier fallback chain: **MediaBunny** (`69c3efe`) first, a real muxed MP4/H.264 via WebCodecs under the hood, no per-browser codec-support roulette; falls back to raw **WebCodecs** (H.264-ish, no muxing) if MediaBunny itself throws; falls all the way back to **MediaRecorder** (WebM, VP9/VP8) if the browser has no WebCodecs `VideoEncoder` at all. Restored/hardened in July (`740b724`).
- **High-Precision Elevation Quantization** (`ecd76ba`) — finer Terrarium encoding (3.9mm steps) as an alternative to TerrainRGB (10cm steps) via the Geomatico COG-protocol middleware, with a same-day fix for reset/layer state on high-res-quantized COGs (`b614aae`).

# Changelog — Drawing Tools via TerraDraw, Sources Samples & Contours Consolidation
<!-- released: 2026-02-18 -->

#### TL;DR
- **Drawing Tools** via TerraDraw: draw shapes, points, and more; import/export geojson features.
- **Load Sample buttons** added to the terrain/basemap source pickers with a variety of nation-wide sources.
- **Contours** reworked and consolidated into their own "Contours & GeoGrid" section.
- Fold/expand-all for every sidebar section, with collapsed state now persisted via jotai atomWithStorage.

### Features
- **TerraDrawSystem** (`42e5760`) — the drawing-tools system (shapes, points, GeoJSON import/export), alongside a rework of the main terrain-viewer component; reworked again the next day (`282304c`).
- **Contours reworked** (`8574074`, `f136a94`) — restructured into their own "Contours & GeoGrid" section (color pickers/line-weight controls followed later, July 2026 — see above).
- **Fold/expand-all for sidebar sections** (`4d96202`) — every section's collapsed/expanded state now persists via `atomWithStorage`, alongside a broader foldable-sections rework.
- Custom terrain/basemap samples added to the BYOD modals (`3cd8688`).
- **"Load Sample" buttons** on the terrain/basemap source pickers — likely also originate here (`3cd8688`), though not confirmed by a distinct commit citing that exact label; flagged as unconfirmed rather than guessed further.

# Changelog — BYOD Basemaps & WMS/DTM-DSM Sources
<!-- released: 2026-02-13 -->

#### TL;DR
- **BYOD basemaps** TMS, WMS, COG, finalized as their own custom-source type via custom protocol, alongside the existing BYOD terrain sources.
- **WMS raw-elevation support** (e.g. IGN France) now stream as MapLibre raster-dem via a custom MapLibre protocol. Standalone demo: [maplibre-raster-dem-wms-float32-generic.html](/maplibre-raster-dem-wms-float32-generic.html).
- DTM-DSM LidarHD selector in samples
- Graticule layer
- Share section

### Features
- **BYOD Basemaps finalized** (`3582cbd` prepare Feb 2, `671bd0b` finalize Feb 3) — custom basemap sources alongside the existing BYOD terrain-source support from Nov 2025.
- **IGN France WMS raster-DEM example** (`4606dd1`) — a real WMS raw-elevation source wired up as a MapLibre raster-dem terrain source.
- **WMS-raw elevation as raster-dem, generalized** (`d0fde9c`) — generalized the IGN France example above into a reusable **MapLibre custom protocol** (not a one-off fetch/transform) that decodes raw Float32 WMS elevation responses into MapLibre's raster-dem tile format directly. Standalone demo: [maplibre-raster-dem-wms-float32-generic.html](/maplibre-raster-dem-wms-float32-generic.html).
- **Graticule layer** (`0b5c12d`), **Share section** (`db380d1`), **DTM-DSM LidarHD selector** (`10e9609`).
- `TerrainControlPanel` exploded into one-file-per-section sub-components (`c4d2218`) — the sidebar's file structure since.

# Changelog — cpt-city Colorramp Library
<!-- released: 2025-11-18 -->

#### TL;DR
Adding a large open-license colorramp library, [cpt-city](https://phillips.shef.ac.uk/pub/cpt-city/), with classic, topo, topobath, top qgis, and temp groups.

### Features
- **cpt-city colorramp pipeline** (`ba2b492`): a large open-license colorramp library parsed via a new `cpt2js`-based pipeline, a standalone cpt-city archive-parser mini-app to harvest it (`57bf00a`), topobath ramps (`0ccb447`), and a further significant expansion (`b5254fc`).

# Changelog — Geomatico COG Protocol vs. Titiler
<!-- released: 2025-11-14 -->

#### TL;DR
Offer the choice to stream COG via **Geomatico's native MapLibre COG-protocol vs. Titiler**. The direct client protocol avoids Titiler's rate limiting and is faster (no middleware hop), but is less permissive: it only reads COGs already in Web Mercator (EPSG:3857), where Titiler can reproject on the fly server-side.

### Features
- **Geomatico COG Protocol introduced alongside Titiler** (`b6beb09`, toggle `9618fbc`). Direct client-side COG consumption as an alternative to the Titiler middleware: no server-side hop means no Titiler rate-limiting and lower latency, at the cost of only handling COGs already tiled in Web Mercator (EPSG:3857) — Titiler can reproject arbitrary source CRS on the fly, this can't. The toggle between them (`useCogProtocolVsTitiler`) is still in Settings → Streaming today.

# Changelog — BYOD (Bring Your Own Data) Terrain Sources
<!-- released: 2025-11-07 -->

#### TL;DR
**Bring Your Own Data (BYOD) Terrain** sources let users import their own TMS, COG remote endpoint terrain sources.

### Features
- **BYOD (Bring Your Own Data) terrain sources** (`f24c1bc`): the initial scaffold's `terrain-types.ts` already had a placeholder `"custom"` encoding value, but the real user-facing feature (Add Custom Terrain Source modal, wiring it up like any other source) landed 3 days later, in `f24c1bc`.

# Changelog — Initial Launch, Viz Modes, Shareable URLs & Split Mode
<!-- released: 2025-11-04 -->

#### TL;DR
- **Initial launch** with all user-controls on one foldable, sidebar control panel. UI transparency on slider change enables better-feedback, 2D/3D/Globe map projection modes.
- **Terrain visualization modes**: Hillshade (Combined, Standard, Aspect Multidir colors, Igor, Basic), Hypsometric color-relief, Raster Basemap
- **Sources for Terrain** (Terrarium /TerrainRGB): [Mapterhorn](https://mapterhorn.com/), [Mapbox](https://www.mapbox.com/), [Maptiler](https://www.maptiler.com/). [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
- Source for Raster Basemaps: [Google](https://mapsplatform.google.com/), [Bing](https://www.bing.com/maps/aerial), [ESRI](https://www.esri.com/en-us/arcgis/products/arcgis-image/services/world-imagery), [Mapbox](https://www.mapbox.com/), [Here](https://www.here.com/), [OSM](https://www.openstreetmap.org/)
- **Shareable URLs**, State persisted to URL via nuqs so any shared url results in visually the exact same map.
- **Split Mode**: A/B side-by-side comparison, originally built for comparing the same location's resolution/quality across different terrain sources (Mapterhorn vs. Mapbox/MapLibre terrain-RGB vs. AWS Terrain Tiles).

### Features
- **Initial launch** (`29ced9e`, `1e12655`, `535bb2a`, `c4d067f`) — the app's first version already had Hillshade, hypsometric tint (color-relief), a raster basemap, split-screen A/B comparison, and a UI-transparency option, all driven from the sidebar control panel (`components/terrain-controls.tsx`, `components/terrain-viewer.tsx`, `components/ui/sidebar.tsx`) — contours were present too, stabilized two days later (`069570e`).
- **Split Mode (A/B side-by-side comparison)** — built to compare the same location across different terrain sources at various resolutions/qualities (e.g. Mapterhorn vs. Mapbox/MapLibre terrain-RGB vs. AWS Terrain Tiles), not just different imagery. The later Overlay (blend-mode compositing) and Grid (up to 8 views) shapes both grew out of this original two-way split — see July/August 2026 above.
