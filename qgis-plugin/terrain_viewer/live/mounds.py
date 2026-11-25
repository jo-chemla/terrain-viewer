"""The mound detector (lib/tells-protocol.ts), ported: candidates of tell
mounds (and pits) in one tile of the source's own pyramid, as the tile
service's moundDetector vector tiles carry them.

  A: a difference of two low-passes of the elevation, the source's tile
     one pyramid level up (kSmall) minus kLarge levels up (the radius's
     octave, as LRM's), both read bilinear with the half-pixel recentring
     of lib/lrm-protocol.ts, over the tile and a one-pixel ring (Float32,
     as the app keeps it).
  candidates: strict 3x3 extrema of A past the relief threshold (maxima:
     mounds; minima: pits), the strongest first, at most 2000; then greedy
     non-maximum suppression within half the tell size.
  vetoes, each on its own: structure-tensor blobness (D), plan convexity
     (-plan curvature, clipped at 0: C), determinant of the Hessian (F), on
     the kSmall low-pass ("coarse", the default) or the tile's own pixels
     ("fine"), a pit on the flipped surface.
  measures: a (relief), blobness, plan, detHessian, pit, and with
     measureScale the diameter at half the peak (median of 8 rays through A).

The tile is the source's own (a 512 px Mapterhorn tile at its zoom), like
the protocol's: the same pixels, the same candidates. No data (NaN) is a
hole, as the app's paddedValid. Pure numpy over the Dem's native tiles."""
import math

import numpy as np

from .dem import EARTH_CIRCUMFERENCE_M

DEFAULTS = {"polarity": "mounds", "size": 100.0, "radius": 4.0, "minRelief": 1.5, "blobnessMin": 0.0, "planMin": 0.0,
            "detHessianMin": 0.0, "measureScale": True, "vetoResolution": "coarse"}
MAX_CANDIDATES = 2000
EXTENT = 4096
RAY_DIRS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
BLOBNESS_SCALE = 100 / 64


def radius_to_levels(radius_px):
    """lib/lrm-protocol.ts radiusToLevels."""
    return min(6, max(1, int(math.floor(math.log2(max(2.0, radius_px)) + 0.5))))


def ground_resolution(z, y, n):
    lat = math.atan(math.sinh(math.pi - 2 * math.pi * (y + 0.5) / (1 << z)))
    return EARTH_CIRCUMFERENCE_M * math.cos(lat) / (n * (1 << z))


def native_padded(dem, z, x, y, halo=1):
    """The source's own tile z/x/y (its size n) and `halo` pixels of its
    neighbours: (n + 2 halo)^2 float32 (x wraps, y clamped to the world)."""
    n = dem.spec["size"]
    w = 1 << z
    futs = {(dy, dx): dem.pool.submit(dem._native, z, (x + dx) % w, min(max(y + dy, 0), w - 1))
            for dy in (-1, 0, 1) for dx in (-1, 0, 1)}
    mosaic = np.empty((3 * n, 3 * n), np.float32)
    for (dy, dx), f in futs.items():
        mosaic[(dy + 1) * n:(dy + 2) * n, (dx + 1) * n:(dx + 2) * n] = f.result()
    return mosaic[n - halo:2 * n + halo, n - halo:2 * n + halo]


class _Ancestor:
    """A tile k levels up (its 1-pixel padded grid) read at the fine tile's
    pixels (fetchAncestorScale, lowpassAt)."""

    def __init__(self, dem, z, x, y, k, n):
        levels = min(k, z)
        self.scale = 1 << levels
        ax, ay = x >> levels, y >> levels
        self.xo, self.yo = x - (ax << levels), y - (ay << levels)
        self.grid = native_padded(dem, z - levels, ax, ay, 1).astype(np.float64)
        self.n = n

    def _pos(self, rows, cols):
        py = (self.yo * self.n + rows + 0.5) / self.scale - 0.5 + 1
        px = (self.xo * self.n + cols + 0.5) / self.scale - 0.5 + 1
        return px, py

    def sample(self, rows, cols):
        """bilinearSamplePadded at the fine pixels (rows, cols), broadcast."""
        px, py = self._pos(np.asarray(rows, np.float64), np.asarray(cols, np.float64))
        g, last = self.grid, self.grid.shape[0] - 1
        x0, y0 = np.floor(px), np.floor(py)
        fx, fy = px - x0, py - y0
        x0, y0 = x0.astype(np.intp), y0.astype(np.intp)
        cx0, cx1 = np.clip(x0, 0, last), np.clip(x0 + 1, 0, last)
        cy0, cy1 = np.clip(y0, 0, last), np.clip(y0 + 1, 0, last)
        return (g[cy0, cx0] * (1 - fx) * (1 - fy) + g[cy0, cx1] * fx * (1 - fy)
                + g[cy1, cx0] * (1 - fx) * fy + g[cy1, cx1] * fx * fy)

    def valid(self, rows, cols):
        """bilinearValidPadded: the four pixels blended are data."""
        px, py = self._pos(np.asarray(rows, np.float64), np.asarray(cols, np.float64))
        last = self.grid.shape[0] - 1
        x0, y0 = np.floor(px).astype(np.intp), np.floor(py).astype(np.intp)
        cx0, cx1 = np.clip(x0, 0, last), np.clip(x0 + 1, 0, last)
        cy0, cy1 = np.clip(y0, 0, last), np.clip(y0 + 1, 0, last)
        ok = ~np.isnan(self.grid)
        return ok[cy0, cx0] & ok[cy0, cx1] & ok[cy1, cx0] & ok[cy1, cx1]


