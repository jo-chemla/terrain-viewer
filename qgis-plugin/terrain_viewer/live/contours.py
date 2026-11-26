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
from .overlays import vector_mem
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
    vds = vector_mem("contours")
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


_POOL = []


def _view_pool():
    """The workers that compute a view's tiles (apart from the Dem's fetchers)."""
    if not _POOL:
        import os
        from concurrent.futures import ThreadPoolExecutor
        _POOL.append(ThreadPoolExecutor(max_workers=max(2, os.cpu_count() or 4), thread_name_prefix="tv-view"))
    return _POOL[0]


def view_values(dem, extent3857, width_px, mode, opts, max_tiles=MAX_TILES):
    """A mode's values over a view, mosaicked from its tiles (each computed
    with its own halo and ancestors, as the server's: no seams):
    (array, geotransform, z)."""
    from . import modes
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

    def one(tx, ty):
        g = dem.grid(z, tx % (1 << z), ty)
        return modes.values(mode, g, dem.resolution_m(z, ty), opts, TILE)

    # A pool of its own: `one` waits on dem.pool (Dem.padded fetches the
    # neighbours there), so run on dem.pool itself it filled every worker
    # with waits on jobs queued behind them, and froze (a view of more tiles
    # than workers: an iso-line over a 1024 px canvas).
    futs = {(ty, tx): _view_pool().submit(one, tx, ty) for ty in range(y0, y1 + 1) for tx in range(x0, x1 + 1)}
    out = np.empty(((y1 - y0 + 1) * TILE, (x1 - x0 + 1) * TILE), np.float32)
    for (ty, tx), f in futs.items():
        out[(ty - y0) * TILE:(ty - y0 + 1) * TILE, (tx - x0) * TILE:(tx - x0 + 1) * TILE] = f.result()
    px = size / TILE
    return out, (-WORLD + x0 * size, px, 0.0, WORLD - y0 * size, 0.0, -px), z


def _mem(grid, geotransform):
    from osgeo import gdal
    src = gdal.GetDriverByName("MEM").Create("", grid.shape[1], grid.shape[0], 1, gdal.GDT_Float32)
    src.SetGeoTransform(geotransform)
    band = src.GetRasterBand(1)
    band.WriteArray(grid)
    band.SetNoDataValue(float("nan"))
    return src


def level_lines(grid, geotransform, levels=None, interval=None):
    """GDAL's lines of a grid at fixed levels or every interval: [(wkb, level)]."""
    from osgeo import gdal, ogr
    src = _mem(grid, geotransform)
    vds = vector_mem("lines")
    lyr = vds.CreateLayer("lines", geom_type=ogr.wkbLineString)
    lyr.CreateField(ogr.FieldDefn("v", ogr.OFTReal))
    opts = ["ELEV_FIELD=0"] +([f"FIXED_LEVELS={','.join(repr(float(v)) for v in levels)}"] if levels is not None
                               else [f"LEVEL_INTERVAL={float(interval)!r}"])
    gdal.ContourGenerateEx(src.GetRasterBand(1), lyr, options=opts)
    return [(bytes(f.GetGeometryRef().ExportToWkb()), float(f.GetField(0))) for f in lyr if f.GetGeometryRef() is not None]


def side_polygons(grid, geotransform, value, side="below"):
    """GDAL's polygons of the area of a grid below or above a value:
    [wkb] (multipolygons)."""
    from osgeo import gdal, ogr
    src = _mem(grid, geotransform)
    vds = vector_mem("bands")
    lyr = vds.CreateLayer("bands", geom_type=ogr.wkbMultiPolygon)
    lyr.CreateField(ogr.FieldDefn("lo", ogr.OFTReal))
    lyr.CreateField(ogr.FieldDefn("hi", ogr.OFTReal))
    # Polygons come between pairs of levels (MIN and MAX: the grid's own);
    # the ELEV_FIELD options are field indexes, not names.
    gdal.ContourGenerateEx(src.GetRasterBand(1), lyr, options=[
        "POLYGONIZE=YES", f"FIXED_LEVELS=MIN,{float(value)!r},MAX", "ELEV_FIELD_MIN=0", "ELEV_FIELD_MAX=1"])
    out = []
    for f in lyr:
        g = f.GetGeometryRef()
        if g is None or g.IsEmpty():
            continue
        hi = f.GetField(1)
        below = hi is not None and hi <= value + 1e-9
        if below == (side == "below"):
            out.append(bytes(g.ExportToWkb()))
    return out


