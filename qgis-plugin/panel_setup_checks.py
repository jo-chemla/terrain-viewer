# Run by test_panel_units.py (exec, in its namespace: `dock`, `canvas`,
# `check`, `spin`). 0.12.0: a setup kept as it is. Freeze writes every
# parameter on the copies (custom properties, abstract, metadata); the
# panel's state as the app's link, read back by the link reader; Save setup
# to a folder (setup.json, layers.qlr, never over an earlier one, no key in
# the record) and Load setup. No network: the layers point at an address
# nothing listens on, and nothing is drawn.
import json as _json
import shutil as _shutil
import tempfile as _tempfile

from qgis.core import QgsDataSourceUri as _Uri, QgsLayerDefinition as _LayerDefinition, QgsLayerTreeGroup as _TreeGroup, QgsProject as _Project  # noqa: E402
from qgis.PyQt.QtWidgets import QToolButton as _ToolButton  # noqa: E402
from iconem_terrain_viewer import setups, links as _links  # noqa: E402
from iconem_terrain_viewer.layers import PROP as _PROP, FROZEN_PROP as _FROZEN  # noqa: E402


def _address(layer):
    """A layer's tile address, whatever the order QGIS wrote its XYZ
    parameters in (a .qlr adds crs= and format= to them)."""
    src = layer.source()
    if "url=" not in src:
        return src
    uri = _Uri()
    uri.setEncodedUri(src)
    return uri.param("url")


_Project.instance().clear()
spin(50)
dock.connected = None
dock.build()
dock.extra = {}
dock.base = "http://127.0.0.1:9"
dock.connected = "remote"
dock.keys["mapboxKey"].setText("pk.secret-of-the-test")
dock.set_source("mapterhorn", quiet=True)
dock._to_free()
dock.set_light(120.0, 30.0, schedule=False)
for _r in dock.rows.values():
    _r.row.set_forms(set())
_slope, _hill, _curv, _cont = (dock.rows[k] for k in ("slope", "hillshade", "curvature", "contours"))
_ramp_key = next(k for k in _slope.settings if "ramp" in k.lower())
_ramp_choices = [_slope.settings[_ramp_key].widget.itemData(i) for i in range(_slope.settings[_ramp_key].widget.count())]
_ramp = next(v for v in _ramp_choices if v and v != _slope.settings[_ramp_key].spec.get("default"))
_slope.set_values({_ramp_key: _ramp})
_slope.set_opacity(0.6)
_slope.row.set_forms({"colour"})
_hill.row.set_forms({"colour"})
_cont.set_values({"contourMinor": 25})
_cont.row.set_forms({"vector"})
for _r in (_slope, _hill, _cont):
    _r.update()
    _r.apply_style()
dock.zoom_to(45.8326, 6.8652, 12)  # after the first layer: a fresh project's first layer shows the whole world
spin(50)
check({l.customProperty(_PROP) for l in dock.stack.live_checked()} == {"slope", "hillshade", "contours:vector"},
      "setups: three live layers to keep (slope, hillshade, contour vector tiles)")

# The menu on the Freeze button.
check(isinstance(dock.freeze_btn, _ToolButton) and dock.freeze_btn.menu() is not None
      and [a.text() for a in dock.freeze_btn.menu().actions()] == ["Freeze", "Save setup to folder...",
                                                                  "Save setup and GeoTIFFs to folder...", "Load setup..."],
      "setups: Freeze is a button with a menu (Freeze, Save setup, Save with GeoTIFFs, Load setup)")

# The panel as the app's link, read back as the app reads it.
_q = setups.panel_query(dock)
check(_q.get("showTerrainAnalysis") == "true" and "showSlope" not in _q and _q.get("showContoursAndGraticules") == "true"
      and "showHillshade" not in _q and _q.get(_ramp_key) == str(_ramp) and _q.get("slopeOpacity") == "0.6"
      and _q.get("contourMinor") == "25" and _q.get("illuminationDir") == "120" and _q.get("illuminationAlt") == "30"
      and abs(float(_q["lat"]) - 45.8326) < 1e-3 and abs(float(_q["zoom"]) - 12) < 0.01,
      f"setups: the panel as the app's parameters, only what differs from its defaults ({len(_q)} parameters)")
_view = _links.local_view(_q, {mid: r.mode for mid, r in dock.rows.items()})
check(set(_view["active"]) == {"slope", "hillshade", "contours"},
      f"setups: that link read back turns on exactly the three modes ({sorted(_view['active'])})")
