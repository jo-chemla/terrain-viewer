"""Interactivity of the local compute: a 1920x1080 canvas drawn by QGIS at
z12, z13 and z14 around Mont Blanc, tiles per second (the median of
--reps runs), elevation already cached (what a pan or a setting change costs once the area was seen):
  QT_QPA_PLATFORM=offscreen python-qgis bench_canvas.py [--old <dir>] [--json out.json]
--old: a folder holding an earlier copy of the package as tv_old/live/ (e.g.
cb7c545's, `git show cb7c545:qgis-plugin/iconem_terrain_viewer/live/server.py` and
its siblings) to time it the same way: "before".
Each run asks fresh tiles (a cache-busting parameter): QGIS's network cache,
GDAL's block cache and the server's result LRU never answer.
Then the servers alone: the same tiles over HTTP from 6 and 16 client threads
(6: what QGIS's network manager opens per host; 16: GDAL's MaxConnections)."""
import argparse
import json
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ap = argparse.ArgumentParser()
ap.add_argument("--old", default=None)
ap.add_argument("--json", default=None)
ap.add_argument("--zooms", default="12,13,14")
ap.add_argument("--reps", type=int, default=3, help="runs per cell, the median kept")
args = ap.parse_args()
if args.old:
    sys.path.insert(0, args.old)

from qgis.core import (Qgis, QgsApplication, QgsCoordinateReferenceSystem, QgsMapRendererParallelJob,  # noqa: E402
                       QgsMapSettings, QgsRasterLayer, QgsRectangle)
from qgis.PyQt.QtCore import QEventLoop, QSize  # noqa: E402

app = QgsApplication([], False)
app.initQgis()

from iconem_terrain_viewer.live.dem import Dem  # noqa: E402
from iconem_terrain_viewer.live.layers import tiles_of, xyz_source  # noqa: E402
from iconem_terrain_viewer.live.server import LiveServer  # noqa: E402

WORLD = 20037508.342789244
LAT, LNG = 45.8326, 6.8652
W, H = 1920, 1080
CASES = [("hillshade", {}), ("svf", {"radius": 16}), ("shadows", {"altitude": 30})]
merc = QgsCoordinateReferenceSystem("EPSG:3857")
cx = LNG * WORLD / 180
cy = math.log(math.tan(math.radians(90 + LAT) / 2)) * 6378137
zooms = [int(z) for z in args.zooms.split(",")]
print(f"QGIS {Qgis.version()}, {os.cpu_count()} logical cores, canvas {W}x{H}")


def extent(z):
    per_px = 2 * WORLD / (256 * 2 ** z)
    return QgsRectangle(cx - W / 2 * per_px, cy - H / 2 * per_px, cx + W / 2 * per_px, cy + H / 2 * per_px)


def draw(layer, z):
    ms = QgsMapSettings()
    ms.setLayers([layer])
    ms.setDestinationCrs(merc)
    ms.setExtent(extent(z))
    ms.setOutputSize(QSize(W, H))
    job = QgsMapRendererParallelJob(ms)
    loop = QEventLoop()
    job.finished.connect(loop.quit)
    t0 = time.perf_counter()
    job.start()
    loop.exec()
    return time.perf_counter() - t0


def warm(dem, z):
    """The canvas's elevation tiles, and their ring, decoded beforehand."""
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda t: dem.tile(*t), tiles_of(extent(z), z, ring=2)))


def tile_count(z):
    return len(tiles_of(extent(z), z, ring=0))


rows = []
bust = int(time.time())


def run(label, srv, make_source, provider):
    global bust
    dem = Dem("mapterhorn")
    srv._dems = {"mapterhorn": dem}
    for z in zooms:
        warm(dem, z)
        for mode, opts in CASES:
            walls = []
            for _ in range(args.reps):
                bust += 1
                o = dict(opts, _b=bust)
                layer = QgsRasterLayer(make_source(srv, mode, o), f"{label} {mode}", provider)
                assert layer.isValid(), (label, mode, layer.error().summary())
                if hasattr(srv, "clear_results"):
                    srv.clear_results()
                before = srv.stats.get(mode, {}).get("tiles", 0)
                walls.append(draw(layer, z))
                tiles = srv.stats.get(mode, {}).get("tiles", 0) - before
                if getattr(srv, "errors", None):
                    print("  errors:", srv.errors[-3:])
                    srv.errors.clear()
            wall = sorted(walls)[len(walls) // 2]
            row = {"server": label, "z": z, "mode": mode, "wall_s": round(wall, 3), "tiles": tiles,
                   "tiles_per_s": round(tiles / wall, 1), "peak_inflight": getattr(srv, "peak_inflight", None)}
            if hasattr(srv, "peak_inflight"):
                srv.peak_inflight = 0
            rows.append(row)
            print(row, flush=True)


def xyz(srv, mode, o):
    return xyz_source(srv.xyz_url(mode, o))


def http_rate(srv, mode, opts, z, workers, ext="png"):
    """Tiles/s for the canvas's tiles fetched straight from the server."""
    global bust
    bust += 1
    q = "&".join(f"{k}={v}" for k, v in dict(opts, _b=bust).items())
    urls = [f"http://127.0.0.1:{srv.port}/{mode}/{t[0]}/{t[1]}/{t[2]}.{ext}?{q}" for t in tiles_of(extent(z), z, ring=0)]

    def get(u):
        with urllib.request.urlopen(u, timeout=120) as r:
            r.read()
    if hasattr(srv, "clear_results"):
        srv.clear_results()
    t0 = time.perf_counter()
    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(get, urls))
    return len(urls) / (time.perf_counter() - t0)


http_rows = []


def run_http(label, srv, ext="png"):
    dem = Dem("mapterhorn")
    srv._dems = {"mapterhorn": dem}
    z = 13
    warm(dem, z)
    for mode, opts in CASES:
        r = {"server": label, "z": z, "mode": mode}
        for workers in (6, 16):
            rates = sorted(http_rate(srv, mode, opts, z, workers, ext) for _ in range(args.reps))
            r[f"tiles_per_s_{workers}"] = round(rates[len(rates) // 2], 1)
        http_rows.append(r)
        print(r, flush=True)


if args.old:
    from tv_old.live.server import LiveServer as OldServer
    old = OldServer()
    run("before (cb7c545), grey xyz", old, xyz, "wms")
    run_http("before (cb7c545)", old)
    old.stop()
srv = LiveServer.instance()
run("after, grey xyz", srv, xyz, "wms")
run("after, values (gdal)", srv, lambda s, m, o: s.gdal_xml(m, o), "gdal")
run_http("after", srv)
run_http("after, .tif", srv, "tif")
LiveServer.shutdown()

print("\ncanvas tiles:", {z: tile_count(z) for z in zooms})
print(f"{'server':<30} {'mode':<10} " + " ".join(f"z{z:<10}" for z in zooms) + "  (tiles/s, wall s)")
for label in dict.fromkeys(r["server"] for r in rows):
    for mode, _ in CASES:
        cells = []
        for z in zooms:
            r = next(r for r in rows if r["server"] == label and r["mode"] == mode and r["z"] == z)
            cells.append(f"{r['tiles_per_s']:>5} {r['wall_s']:>5}")
        print(f"{label:<30} {mode:<10} " + " ".join(f"{c:<11}" for c in cells))
if args.json:
    with open(args.json, "w") as f:
        json.dump({"qgis": Qgis.version(), "cores": os.cpu_count(), "canvas": [W, H], "rows": rows, "http": http_rows}, f, indent=1)
app.exitQgis()
