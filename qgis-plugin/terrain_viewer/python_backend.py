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
# Per service mode: its URL parameter -> live/'s setting. (The ramp
# settings keep the service's names: live/ramps.py reads them as they are.)
SETTING_ALIAS = {
    "hillshade": {"hillshadeExag": "exaggeration", "hillshadeMethod": "method"},
    "curvature": {"curvatureMode": "mode"},
    "lrm": {"lrmRadius": "radius"},
    "svf": {"svfRadius": "radius"},
    "openness": {"opennessRadius": "radius", "opennessMode": "mode"},
    "shadows": {"shadowRadiusPx": "radius"},
    "contours": {"contourMinor": "minor", "contourMajor": "major", "contourReferenceMode": "reference",
                 "contourMinorLrm": "minorLrm", "contourMajorLrm": "majorLrm", "contourWeight": "weight",
                 "contourColor": "color"},
    "moundDetector": {"tellSize": "size", "tellRadius": "radius", "tellMinRelief": "minRelief",
                      "tellBlobnessMin": "blobnessMin", "tellPlanMin": "planMin", "tellDetHessianMin": "detHessianMin",
                      "tellMeasureScale": "measureScale", "tellVetoResolution": "vetoResolution",
                      "tellsPolarity": "polarity", "tellsStyle": "style", "tellsOutlineColor": "outlineColor",
                      "tellsPitColor": "pitColor", "tellsScaleMarkers": "scaleMarkers",
                      "tellsScaleMultiplier": "scaleMultiplier"},
    "phong": {"phongDiffuseStrength": "diffuse", "phongSpecularStrength": "specular",
              "phongFresnelStrength": "fresnel", "phongFresnelPower": "fresnelPower"},
    "matcap": {"matcapTextureId": "texture", "matcapRotationDeg": "rotation"},
    "isoline": {"isolineMode": "at"},
    "graticules": {"graticuleDensity": "density", "graticuleWidth": "width", "graticuleColor": "color"},
    "planeSlicer": {"planeSlicerReferenceMode": "reference"},
}
# The shared light (illuminationDir, illuminationAlt) -> live/'s names.
LIGHT_ALIAS = ("azimuth", "altitude")
# The panel's settings the panel itself applies (the hypsometric range that
# follows the view is computed by the panel; a symmetric range mirrors its
# minimum in the panel).
PANEL_SETTINGS = ("hypsoAutoRange",)
# The app's hillshade methods that 0.7.0 drew as its multidirectional shade;
# the hillshade's colour tile draws every method since (live/hillshade.py).
MULTIDIRECTIONAL = ()


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
    colour_keys = reg[py].get("colour_keys", ())
    colour_defaults = _colour_defaults(reg[py].get("service", service_id))
    for key, v in (values or {}).items():
        if key in colour_keys:
            # A ramp setting, under the service's name; only when it differs
            # from the app's default (the address stays short).
            if v is not None and v != "" and _fmt(v) != _fmt(colour_defaults.get(key)):
                out[key] = v
            continue
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
        if k in colour_keys:
            clean[k] = _fmt(v)
            continue
        d = defaults.get(k)
        try:
            v = type(d)(float(v)) if isinstance(d, (int, float)) and not isinstance(d, bool) else v
        except (TypeError, ValueError):
            continue
        if str(v) != str(d):
            clean[k] = v
    return py, clean


