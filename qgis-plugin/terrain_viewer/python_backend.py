"""The experimental Python backend behind the panel's one modes tree: which
of the tile service's modes (by their /processes id) live/ computes, under
which of its own names, which settings carry over, and which elevation
sources it reads. live/modes.py stays the registry of what is computed; this
file only maps the service's vocabulary onto it, so a mode added there under
the service's id (shapeIndex, blobness, localDominance, graticules,
planeSlicer, ...) shows up enabled with no change here.

numpy is imported only when the backend is picked (live.modes imports it)."""
import urllib.request

# The service's id -> live/modes.py's, where they differ.
MODE_ALIAS = {"colorRelief": "elevation"}
# Per service mode: its URL parameter -> live/'s setting.
SETTING_ALIAS = {
    "colorRelief": {"minElevation": "min", "maxElevation": "max"},
    "hillshade": {"hillshadeExag": "exaggeration"},
    "curvature": {"curvatureMode": "mode"},
    "lrm": {"lrmRadius": "radius"},
    "svf": {"svfRadius": "radius"},
    "openness": {"opennessRadius": "radius", "opennessMode": "mode"},
    "shadows": {"shadowRadiusPx": "radius"},
    "contours": {"contourMinor": "minor", "contourMajor": "major"},
    "phong": {"phongDiffuseStrength": "diffuse", "phongSpecularStrength": "specular",
              "phongFresnelStrength": "fresnel", "phongFresnelPower": "fresnelPower"},
    "matcap": {"matcapTextureId": "texture", "matcapRotationDeg": "rotation"},
    "isoline": {"isolineMode": "at"},
    "graticules": {"graticuleDensity": "density", "graticuleWidth": "width", "graticuleColor": "color"},
    "planeSlicer": {"planeSlicerReferenceMode": "reference"},
}
# The shared light (illuminationDir, illuminationAlt) -> live/'s names.
LIGHT_ALIAS = ("azimuth", "altitude")
# The app's hillshade methods that live/ draws as its multidirectional shade.
MULTIDIRECTIONAL = ("aspect-multidir", "multidir-colors")


def registry():
    """live/modes.py's MODES, or None when numpy is missing."""
    try:
        from .live import modes
    except ImportError:
        return None
    return modes.MODES


def numpy_missing():
    try:
        import numpy  # noqa: F401
        return False
    except ImportError:
        return True


def _lower_first(s):
    return s[:1].lower() + s[1:]


def _computed(reg, m):
    """live/ computes `m` (a registry entry not marked python_supported: False)."""
    return bool(m) and m in reg and reg[m].get("python_supported", True)


def py_mode(service_id, values=None, reg=None):
    """live/'s mode for a service mode (and its settings: a multidirectional
    hillshade method), or None when live/ does not compute it (absent, or
    listed with python_supported False, as the mound detector)."""
    reg = reg if reg is not None else (registry() or {})
    if service_id == "hillshade" and values and values.get("hillshadeMethod") in MULTIDIRECTIONAL and _computed(reg, "multihillshade"):
        return "multihillshade"
    for cand in (MODE_ALIAS.get(service_id), service_id, _lower_first(service_id), service_id.lower()):
        if cand in reg:
            return cand if _computed(reg, cand) else None
    # By the registry's own `service` field (its entries that need no
    # particular setting to match).
    for m, spec in reg.items():
        if spec.get("service") == service_id and not spec.get("service_query") and _computed(reg, m):
            return m
    return None


def setting_target(service_id, key, py, reg=None):
    """live/'s setting for a service URL parameter, or None. Explicit aliases
    first, then the parameter itself, then the parameter with the mode's
    name taken off (shapeIndexMin -> min, localDominanceMaxRadius ->
    maxRadius), so a mode added to live/ with those names maps by itself."""
    reg = reg if reg is not None else (registry() or {})
    if py is None or py not in reg:
        return None
    defaults = reg[py].get("defaults", {})
    alias = SETTING_ALIAS.get(service_id, {}).get(key)
    if alias in defaults:
        return alias
    if key in defaults:
        return key
    for prefix in (service_id, py):
        if key.startswith(prefix) and len(key) > len(prefix):
            rest = _lower_first(key[len(prefix):])
            if rest in defaults:
                return rest
    return None


def py_forms(service_id, service_forms, reg=None):
    """The forms the panel offers for a mode under the Python backend: the
    service's forms that live/ also makes (hillshade has no Values in the
    service: none here either)."""
    reg = reg if reg is not None else (registry() or {})
    py = py_mode(service_id, None, reg)
    if py is None:
        return set()
    spec = reg[py]
    if spec.get("outputs"):
        mine = set(spec["outputs"])
    else:
        mine = {"colour"}
        if spec.get("values", True) and spec.get("kind") != "rgb":
            mine.add("values")
        if spec.get("vector"):
            mine.add("vector")
    return set(service_forms) & mine


