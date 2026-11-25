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

import numpy as np

from .dem import TILE, Dem

WORLD = 20037508.342789244
FEET = {"ft": 0.3048, "foot": 0.3048, "feet": 0.3048, "international foot": 0.3048,
        "us-ft": 1200 / 3937, "us survey foot": 1200 / 3937, "ftus": 1200 / 3937, "us_survey_foot": 1200 / 3937}
MAX_ZOOM = 22


def _gdal():
    from osgeo import gdal, osr
    gdal.UseExceptions()
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


def make_dem(spec):
    """The Dem for a source spec: GDAL's, a QGIS provider's, or a tile pyramid's."""
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
