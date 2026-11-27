# Run by test_panel_units.py (exec, in its namespace: `dock`, `canvas`,
# `check`, `spin`). 0.12.0: the app's Vector library as QGIS layers. Which
# layer each kind of entry becomes (a vector tile layer, or a GDAL vector
# layer for PMTiles and GeoJSON), Overture's release in its address, the
# categories as QGIS rules no two of which take one feature, the symbols,
# the attribution, the panel's select and its Add. No network: the TileJSON
# and the style are answered here, and nothing is drawn.
import json as _json
import os as _os
import tempfile as _tempfile

from qgis.core import (QgsExpression as _Expression, QgsExpressionContext as _ExpressionContext,  # noqa: E402
                       QgsExpressionContextUtils as _ContextUtils, QgsLayerTreeGroup as _TreeGroup, QgsProject as _Project,
                       QgsRuleBasedRenderer as _RuleRenderer, QgsVectorLayer as _VLayer, QgsVectorTileLayer as _VTLayer)
from terrain_viewer import vector_library as vl  # noqa: E402

_Project.instance().clear()
spin(50)
canvas.freeze(True)
_entries = {e["id"]: e for e in vl.entries()}
check(len(_entries) >= 14 and {"overture-buildings", "osm-liberty-lines-labels", "unesco-world-heritage", "ign-ocsge-couverture",
                               "hwai-heritage-osm"} <= set(_entries),
      f"Vector library: the plugin carries the app's {len(_entries)} entries (assets/app_defaults.json)")
check([t for t, _ in vl.grouped()][:3] == ["Buildings", "Heritage", "Land cover and land use"]
      and sum(len(es) for _, es in vl.grouped()) == len(_entries), "Vector library: grouped as in the app, every entry in a group")


def _no_fetch(url):
    raise AssertionError(f"asked {url}")


# Which layer each entry becomes.
_mvt = vl.plan(_entries["ign-ocsge-couverture"], _no_fetch)
check(len(_mvt) == 1 and _mvt[0]["provider"] == "vectortile" and _mvt[0]["uri"].startswith("type=xyz&url=https://data.geopf.fr/")
      and "&zmin=13&zmax=16" in _mvt[0]["uri"] and _mvt[0]["layers"] == ["occupation_sol"],
      "a {z}/{x}/{y} template: one vector tile layer, its zooms the entry's, no request")
_vd = vl.plan(_entries["vida-open-buildings"], _no_fetch)
check(len(_vd) == 1 and _vd[0]["provider"] == "ogr" and _vd[0]["uri"] == "/vsicurl/" + _entries["vida-open-buildings"]["url"]
      + "|layername=goog_msft_osm_building_footprints|option:ZOOM_LEVEL_AUTO=YES",
      "a PMTiles archive over https: a GDAL vector layer over /vsicurl/, its zoom picked for the view")
_ov = vl.plan(_entries["overture-buildings"], _no_fetch, release="2031-01-15.0")
_ov_fb = vl.plan(_entries["overture-buildings"], _no_fetch)
check(len(_ov) == 1 and _ov[0]["provider"] == "vectortile" and _ov[0]["uri"] is None
      and _ov[0]["archive"] == "https://tiles.overturemaps.org/2031-01-15.0/buildings.pmtiles" and (_ov[0]["zmin"], _ov[0]["zmax"]) == (5, 14)
      and _entries["overture-buildings"]["fallbackRelease"] in _ov_fb[0]["archive"],
      "Overture's archives (a host GDAL cannot read): vector tiles from the plugin's own server, the release in the address "
      "(the fallback without one)")


class _FakeServer:
    port = 8765

    def pmtiles_url(self, url):
        from terrain_viewer.live.server import LiveServer
        return LiveServer.pmtiles_url(self, url)


from qgis.core import QgsDataSourceUri as _OvUri  # noqa: E402
_u = _OvUri()
_u.setEncodedUri(vl.local_uri(_ov[0]["archive"], 5, 14, _FakeServer()))
check(_u.param("type") == "xyz" and _u.param("zmin") == "5" and _u.param("zmax") == "14" and _u.param("url")
      == "http://127.0.0.1:8765/pmtiles/{z}/{x}/{y}.pbf?url=https%3A%2F%2Ftiles.overturemaps.org%2F2031-01-15.0%2Fbuildings.pmtiles",
      "its address: /pmtiles/{z}/{x}/{y}.pbf on 127.0.0.1, the archive named in the query")
_hw = vl.plan(_entries["hwai-heritage-osm"], _no_fetch)
check([i["layers"] for i in _hw] == [["osm"], ["shapes"]] and "osm-heritage-planet.pmtiles|" in _hw[0]["uri"]
      and "osm-heritage-planet-shapes.pmtiles|" in _hw[1]["uri"] and _hw[0]["geometries"] == ["point"]
      and _hw[1]["geometries"] == ["polygon", "line"] and _hw[0]["name"] != _hw[1]["name"],
      "an entry with a companion archive: a layer each, the points first (drawn on top)")
