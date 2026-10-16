# Change detection frameworks

Labelling before/after pairs of dated rasters, COG or not, with off-the-shelf annotation tools: CVAT, Label Studio
and labelme. None of them reads a GeoTIFF or a CRS, so this folder is the glue: TiTiler serves pixel-aligned chips
of any GDAL source by URL, one manifest carries the georeference and the pair metadata, and one converter brings
every export back to GeoJSON in the source CRS.

Tracking issue: [Iconem/terrain-viewer#19](https://github.com/Iconem/terrain-viewer/issues/19), which also holds the
tool comparison tables and the feature requests filed upstream. The same text as this README is on the docs site
under Dev, Change detection frameworks.

Tested on 2026-10-16 with the Amphipolis 10 cm RGB COG against Esri World Imagery, 1024 px chip at the
[terrain-viewer viewport](https://terrain-viewer.iconem.com/?zoom=18.4&lat=40.8227&lng=23.845) lng 23.845, lat 40.8227, zoom 18.4.
Polygons drawn at the same pixels in the three tools convert to the same EPSG:3857 coordinates.

## The tools, in the order we would pick them

- **[CVAT](https://github.com/cvat-ai/cvat)**, web, self-hosted with Docker Compose. A pair is a two-frame job and F/D is an exact flicker, the whole workflow is keyboard driven, and jobs, assignees, review stages and quality reports come with the open-source build. The data model fits a dated series: frames in date order, a `drawn_on` attribute per polygon. Requests filed: [cvat#11296](https://github.com/cvat-ai/cvat/issues/11296) for georeferenced input and GeoJSON export, [cvat#11297](https://github.com/cvat-ai/cvat/issues/11297) for pair tasks.
- **[labelme](https://github.com/wkentaro/labelme)**, desktop, `pip install labelme`. Opens the GeoTIFF chips directly, A/D flickers, batch labelling with `display_label_popup: false`. One analyst per folder, no jobs or review. Requests filed: a comment on [labelme#2209](https://github.com/wkentaro/labelme/issues/2209#issuecomment-6143351751) for GeoJSON export with the geotransform, [discussion 2763](https://github.com/wkentaro/labelme/discussions/2763) for tiled COG rendering and a compare image.
- **[Label Studio](https://github.com/HumanSignal/label-studio)**, web, Docker or pip. The least suited for raster time series today: the two images are independent viewports with no synced pan and zoom, no flicker, no swipe. Its one advantage is that the task JSON carries the pair metadata natively, so it is the easiest to script around. Requests filed: [label-studio#9985](https://github.com/HumanSignal/label-studio/issues/9985) for georeference fields and a GeoJSON converter, [label-studio#9986](https://github.com/HumanSignal/label-studio/issues/9986) for synced viewports with swipe and flicker.
- **[GeoLabel](https://github.com/Deadwood-ai/deadtrees-frontend)** from DeadTrees, the geo-native alternative: native COG rendering, polygons in PostGIS, auditor queue, row-level security, but one image per dataset and fixed classes. [deadtrees-frontend#158](https://github.com/Deadwood-ai/deadtrees-frontend/issues/158) asks for a generic change detection mode. Until then it is the fork candidate: pair table, second COG layer with flicker and swipe, configurable classes, a few days of work on a data model that is already most of the way there.

## Not covered here: GIS-native workflows

For teams already in QGIS, the alternative is to skip annotation tools altogether: QGIS with the QuickMapCompare plugin
for synced viewports and swipe, polygons straight into PostGIS or a GeoPackage, and QField or Mergin Maps for
assignment and offline capture with per-project roles and a change history. That route keeps the georeference
native and the data model yours, at the cost of CVAT's keyboard speed and review stages. GeoLabel from DeadTrees is
the browser-based, geo-native middle ground once [deadtrees-frontend#158](https://github.com/Deadwood-ai/deadtrees-frontend/issues/158)
or a fork gives it pairs. The comparison tables behind this choice are on [terrain-viewer#19](https://github.com/Iconem/terrain-viewer/issues/19).

QGIS plugins worth knowing for this route:

- [QuickMapServices](https://nextgis.com/blog/quickmapservices/), the basemap catalogue, Esri, Google, Bing and many more as layers in one click, the same sources `data/*.xml` describe for TiTiler.
- [Map Swipe Tool](https://github.com/lmotta/mapswipetool_plugin), a swipe divider between the active layer and the rest, the before/after comparison inside QGIS.
- [Feature Iterator](https://gitlab.com/cigeoe/feature-iterator-qgis-plugin/tree/master), step through the features of a layer one by one, which turns a grid of cells into a task queue.
- [send2map](https://wiki.iconem.com/images/research/gis/send2map_app.zip), Iconem's own, on the wiki.
- [Load Them All](https://github.com/gacarrillor/loadthemall), bulk load every raster or vector under a folder, for a cell's stack of dated GeoTIFFs.
- [qgis-mcp](https://github.com/nkarasiak/qgis-mcp), drive QGIS from an AI assistant over MCP.
- Further out: [Lat Lon Tools](https://github.com/hamiltoncj/qgis-latlontools-plugin) for coordinate capture and conversion, and [QGIS Timelapse](https://github.com/opengeos/qgis-timelapse-plugin) for animating a dated stack.

## Why TiTiler in the middle

The three tools take an image by URL, labelme takes a file. TiTiler's bbox endpoint turns any GDAL-readable source
into a PNG or GeoTIFF crop of an exact bounding box at an exact pixel size:

```
{titiler}/cog/bbox/{minx},{miny},{maxx},{maxy}/{w}x{h}.png?url={source}&coord_crs=EPSG:3857&dst_crs=EPSG:3857
```

- **Matching footprints.** Two dates almost never share a pixel grid: different footprints, ground sample distance,
  sometimes CRS. Asking for the same bbox and size from each source gives chips aligned to the pixel, so flicker and
  side by side are exact without warping anything yourself.
- **Not only COGs.** `source` is whatever GDAL opens: a remote COG, a local GeoTIFF, a VRT, a NetCDF subdataset, or a
  GDAL description file. `esri_tms18.xml` wraps Esri World Imagery tiles as a TMS source, and the same XML form covers
  any XYZ or WMTS basemap. One tile server, one URL grammar, every input.
- **Georeference for free.** The crop is warped to `dst_crs`, so the chip's geotransform is known from the request
  alone: origin at `minx, maxy`, pixel size `(maxx - minx) / w`, no rotation. Nothing has to be read back from the
  image.
- **GeoTIFF on demand.** `.tif` instead of `.png` embeds that geotransform, which is what labelme gets.
- **Credentials stay server side.** TiTiler holds the bucket or WMTS credentials, the annotation tool only sees TiTiler URLs.

## One compose stack

`docker-compose.yml` in this folder starts TiTiler on 8010, the CVAT frame-name shim on 8020, Label Studio on 8081,
and CVAT on 8085 by including CVAT's own compose file from a `cvat/` checkout next to it. `cvat.env` sets the
Smokescreen flag and the host name, `docker-compose.override.yml` moves CVAT off port 8080.

```sh
git clone --depth 1 https://github.com/cvat-ai/cvat.git     # once
docker compose up -d                                       # everything
docker compose up -d titiler chip-shim label-studio        # without CVAT
docker exec -e DJANGO_SUPERUSER_USERNAME=admin -e DJANGO_SUPERUSER_PASSWORD=... -e DJANGO_SUPERUSER_EMAIL=a@b.c cvat_server python3 /home/django/manage.py createsuperuser --noinput
```

GDAL source files go in `./data`, which is `/data` inside TiTiler. Inside the stack the services reach each other by
name, so `sources.json` uses `http://titiler` for the server-side URLs and `http://chip-shim:8020` for the shim, and
`http://127.0.0.1:8010` for what the browser and labelme fetch. The included CVAT file has been validated with
`docker compose config`; the stack was exercised in this test with the same services started by hand on the same ports.

## Setup

```sh
pip install -r requirements.txt                     # requests, rasterio, label-studio-sdk, cvat-sdk; labelme separately
docker run -d --name titiler -p 8010:80 -v "$PWD:/data" ghcr.io/developmentseed/titiler:latest
python make_pair.py 1024                            # writes pair.json
```

Then one of:

```sh
# Label Studio: pip install label-studio; label-studio start --port 8081 ...
LS_URL=http://127.0.0.1:8081 LS_API_KEY=... python labelstudio_task.py

# CVAT: git clone https://github.com/cvat-ai/cvat && SMOKESCREEN_OPTS=--unsafe-allow-private-ranges docker compose up -d
python chip_proxy.py 8020 &                          # frame-name shim, CVAT only, see Workarounds
CVAT_URL=http://localhost:8085 CVAT_USER=... CVAT_PASS=... python cvat_task.py

# labelme: pip install labelme
python labelme_task.py
python -m labelme labelme_files/amphipolis_pair_001 --labels labelme_files/amphipolis_pair_001/labels.txt
```

And back to GeoJSON, whatever the tool:

```sh
python to_geojson.py pair.json <export.xml | export.json | labelme.json> out.geojson
ogr2ogr -t_srs EPSG:4326 out_wgs84.geojson out.geojson
```

## The manifest, `pair.json`

Single source of truth. Every builder reads it, the converter applies it.

```json
{
  "pair_id": "amphipolis_pair_001",
  "crs": "EPSG:3857",
  "geotransform": [2654181.54, 0.4526, 0.0, 4986456.74, 0.0, -0.4526],
  "width": 1024, "height": 1024,
  "classes": ["no-change", "destruction", "construction", "modification"],
  "before": {"id": "esri_world_imagery", "date": "unknown", "url": "...png", "tif_local": "...tif"},
  "after":  {"id": "amphipolis_rgb_10cm", "date": "2024", "url": "...png", "tif_local": "...tif", "source_cog": "https://..."}
}
```

The geotransform is the six-term GDAL affine. With TiTiler warping to `dst_crs` the rotation terms are zero, but the
converter applies the full affine, so a source served in its native rotated geometry works unchanged.

## Data model of each service, and how the pair maps onto it

### CVAT

- **Unit of work**: a task of frames, split into jobs. A pair is a two-frame task, or a two-frame segment of a longer series.
- **Frames**: the server downloads each URL at task creation and names the frame after the URL's last path segment. That name is the only place the pair identity survives, so the shim encodes `{pair}_{1|2}_{before|after}_{image_id}` into it.
- **Labels**: the four classes, each with a `drawn_on` select attribute, values `before` and `after`.
- **View**: one frame at a time, F and D step frames, which is an exact flicker. V and C step by the configured step size.
- **Export**: CVAT for images 1.1 XML, polygons in pixels, attributes included. Native georeferencing requested in [cvat#11296](https://github.com/cvat-ai/cvat/issues/11296), pair tasks in [cvat#11297](https://github.com/cvat-ai/cvat/issues/11297).
- **Assignment and review**: jobs, assignees, annotation and validation stages, quality reports, all in the open-source build.

### labelme

- **Unit of work**: a folder of images. Annotations are one JSON per image, next to it.
- **Files**: the two chips as GeoTIFF from TiTiler's `.tif` output, named `{pair}_{1|2}_{before|after}_{image_id}.tif` so A and D step between them. `labels.txt` holds the classes, `pair.json` sits beside the files.
- **Labels**: the dialog remembers the last class, so Enter confirms it. For a true batch run start with
  `--config "display_label_popup: false"`, draw every polygon of one class, then switch class and continue. `--keep-prev` copies the previous image's shapes onto the next one, useful when the before polygon should be adjusted on the after image rather than redrawn.
- **Export**: labelme JSON, pixel coordinates. The converter reads the geotransform from the manifest. Native GeoJSON requested in [labelme#2209](https://github.com/wkentaro/labelme/issues/2209), tiled COG and compare image in [discussion #2763](https://github.com/wkentaro/labelme/discussions/2763).
- **Assignment and review**: none, one analyst per folder.

### Label Studio

- **Unit of work**: a task. Task `data` is free JSON, so it carries the pair id, both image ids, both dates and the geotransform verbatim.
- **Labeling config**: two `<Image>` tags, `before` and `after`, each with its own `<PolygonLabels>` holding the four classes. Which image a polygon was drawn on is therefore implicit in the region's `to_name`. See `labelstudio_config.xml`.
- **Images**: loaded by the browser from the URL. The TiTiler host must be reachable from the analyst's machine and send CORS headers, which TiTiler does by default.
- **View**: side by side, independent zoom and pan. No flicker, no swipe. Requested in [label-studio#9986](https://github.com/HumanSignal/label-studio/issues/9986).
- **Export**: JSON. Polygon points are percentages of the image. The converter multiplies by chip size and applies the geotransform. Native GeoJSON requested in [label-studio#9985](https://github.com/HumanSignal/label-studio/issues/9985).
- **Assignment and review**: basic in the community edition, review stages are Enterprise.

## Workarounds, and why each exists

- **CVAT frame naming.** Every TiTiler bbox URL ends in `1024x1024.png`, so two chips in one task collide. `chip_proxy.py` is a pass-through that gives each chip a distinct path and forwards to TiTiler. In production, the same rewrite belongs in nginx or Caddy in front of TiTiler.
- **CVAT private hosts.** CVAT fetches URLs through Smokescreen, which refuses private IP ranges. For a TiTiler on the same machine or LAN set `SMOKESCREEN_OPTS=--unsafe-allow-private-ranges`, or give TiTiler a public hostname.
- **CVAT hostname.** The default compose routes on `Host: localhost`. Open it as `localhost`, not `127.0.0.1`. A first page load right after login can show "Authentication credentials were not provided" while the session cookie settles, a reload fixes it.
- **Label Studio tokens.** 1.23 disables legacy API tokens per organisation. Enable them once with `POST /api/jwt/settings` or use a personal access token from the UI.
- **Label Studio images.** Loaded by the browser, not the server. Some browsers refuse the image when the page and the image use different loopback host names, `localhost:8081` against `127.0.0.1:8010` failed, `localhost` for both worked. Use one host name for Label Studio and TiTiler, and open the image URL in a tab first when something does not render.
- **labelme 7.** `--nodata` and `--autosave` are gone because both are defaults. Run `python -m labelme` when the Scripts directory is not on PATH. Never name a sibling folder `labelme`, Python imports it instead of the package.
- **Esri as a date.** The Esri export endpoint caps the scale, so the basemap is read through a GDAL TMS XML with a tile cache. Real tiles stop at zoom 18 over Amphipolis.

## Gridding a large raster and a long series, the reasoning behind `cdtasks.py`

Nothing in the recipe changes, only the manifest grows. Implemented in `cdtasks.py` below and run on a 3 x 3 grid at three dates; the 10k x 10k at ten dates figures are extrapolated from that.

**Grid.** Cut the area of interest into cells the annotator can work with. At 1024 px a 10k x 10k raster is a
10 x 10 grid, 100 cells. Overlap cells by 5 to 10 percent so a feature on a boundary is seen whole in at least one
cell, and dissolve duplicates on export. 1024 to 2048 px is the usual range.

**Pairs versus series.** Ten dates give nine consecutive pairs per cell, 45 if every combination matters. Consecutive
pairs is the normal choice: 100 cells x 9 pairs = 900 units of work. One unit is one CVAT job, one Label Studio task,
or one labelme folder. One manifest row per unit with cell id, both dates, both image ids and the geotransform.

**CVAT layout.** One task per cell with the ten dates as frames in date order. Segments cannot overlap, so
`segment_size=2` gives jobs (1,2), (3,4) and loses (2,3). Either duplicate the shared frame in the URL list so the
sequence is 1,2,2,3,3,4 and every job is a true consecutive pair, or use `segment_size=10` so one job holds the whole
series and the analyst flickers along the timeline with F/D, setting `drawn_on` to the date index. The second is
simpler and matches how analysts already read a series. Review and assignment then work per cell.

**Label Studio layout.** One task per pair, or one task per cell with `valueList` holding all ten URLs and one
PolygonLabels per image. One project per theme, tasks assigned by filter.

**labelme layout.** One folder per cell, files named `{cell}_{index:02d}_{date}_{image_id}.tif`. A/D walks the
timeline. One annotator per folder, merge the JSONs afterwards.

**Server side.** TiTiler serves chips on demand, so 900 units cost nothing until opened. Put a cache in front, nginx
`proxy_cache` or Varnish, since every chip is fetched by several people during review. CVAT downloads chips at task
creation: 100 tasks x 10 frames x 1024 px is about 2 GB of PNG on its volume.

**Export and merge.** Run `to_geojson.py` per unit, concatenate, then `ogr2ogr -t_srs EPSG:4326` or load straight into
PostGIS with cell id, pair id, class, drawn-on date and both image ids as columns. Dissolve polygons that touch across
cell overlaps when they share class and pair.

## From one pair to many with `cdtasks.py`

The single-pair scripts above are the worked example. `cdtasks.py` is the general tool: any number of dated sources,
an area of interest, a target ground sample distance, and it plans the grid, builds the work in the chosen tool and
merges the exports back. An AOI smaller than one chip gives a single cell, so one pair and a thousand pairs are the
same three commands.

```sh
# 1. plan: sources + AOI + GSD -> jobs.json (cells with geotransforms, units = cell x pair, chip URLs per date)
python cdtasks.py plan --sources sources.json --aoi 23.838,40.817,23.852,40.828 --aoi-crs EPSG:4326        --gsd 0.5 --chip 1024 --overlap 0.1 --pairs consecutive --name amph -o jobs.json

# 2. build the work in one tool
CVAT_URL=... CVAT_USER=... CVAT_PASS=... python cdtasks.py build cvat jobs.json --layout series   # or --layout pairs
LS_URL=... LS_API_KEY=...                 python cdtasks.py build labelstudio jobs.json
                                          python cdtasks.py build labelme jobs.json --labelme-dir labelme_files

# 3. pull every export, georeference, merge, dissolve across cell overlaps
python cdtasks.py export cvat jobs.json -o merged.geojson --dissolve
```

`sources.json` lists the dated sources and the TiTiler endpoints. A source is anything GDAL opens: a COG, a local
GeoTIFF, or a tile service described in a GDAL XML. `esri_tms18.xml` and `google_sat_tms.xml` are plain TMS
descriptions, `bing_aerial_quadkey.xml` uses GDAL's VirtualEarth driver, which builds the quadkey from x, y and z.
Basemap dates are nominal, the providers do not expose a capture date per tile, and their terms apply. A float raster
such as a DSM takes a `params` entry, for example `rescale=80,200&colormap_name=terrain`:

```json
{"titiler": {"servers": "http://host.docker.internal:8010", "local": "http://127.0.0.1:8010"},
 "cvat_shim": "http://host.docker.internal:8020",
 "classes": ["no-change", "destruction", "construction", "modification"],
 "sources": [
   {"id": "esri_world_imagery",  "date": "2016-01-01", "url": "/data/esri_tms18.xml"},
   {"id": "google_satellite",    "date": "2019-01-01", "url": "/data/google_sat_tms.xml"},
   {"id": "bing_aerial",         "date": "2021-01-01", "url": "/data/bing_aerial_quadkey.xml"},
   {"id": "amphipolis_rgb_10cm", "date": "2024-06-01", "url": "https://.../rgb_cog.tif"}]}
```

What `plan` decides:

- **Pixel size.** The requested GSD is a ground distance. Chips are cut in EPSG:3857, whose metre is shorter than a ground metre by `cos(latitude)`, so the Web Mercator pixel size is `gsd / cos(lat)`. At Amphipolis 0.5 m of ground is 0.661 map units, and a 1024 px chip covers 677 m on the ground.
- **Grid.** Cells of `chip` pixels stepping by `chip * (1 - overlap)`, enough rows and columns to cover the AOI, origin at the AOI's top left. Each cell gets its own geotransform.
- **Units.** `consecutive` gives n-1 pairs per cell for n dates, `all` gives every combination, or list explicit `before:after` pairs by source id.

What `build` does per tool:

- **CVAT, `--layout series`**: one task per cell, the dates as frames in order, one job holding the whole series. F/D flickers along the timeline, the `drawn_on` attribute names the date a polygon belongs to. `--layout pairs`: the frame list becomes 1,2,2,3,3,4 with `segment_size=2`, so every job is a true consecutive pair. Frame names encode cell, date index, date and source id, which is how `export` finds the cell and the pair again.
- **Label Studio**: one project, one task per unit with before and after URLs and the cell geotransform in the task data.
- **labelme**: one folder per cell with one GeoTIFF per date, A/D walks the dates, `cell.json` beside them.

**Review in CVAT.** Nothing is created for review. Every job starts in the `annotation` stage with no assignee, and
review is a stage change: `validation` for a reviewer, `acceptance` for sign-off, each with its own assignee. The
jobs page filters by stage, and the reviewer gets the same canvas with issue markers. `cdtasks.py cvat-stage jobs.json --stage validation --assignee <user>`
moves every job of a plan at once. For sampled review instead of full review, CVAT's quality control adds a ground
truth job per task and scores annotators against it.

What `export` does: pulls every task or project export through the API, or walks the labelme folders, applies each
cell's geotransform, writes one GeoJSON in EPSG:3857 with class, drawn-on source, before and after ids and dates, and
with `--dissolve` unions polygons that touch across cell overlaps when class and pair match.

Tested on 2026-10-16 with the four sources above over a 1.4 km AOI at 50 cm GSD: 9 cells of 4 dates, 27 units, built
in all three tools, a test square placed on the overlap strip between two cells came back from every tool at the
same coordinates, and the CVAT dissolve merged its two halves into one polygon. The single-AOI plan and the CVAT
pairs layout, three two-frame jobs over four dates, were run the same day, and `cvat-stage` moved the 9 jobs to validation.

## Which tool for which case

- Several annotators, review stages, exact pair flicker: CVAT with the frame-name shim and a `drawn_on` attribute.
- One analyst, offline or on a laptop, imagery already as GeoTIFF: labelme.
- Scripted pipelines where the pair metadata must ride along in the task itself, and side by side without sync is acceptable: Label Studio.
- A geo-native alternative that would need a fork for pairs: GeoLabel from DeadTrees, see [deadtrees-frontend#158](https://github.com/Deadwood-ai/deadtrees-frontend/issues/158).

## Files

| File | Purpose |
|---|---|
| `cdtasks.py` | The general tool: `plan` a grid of cells and pairs from sources, AOI and GSD, `build` it in CVAT, Label Studio or labelme, `export` and merge to GeoJSON |
| `sources.json`, `jobs_single.json`, `jobs_grid.json` | The tested inputs and plans: four dated sources, one cell with three pairs, and the 3 x 3 grid at 50 cm GSD |
| `data/esri_tms18.xml`, `data/google_sat_tms.xml`, `data/bing_aerial_quadkey.xml` | Tile basemaps as GDAL sources, the templates for any XYZ, quadkey or WMTS input |
| `docker-compose.yml`, `cvat.env`, `docker-compose.override.yml` | The stack: TiTiler, shim, Label Studio, CVAT included |
| `make_pair.py` | Single pair worked example: viewport to bbox, geotransform and TiTiler URLs. Writes `pair.json` |
| `pair.json` | The tested manifest, Amphipolis COG against Esri |
| `labelstudio_task.py`, `labelstudio_config.xml`, `labelstudio_tasks.json` | Project, labeling config and task for Label Studio |
| `cvat_task.py`, `chip_proxy.py` | Two-frame CVAT task from remote URLs, plus the frame-name shim |
| `labelme_task.py` | GeoTIFF chips and `labels.txt` for labelme |
| `to_geojson.py` | Any of the three exports to GeoJSON in the manifest CRS |
| `samples/` | One export of each tool from the test, and the CVAT one converted |
