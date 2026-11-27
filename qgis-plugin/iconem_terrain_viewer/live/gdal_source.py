"""Any raster GDAL opens as the Python backend's elevation: a local GeoTIFF
or COG, a VRT, a /vsicurl/ address, a GDAL WMS or WCS description, a
QGIS raster layer of the project (its file, through GDAL; a layer of
another provider, a WMS or WCS of QGIS, through its own provider).

Each 256 px Web Mercator tile is one window of a gdal.Warp to a VRT (one
per zoom and thread: the raster in EPSG:3857 on the zoom's own pixel
grid, Float32, bilinear; GDAL picks the overview nearest the zoom's
resolution, so a zoomed-out view reads a COG's overviews, not its full
resolution), the band's no data as NaN, its scale and offset applied,
feet turned into metres. The kernels' halo comes from the neighbouring
tiles, as for the tile pyramids (live/dem.py Dem.padded): each tile is
warped once and kept in the same LRU cache, and the nine tiles of a padded
grid are warped in parallel (one GDAL dataset per thread: a dataset is not
thread-safe). A tile outside the raster's extent is NaN, warped not at all.

    spec = probe("/data/lidar.tif")          # opened once: extent, depth, units
    dem.SOURCES["gdal-1"] = spec
    GdalDem(spec).tile(15, 16891, 11732)      # (256, 256) float32 metres
"""
import math
import threading
import urllib.error
from urllib.parse import parse_qsl, urlsplit, unquote

import numpy as np

from .dem import TILE, Dem

WORLD = 20037508.342789244
FEET = {"ft": 0.3048, "foot": 0.3048, "feet": 0.3048, "international foot": 0.3048,
        "us-ft": 1200 / 3937, "us survey foot": 1200 / 3937, "ftus": 1200 / 3937, "us_survey_foot": 1200 / 3937}
MAX_ZOOM = 22


def _gdal():
    from osgeo import gdal, osr
    gdal.UseExceptions()
    # /vsicurl/ on a bucket: no directory listing on open (one request
    # instead of a listing of the whole bucket), as GDAL's cloud docs advise.
    for k, v in (("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR"), ("GDAL_HTTP_MULTIRANGE", "YES"),
                 ("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")):
        if gdal.GetConfigOption(k) is None:
            gdal.SetConfigOption(k, v)
    return gdal, osr


def vertical_scale(band, srs=None):
    """Metres per unit of the band's values: its unit type (ft, US survey
    foot) or the vertical axis of a compound CRS; 1 otherwise."""
    unit = (band.GetUnitType() or "").strip().lower()
    if unit in FEET:
        return FEET[unit]
    if srs is not None and srs.IsCompound():
        try:
            name = (srs.GetAttrValue("VERT_CS|UNIT") or "").lower()
            if "foot" in name or "feet" in name:
                return 1200 / 3937 if "us" in name else 0.3048
        except Exception:  # noqa: BLE001 - an unusual WKT: metres
            pass
    return 1.0


def _open(path, open_options=()):
    gdal, _osr = _gdal()
    return gdal.OpenEx(path, gdal.OF_RASTER | gdal.OF_READONLY, open_options=list(open_options or []))


