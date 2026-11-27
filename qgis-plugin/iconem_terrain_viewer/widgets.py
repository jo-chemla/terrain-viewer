"""The panel's small widgets: a slider with its number box, the light
direction pad, selects with ramp and matcap previews, a foldable section and
radio buttons in a row. Qt 5 and Qt 6 alike (qgis.PyQt, scoped enums)."""
import math

from qgis.PyQt.QtCore import Qt, QPointF, QRectF, QSize, QObject, QEvent, pyqtSignal
from qgis.PyQt.QtGui import QColor, QPainter, QPen, QBrush, QPalette
from qgis.PyQt.QtWidgets import (
    QWidget, QHBoxLayout, QVBoxLayout, QSlider, QDoubleSpinBox, QSpinBox, QComboBox, QToolButton, QButtonGroup,
    QSizePolicy, QFrame, QRadioButton, QLabel,
)


class SliderSpin(QWidget):
    """A slider and a number box bound together, as the app's SliderControl.
    The slider covers [lo, hi] (the usual range); the box takes anything in
    [hard_lo, hard_hi] (typed values beyond the slider stay). `valueChanged`
    fires while the slider is dragged (the panel debounces)."""

    valueChanged = pyqtSignal(float)

    def __init__(self, lo, hi, step=1.0, value=None, integer=False, hard=None, decimals=None, parent=None):
        super().__init__(parent)
        self.lo, self.hi, self.step, self.integer = float(lo), float(hi), float(step) or 1.0, integer
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)
        self.slider = QSlider(Qt.Orientation.Horizontal)
        self.slider.setRange(0, max(1, int(round((self.hi - self.lo) / self.step))))
        self.slider.setMinimumWidth(50)
        hard_lo, hard_hi = hard if hard else (-1e7, 1e7)
        if integer:
            self.spin = QSpinBox()
            self.spin.setRange(int(max(hard_lo, -2 ** 31 + 1)), int(min(hard_hi, 2 ** 31 - 1)))
            self.spin.setSingleStep(max(1, int(self.step)))
        else:
            self.spin = QDoubleSpinBox()
            if decimals is None:
                s = f"{self.step:g}"
                decimals = len(s.split(".")[1]) if "." in s else 0
                decimals = min(max(decimals, 0), 4)
            self.spin.setDecimals(decimals)
            self.spin.setRange(hard_lo, hard_hi)
            self.spin.setSingleStep(self.step)
        self.spin.setKeyboardTracking(False)
        self.spin.setMinimumWidth(56)
        self.spin.setMaximumWidth(84)
        lay.addWidget(self.slider, 1)
        lay.addWidget(self.spin)
        self._sync = False
        self.slider.valueChanged.connect(self._slid)
        self.spin.valueChanged.connect(self._typed)
        if value is not None:
            self.setValue(value)

    def _to_slider(self, v):
        return int(round((min(max(v, self.lo), self.hi) - self.lo) / self.step))

    def _slid(self, i):
        if self._sync:
            return
        v = self.lo + i * self.step
        self._sync = True
        self.spin.setValue(int(round(v)) if self.integer else v)
        self._sync = False
        self.valueChanged.emit(float(self.spin.value()))

    def _typed(self, v):
        if self._sync:
            return
        self._sync = True
        self.slider.setValue(self._to_slider(float(v)))
        self._sync = False
        self.valueChanged.emit(float(v))

    def value(self):
        v = self.spin.value()
        return int(v) if self.integer else float(v)

    def setValue(self, v, emit=False):
        try:
            v = float(v)
        except (TypeError, ValueError):
            return
        self._sync = True
        self.spin.setValue(int(round(v)) if self.integer else v)
        self.slider.setValue(self._to_slider(v))
        self._sync = False
        if emit:
            self.valueChanged.emit(float(self.spin.value()))

    def setReadOnly(self, on):
        """A mirrored bound: shown, not editable."""
        self.spin.setReadOnly(on)
        self.slider.setEnabled(not on)
        self.spin.setButtonSymbols(QDoubleSpinBox.ButtonSymbols.NoButtons if on else QDoubleSpinBox.ButtonSymbols.UpDownArrows)


