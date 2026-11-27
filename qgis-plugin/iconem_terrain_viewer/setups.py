"""A setup kept as it is: what the panel draws now, written down so that a
later change of the panel cannot touch it.

- snapshot(dock): the panel's state as one record: the app link of it (the
  format the web app and Open link read: the modes on, their settings that
  differ from the defaults, opacities, source, light, basemap, camera) and
  the plugin's own (the backend, each mode's forms, every setting's value,
  the light's mode, the buildings' source). Never an API key.
- describe(...): that record's part for one frozen layer, stored on the layer
  (custom properties) and written in its abstract and metadata, which QGIS
  shows in the layer's tooltip and under Layer Properties > Information.
- save(dock, folder, rasters): a dated subfolder of `folder` with setup.json
  (the record), layers.qlr (the layers drawn now as a QGIS layer definition:
  drag it into QGIS, or Layer > Add from Layer Definition File), vectors.gpkg
  (the Python backend's lines and areas, which live in memory) and, when
  asked, rasters/*.tif: each raster layer for the canvas's extent at the
  canvas's pixel size, read through its own QGIS provider (so with every
  backend).
- load(dock, path): a setup.json read back into the panel.

The layers of a .qlr or of a frozen group still ask the backend that drew
them for their tiles (a tile service's address, the Python backend's
127.0.0.1 server): they are frozen settings, not frozen pixels. The GeoTIFFs
are the pixels."""
import json
import os
import re
import time
from urllib.parse import urlencode

from . import links
from .service import setting_params, split_link, query_dict, KEY_PARAMS

APP_URL = "https://terrain-viewer.iconem.com/"
FORMAT = "terrain-viewer-setup"
VERSION = 1
# "terrain_viewer/", not the folder name: kept so earlier frozen layers are read (see SETTINGS in dock.py).
SETUP_PROP = "terrain_viewer/setup"            # on a frozen group: the whole record (JSON)
PARAMS_PROP = "terrain_viewer/params"          # on a frozen layer: its part of it (JSON)
LINK_PROP = "terrain_viewer/link"              # on a frozen layer and group: the app link
FROZEN_AT_PROP = "terrain_viewer/frozen_at"    # on a frozen layer: when (ISO 8601)
LIGHT_DEFAULT = (315.0, 45.0)
SETUP_FILE, LAYERS_FILE, VECTORS_FILE, RASTERS_DIR = "setup.json", "layers.qlr", "vectors.gpkg", "rasters"
# The longer side of a GeoTIFF, at most (a 4K canvas is 3840).
MAX_RASTER_PX = 4096
# A form as the record names it ("color": the panel's own key for it is the
# older "colour", kept in the code only).
FORM_LABEL = {"colour": "color", "values": "values", "vector": "vector"}
FORM_KEY = {"color": "colour"}


def plugin_version():
    try:
        from .updates import installed_version
        return installed_version()
    except Exception:  # noqa: BLE001 - a folder without its metadata
        return ""


def _num(v, digits):
    return f"{round(float(v), digits):g}"


def _form_of(key):
    return "values" if key.endswith(":values") else "vector" if key.endswith(":vector") else "color"


def _is_app_source(dock, src):
    """Whether the web app can read the source named: a library or default
    id, or an address; not a layer of this project or a file of this machine."""
    from . import python_backend as pyb
    return bool(src) and not pyb.is_local_source(src)


def switches(modes, active, defaults):
    """The app's show* parameters that turn on exactly `active` among
    `modes` ({id: mode}), over the app's defaults: the switches of the modes
    on, and one switch off for each mode the defaults (and those) would
    otherwise leave on (showSlope defaults to true: a link with the terrain
    analysis group on for the curvature alone says showSlope=false). Only
    what differs from the defaults."""
    want = {}
    for mid in active:
        want.update((modes[mid].get("switches") or {}))
    state = dict(defaults)
    state.update(want)
    for mid, mode in modes.items():
        if mid in active:
            continue
        sw = mode.get("switches") or {}
        if sw and all(links.truthy(state.get(k, False)) == bool(v) for k, v in sw.items()):
            free = [k for k in sw if k not in want]
            if free:
                state[free[-1]] = not sw[free[-1]]
    keys = {k for mode in modes.values() for k in (mode.get("switches") or {})}
    return {k: bool(state[k]) for k in sorted(keys)
            if k in state and bool(links.truthy(state[k])) != bool(links.truthy(defaults.get(k, False)))}


