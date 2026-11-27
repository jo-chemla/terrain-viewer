"""The hillshade picture as the tile service draws it: MapLibre's two shader
passes (tile-server/direct.mjs, maplibre-gl 6 hillshade_prepare and
hillshade fragment shaders), fed with the paint the app computes from its
settings (lib/layer-paints.ts computeHillshadePaint): every method
(standard, combined, igor, basic, multidirectional, multidir-colors,
duotone-nw-ne, aspect-multidir), the shadow, highlight and accent colours,
the exaggeration.

The prepare pass works on the source's own grid: its Sobel sums times
MapLibre's zoom factor (from the source zoom and tile size, so a 512 px
pyramid at z-1 and live/'s 256 px tile at z give the same numbers), kept in
an 8-bit texture; the shading pass divides by cos(latitude) per output row.
Over the map's white background (a shading layer is multiplied in QGIS, as
the service's picture is)."""
import math

import numpy as np

from .ramps import rgba

METHODS = ("standard", "combined", "igor", "basic", "multidirectional", "multidir-colors", "duotone-nw-ne",
           "aspect-multidir")
PI = math.pi


def paint(method="combined", azimuth=315.0, altitude=45.0, shadow="#000000", highlight="#FFFFFF", accent="#808080",
          exaggeration=1.0, opacity=1.0):
    """computeHillshadePaint, then hillshadeUniforms: the uniforms MapLibre
    reads (angles in radians, colours premultiplied 0-1)."""
    p = {}
    if method == "multidir-colors":
        p = {"method": "multidirectional", "highlight": ["#FF4000", "#FFFF00", "#40ff00", "#00FF80"],
             "shadow": ["#00bfff", "#0000ff", "#bf00ff", "#FF0080"], "dir": [270, 315, 0, 45], "alt": [30, 30, 30, 30]}
    elif method == "duotone-nw-ne":
        p = {"method": "multidirectional", "highlight": ["#FFFFFF", "#4A90D9"], "shadow": ["#000000", "#B8692E"],
             "dir": [315, 45], "alt": [35, 35]}
    elif method == "aspect-multidir":
        p = {"method": "multidirectional", "highlight": ["#CC0000", "#0000CC"], "shadow": ["#00CCCC", "#CCCC00"],
             "dir": [0, 270], "alt": [30, 30]}
    else:
        lit = method in ("standard", "combined", "igor", "basic")
        if lit:
            p["dir"] = [float(azimuth)]
            r, g, b, _a = rgba(shadow)
            p["shadow"] = [(r, g, b, float(opacity))]
            r, g, b, _a = rgba(highlight)
            p["highlight"] = [(r, g, b, float(opacity))]
        if method in ("combined", "basic"):
            p["alt"] = [90 - (90 - float(altitude)) / 6.28 if method == "basic" else float(altitude)]
        p["exaggeration"] = float(exaggeration)
        if method == "standard":
            p["accent"] = accent
        p["method"] = method if method != "standard" else "standard"
    dirs = p.get("dir", [335])
    n = len(dirs)

    def pad(arr, d):
        arr = arr or [d]
        return [arr[i] if i < len(arr) else arr[-1] for i in range(n)]

    def premult(c):
        r, g, b, a = rgba(c)
        return (r / 255 * a, g / 255 * a, b / 255 * a, a)

    u = {"method": p.get("method", "standard"), "exaggeration": p.get("exaggeration", 0.5),
         "azimuths": [math.radians(d) for d in dirs], "altitudes": [math.radians(a) for a in pad(p.get("alt"), 45)],
         "shadows": [premult(c) for c in pad(p.get("shadow"), "#000000")],
         "highlights": [premult(c) for c in pad(p.get("highlight"), "#FFFFFF")],
         "accent": premult(p.get("accent", "#000000"))}
    u["scaledDen"] = math.pow(1.875 - u["exaggeration"] * 1.75, 0.5 * PI) - 1
    return u


def _round(x):
    return np.floor(x + 0.5)  # JavaScript's Math.round


def prepare(padded, zd, side):
    """MapLibre's prepare pass over a (n + 2)^2 elevation grid at the source's
    zoom `zd` and tile size `side`: (dx, dy), (n, n), 8-bit quantised."""
    factor = 0.4 if zd < 2 else 0.35 if zd < 4.5 else 0.3
    exag = (zd - 15) * factor if zd < 15 else 0
    scale = side / math.pow(2, exag + (28.2562 - zd))
    e = padded.astype(np.float64)
    a, b, c = e[:-2, :-2], e[:-2, 1:-1], e[:-2, 2:]
    d, f = e[1:-1, :-2], e[1:-1, 2:]
    g, h, nn = e[2:, :-2], e[2:, 1:-1], e[2:, 2:]

    def q8(v):
        return (_round(np.clip(v / 8 + 128 / 255, 0, 1) * 255) / 255 - 128 / 255) * 8

    return q8((c + f + f + nn - (a + d + d + g)) * scale), q8((g + h + h + nn - (a + b + b + c)) * scale)


