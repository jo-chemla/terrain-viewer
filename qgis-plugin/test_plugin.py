"""Headless check of the plugin against a running tile service:
  QT_QPA_PLATFORM=offscreen python-qgis test_plugin.py http://localhost:3400 out-dir
Builds the panel, opens a share link, checks modes, freezes them (the copies
must not follow a later panel change), renders the canvas
extent to PNGs and prints each layer's state."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication, QgsProject, QgsMapSettings, QgsMapRendererParallelJob, QgsRectangle, QgsCoordinateReferenceSystem, QgsPointXY, Qgis
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

# The plugin around the panel: its button on the Web toolbar and in the Web
# menu, its SVG icon, nothing left after unload.
import terrain_viewer  # noqa: E402
from qgis.PyQt.QtWidgets import QMainWindow  # noqa: E402


class Iface:
    def __init__(self):
        self.window, self.toolbar, self.web = QMainWindow(), [], []

    def mainWindow(self):
        return self.window

    def addWebToolBarIcon(self, a):
        self.toolbar.append(a)

    def removeWebToolBarIcon(self, a):
        self.toolbar.remove(a)

    def addPluginToWebMenu(self, name, a):
        self.web.append(a)

    def removePluginWebMenu(self, name, a):
        self.web.remove(a)


iface = Iface()
plugin = terrain_viewer.classFactory(iface)
plugin.initGui()
if len(iface.toolbar) != 1 or len(iface.web) != 1 or iface.toolbar[0].icon().pixmap(24, 24).isNull():
    failures.append("plugin: toolbar button, Web menu entry or icon")
plugin.unload()
if iface.toolbar or iface.web:
    failures.append("plugin: unload")

dock = TerrainViewerDock(None)
print("tree before any service (the packaged snapshot):", len(dock.rows), "rows")
if len(dock.rows) < 20:
    failures.append("no modes tree before connecting (assets/catalog.json)")
dock.set_backend("remote", connect=False)
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


# 1. A share link: color relief, slope, LRM, hillshade (the app's defaults
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
if not dock.rows["contours"].vector.isChecked() or dock.rows["contours"].color.isChecked():
    failures.append("overlays: vector tiles are not the default form")
dock.rows["contours"].color.setChecked(True)
dock.rows["svf"].settings["svfRadius"].set(20)
# The slope's values too: a Float32 raster read by GDAL (/gdal.xml).
dock.rows["slope"].numbers.setChecked(True)
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
numbers = dock.stack.find("slope:values")
v, sampled = numbers.dataProvider().sample(QgsPointXY(x, y), 1)
print("slope values:", numbers.name(), "Float32:", numbers.dataProvider().dataType(1) == Qgis.DataType.Float32, "at the view's centre:", round(v, 2) if sampled else None, "degrees")
if not (sampled and 0 <= v <= 90):
    failures.append("slope values")

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
print(render("plugin-slope-values.png", [numbers], extent))

# 2b. Freeze: the checked layers copied into a group, then a panel change
# rewrites the live layers and leaves the copies alone.
from terrain_viewer.layers import PROP, FROZEN_PROP  # noqa: E402
live_before = {l.customProperty(PROP): l.source() for l in dock.stack.live_checked()}
group = dock.freeze()
frozen = [n.layer() for n in group.findLayers()] if group else []
print("freeze:", group.name() if group else None, len(frozen), "layers")
if not frozen or len(frozen) != len(live_before):
    failures.append("freeze: layer count")
frozen_src = {l.customProperty(FROZEN_PROP): l.source() for l in frozen}
if frozen_src != live_before:
    failures.append("freeze: sources differ from the live layers")
if any(l.customProperty(PROP) for l in frozen) or any(dock.stack.find(k) in frozen for k in live_before):
    failures.append("freeze: a copy is still tracked by the panel")
if [l.customProperty(FROZEN_PROP) for l in frozen] != [l.customProperty(PROP) for l in dock.stack.live_checked()]:
    failures.append("freeze: order")
for l in frozen:
    live = dock.stack.find(l.customProperty(FROZEN_PROP))
    if type(l) is not type(live) or not l.isValid() or l.blendMode() != live.blendMode():
        failures.append(f"freeze: {l.name()} type, validity or blending")
    if hasattr(l, "renderer") and l.renderer() and live.renderer():
        if hasattr(l.renderer(), "opacity") and round(l.renderer().opacity(), 3) != round(live.renderer().opacity(), 3):
            failures.append(f"freeze: {l.name()} opacity")
        if l.renderer().type() != live.renderer().type() if hasattr(l.renderer(), "type") else False:
            failures.append(f"freeze: {l.name()} renderer")
    print(f"  frozen {l.name():32} {type(l).__name__} valid={l.isValid()}")
kinds = {type(l).__name__ for l in frozen}
print("frozen kinds:", sorted(kinds))
if not {"QgsRasterLayer", "QgsVectorTileLayer"} <= kinds or not any(l.providerType() == "gdal" for l in frozen):
    failures.append("freeze: XYZ, vector tile and values layers expected")
dock.rows["svf"].settings["svfRadius"].set(35)
dock.rows["slope"].settings["slopeMaxDegrees"].set(60)
dock.rows["contours"].settings["contourMinor"].set(7)
dock.flush()
after = {l.customProperty(FROZEN_PROP): l.source() for l in frozen}
print("frozen unchanged after a panel change:", after == frozen_src)
if after != frozen_src:
    failures.append("freeze: a frozen source changed")
for k in ("svf", "slope", "slope:values", "contours", "contours:vector"):
    if dock.stack.find(k).source() == frozen_src.get(k):
        failures.append(f"freeze: live {k} did not change")
group2 = dock.freeze()
roots = [c.name() for c in QgsProject.instance().layerTreeRoot().children()]
print("tree roots after two freezes:", roots)
if not (group2 and roots[0] == "Terrain Viewer (live)" and group2.name().startswith("Frozen " + time.strftime("%Y-%m-%d")) and roots[1] == group2.name() and group.name() in roots[2:] and group.name() != group2.name()):
    failures.append("freeze: groups do not stack under the live one")

# 2c. A project saved before the live group was renamed: its "Terrain Viewer"
# group is adopted and renamed, the frozen groups left alone.
from terrain_viewer.layers import ROOT_PROP, ROOT_NAME  # noqa: E402
live_group = dock.stack.root(create=False)
live_group.setName("Terrain Viewer")
live_group.removeCustomProperty(ROOT_PROP)
adopted = dock.stack.root(create=False)
print("legacy group adopted:", adopted is not None and adopted.name(), adopted is live_group)
if adopted is not live_group or adopted.name() != ROOT_NAME or not adopted.customProperty(ROOT_PROP):
    failures.append("legacy live group not adopted")

# 2d. A mode's forms: Color and Values each add and remove their layer;
# the mode's box turns them on (Color the first time) and off; the cog shows
# while Color is on; a layer removed by hand unchecks its form.
row = dock.rows["curvature"]


def curvature_layers():
    return sorted(k for k in ("curvature", "curvature:values") if dock.stack.find(k) is not None)


for label, act, want in [
    ("values only", lambda: row.numbers.setChecked(True), ["curvature:values"]),
    ("+ color", lambda: row.color.setChecked(True), ["curvature", "curvature:values"]),
    ("mode off", lambda: row.check.setChecked(False), []),
    ("mode on: both back", lambda: row.check.setChecked(True), ["curvature", "curvature:values"]),
    ("color off", lambda: row.color.setChecked(False), ["curvature:values"]),
    ("values off", lambda: row.numbers.setChecked(False), []),
    ("mode on: color", lambda: row.check.setChecked(True), ["curvature"]),
]:
    act()
    got, cog = curvature_layers(), row.more.isVisibleTo(row.box)
    print(f"curvature {label:<20} -> {got}, mode {row.check.isChecked()}, cog {cog}")
    if got != want or cog != row.color.isChecked() or row.check.isChecked() != bool(want):
        failures.append(f"forms: curvature {label}: {got}, cog {cog}")
QgsProject.instance().removeMapLayer(dock.stack.find("curvature").id())
if row.check.isChecked() or row.color.isChecked():
    failures.append("forms: a layer removed by hand left its form checked")

# 2e. 0.7.0: layer cleanup, both shadows, the light, a whole-row click,
# symmetric ramps, a share link with app-only parameters.
from qgis.core import QgsLayerTreeGroup  # noqa: E402


def group_names():
    out = []

    def walk(g):
        for c in g.children():
            if isinstance(c, QgsLayerTreeGroup):
                out.append(c.name())
                walk(c)
    root = dock.stack.root(create=False)
    if root is not None:
        walk(root)
    return out


iso = dock.rows["isoline"]
iso.check.setChecked(True)
had = "Overlays" in group_names()
iso.check.setChecked(False)
contours_on = dock.rows["contours"].check.isChecked()
print("isoline group made:", had, "groups after:", group_names())
for mid in ("shadows", "buildingShadows"):
    dock.rows[mid].check.setChecked(True)
both = [dock.stack.find(k) is not None for k in ("shadows", "buildingShadows")]
print("terrain and building shadows both drawn:", both)
if not all(both):
    failures.append(f"shadows: both modes should have their layer: {both}")
dock.set_light(120, 30)
dock.flush()
light_src = dock.stack.find("shadows").source()
print("light in the shadows address:", "illuminationDir%3D120" in light_src and "illuminationAlt%3D30" in light_src)
if "illuminationDir%3D120" not in light_src:
    failures.append("light: not in the shadows layer's address")
if (dock.light_pad.azimuth, dock.light_pad.elevation) != (120, 30):
    failures.append("light: the pad does not follow the sliders")
dock.set_light(315, 45)
for mid in ("shadows", "buildingShadows"):
    dock.rows[mid].check.setChecked(False)
if "Lighting Effects" in group_names():
    failures.append("cleanup: the empty Lighting Effects group stayed")
# A copy made with Duplicate Layer carries the key: unchecking removes both.
tri = dock.rows["tri"]
tri.row._clicked()
if not tri.check.isChecked() or dock.stack.find("tri") is None:
    failures.append("row click: the mode did not turn on")
dup = dock.stack.find("tri").clone()
QgsProject.instance().addMapLayer(dup)
tri.row._clicked()
if dock.stack.find_all("tri"):
    failures.append("cleanup: a duplicated layer of an unchecked mode stayed")
lrm = dock.rows["lrm"]
lrm.settings["lrmSymmetric"].widget.setChecked(True)
lrm.settings["lrmMax"].widget.setValue(33, emit=True)
print("symmetric LRM: min", lrm.settings["lrmMin"].get(), "read only", lrm.settings["lrmMin"].widget.spin.isReadOnly())
if lrm.settings["lrmMin"].get() != -33 or not lrm.settings["lrmMin"].widget.spin.isReadOnly():
    failures.append("symmetric: the minimum does not mirror the maximum")
lrm.settings["lrmSymmetric"].widget.setChecked(False)
lrm.settings["lrmMax"].widget.setValue(20, emit=True)
lrm.settings["lrmMin"].widget.setValue(-20, emit=True)
ramp = dock.rows["slope"].settings["slopeColorRamp"].widget
print("ramp select:", ramp.count(), "ramps,", sum(1 for i in range(ramp.count()) if not ramp.itemIcon(i).isNull()), "with a preview")
if ramp.count() < 100 or ramp.itemIcon(0).isNull():
    failures.append("ramps: no previews")
matcap = dock.rows["matcap"].settings["matcapTextureId"].widget
print("matcap select:", matcap.count(), "textures, current", matcap.get())
if matcap.count() < 20 or matcap.itemIcon(0).isNull():
    failures.append("matcaps: no previews")
zermatt = ("https://terrain-viewer.iconem.com/?zoom=12.34&lat=45.8719&lng=7.8561&terrainSourceA=esri&showColorRelief=true"
           "&splitRatio=0.489&showTerrainAnalysis=true&slopeMaxDegrees=67&hillshadeOpacity=0.5")
dock.open_link(zermatt)
zs = dock.stack.find("slope").source()
print("Zermatt link: source", dock.current_source(), "| extra", dock.extra, "| splitRatio in tiles:", "splitRatio" in zs)
if dock.current_source() != "esri" or "terrainSource%3Desri" not in zs or "splitRatio" in zs:
    failures.append("link: source not esri, or app-only parameters in the tiles")
dock.open_link(link)  # back to the first link's view
dock.flush()

# 3. A saved project read back: the checkboxes come back from the layers.
path = os.path.join(out, "plugin-test.qgz")
QgsProject.instance().write(path)
QgsProject.instance().clear()
QgsProject.instance().read(path)
dock2 = TerrainViewerDock(None)
dock2.set_backend("remote", connect=False)
dock2.url.setText(base)
dock2.connect_service()
back = sorted(k for k, r in dock2.rows.items() if r.check.isChecked())
if len(QgsProject.instance().mapLayers()) != len([l for l in QgsProject.instance().mapLayers().values() if l.customProperty(PROP) or l.customProperty(FROZEN_PROP)]):
    failures.append("read back: a layer lost its property")
print("read back checked:", back, "svfRadius:", dock2.rows["svf"].settings["svfRadius"].get(), "slope values:", dock2.rows["slope"].numbers.isChecked())
print("FAILURES:", failures or "none")
app.exitQgis()
