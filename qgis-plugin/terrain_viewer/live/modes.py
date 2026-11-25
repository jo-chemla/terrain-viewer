"""The modes computed locally: their values (Float32, natural units, as the
tile service's /terrain-tiles/{z}/{x}/{y}.tif), the halo each needs, their
settings, and how QGIS draws them by default.

The 3x3 family is the app's own formulas (lib/slope-protocol.ts,
aspect-, tri-, tpi-, roughness-, curvature-protocol.ts), vectorised; the ray
sweeps and the shadow sweep are kernels.py; LRM is lib/lrm-protocol.ts (the
tile minus its ancestor, bilinear); the multidirectional hillshade and the
contour mask have no app protocol (the app draws them on the GPU) and follow
gdaldem and the iso-line rule instead. The structure tensor modes (blobness,
eigenvalue ratio, orientation) are lib/blobness-protocol.ts, local dominance
lib/local-dominance-kernel.ts, both in kernels.py; the graticule, plane
slicer and iso-line are overlays.py, the building shadows buildings.py.
Written against an array module `xp` (numpy; cupy runs the same code)."""
import math

import numpy as np

from . import kernels
from .kernels import hillshade, horizon, shadow, sun_step


# ---------------------------------------------------------------- 3x3 family
def _win(p):
    """The 3x3 window of every pixel of a (n + 2)^2 grid, GDAL's order
    0 1 2 / 3 4 5 / 6 7 8 (row 0 north)."""
    return (p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:], p[1:-1, :-2], p[1:-1, 1:-1], p[1:-1, 2:],
            p[2:, :-2], p[2:, 1:-1], p[2:, 2:])


def _horn(p, res_m):
    """GDAL's Horn gradient, as lib/slope-protocol.ts: x = west - east,
    y = south - north, over the ground size (not yet / 8)."""
    a0, a1, a2, a3, _, a5, a6, a7, a8 = _win(p)
    inv = 1.0 / res_m
    return (a0 + 2 * a3 + a6 - (a2 + 2 * a5 + a8)) * inv, (a6 + 2 * a7 + a8 - (a0 + 2 * a1 + a2)) * inv


def v_slope(p, res_m, xp=np):
    x, y = _horn(p, res_m)
    return xp.degrees(xp.arctan(xp.sqrt(x * x + y * y) * 0.125)).astype(xp.float32)


def v_aspect(p, res_m, xp=np):
    """The compass bearing the slope faces, clockwise from north, 0 on flat
    ground: gdaldem aspect -zero_for_flat (an east-facing slope is 90).
    Same as lib/aspect-protocol.ts (fixed 2026-11-25, it used to read an
    east-facing slope as 270) and gdaldem: checked against both."""
    x, y = _horn(p, res_m)
    a = xp.degrees(xp.arctan2(x, y))  # x: downhill toward the east, y: toward the north
    a = xp.where(a < 0, a + 360.0, a)
    a = xp.where(a >= 360.0, a - 360.0, a)
    return xp.where((x == 0) & (y == 0), 0.0, a).astype(xp.float32)


def v_tri(p, xp=np):
    """lib/tri-protocol.ts: the root of the summed squared differences to the 8 neighbours."""
    w = _win(p)
    c = w[4]
    s = xp.zeros_like(c)
    for i, a in enumerate(w):
        if i != 4:
            d = a - c
            s = s + d * d
    return xp.sqrt(s).astype(xp.float32)


def v_tpi(p, xp=np):
    a0, a1, a2, a3, a4, a5, a6, a7, a8 = _win(p)
    return (a4 - (a0 + a1 + a2 + a3 + a5 + a6 + a7 + a8) / 8.0).astype(xp.float32)


def v_roughness(p, xp=np):
    w = _win(p)
    hi, lo = w[0], w[0]
    for a in w[1:]:
        hi, lo = xp.maximum(hi, a), xp.minimum(lo, a)
    return (hi - lo).astype(xp.float32)


CURVATURE_MODES = ("combined", "profile", "plan", "det-hessian", "casorati", "shape-index")


def v_curvature(p, res_m, mode="combined", xp=np):
    """lib/curvature-protocol.ts in natural units (the app's x100 or x10000
    taken off, as the tile service's values): combined (the Laplacian),
    profile, plan and casorati in 1/m, det-hessian in 1/m^2, shape-index
    -1..1. Positive: concave (valleys)."""
    a0, a1, a2, a3, a4, a5, a6, a7, a8 = _win(p)
    L = res_m
    if mode == "combined":
        return ((a1 + a3 + a5 + a7 - 4 * a4) / (L * L)).astype(xp.float32)
    pp = (a5 - a3) / (2 * L)
    q = (a7 - a1) / (2 * L)
    r = (a5 - 2 * a4 + a3) / (L * L)
    t = (a7 - 2 * a4 + a1) / (L * L)
    s = (a2 - a0 - a8 + a6) / (4 * L * L)
    if mode in ("profile", "plan"):
        g = pp * pp + q * q
        flat = g < 1e-12
        gs = xp.where(flat, 1.0, g)
        if mode == "profile":
            v = (r * pp * pp + 2 * s * pp * q + t * q * q) / (gs * (1 + gs) ** 1.5)
        else:
            v = (r * q * q - 2 * s * pp * q + t * pp * pp) / gs ** 1.5
        return xp.where(flat, 0.0, v).astype(xp.float32)
    if mode == "det-hessian":
        return (r * t - s * s).astype(xp.float32)
    disc = xp.sqrt((r - t) * (r - t) + 4 * s * s)
    k1, k2 = (r + t + disc) / 2, (r + t - disc) / 2
    if mode == "casorati":
        return xp.sqrt((k1 * k1 + k2 * k2) / 2).astype(xp.float32)
    return ((2 / math.pi) * xp.arctan2(k1 + k2, k1 - k2)).astype(xp.float32)


