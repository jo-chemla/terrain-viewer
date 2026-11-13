---
name: gcs-cors-media-endpoint
description: Public Google Cloud Storage buckets without CORS (GEM-15, Open Buildings) serve the same objects with CORS and Range through the JSON API media endpoint; GEM-15 layout and bertt/gem15 reference implementation
type: project
---

# GCS buckets without CORS: use the JSON API media endpoint

Plain object URLs `https://storage.googleapis.com/<bucket>/<object>` on `climate-and-sustainability` (GEM-15) and `open-buildings-temporal-data` send no `Access-Control-Allow-Origin`, so the in-browser COG and VRT readers cannot use them. The same objects served through the JSON API media endpoint, `https://storage.googleapis.com/storage/v1/b/<bucket>/o/<url-encoded object>?alt=media`, come with CORS (origin echoed, `Range` allowed in preflight, `Content-Range` exposed, max-age 3600) and HTTP 206 range answers. Verified 2026-11-13 for terrain-viewer.iconem.com and localhost:5173 on a GEM-15 DTM. Found through Bert Temme's viewer, https://bertt.github.io/gem15/ (repo bertt/gem15, framework-free MapLibre + geotiff.js + proj4, `gem://` protocol).

**GEM-15** (Google, CC-BY 4.0, 15 m DSM and DTM, 60S to 84N minus Russia, China, Mongolia, Greenland, Antarctica; India offset): one COG per 1x1 degree cell in the local UTM zone, about 13 500 cells per band. Path `gem-15/<group>/<cell>/<dtm|dsm>/zall/mosaic.tif` with cell `w<lon>s<lat>` (west and south edges, `m` prefix for negatives, e.g. `wm91sm1`) and group `<p|m><floor(lat/10)*10>_<p|m><floor(lon/10)*10>` (e.g. `p40_p0`, `m10_m100`). STAC item per cell at `gem-15/stac/gem-15/<group>/<cell>/<cell>.json` (bbox, proj:epsg, proj:transform, assets dsm and dtm); a missing cell is a 404. DTM: 8192x8192 float32, one band, overviews 2-16, NaN nodata, 100-200 MB. DSM: five bands (dsm, p5, p50, p95, std; read band 1), 500 MB to 1 GB. titiler.xyz opens them too (`nodata=nan`, `bidx=1` for the DSM) but has no mosaic endpoint, and the app's `stac` and `mosaicjson` source types are placeholders.

**How to apply:** a GEM-15 terrain source would be a cell-routing protocol like the capture mosaic: per tile, the 1 to 4 cells it touches, each read as a windowed overview from the media endpoint and reprojected from UTM, output Terrain-RGB; data from z7 or z8 up, and a hosted cell index to skip the 404s. The same endpoint may unlock the Open Buildings 2.5D dead end ([[google-3d-coverage-dead-end]]). Not implemented as of 2026-11-13.
