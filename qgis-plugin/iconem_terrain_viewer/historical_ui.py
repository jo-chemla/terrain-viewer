"""The panel's Historical mode (the app's appMode=historical): dated imagery
picked by source and date, the dates of the map's centre as a list, as ticks
on a small time axis and as the steps of QGIS's own Temporal Controller.

How the dates reach QGIS: every date is one XYZ raster layer of the group
"Historical imagery", with a fixed temporal range: its true capture date
until the next capture (a mosaic's month or year). The canvas's temporal
navigation (QgsTemporalNavigationObject) is given those ranges as its
available ranges. Its step is the panel's choice: a regular one (a week by
default; a day, a month, a year), where the slider's position is
proportional to time and each frame draws the latest capture at or before
its end, or "source timestamps" (an irregular step: one stop per date, the
controller's date is the capture's). QGIS does the filtering. The group
works without the plugin (a saved project, a layout's atlas, an animation
export).

The backend: the dated sources that are a provider's own XYZ tiles (Esri
Wayback, Planet, NASA HLS, EOX) need none, and the page says so. Google
Earth historical is listed and drawn by a tile service: while it is picked,
the page shows the panel's backend control (the very one of the Terrain
page, moved here: one setting, one connection).

The dates are listed by historical.py in a worker thread (urllib, as the
Python backend reads its tiles), the panel polling its progress: nothing
blocks the UI thread, and the list, the axis and the layers fill in as the
dates answer."""
import os
import threading

from qgis.PyQt.QtCore import Qt, QTimer, QDateTime, QDate, QTime
from qgis.PyQt.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel, QComboBox, QToolButton, QPushButton, QListWidget,
    QCheckBox, QDockWidget, QSizePolicy, QProgressBar, QLineEdit, QMainWindow, QAction, QFrame,
)
from qgis.core import (
    Qgis, QgsApplication, QgsProject, QgsRasterLayer, QgsLayerTreeGroup, QgsDateTimeRange, QgsInterval,
    QgsTemporalNavigationObject, QgsRasterLayerTemporalProperties, QgsSettings,
)

from . import historical, links
from .layers import xyz_uri
from .widgets import TickStrip, CompactOpacity, FoldSection, hand

SETTINGS = "terrain_viewer"  # not the folder name (iconem_terrain_viewer): kept, see SETTINGS in dock.py
GROUP = "Historical imagery"
ROOT_PROP = "terrain_viewer/historical_root"
PROP = "terrain_viewer/historical"  # "<source>:<ref>" (a Wayback release, a year, a mosaic)
DATE_PROP = "terrain_viewer/historical_date"  # the tick's date, ms
# QGIS's Temporal Controller panel and the action that shows it (the clock of
# the Map Navigation toolbar, View > Panels): their object names in QgisApp,
# the same in QGIS 3.44 and 4.2, whatever the language of the interface.
TEMPORAL_DOCK = "Temporal Controller"
TEMPORAL_ACTION = "mActionTemporalController"


def _scoped(new, old):
    """An enum value by its scoped name (recent QGIS) or its older one; None
    when this QGIS has neither (the panel then checks the date's layer
    instead of driving the temporal navigation)."""
    for get in (new, old):
        try:
            return get()
        except (AttributeError, ImportError):
            continue
    return None


def _unit(name):
    return _scoped(lambda: getattr(Qgis.TemporalUnit, name),
                   lambda: getattr(__import__("qgis.core", fromlist=["QgsUnitTypes"]).QgsUnitTypes, "Temporal" + name))


IRREGULAR = _unit("IrregularStep")
NAV_OFF = _scoped(lambda: Qgis.TemporalNavigationMode.NavigationOff, lambda: QgsTemporalNavigationObject.NavigationOff)
NAV_ANIMATED = _scoped(lambda: Qgis.TemporalNavigationMode.Animated, lambda: QgsTemporalNavigationObject.Animated)
FIXED_RANGE = _scoped(lambda: Qgis.RasterTemporalMode.FixedTemporalRange,
                      lambda: QgsRasterLayerTemporalProperties.ModeFixedTemporalRange)
# Checked headless in QGIS 3.44 and 4.2; the older names are those of 3.28.
TEMPORAL = None not in (IRREGULAR, NAV_OFF, NAV_ANIMATED, FIXED_RANGE)
# The controller's step: id, label, QGIS's unit (None: the dates themselves), what it does.
STEPS = (
    ("day", "Day", _unit("Days"),
     "One frame a day: the slider's position is the date, and each frame draws the latest capture at or before it. "
     "Every capture has its own frame; 14 years are some 5000 frames."),
    ("week", "Week", _unit("Weeks"),
     "One frame a week, from a Monday (the default): the slider's position is the date, and each frame draws the latest "
     "capture at or before the end of its week. Most frames change nothing, as time passes between captures."),
    ("month", "Month", _unit("Months"),
     "One frame a calendar month: a short slider. Two captures of the same month share a frame, which draws the newer."),
    ("year", "Year", _unit("Years"),
     "One frame a calendar year: each draws the newest capture of the year."),
    ("timestamps", "Source timestamps", None,
     "One stop per capture date, nothing in between: every step changes the imagery, but the stops are evenly spaced "
     "on the slider, whatever the time between them."),
)
# The step a new user gets: time runs evenly on the slider, a week a frame.
# (0.10.1's was "timestamps", under the setting historicalStep; the choice is
# kept under STEP_SETTING since, so every user starts on the week once.)
DEFAULT_STEP = "week"
STEP_SETTING = "temporalStep"


def qdatetime(ms):
    """A date in milliseconds as a UTC QDateTime at midnight of its day."""
    y, m, d = historical.ymd(ms)
    return QDateTime(QDate(y, m, d), QTime(0, 0), Qt.TimeSpec.UTC)


def qranges(ticks):
    """The ticks' spans as QGIS temporal ranges, half open."""
    return [QgsDateTimeRange(qdatetime(a), qdatetime(b), True, False) for a, b in historical.tick_ranges(ticks)]


