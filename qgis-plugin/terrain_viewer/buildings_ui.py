"""Where the building shadows take their footprints and heights from: the
"Buildings from" choice under the Building shadows row's cog.

Three kinds, for every backend:

- a vector source of the app's Library that has heights (Overture's
  buildings, OpenFreeMap's OSM buildings, the default, ...): the list the
  plugin carries (assets/app_defaults.json, made from
  lib/custom-sources.json), with what a tile service lists at
  /building-sources added to it;
- an address of the user's own: a PMTiles archive, a TileJSON or a
  {z}/{x}/{y} vector tile template, with its layer and its height field;
- a polygon layer of the QGIS project, with the field that holds the height
  (times a factor: 3.2 for a field of floors) or one height for all. The
  panel writes its polygons to a GeoJSON in the profile
  (terrain_viewer/buildings/<layer id>.geojson: longitude and latitude, the
  height in `height`), which the Python backend burns as it burns a tile's
  buildings and a tile service on this machine reads once it is registered
  with it (POST /files, buildingShadowSource=file:<id>). A small layer is
  written whole; a large one for the map's extent and three kilometres
  around (a shadow's longest reach), again when the map leaves it.

The choice is kept in the project (terrain_viewer/buildingsFrom). What goes
in a layer's address: `service_params()` for a tile service (the app's
buildingShadowSource and the service's buildingShadowLayer,
buildingShadowHeightField), `python_key()` for the Python backend
(live/buildings.py register)."""
import json
import os

from qgis.PyQt.QtCore import Qt, QTimer
from qgis.PyQt.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel, QComboBox, QLineEdit, QDoubleSpinBox, QToolButton,
)
from qgis.core import (
    QgsApplication, QgsProject, QgsVectorLayer, QgsFeatureRequest, QgsCoordinateTransform, QgsCoordinateReferenceSystem,
    QgsRectangle,
)

from . import links
from .widgets import hand

DEFAULT_SOURCE = "osm-buildings-openfreemap"
# The service's parameters this control writes (processes.mjs BUILDING_INPUTS):
# never shown as plain settings of the row.
PARAMS = ("buildingShadowSource", "buildingShadowLayer", "buildingShadowHeightField", "buildingShadowFloorsField",
          "buildingShadowMinHeightField", "buildingShadowType")
PROJECT_SCOPE, PROJECT_KEY = "terrain_viewer", "buildingsFrom"
# A layer of at most this many features is written whole; a larger one for
# the map's extent, and never more than SNAPSHOT_MAX features.
WHOLE_MAX = 50000
SNAPSHOT_MAX = 200000
MARGIN_M = 3000.0  # a shadow's longest reach (live/buildings.py MAX_REACH_M)
CONSTANT = "\x00constant"
FLOOR_M = 3.2


def library(extra=None):
    """The Library's building sources, the plugin's own first, then what a
    tile service lists that the plugin does not know yet."""
    out = list(links.building_sources())
    known = {e["id"] for e in out}
    out.extend(e for e in (extra or []) if e.get("id") and e["id"] not in known and e.get("heightField"))
    return out


def polygon_layers(project=None):
    """The project's polygon layers, as the choice lists them: [(name, id)]."""
    out = []
    for layer in (project or QgsProject.instance()).mapLayers().values():
        if not isinstance(layer, QgsVectorLayer) or not layer.isValid():
            continue
        if layer.customProperty("terrain_viewer/layer") or layer.customProperty("terrain_viewer/frozen"):
            continue  # the panel's own (the Python backend's contour lines)
        g = layer.geometryType()
        if getattr(g, "value", g) != 2:  # polygons (Qgis.GeometryType.Polygon)
            continue
        out.append((layer.name(), layer.id()))
    return sorted(out)


def numeric_fields(layer):
    """The fields a height can be read from: numbers, and text (a height
    kept as "12.5" reads as a number)."""
    return [f.name() for f in layer.fields() if f.isNumeric() or f.typeName().lower() in ("string", "text", "varchar")]


