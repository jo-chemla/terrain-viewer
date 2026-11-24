"""Headless check of the Send2MapApp plugin in QGIS (no network, no browser):
  QT_QPA_PLATFORM=offscreen python-qgis test_send2map.py
Loads the plugin with a stand-in iface, reads a canvas as a camera (zoom,
rotation, CRS), opens the toolbar, Web and right-click menus and the map tool,
with the browser replaced by a recorder, then unloads."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication, QgsCoordinateReferenceSystem, QgsPointXY, QgsRectangle, QgsSettings  # noqa: E402
from qgis.gui import QgsMapCanvas, QgsMapMouseEvent, QgsMapToolPan  # noqa: E402
from qgis.PyQt.QtCore import QEvent, QPoint, Qt  # noqa: E402
from qgis.PyQt.QtWidgets import QAction, QMainWindow, QMenu  # noqa: E402

app = QgsApplication([], True)
app.initQgis()
failures = []

import send2map_app  # noqa: E402
from send2map_app import send2map_apptool  # noqa: E402
from send2map_app.destinations import DESTINATIONS  # noqa: E402

opened = []


class Recorder:
    @staticmethod
    def openUrl(url):
        opened.append(url.toString())
        return True


send2map_apptool.QDesktopServices = Recorder


class Bar:
    def __init__(self):
        self.messages = []

    def pushMessage(self, *a):
        self.messages.append(a)


class Iface:
    def __init__(self):
        self.window = QMainWindow()
        self.canvas = QgsMapCanvas()
        self.canvas.resize(1000, 600)
        self.canvas.show()  # the map settings take the widget's size on show
        QgsApplication.processEvents()
        self.bar = Bar()
        self.toolbar, self.web = [], []

    def mainWindow(self):
        return self.window

    def mapCanvas(self):
        return self.canvas

    def messageBar(self):
        return self.bar

    def addWebToolBarWidget(self, w):
        a = QAction(self.window)
        self.toolbar.append((a, w))
        return a

    def removeWebToolBarIcon(self, a):
        self.toolbar = [t for t in self.toolbar if t[0] is not a]

    def addPluginToWebMenu(self, name, a):
        self.web.append(a)

    def removePluginWebMenu(self, name, a):
        self.web.remove(a)


iface = Iface()
canvas = iface.canvas
QgsSettings().remove("plugins/send2map_app/destination")
QgsSettings().setValue("send2map_app/destination", "esri-wayback")  # 0.4.0's key, read when the new one is unset
plugin = send2map_app.classFactory(iface)
plugin.initGui()
if plugin.selected().id != "esri-wayback":
    failures.append("0.4.0's remembered destination not read")
QgsSettings().remove("send2map_app/destination")

# Icons: the plugin's SVG, one per destination (files and QGIS theme icons).
from send2map_app.send2map_apptool import destination_icon, plugin_icon  # noqa: E402
blank = [d.id for d in DESTINATIONS if destination_icon(d).pixmap(16, 16).isNull()]
print("icons: plugin", not plugin_icon().pixmap(24, 24).isNull(), "destinations without one:", blank or "none")
if plugin_icon().pixmap(24, 24).isNull() or blank or plugin.tool_action.icon().isNull():
    failures.append("icons")

# A Web Mercator view of Ardèche at the app's zoom 11.32 (512 px tiles).
WORLD = send2map_apptool.WORLD
lat, lng, zoom = 44.5061, 4.0005, 11.32
x = lng * WORLD / 180
y = math.log(math.tan((90 + lat) * math.pi / 360)) * WORLD / math.pi
per_px = 2 * WORLD / (512 * 2 ** zoom)
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
canvas.setExtent(QgsRectangle(x - 500 * per_px, y - 300 * per_px, x + 500 * per_px, y + 300 * per_px))
canvas.refresh()
ctx = send2map_apptool.canvas_context(canvas)
print("canvas size:", canvas.mapSettings().outputSize())
print("3857 view:", round(ctx.lat, 4), round(ctx.lng, 4), "zoom", round(ctx.zoom, 3), "bearing", ctx.bearing, "bounds", ctx.bounds and {k: round(v, 3) for k, v in ctx.bounds.items()})
if abs(ctx.lat - lat) > 1e-3 or abs(ctx.lng - lng) > 1e-3 or abs(ctx.zoom - zoom) > 0.02:
    failures.append("canvas_context: 3857 camera")

# The same place in WGS84 and rotated 30 degrees clockwise: the zoom holds,
# the heading at the top is 330.
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:4326"))
deg_per_px = per_px * 180 / WORLD  # a degree of longitude is WORLD / 180 Mercator metres
canvas.setExtent(QgsRectangle(lng - 500 * deg_per_px, lat - 300 * deg_per_px, lng + 500 * deg_per_px, lat + 300 * deg_per_px))
canvas.setRotation(30)
canvas.refresh()
ctx = send2map_apptool.canvas_context(canvas)
print("4326 rotated view:", round(ctx.lat, 4), round(ctx.lng, 4), "zoom", round(ctx.zoom, 3), "bearing", round(ctx.bearing, 3))
if abs(ctx.lat - lat) > 1e-3 or abs(ctx.zoom - zoom) > 0.05 or abs(ctx.bearing - 330) > 1e-6:
    failures.append("canvas_context: 4326 rotated camera")
canvas.setRotation(0)
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
canvas.setExtent(QgsRectangle(x - 500 * per_px, y - 300 * per_px, x + 500 * per_px, y + 300 * per_px))
canvas.refresh()

# The toolbar button and its menu: every destination, picking one opens the
# view and remembers it.
(button_action, button), = iface.toolbar
labels = [a.text() for a in plugin.menu.actions() if a.isCheckable() and a is not plugin.tool_action]
print("toolbar menu:", len(labels), "destinations")
if labels != [d.label for d in DESTINATIONS]:
    failures.append("toolbar menu: destinations")
plugin.menu.aboutToShow.emit()
lidar = plugin.choices["lidarlens"]
if lidar.isEnabled():
    failures.append("LiDAR Lens enabled outside Britain")
plugin.choices["bing-maps-3d"].trigger()
print("picked Bing:", opened[-1] if opened else None)
if not opened or not opened[-1].startswith("https://www.bing.com/maps?cp=44.506") or QgsSettings().value("plugins/send2map_app/destination") != "bing-maps-3d":
    failures.append("toolbar menu: Bing not opened or not remembered")
if "Bing Maps 3D" not in plugin.tool_action.text():
    failures.append("map tool action does not name the remembered destination")

# The map tool: a click opens the point clicked in the remembered destination.
button.defaultAction().trigger()
if canvas.mapTool() is not plugin.tool:
    failures.append("map tool not set by the button")
if not plugin.tool_action.isChecked():
    failures.append("map tool action not checked while on")
cur = canvas.cursor()  # the tool's, set on the canvas while it is on
print("cursor:", cur.shape(), cur.pixmap().size(), cur.hotSpot())
if cur.shape() != Qt.CursorShape.BitmapCursor or cur.pixmap().isNull():
    failures.append("map tool cursor")
n = len(opened)
pt = QPoint(250, 150)
press = QgsMapMouseEvent(canvas, QEvent.Type.MouseButtonPress, pt, Qt.MouseButton.LeftButton)
plugin.tool.canvasPressEvent(press)
right = QgsMapMouseEvent(canvas, QEvent.Type.MouseButtonPress, pt, Qt.MouseButton.RightButton)
plugin.tool.canvasPressEvent(right)
if len(opened) != n + 1:
    failures.append(f"map tool: {len(opened) - n} opens for a left and a right click (1 expected)")
clicked = canvas.getCoordinateTransform().toMapCoordinates(250, 150)
print("map tool click:", opened[-1] if len(opened) > n else None)
want_lng = clicked.x() * 180 / WORLD
got_lng = float(opened[-1].split("~")[1].split("&")[0]) if len(opened) > n else None
if got_lng is None or abs(got_lng - want_lng) > 1e-6:
    failures.append("map tool: clicked point not opened")

# Another map tool picked (Pan): the button unchecks itself.
pan = QgsMapToolPan(canvas)
canvas.setMapTool(pan)
print("after Pan: tool action checked:", plugin.tool_action.isChecked())
if plugin.tool_action.isChecked():
    failures.append("map tool action still checked after another tool was picked")
plugin.tool_action.trigger()
if canvas.mapTool() is not plugin.tool or not plugin.tool_action.isChecked():
    failures.append("map tool not back on")
plugin.tool_action.trigger()
if canvas.mapTool() is plugin.tool:
    failures.append("map tool not off when its button is unchecked")

# The right-click menu at a point in Stonehenge: LiDAR Lens enabled there.
sx, sy = -1.82622 * WORLD / 180, math.log(math.tan((90 + 51.17886) * math.pi / 360)) * WORLD / math.pi
canvas.setExtent(QgsRectangle(sx - 500 * per_px, sy - 300 * per_px, sx + 500 * per_px, sy + 300 * per_px))
canvas.refresh()
menu = QMenu()
event = QgsMapMouseEvent(canvas, QEvent.Type.MouseButtonRelease, QPoint(500, 300), Qt.MouseButton.RightButton)
canvas.contextMenuAboutToShow.emit(menu, event)
sub = next((a.menu() for a in menu.actions() if a.menu() and a.text() == "Open in"), None)
items = {a.text(): a for a in sub.actions()} if sub else {}
print("context menu:", len(items), "entries, LiDAR Lens enabled:", items.get("LiDAR Lens (Britain and Ireland)") and items["LiDAR Lens (Britain and Ireland)"].isEnabled())
if len(items) != len(DESTINATIONS) or not items["LiDAR Lens (Britain and Ireland)"].isEnabled():
    failures.append("context menu")
items["LiDAR Lens (Britain and Ireland)"].trigger()
items["Terrain Viewer"].trigger()
print("context menu opened:", opened[-2:])
if not opened[-2].startswith("https://lidarlens.sarsen.org/#map=") or "51.1" not in opened[-2]:
    failures.append("context menu: LiDAR Lens")
if not opened[-1].startswith("https://terrain-viewer.iconem.com/?lat=51.17") or "&zoom=11.3" not in opened[-1]:
    failures.append("context menu: Terrain Viewer")

# Web menu.
if len(iface.web) != 2 or iface.web[0].menu() is None or len(iface.web[0].menu().actions()) != len(DESTINATIONS):
    failures.append("Web menu")

# Unload leaves nothing behind.
tool = plugin.tool
plugin.unload()
if iface.toolbar or iface.web or canvas.mapTool() is tool:
    failures.append("unload")
print("FAILURES:", failures or "none")
app.exitQgis()
sys.exit(1 if failures else 0)
