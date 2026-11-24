"""Measures the grey -> metres stretch of a NASA G-LiHT DTM KMZ against the
campaign's Float32 GeoTIFF (docs/content/docs/dev/g-liht.mdx, "The PNGs
against the GeoTIFF").

    python scripts/gliht-stretch.py <campaign>_DTM.tif <campaign>_DTM.kmz [level-offset]

Download both first (no CORS for a script; never into the repository):
    https://glihtdata.gsfc.nasa.gov/files/G-LiHT/<c>/lidar/geotiff/<c>_DTM.tif.gz   (gunzip it)
    https://glihtdata.gsfc.nasa.gov/files/G-LiHT/<c>/lidar/kml/<c>_DTM.kmz

Every PNG tile of a level (the finest minus `level-offset`, 0 by default: the
1 m level, at most 2 000 pixels a tile) is compared with the GeoTIFF averaged
over each grey pixel's footprint: the pixel's centre is placed by the tile's
gx:LatLonQuad, projected to the GeoTIFF's CRS, and the raster is box-averaged
over the pixel's size there. Fitted: metres = lo + grey / 255 * (hi - lo),
on the pixels below 255 (255 is clipped). Printed as one JSON line: the
raster's min and 99.9th percentile, the fit (lo, hi), its RMSE and worst
residual, the same per tile (spread of lo and hi), the residual by grey band
(linearity) and the RMSE of the "min / p99.9" rule without a fit.

Needs numpy, rasterio and Pillow.
"""
import io
import json
import re
import sys
import zipfile

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform
from PIL import Image


def quad_of(kml: str):
    m = re.search(r"<(?:\w+:)?LatLonQuad>\s*<coordinates>([^<]+)</coordinates>", kml)
    if not m:
        return None
    pts = [tuple(map(float, t.split(",")[:2])) for t in m.group(1).split()]
    return np.array(pts[:4])  # lower left, lower right, upper right, upper left


