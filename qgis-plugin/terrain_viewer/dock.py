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
import os
import time
from urllib.parse import urlsplit, parse_qsl

from qgis.PyQt.QtCore import Qt, QTimer, QUrl, QSize, QDateTime, QDate, QTime
from qgis.PyQt.QtGui import QColor, QIcon
from qgis.PyQt.QtNetwork import QNetworkRequest, QNetworkReply
from qgis.PyQt.QtWidgets import (
    QApplication, QDockWidget, QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel, QLineEdit, QPushButton,
    QComboBox, QCheckBox, QDoubleSpinBox, QSpinBox, QScrollArea, QToolButton, QFrame, QGroupBox, QSizePolicy,
    QStackedWidget, QDateTimeEdit,
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
    from qgis.gui import QgsColorButton
except ImportError:  # pragma: no cover
    QgsColorButton = None

from .service import (
    Catalog, ServiceError, tile_url, values_url, split_link, query_dict, KEY_PARAMS, ALL_KEYS, unresponsive_message,
    health, health_request, link_params, panel_tree,
)
from .layers import LayerStack, PROP, BACKEND_PROP, tree_ranks
from . import local_server, assets, links
from . import python_backend as pyb
from .settings_ui import (
    LIGHT_KEYS, LIGHT_DEFAULT, LIGHT_MODES, slider_range, symmetric_pairs, is_ramp_key, is_matcap_key, is_color_key,
    clean_enum,
)
from .widgets import SliderSpin, LightPad, IconCombo, FoldSection, RadioRow, CompactOpacity, ModeSwitch, hand, hand_title
from . import solar
from .historical_ui import HistoricalPanel

SETTINGS = "terrain_viewer"
DEFAULT_SERVICE = "http://localhost:3400"
WORLD = 20037508.342789244
# While connected, the service's /health is asked this often (in the
# background), so a service that went away (the desktop app closed) is
# reported instead of leaving empty layers.
HEALTH_EVERY_MS = 15000
# The deepest zoom of the Python backend's color tiles (Mapterhorn's 512 px
# tiles go to z17, so 256 px tiles to z18).
PY_XYZ_ZMAX = 18
# The panel's defaults where they differ from the app's: contours in black
# (the app's "" draws them half transparent black on the map, brown in a
# QGIS vector style), for every backend.
PANEL_DEFAULTS = {"contourColor": "#000000"}
# The basemap (the Basemap row, which a link's showRasterBasemap=true also
# drives): one layer under every mode, at the bottom of the live group.
BASEMAP_KEY = "basemap"
# The panel's row the Basemap row goes under (the app's stack: the basemap
# under the elevation's hypsometric tint, docs/content/docs/dev/layer-order.mdx).
BASEMAP_AFTER = "colorRelief"
# While the light is dragged, the shaded modes' layers are rewritten as soon
# as the canvas has drawn the previous light, and at most this often (ms);
# after LIGHT_MAX_WAIT_MS without a finished draw, anyway. Measured on a
# 1920x1080 canvas of hillshade at z13 (elevation cached): a light change
# redraws in about 1.0 to 1.3 s from the Python backend (its server computes
# the 40 tiles in about 0.3 s; the rest is QGIS's XYZ provider), 2 to 2.5 s
# from a tile service.
LIGHT_THROTTLE_MS = {"python": 100, "service": 200}
LIGHT_MAX_WAIT_MS = 2500
# In the panel's order: Python first (nothing to install or run), then the
# packaged tile server, then a remote one.
# The app's modes (appMode): the terrain panel, or dated imagery on a timeline.
APP_MODES = (
    ("terrain", "Terrain", "The terrain modes: hillshade, slope, relief visualization, contours... (the app's Terrain mode)",
     "icon.svg"),
    ("historical", "Historical", "Dated satellite and aerial imagery: a source, the dates at the map's centre, and "
     "QGIS's Temporal Controller stepping through them (the app's Historical Imagery mode)", "clock.svg"),
)
BACKENDS = (
    ("python", "Python backend",
     "The modes computed in QGIS's own Python with numpy, no tile service at all; it starts when picked. Every mode, "
     "from Terrarium and Terrain-RGB tiles, COGs, VRTs, WMS, QGIS raster layers and anything GDAL opens."),
    ("local", "Packaged tile server",
     "The Terrain Viewer tile service packaged for QGIS (Node and the service, about 50 MB): installed from the panel "
     "the first time, started on this machine (127.0.0.1) when you connect, stopped when QGIS quits. Every mode and source."),
    ("remote", "Remote tile server",
     "A tile service at an address: the Terrain Viewer desktop app's (http://localhost:3400), one you run yourself "
     "(cd tile-server && pnpm start), or a hosted one. Every mode and source."),
)


def initial_backend(s):
    """The backend the panel opens with: the one picked last; for a new user
    the Python backend (nothing to download or run, every mode), unless
    QGIS's Python lacks numpy. Users of 0.6.0 and earlier keep theirs: the
    "Local tile service" box, or a service address typed."""
    backend = s.value(f"{SETTINGS}/backend", "")
    if backend in ("local", "remote", "python"):
        return backend
    if str(s.value(f"{SETTINGS}/bundled", "false")).lower() in ("1", "true"):
        return "local"
    if s.contains(f"{SETTINGS}/service"):
        return "remote"
    return "remote" if pyb.numpy_missing() else "python"


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
    number box, a ramp or matcap select with previews, a color button),
    read and written as the URL value."""

    def __init__(self, spec, dock, on_change):
        if spec["key"] in PANEL_DEFAULTS:
            spec = {**spec, "default": PANEL_DEFAULTS[spec["key"]]}
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
        elif is_color_key(key, t) and QgsColorButton is not None:
            w = QgsColorButton()
            w.setColor(QColor(str(d or "#000000")))
            w.colorChanged.connect(on_change)
            # The default as written (#FFFFFF), so an unchanged color stays
            # out of the address.
            self.get = lambda: str(d) if d and QColor(str(d)) == w.color() else w.color().name()
            # An empty or unreadable color (the app's "" default) is the
            # panel's default.
            self.set = lambda v: w.setColor(QColor(str(v)) if v and QColor(str(v)).isValid() else QColor(str(d or "#000000")))
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


# The forms by their ids. "colour" stays the id of the drawn raster form (the
# Python backend's form names, python_backend.py, use it); the panel says Color.
FORM_LABELS = {"colour": "Color", "values": "Values", "vector": "Vector"}
DRAWN_FORMS = ("colour", "vector")  # the forms whose look the settings change


def _retain_hidden(w):
    """A hidden widget keeps its room in the layout."""
    sp = w.sizePolicy()
    sp.setRetainSizeWhenHidden(True)
    w.setSizePolicy(sp)


class _RowHeader(QWidget):
    """A mode's line: a click anywhere on it (not on one of its boxes or
    buttons, which take their own clicks) toggles the mode. A pointing hand
    and a light background under the mouse say so."""

    def __init__(self, on_click):
        super().__init__()
        self.on_click = on_click
        self.setObjectName("tvRowHeader")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_Hover, True)
        # A grey of low alpha reads on light and dark themes alike.
        self.setStyleSheet("#tvRowHeader { border-radius: 3px; }"
                           "#tvRowHeader:hover { background-color: rgba(128, 128, 128, 40); }")
        hand(self)

    def mouseReleaseEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton and self.isEnabled():
            self.on_click()
        super().mouseReleaseEvent(e)


class FormsRow:
    """A mode's row: its checkbox on the left, its forms on the right
    (Color: the colored layer; Values: the numbers, a Float32 raster;
    Vector: the overlay's features), each a layer of the project, and a
    settings cog shown while a drawn form (Color, Vector) is on; the
    settings fold under the row.

    Checking the mode turns on the forms it had (the default form the first
    time: Vector for the overlays that have one, else Color); unchecking it
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
        self.head = head
        head.setContentsMargins(0, 0, 0, 0)
        head.setSpacing(4)
        self.check = QCheckBox(label)
        self.check.setMinimumWidth(40)  # long names elide rather than widen the panel
        self.check.toggled.connect(self._mode_toggled)
        head.addWidget(self.check, 1)
        self.forms = {}
        # Two columns, so the boxes line up from row to row (an empty slot
        # keeps its width): Vector then Raster for the overlays, Color then
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
            hand(cb)
            head.addWidget(cb)
            self.forms[f] = cb
        self.more = QToolButton()
        self.more.setText("⚙")
        self.more.setCheckable(True)
        self.more.setAutoRaise(True)
        self.more.setToolTip("Settings")
        hand(self.more)
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

    def add_inline(self, widget):
        """A small control between the mode's name and its forms (the
        opacity), its room kept when hidden so the boxes line up."""
        _retain_hidden(widget)
        self.head.insertWidget(1, widget)
        self.inline = widget
        self._sync()

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
        for w in [self.header, self.more] + list(self.forms.values()):
            w.setCursor(Qt.CursorShape.PointingHandCursor if ok else Qt.CursorShape.ArrowCursor)
        self.check.setToolTip("" if ok else why)
        self.header.setToolTip("" if ok else why)
        if not ok:
            self.panel.setVisible(False)
        else:
            self._sync()

    def _sync(self):
        drawn = any(self.on(f) for f in DRAWN_FORMS)
        inline = getattr(self, "inline", None)
        if inline is not None:
            inline.setVisible(drawn and self.header.isEnabled())
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
            tips["values"] = (f"The values before the color ramp, a Float32 raster read by GDAL, for analysis "
                              f"({mode['values'].get('unit')}): {mode['values'].get('description', '')}")
        if mode.get("vector"):
            forms.append("vector")
            tips["vector"] = "The features as vector tiles, styled in QGIS (sharp at every zoom, Identify)"
        self.all_forms = set(forms)
        self.row = FormsRow(mode["name"], forms, self.update, tips)
        self.box, self.check, self.more = self.row.box, self.row.check, self.row.more
        # The boxes by name (tests, scripts; `colour` and `numbers` are the
        # 0.5.0 names).
        self.values_box = self.numbers = self.row.forms.get("values")
        self.vector = self.row.forms.get("vector")
        self.color = self.colour = self.row.forms.get("colour")
        form = self.row.form_layout
        self.opacity = None
        if mode.get("opacityKey") or mode.get("form") != "vector":
            # In the row, between the name and the forms (0.9.0; it was
            # under the cog): shown while a drawn form is on.
            self.opacity = CompactOpacity(1.0)
            self.opacity.opacityChanged.connect(lambda _v: self.apply_style())
            self.row.add_inline(self.opacity)
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
            self.row.set_enabled(False, "Not computed by the Python backend (yet): pick the packaged or remote tile server "
                                        "at the top of the panel for this mode")
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
        if sid is None:  # a source it cannot read: nothing drawn (said once)
            for key in keys.values():
                dock.remove_layers(key)
            return
        srv = dock.live_server()
        ext, width = dock.canvas_extent()
        if py == "elevation" and values.get("hypsoAutoRange") in (True, "true"):
            # The range follows the view (the app's hypsoAutoRange): its 2nd
            # to 98th percentile; otherwise the ramp settings as the service.
            if self.py_auto_range is None and ext is not None:
                self.py_auto_range = elevation_range(ext, width, sid)
            pyb.elevation_opts(values, opts, self.py_auto_range)
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
                # The colour tiles' ramp, again when the panel's ramp settings
                # change (a style set in the layer's properties stays until then).
                ramp_key = repr(sorted((k, v) for k, v in opts.items() if k in spec.get("colour_keys", ())))
                if layer is not None and layer.isValid() and (new or layer.customProperty("terrain_viewer/ramp") != ramp_key):
                    apply_renderer(layer, py, None, opts)
                    layer.setCustomProperty("terrain_viewer/ramp", ramp_key)
                    layer.triggerRepaint()
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
                    style_vector(layer, py, opts)  # a color or width setting changed
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


class BasemapRow:
    """The basemap as a row of the tree, under Elevation Hypso: its checkbox
    adds or removes one XYZ layer at the bottom of the live group (under
    every mode, as the app stacks it), its opacity in the row, and under the
    cog a select of its source: the app's built-in basemaps
    (lib/basemap-sources.ts through assets/app_defaults.json), a keyed one
    only while the panel holds its key. A link's basemap that is none of
    them (an XYZ address, a dated source relayed by a tile service) is added
    to the select when the link is opened. Open link drives this row, so
    there is one way a basemap layer is made, for every backend."""

    def __init__(self, dock):
        self.dock = dock
        self.custom = None  # (source, params): a link's basemap that is not a choice
        self.noted = None
        self.row = FormsRow("Basemap", ["colour"], self.update, None)
        # One form, drawn: its box is the row's own, hidden (its room kept,
        # so the opacities line up with the modes').
        self.row.forms["colour"].setVisible(False)
        self.box, self.check, self.more = self.row.box, self.row.check, self.row.more
        self.check.setToolTip("An imagery basemap as an XYZ layer under every mode (the app's Raster basemap)")
        self.opacity = CompactOpacity(1.0)
        self.opacity.opacityChanged.connect(lambda _v: self.apply_style())
        self.row.add_inline(self.opacity)
        self.source = QComboBox()
        self.source.setMinimumWidth(60)
        self.source.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.source.setMinimumContentsLength(8)
        self.source.setToolTip("The basemap's imagery: the app's built-in basemaps; Mapbox, MapTiler and HERE show once "
                               "their key is set under API keys")
        self.row.form_layout.addRow("Source", self.source)
        self.fill()
        self.source.currentIndexChanged.connect(lambda _i: self.update())
        self.row._sync()

    def fill(self):
        """The select's choices again (a key was set or cleared, a link
        brought its own), the one picked kept when it is still offered."""
        current = self.current()
        self.source.blockSignals(True)
        self.source.clear()
        for sid, name in links.basemap_choices(self.dock.key_values()):
            self.source.addItem(name, sid)
        if self.custom is not None and self.source.findData(self.custom[0]) < 0:
            self.source.addItem(links.basemap_label(self.custom[0]), self.custom[0])
        i = self.source.findData(current)
        self.source.setCurrentIndex(i if i >= 0 else max(0, self.source.findData(links.DEFAULT_BASEMAP)))
        self.source.blockSignals(False)

    def current(self):
        """The source picked: a built-in's id or a link's own source."""
        return self.source.currentData() or links.DEFAULT_BASEMAP

    def set_source(self, src, params=None):
        """Picks a source without drawing it (update() does): a choice of the
        select, or one added to it (a link's XYZ address, dated source or
        keyed basemap, with the link's parameters for a tile service)."""
        src = src or links.DEFAULT_BASEMAP
        if self.source.findData(src) < 0 or params:
            self.custom = (src, dict(params or {}))
        self.fill()
        self.source.blockSignals(True)
        self.source.setCurrentIndex(max(0, self.source.findData(src)))
        self.source.blockSignals(False)

    def set_opacity(self, v):
        self.opacity.setOpacity(float(v))

    def state(self):
        return (self.row.checked_forms(), self.row.remembered, self.current(), self.custom, self.opacity.opacity(),
                self.more.isChecked())

    def restore(self, state):
        forms, remembered, src, custom, opacity, more = state
        self.custom = custom
        self.set_source(src)
        self.opacity.blockSignals(True)
        self.set_opacity(opacity)
        self.opacity.blockSignals(False)
        self.more.setChecked(more)
        self.row.set_forms(forms)
        self.row.remembered = remembered

    def tiles(self):
        """(name, XYZ template, max zoom, note) of the source picked, for the
        backend connected (a tile service relays the dated sources)."""
        dock = self.dock
        service = dock.service_url() if dock.connected in ("local", "remote") else None
        src = self.current()
        params = self.custom[1] if self.custom is not None and self.custom[0] == src else None
        return links.basemap_tiles(src, dock.key_values(), service, params)

    def update(self):
        """The basemap layer added (checked), re-pointed (another source,
        another backend, a key) or removed (unchecked). Returns the layer,
        or None."""
        dock, stack = self.dock, self.dock.stack
        base = self.tiles() if self.row.on("colour") else None
        if base is None:
            if stack.find(BASEMAP_KEY) is not None:
                dock.remove_layers(BASEMAP_KEY)
            return None
        name, url, zmax, note = base
        new = stack.find(BASEMAP_KEY) is None
        layer = stack.ensure(BASEMAP_KEY, name, (), url, False, zmax=zmax,
                             backend="python" if dock.connected == "python" else "service")
        if layer.name() != name:
            layer.setName(name)
        if new:
            stack.style(layer, self.opacity.opacity(), False)
            stack.set_visible(layer, True)
        if note and self.noted != (self.current(), note):
            dock.warn(f"Basemap: {note}")
        self.noted = (self.current(), note) if note else None
        return layer

    def apply_style(self):
        self.dock.stack.style(self.dock.stack.find(BASEMAP_KEY), self.opacity.opacity(), False)

    def adopt(self, layer):
        """A basemap layer of a saved project read back: its source, its
        opacity, the row checked."""
        uri = QgsDataSourceUri()
        uri.setEncodedUri(layer.source())
        src, params = links.basemap_of_url(uri.param("url"))
        self.set_source(src, params)
        if layer.renderer() is not None:
            self.opacity.blockSignals(True)
            self.set_opacity(layer.renderer().opacity())
            self.opacity.blockSignals(False)
        self.row.set_forms({"colour"})


def _enum(owner, scope, name):
    """An enum value by its scoped name (QGIS 4, recent QGIS 3) or its flat
    one (older QGIS 3)."""
    scoped = getattr(getattr(owner, scope, None), name, None)
    return scoped if scoped is not None else getattr(owner, name)


def raw_stretch(layer):
    """A raw elevation layer's grey stretched to the 2nd to 98th percentile
    of what the canvas shows, again at every view (QGIS's "updated canvas"
    min / max, estimated from the overviews). QGIS's default stretches the
    whole raster's range once: a country's lowlands are then near black (0
    to 300 m of NRCan's 0 to 5900 m), and a hillshade multiplied over them
    stays black."""
    from qgis.core import QgsRasterMinMaxOrigin
    r = layer.renderer() if layer is not None and layer.isValid() else None
    if r is None or not hasattr(r, "minMaxOrigin") or r.type() != "singlebandgray":
        return False
    mmo = QgsRasterMinMaxOrigin(r.minMaxOrigin())
    mmo.setLimits(_enum(QgsRasterMinMaxOrigin, "Limits", "CumulativeCut"))
    mmo.setExtent(_enum(QgsRasterMinMaxOrigin, "Extent", "UpdatedCanvas"))
    mmo.setStatAccuracy(_enum(QgsRasterMinMaxOrigin, "StatAccuracy", "Estimated"))
    r.setMinMaxOrigin(mmo)
    return True


class TerrainViewerDock(QDockWidget):
    def __init__(self, canvas=None, parent=None, message_bar=None, bridge=None):
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
        self.basemap_row = None  # the Basemap row, made with the tree (build)
        self.stack = LayerStack()
        # QGIS's layer tree to canvas bridge (iface.layerTreeCanvasBridge()):
        # it zooms to the first layer added to a project with none, the whole
        # world for tiles; keep_extent stops it for the panel's layers.
        self.bridge = bridge
        self.stack.before_insert = self.keep_extent
        self.stack.after_insert = self.place_raw_group
        # A fresh, empty project (QGIS just started, or File > New): the
        # panel's first layer there sets the project up (keep_extent).
        project = QgsProject.instance()
        self.project_fresh = not project.mapLayers() and not project.fileName()
        project.cleared.connect(self._project_cleared)
        project.readProject.connect(self._project_read)
        self.extra = {}  # a share link's other parameters, kept in every address
        self.camera = None  # the last share link's (lat, lng, zoom), when there is no canvas
        self.pending = set()
        self.adopted = False
        self._py_sources = {}
        self._service_sources = {}  # (service, layer or file) -> its file:<id> there
        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(500)
        self.timer.timeout.connect(self.flush)
        # The light, throttled while dragged (light_changed).
        self.light_pending = set()
        self.light_late = False
        self.light_wait = False
        self.light_min_done = self.light_drawn = self.light_render_seen = False
        self.light_rewrites = 0  # how many times the shaded layers were rewritten (tests, measures)
        self.light_timer = QTimer(self)
        self.light_timer.setSingleShot(True)
        self.light_timer.timeout.connect(self._light_tick)
        self.light_guard = QTimer(self)
        self.light_guard.setSingleShot(True)
        self.light_guard.timeout.connect(lambda: self._light_next(force=True))
        if canvas is not None:
            canvas.renderStarting.connect(self._canvas_render_starting)
            canvas.mapCanvasRefreshed.connect(self._canvas_refreshed)
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
        QgsProject.instance().layersAdded.connect(self.refresh_layer_sources)
        QgsProject.instance().layersRemoved.connect(self.refresh_layer_sources)
        self.install_task = None

        s = QgsSettings()
        # 0.5.0 kept an Earthdata token for the local service here; a token
        # now lives in the service's environment only (EARTHDATA_TOKEN).
        if s.contains(f"{SETTINGS}/earthdataToken"):
            s.remove(f"{SETTINGS}/earthdataToken")
        self.backend = backend = initial_backend(s)

        body = QWidget()
        outer = QVBoxLayout(body)

        # -- a newer version, when there is one (updates.py) ----------------
        self.update_box = QFrame()
        self.update_box.setFrameShape(QFrame.Shape.StyledPanel)
        ub = QHBoxLayout(self.update_box)
        ub.setContentsMargins(6, 3, 3, 3)
        self.update_label = QLabel()
        self.update_label.setWordWrap(True)
        ub.addWidget(self.update_label, 1)
        self.update_btn = QPushButton("Update")
        self.update_btn.clicked.connect(lambda _checked=False: self.install_update())
        ub.addWidget(self.update_btn)
        hand(self.update_btn)
        self.update_box.setVisible(False)
        self.update_info = None
        self.update_reply = None
        outer.addWidget(self.update_box)

        # -- the app's modes: Terrain (everything below), Historical ----------
        here = os.path.dirname(os.path.abspath(__file__))
        self.mode = "historical" if s.value(f"{SETTINGS}/appMode", "terrain") == "historical" else "terrain"
        self.mode_switch = ModeSwitch([(i, label, tip, QIcon(os.path.join(here, icon))) for i, label, tip, icon in APP_MODES],
                                      self.mode)
        outer.addWidget(self.mode_switch)
        self.terrain_page = QWidget()
        page = outer  # the panel's own layout, kept for the two pages
        outer = QVBoxLayout(self.terrain_page)
        outer.setContentsMargins(0, 0, 0, 0)

        # -- the backend, and its options -----------------------------------
        self.backend_picker = RadioRow(BACKENDS, backend)
        outer.addWidget(self.backend_picker)
        self.pages = QStackedWidget()
        self.pages.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Maximum)
        # Packaged tile server
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
        self.page_of = {"local": local}
        # Remote tile server
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
        self.page_of["remote"] = remote
        # Python: no Connect, it starts when picked (a server thread of QGIS
        # on 127.0.0.1, nothing to install or wait for).
        python = QWidget()
        pl = QHBoxLayout(python)
        pl.setContentsMargins(0, 0, 0, 0)
        self.python_info = QLabel("Computed in QGIS with numpy: every mode, from tile pyramids, COGs, VRTs, WMS, "
                                  "QGIS raster layers and anything GDAL opens.")
        self.python_info.setWordWrap(True)
        pl.addWidget(self.python_info, 1)
        self.page_of["python"] = python
        for b in BACKENDS:  # the pages in the radio buttons' order
            self.pages.addWidget(self.page_of[b[0]])
        hand(self.install_btn, self.local_connect, go)
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
        self.source.setToolTip("An id from the service's /terrain-sources, or the address of Terrarium tiles, a COG or a VRT")
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
        hand(self.zoom_btn)
        src.addWidget(self.zoom_btn)
        # The raw elevation of a library COG, VRT or WMS as a QGIS layer (the
        # address the Python backend reads), in a "Raw elevation inputs" group.
        self.raw_btn = QToolButton()
        icon = _theme_icon("/mActionAddRasterLayer.svg", "/mIconRaster.svg")
        if icon is not None:
            self.raw_btn.setIcon(icon)
        else:
            self.raw_btn.setText("Raw")
        self.raw_btn.clicked.connect(lambda _checked=False: self.add_raw_input())
        hand(self.raw_btn)
        src.addWidget(self.raw_btn)
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
            basemap = any(b.get("apiKey") == k for b in links.builtin_basemaps().values())
            e.setPlaceholderText("only for the sources that need it" if sent else
                                 "for its basemap (the Basemap row)" if basemap else "kept; no source needs it yet")
            e.setToolTip(f"{label} key ({k}): " + ("sent to the tile service with each tile of a source that needs it, "
                                                   "and used by the Python backend for that source" if sent else
                                                   "stored in QGIS's settings for the app's sources that will need it")
                         + (f". With it, the Basemap row offers the {label} basemap (the key goes in that layer's address)"
                            if basemap else ""))
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
        hand(open_btn)
        link.addWidget(self.link, 1)
        link.addWidget(open_btn)
        outer.addLayout(link)

        freeze = QHBoxLayout()
        freeze_btn = QPushButton("Freeze")
        freeze_btn.setToolTip("Copy the layers drawn now from the \"Terrain Viewer (live)\" group into a new dated "
                              "group under it, every setting kept in their addresses; the panel never changes the copies")
        freeze_btn.clicked.connect(lambda _checked=False: self.freeze())
        hand(freeze_btn)
        freeze.addStretch(1)
        freeze.addWidget(freeze_btn)
        outer.addLayout(freeze)
        self.freeze_btn = freeze_btn

        # -- the light, shared by the shaded modes ----------------------------
        self.light_section = FoldSection("Light (hillshade, Phong, shadows)", None, open_=True)  # open by default (0.9.2)
        # Free (the pad and its sliders) or the sun at a date and time over
        # the canvas centre, which sets them (the pad shows where it is).
        self.light_mode = RadioRow((("free", "Free", "Drag the light on the pad or set its azimuth and elevation"),
                                    ("sun", "Sun at a date and time",
                                     "The sun's direction over the map's centre at the date and time set (UTC), as the "
                                     "app's date and time light: it sets the azimuth and elevation")), "free")
        self.light_mode.changed.connect(self._light_mode_changed)
        self.light_section.body_layout.addWidget(self.light_mode)
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
        self.light_pad.released.connect(self._light_released)
        for w in (self.light_az, self.light_el):
            w.slider.sliderReleased.connect(self._light_released)
        self.light_az.valueChanged.connect(self._light_from_sliders)
        self.light_el.valueChanged.connect(self._light_from_sliders)
        self.sun_box = QWidget()
        sform = QFormLayout(self.sun_box)
        sform.setContentsMargins(0, 0, 0, 0)
        self.sun_when = QDateTimeEdit(QDateTime.currentDateTimeUtc())
        self.sun_when.setTimeSpec(Qt.TimeSpec.UTC)
        self.sun_when.setDisplayFormat("yyyy-MM-dd HH:mm")
        self.sun_when.setCalendarPopup(True)
        self.sun_when.setToolTip("The date and the time, in UTC: the sun's place follows the map's longitude")
        self.sun_day = SliderSpin(1, 365, 1, 172, integer=True, hard=(1, 365))
        self.sun_day.setToolTip("The day of the year (1 is 1 January, 172 the June solstice); the year is kept")
        self.sun_hour = SliderSpin(0, 24, 0.25, 12, hard=(0, 24))
        self.sun_hour.setToolTip("The time of day in UTC, in hours (15.5 is 15:30)")
        sform.addRow("Date, time (UTC)", self.sun_when)
        sform.addRow("Day of year", self.sun_day)
        sform.addRow("Hour (UTC)", self.sun_hour)
        self.sun_info = QLabel()
        self.sun_info.setWordWrap(True)
        sform.addRow(self.sun_info)
        self.light_section.body_layout.addWidget(self.sun_box)
        self._sun_sync = False
        self._sun_from_when()  # the day and hour boxes from the date picked
        self.sun_when.dateTimeChanged.connect(lambda _dt: self._sun_from_when())
        self.sun_day.valueChanged.connect(lambda _v: self._sun_from_parts())
        self.sun_hour.valueChanged.connect(lambda _v: self._sun_from_parts())
        self.sun_box.setVisible(False)
        self.sun_timer = QTimer(self)  # the canvas moved: the sun over its new centre
        self.sun_timer.setSingleShot(True)
        self.sun_timer.setInterval(400)
        self.sun_timer.timeout.connect(self.apply_sun)
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
        page.addWidget(self.terrain_page, 1)
        self.historical = HistoricalPanel(self)
        page.addWidget(self.historical, 1)
        self.setWidget(body)

        # The tree from the packaged snapshot until a service answers.
        snap = assets.catalog()
        if snap.get("tree"):
            self.catalog = Catalog(None, snapshot=snap)
            self.build()
        self.show_backend(backend)
        self.mode_switch.changed.connect(self.set_mode)
        self.set_mode(self.mode, save=False)
        # A newer release, looked for a few seconds after the panel opens (at
        # most once a day; terrain_viewer/checkUpdates false turns it off).
        if str(s.value(f"{SETTINGS}/checkUpdates", "true")).lower() in ("1", "true"):
            QTimer.singleShot(4000, lambda: self.check_updates())

    # -- updates ---------------------------------------------------------------
    def check_updates(self, force=False, xml_url=None):
        """Reads the repository's plugins.xml in the background (at most once
        a day unless `force`) and shows "Update to x.y.z" when it lists a
        newer version than this one. Returns False when not asked."""
        from . import updates
        s = QgsSettings()
        now = time.time()
        try:
            last = float(s.value(f"{SETTINGS}/updateCheckedAt", 0) or 0)
        except (TypeError, ValueError):
            last = 0
        if not force and now - last < updates.CHECK_EVERY_S:
            cached = s.value(f"{SETTINGS}/updateAvailable", "")
            if cached:
                self._update_found(str(cached), s.value(f"{SETTINGS}/updateXml", ""))
            return False
        if self.update_reply is not None:
            return False
        reply = QgsNetworkAccessManager.instance().get(updates.request(xml_url or updates.REPOSITORY_XML))
        self.update_reply = reply

        def done():
            self.update_reply = None
            ok = reply.error() == QNetworkReply.NetworkError.NoError
            data = bytes(reply.readAll()) if ok else b""
            reply.deleteLater()
            if ok:
                self.updates_answered(data, xml_url or updates.REPOSITORY_XML)
        reply.finished.connect(done)
        return True

    def updates_answered(self, data, xml_url=""):
        """plugins.xml read: a newer version shown, or nothing."""
        from . import updates
        s = QgsSettings()
        s.setValue(f"{SETTINGS}/updateCheckedAt", time.time())
        try:
            info = updates.parse_plugins_xml(data)
        except updates.UpdateError:
            return None
        if info is None or not updates.newer(info["version"], updates.installed_version()):
            s.setValue(f"{SETTINGS}/updateAvailable", "")
            self.update_box.setVisible(False)
            return None
        s.setValue(f"{SETTINGS}/updateAvailable", info["version"])
        s.setValue(f"{SETTINGS}/updateXml", xml_url)
        self.update_info = info
        self._update_found(info["version"], xml_url)
        return info

    def _update_found(self, version, xml_url=""):
        from . import updates
        if not updates.newer(version, updates.installed_version()):
            return
        ok, why = updates.can_update()
        self.update_label.setText(f"Terrain Viewer {version} is available (this is {updates.installed_version()})."
                                  + ("" if ok else f" {why}."))
        self.update_btn.setText(f"Update to {version}")
        self.update_btn.setEnabled(ok)
        self.update_btn.setToolTip("Download it from the project's GitHub release, check its sha256, install it over "
                                   "this version, then reload the plugin" if ok else why)
        self.update_box.setVisible(True)
        if self.update_info is None:
            self.update_info = {"version": version, "xml": xml_url}

    def install_update(self, reload=True):
        """The newer version downloaded, its sha256 checked against plugins.xml,
        unpacked over this plugin's folder; then the plugin reloaded (or QGIS
        to restart). Returns the version installed, or None."""
        from . import updates
        info = self.update_info or {}
        try:
            if not info.get("download_url"):  # known from the daily check: read plugins.xml again
                info = updates.parse_plugins_xml(updates.fetch(info.get("xml") or updates.REPOSITORY_XML)) or {}
            if not info.get("download_url"):
                raise updates.UpdateError("plugins.xml lists no download")
            self.status.setText(f"Downloading Terrain Viewer {info['version']}...")
            QApplication.processEvents()
            version = updates.install_zip(updates.fetch(info["download_url"]), info.get("sha256", ""))
        except updates.UpdateError as e:
            self.warn(f"Terrain Viewer was not updated: {e}")
            return None
        QgsSettings().setValue(f"{SETTINGS}/updateAvailable", "")
        self.update_box.setVisible(False)
        text = f"Terrain Viewer {version} installed: the plugin reloads now (restart QGIS if anything looks off)"
        self.status.setText(text)
        if self.message_bar is not None:
            self.message_bar.pushMessage("Terrain Viewer", text, Qgis.MessageLevel.Success, 10)
        if reload:
            # From the event loop, not from this button's click: reloading
            # deletes this panel.
            def again():
                try:
                    from qgis.utils import reloadPlugin
                    reloadPlugin(updates.PLUGIN)
                except Exception as e:  # noqa: BLE001 - restart then
                    if self.message_bar is not None:
                        self.message_bar.pushMessage("Terrain Viewer", f"Restart QGIS to use {version} ({e})",
                                                     Qgis.MessageLevel.Info, 0)
            QTimer.singleShot(0, again)
        return version

    # -- the app's modes ------------------------------------------------------
    def set_mode(self, mode, save=True):
        """Terrain (the backends, the source, the light, the modes tree) or
        Historical (dated imagery, historical_ui.py). The layers of the
        other mode stay in the project: dated imagery under a hillshade is
        one picture."""
        mode = "historical" if mode == "historical" else "terrain"
        self.mode = mode
        self.mode_switch.set(mode, emit=False)
        self.terrain_page.setVisible(mode == "terrain")
        self.historical.setVisible(mode == "historical")
        if save:
            QgsSettings().setValue(f"{SETTINGS}/appMode", mode)
        if mode == "historical":
            # After the panel is laid out (and, at start, the canvas is there).
            QTimer.singleShot(0, lambda: self.mode == "historical" and self.historical.activate())
        else:
            self.historical.deactivate()

    # -- the backend --------------------------------------------------------
    def show_backend(self, backend):
        self.pages.setCurrentWidget(self.page_of[backend])
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
                self.status.setText("Packaged tile server not installed yet: Connect downloads it, checks it and starts it")
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
                                    "use the remote tile server")
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
        self.install_btn.setToolTip(f"Install the packaged tile server: download it for {local_server.platform_label()} "
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
            self.status.setText("Packaged tile server removed")
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
        self.status.setText("Downloading the packaged tile server...")

        def done(error, where=None):
            self.install_btn.setEnabled(True)
            self.local_connect.setEnabled(True)
            self.install_task = None
            self.refresh_service_row()
            if error:
                self.warn(f"The packaged tile server was not installed: {error}")
                return
            self.status.setText(f"Packaged tile server installed in {where}")
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
        self.install_task.progressChanged.connect(lambda v: self.status.setText(f"Downloading the packaged tile server... {v:.0f} %"))
        QgsApplication.taskManager().addTask(self.install_task)
        return True

    def start_bundled(self):
        """The local service's address, started if needed; None (and the
        reason in the status line) when it does not start."""
        server = local_server.instance()
        if not server.running():
            self.status.setText("Starting the packaged tile server...")
            QApplication.processEvents()
        try:
            return server.start()
        except RuntimeError as e:
            self.status.setText(f"The packaged tile server did not start: {e} (log: {server.log_path})")
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
            # No Connect for it: a thread of QGIS, started when picked and
            # when the panel opens with it picked.
            return self.connect_python()
        if backend == "local":
            if not local_server.bundled():
                if not start_bundled:
                    self.status.setText("Packaged tile server not installed: Connect installs and starts it")
                    return False
                if not local_server.installable():
                    self.warn(f"No packaged tile server for this platform ({local_server.platform_label()}): pick the remote tile server")
                    return False
                self.install_service(then=lambda: self.connect_service())
                return False
            if not local_server.instance().running() and not start_bundled:
                self.status.setText("Packaged tile server: press Connect to start it")
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
        self.update_basemap()
        self.health_timer.start()
        return True

    def connect_python(self):
        if pyb.numpy_missing():
            self.warn("The Python backend needs numpy, which this QGIS's Python lacks: pick the packaged or remote tile server")
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
        if sid is not None:
            self.status.setText(f"Python backend: {n} of {len(self.rows)} modes, elevation from {self.current_source() or sid}")
        self.schedule_all()
        self.update_basemap()
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
        """live/'s id of the source picked, registered; None (and one
        warning) when live/ cannot read it: the Python backend then draws
        nothing, never another source in its place (0.8.0 drew Mapterhorn,
        so a COG it refused showed the whole world's hillshade)."""
        src = self.current_source() or "mapterhorn"
        keys = self.key_values()
        cache_key = (src, tuple(sorted(keys.items())))
        if cache_key not in self._py_sources:
            sources = self.catalog.sources if self.catalog is not None else assets.catalog().get("sources", [])
            # A source the catalog does not list with its address (an older
            # service) is looked up in the packaged snapshot too.
            snap = assets.catalog().get("sources", [])
            listed = next((s for s in sources if s.get("id") == src), None)
            if listed is not None and listed.get("type") in ("cog", "vrt", "wms-raw") and not listed.get("address"):
                sources = snap
            sid, why = pyb.source_spec(src, sources, keys)
            if sid is None:
                self.warn(f"{why}. The Python backend draws nothing from it: pick another source, or a tile server.")
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
        basemap_state = self.basemap_row.state() if self.basemap_row is not None else None
        while self.groups_layout.count():
            item = self.groups_layout.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()
        self.rows = {}
        self.fill_sources()

        def add_group(g, parent_layout, path):
            # `group` is the layer tree's name (the layers' path), `title`
            # the panel's ("Vector overlays").
            here = path + ((g["group"],) if g.get("group") else ())
            if g.get("group"):
                box = GroupBox(g.get("title") or g["group"])
                hand_title(box)
                inner = QVBoxLayout(box)
                parent_layout.addWidget(box)
            else:
                inner = parent_layout
            for sub in g.get("groups", []):
                add_group(sub, inner, here)
            for item in g.get("items", []):
                row = ModeRow(self, here, item)
                self.rows[item["id"]] = row
                inner.addWidget(row.box)

        # The panel reads from the base up with hillshade first (Hillshade,
        # Elevation Hypso, analysis, relief, lighting, vector overlays);
        # /processes is top of the map first, and the layer tree keeps the
        # map's order (service.panel_tree).
        # The Basemap row under Elevation Hypso (the bottom of the app's
        # stack), at the end of a tree that has no such mode.
        self.basemap_row = BasemapRow(self)
        placed = False
        for g in panel_tree(self.catalog.tree):
            add_group(g, self.groups_layout, ())
            if not placed and not g.get("group") and any(it["id"] == BASEMAP_AFTER for it in g.get("items", [])):
                self.groups_layout.addWidget(self.basemap_row.box)
                placed = True
        if not placed:
            self.groups_layout.addWidget(self.basemap_row.box)
        if basemap_state is not None:
            self.basemap_row.restore(basemap_state)
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
            self._to_free()
            self.set_light(*light, schedule=False)
        base = self.stack.find(BASEMAP_KEY)
        if base is not None and self.basemap_row is not None and not self.adopted:
            self.basemap_row.adopt(base)
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
        self.refresh_raw_button()

    SOURCE_GROUPS = ("QGIS elevation layers", "Worldwide defaults", "Terrain library")

    def _source_header(self, text):
        """A group title in the source list: bold, not selectable."""
        if self.source.count():
            self.source.insertSeparator(self.source.count())
        self.source.addItem(text, None)
        item = self.source.model().item(self.source.count() - 1) if hasattr(self.source.model(), "item") else None
        if item is not None:
            item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsSelectable & ~Qt.ItemFlag.ItemIsEnabled)
            f = item.font()
            f.setBold(True)
            item.setFont(f)

    def fill_sources(self):
        """The source list in three groups: the project's plausible elevation
        layers (one band of floats or 16-bit integers, layer:<id>, kept in
        step with the project), the Worldwide defaults, the terrain library
        (the service's /terrain-sources, or the packaged snapshot). Any of
        the layers can be the elevation: read by GDAL under the Python
        backend, registered with a tile service on this machine
        (local_files.py)."""
        current = self.current_source()
        sources = self.catalog.sources if self.catalog is not None else assets.catalog().get("sources", [])
        snap_defaults = {s["id"] for s in assets.catalog().get("sources", []) if s.get("section") == "defaults"}

        def default(s):
            return s.get("section") == "defaults" or ("section" not in s and s.get("id") in snap_defaults)
        self.source.blockSignals(True)
        self.source.clear()
        layers = pyb.layer_sources(QgsProject.instance())
        groups = ((self.SOURCE_GROUPS[0], layers),
                  (self.SOURCE_GROUPS[1], [(self._source_label(s), s["id"]) for s in sources if default(s)]),
                  (self.SOURCE_GROUPS[2], [(self._source_label(s), s["id"]) for s in sources if not default(s)]))
        for title, items in groups:
            if not items:
                continue
            self._source_header(title)
            for label, data in items:
                self.source.addItem(label, data)
        self.source.blockSignals(False)
        self.set_source(current or "mapterhorn", quiet=True)

    @staticmethod
    def _source_label(s):
        return s["name"] + (f"  ({s['key']})" if s.get("key") else "")

    def refresh_layer_sources(self, *_):
        """The project's layers changed: the source list again (its first
        group), the source picked kept."""
        self.fill_sources()

    def service_source(self, src):
        """The source as the tile service takes it: a QGIS raster layer or a
        raster file on this machine registered with a service on this
        machine (file:<id>, local_files.py); anything else as it is."""
        if not pyb.is_local_source(src):
            return src
        from . import local_files
        key = (self.service_url(), src)
        if key not in self._service_sources:
            sid, why = local_files.service_source(self.service_url(), src)
            if sid is None:
                self.warn(why)
                sid = src
            self._service_sources[key] = sid
        return self._service_sources[key]

    RAW_ROOT = "Raw elevation inputs"
    RAW_PROP = "terrain_viewer/raw_input"  # on a raw input layer: the library id it shows

    def source_entry(self, src=None):
        """The catalog entry of a library source (the packaged snapshot's when
        the service lists no address for it), or None."""
        src = src or self.current_source()
        entry = self.catalog.source(src) if self.catalog is not None else None
        if entry is None or (entry.get("type") in ("cog", "vrt", "wms-raw") and not entry.get("address")):
            entry = next((s for s in assets.catalog().get("sources", []) if s.get("id") == src), entry)
        return entry

    def refresh_raw_button(self):
        if not hasattr(self, "raw_btn"):
            return
        entry = self.source_entry()
        ok = entry is not None and pyb.raw_input_address(entry) is not None
        self.raw_btn.setEnabled(ok)
        self.raw_btn.setToolTip(
            f"Add {entry.get('name')}'s raw elevation to the project as a raster layer (in \"{self.RAW_ROOT}\"): "
            "the very GDAL source the Python backend reads (/vsicurl/ for a COG or VRT, a GDAL WMS description for "
            "a WMS), to see, identify or style the raw values. It goes under the modes, its grey stretched to "
            "what the canvas shows" if ok else
            "Add a library source's raw elevation as a QGIS layer: for COG, VRT and raw WMS sources")

    def add_raw_input(self):
        """The source picked (a library COG, VRT or raw WMS) as a raster
        layer of the project, in the "Raw elevation inputs" group (kept right
        under the live group, place_raw_group), its grey following the view
        (raw_stretch); the one there already when it was added before.
        Returns the layer, or None."""
        from qgis.core import QgsRasterLayer
        src = self.current_source()
        entry = self.source_entry(src)
        address = pyb.raw_input_address(entry) if entry else None
        if address is None:
            self.warn(f"{src}: no raw elevation GDAL opens (COG, VRT and raw WMS sources only)")
            return None
        project = QgsProject.instance()
        for layer in project.mapLayers().values():
            if layer.customProperty(self.RAW_PROP) == src:
                self.status.setText(f"{layer.name()} is in the project already")
                return layer
        layer = QgsRasterLayer(address, f"{entry.get('name', src)} (raw elevation)", "gdal")
        if not layer.isValid():
            self.warn(f"{entry.get('name', src)}: GDAL did not open its raw elevation ({layer.error().summary()})")
            return None
        layer.setCustomProperty(self.RAW_PROP, src)
        raw_stretch(layer)
        self.keep_extent()
        group = self.raw_group()
        if group is None:
            group = project.layerTreeRoot().insertGroup(0, self.RAW_ROOT)
            group.setCustomProperty("terrain_viewer/raw_root", True)
        project.addMapLayer(layer, False)
        group.addLayer(layer)
        self.place_raw_group()
        self.status.setText(f"{layer.name()} added to \"{self.RAW_ROOT}\", under the modes: the GDAL source the "
                            "Python backend reads (the shaded modes multiply over it)")
        return layer

    def raw_group(self):
        root = QgsProject.instance().layerTreeRoot()
        return next((g for g in root.findGroups() if g.customProperty("terrain_viewer/raw_root")), None)

    def place_raw_group(self):
        """"Raw elevation inputs" kept right under the live group. A raw
        input is an opaque raster: above the modes (0.9.2 put the group at
        the top of the tree, so above a live group that was there already)
        it hid every one of them, and a hillshade checked next drew nothing."""
        root = QgsProject.instance().layerTreeRoot()
        raw, live = self.raw_group(), self.stack.root(create=False)
        kids = root.children()
        if raw is None or live is None or raw not in kids or live not in kids or kids.index(raw) > kids.index(live):
            return False
        moved = raw.clone()
        root.insertChildNode(kids.index(live) + 1, moved)
        root.removeChildNode(raw)
        return True

    def source_changed(self):
        self.refresh_raw_button()
        self._py_sources.clear()
        self._service_sources.clear()
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
        if self.basemap_row is not None:  # a keyed basemap offered, or no longer
            self.basemap_row.fill()
            self.update_basemap()
        self.historical.fill_sources()

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
        self._to_free()
        self.set_light(az, el)

    def _light_from_sliders(self, _v):
        self._to_free()
        self.light_pad.setValue(*self.light_value())
        self.light_changed()

    # -- the sun at a date and time -------------------------------------------
    def sun_mode(self):
        return self.light_mode.current() == "sun"

    def _to_free(self):
        """The light moved by hand: back to Free (the date stays set)."""
        if self.sun_mode():
            self.light_mode.set("free", emit=False)
            self.sun_box.setVisible(False)
            self.sun_timer.stop()

    def _light_mode_changed(self, mode):
        self.sun_box.setVisible(mode == "sun")
        if mode == "sun":
            self.apply_sun()

    def set_light_mode(self, mode):
        """"free" or "sun" (the sun applied at once)."""
        self.light_mode.set(mode)

    def _sun_from_when(self):
        """The date picker changed: the day and hour boxes follow."""
        if self._sun_sync:
            return
        dt = self.sun_when.dateTime().toUTC()
        d, t = dt.date(), dt.time()
        self._sun_sync = True
        self.sun_day.setValue(solar.day_of_year(d.month(), d.day()))
        self.sun_hour.setValue(t.hour() + t.minute() / 60)
        self._sun_sync = False
        self._sun_changed()

    def _sun_from_parts(self):
        """The day or the hour changed: the date picker follows (its year kept)."""
        if self._sun_sync:
            return
        year = self.sun_when.dateTime().toUTC().date().year()
        month, day = solar.date_of_day(self.sun_day.value(), year)
        minutes = int(round(float(self.sun_hour.value()) * 60))
        if minutes >= 24 * 60:
            minutes = 24 * 60 - 1
        self._sun_sync = True
        self.sun_when.setDateTime(QDateTime(QDate(year, month, day), QTime(minutes // 60, minutes % 60), Qt.TimeSpec.UTC))
        self._sun_sync = False
        self._sun_changed()

    def _sun_changed(self):
        if self.sun_mode():
            self.apply_sun()

    def sun_place(self):
        """(lat, lng) of the canvas centre (the last link's camera without a
        canvas), or None."""
        p = self.place()
        return (p[0], p[1]) if p else None

    def apply_sun(self):
        """The light set to the sun over the canvas centre at the date and time
        set (rounded to the degree, so a small pan rewrites nothing). Returns
        (azimuth, altitude) before rounding, or None without a place."""
        if not self.sun_mode():
            return None
        where = self.sun_place()
        if where is None:
            self.sun_info.setText("No map centre to place the sun over")
            return None
        lat, lng = where
        dt = self.sun_when.dateTime().toUTC()
        d, t = dt.date(), dt.time()
        az, alt, solar_hour = solar.sun_at(lat, lng, d.month(), d.day(), t.hour() + t.minute() / 60)
        up = alt > 0
        self.sun_info.setText(
            f"Sun over {abs(lat):.2f}° {'N' if lat >= 0 else 'S'}, {abs(lng):.2f}° {'E' if lng >= 0 else 'W'} at "
            f"{solar.format_hour(solar_hour)} solar time: azimuth {az:.0f}°, "
            + (f"elevation {alt:.0f}°" if up else f"{-alt:.0f}° below the horizon (lit from the horizon)"))
        new = (float(round(az) % 360), float(round(min(max(alt, 0.0), 90.0))))
        if new != self.light_value():
            self.set_light(*new)
        return az, alt

    def light_changed(self):
        """The light moved: the shaded modes' layers follow while it is
        dragged, throttled (a rewrite at most every LIGHT_THROTTLE_MS, the
        first at once), not debounced to half a second after the last move
        as the other settings are; the pad's release applies the last one."""
        for mid in LIGHT_MODES:
            row = self.rows.get(mid)
            if row is not None and any(row.row.on(f) for f in row.all_forms):
                self.light_pending.add(row)
                self.pending.discard(row)
        if not self.light_pending:
            return
        if self.light_wait:
            self.light_late = True  # applied when the canvas has drawn the last one
            return
        self.flush_light()  # the first move at once
        self._light_wait_start()

    def _light_wait_start(self):
        """Paced by the canvas: the next light is written once the canvas has
        drawn the last one (renderStarting then mapCanvasRefreshed) and at
        least LIGHT_THROTTLE_MS later, or after LIGHT_MAX_WAIT_MS whatever
        happens. Rewriting faster than the canvas draws only cancels its
        renders and queues tiles nobody sees."""
        self.light_wait = True
        self.light_min_done = False
        self.light_render_seen = False
        self.light_drawn = self.canvas is None  # no canvas (tests): the minimum interval alone
        self.light_timer.start(LIGHT_THROTTLE_MS["python" if self.connected == "python" else "service"])
        self.light_guard.start(LIGHT_MAX_WAIT_MS)

    def _light_tick(self):
        self.light_min_done = True
        self._light_next()

    def _canvas_render_starting(self):
        if self.light_wait:
            self.light_render_seen = True

    def _canvas_refreshed(self):
        if self.light_wait and self.light_render_seen:
            self.light_drawn = True
            self._light_next()

    def _light_next(self, force=False):
        if not self.light_wait or not (force or (self.light_min_done and self.light_drawn)):
            return
        self.light_guard.stop()
        self.light_timer.stop()
        self.light_wait = False
        if self.light_late:
            self.light_late = False
            self.flush_light()
            self._light_wait_start()

    def flush_light(self):
        rows, self.light_pending = self.light_pending, set()
        if not rows:
            return
        self.light_rewrites += 1
        for row in rows:
            if self.rows.get(row.mode["id"]) is row:
                row.update()

    def _light_released(self):
        """The drag ended: the last light written now, whatever the pace."""
        if self.light_late or self.light_pending:
            self.light_guard.stop()
            self.light_timer.stop()
            self.light_wait = False
            self.light_late = False
            self.flush_light()

    def common_params(self, mode_id=None):
        """The parameters of every layer: a share link's others, the source,
        the keys the service reads, and for the shaded modes the light."""
        out = dict(self.extra)
        src = self.current_source()
        if src:
            out["terrainSource"] = self.service_source(src)
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
            if key == BASEMAP_KEY and self.basemap_row is not None:
                by_hand = True
                self.basemap_row.row.form_removed("colour")
            elif key and key.split(":")[0] in self.rows:
                by_hand = True
                self.rows[key.split(":")[0]].row.form_removed(ModeRow.form_of(key))
        if by_hand:
            QTimer.singleShot(0, self.stack.prune)

    def cleanup(self):
        """Disconnected from the project (the plugin unloading)."""
        for signal, slot in ((QgsProject.instance().layersWillBeRemoved, self.layers_removed),
                             (QgsProject.instance().layersAdded, self.refresh_layer_sources),
                             (QgsProject.instance().layersRemoved, self.refresh_layer_sources),
                             (QgsProject.instance().cleared, self._project_cleared),
                             (QgsProject.instance().readProject, self._project_read)):
            try:
                signal.disconnect(slot)
            except (TypeError, RuntimeError):
                pass
        if self.canvas is not None:
            try:
                self.canvas.extentsChanged.disconnect(self.extent_changed)
            except (TypeError, RuntimeError):
                pass
        self.health_timer.stop()
        self.historical.cleanup()

    def _project_cleared(self):
        self.project_fresh = True

    def _project_read(self, *_):
        self.project_fresh = False

    def first_layer_setup(self):
        """QGIS's own setup for a first layer, done by the panel: the project
        in EPSG:3857 (the tiles' CRS), the canvas on the whole world."""
        crs = QgsCoordinateReferenceSystem("EPSG:3857")
        QgsProject.instance().setCrs(crs)
        if self.canvas is not None:
            if self.canvas.mapSettings().destinationCrs() != crs:
                self.canvas.setDestinationCrs(crs)
            self.canvas.setExtent(QgsRectangle(-WORLD, -WORLD, WORLD, WORLD))
            self.canvas.refresh()

    def keep_extent(self):
        """A layer is about to join the project. In a project with no spatial
        layer left (every mode unchecked, no other layer), QGIS's bridge would
        zoom the canvas to it, the whole world for tiles, and take its CRS:
        that setup is off until the bridge has seen the new layer, and the
        canvas stays where it is. Except for the panel's first layer in a
        fresh, empty project (a new project, or QGIS just started): there the
        panel does QGIS's setup itself (EPSG:3857, the whole world), whatever
        the bridge's state."""
        if any(lyr.isSpatial() for lyr in QgsProject.instance().mapLayers().values()):
            self.project_fresh = False
            return
        first, self.project_fresh = self.project_fresh, False
        if first:
            self.first_layer_setup()
        b = self.bridge
        if b is None or not b.autoSetupOnFirstLayer():
            return
        b.setAutoSetupOnFirstLayer(False)

        def restore(*_):
            try:
                b.canvasLayersChanged.disconnect(restore)
            except (TypeError, RuntimeError):
                return  # already restored
            b.setAutoSetupOnFirstLayer(True)
        b.canvasLayersChanged.connect(restore)
        QTimer.singleShot(3000, restore)  # should the bridge not update

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
        if self.mode == "historical":
            self.historical.moved()
        if self.sun_mode():
            self.sun_timer.start()
        if self.connected == "python":
            self.prefetch_timer.start()
            if any(r.row.on("vector") for r in self.rows.values()):
                self.vector_timer.start()

    def prefetch(self):
        if self.connected != "python":
            return
        from .live.layers import LocalLayers
        ext, width = self.canvas_extent()
        sid = self.python_source()
        if ext is not None and sid is not None:
            LocalLayers(self.stack.project).prefetch(ext, width, sid)
        # A hypsometric range that follows the view, read again for the new one.
        relief = self.rows.get("colorRelief")
        if relief is not None and relief.values().get("hypsoAutoRange") in (True, "true"):
            relief.py_auto_range = None
            self.schedule(relief)

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
            # A row of the tree before a rebuild (another backend connected
            # since it was scheduled) is unchecked: its update removed the
            # layers of the new row with the same key.
            if self.rows.get(row.mode["id"]) is row:
                row.update()

    # -- a share link -----------------------------------------------------
    def local_view(self, query):
        """A share link read without a service (the Python backend), as the
        app reads it: every parameter the link leaves out at the app's
        default (links.py), so showTerrainAnalysis=true alone is the slope.
        The modes on, their opacities, the link's parameters, the camera."""
        return links.local_view(query, {mid: row.mode for mid, row in self.rows.items()})

    def open_link(self, link=None):
        """A share link (any address: https://..., the desktop app's
        views://app/index.html?..., no scheme) or its query (with or without
        its "?"): its modes checked, their settings set (the app's defaults
        for the ones it leaves out), their opacities, the light, the source,
        the basemap under them when it shows one, the canvas moved to its
        camera. The backend is asked first (one clear message if it is not
        there)."""
        link = link if isinstance(link, str) else self.link.text()
        query = split_link(link)
        if not query:
            self.warn("Not a share link: paste the app's link (https://...?zoom=...&lat=...) or its query")
            return False
        hstate, hgiven = links.link_state(query)
        if hstate.get("appMode") == "historical":
            # The app's historical mode: no backend asked, the terrain modes
            # left as they are; the camera, then view A's source and date.
            self.set_mode("historical")
            if hgiven.get("lat") not in (None, "") and hgiven.get("lng") not in (None, ""):
                self.camera = (float(hgiven["lat"]), float(hgiven["lng"]), float(hgiven.get("zoom") or 12))
                self.zoom_to(*self.camera)
            self.historical.open_link(hstate)
            return True
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
        state, given = links.link_state(query)
        params = dict(view.get("params", {}))
        src = params.pop("terrainSource", None) or params.pop("terrainSourceA", None)
        if src:
            self.set_source(src, quiet=True)
            self._py_sources.clear()
        # The light: the link's, else the app's default (315, 45).
        self._to_free()
        self.set_light(float(state.get("illuminationDir", LIGHT_DEFAULT[0])),
                       float(state.get("illuminationAlt", LIGHT_DEFAULT[1])), schedule=False)
        # The opacities go to the QGIS layers (view["opacity"]), not into
        # the addresses.
        taken = {r.mode["opacityKey"] for r in self.rows.values() if r.mode.get("opacityKey")}
        taken.update(LIGHT_KEYS)
        taken.update(("terrainSource", "terrainSourceA"))
        for row in self.rows.values():
            # Every setting the link leaves out back to its default (the
            # app's, or the panel's: PANEL_DEFAULTS).
            values = {k: sw.spec["default"] for k, sw in row.settings.items() if sw.spec.get("default") is not None}
            values.update({k: v for k, v in params.items() if k in row.settings})
            row.set_values(values)
            taken.update(row.settings)
        self.extra = link_params(params, getattr(self.catalog, "inputs", set()), taken)
        active = set(view.get("active", []))
        on = 0
        for mode_id, row in self.rows.items():
            if mode_id in view.get("opacity", {}):
                row.set_opacity(view["opacity"][mode_id])
            if mode_id in active:
                forms = (row.row.checked_forms() & row.row.available) or {row.row.default_form()} - {None}
            else:
                forms = set()
            row.row.set_forms(forms)
            on += bool(forms)
        self.pending.clear()
        for row in self.rows.values():
            row.update()
        base = self.open_basemap(query)
        cam = view.get("camera") or {}
        if cam.get("lat") is not None and cam.get("lng") is not None:
            self.camera = (float(cam["lat"]), float(cam["lng"]), float(cam.get("zoom") or 12))
            self.zoom_to(*self.camera)
        if links.truthy(state.get("lightUseDatetime")):
            self.sun_from_link(state)
        skipped = len(active & set(self.rows)) - on
        self.status.setText(f"Opened: {on} modes on" + (" over the basemap" if base else "")
                            + (f" ({skipped} not drawn by this backend)" if skipped > 0 else "")
                            + (f", {len(self.extra)} other parameters kept" if self.extra else ""))
        return True

    def update_basemap(self):
        """The basemap layer as the Basemap row says (another backend, a key)."""
        return self.basemap_row.update() if self.basemap_row is not None else None

    def open_basemap(self, query):
        """A link's basemap through the Basemap row: showRasterBasemap=true
        checks it with the view's source (basemapSourceA, or basemapSource)
        and opacity; a link that shows none unchecks it. Returns the layer,
        or None."""
        row = self.basemap_row
        if row is None:
            return None
        choice = links.link_basemap(query)
        if choice is None:
            row.row.set_forms(set())
            return row.update()
        row.set_source(choice["source"], choice["params"])
        row.set_opacity(choice["opacity"])
        row.row.set_forms({"colour"})
        layer = row.update()
        row.apply_style()
        return layer

    def sun_from_link(self, state):
        """lightUseDatetime=true: the light set to the sun at the link's day
        (lightDayOfYear) and time (lightTimeOfDay), over the canvas centre.
        The panel's hour is UTC; the app's "local" time is the place's civil
        time, taken here as its longitude's mean time (lng / 15 hours from
        UTC: within an hour of the app's, which follows time zones and DST)."""
        try:
            day = int(float(state.get("lightDayOfYear", 172)))
            hour = float(state.get("lightTimeOfDay", 15))
        except (TypeError, ValueError):
            return
        if state.get("lightTimeMode", "local") != "utc":
            place = self.sun_place()
            if place is not None:
                hour -= place[1] / 15
        hour %= 24
        self._sun_sync = True
        self.sun_day.setValue(max(1, min(365, day)))
        self.sun_hour.setValue(hour)
        self._sun_sync = False
        self._sun_from_parts()
        self.set_light_mode("sun")

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
        merc = QgsCoordinateReferenceSystem("EPSG:3857")
        rect = QgsRectangle(x - w / 2 * per_px, y - h / 2 * per_px, x + w / 2 * per_px, y + h / 2 * per_px)
        dest = self.canvas.mapSettings().destinationCrs()
        if not dest.isValid():
            QgsProject.instance().setCrs(merc)
        elif dest != merc:
            # The project's CRS kept: the app's view (Web Mercator) as an
            # extent in it.
            try:
                rect = QgsCoordinateTransform(merc, dest, QgsProject.instance()).transformBoundingBox(rect)
            except Exception:  # noqa: BLE001 - a view outside the project's CRS
                QgsProject.instance().setCrs(merc)
        self.canvas.setExtent(rect)
        self.canvas.refresh()
