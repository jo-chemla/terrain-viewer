"""Building shadows: the app's BuildingShadowLayer (tile-server/direct.mjs
buildingShadowSvg) from the same data, OpenFreeMap's z14 building tiles
(lib/building-tiles.ts), as a raster tile.

The app sweeps each footprint away from the sun by min(render_height,
600 m) / tan(altitude) on flat ground, unions the sweeps and cuts the
footprints back out (roofs stay lit). The same picture comes from the
terrain shadow sweep run on flat ground with the buildings as prisms: the
footprints are burnt into a grid with their height (GDAL's MVT driver reads
the tiles, RasterizeLayer burns render_height), kernels.shadow sweeps it
toward the sun, and the footprints are lit again. No loop over buildings or
pixels in Python. Nothing below tile zoom 14 (map zoom 13, as the app)."""
import json
import math
import threading
import urllib.error
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from .dem import USER_AGENT
from .overlays import vector_mem
from .kernels import shadow, sun_step

TILEJSON = "https://tiles.openfreemap.org/planet"
TILE_ZOOM = 14  # the planet set's maxzoom: every building whole
MIN_ZOOM = 14  # 256 px tiles; the app draws nothing below map zoom 12.5
MAX_HEIGHT_M = 600.0
MAX_REACH_M = 3000.0
MAX_HALO_PX = 1024
WORLD = 20037508.342789244
EARTH_RADIUS = 6378137.0

_lock = threading.Lock()
_tiles = OrderedDict()  # (x, y) -> (mvt bytes or b"", tallest height)
_template = []
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="tv-buildings")
_seq = [0]


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()


def tile_template():
    with _lock:
        if _template:
            return _template[0]
    _status, body = _get(TILEJSON)
    url = json.loads(body)["tiles"][0]
    with _lock:
        _template[:] = [url]
    return url


def _open(data, x, y):
    from osgeo import gdal
    with _lock:
        _seq[0] += 1
        name = f"/vsimem/tv-buildings-{x}-{y}-{_seq[0]}.pbf"
    gdal.FileFromMemBuffer(name, data)
    ds = gdal.OpenEx(name, gdal.OF_VECTOR, open_options=[f"X={x}", f"Y={y}", f"Z={TILE_ZOOM}", "CLIP=NO"])
    return ds, name


class Footprints:
    """One z14 tile's buildings, decoded once: an OGR memory layer of their
    footprints (EPSG:3857) and render_height, lowest first (a building's
    parts overlap, a podium under its tower, and a later burn replaces an
    earlier one: the tallest must win), its tallest height, and a lock (an
    OGR layer's spatial filter is not thread-safe)."""

    def __init__(self, layer=None, ds=None, tallest=0.0):
        self.layer, self.ds, self.tallest = layer, ds, tallest
        self.lock = threading.Lock()

    def burn(self, raster, extent):
        """Burns the heights into a GDAL raster, only the buildings over
        `extent` (xmin, ymin, xmax, ymax)."""
        from osgeo import gdal
        if self.layer is None:
            return
        with self.lock:
            self.layer.SetSpatialFilterRect(*extent)
            gdal.RasterizeLayer(raster, [1], self.layer, options=["ATTRIBUTE=render_height"])
            self.layer.SetSpatialFilter(None)


