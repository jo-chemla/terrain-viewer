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


class LocalSection:
    """The panel's "Experimental: compute locally" box, at its top: modes
    computed in QGIS's Python (live/), no tile service. Off by default; its
    rows are built the first time it is checked (numpy is imported then)."""

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
                              "from a thread of QGIS on 127.0.0.1: no tile service, no Node. Drawn as values (QGIS's colour "
                              "ramps, Identify, raster calculator) or as grey tiles.")
        self.check.toggled.connect(dock.toggle_local)
        lay.addWidget(self.check)
        self.body = QWidget()
        self.body.setVisible(False)
        lay.addWidget(self.body)
        self.rows = {}
        self.form = None
        self.built = False
        self.timer = QTimer(dock)
        self.timer.setSingleShot(True)
        self.timer.setInterval(400)
        self.timer.timeout.connect(self.apply_all)
        self.prefetch_timer = QTimer(dock)
        self.prefetch_timer.setSingleShot(True)
        self.prefetch_timer.setInterval(150)
        self.prefetch_timer.timeout.connect(self.prefetch)
        if dock.canvas is not None:
            dock.canvas.extentsChanged.connect(self.extent_changed)

    def extent_changed(self):
        if self.check.isChecked():
            self.prefetch_timer.start()

    def build(self):
        from .live import modes  # numpy is only imported when asked
        from .live.layers import DEFAULT_ON, ORDER
        lay = QVBoxLayout(self.body)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        out = QHBoxLayout()
        out.addWidget(QLabel("Draw as"))
        self.form = QComboBox()
        self.form.addItem("Values (QGIS colour ramps, Identify)", True)
        self.form.addItem("Grey image tiles (XYZ)", False)
        self.form.setToolTip("Values: Float32 rasters read by GDAL, drawn by QGIS's own renderers (another ramp or "
                             "classification from the layer's Symbology). Grey tiles: 8-bit pictures, shown tile by tile")
        self.form.setMinimumWidth(60)
        self.form.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.form.currentIndexChanged.connect(lambda _i: self.apply_all())
        out.addWidget(self.form, 1)
        lay.addLayout(out)
        for mode in reversed(ORDER):  # the base first, as the panel's groups read
            spec = modes.MODES[mode]
            row = QWidget()
            rl = QVBoxLayout(row)
            rl.setContentsMargins(0, 0, 0, 0)
            rl.setSpacing(0)
            head = QHBoxLayout()
            check = QCheckBox(spec["label"])
            check.setChecked(mode in DEFAULT_ON)
            check.setToolTip(f"Values in {spec['unit']}")
            check.toggled.connect(lambda _on, m=mode: self.apply(m))
            head.addWidget(check, 1)
            panel = QFrame()
            panel.setVisible(False)
            form = QFormLayout(panel)
            form.setContentsMargins(18, 0, 0, 4)
            widgets = {}
            for key, default in spec["defaults"].items():
                if key in spec.get("enums", {}):
                    w = QComboBox()
                    w.addItems(list(spec["enums"][key]))
                    w.setCurrentText(str(default))
                    w.currentTextChanged.connect(lambda _v: self.timer.start())
                    get = w.currentText
                elif isinstance(default, int):
                    w = QSpinBox()
                    w.setRange(1, 256)
                    w.setValue(default)
                    w.setKeyboardTracking(False)
                    w.valueChanged.connect(lambda _v: self.timer.start())
                    get = w.value
                else:
                    w = QDoubleSpinBox()
                    w.setRange(-1e6, 1e6)
                    w.setDecimals(1)
                    w.setValue(float(default))
                    w.setKeyboardTracking(False)
                    w.valueChanged.connect(lambda _v: self.timer.start())
                    get = w.value
                widgets[key] = get
                form.addRow(_label(key, mode), w)
            if widgets:
                more = QToolButton()
                more.setText("⚙")
                more.setCheckable(True)
                more.setAutoRaise(True)
                more.setToolTip("Settings")
                more.toggled.connect(panel.setVisible)
                head.addWidget(more)
            rl.addLayout(head)
            rl.addWidget(panel)
            lay.addWidget(row)
            self.rows[mode] = (check, widgets)
        self.built = True

    def opts(self, mode):
        from .live import modes
        defaults = modes.MODES[mode]["defaults"]
        # Only what differs from the defaults goes into the address.
        return {k: get() for k, get in self.rows[mode][1].items() if str(get()) != str(defaults[k])}

    def as_values(self):
        return self.form is None or bool(self.form.currentData())

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

    def apply(self, mode):
        from .live.layers import LocalLayers
        if not self.check.isChecked():
            return
        ext, width = self.canvas_extent()
        LocalLayers().set_mode(mode, self.rows[mode][0].isChecked(), self.opts(mode), self.as_values(), ext, width)

    def apply_all(self):
        for mode in self.rows:
            self.apply(mode)

    def prefetch(self):
        from .live.layers import LocalLayers
        ext, width = self.canvas_extent()
        if ext is not None and self.check.isChecked():
            LocalLayers().prefetch(ext, width)

    def toggle(self, on):
        from .live.layers import LocalLayers
        if on and not self.built:
            self.build()
        self.body.setVisible(on)
        if on:
            self.prefetch()
            self.apply_all()
        else:
            LocalLayers().remove_all()

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

        s = QgsSettings()
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
        self.token = None
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
        if self.bundled is not None:
            # Only for the local service, only from here: never shipped,
            # never in a layer's address. Read when the service starts.
            self.token = QLineEdit(s.value(f"{SETTINGS}/earthdataToken", ""))
            self.token.setEchoMode(QLineEdit.EchoMode.Password)
            self.token.setPlaceholderText("optional, for G-LiHT's protected files")
            self.token.setToolTip("A NASA Earthdata token (https://urs.earthdata.nasa.gov, Generate Token), given to the "
                                  "local tile service as EARTHDATA_TOKEN when it starts; changing it restarts the service")
            self.token.editingFinished.connect(self.token_changed)
            src.addRow("Earthdata token", self.token)
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

    def token_changed(self):
        s = QgsSettings()
        token = self.token.text().strip()
        if token == (s.value(f"{SETTINGS}/earthdataToken", "") or ""):
            return
        s.setValue(f"{SETTINGS}/earthdataToken", token)
        if self.use_bundled() and local_server.instance().running():
            local_server.stop_instance()
            self.connect_service()

    def start_bundled(self):
        """The bundled service's address, started if needed; None (and the
        reason in the status line) when it does not start."""
        server = local_server.instance()
        if not server.running():
            self.status.setText("Starting the local tile service...")
            QApplication.processEvents()
        try:
            url = server.start(earthdata_token=self.token.text().strip() if self.token is not None else "")
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
