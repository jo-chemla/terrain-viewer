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


def horizon(padded, n, radius_px, res_m, sign=1.0, aggregate="svf", xp=np):
    """lib/horizon-kernel.ts computeHorizonRows, "precise": per direction the
    steepest elevation-to-distance ratio over every pixel of the radius.
    aggregate "svf": sky view factor in percent, 100 (1 - mean sin(max(angle, 0)));
    "openness": the mean signed horizon angle, in degrees (openness is 90
    minus it). sign -1: the terrain flipped (negative openness)."""
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
            inv = sign / (math.sqrt(rr * rr + rc * rc) * res_m)
            view = padded[r0 + rr:r0 + rr + n, r0 + rc:r0 + rc + n]
            xp.subtract(view, centre, out=tmp)
            tmp *= inv
            xp.maximum(best, tmp, out=best)
        if aggregate == "svf":
            # sin(atan(t)) = t / sqrt(1 + t^2), with t clamped at 0 (horizon below).
            t = xp.maximum(best, 0.0)
            acc += t / xp.sqrt(1.0 + t * t)
        else:
            acc += xp.arctan(best)
    if aggregate == "svf":
        return ((1.0 - acc / DIRECTIONS) * 100.0).astype(xp.float32)
    return (xp.degrees(acc / DIRECTIONS)).astype(xp.float32)


FAR_SUB_ANGLES = (-0.3, 0.0, 0.3)


def _bilinear_padded(g, px, py, xp=np):
    """lib/horizon-kernel.ts bilinear: (px, py) in the tile's own pixels of a
    1-pixel padded grid, clamped."""
    gx, gy = px + 1, py + 1
    x0, y0 = xp.floor(gx), xp.floor(gy)
    fx, fy = gx - x0, gy - y0
    last = g.shape[0] - 1
    x0, y0 = x0.astype(xp.intp), y0.astype(xp.intp)
    cx0, cx1 = xp.clip(x0, 0, last), xp.clip(x0 + 1, 0, last)
    cy0, cy1 = xp.clip(y0, 0, last), xp.clip(y0 + 1, 0, last)
    return (g[cy0, cx0] * (1 - fx) * (1 - fy) + g[cy0, cx1] * fx * (1 - fy)
            + g[cy1, cx0] * (1 - fx) * fy + g[cy1, cx1] * fx * fy)


def horizon_fast(padded, n, radius_px, near_px, res_m, sign=1.0, aggregate="svf", far=(), xp=np):
    """lib/horizon-kernel.ts computeHorizonRows, "fast": within `near_px`
    (padded's halo) only the radii 1, 2, 4, ... and the near radius itself;
    past it, per octave ring (`far`: [(ancestor (m + 2)^2, scale, x offset
    in tiles, y offset, distance m)]) the ancestor read bilinear at each
    direction and two directions 0.3 rad either side, the steepest of the
    three. Same aggregates as horizon()."""
    r0 = near_px
    centre = padded[r0:r0 + n, r0:r0 + n].astype(xp.float64)
    steps = []
    r = 1
    while r <= near_px:
        steps.append(r)
        r *= 2
    if steps and steps[-1] != near_px:
        steps.append(near_px)
    rows = xp.arange(n, dtype=xp.float64)[:, None]
    cols = xp.arange(n, dtype=xp.float64)[None, :]
    acc = xp.zeros((n, n), xp.float64)
    for d_row, d_col in _DIRS:
        best = xp.full((n, n), -xp.inf, xp.float64)
        for r in steps:
            rr, rc = round(r * d_row), round(r * d_col)
            dist = math.sqrt(rr * rr + rc * rc) * res_m
            if dist == 0:
                continue
            view = padded[r0 + rr:r0 + rr + n, r0 + rc:r0 + rc + n]
            best = xp.maximum(best, (view - centre) * (sign / dist))
        ang = xp.where(xp.isinf(best), 0.0, xp.arctan(best))
        for g, scale, xo, yo, dist_m in far:
            ax = (xo * n + cols + 0.5) / scale - 0.5
            ay = (yo * n + rows + 0.5) / scale - 0.5
            best_d = xp.full((n, n), -xp.inf, xp.float64)
            for spread in FAR_SUB_ANGLES:
                ca, sa = math.cos(spread), math.sin(spread)
                sr, sc = d_row * ca + d_col * sa, d_col * ca - d_row * sa
                v = _bilinear_padded(g, ax + sc, ay + sr, xp)
                best_d = xp.maximum(best_d, (v - centre) * sign)
            ang = xp.maximum(ang, xp.where(xp.isinf(best_d), -xp.inf, xp.arctan(best_d / dist_m)))
        if aggregate == "svf":
            acc += xp.sin(xp.maximum(ang, 0.0))
        else:
            acc += ang
    if aggregate == "svf":
        return ((1.0 - acc / DIRECTIONS) * 100.0).astype(xp.float32)
    return xp.degrees(acc / DIRECTIONS).astype(xp.float32)


