"""A QGIS raster layer or a raster file as the tile service's terrain source.

A tile service on this machine (the bundled one, the desktop app's, one
started by hand) reads a local GeoTIFF or VRT once it is registered with it:
POST /files {"path": ...} answers file:<id>, which then goes in every tile
address as terrainSource (tile-server/files.mjs). The service checks the
file (a TIFF or a VRT, under its allowed folders if it has any) and serves
it back to the app's VRT reader over loopback; no path is ever put in a
tile address. A service on another machine cannot read this machine's
files: an https COG or VRT is handed over as an address instead, and
anything else (a QGIS WMS or WCS layer) is for the Python backend."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from . import python_backend as pyb

LOOPBACK = ("127.0.0.1", "localhost", "::1", "[::1]")


def is_loopback(base):
    host = (urllib.parse.urlsplit(base or "").hostname or "").lower()
    return host in LOOPBACK or host.startswith("127.")


def register(base, path, timeout=10):
    """POST /files: the service's id of a local file, or raises (its message)."""
    req = urllib.request.Request(base.rstrip("/") + "/files", data=json.dumps({"path": path}).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "User-Agent": "terrain-viewer-qgis"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error")
        except Exception:  # noqa: BLE001 - not JSON: an older service
            msg = None
        if e.code in (404, 405) and not msg:
            msg = "this tile service has no /files (an older one): update it"
        raise ValueError(msg or f"HTTP {e.code}") from None


def remote_address(source):
    """An https GeoTIFF or VRT behind a source (a GDAL layer read over
    /vsicurl/, an address typed), as the tile service's JSON source; None."""
    s = str(source)
    layer = pyb.layer_of(s)
    if layer is not None:
        if layer.providerType() != "gdal":
            return None
        s = layer.source().split("|")[0]
    s = s[5:] if s.startswith("gdal:") else s
    s = s[len("/vsicurl/"):] if s.startswith("/vsicurl/") else s
    low = s.lower().split("?", 1)[0]
    if low.startswith("https://") and low.endswith((".tif", ".tiff", ".vrt")):
        return json.dumps({"url": s, "type": "vrt" if low.endswith(".vrt") else "cog"}, separators=(",", ":"))
    return None


def service_source(base, source):
    """(terrainSource for the service, None) or (None, why) for a QGIS raster
    layer or a raster file (pyb.is_local_source)."""
    path = pyb.local_file(source)
    if path is None:
        remote = remote_address(source)
        if remote is not None:
            return remote, None
        layer = pyb.layer_of(source)
        what = f"the layer {layer.name()}" if layer is not None else str(source)
        return None, (f"{what} is not a file the tile service can read (a {layer.providerType()} layer: pick the Python "
                      f"backend for it)" if layer is not None else f"{what}: the tile service reads a GeoTIFF or VRT "
                      "file, or an https COG or VRT")
    if not path.lower().endswith((".tif", ".tiff", ".vrt")):
        return None, f"{os.path.basename(path)}: the tile service reads GeoTIFF and VRT files (the Python backend reads any GDAL raster)"
    if not is_loopback(base):
        return None, f"the tile service at {base} is on another machine: it cannot read {path} (use a local service or the Python backend)"
    try:
        return register(base, path)["source"], None
    except (ValueError, OSError) as e:
        return None, f"{os.path.basename(path)} was not registered with the tile service: {e}"
