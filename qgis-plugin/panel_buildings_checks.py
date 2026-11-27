# Run by test_panel_units.py (exec, in its namespace: `dock`, `canvas`,
# `check`, `spin`). 0.11.0: where the building shadows take their buildings
# from. The PMTiles reader against an archive written here, the height rule,
# the "Buildings from" choice (the Library's sources, an address, a polygon
# layer of the project with its height field), the layer written as GeoJSON
# and burnt by the Python backend, what goes in a tile service's address.
# No network.
import gzip as _gzip
import json as _json
import struct as _struct

from qgis.core import QgsVectorLayer as _VLayer, QgsFeature as _Feature, QgsGeometry as _Geometry, QgsRectangle as _Rect  # noqa: E402
from iconem_terrain_viewer import buildings_ui as bui, local_files as _local_files  # noqa: E402
from iconem_terrain_viewer.live import buildings as lb, pmtiles as lp  # noqa: E402


# -- a PMTiles archive, written as the specification says --------------------------
def _varint(v):
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        out.append(b | (0x80 if v else 0))
        if not v:
            return bytes(out)


def _directory(entries):
    """[(tile id, run length, length, offset)] serialized, gzipped."""
    out = bytearray(_varint(len(entries)))
    last = 0
    for tid, *_ in entries:
        out += _varint(tid - last)
        last = tid
    for _t, run, _l, _o in entries:
        out += _varint(run)
    for _t, _r, length, _o in entries:
        out += _varint(length)
    for i, (_t, _r, _l, off) in enumerate(entries):
        contiguous = i > 0 and off == entries[i - 1][3] + entries[i - 1][2]
        out += _varint(0 if contiguous else off + 1)
    return _gzip.compress(bytes(out))


def _archive(tiles, leaf_from=None):
    """{(z, x, y): bytes} as an archive; the tiles from index `leaf_from` on
    behind a leaf directory."""
    items = sorted((lp.tile_id(*zxy), _gzip.compress(data)) for zxy, data in tiles.items())
    data, entries, off = b"", [], 0
    for tid, blob in items:
        entries.append((tid, 1, len(blob), off))
        data += blob
        off += len(blob)
    leaves = b""
    root_entries = entries
    if leaf_from is not None:
        leaf = _directory(entries[leaf_from:])
        leaves = leaf
        root_entries = entries[:leaf_from] + [(entries[leaf_from][0], 0, len(leaf), 0)]
    root = _directory(root_entries)
    meta = _gzip.compress(_json.dumps({"vector_layers": [{"id": "building"}]}).encode())
    root_off = 127
    meta_off = root_off + len(root)
    leaf_off = meta_off + len(meta)
    data_off = leaf_off + len(leaves)
    header = bytearray(127)
    header[:7] = b"PMTiles"
    header[7] = 3
    _struct.pack_into("<11Q", header, 8, root_off, len(root), meta_off, len(meta), leaf_off, len(leaves), data_off, len(data),
                      len(items), len(items), len(items))
    header[96], header[97], header[98], header[99] = 1, 2, 2, 1  # clustered, gzip directories, gzip tiles, MVT
    header[100], header[101] = 0, 14
    return bytes(header) + root + meta + leaves + data


_tiles = {(0, 0, 0): b"world", (14, 8289, 5633): b"paris", (14, 8290, 5633): b"paris east", (14, 4825, 6156): b"new york"}
_asked = []


def _range_of(blob):
    def fetch(url, start, length):
        _asked.append((start, length))
        return blob[start:start + length]
    return fetch


for _leaf in (None, 1):
    _blob = _archive(_tiles, _leaf)
    del _asked[:]
    _a = lp.Archive("https://example.com/b.pmtiles", fetch=_range_of(_blob))
    _got = {zxy: _a.tile(*zxy) for zxy in _tiles}
    _n = len(_asked)
    check(_got == _tiles and _a.tile(14, 1, 1) is None and _a.tile(15, 0, 0) is None and _a.header["max_zoom"] == 14
          and _a.metadata()["vector_layers"][0]["id"] == "building" and _n == (1 + len(_tiles) + (1 if _leaf else 0)),
          f"PMTiles ({'a leaf directory' if _leaf else 'the root directory alone'}): every tile read back, decompressed, "
          f"a missing one None; {_n} range requests for {len(_tiles)} tiles (the header and directories once)")
check(lp.tile_id(0, 0, 0) == 0 and lp.tile_id(1, 1, 0) == 4 and lp.tile_id(5, 17, 11) == 1209 and lp.tile_id(14, 8289, 5633) == 317461501
      and lp.tile_id(15, 16578, 11266) == 1269846007 and lp.tile_id(20, 1, 1048575) == 733007751851,
      "PMTiles: tile ids on the Hilbert curve, as the pmtiles package numbers them")