def guess_height_field(names):
    low = {n.lower(): n for n in names}
    for want in ("height", "render_height", "hauteur", "height_m", "h", "hoehe", "altura", "building_height", "z"):
        if want in low:
            return low[want]
    return next((n for n in names if "height" in n.lower() or "haut" in n.lower()), None)


def snapshot_dir():
    d = os.path.join(QgsApplication.qgisSettingsDirPath(), "terrain_viewer", "buildings")
    os.makedirs(d, exist_ok=True)
    return d


def write_snapshot(layer, path, field=None, factor=1.0, constant=0.0, extent=None, limit=SNAPSHOT_MAX):
    """Writes a layer's polygons as GeoJSON (longitude and latitude, RFC
    7946), each with `height` in metres: its `field` times `factor`, else
    `constant` (0: a feature with no height is left out). `extent`: a
    QgsRectangle in EPSG:3857 to keep to, or None for the whole layer.
    Returns (features written, whether the limit cut it short)."""
    project = QgsProject.instance()
    wgs = QgsCoordinateReferenceSystem("EPSG:4326")
    to_wgs = QgsCoordinateTransform(layer.crs(), wgs, project)
    request = QgsFeatureRequest()
    if field:
        request.setSubsetOfAttributes([field], layer.fields())
    else:
        request.setNoAttributes()
    if extent is not None:
        to_layer = QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:3857"), layer.crs(), project)
        request.setFilterRect(to_layer.transformBoundingBox(extent))
    n, cut = 0, False
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write('{"type":"FeatureCollection","features":[\n')
        for feature in layer.getFeatures(request):
            h = 0.0
            if field:
                try:
                    v = feature[field]
                    h = float(v) * factor if v is not None and str(v) not in ("", "NULL") else 0.0
                except (TypeError, ValueError, KeyError):
                    h = 0.0
            if not (h > 0) or h != h:
                h = float(constant or 0.0)
            if not (h > 0):
                continue
            geom = feature.geometry()
            if geom is None or geom.isEmpty():
                continue
            try:
                geom.transform(to_wgs)
            except Exception:  # noqa: BLE001 - a feature outside the CRS's domain
                continue
            if n >= limit:
                cut = True
                break
            f.write(("," if n else "") + '{"type":"Feature","properties":{"height":%s},"geometry":%s}\n'
                    % (json.dumps(round(h, 2)), geom.asJson(7)))
            n += 1
        f.write("]}\n")
    os.replace(tmp, path)
    return n, cut


