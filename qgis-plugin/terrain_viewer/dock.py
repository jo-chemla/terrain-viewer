"""The panel: the app's sidebar groups, each mode a checkbox with its
settings, built from what the tile service answers (/sources, /processes,
/colorramps), so a mode or setting added to the app shows up here without a
plugin release. Each checked mode is a layer of the project whose address
the panel writes; a changed setting rewrites that address."""
import math
import time
from urllib.parse import urlsplit, parse_qsl

from qgis.PyQt.QtCore import Qt, QTimer, QUrl
from qgis.PyQt.QtNetwork import QNetworkRequest, QNetworkReply
from qgis.PyQt.QtWidgets import (
    QApplication, QDockWidget, QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel, QLineEdit, QPushButton,
    QComboBox, QCheckBox, QDoubleSpinBox, QSpinBox, QScrollArea, QToolButton, QFrame, QGroupBox, QSizePolicy,
)
from qgis.core import (
    Qgis, QgsNetworkAccessManager, QgsSettings, QgsCoordinateReferenceSystem, QgsRectangle, QgsDataSourceUri, QgsCoordinateTransform, QgsProject,
)

try:
    from qgis.gui import QgsCollapsibleGroupBox as GroupBox
except ImportError:  # pragma: no cover
    GroupBox = QGroupBox
try:
    from qgis.gui import QgsOpacityWidget
except ImportError:  # pragma: no cover
    QgsOpacityWidget = None

from .service import Catalog, ServiceError, tile_url, values_url, split_link, KEY_PARAMS, walk_modes, unresponsive_message
from .layers import LayerStack, PROP, tree_ranks
from . import local_server

SETTINGS = "terrain_viewer"
DEFAULT_SERVICE = "http://localhost:3400"
WORLD = 20037508.342789244
# While connected, the service's /health is asked this often (in the
# background), so a service that went away (the desktop app closed) is
# reported instead of leaving empty layers.
HEALTH_EVERY_MS = 15000


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


FORM_LABELS = {"colour": "Colour", "values": "Values", "vector": "Vector"}
DRAWN_FORMS = ("colour", "vector")  # the forms whose look the settings change


def _retain_hidden(w):
    """A hidden widget keeps its room in the layout."""
    sp = w.sizePolicy()
    sp.setRetainSizeWhenHidden(True)
    w.setSizePolicy(sp)


