"""The panel: a backend picked at the top (the local tile service installed
from the panel, a remote tile service, or the experimental Python compute),
its options under it, then the terrain source, the keys, a share link, the
light, and the app's sidebar groups as one modes tree for every backend.

The tree comes from the tile service's /processes (or, before a service
answers and for the Python backend, from the snapshot the plugin carries,
assets/catalog.json), so a mode or setting added to the app shows up with no
plugin release. Each checked mode is a layer of the project whose address
the panel writes; a changed setting rewrites that address. Under the Python
backend, the modes it does not compute are greyed out, and so are the
settings it ignores."""
import math
import time
from urllib.parse import urlsplit, parse_qsl

from qgis.PyQt.QtCore import Qt, QTimer, QUrl, QSize
from qgis.PyQt.QtGui import QColor
from qgis.PyQt.QtNetwork import QNetworkRequest, QNetworkReply
from qgis.PyQt.QtWidgets import (
    QApplication, QDockWidget, QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel, QLineEdit, QPushButton,
    QComboBox, QCheckBox, QDoubleSpinBox, QSpinBox, QScrollArea, QToolButton, QFrame, QGroupBox, QSizePolicy,
    QStackedWidget,
)
from qgis.core import (
    Qgis, QgsApplication, QgsNetworkAccessManager, QgsSettings, QgsCoordinateReferenceSystem, QgsRectangle,
    QgsDataSourceUri, QgsCoordinateTransform, QgsProject, QgsVectorLayer,
)

try:
    from qgis.gui import QgsCollapsibleGroupBox as GroupBox
except ImportError:  # pragma: no cover
    GroupBox = QGroupBox
try:
    from qgis.gui import QgsOpacityWidget
except ImportError:  # pragma: no cover
    QgsOpacityWidget = None
try:
    from qgis.gui import QgsColorButton
except ImportError:  # pragma: no cover
    QgsColorButton = None

from .service import (
    Catalog, ServiceError, tile_url, values_url, split_link, query_dict, KEY_PARAMS, ALL_KEYS, unresponsive_message,
    health, health_request, link_params,
)
from .layers import LayerStack, PROP, BACKEND_PROP, tree_ranks
from . import local_server, assets
from . import python_backend as pyb
from .settings_ui import (
    LIGHT_KEYS, LIGHT_DEFAULT, LIGHT_MODES, slider_range, symmetric_pairs, is_ramp_key, is_matcap_key, is_colour_key,
    clean_enum,
)
from .widgets import SliderSpin, LightPad, IconCombo, FoldSection, Segmented

SETTINGS = "terrain_viewer"
DEFAULT_SERVICE = "http://localhost:3400"
WORLD = 20037508.342789244
# While connected, the service's /health is asked this often (in the
# background), so a service that went away (the desktop app closed) is
# reported instead of leaving empty layers.
HEALTH_EVERY_MS = 15000
# The deepest zoom of the Python backend's colour tiles (Mapterhorn's 512 px
# tiles go to z17, so 256 px tiles to z18).
PY_XYZ_ZMAX = 18
BACKENDS = (
    ("local", "Local service",
     "The tile service packaged for QGIS (Node and the service, about 50 MB): installed from the panel the first time, "
     "started on this machine (127.0.0.1) when you connect, stopped when QGIS quits. Every mode and source."),
    ("remote", "Remote service",
     "A tile service at an address: the Terrain Viewer desktop app's (http://localhost:3400), one you run yourself "
     "(cd tile-server && pnpm start), or a hosted one. Every mode and source."),
    ("python", "Python",
     "Experimental: the modes computed in QGIS's own Python with numpy, no tile service at all. Fast, but not every "
     "mode, setting or source (Terrarium and Terrain-RGB tiles only)."),
)


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


def _theme_icon(*names):
    for n in names:
        icon = QgsApplication.getThemeIcon(n)
        if icon is not None and not icon.isNull():
            return icon
    return None


class SettingWidget:
    """One setting: a widget chosen by its type and name (a slider with its
    number box, a ramp or matcap select with previews, a colour button),
    read and written as the URL value."""

    def __init__(self, spec, dock, on_change):
        self.spec = spec
        t, key = spec["type"], spec["key"]
        d = spec.get("default")
        self.tooltip = spec.get("note") or ""
        if t == "boolean":
            w = QCheckBox()
            w.setChecked(bool(d))
            w.toggled.connect(on_change)
            self.get, self.set = w.isChecked, lambda v: w.setChecked(str(v).lower() in ("1", "true", "yes"))
        elif is_ramp_key(key):
            w = IconCombo(dock.ramp_items(), d)
            w.currentIndexChanged.connect(on_change)
            self.get, self.set = w.get, w.set
        elif is_matcap_key(key):
            items, default = assets.matcaps()
            w = IconCombo([(i, n, assets.matcap_icon(i)) for i, n in items], d or default, icon_size=QSize(22, 22))
            w.currentIndexChanged.connect(on_change)
            self.get, self.set = w.get, w.set
        elif t == "enum" or spec.get("enum"):
            w = QComboBox()
            items = clean_enum(spec.get("enum"))
            if d is not None and str(d) not in items:
                items.insert(0, str(d))
            w.addItems(items)
            if d is not None:
                w.setCurrentText(str(d))
            w.currentTextChanged.connect(on_change)
            self.get, self.set = w.currentText, lambda v: w.setCurrentText(str(v))
        elif t in ("number", "integer"):
            integer = t == "integer"
            r = slider_range(key, d, spec.get("minimum"), spec.get("maximum"))
            if r is not None:
                lo, hi, step, hard_lo, hard_hi = r
                w = SliderSpin(lo, hi, 1 if integer else step, d if isinstance(d, (int, float)) else lo, integer,
                               hard=(hard_lo, hard_hi))
                w.valueChanged.connect(on_change)
                # Set from a link or a script: the layer follows, as when typed.
                self.get, self.set = w.value, lambda v: w.setValue(v, emit=True)
            else:
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
        elif is_colour_key(key, t) and QgsColorButton is not None:
            w = QgsColorButton()
            w.setColor(QColor(str(d or "#000000")))
            w.colorChanged.connect(on_change)
            # The default as written (#FFFFFF), so an unchanged colour stays
            # out of the address.
            self.get = lambda: str(d) if d and QColor(str(d)) == w.color() else w.color().name()
            self.set = lambda v: w.setColor(QColor(str(v)))
        else:
            w = QLineEdit(str(d) if d is not None else "")
            w.editingFinished.connect(on_change)
            self.get, self.set = w.text, lambda v: w.setText(str(v))
        if self.tooltip:
            w.setToolTip(self.tooltip)
        # The panel stays as narrow as the dock: long ramp names elide.
        w.setMinimumWidth(60)
        if isinstance(w, QComboBox) and not isinstance(w, IconCombo):
            w.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
            w.setMinimumContentsLength(8)
        self.widget = w

    def set_available(self, ok, why=""):
        self.widget.setEnabled(ok)
        self.widget.setToolTip(self.tooltip if ok else why)


