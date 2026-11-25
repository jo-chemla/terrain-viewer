"""Contour lines as a QGIS vector layer, computed for the canvas.

The elevation tiles over the view (the zoom whose pixel is the canvas
pixel, at most 64 tiles: coarser for a wide view) are mosaicked into one
grid, GDAL's ContourGenerate draws the lines, and they replace the features
of a memory layer, which QGIS redraws at once. Recomputed after each pan or
zoom (the panel waits until the canvas stops), in a QgsTask: the canvas
never waits. A memory layer rather than vector tiles: the lines are whole
across the view (no tile seams, no clipping), and the attribute table,
Identify and Save As work as on any vector layer; its features are those of
the last view, so a frozen copy keeps them.

The levels are the contour mask's (minor and major intervals, metres); a
line carries its elevation (`elev`) and whether it is a major level
(`major`)."""
import math

import numpy as np

from .dem import TILE
from .server import WORLD

MAX_TILES = 64


def view_grid(dem, extent3857, width_px, max_tiles=MAX_TILES):
    """The elevation over an EPSG:3857 extent: (array, geotransform, z),
    the tiles of the zoom whose pixel is the canvas pixel, coarser until at
    most `max_tiles` cover it."""
    from .layers import tile_zoom
    z = tile_zoom(extent3857, width_px, dem.spec["maxzoom"] + (1 if dem.spec["size"] == 512 else 0))
    while True:
        n = 1 << z
        size = 2 * WORLD / n
        x0 = int(math.floor((extent3857.xMinimum() + WORLD) / size))
        x1 = int(math.floor((extent3857.xMaximum() + WORLD) / size))
        y0 = max(int(math.floor((WORLD - extent3857.yMaximum()) / size)), 0)
        y1 = min(int(math.floor((WORLD - extent3857.yMinimum()) / size)), n - 1)
        if (x1 - x0 + 1) * (y1 - y0 + 1) <= max_tiles or z == 0:
            break
        z -= 1
    futs = {(ty, tx): dem.pool.submit(dem.tile, z, tx, ty) for ty in range(y0, y1 + 1) for tx in range(x0, x1 + 1)}
    grid = np.empty(((y1 - y0 + 1) * TILE, (x1 - x0 + 1) * TILE), np.float32)
    for (ty, tx), f in futs.items():
        grid[(ty - y0) * TILE:(ty - y0 + 1) * TILE, (tx - x0) * TILE:(tx - x0 + 1) * TILE] = f.result()
    px = size / TILE
    return grid, (-WORLD + x0 * size, px, 0.0, WORLD - y0 * size, 0.0, -px), z


def contour_lines(grid, geotransform, minor=50.0, major=200.0):
    """GDAL's contour lines of a grid every `minor` metres: [(wkb, elev,
    major)] in the grid's coordinates (EPSG:3857 here)."""
    from osgeo import gdal, ogr
    if not minor or minor <= 0:
        return []
    src = gdal.GetDriverByName("MEM").Create("", grid.shape[1], grid.shape[0], 1, gdal.GDT_Float32)
    src.SetGeoTransform(geotransform)
    src.GetRasterBand(1).WriteArray(grid)
    vds = ogr.GetDriverByName("Memory").CreateDataSource("contours")
    lyr = vds.CreateLayer("contours", geom_type=ogr.wkbLineString)
    lyr.CreateField(ogr.FieldDefn("elev", ogr.OFTReal))
    gdal.ContourGenerate(src.GetRasterBand(1), float(minor), 0.0, [], 0, 0, lyr, -1, 0)
    out = []
    for f in lyr:
        g = f.GetGeometryRef()
        if g is None:
            continue
        elev = f.GetField(0)
        is_major = bool(major and major > 0 and abs(math.remainder(elev, major)) < 1e-6)
        out.append((bytes(g.ExportToWkb()), float(elev), is_major))
    return out


def view_contours(dem, extent3857, width_px, minor=50.0, major=200.0):
    """The contour lines over a view, and the zoom of the elevation read."""
    grid, gt, z = view_grid(dem, extent3857, width_px)
    return contour_lines(grid, gt, minor, major), z


def style(layer, colour="#7a3b00"):
    """Minor lines thin, major lines thicker, the mask's brown."""
    from qgis.core import QgsCategorizedSymbolRenderer, QgsLineSymbol, QgsRendererCategory
    minor = QgsLineSymbol.createSimple({"line_color": colour, "line_width": "0.2", "line_width_unit": "MM"})
    major = QgsLineSymbol.createSimple({"line_color": colour, "line_width": "0.5", "line_width_unit": "MM"})
    layer.setRenderer(QgsCategorizedSymbolRenderer("major", [QgsRendererCategory(0, minor, "minor"),
                                                             QgsRendererCategory(1, major, "major")]))


def replace_features(layer, lines):
    """The layer's features replaced by `lines` [(wkb, elev, major)]."""
    from qgis.core import QgsFeature, QgsGeometry
    prov = layer.dataProvider()
    prov.truncate()
    feats = []
    fields = layer.fields()
    for wkb, elev, is_major in lines:
        f = QgsFeature(fields)
        g = QgsGeometry()
        g.fromWkb(wkb)
        f.setGeometry(g)
        f.setAttributes([elev, 1 if is_major else 0])
        feats.append(f)
    prov.addFeatures(feats)
    layer.updateExtents()
    layer.triggerRepaint()
