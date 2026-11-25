"""Headless check of the experimental local compute (terrain_viewer/live/):
  QT_QPA_PLATFORM=offscreen python-qgis test_live.py [out-dir]
1. The numpy kernels against the app's own (lib/shadow-kernel.ts, lib/horizon-kernel.ts
   run by Node through live_reference.mjs) on real Mapterhorn tiles around Mont Blanc.
2. numba's port against numpy, when numba imports.
3. End to end: the localhost XYZ server, one XYZ layer per mode, the canvas
   extent rendered by QGIS's parallel renderer.
Network: tiles.mapterhorn.com."""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
if os.environ.get("TV_EXTRA_PYTHONPATH"):  # numba installed with pip --target elsewhere (python-qgis resets PYTHONPATH)
    sys.path.append(os.environ["TV_EXTRA_PYTHONPATH"])
from qgis.core import (QgsApplication, QgsCoordinateReferenceSystem, QgsMapRendererParallelJob, QgsMapSettings,  # noqa: E402
                       QgsProject, QgsRasterLayer, QgsRectangle)
from qgis.PyQt.QtCore import QEventLoop, QSize  # noqa: E402

app = QgsApplication([], False)
app.initQgis()
out = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="tv-live-")
os.makedirs(out, exist_ok=True)

import numpy as np  # noqa: E402

from terrain_viewer.live import kernels, kernels_numba  # noqa: E402
from terrain_viewer.live.dem import TILE, Dem, ground_resolution_m  # noqa: E402
from terrain_viewer.live.server import LiveServer  # noqa: E402

failures = []