# The curvature alone in its group: the slope the app's defaults would add is switched off.
_sw = setups.switches({mid: r.mode for mid, r in dock.rows.items()}, ["curvature"], _links.app_defaults())
_state = dict(_links.app_defaults(), **_sw)
check(_sw.get("showCurvature") is True and _sw.get("showSlope") is False and _sw.get("showHillshade") is False
      and [m for m, r in dock.rows.items() if _links.mode_active(r.mode, _state)] == ["curvature"],
      f"setups: a mode alone in its group switches off what the app's defaults would add ({_sw})")
_snap = setups.snapshot(dock)
_text = _json.dumps(_snap)
check(_snap["format"] == "terrain-viewer-setup" and _snap["link"].startswith("https://terrain-viewer.iconem.com/?")
      and _snap["panel"]["modes"]["slope"]["forms"] == ["color"] and _snap["panel"]["modes"]["slope"]["opacity"] == 0.6
      and _snap["panel"]["modes"]["contours"]["settings"]["contourMinor"] == 25 and _snap["panel"]["light"]["azimuth"] == 120.0
      and _snap["panel"]["service"] == "http://127.0.0.1:9" and _snap["panel"]["source"] == "mapterhorn",
      "setups: the record holds the link and the panel's own (backend, source, light, each mode's forms and settings)")
check("secret-of-the-test" not in _text and "mapboxKey" not in _text and "colour" not in _text,
      "setups: no API key in the record (and its forms are color, values, vector)")

# Freeze: the parameters on each copy.
_live_src = {l.customProperty(_PROP): l.source() for l in dock.stack.live_checked()}
_group = dock.freeze()
_frozen = {n.layer().customProperty(_FROZEN): n.layer() for n in _group.findLayers()}
_p = _json.loads(_frozen["slope"].customProperty(setups.PARAMS_PROP))
check(set(_frozen) == set(_live_src) and _p["mode"] == "slope" and _p["form"] == "color" and _p["opacity"] == 0.6
      and _p["settings"][_ramp_key] == _ramp and _p["source"] == "mapterhorn" and _p["backend"] == "remote",
      f"Freeze: each copy carries its parameters as a custom property ({sorted(_p)})")
_abstract = _frozen["slope"].metadata().abstract()
check("Slope (color), Remote tile server, source mapterhorn" in _abstract and "Opacity 60 %" in _abstract
      and f"{_ramp_key}={_ramp}" in _abstract and "Link: https://terrain-viewer.iconem.com/?" in _abstract,
      "Freeze: and as text in its metadata (Layer Properties > Information): " + _abstract.split("\n")[1])
try:
    _tip = _frozen["slope"].serverProperties().abstract()
except AttributeError:
    _tip = _frozen["slope"].abstract()
check(_tip == _abstract, "Freeze: and in its abstract, which the layer tree shows as the layer's tooltip")
_hp = _json.loads(_frozen["hillshade"].customProperty(setups.PARAMS_PROP))
check(_hp["blend"] == "multiply" and _hp["light"]["azimuth"] == 120.0 and "Light: azimuth 120, elevation 30" in _frozen["hillshade"].metadata().abstract()
      and "light" not in _p, "Freeze: a shaded layer carries the light, the slope does not")
check(_json.loads(_group.customProperty(setups.SETUP_PROP))["panel"]["modes"].keys() == _snap["panel"]["modes"].keys()
      and _group.customProperty(setups.LINK_PROP).startswith("https://"), "Freeze: the group carries the whole setup and its link")
check("secret-of-the-test" not in _abstract and "secret-of-the-test" not in _frozen["slope"].customProperty(setups.PARAMS_PROP),
      "Freeze: no API key in a copy's parameters or text")
_slope.set_opacity(0.9)
_slope.set_values({_ramp_key: _slope.settings[_ramp_key].spec.get("default")})
_slope.update()
_slope.apply_style()
check(_frozen["slope"].source() == _live_src["slope"] and dock.stack.find("slope").source() != _live_src["slope"]
      and abs(_frozen["slope"].renderer().opacity() - 0.6) < 1e-6 and not any(l.customProperty(_PROP) for l in _frozen.values()),
      "Freeze: a later change of the panel rewrites the live layer, not the copy (address and opacity kept)")
_slope.set_opacity(0.6)
_slope.set_values({_ramp_key: _ramp})
_slope.update()
_slope.apply_style()

# Save to a folder, and again: never over the first.
_parent = _tempfile.mkdtemp(prefix="tv-setup-")
_n_before = len(_Project.instance().mapLayers())
_res = dock.save_setup(_parent)
_res2 = dock.save_setup(_parent)
check(_res is not None and sorted(os.listdir(_res["folder"])) == ["layers.qlr", "setup.json"] and _res["layers"] == 3 and not _res["problems"],
      f"Save setup: a dated subfolder with setup.json and layers.qlr ({os.path.basename(_res['folder'])})")