def multidirectional(p, res_m, altitude_deg=45.0, exaggeration=1.0, xp=np):
    """gdaldem hillshade -multidirectional (USGS, Mark 1992): four lights,
    at 225, 270, 315 and 360 degrees, each weighted by sin^2 of the aspect
    minus its azimuth. (n + 2)^2 -> (n, n), 0..1 (gdaldem's byte is
    1 + 254 times it)."""
    x, y = _horn(p, res_m)
    zs = exaggeration / 8.0
    x = x * zs  # downhill toward the east
    y = y * zs  # downhill toward the north
    sa, ca = math.sin(math.radians(altitude_deg)), math.cos(math.radians(altitude_deg))

    def light(az):  # one light's shade, before the normal's length
        a = math.radians(az)
        return xp.maximum(sa + ca * (x * math.sin(a) + y * math.cos(a)), 0.0)

    xx, yy = x * x, y * y
    g = xx + yy
    w225 = 0.5 * g + x * y  # gdaldem's weights, in these axes
    w315 = g - w225
    flat = g == 0
    gs = xp.where(flat, 1.0, g)
    num = (w225 * light(225) + xx * light(270) + w315 * light(315) + yy * light(360)) / gs * 0.5
    return xp.where(flat, sa, num / xp.sqrt(1.0 + g)).astype(xp.float32)


def contour_mask(p, minor=50.0, major=200.0, xp=np):
    """Contours as a raster: a pixel is on a level's line when one of its
    four neighbours lies below that level and it does not (lines one pixel
    wide, on the upper side). 2 on a major level, 1 on a minor one, NaN off
    the lines. (n + 2)^2 -> (n, n)."""
    c = p[1:-1, 1:-1]
    out = xp.full(c.shape, xp.nan, xp.float32)
    for interval, value in ((minor, 1.0), (major, 2.0)):
        if not interval or interval <= 0:
            continue
        k = xp.floor(c / interval)
        on = xp.zeros(c.shape, bool)
        for nb in (p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]):
            on |= xp.floor(nb / interval) < k
        out[on] = value
    return out


def lrm(fine, ancestor, n, k, x, y, xp=np):
    """lib/lrm-protocol.ts: the tile minus the bilinear sample of its
    ancestor k levels up, pixel centres aligned (the half-pixel recentring
    of the app). fine (n, n); ancestor (n + 2)^2, tile (x >> k, y >> k) with
    a 1-pixel halo."""
    scale = 1 << k
    xo, yo = x - ((x >> k) << k), y - ((y >> k) << k)
    last = ancestor.shape[0] - 1
    g = (np.arange(n) + 0.5) / scale - 0.5 + 1
    gx, gy = xo * n / scale + g, yo * n / scale + g
    x0, y0 = np.floor(gx).astype(np.int64), np.floor(gy).astype(np.int64)
    fx, fy = (gx - x0).astype(np.float32), (gy - y0).astype(np.float32)
    cx0, cx1 = np.clip(x0, 0, last), np.clip(x0 + 1, 0, last)
    cy0, cy1 = np.clip(y0, 0, last), np.clip(y0 + 1, 0, last)
    if xp is not np:
        cx0, cx1, cy0, cy1, fx, fy = map(xp.asarray, (cx0, cx1, cy0, cy1, fx, fy))
    a = ancestor
    top = a[cy0][:, cx0] * (1 - fx) + a[cy0][:, cx1] * fx
    bot = a[cy1][:, cx0] * (1 - fx) + a[cy1][:, cx1] * fx
    return (fine - (top * (1 - fy)[:, None] + bot * fy[:, None])).astype(xp.float32)


def lrm_levels(radius_px):
    """lib/lrm-protocol.ts radiusToLevels."""
    return min(6, max(1, round(math.log2(max(2.0, radius_px)))))



# ---------------------------------------------------------------- lighting
def normals(p, res_m, exaggeration=1.0, xp=np):
    """The surface normal of every pixel, as the app's live Phong and matcap
    layers take it (DEM_NORMAL_GLSL, tile-server/direct.mjs liveLighting):
    Horn's sums over the ground size with no /8 (lib/normal-derived-
    protocol.ts hornGradient), times the exaggeration; x east, y south, z up.
    (n + 2)^2 -> three (n, n)."""
    gx, gy = _horn(p, res_m)  # west - east, south - north
    nx, ny = -gx * exaggeration, -gy * exaggeration
    inv = 1.0 / xp.sqrt(nx * nx + ny * ny + 1.0)
    return nx * inv, ny * inv, inv


PHONG_AMBIENT, PHONG_SHININESS = 0.35, 32


