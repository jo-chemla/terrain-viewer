# Slope-and-More GDAL VRT pack

Ports of every Slope-and-More sub-mode's exact client-side formula (from this app's
`lib/*-protocol.ts` files) into standalone GDAL VRT XML, chained on a real Mapterhorn
elevation source (`https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`, TMS, 512px tiles,
terrarium encoding, z18 max).

## Chain

```
mapterhorn_wms.xml   (GDAL_WMS/TMS source, EPSG:3857, z18)
        |
elevation.vrt         (Python pixel function: terrarium decode -> Float32 meters)
        |
        +-- slope.vrt / aspect.vrt / tri.vrt / tpi.vrt / roughness.vrt   (BufferRadius=1)
        +-- curvature_combined.vrt / _profile.vrt / _plan.vrt / _det_hessian.vrt  (BufferRadius=1)
        +-- blobness.vrt                                                (BufferRadius=2)

mapterhorn_wms_ancestor_z15.xml  -> elevation_ancestor_z15.vrt  --+
elevation.vrt                                                    +--> lrm.vrt (native "diff" pixel function)
```

Every file nominally covers the whole world at its native pixel resolution (over
134M px/side at z18) — none of this is materialized until you ask for a window:

```
gdal_translate -projwin <ulx> <uly> <lrx> <lry> slope.vrt slope_out.tif
```

Coordinates are EPSG:3857 (Web Mercator meters), not lon/lat. To get a window from
lon/lat, reproject first or use `gdalwarp -t_srs EPSG:3857`.

## Modes

| File | Formula | Needs Python? |
|---|---|---|
| `slope.vrt` | Horn 3x3 kernel, Mercator-corrected, `atan(sqrt(dx^2+dy^2)/8)` in degrees | yes |
| `aspect.vrt` | Same Horn gx/gy, `atan2` -> compass bearing 0-360 | yes |
| `tri.vrt` | Riley et al. 2006 RMS elevation difference vs 8 neighbors | yes |
| `tpi.vrt` | center - mean(8 neighbors) | yes |
| `roughness.vrt` | max - min over 3x3 (9 cells) | yes |
| `curvature_combined.vrt` | discrete Laplacian x100 | yes |
| `curvature_profile.vrt` | Zevenbergen & Thorne (1987) profile curvature x100 | yes |
| `curvature_plan.vrt` | Zevenbergen & Thorne (1987) plan curvature x100 | yes |
| `curvature_det_hessian.vrt` | Hessian determinant x10000 | yes |
| `blobness.vrt` | 5x5 structure-tensor det/trace, x(100/64) | yes |
| `lrm.vrt` | fine (z18) minus bilinear-upsampled ancestor (z15) | **no** — uses GDAL's built-in native `diff` pixel function |

All of `PixelFunctionLanguage="Python"` modes require GDAL built with the Python
plugin and `GDAL_VRT_ENABLE_PYTHON=YES` set in the environment (Python pixel functions
are disabled by default for security reasons since GDAL 3.x).

## What's a faithful port vs. an approximation

- **Slope, Aspect, TRI, TPI, Roughness, all 4 Curvature modes**: verified live against
  a real GDAL 3.13 install. TRI/TPI/Roughness matched `gdaldem`'s own implementations
  almost exactly (they're scale-free, so there's nothing this app does differently).
  Slope's magnitude differs from `gdaldem`'s naive value by design: this VRT applies
  the same Web Mercator latitude correction (`cos(tile-center latitude)`) the app
  applies and `gdaldem` does not, so slopes come out ~1/cos(lat) steeper than
  `gdaldem`'s raw-pixel-size answer at the same location — that's a feature, not a
  bug. Aspect's *direction* is scale-invariant so it's unaffected either way; only a
  naive mean-of-degrees comparison looks different because averaging circular
  quantities isn't meaningful (max/min/stddev matched `gdaldem` almost exactly).
- **Blobness**: a vectorized re-derivation of the app's structure-tensor algorithm,
  not a byte-for-byte transcription of its explicit 3x3-sample-point loop. Ran clean
  and produced sane bounded values on real data, but hasn't been diffed pixel-by-pixel
  against the app's own tile output — spot-check before depending on it.
- **LRM**: architecturally the odd one out. The app fetches the *actual* ancestor
  pyramid tile at runtime and bilinear-samples it with careful half-pixel recentering;
  a static VRT can't dynamically pick a "k levels coarser" read for an arbitrary
  requested window. This file instead hard-codes one fixed pair of zoom levels
  (z18 fine, z15 ancestor — a 3-level/~8x gap, i.e. `radiusToLevels` mapped to k=3) as
  two whole-world VRTs, letting GDAL's own `SrcRect`/`DstRect`-with-`resampling=
  "bilinear"` machinery do the upsampling. To change the smoothing radius, swap in a
  different ancestor `TileLevel` (`mapterhorn_wms_ancestor_z15.xml` -> z=18-k) and
  rescale `lrm.vrt`'s second source's `SrcRect` to that level's raster size
  (`512 * 2^z`). Verified against real Mapterhorn data (fine z16 test, ancestor z13
  test — same 3-level gap) and produced sane, symmetric relief values.

## Known real-world gotcha

Mapterhorn's WMS declares `maxzoom=18` but coverage at z18 (and sometimes z17) is
sparse in mountainous test areas — many z18 tiles 404. If you get an all-zero /
all-nodata result, drop `TileLevel` in `mapterhorn_wms.xml` (and the matching
`GeoTransform`/raster size in `elevation.vrt` and every mode VRT) to z16 or lower
until you hit real coverage.
