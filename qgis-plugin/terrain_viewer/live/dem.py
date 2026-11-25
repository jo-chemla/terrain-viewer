"""Elevation tiles read in Python: Terrarium / Terrain-RGB pyramids decoded to
float32 metres, as 256 px Web Mercator tiles whatever the source's tile size,
and a padded grid (the tile plus a halo from its neighbours) for the kernels.

Decoding is Qt's (QImage reads PNG and WebP in QGIS 3.44 and 4.x alike; it is
reentrant, so it runs in worker threads), the RGB packing numpy
(lib/elevation-encoding.ts). Fetching is urllib in a small pool: no Qt event
loop needed, so it works from the HTTP server's threads and from scripts.
"""
import math
import threading
import urllib.error
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from qgis.PyQt.QtGui import QImage

TILE = 256
EARTH_CIRCUMFERENCE_M = 2 * math.pi * 6378137

SOURCES = {
    # 512 px WebP, global to z12, deeper where the data is (404 elsewhere).
    "mapterhorn": {"url": "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", "size": 512, "maxzoom": 17, "encoding": "terrarium"},
    # 256 px PNG, global to z15.
    "aws": {"url": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", "size": 256, "maxzoom": 15, "encoding": "terrarium"},
}
USER_AGENT = "terrain-viewer-qgis-live/0.2"


def decode(rgb, encoding):
    """(h, w, 3) uint8 -> (h, w) float32 metres."""
    r = rgb[..., 0].astype(np.float32)
    g = rgb[..., 1].astype(np.float32)
    b = rgb[..., 2].astype(np.float32)
    if encoding == "terrainrgb":
        return (r * 65536.0 + g * 256.0 + b) * 0.1 - 10000.0
    return r * 256.0 + g + b / 256.0 - 32768.0


def image_rgb(data):
    """Encoded PNG/WebP bytes -> (h, w, 3) uint8, through QImage."""
    img = QImage.fromData(data)
    if img.isNull():
        raise ValueError("undecodable image")
    img = img.convertToFormat(QImage.Format.Format_RGB888)
    w, h, bpl = img.width(), img.height(), img.bytesPerLine()
    ptr = img.constBits()
    size = img.sizeInBytes() if hasattr(img, "sizeInBytes") else img.byteCount()
    if hasattr(ptr, "setsize"):  # sip.voidptr (PyQt5 and PyQt6)
        ptr.setsize(size)
    buf = np.frombuffer(ptr, np.uint8, count=size).reshape(h, bpl)
    return buf[:, : w * 3].reshape(h, w, 3).copy()


def ground_resolution_m(z, y, n=TILE):
    """Metres per pixel at the tile's centre latitude."""
    lat = math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / (1 << z))))
    return EARTH_CIRCUMFERENCE_M / (n * (1 << z)) * math.cos(lat)


