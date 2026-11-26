"""An app link read the way the app reads it, with no tile service: every URL
parameter the link leaves out takes the app's default (assets/app_defaults.json,
from QUERY_STATE_PARSERS in components/TerrainViewer.tsx), so
showTerrainAnalysis=true alone shows the slope (showSlope defaults to true)
and showReliefVisualization=true alone the local relief model (showLrm
defaults to true), and the hillshade is on unless the link says
showHillshade=false.

The Python backend reads links with this; every backend takes the basemap
from it: the Basemap row's choices (the app's built-in basemaps), a link's
basemap (showRasterBasemap=true: the view's), and the XYZ layer of either."""
from urllib.parse import urlencode

from . import assets
from .service import query_dict

# The app's basemap when a link names none it can draw (its default).
DEFAULT_BASEMAP = "esri"


def app_defaults():
    """{parameter: default} of the app's URL parameters."""
    return assets._json("app_defaults.json").get("defaults", {})


def builtin_basemaps():
    """{id: {id, name, url, maxzoom, apiKey?}}: the app's basemaps with a
    fixed address (lib/basemap-sources.ts)."""
    return {b["id"]: b for b in assets._json("app_defaults.json").get("basemaps", [])}


def typed(value, default):
    """A link's value as the type of the app's default ("true" -> True,
    "0.8" -> 0.8); as given when it does not read as that type."""
    if isinstance(default, bool):
        s = str(value).strip().lower()
        if s in ("true", "1", "yes", "on"):
            return True
        if s in ("false", "0", "no", "off", ""):
            return False
        return value
    if isinstance(default, (int, float)):
        try:
            f = float(value)
        except (TypeError, ValueError):
            return value
        return int(f) if f.is_integer() and isinstance(default, int) else f
    return value


def link_state(query):
    """The app's state for a link's query: its defaults, the link's values
    over them (typed as the defaults), the parameters the app does not know
    kept as given. Returns (state, given): `given`, the link's own values."""
    given = query_dict(query) if isinstance(query, str) else dict(query)
    defaults = app_defaults()
    state = dict(defaults)
    for k, v in given.items():
        state[k] = typed(v, defaults[k]) if k in defaults else v
    return state, given


def truthy(v):
    return v is True or str(v).strip().lower() == "true"


def mode_active(mode, state):
    """A mode is on when every switch of it is (showTerrainAnalysis and
    showSlope for the slope): the link's values over the app's defaults."""
    sw = mode.get("switches") or {}
    return bool(sw) and all(truthy(state.get(k, False)) == bool(v) for k, v in sw.items())


def mode_opacity(mode, state):
    """A mode's opacity as the map draws it: its own (slopeOpacity) times its
    group's (terrainAnalysisOpacity, reliefVisualizationOpacity,
    lightingEffectsOpacity), each the link's or the app's default; None when
    the mode has no opacity parameter."""
    own = mode.get("opacityKey")
    keys = [own] if own else []
    for k in (mode.get("switches") or {}):
        if k.startswith("show"):
            g = k[4].lower() + k[5:] + "Opacity"
            if g != own and g in state and g not in keys:
                keys.append(g)
    keys = [k for k in keys if k in state]
    if not keys:
        return None
    value = 1.0
    for k in keys:
        try:
            value *= max(0.0, min(1.0, float(state[k])))
        except (TypeError, ValueError):
            pass
    return value


def local_view(query, modes):
    """A link read with no service, as the service's /view reads it:
    `modes`, {id: mode} of the panel tree. {"active", "opacity", "params",
    "camera"}: the modes on, each mode's opacity (the link's or the app's
    default), the link's own parameters (the switches left out), the camera
    when the link has one."""
    state, given = link_state(query)
    active = [mid for mid, m in modes.items() if mode_active(m, state)]
    opacity = {}
    for mid, m in modes.items():
        o = mode_opacity(m, state)
        if o is not None:
            opacity[mid] = o
    camera = {k: given[k] for k in ("lat", "lng", "zoom") if given.get(k) not in (None, "")}
    params = {k: v for k, v in given.items() if not k.startswith("show")}
    return {"active": active, "opacity": opacity, "params": params, "camera": camera}


def _xyz(url):
    """The app's tile template as QGIS's XYZ provider reads it ({quadkey} is
    {q} there)."""
    return url.replace("{quadkey}", "{q}")


def is_xyz(url):
    return isinstance(url, str) and url.lower().startswith(("http://", "https://")) and all(
        t in url for t in ("{z}", "{x}", "{y}"))


# A link's parameters a dated or user basemap needs, handed to the tile
# service's /basemap-tiles with it.
BASEMAP_PARAMS = ("basemap", "imagery", "historicalActiveSource", "date", "overlay")


