"""Headless check of the ways the plugin reaches a tile service, the way
QGIS uses it, from a temporary plugins folder (never a QGIS profile):

  QT_QPA_PLATFORM=offscreen python-qgis test_service_paths.py installed dist/terrain_viewer-<v>.zip [dist/terrain-viewer-tile-service-windows-x64.zip]
  QT_QPA_PLATFORM=offscreen python-qgis test_service_paths.py external  dist/terrain_viewer-<v>.zip http://localhost:3431 [--stop "<command>"]

installed: the panel's "Install local tile service": with a bundle given, it
is served from this machine and pinned into the unzipped plugin (its sha256);
without, the plugin's own pins are used, i.e. the real download from the
GitHub release. A download whose sha256 differs from the pin must be
refused. Installed, the box must be off by default and the panel opening
must not start it; checked, Connect starts it. Remove deletes it.
external: the address given (the desktop app's tile service, or any other).
--stop runs a command that takes that service away (e.g. closing the
desktop app), to see the panel notice it while connected.

Each run: Connect, the processes listed, a slope layer added through the
panel (its address read back from the QGIS layer), one of its tiles
fetched; then the unresponsive paths: Connect to a dead local address (the
warning names the desktop app, and the local service), and the service going
away while connected (the background /health check warns, in the panel and
in the message bar). QGIS's settings are kept in a temporary file for the
run, the downloaded service in a temporary folder (TV_SERVICE_HOME)."""
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
bundle_zip = os.path.abspath(args[2]) if mode == "installed" and len(args) > 2 else None
assert mode in ("installed", "external"), mode

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
os.environ["TV_SERVICE_HOME"] = os.path.join(tmp, "service-home")
pins_path = os.path.join(plugins, "terrain_viewer", "service_pins.json")
if bundle_zip:
    # The bundle served from here, and pinned into the unzipped plugin.
    import hashlib
    import threading
    from functools import partial
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=os.path.dirname(bundle_zip)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    data = open(bundle_zip, "rb").read()
    plat = json.loads(zipfile.ZipFile(bundle_zip).read("bundle.json"))["platform"]
    with open(pins_path, "w", encoding="utf-8") as f:
        json.dump({"release": "test-release", "base": f"http://127.0.0.1:{httpd.server_address[1]}",
                   "assets": {plat: {"file": os.path.basename(bundle_zip), "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}}}, f)
print("pins:", open(pins_path, encoding="utf-8").read().strip()[:400])

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
check(not local_server.bundled(), "a fresh plugin has no tile service yet")
offered = local_server.installable()
print("plugin: plain;", f"a service pinned for {local_server.platform_label()}" if offered else "no service pinned for this platform")

# The panel as the toolbar button opens it: it connects to the saved address
# and must not start the bundled service.
if external:
    QgsSettings().setValue("terrain_viewer/service", external)
# 0.7.0: a backend picked at the top of the panel; the remote one first.
QgsSettings().setValue("terrain_viewer/backend", "remote" if external else "local")
plugin.action.setChecked(True)
dock = plugin.dock
check(not local_server.instance().running(), "the panel opening starts no service")
if offered:
    check(dock.install_btn.text().startswith("Install"), f"the local page offers Install: [{dock.install_btn.text()}]")
has_bundle = False
if mode == "installed":
    from terrain_viewer import service_install  # noqa: E402
    # A download that is not what the plugin pins is refused.
    bad = local_server.pins()
    bad["assets"][local_server.platform_label()]["sha256"] = "0" * 64
    try:
        service_install.install(p=bad)
        check(False, "a download with another sha256 is refused")
    except service_install.InstallError as e:
        check("sha256" in str(e) and not local_server.bundled(), f"a download with another sha256 is refused ({str(e)[:90]}...)")
    t0 = time.time()
    ok = dock.install_service(wait=True)
    print(f"install: {ok} in {time.time() - t0:.1f} s; status: {dock.status.text()}")
    where = local_server.current_dir() or ""
    check(ok and local_server.bundled() and where.startswith(os.environ["TV_SERVICE_HOME"]), f"installed into the plugin's data folder ({where})")
    check(dock.install_btn.text() == "Remove", "the button now removes it")
    has_bundle = True
    print("bundle:", json.dumps(local_server.bundle_info()))
    check(not local_server.instance().running(), "installing does not start it")
    dock.set_backend("local", connect=False)
    print("  status:", dock.status.text())

t0 = time.time()
ok = dock.connect_service()
base = dock.service_url()
print(f"connect: {ok} in {time.time() - t0:.1f} s, {base}; status: {dock.status.text()}")
check(ok, "Connect")
if mode == "installed":
    check(local_server.instance().running() and base.startswith("http://127.0.0.1:"), "Connect started the local service on 127.0.0.1")
if ok:
    code, ctype, _, body = get(f"{base}/processes")
    procs = [p["id"] for p in json.loads(body).get("processes", [])]
    print(f"/processes: {code}, {len(procs)}: {', '.join(procs[:12])}...")
    check(code == 200 and "slope" in procs, "processes listed, slope among them")
    check(len(dock.rows) >= 10 and "slope" in dock.rows, f"panel built ({len(dock.rows)} modes)")
    # The browser engine is not in the bundles: a tilted view is a 501.
    if mode == "installed":
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
dock.set_backend("remote", connect=False)
dead = "http://localhost:3499"
dock.url.setText(dead)
n = len(iface.bar.messages)
check(not dock.connect_service(), f"Connect to {dead} fails")
said = dock.status.text()
print("  status:", said)
check("does not answer" in said and "desktop app" in said, "the warning names the desktop app's tile service")
if offered:
    check("Local service" in said, "and the local service")
check(len(iface.bar.messages) > n, "the warning went to the message bar too")
# A remote address: no desktop app suggested.
dock.url.setText("http://tv-unreachable.invalid:3400")
dock.connect_service()
check("desktop app" not in dock.status.text(), "a remote address does not suggest the desktop app")

# Unresponsive, while connected: the service goes away.
if mode == "installed":
    dock.set_backend("local", connect=False)
    check(dock.connect_service(), "Connect again (local service)")
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
    if mode == "installed":
        check("Connect" in dock.status.text(), "and says Connect starts it again")
        # Remove: stopped and deleted.
        dock.install_clicked()
        check(not local_server.bundled() and not os.path.exists(os.environ["TV_SERVICE_HOME"]) and dock.install_btn.text().startswith("Install"),
              "Remove deletes the downloaded service")

plugin.unload()
time.sleep(1)
if has_bundle:
    check(not local_server.instance().running(), "unload: no local service left")

print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