try:
    lp.parse_header(b"PMTiles\x02" + bytes(119))
    check(False, "PMTiles: version 2 refused")
except lp.PMTilesError as e:
    check("version 2" in str(e), "PMTiles: another version is refused with a message")
try:
    lp.decompress(b"x", 4)
    check(False, "PMTiles: zstd refused")
except lp.PMTilesError as e:
    check("zstd" in str(e), "PMTiles: a compression that is not read is said")

# -- the height rule, as the app's (lib/vector-sources.ts featureHeight) -----------
check(lb.feature_height({"height": 12.5}, "height") == 12.5 and lb.feature_height({"height": "8"}, "height") == 8.0
      and lb.feature_height({"height": None, "num_floors": 3}, "height", "num_floors") == 3 * 3.2
      and lb.feature_height({"height": 0}, "height", "num_floors") == 4.0 and lb.feature_height({"height": "tall"}, "height") == 4.0
      and lb.feature_height({}, None) == 4.0 and lb.feature_height({"height": None}, "height", fallback=0.0) == 0.0,
      "a building's height: its field, else its floors times 3.2 m, else 4 m")
check(lb.transport_of("https://x/b.pmtiles?v=2") == "pmtiles" and lb.transport_of("https://x/{z}/{x}/{y}.pbf") == "mvt"
      and lb.transport_of("https://x/tiles.json") == "tilejson" and lb.transport_of("https://x/t", "mvt") == "mvt",
      "an address is a PMTiles archive, a template or a TileJSON, as the tile service reads it")
check(lb.register(None) == "" and lb.register("osm-buildings-openfreemap") == "" and lb.register({"id": "osm-buildings-openfreemap"}) == ""
      and len(lb.register({"type": "pmtiles", "url": "https://x/b.pmtiles", "sourceLayers": ["b"], "heightField": "h"})) == 12,
      "the Python backend keys a source of buildings; the default has none (the address stays as it was)")

# -- "Buildings from" ------------------------------------------------------------
QgsProject.instance().clear()
spin(50)
dock.connected = None
dock.build()
brow = dock.rows["buildingShadows"]
bf = brow.buildings
labels = [bf.source.itemText(i) for i in range(bf.source.count())]
check(bf is not None and "buildingShadowSource" not in brow.settings and "buildingShadowLayer" not in brow.settings
      and bf.kind() == ("library", "osm-buildings-openfreemap"),
      "Building shadows: a \"Buildings from\" choice, OpenFreeMap's OSM buildings by default; no plain text setting for the source")
check("Overture Maps buildings" in labels and "OpenStreetMap buildings (OpenFreeMap)" in labels and "Custom address..." in labels
      and not any(t.startswith("QGIS layer:") for t in labels) and bf.custom_box.isHidden() and bf.layer_box.isHidden(),
      f"the Library's vector sources with heights, then an address of your own ({len(labels)} rows)")
check(bf.service_params("http://127.0.0.1:1") == ({}, None) and bf.python_key() == ("", None),
      "the default goes in no address")
bf.source.setCurrentIndex(bf.source.findData("library:overture-buildings"))
p_over, why = bf.service_params("http://127.0.0.1:1")
k_over, why2 = bf.python_key()
check(p_over == {"buildingShadowSource": "overture-buildings"} and why is None and len(k_over) == 12 and why2 is None
      and lb.source_of(k_over).spec["partLayers"] == ["building_part"] and lb.source_of(k_over).spec["resolver"] == "overture",
      "Overture picked: its id for a tile service, its entry (PMTiles, parts, floors) for the Python backend")
check(_json.loads(QgsProject.instance().readEntry("terrain_viewer", "buildingsFrom", "")[0])["id"] == "overture-buildings",
      "the choice is kept in the project")
dock.build()  # the tree made again (a backend connecting)
brow = dock.rows["buildingShadows"]
bf = brow.buildings
check(bf.kind() == ("library", "overture-buildings"), "and shown again when the tree is made again")
bf.source.setCurrentIndex(bf.source.findData("custom:"))
bf.address.setText("https://example.com/bati.pmtiles")
bf.layer_name.setText("bati, parts")
bf.height_name.setText("hauteur")
bf._edited()
p_c, _ = bf.service_params("http://127.0.0.1:1")
k_c, _ = bf.python_key()
check(not bf.custom_box.isHidden() and p_c == {"buildingShadowSource": "https://example.com/bati.pmtiles", "buildingShadowLayer": "bati, parts",
                                               "buildingShadowHeightField": "hauteur"}
      and lb.source_of(k_c).spec == {"type": "pmtiles", "url": "https://example.com/bati.pmtiles", "heightField": "hauteur",
                                      "sourceLayers": ["bati", "parts"]},
      "an address of your own: with its layers and its height field, for both backends")