def phong(p, res_m, azimuth=315.0, altitude=45.0, diffuse=0.8, specular=0.2, fresnel=0.0, fresnel_power=3.0,
          exaggeration=1.0, xp=np):
    """The app's live Phong layer (lib/phong-live-gl-layer.ts, as the tile
    service's liveLighting draws it on a light map, one white light, the
    view north-up): the multiply factor (ambient plus diffuse over its
    maximum, darkened by the Fresnel rim) plus the specular highlight. Over
    a white background this is the picture's grey; 0-1, highlights above 1.
    (n + 2)^2 -> (n, n)."""
    nx, ny, nz = normals(p, res_m, exaggeration, xp)
    az, el = math.radians(azimuth), math.radians(altitude)
    lx, ly, lz = -math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)
    hx, hy, hz = lx, ly, lz + 1.0
    hl = math.sqrt(hx * hx + hy * hy + hz * hz)
    hx, hy, hz = hx / hl, hy / hl, hz / hl
    d = xp.maximum(nx * lx + ny * ly + nz * lz, 0.0)
    spec = xp.maximum(nx * hx + ny * hy + nz * hz, 0.0) ** PHONG_SHININESS
    rim = fresnel * (1.0 - xp.clip(nz, 0.0, 1.0)) ** fresnel_power
    intensity = xp.clip((PHONG_AMBIENT + diffuse * d) / (PHONG_AMBIENT + diffuse), 0.0, 1.0)
    shade = intensity * (1.0 - xp.clip(rim, 0.0, 1.0))  # a light map: the rim darkens
    add = xp.clip(specular * spec, 0.0, 1.0) if specular > 0 else 0.0
    return (shade + add).astype(xp.float32)


def matcap(p, res_m, texture, rotation=0.0, exaggeration=1.0, xp=np):
    """The app's live matcap layer (lib/matcap-live-gl-layer.ts, as the tile
    service's liveLighting draws it, the view north-up, the light relative
    to the camera, its default): the normal rotated, read as a UV into the
    matcap picture, bilinear. texture: (h, w, 3) float32 0-1.
    (n + 2)^2 -> (n, n, 3) float32 0-1."""
    nx, ny, _ = normals(p, res_m, exaggeration, xp)
    r = math.radians(rotation)
    cb, sb = math.cos(r), math.sin(r)
    rx, ry = nx * cb + ny * sb, -nx * sb + ny * cb
    h, w = texture.shape[:2]
    px, py = (0.5 - 0.5 * rx) * w - 0.5, (0.5 + 0.5 * ry) * h - 0.5
    x0, y0 = xp.floor(px), xp.floor(py)
    tx, ty = (px - x0)[..., None], (py - y0)[..., None]
    x0, y0 = x0.astype(np.int64), y0.astype(np.int64)
    cx0, cx1 = xp.clip(x0, 0, w - 1), xp.clip(x0 + 1, 0, w - 1)
    cy0, cy1 = xp.clip(y0, 0, h - 1), xp.clip(y0 + 1, 0, h - 1)
    t = texture
    top = t[cy0, cx0] * (1 - tx) + t[cy0, cx1] * tx
    bot = t[cy1, cx0] * (1 - tx) + t[cy1, cx1] * tx
    return (top * (1 - ty) + bot * ty).astype(xp.float32)


# ---------------------------------------------------------------- the modes
# The app's matcap pictures (lib/matcap-textures.ts): its two own, served by
# the app, and Potree's (CC0), as the tile service reads them.
APP_URL = "https://terrain-viewer.iconem.com/"
POTREE_MATCAPS = "https://raw.githubusercontent.com/potree/potree/develop/resources/textures/matcap/"
MATCAP_TEXTURES = {"normal_sphere": APP_URL + "matcap-normal-sphere.png", "duotone_sphere": APP_URL + "matcap-duotone-sphere.png"}
MATCAP_TEXTURES.update({k: f"{POTREE_MATCAPS}{k}.jpg" for k in (
    "basic_1", "basic_2", "basic_dark", "basic_side", "ceramic_dark", "ceramic_lightbulb", "clay_brown", "clay_muddy",
    "clay_studio", "jade", "metal_anisotropic", "metal_carpaint", "metal_lead", "metal_shiny", "pearl", "resin", "skin",
    "toon")})


# The app's own colour ramps (lib/color-ramps.ts), as (value, (r, g, b, alpha
# 0-1)) in the mode's natural units: the colour tiles of the modes that have
# `stops` use them (overlays.stops_lut), so they match the app; `ramp` is the
# QGIS ramp nearest to it, for the values layer's renderer.
SHAPE_INDEX_STOPS = [(-1.0, (33, 102, 172, 1)), (-0.5, (146, 197, 222, 1)), (0.0, (255, 255, 255, 1)),
                     (0.5, (244, 165, 130, 1)), (1.0, (178, 24, 43, 1))]  # DEFAULT_SHAPE_INDEX_CUSTOM_STOPS, discrete
BLOBNESS_STOPS = [(0.0, (255, 255, 255, 0)), (0.05, (229, 245, 249, 1)), (0.15, (153, 216, 201, 1)),
                  (0.30, (44, 162, 95, 1)), (0.50, (0, 109, 44, 1))]  # blobness-default, its 0-50 / 100
