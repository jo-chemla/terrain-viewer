---
name: land-cover-canopy-gba-survey
description: 2026-11-21 survey of land cover endpoints, Meta canopy height v2 (metachm://, titiler only, no CORS on the bucket) and GlobalBuildingAtlas (nothing cloud-readable); the Library search matcher
type: project
---

# Land cover, canopy height, GlobalBuildingAtlas (surveyed 2026-11-21)

**Land cover overlays added** (SAMPLE_BASEMAPS_SOURCES, all CORS-open, no key, each fetched with curl and drawn in headless Chrome): ESA WorldCover 2020 (Terrascope mapproxy, same service as 2021), Esri / Impact Observatory 10 m (`ic.imagery1.arcgis.com/.../Sentinel2_10m_LandCover/ImageServer/exportImage`, type `wms` with `{bbox-epsg-3857}`), MODIS IGBP 500 m (NASA GIBS), Corine 2018 (EEA discomap `Corine/CLC2018_WM/MapServer/export`; the service has no tile cache, `/tile/` is 404), NLCD 2021 (MRLC GeoServer WMS), IGN OCS GE couverture and usage 2021-2023 and CoSIA 2021-2023 (data.geopf.fr WMTS).

**Not added, and why:**
- Copernicus Global Land Cover 100 m: `services.terrascope.be/wms/v2` and `/wmts/v2` did not answer (connection failure, twice), the `vito.landcover.global` bucket does not exist; no other tile endpoint found.
- Dynamic World: Earth Engine only (not probed further).
- Annual NLCD (1985-2024): on the MRLC server only as `Annual_NLCD_LndCov_2024_CU_C1V1-wmstest`.
- `LCM_2020` on the Terrascope mapproxy answers tiles in the WorldCover legend (probably the Copernicus LCFM LCM-10 map) but the capabilities carry no abstract: not added until identified.
- Esri's `tiledimageservices.arcgis.com/.../Esri_2020_Land_Cover_V2` needs a token.
- OCS GE and CoSIA 2024-2026 layers exist but were empty over Lyon.

**Vector forms:** the app's custom basemap types are raster only (`cog | tms | wms | wmts | tilejson | image | iiif`). OpenFreeMap's planet tiles (already the source of the 3D buildings, `VectorBasemapLayer.tsx`) carry `landcover` and `landuse` layers; Overture `base.pmtiles` (land_cover, land_use; `https://tiles.overturemaps.org/<release>/base.pmtiles`, 192 GB, CORS and Range, release id from `stac.overturemaps.org/catalog.json`) and `buildings.pmtiles` are readable; Corine vector is a WFS on data.geopf.fr (`LANDCOVER.CLC18_FR:clc18_fr`, France only) and the discomap MapServer's query endpoint. Showing any of them needs a vector overlay type (source + fill layer + a colour table per class), which does not exist.

**Meta / WRI canopy height v2** (`metachm://v2`, lib/vrt-protocol.ts, docs dev/cell-routed-sources): the S3 bucket `dataforgood-fb-data` has Range but no CORS, so the route is titiler only. v2 (`forests/v2/global/`, files dated 2026-02) supersedes v1 (`forests/v1/alsgedi_global_v6_float`, zoom 9 cells, 65536 px strips with no overviews, unusable for streaming). The 10 m p95 derivative also exists (`..._10m_p95`), not used. The v2 1 m COGs hold 14 IFDs (7 images, 7 masks). Index: `public/meta-chm/cells.bin` from `docs/scripts/build-meta-chm-index.mjs`.

**GlobalBuildingAtlas** (Zhu et al. 2025): nothing cloud-readable, nothing added. Heights (3 m, CC BY-NC 4.0): zips of GeoTIFFs per 5 degree tile on mediaTUM, rsync and FTP only (36 TB). Polygons and LoD1: GeoJSON per 5 degree tile on HuggingFace (`zhu-xlab/GBA.ODbLPolygon` ODbL, `GBA.LoD1` CC BY-NC), 3 to 10 GB a file. The web viewer's GeoServer has a WFS (`global3D:lod1_global`) that answers 403 outside the viewer and that the authors ask not to stream from, and a 480 m volume raster with no CORS header. Showing the polygons like the OpenStreetMap extrusions would need someone to tile them (PMTiles) first.

**Library search** (`lib/library-search.ts`, tests in `lib/library-search.test.ts`, run with `node --test --experimental-strip-types`): separators ignored, typo fallback only when nothing matches exactly, an optional `keywords` field on entries for other spellings.
