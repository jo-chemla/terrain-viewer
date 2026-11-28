"""The app's Vector library (lib/custom-sources.json SAMPLE_VECTOR_SOURCES,
carried by assets/app_defaults.json as `vectorSources`) as native QGIS
layers, styled from each entry's categories, with its attribution.

What QGIS reads, measured in QGIS 4.2 and 3.44 (2026-11-27):

| Entry's type | The QGIS layer |
|---|---|
| mvt (a {z}/{x}/{y} template) | A vector tile layer (type=xyz) |
| tilejson | The same, from the tiles address the TileJSON names (one request) |
| style (a MapLibre style) | A vector tile layer with the style imported by QGIS (styleUrl, loadDefaultStyle), its geometry tests repaired (fix_geometry_test), cut to the entry's styleLayerTypes (lines and labels: the fills dropped) |
| pmtiles over https | A vector layer of GDAL's PMTiles driver (GDAL 3.8 or later) over /vsicurl/ (one per source layer, ZOOM_LEVEL_AUTO) |
| pmtiles GDAL cannot read: on Overture's host (it answers 400 to the HEAD and the un-ranged GET GDAL sizes a file with, whatever GDAL's use_head), or any archive when GDAL has no PMTiles driver (before 3.8) | A vector tile layer on the plugin's own 127.0.0.1 server, which reads the archive by range requests (live/pmtiles.py, /pmtiles/{z}/{x}/{y}.pbf): drawn while the panel is open |
| geojson | A vector layer of GDAL (the file downloaded whole) |
| geojson, format "compact" | The file downloaded, its properties put back (expand_compact, the app's expandCompactGeoJSON), written to the profile's terrain_viewer/vector folder and opened from there |

QGIS's own vector tile layer reads no PMTiles archive, local or remote
(checked 2026-11-27 in 3.44.11 and 4.2.0: its providers are
xyzvectortiles, mbtilesvectortiles, vtpkvectortiles and
arcgisvectortileservice; a `type=pmtiles&url=...` layer is invalid, with no
provider; the word pmtiles is nowhere in qgis_core.dll; QGIS's source has
it only in its STAC browser, from 4.4 on, which opens such an asset as
`/vsicurl/...|option:ZOOM_LEVEL_AUTO=YES` with the ogr provider: this
module's route). "QGIS reads remote PMTiles" is GDAL's driver.

The plan (which layers, which addresses) is plain Python, tested offline;
the layers and their styles need QGIS. Nothing here is live: a layer added
is the project's, the panel never changes it afterwards."""
import json
import re
import urllib.request

from . import assets

APP_SITE = "https://terrain-viewer.iconem.com"
# Where the app's own files (public/vector/*.geojson) also are: the release
# its build pulls them from (datasets.lock.json). Read when the site does not
# serve a file yet (an entry newer than the last deploy).
APP_FILES_RELEASE = "https://github.com/Iconem/terrain-viewer/releases/download/dataset-indexes/"
GROUP = "Vector overlays (library)"
PROP = "terrain_viewer/overlay"  # on a layer: the Library id it shows
GROUP_TITLES = (("buildings", "Buildings"), ("heritage", "Heritage"), ("landcover", "Land cover and land use"),
                ("reference", "Reference"))
FILL_OPACITY = 0.7
DEFAULT_COLOR = "#f97316"  # the app's VECTOR_STYLE_DEFAULT
# The Library's footprints wait for this zoom in the app (VECTOR_FOOTPRINT_MINZOOM).
FOOTPRINT_MINZOOM = 11
USER_AGENT = "terrain-viewer-qgis"
# Hosts whose archives GDAL's /vsicurl/ cannot open (measured 2026-11-27,
# GDAL 3.13: HTTP 400 to HEAD and to a GET without a Range; use_head=no and
# CPL_VSIL_CURL_USE_HEAD=NO end on the same 400): their PMTiles are served
# as vector tiles by the plugin's own server instead.
NO_GDAL_HOSTS = ("tiles.overturemaps.org",)
# Whether GDAL has its PMTiles driver (3.8 or later); None: asked once.
# Without it every archive goes through the plugin's own server.
GDAL_PMTILES = None
VECTOR_DIR = "vector"  # in the profile's terrain_viewer folder: the compact files, expanded
LOCAL_MARK = "/pmtiles/{z}/{x}/{y}.pbf?"


