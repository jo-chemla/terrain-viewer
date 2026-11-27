"""The overlays that are not a value per pixel: the graticule, and the
colour helpers of the plane slicer, the iso-line and the app's own colour
ramps (stops). Vectorised over the tile; the graticule needs no elevation."""
import math

import numpy as np

WORLD = 20037508.342789244

# lib/graticule-density.ts
GEOGRID_DENSITY = {0: 30, 1: 15, 2: 10, 3: 7.5, 4: 5, 5: 3, 6: 2, 7: 1.5, 8: 0.75, 9: 0.5, 10: 0.25, 11: 0.125, 12: 0.075,
                   13: 0.05, 14: 0.025}


def nice_graticule_density(zoom):
    """lib/graticule-density.ts niceGraticuleDensity: the line spacing in
    degrees at a map zoom (512 px tiles), 90 / 2^n, halving each zoom."""
    z = max(0, math.floor(zoom))
    raw = GEOGRID_DENSITY[z] if z <= 14 else GEOGRID_DENSITY[14] / 2 ** (z - 14)
    n = max(0, round(math.log2(90 / raw)))
    return 90 / 2 ** n


def _lat_of(py, world):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / world))))


def _y_of(lat, world):
    return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * world


def graticule_mask(z, x, y, n=256, density=0.0, width=1.0):
    """(n, n) float32 coverage 0-1: the meridians and parallels every
    `density` degrees (0: the app's spacing for the zoom; a 256 px tile at z
    is map zoom z - 1), `width` pixels wide, as tile-server/direct.mjs
    graticuleSvg strokes them: the share of each pixel the stroke covers
    (antialiased; the lines nest with the tiles, so most fall on a pixel
    edge and half-cover the two pixels beside it, as in the app)."""
    world = n * (1 << z)
    x0, y0 = x * n, y * n
    step = density if density and density > 0 else nice_graticule_density(math.log2(world / 512))
    half = max(float(width), 0.1) / 2
    lo = np.arange(n, dtype=np.float64)  # pixel i spans [i, i + 1]

    def cover(at):  # [at - half, at + half] against each pixel
        return np.clip(np.minimum(lo + 1, at + half) - np.maximum(lo, at - half), 0.0, 1.0)

    cols = np.zeros(n)
    lng0 = ((x0 - half) / world) * 360 - 180
    lng1 = ((x0 + n + half) / world) * 360 - 180
    for k in range(math.ceil(lng0 / step), math.floor(lng1 / step) + 1):
        cols = np.maximum(cols, cover(((k * step + 180) / 360) * world - x0))
    rows = np.zeros(n)
    lat_lo, lat_hi = _lat_of(y0 + n + half, world), _lat_of(y0 - half, world)
    for k in range(math.ceil(lat_lo / step), math.floor(lat_hi / step) + 1):
        lat = k * step
        if abs(lat) < 85.06:
            rows = np.maximum(rows, cover(_y_of(lat, world) - y0))
    return np.maximum(rows[:, None], cols[None, :]).astype(np.float32)


def graticule_lines(extent3857, width_px, density=0.0):
    """The graticule over a view as [(wkb, kind, deg)] in EPSG:3857: the
    meridians and parallels every `density` degrees (0: the app's spacing
    at the view's zoom), each across the view."""
    from osgeo import ogr
    xmin, ymin, xmax, ymax = extent3857.xMinimum(), extent3857.yMinimum(), extent3857.xMaximum(), extent3857.yMaximum()
    world_px = width_px * (2 * WORLD) / max(xmax - xmin, 1e-9)
    step = density if density and density > 0 else nice_graticule_density(math.log2(world_px / 512))
    out = []
    lng0, lng1 = max(xmin, -WORLD) / WORLD * 180, min(xmax, WORLD) / WORLD * 180
    y_lo, y_hi = max(ymin, -WORLD), min(ymax, WORLD)
    k = math.ceil(lng0 / step)
    while k * step <= lng1 and len(out) < 2000:
        lng = k * step
        mx = lng / 180 * WORLD
        g = ogr.Geometry(ogr.wkbLineString)
        g.AddPoint_2D(mx, y_lo)
        g.AddPoint_2D(mx, y_hi)
        out.append((bytes(g.ExportToWkb()), "meridian", round(lng, 10)))
        k += 1
    lat_lo = math.degrees(math.atan(math.sinh(y_lo / 6378137.0)))
    lat_hi = math.degrees(math.atan(math.sinh(y_hi / 6378137.0)))
    k = math.ceil(lat_lo / step)
    while k * step <= lat_hi and len(out) < 4000:
        lat = k * step
        my = math.asinh(math.tan(math.radians(lat))) * 6378137.0
        g = ogr.Geometry(ogr.wkbLineString)
        g.AddPoint_2D(max(xmin, -WORLD), my)
        g.AddPoint_2D(min(xmax, WORLD), my)
        out.append((bytes(g.ExportToWkb()), "parallel", round(lat, 10)))
        k += 1
    return out


def vector_mem(name):
    """An in-memory OGR data source: GDAL's MEM driver from 3.11 (the
    Memory driver is deprecated there), Memory before."""
    from osgeo import gdal, ogr
    driver = "MEM" if int(gdal.VersionInfo()) >= 3110000 else "Memory"
    return ogr.GetDriverByName(driver).CreateDataSource(name)


def hex_rgb(colour, default=(0, 0, 0)):
    """'#rrggbb' (or 'rrggbb', '#rgb') -> (r, g, b)."""
    s = str(colour or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    try:
        return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4)) if len(s) >= 6 else default
    except ValueError:
        return default


def stops_lut(stops, lo, hi, discrete=False, steps=256):
    """An app colour ramp (lib/color-ramps.ts: [(value, (r, g, b, a))],
    alpha 0-1) sampled at `steps` values over [lo, hi]: (steps, 4) uint8.
    Continuous: linear between stops, held past the ends; discrete: each
    colour held up to the next stop (buildCustomRampColors's stepped form)."""
    vals = np.array([s[0] for s in stops], np.float64)
    cols = np.array([(r, g, b, a * 255.0) for _v, (r, g, b, a) in stops], np.float64)
    t = lo + (hi - lo) * np.arange(steps) / (steps - 1)
    if discrete:
        i = np.clip(np.searchsorted(vals, t, side="right") - 1, 0, len(vals) - 1)
        out = cols[i]
    else:
        out = np.stack([np.interp(t, vals, cols[:, c]) for c in range(4)], axis=-1)
    return (out + 0.5).astype(np.uint8)


def through_lut(v, lut, lo, hi, xp=np):
    """Values -> (n, n, 4) RGBA through a (steps, 4) LUT over [lo, hi], clear on NaN."""
    steps = lut.shape[0]
    g = xp.clip((v - lo) * ((steps - 1) / max(hi - lo, 1e-12)), 0, steps - 1)
    nan = xp.isnan(g)
    lut = lut if xp is np else xp.asarray(lut)
    out = lut[xp.nan_to_num(g, nan=0).round().astype(xp.intp)]
    out[nan] = 0
    return out


def solid(mask, rgb, alpha, xp=np):
    """(n, n, 4) RGBA: `rgb` at `alpha` (0-1) where mask, clear elsewhere."""
    out = xp.zeros(mask.shape + (4,), xp.uint8)
    out[mask] = tuple(rgb) + (int(round(min(max(alpha, 0.0), 1.0) * 255)),)
    return out
