"""Headless check of the experimental local compute (terrain_viewer/live/):
  QT_QPA_PLATFORM=offscreen NODE=<node> python-qgis test_live.py [--service http://127.0.0.1:3461] [out-dir]
1. Shadows and sky view factor against the app's own kernels (lib/shadow-kernel.ts,
   lib/horizon-kernel.ts run by Node through live_reference.mjs).
2. Every value mode against the tile service's values (/terrain-tiles/...tif,
   the app's protocols run in Node), when --service is given: the share of
   pixels within a tolerance (the "match score"), on three tiles at z12-14.
3. The 3x3 family, hillshade (single and multidirectional) and the contour
   mask against GDAL's own gdaldem and contour generator.
4. numba's port against numpy, when numba imports.
   Phong and matcap against the service's pictures (no values); the contour
   lines (vector form) against the mask. The overlays (plane slicer,
   graticule, iso-line) and the building shadows against the service's
   pictures (within a pixel); their vector forms against their rasters.
   0. (offline) the structure tensor's orientation on planes and ridges:
   not mirrored (lib/blobness-protocol.test.ts's cases).
5. End to end: the localhost server, each mode's forms (colour XYZ tiles,
   values read by GDAL with QGIS's renderers, contour lines) drawn by QGIS's
   parallel renderer; a new setting keeps a layer's own style.
6. The panel's box: off by default, at the top, the default colour layers
   when checked; Colour and Values add and remove their layers; gone with
   the server when unchecked.
Network: tiles.mapterhorn.com (and the tile service)."""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
if os.environ.get("TV_EXTRA_PYTHONPATH"):  # numba installed with pip --target elsewhere (python-qgis resets PYTHONPATH)
    sys.path.append(os.environ["TV_EXTRA_PYTHONPATH"])
from qgis.core import (Qgis, QgsApplication, QgsCoordinateReferenceSystem, QgsMapRendererParallelJob, QgsMapSettings,  # noqa: E402
                       QgsProject, QgsRasterLayer, QgsRectangle)
from qgis.PyQt.QtCore import QEventLoop, QSize  # noqa: E402

app = QgsApplication([], False)
app.initQgis()
args = [a for a in sys.argv[1:]]
service = None
if "--service" in args:
    i = args.index("--service")
    service = args[i + 1].rstrip("/")
    del args[i:i + 2]
out = args[0] if args else tempfile.mkdtemp(prefix="tv-live-")
os.makedirs(out, exist_ok=True)

import numpy as np  # noqa: E402
from osgeo import gdal, ogr  # noqa: E402

from terrain_viewer.live import kernels, kernels_numba, modes  # noqa: E402
from terrain_viewer.live.dem import TILE, Dem, ground_resolution_m  # noqa: E402
from terrain_viewer.live.server import LiveServer  # noqa: E402

gdal.UseExceptions()
failures = []
scores = []  # (mode, reference, score %, detail)


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


def score(mode, ref_name, mine, ref, tol, circular=False, mask=None, need=99.0, rel=0.0):
    """The share of pixels where |mine - ref| <= tol + rel |ref| (circular:
    angles in degrees, of period 360, or the number given), NaN in both
    counted as equal."""
    d = np.abs(mine.astype(np.float64) - ref.astype(np.float64))
    if circular:
        period = 360 if circular is True else circular
        d = np.minimum(d, period - d)
    raw = d.copy()
    if rel:
        d = d - rel * np.abs(ref.astype(np.float64))
    both_nan = np.isnan(mine) & np.isnan(ref)
    d[both_nan] = 0
    d[np.isnan(d)] = np.inf
    raw[both_nan] = 0
    if mask is not None:
        d, raw = d[mask], raw[mask]
    ok = float((d <= tol).mean() * 100)
    finite = raw[np.isfinite(raw)]
    detail = f"median |diff| {np.median(finite):.3g}, p99 {np.percentile(finite, 99):.3g}, tol {tol:g}" + (f" + {rel:g} |ref|" if rel else "")
    scores.append((mode, ref_name, ok, detail))
    print(f"  {mode:<22} vs {ref_name:<14} {ok:6.2f}% within tol ({detail})", flush=True)
    if ok < need:
        failures.append(f"{mode} vs {ref_name}: {ok:.2f}% within {tol} (need {need}%)")


# 0. The structure tensor's orientation, offline: a compass axis of the
# dominant gradient, not mirrored (lib/blobness-protocol.test.ts's cases).
print("0. orientation on planes and ridges")
_e, _n = np.meshgrid(np.arange(-2.0, 3.0), np.arange(2.0, -3.0, -1.0))  # 5x5, row 0 north
for label, zz, want in [("plane rising NE", _e + _n, 45), ("plane rising NW", -_e + _n, 135),
                        ("east-west slope", 3 * _e, 90), ("north-south slope", 2 * _n, 0),
                        ("ridge running N-S", -10 * np.abs(_e), 90), ("ridge running E-W", -10 * np.abs(_n), 0)]:
    got = float(kernels.orientation(*kernels.structure_tensor(zz, 1.0))[0, 0])
    print(f"  {label:<18} {got:6.2f} (want {want})")
    if min(abs(got - want), 180 - abs(got - want)) > 1e-6:
        failures.append(f"orientation {label}: {got} != {want}")

