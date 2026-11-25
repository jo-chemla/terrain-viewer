"""Timings of the experimental local compute, ms per 256 px tile:
  python-qgis bench_live.py [--service http://localhost:3461] [--json out.json]
Kernels on 16 prefetched z12 tiles around Mont Blanc (compute only, colour
included): numpy in one thread, numpy over a thread pool (throughput), numba
(all cores, and one), cupy (host to device and back included), the app's own
JavaScript kernel in Node (one thread, JIT warmed). Then whole tiles over HTTP with the
elevation already cached: the localhost server of live/ and, with --service, the
tile service, one at a time (latency) and 8 at a time (throughput).
numba and cupy are optional: QGIS ships neither; TV_EXTRA_PYTHONPATH may name a
folder where they were pip-installed with --target (never QGIS's own)."""
import argparse
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
extra = os.environ.get("TV_EXTRA_PYTHONPATH")
if extra:
    sys.path.append(extra)
    for sub in ("nvidia/cuda_nvrtc/bin", "nvidia/cuda_runtime/bin"):
        d = os.path.join(extra, sub)
        if os.path.isdir(d) and hasattr(os, "add_dll_directory"):
            os.add_dll_directory(d)
            os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]

ap = argparse.ArgumentParser()
ap.add_argument("--service", default=None)
ap.add_argument("--json", default=None)
ap.add_argument("--source", default="mapterhorn")
args = ap.parse_args()

from qgis.core import Qgis, QgsApplication  # noqa: E402
from qgis.PyQt.QtCore import QT_VERSION_STR  # noqa: E402

app = QgsApplication([], False)
app.initQgis()
import numpy as np  # noqa: E402

from terrain_viewer.live import kernels, kernels_numba, modes  # noqa: E402
from terrain_viewer.live.dem import TILE, Dem, ground_resolution_m  # noqa: E402
from terrain_viewer.live.server import LiveServer  # noqa: E402

try:
    import cupy
    cupy.zeros(1).sum()
except Exception as e:  # noqa: BLE001
    print("cupy: unavailable,", type(e).__name__, str(e)[:120])
    cupy = None

Z = 12
CX, CY = 2126, 1460  # Mont Blanc's z12 tile
TILES = [(Z, CX - 2 + i, CY - 2 + j) for j in range(4) for i in range(4)]
CASES = [
    ("hillshade", {}),
    ("svf", {"radius": 8}),
    ("svf", {"radius": 32}),
    ("shadows", {"altitude": 45}),
    ("shadows", {"altitude": 15}),
]
dem = Dem(args.source)
print(f"QGIS {Qgis.version()}, Qt {QT_VERSION_STR}, numpy {np.__version__}, {os.cpu_count()} logical cores")
print("prefetching", len(TILES), "tiles and their neighbours ...")
grids = {}
for halo in (1, 8, 32, 256):
    grids[halo] = {t: dem.padded(*t, halo) for t in TILES}


def label(mode, opts):
    if mode == "svf":
        return f"SVF r={opts['radius']}"
    if mode == "shadows":
        return f"Shadows r=256 alt {opts['altitude']}°"
    return "Hillshade (3x3)"


def opts_of(mode, o):
    d = dict(modes.DEFAULTS[mode])
    d.update(o)
    return d


def one(mode, opts, t, xp=np):
    g = grids[modes.halo_of(mode, opts)][t]
    if xp is not np:
        g = xp.asarray(g)
    v = modes.render(mode, g, TILE, ground_resolution_m(t[0], t[2]), opts, xp)
    return v if xp is np else xp.asnumpy(v)


def median_ms(fn, reps=1):
    times = []
    for t in TILES:
        for _ in range(reps):
            t0 = time.perf_counter()
            fn(t)
            times.append((time.perf_counter() - t0) * 1000)
    return statistics.median(times)


def pool_ms(fn, workers=8, rounds=2):
    work = TILES * rounds
    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(fn, TILES[:workers]))  # warm
        t0 = time.perf_counter()
        list(ex.map(fn, work))
        return (time.perf_counter() - t0) * 1000 / len(work)


def numba_fn(mode, opts):
    if mode == "hillshade":
        return lambda t: kernels_numba.hillshade(grids[1][t], ground_resolution_m(*t[::2]), 315.0, 45.0, 1.0)
    if mode == "svf":
        r = opts["radius"]
        return lambda t: kernels_numba.svf(grids[r][t], TILE, r, ground_resolution_m(*t[::2]), *kernels_numba.svf_rays(r, ground_resolution_m(*t[::2])))
    dr, dc = kernels.sun_step(opts["azimuth"])
    return lambda t: kernels_numba.shadow(grids[256][t], TILE, 256, dr, dc, ground_resolution_m(*t[::2]), math.radians(opts["altitude"]))


node = os.environ.get("NODE") or shutil.which("node")
tmp = tempfile.mkdtemp(prefix="tv-bench-")


