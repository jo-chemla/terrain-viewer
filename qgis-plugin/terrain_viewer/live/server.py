"""A tiny tile server on a localhost thread, for the modes computed with
numpy. Two forms of the same tiles:

  /{mode}/{z}/{x}/{y}.tif?<settings>   the values, a Float32 TIFF, read by
                                       GDAL's WMS driver (gdal_xml(): QGIS's
                                       gdal provider, so QGIS's own colour
                                       ramps, Identify, raster calculator)
  /{mode}/{z}/{x}/{y}.png?<settings>   the colour picture, for a plain XYZ
                                       layer: the mode's colour ramp (QGIS's,
                                       sampled), grey for the shades

  srv = LiveServer.instance()          # 127.0.0.1:3420, or a free port
  srv.gdal_xml("slope", {})            # a GDAL dataset: <GDAL_WMS>...</GDAL_WMS>
  srv.xyz_url("hillshade", {"altitude": 30})

Concurrency: each request has its own thread (ThreadingHTTPServer), the
computing is bounded by a semaphore sized to the cores (more threads than
cores only fight over the GIL and the caches), the elevation tiles of a
padded grid are fetched in parallel by the Dem's pool, and finished tiles
are kept in a small LRU (a re-render, the same mode as values and picture).
numpy releases the GIL inside its array operations, so tiles overlap on
several cores.
"""
import os
import struct
import threading
import time
import zlib
from collections import OrderedDict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import numpy as np

from . import modes
from .dem import SOURCES, TILE
from .gdal_source import make_dem

# The port asked first, so a saved project's layers find the server again
# next session (once the box is checked); another free one when taken.
PREFERRED_PORT = 3420
COLOUR_VERSION = 3  # bumped when the colour tiles change for the same settings (3: the app's ramps)
WORLD = 20037508.342789244


def png(a):
    """(h, w) grey, (h, w, 3) RGB or (h, w, 4) RGBA uint8 -> PNG bytes (zlib
    level 1: fast, the tiles are smooth shades)."""
    h, w = a.shape[:2]
    channels = 1 if a.ndim == 2 else a.shape[2]
    raw = np.empty((h, w * channels + 1), np.uint8)
    raw[:, 0] = 0
    raw[:, 1:] = a.reshape(h, w * channels)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    colour_type = {1: 0, 3: 2, 4: 6}[channels]
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, colour_type, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw.tobytes(), 1)) + chunk(b"IEND", b""))


png_grey = png


def tiff_float32(a):
    """(h, w) float32 -> a one-band, one-strip, uncompressed little-endian
    TIFF (no compression: it only crosses localhost; 256 KB a tile). The
    tile's place is the WMS grid's, so no GeoTIFF keys; NaN is no data
    (GDAL_NODATA, and the XML's NoData)."""
    h, w = a.shape
    data = np.ascontiguousarray(a, dtype="<f4").tobytes()
    nodata = b"nan\x00"
    entries = [  # tag, type (3 SHORT, 4 LONG, 2 ASCII), count, value
        (256, 4, 1, w), (257, 4, 1, h), (258, 3, 1, 32), (259, 3, 1, 1), (262, 3, 1, 1),
        (273, 4, 1, None), (277, 3, 1, 1), (278, 4, 1, h), (279, 4, 1, len(data)), (284, 3, 1, 1),
        (339, 3, 1, 3), (42113, 2, len(nodata), None),
    ]
    ifd_size = 2 + 12 * len(entries) + 4
    data_at = 8 + ifd_size
    out = [b"II*\x00", struct.pack("<I", 8), struct.pack("<H", len(entries))]
    for tag, typ, count, value in entries:
        if tag == 273:
            value = data_at
        if tag == 42113:  # 4 bytes: inside the entry
            out.append(struct.pack("<HHI4s", tag, typ, count, nodata))
        elif typ == 3:
            out.append(struct.pack("<HHIHH", tag, typ, count, value, 0))
        else:
            out.append(struct.pack("<HHII", tag, typ, count, value))
    out.append(struct.pack("<I", 0))
    return b"".join(out) + data