# 1. numpy against the app's kernels.
print("1. against the app's kernels (Node)")
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
        print(f"  shadow az {az} alt {alt}: {ref.mean() * 100:.1f}% in shadow, {diff} px differ")
        if diff > TILE * TILE * 0.001:
            failures.append(f"shadow az {az} alt {alt}: {diff} px differ from lib/shadow-kernel.ts")
    for r in (8, 32):
        padded = dem.padded(z, x, y, r)
        mine = kernels.svf(padded, TILE, r, res)
        ref = reference("svf", padded, r)
        d = float(np.abs(mine - ref).max())
        print(f"  svf r {r}: max |diff| {d:.4f} (%)")
        if d > 0.05:
            failures.append(f"svf r {r}: max diff {d}")

# 2. Against the tile service's values.
TILES = [(12, 2126, 1460), (13, 4253, 2921), (14, 8507, 5843)]  # Mont Blanc, z12 to z14
# mode -> (local opts, the service's query, tolerance in the mode's unit, circular)
REF = [
    ("elevation", {}, "modes=elevation", 0.01, False),
    # The service packs slope as Terrain-RGB, 0.1 degree steps.
    ("slope", {}, "modes=slope", 0.1, False),
    # Relative tolerances (below, REL): the service divides by the ground
    # size at the centre of its 512 px tile, the plugin at its 256 px tile's
    # centre, 0.1 to 0.3 % apart at 45 degrees north; det-hessian goes as 1/L^4.
    ("aspect", {}, "modes=aspect", 0.5, True),
    ("tri", {}, "modes=tri", 0.05, False),
    ("tpi", {}, "modes=tpi", 0.01, False),
    ("roughness", {}, "modes=roughness", 0.01, False),
    ("lrm", {"radius": 16}, "modes=lrm&lrmRadius=16", 0.05, False),
    ("svf", {"radius": 8}, "modes=svf&svfRadius=8&svfPrecision=precise", 0.001, False),
    ("openness", {"radius": 8, "mode": "positive"}, "modes=openness&opennessRadius=8&opennessMode=positive&opennessPrecision=precise", 0.05, False),
    ("openness", {"radius": 8, "mode": "negative"}, "modes=openness&opennessRadius=8&opennessMode=negative&opennessPrecision=precise", 0.05, False),
    # The structure tensor and local dominance: the service packs them as
    # Terrarium (1/256 of the app's units; blobness and eigenRatio are x100 there).
    ("shapeIndex", {}, "modes=shapeIndex", 0.01, False),
    ("blobness", {}, "modes=blobness", 2e-4, False),
    ("eigenRatio", {}, "modes=eigenRatio", 1e-4, False),
    ("orientation", {}, "modes=orientation", 0.01, 180),
    ("localDominance", {}, "modes=localDominance", 0.02, False),
] + [("curvature", {"mode": m}, f"modes=curvature&curvatureMode={m}", tol, False) for m, tol in
     [("combined", 1e-4), ("profile", 1e-4), ("plan", 1e-3), ("det-hessian", 1e-6), ("casorati", 1e-4), ("shape-index", 0.01)]]


def service_values(t, query):
    url = f"{service}/terrain-tiles/{t[0]}/{t[1]}/{t[2]}.tif?terrainSource=mapterhorn&compression=none&{query}"
    with urllib.request.urlopen(url, timeout=300) as r:
        data = r.read()
    name = f"/vsimem/ref-{t[0]}-{t[1]}-{t[2]}.tif"
    gdal.FileFromMemBuffer(name, data)
    a = gdal.Open(name).ReadAsArray().astype(np.float32)
    gdal.Unlink(name)
    return a