EIGEN_RATIO_STOPS = [(0.0, (255, 255, 255, 0)), (0.25, (239, 237, 245, 1)), (0.50, (188, 189, 220, 1)),
                     (0.75, (128, 125, 186, 1)), (1.0, (84, 39, 143, 1))]  # eigen-ratio-default, its % / 100
ORIENTATION_STOPS = [(0.0, (230, 85, 13, 1)), (45.0, (253, 190, 133, 1)), (90.0, (254, 230, 206, 1)),
                     (135.0, (158, 202, 225, 1)), (180.0, (49, 130, 189, 1))]  # orientation-default
LOCAL_DOMINANCE_STOPS = [(-5.0, (20, 20, 35, 1)), (0.0, (85, 88, 100, 1)), (3.0, (150, 152, 160, 1)),
                         (8.0, (215, 218, 222, 1)), (15.0, (255, 255, 255, 1))]  # local-dominance-default

# The iso-line's measures (lib/isoline-measures.ts, the ones computed here),
# traced in their natural units (the values' units: eigenRatio 0-1, Phong
# 0-1, shadows 0 or 1), unlike the app's luma 0-255 for the lights.
ISOLINE_MEASURES = ("elevation", "slope", "aspect", "tri", "tpi", "roughness", "curvature", "shapeIndex", "blobness",
                    "eigenRatio", "orientation", "lrm", "hillshade", "multihillshade", "phong", "shadows")