def probe(path, band=1, open_options=(), name=None):
    """Opens a raster once: its extent (EPSG:3857 and lon/lat), the zoom of
    its own resolution, its band's no data, scale, offset and vertical
    unit. Raises when GDAL cannot open it or it has no georeferencing."""
    gdal, osr = _gdal()
    ds = _open(path, open_options)
    if ds is None:
        raise ValueError(f"GDAL cannot open {path}")
    if not 1 <= band <= ds.RasterCount:
        raise ValueError(f"{path} has no band {band}")
    b = ds.GetRasterBand(band)
    wkt = ds.GetProjection() or ""
    gt = ds.GetGeoTransform(can_return_null=True)
    if not wkt or gt is None:
        raise ValueError(f"{path} has no georeferencing (no CRS or geotransform)")
    src = osr.SpatialReference()
    src.ImportFromWkt(wkt)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    merc, ll = osr.SpatialReference(), osr.SpatialReference()
    merc.ImportFromEPSG(3857)
    ll.ImportFromEPSG(4326)
    for s in (merc, ll):
        s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_merc = osr.CoordinateTransformation(src, merc)
    to_ll = osr.CoordinateTransformation(src, ll)
    w, h = ds.RasterXSize, ds.RasterYSize
    # The extent's edge, densified (a projected raster's edge is curved in 3857).
    pts = []
    for i in range(21):
        f = i / 20
        for px, py in ((f * w, 0), (f * w, h), (0, f * h), (w, f * h)):
            pts.append((gt[0] + px * gt[1] + py * gt[2], gt[3] + px * gt[4] + py * gt[5]))
    merc_pts = [to_merc.TransformPoint(x, y)[:2] for x, y in pts]
    ll_pts = [to_ll.TransformPoint(x, y)[:2] for x, y in pts]
    xs, ys = [p[0] for p in merc_pts], [p[1] for p in merc_pts]
    bounds3857 = (max(min(xs), -WORLD), max(min(ys), -WORLD), min(max(xs), WORLD), min(max(ys), WORLD))
    lons, lats = [p[0] for p in ll_pts], [p[1] for p in ll_pts]
    # The resolution at the centre, in Web Mercator metres: one pixel across.
    cx, cy = gt[0] + w / 2 * gt[1] + h / 2 * gt[2], gt[3] + w / 2 * gt[4] + h / 2 * gt[5]
    a = to_merc.TransformPoint(cx, cy)[:2]
    bx = to_merc.TransformPoint(cx + gt[1], cy + gt[4])[:2]
    by = to_merc.TransformPoint(cx + gt[2], cy + gt[5])[:2]
    px_m = max(1e-6, min(math.hypot(bx[0] - a[0], bx[1] - a[1]), math.hypot(by[0] - a[0], by[1] - a[1])))
    maxzoom = int(min(MAX_ZOOM, max(0, math.ceil(math.log2(2 * WORLD / (TILE * px_m)) - 1e-9))))
    nodata = b.GetNoDataValue()
    return {"gdal": path, "open_options": list(open_options or []), "band": band, "size": TILE, "maxzoom": maxzoom,
            "encoding": "float", "bounds3857": bounds3857, "bounds": [min(lons), min(lats), max(lons), max(lats)],
            "nodata": nodata, "scale": b.GetScale() or 1.0, "offset": b.GetOffset() or 0.0,
            "vertical_scale": vertical_scale(b, src), "pixel_m": px_m, "name": name or path,
            "overviews": b.GetOverviewCount(), "size_px": (w, h)}


def tile_bounds(z, x, y):
    size = 2 * WORLD / (1 << z)
    return (-WORLD + x * size, WORLD - (y + 1) * size, -WORLD + (x + 1) * size, WORLD - y * size)


