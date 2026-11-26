"""The library's raw elevation read by the Python backend through GDAL, for
real (network): Canada's NRCan MRDEM (a COG in EPSG:3979, /vsicurl/), France's
IGN LiDAR HD DSM (a raw Float32 WMS, a GDAL WMS description), a WCS and an
ArcGIS image service (the app's bounding box template, each answer decoded by
GDAL); the panel drawing them (never Mapterhorn in their place), their raw
inputs as QGIS layers:

  QT_QPA_PLATFORM=offscreen python-qgis test_sources.py
"""
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication  # noqa: E402

app = QgsApplication([], True)
app.initQgis()
from osgeo import gdal  # noqa: E402
gdal.SetConfigOption("CPL_VSIL_NETWORK_STATS_ENABLED", "YES")  # counted from GDAL's first request (the NRCan check below)
import numpy as np  # noqa: E402
from qgis.core import QgsProject, QgsCoordinateReferenceSystem  # noqa: E402
from qgis.PyQt.QtCore import QEventLoop, QTimer  # noqa: E402
from terrain_viewer import assets, python_backend as pyb  # noqa: E402
from terrain_viewer.live import dem, gdal_source  # noqa: E402

failures = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what, flush=True)
    if not ok:
        failures.append(what)


def tile_of(lat, lon, z):
    n = 1 << z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


cat = assets.catalog()
# id, place, zoom, the reader expected, the elevation range expected there
CASES = [
    ("custom-ca-nrcan-mrdem30", "Mount Robson", 53.1105, -119.1563, 13, "GdalDem", (1500, 3960)),
    ("custom-ca-nrcan-mrdem30", "Banff", 51.1784, -115.5708, 12, "GdalDem", (1300, 3000)),
    ("custom-ign-lidarhd-dsm-wms-raw", "the Eiffel Tower", 48.8584, 2.2945, 16, "GdalDem", (25, 340)),
    ("custom-ign-lidarhd-dsm-wms-raw", "Mont Blanc", 45.8326, 6.8652, 14, "GdalDem", (3500, 4815)),
    ("custom-nl-ahn-dtm", "Amsterdam (WCS)", 52.37, 4.89, 15, "TemplateDem", (-8, 10)),
    ("custom-us-3dep", "the Grand Canyon (ArcGIS exportImage)", 36.1, -112.1, 12, "TemplateDem", (600, 2700)),
]
for sid, place, lat, lon, z, reader, (lo, hi) in CASES:
    t0 = time.perf_counter()
    src, why = pyb.source_spec(sid, cat["sources"], {})
    if src is None:
        check(False, f"{sid}: refused ({why})")
        continue
    d = gdal_source.make_dem(dem.SOURCES[src])
    a = d.tile(z, *tile_of(lat, lon, z))
    ok = np.isfinite(a)
    mn, mx = (float(np.nanmin(a)), float(np.nanmax(a))) if ok.any() else (None, None)
    check(type(d).__name__ == reader and ok.mean() > 0.3 and lo <= mn and mx <= hi,
          f"{sid}, {place} z{z}: {type(d).__name__}, {ok.mean():.0%} valid, {mn and round(mn)} to {mx and round(mx)} m "
          f"(expected {lo} to {hi}), {1000 * (time.perf_counter() - t0):.0f} ms")

# 0.10.0, the Historical mode's sources for real: Esri Wayback's capture
# dates at the Eiffel Tower (the catalog, the tilemap walk, the metadata of
# each release, as historical.py asks them), a tile of the oldest and of the
# newest date, and a tile of an EOX yearly mosaic.
from terrain_viewer import historical  # noqa: E402

t0 = time.perf_counter()
steps = []
wb = historical.list_dates("wayback", 48.8584, 2.2945, 15, report=lambda t, note: steps.append(len(t)))
wb_labels = [t["label"] for t in wb]
check(len(wb) >= 8 and wb_labels[0] == "2011-08-01" and wb_labels == sorted(set(wb_labels)) and "2014-09-12" in wb_labels,
      f"Esri Wayback at the Eiffel Tower: {len(wb)} capture dates, {wb_labels[0]} to {wb_labels[-1]}, "
      f"{sum(1 for t in wb if not t['real'])} at their release date, in {time.perf_counter() - t0:.1f} s "
      f"({len(steps)} progress reports)")
wx, wy = tile_of(48.8584, 2.2945, 16)
tiles = [historical.fetch_url(t["url"].format(z=16, x=wx, y=wy)) for t in (wb[0], wb[-1])]
check(all(b[:2] == b"\xff\xd8" and len(b) > 2000 for b in tiles) and tiles[0] != tiles[1],
      f"a tile of {wb_labels[0]} and one of {wb_labels[-1]}: two different JPEGs ({len(tiles[0])} and {len(tiles[1])} bytes)")
