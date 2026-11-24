"""The panel: the app's sidebar groups, each mode a checkbox with its
settings, built from what the tile service answers (/sources, /modes,
/colorramps), so a mode or setting added to the app shows up here without a
plugin release. Each checked mode is a layer of the project whose address
the panel writes; a changed setting rewrites that address."""
import math
import time
from urllib.parse import urlsplit, parse_qsl

from qgis.PyQt.QtCore import Qt, QTimer
from qgis.PyQt.QtWidgets import (
    QDockWidget, QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel, QLineEdit, QPushButton,
    QComboBox, QCheckBox, QDoubleSpinBox, QSpinBox, QScrollArea, QToolButton, QFrame, QGroupBox, QSizePolicy,
)
from qgis.core import (
    QgsSettings, QgsCoordinateReferenceSystem, QgsRectangle, QgsDataSourceUri, QgsCoordinateTransform, QgsProject,
)

try:
    from qgis.gui import QgsCollapsibleGroupBox as GroupBox
except ImportError:  # pragma: no cover
    GroupBox = QGroupBox
try:
    from qgis.gui import QgsOpacityWidget
except ImportError:  # pragma: no cover
    QgsOpacityWidget = None

from .service import Catalog, ServiceError, tile_url, values_url, split_link, KEY_PARAMS, walk_modes
from .layers import LayerStack, PROP, tree_ranks

SETTINGS = "terrain_viewer"
DEFAULT_SERVICE = "http://localhost:3400"
WORLD = 20037508.342789244


def _label(key, mode_id):
    """slopeMinDegrees -> "Min degrees" (the mode's name taken off)."""
    k = key
    for prefix in (mode_id, mode_id.rstrip("s"), "tells", "tell"):
        if k.startswith(prefix) and len(k) > len(prefix) and k[len(prefix)].isupper():
            k = k[len(prefix):]
            break
    words, cur = [], ""
    for ch in k:
        if ch.isupper() and cur:
            words.append(cur)
            cur = ch
        else:
            cur += ch
    words.append(cur)
    text = " ".join(words).lower()
    return text[:1].upper() + text[1:]


class SettingWidget:
    """One setting: a widget chosen by its type, read and written as the
    URL value."""

    def __init__(self, spec, colorramps, on_change):
        self.spec = spec
        t, key = spec["type"], spec["key"]
        d = spec.get("default")
        if t == "boolean":
            w = QCheckBox()
            w.setChecked(bool(d))
            w.toggled.connect(on_change)
            self.get, self.set = w.isChecked, lambda v: w.setChecked(str(v).lower() in ("1", "true", "yes"))
        elif t == "enum" or spec.get("enum"):
            w = QComboBox()
            w.addItems([str(e) for e in spec.get("enum") or []])
            if d is not None:
                w.setCurrentText(str(d))
            w.currentTextChanged.connect(on_change)
            self.get, self.set = w.currentText, lambda v: w.setCurrentText(str(v))
        elif t in ("number", "integer"):
            integer = t == "integer"
            w = QSpinBox() if integer else QDoubleSpinBox()
            w.setRange(-10 ** 6, 10 ** 6)
            if not integer:
                w.setDecimals(3 if isinstance(d, float) and not float(d).is_integer() else 2)
                w.setSingleStep(0.1 if isinstance(d, float) and abs(d) <= 2 else 1)
            if isinstance(d, (int, float)):
                w.setValue(int(d) if integer else float(d))
            w.valueChanged.connect(on_change)
            w.setKeyboardTracking(False)
            self.get = w.value
            self.set = lambda v: w.setValue(int(float(v)) if integer else float(v))
        elif key.lower().endswith("colorramp") and colorramps:
            w = QComboBox()
            w.setEditable(True)
            w.addItems(colorramps)
            w.setCurrentText(str(d or ""))
            w.currentTextChanged.connect(on_change)
            self.get, self.set = w.currentText, lambda v: w.setCurrentText(str(v))
        else:
            w = QLineEdit(str(d) if d is not None else "")
            w.editingFinished.connect(on_change)
            self.get, self.set = w.text, lambda v: w.setText(str(v))
        if spec.get("note"):
            w.setToolTip(spec["note"])
        # The panel stays as narrow as the dock: long ramp names elide.
        w.setMinimumWidth(60)
        if isinstance(w, QComboBox):
            w.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
            w.setMinimumContentsLength(8)
        self.widget = w


