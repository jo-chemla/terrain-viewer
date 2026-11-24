"""The tile service, as the panel reads it: its catalogs (/sources, /processes,
/colorramps) and the addresses of a mode's tiles. No QGIS widget here, so
the address building can be tested on its own."""
import json
from urllib.parse import urlencode, urlsplit, parse_qsl

from qgis.PyQt.QtCore import QUrl
from qgis.PyQt.QtNetwork import QNetworkRequest, QNetworkReply
from qgis.core import QgsNetworkAccessManager

# The keys a source can need, as the service names them (?mapboxKey=...).
KEY_PARAMS = ("mapboxKey", "maptilerKey", "cesiumIonKey")


class ServiceError(Exception):
    pass


def get_json(url, timeout_ms=20000):
    """GET a JSON document through QGIS's network manager (its proxy and
    SSL settings)."""
    request = QNetworkRequest(QUrl(url))
    request.setTransferTimeout(timeout_ms)
    reply = QgsNetworkAccessManager.instance().blockingGet(request)
    # Compared, not tested for truth: under PyQt6 an enum member is always
    # true, NoError included.
    if reply.error() != QNetworkReply.NetworkError.NoError:
        raise ServiceError(f"{url}: {reply.errorString()}")
    try:
        return json.loads(bytes(reply.content()).decode("utf-8"))
    except ValueError as e:
        raise ServiceError(f"{url}: not JSON ({e})")


def walk_modes(groups, path=()):
    """Every mode of the panel tree (tree_of_processes), with the group names above it, top of the
    map first."""
    for g in groups:
        here = path + ((g["group"],) if g.get("group") else ())
        for sub in g.get("groups", []):
            yield from walk_modes([sub], here)
        for item in g.get("items", []):
            yield here, item


def mode_of_process(p):
    """An OGC API - Processes description (/processes/{id}) as the panel's
    mode: its form, shading, opacity parameter, values, and its settings
    (the inputs whose x-tv-role is "setting")."""
    settings = []
    for key, spec in (p.get("inputs") or {}).items():
        if spec.get("x-tv-role") != "setting":
            continue
        schema = spec.get("schema") or {}
        s = {"key": spec.get("x-tv-url-param", key), "type": spec.get("x-tv-type") or schema.get("type", "string")}
        if schema.get("enum"):
            s["enum"] = schema["enum"]
        if "default" in schema:
            s["default"] = schema["default"]
        if spec.get("description"):
            s["note"] = spec["description"]
        settings.append(s)
    mode = {"id": p["id"], "name": p.get("title", p["id"]), "form": p.get("x-tv-form", "raster"),
            "shading": p.get("x-tv-shading", False), "vector": p.get("x-tv-vector", False),
            "switches": p.get("x-tv-switches", {}), "settings": settings}
    if p.get("x-tv-opacity-key"):
        mode["opacityKey"] = p["x-tv-opacity-key"]
    if p.get("x-tv-values"):
        mode["values"] = p["x-tv-values"]
    return mode


def tree_of_processes(groups, modes):
    """/processes' x-tv-groups (the panel tree by process id) with the
    modes in place of the ids."""
    out = []
    for g in groups:
        node = {k: g[k] for k in ("group",) if g.get(k)}
        if g.get("groups"):
            node["groups"] = tree_of_processes(g["groups"], modes)
        if g.get("items"):
            node["items"] = [modes[i] for i in g["items"] if i in modes]
        out.append(node)
    return out


class Catalog:
    """What the service answers: its sources, its modes and their settings
    (/processes, OGC API - Processes), its colour ramps. A service from
    before 2026-11-24 (no /processes) is not read: update it."""

    def __init__(self, base):
        self.base = base.rstrip("/")
        self.sources = get_json(f"{self.base}/sources").get("sources", [])
        try:
            listing = get_json(f"{self.base}/processes?expand=true")
        except ServiceError as e:
            raise ServiceError(f"{e} (a tile service from before 2026-11-24 has no /processes: update it)")
        modes = {p["id"]: mode_of_process(p) for p in listing.get("processes", [])}
        self.tree = tree_of_processes(listing.get("x-tv-groups", []), modes)
        try:
            self.colorramps = [r["id"] for r in get_json(f"{self.base}/colorramps").get("colorramps", [])]
        except ServiceError:
            self.colorramps = []
        self.modes = {item["id"]: item for _, item in walk_modes(self.tree)}
        self.order = [item["id"] for _, item in walk_modes(self.tree)]

    def view(self, query):
        """A share link's view: the modes it switches on, their opacities,
        the parameters its layers keep, the camera."""
        return get_json(f"{self.base}/view?{query}")


def format_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def setting_params(mode, values):
    """A mode's settings that differ from their defaults, as query
    parameters (the defaults are the app's: no need to repeat them)."""
    out = {}
    for s in mode.get("settings", []):
        if s["key"] not in values:
            continue
        v = values[s["key"]]
        if v is None or v == "":
            continue
        if "default" in s and format_value(s["default"]) == format_value(v):
            continue
        out[s["key"]] = format_value(v)
    return out


def tile_url(base, mode, values, common, vector=False):
    """The XYZ address of one mode's tiles. Raster tiles are asked opaque
    (the mode at full opacity, the opacity left to the QGIS layer): QGIS
    draws neighbouring tiles a pixel over each other, so half transparent
    tiles show a line along every tile edge. Shading modes keep the map's
    background and are multiplied over the layers under them; the others
    come without it (background=none) to stack. `common`: the parameters of
    every layer (terrain source, keys, a share link's other parameters)."""
    q = {"modes": mode["id"]}
    q.update({k: v for k, v in common.items() if v not in (None, "")})
    q.update(setting_params(mode, values))
    if not vector:
        if not mode.get("shading"):
            q["background"] = "none"
        if mode.get("opacityKey") and not mode.get("vector"):
            q[mode["opacityKey"]] = "1"
    ext = "pbf" if vector else "png"
    # {z}/{x}/{y} stay as they are: QGIS fills them.
    return f"{base.rstrip('/')}/terrain-tiles/{{z}}/{{x}}/{{y}}.{ext}?{urlencode(q, safe=',{}')}"


def values_url(base, mode, values, common):
    """The address of one mode's values as a GDAL raster: the service's
    /gdal.xml, a GDAL WMS description of its Float32 GeoTIFF tiles, which
    GDAL (and so QGIS's gdal provider) opens by its URL. No opacity, no
    background: numbers, not colours."""
    q = {"modes": mode["id"]}
    q.update({k: v for k, v in common.items() if v not in (None, "")})
    q.update(setting_params(mode, values))
    return f"{base.rstrip('/')}/gdal.xml?{urlencode(q, safe=',')}"


def split_link(link):
    """A share link (or a bare query): its query string."""
    link = link.strip()
    if "?" in link:
        return urlsplit(link).query
    return link.lstrip("?")


def query_dict(query):
    return dict(parse_qsl(query, keep_blank_values=True))