class _Handler(BaseHTTPRequestHandler):
    server_version = "TerrainViewerLive/0.2"
    # HTTP/1.0, a connection per tile: measured against keep-alive (HTTP/1.1,
    # Nagle off), QGIS's XYZ provider redraws a 1920x1080 canvas of fresh
    # hillshade tiles in about 1.0 s either way (1.1 to 1.9 s with keep-alive).
    protocol_version = "HTTP/1.0"

    def log_message(self, *_):  # quiet
        pass

    def do_GET(self):  # noqa: N802 - http.server's name
        u = urlparse(self.path)
        parts = u.path.strip("/").split("/")
        srv = self.server.live
        try:
            if parts == ["health"]:
                return self._send(200, b'{"ok":true}', "application/json")
            mode, z, x, y = parts[0], int(parts[1]), int(parts[2]), parts[3]
            y, ext = y.split(".") if "." in y else (y, "png")
            y = int(y)
            spec = modes.MODES.get(mode)
            if (spec is None or not spec["python_supported"] or ext not in ("png", "tif")
                    or ("values" if ext == "tif" else "colour") not in spec["outputs"]):
                return self._send(404, b"unknown mode or format", "text/plain")
            if z < 0 or not (0 <= x < 1 << z) or not (0 <= y < 1 << z):
                return self._send(404, b"no such tile", "text/plain")
            q = parse_qs(u.query)
            source = q.get("source", ["mapterhorn"])[0]
            if source not in SOURCES:
                return self._send(404, b"unknown source", "text/plain")
            srv.requests += 1
            srv.seen.append((mode, z, x, y, ext))
            body, t = srv.tile(source, mode, z, x, y, modes.parse_opts(mode, q), ext)
            self._send(200, body, "image/tiff" if ext == "tif" else "image/png", {
                "Cache-Control": "max-age=86400",
                "Server-Timing": f"wait;dur={t['wait_ms']:.1f}, fetch;dur={t['fetch_ms']:.1f}, compute;dur={t['compute_ms']:.1f}",
            })
        except (IndexError, ValueError):
            self._send(400, b"expected /{mode}/{z}/{x}/{y}.png or .tif", "text/plain")
        except Exception as e:  # noqa: BLE001 - one bad tile must not end the server
            srv.errors.append(f"{self.path}: {e!r}")
            del srv.errors[:-20]
            self._send(502, str(e).encode("utf-8", "replace"), "text/plain")

    def _send(self, code, body, ctype, headers=None):
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # the client cancelled the tile (pan/zoom): fine


