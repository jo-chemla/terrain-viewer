"""Building shadows: the app's BuildingShadowLayer (tile-server/direct.mjs
buildingShadowSvg) from the same data, as a raster tile.

The footprints come from the source picked (the app's buildingShadowSource,
tile-server/buildings.mjs): a vector source of the Library with heights
(OpenFreeMap's OSM buildings by default, a TileJSON; Overture's buildings, a
PMTiles archive whose address follows its monthly release), a PMTiles,
TileJSON or {z}/{x}/{y} address of the user's own with its layer and height
field, or a file OGR opens (the panel writes a polygon layer of the project
to a GeoJSON, its height in `height`). Tiles are read at the source's
deepest zoom, 14 at most, where they hold every building whole; a feature's
height is its height field, else its floors times 3.2 m, else 4 m
(lib/vector-sources.ts featureHeight), and a building marked as having parts
is replaced by its parts.

The app sweeps each footprint away from the sun by min(height, 600 m) /
tan(altitude) on flat ground, unions the sweeps and cuts the footprints back
out (roofs stay lit). The same picture comes from the terrain shadow sweep
run on flat ground with the buildings as prisms: the footprints are burnt
into a grid with their height (GDAL's MVT driver reads the tiles,
RasterizeLayer burns the heights), kernels.shadow sweeps it toward the sun,
and the footprints are lit again. No loop over pixels in Python. Nothing
below tile zoom 14 (map zoom 13, as the app). A raised part (a base above
the ground) is burnt as a prism from the ground: its shadow starts at its
foot, where the app's starts at the base's."""
import hashlib
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

DEFAULT_SOURCE = "osm-buildings-openfreemap"
# The default's entry, as lib/custom-sources.json has it (the panel gives
# the Library's others, assets/app_defaults.json).
DEFAULT_SPEC = {"id": DEFAULT_SOURCE, "type": "tilejson", "url": "https://tiles.openfreemap.org/planet",
                "sourceLayers": ["building"], "heightField": "render_height", "maxzoom": 14}
OVERTURE_CATALOG = "https://stac.overturemaps.org/catalog.json"
TILE_ZOOM = 14  # the deepest zoom tiles are read at
MIN_ZOOM = 14  # 256 px tiles; the app draws nothing below map zoom 12.5
MAX_HEIGHT_M = 600.0
MAX_REACH_M = 3000.0
MAX_HALO_PX = 1024
FLOOR_M = 3.2
DEFAULT_HEIGHT_M = 4.0
WORLD = 20037508.342789244
EARTH_RADIUS = 6378137.0

_lock = threading.Lock()
_tiles = OrderedDict()  # (source key, x, y) -> Footprints
_sources = {}  # key -> Source
_releases = {}
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="tv-buildings")
_seq = [0]


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()


def number(v):
    """A property as the app reads it (lib/vector-sources.ts
    propertyNumber): a number, a numeric string, 0 for a missing one, -1
    for what is not a number."""
    if v is None or v is False or v == "":
        return 0.0
    if v is True:
        return 1.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return -1.0
    return f if math.isfinite(f) else -1.0


def feature_height(props, height_field, floors_field=None, fallback=DEFAULT_HEIGHT_M):
    """A feature's height in metres: its height, else its floors times
    3.2 m, else `fallback` (lib/vector-sources.ts featureHeight)."""
    if not height_field:
        return fallback
    h = number(props.get(height_field))
    if h > 0:
        return h
    if floors_field:
        floors = number(props.get(floors_field))
        if floors > 0:
            return floors * FLOOR_M
    return fallback


def overture_release(fetch=_get):
    """Overture's current release id, asked once per session; None when its
    catalog does not answer (the entry's fallback release is used)."""
    with _lock:
        if "overture" in _releases:
            return _releases["overture"]
    try:
        latest = json.loads(fetch(OVERTURE_CATALOG)[1]).get("latest")
    except Exception:  # noqa: BLE001 - the fallback release
        return None
    if not isinstance(latest, str) or not all(c.isalnum() or c in "._-" for c in latest):
        return None
    with _lock:
        _releases["overture"] = latest
    return latest


def transport_of(url, given=None):
    """pmtiles, tilejson or mvt, as tile-server/buildings.mjs reads an address."""
    if given in ("pmtiles", "tilejson", "mvt"):
        return given
    bare = url.split("?")[0].split("#")[0]
    if bare.lower().endswith(".pmtiles"):
        return "pmtiles"
    return "mvt" if "{z}" in url else "tilejson"


