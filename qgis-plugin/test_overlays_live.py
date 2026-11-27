"""The app's Vector library as QGIS layers, for real (network): every entry
added through the panel and drawn at its sample place, in headless QGIS.

  QT_QPA_PLATFORM=offscreen python-qgis test_overlays_live.py [an entry id ...]

For each entry: the layers it becomes (a vector tile layer, or a GDAL vector
layer for a PMTiles archive or a GeoJSON), each valid, styled by the entry's
categories and credited; a 400 x 300 px picture of them at the entry's
sample place, which must show something, in the entry's colors when it has
categories; how long it took. Sources that do not answer are failures: run
it again before concluding.
"""
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication  # noqa: E402

app = QgsApplication([], True)
app.initQgis()
from qgis.core import (  # noqa: E402
    Qgis, QgsCoordinateReferenceSystem, QgsMapRendererParallelJob, QgsMapSettings, QgsProject, QgsRectangle, QgsSettings,
    QgsVectorLayer, QgsVectorTileLayer,
)
from qgis.gui import QgsMapCanvas, QgsLayerTreeMapCanvasBridge  # noqa: E402
from qgis.PyQt.QtCore import QEventLoop, QSize, QTimer  # noqa: E402
from qgis.PyQt.QtGui import QColor  # noqa: E402
from terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from terrain_viewer import vector_library as vl  # noqa: E402

failures = []
WORLD = 20037508.342789244
# Where to look at an entry that names no sample place.
PLACES = {"osm-liberty-lines-labels": (45.7578, 4.832, 14), "unesco-world-heritage": (47.0, 8.0, 5),
          "unesco-world-heritage-components": (47.0, 8.0, 6)}


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what, flush=True)
    if not ok:
        failures.append(what)


def spin(ms=200):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


def draw(layers, lat, lon, zoom):
    """The layers at the app's camera (512 px tiles), 400 x 300 px on
    white: (the colors drawn, the share of pixels drawn, seconds)."""
    x = lon * WORLD / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * WORLD / math.pi
    pp = 2 * WORLD / (512 * 2 ** zoom)
    ms = QgsMapSettings()
    ms.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
    ms.setOutputSize(QSize(400, 300))
    ms.setExtent(QgsRectangle(x - 200 * pp, y - 150 * pp, x + 200 * pp, y + 150 * pp))
    ms.setLayers(layers)
    ms.setBackgroundColor(QColor(255, 255, 255))
    job = QgsMapRendererParallelJob(ms)
    loop = QEventLoop()
    job.finished.connect(loop.quit)
    t0 = time.perf_counter()
    job.start()
    loop.exec()
    img = job.renderedImage()
    px = [img.pixel(i, j) & 0xFFFFFF for i in range(0, 400, 2) for j in range(0, 300, 2)]
    return px, sum(1 for p in px if p != 0xFFFFFF) / len(px), time.perf_counter() - t0


def near(px, color, tolerance=70):
    """How many sampled pixels are within `tolerance` of a color (a fill at
    70 % over white is a lighter shade of it)."""
    c = QColor(color)
    mixed = [round(255 - 0.7 * (255 - v)) for v in (c.red(), c.green(), c.blue())]
    n = 0
    for p in px:
        r, g, b = (p >> 16) & 255, (p >> 8) & 255, p & 255
        if (abs(r - c.red()) + abs(g - c.green()) + abs(b - c.blue()) < tolerance
                or abs(r - mixed[0]) + abs(g - mixed[1]) + abs(b - mixed[2]) < tolerance):
            n += 1
    return n


settings = QgsSettings()
kept = {k: settings.value(f"terrain_viewer/{k}") for k in ("appMode", "backend", "checkUpdates")}
settings.setValue("terrain_viewer/appMode", "terrain")
settings.setValue("terrain_viewer/backend", "remote")  # nothing started
settings.setValue("terrain_viewer/checkUpdates", "false")
canvas = QgsMapCanvas()
canvas.resize(640, 400)
canvas.show()
bridge = QgsLayerTreeMapCanvasBridge(QgsProject.instance().layerTreeRoot(), canvas)
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
canvas.freeze(True)  # the pictures are drawn by the jobs below, not by the canvas
dock = TerrainViewerDock(canvas, None, None, bridge)
dock.project_fresh = False
print(f"QGIS {Qgis.version()}", flush=True)
wanted = set(sys.argv[1:])
for entry in vl.entries():
    if wanted and entry["id"] not in wanted:
        continue
    t0 = time.perf_counter()
    n_warn = len(dock.warnings)
    layers = dock.add_overlay(entry["id"])
    opened = time.perf_counter() - t0
    said = "; ".join(dock.warnings[n_warn:])
    kinds = sorted({"vector tiles" if isinstance(l, QgsVectorTileLayer) else f"vector ({l.providerType()})" for l in layers})
    if not layers or said:
        check(False, f"{entry['id']}: {len(layers)} layers ({said[:200]})")
        continue
    sample = entry.get("sample")
    lat, lon, zoom = (sample["lat"], sample["lng"], sample["zoom"]) if sample else PLACES.get(entry["id"], (48.86, 2.35, 13))
    px, share, took = draw(layers, lat, lon, zoom)
    cats = [c for c in entry.get("categories") or []]
    seen = [c["label"] for c in cats if near(px, c["color"]) > 3]
    rights = layers[0].metadata().rights()
    ok = (all(l.isValid() and l.customProperty(vl.PROP) == entry["id"] for l in layers) and share > 0.002
          and (not cats or seen) and rights == [entry.get("attribution") or entry.get("shortAttribution")])
    # Never a feature count of a planet archive: only of a file read whole.
    features = [l.featureCount() for l in layers if isinstance(l, QgsVectorLayer)] if entry["type"] == "geojson" else []
    check(ok, f"{entry['id']} ({entry['type']}): {len(layers)} layer{'s' if len(layers) > 1 else ''}, {', '.join(kinds)}, opened in "
              f"{opened:.1f} s; at {lat:.2f}, {lon:.2f} z{zoom}: {100 * share:.0f} % of the picture drawn in {took:.1f} s"
              + (f", categories seen: {', '.join(seen) or 'none'}" if cats else "")
              + (f", {features} features" if features else ""))

group = next((c for c in QgsProject.instance().layerTreeRoot().children() if c.name() == vl.GROUP), None)
check(group is not None and QgsProject.instance().layerTreeRoot().children()[0] is group or wanted,
      f"all in \"{vl.GROUP}\", at the top of the layer tree ({len(group.findLayers()) if group else 0} layers)")
QgsProject.instance().clear()
spin(100)
for k, v in kept.items():
    if v is None:
        settings.remove(f"terrain_viewer/{k}")
    else:
        settings.setValue(f"terrain_viewer/{k}", v)
dock.cleanup()
from terrain_viewer.live.server import LiveServer  # noqa: E402
LiveServer.shutdown()
print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