if service:
    print(f"2. against the tile service's values ({service})")
    for mode, opts, query, tol, circ in REF:
        o = modes.parse_opts(mode, opts)
        mine, ref = [], []
        for t in TILES:
            mine.append(modes.values(mode, dem.grid(*t), ground_resolution_m(t[0], t[2]), o))
            ref.append(service_values(t, query))
        mine, ref = np.stack(mine), np.stack(ref)
        mask = None
        ref_name = "tile service"
        if mode == "aspect":
            # The direction of flat ground is arbitrary. (Until 2026-11-25 the
            # app's aspect was mirrored east-west; both follow gdaldem now.)
            mask = np.stack([modes.v_slope(dem.padded(*t, 1), ground_resolution_m(t[0], t[2])) > 2 for t in TILES])
        if mode == "curvature":
            # The service packs curvature as Terrarium, x1000 over the app's
            # scale: values past +-32767 / scale are clipped there.
            clip = 32767 / {"det-hessian": 1e7, "shape-index": 1e3}.get(opts["mode"], 1e5)
            mask = np.abs(ref) < 0.999 * clip
        label = mode + (f":{opts['mode']}" if "mode" in opts else "")
        # blobness goes as 1/L^2: twice the relative gap of the ground sizes.
        rel = {"slope": 0.005, "curvature": 0.005, "blobness": 0.01}.get(mode, 0.0)
        score(label, ref_name, mine, ref, tol, circ, mask, rel=rel)

    # Phong and matcap have no values: the service's picture (its default
    # renderer, the app's live layers) against the plugin's colour tile.
    # Phong over the service's white background is min(shade + highlight,
    # 1) in grey; matcap is RGB. 8-bit levels.
    def service_png(t, query):
        url = f"{service}/terrain-tiles/{t[0]}/{t[1]}/{t[2]}.png?terrainSource=mapterhorn&{query}"
        with urllib.request.urlopen(url, timeout=300) as r:
            data = r.read()
        name = f"/vsimem/ref-{t[0]}-{t[1]}-{t[2]}.png"
        gdal.FileFromMemBuffer(name, data)
        a = gdal.Open(name).ReadAsArray().astype(np.float32)
        gdal.Unlink(name)
        return np.moveaxis(a, 0, -1)  # (n, n, bands)

    LIGHTING = [
        ("phong", {}, "modes=phong"),
        ("phong", {"azimuth": 120.0, "altitude": 25.0, "specular": 0.6}, "modes=phong&illuminationDir=120&illuminationAlt=25&phongSpecularStrength=0.6"),
        ("phong", {"fresnel": 0.6}, "modes=phong&phongFresnelStrength=0.6"),
        ("matcap", {}, "modes=matcap&background=none"),
        ("matcap", {"texture": "normal_sphere", "rotation": 40.0}, "modes=matcap&background=none&matcapTextureId=normal_sphere&matcapRotationDeg=40"),
    ]
    for mode, opts, query in LIGHTING:
        o = modes.parse_opts(mode, opts)
        mine, ref = [], []
        for t in TILES:
            v = modes.values(mode, dem.grid(*t), ground_resolution_m(t[0], t[2]), o)
            c = modes.colour(mode, v, o).astype(np.float32)
            r = service_png(t, query)
            if mode == "phong":
                mine.append(c)
                ref.append(r[..., 0])
            else:
                mine.append(c)
                ref.append(r[..., :3])
        label = mode + "".join(f" {k}={v}" for k, v in opts.items())
        score(label, "tile service", np.stack(mine), np.stack(ref), 3.0, need=97.0)

    # The overlays and the building shadows have no values: where the
    # service's picture (background none) is drawn against the plugin's
    # colour tile (its alpha), each within a pixel of the other (lines are
    # antialiased there: recall and precision, not equality).
    from terrain_viewer.live import buildings as live_buildings  # noqa: E402

    def grow1(m):
        g = m.copy()
        g[1:] |= m[:-1]
        g[:-1] |= m[1:]
        g[:, 1:] |= m[:, :-1]
        g[:, :-1] |= m[:, 1:]
        return g

    MB, NYC = (45.8326, 6.8652), (40.758, -73.9855)
    MASKS = [
        ("planeSlicer", {"value": 3000.0}, "modes=planeSlicer&planeSlicerValue=3000", MB, 13),
        ("planeSlicer", {"reference": "lrm", "valueLrm": 5.0, "side": "above"},
         "modes=planeSlicer&planeSlicerReferenceMode=lrm&planeSlicerValueLrm=5&planeSlicerSide=above", MB, 14),
        ("graticules", {"density": 0.01}, "modes=graticules&graticuleDensity=0.01", MB, 14),
        ("graticules", {}, "modes=graticules", (45.5, 6.5), 9),
        ("isoline", {"fill": True}, "modes=isoline&isolineFill=true", MB, 14),
        ("isoline", {"smooth": 4}, "modes=isoline&isolineSmooth=4", MB, 14),
        ("isoline", {"at": "interval", "measure": "elevation", "interval": 100.0},
         "modes=isoline&isolineMode=interval&isolineMeasure=elevation&isolineInterval=100", MB, 14),
        ("buildingShadows", {}, "modes=buildingShadows", NYC, 16),
        ("buildingShadows", {"azimuth": 120.0, "altitude": 20.0},
         "modes=buildingShadows&illuminationDir=120&illuminationAlt=20", NYC, 17),
    ]
    for mode, opts, query, (lat, lng), zt in MASKS:
        t = (zt, *tile_of(lat, lng, zt))
        o = modes.parse_opts(mode, opts)
        v = modes.values(mode, dem.grid(*t), ground_resolution_m(t[0], t[2]), o)
        r = service_png(t, query + "&background=none")[..., 3] > 20
        if mode == "buildingShadows":
            # Off the footprints: the service cuts the footprints out with one
            # even-odd path over every building, so where two parts overlap
            # (a tower on its podium) the roof stays shaded; here roofs are lit.
            off = live_buildings.shadows(*t, 256, o["azimuth"], o["altitude"])[1] == 0
            m, r = (v < 0.5) & off, r & off
        else:
            m = modes.colour(mode, v, o)[..., 3] > 0
        inner = np.zeros_like(m)
        inner[2:-2, 2:-2] = True
        recall = float(grow1(m)[r & inner].mean() * 100) if (r & inner).any() else 100.0
        precision = float(grow1(r)[m & inner].mean() * 100) if (m & inner).any() else 100.0
        sc = min(recall, precision)
        label = mode + "".join(f" {k}={v}" for k, v in opts.items()) + f" z{zt}"
        scores.append((label, "tile service", sc, f"recall {recall:.2f}%, precision {precision:.2f}% (within 1 px); "
                                                 f"{m.mean() * 100:.1f}% drawn here, {r.mean() * 100:.1f}% there"))
        print(f"  {label:<44} vs tile service {sc:6.2f}% (recall {recall:.2f}%, precision {precision:.2f}%, "
              f"{m.mean() * 100:.1f}% / {r.mean() * 100:.1f}% drawn)")
        if sc < 97 or (m.any() != r.any()):
            failures.append(f"{label}: recall {recall:.1f}%, precision {precision:.1f}%")
