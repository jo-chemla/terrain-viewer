import os

from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QAction

from .dock import TerrainViewerDock
from . import local_server


class TerrainViewerPlugin:
    def __init__(self, iface):
        self.iface = iface
        self.dock = None
        self.action = None
        self.historical_action = None

    def initGui(self):
        icon = QIcon(os.path.join(os.path.dirname(__file__), "icon.svg"))
        self.action = QAction(icon, "Terrain Viewer", self.iface.mainWindow())
        self.action.setCheckable(True)
        self.action.toggled.connect(self.toggle)
        self.iface.addWebToolBarIcon(self.action)
        self.iface.addPluginToWebMenu("Terrain Viewer", self.action)
        # A second button, straight to the panel's Historical mode.
        clock = QIcon(os.path.join(os.path.dirname(__file__), "clock.svg"))
        self.historical_action = QAction(clock, "Terrain Viewer: historical imagery", self.iface.mainWindow())
        self.historical_action.setObjectName("terrainViewerHistorical")
        self.historical_action.setToolTip("Historical imagery: the Terrain Viewer panel in its Historical mode (dated "
                                          "imagery on QGIS's Temporal Controller)")
        self.historical_action.triggered.connect(lambda _checked=False: self.open_mode("historical"))
        self.iface.addWebToolBarIcon(self.historical_action)
        self.iface.addPluginToWebMenu("Terrain Viewer", self.historical_action)

    def unload(self):
        # The local tile service, if this session started it (QGIS calls
        # unload when it quits, and when the plugin is disabled or updated).
        local_server.stop_instance()
        # The local compute's server thread, if it ran (live/ is only
        # imported when its box was checked).
        import sys
        live = sys.modules.get(__package__ + ".live.server")
        if live is not None:
            live.LiveServer.shutdown()
        if self.dock:
            self.dock.cleanup()
            self.iface.removeDockWidget(self.dock)
            self.dock.deleteLater()
            self.dock = None
        for name in ("action", "historical_action"):
            action = getattr(self, name)
            if action:
                self.iface.removePluginWebMenu("Terrain Viewer", action)
                self.iface.removeWebToolBarIcon(action)
                setattr(self, name, None)

    def open_mode(self, mode):
        """The panel shown in one of the app's modes ("terrain",
        "historical"): opened if it was not, raised if it was behind
        another panel."""
        if self.dock is None or not self.dock.isVisible():
            self.action.setChecked(True)  # toggle(True): makes the dock, shows it
            if self.dock is not None and not self.dock.isVisible():
                self.dock.setVisible(True)
        if self.dock is not None:
            self.dock.set_mode(mode)
            self.dock.raise_()

    def toggle(self, on):
        if self.dock is None:
            bridge = self.iface.layerTreeCanvasBridge() if hasattr(self.iface, "layerTreeCanvasBridge") else None
            self.dock = TerrainViewerDock(self.iface.mapCanvas(), self.iface.mainWindow(), self.iface.messageBar(), bridge)
            self.iface.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, self.dock)
            self.dock.visibilityChanged.connect(self.action.setChecked)
            # The panel opening connects to the address (or starts the Python
            # backend), but never starts the packaged tile server: only
            # Connect does.
            self.dock.connect_service(start_bundled=False)
        self.dock.setVisible(on)