def _blobness(sample, res):
    """computeBlobness: the structure tensor of the 3x3 Horn gradients around
    the point (a 5x5 window), det / trace x 100 / 64."""
    inv = 1.0 / res
    sxx = syy = sxy = 0.0
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            gx = (sample(dr - 1, dc - 1) + 2 * sample(dr, dc - 1) + sample(dr + 1, dc - 1)
                  - (sample(dr - 1, dc + 1) + 2 * sample(dr, dc + 1) + sample(dr + 1, dc + 1))) * inv
            gy = (sample(dr + 1, dc - 1) + 2 * sample(dr + 1, dc) + sample(dr + 1, dc + 1)
                  - (sample(dr - 1, dc - 1) + 2 * sample(dr - 1, dc) + sample(dr - 1, dc + 1))) * inv
            sxx += gx * gx
            syy += gy * gy
            sxy += gx * gy
    ixx, iyy, ixy = sxx / 9, syy / 9, sxy / 9
    tr = ixx + iyy
    if tr < 1e-9:
        return 0.0
    return (ixx * iyy - ixy * ixy) / tr * BLOBNESS_SCALE


def _second(w, L):
    p = (w[5] - w[3]) / (2 * L)
    q = (w[7] - w[1]) / (2 * L)
    r = (w[5] - 2 * w[4] + w[3]) / (L * L)
    t = (w[7] - 2 * w[4] + w[1]) / (L * L)
    s = (w[2] - w[0] - w[8] + w[6]) / (4 * L * L)
    return p, q, r, t, s


def _plan(w, L):
    p, q, r, t, s = _second(w, L)
    g = p * p + q * q
    if g < 1e-12:
        return 0.0
    return 100 * (r * q * q - 2 * s * p * q + t * p * p) / math.pow(g, 1.5)


def _det_hessian(w, L):
    _p, _q, r, t, s = _second(w, L)
    return (r * t - s * s) * 10000


def _half_max_radius(a_grid, halo, row, col, a, valid):
    sgn = -1.0 if a < 0 else 1.0
    peak = sgn * a
    half = peak / 2
    pr, pc = row + halo, col + halo
    stride = a_grid.shape[0]
    crossings = []
    for dr, dc in RAY_DIRS:
        step = math.hypot(dr, dc)
        prev = peak
        s = 1
        while True:
            r, c = pr + dr * s, pc + dc * s
            if r < 0 or r >= stride or c < 0 or c >= stride:
                break
            if valid is not None and not valid[r, c]:
                break
            v = sgn * float(a_grid[r, c])
            if v < half:
                crossings.append((s - 1 + (prev - half) / (prev - v)) * step)
                break
            prev = v
            s += 1
    if not crossings:
        return None
    crossings.sort()
    m = len(crossings) >> 1
    return crossings[m] if len(crossings) % 2 else (crossings[m - 1] + crossings[m]) / 2


def _r(x, d):
    """Math.round(x * 10^d) / 10^d."""
    k = 10 ** d
    return math.floor(x * k + 0.5) / k