else:
    print("2. SKIP the tile service comparison: no --service")

# 3. Against gdaldem and GDAL's contours.
print("3. against GDAL (gdaldem, contour generator)")


def mem_dataset(a, res_m):
    ds = gdal.GetDriverByName("MEM").Create("", a.shape[1], a.shape[0], 1, gdal.GDT_Float32)
    ds.SetGeoTransform((0, res_m, 0, 0, 0, -res_m))
    ds.GetRasterBand(1).WriteArray(a)
    return ds


def gdaldem(a, res_m, what, **kw):
    out_name = f"/vsimem/dem-{what}.tif"
    gdal.DEMProcessing(out_name, mem_dataset(a, res_m), what, computeEdges=False, **kw)
    r = gdal.Open(out_name).ReadAsArray().astype(np.float32)[1:-1, 1:-1]
    gdal.Unlink(out_name)
    return r


for t in TILES[:2]:
    p = dem.padded(*t, 1)
    r_m = ground_resolution_m(t[0], t[2])
    tag = f"z{t[0]}"
    score(f"hillshade {tag}", "gdaldem", 1 + 254 * modes.hillshade(p, r_m, 315, 45, 1), gdaldem(p, r_m, "hillshade", azimuth=315, altitude=45), 1.01)
    score(f"multihillshade {tag}", "gdaldem", 1 + 254 * modes.multidirectional(p, r_m, 45, 1), gdaldem(p, r_m, "hillshade", altitude=45, multiDirectional=True), 1.01)
    score(f"slope {tag}", "gdaldem", modes.v_slope(p, r_m), gdaldem(p, r_m, "slope"), 0.01)
    sl = modes.v_slope(p, r_m) > 2
    score(f"aspect {tag}", "gdaldem", modes.v_aspect(p, r_m), gdaldem(p, r_m, "aspect", zeroForFlat=True), 0.05, True, sl)
    score(f"tri {tag}", "gdaldem", modes.v_tri(p), gdaldem(p, r_m, "TRI", alg="Riley"), 0.01)
    score(f"tpi {tag}", "gdaldem", modes.v_tpi(p), gdaldem(p, r_m, "TPI"), 0.01)
    score(f"roughness {tag}", "gdaldem", modes.v_roughness(p), gdaldem(p, r_m, "roughness"), 0.01)

    # The contour mask against GDAL's contour lines, burnt into the same grid:
    # each within a pixel of the other.
    mine = ~np.isnan(modes.contour_mask(p, 50, 0))
    src = mem_dataset(p, r_m)
    drv = ogr.GetDriverByName("Memory")
    vds = drv.CreateDataSource("c")
    lyr = vds.CreateLayer("c", geom_type=ogr.wkbLineString)
    lyr.CreateField(ogr.FieldDefn("elev", ogr.OFTReal))
    gdal.ContourGenerate(src.GetRasterBand(1), 50, 0, [], 0, 0, lyr, -1, 0)
    burn = gdal.GetDriverByName("MEM").Create("", p.shape[1], p.shape[0], 1, gdal.GDT_Byte)
    burn.SetGeoTransform((0, r_m, 0, 0, 0, -r_m))
    gdal.RasterizeLayer(burn, [1], lyr, burn_values=[1], options=["ALL_TOUCHED=TRUE"])
    lines = burn.ReadAsArray()[1:-1, 1:-1] > 0

    def grow(m):
        g = m.copy()
        g[1:] |= m[:-1]
        g[:-1] |= m[1:]
        g[:, 1:] |= m[:, :-1]
        g[:, :-1] |= m[:, 1:]
        return g
    inner = np.zeros_like(mine)
    inner[1:-1, 1:-1] = True
    recall = float((grow(mine)[lines & inner]).mean() * 100)
    precision = float((grow(lines)[mine & inner]).mean() * 100)
    s = min(recall, precision)
    scores.append((f"contours {tag}", "GDAL contours", s, f"recall {recall:.2f}%, precision {precision:.2f}% (within 1 px)"))
    print(f"  contours {tag:<13} vs GDAL contours {s:6.2f}% (recall {recall:.2f}%, precision {precision:.2f}%, within 1 px)")
    if s < 98:
        failures.append(f"contours {tag}: recall {recall:.1f}%, precision {precision:.1f}%")