check(_res2["folder"] != _res["folder"] and os.path.dirname(_res2["folder"]) == _parent, "Save setup: a second save goes beside the first, never over it")
check(len(_Project.instance().mapLayers()) == _n_before, "Save setup: nothing added to the project")
_saved = setups.read(_res["folder"])
check(_saved["query"] == _q and _saved["panel"]["modes"].keys() == _snap["panel"]["modes"].keys() and _saved["files"]["layers"] == "layers.qlr"
      and "secret-of-the-test" not in open(os.path.join(_res["folder"], "setup.json"), encoding="utf-8").read(),
      "Save setup: setup.json holds the link's parameters and the panel's own, and no API key")
_qlr = open(os.path.join(_res["folder"], "layers.qlr"), encoding="utf-8").read()
check(("secret-of-the-test" in _qlr) == ("mapboxKey" in _live_src["slope"]),
      "Save setup: layers.qlr holds the layers' addresses as they are (a key only when the live address has one)")
_into = _Project.instance().layerTreeRoot().addGroup("from the qlr")
_ok = _LayerDefinition.loadLayerDefinition(os.path.join(_res["folder"], "layers.qlr"), _Project.instance(), _into)
_back = {n.layer().customProperty(_FROZEN): n.layer() for n in _into.findLayers() if n.layer() is not None}
check(bool(_ok[0] if isinstance(_ok, (tuple, list)) else _ok) and set(_back) == set(_live_src)
      and all(_address(_back[k]) == _address(dock.stack.find(k)) for k in _back)
      and _json.loads(_back["slope"].customProperty(setups.PARAMS_PROP))["settings"][_ramp_key] == _ramp
      and abs(_back["slope"].renderer().opacity() - 0.6) < 1e-6 and "Slope (color)" in _back["slope"].metadata().abstract()
      and isinstance(_into.children()[0], _TreeGroup) and _into.children()[0].name().startswith("Frozen "),
      "layers.qlr reopens the layers in their dated group: addresses, opacity, parameters and text as saved, none the panel's")

# Load: the panel changed, then the setup read back.
for _r in dock.rows.values():
    _r.row.set_forms(set())
_curv.row.set_forms({"colour"})
_slope.set_opacity(1.0)
_slope.set_values({_ramp_key: _slope.settings[_ramp_key].spec.get("default")})
_cont.set_values({"contourMinor": 50})
dock.set_light(315.0, 45.0, schedule=False)
dock.zoom_to(10.0, 10.0, 5)
_health = dock.open_link.__globals__["health"]
dock.open_link.__globals__["health"] = lambda *_a, **_k: (True, "")
_view_fn = dock.catalog.view
dock.catalog.view = lambda query: _links.local_view(query, {mid: r.mode for mid, r in dock.rows.items()})
try:
    _loaded = dock.load_setup(os.path.join(_res["folder"], "setup.json"))
finally:
    dock.open_link.__globals__["health"] = _health
    dock.catalog.view = _view_fn
_place = dock.place()
check(_loaded and {m for m, r in dock.rows.items() if r.row.checked_forms()} == {"slope", "hillshade", "contours"}
      and _cont.row.checked_forms() == {"vector"} and abs(_slope.opacity_value() - 0.6) < 1e-6
      and _slope.values()[_ramp_key] == _ramp and _cont.values()["contourMinor"] == 25 and dock.light_value() == (120.0, 30.0)
      and abs(_place[0] - 45.8326) < 0.01 and abs(_place[2] - 12) < 0.05,
      f"Load setup: modes, forms, settings, opacity, light and place back ({dock.status.text()[:60]})")
check({k: l.source() for k, l in ((l.customProperty(_PROP), l) for l in dock.stack.live_checked())} == _live_src,
      "Load setup: the live layers' addresses are the saved ones again")
_n_warn = len(dock.warnings)
open(os.path.join(_parent, "other.json"), "w").write("{\"a\": 1}")
check(dock.load_setup(os.path.join(_parent, "other.json")) is False and len(dock.warnings) == _n_warn + 1 and "not a Terrain Viewer setup" in dock.warnings[-1],
      "Load setup: another JSON is refused with a message")
for _r in dock.rows.values():
    _r.row.set_forms(set())
dock.keys["mapboxKey"].setText("")
dock.connected = None
dock.base = None
dock.extra = {}
dock.set_light(315.0, 45.0, schedule=False)
_Project.instance().clear()
spin(50)
_shutil.rmtree(_parent, ignore_errors=True)