_gj = vl.plan(_entries["unesco-world-heritage"], _no_fetch)
check(_gj[0]["provider"] == "ogr" and _gj[0]["uri"] == "https://terrain-viewer.iconem.com/vector/unesco-world-heritage.geojson"
      and _gj[0]["fallback"] == "https://github.com/Iconem/terrain-viewer/releases/download/dataset-indexes/unesco-world-heritage.geojson",
      "a GeoJSON the app serves itself: read from the app's site, else from the release its build takes it from")
_asked = []


def _fake(url):
    _asked.append(url)
    if url.endswith("/styles/liberty"):
        return _json.dumps({"sources": {"ne": {"type": "raster", "tiles": ["x"]},
                                        "openmaptiles": {"type": "vector", "url": "https://tiles.openfreemap.org/planet"}}}).encode()
    return _json.dumps({"tiles": ["https://tiles.openfreemap.org/planet/20261120_001001_pt/{z}/{x}/{y}.pbf"], "minzoom": 0, "maxzoom": 14}).encode()


_tj = vl.plan(_entries["osm-buildings-openfreemap"], _fake)
_st = vl.plan(_entries["osm-liberty-lines-labels"], _fake)
check(_tj[0]["provider"] == "vectortile" and "/planet/20261120_001001_pt/{z}/{x}/{y}.pbf&zmin=0&zmax=14" in _tj[0]["uri"]
      and _asked[0] == "https://tiles.openfreemap.org/planet", "a TileJSON: one request, a vector tile layer on the tiles it names")
check(_st[0].get("style") and _st[0]["uri"].endswith("&styleUrl=https://tiles.openfreemap.org/styles/liberty")
      and "/planet/20261120_001001_pt/" in _st[0]["uri"] and _asked[1:] == ["https://tiles.openfreemap.org/styles/liberty",
                                                                             "https://tiles.openfreemap.org/planet"],
      "a MapLibre style: its vector source's tiles, the style handed to QGIS (styleUrl)")

# Categories as QGIS rules: exactly one rule takes a feature.
_vida = _entries["vida-open-buildings"]
_rules = vl.category_rules(_vida)
check([r[0] for r in _rules] == ["OpenStreetMap", "Google", "Microsoft", "other"] and _rules[1][1] == "#4285f4"
      and all(not _Expression(r[2]).hasParserError() for r in _rules), f"categories: a rule each and \"other\" ({_rules[1][2][:70]}...)")
_cond = _entries["hwai-heritage-osm-condition"]
_crules = vl.category_rules(_cond)
check(any(" IN (" in r[2] for r in _crules) and all(not _Expression(r[2]).hasParserError() for r in _crules),
      "categories: a list of values is an IN, every expression parses")
_kind = vl.category_rules(_entries["hwai-heritage-osm"])
check("<> ''" in _kind[0][2] and _kind[1][2].count("NOT (") == 1 and _kind[2][2].count("NOT (") == 2,
      "categories: one without a value means the field is there; each rule leaves out the ones before it (the app takes the first)")
check(vl.category_rules(_entries["osm-buildings-openfreemap"]) == [("OSM buildings", "#7ebc6f", "")]
      and len(vl.category_rules(_vida, fields={"area_in_meters"})) == 1,
      "categories: none (or none on a field the layer has): one symbol in the entry's color")

_tmp = _tempfile.mkdtemp(prefix="tv-vl-")
_path = _os.path.join(_tmp, "b.geojson")
with open(_path, "w", encoding="utf-8") as _f:
    _json.dump({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"bf_source": s, "n": i},
         "geometry": {"type": "Polygon", "coordinates": [[[i, 0], [i + 0.5, 0], [i + 0.5, 0.5], [i, 0.5], [i, 0]]]}}
        for i, s in enumerate(["osm", "google", "microsoft", "survey", None])]}, _f)
_local = dict(_vida, id="test-local", type="geojson", url=_path, shortName="Local test")
_local.pop("sourceLayers", None)
_layers, _problems = vl.add(_local, _Project.instance(), dock.keep_extent)
_lyr = _layers[0] if _layers else None
check(_lyr is not None and not _problems and _lyr.isValid() and _lyr.featureCount() == 5 and _lyr.customProperty(vl.PROP) == "test-local",
      "a GeoJSON entry added: a valid vector layer marked with its id")
_r = _lyr.renderer()
_ctx = _ExpressionContext(_ContextUtils.globalProjectLayerScopes(_lyr))
_taken = []
for _feat in _lyr.getFeatures():
    _ctx.setFeature(_feat)
    _taken.append([rule.label() for rule in _r.rootRule().children() if _Expression(rule.filterExpression()).evaluate(_ctx)])
check(isinstance(_r, _RuleRenderer) and _taken == [["OpenStreetMap"], ["Google"], ["Microsoft"], ["other"], ["other"]],
      f"its renderer: rule-based, each feature in exactly one rule, an unknown or missing value in \"other\" ({_taken})")
_sym = _r.rootRule().children()[1].symbol()
check(_sym.color().name() == "#4285f4" and abs(_sym.color().alphaF() - 0.7) < 0.01, "its symbols: the category's color, filled at 70 %")
_group = _Project.instance().layerTreeRoot().children()[0]
check(isinstance(_group, _TreeGroup) and _group.name() == "Vector overlays (library)" and _group.findLayer(_lyr.id()) is not None,
      "it goes in \"Vector overlays (library)\", at the top of the layer tree")