# Contour lines (the vector form): the lines of a view one tile wide are
# GDAL's over the same grid; rasterized, within a pixel of the contour mask.
from qgis.core import QgsRectangle as _R  # noqa: E402
from terrain_viewer.live import contours as live_contours  # noqa: E402
from terrain_viewer.live.server import WORLD as _W  # noqa: E402
for t in TILES[:2]:
    zt, xt, yt = t
    size = 2 * _W / (1 << zt)
    ext_t = _R(-_W + xt * size, _W - (yt + 1) * size, -_W + (xt + 1) * size, _W - yt * size)
    lines, zl = live_contours.view_contours(dem, ext_t, 256, 50, 200)
    bad = [e for _w, e, _m in lines if abs(math.remainder(e, 50)) > 1e-6]
    majors = sum(1 for _w, e, m in lines if m)
    burn = gdal.GetDriverByName("MEM").Create("", 256, 256, 1, gdal.GDT_Byte)
    burn.SetGeoTransform((ext_t.xMinimum(), size / 256, 0, ext_t.yMaximum(), 0, -size / 256))
    vds = ogr.GetDriverByName("Memory").CreateDataSource("l")
    lyr = vds.CreateLayer("l", geom_type=ogr.wkbLineString)
    for w, _e, _m in lines:
        f = ogr.Feature(lyr.GetLayerDefn())
        f.SetGeometry(ogr.CreateGeometryFromWkb(w))
        lyr.CreateFeature(f)
    gdal.RasterizeLayer(burn, [1], lyr, burn_values=[1], options=["ALL_TOUCHED=TRUE"])
    lines_px = burn.ReadAsArray() > 0
    mask_px = ~np.isnan(modes.contour_mask(dem.padded(*t, 1), 50, 0))

    def grow2(m):
        g = m.copy()
        g[1:] |= m[:-1]
        g[:-1] |= m[1:]
        g[:, 1:] |= m[:, :-1]
        g[:, :-1] |= m[:, 1:]
        return g
    inner = np.zeros_like(mask_px)
    inner[2:-2, 2:-2] = True
    recall = float(grow2(mask_px)[lines_px & inner].mean() * 100)
    precision = float(grow2(lines_px)[mask_px & inner].mean() * 100)
    sc = min(recall, precision)
    scores.append((f"contour lines z{zt}", "contour mask", sc, f"{len(lines)} lines, {majors} major, read at z{zl}; recall {recall:.2f}%, precision {precision:.2f}% (within 1 px)"))
    print(f"  contour lines z{zt}: {len(lines)} lines ({majors} major, elevation read at z{zl}), vs the mask {sc:.2f}% "
          f"(recall {recall:.2f}%, precision {precision:.2f}%)")
    if sc < 98 or bad or zl != zt:
        failures.append(f"contour lines z{zt}: {sc:.1f}%, {len(bad)} off-level lines, zoom {zl}")

