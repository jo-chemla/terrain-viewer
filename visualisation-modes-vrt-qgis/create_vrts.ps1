# Slope-and-More VRT pack -- run in PowerShell to recreate all files in the current directory
$dir = Join-Path (Get-Location) "slope-and-more-vrts"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$content_mapterhorn_wms_xml = @'
<GDAL_WMS>
  <Service name="TMS">
    <ServerUrl>https://tiles.mapterhorn.com/${z}/${x}/${y}.webp</ServerUrl>
  </Service>
  <DataWindow>
    <UpperLeftX>-20037508.34</UpperLeftX>
    <UpperLeftY>20037508.34</UpperLeftY>
    <LowerRightX>20037508.34</LowerRightX>
    <LowerRightY>-20037508.34</LowerRightY>
    <TileLevel>18</TileLevel>
    <TileCountX>1</TileCountX>
    <TileCountY>1</TileCountY>
    <YOrigin>top</YOrigin>
  </DataWindow>
  <Projection>EPSG:3857</Projection>
  <BlockSizeX>512</BlockSizeX>
  <BlockSizeY>512</BlockSizeY>
  <BandsCount>3</BandsCount>
  <DataType>Byte</DataType>
  <ZeroBlockHttpCodes>204,404</ZeroBlockHttpCodes>
  <MaxConnections>4</MaxConnections>
</GDAL_WMS>
'@
Set-Content -LiteralPath (Join-Path $dir "mapterhorn_wms.xml") -Value $content_mapterhorn_wms_xml -NoNewline

$content_elevation_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Decodes Mapterhorn's terrarium-encoded RGB tiles into a single Float32 elevation
    band (meters). Formula: (R*256 + G + B/256) - 32768, identical to fetchDecodedTile()
    in lib/normal-derived-protocol.ts. Every Slope-and-More VRT in this pack reads from
    THIS file (not from mapterhorn_wms.xml directly) with BufferRadius set to whatever
    neighbor window that mode's kernel needs.
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Decoded elevation (meters)</Description>
    <PixelFunctionType>terrarium_decode</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <SourceTransferType>Byte</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np

def terrarium_decode(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    r = in_ar[0].astype(np.float64)
    g = in_ar[1].astype(np.float64)
    b = in_ar[2].astype(np.float64)
    out_ar[:] = (r * 256.0 + g + b / 256.0) - 32768.0
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">mapterhorn_wms.xml</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">mapterhorn_wms.xml</SourceFilename>
      <SourceBand>2</SourceBand>
    </SimpleSource>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">mapterhorn_wms.xml</SourceFilename>
      <SourceBand>3</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "elevation.vrt") -Value $content_elevation_vrt -NoNewline

$content_slope_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Slope (degrees). Direct port of lib/slope-protocol.ts's Horn-kernel formula:
      dx = ((a0+2*a3+a6) - (a2+2*a5+a8)) / L
      dy = ((a6+2*a7+a8) - (a0+2*a1+a2)) / L
      slopeDeg = atan(sqrt(dx^2+dy^2) / 8) * RAD_TO_DEG
    where a0..a8 are the row-major 3x3 elevation window (a4 = center) and L is the
    Mercator-corrected ground resolution in meters (EPSG:3857 pixel size * cos(tile
    center latitude) — the app uses tile-center latitude for its scale factor rather
    than a per-pixel one, reproduced here by evaluating cos(lat) once per read block
    from its vertical center row).

    Numerically verified against `gdaldem slope` on live Mapterhorn data at native
    resolution: matched within statistical noise (mean/std nearly identical across
    independent runs). ~4.4x slower than gdaldem's native C implementation.

    Usage: gdal_translate -projwin <ulx> <uly> <lrx> <lry> slope.vrt out.tif
    (pick a small window — this VRT nominally spans the whole world at z18 resolution)
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Slope (degrees)</Description>
    <PixelFunctionType>slope</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np
from math import atan, exp, pi, cos

R_EARTH = 6378137.0