# kind: "shade" grey and multiplied, "ramp" a QGIS colour ramp over `range`
# (`invert`: the ramp reversed; `stops`: the app's own ramp for the colour
# tiles, `discrete` held between stops), "mask" fixed colours, "rgb" a
# picture (no values). `ramp`: a ramp of QGIS's default style ("hypso": the
# plugin's own hypsometric ramp).
# `outputs`: the forms a mode offers, of "colour" (an XYZ layer of the
# server's PNG tiles), "values" (Float32 read by GDAL) and "vector" (a
# memory layer, live/contours.py view_vector; `vector_layer` its geometry and
# fields). `python_supported`: computed here (False: listed so the panel can
# show it greyed out, served by the tile service only). `service`: the mode's
# id in the tile service (/processes), `service_query` the settings that
# select it there. `opacity`: the colour layer's default opacity.
# `colour_only`: settings of the colours alone (the values ignore them).
# Older entries get `outputs`, `python_supported` and `service` filled in
# below, from `values` / `vector`.
MODES = {
    "elevation": {"label": "Elevation (hypsometric tint)", "unit": "m", "kind": "ramp", "ramp": "hypso", "range": None,
                  "defaults": {"min": 0.0, "max": 4000.0}, "colour_only": ("min", "max"), "service": "colorRelief"},
    "hillshade": {"label": "Hillshade", "unit": "0-1", "kind": "shade", "range": (0, 1),
                  "defaults": {"azimuth": 315.0, "altitude": 45.0, "exaggeration": 1.0}},
    "multihillshade": {"label": "Multidirectional hillshade", "unit": "0-1", "kind": "shade", "range": (0, 1),
                       "defaults": {"altitude": 45.0, "exaggeration": 1.0}, "service": "hillshade",
                       "service_query": {"hillshadeMethod": "multidirectional"}},
    "slope": {"label": "Slope", "unit": "°", "kind": "ramp", "ramp": "YlOrRd", "range": (0, 60), "defaults": {}},
    "aspect": {"label": "Aspect", "unit": "° from north", "kind": "ramp", "ramp": "Turbo", "range": (0, 360), "defaults": {}},
    "curvature": {"label": "Curvature", "unit": "1/m", "kind": "ramp", "ramp": "RdBu", "range": (-0.01, 0.01),
                  "defaults": {"mode": "combined"}, "enums": {"mode": CURVATURE_MODES}},
    "tpi": {"label": "Topographic position (TPI)", "unit": "m", "kind": "ramp", "ramp": "RdBu", "invert": True, "range": (-5, 5),
            "defaults": {}},
    "tri": {"label": "Terrain ruggedness (TRI)", "unit": "m", "kind": "ramp", "ramp": "Magma", "range": (0, 50), "defaults": {}},
    "roughness": {"label": "Roughness", "unit": "m", "kind": "ramp", "ramp": "Magma", "range": (0, 50), "defaults": {}},
    "shapeIndex": {"label": "Shape index", "unit": "-1 bowl, 0 saddle, 1 dome", "kind": "ramp", "ramp": "RdBu", "invert": True,
                   "range": (-1, 1), "stops": SHAPE_INDEX_STOPS, "discrete": True, "defaults": {},
                   "outputs": ("colour", "values"), "python_supported": True, "service": "shapeIndex"},
    "blobness": {"label": "Blobness", "unit": "det/trace of the structure tensor", "kind": "ramp", "ramp": "Greens",
                 "range": (0, 0.5), "stops": BLOBNESS_STOPS, "defaults": {},
                 "outputs": ("colour", "values"), "python_supported": True, "service": "blobness"},
    "eigenRatio": {"label": "Eigenvalue ratio", "unit": "0 linear, 1 isotropic", "kind": "ramp", "ramp": "Purples",
                   "range": (0, 1), "stops": EIGEN_RATIO_STOPS, "defaults": {},
                   "outputs": ("colour", "values"), "python_supported": True, "service": "eigenRatio"},
    "orientation": {"label": "Dominant orientation", "unit": "° from north, 0-180", "kind": "ramp", "ramp": "RdBu",
                    "range": (0, 180), "stops": ORIENTATION_STOPS, "defaults": {},
                    "outputs": ("colour", "values"), "python_supported": True, "service": "orientation"},
    "lrm": {"label": "Local relief model", "unit": "m", "kind": "ramp", "ramp": "RdBu", "invert": True, "range": (-20, 20),
            "defaults": {"radius": 16}},
    "svf": {"label": "Sky view factor", "unit": "0-1", "kind": "ramp", "ramp": "Greys", "invert": True, "range": (0.6, 1),
            "defaults": {"radius": 8}, "opacity": 0.8},
    "openness": {"label": "Openness", "unit": "°", "kind": "ramp", "ramp": "Greys", "invert": True, "range": (75, 105),
                 "defaults": {"radius": 8, "mode": "positive"}, "enums": {"mode": ("positive", "negative")}, "opacity": 0.8},
    "localDominance": {"label": "Local dominance", "unit": "°", "kind": "ramp", "ramp": "Greys", "invert": True,
                       "range": (-5, 15), "stops": LOCAL_DOMINANCE_STOPS, "defaults": {"minRadius": 8, "maxRadius": 32},
                       "outputs": ("colour", "values"), "python_supported": True, "service": "localDominance"},
    "shadows": {"label": "Shadows", "unit": "1 lit, 0 in shadow", "kind": "shade", "range": (0, 1),
                "defaults": {"azimuth": 315.0, "altitude": 30.0, "radius": 256}, "opacity": 0.6},
    "buildingShadows": {"label": "Building shadows", "unit": "1 lit, 0 in shadow", "kind": "shade", "range": (0, 1),
                        "defaults": {"azimuth": 315.0, "altitude": 45.0}, "opacity": 0.5,
                        "outputs": ("colour", "values"), "python_supported": True, "service": "buildingShadows"},
    "contours": {"label": "Contours", "unit": "1 minor, 2 major", "kind": "mask", "range": (1, 2),
                 "defaults": {"minor": 50.0, "major": 200.0}, "values": False, "vector": True,
                 "vector_layer": {"geometry": "LineString", "fields": (("elev", "double"), ("major", "integer"))}},
    "isoline": {"label": "Iso-line", "unit": "", "kind": "mask", "range": None,
                "defaults": {"measure": "slope", "at": "value", "value": 30.0, "interval": 10.0, "fill": False,
                             "fillOpacity": 0.35, "smooth": 0, "weight": 2.0, "color": "#ef4444"},
                "enums": {"measure": ISOLINE_MEASURES, "at": ("value", "interval")},
                "outputs": ("colour", "vector"), "values": False, "vector": True, "python_supported": True, "service": "isoline",
                "vector_layer": {"geometry": "LineString", "fields": (("value", "double"),)}},
    "graticules": {"label": "Graticule", "unit": "", "kind": "mask", "range": None,
                   "defaults": {"density": 0.0, "width": 1.0, "color": "#000000"},
                   "outputs": ("colour", "vector"), "values": False, "vector": True, "python_supported": True,
                   "service": "graticules",
                   "vector_layer": {"geometry": "LineString", "fields": (("kind", "string"), ("deg", "double"))}},
    "planeSlicer": {"label": "Plane slicer", "unit": "", "kind": "mask", "range": None,
                    "defaults": {"reference": "absolute", "value": 0.0, "valueLrm": 0.0, "side": "below", "color": "#3388ff",
                                 "opacity": 0.6, "lrmRadius": 16},
                    "enums": {"reference": ("absolute", "lrm"), "side": ("below", "above")},
                    "outputs": ("colour", "vector"), "values": False, "vector": True, "python_supported": True,
                    "service": "planeSlicer",
                    "vector_layer": {"geometry": "Polygon", "fields": (("value", "double"), ("side", "string"))}},
    "phong": {"label": "Phong", "unit": "0-1, highlights above", "kind": "shade", "range": (0, 1),
              "defaults": {"azimuth": 315.0, "altitude": 45.0, "diffuse": 0.8, "specular": 0.2, "fresnel": 0.0,
                           "fresnelPower": 3.0, "exaggeration": 1.0}},
    "matcap": {"label": "Matcap", "unit": "", "kind": "rgb", "range": None, "values": False,
               "defaults": {"texture": "clay_studio", "rotation": 0.0, "exaggeration": 1.0},
               "enums": {"texture": tuple(MATCAP_TEXTURES)}},
    # Served by the tile service only.
    "moundDetector": {"label": "Mound candidates", "unit": "", "kind": "mask", "range": None, "defaults": {},
                      "outputs": ("vector",), "values": False, "vector": True, "python_supported": False,
                      "service": "moundDetector"},
}
for _m, _s in MODES.items():
    _s.setdefault("outputs", ("colour",) + (("values",) if _s.get("values", True) else ())
                  + (("vector",) if _s.get("vector") else ()))
    _s.setdefault("python_supported", True)
    _s.setdefault("service", _m)