class FormsRow:
    """A mode's row: its checkbox on the left, its forms on the right
    (Colour: the coloured layer; Values: the numbers, a Float32 raster;
    Vector: the overlay's features), each a layer of the project, and a
    settings cog shown while a drawn form (Colour, Vector) is on; the
    settings fold under the row.

    Checking the mode turns on the forms it had (Colour the first time);
    unchecking it turns them all off (each layer removed) and remembers
    them. Checking a form checks the mode; unchecking the last one
    unchecks it. `on_change()` is called after every change by the user;
    set_forms() changes the boxes without calling it (a layer removed from
    the project, a saved project read back)."""

    def __init__(self, label, forms, on_change, tooltips=None):
        self.on_change = on_change
        self.box = QWidget()
        lay = QVBoxLayout(self.box)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        head = QHBoxLayout()
        head.setSpacing(4)
        self.check = QCheckBox(label)
        self.check.setMinimumWidth(40)  # long names elide rather than widen the panel
        self.check.toggled.connect(self._mode_toggled)
        head.addWidget(self.check, 1)
        self.forms = {}
        # Two columns at least, Colour in the first, so the boxes line up
        # from row to row (an empty slot keeps its width); the cog keeps its
        # place when hidden.
        slots = list(forms) if len(forms) >= 2 or "colour" not in forms else ["colour", None]
        if "colour" not in forms and len(forms) == 1:
            slots = [None] + list(forms)
        for f in slots:
            cb = QCheckBox(FORM_LABELS[f] if f else FORM_LABELS["values"])
            if f is None:
                _retain_hidden(cb)
                cb.setVisible(False)
                head.addWidget(cb)
                continue
            if tooltips and tooltips.get(f):
                cb.setToolTip(tooltips[f])
            cb.toggled.connect(lambda on, f=f: self._form_toggled(f, on))
            head.addWidget(cb)
            self.forms[f] = cb
        self.more = QToolButton()
        self.more.setText("⚙")
        self.more.setCheckable(True)
        self.more.setAutoRaise(True)
        self.more.setToolTip("Settings")
        _retain_hidden(self.more)
        head.addWidget(self.more)
        lay.addLayout(head)
        self.panel = QFrame()
        self.form_layout = QFormLayout(self.panel)
        self.form_layout.setContentsMargins(18, 0, 0, 6)
        lay.addWidget(self.panel)
        self.more.toggled.connect(lambda _on: self._sync())
        self.remembered = set()
        self._sync()

    def default_form(self):
        return next((f for f in ("colour", "vector", "values") if f in self.forms), None)

    def on(self, form):
        """Is this form wanted (its box checked)?"""
        return form in self.forms and self.forms[form].isChecked()

    def checked_forms(self):
        return {f for f, cb in self.forms.items() if cb.isChecked()}

    def _set_boxes(self, forms_on, mode_on):
        for w in [self.check] + list(self.forms.values()):
            w.blockSignals(True)
        try:
            for f, cb in self.forms.items():
                cb.setChecked(f in forms_on)
            self.check.setChecked(mode_on)
        finally:
            for w in [self.check] + list(self.forms.values()):
                w.blockSignals(False)
        self._sync()

    def _mode_toggled(self, on):
        if on:
            self._set_boxes(self.remembered or {self.default_form()}, True)
        else:
            self.remembered = self.checked_forms()
            self._set_boxes(set(), False)
        self.on_change()

    def _form_toggled(self, form, on):
        forms_on = self.checked_forms()
        if not forms_on:
            self.remembered = set()
        self._set_boxes(forms_on, bool(forms_on))
        self.on_change()

    def set_forms(self, forms_on):
        """The boxes set to `forms_on`, without on_change (the layers are
        already so)."""
        forms_on = set(forms_on) & set(self.forms)
        self._set_boxes(forms_on, bool(forms_on))

    def form_removed(self, form):
        """A form's layer was removed from the project (by hand)."""
        if self.on(form):
            self.set_forms(self.checked_forms() - {form})

    def _sync(self):
        drawn = any(self.on(f) for f in DRAWN_FORMS)
        self.more.setVisible(drawn and self.form_layout.rowCount() > 0)
        self.panel.setVisible(drawn and self.more.isChecked())


class ModeRow:
    """A mode of the tile service: its forms (FormsRow), its opacity and
    settings under the cog."""

    def __init__(self, dock, path, mode):
        self.dock, self.path, self.mode = dock, path, mode
        forms = []
        tips = {}
        if mode.get("form") != "vector":
            forms.append("colour")
            tips["colour"] = "The mode as the app draws it: an XYZ layer of the service's tiles"
        if mode.get("values"):
            forms.append("values")
            tips["values"] = (f"The values before the colour ramp, a Float32 raster read by GDAL, for analysis "
                              f"({mode['values'].get('unit')}): {mode['values'].get('description', '')}")
        if mode.get("vector"):
            forms.append("vector")
            tips["vector"] = "The same features as vector tiles, styled in QGIS"
        self.row = FormsRow(mode["name"], forms, self.update, tips)
        self.box, self.check, self.more = self.row.box, self.row.check, self.row.more
        # The boxes by their 0.5.0 names (tests, scripts).
        self.numbers = self.row.forms.get("values")
        self.vector = self.row.forms.get("vector")
        self.colour = self.row.forms.get("colour")
        form = self.row.form_layout
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
        self.row._sync()

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

    @staticmethod
    def form_of(key):
        return "values" if key.endswith(":values") else "vector" if key.endswith(":vector") else "colour"

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
        """Each form's layer added (checked), re-pointed (a setting changed)
        or removed (unchecked). A new layer gets the panel's opacity and
        blending; an existing one keeps what its properties say."""
        stack = self.dock.stack
        for key, (url, vector) in self.urls().items():
            want = self.row.on(self.form_of(key))
            layer = stack.find(key)
            if not want:
                if layer is not None:
                    self.dock.removing.add(layer.id())
                    stack.remove(key)
                continue
            if vector == "values":
                unit = self.mode["values"].get("unit")
                new = layer is None
                layer = stack.ensure_values(key, f"{self.mode['name']} (values{', ' + unit if unit and unit != '1' else ''})", self.path, url, self.mode["values"].get("range"))
            else:
                new = layer is None
                name = self.mode["name"] + (" (vector tiles)" if vector and self.mode.get("form") != "vector" else "")
                layer = stack.ensure(key, name, self.path, url, vector, self.mode["id"], self.values())
                if new:
                    stack.style(layer, self.opacity_value(), self.mode.get("shading") and not vector)
            if new:
                stack.set_visible(layer, True)

    def apply_style(self):
        for key in self.urls():
            if key.endswith(":values"):
                continue
            layer = self.dock.stack.find(key)
            self.dock.stack.style(layer, self.opacity_value(), self.mode.get("shading") and not key.endswith(":vector"))