FORM_LABELS = {"colour": "Colour", "values": "Values", "vector": "Vector"}
DRAWN_FORMS = ("colour", "vector")  # the forms whose look the settings change


def _retain_hidden(w):
    """A hidden widget keeps its room in the layout."""
    sp = w.sizePolicy()
    sp.setRetainSizeWhenHidden(True)
    w.setSizePolicy(sp)


class _RowHeader(QWidget):
    """A mode's line: a click anywhere on it (not on one of its boxes or
    buttons, which take their own clicks) toggles the mode."""

    def __init__(self, on_click):
        super().__init__()
        self.on_click = on_click

    def mouseReleaseEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton and self.isEnabled():
            self.on_click()
        super().mouseReleaseEvent(e)


class FormsRow:
    """A mode's row: its checkbox on the left, its forms on the right
    (Colour: the coloured layer; Values: the numbers, a Float32 raster;
    Vector: the overlay's features), each a layer of the project, and a
    settings cog shown while a drawn form (Colour, Vector) is on; the
    settings fold under the row.

    Checking the mode turns on the forms it had (the default form the first
    time: Vector for the overlays that have one, else Colour); unchecking it
    turns them all off (each layer removed) and remembers them. Checking a
    form checks the mode; unchecking the last one unchecks it. A backend
    that lacks a form hides its box (set_available). `on_change()` is called
    after every change by the user; set_forms() changes the boxes without
    calling it (a layer removed from the project, a saved project read
    back)."""

    def __init__(self, label, forms, on_change, tooltips=None):
        self.on_change = on_change
        self.box = QWidget()
        lay = QVBoxLayout(self.box)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        self.header = _RowHeader(self._clicked)
        head = QHBoxLayout(self.header)
        head.setContentsMargins(0, 0, 0, 0)
        head.setSpacing(4)
        self.check = QCheckBox(label)
        self.check.setMinimumWidth(40)  # long names elide rather than widen the panel
        self.check.toggled.connect(self._mode_toggled)
        head.addWidget(self.check, 1)
        self.forms = {}
        # Two columns, so the boxes line up from row to row (an empty slot
        # keeps its width): Vector then Raster for the overlays, Colour then
        # Values for the others. The cog keeps its place when hidden.
        slots = [f for f in (("vector", "colour") if "vector" in forms else ("colour", "values")) if f in forms]
        while len(slots) < 2:
            slots.append(None)
        for f in slots:
            text = FORM_LABELS[f] if f else FORM_LABELS["values"]
            if f == "colour" and "vector" in forms:
                text = "Raster"
            cb = QCheckBox(text)
            _retain_hidden(cb)
            if f is None:
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
        lay.addWidget(self.header)
        self.panel = QFrame()
        self.form_layout = QFormLayout(self.panel)
        self.form_layout.setContentsMargins(18, 0, 0, 6)
        lay.addWidget(self.panel)
        self.more.toggled.connect(lambda _on: self._sync())
        self.remembered = set()
        self.available = set(self.forms)
        self._sync()

    def _clicked(self):
        self.check.toggle()

    def default_form(self):
        return next((f for f in ("vector", "colour", "values") if f in self.available), None)

    def on(self, form):
        """Is this form wanted (its box checked, and offered by the backend)?"""
        return form in self.available and self.forms[form].isChecked()

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
            wanted = (self.remembered & self.available) or {self.default_form()} - {None}
            self._set_boxes(wanted, bool(wanted))
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
        if form in self.forms and self.forms[form].isChecked():
            self.set_forms(self.checked_forms() - {form})

    def set_available(self, forms):
        """The forms a backend offers: the others' boxes hidden (their state
        kept, for the backend that has them)."""
        self.available = set(forms) & set(self.forms)
        for f, cb in self.forms.items():
            cb.setVisible(f in self.available)
        self._sync()

    def set_enabled(self, ok, why=""):
        self.header.setEnabled(ok)
        self.check.setToolTip("" if ok else why)
        self.header.setToolTip("" if ok else why)
        if not ok:
            self.panel.setVisible(False)
        else:
            self._sync()

    def _sync(self):
        drawn = any(self.on(f) for f in DRAWN_FORMS)
        self.more.setVisible(drawn and self.form_layout.rowCount() > 0)
        self.panel.setVisible(drawn and self.more.isChecked() and self.header.isEnabled())