bf.set_params({"buildingShadowSource": "https://example.com/{z}/{x}/{y}.pbf", "buildingShadowHeightField": "h"})
check(bf.kind()[0] == "custom" and bf.address.text() == "https://example.com/{z}/{x}/{y}.pbf" and bf.height_name.text() == "h"
      and bf.custom_spec()["sourceLayers"] == ["building"] and bf.custom_spec()["type"] == "mvt",
      "a link's buildingShadowSource (an address) is read into the choice; a template with no layer reads \"building\"")
bf.set_params({"buildingShadowSource": "overture-buildings"})
check(bf.kind() == ("library", "overture-buildings"), "a link's buildingShadowSource (an id) too")

# A polygon layer of the project, in Lambert-93, near the Eiffel Tower:
# three buildings, one with no height, and a height kept as text.
bati = _VLayer("Polygon?crs=EPSG:2154&field=nom:string&field=hauteur:double&field=etages:integer&field=h_txt:string", "bati", "memory")
feats = []
for i, (x, y, w, h, floors) in enumerate(((648200, 6862300, 40, 30.0, 9), (648300, 6862300, 20, None, 4), (648400, 6862400, 30, 12.0, None))):
    f = _Feature(bati.fields())
    f.setGeometry(_Geometry.fromRect(_Rect(x, y, x + w, y + w)))
    f.setAttributes([f"b{i}", h, floors, None if h is None else str(h)])
    feats.append(f)
bati.dataProvider().addFeatures(feats)
bati.updateExtents()
dock.keep_extent()
QgsProject.instance().addMapLayer(bati)
spin(50)
i_l = bf.source.findData("layer:" + bati.id())
check(i_l > 0 and bf.source.itemText(i_l) == "QGIS layer: bati" and bui.polygon_layers() == [("bati", bati.id())],
      "a polygon layer of the project is listed under \"Buildings from\"")
bf.source.setCurrentIndex(i_l)
check(not bf.layer_box.isHidden() and bf.field.currentData() == "hauteur" and bf.factor.value() == 1.0 and bf.constant.value() == 0.0
      and [bf.field.itemData(i) for i in range(bf.field.count())] == ["nom", "hauteur", "etages", "h_txt", bui.CONSTANT],
      "its height field is picked (guessed: hauteur), among its fields and \"One height for all\"")
snap = bf.refresh_snapshot()
gj = _json.load(open(snap["path"], encoding="utf-8"))
ring = gj["features"][0]["geometry"]["coordinates"][0]
check(snap["count"] == 2 and snap["extent"] is None and [f["properties"]["height"] for f in gj["features"]] == [30.0, 12.0]
      and gj["type"] == "FeatureCollection" and 2.2 < ring[0][0] < 2.4 and 48.8 < ring[0][1] < 48.9 and "2 buildings of bati" in bf.note.text(),
      f"the layer written as GeoJSON in longitude and latitude, each building's height in metres; one without a height left out ({bf.note.text()})")
check(bf.refresh_snapshot() is snap, "written once: the same file while the choice stands")
bf.constant.setValue(5.0)
snap5 = bf.refresh_snapshot()
check(snap5["count"] == 3 and snap5["stamp"] != snap["stamp"], "a height for those without one: every building written")
bf.field.setCurrentIndex(bf.field.findData("etages"))
bf.factor.setValue(3.2)
gj = _json.load(open(bf.refresh_snapshot()["path"], encoding="utf-8"))
check([f["properties"]["height"] for f in gj["features"]] == [28.8, 12.8, 5.0], "a field of floors, 3.2 m each; the height without one for the third")
bf.field.setCurrentIndex(bf.field.findData("h_txt"))
bf.factor.setValue(1.0)
bf.constant.setValue(0.0)
check(bf.refresh_snapshot()["count"] == 2, "a height kept as text is read as a number")
bf.field.setCurrentIndex(bf.field.findData(bui.CONSTANT))
check(bf.constant.value() == 10.0 and not bf.factor.isEnabled() and bf.refresh_snapshot()["count"] == 3,
      "one height for all: 10 m unless set")
bf.field.setCurrentIndex(bf.field.findData("hauteur"))
bf.constant.setValue(0.0)

