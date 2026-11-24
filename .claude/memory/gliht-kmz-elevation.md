---
name: gliht-kmz-elevation
description: NASA G-LiHT DTM KMZ PNGs are min-to-p99.9 stretched elevation (not hillshade); gliht:// reads them by Range; LP DAAC GLDTMT = same GeoTIFFs uncompressed
type: project
---

G-LiHT DTM KMZs (GDAL KMLSUPEROVERLAY, `L/x/y.png` + `.kml`, gx:LatLonQuad) hold the 1 m DTM as 8-bit grey: 0 = raster minimum, 255 ≈ 99.9th percentile, per KMZ, written nowhere. Measured 2026-11-24 on Kiuic 1-3 and an AMIGA cell: decoded heights within 0.06-0.2 m RMS. Earlier notes calling them "hillshade" were wrong.

**Why:** heights need `dem=lo,hi` measured on the GeoTIFF; only Kiuic 1-3 are calibrated (library entries).
**How to apply:** `lib/gliht-kmz.ts` (reader, Node-testable), `lib/gliht-protocol.ts`, the tile service's `/proxy/gliht` and `/proxy/earthdata` (`tile-server/proxy.mjs`, token `EARTHDATA_TOKEN`). LP DAAC GLDTMT granules are byte-identical to the GeoTIFFs inside NASA's .tif.gz: stripped, no overviews, not COGs. Details: docs/content/docs/dev/g-liht.mdx.
