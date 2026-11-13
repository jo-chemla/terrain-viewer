---
name: static-indexes-and-release-assets
description: Which library sources need a prebuilt index (VRT, manifest bbox list, STAC dump), which can stay on-the-fly, where each index should live (repo, release asset, upstream), and the OpenTopography global VRTs still unused
type: project
---

# Static indexes: what to prebuild, where to keep it (survey of 2026-11-13)

- **Repo weight.** Pack 383 MB. The weight is docs/public/screenshots (173 MB, 4K jpg plus a 9 MB mp4), not data indexes: public/vrt is 2.8 MB (the two Open Buildings sample VRTs), public/coverage 5.8 MB. A release-asset move only pays for the screenshots (the docs build would download them like the deploy does for ux-flows-latest).
- **GEM-15**: no index needed, the cell address follows from the coordinates and the STAC item per cell is fetched on demand (see [[gcs-cors-media-endpoint]]).
- **Open Buildings 2.5D, whole earth per year**: 1 173 manifests (39 S2 cells x 73 UTM zones x 8 years, about 950 KB each) on the bucket, CORS through the media endpoint. One VRT per manifest is what docs/scripts/build-open-buildings-vrt.mjs writes; the whole earth cannot be one VRT (mixed UTM zones) and does not need hosting: a committed index of manifest name -> lon/lat bbox (about 40 KB, computed once from each manifest's affineTransform and dimensions) plus an `openbuildings://<year>` router that fetches the 1-2 manifests a tile touches and builds the VrtDoc in memory, the gem15 pattern. About a day. Not built.
- **OpenTopography global VRTs that exist upstream and are not in the library**: COP30/COP30_hh.vrt, COP90/COP90_hh.vrt, NASADEM/NASADEM_be.vrt, SRTM_GL1/SRTM_GL1_srtm.vrt, SRTM_GL3/SRTM_GL3_srtm.vrt, EU_DTM/EU_DTM_be.vrt, GEDTM30/GEDTM30_be.vrt, SRTM15Plus/SRTM15Plus_srtm.vrt (same host and CORS as AW3D30, so a "type": "vrt" entry each). GEBCO has none.
- **Scotland** (9 600 per-10 km COGs, no upstream VRT) was dropped by Jonathan on 2026-11-12; a gdalbuildvrt over S3 would be the one case needing a hosted VRT of a few MB.
- **The 3dtiled precedent**: the France IGN LiDAR HD virtual point cloud is a STAC ItemCollection of 337 206 COPC items, 29 MB split into 564 quadkey children, published as the `sample-assets-v1` GitHub release on jo-chemla/3dtiled-to-3dtiles and read by the tile server from there; the overview COPC is the host's own file. That is the shape for any index too big to commit: build once, release asset, fetch at deploy or at runtime.