class GdalDem(Dem):
    """Dem's tiles (its cache, in-flight sharing, padded grids and pool), each
    warped from a GDAL raster rather than downloaded."""

    def __init__(self, spec, cache_mb=256, workers=8):
        super().__init__(spec, cache_mb, workers)
        self._local = threading.local()
        self._vrt_lock = threading.Lock()
        self._vrt_xml = {}
        self._zoom_locks = {}
        self.warp_ms = 0.0
        self.warps = 0
        self.skipped = 0

    def _ds(self):
        ds = getattr(self._local, "ds", None)
        if ds is None:
            ds = self._local.ds = _open(self.spec["gdal"], self.spec.get("open_options"))
        return ds

    def _zoom_vrt(self, z):
        """This thread's warped VRT of zoom z: the raster in EPSG:3857 on the
        zoom's own pixel grid, over the tiles it touches (gdal.Warp to a
        VRT: its transformer and overview choice made once; a tile is then
        one window of it, read in a few ms instead of a full gdal.Warp per
        tile, ~40-60 ms). (dataset, column and row of its first pixel)."""
        vrts = getattr(self._local, "vrts", None)
        if vrts is None:
            vrts = self._local.vrts = {}
        if z in vrts:
            return vrts[z]
        gdal, _osr = _gdal()
        # Made once (~130 ms) by the first thread to need it, its XML shared:
        # the others wait for it, then open that (~10 ms).
        with self._vrt_lock:
            zl = self._zoom_locks.setdefault(z, threading.Lock())
        with zl:
            shared = self._vrt_xml.get(z)
            if shared is not None and not self.spec.get("open_options"):
                vrts[z] = (gdal.Open(shared[0]), shared[1], shared[2])
                return vrts[z]
            return self._build_vrt(z, vrts)

    def _build_vrt(self, z, vrts):
        gdal, _osr = _gdal()
        e = self.spec["bounds3857"]
        n = 1 << z
        size = 2 * WORLD / n
        x0 = max(0, int(math.floor((e[0] + WORLD) / size)))
        x1 = min(n - 1, int(math.floor((e[2] + WORLD) / size)))
        y0 = max(0, int(math.floor((WORLD - e[3]) / size)))
        y1 = min(n - 1, int(math.floor((WORLD - e[1]) / size)))
        nd = self.spec.get("nodata")
        opts = gdal.WarpOptions(format="VRT", outputBounds=(-WORLD + x0 * size, WORLD - (y1 + 1) * size,
                                                            -WORLD + (x1 + 1) * size, WORLD - y0 * size),
                                xRes=size / TILE, yRes=size / TILE, dstSRS="EPSG:3857", resampleAlg="bilinear",
                                outputType=gdal.GDT_Float32, srcBands=[self.spec.get("band", 1)],
                                dstNodata=float("nan"), srcNodata=nd if nd is not None else None)
        vrt = gdal.Warp("", self._ds(), options=opts)
        vrts[z] = (vrt, x0, y0)
        self._vrt_xml.setdefault(z, (vrt.GetMetadata("xml:VRT")[0], x0, y0))
        return vrts[z]

    def _load_native(self, z, x, y):
        import time
        b = tile_bounds(z, x, y)
        e = self.spec["bounds3857"]
        if b[2] <= e[0] or b[0] >= e[2] or b[3] <= e[1] or b[1] >= e[3]:
            self.skipped += 1
            return np.full((TILE, TILE), np.nan, np.float32)
        t0 = time.perf_counter()
        nd = self.spec.get("nodata")
        vrt, x0, y0 = self._zoom_vrt(z)
        a = vrt.GetRasterBand(1).ReadAsArray((x - x0) * TILE, (y - y0) * TILE, TILE, TILE).astype(np.float32)
        if nd is not None and not (isinstance(nd, float) and math.isnan(nd)):
            a[a == np.float32(nd)] = np.nan
        floor = self.spec.get("nodata_floor")
        if floor is not None:  # the library's nodataFloor: a service's own no data value, below it
            a[a < np.float32(floor)] = np.nan
        sc, off, vs = self.spec.get("scale", 1.0), self.spec.get("offset", 0.0), self.spec.get("vertical_scale", 1.0)
        if sc != 1.0 or off != 0.0 or vs != 1.0:
            a = ((a * sc + off) * vs).astype(np.float32)
        self.warp_ms += (time.perf_counter() - t0) * 1000
        self.warps += 1
        return a

    def tile(self, z, x, y):
        n = 1 << z
        x %= n
        y = min(max(y, 0), n - 1)
        return self._native(z, x, y)