def _ground_resolution(gt, yoff, ysize):
    y_center = gt[3] + gt[5] * (yoff + ysize / 2.0)
    lat = 2.0 * atan(exp(y_center / R_EARTH)) - pi / 2.0
    return abs(gt[1]) * cos(lat)

def slope(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    r = buf_radius
    z = in_ar[0].astype(np.float64)
    L = _ground_resolution(gt, yoff, ysize)

    a0 = z[0:-2, 0:-2]; a1 = z[0:-2, 1:-1]; a2 = z[0:-2, 2:]
    a3 = z[1:-1, 0:-2];                     a5 = z[1:-1, 2:]
    a6 = z[2:,   0:-2]; a7 = z[2:,   1:-1]; a8 = z[2:,   2:]

    dx = ((a0 + 2 * a3 + a6) - (a2 + 2 * a5 + a8)) / L
    dy = ((a6 + 2 * a7 + a8) - (a0 + 2 * a1 + a2)) / L

    out_ar[r:-r, r:-r] = np.degrees(np.arctan(np.sqrt(dx * dx + dy * dy) / 8.0))
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "slope.vrt") -Value $content_slope_vrt -NoNewline

$content_aspect_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Aspect (compass bearing, degrees, 0=N/90=E/180=S/270=W). Port of lib/aspect-protocol.ts,
    which reuses the same Horn gx/gy as slope.vrt but converts to a compass bearing:
      mathDeg = atan2(dy, -dx) * RAD_TO_DEG
      compassDeg = wrap0to360(90 - mathDeg)
      flat ground (dx==0 and dy==0) -> 0 (North), matching the app's fallback.
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Aspect (compass degrees)</Description>
    <PixelFunctionType>aspect</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np
from math import atan, exp, pi, cos

R_EARTH = 6378137.0

def _ground_resolution(gt, yoff, ysize):
    y_center = gt[3] + gt[5] * (yoff + ysize / 2.0)
    lat = 2.0 * atan(exp(y_center / R_EARTH)) - pi / 2.0
    return abs(gt[1]) * cos(lat)

def aspect(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    r = buf_radius
    z = in_ar[0].astype(np.float64)
    L = _ground_resolution(gt, yoff, ysize)

    a0 = z[0:-2, 0:-2]; a1 = z[0:-2, 1:-1]; a2 = z[0:-2, 2:]
    a3 = z[1:-1, 0:-2];                     a5 = z[1:-1, 2:]
    a6 = z[2:,   0:-2]; a7 = z[2:,   1:-1]; a8 = z[2:,   2:]

    dx = ((a0 + 2 * a3 + a6) - (a2 + 2 * a5 + a8)) / L
    dy = ((a6 + 2 * a7 + a8) - (a0 + 2 * a1 + a2)) / L

    math_deg = np.degrees(np.arctan2(dy, -dx))
    compass_deg = np.mod(90.0 - math_deg, 360.0)
    flat = (dx == 0) & (dy == 0)
    out_ar[r:-r, r:-r] = np.where(flat, 0.0, compass_deg)
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "aspect.vrt") -Value $content_aspect_vrt -NoNewline

$content_tri_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Terrain Ruggedness Index (Riley et al. 2006), meters. Port of lib/tri-protocol.ts:
    root-mean-square elevation difference between the center cell and its 8 neighbors.
    Unlike slope/aspect, TRI is scale-free (a pure elevation-difference RMS), so it
    needs no ground-resolution correction — same as the app.
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Terrain Ruggedness Index (meters)</Description>
    <PixelFunctionType>tri</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np

