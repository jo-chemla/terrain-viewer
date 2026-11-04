---
name: national-terrain-sources
description: Gotchas behind the national open-data terrain library (lib/custom-sources.json) — verification method, per-source traps, bounds/underzoom behaviour, and what was surveyed and rejected
type: project
---

# National terrain sources — what is not obvious from the code

**Verification rule.** Every shipped source was checked by fetching a real window through the actual protocol (`float32dem://` re-encode or titiler), decoding the Terrarium PNG and comparing a known summit (Snezka 1603 m, Gennargentu 1834 m, …). Do the same before adding one; measure `minzoom` from a point deep inland, never near a coast (a coverage edge looks identical to "zoom too low").

**Sentinels.** Nodata is not always negative: AHN and swissALTIRegio use `+3.4e38`, Aguada Fénix `+1.7e38`. `isSentinel` (|v| ≥ 1e30) in `lib/nodata.ts` catches both signs; the per-source floor/fill handles ordinary `-9999`. Fill must run BEFORE bilinear resampling or the sentinel smears into a downward ramp.

**ArcGIS ImageServer traps.** Without `noData=-9999&noDataInterpretation=esriNoDataMatchAny` CUZK returns out-of-coverage pixels as untagged 0.0 (reads as sea level inland). `bandIds=0` on some servers yields a ±1.134e38 stretch. Use `format=tiff&pixelType=F32`.

**`FORMAT=image/geotiff` on WMS is usually 8-bit RGB.** Raw values live on WCS or ImageServer. A Float32 layer whose values run 0–255 is a hillshade stored as float (Iceland).

**WCS 2.0 axis spelling differs per server**: TINITALY needs the OGC `i`/`j` URIs, DE Africa needs plain axis labels → `__wcs2subset=X,Y[,axis]`.

**Non-3857 COGs** (swissALTIRegio LV95, ANADEM EPSG:4674) must be pinned with `cogViaTitiler: true`: the geomatico reader does not reproject and reads degree-sized pixels as metres, which made the camera lock at z19 (detected minzoom).

**Bounds / underzoom.** Selecting a bounded source sets `maxBounds` imperatively (react-map-gl's maplibre build ignores the prop) through `lib/underzoom.ts` (maplibre-xy, `extendScale` 0.6 — at 1.0 the constrain cancels any fitBounds padding). The picker applies the fence BEFORE `fitBounds`, and only fits when the viewport is not already inside the target (`shouldZoomToTerrainBounds`). `minzoom` on a source limits tile requests only, never the camera.

**Mapterhorn comparison.** `MAPTERHORN_RES` in the docs table is per-country best ingested resolution read off its source-catalog; NLD is 5 m (AHN5 low-res), not 0.5. Candidates worth reporting upstream (mapterhorn issue #27): NOR 0.25 m, CZE 0.5 m DMP, NLD 0.5 m AHN.

**Rejected on purpose, do not re-add:** NOAA (user choice), Esri Terrain3D (values wrong vs USGS, ToU), Japan GSI raw tiles (needs a bespoke protocol; only shared protocols allowed), Sardinia 1 m (patchy: river corridors only), Bolzano. The full rejected list with reasons is `UNUSABLE` in `docs/src/components/national-datasets-table.tsx`.

**United Kingdom (2026-11-04).** England: EA WCS (shipped). Wales: the Welsh Government 1 m DTM is one national Float32 COG on DataMapWales's Azure blob (`wales_dtm_32bit_cog.tif`, EPSG:27700, nodata -9999, no CORS, so `cogViaTitiler`); the DataMapWales WMS and WCS carry no raw heights. Scotland: the JNCC portal (`ows.remotesensing.data.gov.scot/geoserver`) has WCS disabled in every version and its WMS `image/geotiff` is 8-bit; the raw 1 m DTMs are about 9 600 per-10 km-tile Float32 LZW COGs on S3 `srsp-open-data` (`lidar/<phase>/dtm/27700/gridded/*.tif`, phases 1-6, national-lidar-programme 5 933 tiles, Orkney 1 655) with no VRT, so the route would be a self-hosted VRT like `public/vrt/open-buildings-*.vrt` (gdalbuildvrt over /vsicurl, needs every header read). Northern Ireland: no national LiDAR DTM; the 2021 coastal survey is a cached-tile MapServer only.