def tile_of(lat, lng, z):
    n = 1 << z
    x = int((lng + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


node = os.environ.get("NODE") or shutil.which("node")  # python-qgis.bat resets PATH: NODE=<path>
dem = Dem("mapterhorn")
z = 12
x, y = tile_of(45.8326, 6.8652, z)  # Mont Blanc
res = ground_resolution_m(z, y)
tmp = tempfile.mkdtemp(prefix="tv-live-ref-")


def reference(kind, padded, halo, **kw):
    pth, outp = os.path.join(tmp, "p.bin"), os.path.join(tmp, "o.bin")
    padded.astype(np.float32).tofile(pth)
    job = {"padded": pth, "out": outp, "stride": padded.shape[0], "n": TILE, "halo": halo, "kind": kind, "groundResM": res, **kw}
    with open(os.path.join(tmp, "job.json"), "w") as f:
        json.dump(job, f)
    subprocess.run([node, "--experimental-strip-types", "--no-warnings", os.path.join(HERE, "live_reference.mjs"),
                    os.path.join(tmp, "job.json")], check=True, capture_output=True)
    if kind == "shadow":
        return np.fromfile(outp, np.uint8).reshape(TILE, TILE) == 255
    return np.fromfile(outp, np.float32).reshape(TILE, TILE)


# 1. numpy against the app's kernels.
if node is None:
    print("SKIP reference: no node on PATH")
else:
    for az, alt in [(315, 45), (315, 15), (120, 8), (200, 25), (90, 5), (0, 10)]:
        halo = 256
        padded = dem.padded(z, x, y, halo)
        d_row, d_col = kernels.sun_step(az)
        mine = kernels.shadow(padded, TILE, halo, d_row, d_col, res, math.radians(alt))
        ref = reference("shadow", padded, halo, dRow=d_row, dCol=d_col, altitudeRad=math.radians(alt))
        diff = int((mine != ref).sum())
        print(f"shadow az {az} alt {alt}: {ref.mean() * 100:.1f}% in shadow, {diff} px differ")
        if diff > TILE * TILE * 0.001:
            failures.append(f"shadow az {az} alt {alt}: {diff} px differ from lib/shadow-kernel.ts")
    for r in (8, 32):
        padded = dem.padded(z, x, y, r)
        mine = kernels.svf(padded, TILE, r, res)
        ref = reference("svf", padded, r)
        d = float(np.abs(mine - ref).max())
        print(f"svf r {r}: max |diff| {d:.4f} (%)")
        if d > 0.05:
            failures.append(f"svf r {r}: max diff {d}")

# 2. numba against numpy.
if kernels_numba.available:
    padded = dem.padded(z, x, y, 256)
    for az, alt in [(315, 15), (120, 8), (0, 10)]:
        d_row, d_col = kernels.sun_step(az)
        a = kernels.shadow(padded, TILE, 256, d_row, d_col, res, math.radians(alt))
        b = kernels_numba.shadow(padded, TILE, 256, d_row, d_col, res, math.radians(alt))
        print(f"numba shadow az {az}: {int((a != b).sum())} px differ")
        if (a != b).sum() > TILE * TILE * 0.001:
            failures.append(f"numba shadow az {az}")
    p8 = dem.padded(z, x, y, 8)
    d = float(np.abs(kernels.svf(p8, TILE, 8, res) - kernels_numba.svf(p8, TILE, 8, res, *kernels_numba.svf_rays(8, res))).max())
    p1 = dem.padded(z, x, y, 1)
    dh = float(np.abs(kernels.hillshade(p1, res) - kernels_numba.hillshade(p1, res, 315.0, 45.0, 1.0)).max())
    print(f"numba svf max diff {d:.4f}, hillshade {dh:.5f}")
    if d > 0.05 or dh > 1e-3:
        failures.append("numba svf/hillshade")
else:
    print("SKIP numba: not importable")

# 3. End to end in QGIS: XYZ layers on the localhost server.
srv = LiveServer.instance()
merc = QgsCoordinateReferenceSystem("EPSG:3857")
cx, cy = 6.8652 * 20037508.34 / 180, math.log(math.tan(math.radians(90 + 45.8326) / 2)) * 6378137
ext = QgsRectangle(cx - 12000, cy - 9000, cx + 12000, cy + 9000)
for mode, opts in [("hillshade", {}), ("slope", {}), ("svf", {"radius": 16}), ("shadows", {"altitude": 15})]:
    uri = f"type=xyz&url={srv.xyz_url(mode, opts)}&zmin=0&zmax=17"
    layer = QgsRasterLayer(uri, f"local {mode}", "wms")
    if not layer.isValid():
        failures.append(f"{mode}: layer invalid ({layer.error().summary()})")
        continue
    QgsProject.instance().addMapLayer(layer)
    ms = QgsMapSettings()
    ms.setLayers([layer])
    ms.setDestinationCrs(merc)
    ms.setExtent(ext)
    ms.setOutputSize(QSize(1024, 768))
    job = QgsMapRendererParallelJob(ms)
    loop = QEventLoop()
    job.finished.connect(loop.quit)
    import time
    t0 = time.perf_counter()
    job.start()
    loop.exec()
    wall = (time.perf_counter() - t0) * 1000
    img = job.renderedImage()
    img.save(os.path.join(out, f"live-{mode}.png"))
    rgb32 = img.convertToFormat(img.Format.Format_RGB32)  # kept alive while its bits are read
    ptr = rgb32.constBits()
    nbytes = img.width() * img.height() * 4
    if hasattr(ptr, "setsize"):
        ptr.setsize(nbytes)
    px = np.frombuffer(ptr, np.uint8, count=nbytes).copy()
    spread = int(px[0::4].max()) - int(px[0::4].min())
    st = srv.stats.get(mode, {"tiles": 0, "fetch_ms": 0, "compute_ms": 0})
    print(f"render {mode}: {wall:.0f} ms for 1024x768, {st['tiles']} tiles, "
          f"compute {st['compute_ms'] / max(st['tiles'], 1):.1f} ms/tile, grey spread {spread}")
    if st["tiles"] == 0 or spread < 20:
        failures.append(f"{mode}: rendered image empty or flat")
LiveServer.shutdown()

# 4. The panel's off-by-default box: a group of three layers, gone when unchecked.
from terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from terrain_viewer.live.layers import GROUP_PROP  # noqa: E402

dock = TerrainViewerDock(None)


def local_groups():
    return [g for g in QgsProject.instance().layerTreeRoot().findGroups(True) if g.customProperty(GROUP_PROP)]


if dock.local.isChecked() or local_groups():
    failures.append("dock: local compute must be off by default")
dock.local.setChecked(True)
g = local_groups()
names = [n.layer().name() for n in g[0].findLayers()] if g else []
print("dock local group:", names)
if len(g) != 1 or len(names) != 3 or not all(n.layer().isValid() for n in g[0].findLayers()):
    failures.append(f"dock: local group {names}")
dock.local.setChecked(False)
if local_groups() or LiveServer._instance is not None:
    failures.append("dock: unchecking leaves the group or the server")

print("out:", out)
print("FAILURES:" if failures else "ALL OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