def floor_ms(step, ms):
    """The start of the day, week (a Monday), month or year holding a date."""
    y, m, d = historical.ymd(ms)
    if step == "year":
        return historical.utc_ms(y)
    if step == "month":
        return historical.utc_ms(y, m)
    day = historical.utc_ms(y, m, d)
    if step == "week":
        return day - ((day // historical.DAY_MS + 3) % 7) * historical.DAY_MS  # 1970-01-01 was a Thursday
    return day


def scale_text(denominator):
    """A map scale as "1:250 000", to two figures."""
    if not denominator or denominator <= 0:
        return ""
    digits = max(0, len(str(int(denominator))) - 2)
    return "1:" + f"{int(round(denominator / 10 ** digits) * 10 ** digits):,}".replace(",", " ")


class _Job:
    """One listing running in a worker thread; the panel reads it from a timer."""

    def __init__(self, key):
        self.key = key
        self.lock = threading.Lock()
        self.ticks, self.note, self.version = [], "", 0
        self.dated, self.total = 0, 0
        self.done, self.error, self.cancel = False, None, False

    def report(self, ticks, note, dated=0, total=0):
        with self.lock:
            self.ticks, self.note, self.version = ticks, note, self.version + 1
            self.dated, self.total = dated, total

    def finish(self, ticks=None, error=None):
        with self.lock:
            if ticks is not None:
                self.ticks = ticks
            self.error, self.done, self.version = error, True, self.version + 1

    def read(self):
        with self.lock:
            return self.version, list(self.ticks), self.note, self.done, self.error, self.dated, self.total


class HistoricalPanel(QWidget):
    def __init__(self, dock):
        super().__init__(dock)
        self.dock = dock
        self.fetch = historical.fetch_url  # replaced in the tests
        self.sid = None  # the dated source drawn
        self.ticks, self.index = [], -1
        self.target_ms = None  # the date asked for (a pick, a link); None: the newest
        self.listed_key = None  # the place the dates are, or are being, listed for
        self.shown_key = None  # the place of the dates shown
        self.final = True  # False while the dates shown are still arriving
        self.job, self.job_seen = None, -1
        self._driving = self._applying = False
        self._nav = None
        self.temporal_wanted = True  # False once the user turns the Temporal Controller off
        self.active = False
        self.paused = False  # Remove pressed: nothing listed again until asked
        self.shown_sid = None  # the source whose dates are shown
        s = QgsSettings()
        step = str(s.value(f"{SETTINGS}/{STEP_SETTING}", DEFAULT_STEP))
        usable = [i for i, _l, unit, _t in STEPS if unit is not None or i == "timestamps"]
        self.step = step if step in usable else DEFAULT_STEP if DEFAULT_STEP in usable else "timestamps"
        self.frame = None  # (start ms, end ms) of the controller's frame under a regular step

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        row = QHBoxLayout()
        row.addWidget(QLabel("Imagery"))
        self.source = QComboBox()
        self.source.setMinimumWidth(60)
        self.source.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.source.setMinimumContentsLength(10)
        self.source.setToolTip("The imagery under the map: a historical source (its dates below), or one of the "
                               "worldwide default basemaps (one current mosaic, no dates)")
        row.addWidget(self.source, 1)
        self.opacity = CompactOpacity(1.0)
        self.opacity.opacityChanged.connect(lambda _v: self.apply_opacity())
        row.addWidget(self.opacity)
        lay.addLayout(row)
        # Where the tiles come from: a source that needs no backend says so;
        # one a tile service draws (Google Earth historical) gets the
        # panel's backend control here, the Terrain page's own (the dock
        # moves it: place_backend_box).
        self.origin = QLabel()
        self.origin.setWordWrap(True)
        self.origin.setEnabled(False)  # the quiet grey of a disabled label
        f = self.origin.font()
        f.setPointSizeF(max(6.0, f.pointSizeF() - 1))
        self.origin.setFont(f)
        lay.addWidget(self.origin)
        self.backend_slot = QVBoxLayout()
        self.backend_slot.setContentsMargins(0, 0, 0, 0)
        lay.addLayout(self.backend_slot)

        # What the user must know before reading the dates: the view is too
        # wide for capture dates, or the dates are those of another place.
        self.notice = QLabel()
        self.notice.setWordWrap(True)
        self.notice.setFrameShape(QFrame.Shape.StyledPanel)
        self.notice.setMargin(4)
        self.notice.setVisible(False)
        lay.addWidget(self.notice)
        self.progress = QProgressBar()
        self.progress.setTextVisible(False)
        self.progress.setMaximumHeight(6)
        self.progress.setVisible(False)
        lay.addWidget(self.progress)

        nav = QHBoxLayout()
        self.prev_btn, self.next_btn, self.refresh_btn = QToolButton(), QToolButton(), QToolButton()
        self.prev_btn.setArrowType(Qt.ArrowType.LeftArrow)
        self.prev_btn.setToolTip("The previous (older) date")
        self.next_btn.setArrowType(Qt.ArrowType.RightArrow)
        self.next_btn.setToolTip("The next (newer) date")
        icon = QgsApplication.getThemeIcon("/mActionRefresh.svg")
        if icon is not None and not icon.isNull():
            self.refresh_btn.setIcon(icon)
        else:
            self.refresh_btn.setText("List")
        self.refresh_btn.setToolTip("List the dates at the map's centre again")
        self.current_label = QLabel("No date")
        f = self.current_label.font()
        f.setBold(True)
        self.current_label.setFont(f)
        self.current_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.current_label.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        self.prev_btn.clicked.connect(lambda _c=False: self.step_by(-1))
        self.next_btn.clicked.connect(lambda _c=False: self.step_by(1))
        self.refresh_btn.clicked.connect(lambda _c=False: self.refresh(force=True))
        nav.addWidget(self.prev_btn)
        nav.addWidget(self.current_label, 1)
        nav.addWidget(self.next_btn)
        nav.addWidget(self.refresh_btn)
        lay.addLayout(nav)

        self.strip = TickStrip()
        self.strip.picked.connect(self.pick)
        lay.addWidget(self.strip)
        self.dates = QListWidget()
        self.dates.setMaximumHeight(170)
        self.dates.setToolTip("The dates available at the map's centre, the newest first")
        self.dates.currentRowChanged.connect(self._row_picked)
        lay.addWidget(self.dates)
        self.detail = QLabel()
        self.detail.setWordWrap(True)
        lay.addWidget(self.detail)
        # Under a regular step: the controller's frame, and the capture it draws.
        self.frame_label = QLabel()
        self.frame_label.setWordWrap(True)
        self.frame_label.setVisible(False)
        lay.addWidget(self.frame_label)

        opts = QHBoxLayout()
        self.follow = QCheckBox("Follow the map")
        self.follow.setChecked(True)
        self.follow.setToolTip("List the dates again when the map's centre moves to another tile")
        opts.addWidget(self.follow)
        opts.addStretch(1)
        self.remove_btn = QPushButton("Remove")
        self.remove_btn.setToolTip(f"Remove the \"{GROUP}\" group from the project")
        self.remove_btn.clicked.connect(lambda _c=False: self.remove())
        opts.addWidget(self.remove_btn)
        lay.addLayout(opts)

        # QGIS's Temporal Controller: its panel, and the step of its slider.
        tc = QHBoxLayout()
        self.temporal_btn = QPushButton("Temporal Controller")
        self.temporal_btn.setToolTip("Show QGIS's Temporal Controller panel (View > Panels): its slider steps through "
                                     "these dates, and it plays and exports them")
        self.temporal_btn.clicked.connect(lambda _c=False: self.show_temporal_controller())
        tc.addWidget(self.temporal_btn)
        tc.addWidget(QLabel("step"))
        self.step_box = QComboBox()
        for i, (sid, label, unit, tip) in enumerate(STEPS):
            if unit is None and sid != "timestamps":
                continue  # a unit this QGIS does not have
            self.step_box.addItem(label, sid)
            self.step_box.setItemData(self.step_box.count() - 1, tip, Qt.ItemDataRole.ToolTipRole)
        self.step_box.setCurrentIndex(max(0, self.step_box.findData(self.step)))
        self.step_box.setToolTip("The step of the Temporal Controller's slider. Day, week (the default), month, year: "
                                 "frames of equal duration, so the slider's position is the date; each frame draws the "
                                 "latest capture at or before it, each layer standing from its true capture date until "
                                 "the next one. Source timestamps: one stop per capture date, evenly spaced.")
        self.step_box.currentIndexChanged.connect(lambda _i: self.set_step(self.step_box.currentData()))
        tc.addWidget(self.step_box, 1)
        lay.addLayout(tc)

        # The keys of the dated sources, folded as the Terrain mode's API keys.
        icon = next((i for i in (QgsApplication.getThemeIcon(n) for n in ("/locked.svg", "/mIconLock.svg"))
                     if i is not None and not i.isNull()), None)
        self.keys_section = FoldSection("API keys", icon)
        kform = QFormLayout()
        kform.setContentsMargins(0, 0, 0, 0)
        self.keys = {}
        for k, label in historical.KEYS:
            e = QLineEdit(str(s.value(f"{SETTINGS}/{k}", "") or ""))
            e.setEchoMode(QLineEdit.EchoMode.Password)
            e.setPlaceholderText("for Planet's monthly and quarterly basemaps")
            e.setToolTip(f"{label} key ({k}), kept in QGIS's settings with the Terrain mode's keys. It goes into the "
                         "address of each Planet layer (a project saved with them holds it) and nowhere else: no "
                         "message or log of the panel shows it. Every tile counts against the key's quota.")
            e.editingFinished.connect(self.keys_changed)
            self.keys[k] = e
            kform.addRow(label, e)
        self.keys_section.body_layout.addLayout(kform)
        lay.addWidget(self.keys_section)

        self.status = QLabel()
        self.status.setWordWrap(True)
        lay.addWidget(self.status)
        lay.addStretch(1)
        hand(self.prev_btn, self.next_btn, self.refresh_btn, self.follow, self.temporal_btn, self.remove_btn)

        historical.set_store(os.path.join(QgsApplication.qgisSettingsDirPath(), "terrain_viewer", "wayback-dates.json"))
        self.fill_sources()
        self.source.currentIndexChanged.connect(lambda _i: self.source_changed())
        self.poll = QTimer(self)
        self.poll.setInterval(400)
        self.poll.timeout.connect(self._poll)
        self.move_timer = QTimer(self)
        self.move_timer.setSingleShot(True)
        self.move_timer.setInterval(900)
        self.move_timer.timeout.connect(lambda: self.refresh())
        self.show_current()
        self.update_notice()

    # -- keys, the tile service ---------------------------------------------------
    def key_values(self):
        return {k: e.text().strip() for k, e in self.keys.items() if e.text().strip()}

    def keys_changed(self):
        s = QgsSettings()
        for k, e in self.keys.items():
            s.setValue(f"{SETTINGS}/{k}", e.text().strip())
        self.fill_sources()
        kind, sid = self.current()
        if self.active and kind == "dated" and (historical.source(sid) or {}).get("key"):
            self.refresh()

    def service(self):
        """The tile service connected (Packaged or Remote tile server), or None."""
        dock = self.dock
        if getattr(dock, "connected", None) in ("local", "remote"):
            return (dock.service_url() or "").rstrip("/") or None
        return None

    def needs_backend(self):
        """Whether the source picked is listed and drawn by a tile service:
        the page then shows the panel's backend control."""
        kind, sid = self.current()
        return kind == "dated" and bool((historical.source(sid) or {}).get("service"))

    def backend_changed(self):
        """The dock connected to another backend, or lost it: the sources a
        tile service draws are offered or not, their layers follow its address."""
        self.fill_sources()
        kind, sid = self.current()
        if self.active and not self.paused and kind == "dated" and (historical.source(sid) or {}).get("service"):
            self.refresh()

    # -- the source ------------------------------------------------------------
    def _header(self, text):
        if self.source.count():
            self.source.insertSeparator(self.source.count())
        self.source.addItem(text, None)
        self._disable(self.source.count() - 1, bold=True)

    def _disable(self, index, bold=False):
        item = self.source.model().item(index) if hasattr(self.source.model(), "item") else None
        if item is not None:
            item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsSelectable & ~Qt.ItemFlag.ItemIsEnabled)
            if bold:
                f = item.font()
                f.setBold(True)
                item.setFont(f)

    def fill_sources(self):
        """Two groups: the historical sources (dated; one that cannot be
        used now is greyed out with its reason), then the app's worldwide
        default basemaps (the Basemap row's choices, undated)."""
        current = self.source.currentData()
        keys, service = self.key_values(), self.service()
        self.source.blockSignals(True)
        self.source.clear()
        self._header("Historical sources")
        for s in historical.SOURCES:
            why = historical.unavailable(s["id"], keys, service)
            short = "needs a Planet key" if s.get("key") else "needs a tile server backend"
            self.source.addItem(s["name"] + (f" ({short})" if why else ""), "dated:" + s["id"])
            self.source.setItemData(self.source.count() - 1, s["about"] + (f" Now: it {why}." if why else ""),
                                    Qt.ItemDataRole.ToolTipRole)
            # A source that waits for a key is greyed out; one that waits
            # for a tile server can be picked: the backend control then
            # shows on this page, to connect one.
            if why and not s.get("service") and current != "dated:" + s["id"]:
                self._disable(self.source.count() - 1)
        self._header("Worldwide defaults (no dates)")
        for sid, name in links.basemap_choices(self.dock.key_values() if hasattr(self.dock, "keys") else {}):
            self.source.addItem(name, "basemap:" + sid)
        i = self.source.findData(current or "dated:wayback")
        self.source.setCurrentIndex(i if i >= 0 else self.source.findData("dated:wayback"))
        self.source.blockSignals(False)
        self.show_origin()

    def show_origin(self):
        """One quiet line: where the tiles of the source picked come from."""
        kind, sid = self.current()
        s = historical.source(sid) if kind == "dated" else None
        if s is not None and s.get("service"):
            service = self.service()
            self.origin.setText(f"Dates and tiles through the tile server backend at {service}, which reads Google "
                                "Earth and reprojects it to Web Mercator. The backend below is the Terrain mode's." if service else
                                "Google Earth's tiles are not Web Mercator: a tile server backend lists and "
                                "reprojects them. Pick Packaged tile server or Remote tile server below and Connect "
                                "(the same backend as the Terrain mode's; the Python backend does not read Google Earth).")
        elif kind == "dated":
            self.origin.setText(f"{s['short'] if s else 'This source'} needs no backend: its tiles are the provider's own "
                                "XYZ address, read by QGIS itself (not the Python backend, not a tile server).")
        else:
            self.origin.setText("No backend needed: the provider's own XYZ tiles, through the Basemap row of the Terrain mode.")
        place = getattr(self.dock, "place_backend_box", None)
        if place is not None:
            place()

    def current(self):
        """("dated" or "basemap", id) of the imagery picked."""
        kind, _, sid = str(self.source.currentData() or "dated:wayback").partition(":")
        return kind, sid

    def set_source(self, sid, kind="dated"):
        i = self.source.findData(f"{kind}:{sid}")
        if i < 0:
            return False
        self.source.blockSignals(True)
        self.source.setCurrentIndex(i)
        self.source.blockSignals(False)
        self.show_origin()
        return True

    def source_changed(self):
        self.listed_key = None
        self.paused = False
        self.show_origin()
        self.refresh()

    # -- listing ----------------------------------------------------------------
    def activate(self):
        """The mode shown: the dates of the place listed (again if it moved)."""
        self.active = True
        self.fill_sources()
        if not self.paused:
            self.refresh()

    def deactivate(self):
        self.active = False
        self.move_timer.stop()

    def place_now(self):
        """(lat, lng, zoom) the source picked lists its dates at, or None."""
        kind, sid = self.current()
        s = historical.source(sid) if kind == "dated" else None
        if s is None or not s["per_place"]:
            return None
        return self.dock.place()

    def key_now(self):
        """The place key of the source picked at the map's centre now."""
        kind, sid = self.current()
        if kind != "dated" or historical.source(sid) is None:
            return None
        place = self.place_now() or (0.0, 0.0, 0.0)
        return historical.place_key(sid, *place, self.key_values(), self.service())

    def moved(self):
        """The canvas moved (the dock tells): said at once when the dates
        shown are no longer those of the centre, listed again once it settles."""
        kind, sid = self.current()
        if not (self.active and kind == "dated" and historical.source(sid)["per_place"]):
            return
        self.update_notice()
        if not self.paused and self.follow.isChecked():
            self.move_timer.start()

    def cancel_job(self):
        if self.job is not None:
            self.job.cancel = True
            self.job = None
        self.poll.stop()
        self.progress.setVisible(False)

    def refresh(self, force=False, wait=False):
        """The dates of the source picked at the map's centre, listed in a
        worker thread (`wait`: in this one, for the tests); a worldwide
        default basemap goes to the Basemap row. Returns True when a listing
        was applied or started."""
        kind, sid = self.current()
        if kind == "basemap":
            return self.show_static(sid)
        s = historical.source(sid)
        keys, service = self.key_values(), self.service()
        why = historical.unavailable(sid, keys, service)
        if why:
            self.cancel_job()
            self.listed_key = None
            self.sid = sid
            self.clear_layers()  # its layers too: a Planet layer holds the key that was removed
            self.status.setText(f"{s['name']} {why}")
            self.update_notice()
            return False
        lat = lng = zoom = 0.0
        if s["per_place"]:
            place = self.dock.place()
            if place is None:
                self.status.setText("No map to read the place from")
                return False
            lat, lng, zoom = place
        key = historical.place_key(sid, lat, lng, zoom, keys, service)
        if not force and key == self.listed_key:
            self.update_notice()
            return False
        if force:
            historical.forget(key)
            self.paused = False
        self.cancel_job()
        self.listed_key, self.sid = key, sid
        if self.shown_sid != sid:
            self.shown_key = None
        known = historical.cached(sid, lat, lng, zoom, keys, service)
        if known is not None:
            self.apply(known, True)
            return True
        args = dict(fetch=self.fetch, keys=keys, service=service, target_ms=self.target_ms)
        if wait or sid in ("eox-s2", "hls"):  # no request: listed at once
            try:
                ticks = historical.list_dates(sid, lat, lng, zoom, **args)
            except Exception as e:  # noqa: BLE001 - the network, said in the panel
                self.failed(e)
                return False
            self.apply(ticks or [], True)
            return True
        job = self.job = _Job(key)
        self.job_seen = -1
        self.status.setText(f"{s['short']}: listing the dates here...")
        self.progress.setRange(0, 0)  # busy until the releases are known
        self.progress.setVisible(True)
        self.update_notice()

        def run():
            try:
                job.finish(historical.list_dates(sid, lat, lng, zoom, report=job.report, cancelled=lambda: job.cancel, **args))
            except Exception as e:  # noqa: BLE001 - read by the panel's timer
                job.finish(error=historical.scrub(e) or type(e).__name__)
        threading.Thread(target=run, name="terrain-viewer-historical", daemon=True).start()
        self.poll.start()
        return True

    def _poll(self):
        job = self.job
        if job is None:
            self.poll.stop()
            return
        version, ticks, note, done, error, dated, total = job.read()
        if version == self.job_seen:
            return
        self.job_seen = version
        if total:
            self.progress.setRange(0, total)
            self.progress.setValue(dated)
        if done:
            self.job = None
            self.poll.stop()
            self.progress.setVisible(False)
            if error:
                self.failed(error)
                return
        if done or ticks:
            # The dates known so far, as they answer: the list, the axis and
            # the layers fill in, the previous place's layers staying until
            # the list is whole.
            self.apply(ticks, done)
        if not done:
            if note:
                self.status.setText(note)
            self.update_notice()

    def failed(self, error):
        self.listed_key = None
        error = historical.scrub(error)
        self.dock.warn(f"Historical imagery: the dates could not be listed ({error})")
        self.status.setText(f"The dates could not be listed: {error}")
        self.update_notice()

    def update_notice(self):
        """The line above the dates: the view too wide for capture dates
        (and the zoom needed), or the dates shown being those of another
        place, or still arriving."""
        kind, sid = self.current()
        s = historical.source(sid) if kind == "dated" else None
        text = ""
        if s is not None and s["per_place"] and not historical.unavailable(sid, self.key_values(), self.service()):
            place = self.dock.place()
            job = self.job
            _v, _t, _n, _d, _e, dated, total = job.read() if job is not None else (0, [], "", True, None, 0, 0)
            count = f" ({dated} of {total} releases dated)" if total else ""
            key = historical.place_key(sid, *place, self.key_values(), self.service()) if place else None
            if place and historical.too_wide(sid, place[2]):
                need = self.dock.canvas.scale() / 2 ** (historical.MIN_PLACE_ZOOM - place[2]) if self.dock.canvas is not None else 0
                text = (f"Zoom in to see the capture dates. {s['short']} dates a place from zoom "
                        f"{int(round(historical.MIN_PLACE_ZOOM + 0.5))} on"
                        + (f" (about {scale_text(need)} here)" if need else "")
                        + f"; the map is at zoom {place[2]:.1f}. Until then only the newest release is listed: a wider "
                          "view has no one date.")
            elif self.ticks and self.shown_sid == sid and self.shown_key and key and self.shown_key != key:
                if job is not None:
                    text = f"The map moved: these dates are of the previous place. Updating{count}..."
                elif self.paused:
                    text = ""
                elif not self.follow.isChecked():
                    text = ("The map moved: these dates are of the previous place (Follow the map is off: the list "
                            "button updates them).")
                else:
                    text = "The map moved: these dates are of the previous place. Updating..."
            elif job is not None and not self.final:
                text = f"Dates still arriving{count}: the list, the axis and the layers fill in as they answer."
        self.notice.setText(("⚠ " + text) if text else "")
        self.notice.setVisible(bool(text))

    # -- the dates applied -------------------------------------------------------
    def apply(self, ticks, final=True):
        """A list of ticks (complete, or what is known so far): its layers,
        the list, the axis, the Temporal Controller; the date shown is the
        one asked for, or the nearest."""
        self.ticks = list(ticks)
        self.shown_sid = self.sid
        self.shown_key = self.listed_key
        self.final = final
        self.index = historical.nearest(self.ticks, self.target_ms)
        row = getattr(self.dock, "basemap_row", None)
        # While the layers change, QGIS's Temporal Controller reads the
        # project's ranges again and moves its frame: not a move of the user's.
        self._applying = True
        try:
            if self.ticks and row is not None and row.row.on("colour"):
                row.row.set_forms(set())  # one basemap at a time: the dated imagery is it
                row.update()
            self.sync_layers(keep_stale=not final)
            self.fill_dates()
        finally:
            self._applying = False
        self.drive()
        self.update_notice()
        s = historical.source(self.sid)
        if final and any(t.get("wide") for t in self.ticks):
            self.status.setText(f"{s['short']}: {self.ticks[0]['label']}")
        elif final:
            unsure = sum(1 for t in self.ticks if not t.get("real", True))
            self.status.setText(
                (f"{s['short']}: {len(self.ticks)} dates" + (" here" if s["per_place"] else "") if self.ticks
                 else f"{s['short']}: no dated imagery listed here")
                + (f" ({unsure} at their release date: the capture date did not answer)" if unsure and self.sid == "wayback" else "")
                + (". QGIS's Temporal Controller steps through them." if self.ticks and self.nav() is not None else ""))

    def group(self, create=False):
        live = self.dock.stack.root(create=create)
        if live is None:
            return None
        g = next((c for c in live.children() if isinstance(c, QgsLayerTreeGroup) and c.customProperty(ROOT_PROP)), None)
        if g is None and create:
            g = live.addGroup(GROUP)  # at the bottom: the basemap's place
            g.setCustomProperty(ROOT_PROP, True)
        return g

    def layers(self):
        """{key: layer} of the dated layers in the project."""
        g = self.group()
        out = {}
        for node in (g.findLayers() if g is not None else []):
            if node.layer() is not None and node.layer().customProperty(PROP):
                out[node.layer().customProperty(PROP)] = node.layer()
        return out

    @staticmethod
    def _date_of(node):
        layer = node.layer() if hasattr(node, "layer") else None
        try:
            return int(layer.customProperty(DATE_PROP)) if layer is not None else 0
        except (TypeError, ValueError):
            return 0

    def sync_layers(self, keep_stale=False):
        """One XYZ layer per tick in the group, the newest on top, each with
        its fixed temporal range: a layer that stays (the same release) is
        kept, so a pan that lists the same captures redraws nothing. With
        `keep_stale` (the dates still arriving) the layers the list does not
        name yet stay, so the imagery on screen does not go and come back."""
        project = QgsProject.instance()
        have = self.layers()
        wanted = {f"{self.sid}:{t['ref']}" for t in self.ticks}
        gone = [layer.id() for key, layer in have.items()
                if key not in wanted and not (keep_stale and key.startswith(f"{self.sid}:"))]
        if gone:
            self.drop(gone)
        if not self.ticks:
            if not keep_stale:
                self.dock.stack.prune()
            return
        s = historical.source(self.sid)
        group = self.group(create=True)
        group.setName(f"{GROUP} ({s['short']})")
        added = 0
        ranges = qranges(self.ticks)
        # The newest date stays drawn after its span: QGIS counts a month as
        # 30 days when it numbers the frames of a regular step, so a slider
        # of months or years ends a few frames past the last date, and those
        # would draw nothing.
        ranges[-1] = QgsDateTimeRange(ranges[-1].begin(), qdatetime(historical.utc_ms(2200)), True, False)
        for t, rng in zip(self.ticks, ranges):
            key = f"{self.sid}:{t['ref']}"
            name = f"{t['label']} · {s['short']}"
            uri = xyz_uri(t["url"], t["maxzoom"])
            layer = have.get(key)
            if layer is None:
                layer = QgsRasterLayer(uri, name, "wms")
                layer.setCustomProperty(PROP, key)
                layer.setCustomProperty(DATE_PROP, str(t["dateMs"]))
                self.dock.keep_extent()
                project.addMapLayer(layer, False)
                added += 1
                group.insertLayer(sum(1 for n in group.children() if self._date_of(n) > t["dateMs"]), layer)
                if layer.renderer() is not None:
                    layer.renderer().setOpacity(self.opacity.opacity())
            else:
                if layer.source() != uri:  # another key, another tile service address
                    layer.setDataSource(uri, name, "wms")
                if layer.name() != name:
                    layer.setName(name)
                layer.setCustomProperty(DATE_PROP, str(t["dateMs"]))
            if TEMPORAL:
                props = layer.temporalProperties()
                props.setMode(FIXED_RANGE)
                props.setFixedTemporalRange(rng)
                props.setIsActive(True)
        if added > 12:
            group.setExpanded(False)  # a month a layer: 80 to 130 of them

    def apply_opacity(self):
        for layer in self.layers().values():
            if layer.renderer() is not None:
                layer.renderer().setOpacity(self.opacity.opacity())
                layer.triggerRepaint()

    def remove(self):
        """The group and its layers out of the project."""
        self.cancel_job()
        self.clear_layers()
        self.paused = True
        self.status.setText("Historical imagery removed (the list button lists the dates again)")
        self.update_notice()

    def clear_layers(self):
        self.ticks, self.index, self.listed_key, self.shown_key, self.final = [], -1, None, None, True
        self.drop([layer.id() for layer in self.layers().values()])
        self.dock.stack.prune()
        self.fill_dates()

    def drop(self, ids):
        """Layers out of the project, the canvas's drawing stopped first:
        QGIS waits on the tile requests of XYZ layers removed while they
        draw (measured headless: five layers mid-draw, the event loop held
        for minutes; none once the rendering is stopped)."""
        if not ids:
            return
        if self.dock.canvas is not None:
            self.dock.canvas.stopRendering()
        QgsProject.instance().removeMapLayers(ids)

    def show_static(self, sid):
        """A worldwide default basemap: no dates, the Basemap row draws it
        (the one way a basemap layer is made)."""
        self.cancel_job()
        self.clear_layers()
        self.update_notice()
        row = getattr(self.dock, "basemap_row", None)
        if row is None:
            return False
        row.set_source(sid)
        row.row.set_forms({"colour"})
        layer = row.update()
        self.status.setText(f"{layer.name() if layer is not None else sid}: one current mosaic, no dates "
                            "(the Basemap row of the Terrain mode)")
        return layer is not None

    # -- the date shown ---------------------------------------------------------
    def fill_dates(self):
        self.dates.blockSignals(True)
        self.dates.clear()
        for t in reversed(self.ticks):
            self.dates.addItem(t["label"])
            self.dates.item(self.dates.count() - 1).setToolTip(t.get("detail", ""))
        self.dates.blockSignals(False)
        self.strip.set_ticks([(t["dateMs"], t["label"], t.get("real", True)) for t in self.ticks], self.index)
        self.show_current()

    def show_current(self):
        n, i = len(self.ticks), self.index
        ok = 0 <= i < n
        self.current_label.setText(self.ticks[i]["label"] if ok else "No date")
        self.detail.setText(self.ticks[i].get("detail", "") if ok else "")
        self.show_frame()
        self.prev_btn.setEnabled(ok and i > 0)
        self.next_btn.setEnabled(ok and i < n - 1)
        self.remove_btn.setEnabled(bool(self.ticks))
        self.strip.set_current(i)
        self.dates.blockSignals(True)
        self.dates.setCurrentRow(n - 1 - i if ok else -1)
        self.dates.blockSignals(False)

    def frame_text(self):
        """Under a regular step with the controller on: the frame it is at
        and the capture that frame draws, e.g. "Controller: week of
        2019-06-03. Imagery: captured 2018-09-11, the latest at or before
        it." Empty otherwise (source timestamps: the frame is the capture)."""
        if self.frame is None or self.step == "timestamps" or not 0 <= self.index < len(self.ticks):
            return ""
        t = self.ticks[self.index]
        start = historical.day_label(self.frame[0])
        what = {"day": start, "week": f"week of {start}", "month": f"month of {start[:7]}", "year": f"year {start[:4]}"}[self.step]
        if t.get("endMs"):  # a mosaic: its own span, not a capture
            return f"Controller: {what}. Imagery: {t['label']}."
        same = self.frame[0] <= t["dateMs"] < self.frame[1]
        return (f"Controller: {what}. Imagery: captured {historical.day_label(t['dateMs'])}"
                + (", in this frame." if same else ", the latest at or before it."))

    def show_frame(self):
        text = self.frame_text() if self.temporal_on() else ""
        self.frame_label.setText(text)
        self.frame_label.setVisible(bool(text))

    def _row_picked(self, row):
        if 0 <= row < len(self.ticks):
            self.pick(len(self.ticks) - 1 - row)

    def step_by(self, by):
        self.pick(self.index + by)

    def pick(self, index):
        """A date picked in the panel: its layer drawn, the Temporal
        Controller moved to it."""
        if not 0 <= index < len(self.ticks):
            return False
        self.index = index
        self.target_ms = self.ticks[index]["dateMs"]
        self.show_current()
        self.drive()
        return True

    def pick_date(self, ms):
        """The date nearest `ms` (a link's), now or once the dates are listed."""
        self.target_ms = ms or None
        if self.ticks:
            self.pick(historical.nearest(self.ticks, self.target_ms))

    # -- QGIS's temporal navigation ----------------------------------------------
    def nav(self):
        """The canvas's temporal navigation (the Temporal Controller's), or None."""
        canvas = self.dock.canvas
        c = canvas.temporalController() if canvas is not None and hasattr(canvas, "temporalController") else None
        nav = c if TEMPORAL and isinstance(c, QgsTemporalNavigationObject) else None
        if nav is not self._nav:
            self._unwatch()
            self._nav = nav
            if nav is not None:
                # Only this signal: a Python slot on navigationModeChanged
                # crashes QGIS 3.44 (Qt 5) when it is emitted, and a change
                # of mode emits updateTemporalRange too.
                nav.updateTemporalRange.connect(self._nav_range)
        return nav

    def _unwatch(self):
        if self._nav is not None:
            try:
                self._nav.updateTemporalRange.disconnect(self._nav_range)
            except (TypeError, RuntimeError):
                pass
        self._nav = None

    def temporal_on(self):
        nav = self.nav()
        return nav is not None and nav.navigationMode() != NAV_OFF

    def step_unit(self):
        return next((unit for sid, _l, unit, _t in STEPS if sid == self.step), None)

    def set_step(self, step):
        """The Temporal Controller's step, kept in QGIS's settings."""
        if not any(sid == step and (unit is not None or sid == "timestamps") for sid, _l, unit, _t in STEPS):
            return False
        self.step = step
        self.frame = None
        QgsSettings().setValue(f"{SETTINGS}/{STEP_SETTING}", step)
        i = self.step_box.findData(step)
        if i != self.step_box.currentIndex():
            self.step_box.blockSignals(True)
            self.step_box.setCurrentIndex(i)
            self.step_box.blockSignals(False)
        self.drive()
        return True

    def drive(self):
        """The Temporal Controller given the dates: its available ranges are
        the ticks' spans, its frame the date shown, the canvas drawn at that
        frame. Step "source timestamps": one frame per date. A regular step:
        frames of one day, week, month or year from the start of the first
        date's, the frame being the one that holds the date; when a newer
        capture begins in the same frame QGIS draws that one, and the panel
        shows it. When the user has turned the controller off, the date's
        layer is the one checked instead."""
        nav = self.nav()
        ranges = qranges(self.ticks)
        if nav is not None and ranges and 0 <= self.index < len(ranges):
            self._driving = True
            try:
                if self.temporal_wanted and nav.navigationMode() != NAV_ANIMATED:
                    nav.setNavigationMode(NAV_ANIMATED)
                if nav.navigationMode() != NAV_OFF:
                    unit = self.step_unit()
                    nav.setAvailableTemporalRanges(ranges)
                    if unit is None:
                        self.frame = None
                        if nav.frameDuration().originalUnit() != IRREGULAR:
                            nav.setFrameDuration(QgsInterval(1, IRREGULAR))
                        nav.setTemporalExtents(QgsDateTimeRange(ranges[0].begin(), ranges[-1].end(), True, False))
                        nav.setCurrentFrameNumber(self.index)
                        self.dock.canvas.setTemporalRange(ranges[self.index])
                    else:
                        spans = historical.tick_ranges(self.ticks)
                        if nav.frameDuration().originalUnit() != unit or nav.frameDuration().originalDuration() != 1:
                            nav.setFrameDuration(QgsInterval(1, unit))
                        nav.setTemporalExtents(QgsDateTimeRange(qdatetime(floor_ms(self.step, spans[0][0])), ranges[-1].end(),
                                                                True, False))
                        frame = nav.findBestFrameNumberForFrameStart(qdatetime(floor_ms(self.step, spans[self.index][0])))
                        nav.setCurrentFrameNumber(frame)
                        rng = nav.dateTimeRangeForFrameNumber(frame)
                        self.dock.canvas.setTemporalRange(rng)
                        self.frame = (rng.begin().toMSecsSinceEpoch(), rng.end().toMSecsSinceEpoch())
                        drawn = historical.index_in(self.ticks, rng.begin().toMSecsSinceEpoch(), rng.end().toMSecsSinceEpoch())
                        if drawn != self.index and drawn >= 0:
                            asked = self.ticks[self.index]["label"]
                            self.index = drawn
                            self.target_ms = self.ticks[drawn]["dateMs"]
                            self.show_current()
                            self.status.setText(f"{asked} and {self.ticks[drawn]['label']} fall in the same {self.step} of the "
                                                f"controller: its frame draws the newer. A finer step, or source "
                                                f"timestamps, shows {asked}.")
            finally:
                self._driving = False
        self.sync_visibility()
        self.show_frame()

    def sync_visibility(self):
        """With the temporal navigation on, every dated layer is checked and
        QGIS draws the one of the frame; without it (turned off, or no
        canvas), only the date shown is checked: never every date drawn at
        once."""
        g = self.group()
        if g is None:
            return
        on = self.temporal_on()
        key = f"{self.sid}:{self.ticks[self.index]['ref']}" if 0 <= self.index < len(self.ticks) else None
        for node in g.findLayers():
            layer = node.layer()
            want = on or (layer is not None and layer.customProperty(PROP) == key)
            if node.itemVisibilityChecked() != want:
                node.setItemVisibilityChecked(want)
        if not g.itemVisibilityChecked():
            g.setItemVisibilityChecked(True)

    def _nav_range(self, rng):
        """The Temporal Controller moved (its slider, its play button): the
        panel shows the date its frame draws."""
        if self._driving or self._applying:
            return
        if self._nav is not None:  # turned off or on by the user: kept that way
            self.temporal_wanted = self._nav.navigationMode() != NAV_OFF
        if not self.ticks or self.group() is None:
            return
        if rng.isInfinite():
            self.frame = None
            self.sync_visibility()
            self.show_frame()
            return
        self.frame = (rng.begin().toMSecsSinceEpoch(), rng.end().toMSecsSinceEpoch()) if self.step != "timestamps" else None
        i = historical.index_in(self.ticks, rng.begin().toMSecsSinceEpoch(), rng.end().toMSecsSinceEpoch())
        if i != self.index and i >= 0:
            self.index = i
            self.target_ms = self.ticks[i]["dateMs"]
            self.show_current()
        else:
            self.show_frame()

    def main_window(self):
        """QGIS's main window: the application's, else the one the dock is in."""
        try:
            from qgis.utils import iface
            if iface is not None and iface.mainWindow() is not None:
                return iface.mainWindow()
        except Exception:  # noqa: BLE001 - outside the application
            pass
        w = self.dock.parent()
        while w is not None and not isinstance(w, QMainWindow):
            w = w.parent()
        return w or self.dock.parent()

    def temporal_dock(self):
        """QGIS's Temporal Controller panel, by its object name in the main
        window. (0.10.0 looked for a QgsTemporalControllerWidget inside each
        dock: in the application that finds nothing, the widget is not
        reachable by its type from Python, so the button did nothing.)"""
        window = self.main_window()
        if window is None:
            return None
        d = window.findChild(QDockWidget, TEMPORAL_DOCK)
        if d is None:
            d = next((x for x in window.findChildren(QDockWidget) if "temporal" in x.objectName().lower()), None)
        return d

    def temporal_action(self):
        """The action that shows the panel (View > Panels, the toolbar's clock)."""
        window = self.main_window()
        return window.findChild(QAction, TEMPORAL_ACTION) if window is not None else None

    def show_temporal_controller(self):
        """QGIS's Temporal Controller shown and brought to the front, its
        navigation on, at the date of the panel."""
        d, a = self.temporal_dock(), self.temporal_action()
        if d is None and a is None:
            self.status.setText("QGIS's Temporal Controller was not found: View > Panels > Temporal Controller")
            return False
        if a is not None and a.isCheckable() and not a.isChecked():
            a.setChecked(True)  # as a click on the toolbar's clock: QGIS shows the panel
        elif a is not None and not a.isCheckable():
            a.trigger()
        if d is not None:
            if hasattr(d, "setUserVisible"):
                d.setUserVisible(True)  # shown, and raised when tabbed behind another panel
            else:
                d.show()
                d.raise_()
        self.temporal_wanted = True
        self.drive()
        return True

    # -- links, the end -----------------------------------------------------------
    def open_link(self, state):
        """A link in the app's historical mode: view A's source
        (historicalActiveSourceA) and date (dateA, ms; 0: the newest)."""
        sid = str(state.get("historicalActiveSourceA") or "wayback")
        note = ""
        if historical.source(sid) is None:
            note = historical.LEFT_OUT.get(sid, f"\"{sid}\" is not a source of this panel")
            sid = "wayback"
        else:
            why = historical.unavailable(sid, self.key_values(), self.service())
            if why:
                note = f"{historical.source(sid)['name']} {why}"
                sid = "wayback"
        try:
            date = int(float(state.get("dateA") or 0))
        except (TypeError, ValueError):
            date = 0
        self.target_ms = date or None
        self.set_source(sid)
        self.listed_key = None
        self.paused = False
        started = self.refresh()
        if note:
            self.dock.warn(f"Historical imagery: {note}; Esri Wayback instead")
        return started

    def cleanup(self):
        self.cancel_job()
        self.move_timer.stop()
        self._unwatch()
        historical.save_store()