class ModeRow:
    """A mode: its checkbox, its opacity, its settings (folded)."""

    def __init__(self, dock, path, mode):
        self.dock, self.path, self.mode = dock, path, mode
        self.box = QWidget()
        lay = QVBoxLayout(self.box)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        head = QHBoxLayout()
        self.check = QCheckBox(mode["name"])
        self.check.toggled.connect(self.on_toggle)
        head.addWidget(self.check, 1)
        self.vector = None
        if mode.get("form") in ("vector", "both") and mode.get("vector"):
            self.vector = QCheckBox("vector")
            self.vector.setToolTip("Also as vector tiles (the same features, styled in QGIS)")
            self.vector.toggled.connect(self.on_toggle)
            head.addWidget(self.vector)
        self.numbers = None
        if mode.get("values"):
            self.numbers = QCheckBox("values")
            self.numbers.setToolTip(f"Also the values before the colour ramp, a Float32 raster for analysis ({mode['values'].get('unit')}): {mode['values'].get('description', '')}")
            self.numbers.toggled.connect(self.on_toggle)
            head.addWidget(self.numbers)
        self.more = QToolButton()
        self.more.setText("⚙")
        self.more.setCheckable(True)
        self.more.setAutoRaise(True)
        self.more.setToolTip("Settings")
        head.addWidget(self.more)
        lay.addLayout(head)

        self.panel = QFrame()
        self.panel.setVisible(False)
        form = QFormLayout(self.panel)
        form.setContentsMargins(18, 0, 0, 6)
        self.more.toggled.connect(self.panel.setVisible)
        self.opacity = None
        if mode.get("opacityKey") or mode.get("form") != "vector":
            if QgsOpacityWidget is not None:
                self.opacity = QgsOpacityWidget()
                self.opacity.setOpacity(1.0)
                self.opacity.opacityChanged.connect(lambda _v: self.apply_style())
            else:
                self.opacity = QDoubleSpinBox()
                self.opacity.setRange(0, 1)
                self.opacity.setSingleStep(0.05)
                self.opacity.setValue(1)
                self.opacity.valueChanged.connect(lambda _v: self.apply_style())
            form.addRow("Opacity", self.opacity)
        self.settings = {}
        for spec in mode.get("settings", []):
            sw = SettingWidget(spec, dock.catalog.colorramps, self.changed)
            self.settings[spec["key"]] = sw
            form.addRow(_label(spec["key"], mode["id"]), sw.widget)
        lay.addWidget(self.panel)

    # values ---------------------------------------------------------------
    def values(self):
        return {k: sw.get() for k, sw in self.settings.items()}

    def opacity_value(self):
        if self.opacity is None:
            return 1.0
        return self.opacity.opacity() if hasattr(self.opacity, "opacity") else self.opacity.value()

    def set_opacity(self, v):
        if self.opacity is None:
            return
        (self.opacity.setOpacity if hasattr(self.opacity, "setOpacity") else self.opacity.setValue)(float(v))

    def set_values(self, params):
        for k, v in params.items():
            if k in self.settings:
                self.settings[k].set(v)

    # layers ---------------------------------------------------------------
    def changed(self, *_):
        self.dock.schedule(self)

    def on_toggle(self, *_):
        self.update()

    def urls(self):
        base, common = self.dock.service_url(), self.dock.common_params()
        values = self.values()
        out = {}
        if self.mode.get("form") != "vector":
            out[self.mode["id"]] = (tile_url(base, self.mode, values, common), False)
        if self.mode.get("vector"):
            out[self.mode["id"] + ":vector"] = (tile_url(base, self.mode, values, common, vector=True), True)
        if self.mode.get("values"):
            out[self.mode["id"] + ":values"] = (values_url(base, self.mode, values, common), "values")
        return out

    def update(self):
        stack = self.dock.stack
        for key, (url, vector) in self.urls().items():
            want = self.check.isChecked() if not key.endswith(":vector") else bool(self.vector and self.vector.isChecked() and self.check.isChecked())
            if self.mode.get("form") == "vector" and key.endswith(":vector"):
                want = self.check.isChecked()
            layer = stack.find(key)
            if vector == "values":
                want = bool(self.numbers and self.numbers.isChecked() and self.check.isChecked())
                if want or layer is not None:
                    unit = self.mode["values"].get("unit")
                    layer = stack.ensure_values(key, f"{self.mode['name']} (values{', ' + unit if unit and unit != '1' else ''})", self.path, url, self.mode["values"].get("range"))
                    stack.set_visible(layer, want)
                continue
            if not want and layer is None:
                continue
            if want or layer is not None:
                name = self.mode["name"] + (" (vector tiles)" if vector and self.mode.get("form") != "vector" else "")
                layer = stack.ensure(key, name, self.path, url, vector, self.mode["id"], self.values())
                stack.style(layer, self.opacity_value(), self.mode.get("shading") and not vector)
                stack.set_visible(layer, want)

    def apply_style(self):
        for key in self.urls():
            if key.endswith(":values"):
                continue
            layer = self.dock.stack.find(key)
            self.dock.stack.style(layer, self.opacity_value(), self.mode.get("shading") and not key.endswith(":vector"))


