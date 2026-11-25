"""The same kernels as kernels.py, as loops compiled by numba when it is
importable (QGIS does not ship it: `available` is False then). Line for line
the JavaScript of lib/horizon-kernel.ts and lib/shadow-kernel.ts; prange over
rows for hillshade and SVF, the shadow sweep parallel over sheared columns."""
import math

import numpy as np

try:
    from numba import njit, prange
    available = True
except Exception:  # noqa: BLE001 - numba missing or broken
    available = False

if available:
    @njit(parallel=True, fastmath=True, cache=False)
    def hillshade(p, res_m, azimuth_deg, altitude_deg, exaggeration):
        n = p.shape[0] - 2
        out = np.empty((n, n), np.float32)
        zen = math.radians(90.0 - altitude_deg)
        az = math.radians(azimuth_deg)
        lx, ly, lz = math.sin(az) * math.sin(zen), math.cos(az) * math.sin(zen), math.cos(zen)
        k = exaggeration / (8.0 * res_m)
        for r in prange(n):
            for c in range(n):
                a, b, cc = p[r, c], p[r, c + 1], p[r, c + 2]
                d, f = p[r + 1, c], p[r + 1, c + 2]
                g, h, i = p[r + 2, c], p[r + 2, c + 1], p[r + 2, c + 2]
                dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) * k
                dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) * k
                s = (lz - lx * dzdx + ly * dzdy) / math.sqrt(1.0 + dzdx * dzdx + dzdy * dzdy)
                out[r, c] = min(max(s, 0.0), 1.0)
        return out

    @njit(parallel=True, fastmath=True, cache=False)
    def svf(p, n, radius_px, res_m, offs_r, offs_c, inv_d, starts):
        out = np.empty((n, n), np.float32)
        nd = starts.shape[0] - 1
        for r in prange(n):
            for c in range(n):
                centre = p[r + radius_px, c + radius_px]
                acc = 0.0
                for d in range(nd):
                    best = 0.0
                    for j in range(starts[d], starts[d + 1]):
                        t = (p[r + radius_px + offs_r[j], c + radius_px + offs_c[j]] - centre) * inv_d[j]
                        if t > best:
                            best = t
                    acc += best / math.sqrt(1.0 + best * best)
                out[r, c] = (1.0 - acc / nd) * 100.0
        return out

    @njit(parallel=True, cache=False)
    def _sweep(P, n, halo, sa, b, drop, J, c_min, n_cols, out):
        """out (n, n) in (major, minor) coordinates. Each sheared column is an
        independent 1-D sliding maximum: parallel over columns."""
        T = n - 1 + J
        last = P.shape[1] - 1
        i_down = halo if sa > 0 else halo + n - 1
        win = np.full((n, n_cols), -1e30, np.float32)
        for j in prange(n_cols):
            g = np.empty(T, np.float32)
            pre = np.empty(T, np.float32)
            for k in range(T):
                t = k + 1
                s = b * t
                fl = math.floor(s)
                f = s - fl
                m0 = c_min + j + int(fl)
                m1 = m0 + 1
                if m0 < 0:
                    m0 = 0
                    m1 = 0
                else:
                    if m1 > last:
                        m1 = last
                    if m0 > last:
                        m0 = last
                maj = i_down + sa * t
                h0 = P[maj, m0]
                v = h0 + (P[maj, m1] - h0) * f - t * drop
                g[k] = v
                if k % J == 0 or v > pre[k - 1]:
                    pre[k] = v
                else:
                    pre[k] = pre[k - 1]
            suf = -1e30
            for k in range(T - 1, -1, -1):
                v = g[k]
                if k == T - 1 or k % J == J - 1 or v > suf:
                    suf = v
                if k < n:
                    pk = pre[k + J - 1]
                    win[k, j] = pk if pk > suf else suf
        for ui in prange(n):
            u = np.int64(ui)  # prange's index is unsigned: int64 - uint64 would be float64
            p = u if sa > 0 else n - 1 - u
            s = -b * u
            f0 = math.floor(s)
            f = s - f0
            base = halo + int(f0) - c_min
            rise = u * drop
            for q in range(n):
                w0 = win[u, base + q]
                cast = w0 + (win[u, base + q + 1] - w0) * f + rise
                out[p, q] = cast > P[halo + p, halo + q]

    def shadow(padded, n, halo, d_row, d_col, res_m, altitude_rad):
        from .kernels import shadow as np_shadow  # same set-up; numba only for the sweep
        stride = padded.shape[0]
        if altitude_rad >= math.pi / 2:
            return np.zeros((n, n), np.bool_)
        row_major = abs(d_row) >= abs(d_col)
        a = d_row if row_major else d_col
        if a == 0:
            return np.zeros((n, n), np.bool_)
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
                return np.zeros((n, n), np.bool_)
            J = min(J, int(math.floor((top - low) / drop)))
        if J <= 0:
            return np_shadow(padded, n, halo, d_row, d_col, res_m, altitude_rad)
        P = np.ascontiguousarray(padded if row_major else padded.T)
        span = -b * (n - 1)
        c_min = int(math.floor(halo + min(0.0, span)))
        c_max = int(math.floor(halo + n - 1 + max(0.0, span))) + 1
        out = np.zeros((n, n), np.bool_)
        _sweep(P, n, halo, sa, b, drop, J, c_min, c_max - c_min + 1, out)
        return out if row_major else out.T


def svf_rays(radius_px, res_m):
    """The 8 directions' (row, col) offsets and 1/distance, flattened."""
    from .kernels import _DIRS
    rr_l, rc_l, inv_l, starts = [], [], [], [0]
    for d_row, d_col in _DIRS:
        seen = set()
        for r in range(1, radius_px + 1):
            rr, rc = round(r * d_row), round(r * d_col)
            if (rr, rc) in seen or (rr == 0 and rc == 0):
                continue
            seen.add((rr, rc))
            rr_l.append(rr)
            rc_l.append(rc)
            inv_l.append(1.0 / (math.sqrt(rr * rr + rc * rc) * res_m))
        starts.append(len(rr_l))
    return (np.array(rr_l, np.int64), np.array(rc_l, np.int64), np.array(inv_l, np.float32), np.array(starts, np.int64))