class Dem:
    """Decoded 256 px tiles of one source, an LRU cache with in-flight
    de-duplication (nine tiles of a padded grid are shared by nine requests)."""

    def __init__(self, source="mapterhorn", cache_mb=256, workers=16):
        self.spec = SOURCES[source] if isinstance(source, str) else source
        # A byte budget, not a count: a 512 px source tile is 1 MB decoded.
        self.cache_bytes = cache_mb * 1024 * 1024
        self.cached_bytes = 0
        self.cache = OrderedDict()
        self.inflight = {}
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="tv-dem")
        self.fetch_ms = 0.0
        self.fetches = 0

    # -- native tiles ------------------------------------------------------
    def _download(self, z, x, y):
        url = self.spec["url"].format(z=z, x=x, y=y)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()

    def _native(self, z, x, y):
        """The source's own tile (its size), decoded; from the parent when the
        source has none (404 past its depth)."""
        key = ("n", z, x, y)
        return self._cached(key, lambda: self._load_native(z, x, y))

    def _load_native(self, z, x, y):
        import time
        size = self.spec["size"]
        if z <= self.spec["maxzoom"]:
            t0 = time.perf_counter()
            try:
                data = self._download(z, x, y)
                arr = decode(image_rgb(data), self.spec["encoding"])
                self.fetch_ms += (time.perf_counter() - t0) * 1000
                self.fetches += 1
                return arr
            except urllib.error.HTTPError as e:
                if e.code not in (403, 404) or z == 0:
                    raise
        parent = self._native(z - 1, x >> 1, y >> 1)
        h = size // 2
        quad = parent[(y & 1) * h:(y & 1) * h + h, (x & 1) * h:(x & 1) * h + h]
        return upsample2(quad)

    def _cached(self, key, load):
        with self.lock:
            v = self.cache.get(key)
            if v is not None:
                self.cache.move_to_end(key)
                return v
            ev = self.inflight.get(key)
            owner = ev is None
            if owner:
                ev = self.inflight[key] = [threading.Event(), None, None]
        if not owner:
            ev[0].wait()
            if ev[2] is not None:
                raise ev[2]
            return ev[1]
        try:
            v = load()
            ev[1] = v
        except Exception as e:  # noqa: BLE001 - handed to the waiters
            ev[2] = e
            raise
        finally:
            with self.lock:
                self.inflight.pop(key, None)
                if ev[2] is None and key not in self.cache:
                    self.cache[key] = ev[1]
                    self.cached_bytes += ev[1].nbytes
                    while self.cached_bytes > self.cache_bytes and len(self.cache) > 1:
                        self.cached_bytes -= self.cache.popitem(last=False)[1].nbytes
            ev[0].set()
        return v

    # -- 256 px tiles --------------------------------------------------------
    def tile(self, z, x, y):
        """(256, 256) float32 metres of the 256 px Web Mercator tile z/x/y
        (x wraps, y is clamped to the world)."""
        n = 1 << z
        x %= n
        y = min(max(y, 0), n - 1)
        if self.spec["size"] == TILE:
            return self._native(z, x, y)
        # A 512 px source: tile z/x/y is a quarter of its tile z-1/(x>>1)/(y>>1).
        if z == 0:
            return downsample2(self._native(0, 0, 0))
        big = self._native(z - 1, x >> 1, y >> 1)
        return big[(y & 1) * TILE:(y & 1) * TILE + TILE, (x & 1) * TILE:(x & 1) * TILE + TILE]

    def padded(self, z, x, y, halo):
        """(256 + 2 halo)^2 float32: the tile and `halo` pixels of its
        neighbours (halo <= 256: one ring of tiles). Neighbours are fetched in
        parallel; only the ones the halo reaches."""
        halo = int(min(max(halo, 0), TILE))
        if halo == 0:
            return np.ascontiguousarray(self.tile(z, x, y))
        need = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
        futs = {d: self.pool.submit(self.tile, z, x + d[1], y + d[0]) for d in need}
        mosaic = np.empty((3 * TILE, 3 * TILE), np.float32)
        for (dy, dx), f in futs.items():
            mosaic[(dy + 1) * TILE:(dy + 2) * TILE, (dx + 1) * TILE:(dx + 2) * TILE] = f.result()
        return np.ascontiguousarray(mosaic[TILE - halo:2 * TILE + halo, TILE - halo:2 * TILE + halo])

    def grid(self, z, x, y):
        """The padded grids of one tile, as modes.values() asks for them
        (grid(halo), grid.ancestor(k)), each fetched once."""
        return TileGrid(self, z, x, y)

    def prefetch(self, tiles):
        """Starts fetching tiles [(z, x, y)] in the background (a canvas's
        tiles, before their requests arrive)."""
        for t in tiles:
            self.pool.submit(self.tile, *t)


class TileGrid:
    def __init__(self, dem, z, x, y):
        self.dem, self.z, self.x, self.y = dem, z, x, y
        self._by_halo = {}

    def __call__(self, halo):
        if halo not in self._by_halo:
            self._by_halo[halo] = self.dem.padded(self.z, self.x, self.y, halo)
        return self._by_halo[halo]

    def ancestor(self, k):
        return self.dem.padded(self.z - k, self.x >> k, self.y >> k, 1)


def upsample2(a):
    """Bilinear x2 (pixel centres), edge-clamped."""
    h, w = a.shape
    ys = (np.arange(2 * h) + 0.5) / 2 - 0.5
    xs = (np.arange(2 * w) + 0.5) / 2 - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    fy = np.clip(ys - np.floor(ys), 0, 1)[:, None].astype(np.float32)
    fx = np.clip(xs - np.floor(xs), 0, 1)[None, :].astype(np.float32)
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)


def downsample2(a):
    h, w = a.shape
    return a.reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3)).astype(np.float32)