# The other vector forms (contours.view_vector) over a view one tile wide,
# burnt into the tile's grid, against their own colour tiles: the iso-line's
# lines (one pixel, upper side) within a pixel of its raster, the plane
# slicer's polygons on the same pixels as its raster, the graticule's lines
# at its spacing.
for t in TILES[1:2]:
    zt, xt, yt = t
    size = 2 * _W / (1 << zt)
    ext_t = _R(-_W + xt * size, _W - (yt + 1) * size, -_W + (xt + 1) * size, _W - yt * size)

    def burn(feats, polygons=False):
        ds = gdal.GetDriverByName("MEM").Create("", 256, 256, 1, gdal.GDT_Byte)
        ds.SetGeoTransform((ext_t.xMinimum(), size / 256, 0, ext_t.yMaximum(), 0, -size / 256))
        vds = ogr.GetDriverByName("MEM" if int(gdal.VersionInfo()) >= 3110000 else "Memory").CreateDataSource("b")
        lyr = vds.CreateLayer("b", geom_type=ogr.wkbMultiPolygon if polygons else ogr.wkbLineString)
        for w, _a in feats:
            f = ogr.Feature(lyr.GetLayerDefn())
            f.SetGeometry(ogr.CreateGeometryFromWkb(w))
            lyr.CreateFeature(f)
        gdal.RasterizeLayer(ds, [1], lyr, burn_values=[1], options=[] if polygons else ["ALL_TOUCHED=TRUE"])
        return ds.ReadAsArray() > 0

    inner = np.zeros((256, 256), bool)
    inner[2:-2, 2:-2] = True
    for mode, opts in [("isoline", {"weight": 1.0}), ("isoline", {"at": "interval", "measure": "elevation", "interval": 100.0, "weight": 1.0}),
                       ("isoline", {"measure": "lrm", "value": 0.0, "weight": 1.0})]:
        o = modes.parse_opts(mode, opts)
        feats, _zv = live_contours.view_vector(dem, ext_t, 256, mode, o)
        lines_px = burn(feats)
        mask_px = modes.values(mode, dem.grid(*t), ground_resolution_m(zt, yt), o) == 2
        recall = float(grow2(mask_px)[lines_px & inner].mean() * 100)
        precision = float(grow2(lines_px)[mask_px & inner].mean() * 100)
        sc = min(recall, precision)
        label = f"{mode} lines" + "".join(f" {k}={v}" for k, v in opts.items() if k != "weight") + f" z{zt}"
        scores.append((label, "its raster", sc, f"{len(feats)} lines; recall {recall:.2f}%, precision {precision:.2f}% (within 1 px)"))
        print(f"  {label:<44} {len(feats):5d} lines, vs its raster {sc:6.2f}% (recall {recall:.2f}%, precision {precision:.2f}%)")
        if sc < 97:
            failures.append(f"{label}: {sc:.1f}%")
    for opts in [{"value": 2500.0}, {"value": 2500.0, "side": "above"}, {"reference": "lrm", "valueLrm": 2.0, "side": "above"}]:
        o = modes.parse_opts("planeSlicer", opts)
        feats, _zv = live_contours.view_vector(dem, ext_t, 256, "planeSlicer", o)
        poly_px = burn(feats, polygons=True)
        mask_px = modes.colour("planeSlicer", modes.values("planeSlicer", dem.grid(*t), ground_resolution_m(zt, yt), o), o)[..., 3] > 0
        agree = float((poly_px == mask_px)[inner].mean() * 100)
        label = "planeSlicer polygons" + "".join(f" {k}={v}" for k, v in opts.items()) + f" z{zt}"
        scores.append((label, "its raster", agree, f"{len(feats)} polygons; {poly_px.mean() * 100:.1f}% vs {mask_px.mean() * 100:.1f}% of the tile"))
        print(f"  {label:<44} {len(feats):5d} polygons, same pixels as its raster: {agree:6.2f}%")
        if agree < 98:
            failures.append(f"{label}: {agree:.1f}%")
    feats, _zv = live_contours.view_vector(dem, ext_t, 256, "graticules", {"density": 0.01})
    kinds = sorted({a[0] for _w, a in feats})
    print(f"  graticule lines density 0.01: {len(feats)} lines {kinds}")
    if len(feats) < 4 or kinds != ["meridian", "parallel"] or any(abs(round(a[1] / 0.01) * 0.01 - a[1]) > 1e-9 for _w, a in feats):
        failures.append(f"graticule lines: {len(feats)} {kinds}")

# 4. numba against numpy.
if kernels_numba.available:
    padded = dem.padded(z, x, y, 256)
    for az, alt in [(315, 15), (120, 8), (0, 10)]:
        d_row, d_col = kernels.sun_step(az)
        a = kernels.shadow(padded, TILE, 256, d_row, d_col, res, math.radians(alt))
        b = kernels_numba.shadow(padded, TILE, 256, d_row, d_col, res, math.radians(alt))
        print(f"numba shadow az {az}: {int((a != b).sum())} px differ")
        if (a != b).sum() > TILE * TILE * 0.001:
            failures.append(f"numba shadow az {az}")
else:
    print("4. SKIP numba: not importable")

# 5. End to end in QGIS: each mode's forms (colour XYZ, values GDAL, contour
# lines) on the localhost server, drawn by QGIS's parallel renderer.
print("5. drawn by QGIS")
from terrain_viewer.live.layers import LocalLayers  # noqa: E402