class BuildingsFrom(QWidget):
    """The choice and its fields; `on_change()` after every change the layers
    must follow."""

    def __init__(self, dock, on_change):
        super().__init__()
        self.dock, self.on_change = dock, on_change
        # Kept on the dock: the tree's rows are made again when a backend
        # connects, the file written for a layer and its id at a service stay.
        kept = getattr(dock, "buildings_kept", None)
        if kept is None:
            kept = dock.buildings_kept = {"snapshot": None, "registered": {}}
        self.kept = kept
        self.registered = kept["registered"]  # (service, path, stamp) -> file:<id>
        self._loading = False
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        row = QHBoxLayout()
        self.source = QComboBox()
        self.source.setMinimumWidth(60)
        self.source.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.source.setMinimumContentsLength(10)
        self.source.setToolTip("Where the footprints and the heights of the buildings come from: a vector source of the "
                               "app's Library that has heights, an address of your own (PMTiles, TileJSON, vector tile "
                               "template), or a polygon layer of this project with its height field")
        row.addWidget(self.source, 1)
        self.again = QToolButton()
        icon = QgsApplication.getThemeIcon("/mActionRefresh.svg")
        if icon is not None and not icon.isNull():
            self.again.setIcon(icon)
        else:
            self.again.setText("Again")
        self.again.setToolTip("Read the layer's buildings again (after an edit)")
        self.again.clicked.connect(lambda _c=False: self.refresh_snapshot(force=True))
        hand(self.again)
        row.addWidget(self.again)
        lay.addLayout(row)

        self.custom_box = QWidget()
        form = QFormLayout(self.custom_box)
        form.setContentsMargins(0, 0, 0, 0)
        self.address = QLineEdit()
        self.address.setPlaceholderText("https://.../buildings.pmtiles, a TileJSON, or .../{z}/{x}/{y}.pbf")
        self.address.setToolTip("An https address: a PMTiles archive (.pmtiles), a vector tile template ({z}/{x}/{y}), or a "
                                "TileJSON (anything else)")
        self.layer_name = QLineEdit()
        self.layer_name.setPlaceholderText("building")
        self.layer_name.setToolTip("The vector tile layer (or layers, comma-separated) holding the buildings' polygons. "
                                   "Empty: every layer a PMTiles archive or a TileJSON lists; \"building\" for a template")
        self.height_name = QLineEdit()
        self.height_name.setPlaceholderText("height")
        self.height_name.setToolTip("The property holding a height in metres (\"height\" when empty). A feature without "
                                    "one counts 4 m")
        for label, w in (("Address", self.address), ("Layer", self.layer_name), ("Height field", self.height_name)):
            w.setMinimumWidth(60)
            w.editingFinished.connect(self._edited)
            form.addRow(label, w)
        lay.addWidget(self.custom_box)

        self.layer_box = QWidget()
        form = QFormLayout(self.layer_box)
        form.setContentsMargins(0, 0, 0, 0)
        self.field = QComboBox()
        self.field.setMinimumWidth(60)
        self.field.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.field.setMinimumContentsLength(8)
        self.field.setToolTip("The field holding each building's height; or one height for every building")
        self.field.currentIndexChanged.connect(lambda _i: self._field_changed())
        form.addRow("Height field", self.field)
        self.factor = QDoubleSpinBox()
        self.factor.setRange(0.001, 1000.0)
        self.factor.setDecimals(3)
        self.factor.setValue(1.0)
        self.factor.setKeyboardTracking(False)
        self.factor.setToolTip("Metres per unit of the field: 1 for a height in metres, 3.2 for a number of floors, "
                               "0.3048 for feet")
        self.factor.valueChanged.connect(lambda _v: self._edited())
        form.addRow("Metres per unit", self.factor)
        self.constant = QDoubleSpinBox()
        self.constant.setRange(0.0, 1000.0)
        self.constant.setDecimals(1)
        self.constant.setSuffix(" m")
        self.constant.setValue(0.0)
        self.constant.setKeyboardTracking(False)
        self.constant.setToolTip("The height of a building whose field is empty (0: left out); with no field, the height "
                                 "of every building")
        self.constant.valueChanged.connect(lambda _v: self._edited())
        form.addRow("Height without one", self.constant)
        lay.addWidget(self.layer_box)

        self.note = QLabel()
        self.note.setWordWrap(True)
        self.note.setEnabled(False)
        lay.addWidget(self.note)

        self.move_timer = QTimer(self)
        self.move_timer.setSingleShot(True)
        self.move_timer.setInterval(700)
        self.move_timer.timeout.connect(self.moved)
        self.fill()
        self.restore(self.saved())
        self.source.currentIndexChanged.connect(lambda _i: self._source_changed())
        project = QgsProject.instance()
        project.layersAdded.connect(self._layers_changed)
        project.layersRemoved.connect(self._layers_changed)
        self._show()

    # -- the choices -----------------------------------------------------------
    def _header(self, text):
        if self.source.count():
            self.source.insertSeparator(self.source.count())
        self.source.addItem(text, None)
        item = self.source.model().item(self.source.count() - 1) if hasattr(self.source.model(), "item") else None
        if item is not None:
            item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsSelectable & ~Qt.ItemFlag.ItemIsEnabled)
            f = item.font()
            f.setBold(True)
            item.setFont(f)

    @property
    def snapshot(self):
        """{"what", "path", "stamp", "extent", "count", "cut", "name"} of the layer written, or None."""
        return self.kept["snapshot"]

    @snapshot.setter
    def snapshot(self, value):
        self.kept["snapshot"] = value

    def entries(self):
        catalog = getattr(self.dock, "catalog", None)
        return library(getattr(catalog, "building_sources", None))

    def fill(self):
        current = self.source.currentData()
        self.source.blockSignals(True)
        self.source.clear()
        self._header("Library (vector sources with heights)")
        for e in self.entries():
            self.source.addItem(e.get("name") or e["id"], "library:" + e["id"])
            self.source.setItemData(self.source.count() - 1,
                                    f"{e['id']}: {e.get('type')} tiles, layer {', '.join(e.get('sourceLayers') or [])}, "
                                    f"height in {e.get('heightField')}", Qt.ItemDataRole.ToolTipRole)
        self._header("Your own")
        self.source.addItem("Custom address...", "custom:")
        layers = polygon_layers()
        if layers:
            self._header("QGIS polygon layers")
            for name, lid in layers:
                self.source.addItem(f"QGIS layer: {name}", "layer:" + lid)
        i = self.source.findData(current) if current else -1
        self.source.setCurrentIndex(i if i >= 0 else self.source.findData("library:" + DEFAULT_SOURCE))
        self.source.blockSignals(False)

    def _layers_changed(self, *_):
        try:
            before = self.source.currentData()
            self.fill()
            if self.source.currentData() != before:  # the layer picked left the project
                self._source_changed()
        except RuntimeError:  # the row of a tree rebuilt since
            pass

    def kind(self):
        """("library" | "custom" | "layer", id)"""
        kind, _, rest = str(self.source.currentData() or "library:" + DEFAULT_SOURCE).partition(":")
        return kind, rest

    def qgis_layer(self):
        kind, lid = self.kind()
        layer = QgsProject.instance().mapLayer(lid) if kind == "layer" else None
        return layer if isinstance(layer, QgsVectorLayer) and layer.isValid() else None

    def _fill_fields(self, want=None):
        layer = self.qgis_layer()
        self.field.blockSignals(True)
        self.field.clear()
        names = numeric_fields(layer) if layer is not None else []
        for n in names:
            self.field.addItem(n, n)
        self.field.addItem("One height for all", CONSTANT)
        pick = want if want in names or want == CONSTANT else guess_height_field(names)
        self.field.setCurrentIndex(self.field.findData(pick if pick else CONSTANT))
        self.field.blockSignals(False)
        if self.field.currentData() == CONSTANT and self.constant.value() <= 0:
            self.constant.blockSignals(True)
            self.constant.setValue(10.0)
            self.constant.blockSignals(False)

    def _show(self):
        kind, _ = self.kind()
        self.custom_box.setVisible(kind == "custom")
        self.layer_box.setVisible(kind == "layer")
        self.again.setVisible(kind == "layer")
        self.factor.setEnabled(self.field.currentData() != CONSTANT)
        if kind == "library":
            e = next((x for x in self.entries() if x["id"] == self.kind()[1]), None)
            self.note.setText(f"{e.get('type')} tiles, heights in \"{e.get('heightField')}\"" + (
                f", floors in \"{e['floorsField']}\"" if e.get("floorsField") else "") if e else "")
        elif kind == "custom":
            self.note.setText("" if self.address.text().strip() else "Type the address, then Enter.")
        self.note.setVisible(bool(self.note.text()))

    # -- changes ---------------------------------------------------------------
    def _source_changed(self):
        if self.kind()[0] == "layer":
            self._fill_fields()
        self._changed()

    def _field_changed(self):
        if self.field.currentData() == CONSTANT and self.constant.value() <= 0:
            self.constant.blockSignals(True)
            self.constant.setValue(10.0)
            self.constant.blockSignals(False)
        self._edited()

    def _edited(self):
        if not self._loading:
            self._changed()

    def _changed(self):
        self._show()
        self.save()
        self.on_change()

    # -- kept in the project -----------------------------------------------------
    def state(self):
        kind, rest = self.kind()
        return {"kind": kind, "id": rest, "address": self.address.text().strip(), "layer": self.layer_name.text().strip(),
                "heightField": self.height_name.text().strip(), "field": self.field.currentData() if kind == "layer" else None,
                "factor": self.factor.value(), "constant": self.constant.value()}

    def save(self):
        if self._loading:
            return
        s = self.state()
        project = QgsProject.instance()
        if s["kind"] == "library" and s["id"] == DEFAULT_SOURCE:
            project.removeEntry(PROJECT_SCOPE, PROJECT_KEY)
        else:
            project.writeEntry(PROJECT_SCOPE, PROJECT_KEY, json.dumps(s))

    def saved(self):
        try:
            text, ok = QgsProject.instance().readEntry(PROJECT_SCOPE, PROJECT_KEY, "")
            return json.loads(text) if ok and text else {}
        except (ValueError, TypeError):
            return {}

    def restore(self, s):
        """A saved choice (or a link's parameters, set_params) shown; no change announced."""
        self._loading = True
        try:
            kind, rest = s.get("kind") or "library", s.get("id") or DEFAULT_SOURCE
            i = self.source.findData(f"{kind}:{rest}" if kind != "custom" else "custom:")
            if i < 0 and kind == "library":
                # An id the list lacks (a newer Library): kept, by its id.
                self.source.insertItem(1, rest, "library:" + rest)
                i = 1
            self.source.blockSignals(True)
            self.source.setCurrentIndex(i if i >= 0 else self.source.findData("library:" + DEFAULT_SOURCE))
            self.source.blockSignals(False)
            self.address.setText(s.get("address") or "")
            self.layer_name.setText(s.get("layer") or "")
            self.height_name.setText(s.get("heightField") or "")
            for w, v in ((self.factor, s.get("factor")), (self.constant, s.get("constant"))):
                if isinstance(v, (int, float)):
                    w.blockSignals(True)
                    w.setValue(float(v))
                    w.blockSignals(False)
            if self.kind()[0] == "layer":
                self._fill_fields(s.get("field"))
        finally:
            self._loading = False
        self._show()

    def set_params(self, params):
        """A link's or a saved layer's parameters (buildingShadowSource, ...):
        a Library id or an address. A file:<id> is the panel's own: the
        project's saved choice stands."""
        src = str(params.get("buildingShadowSource") or "").strip()
        if not src or src.startswith("file:"):
            return
        if src.startswith("{"):
            try:
                cfg = json.loads(src)
            except ValueError:
                return
            layers = cfg.get("sourceLayers") or cfg.get("layer") or ""
            self.restore({"kind": "custom", "address": cfg.get("url", ""), "heightField": cfg.get("heightField", ""),
                          "layer": ",".join(layers) if isinstance(layers, list) else str(layers)})
        elif "://" in src:
            self.restore({"kind": "custom", "address": src, "layer": params.get("buildingShadowLayer", ""),
                          "heightField": params.get("buildingShadowHeightField", "")})
        else:
            self.restore({"kind": "library", "id": src})
        self.save()

    # -- the QGIS layer as a file ---------------------------------------------------
    def canvas_extent(self):
        ext, _w = self.dock.canvas_extent()
        return ext

    def refresh_snapshot(self, force=False):
        """The GeoJSON of the layer picked, written when there is none for
        this choice (or `force`), or when the map left the extent it was
        written for. Returns the snapshot, or None (and why in the note)."""
        layer = self.qgis_layer()
        if layer is None:
            self.snapshot = None
            return None
        field = self.field.currentData()
        field = None if field == CONSTANT else field
        what = (layer.id(), field, round(self.factor.value(), 4), round(self.constant.value(), 2))
        snap = self.snapshot
        whole = layer.featureCount() <= WHOLE_MAX
        view = None if whole else self.canvas_extent()
        if snap is not None and not force and snap["what"] == what:
            if snap["extent"] is None or (view is not None and snap["extent"].contains(view)):
                return snap
        extent = None
        if not whole:
            if view is None:
                self.note.setText(f"{layer.name()}: {layer.featureCount()} features, read for the map's extent: no map yet")
                self.note.setVisible(True)
                return None
            grow = max(MARGIN_M, 0.5 * max(view.width(), view.height()))
            extent = QgsRectangle(view.xMinimum() - grow, view.yMinimum() - grow, view.xMaximum() + grow, view.yMaximum() + grow)
        path = os.path.join(snapshot_dir(), "".join(c if c.isalnum() or c in "-_" else "_" for c in layer.id()) + ".geojson")
        try:
            count, cut = write_snapshot(layer, path, field, self.factor.value() if field else 1.0, self.constant.value(), extent)
            st = os.stat(path)
        except OSError as e:
            self.note.setText(f"{layer.name()}: its buildings could not be written ({e})")
            self.note.setVisible(True)
            self.snapshot = None
            return None
        self.snapshot = {"what": what, "path": path, "stamp": f"{st.st_size}:{int(st.st_mtime * 1000)}", "extent": extent,
                         "count": count, "cut": cut, "name": layer.name()}
        self.note.setText(f"{count} buildings of {layer.name()}"
                          + ("" if extent is None else " around the map's extent (read again when the map leaves it)")
                          + (f"; the first {SNAPSHOT_MAX} only: zoom in" if cut else "")
                          + ("" if count else ": none with a height (pick the height field, or a height without one)"))
        self.note.setVisible(True)
        if force:
            self.on_change()
        return self.snapshot

    def moved(self):
        """The map moved: a layer read for an extent is read again once the
        map leaves it (the dock tells, debounced here)."""
        snap = self.snapshot
        if snap is None or snap["extent"] is None or self.kind()[0] != "layer":
            return
        view = self.canvas_extent()
        if view is not None and not snap["extent"].contains(view):
            self.on_change()

    # -- what the layers' addresses take ---------------------------------------------
    def custom_spec(self):
        url = self.address.text().strip()
        if not url:
            return None
        from .live.buildings import transport_of
        spec = {"type": transport_of(url), "url": url, "heightField": self.height_name.text().strip() or "height"}
        layers = [x.strip() for x in self.layer_name.text().split(",") if x.strip()]
        if layers:
            spec["sourceLayers"] = layers
        elif spec["type"] == "mvt":
            spec["sourceLayers"] = ["building"]
        return spec

    def service_params(self, base):
        """The tile service's parameters of the choice ({} for the default).
        A QGIS layer is registered with a service on this machine; (params,
        None) or ({}, why)."""
        kind, rest = self.kind()
        if kind == "library":
            return ({} if rest == DEFAULT_SOURCE else {"buildingShadowSource": rest}), None
        if kind == "custom":
            url = self.address.text().strip()
            if not url:
                return {}, None
            out = {"buildingShadowSource": url}
            if self.layer_name.text().strip():
                out["buildingShadowLayer"] = self.layer_name.text().strip()
            if self.height_name.text().strip():
                out["buildingShadowHeightField"] = self.height_name.text().strip()
            return out, None
        snap = self.refresh_snapshot()
        if snap is None:
            return {}, self.note.text() or "no polygon layer picked"
        from . import local_files
        if not local_files.is_loopback(base):
            return {}, (f"the tile service at {base} is on another machine: it cannot read the layer {snap['name']} "
                        "(use a tile server on this machine, or the Python backend)")
        key = (base, snap["path"], snap["stamp"])
        if key not in self.registered:
            try:
                self.registered[key] = local_files.register(base, snap["path"])["source"]
            except (ValueError, OSError) as e:
                return {}, (f"the buildings of {snap['name']} were not registered with the tile service: {e} "
                            "(a tile service without /building-sources reads no GeoJSON: update it)")
        return {"buildingShadowSource": self.registered[key]}, None

    def python_key(self):
        """(live/buildings.py's key of the choice, None) or ("", why)."""
        from .live import buildings
        kind, rest = self.kind()
        if kind == "library":
            if rest == DEFAULT_SOURCE:
                return "", None
            e = next((x for x in self.entries() if x["id"] == rest), None)
            if e is None:
                return "", f"{rest}: not a building source the plugin knows (a tile service may list it)"
            return buildings.register(e), None
        if kind == "custom":
            spec = self.custom_spec()
            return (buildings.register(spec), None) if spec else ("", None)
        snap = self.refresh_snapshot()
        if snap is None:
            return "", self.note.text() or "no polygon layer picked"
        return buildings.register({"type": "file", "path": snap["path"], "heightField": "height", "stamp": snap["stamp"]}), None