class LocalSection:
    """The panel's "Experimental: compute locally" box, at its top: modes
    computed in QGIS's Python (live/), no tile service. Off by default; its
    rows are built the first time it is checked (numpy is imported then).
    Each row is a FormsRow: Colour (the server's coloured tiles), Values
    (Float32, QGIS's colour ramps, Identify), Vector (contour lines)."""

    def __init__(self, dock):
        self.dock = dock
        self.box = QFrame()
        self.box.setFrameShape(QFrame.Shape.StyledPanel)
        lay = QVBoxLayout(self.box)
        lay.setContentsMargins(6, 4, 6, 4)
        self.check = QCheckBox("Experimental: compute locally (no tile service)")
        f = self.check.font()
        f.setBold(True)
        self.check.setFont(f)
        self.check.setToolTip("Terrain modes computed in QGIS's Python with numpy from Mapterhorn elevation tiles, served "
                              "from a thread of QGIS on 127.0.0.1: no tile service, no Node. Per mode: Colour (coloured "
                              "tiles), Values (Float32 numbers, QGIS's colour ramps, Identify), Vector (contour lines).")
        self.check.toggled.connect(dock.toggle_local)
        lay.addWidget(self.check)
        self.body = QWidget()
        self.body.setVisible(False)
        lay.addWidget(self.body)
        self.rows = {}  # mode -> (FormsRow, {setting: getter})
        self.setters = {}  # mode -> {setting: setter}
        self.built = False
        self.timer = QTimer(dock)
        self.timer.setSingleShot(True)
        self.timer.setInterval(400)
        self.timer.timeout.connect(self.apply_all)
        self.prefetch_timer = QTimer(dock)
        self.prefetch_timer.setSingleShot(True)
        self.prefetch_timer.setInterval(150)
        self.prefetch_timer.timeout.connect(self.prefetch)
        # Contour lines: recomputed once the canvas stops.
        self.vector_timer = QTimer(dock)
        self.vector_timer.setSingleShot(True)
        self.vector_timer.setInterval(400)
        self.vector_timer.timeout.connect(self.refresh_vectors)
        if dock.canvas is not None:
            dock.canvas.extentsChanged.connect(self.extent_changed)

    def extent_changed(self):
        if self.check.isChecked():
            self.prefetch_timer.start()
            if any(r.on("vector") for r, _ in self.rows.values()):
                self.vector_timer.start()

    def build(self):
        from .live import modes  # numpy is only imported when asked
        from .live.layers import DEFAULT_ON, ORDER
        lay = QVBoxLayout(self.body)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        tips = {"colour": "Coloured tiles computed here (XYZ), shown tile by tile",
                "values": "The numbers, a Float32 raster read by GDAL: QGIS's colour ramps, Identify, raster calculator",
                "vector": "Contour lines for the view, a vector layer, recomputed after each pan or zoom"}
        for mode in reversed(ORDER):  # the base first, as the panel's groups read
            spec = modes.MODES[mode]
            row = FormsRow(spec["label"], modes.forms_of(mode), lambda m=mode: self.apply(m), tips)
            row.check.setToolTip(f"Values in {spec['unit']}" if spec["unit"] else spec["label"])
            widgets, setters = {}, {}
            for key, default in spec["defaults"].items():
                if key in spec.get("enums", {}):
                    w = QComboBox()
                    w.addItems(list(spec["enums"][key]))
                    w.setCurrentText(str(default))
                    w.currentTextChanged.connect(lambda _v: self.timer.start())
                    w.setMinimumWidth(60)
                    w.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
                    get, put = w.currentText, w.setCurrentText
                elif isinstance(default, int):
                    w = QSpinBox()
                    w.setRange(1, 256)
                    w.setValue(default)
                    w.setKeyboardTracking(False)
                    w.valueChanged.connect(lambda _v: self.timer.start())
                    get, put = w.value, lambda v, w=w: w.setValue(int(v))
                else:
                    w = QDoubleSpinBox()
                    w.setRange(-1e6, 1e6)
                    w.setDecimals(2 if abs(default) < 10 else 1)
                    w.setSingleStep(0.1 if abs(default) < 10 else 1)
                    w.setValue(float(default))
                    w.setKeyboardTracking(False)
                    w.valueChanged.connect(lambda _v: self.timer.start())
                    get, put = w.value, lambda v, w=w: w.setValue(float(v))
                widgets[key], setters[key] = get, put
                row.form_layout.addRow(_label(key, mode), w)
            row._sync()
            lay.addWidget(row.box)
            self.rows[mode] = (row, widgets)
            self.setters[mode] = setters
        self.built = True
        # The defaults, the first time: their colour layers.
        for mode in DEFAULT_ON:
            self.rows[mode][0].set_forms({"colour"})

    def opts(self, mode):
        from .live import modes
        defaults = modes.MODES[mode]["defaults"]
        # Only what differs from the defaults goes into the address.
        return {k: get() for k, get in self.rows[mode][1].items() if str(get()) != str(defaults[k])}

    def canvas_extent(self):
        c = self.dock.canvas
        if c is None:
            return None, 0
        try:
            to_merc = QgsCoordinateTransform(c.mapSettings().destinationCrs(), QgsCoordinateReferenceSystem("EPSG:3857"),
                                             QgsProject.instance())
            return to_merc.transformBoundingBox(c.extent()), c.width()
        except Exception:  # noqa: BLE001 - an extent outside Web Mercator
            return None, 0

    def auto_elevation_range(self):
        """The hypsometric tint over the view's elevations (2nd to 98th
        percentile), the first time it is drawn with its default range."""
        from .live import modes
        from .live.layers import elevation_range
        ext, width = self.canvas_extent()
        if ext is None or self.opts("elevation"):
            return
        lo, hi = elevation_range(ext, width)
        d = modes.MODES["elevation"]["defaults"]
        if (lo, hi) != (d["min"], d["max"]):
            self.setters["elevation"]["min"](round(lo))
            self.setters["elevation"]["max"](round(hi))
            self.timer.stop()  # applied now, by the caller

    def apply(self, mode):
        from .live.layers import LocalLayers
        if not self.check.isChecked():
            return
        row = self.rows[mode][0]
        ll = LocalLayers()
        if mode == "elevation" and row.checked_forms() and ll.find("elevation", "colour") is None and ll.find("elevation", "values") is None:
            self.auto_elevation_range()
        ext, width = self.canvas_extent()
        for form in row.forms:
            want = row.on(form)
            layer = ll.find(mode, form)
            if not want and layer is not None:
                self.dock.removing.add(layer.id())
            ll.set_form(mode, form, want, self.opts(mode), ext, width)

    def apply_all(self):
        for mode in self.rows:
            self.apply(mode)

    def refresh_vectors(self):
        from .live.layers import LocalLayers
        ext, width = self.canvas_extent()
        if ext is not None and self.check.isChecked():
            LocalLayers().refresh_vectors(self.opts, ext, width)

    def prefetch(self):
        from .live.layers import LocalLayers
        ext, width = self.canvas_extent()
        if ext is not None and self.check.isChecked():
            LocalLayers().prefetch(ext, width)

    def form_removed(self, mode, form):
        if mode in self.rows:
            self.rows[mode][0].form_removed(form)

    def toggle(self, on):
        from .live.layers import LocalLayers
        if on and not self.built:
            self.build()
        self.body.setVisible(on)
        if on:
            self.prefetch()
            self.apply_all()
        else:
            # The rows keep their boxes: checking the box again brings the
            # same layers back.
            ll = LocalLayers()
            g = ll.group()
            if g is not None:
                self.dock.removing.update(n.layerId() for n in g.findLayers())
            ll.remove_all()


