"""Headless check of the three ways the plugin reaches a tile service, the way
QGIS uses it, from a temporary plugins folder (never a QGIS profile):

  QT_QPA_PLATFORM=offscreen python-qgis test_service_paths.py bundled  dist/terrain_viewer-<v>-windows-x64.zip
  QT_QPA_PLATFORM=offscreen python-qgis test_service_paths.py external dist/terrain_viewer-<v>.zip http://localhost:3431 [--stop "<command>"]

bundled: the platform zip's own service. The box must be off by default and
the panel opening must not start it; checked, Connect starts it.
external: the address given (the desktop app's tile service, or any other).
--stop runs a command that takes that service away (e.g. closing the
desktop app), to see the panel notice it while connected.

Each run: Connect, the processes listed, a slope layer added through the
panel (its address read back from the QGIS layer), one of its tiles
fetched; then the unresponsive paths: Connect to a dead local address (the
warning names the desktop app, and the bundled service when the zip has
one), and the service going away while connected (the background /health
check warns, in the panel and in the message bar). QGIS's settings are kept
in a temporary file for the run."""
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

from qgis.core import QgsApplication, QgsSettings, QgsProject, QgsDataSourceUri
from qgis.PyQt.QtCore import QSettings, QEventLoop, QTimer

args = sys.argv[1:]
stop_cmd = None
if "--stop" in args:
    i = args.index("--stop")
    stop_cmd = args[i + 1]
    del args[i:i + 2]
mode, zip_path = args[0], os.path.abspath(args[1])
external = args[2].rstrip("/") if mode == "external" else None
assert mode in ("bundled", "external"), mode

tmp = tempfile.mkdtemp(prefix="tv-paths-")
app = QgsApplication([], True)
app.initQgis()
QSettings.setDefaultFormat(QSettings.Format.IniFormat)
QSettings.setPath(QSettings.Format.IniFormat, QSettings.Scope.UserScope, os.path.join(tmp, "settings"))
settings_file = QgsSettings().fileName()
assert settings_file.replace("\\", "/").startswith(tmp.replace("\\", "/")), f"settings outside the temporary folder: {settings_file}"
print("QGIS", __import__("qgis.core", fromlist=["Qgis"]).Qgis.version(), "| settings:", settings_file)

plugins = os.path.join(tmp, "plugins")
with zipfile.ZipFile(zip_path) as z:
    z.extractall(plugins)  # as QGIS's "Install from ZIP" does: no executable bits
sys.path.insert(0, plugins)

import terrain_viewer  # noqa: E402
from terrain_viewer import local_server  # noqa: E402
from terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from qgis.PyQt.QtWidgets import QMainWindow  # noqa: E402

failures = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        failures.append(what)


def get(url, timeout=90):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=timeout) as r:
        return r.status, r.headers.get("content-type"), r.headers.get("x-tv-engine"), r.read()


def wait(ms):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


class MessageBar:
    def __init__(self):
        self.messages = []

    def pushMessage(self, title, text, level=None, duration=None):
        self.messages.append(text)


class Iface:
    def __init__(self):
        self.window, self.bar = QMainWindow(), MessageBar()

    def mainWindow(self):
        return self.window

    def mapCanvas(self):
        return None

    def messageBar(self):
        return self.bar

    def addWebToolBarIcon(self, a):
        pass

    def removeWebToolBarIcon(self, a):
        pass

    def addPluginToWebMenu(self, name, a):
        pass

    def removePluginWebMenu(self, name, a):
        pass

    def addDockWidget(self, area, dock):
        pass

    def removeDockWidget(self, dock):
        pass


iface = Iface()
plugin = terrain_viewer.classFactory(iface)
plugin.initGui()
has_bundle = local_server.bundled()
print("plugin:", "bundled " + json.dumps(local_server.bundle_info()) if has_bundle else "plain (no bundled service)")

# The panel as the toolbar button opens it: it connects to the saved address
# and must not start the bundled service.
if external:
    QgsSettings().setValue("terrain_viewer/service", external)
plugin.action.setChecked(True)
dock = plugin.dock
if has_bundle:
    check(dock.bundled is not None and not dock.bundled.isChecked(), "bundled box offered, off by default")
    check(not local_server.instance().running(), "the panel opening did not start the bundled service")
else:
    check(dock.bundled is None, "plain zip: no bundled box")