def main(tif_path, kmz_path, offset=0):
    src = rasterio.open(tif_path)
    dem = src.read(1).astype(np.float32)
    if src.nodata is not None and not np.isnan(src.nodata):
        dem[dem == src.nodata] = np.nan
    dem[dem < -1000] = np.nan
    finite = dem[np.isfinite(dem)]
    stats = {
        "min": float(finite.min()), "max": float(finite.max()),
        "p99": float(np.percentile(finite, 99)), "p99.9": float(np.percentile(finite, 99.9)),
        "p99.99": float(np.percentile(finite, 99.99)),
    }
    inv = ~src.transform
    zf = zipfile.ZipFile(kmz_path)
    names = zf.namelist()
    levels = sorted({int(n.split("/")[0]) for n in names if re.match(r"^\d+/\d+/\d+\.png$", n)})
    max_level = levels[-1]
    level = max(0, max_level - offset)
    doc = zf.read("doc.kml").decode("utf8", "replace")
    # Anything that could carry the stretch: a non-empty description, data,
    # a legend. (GDAL writes an empty <description> and a list Style.)
    meta = bool(re.search(r"<description>\s*[^<\s]|<(ExtendedData|ScreenOverlay|Schema)", doc + zf.read("0/0/0.kml").decode("utf8", "replace")))

    gs, hs, tile_ids = [], [], []
    grey_min = 255
    for n in names:
        m = re.match(rf"^{level}/(\d+)/(\d+)\.png$", n)
        if not m:
            continue
        q = quad_of(zf.read(n[:-4] + ".kml").decode("utf8", "replace"))
        if q is None:
            continue
        img = np.asarray(Image.open(io.BytesIO(zf.read(n))).convert("RGBA"))
        h, w = img.shape[:2]
        on = img[:, :, 3] == 255
        if on.sum() < 50:
            continue
        grey_min = min(grey_min, int(img[:, :, 0][on].min()))
        jj, ii = np.nonzero(on)
        if len(jj) > 2000:
            pick = np.random.default_rng(len(gs)).choice(len(jj), 2000, replace=False)
            jj, ii = jj[pick], ii[pick]
        u = (ii + 0.5) / w
        v = 1 - (jj + 0.5) / h
        lon = (1 - u) * (1 - v) * q[0, 0] + u * (1 - v) * q[1, 0] + u * v * q[2, 0] + (1 - u) * v * q[3, 0]
        lat = (1 - u) * (1 - v) * q[0, 1] + u * (1 - v) * q[1, 1] + u * v * q[2, 1] + (1 - u) * v * q[3, 1]
        xs, ys = warp_transform("EPSG:4326", src.crs, lon.tolist(), lat.tolist())
        col, row = inv * (np.array(xs), np.array(ys))
        # The pixel's footprint in raster pixels: the quad's size over the PNG's.
        qx, qy = warp_transform("EPSG:4326", src.crs, q[:, 0].tolist(), q[:, 1].tolist())
        qc, qr = inv * (np.array(qx), np.array(qy))
        fx = np.hypot(qc[1] - qc[0], qr[1] - qr[0]) / w
        fy = np.hypot(qc[3] - qc[0], qr[3] - qr[0]) / h
        # Box average by an integral image over the tile's part of the raster.
        r0 = int(max(0, np.floor(row.min() - fy))); r1 = int(min(dem.shape[0], np.ceil(row.max() + fy) + 1))
        c0 = int(max(0, np.floor(col.min() - fx))); c1 = int(min(dem.shape[1], np.ceil(col.max() + fx) + 1))
        if r1 - r0 < 2 or c1 - c0 < 2:
            continue
        sub = dem[r0:r1, c0:c1]
        ok = np.isfinite(sub)
        S = np.zeros((sub.shape[0] + 1, sub.shape[1] + 1)); S[1:, 1:] = np.where(ok, sub, 0).cumsum(0).cumsum(1)
        C = np.zeros_like(S); C[1:, 1:] = ok.cumsum(0).cumsum(1)
        ra = np.clip(np.round(row - r0 - fy / 2).astype(int), 0, sub.shape[0]); rb = np.clip(np.round(row - r0 + fy / 2).astype(int), 0, sub.shape[0])
        ca = np.clip(np.round(col - c0 - fx / 2).astype(int), 0, sub.shape[1]); cb = np.clip(np.round(col - c0 + fx / 2).astype(int), 0, sub.shape[1])
        rb = np.maximum(rb, ra + 1); cb = np.maximum(cb, ca + 1)
        rb = np.minimum(rb, sub.shape[0]); cb = np.minimum(cb, sub.shape[1])
        area = (rb - ra) * (cb - ca)
        cnt = C[rb, cb] - C[ra, cb] - C[rb, ca] + C[ra, ca]
        tot = S[rb, cb] - S[ra, cb] - S[rb, ca] + S[ra, ca]
        full = (cnt == area) & (area > 0)
        # Away from the swath edge: all eight neighbours of the grey pixel on too.
        pad = np.pad(on, 1)
        inner = np.ones_like(on)
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                inner &= pad[1 + dj:1 + dj + h, 1 + di:1 + di + w]
        keep = full & inner[jj, ii]
        gs.append(img[:, :, 0][jj, ii][keep].astype(np.float64))
        hs.append((tot / np.maximum(cnt, 1))[keep])
        tile_ids.append(np.full(keep.sum(), len(tile_ids)))
    g = np.concatenate(gs); hgt = np.concatenate(hs); tid = np.concatenate(tile_ids)
    fit_on = g < 255

    def fit(gg, hh):
        b, a = np.polyfit(gg, hh, 1)
        return a, a + 255 * b

    lo, hi = fit(g[fit_on], hgt[fit_on])
    dec = lo + g / 255 * (hi - lo)
    res = (dec - hgt)[fit_on]
    # Per tile: tiles with enough pixels and grey range.
    per = []
    for t in np.unique(tid):
        s = (tid == t) & fit_on
        if s.sum() >= 300 and np.ptp(g[s]) >= 30:
            per.append(fit(g[s], hgt[s]))
    per = np.array(per) if per else np.zeros((0, 2))
    bands = []
    for b0 in range(0, 255, 51):
        s = fit_on & (g >= b0) & (g < b0 + 51)
        if s.sum() > 100:
            bands.append([b0, round(float((dec - hgt)[s].mean()), 3), int(s.sum())])
    rule = stats["min"] + g / 255 * (stats["p99.9"] - stats["min"])
    quad = np.polyfit(g[fit_on], hgt[fit_on], 2)
    out = {
        "kmz": kmz_path.replace("\\", "/").split("/")[-1], "level": level, "maxLevel": max_level, "pixels": int(fit_on.sum()),
        "greyMinInKmz": grey_min, "kmlHasMetadata": meta,
        "raster": {k: round(v, 3) for k, v in stats.items()},
        "fit": {"lo": round(float(lo), 3), "hi": round(float(hi), 3), "rmse": round(float(np.sqrt((res ** 2).mean())), 3),
                "p99AbsRes": round(float(np.percentile(np.abs(res), 99)), 3), "step": round(float((hi - lo) / 255), 3),
                "r": round(float(np.corrcoef(g[fit_on], hgt[fit_on])[0, 1]), 5)},
        "quadraticRmse": round(float(np.sqrt(((np.polyval(quad, g[fit_on]) - hgt[fit_on]) ** 2).mean())), 3),
        "perTile": {"n": len(per), "loStd": round(float(per[:, 0].std()), 3) if len(per) else None, "hiStd": round(float(per[:, 1].std()), 3) if len(per) else None},
        "bands": bands,
        "rule_min_p999_rmse": round(float(np.sqrt(((rule - hgt)[fit_on] ** 2).mean())), 3),
        "clippedShare": round(float((g == 255).mean()), 5),
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 0)