def node_ms(mode, opts):
    if node is None or mode == "hillshade":
        return None
    out = []
    for t in TILES:
        halo = modes.halo_of(mode, opts)
        g = grids[halo][t]
        g.astype(np.float32).tofile(os.path.join(tmp, "p.bin"))
        job = {"padded": os.path.join(tmp, "p.bin"), "out": os.path.join(tmp, "o.bin"), "stride": g.shape[0], "n": TILE, "halo": halo,
               "kind": "svf" if mode == "svf" else "shadow", "repeat": 6, "groundResM": ground_resolution_m(t[0], t[2])}
        if mode == "shadows":
            dr, dc = kernels.sun_step(opts["azimuth"])
            job.update(dRow=dr, dCol=dc, altitudeRad=math.radians(opts["altitude"]))
        with open(os.path.join(tmp, "job.json"), "w") as f:
            json.dump(job, f)
        r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", os.path.join(HERE, "live_reference.mjs"),
                            os.path.join(tmp, "job.json")], capture_output=True, text=True, check=True)
        out.append(json.loads(r.stdout)["ms"])
    return statistics.median(out)


rows = []
for mode, o in CASES:
    opts = opts_of(mode, o)
    row = {"case": label(mode, opts)}
    one(mode, opts, TILES[0])
    row["numpy_1"] = median_ms(lambda t: one(mode, opts, t))
    row["numpy_pool8"] = pool_ms(lambda t: one(mode, opts, t))
    if kernels_numba.available:
        import numba
        f = numba_fn(mode, opts)
        for t in TILES[:4]:
            f(t)  # compile, start the thread pool
        numba.set_num_threads(numba.config.NUMBA_NUM_THREADS)
        row["numba_all"] = median_ms(f, reps=3)
        numba.set_num_threads(1)
        f(TILES[0])
        row["numba_1"] = median_ms(f, reps=3)
        numba.set_num_threads(numba.config.NUMBA_NUM_THREADS)
    if cupy is not None:
        for t in TILES[:2]:
            one(mode, opts, t, cupy)

        def gpu(t):
            one(mode, opts, t, cupy)
            cupy.cuda.Stream.null.synchronize()
        row["cupy"] = median_ms(gpu)
    row["node_js_1"] = node_ms(mode, opts)
    rows.append(row)
    print({k: (round(v, 1) if isinstance(v, float) else v) for k, v in row.items()}, flush=True)


# Whole tiles over HTTP, elevation cached.
def http_ms(urls, workers):
    def get(u):
        t0 = time.perf_counter()
        with urllib.request.urlopen(u, timeout=120) as r:
            r.read()
        return (time.perf_counter() - t0) * 1000
    if workers == 1:
        return statistics.median([get(u) for u in urls])
    with ThreadPoolExecutor(workers) as ex:
        t0 = time.perf_counter()
        list(ex.map(get, urls))
        return (time.perf_counter() - t0) * 1000 / len(urls)


srv = LiveServer.instance()
srv._dems[args.source] = dem  # the prefetched cache
bust = int(time.time())
http_rows = []
# The service caches rendered tiles by their settings: an opacity a millionth
# off per run makes every request a fresh render at the same cost.
SERVICE = {
    "hillshade": "modes=hillshade&hillshadeMethod=standard&hillshadeOpacity={op}",
    "svf": "modes=svf&svfPrecision=precise&svfRadius={radius}&svfOpacity={op}",
    "shadows": "modes=shadows&shadowRenderer=raster&shadowRadiusPx=256&illuminationDir=315&illuminationAlt={altitude}&shadowOpacity={op}",
}
if args.service:
    # Warm the service's elevation cache with the same tiles (and the ring around).
    warm = [f"{args.service}/terrain-tiles/{z}/{x}/{y}.png?" + SERVICE["shadows"].format(altitude=15, op=0.5 + (bust % 100000) * 1e-7)
            for z, x, y in TILES]
    http_ms(warm, 8)
for mode, o in CASES:
    opts = opts_of(mode, o)
    q = "&".join(f"{k}={v}" for k, v in o.items())
    r = {"case": label(mode, opts)}
    for workers in (1, 8):
        bust += 1
        local = [f"http://127.0.0.1:{srv.port}/{mode}/{z}/{x}/{y}.png?source={args.source}&{q}&_b={bust}" for z, x, y in TILES]
        r[f"local_{workers}"] = http_ms(local, workers)
        if args.service:
            sq = SERVICE[mode].format(op=0.9 + (bust % 100000) * 1e-7, **opts)
            svc = [f"{args.service}/terrain-tiles/{z}/{x}/{y}.png?{sq}&_b={bust}" for z, x, y in TILES]
            r[f"service_{workers}"] = http_ms(svc, workers)
    http_rows.append(r)
    print({k: (round(v, 1) if isinstance(v, float) else v) for k, v in r.items()}, flush=True)
LiveServer.shutdown()

result = {"qgis": Qgis.version(), "qt": QT_VERSION_STR, "numpy": np.__version__, "kernels": rows, "http": http_rows}
if args.json:
    with open(args.json, "w") as f:
        json.dump(result, f, indent=1)
app.exitQgis()