def panel_query(dock):
    """The panel's state as the app's URL parameters (a dict, in the order a
    link reads well): camera, source, switches, each mode's settings and
    opacity, light, basemap, then a link's other parameters the panel kept."""
    defaults = links.app_defaults()
    rows = dock.rows
    active = [mid for mid, r in rows.items() if r.row.checked_forms()]
    q = {}
    place = dock.place()
    if place:
        q["lat"], q["lng"], q["zoom"] = _num(place[0], 5), _num(place[1], 5), _num(place[2], 2)
    src = dock.current_source()
    if _is_app_source(dock, src) and src != defaults.get("terrainSourceA", "mapterhorn"):
        q["terrainSourceA"] = str(src)
    for k, v in switches({mid: r.mode for mid, r in rows.items()}, active, defaults).items():
        q[k] = "true" if v else "false"
    shaded = False
    for mid in active:
        row = rows[mid]
        q.update(setting_params(row.mode, row.values()))
        ok = row.mode.get("opacityKey")
        if ok and row.opacity is not None and abs(row.opacity_value() - float(defaults.get(ok, 1) or 1)) > 1e-3:
            q[ok] = _num(row.opacity_value(), 3)
        shaded = shaded or bool(row.mode.get("shading"))
        if row.buildings is not None:
            s = row.buildings.state()
            if s.get("kind") == "library" and s.get("id"):
                q["buildingShadowSource"] = s["id"]
            elif s.get("kind") == "custom" and s.get("address"):
                q["buildingShadowSource"] = s["address"]
    az, el = dock.light_value()
    if shaded and (az, el) != LIGHT_DEFAULT:
        q["illuminationDir"], q["illuminationAlt"] = f"{az:g}", f"{el:g}"
    if shaded and dock.sun_mode():
        q["lightUseDatetime"], q["lightTimeMode"] = "true", "utc"
        q["lightDayOfYear"], q["lightTimeOfDay"] = f"{int(dock.sun_day.value())}", f"{float(dock.sun_hour.value()):g}"
    base = dock.basemap_row
    if base is not None and base.row.on("colour"):
        q["showRasterBasemap"] = "true"
        if base.current() != links.DEFAULT_BASEMAP:
            q["basemapSourceA"] = str(base.current())
        if abs(base.opacity.opacity() - 1) > 1e-3:
            q["rasterBasemapOpacity"] = _num(base.opacity.opacity(), 3)
    for k, v in (dock.extra or {}).items():
        if k not in q and k not in KEY_PARAMS and not re.search(r"key|token", k, re.I):
            q[k] = v
    return q


def link_of(query):
    return APP_URL + ("?" + urlencode(query, safe=",:/{}") if query else "")


def snapshot(dock, when=None):
    """The record of what the panel draws now (see the module's header)."""
    when = when or time.strftime("%Y-%m-%dT%H:%M:%S%z")
    query = panel_query(dock)
    az, el = dock.light_value()
    modes = {}
    for mid, row in dock.rows.items():
        forms = sorted(FORM_LABEL.get(f, f) for f in row.row.checked_forms())
        if not forms:
            continue
        modes[mid] = {"name": row.mode.get("name", mid), "forms": forms, "opacity": round(row.opacity_value(), 4),
                      "settings": row.values()}
        if row.buildings is not None:
            modes[mid]["buildingsFrom"] = row.buildings.state()
    base = dock.basemap_row
    connected = dock.connected
    panel = {
        "backend": dock.backend,
        "connected": connected,
        "service": dock.service_url() if connected in ("local", "remote") else None,
        "source": dock.current_source(),
        "light": {"mode": "sun" if dock.sun_mode() else "free", "azimuth": az, "elevation": el,
                  "sunDayOfYear": int(dock.sun_day.value()), "sunHourUtc": float(dock.sun_hour.value())},
        "basemap": ({"source": base.current(), "opacity": round(base.opacity.opacity(), 4)}
                    if base is not None and base.row.on("colour") else None),
        "modes": modes,
        "extra": {k: v for k, v in (dock.extra or {}).items() if k not in KEY_PARAMS and not re.search(r"key|token", k, re.I)},
    }
    place = dock.place()
    try:
        from qgis.core import Qgis
        qgis = Qgis.version()
    except Exception:  # noqa: BLE001
        qgis = ""
    return {"format": FORMAT, "version": VERSION, "saved": when, "plugin": plugin_version(), "qgis": qgis,
            "link": link_of(query), "query": query,
            "camera": ({"lat": round(place[0], 6), "lng": round(place[1], 6), "zoom": round(place[2], 3)} if place else None),
            "panel": panel}