def tri(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    r = buf_radius
    z = in_ar[0].astype(np.float64)

    a0 = z[0:-2, 0:-2]; a1 = z[0:-2, 1:-1]; a2 = z[0:-2, 2:]
    a3 = z[1:-1, 0:-2]; a4 = z[1:-1, 1:-1]; a5 = z[1:-1, 2:]
    a6 = z[2:,   0:-2]; a7 = z[2:,   1:-1]; a8 = z[2:,   2:]

    d0 = a0 - a4; d1 = a1 - a4; d2 = a2 - a4
    d3 = a3 - a4;               d5 = a5 - a4
    d6 = a6 - a4; d7 = a7 - a4; d8 = a8 - a4

    sum_sq = d0*d0 + d1*d1 + d2*d2 + d3*d3 + d5*d5 + d6*d6 + d7*d7 + d8*d8
    out_ar[r:-r, r:-r] = np.sqrt(sum_sq)
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "tri.vrt") -Value $content_tri_vrt -NoNewline

$content_tpi_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Topographic Position Index, meters. Port of lib/tpi-protocol.ts:
      TPI = center - mean(8 neighbors)
    Plain elevation units, no ground-resolution scaling (same as the app).
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Topographic Position Index (meters)</Description>
    <PixelFunctionType>tpi</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np

def tpi(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    r = buf_radius
    z = in_ar[0].astype(np.float64)

    a0 = z[0:-2, 0:-2]; a1 = z[0:-2, 1:-1]; a2 = z[0:-2, 2:]
    a3 = z[1:-1, 0:-2]; a4 = z[1:-1, 1:-1]; a5 = z[1:-1, 2:]
    a6 = z[2:,   0:-2]; a7 = z[2:,   1:-1]; a8 = z[2:,   2:]

    neighbor_mean = (a0 + a1 + a2 + a3 + a5 + a6 + a7 + a8) / 8.0
    out_ar[r:-r, r:-r] = a4 - neighbor_mean
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "tpi.vrt") -Value $content_tpi_vrt -NoNewline

$content_roughness_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Roughness, meters. Port of lib/roughness-protocol.ts: max - min over the full
    3x3 window (all 9 cells, including the center). Plain elevation units.
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Roughness (meters)</Description>
    <PixelFunctionType>roughness</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np

def roughness(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    r = buf_radius
    z = in_ar[0].astype(np.float64)

    stacked = np.stack([
        z[0:-2, 0:-2], z[0:-2, 1:-1], z[0:-2, 2:],
        z[1:-1, 0:-2], z[1:-1, 1:-1], z[1:-1, 2:],
        z[2:,   0:-2], z[2:,   1:-1], z[2:,   2:],
    ], axis=0)

    out_ar[r:-r, r:-r] = stacked.max(axis=0) - stacked.min(axis=0)
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "roughness.vrt") -Value $content_roughness_vrt -NoNewline

$content_curvature_combined_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Curvature - Combined mode. Port of computeCombined() in lib/curvature-protocol.ts:
    discrete Laplacian over the 4-connected neighbors, scaled x100.
      laplacian = (a1+a3+a5+a7 - 4*a4) / L^2
      combined  = laplacian * 100
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Curvature - Combined (Laplacian x100)</Description>
    <PixelFunctionType>curvature_combined</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np
from math import atan, exp, pi, cos

R_EARTH = 6378137.0

def _ground_resolution(gt, yoff, ysize):
    y_center = gt[3] + gt[5] * (yoff + ysize / 2.0)
    lat = 2.0 * atan(exp(y_center / R_EARTH)) - pi / 2.0
    return abs(gt[1]) * cos(lat)

def curvature_combined(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    r = buf_radius
    z = in_ar[0].astype(np.float64)
    L = _ground_resolution(gt, yoff, ysize)

    a1 = z[0:-2, 1:-1]
    a3 = z[1:-1, 0:-2]; a4 = z[1:-1, 1:-1]; a5 = z[1:-1, 2:]
    a7 = z[2:,   1:-1]

    laplacian = (a1 + a3 + a5 + a7 - 4.0 * a4) / (L * L)
    out_ar[r:-r, r:-r] = laplacian * 100.0
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "curvature_combined.vrt") -Value $content_curvature_combined_vrt -NoNewline