def detect(dem, z, x, y, opts=None):
    """The candidates of the source's tile z/x/y: [(col + 0.5, row + 0.5 in
    the tile's pixels (its size n), {a, blobness, plan, detHessian, pit[,
    scaleM]})], in the protocol's order, and n."""
    o = dict(DEFAULTS)
    o.update(opts or {})
    n = dem.spec["size"]
    res = ground_resolution(z, y, n)
    k_small = 1
    k_large = min(6, max(k_small + 1, radius_to_levels(float(o["radius"]))))
    small = _Ancestor(dem, z, x, y, k_small, n)
    large = _Ancestor(dem, z, x, y, k_large, n)
    fine = o["vetoResolution"] == "fine"
    native_halo = 2
    native = native_padded(dem, z, x, y, native_halo).astype(np.float64) if fine else None

    halo = 1
    idx = np.arange(-halo, n + halo)
    rows, cols = idx[:, None], idx[None, :]
    a_grid = (small.sample(rows, cols) - large.sample(rows, cols)).astype(np.float32)
    holes = bool(np.isnan(small.grid).any() or np.isnan(large.grid).any() or (native is not None and np.isnan(native).any()))
    valid = (small.valid(rows, cols) & large.valid(rows, cols)) if holes else None
    if valid is not None:
        a_grid = np.where(valid, a_grid, np.float32(0))  # a hole decodes as 0 in the app; never trusted below

    want_mounds = o["polarity"] != "pits"
    want_pits = o["polarity"] != "mounds"
    min_relief = float(o["minRelief"])
    c = a_grid[1:-1, 1:-1].astype(np.float64)
    mound = (c >= min_relief) if want_mounds else np.zeros_like(c, bool)
    pit = (c <= -min_relief) & ~mound if want_pits else np.zeros_like(c, bool)
    ok_m, ok_p = mound.copy(), pit.copy()
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            nb = a_grid[1 + dr:1 + dr + n, 1 + dc:1 + dc + n].astype(np.float64)
            if valid is not None:
                v = valid[1 + dr:1 + dr + n, 1 + dc:1 + dc + n]
                ok_m &= v
                ok_p &= v
            if dr == 0 and dc == 0:
                continue
            ok_m &= ~(nb > c)
            ok_p &= ~(nb < c)
    cand_mask = ok_m | ok_p
    # The protocol's scan stops at the row where it holds 4 x MAX_CANDIDATES.
    per_row = cand_mask.sum(axis=1)
    cum = np.cumsum(per_row)
    stop = int(np.searchsorted(cum >= MAX_CANDIDATES * 4, True)) + 1 if (cum >= MAX_CANDIDATES * 4).any() else n
    rr, cc = np.nonzero(cand_mask[:stop])
    av = c[rr, cc].astype(np.float32).astype(np.float64)
    order = sorted(range(len(av)), key=lambda i: -abs(av[i]))[:MAX_CANDIDATES]

    nms = max(1.0, (float(o["size"]) * 0.5) / res)
    nms_sq = nms * nms
    accepted = []
    for i in order:
        r0, c0 = int(rr[i]), int(cc[i])
        if any((r0 - ar) ** 2 + (c0 - ac) ** 2 < nms_sq for ar, ac, _ in accepted):
            continue
        accepted.append((r0, c0, float(av[i])))

    out = []
    for row, col, a in accepted:
        sgn = -1.0 if a < 0 else 1.0
        if holes:
            if fine:
                win = native[row:row + 5, col:col + 5]
                touches = bool(np.isnan(win).any())
            else:
                dd = np.arange(-2, 3)
                touches = not bool(small.valid(row + dd[:, None], col + dd[None, :]).all())
            if touches:
                continue
        if fine:
            def sample(dr, dc, row=row, col=col, sgn=sgn):
                return sgn * native[row + native_halo + dr, col + native_halo + dc]
        else:
            dd = np.arange(-2, 3)
            win = small.sample(row + dd[:, None], col + dd[None, :])

            def sample(dr, dc, win=win, sgn=sgn):
                return sgn * win[dr + 2, dc + 2]
        blob = _blobness(sample, res)
        if blob < float(o["blobnessMin"]):
            continue
        w = [sample(-1, -1), sample(-1, 0), sample(-1, 1), sample(0, -1), sample(0, 0), sample(0, 1),
             sample(1, -1), sample(1, 0), sample(1, 1)]
        plan_convexity = max(0.0, -_plan(w, res))
        if plan_convexity < float(o["planMin"]):
            continue
        det = _det_hessian(w, res)
        if det < float(o["detHessianMin"]):
            continue
        tags = {"a": _r(abs(a), 2), "blobness": _r(blob, 2), "plan": _r(plan_convexity, 2), "detHessian": _r(det, 3),
                "pit": 1 if sgn < 0 else 0}
        if o["measureScale"]:
            hm = _half_max_radius(a_grid, halo, row, col, a, valid)
            if hm is not None:
                tags["scaleM"] = math.floor(2 * hm * res + 0.5)
        out.append((col + 0.5, row + 0.5, tags))
    return out, n


def tile_points(dem, z, x, y, opts=None):
    """detect() as the vector tile writes it: positions in tile units
    (extent 4096, rounded)."""
    feats, n = detect(dem, z, x, y, opts)
    return [(int(math.floor(cx / n * EXTENT + 0.5)), int(math.floor(cy / n * EXTENT + 0.5)), t) for cx, cy, t in feats]