# -- one frozen layer ---------------------------------------------------------
BACKEND_NAMES = {"python": "Python backend", "local": "Packaged tile server", "remote": "Remote tile server",
                 "service": "tile server"}


def layer_params(setup, key, layer=None):
    """A frozen layer's part of the record: its mode, form, settings,
    opacity, blending, backend, source, light (a shaded mode's)."""
    panel = setup.get("panel", {})
    mid = key.split(":")[0]
    mode = panel.get("modes", {}).get(mid)
    out = {"key": key, "frozen": setup.get("saved"), "plugin": setup.get("plugin"), "backend": panel.get("connected") or panel.get("backend"),
           "source": panel.get("source")}
    if mid == "basemap" and panel.get("basemap"):
        out.update({"mode": "basemap", "name": "Basemap", "form": "color", "basemap": panel["basemap"]["source"],
                    "opacity": panel["basemap"]["opacity"]})
        out.pop("source", None)
    elif mode is not None:
        out.update({"mode": mid, "name": mode.get("name", mid), "form": _form_of(key), "opacity": mode.get("opacity"),
                    "settings": mode.get("settings", {})})
        if mode.get("buildingsFrom"):
            out["buildingsFrom"] = mode["buildingsFrom"]
    else:
        out.update({"mode": mid, "name": layer.name() if layer is not None else mid, "form": _form_of(key)})
    if layer is not None:
        try:
            from qgis.PyQt.QtGui import QPainter
            out["blend"] = "multiply" if layer.blendMode() == QPainter.CompositionMode.CompositionMode_Multiply else "normal"
        except Exception:  # noqa: BLE001
            pass
    if out.get("blend") == "multiply" or mid in ("hillshade", "phong", "shadows", "buildingShadows"):
        out["light"] = {k: panel.get("light", {}).get(k) for k in ("mode", "azimuth", "elevation")}
    return out


def describe_text(params, link=""):
    """A frozen layer's parameters as the few lines of its abstract."""
    lines = [f"Terrain Viewer, frozen {str(params.get('frozen') or '')[:16].replace('T', ' ')}"
             + (f" (plugin {params['plugin']})" if params.get("plugin") else "")]
    head = f"{params.get('name', params.get('mode'))} ({FORM_LABEL.get(params.get('form'), params.get('form'))})"
    backend = BACKEND_NAMES.get(params.get("backend"), params.get("backend"))
    if backend:
        head += f", {backend}"
    if params.get("basemap"):
        head += f", {params['basemap']}"
    if params.get("source"):
        head += f", source {params['source']}"
    lines.append(head)
    style = []
    if params.get("opacity") is not None and params.get("form") != "values":
        style.append(f"opacity {round(float(params['opacity']) * 100)} %")
    if params.get("blend"):
        style.append(f"blending {params['blend']}")
    if style:
        lines.append(", ".join(style).capitalize())
    light = params.get("light")
    if light and light.get("azimuth") is not None:
        lines.append(f"Light: azimuth {float(light['azimuth']):g}, elevation {float(light['elevation']):g}"
                     + (" (the sun at a date and time)" if light.get("mode") == "sun" else ""))
    settings = params.get("settings") or {}
    if settings:
        lines.append("Settings: " + ", ".join(f"{k}={_show(v)}" for k, v in settings.items()))
    b = params.get("buildingsFrom")
    if b:
        lines.append("Buildings from: " + (b.get("id") or b.get("address") or b.get("kind") or ""))
    if link:
        lines.append(f"Link: {link}")
    return "\n".join(lines)