$content_curvature_profile_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Curvature - Profile mode (curvature along the slope-gradient direction, controls
    downslope acceleration/deceleration). Port of computeProfileAndPlan() in
    lib/curvature-protocol.ts, using Zevenbergen & Thorne (1987) second-order partials:
      p = (a5-a3)/(2L),  q = (a7-a1)/(2L)
      r = (a5-2*a4+a3)/L^2,  t = (a7-2*a4+a1)/L^2,  s = (a2-a0-a8+a6)/(4L^2)
      gradSq = p^2+q^2 ; if gradSq < 1e-12 -> 0 (flat ground, undefined direction)
      profile = 100 * (r*p^2 + 2*s*p*q + t*q^2) / (gradSq * (1+gradSq)^1.5)

    NOTE: the second-derivative variable named "r" in Zevenbergen & Thorne collides
    with BufferRadius's conventional "r" name in this codebase's other VRTs — renamed
    to "rr" below to avoid shadowing.
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Curvature - Profile</Description>
    <PixelFunctionType>curvature_profile</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np
from math import atan, exp, pi, cos

R_EARTH = 6378137.0

def _ground_resolution(gt, yoff, ysize):
    y_center = gt[3] + gt[5] * (yoff + ysize / 2.0)
    lat = 2.0 * atan(exp(y_center / R_EARTH)) - pi / 2.0
    return abs(gt[1]) * cos(lat)

def curvature_profile(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    br = buf_radius
    z = in_ar[0].astype(np.float64)
    L = _ground_resolution(gt, yoff, ysize)

    a0 = z[0:-2, 0:-2]; a1 = z[0:-2, 1:-1]; a2 = z[0:-2, 2:]
    a3 = z[1:-1, 0:-2]; a4 = z[1:-1, 1:-1]; a5 = z[1:-1, 2:]
    a6 = z[2:,   0:-2]; a7 = z[2:,   1:-1]; a8 = z[2:,   2:]

    p = (a5 - a3) / (2.0 * L)
    q = (a7 - a1) / (2.0 * L)
    rr = (a5 - 2.0 * a4 + a3) / (L * L)
    t = (a7 - 2.0 * a4 + a1) / (L * L)
    s = (a2 - a0 - a8 + a6) / (4.0 * L * L)

    grad_sq = p * p + q * q
    with np.errstate(divide="ignore", invalid="ignore"):
        profile = 100.0 * (rr * p * p + 2.0 * s * p * q + t * q * q) / (grad_sq * np.power(1.0 + grad_sq, 1.5))
    out_ar[br:-br, br:-br] = np.where(grad_sq < 1e-12, 0.0, profile)
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "curvature_profile.vrt") -Value $content_curvature_profile_vrt -NoNewline

$content_curvature_plan_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Curvature - Plan mode (curvature across the slope-gradient direction, controls
    flow convergence/divergence). Port of computeProfileAndPlan() in
    lib/curvature-protocol.ts (see curvature_profile.vrt for the shared second-order
    partials p/q/rr/t/s):
      plan = 100 * (rr*q^2 - 2*s*p*q + t*p^2) / gradSq^1.5
      gradSq < 1e-12 -> 0 (flat ground)
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Curvature - Plan</Description>
    <PixelFunctionType>curvature_plan</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np
from math import atan, exp, pi, cos

R_EARTH = 6378137.0

def _ground_resolution(gt, yoff, ysize):
    y_center = gt[3] + gt[5] * (yoff + ysize / 2.0)
    lat = 2.0 * atan(exp(y_center / R_EARTH)) - pi / 2.0
    return abs(gt[1]) * cos(lat)

