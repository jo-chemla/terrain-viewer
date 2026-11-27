"""The colour of the ramp modes, as the tile service colours them: the app's
own ramps (assets/colorramp_stops.json, lib/color-ramps.ts colorRampsFlat)
and its rules, ported:

- lib/mode-relief.ts MODE_RELIEF: which settings of a mode colour it (its
  ramp, min, max, invert, custom stops, aspect's shift), with the app's
  defaults (the URL reference's);
- lib/layer-paints.ts computeColorReliefPaint: the ramp's stops remapped
  onto [min, max] (customHypsoMinMax for the colour relief), the colours
  swapped end for end when inverted, a custom ramp built from its stops
  (held between them when discrete), aspect's cyclic shift, the hole stop
  at -10000 and the extra top stop;
- tile-server/direct.mjs rampOf: the stops packed in the tile's encoding
  (1/256 for Terrarium, 0.1 for slope's Terrain-RGB), the colours
  premultiplied and rounded to 8 bits, linear between the two stops around
  a value, held past the ends.

The ramp is written in the app's wire units: the values its protocols pack
in their tiles (blobness, eigenRatio and the sky view factor x100,
curvature x100000, shape index x1000, openness minus 90), which is what a
mode's min and max are in. live/'s values are natural units (the tile
service's .tif): wire() converts them before the ramp. One evaluation per
pixel, vectorised; nothing here needs QGIS."""
import json
import math
import os
import re

import numpy as np

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
_RAMPS = None

# lib/color-ramps.ts
DEFAULT_SLOPE_CUSTOM_STOPS = [(0, "#2ecc40"), (10, "#ffdc00"), (20, "#ff851b"), (35, "#ff4136")]
DEFAULT_SHAPE_INDEX_CUSTOM_STOPS = [(-1, "#2166ac"), (-0.5, "#92c5de"), (0, "#ffffff"), (0.5, "#f4a582"), (1, "#b2182b")]
DEM_HOLE_M = -10000.0
CURVATURE_ENCODE_SCALE = 1000.0

# The settings that colour each mode (lib/mode-relief.ts), by the tile
# service's mode id: (ramp, custom stops, discrete, min, max, invert, shift)
# and their defaults (docs/src/generated/url-params.json).
_DERIVED = ("slope", "aspect", "tri", "curvature", "tpi", "lrm", "roughness", "shapeIndex", "blobness", "eigenRatio",
            "orientation", "svf", "openness", "localDominance")
DEFAULTS = {
    "colorRelief": {"colorRamp": "mby", "customHypsoMinMax": False, "minElevation": 0.0, "maxElevation": 8100.0,
                    "invertColorRamp": False},
    "slope": {"slopeColorRamp": "slope-plantopo", "slopeMinDegrees": 0.0, "slopeMaxDegrees": 55.0},
    "aspect": {"aspectColorRamp": "aspect-compass", "aspectMinDegrees": 0.0, "aspectMaxDegrees": 360.0,
               "aspectShiftDegrees": 0.0},
    "tri": {"triColorRamp": "tri-default", "triMin": 0.0, "triMax": 50.0},
    "curvature": {"curvatureColorRamp": "curvature-diverging", "curvatureMin": -1.0, "curvatureMax": 1.0},
    "tpi": {"tpiColorRamp": "tpi-diverging", "tpiMin": -20.0, "tpiMax": 20.0},
    "lrm": {"lrmColorRamp": "lrm-diverging", "lrmMin": -20.0, "lrmMax": 20.0},
    "roughness": {"roughnessColorRamp": "roughness-default", "roughnessMin": 0.0, "roughnessMax": 50.0},
    "shapeIndex": {"shapeIndexColorRamp": "custom", "shapeIndexMin": -1.0, "shapeIndexMax": 1.0,
                   "shapeIndexCustomStopsDiscrete": True},
    "blobness": {"blobnessColorRamp": "blobness-default", "blobnessMin": 0.0, "blobnessMax": 50.0},
    "eigenRatio": {"eigenRatioColorRamp": "eigen-ratio-default", "eigenRatioMin": 0.0, "eigenRatioMax": 100.0},
    "orientation": {"orientationColorRamp": "orientation-default", "orientationMin": 0.0, "orientationMax": 180.0},
    "svf": {"svfColorRamp": "svf-default", "svfMin": 0.0, "svfMax": 100.0},
    "openness": {"opennessColorRamp": "openness-default", "opennessMin": -15.0, "opennessMax": 15.0},
    "localDominance": {"localDominanceColorRamp": "local-dominance-default", "localDominanceMin": -5.0,
                       "localDominanceMax": 15.0},
}
for _m in _DERIVED:
    DEFAULTS[_m].setdefault(f"{_m}InvertColorRamp", False)
    DEFAULTS[_m].setdefault(f"{_m}CustomStopsDiscrete", False)
    DEFAULTS[_m][f"{_m}CustomStops"] = None  # None: the default stops of the mode (below)