def entries():
    """The Library's vector sources, in list order."""
    return list(assets._json("app_defaults.json").get("vectorSources", []))


def grouped(items=None):
    """[(title, [entry])] in the app's groups, the unknown ones last."""
    items = entries() if items is None else items
    known = dict(GROUP_TITLES)
    out = [(title, [e for e in items if e.get("libraryGroup") == gid]) for gid, title in GROUP_TITLES]
    rest = [e for e in items if e.get("libraryGroup") not in known]
    return [(t, es) for t, es in out if es] + ([("Other", rest)] if rest else [])


def label(entry):
    return entry.get("shortName") or entry.get("name") or entry.get("id")


def parts(entry):
    """The entry and its companions (a points archive and a shapes
    archive), each inheriting what it does not state (lib/vector-sources.ts
    vectorParts)."""
    main = {k: v for k, v in entry.items() if k != "companions"}
    out = [main]
    for c in entry.get("companions") or []:
        part = dict(main)
        part.pop("resolver", None)
        part.update(c)
        out.append(part)
    return out


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def resolve_url(entry, release=None):
    """The entry's address: an app file ("/vector/x.geojson") on the app's
    site, a `{release}` filled (Overture's current one, `release`, else the
    entry's fallback)."""
    url = entry.get("url") or ""
    if url.startswith("/") and not url.startswith("//"):
        return APP_SITE + url
    if "{release}" in url:
        rel = release or entry.get("fallbackRelease")
        return url.replace("{release}", rel) if rel else None
    return url


def _xyz_uri(template, zmin, zmax, style_url=None):
    uri = f"type=xyz&url={template}&zmin={int(zmin or 0)}&zmax={int(zmax if zmax is not None else 14)}"
    return uri + (f"&styleUrl={style_url}" if style_url else "")


def gdal_reads_pmtiles():
    """Whether this QGIS's GDAL has the PMTiles driver (GDAL 3.8+)."""
    global GDAL_PMTILES
    if GDAL_PMTILES is None:
        try:
            from osgeo import ogr
            GDAL_PMTILES = ogr.GetDriverByName("PMTiles") is not None
        except Exception:  # noqa: BLE001 - no bindings: let GDAL try
            GDAL_PMTILES = True
    return GDAL_PMTILES


