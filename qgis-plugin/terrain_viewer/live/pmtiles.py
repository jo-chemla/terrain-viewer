"""A PMTiles archive (version 3) read over HTTP range requests, in plain
Python: its header and directories once, then one request per tile. For the
building shadows' footprints (buildings.py: Overture's buildings, an archive
of the user's own); the format is the specification's
(github.com/protomaps/PMTiles, spec/v3), as the app's `pmtiles` package
reads it.

No dependency: urllib, gzip, struct. Directories and tiles compressed with
gzip (what the archives in the wild use) or not at all; brotli and zstd are
refused with a message."""
import gzip
import struct
import threading
import urllib.error
import urllib.request
from collections import OrderedDict

USER_AGENT = "terrain-viewer-qgis-live/0.2"
HEADER_BYTES = 127
# The first request: the header and, usually, the whole root directory.
FIRST_BYTES = 16384
COMPRESSIONS = {0: "unknown", 1: "none", 2: "gzip", 3: "brotli", 4: "zstd"}


class PMTilesError(Exception):
    pass


def tile_id(z, x, y):
    """A tile's id: the tiles of the zooms under it, then its place on the
    zoom's Hilbert curve."""
    if z > 26 or not (0 <= x < 1 << z) or not (0 <= y < 1 << z):
        raise PMTilesError(f"no such tile {z}/{x}/{y}")
    acc = ((1 << (2 * z)) - 1) // 3
    d, s = 0, (1 << z) >> 1
    while s > 0:
        rx = 1 if x & s else 0
        ry = 1 if y & s else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x, y = s - 1 - x, s - 1 - y
            x, y = y, x
        s >>= 1
    return acc + d


def _varints(data):
    """Every varint of a buffer, in order (a generator)."""
    value = shift = 0
    for b in data:
        value |= (b & 0x7F) << shift
        if b & 0x80:
            shift += 7
        else:
            yield value
            value = shift = 0


def parse_directory(data):
    """A decompressed directory as four lists: tile ids, run lengths,
    lengths, offsets."""
    it = _varints(data)
    n = next(it)
    ids, last = [], 0
    for _ in range(n):
        last += next(it)
        ids.append(last)
    runs = [next(it) for _ in range(n)]
    lengths = [next(it) for _ in range(n)]
    offsets = []
    for i in range(n):
        v = next(it)
        offsets.append(offsets[i - 1] + lengths[i - 1] if v == 0 and i > 0 else v - 1)
    return ids, runs, lengths, offsets


def find(directory, tid):
    """The entry (run length, length, offset) holding a tile id: the last
    one starting at or before it, when its run reaches it (a run of 0 is a
    leaf directory); None otherwise."""
    ids, runs, lengths, offsets = directory
    lo, hi = 0, len(ids) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if ids[mid] == tid:
            return runs[mid], lengths[mid], offsets[mid]
        if ids[mid] < tid:
            lo = mid + 1
        else:
            hi = mid - 1
    if hi < 0:
        return None
    if runs[hi] == 0 or tid - ids[hi] < runs[hi]:
        return runs[hi], lengths[hi], offsets[hi]
    return None


def parse_header(b):
    if len(b) < HEADER_BYTES or b[:7] != b"PMTiles":
        raise PMTilesError("not a PMTiles archive")
    if b[7] != 3:
        raise PMTilesError(f"PMTiles version {b[7]}: only version 3 is read")
    u = struct.unpack_from("<11Q", b, 8)
    return {"root_offset": u[0], "root_length": u[1], "metadata_offset": u[2], "metadata_length": u[3],
            "leaf_offset": u[4], "leaf_length": u[5], "data_offset": u[6], "data_length": u[7],
            "internal_compression": b[97], "tile_compression": b[98], "tile_type": b[99],
            "min_zoom": b[100], "max_zoom": b[101]}


def decompress(data, compression):
    if compression in (0, 1):
        # "unknown": as the bytes say.
        return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data
    if compression == 2:
        return gzip.decompress(data)
    raise PMTilesError(f"{COMPRESSIONS.get(compression, compression)} compression is not read here (gzip or none)")


def http_range(url, start, length, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{start + length - 1}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    # A server that ignores Range answers the whole file (200): its slice.
    return data if len(data) <= length else data[start:start + length]


class Archive:
    """One archive: `tile(z, x, y)` answers the tile's bytes, decompressed,
    or None where the archive has none. `fetch(url, start, length)` is
    replaced in the tests."""

    def __init__(self, url, fetch=http_range, max_directories=64):
        self.url, self.fetch = url, fetch
        self.lock = threading.Lock()
        self.header = None
        self.root = None
        self.leaves = OrderedDict()
        self.max_directories = max_directories

    def open(self):
        with self.lock:
            if self.header is not None:
                return self.header
        first = self.fetch(self.url, 0, FIRST_BYTES)
        header = parse_header(first)
        a, n = header["root_offset"], header["root_length"]
        raw = first[a:a + n] if a + n <= len(first) else self.fetch(self.url, a, n)
        root = parse_directory(decompress(raw, header["internal_compression"]))
        with self.lock:
            self.header, self.root = header, root
        return header

    def _leaf(self, offset, length):
        with self.lock:
            d = self.leaves.get((offset, length))
            if d is not None:
                self.leaves.move_to_end((offset, length))
                return d
        raw = self.fetch(self.url, self.header["leaf_offset"] + offset, length)
        d = parse_directory(decompress(raw, self.header["internal_compression"]))
        with self.lock:
            self.leaves[(offset, length)] = d
            while len(self.leaves) > self.max_directories:
                self.leaves.popitem(last=False)
        return d

    def tile(self, z, x, y):
        header = self.open()
        if z < header["min_zoom"] or z > header["max_zoom"]:
            return None
        tid = tile_id(z, x, y)
        directory = self.root
        for _depth in range(4):
            entry = find(directory, tid)
            if entry is None:
                return None
            run, length, offset = entry
            if run > 0:
                data = self.fetch(self.url, header["data_offset"] + offset, length)
                return decompress(data, header["tile_compression"])
            directory = self._leaf(offset, length)
        raise PMTilesError("directories nested too deep")

    def metadata(self):
        import json
        header = self.open()
        if not header["metadata_length"]:
            return {}
        raw = self.fetch(self.url, header["metadata_offset"], header["metadata_length"])
        return json.loads(decompress(raw, header["internal_compression"]).decode("utf-8"))