class QgsProviderDem(Dem):
    """A QGIS raster layer of another provider than GDAL's (a WMS, WCS or
    ArcGIS service of QGIS): each tile read through the provider itself,
    reprojected to EPSG:3857 by QGIS's raster projector. One provider per
    thread (a provider is not thread-safe)."""

    def __init__(self, spec, cache_mb=256, workers=4):
        super().__init__(spec, cache_mb, workers)
        self._local = threading.local()

    def _pipe(self):
        p = getattr(self._local, "pipe", None)
        if p is None:
            from qgis.core import (QgsCoordinateReferenceSystem, QgsCoordinateTransformContext, QgsDataProvider,
                                   QgsProviderRegistry, QgsRasterProjector)
            prov = QgsProviderRegistry.instance().createProvider(self.spec["qgis_provider"], self.spec["uri"],
                                                                 QgsDataProvider.ProviderOptions())
            proj = QgsRasterProjector()
            proj.setInput(prov)
            proj.setCrs(prov.crs(), QgsCoordinateReferenceSystem("EPSG:3857"), QgsCoordinateTransformContext())
            p = self._local.pipe = (prov, proj)
        return p

    def _load_native(self, z, x, y):
        from qgis.core import Qgis, QgsRectangle
        b = tile_bounds(z, x, y)
        e = self.spec["bounds3857"]
        if b[2] <= e[0] or b[0] >= e[2] or b[3] <= e[1] or b[1] >= e[3]:
            return np.full((TILE, TILE), np.nan, np.float32)
        prov, proj = self._pipe()
        band = self.spec.get("band", 1)
        block = proj.block(band, QgsRectangle(*b), TILE, TILE)
        types = {Qgis.DataType.Float32: np.float32, Qgis.DataType.Float64: np.float64, Qgis.DataType.Int16: np.int16,
                 Qgis.DataType.UInt16: np.uint16, Qgis.DataType.Int32: np.int32, Qgis.DataType.UInt32: np.uint32,
                 Qgis.DataType.Byte: np.uint8}
        dt = types.get(block.dataType())
        if dt is None or block.width() != TILE:
            return np.full((TILE, TILE), np.nan, np.float32)
        a = np.frombuffer(bytes(block.data()), dt, count=TILE * TILE).reshape(TILE, TILE).astype(np.float32)
        if block.hasNoDataValue():
            a[a == np.float32(block.noDataValue())] = np.nan
        if prov.sourceHasNoDataValue(band):
            a[a == np.float32(prov.sourceNoDataValue(band))] = np.nan
        return (a * self.spec.get("vertical_scale", 1.0)).astype(np.float32)

    def tile(self, z, x, y):
        n = 1 << z
        return self._native(z, x % n, min(max(y, 0), n - 1))


class TemplateDem(Dem):
    """A raw elevation service asked by bounding box, as the app asks it
    (the library's wms-raw entries that GDAL has no dataset form for: WCS
    GetCoverage, ArcGIS exportImage): each source tile's {bbox-epsg-3857}
    filled, with the pixel of margin the template asks for (WIDTH=514 for a
    512 px tile), the answer (a GeoTIFF) decoded by GDAL and warped onto the
    tile's own grid (a server that answers a slightly larger extent, or no
    margin, lands right), its no data and the values under nodataFloor as
    NaN. Past the source's depth, the parent's quarter (as the pyramids)."""

    def _load_native(self, z, x, y):
        import time
        import uuid
        import urllib.request
        size = self.spec["size"]
        if z > self.spec["maxzoom"]:
            from .dem import upsample2
            parent = self._native(z - 1, x >> 1, y >> 1)
            h = size // 2
            return upsample2(parent[(y & 1) * h:(y & 1) * h + h, (x & 1) * h:(x & 1) * h + h])
        t0 = time.perf_counter()
        gdal, _osr = _gdal()
        b = tile_bounds(z, x, y)
        e = self.spec.get("bounds3857")
        if e and (b[2] <= e[0] or b[0] >= e[2] or b[3] <= e[1] or b[1] >= e[3]):
            self.skipped = getattr(self, "skipped", 0) + 1
            return np.full((size, size), np.nan, np.float32)
        px = (b[2] - b[0]) / size
        m = self.spec.get("margin_px", 0) * px
        req = (b[0] - m, b[1] - m, b[2] + m, b[3] + m)
        url = self.spec["template"].replace("{bbox-epsg-3857}", ",".join(f"{v:.6f}" for v in req))
        r = urllib.request.Request(url, headers={"User-Agent": "terrain-viewer-qgis-live/0.9"})
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                data = resp.read()
        except urllib.error.HTTPError as err:
            if err.code in (204, 404):
                return np.full((size, size), np.nan, np.float32)
            raise
        name = f"/vsimem/tv-template-{uuid.uuid4().hex}.tif"
        gdal.FileFromMemBuffer(name, data)
        try:
            try:
                src = gdal.Open(name)
            except RuntimeError:
                src = None
            if src is None:
                raise ValueError(f"not a raster: {data[:160]!r}")
            if not src.GetProjection():  # no georeferencing: the bbox asked
                src = gdal.Translate("", src, format="MEM", outputSRS="EPSG:3857", outputBounds=[req[0], req[3], req[2], req[1]])
            nd = src.GetRasterBand(1).GetNoDataValue()
            out = gdal.Warp("", src, format="MEM", outputBounds=b, width=size, height=size, dstSRS="EPSG:3857",
                            resampleAlg="bilinear", outputType=gdal.GDT_Float32, srcBands=[1],
                            srcNodata=nd, dstNodata=float("nan"))
            a = out.GetRasterBand(1).ReadAsArray().astype(np.float32)
        finally:
            gdal.Unlink(name)
        floor = self.spec.get("nodata_floor")
        if floor is not None:
            a[a < np.float32(floor)] = np.nan
        self.fetch_ms += (time.perf_counter() - t0) * 1000
        self.fetches += 1
        return a