class LightPad(QWidget):
    """The light source as a point in a disc, north up: its angle from north,
    clockwise, is the azimuth; its distance from the centre the elevation
    (the centre is the zenith, 90 degrees; the rim the horizon, 0), as the
    app's light direction pad. `changed(azimuth, elevation)` while dragged
    (once per whole degree moved), `released()` when the drag ends."""

    changed = pyqtSignal(float, float)
    released = pyqtSignal()

    def __init__(self, azimuth=315.0, elevation=45.0, parent=None):
        super().__init__(parent)
        self.azimuth, self.elevation = float(azimuth), float(elevation)
        self.setFixedSize(QSize(104, 104))
        self.setCursor(Qt.CursorShape.CrossCursor)
        self.setToolTip("Drag the light: the angle is the azimuth (from north, clockwise), the distance from the "
                        "centre the elevation (centre 90°, rim 0°)")

    def setValue(self, azimuth, elevation):
        self.azimuth, self.elevation = float(azimuth) % 360, min(max(float(elevation), 0.0), 90.0)
        self.update()

    def _geometry(self):
        r = min(self.width(), self.height()) / 2 - 6
        return QPointF(self.width() / 2, self.height() / 2), r

    def _point(self):
        c, r = self._geometry()
        d = r * (1 - self.elevation / 90.0)
        a = math.radians(self.azimuth)
        return QPointF(c.x() + d * math.sin(a), c.y() - d * math.cos(a))

    def paintEvent(self, _e):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        c, r = self._geometry()
        pal = self.palette()
        p.setPen(QPen(pal.color(QPalette.ColorRole.Mid), 1))
        p.setBrush(QBrush(pal.color(QPalette.ColorRole.Base)))
        p.drawEllipse(c, r, r)
        p.setBrush(Qt.BrushStyle.NoBrush)
        for f in (2 / 3, 1 / 3):  # 30 and 60 degrees of elevation
            p.drawEllipse(c, r * f, r * f)
        p.drawLine(QPointF(c.x() - r, c.y()), QPointF(c.x() + r, c.y()))
        p.drawLine(QPointF(c.x(), c.y() - r), QPointF(c.x(), c.y() + r))
        p.setPen(pal.color(QPalette.ColorRole.Text))
        f = p.font()
        f.setPointSizeF(max(6.0, f.pointSizeF() * 0.75))
        p.setFont(f)
        p.drawText(QRectF(c.x() - 6, 0, 12, 10), Qt.AlignmentFlag.AlignCenter, "N")
        pt = self._point()
        p.setPen(QPen(QColor(120, 80, 0), 1))
        p.drawLine(c, pt)
        p.setBrush(QBrush(QColor(255, 196, 0)))
        p.drawEllipse(pt, 5, 5)
        p.end()

    def _from_mouse(self, pos):
        c, r = self._geometry()
        dx, dy = pos.x() - c.x(), pos.y() - c.y()
        d = min(math.hypot(dx, dy) / r, 1.0) if r > 0 else 0
        az = (math.degrees(math.atan2(dx, -dy)) + 360) % 360
        el = 90.0 * (1 - d)
        new = (float(round(az) % 360), float(round(el)))
        if new == (self.azimuth, self.elevation):
            return
        self.azimuth, self.elevation = new
        self.update()
        self.changed.emit(*new)

    def mousePressEvent(self, e):
        self._from_mouse(e.position() if hasattr(e, "position") else e.pos())

    def mouseMoveEvent(self, e):
        if e.buttons() & Qt.MouseButton.LeftButton:
            self._from_mouse(e.position() if hasattr(e, "position") else e.pos())

    def mouseReleaseEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            self.released.emit()


class CompactOpacity(QWidget):
    """A mode's opacity in its row: a short slider (0 to 100 %), its value in
    the tooltip and a small label, as QgsOpacityWidget's opacity() and
    setOpacity() and its opacityChanged(float) signal."""

    opacityChanged = pyqtSignal(float)

    def __init__(self, value=1.0, parent=None):
        super().__init__(parent)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        self.slider = QSlider(Qt.Orientation.Horizontal)
        self.slider.setRange(0, 100)
        self.slider.setSingleStep(5)
        self.slider.setPageStep(10)
        self.slider.setFixedWidth(52)
        self.label = QLabel()
        self.label.setMinimumWidth(28)
        self.label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        f = self.label.font()
        f.setPointSizeF(max(6.5, f.pointSizeF() * 0.85))
        self.label.setFont(f)
        lay.addWidget(self.slider)
        lay.addWidget(self.label)
        self.slider.valueChanged.connect(self._moved)
        self.setOpacity(value)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)

    def _show(self, v):
        self.label.setText(f"{v}%")
        self.setToolTip(f"Opacity: {v} % (the QGIS layer's)")

    def _moved(self, v):
        self._show(v)
        self.opacityChanged.emit(v / 100.0)

    def opacity(self):
        return self.slider.value() / 100.0

    def setOpacity(self, v):
        try:
            v = int(round(min(max(float(v), 0.0), 1.0) * 100))
        except (TypeError, ValueError):
            return
        if v == self.slider.value():
            self._show(v)
            return
        self.slider.setValue(v)  # emits, as QgsOpacityWidget does