def _js_text(value):
    """A value as JavaScript's String() writes it (the keys of `shared`)."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def expand_compact(collection):
    """A compact GeoJSON's properties put back, as the app's
    expandCompactGeoJSON does (lib/vector-sources.ts): `keys` names the
    short property keys ({"n": "name"}), `shared` says once the properties
    of the features grouped by its `by` property ({"by": "id_no", "values":
    {"13": {...}}}); a feature's own property wins. A file with neither
    member comes back as it is."""
    if not isinstance(collection, dict):
        return collection
    keys = collection.get("keys") if isinstance(collection.get("keys"), dict) else None
    shared = collection.get("shared") if isinstance(collection.get("shared"), dict) else {}
    by = shared.get("by") if isinstance(shared.get("by"), str) else None
    groups = shared.get("values") if by and isinstance(shared.get("values"), dict) else None
    if (not keys and not groups) or not isinstance(collection.get("features"), list):
        return collection
    features = []
    for f in collection["features"]:
        f = f if isinstance(f, dict) else {}
        own = {(keys[k] if keys and k in keys else k): v for k, v in (f.get("properties") or {}).items()}
        group = groups.get(_js_text(own[by])) if groups and by in own else None
        features.append({**f, "properties": {**group, **own} if isinstance(group, dict) else own})
    out = {k: v for k, v in collection.items() if k not in ("keys", "shared")}
    out["features"] = features
    return out


def compact_file(entry, url, fallback=None, fetch=_get, folder=None):
    """A compact GeoJSON downloaded (from `url`, else `fallback`), expanded
    and written as <folder>/<entry id>.geojson (the profile's
    terrain_viewer/vector by default): the path GDAL then opens. Written
    again on each Add, so a file the app rebuilt is read anew."""
    import os
    import re
    try:
        data = fetch(url)
    except Exception:  # noqa: BLE001 - the site does not serve it (yet): the release
        if not fallback:
            raise
        data = fetch(fallback)
    collection = expand_compact(json.loads(data))
    if folder is None:
        from qgis.core import QgsApplication
        folder = os.path.join(QgsApplication.qgisSettingsDirPath(), "terrain_viewer", VECTOR_DIR)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, re.sub(r"[^A-Za-z0-9._-]+", "-", entry["id"]) + ".geojson")
    with open(path + ".part", "w", encoding="utf-8", newline="\n") as f:
        json.dump(collection, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(path + ".part", path)
    return path


def plan(entry, fetch=_get, release=None, gdal_pmtiles=None):
    """The QGIS layers an entry becomes: [{"provider": "vectortile" | "ogr",
    "uri", "name", "layers": [source layers], "geometries", "part": the
    entry or companion it draws, "style": True for a MapLibre style,
    "archive": the PMTiles address the plugin's own server reads (then no
    "uri": make_layers builds it on that server), "compact": True for a
    GeoJSON make_layers expands first}].
    `fetch(url) -> bytes` reads a TileJSON or a style (the only requests).
    `gdal_pmtiles`: whether GDAL reads PMTiles (asked when None)."""
    out = []
    if gdal_pmtiles is None:
        gdal_pmtiles = gdal_reads_pmtiles()
    several = len(parts(entry)) > 1
    for part in parts(entry):
        url = resolve_url(part, release)
        if not url:
            continue
        kind = part.get("type")
        geoms = list(part.get("geometries") or ["polygon"])
        name = label(entry)
        if kind == "geojson":
            item = {"provider": "ogr", "uri": url, "name": name, "layers": [], "geometries": geoms, "part": part}
            if url.startswith(APP_SITE + "/"):
                item["fallback"] = APP_FILES_RELEASE + url.rsplit("/", 1)[-1]
            if part.get("format") == "compact":
                item["compact"] = True
            out.append(item)
        elif kind == "pmtiles" and (not gdal_pmtiles or url.split("//", 1)[-1].split("/", 1)[0] in NO_GDAL_HOSTS):
            out.append({"provider": "vectortile", "archive": url, "uri": None, "name": name, "zmin": part.get("minzoom") or 0,
                        "zmax": part.get("maxzoom") if part.get("maxzoom") is not None else 14,
                        "layers": list(part.get("sourceLayers") or []), "geometries": geoms, "part": part})
        elif kind == "pmtiles":
            layers = list(part.get("sourceLayers") or [])
            for lyr in layers:
                suffix = f" ({lyr})" if several or len(layers) > 1 else ""
                out.append({"provider": "ogr", "uri": f"/vsicurl/{url}|layername={lyr}|option:ZOOM_LEVEL_AUTO=YES",
                            "name": name + suffix, "layers": [lyr], "geometries": geoms, "part": part})
        elif kind == "mvt":
            out.append({"provider": "vectortile", "uri": _xyz_uri(url, part.get("minzoom"), part.get("maxzoom")), "name": name,
                        "layers": list(part.get("sourceLayers") or []), "geometries": geoms, "part": part})
        elif kind == "tilejson":
            tj = json.loads(fetch(url))
            out.append({"provider": "vectortile",
                        "uri": _xyz_uri(tj["tiles"][0], tj.get("minzoom", 0), tj.get("maxzoom", part.get("maxzoom"))), "name": name,
                        "layers": list(part.get("sourceLayers") or []), "geometries": geoms, "part": part})
        elif kind == "style":
            style = json.loads(fetch(url))
            src = next((s for s in (style.get("sources") or {}).values() if s.get("type") == "vector"), None)
            if src is None:
                continue
            if src.get("tiles"):
                template, zmin, zmax = src["tiles"][0], src.get("minzoom", 0), src.get("maxzoom", 14)
            else:
                tj = json.loads(fetch(src["url"]))
                template, zmin, zmax = tj["tiles"][0], tj.get("minzoom", 0), tj.get("maxzoom", 14)
            out.append({"provider": "vectortile", "uri": _xyz_uri(template, zmin, zmax, url), "name": name, "layers": [],
                        "geometries": [], "part": part, "style": True})
    return out


# -- categories as QGIS expressions --------------------------------------------
def _quote(text):
    return "'" + str(text).replace("'", "''") + "'"


def _field_text(field):
    return 'coalesce(to_string("' + str(field).replace('"', '""') + "\"), '')"


def category_test(category):
    """One category as a QGIS expression, as the app's categoryExpression
    tests it: the field's text equal to the value, one of the values, or
    simply there (no value)."""
    text, value = _field_text(category["field"]), category.get("value")
    if value is None:
        return f"{text} <> ''"
    if isinstance(value, (list, tuple)):
        return f"{text} IN ({', '.join(_quote(v) for v in value)})"
    return f"{text} = {_quote(value)}"


def category_rules(entry, fields=None):
    """[(label, color, expression)]: the entry's categories as rules no two
    of which match one feature (the app takes the first that matches; QGIS
    draws every rule that does), then "other" for the rest, in the entry's
    one color. `fields`: the layer's field names when known (a category on a
    field the layer lacks is left out); no categories: one rule, no
    expression."""
    color = entry.get("color") or DEFAULT_COLOR
    cats = [c for c in entry.get("categories") or [] if fields is None or c.get("field") in fields]
    if not cats:
        return [(label(entry), color, "")]
    rules, before = [], []
    for c in cats:
        test = category_test(c)
        rules.append((c.get("label") or str(c.get("value")), c.get("color") or color,
                      " AND ".join([f"({test})"] + [f"NOT ({t})" for t in before])))
        before.append(test)
    rules.append(("other", color, " AND ".join(f"NOT ({t})" for t in before)))
    return rules


def min_scale(entry):
    """The scale denominator under which the app draws the entry (its
    minzoom, zoom 11 for the Library's footprints), or 0 for none. The app's
    zoom z is QGIS's 256 px zoom z + 1."""
    z = entry.get("minzoom") or 0
    if entry.get("libraryGroup") == "buildings":
        z = max(z, FOOTPRINT_MINZOOM)
    return 0 if z <= 0 else 591657550.5 / 2 ** z


# -- QGIS ---------------------------------------------------------------------
def _geom_types():
    try:
        from qgis.core import Qgis
        return {"point": Qgis.GeometryType.Point, "line": Qgis.GeometryType.Line, "polygon": Qgis.GeometryType.Polygon}
    except (ImportError, AttributeError):
        from qgis.core import QgsWkbTypes
        return {"point": QgsWkbTypes.PointGeometry, "line": QgsWkbTypes.LineGeometry, "polygon": QgsWkbTypes.PolygonGeometry}


def symbol(geom, color, part):
    """One color's symbol for a geometry kind, as the app draws it: a fill
    at 70 % with a thin dark outline (none with outline false; outlines only
    with polygonFill false), a line, a ringed dot."""
    from qgis.PyQt.QtGui import QColor
    from qgis.core import QgsFillSymbol, QgsLineSymbol, QgsMarkerSymbol
    c = QColor(color)
    if geom == "polygon":
        if part.get("polygonFill") is False:
            return QgsFillSymbol.createSimple({"style": "no", "outline_color": c.name(), "outline_width": "0.4"})
        fill = f"{c.red()},{c.green()},{c.blue()},{round(255 * FILL_OPACITY)}"
        if part.get("outline") is False:
            return QgsFillSymbol.createSimple({"color": fill, "outline_style": "no"})
        return QgsFillSymbol.createSimple({"color": fill, "outline_color": "0,0,0,115", "outline_width": "0.15"})
    if geom == "line":
        return QgsLineSymbol.createSimple({"line_color": c.name(), "line_width": "0.5", "capstyle": "round", "joinstyle": "round"})
    return QgsMarkerSymbol.createSimple({"name": "circle", "color": c.name(), "size": "2.6", "outline_color": "255,255,255,220",
                                         "outline_width": "0.3"})


def style_vector_layer(layer, entry, part):
    """A GDAL vector layer (a PMTiles layer, a GeoJSON) drawn by category:
    QGIS's rule-based renderer, one rule per category with its label in the
    legend; one symbol when the entry has none."""
    from qgis.core import QgsRuleBasedRenderer, QgsSingleSymbolRenderer
    types = _geom_types()
    geom = next((g for g, t in types.items() if t == layer.geometryType()), "polygon")
    rules = category_rules(entry, {f.name() for f in layer.fields()})
    if len(rules) == 1:
        layer.setRenderer(QgsSingleSymbolRenderer(symbol(geom, rules[0][1], part)))
        return 1
    root = QgsRuleBasedRenderer.Rule(None)
    for name, color, expr in rules:
        root.appendChild(QgsRuleBasedRenderer.Rule(symbol(geom, color, part), 0, 0, expr, name))
    layer.setRenderer(QgsRuleBasedRenderer(root))
    return len(rules)


def style_tile_layer(layer, entry, item):
    """A vector tile layer drawn by category: one style per source layer,
    geometry kind and category."""
    from qgis.core import QgsVectorTileBasicRenderer, QgsVectorTileBasicRendererStyle
    types = _geom_types()
    styles = []
    for lyr in item["layers"] or [""]:
        for geom in item["geometries"] or ["polygon"]:
            for name, color, expr in category_rules(entry):
                st = QgsVectorTileBasicRendererStyle(f"{name} ({geom})" if len(item["geometries"]) > 1 else name, lyr, types[geom])
                st.setFilterExpression(expr)
                st.setSymbol(symbol(geom, color, item["part"]))
                styles.append(st)
    renderer = QgsVectorTileBasicRenderer()
    renderer.setStyles(styles)
    layer.setRenderer(renderer)
    layer.setLabeling(None)
    return len(styles)


# QGIS's MapLibre style converter (3.44 and 4.2) writes the expression
# ["geometry-type"] as an empty field name, "": a filter such as ["match",
# ["geometry-type"], ["LineString", "MultiLineString"], true, false]
# becomes `"" IN ('LineString', 'MultiLineString')`, false for every
# feature, and the style draws nothing (OpenFreeMap's Dark and Fiord drew no
# line at all, Positron and Bright only their labels; found 2026-11-28).
_GEOM_TEST = re.compile(r'(?<![\w"])""' + r"\s*(NOT\s+IN|IN|IS\s+NOT|IS|=|!=|<>)\s*(\([^()]*\)|'[^']*')", re.IGNORECASE)
_GEOM_NAMES = {"point": ("point", "multipoint"), "line": ("linestring", "multilinestring"),
               "polygon": ("polygon", "multipolygon")}


def fix_geometry_test(expr, geom):
    """A converted filter with its geometry tests settled for a style that
    draws `geom` ("point", "line", "polygon") only: each `"" IN (...)`,
    `"" = '...'` (and their negations) becomes TRUE or FALSE. A style of
    no known geometry keeps its filter."""
    if not expr or '""' not in expr or geom not in _GEOM_NAMES:
        return expr
    mine = _GEOM_NAMES.get(geom, ())

    def settle(m):
        op = " ".join(m.group(1).upper().split())
        names = [n.strip().strip("'").lower() for n in m.group(2).strip("()").split(",")]
        hit = any(n in mine for n in names)
        return "TRUE" if hit != (op in ("NOT IN", "IS NOT", "!=", "<>")) else "FALSE"
    return _GEOM_TEST.sub(settle, expr)


def _fix_geometry_tests(layer):
    """fix_geometry_test on every style and label style of a layer whose
    style QGIS imported. Returns how many filters changed."""
    types = _geom_types()
    kind = {v: k for k, v in types.items()}
    n = 0
    if layer.renderer() is not None and hasattr(layer.renderer(), "styles"):
        renderer = layer.renderer().clone()
        styles = renderer.styles()
        for st in styles:
            fixed = fix_geometry_test(st.filterExpression(), kind.get(st.geometryType()))
            if fixed != st.filterExpression():
                st.setFilterExpression(fixed)
                n += 1
        renderer.setStyles(styles)
        layer.setRenderer(renderer)
    labeling = layer.labeling()
    if labeling is not None and hasattr(labeling, "styles"):
        labeling = labeling.clone()
        lstyles = labeling.styles()
        for st in lstyles:
            fixed = fix_geometry_test(st.filterExpression(), kind.get(st.geometryType()))
            if fixed != st.filterExpression():
                st.setFilterExpression(fixed)
                n += 1
        labeling.setStyles(lstyles)
        layer.setLabeling(labeling)
    return n


def style_from_maplibre(layer, part):
    """The entry's MapLibre style, imported by QGIS, cut to its
    styleLayerTypes: without "fill", the polygon styles go (roads, rails,
    borders and names over any map); without "symbol", the labels."""
    types = _geom_types()
    wanted = set(part.get("styleLayerTypes") or ["fill", "line", "symbol"])
    layer.loadDefaultStyle()
    _fix_geometry_tests(layer)
    renderer = layer.renderer().clone()
    keep = [s for s in renderer.styles()
            if (s.geometryType() != types["polygon"] or "fill" in wanted)
            and (s.geometryType() != types["line"] or "line" in wanted)
            and (s.geometryType() != types["point"] or "symbol" in wanted)]
    renderer.setStyles(keep)
    layer.setRenderer(renderer)
    if "symbol" not in wanted:
        layer.setLabeling(None)
    return len(keep)


def credit(layer, entry):
    """The entry's attribution, licence, description and page on the layer:
    its metadata (Layer Properties > Information) and its attribution (the
    copyright decoration, a print layout's attribution)."""
    from qgis.core import QgsAbstractMetadataBase
    text = entry.get("attribution") or entry.get("shortAttribution") or ""
    try:
        md = layer.metadata()
        md.setTitle(entry.get("name") or label(entry))
        md.setAbstract(entry.get("description") or "")
        md.setRights([text] if text else [])
        md.setLicenses([entry["licenseName"]] if entry.get("licenseName") else [])
        md.setLinks([QgsAbstractMetadataBase.Link(name, "WWW:LINK", url) for name, url in
                     (("Information", entry.get("infoUrl")), ("Licence", entry.get("licenseUrl"))) if url])
        layer.setMetadata(md)
    except Exception:  # noqa: BLE001 - metadata is a convenience
        pass
    try:  # QGIS 3.38+
        props = layer.serverProperties()
        props.setAttribution(text)
        props.setAttributionUrl(entry.get("licenseUrl") or entry.get("infoUrl") or "")
    except AttributeError:
        try:
            layer.setAttribution(text)
            layer.setAttributionUrl(entry.get("licenseUrl") or entry.get("infoUrl") or "")
        except AttributeError:
            pass


def local_uri(archive, zmin, zmax, server=None):
    """A vector tile layer's address for an archive read by the plugin's own
    server (started when needed: a thread of QGIS on 127.0.0.1)."""
    from qgis.core import QgsDataSourceUri
    if server is None:
        from .live.server import LiveServer
        server = LiveServer.instance()
    uri = QgsDataSourceUri()
    uri.setParam("type", "xyz")
    uri.setParam("url", server.pmtiles_url(archive))
    uri.setParam("zmin", str(int(zmin)))
    uri.setParam("zmax", str(int(zmax)))
    return bytes(uri.encodedUri()).decode("utf-8")


def revive(project=None):
    """A project reopened with layers read through the plugin's own server:
    the server started, and their addresses moved to its port when it is
    not the one they were saved with. Returns how many layers it serves."""
    import re
    from qgis.core import QgsDataProvider, QgsDataSourceUri, QgsProject, QgsVectorTileLayer
    project = project or QgsProject.instance()
    mine = [lyr for lyr in project.mapLayers().values()
            if lyr.customProperty(PROP) and isinstance(lyr, QgsVectorTileLayer) and "127.0.0.1" in lyr.source()]
    if not mine:
        return 0
    from .live.server import LiveServer
    port = LiveServer.instance().port
    for lyr in mine:
        uri = QgsDataSourceUri()
        uri.setEncodedUri(lyr.source())
        url = uri.param("url")
        moved = re.sub(r"^http://127\.0\.0\.1:\d+/", f"http://127.0.0.1:{port}/", url)
        if moved != url:
            uri.removeParam("url")  # setParam alone adds a second one
            uri.setParam("url", moved)
            lyr.setDataSource(bytes(uri.encodedUri()).decode("utf-8"), lyr.name(), "xyzvectortiles", QgsDataProvider.ProviderOptions())
    return len(mine)


def make_layers(entry, fetch=_get, release=None):
    """The entry's QGIS layers, styled and credited, top first (the entry,
    then its companions: a dataset's points over its shapes), not in a
    project yet; and what could not be opened: ([layer], [problem])."""
    from qgis.core import QgsVectorLayer, QgsVectorTileLayer
    layers, problems = [], []
    scale = min_scale(entry)
    for item in plan(entry, fetch, release):
        if item["provider"] == "vectortile":
            if item.get("archive"):
                item["uri"] = local_uri(item["archive"], item["zmin"], item["zmax"])
            layer = QgsVectorTileLayer(item["uri"], item["name"])
            if not layer.isValid():
                problems.append(f"{item['name']}: QGIS could not open its vector tiles")
                continue
            if item.get("style"):
                style_from_maplibre(layer, item["part"])
            else:
                style_tile_layer(layer, entry, item)
        else:
            if item.get("compact"):
                try:
                    item["uri"], item["fallback"] = compact_file(entry, item["uri"], item.get("fallback"), fetch), None
                except Exception as e:  # noqa: BLE001 - no answer, not JSON, a profile that cannot be written
                    problems.append(f"{item['name']}: its file could not be read ({e})")
                    continue
            layer = QgsVectorLayer(item["uri"], item["name"], "ogr")
            if not layer.isValid() and item.get("fallback"):
                layer = QgsVectorLayer(item["fallback"], item["name"], "ogr")
            if not layer.isValid():
                problems.append(f"{item['name']}: GDAL could not open it"
                                + (" (its PMTiles driver, GDAL 3.8 or later, reads the archive over /vsicurl/)"
                                   if "/vsicurl/" in item["uri"] else ""))
                continue
            style_vector_layer(layer, entry, item["part"])
            if scale and "/vsicurl/" in item["uri"]:
                # An archive of the planet: nothing asked from a view wider
                # than the app draws it at.
                layer.setScaleBasedVisibility(True)
                layer.setMinimumScale(scale)
        layer.setCustomProperty(PROP, entry["id"])
        credit(layer, entry)
        layers.append(layer)
    return layers, problems


def add(entry, project=None, before_insert=None, fetch=_get, release=None):
    """The entry added to the project, in the group "Vector overlays
    (library)" at the top of the layer tree. Returns ([layer], [problem]);
    an entry already there is only made visible."""
    from qgis.core import QgsProject, QgsLayerTreeGroup
    project = project or QgsProject.instance()
    tree = project.layerTreeRoot()
    have = [lyr for lyr in project.mapLayers().values() if lyr.customProperty(PROP) == entry["id"]]
    if have:
        for lyr in have:
            node = tree.findLayer(lyr.id())
            while node is not None and hasattr(node, "setItemVisibilityChecked"):
                node.setItemVisibilityChecked(True)
                node = node.parent()
        return have, []
    layers, problems = make_layers(entry, fetch, release)
    if not layers:
        return [], problems
    if before_insert is not None:
        before_insert()
    group = next((c for c in tree.children() if isinstance(c, QgsLayerTreeGroup) and c.name() == GROUP), None)
    if group is None:
        group = tree.insertGroup(0, GROUP)
    for i, layer in enumerate(layers):  # above the entries added before, the entry's own order kept
        project.addMapLayer(layer, False)
        group.insertLayer(i, layer)
    return layers, problems
