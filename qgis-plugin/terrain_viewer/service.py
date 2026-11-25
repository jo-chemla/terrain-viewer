"""The tile service, as the panel reads it: its catalogs (/terrain-sources, /processes,
/colorramps) and the addresses of a mode's tiles. No QGIS widget here, so
the address building can be tested on its own."""
import json
import re
from urllib.parse import urlencode, urlsplit, parse_qsl

from qgis.PyQt.QtCore import QUrl
from qgis.PyQt.QtNetwork import QNetworkRequest, QNetworkReply
from qgis.core import QgsNetworkAccessManager

# The keys a source can need, as the service names them (?mapboxKey=...):
# the only ones sent to a tile service.
KEY_PARAMS = ("mapboxKey", "maptilerKey", "cesiumIonKey")
# Every key the panel keeps (QGIS settings terrain_viewer/<name>), with its
# label; HERE and Google are the app's basemap keys, kept for the sources
# that will need them, sent nowhere today.
ALL_KEYS = (("mapboxKey", "Mapbox"), ("maptilerKey", "MapTiler"), ("hereKey", "HERE"), ("googleKey", "Google"),
            ("cesiumIonKey", "Cesium ion"))
# The view's parameters that are the app's alone (the layout, the camera,
# the other views): never put in a tile address.
APP_ONLY = re.compile(r"^(splitRatio|splitStyle|splitScreen|viewMode|zoom|lat|lng|pitch|bearing|roll|fov|terrainSource[A-H]|"
                      r"source[A-H]|gridLayout|appMode|terrainType)$")


class ServiceError(Exception):
    pass


def health_request(base, timeout_ms):
    """A /health request that never comes from QGIS's network cache: a cached
    answer said a service that had just been killed was still there."""
    request = QNetworkRequest(QUrl(f"{base.rstrip('/')}/health"))
    request.setTransferTimeout(timeout_ms)
    request.setAttribute(QNetworkRequest.Attribute.CacheLoadControlAttribute, QNetworkRequest.CacheLoadControl.AlwaysNetwork)
    request.setAttribute(QNetworkRequest.Attribute.CacheSaveControlAttribute, False)
    return request


def health(base, timeout_ms=3000):
    """(True, "") when the service at `base` answers /health within the
    timeout, else (False, the error): asked before anything else, so a
    service that is not there costs one short wait and one message, not a
    timeout per tile."""
    reply = QgsNetworkAccessManager.instance().blockingGet(health_request(base, timeout_ms))
    if reply.error() != QNetworkReply.NetworkError.NoError:
        return False, reply.errorString() or "no answer"
    return True, ""


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


def is_local(url):
    """Whether a service address is on this machine (localhost, 127.x, ::1)."""
    host = (urlsplit(url if "//" in url else "http://" + url).hostname or "").lower()
    return host in ("localhost", "::1", "0.0.0.0") or host.startswith("127.")


def unresponsive_message(base, error, bundled_available=False, bundled_on=False, bundled_status=""):
    """What the panel and the message bar say when the service at `base`
    does not answer: the error, and for an address on this machine where a
    service usually comes from (the local one, the desktop app, a local
    start)."""
    text = f"The tile service at {base} does not answer ({error})."
    if bundled_on:
        return text + f" {bundled_status or 'The local tile service is not running'}: press Connect to start it again."
    if is_local(base):
        port = urlsplit(base if "//" in base else "http://" + base).port
        text += (" Start the Terrain Viewer desktop app with its tile service on (Settings > Desktop: local tile service"
                 + (f", port {port}" if port else "") + "), or a tile service of your own (cd tile-server && pnpm start).")
        if bundled_available:
            text += " Or pick \"Local service\" at the top of the panel to run one from QGIS (installed on first use)."
    else:
        text += " Check the address, your network, or whether that service is up."
    return text


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
            s["enum"] = clean_enum(schema["enum"])
        for k in ("default", "minimum", "maximum"):
            if k in schema:
                s[k] = schema[k]
        if spec.get("description") and spec["description"] != "--":
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


def clean_enum(values):
    """An enum as the app takes it (the URL reference once listed an inline
    literal's last value as `live" as const`)."""
    out = []
    for v in values or []:
        v = str(v).split('"')[0].strip()
        if v and v not in out:
            out.append(v)
    return out


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

    def __init__(self, base, snapshot=None):
        """`base`: the service asked; `snapshot`: the packaged catalog
        (assets.catalog(), no request: the Python backend, or before a
        service answers)."""
        self.base = (base or "").rstrip("/")
        if snapshot is not None:
            self.snapshot = True
            self.sources = snapshot.get("sources", [])
            self.tree = snapshot.get("tree", [])
            self.colorramps = [r["id"] for r in snapshot.get("colorramps", [])]
            self.inputs = set(snapshot.get("inputs", []))
        else:
            self.snapshot = False
            # /terrain-sources since 2026-11-25; a service from before only
            # has the old address, /sources (still answered as an alias).
            try:
                self.sources = get_json(f"{self.base}/terrain-sources").get("sources", [])
            except ServiceError:
                self.sources = get_json(f"{self.base}/sources").get("sources", [])
            try:
                listing = get_json(f"{self.base}/processes?expand=true")
            except ServiceError as e:
                raise ServiceError(f"{e} (a tile service from before 2026-11-24 has no /processes: update it)")
            modes = {p["id"]: mode_of_process(p) for p in listing.get("processes", [])}
            self.inputs = {spec.get("x-tv-url-param", k) for p in listing.get("processes", [])
                           for k, spec in (p.get("inputs") or {}).items()}
            self.tree = tree_of_processes(listing.get("x-tv-groups", []), modes)
            try:
                self.colorramps = [r["id"] for r in get_json(f"{self.base}/colorramps").get("colorramps", [])]
            except ServiceError:
                self.colorramps = []
        self.modes = {item["id"]: item for _, item in walk_modes(self.tree)}
        self.order = [item["id"] for _, item in walk_modes(self.tree)]

    def source(self, source_id):
        return next((s for s in self.sources if s.get("id") == source_id), None)

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
    """A share link (a whole address, with or without its scheme) or a bare
    query (with or without its "?"): its query string, the fragment off."""
    link = (link or "").strip().split("#", 1)[0]
    if "?" in link:
        return link.split("?", 1)[1]
    return link if "=" in link else ""


def link_params(params, inputs, taken):
    """A share link's parameters that go into every layer's address: the
    ones some mode takes (`inputs`, /processes), minus the ones the panel
    sets itself (`taken`: the settings, opacities, keys, the source, the
    light). The app's own (splitRatio, the camera, the other views) stay out
    of the tiles."""
    return {k: v for k, v in params.items()
            if k not in taken and k not in KEY_PARAMS and not APP_ONLY.match(k) and (not inputs or k in inputs)}


def query_dict(query):
    return dict(parse_qsl(query, keep_blank_values=True))