ex, ey = tile_of(48.8584, 2.2945, 12)
eox_tile = historical.fetch_url(historical.eox_ticks()[0]["url"].format(z=12, x=ex, y=ey))
check(eox_tile[:2] == b"\xff\xd8" and len(eox_tile) > 2000, f"EOX Sentinel-2 cloudless 2016: a tile ({len(eox_tile)} bytes)")
historical.reset_cache()

# The panel: the Python backend draws the source picked, or nothing.
from qgis.gui import QgsMapCanvas, QgsLayerTreeMapCanvasBridge  # noqa: E402
from terrain_viewer.dock import TerrainViewerDock  # noqa: E402


def spin(ms=200):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


canvas = QgsMapCanvas()
canvas.resize(800, 600)
canvas.show()
bridge = QgsLayerTreeMapCanvasBridge(QgsProject.instance().layerTreeRoot(), canvas)
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
dock = TerrainViewerDock(canvas, None, None, bridge)
dock.set_backend("python")
dock.zoom_to(45.8326, 6.8652, 13)
for sid in ("custom-ign-lidarhd-dsm-wms-raw", "custom-ca-nrcan-mrdem30"):
    dock.set_source(sid)
    dock.rows["hillshade"].check.setChecked(True)
    dock.flush()
    layer = dock.stack.find("hillshade")
    url = layer.source() if layer else ""
    check(layer is not None and "source%3Dgdal-" in url.replace("source=gdal-", "source%3Dgdal-"),
          f"{sid}: the hillshade layer reads it through GDAL, not Mapterhorn ({url[-60:]})")
dock.set_source("esri")
dock.flush()
check(dock.stack.find("hillshade") is None and "draws nothing" in dock.warnings[-1],
      f"a source it cannot read (LERC): no layer, a warning, no Mapterhorn instead ({dock.warnings[-1][:80]})")
dock.rows["hillshade"].check.setChecked(False)
# The raw inputs: the WMS and the COG as QGIS layers, in their group.
for sid in ("custom-ign-lidarhd-dsm-wms-raw", "custom-ca-nrcan-mrdem30"):
    dock.set_source(sid)
    layer = dock.add_raw_input()
    check(layer is not None and layer.isValid() and layer.bandCount() == 1 and layer.crs().isValid(),
          f"{sid}: its raw elevation as a QGIS layer ({layer and layer.name()}, {layer and layer.crs().authid()})")
group = next((g for g in QgsProject.instance().layerTreeRoot().findGroups() if g.name() == dock.RAW_ROOT), None)
check(group is not None and len(group.findLayers()) == 2, "both in the \"Raw elevation inputs\" group")
check(dock.add_raw_input() is not None and len(group.findLayers()) == 2, "added twice: the one there is kept")
texts = [dock.source.itemText(i) for i in range(dock.source.count())]
check(texts[0] == "QGIS elevation layers" and any("raw elevation" in t for t in texts[:4]),
      f"the raw inputs are QGIS elevation layers in the source list ({texts[:3]})")
# 0.9.3, the report "NRCan's raw layer added, then Hillshade: nothing". Two
# things are checked on the real COG (84 GB, EPSG:3979):
# 1. what is read: 256 px tiles at the zoom asked, from the COG's overviews
#    (a tile of all Canada costs a few MB of range requests, not the file);
# 2. the hillshade shows over the raw layer: "Raw elevation inputs" under the
#    live group whichever came first, its grey stretched to the view.
import json  # noqa: E402
import urllib.request  # noqa: E402
from qgis.core import QgsMapRendererParallelJob, QgsMapSettings, QgsRectangle  # noqa: E402
from qgis.PyQt.QtCore import QSize  # noqa: E402
from qgis.PyQt.QtGui import QImage  # noqa: E402
from terrain_viewer.live.server import LiveServer as _Live  # noqa: E402

def downloaded():
    """Bytes GDAL downloaded over /vsicurl/ so far (None when this GDAL does not count)."""
    try:
        stats = json.loads(gdal.NetworkStatsGetAsSerializedJSON() or "{}")
    except Exception:  # noqa: BLE001 - an older GDAL
        return None
    get = stats.get("methods", {}).get("GET")
    return int(get.get("downloaded_bytes", 0)) if get else None


def grey_tile(url):
    with urllib.request.urlopen(url, timeout=180) as r:
        img = QImage.fromData(r.read())
    return {img.pixel(i, j) & 255 for i in range(0, 256, 8) for j in range(0, 256, 8)} if not img.isNull() else set()


