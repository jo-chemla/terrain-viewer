---
name: titiler-dem-gotchas
description: What goes wrong with titiler-served DEMs (nodata sentinel must be passed, warp kernel defaults to nearest, maxzoom decides who upsamples, no coverage probe, CloudFront caches CORS per URL) and how the DSM-minus-DTM derived source works
type: project
---

Learned 2026-09-18 on ANADEM (EPSG:4674) and GEDTM30 (EPSG:4326, 432 GB).

**Pass the file's nodata.** `buildRasterTileSource` sends `nodata=<titilerNodata ?? 0>`. An override of 0 unmasks the file's own sentinel; a float32 max (+3.4e38) then reaches the `terrainrgb` algorithm on every tile touching nodata (the sea) and titiler answers HTTP 500 "larger than 256 ** 3". Whole coastlines vanish while inland works. Set `titilerNodata` in the library entry (GEDTM30: `3.4e38`, ANADEM: `-9999`). The query value is URL-encoded because `3.4e38` stringifies as `3.4e+38` and a raw `+` is a space.

**`reproject=bilinear`, not only `resampling=bilinear`.** titiler's `resampling` covers the read (overview decimation); the CRS-to-Mercator warp has its own kernel, `reproject`, default nearest. Nearest drew every 30 m cell of a non-Mercator DEM as a cross-hatched staircase from z13 up. Measured second-difference roughness on a z14 tile: 2.6 m nearest, 0.27 m bilinear. All titiler DEM and basemap-COG templates now pass both.

**maxzoom decides who upsamples.** Above a source's `maxzoom` MapLibre stretches the last DEM tile itself and the hillshade shows each cell as a flat block. A `maxzoom` two levels above the native grid (30 m: native z12.4, maxzoom 15) lets titiler do the upsampling bilinearly. Only for titiler-pinned sources; for the in-browser COG reader the metadata-derived range applies.

**DSM − DTM.** `lib/demdiff-protocol.ts` (`demdiff://`) subtracts two upstream DEM tiles fetched through the viz protocols' shared decoded-tile cache and re-encodes Terrain-RGB. A `CustomTerrainSource` of `type: "dem-diff"` carries `diffMinuendId` / `diffSubtrahendId`; `useClientDemUpstream` resolves both operands by calling itself with `_nested = true` (one level, hooks called conditionally on a per-call-site constant), and `TerrainSources` uses the same hook for the primary source, so terrain and every viz mode read one derived grid. Not browser-tested when written.

**No coverage probe on titiler templates (2026-10-10).** `lib/tile-max-zoom.ts` probes one tile at the view centre rounded to 0.1 degree and lowers the source's maxzoom to the first zoom that answers. A titiler 404 only means "outside the file", so a file smaller than that rounding (La Palma cone DSM, 1 km) got maxzoom 12 under its minzoom 13 and drew nothing, with no console error. `isTitilerTemplate` now skips the probe, and a probed maxzoom never goes below the source's minzoom. titiler.xyz answers HEAD with 405 (`Allow: GET`) unless CloudFront has the GET cached, which is where the probe's "z20 405s" came from.

**titiler.xyz CORS is cached per URL.** CloudFront caches `Access-Control-Allow-Origin` with the tile and sends no `Vary: Origin` (max-age 3600). The first origin to fetch a tile URL owns it for an hour: the same tile then fails CORS (`net::ERR_FAILED`) on localhost, the other deploys (github.io, historical-satellite) or a test script that sent another `Origin`. Use `--disable-web-security` in Playwright to test app behaviour through it, and do not `curl -H "Origin: ..."` production tile URLs.

**How to apply:** when a titiler-served DEM "does not work" or looks blocky, check these before anything else. See also [[national-terrain-sources]].
