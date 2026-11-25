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
dock.cleanup()
from terrain_viewer.live.server import LiveServer  # noqa: E402
LiveServer.shutdown()
print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