DEFAULTS = {m: d["defaults"] for m, d in MODES.items()}
# Top of the map first, the app's layer order (the tile service's
# x-tv-stack-rank, highest first); multidirectional with the hillshade.
ORDER = ["contours", "planeSlicer", "moundDetector", "graticules", "isoline", "buildingShadows", "shadows", "phong",
         "matcap", "hillshade", "multihillshade", "localDominance", "openness", "svf", "orientation", "eigenRatio",
         "blobness", "shapeIndex", "roughness", "lrm", "tpi", "curvature", "tri", "aspect", "slope", "elevation"]
PYTHON_MODES = tuple(m for m in ORDER if MODES[m]["python_supported"])


def forms_of(mode):
    """The forms a mode offers, in the panel's order (colour, values, vector)."""
    out = MODES[mode]["outputs"]
    return tuple(f for f in ("colour", "values", "vector") if f in out)


def _iso(opts):
    """The iso-line's measure, its settings (the measure's defaults, `m_<key>`
    settings of the iso-line passed to it), the smoothing and the halo it
    adds (one for the line, the blur's)."""
    m = opts["measure"]
    mo = parse_opts(m, {k[2:]: v for k, v in opts.items() if k.startswith("m_")})
    s = int(min(max(round(float(opts.get("smooth", 0))), 0), 16))
    e = 1 + s
    if "radius" in mo and m == "shadows":
        mo["radius"] = min(mo["radius"], 256 - e)
    return m, mo, s, e


def ld_levels(opts, z):
    """Local dominance's ancestor levels: one per octave of the annulus
    [minRadius, maxRadius] (lib/local-dominance-protocol.ts), capped at z."""
    lo = kernels.octave_of(float(opts["minRadius"]))
    hi = max(lo, kernels.octave_of(float(opts["maxRadius"])))
    return [min(L, z) for L in range(lo, hi + 1)]


def halo_of(mode, opts):
    if mode in ("svf", "openness", "shadows"):
        return int(opts["radius"])
    if mode in ("elevation", "lrm", "localDominance", "planeSlicer", "graticules", "buildingShadows", "moundDetector"):
        return 0
    if mode in ("blobness", "eigenRatio", "orientation"):
        return 2
    if mode == "isoline":
        m, mo, _s, e = _iso(opts)
        return halo_of(m, mo) + e
    return 1


class _Grown:
    """A grid seen as a tile `e` pixels wider on every side (the iso-line
    computes its measure past the tile, for the line and the blur)."""

    def __init__(self, grid, e):
        self.grid, self.e = grid, e
        self.z, self.x, self.y = grid.z, grid.x, grid.y

    def __call__(self, halo):
        return self.grid(halo + self.e)

    def ancestor(self, k):
        return self.grid.ancestor(k)


def prefetch(mode, grid, opts):
    """Fetches what values() will read (outside the compute slots)."""
    if mode in ("graticules", "buildingShadows", "moundDetector"):
        return
    if mode == "lrm":
        grid(0)
        k = min(lrm_levels(float(opts["radius"])), grid.z)
        if k:
            grid.ancestor(k)
    elif mode == "localDominance":
        grid(0)
        for k in ld_levels(opts, grid.z):
            grid.ancestor(k)
    elif mode == "planeSlicer":
        if opts["reference"] == "lrm":
            prefetch("lrm", grid, {"radius": opts["lrmRadius"]})
        else:
            grid(0)
    elif mode == "isoline":
        m, mo, _s, e = _iso(opts)
        prefetch(m, grid if m in ("lrm", "localDominance") else _Grown(grid, e), mo)
    else:
        grid(halo_of(mode, opts))


def _bool(v):
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def parse_opts(mode, query):
    """A mode's settings from a query ({key: [value]} or {key: value}),
    typed as its defaults, unknown keys and bad values ignored (the
    iso-line keeps `m_<key>`, its measure's settings)."""
    spec = MODES[mode]
    opts = dict(spec["defaults"])
    for k, v in query.items():
        v = v[0] if isinstance(v, (list, tuple)) else v
        if mode == "isoline" and k.startswith("m_"):
            opts[k] = v
            continue
        if k not in opts:
            continue
        if k in spec.get("enums", {}):
            if v in spec["enums"][k]:
                opts[k] = v
            continue
        d = spec["defaults"][k]
        try:
            if isinstance(d, bool):
                opts[k] = v if isinstance(v, bool) else _bool(v)
            elif isinstance(d, str):
                opts[k] = str(v)
            else:
                opts[k] = type(d)(float(v))
        except (TypeError, ValueError):
            pass
    if "radius" in opts:
        opts["radius"] = int(min(max(opts["radius"], 1), 256))
    return opts


def measure(mode, grid, res_m, opts, n, e, xp=np):
    """A mode's values over the tile and `e` pixels past it: (n + 2e)^2.
    LRM and local dominance are made for the tile alone (their ancestors are
    aligned to it) and edge-extended."""
    if mode in ("lrm", "localDominance"):
        return xp.pad(values(mode, grid, res_m, opts, n, xp), e, mode="edge")
    return values(mode, _Grown(grid, e), res_m, opts, n + 2 * e, xp)


