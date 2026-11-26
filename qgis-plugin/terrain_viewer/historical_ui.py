"""The panel's Historical mode (the app's appMode=historical): dated imagery
picked by source and date, the dates of the map's centre as a list, as ticks
on a small time axis and as the steps of QGIS's own Temporal Controller.

How the dates reach QGIS: every date is one XYZ raster layer of the group
"Historical imagery", with a fixed temporal range (its capture until the next
one; a yearly mosaic's year). The canvas's temporal navigation
(QgsTemporalNavigationObject) is given those ranges as its available ranges
with the "source timestamps" step (an irregular step), so its slider has one
stop per date and each stop draws that date's layer, QGIS doing the
filtering. The group works without the plugin (a saved project, a layout's
atlas, an animation export).

The dates are listed by historical.py in a worker thread (urllib, as the
Python backend reads its tiles), the panel polling its progress: nothing
blocks the UI thread."""
import threading

from qgis.PyQt.QtCore import Qt, QTimer, QDateTime, QDate, QTime
from qgis.PyQt.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QComboBox, QToolButton, QPushButton, QListWidget, QCheckBox,
    QDockWidget, QSizePolicy,
)
from qgis.core import (
    Qgis, QgsApplication, QgsProject, QgsRasterLayer, QgsLayerTreeGroup, QgsDateTimeRange, QgsInterval,
    QgsTemporalNavigationObject, QgsRasterLayerTemporalProperties,
)

from . import historical, links
from .layers import xyz_uri
from .widgets import TickStrip, CompactOpacity, hand

GROUP = "Historical imagery"
ROOT_PROP = "terrain_viewer/historical_root"
PROP = "terrain_viewer/historical"  # "<source>:<ref>" (a Wayback release, a year)
DATE_PROP = "terrain_viewer/historical_date"  # the tick's date, ms


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


IRREGULAR = _scoped(lambda: Qgis.TemporalUnit.IrregularStep,
                    lambda: __import__("qgis.core", fromlist=["QgsUnitTypes"]).QgsUnitTypes.TemporalIrregularStep)
NAV_OFF = _scoped(lambda: Qgis.TemporalNavigationMode.NavigationOff, lambda: QgsTemporalNavigationObject.NavigationOff)
NAV_ANIMATED = _scoped(lambda: Qgis.TemporalNavigationMode.Animated, lambda: QgsTemporalNavigationObject.Animated)
FIXED_RANGE = _scoped(lambda: Qgis.RasterTemporalMode.FixedTemporalRange,
                      lambda: QgsRasterLayerTemporalProperties.ModeFixedTemporalRange)
# Checked headless in QGIS 3.44 and 4.2; the older names are those of 3.28.
TEMPORAL = None not in (IRREGULAR, NAV_OFF, NAV_ANIMATED, FIXED_RANGE)


def qdatetime(ms):
    """A date in milliseconds as a UTC QDateTime at midnight of its day."""
    y, m, d = historical.ymd(ms)
    return QDateTime(QDate(y, m, d), QTime(0, 0), Qt.TimeSpec.UTC)


def qranges(ticks):
    """The ticks' spans as QGIS temporal ranges, half open."""
    return [QgsDateTimeRange(qdatetime(a), qdatetime(b), True, False) for a, b in historical.tick_ranges(ticks)]


class _Job:
    """One listing running in a worker thread; the panel reads it from a timer."""

    def __init__(self, key):
        self.key = key
        self.lock = threading.Lock()
        self.ticks, self.note, self.version = [], "", 0
        self.done, self.error, self.cancel = False, None, False

    def report(self, ticks, note):
        with self.lock:
            self.ticks, self.note, self.version = ticks, note, self.version + 1

    def finish(self, ticks=None, error=None):
        with self.lock:
            if ticks is not None:
                self.ticks = ticks
            self.error, self.done, self.version = error, True, self.version + 1

    def read(self):
        with self.lock:
            return self.version, list(self.ticks), self.note, self.done, self.error


