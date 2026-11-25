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

    def initGui(self):
        icon = QIcon(os.path.join(os.path.dirname(__file__), "icon.svg"))
        self.action = QAction(icon, "Terrain Viewer", self.iface.mainWindow())
        self.action.setCheckable(True)
        self.action.toggled.connect(self.toggle)
        self.iface.addWebToolBarIcon(self.action)
        self.iface.addPluginToWebMenu("Terrain Viewer", self.action)

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
        if self.action:
            self.iface.removePluginWebMenu("Terrain Viewer", self.action)
            self.iface.removeWebToolBarIcon(self.action)
            self.action = None

    def toggle(self, on):
        if self.dock is None:
            self.dock = TerrainViewerDock(self.iface.mapCanvas(), self.iface.mainWindow(), self.iface.messageBar())
            self.iface.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, self.dock)
            self.dock.visibilityChanged.connect(self.action.setChecked)
            # The panel opening connects to the address, but never starts the
            # local service: only Connect does.
            self.dock.connect_service(start_bundled=False)
        self.dock.setVisible(on)