def make_dem(spec):
    """The Dem for a source spec: GDAL's, a QGIS provider's, a bounding box
    template's, or a tile pyramid's."""
    if spec.get("template"):
        return TemplateDem(spec)
    if spec.get("gdal"):
        return GdalDem(spec)
    if spec.get("qgis_provider"):
        return QgsProviderDem(spec)
    return Dem(spec)


# -- what the panel's source picker hands over ------------------------------------
GDAL_SUFFIXES = (".tif", ".tiff", ".vrt", ".img", ".asc", ".hgt", ".dem", ".bil", ".nc", ".jp2", ".flt", ".adf",
                 ".xyz", ".bt", ".ter", ".rst", ".sdat", ".grd", ".dt0", ".dt1", ".dt2")


def looks_gdal(source):
    """A string the Python backend hands to GDAL: a GDAL virtual path
    (/vsi...), a connection string (WCS:, WMS:, a <GDAL_WMS> description),
    a raster file name, an https address of a GeoTIFF or VRT, or gdal:<any>."""
    s = (source or "").strip()
    low = s.lower().split("?", 1)[0]
    if s.startswith(("gdal:", "/vsi", "WCS:", "WMS:", "<GDAL_WMS", "<VRTDataset", "GPKG:", "NETCDF:", "HDF5:")):
        return True
    if low.startswith(("http://", "https://")):
        return "{z}" not in s and low.endswith(GDAL_SUFFIXES)
    import os
    return low.endswith(GDAL_SUFFIXES) or os.path.isfile(s)


def gdal_path(source):
    """The path GDAL opens for a source string: https GeoTIFFs and VRTs
    through /vsicurl/, the gdal: prefix taken off."""
    s = source.strip()
    if s.startswith("gdal:"):
        s = s[5:]
    if s.lower().startswith(("http://", "https://")):
        s = "/vsicurl/" + s
    return s


def layer_spec(layer):
    """A QGIS raster layer as a source spec: its file through GDAL when the
    layer is of GDAL's provider, else its own provider."""
    prov = layer.providerType()
    if prov == "gdal":
        from qgis.core import QgsProviderRegistry
        parts = QgsProviderRegistry.instance().decodeUri("gdal", layer.source())
        path = parts.get("path") or layer.source().split("|")[0]
        oo = parts.get("openOptions") or []
        if parts.get("vsiPrefix") and not path.startswith("/vsi"):
            path = parts["vsiPrefix"] + path
        if parts.get("layerName"):
            # A subdataset (GeoPackage raster table, netCDF variable): GDAL's own name.
            path = layer.source().split("|")[0] if path == layer.source() else path
        spec = probe(path, 1, oo, name=layer.name())
        spec["layer"] = layer.id()
        return spec
    from qgis.core import QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsProject
    ext = layer.extent()
    to_merc = QgsCoordinateTransform(layer.crs(), QgsCoordinateReferenceSystem("EPSG:3857"), QgsProject.instance())
    to_ll = QgsCoordinateTransform(layer.crs(), QgsCoordinateReferenceSystem("EPSG:4326"), QgsProject.instance())
    m, ll = to_merc.transformBoundingBox(ext), to_ll.transformBoundingBox(ext)
    px = max(layer.rasterUnitsPerPixelX(), 1e-9) if layer.rasterUnitsPerPixelX() > 0 else None
    maxzoom = 18
    if px is not None and layer.width() > 0:
        px_m = m.width() / max(layer.width(), 1)
        maxzoom = int(min(MAX_ZOOM, max(0, math.ceil(math.log2(2 * WORLD / (TILE * max(px_m, 1e-6)))))))
    return {"qgis_provider": prov, "uri": layer.source(), "band": 1, "size": TILE, "maxzoom": maxzoom,
            "encoding": "float", "bounds3857": (m.xMinimum(), m.yMinimum(), m.xMaximum(), m.yMaximum()),
            "bounds": [ll.xMinimum(), ll.yMinimum(), ll.xMaximum(), ll.yMaximum()], "vertical_scale": 1.0,
            "name": layer.name(), "layer": layer.id()}