def view_vector(dem, extent3857, width_px, mode, opts):
    """The vector form of a mode over a view: ([(wkb, [attributes])], z),
    the attributes in the order of MODES[mode]["vector_layer"]["fields"]."""
    from . import modes
    from .overlays import graticule_lines
    o = modes.parse_opts(mode, opts)
    if mode == "contours":
        lines, z = view_contours(dem, extent3857, width_px, o["minor"], o["major"])
        return [(w, [e, 1 if m else 0]) for w, e, m in lines], z
    if mode == "graticules":
        return [(w, [k, d]) for w, k, d in graticule_lines(extent3857, width_px, o["density"])], None
    if mode == "isoline":
        m, mo, s, _e = modes._iso(o)
        grid, gt, z = view_values(dem, extent3857, width_px, m, mo)
        if s:
            from .kernels import box_blur
            grid = box_blur(grid, s).astype(np.float32)
        if o["at"] == "value":
            lines = level_lines(grid, gt, levels=[o["value"]])
        else:
            lines = level_lines(grid, gt, interval=max(o["interval"], 1e-9))
        return [(w, [v]) for w, v in lines], z
    if mode == "planeSlicer":
        lrm = o["reference"] == "lrm"
        grid, gt, z = view_values(dem, extent3857, width_px, "lrm" if lrm else "elevation",
                                  {"radius": o["lrmRadius"]} if lrm else {})
        value = o["valueLrm"] if lrm else o["value"]
        return [(w, [value, o["side"]]) for w in side_polygons(grid, gt, value, o["side"])], z
    if mode == "moundDetector":
        return view_mounds(dem, extent3857, width_px, o)
    raise ValueError(f"{mode} has no vector form here")


TELLS_MAXZOOM = 15  # tile-server/direct.mjs: the mound tiles are made up to z15, overzoomed past it


def view_mounds(dem, extent3857, width_px, opts, max_tiles=MAX_TILES):
    """The mound candidates over a view (live/mounds.py): the source's tiles
    at the map's zoom (the vector tiles the map loads, capped at z15, as the
    tile service's), each detected on its own, as points in EPSG:3857 with
    the protocol's measures. ([(wkb, [a, blobness, plan, detHessian, pit,
    scaleM])], z)."""
    from osgeo import ogr
    from . import mounds
    from .layers import tile_zoom
    z = max(0, min(TELLS_MAXZOOM, tile_zoom(extent3857, width_px, 22) - 1))
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
    futs = {(tx, ty): _view_pool().submit(mounds.detect, dem, z, tx % n, ty, opts)
            for ty in range(y0, y1 + 1) for tx in range(x0, x1 + 1)}
    out = []
    for (tx, ty), f in futs.items():
        feats, tn = f.result()
        for cx, cy, t in feats:
            g = ogr.Geometry(ogr.wkbPoint)
            g.AddPoint_2D(-WORLD + (tx + cx / tn) * size, WORLD - (ty + cy / tn) * size)
            out.append((bytes(g.ExportToWkb()), [t["a"], t["blobness"], t["plan"], t["detHessian"], t["pit"],
                                                 t.get("scaleM")]))
    return out, z


# The contour lines' colour when none is set: black (0.9.2; brown before).
DEFAULT_COLOUR = "#000000"


def style(layer, colour=DEFAULT_COLOUR):
    """Minor lines thin, major lines thicker, in the contour colour (black by
    default)."""
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