class HistoricalPanel(QWidget):
    def __init__(self, dock):
        super().__init__(dock)
        self.dock = dock
        self.fetch = historical.fetch_url  # replaced in the tests
        self.sid = None  # the dated source drawn
        self.ticks, self.index = [], -1
        self.target_ms = None  # the date asked for (a pick, a link); None: the newest
        self.listed_key = None
        self.job, self.job_seen = None, -1
        self._driving = self._applying = False
        self._nav = None
        self.temporal_wanted = True  # False once the user turns the Temporal Controller off
        self.active = False
        self.paused = False  # Remove pressed: nothing listed again until asked
        self.shown_sid = None  # the source whose dates are shown
        self.stream = True  # whether the listing running shows its dates as they arrive

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
        self.prev_btn.clicked.connect(lambda _c=False: self.step(-1))
        self.next_btn.clicked.connect(lambda _c=False: self.step(1))
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

        opts = QHBoxLayout()
        self.follow = QCheckBox("Follow the map")
        self.follow.setChecked(True)
        self.follow.setToolTip("List the dates again when the map's centre moves to another tile")
        opts.addWidget(self.follow)
        opts.addStretch(1)
        self.temporal_btn = QPushButton("Temporal Controller")
        self.temporal_btn.setToolTip("Show QGIS's Temporal Controller: its slider steps through these dates "
                                     "(step: source timestamps), and it plays and exports them")
        self.temporal_btn.clicked.connect(lambda _c=False: self.show_temporal_controller())
        opts.addWidget(self.temporal_btn)
        self.remove_btn = QPushButton("Remove")
        self.remove_btn.setToolTip(f"Remove the \"{GROUP}\" group from the project")
        self.remove_btn.clicked.connect(lambda _c=False: self.remove())
        opts.addWidget(self.remove_btn)
        lay.addLayout(opts)
        self.status = QLabel()
        self.status.setWordWrap(True)
        lay.addWidget(self.status)
        lay.addStretch(1)
        hand(self.prev_btn, self.next_btn, self.refresh_btn, self.follow, self.temporal_btn, self.remove_btn)

        self.fill_sources()
        self.source.currentIndexChanged.connect(lambda _i: self.source_changed())
        self.poll = QTimer(self)
        self.poll.setInterval(500)
        self.poll.timeout.connect(self._poll)
        self.move_timer = QTimer(self)
        self.move_timer.setSingleShot(True)
        self.move_timer.setInterval(900)
        self.move_timer.timeout.connect(lambda: self.refresh())
        self.show_current()

    # -- the source ------------------------------------------------------------
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

    def fill_sources(self):
        """Two groups: the historical sources (dated), then the app's
        worldwide default basemaps (the Basemap row's choices, undated)."""
        current = self.source.currentData()
        self.source.blockSignals(True)
        self.source.clear()
        self._header("Historical sources")
        for s in historical.SOURCES:
            self.source.addItem(s["name"], "dated:" + s["id"])
            self.source.setItemData(self.source.count() - 1, s["about"], Qt.ItemDataRole.ToolTipRole)
        self._header("Worldwide defaults (no dates)")
        for sid, name in links.basemap_choices(self.dock.key_values() if hasattr(self.dock, "keys") else {}):
            self.source.addItem(name, "basemap:" + sid)
        i = self.source.findData(current or "dated:wayback")
        self.source.setCurrentIndex(i if i >= 0 else self.source.findData("dated:wayback"))
        self.source.blockSignals(False)

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
        return True

    def source_changed(self):
        self.listed_key = None
        self.paused = False
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

    def moved(self):
        """The canvas moved (the dock tells): the dates again once it settles."""
        kind, sid = self.current()
        if (self.active and not self.paused and self.follow.isChecked() and kind == "dated"
                and historical.source(sid)["per_place"]):
            self.move_timer.start()

    def cancel_job(self):
        if self.job is not None:
            self.job.cancel = True
            self.job = None
        self.poll.stop()

    def refresh(self, force=False, wait=False):
        """The dates of the source picked at the map's centre, listed in a
        worker thread (`wait`: in this one, for the tests); a worldwide
        default basemap goes to the Basemap row. Returns True when a listing
        was applied or started."""
        kind, sid = self.current()
        if kind == "basemap":
            return self.show_static(sid)
        s = historical.source(sid)
        lat = lng = zoom = 0.0
        if s["per_place"]:
            place = self.dock.place()
            if place is None:
                self.status.setText("No map to read the place from")
                return False
            lat, lng, zoom = place
        key = historical.place_key(sid, lat, lng, zoom)
        if not force and key == self.listed_key:
            return False
        if force:
            historical.forget(key)
            self.paused = False
        self.cancel_job()
        self.listed_key, self.sid = key, sid
        known = historical.cached(sid, lat, lng, zoom) if s["per_place"] else historical.list_dates(sid, 0, 0, 0)
        if known is not None:
            self.apply(known, True)
            return True
        if wait:
            try:
                ticks = historical.list_dates(sid, lat, lng, zoom, self.fetch)
            except Exception as e:  # noqa: BLE001 - the network, said in the panel
                self.failed(e)
                return False
            self.apply(ticks or [], True)
            return True
        job = self.job = _Job(key)
        self.job_seen = -1
        # A first listing shows its dates as they arrive. After a pan, the
        # dates shown stay until the new place's list is whole: a list that
        # fills in would take the layers away and bring them back.
        self.stream = not (self.ticks and self.shown_sid == sid)
        fetch = self.fetch
        self.status.setText(f"{s['short']}: listing the dates here...")

        def run():
            try:
                job.finish(historical.list_dates(sid, lat, lng, zoom, fetch, job.report, lambda: job.cancel))
            except Exception as e:  # noqa: BLE001 - read by the panel's timer
                job.finish(error=str(e) or type(e).__name__)
        threading.Thread(target=run, name="terrain-viewer-historical", daemon=True).start()
        self.poll.start()
        return True

    def _poll(self):
        job = self.job
        if job is None:
            self.poll.stop()
            return
        version, ticks, note, done, error = job.read()
        if version == self.job_seen:
            return
        self.job_seen = version
        if done:
            self.job = None
            self.poll.stop()
            if error:
                self.failed(error)
                return
        if done or (ticks and self.stream):
            self.apply(ticks, done)
        if not done and note:
            self.status.setText(note)

    def failed(self, error):
        self.listed_key = None
        self.dock.warn(f"Historical imagery: the dates could not be listed ({error})")
        self.status.setText(f"The dates could not be listed: {error}")

    # -- the dates applied -------------------------------------------------------
    def apply(self, ticks, final=True):
        """A list of ticks (complete, or what is known so far): its layers,
        the list, the axis, the Temporal Controller; the date shown is the
        one asked for, or the nearest."""
        self.ticks = list(ticks)
        self.shown_sid = self.sid
        self.index = historical.nearest(self.ticks, self.target_ms)
        row = getattr(self.dock, "basemap_row", None)
        # While the layers change, QGIS's Temporal Controller reads the
        # project's ranges again and moves its frame: not a move of the user's.
        self._applying = True
        try:
            if self.ticks and row is not None and row.row.on("colour"):
                row.row.set_forms(set())  # one basemap at a time: the dated imagery is it
                row.update()
            self.sync_layers()
            self.fill_dates()
        finally:
            self._applying = False
        self.drive()
        s = historical.source(self.sid)
        hint = next((t["hint"] for t in self.ticks if t.get("hint")), None)
        if final and hint:
            self.status.setText(f"{s['short']}: {self.ticks[0]['label']}; {hint}")
        elif final:
            unsure = sum(1 for t in self.ticks if not t.get("real", True))
            self.status.setText(
                (f"{s['short']}: {len(self.ticks)} dates here" if self.ticks else f"{s['short']}: no imagery listed here")
                + (f" ({unsure} at their release date: the capture date did not answer)" if unsure else "")
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

    def sync_layers(self):
        """One XYZ layer per tick in the group, the newest on top, each with
        its fixed temporal range: a layer that stays (the same release) is
        kept, so a pan that lists the same captures redraws nothing."""
        project = QgsProject.instance()
        have = self.layers()
        wanted = {f"{self.sid}:{t['ref']}" for t in self.ticks}
        gone = [layer.id() for key, layer in have.items() if key not in wanted]
        if gone:
            self.drop(gone)
        if not self.ticks:
            self.dock.stack.prune()
            return
        s = historical.source(self.sid)
        group = self.group(create=True)
        group.setName(f"{GROUP} ({s['short']})")
        for t, rng in zip(self.ticks, qranges(self.ticks)):
            key = f"{self.sid}:{t['ref']}"
            name = f"{t['label']} · {s['short']}"
            layer = have.get(key)
            if layer is None:
                layer = QgsRasterLayer(xyz_uri(t["url"], t["maxzoom"]), name, "wms")
                layer.setCustomProperty(PROP, key)
                layer.setCustomProperty(DATE_PROP, str(t["dateMs"]))
                self.dock.keep_extent()
                project.addMapLayer(layer, False)
                group.insertLayer(sum(1 for n in group.children() if self._date_of(n) > t["dateMs"]), layer)
                if layer.renderer() is not None:
                    layer.renderer().setOpacity(self.opacity.opacity())
            else:
                if layer.name() != name:
                    layer.setName(name)
                layer.setCustomProperty(DATE_PROP, str(t["dateMs"]))
            if TEMPORAL:
                props = layer.temporalProperties()
                props.setMode(FIXED_RANGE)
                props.setFixedTemporalRange(rng)
                props.setIsActive(True)

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

    def clear_layers(self):
        self.ticks, self.index, self.listed_key = [], -1, None
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
        self.prev_btn.setEnabled(ok and i > 0)
        self.next_btn.setEnabled(ok and i < n - 1)
        self.remove_btn.setEnabled(bool(self.ticks))
        self.strip.set_current(i)
        self.dates.blockSignals(True)
        self.dates.setCurrentRow(n - 1 - i if ok else -1)
        self.dates.blockSignals(False)

    def _row_picked(self, row):
        if 0 <= row < len(self.ticks):
            self.pick(len(self.ticks) - 1 - row)

    def step(self, by):
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

    def drive(self):
        """The Temporal Controller given the dates: its available ranges are
        the ticks' spans, its step "source timestamps", its frame the date
        shown; the canvas drawn at that span. When the user has turned the
        controller off, the date's layer is the one checked instead."""
        nav = self.nav()
        ranges = qranges(self.ticks)
        if nav is not None and ranges and 0 <= self.index < len(ranges):
            self._driving = True
            try:
                if self.temporal_wanted and nav.navigationMode() != NAV_ANIMATED:
                    nav.setNavigationMode(NAV_ANIMATED)
                if nav.navigationMode() != NAV_OFF:
                    nav.setAvailableTemporalRanges(ranges)
                    step = nav.frameDuration()
                    if step.originalUnit() != IRREGULAR:
                        nav.setFrameDuration(QgsInterval(1, IRREGULAR))
                    nav.setTemporalExtents(QgsDateTimeRange(ranges[0].begin(), ranges[-1].end(), True, False))
                    nav.setCurrentFrameNumber(self.index)
                    self.dock.canvas.setTemporalRange(ranges[self.index])
            finally:
                self._driving = False
        self.sync_visibility()

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
        panel shows the date of its frame."""
        if self._driving or self._applying:
            return
        if self._nav is not None:  # turned off or on by the user: kept that way
            self.temporal_wanted = self._nav.navigationMode() != NAV_OFF
        if not self.ticks or self.group() is None:
            return
        if rng.isInfinite():
            self.sync_visibility()
            return
        i = historical.index_at(self.ticks, rng.begin().toMSecsSinceEpoch())
        if i != self.index and i >= 0:
            self.index = i
            self.target_ms = self.ticks[i]["dateMs"]
            self.show_current()

    def temporal_dock(self):
        """QGIS's Temporal Controller panel, found by what it holds."""
        try:
            from qgis.gui import QgsTemporalControllerWidget
        except ImportError:
            return None
        window = self.dock.parent()
        for d in (window.findChildren(QDockWidget) if window is not None else []):
            if d.findChild(QgsTemporalControllerWidget) is not None:
                return d
        return None

    def show_temporal_controller(self):
        d = self.temporal_dock()
        if d is None:
            self.status.setText("QGIS's Temporal Controller: View > Panels > Temporal Controller")
            return False
        if hasattr(d, "setUserVisible"):
            d.setUserVisible(True)
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
