"""The Historical mode on QGIS's Temporal Controller, for real (network):
Esri Wayback and, with a tile service, Google Earth historical at the Eiffel
Tower, under the default step (one week). At a sample of the controller's
frames: the panel names the latest capture at or before the frame, the one
layer QGIS draws is that capture's (its name carries the true date), and the
picture changes when the capture does.

  QT_QPA_PLATFORM=offscreen python-qgis test_temporal_live.py
  TERRAIN_VIEWER_SERVICE=http://localhost:3400 QT_QPA_PLATFORM=offscreen python-qgis test_temporal_live.py

The second form also checks Google Earth historical through that tile
service, picked and connected from the Historical page's backend control.
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication  # noqa: E402

app = QgsApplication([], True)
app.initQgis()
from qgis.core import (  # noqa: E402
    QgsProject, QgsCoordinateReferenceSystem, QgsTemporalNavigationObject, QgsMapRendererParallelJob, QgsSettings,
)
from qgis.gui import QgsMapCanvas, QgsLayerTreeMapCanvasBridge  # noqa: E402
from qgis.PyQt.QtCore import QEventLoop, QTimer, QSize  # noqa: E402
from iconem_terrain_viewer import historical, historical_ui as hui  # noqa: E402
from iconem_terrain_viewer.dock import TerrainViewerDock  # noqa: E402

failures = []
PARIS = (48.8584, 2.2945, 16)
DAY = 86400000


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what, flush=True)
    if not ok:
        failures.append(what)


def spin(ms=200):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


settings = QgsSettings()
kept = {k: settings.value(f"terrain_viewer/{k}") for k in ("appMode", "temporalStep", "backend", "service")}
for k in ("appMode", "temporalStep"):
    settings.remove(f"terrain_viewer/{k}")
historical.set_store(os.path.join(tempfile.mkdtemp(), "wayback-dates.json"))
canvas = QgsMapCanvas()
canvas.resize(512, 512)
canvas.show()
bridge = QgsLayerTreeMapCanvasBridge(QgsProject.instance().layerTreeRoot(), canvas)
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
canvas.freeze(True)  # drawn by the jobs below, not by the canvas
nav = QgsTemporalNavigationObject()
canvas.setTemporalController(nav)
dock = TerrainViewerDock(canvas, None, None, bridge)
dock.project_fresh = False
dock.zoom_to(*PARIS)
spin(100)
hp = dock.historical
hp.follow.setChecked(False)


def listed(timeout_s=120):
    t0 = time.perf_counter()
    while hp.job is not None and time.perf_counter() - t0 < timeout_s:
        spin(200)
    return hp.job is None


def drawn_layers():
    """The dated layers QGIS draws at the canvas's temporal range: checked
    in the layer tree, their range meeting it; the newest first (on top)."""
    tree = QgsProject.instance().layerTreeRoot()
    out = [lyr for lyr in hp.layers().values()
           if tree.findLayer(lyr.id()).isVisible() and lyr.temporalProperties().isVisibleInTemporalRange(canvas.temporalRange())]
    return sorted(out, key=lambda lyr: -int(lyr.customProperty(hui.DATE_PROP)))


def picture():
    """The canvas's map at its temporal range, drawn by a render job."""
    ms = canvas.mapSettings()
    ms.setOutputSize(QSize(256, 256))
    ms.setLayers(drawn_layers())
    ms.setIsTemporal(True)
    ms.setTemporalRange(canvas.temporalRange())
    job = QgsMapRendererParallelJob(ms)
    loop = QEventLoop()
    job.finished.connect(loop.quit)
    job.start()
    QTimer.singleShot(90000, loop.quit)
    loop.exec()
    img = job.renderedImage()
    return [img.pixel(i, j) for i in range(8, 256, 16) for j in range(8, 256, 16)]


def differ(a, b):
    return sum(1 for p, q in zip(a, b) if p != q)


