"""Three of the app's terrain kernels, vectorised over a padded elevation grid
(the tile plus a halo, float32 metres). Written against an array module `xp`
(numpy by default; cupy runs the same code on the GPU).

- hillshade: Horn's 3x3 gradient (halo 1), the classic single-light shade.
- svf: sky view factor, lib/horizon-kernel.ts "precise": 8 directions, every
  pixel of the radius, max elevation angle per direction, 100 (1 - mean sin).
- shadow: lib/shadow-kernel.ts computeShadowTile, the shadow-height sweep:
  the grid sheared so the lines toward the sun are columns, a sliding window
  maximum by van Herk / Gil-Werman done as a block-wise cumulative maximum.
  The JavaScript runs it row by row; here every row of the sheared grid is one
  gather and the block scans are two `maximum.accumulate` calls.
"""
import math

import numpy as np

NONE = -1e30


def _cummax(xp, a, axis):
    acc = getattr(xp.maximum, "accumulate", None)
    if acc is not None:
        try:
            return acc(a, axis=axis)
        except (NotImplementedError, TypeError):
            pass
    # Hillis-Steele scan (log2 steps), for array modules without accumulate.
    a = xp.moveaxis(a.copy(), axis, 0)
    s = 1
    while s < a.shape[0]:
        a[s:] = xp.maximum(a[s:], a[:-s])
        s *= 2
    return xp.moveaxis(a, 0, axis)


# ---------------------------------------------------------------- hillshade
def hillshade(padded, res_m, azimuth_deg=315.0, altitude_deg=45.0, exaggeration=1.0, xp=np):
    """padded: (n + 2)^2 -> (n, n) float32 in [0, 1]."""
    p = padded
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    k = exaggeration / (8.0 * res_m)
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) * k
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) * k  # rows run south
    zen = math.radians(90.0 - altitude_deg)
    az = math.radians(azimuth_deg)
    # Light vector (east, north, up) against the normal (-dzdx, dzdy, 1).
    lx, ly, lz = math.sin(az) * math.sin(zen), math.cos(az) * math.sin(zen), math.cos(zen)
    shade = (lz - lx * dzdx + ly * dzdy) / xp.sqrt(1.0 + dzdx * dzdx + dzdy * dzdy)
    return xp.clip(shade, 0.0, 1.0).astype(xp.float32)


def slope_deg(padded, res_m, xp=np):
    p = padded
    k = 1.0 / (8.0 * res_m)
    dzdx = ((p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])) * k
    dzdy = ((p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])) * k
    return xp.degrees(xp.arctan(xp.sqrt(dzdx * dzdx + dzdy * dzdy))).astype(xp.float32)


# ---------------------------------------------------------------- sky view factor
DIRECTIONS = 8
_DIRS = [(math.sin(2 * math.pi * i / DIRECTIONS), math.cos(2 * math.pi * i / DIRECTIONS)) for i in range(DIRECTIONS)]


def svf(padded, n, radius_px, res_m, xp=np):
    """padded: (n + 2 r)^2 -> (n, n) float32, sky view factor in percent."""
    r0 = radius_px
    centre = padded[r0:r0 + n, r0:r0 + n]
    acc = xp.zeros((n, n), xp.float32)
    tmp = xp.empty((n, n), xp.float32)
    for d_row, d_col in _DIRS:
        best = xp.full((n, n), -xp.inf, xp.float32)
        seen = set()
        for r in range(1, radius_px + 1):
            rr, rc = round(r * d_row), round(r * d_col)
            if (rr, rc) in seen or (rr == 0 and rc == 0):
                continue  # same pixel, same tangent: the max cannot change
            seen.add((rr, rc))
            inv = 1.0 / (math.sqrt(rr * rr + rc * rc) * res_m)
            view = padded[r0 + rr:r0 + rr + n, r0 + rc:r0 + rc + n]
            xp.subtract(view, centre, out=tmp)
            tmp *= inv
            xp.maximum(best, tmp, out=best)
        # sin(atan(t)) = t / sqrt(1 + t^2), with t clamped at 0 (horizon below).
        t = xp.maximum(best, 0.0)
        acc += t / xp.sqrt(1.0 + t * t)
    return ((1.0 - acc / DIRECTIONS) * 100.0).astype(xp.float32)


# ---------------------------------------------------------------- shadows
def sun_step(azimuth_deg):
    """Unit step toward the sun in (row, col) pixels (lib/shadow-protocol.ts)."""
    az = math.radians(azimuth_deg)
    return -math.cos(az), math.sin(az)


