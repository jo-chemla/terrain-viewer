## Complete DSM & RGB Processing Guide

### 1. Check current resolution
```bash
gdalinfo input.tiff | findstr "Pixel Size"
```
Shows your actual pixel size (e.g., 0.0005m = 0.5mm for photogrammetry data)

### 2. Calculate scale factor
- **Real GSD:** 0.0005m (0.5mm/pixel from photogrammetry)
- **Target GSD:** 2m/pixel (chosen for web maps)
- **Why 2m?** Web Mercator at zoom 20 has ~0.15m/pixel resolution at equator. Using 2m/pixel is conservative and works well across zoom levels 15-20. Could as well be eg 20cm or 0.2
- **Z-scale factor:** 2m ÷ 0.0005m = **4000** (multiply z-elevations by 4000 to compensate xy rescaling)

---

## DSM Command (Elevation Data)

```bash
gdal_translate -of COG -a_gt 0.01 2.0 0 -0.01 0 -2.0 -a_scale -4000 -a_nodata nan -co BIGTIFF=YES -a_srs EPSG:3857 -co BLOCKSIZE=256 -co TILING_SCHEME=GoogleMapsCompatible -co RESAMPLING=BILINEAR -co OVERVIEW_RESAMPLING=NEAREST -co COMPRESS=DEFLATE -co PREDICTOR=3 -co OVERVIEWS=IGNORE_EXISTING -co ADD_ALPHA=NO -b 1 -colorinterp_1 gray DuraEuropos_Synagogue_W_0.5mm_DSM.tif
f DuraEuropos_Synagogue_W_0.5mm_DSM_fakegeo-3.cog.tiff
```

**DSM Parameters:**
- `-of COG` - Cloud Optimized GeoTIFF (web-optimized with internal tiling/overviews)
- `-a_gt 0 2 0 0 0 -2` - Geotransform: origin (0,0), 2m pixels, no rotation
- `-a_scale 4000` - Multiply z-values by 1000 (compensates 2mm→2m pixel scaling)
- `-a_nodata nan` - Numeric nodata value (RC uses NotANumber as NoData)
- `-co BIGTIFF=YES` - Handle files >4GB
- `-a_srs EPSG:3857` - Web Mercator projection
- `-co BLOCKSIZE=256 -co TILING_SCHEME=GoogleMapsCompatible` - Recommended by geomatico/maplibre-cog-protocol
- `-co RESAMPLING=BILINEAR -co OVERVIEW_RESAMPLING=BILINEAR` - Average resampling respects nodata for base tiles and Average for pyramids (prevents nodata spread in overviews)
- `-co COMPRESS=DEFLATE -co PREDICTOR=3` - Lossless compression (preserves elevation precision), float elevation requires predictor 3 for continuous elevation data compression
- ` -co OVERVIEWS=IGNORE_EXISTING -co ADD_ALPHA=NO` overwrite overviews, don't add alpha
- `-b 1` - Extract only elevation band (drop RGB+Alpha if present)
- `-colorinterp_1 gray` - Mark as grayscale elevation (required for hillshade to work)

**Choice of AVERAGE vs BILINEAR or other for DSM?** AVERAGE resampling properly excludes nodata pixels from calculations, preventing nodata from bleeding into valid elevation data in overviews. But results in poorer grid like structure in the data

Good middle-ground: bilin for resampling, nearest for overview-resampling.

---

## RGB Orthophoto Command

```bash
gdal_translate -of COG -a_gt 0.01 2.0 0 -0.01 0 -2.0 -co BIGTIFF=YES -a_srs EPSG:3857 -co BLOCKSIZE
=256 -co TILING_SCHEME=GoogleMapsCompatible -co COMPRESS=JPEG -co QUALITY=95 -co RESAMPLING=BILINEAR -co OVERVIEW_RESAMPLING=BILINEAR -co PREDICTOR=2 -co OVERVIEWS=IGNORE_EXISTING -co ADD_ALPHA=NO DuraEuropos_Synagogue_W_0.5mm_RGB.tiff DuraEuropos_Synagogue_W_0.5mm_RGB_fakegeo.cog.tiff
```

**RGB Parameters:**
- `-of COG` - Cloud Optimized GeoTIFF
- `-a_gt 0 2 0 0 0 -2` - Geotransform: origin (0,0), 2m pixels, no rotation
- `-co BIGTIFF=YES` - Handle files >4GB
- `-a_srs EPSG:3857` - Web Mercator projection
- `-co BLOCKSIZE=256 -co TILING_SCHEME=GoogleMapsCompatible` - Recommended by geomatico/maplibre-cog-protocol
- `-co COMPRESS=JPEG -co QUALITY=95` - Lossy compression (better file size for imagery) + JPEG quality
- `-co RESAMPLING=BILINEAR` - Smooth interpolation for base tiles
- `-co OVERVIEW_RESAMPLING=BILINEAR` - Smooth interpolation for pyramids (prevents artifacts)
- `-co PREDICTOR=2 -co OVERVIEWS=IGNORE_EXISTING -co ADD_ALPHA=NO`

**No `-a_nodata`, `-colorinterp`, or `-a_scale`** - Not needed for RGB imagery

---

## RGB with Alpha Channel (RGBA → RGB with mask)

If your orthophoto has transparency (4 bands):

```bash
# Be careful, command not tested
# gdal_translate -of COG -co BIGTIFF=YES -co COMPRESS=JPEG -co QUALITY=85 -co RESAMPLING=BILINEAR -co OVERVIEW_RESAMPLING=BILINEAR -b 1 -b 2 -b 3 -mask 4 -a_srs EPSG:3857 -a_gt 0 2 0 0 0 -2 input_orthophoto.tiff output_orthophoto.cog.tiff
```

**Additional RGBA parameters:**
- `-b 1 -b 2 -b 3` - Select only RGB bands (drop alpha)
- `-mask 4` - Convert band 4 (alpha) to internal mask (prevents transparency issues in overviews and allows JPEG compression)

**Why drop alpha for JPEG?** JPEG doesn't support transparency. Converting alpha to an internal mask preserves transparency information while allowing JPEG compression of the RGB data.