class TerrainViewerDock(QDockWidget):
    def __init__(self, canvas=None, parent=None):
        super().__init__("Terrain Viewer", parent)
        self.setObjectName("TerrainViewerDock")
        self.canvas = canvas
        self.catalog = None
        self.rows = {}
        self.stack = LayerStack()
        self.extra = {}  # a share link's other parameters, kept in every address
        self.camera = None  # the last share link's (lat, lng, zoom), when there is no canvas
        self.pending = set()
        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(500)
        self.timer.timeout.connect(self.flush)

        s = QgsSettings()
        body = QWidget()
        outer = QVBoxLayout(body)

        line = QHBoxLayout()
        self.url = QLineEdit(s.value(f"{SETTINGS}/service", DEFAULT_SERVICE))
        self.url.setPlaceholderText("Tile service, e.g. http://localhost:3400")
        self.url.returnPressed.connect(self.connect_service)
        go = QPushButton("Connect")
        go.clicked.connect(self.connect_service)
        line.addWidget(self.url, 1)
        line.addWidget(go)
        outer.addLayout(line)
        self.status = QLabel("Not connected")
        self.status.setWordWrap(True)
        outer.addWidget(self.status)

        src = QFormLayout()
        self.source = QComboBox()
        self.source.setEditable(True)
        self.source.setToolTip("An id from the service's /sources, or the address of Terrarium tiles, a COG or a VRT")
        self.source.currentTextChanged.connect(lambda _t: self.schedule_all())
        src.addRow("Terrain source", self.source)
        self.keys = {}
        for k in KEY_PARAMS:
            e = QLineEdit(s.value(f"{SETTINGS}/{k}", ""))
            e.setEchoMode(QLineEdit.EchoMode.Password)
            e.setPlaceholderText("only for the sources that need it")
            e.editingFinished.connect(self.keys_changed)
            self.keys[k] = e
            src.addRow(k, e)
        outer.addLayout(src)

        link = QHBoxLayout()
        self.link = QLineEdit()
        self.link.setPlaceholderText("Paste a Terrain Viewer share link")
        self.link.returnPressed.connect(self.open_link)
        open_btn = QPushButton("Open from link")
        open_btn.clicked.connect(self.open_link)
        link.addWidget(self.link, 1)
        link.addWidget(open_btn)
        outer.addLayout(link)

        freeze = QHBoxLayout()
        freeze_btn = QPushButton("Freeze")
        freeze_btn.setToolTip("Copy the layers drawn now from the \"Terrain Viewer (live)\" group into a new dated "
                              "group under it, every setting kept in their addresses; the panel never changes the copies")
        freeze_btn.clicked.connect(self.freeze)
        freeze.addStretch(1)
        freeze.addWidget(freeze_btn)
        outer.addLayout(freeze)
        self.freeze_btn = freeze_btn

        self.groups_host = QWidget()
        self.groups_layout = QVBoxLayout(self.groups_host)
        self.groups_layout.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setWidget(self.groups_host)
        scroll.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        outer.addWidget(scroll, 1)
        self.setWidget(body)

    # -- the service ------------------------------------------------------
    def service_url(self):
        return self.url.text().strip().rstrip("/")

    def common_params(self):
        out = dict(self.extra)
        src = self.source.currentData() or self.source.currentText().strip()
        if src:
            out["terrainSource"] = src
        for k, e in self.keys.items():
            if e.text().strip():
                out[k] = e.text().strip()
        return out

    def keys_changed(self):
        s = QgsSettings()
        for k, e in self.keys.items():
            s.setValue(f"{SETTINGS}/{k}", e.text().strip())
        self.schedule_all()

    def connect_service(self):
        base = self.service_url()
        try:
            self.catalog = Catalog(base)
        except ServiceError as e:
            self.status.setText(f"No tile service at {base}: {e}")
            return False
        QgsSettings().setValue(f"{SETTINGS}/service", base)
        self.stack.ranks = tree_ranks(self.catalog.tree)
        self.build()
        self.status.setText(f"{len(self.catalog.sources)} sources, {len(self.catalog.modes)} modes from {base}")
        self.adopt_existing()
        return True

    def build(self):
        while self.groups_layout.count():
            w = self.groups_layout.takeAt(0).widget()
            if w:
                w.deleteLater()
        self.rows = {}
        self.source.blockSignals(True)
        current = self.source.currentData() or self.source.currentText()
        self.source.clear()
        for s in self.catalog.sources:
            label = s["name"] + (f"  ({s['key']})" if s.get("key") else "")
            self.source.addItem(label, s["id"])
        i = self.source.findData(current) if current else 0
        self.source.setCurrentIndex(max(i, 0))
        self.source.blockSignals(False)

        def add_group(g, parent_layout, path):
            here = path + ((g["group"],) if g.get("group") else ())
            if g.get("group"):
                box = GroupBox(g["group"])
                inner = QVBoxLayout(box)
                parent_layout.addWidget(box)
            else:
                inner = parent_layout
            for sub in reversed(g.get("groups", [])):
                add_group(sub, inner, here)
            for item in reversed(g.get("items", [])):
                row = ModeRow(self, here, item)
                self.rows[item["id"]] = row
                inner.addWidget(row.box)

        # The app's panel reads from the base up (colour relief, analysis,
        # relief, lighting, overlays); /modes is top of the map first, so
        # the panel lists it reversed (the layer tree keeps the map's order).
        for g in reversed(self.catalog.tree):
            add_group(g, self.groups_layout, ())
        self.groups_layout.addStretch(1)

    def adopt_existing(self):
        """The layers this panel wrote earlier (a saved project): their
        checkboxes and settings read back from their addresses."""
        for key, row in self.rows.items():
            for k in (key, key + ":vector", key + ":values"):
                layer = self.stack.find(k)
                if layer is None:
                    continue
                if k.endswith(":values"):  # a GDAL source: the address itself
                    q = dict(parse_qsl(urlsplit(layer.source()).query))
                else:
                    uri = QgsDataSourceUri()
                    uri.setEncodedUri(layer.source())
                    q = dict(parse_qsl(urlsplit(uri.param("url")).query))
                row.set_values(q)
                node = self.stack.node(layer)
                visible = bool(node and node.itemVisibilityChecked())
                extra = (row.vector,) if k.endswith(":vector") and row.vector else (row.numbers,) if k.endswith(":values") and row.numbers else ()
                for w in (row.check,) + extra:
                    w.blockSignals(True)
                    w.setChecked(w.isChecked() or visible)
                    w.blockSignals(False)
                if q.get("terrainSource"):
                    i = self.source.findData(q["terrainSource"])
                    self.source.blockSignals(True)
                    if i >= 0:
                        self.source.setCurrentIndex(i)
                    else:
                        self.source.setEditText(q["terrainSource"])
                    self.source.blockSignals(False)

    # -- updates, debounced -------------------------------------------------
    def schedule(self, row):
        self.pending.add(row)
        self.timer.start()

    def schedule_all(self):
        self.pending.update(self.rows.values())
        self.timer.start()

    def flush(self):
        rows, self.pending = self.pending, set()
        for row in rows:
            row.update()

    # -- a share link -----------------------------------------------------
    def open_link(self, link=None):
        link = link if isinstance(link, str) else self.link.text()
        if self.catalog is None and not self.connect_service():
            return
        query = split_link(link)
        try:
            view = self.catalog.view(query)
        except ServiceError as e:
            self.status.setText(f"Could not read the link: {e}")
            return
        params = dict(view.get("params", {}))
        src = params.pop("terrainSource", None)
        if src:
            i = self.source.findData(src)
            self.source.blockSignals(True)
            if i >= 0:
                self.source.setCurrentIndex(i)
            else:
                self.source.setEditText(src)
            self.source.blockSignals(False)
        # The opacities go to the QGIS layers (view["opacity"]), not into
        # the addresses.
        settings_keys = {r.mode["opacityKey"] for r in self.rows.values() if r.mode.get("opacityKey")}
        for row in self.rows.values():
            row.set_values(params)
            settings_keys.update(row.settings)
        self.extra = {k: v for k, v in params.items() if k not in settings_keys and k not in KEY_PARAMS}
        active = set(view.get("active", []))
        for mode_id, row in self.rows.items():
            if mode_id in view.get("opacity", {}):
                row.set_opacity(view["opacity"][mode_id])
            row.check.blockSignals(True)
            row.check.setChecked(mode_id in active)
            row.check.blockSignals(False)
        for row in self.rows.values():
            row.update()
        cam = view.get("camera") or {}
        if cam.get("lat") is not None and cam.get("lng") is not None:
            self.camera = (float(cam["lat"]), float(cam["lng"]), float(cam.get("zoom") or 12))
            self.zoom_to(float(cam["lat"]), float(cam["lng"]), float(cam.get("zoom") or 12))
        self.status.setText(f"Opened: {len(active)} modes on" + (f", {len(self.extra)} other parameters kept" if self.extra else ""))

    # -- freeze ---------------------------------------------------------------
    def place(self):
        """(lat, lng, zoom) of the canvas centre, in the app's zoom (512 px
        tiles), or the last link's camera when there is no canvas."""
        if self.canvas is None:
            return self.camera
        ms = self.canvas.mapSettings()
        try:
            to_merc = QgsCoordinateTransform(ms.destinationCrs(), QgsCoordinateReferenceSystem("EPSG:3857"), QgsProject.instance())
            c = to_merc.transform(self.canvas.extent().center())
            ext = to_merc.transformBoundingBox(self.canvas.extent())
        except Exception:  # noqa: BLE001 - an extent outside Web Mercator
            return self.camera
        width = max(self.canvas.width(), 1)
        if ext.width() <= 0:
            return self.camera
        zoom = math.log2(2 * WORLD * width / (512 * ext.width()))
        lng = c.x() * 180 / WORLD
        lat = math.degrees(2 * math.atan(math.exp(c.y() * math.pi / WORLD)) - math.pi / 2)
        return (lat, lng, zoom)

    def freeze(self, *_):
        """The layers drawn now copied into a new group named with the time
        and the place, every setting burnt into their addresses."""
        self.flush()  # a setting changed less than half a second ago
        name = "Frozen " + time.strftime("%Y-%m-%d %H:%M")
        place = self.place()
        if place:
            name += f" — {place[0]:.2f}, {place[1]:.2f} z{round(place[2])}"
        group = self.stack.freeze(name)
        if group is None:
            self.status.setText("Nothing to freeze: no Terrain Viewer layer is checked")
            return None
        self.status.setText(f"{group.name()}: {len(group.findLayers())} layers")
        return group

    def zoom_to(self, lat, lng, zoom):
        """The app's camera as the canvas extent (512 px tiles: zoom z is a
        world of 512 * 2^z pixels)."""
        if self.canvas is None:
            return
        x = lng * WORLD / 180
        y = math.log(math.tan((90 + lat) * math.pi / 360)) * WORLD / math.pi
        per_px = 2 * WORLD / (512 * 2 ** zoom)
        w, h = max(self.canvas.width(), 400), max(self.canvas.height(), 300)
        crs = QgsCoordinateReferenceSystem("EPSG:3857")
        if self.canvas.mapSettings().destinationCrs() != crs:
            QgsProject.instance().setCrs(crs)
        self.canvas.setExtent(QgsRectangle(x - w / 2 * per_px, y - h / 2 * per_px, x + w / 2 * per_px, y + h / 2 * per_px))
        self.canvas.refresh()