def step_through(name, samples=40):
    """The controller stepped over `samples` frames of its whole span: at
    each, what the panel names and what QGIS draws."""
    ticks = hp.ticks
    total = nav.totalFrameCount()
    frames = sorted(set(list(range(0, total, max(1, total // samples))) + [total - 1]
                        + [nav.findBestFrameNumberForFrameStart(hui.qdatetime(hui.floor_ms(hp.step, t["dateMs"]))) for t in ticks[-6:]]))
    ok, met, bad = True, set(), []
    for fr in frames:
        nav.setCurrentFrameNumber(fr)
        rng = nav.dateTimeRangeForFrameNumber(fr)
        a, b = rng.begin().toMSecsSinceEpoch(), rng.end().toMSecsSinceEpoch()
        begun = [t for t in ticks if t["dateMs"] < b]
        want = max(begun, key=lambda t: t["dateMs"]) if begun else ticks[0]
        layers = drawn_layers()
        top = layers[0].name() if layers else ""
        good = (hp.current_label.text() == want["label"] and top.startswith(want["label"] + " · ")
                and (b - a == 7 * DAY) and want["label"] in hp.frame_label.text() and not hp.frame_label.isHidden())
        if not good:
            bad.append((fr, historical.day_label(a), want["label"], hp.current_label.text(), top))
        ok = ok and good
        met.add(want["label"])
    check(ok, f"{name}, step {hp.step}: {total} frames of one week; at {len(frames)} of them the panel names the latest capture at or "
              f"before the frame's end and QGIS draws that capture's layer on top, named with its true date "
              f"({len(met)} of {len(ticks)} captures met)" + (f"; wrong: {bad[:3]}" if bad else ""))
    return frames


# -- Esri Wayback ------------------------------------------------------------------
dock.mode_switch.buttons["historical"].click()
spin(300)
check(hp.step == "week" and hp.step_box.currentText() == "Week" and nav.navigationMode() != hui.NAV_OFF or hp.job is not None,
      f"a new user: the Temporal Controller's step is one week ({hp.step_box.currentText()})")
check(not hp.needs_backend() and hp.backend_slot.indexOf(dock.backend_box) < 0 and "needs no backend" in hp.origin.text(),
      f"Esri Wayback: no backend control on the page ({hp.origin.text()[:50]}...)")
t0 = time.perf_counter()
check(listed(180) and len(hp.ticks) >= 8, f"Esri Wayback at the Eiffel Tower: {len(hp.ticks)} capture dates listed in {time.perf_counter() - t0:.0f} s")
if len(hp.ticks) >= 2:
    ranges = {k: lyr.temporalProperties().fixedTemporalRange() for k, lyr in hp.layers().items()}
    spans = historical.tick_ranges(hp.ticks)
    by_ref = {f"wayback:{t['ref']}": (t, s) for t, s in zip(hp.ticks, spans)}
    ok = all(ranges[k].begin().toMSecsSinceEpoch() == hui.floor_ms("day", t["dateMs"]) for k, (t, _s) in by_ref.items())
    nxt = all(ranges[f"wayback:{a['ref']}"].end().toMSecsSinceEpoch() == hui.floor_ms("day", b["dateMs"])
              for a, b in zip(hp.ticks, hp.ticks[1:]))
    check(ok and nxt and len(ranges) == len(hp.ticks),
          f"each of the {len(ranges)} layers stands from its true capture date until the next capture's")
    step_through("Esri Wayback")
    # Two frames a year apart inside one capture: the same picture; across a
    # change of capture: another one.
    t_old, t_new = hp.ticks[-2], hp.ticks[-1]
    f_new = nav.findBestFrameNumberForFrameStart(hui.qdatetime(hui.floor_ms("week", t_new["dateMs"])))
    nav.setCurrentFrameNumber(f_new - 1)
    before_label, before = hp.current_label.text(), picture()
    nav.setCurrentFrameNumber(f_new)
    after_label, after = hp.current_label.text(), picture()
    nav.setCurrentFrameNumber(f_new + 3)
    later_label, later = hp.current_label.text(), picture()
    check(before_label == t_old["label"] and after_label == later_label == t_new["label"] and differ(before, after) > 20 and differ(after, later) == 0,
          f"the week before {t_new['label']} draws {before_label}, its week and three weeks on draw {after_label}: the picture changes "
          f"at the capture ({differ(before, after)} of {len(after)} sampled pixels) and not between ({differ(after, later)})")
    print(f"       frame line: {hp.frame_label.text()}")

# -- Google Earth historical, through a tile service -----------------------------------
service = (os.environ.get("TERRAIN_VIEWER_SERVICE") or "").rstrip("/")
if not service:
    print("  skip Google Earth historical: no tile service (set TERRAIN_VIEWER_SERVICE=http://localhost:3400)")
else:
    i_g = hp.source.findData("dated:ge-historical")
    if dock.connected in ("local", "remote"):
        dock.connected = None
    hp.source.setCurrentIndex(i_g)
    spin(300)
    check(hp.needs_backend() and hp.backend_slot.indexOf(dock.backend_box) == 0 and not hp.layers(),
          "Google Earth historical picked: the backend control is on the Historical page, nothing drawn yet")
    # As the user does it there: Remote tile server, the address, Connect.
    dock.url.setText(service)
    dock.backend_picker.set("remote", emit=False)
    dock.set_backend("remote")
    spin(500)
    check(dock.connected == "remote" and hp.service() == service and f"at {service}" in hp.origin.text(),
          f"connected from that page: {dock.status.text()[:70]}")
    t0 = time.perf_counter()
    check(listed(180) and len(hp.ticks) >= 20, f"Google Earth historical: {len(hp.ticks)} captures, {hp.ticks[0]['label'] if hp.ticks else '?'} to "
                                             f"{hp.ticks[-1]['label'] if hp.ticks else '?'}, in {time.perf_counter() - t0:.0f} s")
    if len(hp.ticks) >= 2:
        step_through("Google Earth historical", samples=60)
        recent = [t for t in hp.ticks if t["label"] > "2012"]
        t_old, t_new = recent[-2], recent[-1]
        f_new = nav.findBestFrameNumberForFrameStart(hui.qdatetime(hui.floor_ms("week", t_new["dateMs"])))
        nav.setCurrentFrameNumber(f_new - 1)
        before_label, before = hp.current_label.text(), picture()
        nav.setCurrentFrameNumber(f_new)
        after_label, after = hp.current_label.text(), picture()
        check(before_label == t_old["label"] and after_label == t_new["label"] and differ(before, after) > 20,
              f"the week before {t_new['label']} draws {before_label}, its week draws {after_label}: another picture "
              f"({differ(before, after)} of {len(after)} sampled pixels)")
        print(f"       frame line: {hp.frame_label.text()}")
    dock.set_mode("terrain")
    spin(100)
    check(dock.terrain_layout.indexOf(dock.backend_box) == 0 and dock.connected == "remote",
          "back on the Terrain page: the same backend, still connected")

hp.remove()
dock.cleanup()
for k, v in kept.items():
    if v is None:
        settings.remove(f"terrain_viewer/{k}")
    else:
        settings.setValue(f"terrain_viewer/{k}", v)
historical.set_store(None)
print("FAILURES:" if failures else "OK", *failures, sep="\n  ", flush=True)
canvas.stopRendering()
QgsProject.instance().clear()
spin(200)
import test_teardown  # noqa: E402 - the widgets deleted, exitQgis, the process ended as QGIS ends
test_teardown.leave(app, 1 if failures else 0, dock, bridge, canvas)