srv = LiveServer.instance()
ll = LocalLayers()
merc = QgsCoordinateReferenceSystem("EPSG:3857")
cx, cy = 6.8652 * 20037508.34 / 180, math.log(math.tan(math.radians(90 + 45.8326) / 2)) * 6378137
ext = QgsRectangle(cx - 12000, cy - 9000, cx + 12000, cy + 9000)


def draw(layer, name):
    ms = QgsMapSettings()
    ms.setLayers([layer])
    ms.setDestinationCrs(merc)
    ms.setExtent(ext)
    ms.setOutputSize(QSize(1024, 768))
    job = QgsMapRendererParallelJob(ms)
    loop = QEventLoop()
    job.finished.connect(loop.quit)
    t0 = time.perf_counter()
    job.start()
    loop.exec()
    wall = (time.perf_counter() - t0) * 1000
    img = job.renderedImage()
    img.save(os.path.join(out, f"live-{name}.png"))
    rgb32 = img.convertToFormat(img.Format.Format_RGB32)  # kept alive while its bits are read
    ptr = rgb32.constBits()
    nbytes = img.width() * img.height() * 4
    if hasattr(ptr, "setsize"):
        ptr.setsize(nbytes)
    px = np.frombuffer(ptr, np.uint8, count=nbytes).reshape(-1, 4)[:, :3].astype(int)
    return wall, int(px.max() - px.min()), len(np.unique(px[::37] @ np.array([65536, 256, 1])))


from terrain_viewer.live import layers as live_layers  # noqa: E402

for mode in modes.MODES:
    # The modes and vector forms the panel's layers know (live/layers.py
    # ORDER, its contour-only vector layer); the others are checked above
    # until the panel adds them.
    if not modes.MODES[mode]["python_supported"] or mode not in live_layers.ORDER:
        print(f"  {mode:<15} skipped: not in live/layers.py yet")
        continue
    for form in modes.forms_of(mode):
        if form == "vector" and mode != "contours":
            continue
        opts = {"min": 1000.0, "max": 4800.0} if mode == "elevation" else {}
        layer = ll.set_form(mode, form, True, opts, ext, 1024)
        if form == "vector" and layer is not None:
            ll.refresh_vector(layer, opts, ext, 1024, wait=True)
        if layer is None or not layer.isValid():
            failures.append(f"{mode} ({form}): layer invalid")
            continue
        before = srv.stats.get(mode, {}).get("tiles", 0)
        wall, spread, colours = draw(layer, f"{mode}-{form}")
        tiles = srv.stats.get(mode, {}).get("tiles", 0) - before
        extra = f", {layer.featureCount()} lines" if form == "vector" else ""
        print(f"  {mode:<15} {form:<7} {wall:6.0f} ms, {tiles:3d} tiles, spread {spread}, {colours} colours{extra}")
        if spread < 20:
            failures.append(f"{mode} ({form}): rendered image empty or flat")
        if modes.MODES[mode]["kind"] in ("ramp", "rgb") and form != "vector" and colours < 8:
            failures.append(f"{mode} ({form}): {colours} colours, the ramp did not apply")
        if form == "vector" and layer.featureCount() < 10:
            failures.append(f"{mode} (vector): {layer.featureCount()} lines")
        ll.set_form(mode, form, False)
    srv.clear_results()

# A changed setting keeps the layer, its style and its resampling.
from qgis.core import QgsBilinearRasterResampler, QgsRasterDataProvider  # noqa: E402
v = ll.set_form("slope", "values", True, {}, ext, 1024)
early = v.resamplingStage() == getattr(getattr(Qgis, "RasterResamplingStage", None), "Provider", 1) and \
    v.dataProvider().zoomedOutResamplingMethod() == QgsRasterDataProvider.ResamplingMethod.Bilinear
c = ll.set_form("hillshade", "colour", True, {}, ext, 1024)
c.resampleFilter().setZoomedInResampler(QgsBilinearRasterResampler())
c.renderer().setOpacity(0.42)
c2 = ll.set_form("hillshade", "colour", True, {"altitude": 30.0}, ext, 1024)
kept = c2 is c and "altitude=30" in urllib.parse.unquote(c2.source()) and abs(c2.renderer().opacity() - 0.42) < 1e-6 and \
    isinstance(c2.resampleFilter().zoomedInResampler(), QgsBilinearRasterResampler)
print(f"  values layer resampled early, bilinear: {early}; a new setting keeps the layer, opacity and resampling: {kept}")
if not early:
    failures.append("values layer: early bilinear resampling not set")
if not kept:
    failures.append("colour layer: a new setting lost the layer's own opacity or resampling")
ll.set_form("hillshade", "colour", False)
# Identify reads the numbers.
from qgis.core import QgsPointXY, QgsRaster  # noqa: E402
ident = v.dataProvider().identify(QgsPointXY(cx, cy), QgsRaster.IdentifyFormat.IdentifyFormatValue
                                  if hasattr(QgsRaster, "IdentifyFormat") else QgsRaster.IdentifyFormatValue).results()