def values(mode, grid, res_m, opts, n=256, xp=np):
    """One mode's values over a tile: (n, n) float32. `grid(halo)` is the
    padded elevation; `grid.ancestor(k)` the tile k levels up with a 1-pixel
    halo (LRM, local dominance); grid.z, grid.x, grid.y the tile."""
    if mode == "elevation":
        return grid(0).astype(xp.float32)
    if mode == "lrm":
        k = min(lrm_levels(float(opts["radius"])), grid.z)
        if k == 0:
            return xp.zeros((n, n), xp.float32)
        return lrm(grid(0), grid.ancestor(k), n, k, grid.x, grid.y, xp)
    if mode == "localDominance":
        levels = [(grid.ancestor(k), k) for k in ld_levels(opts, grid.z)]
        return kernels.local_dominance(grid(0), levels, n, grid.x, grid.y, res_m, xp)
    if mode == "graticules":
        from .overlays import graticule_mask
        m = xp.asarray(graticule_mask(grid.z, grid.x, grid.y, n, float(opts["density"]), float(opts["width"])))
        return xp.where(m > 0, m, xp.nan).astype(xp.float32)  # the stroke's coverage, NaN off it
    if mode == "buildingShadows":
        from .buildings import lit
        return xp.asarray(lit(grid.z, grid.x, grid.y, n, opts["azimuth"], opts["altitude"]))
    if mode == "planeSlicer":
        if opts["reference"] == "lrm":
            return values("lrm", grid, res_m, {"radius": opts["lrmRadius"]}, n, xp)
        return grid(0).astype(xp.float32)
    if mode == "isoline":
        return isoline(grid, res_m, opts, n, xp)
    if mode == "moundDetector":
        raise ValueError("the mound detector is served by the tile service only")
    p = grid(halo_of(mode, opts))
    if mode == "hillshade":
        return hillshade(p, res_m, opts["azimuth"], opts["altitude"], opts["exaggeration"], xp)
    if mode == "multihillshade":
        return multidirectional(p, res_m, opts["altitude"], opts["exaggeration"], xp)
    if mode == "slope":
        return v_slope(p, res_m, xp)
    if mode == "aspect":
        return v_aspect(p, res_m, xp)
    if mode == "curvature":
        return v_curvature(p, res_m, opts["mode"], xp)
    if mode == "shapeIndex":
        return v_curvature(p, res_m, "shape-index", xp)
    if mode in ("blobness", "eigenRatio", "orientation"):
        t = kernels.structure_tensor(p, res_m, xp)
        if mode == "blobness":  # natural units: the app's / 100, as the tile service's values
            return (kernels.blobness(*t, xp=xp) / 100.0).astype(xp.float32)
        if mode == "eigenRatio":
            return (kernels.eigen_ratio(*t, xp=xp) / 100.0).astype(xp.float32)
        return kernels.orientation(*t, xp=xp).astype(xp.float32)
    if mode == "tpi":
        return v_tpi(p, xp)
    if mode == "tri":
        return v_tri(p, xp)
    if mode == "roughness":
        return v_roughness(p, xp)
    if mode == "svf":
        return horizon(p, n, int(opts["radius"]), res_m, 1.0, "svf", xp) / 100.0
    if mode == "openness":
        sign = -1.0 if opts["mode"] == "negative" else 1.0
        return (90.0 - horizon(p, n, int(opts["radius"]), res_m, sign, "openness", xp)).astype(xp.float32)
    if mode == "shadows":
        d_row, d_col = sun_step(opts["azimuth"])
        s = shadow(p, n, int(opts["radius"]), d_row, d_col, res_m, math.radians(opts["altitude"]), xp)
        return xp.where(s, 0.0, 1.0).astype(xp.float32)
    if mode == "contours":
        return contour_mask(p, float(opts["minor"]), float(opts["major"]), xp)
    if mode == "phong":
        return phong(p, res_m, opts["azimuth"], opts["altitude"], opts["diffuse"], opts["specular"], opts["fresnel"],
                     opts["fresnelPower"], opts["exaggeration"], xp)
    if mode == "matcap":
        from .textures import matcap_texture
        return matcap(p, res_m, matcap_texture(opts["texture"]), opts["rotation"], opts["exaggeration"], xp)
    raise ValueError(f"unknown mode {mode}")


def isoline(grid, res_m, opts, n=256, xp=np):
    """The iso-line as a raster (IsolineLayers.tsx): the measure, blurred by
    `smooth` pixels, traced at `value` (the pixels where it crosses, on the
    upper side, and the lower one too when `weight` is 2 px or more; `fill`:
    the area at or above it) or every `interval`. 2 on the line, 1 in the
    fill, NaN elsewhere."""
    m, mo, s, e = _iso(opts)
    v = measure(m, grid, res_m, mo, n, e, xp).astype(xp.float64)
    if s:
        v = kernels.box_blur(v, s, xp)
    both = float(opts["weight"]) >= 2
    with np.errstate(invalid="ignore"):
        if opts["at"] == "value":
            k = (v >= float(opts["value"])).astype(xp.int8)
        else:
            k = xp.floor(v / max(float(opts["interval"]), 1e-9))
        line = kernels.crossing_mask(k, both, xp)[e - 1:e - 1 + n, e - 1:e - 1 + n]
        out = xp.full((n, n), xp.nan, xp.float32)
        if opts["at"] == "value" and opts["fill"]:
            out[v[e:e + n, e:e + n] >= float(opts["value"])] = 1.0
    out[line] = 2.0
    return out