dock.set_source("custom-ca-nrcan-mrdem30")
dock._py_sources.clear()
nrcan = dock.python_source()
spec = dem.SOURCES[nrcan]
check(spec["overviews"] >= 8 and spec["size_px"][0] > 100000, f"NRCan: {spec['size_px']} px, {spec['overviews']} overviews")
srv = _Live.instance()
d = srv.dem(nrcan)
for label, z, (lat, lon), min_greys in (("all of western Canada", 3, (55.0, -115.0), 20), ("Banff", 12, (51.1784, -115.5708), 20),
                                        ("Banff, past the COG's own zoom (18 of its pixels across)", 15, (51.1784, -115.5708), 4)):
    before, warps = downloaded(), d.warps
    x, y = tile_of(lat, lon, z)
    t0 = time.perf_counter()
    greys = grey_tile(srv.xyz_url("hillshade", {}, source=nrcan).replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)))
    after = downloaded()
    mb = (after - before) / 1e6 if before is not None and after is not None else None
    check(len(greys) > min_greys and d.warps - warps <= 9 and (mb is None or mb < 48),
          f"NRCan hillshade, {label} z{z}: {len(greys)} greys, {d.warps - warps} windows of 256 px warped, "
          f"{'%.1f MB' % mb if mb is not None else 'bytes not counted'} downloaded of 84 GB, {time.perf_counter() - t0:.1f} s")

merc = QgsCoordinateReferenceSystem("EPSG:3857")


def draw(layers, lat, lon, zoom):
    x = lon * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * 20037508.34 / math.pi
    pp = 2 * 20037508.34 / (512 * 2 ** zoom)
    ms = QgsMapSettings()
    ms.setDestinationCrs(merc)
    ms.setOutputSize(QSize(800, 500))
    ms.setExtent(QgsRectangle(x - 400 * pp, y - 250 * pp, x + 400 * pp, y + 250 * pp))
    ms.setLayers(layers)
    job = QgsMapRendererParallelJob(ms)
    loop = QEventLoop()
    job.finished.connect(loop.quit)
    job.start()
    QTimer.singleShot(240000, loop.quit)
    loop.exec()
    return job.renderedImage()


def changed(a, b):
    return sum(1 for i in range(0, 800, 10) for j in range(0, 500, 10) if abs((a.pixel(i, j) & 255) - (b.pixel(i, j) & 255)) > 6)


tree_root = QgsProject.instance().layerTreeRoot()
raw = next(lyr for lyr in QgsProject.instance().mapLayers().values() if lyr.customProperty(dock.RAW_PROP) == "custom-ca-nrcan-mrdem30")
# The raw inputs were added with no mode on: the live group, made now, goes above them.
dock.rows["hillshade"].check.setChecked(True)
dock.flush()
top = [c.name() for c in tree_root.children()]
check(top == [dock.stack.root(create=False).name(), dock.RAW_ROOT], f"Hillshade checked after the raw input: the live group above it ({top})")
# The other order (0.9.2's "nothing"): a mode on first, the raw input after.
for lyr in list(QgsProject.instance().mapLayers().values()):
    if lyr.customProperty(dock.RAW_PROP):
        QgsProject.instance().removeMapLayer(lyr.id())
tree_root.removeChildNode(dock.raw_group())
raw = dock.add_raw_input()
top = [c.name() for c in tree_root.children()]
check(top == [dock.stack.root(create=False).name(), dock.RAW_ROOT],
      f"the raw input added while a mode is on: under the live group, not over it ({top})")
order = tree_root.layerOrder()
hl = dock.stack.find("hillshade")
check(order.index(hl) < order.index(raw), "QGIS draws the hillshade over the raw elevation")
both, alone = draw(order, 51.1784, -115.5708, 10), draw([raw], 51.1784, -115.5708, 10)
n = changed(both, alone)
check(n > 2000, f"Banff: the hillshade changes {n} of 4000 sampled pixels of the canvas over the raw layer (0 in 0.9.2)")
greys = {alone.pixel(i, j) & 255 for i in range(0, 800, 10) for j in range(0, 500, 10)}
low = draw([raw], 50.45, -104.6, 9)  # the prairies, 500 to 800 m of the raster's 0 to 5900 m
low_greys = sorted(low.pixel(i, j) & 255 for i in range(0, 800, 10) for j in range(0, 500, 10))
check(low_greys[len(low_greys) // 2] > 40 and low_greys[-1] - low_greys[0] > 150,
      f"the raw layer over the prairies: stretched to the view (median grey {low_greys[len(low_greys) // 2]}, not near black)")
dock.rows["hillshade"].check.setChecked(False)
dock.cleanup()
from terrain_viewer.live.server import LiveServer  # noqa: E402
LiveServer.shutdown()
print("FAILURES:" if failures else "OK", *failures, sep="\n  ", flush=True)
# The canvas may still be drawing the raw inputs over the network: stopped,
# and the project emptied, before QGIS is torn down (exitQgis waited on it).
canvas.stopRendering()
del raw, order, hl, both, alone, low
QgsProject.instance().clear()
spin(200)
app.exitQgis()
sys.exit(1 if failures else 0)