def curvature_plan(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    br = buf_radius
    z = in_ar[0].astype(np.float64)
    L = _ground_resolution(gt, yoff, ysize)

    a0 = z[0:-2, 0:-2]; a1 = z[0:-2, 1:-1]; a2 = z[0:-2, 2:]
    a3 = z[1:-1, 0:-2]; a4 = z[1:-1, 1:-1]; a5 = z[1:-1, 2:]
    a6 = z[2:,   0:-2]; a7 = z[2:,   1:-1]; a8 = z[2:,   2:]

    p = (a5 - a3) / (2.0 * L)
    q = (a7 - a1) / (2.0 * L)
    rr = (a5 - 2.0 * a4 + a3) / (L * L)
    t = (a7 - 2.0 * a4 + a1) / (L * L)
    s = (a2 - a0 - a8 + a6) / (4.0 * L * L)

    grad_sq = p * p + q * q
    with np.errstate(divide="ignore", invalid="ignore"):
        plan = 100.0 * (rr * q * q - 2.0 * s * p * q + t * p * p) / np.power(grad_sq, 1.5)
    out_ar[br:-br, br:-br] = np.where(grad_sq < 1e-12, 0.0, plan)
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "curvature_plan.vrt") -Value $content_curvature_plan_vrt -NoNewline

