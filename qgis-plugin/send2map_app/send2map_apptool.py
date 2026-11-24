# -*- coding: utf-8 -*-
# ******************************************************************************
#
# Send2MapApp
# ---------------------------------------------------------
# Opens the place clicked in QGIS in Google Earth and other viewers.
#
# Copyright (C) 2013-2015 Maxim Dubinin (sim@gis-lab.info), NextGIS (info@nextgis.org)
# Copyright (C) 2025-2026 Jonathan Chemla, Iconem
#
# This source is free software; you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free
# Software Foundation, either version 2 of the License, or (at your option)
# any later version.
#
# This code is distributed in the hope that it will be useful, but WITHOUT ANY
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
# FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
# details.
#
# A copy of the GNU General Public License is available on the World Wide Web
# at <http://www.gnu.org/licenses/>. You can also obtain it by writing
# to the Free Software Foundation, 51 Franklin Street, Suite 500 Boston,
# MA 02110-1335 USA.
#
# ******************************************************************************
"""The map tool (click a point, open it), the icons, and the
canvas-to-camera reading, shared by the toolbar menu and the canvas context
menu."""
import math
import os
import platform
import subprocess
import tempfile

from qgis.PyQt.QtCore import Qt, QSize, QUrl
from qgis.PyQt.QtGui import QCursor, QDesktopServices, QIcon
from qgis.core import QgsApplication, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsPointXY, QgsProject
from qgis.gui import QgsMapToolEmitPoint

from .destinations import Context

WORLD = 20037508.342789244  # half the Web Mercator world, metres
ICONS = os.path.join(os.path.dirname(__file__), "icons")
PLUGIN_ICON = os.path.join(ICONS, "send2map_app.svg")


def plugin_icon():
    return QIcon(PLUGIN_ICON)


def destination_icon(dest):
    """A destination's icon: a file of icons/, a QGIS theme icon
    ("theme:/name.svg"), or the generic globe."""
    name = dest.icon or "icon-web.svg"
    if name.startswith("theme:"):
        icon = QgsApplication.getThemeIcon(name[len("theme:"):])
        if not icon.isNull():
            return icon
        name = "icon-web.svg"
    return QIcon(os.path.join(ICONS, name))


def tool_cursor():
    """The map tool's cursor: QGIS's crosshair with an "open elsewhere"
    badge (icons/cursor_open_in.svg, hotspot at the crosshair's centre,
    9/24 of the side), scaled with the screen like QGIS's own cursors; the
    theme crosshair if the SVG cannot be drawn."""
    screen = QgsApplication.primaryScreen()
    scale = max(1.0, (screen.logicalDotsPerInch() / 96.0) if screen else 1.0)
    side = int(round(24 * scale))
    pixmap = QIcon(os.path.join(ICONS, "cursor_open_in.svg")).pixmap(QSize(side, side))
    if pixmap.isNull():
        cursors = getattr(QgsApplication, "Cursor", QgsApplication)
        return QgsApplication.getThemeCursor(getattr(cursors, "CrossHair"))
    hot = int(round(side * 9 / 24))
    return QCursor(pixmap, hot, hot)


def canvas_context(canvas, point=None):
    """The camera of `canvas` in the web app's conventions, centred on
    `point` (map coordinates) or on the canvas centre: the zoom is the one
    whose 512 px tiles have the canvas's ground resolution there, so the
    other viewer opens at the same scale; the bearing follows the canvas
    rotation (clockwise in QGIS, so the heading at the top is its opposite)."""
    ms = canvas.mapSettings()
    crs = ms.destinationCrs()
    tc = QgsProject.instance().transformContext()
    to_wgs = QgsCoordinateTransform(crs, QgsCoordinateReferenceSystem("EPSG:4326"), tc)
    to_merc = QgsCoordinateTransform(crs, QgsCoordinateReferenceSystem("EPSG:3857"), tc)
    centre = QgsPointXY(point) if point is not None else QgsPointXY(canvas.center())
    ll = to_wgs.transform(centre)
    lat = max(-85.0511, min(85.0511, ll.y()))
    res = canvas.mapUnitsPerPixel() or 1.0
    try:
        a = to_merc.transform(QgsPointXY(centre.x() - res / 2, centre.y()))
        b = to_merc.transform(QgsPointXY(centre.x() + res / 2, centre.y()))
        metres_per_px = math.hypot(b.x() - a.x(), b.y() - a.y())
        zoom = math.log2(2 * WORLD / (512 * metres_per_px)) if metres_per_px > 0 else 12.0
    except Exception:  # noqa: BLE001 - a point outside Web Mercator
        zoom = 12.0
    bounds = None
    try:
        e = to_wgs.transformBoundingBox(ms.visibleExtent())
        bounds = {"west": e.xMinimum(), "south": e.yMinimum(), "east": e.xMaximum(), "north": e.yMaximum()}
    except Exception:  # noqa: BLE001
        pass
    return Context(lat, ll.x(), max(0.0, min(22.0, zoom)), bearing=-canvas.rotation(), pitch=0.0, bounds=bounds)


GOOGLE_EARTH_EXES = [
    r"C:\Program Files\Google\Google Earth Pro\client\googleearth.exe",
    r"C:\Program Files (x86)\Google\Google Earth Pro\client\googleearth.exe",
    r"C:\Program Files\Google\Google Earth\client\googleearth.exe",
    r"C:\Program Files (x86)\Google\Google Earth\client\googleearth.exe",
]


def open_destination(dest, ctx):
    """Opens `dest` at `ctx`: a URL in the default browser, or a KML file in
    Google Earth Pro. Returns an error message, or None."""
    if not dest.is_available(ctx):
        return dest.unavailable_hint or f"{dest.label} has no data here"
    if dest.kind == "kml":
        f = tempfile.NamedTemporaryFile(prefix="qgis-", suffix=".kml", delete=False, mode="w", encoding="utf-8")
        f.write(dest.build(ctx))
        f.close()
        if platform.system() == "Windows":
            exe = next((p for p in GOOGLE_EARTH_EXES if os.path.exists(p)), None)
            if exe:
                subprocess.Popen([exe, f.name])
                return None
        elif platform.system() == "Darwin" and os.path.exists("/Applications/Google Earth Pro.app"):
            subprocess.Popen(["open", "-a", "Google Earth Pro", f.name])
            return None
        if not QDesktopServices.openUrl(QUrl.fromLocalFile(f.name)):
            return "Google Earth Pro was not found (no application opens .kml files)"
        return None
    if not QDesktopServices.openUrl(QUrl(dest.build(ctx))):
        return f"Could not open a browser for {dest.label}"
    return None


class Send2MapApptool(QgsMapToolEmitPoint):
    """Click the map: the point clicked opens in the chosen destination, at
    the canvas's scale. A QGIS point tool: its cursor while it is on, and
    its action (setAction) unchecked when another map tool is picked."""

    def __init__(self, canvas, on_click):
        super().__init__(canvas)
        self.on_click = on_click  # QgsPointXY (map coordinates) -> None
        self.setCursor(tool_cursor())
        self.canvasClicked.connect(self._clicked)

    def _clicked(self, point, button):
        if button == Qt.MouseButton.LeftButton:
            self.on_click(QgsPointXY(point))
