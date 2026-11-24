# -*- coding: utf-8 -*-
# ******************************************************************************
#
# Send2MapApp
# ---------------------------------------------------------
# Opens the place clicked in QGIS in Google Earth and other viewers.
#
# Copyright (C) 2013 Maxim Dubinin (sim@gis-lab.info), NextGIS (info@nextgis.org)
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
"""Three ways in, one list of destinations:
- the button on the Web toolbar: its menu opens the current view in the
  destination picked (and remembers it, in QgsSettings); the button itself
  turns on a map tool, like Identify, that opens the point clicked in the
  remembered destination, until another map tool is picked;
- the map canvas's right-click menu: "Open in" at the point clicked;
- Web > Send2MapApp: the same list, for the current view, and the map tool."""
from qgis.PyQt.QtWidgets import QAction, QMenu, QToolButton
try:  # Qt 6 moved it to QtGui
    from qgis.PyQt.QtGui import QActionGroup
except ImportError:
    from qgis.PyQt.QtWidgets import QActionGroup
from qgis.core import Qgis, QgsSettings

from .destinations import BY_ID, DEFAULT_ID, DESTINATIONS
from .send2map_apptool import Send2MapApptool, canvas_context, destination_icon as _icon, open_destination, plugin_icon

MENU = "Send2MapApp"
# QGIS keeps a plugin's settings under plugins/<name>/; 0.4.0 wrote the
# destination at send2map_app/destination, still read when the new key is unset.
SETTING = "plugins/send2map_app/destination"
OLD_SETTING = "send2map_app/destination"
WARNING = getattr(getattr(Qgis, "MessageLevel", Qgis), "Warning")


class Send2MapApp:
    def __init__(self, iface):
        self.iface = iface
        self.canvas = iface.mapCanvas()
        self.tool = None
        self.tool_action = None
        self.button = None
        self.button_action = None
        self.menu = None
        self.web_menu = None
        self.web_menu_action = None
        self.choices = {}

    # -- the remembered destination ---------------------------------------
    def selected(self):
        s = QgsSettings()
        return BY_ID.get(s.value(SETTING) or s.value(OLD_SETTING) or DEFAULT_ID) or BY_ID[DEFAULT_ID]

    def select(self, dest):
        QgsSettings().setValue(SETTING, dest.id)
        self.choices[dest.id].setChecked(True)
        self.tool_action.setText(f"Open the Point Clicked in {dest.label}")
        self.tool_action.setToolTip(f"Send2MapApp: click the map to open the point in {dest.label}<br>"
                                    "The arrow beside the button opens the current view in another viewer")
        self.tool_action.setStatusTip(f"Click the map to open the point in {dest.label}")

    # -- GUI ----------------------------------------------------------------
    def initGui(self):
        main = self.iface.mainWindow()
        self.tool = Send2MapApptool(self.canvas, self.open_point)

        self.tool_action = QAction(plugin_icon(), "Send2MapApp", main)
        self.tool_action.setObjectName("mActionSend2MapAppTool")
        self.tool_action.setCheckable(True)
        self.tool_action.triggered.connect(self.toggle_tool)
        self.tool.setAction(self.tool_action)

        # The dropdown: each destination opens the current view at once.
        self.menu = QMenu(main)
        self.menu.setToolTipsVisible(True)
        title = self.menu.addAction("Open the current view in:")
        title.setEnabled(False)
        group = QActionGroup(self.menu)
        group.setExclusive(True)
        for dest in DESTINATIONS:
            a = QAction(_icon(dest), dest.label, self.menu)
            a.setCheckable(True)
            a.setActionGroup(group)
            a.triggered.connect(lambda _=False, d=dest: self.open_view(d, remember=True))
            self.menu.addAction(a)
            self.choices[dest.id] = a
        self.menu.addSeparator()
        self.menu.addAction(self.tool_action)
        self.menu.aboutToShow.connect(self.grey_unavailable)

        self.button = QToolButton(main)
        self.button.setObjectName("Send2MapAppButton")
        self.button.setMenu(self.menu)
        self.button.setDefaultAction(self.tool_action)
        self.button.setPopupMode(QToolButton.ToolButtonPopupMode.MenuButtonPopup)
        self.button_action = self.iface.addWebToolBarWidget(self.button)

        # Web > Send2MapApp > Open the current view in ...
        self.web_menu = QMenu("Open the current view in", main)
        for dest in DESTINATIONS:
            a = self.web_menu.addAction(_icon(dest), dest.label)
            a.triggered.connect(lambda _=False, d=dest: self.open_view(d))
        self.web_menu.aboutToShow.connect(lambda: self._grey(self.web_menu.actions(), canvas_context(self.canvas)))
        self.web_menu_action = self.web_menu.menuAction()
        self.web_menu_action.setIcon(plugin_icon())
        self.iface.addPluginToWebMenu(MENU, self.web_menu_action)
        self.iface.addPluginToWebMenu(MENU, self.tool_action)

        # The canvas's right-click menu.
        self.canvas.contextMenuAboutToShow.connect(self.canvas_menu)

        self.select(self.selected())

    def unload(self):
        try:
            self.canvas.contextMenuAboutToShow.disconnect(self.canvas_menu)
        except (TypeError, RuntimeError):
            pass
        if self.tool is not None and self.canvas.mapTool() == self.tool:
            self.canvas.unsetMapTool(self.tool)
        if self.web_menu_action is not None:
            self.iface.removePluginWebMenu(MENU, self.web_menu_action)
            self.iface.removePluginWebMenu(MENU, self.tool_action)
        if self.button_action is not None:
            self.iface.removeWebToolBarIcon(self.button_action)
        self.tool = None
        self.button_action = self.web_menu_action = None

    # -- actions ------------------------------------------------------------
    def toggle_tool(self, on):
        if on:
            self.canvas.setMapTool(self.tool)
        elif self.canvas.mapTool() == self.tool:
            self.canvas.unsetMapTool(self.tool)

    def _open(self, dest, ctx):
        error = open_destination(dest, ctx)
        if error:
            self.iface.messageBar().pushMessage(MENU, error, WARNING, 5)

    def open_view(self, dest, remember=False):
        if remember:
            self.select(dest)
        self._open(dest, canvas_context(self.canvas))

    def open_point(self, point):
        self._open(self.selected(), canvas_context(self.canvas, point))

    def _grey(self, actions, ctx):
        labels = {d.label: d for d in DESTINATIONS}
        for a in actions:
            d = labels.get(a.text())
            if d is not None:
                ok = d.is_available(ctx)
                a.setEnabled(ok)
                a.setToolTip("" if ok else (d.unavailable_hint or ""))

    def grey_unavailable(self):
        self._grey(self.menu.actions(), canvas_context(self.canvas))

    def canvas_menu(self, menu, event):
        point = event.mapPoint()
        ctx = canvas_context(self.canvas, point)
        sub = menu.addMenu(plugin_icon(), "Open in")
        sub.setToolTipsVisible(True)
        for dest in DESTINATIONS:
            a = sub.addAction(_icon(dest), dest.label)
            a.triggered.connect(lambda _=False, d=dest, p=point: self._open(d, canvas_context(self.canvas, p)))
        self._grey(sub.actions(), ctx)