def _show(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return f"{v:g}"
    return "(empty)" if v == "" else str(v)


def describe(layer, setup, key):
    """Writes a frozen layer's parameters on it: custom properties (JSON, for
    scripts), its abstract (the layer tree's tooltip) and its metadata's
    abstract (Layer Properties > Information)."""
    params = layer_params(setup, key, layer)
    link = setup.get("link", "")
    text = describe_text(params, link)
    layer.setCustomProperty(PARAMS_PROP, json.dumps(params, ensure_ascii=False))
    layer.setCustomProperty(LINK_PROP, link)
    layer.setCustomProperty(FROZEN_AT_PROP, setup.get("saved") or "")
    try:
        md = layer.metadata()
        md.setAbstract(text)
        md.setKeywords({"terrain-viewer": [str(params.get("mode")), str(FORM_LABEL.get(params.get("form"), params.get("form")))]})
        layer.setMetadata(md)
    except Exception:  # noqa: BLE001 - metadata is a convenience
        pass
    try:  # QGIS 3.38+: the abstract the layer tree's tooltip shows
        layer.serverProperties().setAbstract(text)
    except AttributeError:
        try:
            layer.setAbstract(text)
        except AttributeError:
            pass
    return params


# -- to a folder -------------------------------------------------------------
def unique_folder(parent, when=None):
    name = "terrain-viewer-setup-" + time.strftime("%Y-%m-%d-%H%M", when or time.localtime())
    path, n = os.path.join(parent, name), 2
    while os.path.exists(path):  # never over an earlier setup
        path, n = os.path.join(parent, f"{name}-{n}"), n + 1
    os.makedirs(path)
    return path


def _safe(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-") or "layer"


def write_vector(layer, path, name):
    """A memory layer (the Python backend's lines or areas of the view)
    written as a layer of a GeoPackage; its style follows the layer."""
    from qgis.core import QgsVectorFileWriter, QgsProject
    opts = QgsVectorFileWriter.SaveVectorOptions()
    opts.driverName = "GPKG"
    opts.layerName = name
    if os.path.exists(path):
        opts.actionOnExistingFile = QgsVectorFileWriter.ActionOnExistingFile.CreateOrOverwriteLayer
    res = QgsVectorFileWriter.writeAsVectorFormatV3(layer, path, QgsProject.instance().transformContext(), opts)
    if res[0] != QgsVectorFileWriter.WriterError.NoError:
        raise RuntimeError(str(res[1]))
    return f"{path}|layername={name}"


def write_raster(layer, path, extent3857, width, height):
    """A raster layer's own pixels (an XYZ layer's color tiles as RGBA, a
    values layer's Float32) for an extent, `width` x `height` px, as a
    GeoTIFF in the layer's CRS, read through the layer's provider. Returns
    None, or what went wrong."""
    from qgis.core import (QgsRasterFileWriter, QgsRasterPipe, QgsCoordinateTransform, QgsCoordinateReferenceSystem,
                           QgsProject)
    provider = layer.dataProvider().clone()
    crs = layer.crs()
    extent = extent3857
    merc = QgsCoordinateReferenceSystem("EPSG:3857")
    if crs.isValid() and crs != merc:
        extent = QgsCoordinateTransform(merc, crs, QgsProject.instance()).transformBoundingBox(extent3857)
    pipe = QgsRasterPipe()
    if not pipe.set(provider):
        return "the layer's provider cannot be read"
    writer = QgsRasterFileWriter(path)
    writer.setOutputFormat("GTiff")
    try:
        writer.setCreationOptions(["COMPRESS=DEFLATE", "TILED=YES"])
    except AttributeError:  # QGIS < 3.40
        writer.setCreateOptions(["COMPRESS=DEFLATE", "TILED=YES"])
    err = writer.writeRaster(pipe, int(width), int(height), extent, crs if crs.isValid() else merc,
                             QgsProject.instance().transformContext())
    try:
        ok = err == QgsRasterFileWriter.WriterError.NoError
    except AttributeError:
        ok = int(err) == 0
    return None if ok else f"QGIS's raster writer: error {err}"


def raster_size(extent3857, canvas_width, canvas_height=None):
    """(width, height) of a GeoTIFF of the canvas: the canvas's own pixels,
    the longer side capped at MAX_RASTER_PX."""
    w = max(int(canvas_width or 0), 16)
    h = int(canvas_height or 0) or max(1, round(w * extent3857.height() / max(extent3857.width(), 1e-9)))
    k = min(1.0, MAX_RASTER_PX / max(w, h))
    return max(1, round(w * k)), max(1, round(h * k))


def save(dock, parent, rasters=False):
    """The setup written to a new dated subfolder of `parent`. Returns
    {"folder", "files", "layers", "rasters", "problems"}, or None when
    nothing is drawn."""
    from qgis.core import QgsLayerDefinition, QgsLayerTreeGroup, QgsRasterLayer, QgsDataProvider
    from .layers import FROZEN_PROP, PROP
    dock.flush()
    layers = dock.stack.live_checked()
    if not layers:
        return None
    setup = snapshot(dock)
    folder = unique_folder(parent)
    problems, files = [], [SETUP_FILE]
    group = QgsLayerTreeGroup(frozen_name(dock, setup))
    group.setCustomProperty(SETUP_PROP, json.dumps(setup, ensure_ascii=False))
    copies = []
    for layer in layers:
        key = layer.customProperty(PROP)
        copy = dock.stack.frozen_copy(layer)
        describe(copy, setup, key)
        if copy.providerType() == "memory":
            try:
                uri = write_vector(layer, os.path.join(folder, VECTORS_FILE), _safe(key))
                copy.setDataSource(uri, copy.name(), "ogr", QgsDataProvider.ProviderOptions())
                if VECTORS_FILE not in files:
                    files.append(VECTORS_FILE)
            except Exception as e:  # noqa: BLE001
                problems.append(f"{layer.name()}: not written to {VECTORS_FILE} ({e})")
        copies.append(copy)
        group.addLayer(copy)
    done = 0
    if rasters:
        ext, width = dock.canvas_extent()
        if ext is None or ext.isEmpty():
            problems.append("no GeoTIFF: the map's extent is not in Web Mercator's range")
        else:
            w, h = raster_size(ext, width, dock.canvas.height() if dock.canvas is not None else None)
            os.makedirs(os.path.join(folder, RASTERS_DIR), exist_ok=True)
            written = {}
            for layer in layers:
                if not isinstance(layer, QgsRasterLayer) or not layer.isValid():
                    continue
                name = f"{_safe(layer.customProperty(PROP))}.tif"
                why = write_raster(layer, os.path.join(folder, RASTERS_DIR, name), ext, w, h)
                if why:
                    problems.append(f"{layer.name()}: no GeoTIFF ({why})")
                else:
                    done += 1
                    written[layer.customProperty(PROP)] = f"{RASTERS_DIR}/{name}"
            setup["rasters"] = {"width": w, "height": h, "crs": "EPSG:3857",
                                "extent": [ext.xMinimum(), ext.yMinimum(), ext.xMaximum(), ext.yMaximum()], "files": written}
            if done:
                files.append(RASTERS_DIR + "/")
    setup["files"] = {"layers": LAYERS_FILE, **({"vectors": VECTORS_FILE} if VECTORS_FILE in files else {})}
    with open(os.path.join(folder, SETUP_FILE), "w", encoding="utf-8", newline="\n") as f:
        json.dump(setup, f, indent=1, ensure_ascii=False)
        f.write("\n")
    res = QgsLayerDefinition.exportLayerDefinition(os.path.join(folder, LAYERS_FILE), [group])
    ok = res[0] if isinstance(res, (tuple, list)) else bool(res)
    if ok:
        files.insert(1, LAYERS_FILE)
    else:
        problems.append(f"{LAYERS_FILE} not written ({res[1] if isinstance(res, (tuple, list)) else ''})")
    n = len(copies)
    group.removeAllChildren()
    del copies[:]
    return {"folder": folder, "files": files, "layers": n, "rasters": done, "problems": problems, "setup": setup}


def frozen_name(dock, setup):
    name = "Frozen " + str(setup.get("saved") or "")[:16].replace("T", " ")
    cam = setup.get("camera")
    if cam:
        name += f" — {cam['lat']:.2f}, {cam['lng']:.2f} z{round(cam['zoom'])}"
    return name


# -- back into the panel ------------------------------------------------------
class SetupError(Exception):
    pass


def read(path):
    """A setup.json (or the folder that holds one) as its record."""
    if os.path.isdir(path):
        path = os.path.join(path, SETUP_FILE)
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        raise SetupError(f"not a setup file: {e}") from e
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise SetupError("not a Terrain Viewer setup (no \"format\": \"terrain-viewer-setup\")")
    if int(data.get("version") or 0) > VERSION:
        raise SetupError(f"a setup of a newer plugin (version {data.get('version')}): update Terrain Viewer")
    return data


def load(dock, data):
    """A record read back into the panel: its link opened as Open link does
    (modes, settings, opacities, source, light, basemap, camera), then the
    plugin's own on top (each mode's forms and exact settings, a source of
    this project or machine, the light's mode). The backend is left as it
    is: the one the setup was saved under is said when it differs. Returns
    a line for the status."""
    panel = data.get("panel") or {}
    query = data.get("query") or query_dict(split_link(data.get("link") or ""))
    if query and not dock.open_link("?" + urlencode(query, safe=",:/{}")):
        raise SetupError("the setup's link could not be opened (see the message above)")
    src = panel.get("source")
    if src and src != dock.current_source() and dock.source.findData(src) >= 0:
        dock.set_source(src, quiet=True)
        dock._py_sources.clear()
    light = panel.get("light") or {}
    if light.get("mode") == "sun":
        dock._sun_sync = True
        dock.sun_day.setValue(int(light.get("sunDayOfYear") or 172))
        dock.sun_hour.setValue(float(light.get("sunHourUtc") or 12))
        dock._sun_sync = False
        dock._sun_from_parts()
        dock.set_light_mode("sun")
    elif light.get("azimuth") is not None:
        dock._to_free()
        dock.set_light(float(light["azimuth"]), float(light["elevation"]), schedule=False)
    dock.extra = dict(panel.get("extra") or dock.extra or {})
    modes = panel.get("modes")
    missing = []
    if isinstance(modes, dict):
        for mid, row in dock.rows.items():
            m = modes.get(mid)
            if m is None:
                row.row.set_forms(set())
                continue
            row.set_values(m.get("settings") or {})
            if m.get("opacity") is not None:
                row.set_opacity(m["opacity"])
            if row.buildings is not None and m.get("buildingsFrom"):
                row.buildings.restore(m["buildingsFrom"])
                row.buildings.save()
            forms = {FORM_KEY.get(f, f) for f in m.get("forms") or ()} & set(row.row.forms)
            row.row.set_forms(forms)
        missing = [m.get("name", mid) for mid, m in modes.items() if mid not in dock.rows]
        dock.pending.clear()
        for row in dock.rows.values():
            row.update()
            row.apply_style()
    on = sum(1 for r in dock.rows.values() if r.row.checked_forms())
    text = f"Setup of {str(data.get('saved') or '')[:16].replace('T', ' ')} loaded: {on} modes on"
    was = panel.get("connected") or panel.get("backend")
    if was and was != (dock.connected or dock.backend):
        text += f"; it was saved under the {BACKEND_NAMES.get(was, was)}, drawn here by the {BACKEND_NAMES.get(dock.connected or dock.backend, dock.backend)}"
    if missing:
        text += f"; not in this panel: {', '.join(missing)}"
    return text