def svf(padded, n, radius_px, res_m, xp=np):
    """padded: (n + 2 r)^2 -> (n, n) float32, sky view factor in percent."""
    return horizon(padded, n, radius_px, res_m, 1.0, "svf", xp)


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


# ---------------------------------------------------------------- structure tensor
def _box3(a):
    """The 3x3 sum of every inner pixel: (m + 2)^2 -> (m, m), separable."""
    r = a[:-2] + a[1:-1] + a[2:]
    return r[:, :-2] + r[:, 1:-1] + r[:, 2:]


def structure_tensor(padded, res_m, xp=np):
    """lib/blobness-protocol.ts: the Horn gradient (x = west - east,
    y = south - north, not / 8) at every pixel of the tile and its one-pixel
    ring, computed once into two grids, then the 3x3-box means of gx^2,
    gy^2 and gx gy. Float64, as the app keeps its gradient grids.
    (n + 4)^2 -> three (n, n)."""
    p = padded.astype(xp.float64)
    inv = 1.0 / res_m
    l, c, r = p[:, :-2], p[:, 1:-1], p[:, 2:]
    gx = ((l[:-2] + 2 * l[1:-1] + l[2:]) - (r[:-2] + 2 * r[1:-1] + r[2:])) * inv
    gy = ((l[2:] + 2 * c[2:] + r[2:]) - (l[:-2] + 2 * c[:-2] + r[:-2])) * inv
    return _box3(gx * gx) / 9, _box3(gy * gy) / 9, _box3(gx * gy) / 9


BLOBNESS_SCALE = 100 / 64  # lib/blobness-protocol.ts: undoes Horn's x8 on a degree-2 quantity, then x100


def blobness(ixx, iyy, ixy, xp=np):
    """det(J) / trace(J) x BLOBNESS_SCALE (the app's units: its ramp's
    0-50), 0 where the trace is under 1e-9."""
    tr = ixx + iyy
    flat = tr < 1e-9
    v = (ixx * iyy - ixy * ixy) / xp.where(flat, 1.0, tr) * BLOBNESS_SCALE
    return xp.where(flat, 0.0, v)


def eigen_ratio(ixx, iyy, ixy, xp=np):
    """lambda_min / lambda_max x 100 (0 an edge, 100 isotropic), 0 on flat ground."""
    tr = ixx + iyy
    disc = xp.sqrt((ixx - iyy) * (ixx - iyy) + 4 * ixy * ixy)
    lmax, lmin = (tr + disc) / 2, (tr - disc) / 2
    ok = (tr >= 1e-9) & (lmax > 1e-12)
    return xp.where(ok, lmin / xp.where(ok, lmax, 1.0) * 100, 0.0)


def orientation(ixx, iyy, ixy, xp=np):
    """The dominant eigenvector's axis as a compass bearing folded to 0-180:
    the axis along which the elevation changes most (across a ridge, not
    along it). Horn's x and y are both the opposite of east and north and
    the tensor is quadratic in them, so nothing is mirrored: 90 minus the
    math angle is the bearing (lib/blobness-protocol.test.ts)."""
    tr = ixx + iyy
    math_deg = 0.5 * xp.degrees(xp.arctan2(2 * ixy, ixx - iyy))
    v = xp.mod(xp.mod(90.0 - math_deg, 180.0) + 180.0, 180.0)
    return xp.where(tr < 1e-9, 0.0, v)


# ---------------------------------------------------------------- local dominance
OBSERVER_HEIGHT_M = 1.6
_LD_DIRS = [(math.sin(2 * math.pi * i / 8), math.cos(2 * math.pi * i / 8)) for i in range(8)]


