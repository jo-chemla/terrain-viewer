"""Headless check of a platform zip (the plugin with the tile service inside),
the way QGIS uses it:
  QT_QPA_PLATFORM=offscreen python-qgis test_bundled.py dist/terrain_viewer-<version>-windows-x64.zip
Unzips it into a temporary plugins folder (not a QGIS profile), builds the
panel with "Local bundled tile service" picked, so the service starts through
the plugin's own code; asks it for /processes and a /terrain-tiles tile;
unloads the plugin and checks the service is gone. QGIS's settings are kept
in a temporary file for the run."""
import os
import sys
import tempfile
import time
import urllib.request
import zipfile

from qgis.core import QgsApplication, QgsSettings
from qgis.PyQt.QtCore import QSettings

tmp = tempfile.mkdtemp(prefix="tv-bundled-")
app = QgsApplication([], True)
app.initQgis()
# QgsSettings in a temporary ini, never the machine's QGIS settings.
QSettings.setDefaultFormat(QSettings.Format.IniFormat)
QSettings.setPath(QSettings.Format.IniFormat, QSettings.Scope.UserScope, os.path.join(tmp, "settings"))
settings_file = QgsSettings().fileName()
assert settings_file.replace("\\", "/").startswith(tmp.replace("\\", "/")), f"settings outside the temporary folder: {settings_file}"
print("settings:", settings_file)

zip_path = os.path.abspath(sys.argv[1])
plugins = os.path.join(tmp, "plugins")
with zipfile.ZipFile(zip_path) as z:
    z.extractall(plugins)  # as QGIS's "Install from ZIP" does: no executable bits
sys.path.insert(0, plugins)

import terrain_viewer  # noqa: E402
from terrain_viewer import local_server  # noqa: E402
from terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from qgis.PyQt.QtWidgets import QMainWindow  # noqa: E402

failures = []
assert terrain_viewer.__file__.startswith(plugins), terrain_viewer.__file__
assert local_server.bundled(), "no server/ in the zip"
print("bundle:", local_server.bundle_info())


def get(url, timeout=60):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=timeout) as r:
        return r.status, r.headers.get("content-type"), r.read()


class Iface:
    def __init__(self):
        self.window = QMainWindow()

    def mainWindow(self):
        return self.window

    def addWebToolBarIcon(self, a):
        pass

    def removeWebToolBarIcon(self, a):
        pass

    def addPluginToWebMenu(self, name, a):
        pass

    def removePluginWebMenu(self, name, a):
        pass


plugin = terrain_viewer.classFactory(Iface())
plugin.initGui()
dock = TerrainViewerDock(None)
if dock.bundled is None or not dock.bundled.isChecked():
    failures.append("panel: 'Local bundled tile service' not offered or not picked by default")
t0 = time.time()
ok = dock.connect_service()
print(f"connect: {ok} in {time.time() - t0:.1f} s; status: {dock.status.text()}")
if not ok:
    failures.append("connect: " + dock.status.text())
server = local_server.instance()
base = server.url
pid = server.proc.pid if server.proc else None
if ok:
    if not base.startswith("http://127.0.0.1:"):
        failures.append(f"address {base}")
    code, ctype, body = get(f"{base}/processes")
    n = len(__import__("json").loads(body).get("processes", []))
    print(f"/processes: {code} {ctype}, {n} processes")
    if code != 200 or n < 10:
        failures.append("/processes")
    # A slope tile over the Alps, drawn by the direct engine with sharp.
    url = f"{base}/terrain-tiles/10/533/361.png?modes=slope&background=none"
    t0 = time.time()
    code, ctype, body = get(url, 90)
    print(f"tile: {code} {ctype}, {len(body)} bytes in {time.time() - t0:.1f} s")
    if code != 200 or ctype != "image/png" or body[:8] != b"\x89PNG\r\n\x1a\n" or len(body) < 2000:
        failures.append("tile")
    with open(os.path.join(tmp, "slope.png"), "wb") as f:
        f.write(body)
    print("tile written to", os.path.join(tmp, "slope.png"))
    if dock.url.text() != base or dock.url.isEnabled():
        failures.append("panel: address field")

plugin.unload()
time.sleep(1)
if server.running():
    failures.append("unload: the service is still running")
if base:
    try:
        get(f"{base}/health", 3)
        failures.append("unload: the service still answers")
    except OSError:
        print("after unload: no answer on", base, "(process", pid, "gone)")

print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