class IconCombo(QComboBox):
    """A select of (id, name, icon) items, read and written by id; an id it
    does not list is added (a share link's or a newer service's)."""

    def __init__(self, items, current=None, icon_size=QSize(48, 10), parent=None):
        super().__init__(parent)
        self.setIconSize(icon_size)
        self.setMinimumWidth(60)
        self.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.setMinimumContentsLength(8)
        for item_id, name, icon in items:
            if icon is not None:
                self.addItem(icon, name, item_id)
            else:
                self.addItem(name, item_id)
            self.setItemData(self.count() - 1, f"{name} ({item_id})" if name != item_id else name, Qt.ItemDataRole.ToolTipRole)
        if current is not None:
            self.set(current)

    def get(self):
        d = self.currentData()
        return d if d is not None else self.currentText()

    def set(self, item_id):
        item_id = str(item_id)
        i = self.findData(item_id)
        if i < 0:
            self.addItem(item_id, item_id)
            i = self.count() - 1
        self.setCurrentIndex(i)


class FoldSection(QWidget):
    """A header button (an arrow, an optional icon, a title) folding a body."""

    toggled = pyqtSignal(bool)

    def __init__(self, title, icon=None, open_=False, parent=None):
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        self.title = title
        self.button = QToolButton()
        self.button.setText(title)
        self.button.setCheckable(True)
        self.button.setChecked(open_)
        self.button.setAutoRaise(True)
        self.button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
        self.button.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        hand(self.button)
        self.icon = icon
        lay.addWidget(self.button)
        self.body = QFrame()
        self.body_layout = QVBoxLayout(self.body)
        self.body_layout.setContentsMargins(14, 0, 0, 4)
        lay.addWidget(self.body)
        self.button.toggled.connect(self._toggled)
        self._toggled(open_)

    def _toggled(self, on):
        self.body.setVisible(on)
        if self.icon is not None and not self.icon.isNull():
            # The icon says what it is, the triangle whether it is open.
            self.button.setIcon(self.icon)
            self.button.setText(("▾ " if on else "▸ ") + self.title)
        else:
            self.button.setArrowType(Qt.ArrowType.DownArrow if on else Qt.ArrowType.RightArrow)
        self.toggled.emit(on)

    def is_open(self):
        return self.button.isChecked()


def hand(*widgets):
    """A pointing hand over what takes a click (a row, a box, a button)."""
    for w in widgets:
        if w is not None:
            w.setCursor(Qt.CursorShape.PointingHandCursor)
    return widgets[0] if len(widgets) == 1 else widgets


class _TitleHand(QObject):
    """A group box's title (which folds it) under a pointing hand, the rest of
    the box under the usual arrow."""

    def eventFilter(self, obj, e):
        t = e.type()
        if t in (QEvent.Type.HoverMove, QEvent.Type.HoverEnter, QEvent.Type.MouseMove):
            pos = e.position() if hasattr(e, "position") else e.pos()
            if pos.y() <= obj.fontMetrics().height() + 6:
                obj.setCursor(Qt.CursorShape.PointingHandCursor)
            else:
                obj.unsetCursor()
        elif t in (QEvent.Type.HoverLeave, QEvent.Type.Leave):
            obj.unsetCursor()
        return False


def hand_title(box):
    """A pointing hand over a (collapsible) group box's title and fold button."""
    box.setAttribute(Qt.WidgetAttribute.WA_Hover, True)
    box._title_hand = _TitleHand(box)
    box.installEventFilter(box._title_hand)
    button = box.collapseButton() if hasattr(box, "collapseButton") else None
    hand(button)
    return box


class RadioRow(QWidget):
    """Exclusive radio buttons side by side, the QGIS way; `changed(id)` when
    another is picked."""

    changed = pyqtSignal(str)

    def __init__(self, items, current=None, parent=None):
        super().__init__(parent)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(10)
        self.group = QButtonGroup(self)
        self.group.setExclusive(True)
        self.buttons = {}
        for item_id, label, tip in items:
            b = QRadioButton(label)
            b.setToolTip(tip)
            hand(b)
            self.group.addButton(b)
            lay.addWidget(b)
            self.buttons[item_id] = b
            b.toggled.connect(lambda on, i=item_id: on and self.changed.emit(i))
        lay.addStretch(1)
        if current in self.buttons:
            self.set(current, emit=False)

    def current(self):
        return next((i for i, b in self.buttons.items() if b.isChecked()), None)

    def set(self, item_id, emit=True):
        b = self.buttons.get(item_id)
        if b is None:
            return
        if not emit:
            b.blockSignals(True)
        b.setChecked(True)
        if not emit:
            b.blockSignals(False)