_md = _lyr.metadata()
try:
    _attr = _lyr.serverProperties().attribution()
except AttributeError:
    _attr = _lyr.attribution()
check(_md.rights() == [_vida["attribution"]] and _md.licenses() == [_vida["licenseName"]] and "VIDA" in _attr
      and _md.abstract() == _vida["description"] and any(l.url == _vida["infoUrl"] for l in _md.links()),
      "its attribution, licence, description and page: in the layer's metadata, and as its attribution")
_again, _ = vl.add(_local, _Project.instance())
check([l.id() for l in _again] == [_lyr.id()] and len(_Project.instance().mapLayers()) == 1, "added again: the same layer, not a second one")

# A vector tile layer's styles, and outlines only.
_item = {"provider": "vectortile", "layers": ["shapes", "damage"], "geometries": ["polygon", "line", "point"], "part": _cond}
_vt = _VTLayer("type=xyz&url=http://127.0.0.1:9/{z}/{x}/{y}.pbf&zmin=0&zmax=14", "tiles")
_n = vl.style_tile_layer(_vt, _cond, _item)
_styles = _vt.renderer().styles()
check(_n == 2 * 3 * len(_crules) and {s.layerName() for s in _styles} == {"shapes", "damage"}
      and all(not _Expression(s.filterExpression()).hasParserError() for s in _styles),
      f"a vector tile layer: a style per source layer, geometry and category ({_n})")
_sym_a, _sym_b = vl.symbol("polygon", "#ff0000", {"polygonFill": False}), vl.symbol("polygon", "#ff0000", {"outline": False})
_fill, _flat = _sym_a.symbolLayer(0), _sym_b.symbolLayer(0)  # the symbols kept: they own their layers
check(_fill.brushStyle() == Qt.BrushStyle.NoBrush and _fill.strokeColor().name() == "#ff0000" and _flat.strokeStyle() == Qt.PenStyle.NoPen,
      "polygonFill false: outlines only, in the color; outline false: no outline")
check(abs(vl.min_scale(_entries["overture-buildings"]) - 591657550.5 / 2 ** 11) < 1 and vl.min_scale(_entries["unesco-world-heritage"]) == 0
      and abs(vl.min_scale(_entries["overture-land-use"]) - 591657550.5 / 2 ** 13) < 1,
      "a planet archive is drawn from the app's zoom on (11 for the buildings, the entry's own otherwise)")

# The panel: a folded section, a select in groups, Add.
_pick = dock.overlay_pick
_ids = [_pick.itemData(i) for i in range(_pick.count())]
check(dock.overlays_section.button.text().startswith("Vector library") and [i for i in _ids if i] == [e["id"] for _, es in vl.grouped() for e in es]
      and _pick.itemText(0) == "Buildings" and not (_pick.model().item(0).flags() & Qt.ItemFlag.ItemIsSelectable)
      and _pick.currentData() is not None,
      f"the panel's Vector library: a select of the {len([i for i in _ids if i])} entries under their group titles, and Add")
_added = dock.add_overlay("ign-ocsge-usage")
check(len(_added) == 1 and isinstance(_added[0], _VTLayer) and _added[0].isValid() and _added[0].customProperty(vl.PROP) == "ign-ocsge-usage"
      and "IGN" in dock.status.text() and "zoom 13" in dock.status.text()
      and len(_added[0].renderer().styles()) == len(vl.category_rules(_entries["ign-ocsge-usage"])),
      f"Add: a styled vector tile layer in the project, its attribution in the status line ({dock.status.text()[:70]})")
# A project reopened with a layer read through the plugin's own server,
# saved when that server had another port: served again, on this one.
from terrain_viewer.live.server import LiveServer as _Live  # noqa: E402
_old = _VTLayer(vl.local_uri("https://tiles.overturemaps.org/2031-01-15.0/base.pmtiles", 9, 13, _FakeServer()), "saved earlier")
_old.setCustomProperty(vl.PROP, "overture-land-cover")
_Project.instance().addMapLayer(_old)
dock.revive_overlays()
_u.setEncodedUri(_old.source())
check(_u.param("url").startswith(f"http://127.0.0.1:{_Live.instance().port}/pmtiles/") and "8765" not in _old.source()
      and _u.param("url").endswith("base.pmtiles") and _u.param("zmax") == "13" and _old.isValid(),
      f"a saved project's Overture layer: its address moved to the server's port ({_Live.instance().port}), the server started")
_n_warn = len(dock.warnings)


def _down(url):
    raise OSError("no answer")


check(dock.add_overlay("osm-buildings-openfreemap", fetch=_down) == [] and len(dock.warnings) == _n_warn + 1
      and "no answer" in dock.warnings[-1], "Add: a TileJSON that does not answer is said, nothing added")
_Project.instance().clear()
spin(50)
canvas.freeze(False)
__import__("shutil").rmtree(_tmp, ignore_errors=True)