if mode == "bundled":
    dock.bundled.setChecked(True)
    check(not local_server.instance().running(), "checking the box alone does not start it")
    print("  status:", dock.status.text())

t0 = time.time()
ok = dock.connect_service()
base = dock.service_url()
print(f"connect: {ok} in {time.time() - t0:.1f} s, {base}; status: {dock.status.text()}")
check(ok, "Connect")
if mode == "bundled":
    check(local_server.instance().running() and base.startswith("http://127.0.0.1:"), "Connect started the bundled service on 127.0.0.1")
if ok:
    code, ctype, _, body = get(f"{base}/processes")
    procs = [p["id"] for p in json.loads(body).get("processes", [])]
    print(f"/processes: {code}, {len(procs)}: {', '.join(procs[:12])}...")
    check(code == 200 and "slope" in procs, "processes listed, slope among them")
    check(len(dock.rows) >= 10 and "slope" in dock.rows, f"panel built ({len(dock.rows)} modes)")
    # The browser engine is not in the bundled copies: a tilted view is a 501.
    if mode == "bundled":
        try:
            get(f"{base}/render.png?lat=45.9&lng=7&zoom=12&pitch=60&modes=slope&width=64&height=64", 30)
            check(False, "a tilted view answers 501 (no browser engine)")
        except urllib.error.HTTPError as e:
            check(e.code == 501, f"a tilted view answers {e.code} (no browser engine): {e.read()[:120]!r}")

    # A slope layer through the panel.
    row = dock.rows["slope"]
    row.check.setChecked(True)
    dock.flush()
    layer = dock.stack.find("slope")
    check(layer is not None and layer.isValid(), "slope layer added to the project")
    if layer is not None:
        uri = QgsDataSourceUri()
        uri.setEncodedUri(layer.source())
        template = uri.param("url")
        print("layer:", layer.name(), template)
        url = template.replace("{z}", "10").replace("{x}", "533").replace("{y}", "361")
        t0 = time.time()
        code, ctype, engine, body = get(url, 120)
        print(f"tile: {code} {ctype} {len(body)} bytes, engine {engine}, {time.time() - t0:.1f} s")
        check(code == 200 and ctype == "image/png" and body[:4] == b"\x89PNG" and len(body) > 2000, "slope tile from the layer's address")
        with open(os.path.join(tmp, f"slope-{mode}.png"), "wb") as f:
            f.write(body)
        print("  written to", os.path.join(tmp, f"slope-{mode}.png"))

# Unresponsive, at Connect: a local address where nothing listens.
saved_bundled = has_bundle and dock.bundled.isChecked()
if has_bundle:
    dock.bundled.setChecked(False)
dead = "http://localhost:3499"
dock.url.setText(dead)
n = len(iface.bar.messages)
check(not dock.connect_service(), f"Connect to {dead} fails")
said = dock.status.text()
print("  status:", said)
check("does not answer" in said and "desktop app" in said, "the warning names the desktop app's tile service")
if has_bundle:
    check("Local bundled tile service" in said, "and the bundled service")
check(len(iface.bar.messages) > n, "the warning went to the message bar too")
# A remote address: no desktop app suggested.
dock.url.setText("http://tv-unreachable.invalid:3400")
dock.connect_service()
check("desktop app" not in dock.status.text(), "a remote address does not suggest the desktop app")

# Unresponsive, while connected: the service goes away.
if mode == "bundled":
    dock.bundled.setChecked(True)
    check(dock.connect_service(), "Connect again (bundled)")
    proc = local_server.instance().proc
    proc.kill()
    proc.wait(5)
    went = True
elif stop_cmd:
    dock.url.setText(external)
    check(dock.connect_service(), "Connect again")
    print("  running:", stop_cmd)
    subprocess.run(stop_cmd if os.name == "nt" else shlex.split(stop_cmd), shell=os.name == "nt", check=False)
    time.sleep(2)
    went = True
else:
    went = False
if went:
    n = len(iface.bar.messages)
    dock.check_health()
    for _ in range(40):
        wait(250)
        if dock.service_down:
            break
    print("  status:", dock.status.text())
    check(dock.service_down and "does not answer" in dock.status.text(), "the background health check warns that the service went away")
    check(len(iface.bar.messages) > n, "in the message bar too")
    if mode == "bundled":
        check("Connect" in dock.status.text(), "and says Connect starts it again")

plugin.unload()
time.sleep(1)
if has_bundle:
    check(not local_server.instance().running(), "unload: no bundled service left")

print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