class TerrainViewerDock(QDockWidget):
    def __init__(self, canvas=None, parent=None, message_bar=None):
        super().__init__("Terrain Viewer", parent)
        self.setObjectName("TerrainViewerDock")
        self.canvas = canvas
        self.message_bar = message_bar  # QGIS's message bar (iface.messageBar()), None in the tests
        self.warnings = []  # what warn() said, for the tests
        self.service_down = False
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
        self.health_timer = QTimer(self)
        self.health_timer.setInterval(HEALTH_EVERY_MS)
        self.health_timer.timeout.connect(self.check_health)
        self.health_reply = None
        # Layers this panel removes itself; any other removal (by hand in the
        # layer tree, a new project) unchecks the form it drew.
        self.removing = set()
        QgsProject.instance().layersWillBeRemoved.connect(self.layers_removed)

        s = QgsSettings()
        # 0.5.0 kept an Earthdata token for the local service here; a token
        # now lives in the service's environment only (EARTHDATA_TOKEN).
        if s.contains(f"{SETTINGS}/earthdataToken"):
            s.remove(f"{SETTINGS}/earthdataToken")
        body = QWidget()
        outer = QVBoxLayout(body)

        # Experimental, off by default, at the top: modes computed here with
        # numpy (live/), no tile service.
        self.local_section = LocalSection(self)
        self.local = self.local_section.check
        outer.addWidget(self.local_section.box)

        line = QHBoxLayout()
        self.url = QLineEdit(s.value(f"{SETTINGS}/service", DEFAULT_SERVICE))
        self.url.setPlaceholderText("Tile service, e.g. http://localhost:3400")
        self.url.returnPressed.connect(self.connect_service)
        go = QPushButton("Connect")
        go.clicked.connect(self.connect_service)
        line.addWidget(self.url, 1)
        line.addWidget(go)
        outer.addLayout(line)
        # The local tile service: downloaded on demand (Install), off by
        # default: checking "Local tile service" enables it, and Connect
        # starts it on this machine; it never starts on its own.
        self.bundled = None
        self.install_btn = None
        self.install_task = None
        if local_server.bundled() or local_server.installable():
            row = QHBoxLayout()
            self.bundled = QCheckBox("Local tile service")
            self.bundled.setChecked(str(s.value(f"{SETTINGS}/bundled", "false")).lower() in ("1", "true"))
            self.bundled.toggled.connect(self.bundled_toggled)
            row.addWidget(self.bundled, 1)
            self.install_btn = QPushButton()
            self.install_btn.clicked.connect(self.install_clicked)
            row.addWidget(self.install_btn)
            outer.addLayout(row)
        self.status = QLabel("Not connected")
        self.status.setWordWrap(True)
        outer.addWidget(self.status)
        self.refresh_service_row()

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

    def toggle_local(self, on):
        self.local_section.toggle(on)

    def layers_removed(self, ids):
        """Layers about to leave the project: the panel's own removals are
        expected; any other unchecks the form whose layer it was."""
        project = QgsProject.instance()
        for lid in ids:
            if lid in self.removing:
                self.removing.discard(lid)
                continue
            layer = project.mapLayer(lid)
            if layer is None:
                continue
            key = layer.customProperty(PROP)
            if key and key.split(":")[0] in self.rows:
                self.rows[key.split(":")[0]].row.form_removed(ModeRow.form_of(key))
            local = layer.customProperty("terrain_viewer/local_mode")
            if local and self.local_section.built:
                from .live.layers import _mode_form
                self.local_section.form_removed(*_mode_form(layer))

    def cleanup(self):
        """Disconnected from the project (the plugin unloading)."""
        try:
            QgsProject.instance().layersWillBeRemoved.disconnect(self.layers_removed)
        except (TypeError, RuntimeError):
            pass
        self.health_timer.stop()

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

    def use_bundled(self):
        return self.bundled is not None and self.bundled.isChecked() and local_server.bundled()

    # -- installing the local service -------------------------------------
    def refresh_service_row(self):
        """The box enabled once a service is installed; the button installs it, or removes it."""
        if self.bundled is None:
            return
        have = local_server.bundled()
        info = local_server.bundle_info() if have else {}
        self.bundled.setEnabled(have)
        self.url.setEnabled(not (have and self.bundled.isChecked()))
        legacy = have and local_server.current_dir() == local_server.LEGACY_DIR
        if have:
            self.bundled.setToolTip(f"The local tile service (Node {info.get('node', '?')}, {info.get('platform', '')}, built "
                                    f"{info.get('built', '?')}, in {local_server.current_dir()}): when checked, Connect starts "
                                    "it on this machine (127.0.0.1); unchecking it or quitting QGIS stops it. Unchecked, the "
                                    "panel connects to the address above (e.g. the Terrain Viewer desktop app's tile service, "
                                    "http://localhost:3400)")
        else:
            self.bundled.setToolTip("Install the local tile service first (the button on the right)")
        self.install_btn.setVisible(not legacy)
        if have:
            self.install_btn.setText("Remove")
            self.install_btn.setToolTip("Delete the downloaded tile service")
            return
        try:
            from .service_install import asset
            size = asset()[3]
        except Exception:  # noqa: BLE001 - nothing pinned for this platform
            size = 0
        p = local_server.pins()
        self.install_btn.setText("Install" + (f" ({size / 1e6:.0f} MB)" if size else ""))
        self.install_btn.setToolTip(f"Install the local tile service: download it for {local_server.platform_label()} "
                                    f"(Node, the service, its image libraries) from the GitHub release "
                                    f"{p.get('release', '?')}, check its sha256, unpack it into {local_server.installed_dir()}")

    def install_clicked(self):
        if local_server.bundled():
            from .service_install import uninstall
            self.bundled.setChecked(False)
            uninstall()
            self.status.setText("Local tile service removed")
            self.refresh_service_row()
        else:
            self.install_service()

    def install_service(self, wait=False, fetch=None):
        """Downloads and unpacks the pinned service, in a QgsTask (wait: in
        this thread, for the tests). Returns True when installed (wait) or
        started (no wait)."""
        from .service_install import InstallError, install
        self.install_btn.setEnabled(False)
        self.status.setText("Downloading the local tile service...")

        def done(error, where=None):
            self.install_btn.setEnabled(True)
            self.install_task = None
            if error:
                self.warn(f"The local tile service was not installed: {error}")
            else:
                self.status.setText(f"Local tile service installed in {where}: check Local tile service and press Connect")
            self.refresh_service_row()

        if wait:
            try:
                where = install(fetch=fetch)
            except (InstallError, OSError) as e:
                done(e)
                return False
            done(None, where)
            return True
        from qgis.core import QgsApplication, QgsTask

        def run(task):
            def progress(n, total):
                if total > 0:
                    task.setProgress(100.0 * n / total)
            return install(progress=progress, fetch=fetch)

        def finished(exception, result=None):
            done(exception, result)
        self.install_task = QgsTask.fromFunction("Installing the Terrain Viewer tile service", run, on_finished=finished)
        self.install_task.progressChanged.connect(lambda v: self.status.setText(f"Downloading the local tile service... {v:.0f} %"))
        QgsApplication.taskManager().addTask(self.install_task)
        return True

    def bundled_toggled(self, on):
        QgsSettings().setValue(f"{SETTINGS}/bundled", "true" if on else "false")
        self.url.setEnabled(not on)
        self.health_timer.stop()
        if on:
            self.status.setText("Local tile service enabled: press Connect to start it")
        else:
            local_server.stop_instance()
            self.url.setText(QgsSettings().value(f"{SETTINGS}/service", DEFAULT_SERVICE))
            self.status.setText("Local tile service stopped: press Connect to use the address above")

    def start_bundled(self):
        """The bundled service's address, started if needed; None (and the
        reason in the status line) when it does not start."""
        server = local_server.instance()
        if not server.running():
            self.status.setText("Starting the local tile service...")
            QApplication.processEvents()
        try:
            url = server.start()
        except RuntimeError as e:
            self.status.setText(f"The local tile service did not start: {e} (log: {server.log_path})")
            return None
        self.url.setText(url)
        return url

    def warn(self, text):
        """A warning in the panel's status line and in QGIS's message bar."""
        self.warnings.append(text)
        self.status.setText("⚠ " + text)
        if self.message_bar is not None:
            self.message_bar.pushMessage("Terrain Viewer", text, Qgis.MessageLevel.Warning, 15)

    def unresponsive(self, base, error):
        server = local_server.instance() if self.bundled is not None else None
        return unresponsive_message(base, error, bundled_available=self.bundled is not None, bundled_on=self.use_bundled(),
                                    bundled_status=server.status() if server is not None else "")

    def connect_service(self, start_bundled=True):
        """Connect to the service: the bundled one, started now (unless
        start_bundled is False: the panel opening never starts it, only
        Connect does), or the address typed."""
        self.health_timer.stop()
        bundled = self.use_bundled()
        if bundled and not local_server.instance().running():
            if not start_bundled:
                self.status.setText("Local tile service enabled: press Connect to start it")
                return False
            if self.start_bundled() is None:
                self.warnings.append(self.status.text())
                if self.message_bar is not None:
                    self.message_bar.pushMessage("Terrain Viewer", self.status.text(), Qgis.MessageLevel.Warning, 15)
                return False
        elif bundled:
            self.url.setText(local_server.instance().url)
        base = self.service_url()
        try:
            self.catalog = Catalog(base)
        except ServiceError as e:
            self.service_down = True
            self.warn(self.unresponsive(base, e))
            return False
        self.service_down = False
        if not bundled:
            QgsSettings().setValue(f"{SETTINGS}/service", base)
        self.stack.ranks = tree_ranks(self.catalog.tree)
        self.build()
        counts = f"{len(self.catalog.sources)} sources, {len(self.catalog.modes)} modes"
        self.status.setText(f"{counts}. {local_server.instance().status()}" if bundled else f"{counts} from {base}")
        self.adopt_existing()
        if bundled:
            # The bundled service may be on another port than when the project
            # was saved: the layers' addresses follow it.
            self.schedule_all()
        self.health_timer.start()
        return True

    # -- is it still there? ---------------------------------------------------
    def check_health(self):
        """Ask /health without blocking QGIS; a failure after a working
        connection is warned about once, and its return said too."""
        if self.health_reply is not None:
            return
        base = self.service_url()
        request = QNetworkRequest(QUrl(f"{base}/health"))
        request.setTransferTimeout(5000)
        reply = QgsNetworkAccessManager.instance().get(request)
        self.health_reply = reply

        def done():
            self.health_reply = None
            ok = reply.error() == QNetworkReply.NetworkError.NoError
            error = reply.errorString()
            reply.deleteLater()
            self.health_result(base, ok, error)
        reply.finished.connect(done)

    def health_result(self, base, ok, error=""):
        if base != self.service_url():
            return
        if not ok and not self.service_down:
            self.service_down = True
            self.warn(self.unresponsive(base, error))
        elif ok and self.service_down:
            self.service_down = False
            self.status.setText(f"The tile service at {base} answers again")

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
        # relief, lighting, overlays); /processes is top of the map first, so
        # the panel lists it reversed (the layer tree keeps the map's order).
        for g in reversed(self.catalog.tree):
            add_group(g, self.groups_layout, ())
        self.groups_layout.addStretch(1)

    def adopt_existing(self):
        """The layers this panel wrote earlier (a saved project): their
        checkboxes and settings read back from their addresses."""
        for key, row in self.rows.items():
            present = set()
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
                # A layer in the project is a checked form (hidden or not:
                # its visibility is the layer tree's).
                present.add(ModeRow.form_of(k))
                if q.get("terrainSource"):
                    i = self.source.findData(q["terrainSource"])
                    self.source.blockSignals(True)
                    if i >= 0:
                        self.source.setCurrentIndex(i)
                    else:
                        self.source.setEditText(q["terrainSource"])
                    self.source.blockSignals(False)
            row.row.set_forms(present)

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
            row.row.set_forms((row.row.checked_forms() or {row.row.default_form()}) if mode_id in active else set())
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