def colour_keys(service_mode):
    """The service parameters that colour a mode (the ramp settings), or ()."""
    return tuple(DEFAULTS.get(service_mode, {}))


def _bounds_keys(m):
    if m in ("slope", "aspect"):
        return f"{m}MinDegrees", f"{m}MaxDegrees"
    return f"{m}Min", f"{m}Max"


# -- the ramps -------------------------------------------------------------------
def ramps():
    """{id: [(value, "#rrggbbaa")]}, read once from the packaged assets."""
    global _RAMPS
    if _RAMPS is None:
        try:
            with open(os.path.join(ASSETS, "colorramp_stops.json"), encoding="utf-8") as f:
                _RAMPS = {k: [(float(v), c) for v, c in s] for k, s in json.load(f)["ramps"].items()}
        except (OSError, ValueError, KeyError):
            _RAMPS = {}
    return _RAMPS


_HEX = re.compile(r"#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$")


def rgba(c):
    """A colour as (r, g, b 0-255, a 0-1): "#rrggbb[aa]", "#rgb",
    "rgb(...)", "rgba(...)", or a tuple (r, g, b[, a])."""
    if isinstance(c, (tuple, list)):
        return (float(c[0]), float(c[1]), float(c[2]), float(c[3]) if len(c) > 3 else 1.0)
    s = str(c).strip()
    if re.fullmatch(r"#[0-9a-fA-F]{3}", s):
        s = "#" + "".join(ch * 2 for ch in s[1:])
    m = _HEX.fullmatch(s)
    if m:
        h = m.group(1)
        a = int(m.group(2), 16) / 255 if m.group(2) else 1.0
        return (float(int(h[0:2], 16)), float(int(h[2:4], 16)), float(int(h[4:6], 16)), a)
    m = re.fullmatch(r"rgba?\(([^)]*)\)", s)
    if m:
        p = [x for x in re.split(r"[\s,/]+", m.group(1)) if x]
        a = 1.0 if len(p) < 4 else (float(p[3][:-1]) / 100 if p[3].endswith("%") else float(p[3]))
        return (float(p[0]), float(p[1]), float(p[2]), a)
    return (0.0, 0.0, 0.0, 1.0)


def _rgb_fn(c):
    """lib/color-ramps.ts parseRgbColor, as shiftCyclicRampStops reads a
    colour: rgb()/rgba() only, anything else black (the app's own rule: a
    hex ramp shifted reads black; the default aspect-compass is rgb())."""
    if isinstance(c, (tuple, list)):
        return rgba(c)
    m = re.search(r"rgba?\(([^)]+)\)", str(c))
    if not m:
        return (0.0, 0.0, 0.0, 1.0)
    p = [float(x.strip()) for x in m.group(1).split(",")]
    return (p[0] if len(p) > 0 else 0.0, p[1] if len(p) > 1 else 0.0, p[2] if len(p) > 2 else 0.0,
            p[3] if len(p) > 3 else 1.0)


def custom_stops(raw, default):
    """Custom stops from a setting: a list of {value, color} or (value,
    color), or its JSON (the app's URL form); the default when unreadable
    (parseAsCustomRampStops)."""
    if raw is None or raw == "":
        return list(default)
    try:
        v = json.loads(raw) if isinstance(raw, str) else raw
        out = [(float(s["value"]), s["color"]) if isinstance(s, dict) else (float(s[0]), s[1]) for s in v]
    except (ValueError, TypeError, KeyError, IndexError):
        return list(DEFAULT_SLOPE_CUSTOM_STOPS)
    return out


