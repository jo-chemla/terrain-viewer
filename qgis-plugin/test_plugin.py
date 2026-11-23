"""Headless check of the plugin against a running tile service:
  QT_QPA_PLATFORM=offscreen python-qgis test_plugin.py http://localhost:3400 out-dir
Builds the panel, opens a share link, checks modes, renders the canvas
extent to PNGs and prints each layer's state."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication, QgsProject, QgsMapSettings, QgsMapRendererParallelJob, QgsRectangle, QgsCoordinateReferenceSystem
from qgis.PyQt.QtCore import QSize, QEventLoop, QTimer
from qgis.PyQt.QtGui import QColor

app = QgsApplication([], True)
app.initQgis()
base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3400"
out = sys.argv[2] if len(sys.argv) > 2 else "."
os.makedirs(out, exist_ok=True)

from terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from terrain_viewer.service import tile_url  # noqa: E402

failures = []
dock = TerrainViewerDock(None)
dock.url.setText(base)
assert dock.connect_service(), dock.status.text()
print("status:", dock.status.text())
print("groups:", [r.path for r in dock.rows.values()][:3], "...", len(dock.rows), "rows")


def wait(ms):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


def render(name, layers, extent):
    ms = QgsMapSettings()
    ms.setLayers(layers)
    ms.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
    ms.setBackgroundColor(QColor("white"))
    ms.setExtent(extent)
    ms.setOutputSize(QSize(800, 500))
    job = QgsMapRendererParallelJob(ms)
    job.start()
    job.waitForFinished()
    path = os.path.join(out, name)
    job.renderedImage().save(path)
    for e in job.errors():
        print("  render error:", e.layerID, e.message)
    return path


def visible_layers():
    """The checked layers, top first, as the layer tree draws them."""
    return QgsProject.instance().layerTreeRoot().checkedLayers()


# 1. A share link: colour relief, slope, LRM, hillshade (the app's defaults
# under the show* switches).
link = "http://localhost:5173/?zoom=11.32&lat=44.5061&lng=4.0005&showColorRelief=true&showRasterBasemap=true&showReliefVisualization=true&showTerrainAnalysis=true&slopeOpacity=0.8&slopeMaxDegrees=45"
dock.open_link(link)
print("after link:", dock.status.text())
x, y = 4.0005 * 20037508.34 / 180, 5542000
import math
y = math.log(math.tan((90 + 44.5061) * math.pi / 360)) * 20037508.34 / math.pi
half = 2 * 20037508.34 / (512 * 2 ** 11.32) * 400
extent = QgsRectangle(x - half, y - half * 0.625, x + half, y + half * 0.625)

# 2. The panel's own changes: check sky view factor and contours (and its
# vector tiles), change a setting.
dock.rows["svf"].check.setChecked(True)
dock.rows["contours"].check.setChecked(True)
dock.rows["contours"].vector.setChecked(True)
dock.rows["svf"].settings["svfRadius"].set(20)
dock.flush()

for layer in QgsProject.instance().mapLayers().values():
    node = QgsProject.instance().layerTreeRoot().findLayer(layer.id())
    ok = layer.isValid()
    if not ok:
        failures.append(layer.name())
    print(f"  {'ok ' if ok else 'BAD'} {layer.name():32} visible={node.itemVisibilityChecked()} blend={int(layer.blendMode().value) if hasattr(layer.blendMode(), 'value') else int(layer.blendMode())} src={layer.source()[:150]}")

slope = dock.stack.find("slope")
print("slope url carries slopeMaxDegrees:", "slopeMaxDegrees%3D45" in slope.source() or "slopeMaxDegrees=45" in slope.source())
print("slope layer opacity (link: 0.8):", round(slope.renderer().opacity(), 2), "- address asks it opaque:", "slopeOpacity%3D1" in slope.source())
svf = dock.stack.find("svf")
print("svf url carries svfRadius:", "svfRadius" in svf.source())

# The tree, top first.
def dump(g, d=0):
    for c in g.children():
        print("  " * d + ("[" + c.name() + "]" if not hasattr(c, "layer") else c.name()))
        if not hasattr(c, "layer"):
            dump(c, d + 1)
dump(QgsProject.instance().layerTreeRoot())

dock.rows["svf"].more.setChecked(True)
dock.resize(380, 1100)
dock.show()
wait(300)
panel = os.path.join(out, "plugin-panel.png")
dock.grab().save(panel)
print(panel)
print(render("plugin-all.png", visible_layers(), extent))
print(render("plugin-svf.png", [svf], extent))
print(render("plugin-contours-vector.png", [dock.stack.find("contours:vector")], extent))

# 3. A saved project read back: the checkboxes come back from the layers.
path = os.path.join(out, "plugin-test.qgz")
QgsProject.instance().write(path)
QgsProject.instance().clear()
QgsProject.instance().read(path)
dock2 = TerrainViewerDock(None)
dock2.url.setText(base)
dock2.connect_service()
back = sorted(k for k, r in dock2.rows.items() if r.check.isChecked())
print("read back checked:", back, "svfRadius:", dock2.rows["svf"].settings["svfRadius"].get())
print("FAILURES:", failures or "none")
app.exitQgis()
