"""A platform zip's tile service started as the plugin starts it, without
QGIS (for the build machines of .github/workflows/qgis-plugins.yml):
  python smoke_bundled.py dist/terrain_viewer-<version>-<platform>.zip
Unzips it into a temporary folder the way QGIS's installer does (no
executable bits), loads terrain_viewer/local_server.py alone (the package
itself imports QGIS), starts the service, asks /processes and a /terrain-tiles
tile drawn with sharp, stops it and checks it is gone. test_bundled.py is the
same check through the panel, in QGIS."""
import importlib.util
import json
import os
import sys
import tempfile
import time
import urllib.request
import zipfile

tmp = tempfile.mkdtemp(prefix="tv-smoke-")
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall(tmp)
spec = importlib.util.spec_from_file_location("local_server", os.path.join(tmp, "terrain_viewer", "local_server.py"))
local_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local_server)

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
failures = []
print("bundle:", local_server.bundle_info())
server = local_server.LocalServer()
t0 = time.time()
try:
    base = server.start(timeout=90)
except RuntimeError as e:
    sys.exit(f"did not start: {e}")
print(f"started on {base} in {time.time() - t0:.1f} s")
with opener.open(f"{base}/processes", timeout=60) as r:
    n = len(json.loads(r.read()).get("processes", []))
print("/processes:", n)
if n < 10:
    failures.append("/processes")
t0 = time.time()
with opener.open(f"{base}/terrain-tiles/10/533/361.png?modes=slope&background=none", timeout=120) as r:
    body, ctype = r.read(), r.headers.get("content-type")
print(f"tile: {ctype}, {len(body)} bytes in {time.time() - t0:.1f} s")
if ctype != "image/png" or body[:4] != b"\x89PNG" or len(body) < 2000:
    failures.append("tile")
server.stop()
time.sleep(1)
try:
    opener.open(f"{base}/health", timeout=3)
    failures.append("still answers after stop")
except OSError:
    print("stopped")
print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
sys.exit(1 if failures else 0)
