"""A setup kept, for real (network: Mapterhorn's tiles): the Python backend
drawing a hillshade, a slope (Color and Values) and contour lines at Mont
Blanc, frozen, saved to a folder with its GeoTIFFs, and read back.

  QT_QPA_PLATFORM=offscreen python-qgis test_setup_live.py [a folder to keep the setup in]

What it checks: the frozen copies' parameters; setup.json; layers.qlr
reopened in an empty project (its layers valid, the contour lines read from
vectors.gpkg); each GeoTIFF's size, CRS, extent, bands and content (a Color
form as RGBA, a Values form as Float32 degrees); Load setup after the panel
was changed.
"""
import json
import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication  # noqa: E402

app = QgsApplication([], True)
app.initQgis()
import numpy as np  # noqa: E402
from osgeo import gdal  # noqa: E402
from qgis.core import (  # noqa: E402
    QgsProject, QgsCoordinateReferenceSystem, QgsLayerDefinition, QgsRasterLayer, QgsVectorLayer, QgsSettings,
)
from qgis.gui import QgsMapCanvas, QgsLayerTreeMapCanvasBridge  # noqa: E402
from qgis.PyQt.QtCore import QEventLoop, QTimer  # noqa: E402
from terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from terrain_viewer import setups  # noqa: E402
from terrain_viewer.layers import PROP, FROZEN_PROP  # noqa: E402

failures = []
LAT, LNG, ZOOM = 45.8326, 6.8652, 11.5  # Mont Blanc


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what, flush=True)
    if not ok:
        failures.append(what)


def spin(ms=200):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


settings = QgsSettings()
kept = {k: settings.value(f"terrain_viewer/{k}") for k in ("appMode", "backend", "checkUpdates")}
settings.setValue("terrain_viewer/appMode", "terrain")
settings.setValue("terrain_viewer/checkUpdates", "false")
canvas = QgsMapCanvas()
canvas.resize(640, 400)
canvas.show()
bridge = QgsLayerTreeMapCanvasBridge(QgsProject.instance().layerTreeRoot(), canvas)
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
canvas.freeze(True)  # the canvas itself draws nothing: the GeoTIFFs ask the tiles
dock = TerrainViewerDock(canvas, None, None, bridge)
dock.project_fresh = False
dock.set_backend("python")
spin(300)
check(dock.connected == "python", f"the Python backend connected ({dock.status.text()[:60]})")
dock.set_source("mapterhorn", quiet=True)
canvas.freeze(False)
dock.zoom_to(LAT, LNG, ZOOM)
spin(100)
canvas.freeze(True)
dock.set_light(135.0, 35.0, schedule=False)
slope, hill, cont = dock.rows["slope"], dock.rows["hillshade"], dock.rows["contours"]
for r in dock.rows.values():
    r.row.set_forms(set())
slope.set_opacity(0.65)
slope.row.set_forms({"colour", "values"})
hill.row.set_forms({"colour"})
cont.set_values({"contourMinor": 100, "contourMajor": 500})
cont.row.set_forms({"vector"})
t0 = time.perf_counter()
for r in (hill, slope, cont):
    r.update()
    r.apply_style()
live = {l.customProperty(PROP): l for l in dock.stack.live_checked()}
for _ in range(300):  # the lines are computed in the background
    if "contours:vector" in live and live["contours:vector"].featureCount() > 20:
        break
    spin(200)
check(set(live) == {"slope", "slope:values", "hillshade", "contours:vector"} and all(l.isValid() for l in live.values())
      and live["contours:vector"].providerType() == "memory" and live["contours:vector"].featureCount() > 20,
      f"four live layers under the Python backend, the contour lines computed for the view "
      f"({live.get('contours:vector').featureCount() if 'contours:vector' in live else 0} lines, {time.perf_counter() - t0:.1f} s)")