def py_opts(service_id, values, light=None, reg=None):
    """live/'s settings from the panel's values (the service's URL
    parameters) and the shared light, only those that differ from live/'s
    defaults (the address stays short)."""
    reg = reg if reg is not None else (registry() or {})
    py = py_mode(service_id, values, reg)
    if py is None:
        return None, {}
    defaults = reg[py].get("defaults", {})
    enums = reg[py].get("enums", {})
    out = {}
    for key, v in (values or {}).items():
        target = setting_target(service_id, key, py, reg)
        if target is None:
            continue
        if target in enums and str(v) not in enums[target]:
            continue
        out[target] = v
    if light is not None:
        for target, v in zip(LIGHT_ALIAS, light):
            if target in defaults:
                out[target] = v
    clean = {}
    for k, v in out.items():
        d = defaults.get(k)
        try:
            v = type(d)(float(v)) if isinstance(d, (int, float)) and not isinstance(d, bool) else v
        except (TypeError, ValueError):
            continue
        if str(v) != str(d):
            clean[k] = v
    return py, clean


def unsupported_settings(service_id, keys, reg=None):
    """The service mode's settings live/ ignores (shown greyed out)."""
    reg = reg if reg is not None else (registry() or {})
    py = py_mode(service_id, None, reg)
    return {k for k in keys if setting_target(service_id, k, py, reg) is None and not k.endswith("Opacity")}


# -- elevation sources ---------------------------------------------------------
# The library's Terrarium and Terrain-RGB pyramids with a public address are
# read as they are; Mapbox and MapTiler with the user's key. Anything else
# (COG, VRT, LERC, WMS, quantized mesh, a difference of two) needs the tile
# service.
KEYED = {
    "mapbox": ("mapboxKey", "https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token={key}", "terrainrgb", 15, 256),
    "maptiler": ("maptilerKey", "https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key={key}", "terrainrgb", 12, 512),
}
_sizes = {}


def _tile_size(url, encoding):
    """The pixel size of a pyramid's tiles, read from one tile (z0 or z1), 256
    when it cannot be read."""
    if url in _sizes:
        return _sizes[url]
    size = 256
    for z, x, y in ((0, 0, 0), (1, 0, 0), (1, 1, 0)):
        try:
            req = urllib.request.Request(url.format(z=z, x=x, y=y), headers={"User-Agent": "terrain-viewer-qgis-live/0.7"})
            with urllib.request.urlopen(req, timeout=8) as r:
                data = r.read()
            from qgis.PyQt.QtGui import QImage
            img = QImage.fromData(data)
            if not img.isNull():
                size = img.width()
                break
        except Exception:  # noqa: BLE001 - try the next, else 256
            continue
    _sizes[url] = size
    return size


def source_spec(source, sources, keys):
    """(live/ source id, None) for a source live/ reads, registered into
    live.dem.SOURCES; (None, reason) otherwise. `source`: a library id or a
    tile address ({z}/{x}/{y}, Terrarium unless it says terrain-rgb);
    `sources`: the service's /terrain-sources (or the packaged snapshot); `keys`:
    {mapboxKey: ...}."""
    from .live import dem
    if not source or source == "mapterhorn":
        return "mapterhorn", None
    if source in KEYED:
        key_name, template, encoding, maxzoom, size = KEYED[source]
        key = (keys or {}).get(key_name)
        if not key:
            return None, f"{source} needs {key_name} (API keys)"
        sid = f"{source}-{abs(hash(key)) % 10 ** 8}"
        dem.SOURCES.setdefault(sid, {"url": template.replace("{key}", key), "size": size, "maxzoom": maxzoom, "encoding": encoding})
        return sid, None
    if source in dem.SOURCES:
        return source, None
    entry = next((s for s in sources or [] if s.get("id") == source), None)
    if entry is not None:
        url, encoding = entry.get("url"), entry.get("type")
        if encoding not in ("terrarium", "terrainrgb") or not url or "{z}" not in url:
            return None, (f"{entry.get('name', source)} is a {encoding} source: the Python backend reads Terrarium and "
                          "Terrain-RGB tiles only (use a tile service for it)")
        maxzoom = int(entry.get("maxzoom") or 15)
    elif "{z}" in source and source.startswith(("http://", "https://")):
        url = source
        encoding = "terrainrgb" if "terrain-rgb" in source.lower() or "terrainrgb" in source.lower() else "terrarium"
        maxzoom = 15
    else:
        return None, f"{source}: the Python backend reads Terrarium and Terrain-RGB tile addresses ({{z}}/{{x}}/{{y}}) only"
    size = _tile_size(url, encoding)
    # A library source's maxzoom counts 256 px tiles (Mapterhorn's 512 px
    # pyramid, native z17, is listed 18); live/ wants the native one.
    dem.SOURCES[source] = {"url": url, "size": size, "maxzoom": maxzoom - (1 if size == 512 and entry is not None else 0),
                           "encoding": encoding}
    return source, None


def supported_sources(sources):
    """The ids of `sources` the Python backend reads (with a key when needed)."""
    out = ["mapterhorn"]
    for s in sources or []:
        if s.get("id") in KEYED or (s.get("type") in ("terrarium", "terrainrgb") and s.get("url") and "{z}" in s["url"]):
            if s["id"] not in out:
                out.append(s["id"])
    return out