def _fmt(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return "" if v is None else str(v)


def _colour_defaults(service_mode):
    try:
        from .live import ramps
    except ImportError:
        return {}
    return ramps.DEFAULTS.get(service_mode, {})


def unsupported_settings(service_id, keys, reg=None):
    """The service mode's settings live/ ignores (shown greyed out): not a
    setting of live/'s mode, not a ramp setting (live/ramps.py), not one the
    panel applies itself (symmetric, the hypsometric auto range)."""
    reg = reg if reg is not None else (registry() or {})
    py = py_mode(service_id, None, reg)
    colour_keys = reg.get(py, {}).get("colour_keys", ()) if py else ()
    return {k for k in keys if setting_target(service_id, k, py, reg) is None and not k.endswith("Opacity")
            and k not in colour_keys and not k.endswith("Symmetric") and k not in PANEL_SETTINGS}


def elevation_opts(values, opts, auto_range=None):
    """The colour relief's ramp settings under the Python backend, as the
    tile service reads them (customHypsoMinMax off: the ramp's own stops);
    the view's range when the range follows the view (hypsoAutoRange: the
    2nd to 98th percentile, `auto_range`). Returns opts, updated."""
    if values.get("hypsoAutoRange") in (True, "true") and auto_range:
        opts.update({"customHypsoMinMax": "true", "minElevation": _fmt(float(auto_range[0])),
                     "maxElevation": _fmt(float(auto_range[1]))})
    return opts


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
    if is_local_source(source):
        return gdal_source_spec(source)
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
        if encoding in ("cog", "vrt") and url and str(url).startswith("https://") and "{z}" not in url:
            return gdal_source_spec(url)  # GDAL reads the library's COGs and VRTs over /vsicurl/
        if encoding not in ("terrarium", "terrainrgb") or not url or "{z}" not in url:
            return None, (f"{entry.get('name', source)} is a {encoding} source: the Python backend reads Terrarium and "
                          "Terrain-RGB tiles, COGs, VRTs, QGIS raster layers and what GDAL opens (use a tile service for it)")
        maxzoom = int(entry.get("maxzoom") or 15)
    elif "{z}" in source and source.startswith(("http://", "https://")):
        url = source
        encoding = "terrainrgb" if "terrain-rgb" in source.lower() or "terrainrgb" in source.lower() else "terrarium"
        maxzoom = 15
    else:
        return None, (f"{source}: the Python backend reads Terrarium and Terrain-RGB tile addresses ({{z}}/{{x}}/{{y}}), "
                      "QGIS raster layers and what GDAL opens")
    size = _tile_size(url, encoding)
    # A library source's maxzoom counts 256 px tiles (Mapterhorn's 512 px
    # pyramid, native z17, is listed 18); live/ wants the native one.
    dem.SOURCES[source] = {"url": url, "size": size, "maxzoom": maxzoom - (1 if size == 512 and entry is not None else 0),
                           "encoding": encoding}
    return source, None


LAYER_PREFIX = "layer:"


def is_local_source(source):
    """A QGIS raster layer of the project (layer:<id>) or anything GDAL opens
    (a file, a VRT, /vsicurl/, WCS:, a GDAL WMS description; https GeoTIFFs
    and VRTs): what the Python backend reads through GDAL."""
    if not source:
        return False
    s = str(source)
    if s.startswith(LAYER_PREFIX):
        return True
    try:
        from .live.gdal_source import looks_gdal
    except ImportError:
        return False
    return looks_gdal(s)


def layer_of(source):
    """The project's raster layer of a layer:<id> source, or None."""
    from qgis.core import QgsProject, QgsRasterLayer
    if not str(source).startswith(LAYER_PREFIX):
        return None
    layer = QgsProject.instance().mapLayer(str(source)[len(LAYER_PREFIX):])
    return layer if isinstance(layer, QgsRasterLayer) and layer.isValid() else None


def local_file(source):
    """The file on this machine behind a source (a GDAL layer's file, a path
    given), for a tile service on this machine to register; None when there
    is none (a WMS, an https address)."""
    import os
    layer = layer_of(source)
    if layer is not None:
        if layer.providerType() != "gdal":
            return None
        from qgis.core import QgsProviderRegistry
        path = QgsProviderRegistry.instance().decodeUri("gdal", layer.source()).get("path") or layer.source().split("|")[0]
    else:
        path = str(source)[5:] if str(source).startswith("gdal:") else str(source)
    return os.path.abspath(path) if os.path.isfile(path) else None


def gdal_source_spec(source):
    """(live/ source id, None) for a raster layer or a GDAL source, probed
    and registered into live.dem.SOURCES; (None, reason) when GDAL cannot
    read it."""
    import hashlib
    from .live import dem, gdal_source
    layer = None
    try:
        if str(source).startswith(LAYER_PREFIX):
            layer = layer_of(source)
            if layer is None:
                return None, f"{source}: no such raster layer in the project"
            spec = gdal_source.layer_spec(layer)
        else:
            spec = gdal_source.probe(gdal_source.gdal_path(source))
    except Exception as e:  # noqa: BLE001 - GDAL's own message
        return None, f"{getattr(layer, 'name', lambda: source)()}: {e}"
    key = spec.get("gdal") or spec.get("uri") or str(source)
    sid = "gdal-" + hashlib.sha1((key + repr(spec.get("open_options"))).encode("utf-8")).hexdigest()[:12]
    dem.SOURCES[sid] = spec
    return sid, None


def layer_sources(project):
    """The project's raster layers the backends can read as elevation, as the
    source picker lists them: [(label, "layer:<id>")]. The panel's own
    layers are left out."""
    from qgis.core import QgsRasterLayer
    out = []
    for layer in project.mapLayers().values():
        if not isinstance(layer, QgsRasterLayer) or not layer.isValid() or layer.customProperty("terrain_viewer/layer"):
            continue
        if layer.customProperty("terrain_viewer/frozen") or layer.customProperty("terrain_viewer/local_mode"):
            continue
        prov = layer.providerType()
        if prov == "wms" and "type=xyz" in layer.source():
            continue  # picture tiles, not elevation
        if prov not in ("gdal", "wcs", "wms", "arcgismapserver", "arcgisfeatureserver") or layer.bandCount() < 1:
            continue
        out.append((f"QGIS layer: {layer.name()}", LAYER_PREFIX + layer.id()))
    return sorted(out)


def supported_sources(sources):
    """The ids of `sources` the Python backend reads (with a key when needed)."""
    out = ["mapterhorn"]
    for s in sources or []:
        if s.get("id") in KEYED or (s.get("type") in ("terrarium", "terrainrgb") and s.get("url") and "{z}" in s["url"]) \
                or (s.get("type") in ("cog", "vrt") and str(s.get("url") or "").startswith("https://")):
            if s["id"] not in out:
                out.append(s["id"])
    return out