def _as_list(v):
    return [x.strip() for x in (v if isinstance(v, (list, tuple)) else str(v or "").split(",")) if str(x).strip()]


class Footprints:
    """Buildings decoded once: an OGR memory layer of their footprints
    (EPSG:3857) and height `h`, lowest first (a building's parts overlap, a
    podium under its tower, and a later burn replaces an earlier one: the
    tallest must win), its tallest height, and a lock (an OGR layer's
    spatial filter is not thread-safe)."""

    def __init__(self, layer=None, ds=None, tallest=0.0, count=0):
        self.layer, self.ds, self.tallest, self.count = layer, ds, tallest, count
        self.lock = threading.Lock()

    def burn(self, raster, extent):
        """Burns the heights into a GDAL raster, only the buildings over
        `extent` (xmin, ymin, xmax, ymax)."""
        from osgeo import gdal
        if self.layer is None:
            return
        with self.lock:
            self.layer.SetSpatialFilterRect(*extent)
            gdal.RasterizeLayer(raster, [1], self.layer, options=["ATTRIBUTE=h"])
            self.layer.SetSpatialFilter(None)


def footprints_of(found, name):
    """[(height, OGR geometry in EPSG:3857)] as Footprints."""
    from osgeo import ogr, osr
    if not found:
        return Footprints()
    found.sort(key=lambda f: f[0])
    mem = vector_mem(name)
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    layer = mem.CreateLayer("building", srs, ogr.wkbUnknown)
    layer.CreateField(ogr.FieldDefn("h", ogr.OFTReal))
    defn = layer.GetLayerDefn()
    for h, geom in found:
        f = ogr.Feature(defn)
        f.SetField(0, float(h))
        f.SetGeometry(geom)
        layer.CreateFeature(f)
    return Footprints(layer, mem, float(found[-1][0]), len(found))


def decode_tile(data, x, y, z, spec):
    """A vector tile's buildings as Footprints: the polygons of the entry's
    layers (minus the buildings its `hasPartsField` marks, when it has part
    layers) and of its part layers, each with its height."""
    from osgeo import gdal, ogr
    if data[:2] == b"\x1f\x8b":
        import gzip
        data = gzip.decompress(data)
    if not data:
        return Footprints()
    with _lock:
        _seq[0] += 1
        name = f"/vsimem/tv-buildings-{x}-{y}-{_seq[0]}.pbf"
    gdal.FileFromMemBuffer(name, data)
    found = []
    try:
        ds = gdal.OpenEx(name, gdal.OF_VECTOR, open_options=[f"X={x}", f"Y={y}", f"Z={z}", "CLIP=NO"])
        if ds is None:
            return Footprints()
        layers, parts = _as_list(spec.get("sourceLayers")), _as_list(spec.get("partLayers"))
        if not layers:  # an address given with no layer: every layer of the tile
            layers = [ds.GetLayer(i).GetName() for i in range(ds.GetLayerCount())]
        height_field, floors_field = spec.get("heightField"), spec.get("floorsField")
        has_parts = spec.get("hasPartsField") if parts else None
        for li, lname in enumerate(layers + parts):
            layer = ds.GetLayerByName(lname)
            if layer is None:
                continue
            defn = layer.GetLayerDefn()
            idx = {k: defn.GetFieldIndex(k) for k in (height_field, floors_field, has_parts) if k}
            is_part = li >= len(layers)
            for f in layer:
                geom = f.GetGeometryRef()
                if geom is None or ogr.GT_Flatten(geom.GetGeometryType()) not in (ogr.wkbPolygon, ogr.wkbMultiPolygon):
                    continue
                props = {k: (f.GetField(i) if i >= 0 else None) for k, i in idx.items()}
                if not is_part and has_parts and props.get(has_parts) in (1, True, "true"):
                    continue  # replaced by its parts, which the part layers hold
                h = feature_height(props, height_field, floors_field)
                if h > 0:
                    found.append((h, geom.Clone()))
        ds = None
    finally:
        gdal.Unlink(name)
    return footprints_of(found, f"tv-buildings-{x}-{y}-{_seq[0]}")


