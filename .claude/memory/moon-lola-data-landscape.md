---
name: moon-lola-data-landscape
description: Verified lunar DEM data landscape — product sizes/URLs, CORS matrix, the three mercator tricks, and why no browser-streamable lunar DTM existed before this project
type: project
---

# Moon LOLA data landscape (verified Aug 2026, branch t3code/moon-lola-terrain-explore)

## The gap that motivates the project
No one serves lunar elevation in a MapLibre-consumable form. Everything hosted is:
- **colorized renders** — USGS planetarymaps WMS (LOLA_color/bw/steel, LROC_WAC; CORS ✓ but **EPSG:4326 + IAU_2015:30100 only** — a GetMap with srs=EPSG:3857 returns a ServiceException, live-tested; so maplibre's `{bbox-epsg-3857}` WMS path cannot use it directly, needs titiler/proxy), NASA Trek WMTS (4326 tile matrix), OPM moon hillshade (CARTO, **native mercator XYZ, alive**, the one no-proxy lunar basemap)
- **wrong format** — PDS LDEM GDR (untiled IMG/plain GeoTIFF, no overviews; 118 m global = 8.49 GB exact), SLDEM2015 as JP2
- **wrong encoding** — Cesium ion Moon terrain = quantized-mesh (what the Cesium demos use); maplibre raster-dem can't eat meshes
- **wrong access** — PGDA Barker-2023 south-pole set: proper Float32 COGs at 240→10 m/px (60S/75S/80S/83S caps, +5 m 87S BigTIFF) but **no CORS headers** (range requests work, ~1 MB/s)

## Verified numbers
- LDEM_64 global 531 MB · 118 m/256 ppd 8.49 GB raw (~4–5 GB COG) · 59 m/512 ppd 34 GB raw · 30 m/1024 ppd 136 GB raw (144×0.94 GB tiles; JP2 ~87 MB/tile — equator is mostly interpolation, real cross-track info ends ~SLDEM's 59 m; genuine 30 m only poleward of ~75°)
- SLDEM2013 (JAXA DARTS): 7 200 tiles × 288 MB = 2.07 TB, 3°×3° @4096 ppd, pre-LOLA-control
- Kaguya TC DTMs v2 (USGS STAC): **155 925 strips, ~10 m, true COGs, CORS ✓** on astrogeo-ard S3; coverage measured global — min 289 strips per 15° cell (median 673). NOT sparse.
- Hosting CORS+range matrix: HF ✓✓ (chosen), source.coop ✓✓ (needs onboarding), GitHub releases ✗CORS, PGDA ✗CORS.

## The three mercator tricks (docs/beta/moon-lola has the full write-up)
1. **Metric fake-geo**: relabel polar-stereographic meters as 3857 (`gdal_translate -a_srs EPSG:3857`) — pole at null island, true scale, exaggeration 1×.
2. **Angular rotated-pole**: `ob_tran +o_proj=webmerc +o_lat_p=0 +o_lon_p=180` (+`PROJ_IGNORE_CELESTIAL_BODY=YES`) — pole at null island, 1 lunar° = 1 earth°, pure 180° rotation (no mirroring), needs exaggeration ≈3.671 (R⊕/R☾).
3. **True-position**: lunar lon/lat as earth lon/lat — global works (≈3.7× exaggeration), polar caps clipped at 85.051° (Malapert 86°S falls off).

## Key implementation facts
- geomatico maplibre-cog-protocol is hard-wired 3857 (deps: sphericalmercator+geotiff only) → hosted COGs must be 3857-labeled.
- geowarp (CPU, custom proj4 forward/inverse hooks) → data → can feed terrain; deck.gl-raster (GPU) → screen → imagery only; STACLayer unbuilt (#147), MultiCOG API in flux (#417/#404).
- FlatGeobuf tindex is bbox-queryable remotely via range requests (no full download); schema after gdaltindex (`location` + precomputed proj4 `srs` column).
- Docker `ghcr.io/osgeo/gdal:alpine-small-latest` is the local GDAL (none installed natively).
- GH Actions free for public repo; 118 m global fits plain runner, SLDEM2015 needs disk-reclaim step, 1024 ppd/SLDEM2013 need a us-west-2 spot instance (same region as astrogeo-ard).