# Freeze.
group = dock.freeze()
frozen = {n.layer().customProperty(FROZEN_PROP): n.layer() for n in group.findLayers()}
p = json.loads(frozen["slope:values"].customProperty(setups.PARAMS_PROP))
check(set(frozen) == set(live) and p["form"] == "values" and p["backend"] == "python" and p["source"] == "mapterhorn"
      and "Slope (values), Python backend, source mapterhorn" in frozen["slope:values"].metadata().abstract()
      and frozen["contours:vector"].featureCount() == live["contours:vector"].featureCount(),
      "Freeze: four copies with their parameters, the contour lines copied with their features")

# Save, with GeoTIFFs.
parent = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="tv-setup-live-")
os.makedirs(parent, exist_ok=True)
t0 = time.perf_counter()
res = dock.save_setup(parent, rasters=True)
took = time.perf_counter() - t0
folder = res["folder"] if res else ""
names = sorted(os.listdir(folder)) if folder else []
check(res is not None and names == ["layers.qlr", "rasters", "setup.json", "vectors.gpkg"] and not res["problems"] and res["rasters"] == 3,
      f"Save setup and GeoTIFFs: {names}, {res['rasters'] if res else 0} GeoTIFFs in {took:.1f} s ({'; '.join(res['problems']) if res else ''})")
data = setups.read(folder)
ext, width = dock.canvas_extent()
check(data["rasters"]["width"] == canvas.width() and data["rasters"]["height"] == canvas.height()
      and sorted(data["rasters"]["files"]) == ["hillshade", "slope", "slope:values"] and data["files"].get("vectors") == "vectors.gpkg"
      and data["panel"]["connected"] == "python" and data["panel"]["modes"]["slope"]["forms"] == ["color", "values"],
      f"setup.json: the GeoTIFFs listed at the canvas's size ({data['rasters']['width']} x {data['rasters']['height']} px), "
      "the gpkg, the Python backend, the slope's two forms")
for key, rel in sorted(data["rasters"]["files"].items()):
    ds = gdal.Open(os.path.join(folder, rel))
    if ds is None:
        check(False, f"{rel}: not a raster")
        continue
    gt = ds.GetGeoTransform()
    size_ok = (ds.RasterXSize, ds.RasterYSize) == (canvas.width(), canvas.height())
    where_ok = abs(gt[0] - ext.xMinimum()) < 1 and abs(gt[3] - ext.yMaximum()) < 1 and "3857" in (ds.GetProjection() or "")
    a = ds.ReadAsArray()
    if key.endswith(":values"):
        band = a if a.ndim == 2 else a[0]
        good = np.isfinite(band)
        check(size_ok and where_ok and ds.RasterCount == 1 and gdal.GetDataTypeName(ds.GetRasterBand(1).DataType) == "Float32"
              and good.mean() > 0.9 and 5 < float(np.nanmean(band[good])) < 60 and float(np.nanmax(band[good])) <= 90.01,
              f"{rel}: Float32, {ds.RasterXSize} x {ds.RasterYSize} px on the map's extent in EPSG:3857, slopes of "
              f"{float(np.nanmin(band[good])):.1f} to {float(np.nanmax(band[good])):.1f} degrees (mean {float(np.nanmean(band[good])):.1f})")
    else:
        rgb = a[:3].reshape(3, -1)
        # The slope's ramp is transparent where the ground is flat: its own alpha, kept.
        check(size_ok and where_ok and ds.RasterCount == 4 and len(np.unique(rgb[0])) > 20 and (a[3] > 0).mean() > 0.5,
              f"{rel}: RGBA, {ds.RasterXSize} x {ds.RasterYSize} px on the map's extent in EPSG:3857, "
              f"{len(np.unique(rgb[0]))} levels of red, {100 * (a[3] > 0).mean():.0f} % opaque")
    ds = None