def read_file(path, height_field="height", floors_field=None, layer_name=None):
    """A file OGR opens (the panel's GeoJSON of a QGIS layer) as Footprints
    in EPSG:3857: its polygons with a height."""
    from osgeo import gdal, ogr, osr
    ds = gdal.OpenEx(path, gdal.OF_VECTOR)
    if ds is None:
        raise ValueError(f"{path}: OGR does not open it")
    layer = ds.GetLayerByName(layer_name) if layer_name else ds.GetLayer(0)
    if layer is None:
        raise ValueError(f"{path}: no layer")
    target = osr.SpatialReference()
    target.ImportFromEPSG(3857)
    source = layer.GetSpatialRef()
    ct = None
    if source is not None and not source.IsSame(target):
        source = source.Clone()
        source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        ct = osr.CoordinateTransformation(source, target)
    defn = layer.GetLayerDefn()
    idx = {k: defn.GetFieldIndex(k) for k in (height_field, floors_field) if k}
    found = []
    for f in layer:
        geom = f.GetGeometryRef()
        if geom is None or ogr.GT_Flatten(geom.GetGeometryType()) not in (ogr.wkbPolygon, ogr.wkbMultiPolygon):
            continue
        props = {k: (f.GetField(i) if i >= 0 else None) for k, i in idx.items()}
        h = feature_height(props, height_field, floors_field, fallback=0.0)
        if h <= 0:
            continue
        geom = geom.Clone()
        if ct is not None and geom.Transform(ct) != 0:
            continue
        found.append((h, geom))
    return footprints_of(found, f"tv-buildings-file-{abs(hash(path))}")


class Source:
    """One source of buildings, opened on first use: where its tiles are
    and the zoom they are read at; or a file, read whole."""

    def __init__(self, key, spec):
        self.key, self.spec = key, dict(spec)
        self.lock = threading.Lock()
        self.opened = False
        self.zoom = TILE_ZOOM
        self.template = self.archive = self.whole = None

    def _zoom(self, maxzoom):
        try:
            m = float(maxzoom)
        except (TypeError, ValueError):
            return TILE_ZOOM
        return int(min(TILE_ZOOM, math.floor(m))) if m >= 0 else TILE_ZOOM

    def open(self):
        with self.lock:
            if self.opened:
                return self
            spec = self.spec
            if spec.get("type") == "file":
                self.whole = read_file(spec["path"], spec.get("heightField") or "height", spec.get("floorsField"))
                self.opened = True
                return self
            url = str(spec.get("url") or "")
            if "{release}" in url:
                release = (overture_release() if spec.get("resolver") == "overture" else None) or spec.get("fallbackRelease")
                if not release:
                    raise ValueError(f"{spec.get('id', 'the source')}: its current release is not known")
                url = url.replace("{release}", release)
            kind = transport_of(url, spec.get("type"))
            if kind == "pmtiles":
                from .pmtiles import Archive
                self.archive = Archive(url[len("pmtiles://"):] if url.startswith("pmtiles://") else url)
                header = self.archive.open()
                self.zoom = self._zoom(spec.get("maxzoom") if spec.get("maxzoom") is not None else header["max_zoom"])
            elif kind == "tilejson":
                doc = json.loads(_get(url)[1])
                tiles = doc.get("tiles") or []
                if not tiles or not isinstance(tiles[0], str):
                    raise ValueError("TileJSON without tiles")
                from urllib.parse import urljoin
                self.template = urljoin(url, tiles[0]).replace("%7B", "{").replace("%7D", "}")
                self.zoom = self._zoom(doc.get("maxzoom") if doc.get("maxzoom") is not None else spec.get("maxzoom"))
            else:
                self.template = url
                self.zoom = self._zoom(spec.get("maxzoom"))
            self.opened = True
            return self

    def fetch(self, x, y):
        """A tile's bytes, b"" where the source has none."""
        if self.archive is not None:
            return self.archive.tile(self.zoom, x, y) or b""
        url = self.template.replace("{z}", str(self.zoom)).replace("{x}", str(x)).replace("{y}", str(y))
        try:
            status, data = _get(url)
        except urllib.error.HTTPError as e:
            if e.code not in (204, 404):
                raise
            return b""
        return data if status == 200 else b""

    def tile(self, x, y):
        """One tile's Footprints (empty where the source has none), cached
        for the session (200 tiles)."""
        k = (self.key, x, y)
        with _lock:
            t = _tiles.get(k)
            if t is not None:
                _tiles.move_to_end(k)
                return t
        t = decode_tile(self.fetch(x, y), x, y, self.zoom, self.spec)
        with _lock:
            _tiles[k] = t
            while len(_tiles) > 200:
                _tiles.popitem(last=False)
        return t