# -- the library's raw elevation services ---------------------------------------
def _query(address):
    """(base address with its ?, {lower-case key: (key, value)}) of a
    template address (the {bbox-epsg-3857} placeholder kept as it is)."""
    parts = urlsplit(address.replace("{bbox-epsg-3857}", "BBOXPLACEHOLDER"))
    q = {}
    for k, v in parse_qsl(parts.query, keep_blank_values=True):
        q[k.lower()] = (k, v.replace("BBOXPLACEHOLDER", "{bbox-epsg-3857}"))
    return f"{parts.scheme}://{parts.netloc}{parts.path}?", q


def request_px(address):
    """The pixel size the template asks for (WIDTH=1026, size=514,514), or None."""
    _base, q = _query(address)
    for k in ("width", "size"):
        if k in q:
            try:
                return int(q[k][1].split(",")[0])
            except ValueError:
                return None
    return None


def is_wms_getmap(address):
    """A WMS GetMap address (SERVICE=WMS, REQUEST=GetMap)."""
    _base, q = _query(address or "")
    return q.get("service", ("", ""))[1].upper() == "WMS" and q.get("request", ("", ""))[1].lower() == "getmap"


def _merc(lon, lat):
    lat = max(min(lat, 85.0511), -85.0511)
    return lon * WORLD / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * WORLD / math.pi


def bounds3857(bounds):
    """Lon/lat bounds in EPSG:3857 (the world without any)."""
    if not bounds:
        return (-WORLD, -WORLD, WORLD, WORLD)
    x0, y0 = _merc(bounds[0], bounds[1])
    x1, y1 = _merc(bounds[2], bounds[3])
    return (max(x0, -WORLD), max(y0, -WORLD), min(x1, WORLD), min(y1, WORLD))


def tile_px(entry):
    """A raw service's tile size, as the app asks it: the library's tileSize,
    else the size its template asks less the two pixels of margin (514 ->
    512), else 512."""
    if entry.get("tileSize"):
        return int(entry["tileSize"])
    n = request_px(entry.get("address") or "")
    if n and n - 2 in (256, 512, 1024, 2048):
        return n - 2
    return n or 512