def build_custom(stops, discrete=False):
    """buildCustomRampColors: [(value, colour)] sorted, held between the stops
    when discrete (a pair a hair apart at each boundary)."""
    usable = sorted(stops, key=lambda s: s[0])
    if len(usable) < 2:
        usable = list(DEFAULT_SLOPE_CUSTOM_STOPS)
    if not discrete:
        return [(float(v), c) for v, c in usable]
    gaps = [usable[i][0] - usable[i - 1][0] for i in range(1, len(usable))]
    min_gap = min(gaps) if gaps else math.inf
    eps = min(1e-3, min_gap / 1000) if math.isfinite(min_gap) and min_gap > 0 else 1e-3
    out = [(float(usable[0][0]), usable[0][1])]
    for i in range(1, len(usable)):
        out.append((float(usable[i][0]) - eps, usable[i - 1][1]))
        out.append((float(usable[i][0]), usable[i][1]))
    return out


def remap(colors, lo, hi, invert=False):
    """remapColorRampStops: the stops stretched from the ramp's own range onto
    [lo, hi] (unchanged when either is flat or missing), the colours swapped
    end for end when inverted."""
    vals = [v for v, _ in colors]
    rmin, rmax = min(vals), max(vals)
    if rmax == rmin:
        return list(colors)
    lo = lo if lo is not None and math.isfinite(lo) else rmin
    hi = hi if hi is not None and math.isfinite(hi) else rmax
    if hi == lo:
        return list(colors)
    out = [(lo + (v - rmin) / (rmax - rmin) * (hi - lo), c) for v, c in colors]
    if invert:
        cols = [c for _, c in out]
        n = len(cols)
        for i in range(int(n / 2 + 0.5) if n % 2 else n // 2):  # the app's loop: i < n / 2
            cols[i], cols[n - 1 - i] = cols[n - 1 - i], cols[i]
        out = [(v, c) for (v, _), c in zip(out, cols)]
    return out


def shift_cyclic(colors, shift, dmin=0.0, dmax=360.0):
    """shiftCyclicRampStops: the ramp rotated round [dmin, dmax] by `shift`."""
    period = dmax - dmin
    if not period or not shift:
        return list(colors)
    n = len(colors)
    if n < 2:
        return list(colors)
    cols = [_rgb_fn(c) for _, c in colors]
    k = ((shift % period) + period) % period
    cand = sorted(((v - k + tile, col) for (v, _), col in zip(colors, cols) for tile in (-period, 0.0, period)),
                  key=lambda t: t[0])

    def colour_at(pos):
        for i in range(len(cand) - 1):
            if cand[i][0] <= pos <= cand[i + 1][0]:
                span = cand[i + 1][0] - cand[i][0]
                t = 0.0 if span == 0 else (pos - cand[i][0]) / span
                return tuple(a + (b - a) * t for a, b in zip(cand[i][1], cand[i + 1][1]))
        return cand[0][1]

    points = [(dmin, colour_at(dmin))] + [c for c in cand if dmin < c[0] < dmax] + [(dmax, colour_at(dmax))]
    seen, out = set(), []
    for pos, col in points:
        key = round(pos * 1000)
        if key in seen:
            continue
        seen.add(key)
        r, g, b, a = col  # formatRgbColor: rounded channels, alpha to 4 decimals
        out.append((pos, (round(r), round(g), round(b), 1.0 if a >= 1 else round(a, 4))))
    return out


def _with_top_stop(colors):
    if len(colors) < 2:
        return colors
    last, before = colors[-1][0], colors[-2][0]
    if last - before >= 0.25:
        return colors
    return colors + [(last + 0.25, colors[-1][1])]


def _with_hole_stop(colors):
    if len(colors) < 2 or colors[0][0] <= DEM_HOLE_M + 1:
        return colors
    return [(DEM_HOLE_M, (0, 0, 0, 0.0)), (DEM_HOLE_M + 0.5, colors[0][1])] + colors


def relief_paint(color_ramp, custom=None, custom_discrete=False, custom_hypso_min_max=False, lo=0.0, hi=8100.0,
                 invert=False, shift=0.0):
    """computeColorReliefPaint's colour stops, [(value, colour)], or None
    when the ramp is unknown."""
    if color_ramp == "custom":
        base = build_custom(custom if custom is not None else DEFAULT_SLOPE_CUSTOM_STOPS, custom_discrete)
        vals = [v for v, _ in base]
        dmin, dmax = min(vals), max(vals)
        colors = remap(base, dmin, dmax, True) if invert else base
        if shift:
            colors = shift_cyclic(colors, shift, dmin, dmax)
        return _with_top_stop(_with_hole_stop(colors))
    base = ramps().get(color_ramp)
    if not base:
        return None
    colors = remap(base, lo, hi, invert) if custom_hypso_min_max else list(base)
    if shift:
        colors = shift_cyclic(colors, shift, lo if lo is not None else 0.0, hi if hi is not None else 360.0)
    return _with_top_stop(_with_hole_stop(colors))


# -- a mode's settings -> its paint ----------------------------------------------
def _num(v, d):
    try:
        f = float(v)
        return f if math.isfinite(f) else d
    except (TypeError, ValueError):
        return d


def _bool(v):
    return v if isinstance(v, bool) else str(v).strip().lower() in ("1", "true", "yes", "on")


def state_of(service_mode, settings):
    """The colour settings of a mode over their defaults (raw values typed)."""
    s = dict(DEFAULTS.get(service_mode, {}))
    for k, v in (settings or {}).items():
        if k not in s or v is None:
            continue
        d = s[k]
        if isinstance(d, bool):
            s[k] = _bool(v)
        elif isinstance(d, float):
            s[k] = _num(v, d)
        else:
            s[k] = v
    return s


def mode_paint(service_mode, settings=None):
    """lib/mode-relief.ts MODE_RELIEF then computeColorReliefPaint: the colour
    stops of a mode, in its wire units, from its (service-named) settings;
    None when the mode is not a ramp mode or its ramp unknown."""
    if service_mode not in DEFAULTS:
        return None
    s = state_of(service_mode, settings)
    if service_mode == "colorRelief":
        return relief_paint(s["colorRamp"], None, False, s["customHypsoMinMax"], s["minElevation"], s["maxElevation"],
                            s["invertColorRamp"])
    m = service_mode
    lo_k, hi_k = _bounds_keys(m)
    lo, hi = s[lo_k], s[hi_k]
    default_stops = DEFAULT_SHAPE_INDEX_CUSTOM_STOPS if m == "shapeIndex" else DEFAULT_SLOPE_CUSTOM_STOPS
    stops = custom_stops(s[f"{m}CustomStops"], default_stops)
    if m in ("curvature", "shapeIndex"):  # the protocol's x1000 on the wire, and on the bounds and stops
        stops = [(v * CURVATURE_ENCODE_SCALE, c) for v, c in stops]
        lo, hi = lo * CURVATURE_ENCODE_SCALE, hi * CURVATURE_ENCODE_SCALE
    return relief_paint(s[f"{m}ColorRamp"], stops, s[f"{m}CustomStopsDiscrete"], True, lo, hi,
                        s[f"{m}InvertColorRamp"], s["aspectShiftDegrees"] if m == "aspect" else 0.0)


# natural = wire * a + b (tile-server/direct.mjs VALUE_MODES `to`), and the
# encoding the protocol packs the wire value in.
def wire_of(service_mode, curvature_mode="combined"):
    """(a, b, encoding): natural = wire * a + b."""
    if service_mode == "curvature":
        a = {"shape-index": 1 / 1000, "det-hessian": 1 / 1e7}.get(curvature_mode, 1 / 1e5)
        return a, 0.0, "terrarium"
    return {"shapeIndex": (1 / 1000, 0.0, "terrarium"), "blobness": (0.01, 0.0, "terrarium"),
            "eigenRatio": (0.01, 0.0, "terrarium"), "svf": (0.01, 0.0, "terrarium"),
            "openness": (1.0, 90.0, "terrarium"), "slope": (1.0, 0.0, "mapbox")}.get(service_mode, (1.0, 0.0, "terrarium"))


def to_wire(v, service_mode, curvature_mode="combined", quantise=True, xp=np):
    """Natural values -> the app's wire values, packed as its protocol packs
    them (lib/elevation-encoding.ts: Terrarium floors to 1/256, Terrain-RGB
    to 0.1) when `quantise`."""
    a, b, enc = wire_of(service_mode, curvature_mode)
    w = (v.astype(xp.float64) - b) / a
    if not quantise:
        return w
    # The service samples the decoded values from a Float32 grid: a value on
    # a stop that two stops share (a discrete ramp's pair) falls below it.
    if enc == "mapbox":
        w = xp.floor((w + 10000) / 0.1) * 0.1 - 10000
    else:
        w = xp.floor((xp.clip(w, -32768, 32767.996) + 32768) * 256) / 256 - 32768
    return w.astype(xp.float32).astype(xp.float64)


def colour_stops(paint, encoding="terrarium"):
    """rampOf's tables: stops packed in the encoding, colours premultiplied
    and rounded to 8 bits. (values (n,), colours (n, 4) 0-1)."""
    step, shift = (0.1, 10000.0) if encoding == "mapbox" else (1 / 256, 32768.0)
    vals = np.array([round((v + shift) / step) * step - shift for v, _ in paint], np.float64)
    cols = []
    for _, c in paint:
        r, g, b, a = rgba(c)
        cols.append([round(r / 255 * a * 255) / 255, round(g / 255 * a * 255) / 255, round(b / 255 * a * 255) / 255,
                     round(a * 255) / 255])
    return vals, np.array(cols, np.float64)


def evaluate(wire, paint, encoding="terrarium", xp=np):
    """rampOf on an array of wire values: premultiplied RGBA 0-1, (..., 4);
    NaN values (no data) transparent."""
    vals, cols = colour_stops(paint, encoding)
    n = len(vals)
    out = xp.zeros(wire.shape + (4,), xp.float64)
    if n == 0:
        return out
    nan = xp.isnan(wire)
    w = xp.where(nan, vals[0], wire)
    if n == 1:
        out[...] = cols[0]
    else:
        vals_x, cols_x = (vals, cols) if xp is np else (xp.asarray(vals), xp.asarray(cols))
        lo = xp.clip(xp.searchsorted(vals_x, w, side="right") - 1, 0, n - 2)
        s0, s1 = vals_x[lo], vals_x[lo + 1]
        with np.errstate(invalid="ignore", divide="ignore"):
            t = (w - s0) / (s1 - s0)
        bad = xp.isnan(t)  # two stops packed to one value: the GPU reads transparent
        p = xp.clip(lo + xp.nan_to_num(t, nan=0.0), 0, n - 1)
        i = xp.floor(p).astype(xp.intp)
        f = (p - i)[..., None]
        out = cols_x[i] * (1 - f) + cols_x[xp.minimum(i + 1, n - 1)] * f
        out[bad] = 0
    out[nan] = 0
    return out


def premultiplied_to_rgba8(px, xp=np):
    """Premultiplied RGBA 0-1 -> straight RGBA uint8, as the tile service
    writes its PNG."""
    a = px[..., 3:4]
    rgb = xp.where(a > 0, xp.minimum(1.0, px[..., :3] / xp.where(a > 0, a, 1.0)), 0.0)
    return xp.concatenate([xp.round(rgb * 255), xp.round(xp.minimum(1.0, a) * 255)], axis=-1).astype(xp.uint8)


def colour(service_mode, v, settings=None, curvature_mode="combined", xp=np):
    """A ramp mode's colour tile from its natural values: (n, n, 4) uint8
    RGBA, transparent on no data; None when the mode has no ramp here."""
    paint = mode_paint(service_mode, settings)
    if paint is None:
        return None
    _a, _b, enc = wire_of(service_mode, curvature_mode)
    if service_mode == "colorRelief":
        enc = "terrarium"
    w = to_wire(v, service_mode, curvature_mode, xp=xp)
    return premultiplied_to_rgba8(evaluate(w, paint, enc, xp), xp)


def natural_stops(service_mode, settings=None, curvature_mode="combined"):
    """The mode's colour stops in natural units (what live/'s values and the
    Values layer are in): [(value, (r, g, b, a 0-1))], the hole stop left
    out (NaN is no data there). For QGIS's colour ramp shader."""
    paint = mode_paint(service_mode, settings)
    if paint is None:
        return None
    a, b, _enc = wire_of(service_mode, curvature_mode)
    return [(w * a + b, rgba(c)) for w, c in paint if w > DEM_HOLE_M + 1]