def register(spec):
    """A source's key for the live server's addresses (`buildings=<key>`):
    a spec dict {"type": "tilejson" | "pmtiles" | "mvt", "url", "sourceLayers",
    "heightField", ...} (a Library entry's fields), or {"type": "file",
    "path", "heightField", "stamp"}. None or the default id: OpenFreeMap."""
    if not spec or spec == DEFAULT_SOURCE or (isinstance(spec, dict) and spec.get("id") == DEFAULT_SOURCE):
        return ""
    if not isinstance(spec, dict):
        raise ValueError(f"no such building source: {spec}")
    key = hashlib.sha1(json.dumps(spec, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:12]
    with _lock:
        if key not in _sources:
            _sources[key] = Source(key, spec)
    return key


def source_of(key):
    with _lock:
        if not key:
            if "" not in _sources:
                _sources[""] = Source("", DEFAULT_SPEC)
            return _sources[""]
        s = _sources.get(key)
    if s is None:
        raise ValueError("unknown building source (registered by the panel in another session)")
    return s


def clear():
    """Forgets the decoded tiles and the files read, keeping the sources'
    keys (they are read again on the next tile). Called when the live
    server stops: an OGR memory dataset still held when QGIS tears GDAL
    down (QgsApplication.exitQgis) crashes QGIS 3.44's Python as it exits
    (a segmentation fault after the last line of a script; found with a
    dataset kept in this cache, gone once it is dropped first)."""
    with _lock:
        _tiles.clear()
        for s in _sources.values():
            with s.lock:
                s.whole = None
                if s.spec.get("type") == "file":
                    s.opened = False


def building_tile(x, y, source=""):
    """One tile's Footprints of a source (the default: OpenFreeMap's z14 tile)."""
    return source_of(source).open().tile(x, y)


def lit(z, x, y, n=256, azimuth=315.0, altitude=45.0, source=""):
    """(n, n) float32: 1 lit, 0 in a building's shadow, for the 256 px tile
    z/x/y and the sun at azimuth / altitude (degrees)."""
    return shadows(z, x, y, n, azimuth, altitude, source)[0]


def shadows(z, x, y, n=256, azimuth=315.0, altitude=45.0, source=""):
    """lit() and the footprints' heights over the tile, (n, n) metres (0
    off the buildings)."""
    none = np.ones((n, n), np.float32), np.zeros((n, n), np.float32)
    if z < MIN_ZOOM:
        return none
    from osgeo import gdal
    src = source_of(source).open()
    size = 2 * WORLD / (1 << z)
    west, north = -WORLD + x * size, WORLD - y * size
    px = size / n
    lat = math.atan(math.sinh((north - size / 2) / EARTH_RADIUS))
    cos_lat = math.cos(lat)
    ground = px * cos_lat  # metres on the ground per pixel
    alt = max(1.0, float(altitude))
    k_tan = 1.0 / math.tan(math.radians(alt))
    if src.whole is not None:
        tiles = [src.whole] if src.whole.layer is not None else []
    else:
        # The source's tiles whose buildings can shade this one: widened by
        # the longest shadow at this sun height (3 km at most, as the app).
        reach = min(MAX_REACH_M, MAX_HEIGHT_M * k_tan) / cos_lat
        ts = 2 * WORLD / (1 << src.zoom)
        tx0, tx1 = int((west - reach + WORLD) // ts), int((west + size + reach + WORLD) // ts)
        ty0, ty1 = int((WORLD - north - reach) // ts), int((WORLD - north + size + reach) // ts)
        last = (1 << src.zoom) - 1
        tx0, tx1, ty0, ty1 = max(tx0, 0), min(tx1, last), max(ty0, 0), min(ty1, last)
        if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64:
            return none
        coords = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
        tiles = [t for t in _pool.map(lambda c: src.tile(*c), coords) if t.layer is not None]
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
        # One burn per tile, the highest kept: a building near a tile line
        # is in both tiles' buffers.
        band.Fill(0)
        t.burn(grid, extent)
        np.maximum(heights, band.ReadAsArray(), out=heights)
    np.minimum(heights, MAX_HEIGHT_M, out=heights)
    d_row, d_col = sun_step(azimuth)
    shade = shadow(heights, n, halo, d_row, d_col, ground, math.radians(alt))
    own = heights[halo:halo + n, halo:halo + n]
    return np.where(shade & ~(own > 0), 0.0, 1.0).astype(np.float32), own