def octave_of(radius_px):
    """lib/local-dominance-protocol.ts radiusToOctave."""
    return min(6, max(1, round(math.log2(max(2.0, radius_px)))))


def _taps(g, last):
    """Bilinear taps of fractional grid positions: the two clamped indices
    and the weight, clamped as lib/local-dominance-kernel.ts does."""
    i0 = np.floor(g).astype(np.int64)
    return np.clip(i0, 0, last), np.clip(i0 + 1, 0, last), g - i0


def local_dominance(centre, levels, n, x, y, res_m, xp=np):
    """lib/local-dominance-kernel.ts: the mean, over 8 directions and one ring
    per octave, of the angle down from an observer 1.6 m above the pixel to
    the terrain one coarse pixel away on the ancestor tile k levels up
    (bilinear, LRM's half-pixel recentring), in degrees. centre (n, n), the
    tile's own elevations; levels [(padded (n + 2)^2, k)]. The weights of a
    column (a row) are the same down the tile, so the bilinear read is
    separable: across, on the whole ancestor once per distinct column step
    (five of the eight directions' steps differ), then down. Same weights
    and clamps as the app's; the sum is ordered differently (1e-12 m). The
    arctangent stays in float64: numpy's float32 one measured twice as slow."""
    obs = centre.astype(xp.float64) + OBSERVER_HEIGHT_M
    acc = xp.zeros((n, n), xp.float64)
    tmp = xp.empty((n, n), xp.float64)
    idx = np.arange(n)
    for a, k in levels:
        scale = 1 << k
        xo, yo = x - ((x >> k) << k), y - ((y >> k) << k)
        pcx = (xo * n + idx + 0.5) / scale - 0.5
        pcy = (yo * n + idx + 0.5) / scale - 0.5
        inv = 1.0 / (scale * res_m)
        a = a.astype(xp.float64)
        last = a.shape[0] - 1
        across = {}
        for d_row, d_col in _LD_DIRS:
            key = round(d_col, 12)
            ax = across.get(key)
            if ax is None:
                x0, x1, fx = _taps(pcx + d_col + 1, last)
                if xp is not np:
                    x0, x1, fx = map(xp.asarray, (x0, x1, fx))
                ax = across[key] = a[:, x0] * (1 - fx) + a[:, x1] * fx  # (n + 2, n)
            y0, y1, fy = _taps(pcy + d_row + 1, last)
            if xp is not np:
                y0, y1, fy = map(xp.asarray, (y0, y1, fy))
            fy = fy[:, None]
            # obs - (top (1 - fy) + bottom fy), in place
            xp.multiply(ax[y0], 1 - fy, out=tmp)
            tmp += ax[y1] * fy
            xp.subtract(obs, tmp, out=tmp)
            tmp *= inv
            acc += xp.arctan(tmp, out=tmp)
    count = len(levels) * len(_LD_DIRS)
    return (xp.degrees(acc / count) if count else acc).astype(xp.float32)


# ---------------------------------------------------------------- lines and blur
def box_blur(a, r, xp=np):
    """Separable mean over (2 r + 1)^2, the window cut at the grid's edges
    (lib/isoband-protocol.ts boxBlur; running sums here as cumulative sums)."""
    if r <= 0:
        return a
    out = a.astype(xp.float64)
    for axis in (0, 1):
        m = out.shape[axis]
        c = xp.cumsum(out, axis=axis)
        c = xp.concatenate([xp.zeros_like(xp.take(c, [0], axis=axis)), c], axis=axis)
        hi = np.minimum(np.arange(m) + r + 1, m)
        lo = np.maximum(np.arange(m) - r, 0)
        s = xp.take(c, hi, axis=axis) - xp.take(c, lo, axis=axis)
        cnt = (hi - lo).astype(np.float64)
        out = s / (cnt[:, None] if axis == 0 else cnt[None, :])
    return out


def crossing_mask(k, both_sides=False, xp=np):
    """Where the band index k changes between a pixel and one of its four
    neighbours: the pixel on the upper side (both_sides: the lower one too,
    a line two pixels wide). k (m + 2)^2 -> (m, m) bool."""
    c = k[1:-1, 1:-1]
    on = xp.zeros(c.shape, bool)
    for nb in (k[:-2, 1:-1], k[2:, 1:-1], k[1:-1, :-2], k[1:-1, 2:]):
        on |= nb < c
        if both_sides:
            on |= nb > c
    return on