def basemap_choices(keys=None):
    """[(id, name)] of the Basemap row's select: the app's built-in basemaps
    (lib/basemap-sources.ts, in its order), a keyed one (Mapbox, MapTiler,
    HERE) only while the panel holds its key (`keys`, the panel's API keys),
    as the app offers it once its key is set."""
    keys = keys or {}
    return [(b["id"], b["name"]) for b in builtin_basemaps().values() if not b.get("apiKey") or keys.get(b["apiKey"])]


def basemap_label(src):
    """The select's label of a basemap that is not one of its choices: a
    link's XYZ address, dated source or keyed basemap."""
    known = builtin_basemaps().get(src)
    if known is not None:
        return known["name"]
    if is_xyz(src):
        host = src.split("//", 1)[1].split("/", 1)[0]
        return f"XYZ tiles ({host})"
    return f"{src} (from a link)"


def link_basemap(query):
    """The basemap a link shows, or None when it shows none
    (showRasterBasemap false, the app's default): {"source", "opacity",
    "params"}. The source is view A's (basemapSourceA, or basemapSource with
    basemapPerView=false), the app's default ESRI World Imagery when the
    link names none, or an XYZ address (basemapUrl, imageryUrl, or as the
    source); `params`, the link's own basemap parameters (a dated source's
    date), for the tile service."""
    state, given = link_state(query)
    if not truthy(state.get("showRasterBasemap")):
        return None
    src = next((given[k] for k in ("basemapUrl", "imageryUrl") if is_xyz(given.get(k))), None)
    if src is None:
        src = state.get("basemapSourceA") if truthy(state.get("basemapPerView", True)) else state.get("basemapSource")
    try:
        opacity = max(0.0, min(1.0, float(state.get("rasterBasemapOpacity", 1))))
    except (TypeError, ValueError):
        opacity = 1.0
    return {"source": src or DEFAULT_BASEMAP, "opacity": opacity,
            "params": {k: v for k, v in given.items() if k.startswith(BASEMAP_PARAMS)}}


def basemap_tiles(src, keys=None, service=None, params=None):
    """A basemap as an XYZ layer: (name, XYZ template, max zoom, note), or
    None when not even the default is known. A built-in basemap by its own
    address, with any backend (a keyed one with the panel's key, `keys`); an
    XYZ address as it is; a dated or user source through the tile service's
    /basemap-tiles when there is one (`service`, its address; `params`, the
    link's basemap parameters), else the app's default, ESRI World Imagery,
    said in `note`."""
    keys = keys or {}
    src = src or DEFAULT_BASEMAP
    if is_xyz(src):
        return ("Basemap", _xyz(src), 22, "")
    known = builtin_basemaps()
    note = ""
    b = known.get(src)
    if b is not None and b.get("apiKey") and not keys.get(b["apiKey"]):
        note = f"{b['name']} needs a {b['apiKey']}: ESRI World Imagery instead"
        b = None
    if b is None and service and src not in known:
        q = dict(params or {})
        q.setdefault("basemapSourceA", src)
        return (f"Basemap ({src})", f"{service.rstrip('/')}/basemap-tiles/{{z}}/{{x}}/{{y}}.jpg?{urlencode(q, safe=',{}')}", 22, "")
    if b is None:
        if not note:
            note = f"basemap \"{src}\" needs a tile service: ESRI World Imagery instead"
        b = known.get(DEFAULT_BASEMAP)
        if b is None:
            return None
    url = _xyz(b["url"])
    if b.get("apiKey"):
        url = url.replace("{API_KEY}", keys.get(b["apiKey"], ""))
    return (b["name"], url, int(b.get("maxzoom", 19)), note)


def basemap(query, keys=None, service=None):
    """The basemap a link shows as an XYZ layer (link_basemap then
    basemap_tiles), or None when it shows none."""
    choice = link_basemap(query)
    return None if choice is None else basemap_tiles(choice["source"], keys, service, choice["params"])


def basemap_of_url(url):
    """(source, params) of a basemap layer's XYZ address, to read a saved
    project's basemap back into the Basemap row: a built-in's id, a dated
    source relayed by a tile service (its /basemap-tiles query), else the
    address itself."""
    from urllib.parse import parse_qsl, urlsplit
    for b in builtin_basemaps().values():
        if url.startswith(_xyz(b["url"]).split("{API_KEY}")[0]):
            return b["id"], {}
    if "/basemap-tiles/" in url:
        q = dict(parse_qsl(urlsplit(url).query))
        return q.get("basemapSourceA") or DEFAULT_BASEMAP, q
    return url, {}