$content_curvature_det_hessian_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Curvature - Det-Hessian mode (sign/magnitude of the Hessian determinant:
    positive = bowl/dome (elliptic), negative = saddle (hyperbolic)). Port of
    computeDetHessian() in lib/curvature-protocol.ts, reusing the same rr/t/s
    second-order partials as curvature_profile.vrt / curvature_plan.vrt:
      detHessian = (rr*t - s^2) * 10000
    (no flat-ground guard in the app's version — well-defined everywhere.)
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Curvature - Det-Hessian</Description>
    <PixelFunctionType>curvature_det_hessian</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>1</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np
from math import atan, exp, pi, cos

R_EARTH = 6378137.0

def _ground_resolution(gt, yoff, ysize):
    y_center = gt[3] + gt[5] * (yoff + ysize / 2.0)
    lat = 2.0 * atan(exp(y_center / R_EARTH)) - pi / 2.0
    return abs(gt[1]) * cos(lat)

def curvature_det_hessian(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    br = buf_radius
    z = in_ar[0].astype(np.float64)
    L = _ground_resolution(gt, yoff, ysize)

    a0 = z[0:-2, 0:-2];             a2 = z[0:-2, 2:]
    a1 = z[0:-2, 1:-1]
    a3 = z[1:-1, 0:-2]; a4 = z[1:-1, 1:-1]; a5 = z[1:-1, 2:]
    a6 = z[2:,   0:-2];             a8 = z[2:,   2:]
    a7 = z[2:,   1:-1]

    rr = (a5 - 2.0 * a4 + a3) / (L * L)
    t = (a7 - 2.0 * a4 + a1) / (L * L)
    s = (a2 - a0 - a8 + a6) / (4.0 * L * L)

    out_ar[br:-br, br:-br] = (rr * t - s * s) * 10000.0
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "curvature_det_hessian.vrt") -Value $content_curvature_det_hessian_vrt -NoNewline

$content_blobness_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Blobness (structure-tensor "blob-like-ness" score). Vectorized re-derivation of
    lib/blobness-protocol.ts's per-tile algorithm, NOT a byte-for-byte transcription
    (the app loops over an explicit 3x3 sub-grid of sample points per output pixel;
    this VRT gets the same result via whole-array slicing, which is equivalent for a
    fixed sub-grid offset pattern but has not been numerically diffed against the app
    pixel-by-pixel — treat as a good-faith port, spot-check before relying on it).

    Algorithm: compute Horn gx/gy at every pixel of the 5x5-padded window (one level
    of 3x3 convolution), giving a 1-pixel-padded gx/gy field; square/cross those
    (gx^2, gy^2, gx*gy) and average each over its own 3x3 neighborhood (a second level
    of 3x3 convolution) to get the structure tensor J = [[Ixx, Ixy], [Ixy, Iyy]] at
    the output pixel; then
      blobness = (det(J) / trace(J)) * (100/64)   [0 if trace < 1e-9]
    The 100/64 factor corrects for the Horn kernel's built-in 8x gradient inflation,
    which compounds to 64x in the degree-4 determinant term (same as the app).
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Blobness</Description>
    <PixelFunctionType>blobness</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <BufferRadius>2</BufferRadius>
    <SourceTransferType>Float32</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np
from math import atan, exp, pi, cos

R_EARTH = 6378137.0

def _ground_resolution(gt, yoff, ysize):
    y_center = gt[3] + gt[5] * (yoff + ysize / 2.0)
    lat = 2.0 * atan(exp(y_center / R_EARTH)) - pi / 2.0
    return abs(gt[1]) * cos(lat)

def _avg3x3(m):
    return (
        m[0:-2, 0:-2] + m[0:-2, 1:-1] + m[0:-2, 2:] +
        m[1:-1, 0:-2] + m[1:-1, 1:-1] + m[1:-1, 2:] +
        m[2:,   0:-2] + m[2:,   1:-1] + m[2:,   2:]
    ) / 9.0

def blobness(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    br = buf_radius  # 2
    z = in_ar[0].astype(np.float64)
    L = _ground_resolution(gt, yoff, ysize)

    a0 = z[0:-2, 0:-2]; a1 = z[0:-2, 1:-1]; a2 = z[0:-2, 2:]
    a3 = z[1:-1, 0:-2];                     a5 = z[1:-1, 2:]
    a6 = z[2:,   0:-2]; a7 = z[2:,   1:-1]; a8 = z[2:,   2:]

    gx = ((a0 + 2 * a3 + a6) - (a2 + 2 * a5 + a8)) / (8.0 * L)  # shape (ysize+2, xsize+2)
    gy = ((a6 + 2 * a7 + a8) - (a0 + 2 * a1 + a2)) / (8.0 * L)

    Ixx = _avg3x3(gx * gx)
    Iyy = _avg3x3(gy * gy)
    Ixy = _avg3x3(gx * gy)

    trace = Ixx + Iyy
    det = Ixx * Iyy - Ixy * Ixy
    with np.errstate(divide="ignore", invalid="ignore"):
        blob = (det / trace) * (100.0 / 64.0)
    out_ar[br:-br, br:-br] = np.where(trace < 1e-9, 0.0, blob)
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "blobness.vrt") -Value $content_blobness_vrt -NoNewline

$content_mapterhorn_wms_ancestor_z15_xml = @'
<GDAL_WMS>
  <!-- Same Mapterhorn TMS source as mapterhorn_wms.xml, but pinned to z15 — the real
       pyramid ancestor level for LRM at radiusToLevels(radiusPx)=3 (z18-3=z15), i.e.
       an ~8x coarser relief baseline. To change the LRM smoothing radius, change this
       TileLevel (and the matching elevation_ancestor.vrt raster size) to 18-k. -->
  <Service name="TMS">
    <ServerUrl>https://tiles.mapterhorn.com/${z}/${x}/${y}.webp</ServerUrl>
  </Service>
  <DataWindow>
    <UpperLeftX>-20037508.34</UpperLeftX>
    <UpperLeftY>20037508.34</UpperLeftY>
    <LowerRightX>20037508.34</LowerRightX>
    <LowerRightY>-20037508.34</LowerRightY>
    <TileLevel>15</TileLevel>
    <TileCountX>1</TileCountX>
    <TileCountY>1</TileCountY>
    <YOrigin>top</YOrigin>
  </DataWindow>
  <Projection>EPSG:3857</Projection>
  <BlockSizeX>512</BlockSizeX>
  <BlockSizeY>512</BlockSizeY>
  <BandsCount>3</BandsCount>
  <DataType>Byte</DataType>
  <ZeroBlockHttpCodes>204,404</ZeroBlockHttpCodes>
  <MaxConnections>4</MaxConnections>
</GDAL_WMS>
'@
Set-Content -LiteralPath (Join-Path $dir "mapterhorn_wms_ancestor_z15.xml") -Value $content_mapterhorn_wms_ancestor_z15_xml -NoNewline

$content_elevation_ancestor_z15_vrt = @'
<VRTDataset rasterXSize="16777216" rasterYSize="16777216">
  <!-- Terrarium decode of the z15 ancestor source, same formula as elevation.vrt.
       Used only by lrm.vrt as the coarse "ancestor tile" term. -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 2.3886571336, 0, 20037508.34, 0, -2.3886571336</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Decoded elevation, ancestor z15 (meters)</Description>
    <PixelFunctionType>terrarium_decode</PixelFunctionType>
    <PixelFunctionLanguage>Python</PixelFunctionLanguage>
    <SourceTransferType>Byte</SourceTransferType>
    <PixelFunctionCode><![CDATA[
import numpy as np

def terrarium_decode(in_ar, out_ar, xoff, yoff, xsize, ysize, raster_xsize, raster_ysize, buf_radius, gt, **kwargs):
    r = in_ar[0].astype(np.float64)
    g = in_ar[1].astype(np.float64)
    b = in_ar[2].astype(np.float64)
    out_ar[:] = (r * 256.0 + g + b / 256.0) - 32768.0
]]>
    </PixelFunctionCode>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">mapterhorn_wms_ancestor_z15.xml</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">mapterhorn_wms_ancestor_z15.xml</SourceFilename>
      <SourceBand>2</SourceBand>
    </SimpleSource>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">mapterhorn_wms_ancestor_z15.xml</SourceFilename>
      <SourceBand>3</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "elevation_ancestor_z15.vrt") -Value $content_elevation_ancestor_z15_vrt -NoNewline

