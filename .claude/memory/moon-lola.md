---
name: moon-lola
description: Lunar terrain (beta): which LOLA/SLDEM/Kaguya files a browser can read, the two Moon-on-Mercator mappings done by vrt:// (native lunar CRS = true position, ?a_srs=EPSG:3857 = metric fake-geo), the three moon-* projects, what replaced stacdem:// and the tindex workflow
type: project
---

# Moon LOLA terrain (rebuilt on main 2026-11-14, branch moon-lola)

The August 2026 exploration (remote branch `t3code/moon-lola-terrain-explore`, pre-rewrite history, cannot be merged) planned re-hosted COGs, two CI workflows, a FlatGeobuf tindex and a `stacdem://` protocol. On today's main a lunar DEM is a VRT and a URL. Public page: docs/content/docs/beta/moon-lola.mdx.

## Mappings (no warp, no repack)
- **True position**: proj4js does NO datum shift between a `+R=1737400` sphere (or GCS_Moon WKT) and WGS84 when neither has towgs84, so a VRT in its own lunar CRS lands at lunar lon/lat drawn as Earth lon/lat. Checked: Kaguya strip x0 4659372 m in IAU:30115 == proj4js forward of its STAC bbox. Horizontal stretch R_earth/R_moon = 3.67 at every latitude -> exaggeration 3.67 for true proportions. OPM Moon basemap uses the same convention. Caps past 85.05 are lost.
- **Metric fake-geo**: polar stereographic metres + `?a_srs=EPSG:3857` on the VRT URL -> pole at 0,0, lunar 0E up, true scale, exaggeration 1 (same idea as the Dura "fakegeo" COGs).
- Rotated pole (ob_tran) dropped: needs a real warp.

## Hosts (checked 2026-11-14)
- `asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/` (USGS): CORS *, Range. LOLA 118 m global (8.5 GB), SLDEM2015 `LolaKaguya_Topo/..._DEMmerge_60N60S_512ppd.tif` (22.7 GB), GLD100 100 m: all STRIP TIFFs (row strips, no overviews, Int16 x Scale 0.5) -> not browser-streamable, and vrt:// ignores Scale. `Lunar_safed/LMAP/SouthPolar/ldem_87s_5mpp_cog.tif`: real Float32 COG, 512 tiles, 8 overviews, NaN nodata -> the one usable LOLA file.
- planetarymaps.usgs.gov/mosaic 302s to that bucket WITHOUT a CORS header: use the S3 URL.
- `astrogeo-ard` (Kaguya TC DTMs v2, COPC LOLA RDR): CORS *, Range, COGs. STAC: stac.astrogeology.usgs.gov/api, collection `kaguya_terrain_camera_usgs_dtms_v2_equi` (118 379 items), all IAU:30115 (eqc clon=180), nodata -32767, `proj:transform` in GDAL order on this API.
- Neither bucket sends Access-Control-Expose-Headers: Content-Range hidden; geotiff 2.1.3 single-range path survives without it (Node check stripped it).
- No CORS: pgda.gsfc.nasa.gov, pds-geosciences.wustl.edu, imbrium.mit.edu. Nothing lunar on Hugging Face.

## In the repo
- `public/moon/ldem_87s_5mpp.vrt`: hand-written one-source VRT (tracked, 2 KB, real lunar SRS so GDAL/QGIS read it truthfully; the app adds a_srs).
- `docs/scripts/build-kaguya-vrt.mjs --bbox w,s,e,n --name x`: VRT from STAC items, written in eqc clon=0 (shift of pi R, seam to the farside). Output in public/vrt/ (gitignored) -> `pnpm datasets:push`, not committed. apollo15 = 72 strips, 42 KB.
- `lib/projects.json`: moon-south-pole (works once deployed), moon-apollo15 (needs the VRT on the release), moon-global (Cesium Moon Terrain ion 2684829 via quantized-mesh://, needs a token, asset id unconfirmed).

## Gotchas
- vrt:// isHole treats > +9000 m as nodata; the Moon reaches +10 786 m (near Engel'gardt). Terrain-RGB floor -10 000 m is below the lunar minimum (-9 130 m).
- A whole-Moon Kaguya VRT ~118k sources ~70 MB: too big. Next step is a cell-routed `kaguya://` (STAC search per tile -> one-strip VrtDoc, like loadGem15Cell).
- Node verification recipe: tsx + linkedom DOMParser + a fetch shim mapping http://local/ to public/, then `readVrtRegion` (no canvas needed).

Related: [[static-indexes-and-release-assets]], [[deckgl-raster-custom-projections]], [[gcs-cors-media-endpoint]].
