---
name: titiler-dem-gotchas
description: What goes wrong with titiler-served DEMs (nodata sentinel must be passed, warp kernel defaults to nearest, maxzoom decides who upsamples) and how the DSM-minus-DTM derived source works
type: project
---

Learned 2026-09-18 on ANADEM (EPSG:4674) and GEDTM30 (EPSG:4326, 432 GB).

**Pass the file's nodata.** `buildRasterTileSource` sends `nodata=<titilerNodata ?? 0>`. An override of 0 unmasks the file's own sentinel; a float32 max (+3.4e38) then reaches the `terrainrgb` algorithm on every tile touching nodata (the sea) and titiler answers HTTP 500 "larger than 256 ** 3". Whole coastlines vanish while inland works. Set `titilerNodata` in the library entry (GEDTM30: `3.4e38`, ANADEM: `-9999`). The query value is URL-encoded because `3.4e38` stringifies as `3.4e+38` and a raw `+` is a space.

**`reproject=bilinear`, not only `resampling=bilinear`.** titiler's `resampling` covers the read (overview decimation); the CRS-to-Mercator warp has its own kernel, `reproject`, default nearest. Nearest drew every 30 m cell of a non-Mercator DEM as a cross-hatched staircase from z13 up. Measured second-difference roughness on a z14 tile: 2.6 m nearest, 0.27 m bilinear. All titiler DEM and basemap-COG templates now pass both.

**maxzoom decides who upsamples.** Above a source's `maxzoom` MapLibre stretches the last DEM tile itself and the hillshade shows each cell as a flat block. A `maxzoom` two levels above the native grid (30 m: native z12.4, maxzoom 15) lets titiler do the upsampling bilinearly. Only for titiler-pinned sources; for the in-browser COG reader the metadata-derived range applies.

**DSM − DTM.** `lib/demdiff-protocol.ts` (`demdiff://`) subtracts two upstream DEM tiles fetched through the viz protocols' shared decoded-tile cache and re-encodes Terrain-RGB. A `CustomTerrainSource` of `type: "dem-diff"` carries `diffMinuendId` / `diffSubtrahendId`; `useClientDemUpstream` resolves both operands by calling itself with `_nested = true` (one level, hooks called conditionally on a per-call-site constant), and `TerrainSources` uses the same hook for the primary source, so terrain and every viz mode read one derived grid. Not browser-tested when written.

**How to apply:** when a titiler-served DEM "does not work" or looks blocky, check these three before anything else. See also [[national-terrain-sources]].