val = list(ident.values())[0] if ident else None
print(f"  identify slope at Mont Blanc: {val}")
if val is None or not (0 <= float(val) <= 90):
    failures.append(f"identify slope: {val}")
ll.remove_all()

# 6. The panel's Python backend (0.7.0): the same modes tree as the tile
# service's, the modes live/ does not compute greyed out, the forms it lacks
# hidden; per mode, Colour and Values add and remove their layers in the
# live group, marked as the Python backend's.
from terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from terrain_viewer.layers import PROP, BACKEND_PROP  # noqa: E402
from terrain_viewer import python_backend as pyb  # noqa: E402

dock = TerrainViewerDock(None)
dock.set_backend("remote", connect=False)
for r in dock.rows.values():
    r.row.set_forms(set())


def py_keys(prefix=""):
    return sorted(lyr.customProperty(PROP) for lyr in QgsProject.instance().mapLayers().values()
                  if lyr.customProperty(BACKEND_PROP) == "python" and (lyr.customProperty(PROP) or "").startswith(prefix))


if len(dock.rows) < 20:
    failures.append(f"dock: the modes tree has {len(dock.rows)} rows without a service")
dock.set_backend("python")
print("dock python:", dock.status.text())
enabled = sorted(m for m, r in dock.rows.items() if r.row.header.isEnabled())
print("  enabled:", enabled)
for m in enabled:
    if pyb.py_mode(m) is None:
        failures.append(f"dock: {m} enabled but live/ does not compute it")
if dock.rows["moundDetector"].row.header.isEnabled():
    failures.append("dock: the mound detector should be greyed out under Python")
if dock.rows["hillshade"].row.available != {"colour"}:
    failures.append(f"dock: hillshade offers {dock.rows['hillshade'].row.available} under Python (colour only)")
row = dock.rows["curvature"].row
steps = [
    ("values only", lambda: row.forms["values"].setChecked(True), ["curvature:values"]),
    ("+ colour", lambda: row.forms["colour"].setChecked(True), ["curvature", "curvature:values"]),
    ("mode off", lambda: row.check.setChecked(False), []),
    ("mode on: both back", lambda: row.check.setChecked(True), ["curvature", "curvature:values"]),
    ("colour off", lambda: row.forms["colour"].setChecked(False), ["curvature:values"]),
    ("values off", lambda: row.forms["values"].setChecked(False), []),
    ("mode on: colour", lambda: row.check.setChecked(True), ["curvature"]),
]
for label, act, want in steps:
    act()
    got = py_keys("curvature")
    cog = row.more.isVisibleTo(row.box)
    print(f"  curvature {label:<20} -> {got}, mode {row.check.isChecked()}, cog {cog}")
    if got != want:
        failures.append(f"dock curvature {label}: {got} != {want}")
    if cog != row.on("colour"):
        failures.append(f"dock curvature {label}: cog shown {cog} with colour {row.on('colour')}")
# A layer removed by hand unchecks its form.
QgsProject.instance().removeMapLayer(dock.stack.find("curvature").id())
if row.check.isChecked():
    failures.append("dock: removing the layer by hand left the row checked")
# Contours: the lines (the default form of an overlay).
dock.rows["contours"].check.setChecked(True)
if py_keys("contours") != ["contours:vector"]:
    failures.append(f"dock: contour lines layer {py_keys('contours')}")
# A setting the Python backend reads goes into its address; one it ignores is greyed.
svf = dock.rows["svf"]
svf.check.setChecked(True)
svf.settings["svfRadius"].set(12)
dock.flush()
if "radius=12" not in dock.stack.find("svf").source().replace("%3D", "="):
    failures.append("dock: svfRadius did not reach the Python address")
if svf.settings["svfColorRamp"].widget.isEnabled():
    failures.append("dock: the SVF ramp should be greyed out under Python (it draws its own)")
# Another source live/ reads (AWS Terrarium) is followed.
dock.set_source("aws")
dock.flush()
if "source=aws" not in dock.stack.find("svf").source().replace("%3D", "="):
    failures.append("dock: the Python backend did not follow the source")
dock.set_source("mapterhorn")
for r in dock.rows.values():
    r.row.set_forms(set())
    r.update()
if py_keys():
    failures.append(f"dock: unchecked rows left Python layers {py_keys()}")

print("\nmatch scores:")
for m, ref, s, d in scores:
    print(f"  {m:<24} {ref:<14} {s:6.2f}%  {d}")
with open(os.path.join(out, "scores.json"), "w") as f:
    json.dump([{"mode": m, "reference": r, "score": s, "detail": d} for m, r, s, d in scores], f, indent=1)
print("out:", out)
print("FAILURES:" if failures else "ALL OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