class ModeRow:
    """A mode of the tree: its forms (FormsRow), its opacity and settings
    under the cog, its layers under the backend connected."""

    def __init__(self, dock, path, mode):
        self.dock, self.path, self.mode = dock, path, mode
        forms = []
        tips = {}
        if mode.get("form") != "vector":
            forms.append("colour")
            tips["colour"] = "The mode as the app draws it: an XYZ layer of raster tiles"
        if mode.get("values"):
            forms.append("values")
            tips["values"] = (f"The values before the colour ramp, a Float32 raster read by GDAL, for analysis "
                              f"({mode['values'].get('unit')}): {mode['values'].get('description', '')}")
        if mode.get("vector"):
            forms.append("vector")
            tips["vector"] = "The features as vector tiles, styled in QGIS (sharp at every zoom, Identify)"
        self.all_forms = set(forms)
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
                self.opacity = QgsOpacityWidget()  # a slider and a % box
                self.opacity.setOpacity(1.0)
                self.opacity.opacityChanged.connect(lambda _v: self.apply_style())
            else:
                self.opacity = SliderSpin(0, 1, 0.05, 1.0, hard=(0, 1))
                self.opacity.valueChanged.connect(lambda _v: self.apply_style())
            form.addRow("Opacity", self.opacity)
        self.settings = {}
        for spec in mode.get("settings", []):
            if spec["key"] in LIGHT_KEYS:
                continue  # the panel's Light, shared by every shaded mode
            sw = SettingWidget(spec, dock, self.changed)
            self.settings[spec["key"]] = sw
            form.addRow(_label(spec["key"], mode["id"]), sw.widget)
        self.symmetric = symmetric_pairs(self.settings)
        for sym, (lo, hi) in self.symmetric.items():
            self.settings[sym].widget.toggled.connect(lambda _on, s=sym: self.mirror(s))
            w = self.settings[hi].widget
            (w.valueChanged if hasattr(w, "valueChanged") else w.textChanged).connect(lambda _v, s=sym: self.mirror(s))
            self.mirror(sym)
        self.py_auto_range = None
        self.row._sync()

    # values ---------------------------------------------------------------
    def mirror(self, sym):
        """Symmetric on: the minimum follows the maximum (min = -max), live,
        and is read only; off: both editable."""
        lo, hi = self.symmetric[sym]
        on = bool(self.settings[sym].get())
        w = self.settings[lo].widget
        if hasattr(w, "setReadOnly"):
            w.setReadOnly(on)
        if on:
            try:
                v = -abs(float(self.settings[hi].get()))
            except (TypeError, ValueError):
                return
            if hasattr(w, "setValue"):
                w.blockSignals(True)
                w.setValue(v)
                w.blockSignals(False)

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
        for sym in self.symmetric:
            self.mirror(sym)

    # the backend ------------------------------------------------------------
    def apply_backend(self, backend):
        """Greys out what the backend does not draw: under Python, the modes
        live/ does not compute, the forms it lacks, the settings it ignores."""
        if backend != "python":
            self.row.set_enabled(True)
            self.row.set_available(self.all_forms)
            for sw in self.settings.values():
                sw.set_available(True)
            return
        reg = pyb.registry()
        py = pyb.py_mode(self.mode["id"], None, reg) if reg else None
        if py is None:
            self.row.set_enabled(False, "Not computed by the Python backend (yet): pick Local or Remote service at the "
                                        "top of the panel for this mode")
            return
        self.row.set_enabled(True)
        self.row.set_available(pyb.py_forms(self.mode["id"], self.all_forms, reg))
        ignored = pyb.unsupported_settings(self.mode["id"], self.settings, reg)
        for k, sw in self.settings.items():
            sw.set_available(k not in ignored, "Not used by the Python backend")

    # layers ---------------------------------------------------------------
    def changed(self, *_):
        self.py_auto_range = None
        self.dock.schedule(self)

    @staticmethod
    def form_of(key):
        return "values" if key.endswith(":values") else "vector" if key.endswith(":vector") else "colour"

    def keys(self):
        """The layer key of each form of this mode."""
        out = {}
        if "colour" in self.all_forms:
            out["colour"] = self.mode["id"]
        if "values" in self.all_forms:
            out["values"] = self.mode["id"] + ":values"
        if "vector" in self.all_forms:
            out["vector"] = self.mode["id"] + ":vector"
        return out

    def urls(self):
        base, common = self.dock.service_url(), self.dock.common_params(self.mode["id"])
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
        or removed (unchecked), under the backend connected; nothing while
        none is (no layer asks a service that is not there)."""
        if not self.dock.connected:
            return
        if self.dock.connected == "python":
            self.update_python()
        else:
            self.update_service()

    def update_service(self):
        stack = self.dock.stack
        for key, (url, vector) in self.urls().items():
            want = self.row.on(self.form_of(key))
            if not want:
                self.dock.remove_layers(key)
                continue
            new = stack.find(key) is None
            if vector == "values":
                unit = self.mode["values"].get("unit")
                layer = stack.ensure_values(key, f"{self.mode['name']} (values{', ' + unit if unit and unit != '1' else ''})",
                                            self.path, url, self.mode["values"].get("range"), backend="service")
            else:
                name = self.mode["name"] + (" (vector tiles)" if vector and self.mode.get("form") != "vector" else "")
                layer = stack.ensure(key, name, self.path, url, vector, self.mode["id"], self.values(), backend="service")
                if new:
                    stack.style(layer, self.opacity_value(), self.mode.get("shading") and not vector)
            if new:
                stack.set_visible(layer, True)

    def update_python(self):
        from .live.layers import apply_renderer, LocalLayers, elevation_range
        dock, stack = self.dock, self.dock.stack
        reg = pyb.registry() or {}
        values = self.values()
        py, opts = pyb.py_opts(self.mode["id"], values, dock.light_value(), reg)
        keys = self.keys()
        if py is None or not self.row.header.isEnabled():
            for key in keys.values():
                dock.remove_layers(key)
            return
        spec = reg[py]
        sid = dock.python_source()
        srv = dock.live_server()
        ext, width = dock.canvas_extent()
        rng = None
        if py == "elevation":
            # The app's 0 to 8100 m default is far too wide for one view: the
            # view's own range (2nd to 98th percentile), as hypsoAutoRange.
            d = {s["key"]: s.get("default") for s in self.mode.get("settings", [])}
            if values.get("minElevation") == d.get("minElevation") and values.get("maxElevation") == d.get("maxElevation"):
                if self.py_auto_range is None and ext is not None:
                    self.py_auto_range = elevation_range(ext, width, sid)
                rng = self.py_auto_range
            else:
                rng = (float(values.get("minElevation", 0)), float(values.get("maxElevation", 4000)))
            if rng:
                opts.update({"min": float(rng[0]), "max": float(rng[1])})
        for form, key in keys.items():
            if not self.row.on(form):
                dock.remove_layers(key)
                continue
            new = stack.find(key) is None
            if form == "colour":
                layer = stack.ensure(key, self.mode["name"], self.path, srv.xyz_url(py, opts, source=sid), False,
                                     zmax=PY_XYZ_ZMAX, backend="python")
                if new:
                    stack.style(layer, self.opacity_value(), spec.get("kind") == "shade")
            elif form == "values":
                vopts = {k: v for k, v in opts.items() if k not in spec.get("colour_only", ())}
                unit = spec.get("unit")
                layer = stack.ensure_values(key, f"{self.mode['name']} (values{', ' + unit if unit else ''})", self.path,
                                            srv.gdal_xml(py, vopts, source=sid), None, backend="python")
                if new and layer is not None and layer.isValid():
                    apply_renderer(layer, py, rng)
            else:
                layer = stack.find(key)
                if layer is not None and layer.providerType() != "memory":
                    dock.remove_layers(key, prune=False)
                    layer = None
                if layer is None:
                    from .live.layers import vector_layer, vector_noun
                    layer = vector_layer(py, f"{self.mode['name']} ({vector_noun(py)})", opts)
                    stack.add_layer(layer, key, self.path, "python")
                elif not new:
                    from .live.layers import style_vector
                    style_vector(layer, py, opts)  # a colour or width setting changed
                LocalLayers(stack.project).refresh_vector(layer, opts, ext, width, source=sid, mode=py)
            if new and layer is not None:
                stack.set_visible(layer, True)

    def apply_style(self):
        for form, key in self.keys().items():
            if form == "values":
                continue
            layer = self.dock.stack.find(key)
            if layer is None:
                continue
            shading = self.mode.get("shading") and form != "vector"
            self.dock.stack.style(layer, self.opacity_value(), shading)


class TerrainViewerDock(QDockWidget):
    def __init__(self, canvas=None, parent=None, message_bar=None):
        super().__init__("Terrain Viewer", parent)
        self.setObjectName("TerrainViewerDock")
        self.canvas = canvas
        self.message_bar = message_bar  # QGIS's message bar (iface.messageBar()), None in the tests
        self.warnings = []  # what warn() said, for the tests
        self.service_down = False
        self.catalog = None
        self.connected = None  # None, "local", "remote" or "python"
        self.base = None  # the service connected to
        self.rows = {}
        self.stack = LayerStack()
        self.extra = {}  # a share link's other parameters, kept in every address
        self.camera = None  # the last share link's (lat, lng, zoom), when there is no canvas
        self.pending = set()
        self.adopted = False
        self._py_sources = {}
        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(500)
        self.timer.timeout.connect(self.flush)
        self.health_timer = QTimer(self)
        self.health_timer.setInterval(HEALTH_EVERY_MS)
        self.health_timer.timeout.connect(self.check_health)
        self.health_reply = None
        # The Python backend: elevation fetched ahead, contour lines
        # recomputed once the canvas stops.
        self.prefetch_timer = QTimer(self)
        self.prefetch_timer.setSingleShot(True)
        self.prefetch_timer.setInterval(150)
        self.prefetch_timer.timeout.connect(self.prefetch)
        self.vector_timer = QTimer(self)
        self.vector_timer.setSingleShot(True)
        self.vector_timer.setInterval(400)
        self.vector_timer.timeout.connect(self.refresh_vectors)
        if canvas is not None:
            canvas.extentsChanged.connect(self.extent_changed)
        # Layers this panel removes itself; any other removal (by hand in the
        # layer tree, a new project) unchecks the form it drew.
        self.removing = set()
        QgsProject.instance().layersWillBeRemoved.connect(self.layers_removed)
        self.install_task = None

        s = QgsSettings()
        # 0.5.0 kept an Earthdata token for the local service here; a token
        # now lives in the service's environment only (EARTHDATA_TOKEN).
        if s.contains(f"{SETTINGS}/earthdataToken"):
            s.remove(f"{SETTINGS}/earthdataToken")
        backend = s.value(f"{SETTINGS}/backend", "")
        if backend not in ("local", "remote", "python"):
            # 0.6.0 had a "Local tile service" box.
            backend = "local" if str(s.value(f"{SETTINGS}/bundled", "false")).lower() in ("1", "true") else "remote"
        self.backend = backend

        body = QWidget()
        outer = QVBoxLayout(body)

        # -- the backend, and its options -----------------------------------
        self.backend_picker = Segmented([(i, label, tip) for i, label, tip in BACKENDS], backend)
        outer.addWidget(self.backend_picker)
        self.pages = QStackedWidget()
        self.pages.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Maximum)
        # Local service
        local = QWidget()
        ll = QVBoxLayout(local)
        ll.setContentsMargins(0, 0, 0, 0)
        self.local_info = QLabel()
        self.local_info.setWordWrap(True)
        ll.addWidget(self.local_info)
        row = QHBoxLayout()
        self.install_btn = QPushButton()
        self.install_btn.clicked.connect(lambda _checked=False: self.install_clicked())
        row.addWidget(self.install_btn)
        row.addStretch(1)
        self.local_connect = QPushButton("Connect")
        self.local_connect.setToolTip("Install the service if needed, start it on this machine, connect")
        self.local_connect.clicked.connect(lambda _checked=False: self.connect_service())
        row.addWidget(self.local_connect)
        ll.addLayout(row)
        self.pages.addWidget(local)
        # Remote service
        remote = QWidget()
        rl = QHBoxLayout(remote)
        rl.setContentsMargins(0, 0, 0, 0)
        self.url = QLineEdit(s.value(f"{SETTINGS}/service", DEFAULT_SERVICE))
        self.url.setPlaceholderText("Tile service, e.g. http://localhost:3400")
        self.url.setToolTip("The address of a tile service: the desktop app's (http://localhost:3400), one of your own "
                            "on this machine or another, or a hosted one")
        self.url.returnPressed.connect(lambda: self.connect_service())
        go = QPushButton("Connect")
        go.clicked.connect(lambda _checked=False: self.connect_service())
        rl.addWidget(self.url, 1)
        rl.addWidget(go)
        self.pages.addWidget(remote)
        # Python
        python = QWidget()
        pl = QHBoxLayout(python)
        pl.setContentsMargins(0, 0, 0, 0)
        self.python_info = QLabel("Computed in QGIS with numpy, from Terrarium or Terrain-RGB tiles. The modes it does "
                                  "not compute are greyed out.")
        self.python_info.setWordWrap(True)
        pl.addWidget(self.python_info, 1)
        py_go = QPushButton("Connect")
        py_go.setToolTip("Start the Python backend (a server thread of QGIS on 127.0.0.1)")
        py_go.clicked.connect(lambda _checked=False: self.connect_service())
        pl.addWidget(py_go)
        self.pages.addWidget(python)
        outer.addWidget(self.pages)
        self.backend_picker.changed.connect(self.set_backend)

        self.status = QLabel("Not connected")
        self.status.setWordWrap(True)
        outer.addWidget(self.status)

        # -- the source, with zoom-to -----------------------------------------
        src = QHBoxLayout()
        src.addWidget(QLabel("Source"))
        self.source = QComboBox()
        self.source.setEditable(True)
        self.source.setMinimumWidth(60)
        self.source.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.source.setMinimumContentsLength(10)
        self.source.setToolTip("An id from the service's /sources, or the address of Terrarium tiles, a COG or a VRT")
        self.source.currentTextChanged.connect(lambda _t: self.source_changed())
        src.addWidget(self.source, 1)
        self.zoom_btn = QToolButton()
        icon = _theme_icon("/mActionZoomToLayer.svg", "/mActionZoomFullExtent.svg")
        if icon is not None:
            self.zoom_btn.setIcon(icon)
        else:
            self.zoom_btn.setText("Zoom")
        self.zoom_btn.setToolTip("Zoom the map to the source's extent")
        self.zoom_btn.clicked.connect(lambda _checked=False: self.zoom_to_source())
        src.addWidget(self.zoom_btn)
        outer.addLayout(src)

        # -- the keys, folded behind a key ------------------------------------
        self.keys_section = FoldSection("API keys", _theme_icon("/locked.svg", "/mIconLock.svg", "/mActionLock.svg"))
        kform = QFormLayout()
        kform.setContentsMargins(0, 0, 0, 0)
        self.keys = {}
        for k, label in ALL_KEYS:
            e = QLineEdit(s.value(f"{SETTINGS}/{k}", ""))
            e.setEchoMode(QLineEdit.EchoMode.Password)
            sent = k in KEY_PARAMS
            e.setPlaceholderText("only for the sources that need it" if sent else "kept; no source needs it yet")
            e.setToolTip(f"{label} key ({k}): " + ("sent to the tile service with each tile of a source that needs it, "
                                                   "and used by the Python backend for that source" if sent else
                                                   "stored in QGIS's settings for the app's sources that will need it"))
            e.editingFinished.connect(self.keys_changed)
            self.keys[k] = e
            kform.addRow(label, e)
        self.keys_section.body_layout.addLayout(kform)
        outer.addWidget(self.keys_section)

        # -- a share link, freeze ---------------------------------------------
        link = QHBoxLayout()
        self.link = QLineEdit()
        self.link.setPlaceholderText("Paste a share link, or its query")
        self.link.setToolTip("A Terrain Viewer share link (https://terrain-viewer.iconem.com/?...) or just its query "
                             "(zoom=12&lat=...): its modes, settings, source and camera")
        self.link.returnPressed.connect(lambda: self.open_link())
        open_btn = QPushButton("Open link")
        open_btn.clicked.connect(lambda _checked=False: self.open_link())
        link.addWidget(self.link, 1)
        link.addWidget(open_btn)
        outer.addLayout(link)

        freeze = QHBoxLayout()
        freeze_btn = QPushButton("Freeze")
        freeze_btn.setToolTip("Copy the layers drawn now from the \"Terrain Viewer (live)\" group into a new dated "
                              "group under it, every setting kept in their addresses; the panel never changes the copies")
        freeze_btn.clicked.connect(lambda _checked=False: self.freeze())
        freeze.addStretch(1)
        freeze.addWidget(freeze_btn)
        outer.addLayout(freeze)
        self.freeze_btn = freeze_btn

        # -- the light, shared by the shaded modes ----------------------------
        self.light_section = FoldSection("Light (hillshade, Phong, shadows)", None, open_=False)
        lrow = QHBoxLayout()
        self.light_pad = LightPad(*LIGHT_DEFAULT)
        lrow.addWidget(self.light_pad)
        lform = QFormLayout()
        self.light_az = SliderSpin(0, 360, 1, LIGHT_DEFAULT[0], hard=(0, 360))
        self.light_el = SliderSpin(0, 90, 1, LIGHT_DEFAULT[1], hard=(0, 90))
        lform.addRow("Azimuth", self.light_az)
        lform.addRow("Elevation", self.light_el)
        lrow.addLayout(lform, 1)
        self.light_section.body_layout.addLayout(lrow)
        self.light_pad.changed.connect(self._light_from_pad)
        self.light_az.valueChanged.connect(self._light_from_sliders)
        self.light_el.valueChanged.connect(self._light_from_sliders)
        outer.addWidget(self.light_section)

        # -- the modes ----------------------------------------------------------
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

        # The tree from the packaged snapshot until a service answers.
        snap = assets.catalog()
        if snap.get("tree"):
            self.catalog = Catalog(None, snapshot=snap)
            self.build()
        self.show_backend(backend)

    # -- the backend --------------------------------------------------------
    def show_backend(self, backend):
        self.pages.setCurrentIndex([b[0] for b in BACKENDS].index(backend))
        self.refresh_service_row()
        for row in self.rows.values():
            row.apply_backend(backend)

    def set_backend(self, backend, connect=True):
        """Another backend picked: the one before disconnected (the local
        service stopped), the tree greyed for it, and connected (the layers
        of the checked modes re-pointed to it)."""
        if backend not in ("local", "remote", "python"):
            return
        if self.backend_picker.current() != backend:
            self.backend_picker.set(backend, emit=False)
        previous, self.backend = self.backend, backend
        QgsSettings().setValue(f"{SETTINGS}/backend", backend)
        self.health_timer.stop()
        if previous == "local" and backend != "local":
            local_server.stop_instance()
        if self.connected and self.connected != backend:
            self.connected = None
            self.status.setText("Not connected")
        self.show_backend(backend)
        if connect:
            if backend == "local" and not local_server.bundled():
                # A 50 MB download waits for Connect, not for a click on the backend.
                self.status.setText("Local tile service not installed yet: Connect downloads it, checks it and starts it")
                return
            self.connect_service()

    def refresh_service_row(self):
        """The local page: what is installed, Install or Remove."""
        have = local_server.bundled()
        info = local_server.bundle_info() if have else {}
        legacy = have and local_server.current_dir() == local_server.LEGACY_DIR
        self.install_btn.setVisible(not legacy and (have or local_server.installable()))
        if have:
            self.local_info.setText(f"Installed: Node {info.get('node', '?')}, {info.get('platform', '')}, built "
                                    f"{info.get('built', '?')}. Connect starts it on this machine; quitting QGIS stops it.")
            self.local_info.setToolTip(local_server.current_dir() or "")
            self.install_btn.setText("Remove")
            self.install_btn.setToolTip("Delete the downloaded tile service")
            return
        if not local_server.installable():
            self.local_info.setText(f"No tile service is packaged for this platform ({local_server.platform_label() or '?'}): "
                                    "use Remote service")
            return
        try:
            from .service_install import asset
            size = asset()[3]
        except Exception:  # noqa: BLE001 - nothing pinned for this platform
            size = 0
        p = local_server.pins()
        self.local_info.setText("Not installed yet: Connect downloads it" + (f" ({size / 1e6:.0f} MB)" if size else "")
                                + ", checks it and starts it.")
        self.install_btn.setText("Install" + (f" ({size / 1e6:.0f} MB)" if size else ""))
        self.install_btn.setToolTip(f"Install the local tile service: download it for {local_server.platform_label()} "
                                    f"(Node, the service, its image libraries) from the GitHub release "
                                    f"{p.get('release', '?')}, check its sha256, unpack it into {local_server.installed_dir()}")

    # -- installing the local service -------------------------------------
    def install_clicked(self):
        if local_server.bundled():
            from .service_install import uninstall
            if self.connected == "local":
                self.connected = None
            local_server.stop_instance()
            uninstall()
            self.status.setText("Local tile service removed")
            self.refresh_service_row()
        else:
            self.install_service()

    def install_service(self, wait=False, fetch=None, then=None):
        """Downloads and unpacks the pinned service, in a QgsTask (wait: in
        this thread, for the tests), then calls `then` when it worked.
        Returns True when installed (wait) or started (no wait)."""
        from .service_install import InstallError, install
        self.install_btn.setEnabled(False)
        self.local_connect.setEnabled(False)
        self.status.setText("Downloading the local tile service...")

        def done(error, where=None):
            self.install_btn.setEnabled(True)
            self.local_connect.setEnabled(True)
            self.install_task = None
            self.refresh_service_row()
            if error:
                self.warn(f"The local tile service was not installed: {error}")
                return
            self.status.setText(f"Local tile service installed in {where}")
            if then is not None:
                then()

        if wait:
            try:
                where = install(fetch=fetch)
            except (InstallError, OSError) as e:
                done(e)
                return False
            done(None, where)
            return True
        from qgis.core import QgsTask

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

    def start_bundled(self):
        """The local service's address, started if needed; None (and the
        reason in the status line) when it does not start."""
        server = local_server.instance()
        if not server.running():
            self.status.setText("Starting the local tile service...")
            QApplication.processEvents()
        try:
            return server.start()
        except RuntimeError as e:
            self.status.setText(f"The local tile service did not start: {e} (log: {server.log_path})")
            return None

    # -- messages -----------------------------------------------------------
    def warn(self, text):
        """A warning in the panel's status line and in QGIS's message bar."""
        self.warnings.append(text)
        self.status.setText("⚠ " + text)
        if self.message_bar is not None:
            self.message_bar.pushMessage("Terrain Viewer", text, Qgis.MessageLevel.Warning, 15)

    def unresponsive(self, base, error):
        server = local_server.instance()
        return unresponsive_message(base, error, bundled_available=local_server.bundled() or local_server.installable(),
                                    bundled_on=self.backend == "local", bundled_status=server.status())

    # -- connecting -----------------------------------------------------------
    def service_url(self):
        if self.connected in ("local", "remote") and self.base:
            return self.base
        return self.url.text().strip().rstrip("/")

    def connect_service(self, start_bundled=True):
        """Connect to the backend picked: the local service (installed first
        if needed, then started: unless start_bundled is False, the panel
        opening, which never starts anything), the address typed, or the
        Python backend. The service is asked /health first (3 s), so one
        that is not there is one message, not a timeout per tile."""
        self.health_timer.stop()
        backend = self.backend
        if backend == "python":
            if not start_bundled:
                self.status.setText("Python backend: press Connect to start it")
                return False
            return self.connect_python()
        if backend == "local":
            if not local_server.bundled():
                if not start_bundled:
                    self.status.setText("Local tile service not installed: Connect installs and starts it")
                    return False
                if not local_server.installable():
                    self.warn(f"No local tile service for this platform ({local_server.platform_label()}): pick Remote service")
                    return False
                self.install_service(then=lambda: self.connect_service())
                return False
            if not local_server.instance().running() and not start_bundled:
                self.status.setText("Local tile service: press Connect to start it")
                return False
            base = self.start_bundled()
            if base is None:
                self.warn(self.status.text())
                return False
        else:
            base = self.url.text().strip().rstrip("/")
            if not base:
                self.warn("Type the address of a tile service, e.g. http://localhost:3400")
                return False
        ok, error = health(base)
        if not ok:
            self.service_down = True
            self.connected = None
            self.warn(self.unresponsive(base, error))
            return False
        try:
            catalog = Catalog(base)
        except ServiceError as e:
            self.service_down = True
            self.connected = None
            self.warn(self.unresponsive(base, e))
            return False
        self.service_down = False
        self.catalog = catalog
        self.base = base
        self.connected = backend
        if backend == "remote":
            QgsSettings().setValue(f"{SETTINGS}/service", base)
        self.remove_legacy_local()
        self.stack.ranks = tree_ranks(self.catalog.tree)
        self.build()
        counts = f"{len(self.catalog.sources)} sources, {len(self.catalog.modes)} modes"
        self.status.setText(f"{counts}. {local_server.instance().status()}" if backend == "local" else f"{counts} from {base}")
        self.adopt_existing()
        # Every checked mode drawn by this service (the layers of another
        # backend, or of a local service on another port, re-pointed).
        self.schedule_all()
        self.health_timer.start()
        return True

    def connect_python(self):
        if pyb.numpy_missing():
            self.warn("The Python backend needs numpy, which this QGIS's Python lacks: pick Local or Remote service")
            return False
        try:
            self.live_server()
        except Exception as e:  # noqa: BLE001 - a port, a missing module
            self.warn(f"The Python backend did not start: {e}")
            return False
        if self.catalog is None:
            self.catalog = Catalog(None, snapshot=assets.catalog())
            self.build()
        self.connected = "python"
        self.base = None
        self.service_down = False
        self.remove_legacy_local()
        self.stack.ranks = tree_ranks(self.catalog.tree)
        for row in self.rows.values():
            row.apply_backend("python")
        self.adopt_existing()
        n = sum(1 for r in self.rows.values() if r.row.header.isEnabled())
        self._py_sources.clear()
        sid = self.python_source()
        self.status.setText(f"Python backend: {n} of {len(self.rows)} modes, elevation from {sid}")
        self.schedule_all()
        self.prefetch()
        return True

    def live_server(self):
        from .live.server import LiveServer
        from .live.layers import ramp_luts
        srv = LiveServer.instance()
        if not srv.luts:
            srv.luts = ramp_luts()
        return srv

    def remove_legacy_local(self):
        """0.6.0's "Terrain Viewer (local compute)" group: its layers drew
        the Python modes apart from the tree; the tree draws them now."""
        root = QgsProject.instance().layerTreeRoot()
        for g in root.findGroups(True):
            if g.customProperty("terrain_viewer/local_root"):
                ids = [n.layerId() for n in g.findLayers()]
                self.removing.update(ids)
                QgsProject.instance().removeMapLayers(ids)
                g.parent().removeChildNode(g)
                break

    def python_source(self):
        """live/'s id of the source picked, registered; Mapterhorn (and one
        warning) when live/ cannot read it."""
        src = self.current_source() or "mapterhorn"
        keys = self.key_values()
        cache_key = (src, tuple(sorted(keys.items())))
        if cache_key not in self._py_sources:
            sources = self.catalog.sources if self.catalog is not None else assets.catalog().get("sources", [])
            sid, why = pyb.source_spec(src, sources, keys)
            if sid is None:
                self.warn(f"{why}. The Python backend draws Mapterhorn instead.")
                sid = "mapterhorn"
            self._py_sources[cache_key] = sid
        return self._py_sources[cache_key]

    # -- is it still there? ---------------------------------------------------
    def check_health(self):
        """Ask /health without blocking QGIS; a failure after a working
        connection is warned about once, and its return said too."""
        if self.health_reply is not None or self.connected not in ("local", "remote"):
            return
        base = self.service_url()
        reply = QgsNetworkAccessManager.instance().get(health_request(base, 5000))
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

    # -- the tree -------------------------------------------------------------
    def ramp_items(self):
        names = assets.ramp_names()
        ids = list(self.catalog.colorramps) if self.catalog is not None and self.catalog.colorramps else list(names)
        return [(i, names.get(i, i), assets.ramp_icon(i)) for i in ids]

    def build(self):
        """The tree from the catalog, the panel's state (checked forms,
        settings, opacities) kept across a rebuild."""
        state = {mid: (r.row.checked_forms(), r.row.remembered, r.values(), r.opacity_value()) for mid, r in self.rows.items()}
        while self.groups_layout.count():
            item = self.groups_layout.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()
        self.rows = {}
        self.source.blockSignals(True)
        current = self.current_source()
        self.source.clear()
        for s in self.catalog.sources:
            label = s["name"] + (f"  ({s['key']})" if s.get("key") else "")
            self.source.addItem(label, s["id"])
        self.source.blockSignals(False)
        self.set_source(current or "mapterhorn", quiet=True)

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
        for mid, (forms, remembered, values, opacity) in state.items():
            row = self.rows.get(mid)
            if row is None:
                continue
            row.set_values(values)
            row.set_opacity(opacity)
            row.row.set_forms(forms)
            row.row.remembered = remembered
        for row in self.rows.values():
            row.apply_backend(self.backend)

    def adopt_existing(self):
        """The layers this panel wrote earlier (a saved project): their
        checkboxes and settings read back from their addresses. Rows with no
        layer keep what the panel says (a mode checked before connecting)."""
        light = None
        for key, row in self.rows.items():
            present = set()
            for k in (key, key + ":vector", key + ":values"):
                layer = self.stack.find(k)
                if layer is None:
                    continue
                present.add(ModeRow.form_of(k))
                if layer.customProperty(BACKEND_PROP) == "python" or layer.providerType() == "memory":
                    continue  # the Python backend's addresses use live/'s names
                if k.endswith(":values"):  # a GDAL source: the address itself
                    q = dict(parse_qsl(urlsplit(layer.source()).query))
                else:
                    uri = QgsDataSourceUri()
                    uri.setEncodedUri(layer.source())
                    q = dict(parse_qsl(urlsplit(uri.param("url")).query))
                if self.adopted:
                    continue  # the panel's own state wins after the first connect
                row.set_values(q)
                if q.get("illuminationDir") or q.get("illuminationAlt"):
                    light = (float(q.get("illuminationDir", LIGHT_DEFAULT[0])), float(q.get("illuminationAlt", LIGHT_DEFAULT[1])))
                if q.get("terrainSource"):
                    self.set_source(q["terrainSource"], quiet=True)
            if present:
                row.row.set_forms(present)
        if light is not None:
            self.set_light(*light, schedule=False)
        self.adopted = True

    # -- the source -----------------------------------------------------------
    def current_source(self):
        """The source picked: the item's id, or what was typed (an id, a
        name, an address) when the text is not the item's."""
        text = self.source.currentText().strip()
        i = self.source.currentIndex()
        if i >= 0 and self.source.itemText(i) == text:
            return self.source.itemData(i) or text
        if not text:
            return None
        j = self.source.findData(text)
        if j < 0:
            j = self.source.findText(text)
        return self.source.itemData(j) if j >= 0 else text

    def set_source(self, source_id, quiet=False):
        """Picks a source by id (an id the list lacks, a share link's or an
        address, is added to it)."""
        if not source_id:
            return
        if quiet:
            self.source.blockSignals(True)
        i = self.source.findData(source_id)
        if i < 0:
            self.source.addItem(str(source_id), source_id)
            i = self.source.count() - 1
        self.source.setCurrentIndex(i)
        if quiet:
            self.source.blockSignals(False)

    def source_changed(self):
        self._py_sources.clear()
        for row in self.rows.values():
            row.py_auto_range = None
        self.schedule_all()
        if self.connected == "python":
            self.prefetch()

    def zoom_to_source(self):
        """The map canvas moved to the source's bounds (the world for a
        global source). Returns the bounds (lon/lat) used."""
        src = self.current_source()
        entry = None
        if self.catalog is not None:
            entry = self.catalog.source(src)
        if entry is None:
            entry = next((s for s in assets.catalog().get("sources", []) if s.get("id") == src), None)
        bounds = (entry or {}).get("bounds")
        if not bounds:
            self.status.setText(f"{src}: no bounds known (a global source): the whole world")
            bounds = [-180.0, -85.0, 180.0, 85.0]
        if self.canvas is not None:
            rect = QgsRectangle(*[float(b) for b in bounds])
            try:
                tr = QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:4326"), self.canvas.mapSettings().destinationCrs(),
                                            QgsProject.instance())
                self.canvas.setExtent(tr.transformBoundingBox(rect))
                self.canvas.refresh()
            except Exception as e:  # noqa: BLE001 - bounds outside the project's CRS
                self.warn(f"Cannot zoom to {src}: {e}")
        return bounds

    # -- keys and light -------------------------------------------------------
    def key_values(self):
        return {k: e.text().strip() for k, e in self.keys.items() if e.text().strip()}

    def keys_changed(self):
        s = QgsSettings()
        for k, e in self.keys.items():
            s.setValue(f"{SETTINGS}/{k}", e.text().strip())
        self._py_sources.clear()
        self.schedule_all()

    def light_value(self):
        return (float(self.light_az.value()), float(self.light_el.value()))

    def set_light(self, azimuth, elevation, schedule=True):
        for w in (self.light_az, self.light_el):
            w.blockSignals(True)
        self.light_az.setValue(azimuth)
        self.light_el.setValue(elevation)
        for w in (self.light_az, self.light_el):
            w.blockSignals(False)
        self.light_pad.setValue(azimuth, elevation)
        if schedule:
            self.light_changed()

    def _light_from_pad(self, az, el):
        self.set_light(az, el)

    def _light_from_sliders(self, _v):
        self.light_pad.setValue(*self.light_value())
        self.light_changed()

    def light_changed(self):
        for mid in LIGHT_MODES:
            if mid in self.rows:
                self.schedule(self.rows[mid])

    def common_params(self, mode_id=None):
        """The parameters of every layer: a share link's others, the source,
        the keys the service reads, and for the shaded modes the light."""
        out = dict(self.extra)
        src = self.current_source()
        if src:
            out["terrainSource"] = src
        for k, v in self.key_values().items():
            if k in KEY_PARAMS:
                out[k] = v
        if mode_id in LIGHT_MODES:
            az, el = self.light_value()
            if (az, el) != LIGHT_DEFAULT:
                out["illuminationDir"] = f"{az:g}"
                out["illuminationAlt"] = f"{el:g}"
        return out

    # -- layers -----------------------------------------------------------------
    def remove_layers(self, key, prune=True):
        ids = [layer.id() for layer in self.stack.find_all(key)]
        self.removing.update(ids)
        self.stack.remove(key, prune=prune)

    def layers_removed(self, ids):
        """Layers about to leave the project: the panel's own removals are
        expected; any other unchecks the form whose layer it was, and the
        groups it leaves empty go too."""
        project = QgsProject.instance()
        by_hand = False
        for lid in ids:
            if lid in self.removing:
                self.removing.discard(lid)
                continue
            layer = project.mapLayer(lid)
            if layer is None:
                continue
            key = layer.customProperty(PROP)
            if key and key.split(":")[0] in self.rows:
                by_hand = True
                self.rows[key.split(":")[0]].row.form_removed(ModeRow.form_of(key))
        if by_hand:
            QTimer.singleShot(0, self.stack.prune)

    def cleanup(self):
        """Disconnected from the project (the plugin unloading)."""
        try:
            QgsProject.instance().layersWillBeRemoved.disconnect(self.layers_removed)
        except (TypeError, RuntimeError):
            pass
        if self.canvas is not None:
            try:
                self.canvas.extentsChanged.disconnect(self.extent_changed)
            except (TypeError, RuntimeError):
                pass
        self.health_timer.stop()

    # -- the Python backend's view-dependent work -------------------------------
    def canvas_extent(self):
        c = self.canvas
        if c is None:
            return None, 0
        try:
            to_merc = QgsCoordinateTransform(c.mapSettings().destinationCrs(), QgsCoordinateReferenceSystem("EPSG:3857"),
                                             QgsProject.instance())
            return to_merc.transformBoundingBox(c.extent()), c.width()
        except Exception:  # noqa: BLE001 - an extent outside Web Mercator
            return None, 0

    def extent_changed(self):
        if self.connected == "python":
            self.prefetch_timer.start()
            if any(r.row.on("vector") for r in self.rows.values()):
                self.vector_timer.start()

    def prefetch(self):
        if self.connected != "python":
            return
        from .live.layers import LocalLayers
        ext, width = self.canvas_extent()
        if ext is not None:
            LocalLayers(self.stack.project).prefetch(ext, width, self.python_source())

    def refresh_vectors(self):
        if self.connected != "python":
            return
        for row in self.rows.values():
            if "vector" in row.keys() and row.row.on("vector"):
                row.update()

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
    def local_view(self, query):
        """A share link read without a service (the Python backend): the
        modes whose switches it turns on, their opacities, the settings, the
        camera."""
        q = query_dict(query)
        active, opacity = [], {}
        for mid, row in self.rows.items():
            sw = row.mode.get("switches") or {}
            if sw and all(str(q.get(k, "")).lower() == "true" for k, v in sw.items() if v):
                active.append(mid)
            ok = row.mode.get("opacityKey")
            if ok and ok in q:
                opacity[mid] = q[ok]
        camera = {k: q.get(k) for k in ("lat", "lng", "zoom") if q.get(k) is not None}
        params = {k: v for k, v in q.items() if not k.startswith("show")}
        return {"active": active, "opacity": opacity, "params": params, "camera": camera}

    def open_link(self, link=None):
        """A share link (or its query): its modes checked, their settings and
        opacities set, the source picked, the canvas moved to its camera. The
        backend is asked first (one clear message if it is not there)."""
        link = link if isinstance(link, str) else self.link.text()
        query = split_link(link)
        if not query:
            self.warn("Not a share link: paste the app's link (https://...?zoom=...&lat=...) or its query")
            return False
        if self.connected is None and not self.connect_service():
            return False
        if self.connected == "python":
            view = self.local_view(query)
        else:
            ok, error = health(self.service_url())
            if not ok:
                self.service_down = True
                self.warn(self.unresponsive(self.service_url(), error))
                return False
            try:
                view = self.catalog.view(query)
            except ServiceError as e:
                self.warn(f"Could not read the link: {e}")
                return False
        params = dict(view.get("params", {}))
        src = params.pop("terrainSource", None) or params.pop("terrainSourceA", None)
        if src:
            self.set_source(src, quiet=True)
            self._py_sources.clear()
        if any(k in params for k in LIGHT_KEYS):
            self.set_light(float(params.get("illuminationDir", LIGHT_DEFAULT[0])),
                           float(params.get("illuminationAlt", LIGHT_DEFAULT[1])), schedule=False)
        # The opacities go to the QGIS layers (view["opacity"]), not into
        # the addresses.
        taken = {r.mode["opacityKey"] for r in self.rows.values() if r.mode.get("opacityKey")}
        taken.update(LIGHT_KEYS)
        taken.update(("terrainSource", "terrainSourceA"))
        for row in self.rows.values():
            row.set_values(params)
            taken.update(row.settings)
        self.extra = link_params(params, getattr(self.catalog, "inputs", set()), taken)
        active = set(view.get("active", []))
        for mode_id, row in self.rows.items():
            if mode_id in view.get("opacity", {}):
                row.set_opacity(view["opacity"][mode_id])
            if mode_id in active:
                forms = (row.row.checked_forms() & row.row.available) or {row.row.default_form()} - {None}
            else:
                forms = set()
            row.row.set_forms(forms)
        self.pending.clear()
        for row in self.rows.values():
            row.update()
        cam = view.get("camera") or {}
        if cam.get("lat") is not None and cam.get("lng") is not None:
            self.camera = (float(cam["lat"]), float(cam["lng"]), float(cam.get("zoom") or 12))
            self.zoom_to(*self.camera)
        self.status.setText(f"Opened: {len(active)} modes on" + (f", {len(self.extra)} other parameters kept" if self.extra else ""))
        return True

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