class ModeSwitch(QWidget):
    """The app's modes as buttons side by side, each with its icon, one
    checked; `changed(id)` when another is picked. `items`: (id, label, tip,
    icon or None)."""

    changed = pyqtSignal(str)

    def __init__(self, items, current=None, parent=None):
        super().__init__(parent)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(2)
        self.group = QButtonGroup(self)
        self.group.setExclusive(True)
        self.buttons = {}
        for item_id, label, tip, icon in items:
            b = QToolButton()
            b.setText(label)
            b.setToolTip(tip)
            b.setCheckable(True)
            b.setAutoRaise(True)
            b.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
            b.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            if icon is not None and not icon.isNull():
                b.setIcon(icon)
            hand(b)
            self.group.addButton(b)
            lay.addWidget(b)
            self.buttons[item_id] = b
            b.toggled.connect(lambda on, i=item_id: on and self.changed.emit(i))
        if current in self.buttons:
            self.set(current, emit=False)

    def current(self):
        return next((i for i, b in self.buttons.items() if b.isChecked()), None)

    def set(self, item_id, emit=True):
        b = self.buttons.get(item_id)
        if b is None:
            return
        if not emit:
            b.blockSignals(True)
        b.setChecked(True)
        if not emit:
            b.blockSignals(False)


class TickStrip(QWidget):
    """Dates as ticks on a time axis, each at its place in time (the app's
    timeline track): the current one as a handle, a year under each end. A
    click picks the nearest tick, `picked(index)`; hovering names it.
    `set_ticks([(ms, label, sure)], current)`: a tick that is not `sure`
    (a release date standing in for a capture date) is drawn lighter."""

    picked = pyqtSignal(int)
    PAD = 9

    def __init__(self, parent=None):
        super().__init__(parent)
        self.ticks, self.current = [], -1
        self.setMinimumHeight(38)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.setMouseTracking(True)
        hand(self)

    def sizeHint(self):
        return QSize(200, 38)

    def set_ticks(self, ticks, current=-1):
        self.ticks, self.current = list(ticks), current
        self.update()

    def set_current(self, index):
        self.current = index
        self.update()

    def span(self):
        """(first, last) of the axis in milliseconds, a little past the
        oldest and the newest tick so neither sits on the edge."""
        ms = [t[0] for t in self.ticks]
        lo, hi = min(ms), max(ms)
        pad = max((hi - lo) * 0.04, 86400000.0 * 30)
        return lo - pad, hi + pad

    def x_of(self, ms):
        lo, hi = self.span()
        return self.PAD + (ms - lo) / (hi - lo) * max(1, self.width() - 2 * self.PAD)

    def index_at(self, x):
        if not self.ticks:
            return -1
        return min(range(len(self.ticks)), key=lambda i: abs(self.x_of(self.ticks[i][0]) - x))

    def mousePressEvent(self, e):
        i = self.index_at(e.position().x() if hasattr(e, "position") else e.x())
        if i >= 0:
            self.picked.emit(i)

    def mouseMoveEvent(self, e):
        i = self.index_at(e.position().x() if hasattr(e, "position") else e.x())
        self.setToolTip(self.ticks[i][1] if i >= 0 else "")

    def paintEvent(self, _e):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        pal = self.palette()
        text, accent = pal.color(QPalette.ColorRole.WindowText), pal.color(QPalette.ColorRole.Highlight)
        faint = QColor(text)
        faint.setAlpha(90)
        y = 13.0
        p.setPen(QPen(faint, 1))
        p.drawLine(QPointF(self.PAD, y), QPointF(self.width() - self.PAD, y))
        if not self.ticks:
            p.end()
            return
        for i, (ms, _label, sure) in enumerate(self.ticks):
            if i == self.current:
                continue
            p.setPen(QPen(text if sure else faint, 1.6))
            x = self.x_of(ms)
            p.drawLine(QPointF(x, y - 6), QPointF(x, y + 6))
        if 0 <= self.current < len(self.ticks):
            x = self.x_of(self.ticks[self.current][0])
            p.setPen(QPen(accent, 2.4))
            p.drawLine(QPointF(x, y - 9), QPointF(x, y + 9))
            p.setBrush(QBrush(accent))
            p.drawEllipse(QPointF(x, y), 4.0, 4.0)
        lo, hi = self.span()
        p.setPen(QPen(faint, 1))
        f = p.font()
        f.setPointSizeF(max(6.0, f.pointSizeF() * 0.85))
        p.setFont(f)
        year = lambda ms: str(1970 + int(ms // (86400000.0 * 365.2425)))  # noqa: E731

        def flags(f):  # an int for drawText, Qt 5 and Qt 6
            return f.value if hasattr(f, "value") else int(f)
        left, right = QRectF(self.PAD, y + 9, 60, 14), QRectF(self.width() - self.PAD - 60, y + 9, 60, 14)
        p.drawText(left, flags(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop), year(self.ticks[0][0]))
        if year(self.ticks[-1][0]) != year(self.ticks[0][0]):
            p.drawText(right, flags(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignTop), year(self.ticks[-1][0]))
        p.end()