def _aspect(x, y):
    return np.where(x != 0, np.arctan2(y, -x), (PI / 2) * np.where(y > 0, 1.0, -1.0))


def _mod(a, n):
    return a - n * np.floor(a / n)


def shade(u, dx, dy):
    """The fragment shader on arrays: premultiplied RGBA 0-1, (n, n, 4)."""
    ex = u["exaggeration"]
    dt = dx.dtype  # float32 from picture() (half the time of float64, the same 8-bit picture)
    S = [np.array(c, dt) for c in u["shadows"]]
    H = [np.array(c, dt) for c in u["highlights"]]
    out = np.zeros(dx.shape + (4,), dt)
    if u["method"] == "standard":
        azimuth = u["azimuths"][0] + PI
        slope = np.arctan(0.625 * np.hypot(dx, dy))
        base = 1.875 - ex * 1.75
        scaled = (np.power(base, slope) - 1) / u["scaledDen"] * (0.5 * PI) if ex != 0.5 else slope
        k = min(1.0, max(0.0, ex * 2))
        sh = np.abs(_mod((_aspect(dx, dy) + azimuth) / PI + 0.5, 2) - 1)
        s = np.sin(scaled) * k
        S0, H0, A = S[0], H[0], np.array(u["accent"], dt)
        col = (S0 + (H0 - S0) * sh[..., None]) * s[..., None]
        ak = (1 - np.cos(scaled)) * k * (1 - col[..., 3])
        return A * ak[..., None] + col
    dx, dy = dx * ex * 2, dy * ex * 2
    length = np.hypot(dx, dy)
    if u["method"] == "igor":
        azimuth = u["azimuths"][0] + PI
        slope_strength = np.arctan(length) * 2 / PI
        aspect_strength = 1 - np.abs(_mod((_aspect(dx, dy) + azimuth) / PI + 0.5, 2) - 1)
        out += S[0] * (slope_strength * aspect_strength)[..., None]
        out += H[0] * (slope_strength * (1 - aspect_strength))[..., None]
    elif u["method"] == "multidirectional":
        n = len(u["azimuths"])
        for i in range(n):
            ca, sa = math.cos(u["altitudes"][i]), math.sin(u["altitudes"][i])
            cz, sz = -math.cos(u["azimuths"][i]), -math.sin(u["azimuths"][i])
            s = np.clip((sa - (dy * cz * ca - dx * sz * ca)) / np.sqrt(1 + length * length), 0, 1)
            hi = s > 0.5
            out += np.where(hi[..., None], H[i] * ((2 * s - 1) / n)[..., None], S[i] * ((1 - 2 * s) / n)[..., None])
    else:
        azimuth = u["azimuths"][0] + PI
        cz, sz = math.cos(azimuth), math.sin(azimuth)
        ca, sa = math.cos(u["altitudes"][0]), math.sin(u["altitudes"][0])
        c = (sa - (dy * cz * ca - dx * sz * ca)) / np.sqrt(1 + length * length)
        if u["method"] == "basic":
            s = np.clip(c, 0, 1)
            hi = s > 0.5
            out += np.where(hi[..., None], H[0] * (2 * s - 1)[..., None], S[0] * (1 - 2 * s)[..., None])
        else:  # combined
            cang = np.clip(np.arccos(np.clip(c, -1, 1)), 0, PI / 2)
            k = np.arctan(length) * 4 / PI / PI
            out += S[0] * (cang * k)[..., None]
            out += H[0] * ((PI / 2 - cang) * k)[..., None]
    return out


def picture(padded, z, y, n, native_size=256, opts=None, background=(1.0, 1.0, 1.0)):
    """The hillshade of a 256 px tile z/x/y as the tile service draws it over
    its white background: (n, n, 3) uint8. padded: (n + 2)^2 elevation;
    native_size: the source's tile size (its zoom is z - log2(size / 256))."""
    o = opts or {}
    u = paint(o.get("method", "combined"), o.get("azimuth", 315.0), o.get("altitude", 45.0), o.get("shadowColor", "#000000"),
              o.get("highlightColor", "#FFFFFF"), o.get("accentColor", "#808080"), o.get("exaggeration", 1.0))
    zd = z - round(math.log2(max(native_size, 256) / 256))
    dx, dy = prepare(padded, zd, native_size)  # float64: its 8-bit quantisation exactly as MapLibre's
    world = n * (1 << z)
    rows = y * n + np.arange(n) + 0.5
    cos_lat = np.cos(np.arctan(np.sinh(PI * (1 - 2 * rows / world))))[:, None]
    # The shading in float32: about half the time (it is most of a hillshade
    # tile, which the light pad redraws), the same 8-bit picture but for a
    # rare rounding at a half level.
    px = shade(u, (dx / cos_lat).astype(np.float32), (dy / cos_lat).astype(np.float32))
    bad = np.isnan(dx) | np.isnan(dy)
    px[bad] = 0
    a = px[..., 3:4]
    rgb = px[..., :3] + np.array(background, np.float32) * (1 - a)
    return _round(np.clip(rgb, 0, 1) * 255).astype(np.uint8)