def building_tile(x, y):
    """One z14 tile's Footprints (empty where OpenFreeMap has none), cached
    for the session (200 tiles)."""
    with _lock:
        t = _tiles.get((x, y))
        if t is not None:
            _tiles.move_to_end((x, y))
            return t
    url = tile_template().replace("{z}", str(TILE_ZOOM)).replace("{x}", str(x)).replace("{y}", str(y))
    try:
        status, data = _get(url)
    except urllib.error.HTTPError as e:
        if e.code not in (204, 404):
            raise
        status, data = e.code, b""
    t = Footprints()
    if status == 200 and data:
        from osgeo import gdal, ogr
        ds, name = _open(data, x, y)
        if ds is not None and ds.GetLayerByName("building") is not None:
            res = ds.ExecuteSQL("SELECT render_height FROM building ORDER BY render_height")
            mem = vector_mem(f"tv-buildings-{x}-{y}")
            layer = mem.CopyLayer(res, "building")
            ds.ReleaseResultSet(res)
            res = ds.ExecuteSQL("SELECT MAX(render_height) FROM building")
            f = res.GetNextFeature() if res is not None else None
            tallest = float(f.GetField(0) or 0.0) if f is not None else 0.0
            ds.ReleaseResultSet(res)
            t = Footprints(layer, mem, tallest)
        ds = None
        gdal.Unlink(name)
    with _lock:
        _tiles[(x, y)] = t
        while len(_tiles) > 200:
            _tiles.popitem(last=False)
    return t


def lit(z, x, y, n=256, azimuth=315.0, altitude=45.0):
    """(n, n) float32: 1 lit, 0 in a building's shadow, for the 256 px tile
    z/x/y and the sun at azimuth / altitude (degrees)."""
    return shadows(z, x, y, n, azimuth, altitude)[0]


def shadows(z, x, y, n=256, azimuth=315.0, altitude=45.0):
    """lit() and the footprints' heights over the tile, (n, n) metres (0
    off the buildings)."""
    none = np.ones((n, n), np.float32), np.zeros((n, n), np.float32)
    if z < MIN_ZOOM:
        return none
    from osgeo import gdal
    size = 2 * WORLD / (1 << z)
    west, north = -WORLD + x * size, WORLD - y * size
    px = size / n
    lat = math.atan(math.sinh((north - size / 2) / EARTH_RADIUS))
    cos_lat = math.cos(lat)
    ground = px * cos_lat  # metres on the ground per pixel
    alt = max(1.0, float(altitude))
    k_tan = 1.0 / math.tan(math.radians(alt))
    # The z14 tiles whose buildings can shade this one: widened by the
    # longest shadow at this sun height (3 km at most, as the app).
    reach = min(MAX_REACH_M, MAX_HEIGHT_M * k_tan) / cos_lat
    t14 = 2 * WORLD / (1 << TILE_ZOOM)
    tx0, tx1 = int((west - reach + WORLD) // t14), int((west + size + reach + WORLD) // t14)
    ty0, ty1 = int((WORLD - north - reach) // t14), int((WORLD - north + size + reach) // t14)
    last = (1 << TILE_ZOOM) - 1
    tx0, tx1, ty0, ty1 = max(tx0, 0), min(tx1, last), max(ty0, 0), min(ty1, last)
    if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64:
        return none
    coords = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    tiles = [t for t in _pool.map(lambda c: building_tile(*c), coords) if t.layer is not None]
    tallest = min(MAX_HEIGHT_M, max((t.tallest for t in tiles), default=0.0))
    if tallest <= 0:
        return none
    halo = int(min(MAX_HALO_PX, math.ceil(tallest * k_tan / ground) + 1))
    m = n + 2 * halo
    x0, y1 = west - halo * px, north + halo * px
    extent = (x0, y1 - m * px, x0 + m * px, y1)
    heights = np.zeros((m, m), np.float32)
    grid = gdal.GetDriverByName("MEM").Create("", m, m, 1, gdal.GDT_Float32)
    grid.SetGeoTransform((x0, px, 0.0, y1, 0.0, -px))
    band = grid.GetRasterBand(1)
    for t in tiles:
        # One burn per z14 tile, the highest kept: a building near a tile
        # line is in both tiles' buffers.
        band.Fill(0)
        t.burn(grid, extent)
        np.maximum(heights, band.ReadAsArray(), out=heights)
    np.minimum(heights, MAX_HEIGHT_M, out=heights)
    d_row, d_col = sun_step(azimuth)
    shade = shadow(heights, n, halo, d_row, d_col, ground, math.radians(alt))
    own = heights[halo:halo + n, halo:halo + n]
    return np.where(shade & ~(own > 0), 0.0, 1.0).astype(np.float32), own