def plane_side(v, opts, xp=np):
    """The plane slicer's side: where the measure (the elevation or its
    LRM) lies below or above the plane (lib/layer-paints.ts
    computePlaneSlicerPaint)."""
    value = float(opts["valueLrm"] if opts["reference"] == "lrm" else opts["value"])
    with np.errstate(invalid="ignore"):
        return v < value if opts["side"] == "below" else v > value


def grey(mode, v, xp=np):
    """Values -> (n, n) uint8 grey: shading as is, the others stretched over
    the mode's range (reversed where the ramp is), the masks dark on white."""
    spec = MODES[mode]
    if mode == "planeSlicer":
        return xp.where(plane_side(v, MODES[mode]["defaults"], xp), 60, 255).astype(xp.uint8)
    if spec["kind"] == "mask":
        return xp.where(xp.isnan(v), 255, xp.where(v >= 2, 60, 140)).astype(xp.uint8)
    if spec["kind"] == "rgb":
        return (xp.clip(v.mean(axis=-1), 0, 1) * 255 + 0.5).astype(xp.uint8)
    lo, hi = spec["range"] or (float(xp.nanmin(v)), float(xp.nanmax(v)))
    g = xp.clip((v - lo) * (255.0 / max(hi - lo, 1e-9)), 0, 255)
    if spec.get("invert") and spec.get("ramp") != "Greys":
        g = 255 - g
    return xp.nan_to_num(g, nan=255).astype(xp.uint8)


MASK_COLOURS = {1.0: (120, 72, 40), 2.0: (70, 40, 20)}  # minor, major: the values layer's palette
_STOPS_LUTS = {}


def stops_lut(mode):
    """The app ramp of a mode with `stops`, sampled: (256, 4) uint8."""
    lut = _STOPS_LUTS.get(mode)
    if lut is None:
        from .overlays import stops_lut as sample
        spec = MODES[mode]
        lut = _STOPS_LUTS[mode] = sample(spec["stops"], *spec["range"], discrete=spec.get("discrete", False))
    return lut


def colour(mode, v, opts, lut=None, xp=np):
    """Values -> the colour tile: (n, n) uint8 grey for the shades (drawn
    multiplied), (n, n, 3) uint8 RGB through `lut` ((256, 3) uint8, the
    mode's QGIS colour ramp sampled; grey when None) over the mode's range,
    (n, n, 4) RGBA through the app's ramp for the modes with `stops`, RGBA
    for the masks (clear off the lines), the picture itself for matcap."""
    spec = MODES[mode]
    if spec["kind"] in ("rgb", "shade"):
        return (xp.clip(v, 0, 1) * 255 + 0.5).astype(xp.uint8)
    if spec.get("stops"):
        from .overlays import through_lut
        return through_lut(v, stops_lut(mode), *spec["range"], xp=xp)
    if mode in ("planeSlicer", "graticules", "isoline"):
        from .overlays import hex_rgb, solid
        rgb = hex_rgb(opts["color"])
        if mode == "planeSlicer":
            return solid(plane_side(v, opts, xp), rgb, float(opts["opacity"]), xp)
        if mode == "graticules":
            out = solid(~xp.isnan(v), rgb, 1.0, xp)
            out[..., 3] = (xp.nan_to_num(v, nan=0.0) * 255 + 0.5).astype(xp.uint8)
            return out
        out = solid(v == 1.0, rgb, float(opts["fillOpacity"]), xp)
        out[v == 2.0] = tuple(rgb) + (230,)  # the line at 0.9
        return out
    if spec["kind"] == "mask":
        out = xp.zeros(v.shape + (4,), xp.uint8)
        for value, rgb in MASK_COLOURS.items():
            out[v == value] = rgb + (255,)
        return out
    lo, hi = (opts["min"], opts["max"]) if mode == "elevation" else spec["range"]
    g = xp.nan_to_num(xp.clip((v - lo) * (255.0 / max(hi - lo, 1e-9)), 0, 255), nan=0)
    if lut is None:
        return g.astype(xp.uint8)
    return lut[g.astype(xp.intp)]


class PaddedGrid:
    """grid(halo) over one padded array already in memory (tests, bench);
    `ancestors` {k: (n + 2)^2} for LRM and local dominance."""

    def __init__(self, padded, n=256, z=0, x=0, y=0, ancestors=None):
        self.padded, self.n, self.z, self.x, self.y = padded, n, z, x, y
        self.h = (padded.shape[0] - n) // 2
        self.ancestors = ancestors or {}

    def __call__(self, halo):
        h, n = self.h, self.n
        return self.padded[h - halo:h + n + halo, h - halo:h + n + halo]

    def ancestor(self, k):
        return self.ancestors[k]


def render(mode, padded, n, res_m, opts, xp=np):
    """A mode's grey image from one padded grid (every mode but elevation and LRM)."""
    o = dict(MODES[mode]["defaults"])
    o.update(opts)
    return grey(mode, values(mode, PaddedGrid(padded, n), res_m, o, n, xp), xp)