class _Server(ThreadingHTTPServer):
    # The listen backlog: socketserver's default, 5, overflows when GDAL
    # opens its 16 connections at once, and a refused connection is retried
    # by Windows after half a second (measured: 75 tiles/s at 16 clients
    # against 360 at 6, until this was raised).
    request_queue_size = 128
    daemon_threads = True
    # On Windows, SO_REUSEADDR (HTTPServer's default) lets a second QGIS bind
    # the port the first one listens on, and its tiles were then answered by
    # the other QGIS ("unknown source"): an exclusive bind instead, so the
    # second one takes another port.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        import socket
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class LiveServer:
    _instance = None
    _lock = threading.Lock()

    @classmethod
    def instance(cls, **kw):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(**kw)
            return cls._instance

    @classmethod
    def shutdown(cls):
        with cls._lock:
            if cls._instance is not None:
                cls._instance.stop()
                cls._instance = None

    def __init__(self, port=None, workers=None, result_cache_mb=64):
        self.workers = workers or max(2, os.cpu_count() or 4)
        self.httpd = None
        for p in ([port] if port is not None else [PREFERRED_PORT, 0]):
            try:
                self.httpd = _Server(("127.0.0.1", p), _Handler)
                break
            except OSError:
                continue
        if self.httpd is None:
            self.httpd = _Server(("127.0.0.1", 0), _Handler)
        self.httpd.daemon_threads = True
        self.httpd.live = self
        self.port = self.httpd.server_address[1]
        self.compute_slots = threading.BoundedSemaphore(self.workers)
        self._dems = {}
        self._results = OrderedDict()
        self._results_bytes = 0
        self.result_cache_bytes = result_cache_mb * 1024 * 1024
        self.stats = {}
        self.inflight = 0
        self.peak_inflight = 0
        self.requests = 0
        self.errors = []
        self.seen = deque(maxlen=4000)  # (mode, z, x, y, ext) of each request: which zoom QGIS asks (tests)
        # The colour ramps of the colour tiles, (256, 3) uint8 per mode,
        # sampled from QGIS's style on the main thread (live/layers.py
        # ramp_luts); grey until then.
        self.luts = {}
        self._stats_lock = threading.Lock()
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="tv-live-http", daemon=True)
        self.thread.start()

    def dem(self, source):
        with self._stats_lock:
            if source not in self._dems:
                self._dems[source] = make_dem(SOURCES[source])
            return self._dems[source]

    # -- one tile ---------------------------------------------------------------
    def values(self, source, mode, z, x, y, opts, picture=False):
        """(n, n) float32 values of a tile and the timings; the computing
        holds one of the `workers` slots, the fetching does not. picture:
        the colour tile of a mode drawn from the elevation (the hillshade),
        when it has one (else None, and the values)."""
        dem = self.dem(source)
        t0 = time.perf_counter()
        grid = dem.grid(z, x, y)
        # Fetch first, outside the compute slots: a slow network must not
        # hold a core.
        if picture and modes.MODES[mode].get("picture"):
            grid(1)
        else:
            modes.prefetch(mode, grid, opts)
        t1 = time.perf_counter()
        with self.compute_slots:
            t2 = time.perf_counter()
            v = modes.picture(mode, grid, dem.resolution_m(z, y), opts, TILE) if picture else None
            if v is None:
                v = modes.values(mode, grid, dem.resolution_m(z, y), opts, TILE)
            elif picture:
                v = ("picture", v)
            t3 = time.perf_counter()
        return v, {"fetch_ms": (t1 - t0) * 1000, "wait_ms": (t2 - t1) * 1000, "compute_ms": (t3 - t2) * 1000}

    def tile(self, source, mode, z, x, y, opts, ext):
        key = (source, mode, z, x, y, tuple(sorted(opts.items())), ext)
        with self._stats_lock:
            body = self._results.get(key)
            if body is not None:
                self._results.move_to_end(key)
                return body, {"fetch_ms": 0.0, "wait_ms": 0.0, "compute_ms": 0.0}
            self.inflight += 1
            self.peak_inflight = max(self.peak_inflight, self.inflight)
        try:
            v, t = self.values(source, mode, z, x, y, opts, picture=ext == "png")
            if isinstance(v, tuple):
                body = png(v[1])
            else:
                body = tiff_float32(v) if ext == "tif" else png(modes.colour(mode, v, opts, self.luts.get(mode)))
        finally:
            with self._stats_lock:
                self.inflight -= 1
        with self._stats_lock:
            s = self.stats.setdefault(mode, {"tiles": 0, "fetch_ms": 0.0, "wait_ms": 0.0, "compute_ms": 0.0})
            s["tiles"] += 1
            for k in ("fetch_ms", "wait_ms", "compute_ms"):
                s[k] += t[k]
            if key not in self._results:
                self._results[key] = body
                self._results_bytes += len(body)
                while self._results_bytes > self.result_cache_bytes and self._results:
                    self._results_bytes -= len(self._results.popitem(last=False)[1])
        return body, t

    def clear_results(self):
        with self._stats_lock:
            self._results.clear()
            self._results_bytes = 0

    # -- addresses -------------------------------------------------------------
    def _query(self, opts, source):
        q = {"source": source} if source != "mapterhorn" else {}
        q.update({k: v for k, v in (opts or {}).items()})
        return urlencode(q)

    def xyz_url(self, mode, opts=None, source="mapterhorn"):
        # c: the colour tiles' version. QGIS keeps XYZ tiles in its disk cache
        # (max-age a day) by address, and the port is the same each session:
        # without it, the grey tiles of 0.5.0 would be shown for a day.
        q = self._query(dict(opts or {}, c=COLOUR_VERSION), source)
        return f"http://127.0.0.1:{self.port}/{mode}/{{z}}/{{x}}/{{y}}.png" + (f"?{q}" if q else "")

    def gdal_xml(self, mode, opts=None, source="mapterhorn"):
        """A GDAL dataset (GDAL's WMS driver, TMS minidriver) of a mode's
        values: one Float32 raster of the world in EPSG:3857, its deepest
        level the source's, read as Float32 TIFF tiles from this server, up
        to `workers` at a time. QGIS opens the string itself as a layer of
        the gdal provider. The same form as the tile service's /gdal.xml."""
        q = self._query(opts, source)
        url = f"http://127.0.0.1:{self.port}/{mode}/${{z}}/${{x}}/${{y}}.tif" + (f"?{q}" if q else "")
        spec = SOURCES[source]
        level = spec["maxzoom"] + (1 if spec["size"] == 512 else 0)
        esc = url.replace("&", "&amp;")
        return (f"<GDAL_WMS><Service name=\"TMS\"><ServerUrl>{esc}</ServerUrl></Service>"
                f"<DataWindow><UpperLeftX>{-WORLD}</UpperLeftX><UpperLeftY>{WORLD}</UpperLeftY>"
                f"<LowerRightX>{WORLD}</LowerRightX><LowerRightY>{-WORLD}</LowerRightY><TileLevel>{level}</TileLevel>"
                "<TileCountX>1</TileCountX><TileCountY>1</TileCountY><YOrigin>top</YOrigin></DataWindow>"
                "<Projection>EPSG:3857</Projection><BlockSizeX>256</BlockSizeX><BlockSizeY>256</BlockSizeY>"
                "<BandsCount>1</BandsCount><DataType>Float32</DataType><DataValues NoData=\"nan\"/>"
                "<ZeroBlockHttpCodes>204,404</ZeroBlockHttpCodes><ZeroBlockOnServerException>true</ZeroBlockOnServerException>"
                f"<MaxConnections>{min(self.workers, 16)}</MaxConnections><Timeout>120</Timeout></GDAL_WMS>")

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for d in self._dems.values():
            # A GDAL source's datasets live in its pool's threads: let them end (and
            # close them) before QGIS tears GDAL down.
            d.pool.shutdown(wait=bool(d.spec.get("gdal") or d.spec.get("qgis_provider")))