def wms_xml(entry, block=512):
    """A GDAL WMS description (WMS minidriver) of a library entry whose
    address is a WMS GetMap of a raw elevation format (a Float32 GeoTIFF):
    the service's base address, layer, version, CRS and format, a data
    window over the entry's bounds in EPSG:3857 at its finest resolution
    (the library's maxzoom in its own tile size), one Float32 band, empty
    blocks for 204 and 404 and for a service exception. GDAL makes the
    overviews (a zoomed-out view asks the service for coarser pictures).
    None when the address is not a WMS GetMap."""
    address = entry.get("address") or ""
    if not is_wms_getmap(address):
        return None
    base, q = _query(address)
    taken = {"service", "request", "version", "layers", "styles", "format", "crs", "srs", "bbox", "width", "height",
             "transparent"}
    extra = "&".join(f"{k}={v}" for k, v in (q[x] for x in q if x not in taken))
    version = q.get("version", ("", "1.3.0"))[1]
    crs = (q.get("crs") or q.get("srs") or ("", "EPSG:3857"))[1]
    fmt = unquote(q.get("format", ("", "image/geotiff"))[1])
    e = bounds3857(entry.get("bounds"))
    size = tile_px(entry)
    res = 2 * WORLD / (size * (1 << int(entry.get("maxzoom") or 16)))
    nx, ny = max(1, int(math.ceil((e[2] - e[0]) / res))), max(1, int(math.ceil((e[3] - e[1]) / res)))

    def esc(t):
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    crs_tag = "CRS" if version.startswith("1.3") else "SRS"
    return (f"<GDAL_WMS><Service name=\"WMS\"><Version>{esc(version)}</Version>"
            f"<ServerUrl>{esc(base + extra)}</ServerUrl><{crs_tag}>{esc(crs)}</{crs_tag}>"
            f"<ImageFormat>{esc(fmt)}</ImageFormat><Layers>{esc(q.get('layers', ('', ''))[1])}</Layers>"
            f"<Styles>{esc(q.get('styles', ('', ''))[1])}</Styles><Transparent>FALSE</Transparent></Service>"
            f"<DataWindow><UpperLeftX>{e[0]:.4f}</UpperLeftX><UpperLeftY>{e[3]:.4f}</UpperLeftY>"
            f"<LowerRightX>{e[0] + nx * res:.4f}</LowerRightX><LowerRightY>{e[3] - ny * res:.4f}</LowerRightY>"
            f"<SizeX>{nx}</SizeX><SizeY>{ny}</SizeY></DataWindow>"
            f"<Projection>EPSG:3857</Projection><BandsCount>1</BandsCount><DataType>Float32</DataType>"
            f"<BlockSizeX>{block}</BlockSizeX><BlockSizeY>{block}</BlockSizeY><MaxConnections>4</MaxConnections>"
            f"<Timeout>60</Timeout><ZeroBlockHttpCodes>204,404</ZeroBlockHttpCodes>"
            f"<ZeroBlockOnServerException>true</ZeroBlockOnServerException></GDAL_WMS>")


def library_address(entry):
    """The address GDAL opens for a library entry: /vsicurl/ for a COG or
    VRT, the GDAL WMS description for a raw WMS GetMap; None for anything
    else (a pyramid, a WCS or ArcGIS template, no address)."""
    address, kind = entry.get("address"), entry.get("type")
    if not address and kind in ("cog", "vrt") and str(entry.get("url") or "").startswith("https://") and "{z}" not in entry["url"]:
        address = entry["url"]
    if not address:
        return None
    if kind in ("cog", "vrt"):
        return gdal_path(address)
    return wms_xml(entry)


def library_spec(entry):
    """A library entry the Python backend reads through GDAL, as a source
    spec: a COG or VRT by /vsicurl/, a raw WMS by its GDAL WMS description,
    any other raw service (WCS, ArcGIS exportImage) by its template. None
    when it has no such address (an older service's listing, a keyed
    entry). Raises when GDAL cannot open it."""
    name = entry.get("name") or entry.get("id")
    path = library_address(entry)
    if path is not None:
        spec = probe(path, name=name)
        if entry.get("type") == "wms-raw":
            spec["bounds"] = entry.get("bounds") or spec["bounds"]
    elif entry.get("type") == "wms-raw" and entry.get("address"):
        address = entry["address"]
        n = request_px(address)
        size = tile_px(entry)
        if size not in (256, 512):  # live/dem.py's tiles are 256 or 512 px: ask 512 (and its margin)
            import re
            margin = max(0, ((n or size) - size) // 2)
            address = re.sub(r"(?i)\b(width|height)=\d+", lambda m: f"{m.group(1)}={512 + 2 * margin}", address)
            address = re.sub(r"(?i)\bsize=\d+,\d+", f"size={512 + 2 * margin},{512 + 2 * margin}", address)
            size, n = 512, 512 + 2 * margin
        spec = {"template": address, "size": size, "margin_px": max(0, ((n or size) - size) // 2),
                "maxzoom": int(entry.get("maxzoom") or 16), "encoding": "float",
                "bounds3857": bounds3857(entry.get("bounds")), "bounds": entry.get("bounds") or [-180, -85, 180, 85],
                "name": name}
    else:
        return None
    if entry.get("nodataFloor") is not None:
        spec["nodata_floor"] = float(entry["nodataFloor"])
    return spec
