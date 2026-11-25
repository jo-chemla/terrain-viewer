"""A tiny XYZ tile server on a localhost thread: the modes computed with numpy
for a standard QGIS XYZ layer. QGIS keeps doing what it does well (its tile
grid, worker-thread rendering, network cache, zoom-level resampling); this
only answers /{mode}/{z}/{x}/{y}.png?<settings>.

  srv = LiveServer.instance()          # starts on a free port
  srv.xyz_url("hillshade", {"altitude": 30})
  -> http://127.0.0.1:<port>/hillshade/{z}/{x}/{y}.png?altitude=30

Each request runs in its own thread (ThreadingHTTPServer); numpy releases the
GIL inside its array operations, so tiles overlap on several cores.
"""
import struct
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import numpy as np

from . import kernels
from .dem import TILE, Dem, ground_resolution_m


def png_grey(a):
    """(h, w) uint8 -> greyscale PNG bytes (zlib level 1: fast, the tiles are
    smooth shades)."""
    h, w = a.shape
    raw = np.empty((h, w + 1), np.uint8)
    raw[:, 0] = 0
    raw[:, 1:] = a

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw.tobytes(), 1)) + chunk(b"IEND", b""))


def parse_opts(mode, query):
    opts = dict(kernels.DEFAULTS[mode])
    for k, v in query.items():
        if k in opts:
            try:
                opts[k] = type(opts[k])(float(v[0]))
            except ValueError:
                pass
    if "radius" in opts:
        opts["radius"] = int(min(max(opts["radius"], 1), TILE))
    return opts


def compute_tile(dem, mode, z, x, y, opts):
    """-> (uint8 (256, 256), timings dict)."""
    t0 = time.perf_counter()
    halo = kernels.halo_of(mode, opts)
    padded = dem.padded(z, x, y, halo)
    t1 = time.perf_counter()
    img = kernels.render(mode, padded, TILE, ground_resolution_m(z, y), opts)
    t2 = time.perf_counter()
    return img, {"fetch_ms": (t1 - t0) * 1000, "compute_ms": (t2 - t1) * 1000}


class _Handler(BaseHTTPRequestHandler):
    server_version = "TerrainViewerLive/0.1"

    def log_message(self, *_):  # quiet
        pass

    def do_GET(self):  # noqa: N802 - http.server's name
        u = urlparse(self.path)
        parts = u.path.strip("/").split("/")
        srv = self.server.live
        try:
            if parts == ["health"]:
                return self._send(200, b'{"ok":true}', "application/json")
            mode, z, x, y = parts[0], int(parts[1]), int(parts[2]), int(parts[3].split(".")[0])
            if mode not in kernels.DEFAULTS:
                return self._send(404, b"unknown mode", "text/plain")
            source = parse_qs(u.query).get("source", ["mapterhorn"])[0]
            img, t = compute_tile(srv.dem(source), mode, z, x, y, parse_opts(mode, parse_qs(u.query)))
            srv.record(mode, t)
            body = png_grey(img)
            self._send(200, body, "image/png", {
                "Cache-Control": "max-age=86400",
                "Server-Timing": f"fetch;dur={t['fetch_ms']:.1f}, compute;dur={t['compute_ms']:.1f}",
            })
        except (IndexError, ValueError):
            self._send(400, b"expected /{mode}/{z}/{x}/{y}.png", "text/plain")
        except Exception as e:  # noqa: BLE001 - one bad tile must not end the server
            self._send(502, str(e).encode("utf-8", "replace"), "text/plain")

    def _send(self, code, body, ctype, headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # QGIS cancelled the tile (pan/zoom): fine


class LiveServer:
    _instance = None
    _lock = threading.Lock()

    @classmethod
    def instance(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def shutdown(cls):
        with cls._lock:
            if cls._instance is not None:
                cls._instance.stop()
                cls._instance = None

    def __init__(self, port=0):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        self.httpd.daemon_threads = True
        self.httpd.live = self
        self.port = self.httpd.server_address[1]
        self._dems = {}
        self.stats = {}
        self._stats_lock = threading.Lock()
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="tv-live-http", daemon=True)
        self.thread.start()

    def dem(self, source):
        with self._stats_lock:
            if source not in self._dems:
                self._dems[source] = Dem(source)
            return self._dems[source]

    def record(self, mode, t):
        with self._stats_lock:
            s = self.stats.setdefault(mode, {"tiles": 0, "fetch_ms": 0.0, "compute_ms": 0.0})
            s["tiles"] += 1
            s["fetch_ms"] += t["fetch_ms"]
            s["compute_ms"] += t["compute_ms"]

    def xyz_url(self, mode, opts=None):
        q = urlencode({k: v for k, v in (opts or {}).items()})
        return f"http://127.0.0.1:{self.port}/{mode}/{{z}}/{{x}}/{{y}}.png" + (f"?{q}" if q else "")

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for d in self._dems.values():
            d.pool.shutdown(wait=False)