# The Python backend burns the file as it burns a tile's buildings.
key, why = bf.python_key()
src = lb.source_of(key).open()
z, n = 16, 256
size = 2 * lb.WORLD / (1 << z)
to3857 = QgsCoordinateTransform(bati.crs(), QgsCoordinateReferenceSystem("EPSG:3857"), QgsProject.instance())
ext = to3857.transformBoundingBox(bati.extent())
tx, ty = int((ext.center().x() + lb.WORLD) // size), int((lb.WORLD - ext.center().y()) // size)
lit, own = lb.shadows(z, tx, ty, n, 135.0, 30.0, key)
lit_n, own_n = lb.shadows(z, tx, ty - 1, n, 135.0, 30.0, key)
tallest = float(max(own.max(), own_n.max()))
shaded = int((lit == 0).sum() + (lit_n == 0).sum())
check(why is None and src.whole is not None and src.whole.count == 2 and src.whole.tallest == 30.0 and tallest in (12.0, 30.0)
      and shaded > 50 and not ((lit == 0) & (own > 0)).any(),
      f"the Python backend: the layer's two buildings burnt at their heights, {shaded} px shaded around them, the roofs lit")
check(lb.shadows(13, tx >> 3, ty >> 3, n, 135.0, 30.0, key)[0].min() == 1.0, "nothing below tile zoom 14, as the app")

# What a tile service gets: the file registered with it, on this machine only.
_posted = []
_real_register = _local_files.register
_local_files.register = lambda base, path, timeout=10: (_posted.append((base, path)) or {"source": "file:" + "a" * 32})
p_l, why = bf.service_params("http://127.0.0.1:3410")
p_l2, _ = bf.service_params("http://127.0.0.1:3410")
p_far, why_far = bf.service_params("https://tiles.example.com")
check(p_l == p_l2 == {"buildingShadowSource": "file:" + "a" * 32} and why is None and len(_posted) == 1
      and _posted[0][1].endswith(".geojson") and p_far == {} and "another machine" in why_far,
      "a tile service on this machine: the GeoJSON registered once (POST /files), file:<id> in the address; one on "
      "another machine cannot read it, said")
_local_files.register = lambda base, path, timeout=10: (_ for _ in ()).throw(ValueError("this tile service has no /files"))
bf.registered.clear()
p_old, why_old = bf.service_params("http://127.0.0.1:3410")
check(p_old == {} and "not registered" in why_old, "a service that refuses the file: said, the default buildings drawn")
_local_files.register = _real_register

# A large layer is read for the map's extent, again when the map leaves it.
_whole_max = bui.WHOLE_MAX
bui.WHOLE_MAX = 2
bf.kept["snapshot"] = None
canvas.setExtent(to3857.transformBoundingBox(_Rect(648190, 6862290, 648250, 6862350)))
spin(50)
part = bf.refresh_snapshot()
check(part["extent"] is not None and part["count"] == 2 and "around the map's extent" in bf.note.text()
      and part["extent"].width() >= 2 * bui.MARGIN_M,
      "a layer over the limit: read for the map's extent and three kilometres around")
check(bf.refresh_snapshot() is part, "the same file while the map stays inside")
canvas.setExtent(_Rect(ext.center().x() + 50000, ext.center().y(), ext.center().x() + 50500, ext.center().y() + 500))
spin(50)
far = bf.refresh_snapshot()
check(far is not part and far["count"] == 0 and "none with a height" in bf.note.text(), "the map moved away: read again (no building there, said)")
bui.WHOLE_MAX = _whole_max
bf.kept["snapshot"] = None

# In the addresses of the layers, under both backends.
dock.base = "http://127.0.0.1:9"
dock.connected = "remote"
bf.set_params({"buildingShadowSource": "overture-buildings"})
dock.extra = {"buildingShadowSource": "something-from-a-link"}
brow.row.set_forms({"colour"})
url = dock.rows["buildingShadows"].urls()["buildingShadows"][0]
check("buildingShadowSource=overture-buildings" in url and "something-from-a-link" not in url and "modes=buildingShadows" in url,
      "a tile service's address carries the buildings picked (not a link's leftover)")
dock.catalog.building_sources = None  # a service from before /building-sources
before_w = len(dock.warnings)
url_old = dock.rows["buildingShadows"].urls()["buildingShadows"][0]
check("buildingShadowSource" not in url_old and len(dock.warnings) == before_w + 1 and "OpenFreeMap's buildings only" in dock.warnings[-1],
      "an older tile service reads OpenFreeMap's buildings only: said once, its address left as it was")
dock.catalog.building_sources = []
dock.extra = {}
dock.connected = None
dock.base = None
brow.row.set_forms(set())
bf.set_params({"buildingShadowSource": "osm-buildings-openfreemap"})
check(QgsProject.instance().readEntry("terrain_viewer", "buildingsFrom", "")[0] == "", "back to the default: nothing kept in the project")
QgsProject.instance().removeMapLayer(bati.id())
spin(50)
check(not any(bf.source.itemText(i).startswith("QGIS layer:") for i in range(bf.source.count())), "the layer removed: off the list")