def shadow(padded, n, halo, d_row, d_col, res_m, altitude_rad, xp=np):
    """padded: (n + 2 halo)^2 -> (n, n) bool, True in shadow. The sweep of
    lib/shadow-kernel.ts computeShadowTile, same reach and early exit."""
    stride = padded.shape[0]
    zero = xp.zeros((n, n), bool)
    if altitude_rad >= math.pi / 2:
        return zero
    row_major = abs(d_row) >= abs(d_col)
    a = d_row if row_major else d_col
    if a == 0:
        return zero
    sa = 1 if a > 0 else -1
    b = (d_col if row_major else d_row) / abs(a)
    step_len = math.hypot(1, b)
    drop = step_len * res_m * math.tan(altitude_rad)
    J = int(math.floor(halo / step_len + 1e-9))

    if drop > 0:
        reach_r, reach_c = math.ceil(halo * abs(d_row)), math.ceil(halo * abs(d_col))
        r0, r1 = (halo - reach_r, halo + n) if d_row < 0 else (halo, halo + n + reach_r)
        c0, c1 = (halo - reach_c, halo + n) if d_col < 0 else (halo, halo + n + reach_c)
        top = float(padded[max(0, r0 - 1):min(stride, r1 + 1), max(0, c0 - 1):min(stride, c1 + 1)].max())
        low = float(padded[halo:halo + n, halo:halo + n].min())
        if not top > low:
            return zero
        J = min(J, int(math.floor((top - low) / drop)))
    if J <= 0:
        return xp.full((n, n), altitude_rad < 0, bool)

    P = padded if row_major else padded.T  # (major, minor)
    i_down = halo if sa > 0 else halo + n - 1
    span = -b * (n - 1)
    c_min = int(math.floor(halo + min(0.0, span)))
    c_max = int(math.floor(halo + n - 1 + max(0.0, span))) + 1
    n_cols = c_max - c_min + 1
    T = n - 1 + J

    # The sheared grid g(t, c) = hs(t) - t drop, t = 1..T, every column at once.
    t = np.arange(1, T + 1)
    maj = i_down + sa * t
    s = b * t
    fl = np.floor(s).astype(np.int64)
    f = (s - fl).astype(np.float32)
    m0 = c_min + np.arange(n_cols)[None, :] + fl[:, None]
    m1 = m0 + 1
    neg = m0 < 0
    m0[neg] = 0
    m1[neg] = 0
    last = stride - 1
    np.minimum(m1, last, out=m1)
    np.minimum(m0, last, out=m0)
    if xp is not np:
        maj, m0, m1, f, tt = xp.asarray(maj), xp.asarray(m0), xp.asarray(m1), xp.asarray(f), xp.asarray(t)
    else:
        tt = t
    rows = maj[:, None]
    h0 = P[rows, m0]
    g = h0 + (P[rows, m1] - h0) * f[:, None] - (tt * drop).astype(xp.float32)[:, None]

    # Sliding maximum over (u, u + J]: prefix and suffix maxima per block of J
    # (blocks start at t = 1), window = max(suffix(u + 1), prefix(u + J)).
    Tp = -(-T // J) * J
    G = xp.full((Tp, n_cols), NONE, xp.float32)
    G[:T] = g
    B = G.reshape(Tp // J, J, n_cols)
    pre = _cummax(xp, B, 1).reshape(Tp, n_cols)
    suf = _cummax(xp, B[:, ::-1], 1)[:, ::-1].reshape(Tp, n_cols)
    win = xp.maximum(suf[:n], pre[J - 1:J - 1 + n])

    # Tile pixels: the window maximum between their two sheared columns, plus
    # u drop, against their own elevation.
    u = np.arange(n)
    su = -b * u
    f0 = np.floor(su).astype(np.int64)
    fu = (su - f0).astype(np.float32)
    cols = (halo + f0 - c_min)[:, None] + np.arange(n)[None, :]
    if xp is not np:
        cols, fu, uu = xp.asarray(cols), xp.asarray(fu), xp.asarray(u)
    else:
        uu = u
    ur = uu[:, None]
    w0 = win[ur, cols]
    cast = w0 + (win[ur, cols + 1] - w0) * fu[:, None] + (uu * drop).astype(xp.float32)[:, None]
    p = uu if sa > 0 else (n - 1 - uu)
    elev = P[(halo + p)[:, None], halo + xp.arange(n)[None, :]]
    shade = cast > elev  # (u, q): True in shadow
    if sa < 0:
        shade = shade[::-1]
    return shade if row_major else shade.T


# ---------------------------------------------------------------- one tile
DEFAULTS = {
    "hillshade": {"azimuth": 315.0, "altitude": 45.0, "exaggeration": 1.0},
    "slope": {},
    "svf": {"radius": 8, "min": 0.0, "max": 100.0},
    "shadows": {"azimuth": 315.0, "altitude": 45.0, "radius": 256, "darkness": 0.6},
}


def halo_of(mode, opts):
    if mode in ("hillshade", "slope"):
        return 1
    return int(opts["radius"])


def render(mode, padded, n, res_m, opts, xp=np):
    """-> (n, n) uint8 grey, opaque (the plugin multiplies shading layers)."""
    if mode == "hillshade":
        v = hillshade(padded, res_m, opts["azimuth"], opts["altitude"], opts["exaggeration"], xp) * 255.0
    elif mode == "slope":
        v = 255.0 - xp.clip(slope_deg(padded, res_m, xp) * (255.0 / 60.0), 0, 255)
    elif mode == "svf":
        lo, hi = float(opts["min"]), float(opts["max"])
        v = xp.clip((svf(padded, n, int(opts["radius"]), res_m, xp) - lo) * (255.0 / max(hi - lo, 1e-6)), 0, 255)
    elif mode == "shadows":
        d_row, d_col = sun_step(opts["azimuth"])
        s = shadow(padded, n, int(opts["radius"]), d_row, d_col, res_m, math.radians(opts["altitude"]), xp)
        v = xp.where(s, 255.0 * (1.0 - float(opts["darkness"])), 255.0)
    else:
        raise ValueError(f"unknown mode {mode}")
    return v.astype(xp.uint8)