# layers.qlr in an empty project.
live_n = live["contours:vector"].featureCount()
qlr_text = open(os.path.join(folder, "layers.qlr"), encoding="utf-8").read()
check("vectors.gpkg" in qlr_text, "layers.qlr names vectors.gpkg for the contour lines")
other = QgsProject()
into = other.layerTreeRoot().addGroup("qlr")
ok = QgsLayerDefinition.loadLayerDefinition(os.path.join(folder, "layers.qlr"), other, into)
back = {n.layer().customProperty(FROZEN_PROP): n.layer() for n in into.findLayers() if n.layer() is not None}
lines = back.get("contours:vector")
check(bool(ok[0] if isinstance(ok, (tuple, list)) else ok) and set(back) == set(live) and all(l.isValid() for l in back.values())
      and isinstance(lines, QgsVectorLayer) and lines.providerType() == "ogr" and lines.featureCount() == live_n
      and isinstance(back["slope"], QgsRasterLayer) and abs(back["slope"].renderer().opacity() - 0.65) < 1e-6
      and not any(l.customProperty(PROP) for l in back.values()),
      f"layers.qlr in another project: four valid layers, the contour lines from vectors.gpkg ({lines.featureCount() if lines else 0} "
      f"of {live_n}), the slope at 65 %, none the panel's")
check(lines is not None and lines.renderer() is not None and lines.renderer().type() == live["contours:vector"].renderer().type()
      and lines.labelsEnabled() == live["contours:vector"].labelsEnabled(), "the contour lines keep their style and labels")
# The second project and its layers go before QGIS does (a project of
# Python's own, alive at exitQgis, crashes QGIS 3.44 as it quits).
del back, lines, into
other.clear()
del other

# Load, after the panel was changed.
src_before = {k: l.source() for k, l in live.items() if l.providerType() != "memory"}
for r in dock.rows.values():
    r.row.set_forms(set())
    r.update()
slope.set_opacity(1.0)
cont.set_values({"contourMinor": 50, "contourMajor": 200})
dock.set_light(315.0, 45.0, schedule=False)
canvas.freeze(False)
dock.zoom_to(10.0, 10.0, 5)
spin(100)
canvas.freeze(True)
check(not dock.stack.live_checked(), "the panel changed: nothing live")
loaded = dock.load_setup(os.path.join(folder, "setup.json"))
now = {l.customProperty(PROP): l for l in dock.stack.live_checked()}
place = dock.place()
check(loaded and set(now) == set(live) and {k: l.source() for k, l in now.items() if l.providerType() != "memory"} == src_before
      and abs(slope.opacity_value() - 0.65) < 1e-6 and cont.values()["contourMinor"] == 100 and dock.light_value() == (135.0, 35.0)
      and abs(place[0] - LAT) < 0.01 and abs(place[1] - LNG) < 0.01 and abs(place[2] - ZOOM) < 0.05,
      f"Load setup: the four layers back with the saved addresses, opacity, contour interval, light and place ({dock.status.text()[:70]})")
for _ in range(300):  # the lines again, in the background: awaited before QGIS goes
    if "contours:vector" in now and now["contours:vector"].featureCount() > 20:
        break
    spin(200)
check("contours:vector" in now and now["contours:vector"].featureCount() == live_n,
      f"Load setup: the contour lines computed again for the place ({now['contours:vector'].featureCount() if 'contours:vector' in now else 0})")

for r in dock.rows.values():
    r.row.set_forms(set())
    r.update()
del live, frozen, now, group
QgsProject.instance().clear()
spin(100)
for k, v in kept.items():
    if v is None:
        settings.remove(f"terrain_viewer/{k}")
    else:
        settings.setValue(f"terrain_viewer/{k}", v)
dock.cleanup()
# The view's lines are computed in QGIS tasks (a move of the map starts one
# more): none may still run when QGIS goes. The application waits for its
# tasks when it quits; a script must. Known and not solved (0.12.0): on QGIS
# 3.44 this script still ends with an access violation after its "OK", about
# one run in two (exit code 0xC0000005, no Python frame); every check has
# passed by then. QGIS 4.2 ends cleanly.
for _ in range(300):
    if not QgsApplication.taskManager().countActiveTasks():
        break
    spin(100)
from terrain_viewer.live.server import LiveServer  # noqa: E402
LiveServer.shutdown()
if len(sys.argv) <= 1:
    shutil.rmtree(parent, ignore_errors=True)
print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