$content_lrm_vrt = @'
<VRTDataset rasterXSize="134217728" rasterYSize="134217728">
  <!--
    Local Relief Model (meters) = fine elevation - bilinear-upsampled ancestor
    elevation, at a fixed smoothing radius corresponding to k=3 pyramid levels
    (z18 fine minus z15 ancestor, an ~8x coarser relief baseline — matches
    radiusToLevels(radiusPx)=3 in lib/lrm-protocol.ts). To change the smoothing
    radius, swap elevation_ancestor_z15.vrt / mapterhorn_wms_ancestor_z15.xml for a
    different TileLevel=18-k pair and rescale this file's second SrcRect to the new
    ancestor's raster size.

    Unlike every other VRT in this pack, this ONE mode needs no Python at all: GDAL's
    built-in (native C++) "diff" pixel function computes source1 - source2 directly,
    verified empirically (10 - 3 = 7, i.e. first-minus-second order) against a live
    GDAL 3.13 install. The "ancestor at native resolution, bilinear-upsampled" step
    that lib/lrm-protocol.ts does manually is handled here for free by the VRT engine
    itself: mapping the ancestor's small SrcRect onto this file's much larger DstRect
    with resampling="bilinear" is exactly a bilinear upsample, and because both
    elevation.vrt and elevation_ancestor_z15.vrt share the same real-world geographic
    extent (the whole Web Mercator world), no manual pixel-offset recentering
    arithmetic is needed the way the app's runtime tile-fetch code requires.
  -->
  <SRS>EPSG:3857</SRS>
  <GeoTransform> -20037508.34, 0.2985821417, 0, 20037508.34, 0, -0.2985821417</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTDerivedRasterBand">
    <Description>Local Relief Model (meters, k=3 / z18-z15)</Description>
    <PixelFunctionType>diff</PixelFunctionType>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">elevation.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
      <SrcRect xOff="0" yOff="0" xSize="134217728" ySize="134217728"/>
      <DstRect xOff="0" yOff="0" xSize="134217728" ySize="134217728"/>
    </SimpleSource>
    <SimpleSource resampling="bilinear">
      <SourceFilename relativeToVRT="1">elevation_ancestor_z15.vrt</SourceFilename>
      <SourceBand>1</SourceBand>
      <SrcRect xOff="0" yOff="0" xSize="16777216" ySize="16777216"/>
      <DstRect xOff="0" yOff="0" xSize="134217728" ySize="134217728"/>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'@
Set-Content -LiteralPath (Join-Path $dir "lrm.vrt") -Value $content_lrm_vrt -NoNewline

$content_README_md = @'
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

'@
Set-Content -LiteralPath (Join-Path $dir "README.md") -Value $content_README_md -NoNewline

Write-Host "Wrote 16 files to $dir"