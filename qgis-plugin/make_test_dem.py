"""Test elevation rasters for the GDAL source tests (test_live.py section 7,
tile-server/test.mjs reads one too): Mapterhorn's elevation around the
Mont Blanc at z13, mosaicked and warped to Lambert-93 (EPSG:2154) at 20 m,
written as a COG with overviews (float32, nodata -9999 outside a 600 m
margin), and the same in feet (a band unit of "ft") as a plain GeoTIFF.

    python-qgis make_test_dem.py <out folder>   -> dem_2154_cog.tif, dem_2154_ft.tif

Network: tiles.mapterhorn.com."""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def make(out_dir, z=13, x0=4250, y0=2918, nx=6, ny=6):
    import numpy as np
    from osgeo import gdal
    from terrain_viewer.live.dem import TILE, Dem
    gdal.UseExceptions()
    os.makedirs(out_dir, exist_ok=True)
    dem = Dem("mapterhorn")
    grid = np.empty((ny * TILE, nx * TILE), np.float32)
    for j in range(ny):
        for i in range(nx):
            grid[j * TILE:(j + 1) * TILE, i * TILE:(i + 1) * TILE] = dem.tile(z, x0 + i, y0 + j)
    world = 20037508.342789244
    size = 2 * world / (1 << z)
    px = size / TILE
    src = gdal.GetDriverByName("MEM").Create("", grid.shape[1], grid.shape[0], 1, gdal.GDT_Float32)
    src.SetGeoTransform((-world + x0 * size, px, 0, world - y0 * size, 0, -px))
    src.SetProjection("EPSG:3857")
    src.GetRasterBand(1).WriteArray(grid)
    warped = gdal.Warp("", src, format="MEM", dstSRS="EPSG:2154", xRes=20, yRes=20, resampleAlg="bilinear",
                       dstNodata=-9999, outputType=gdal.GDT_Float32)
    b = warped.GetRasterBand(1)
    a = b.ReadAsArray()
    # A hole in the middle, no data: the kernels must leave it out.
    h, w = a.shape
    a[h // 2 - 20:h // 2 + 20, w // 2 - 20:w // 2 + 20] = -9999
    b.WriteArray(a)
    b.SetNoDataValue(-9999)
    cog = os.path.join(out_dir, "dem_2154_cog.tif")
    gdal.Translate(cog, warped, format="COG", creationOptions=["COMPRESS=DEFLATE", "PREDICTOR=FLOATING_POINT",
                                                                "OVERVIEWS=AUTO", "BLOCKSIZE=256"])
    ft = os.path.join(out_dir, "dem_2154_ft.tif")
    fa = np.where(a == -9999, -9999, a / 0.3048).astype(np.float32)
    d = gdal.GetDriverByName("GTiff").Create(ft, w, h, 1, gdal.GDT_Float32, ["COMPRESS=DEFLATE", "TILED=YES"])
    d.SetGeoTransform(warped.GetGeoTransform())
    d.SetProjection(warped.GetProjection())
    d.GetRasterBand(1).WriteArray(fa)
    d.GetRasterBand(1).SetNoDataValue(-9999)
    d.GetRasterBand(1).SetUnitType("ft")
    d = None
    return cog, ft


if __name__ == "__main__":
    from qgis.core import QgsApplication
    app = QgsApplication([], False)
    app.initQgis()
    print(*make(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out", "test-dem")), sep="\n")
    del math
