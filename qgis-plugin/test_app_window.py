"""The plugin inside the QGIS application itself (QgisApp, its main window,
its toolbars, its own Temporal Controller panel), which the headless tests
cannot make: a bare QgsApplication has no main window. Run by QGIS with
--code, no window shown (offscreen), in a throwaway profile, no network:

  Windows (Git Bash), QGIS 4.2; for 3.44 LTR: qgis-ltr-bin.exe, apps\\qgis-ltr, qt5
    export QT_QPA_PLATFORM=offscreen TV_APP_TEST_OUT=out/app-window.json
    cmd //c "call \"C:\\Program Files\\QGIS 4.2.0\\bin\\o4w_env.bat\" && call \"C:\\Program Files\\QGIS 4.2.0\\bin\\qt6_env.bat\"
      && set QGIS_PREFIX_PATH=%OSGEO4W_ROOT%\\apps\\qgis && path %OSGEO4W_ROOT%\\apps\\qgis\\bin;%PATH%
      && set QT_PLUGIN_PATH=%OSGEO4W_ROOT%\\apps\\qgis\\qtplugins;%OSGEO4W_ROOT%\\apps\\qt6\\plugins
      && qgis-bin.exe --noplugins --nologo --noversioncheck --profiles-path <an empty folder> --code test_app_window.py"
  Linux, macOS:
    QT_QPA_PLATFORM=offscreen TV_APP_TEST_OUT=out/app-window.json qgis --noplugins --nologo --noversioncheck \\
      --profiles-path "$(mktemp -d)" --code test_app_window.py

It writes its checks to TV_APP_TEST_OUT (JSON: {"ok", "failures", "checks"})
and ends QGIS. What it checks: the two buttons on the Web toolbar, the clock
opening the panel in its Historical mode, and the panel's Temporal
Controller button showing QGIS's own panel (0.10.0's did nothing)."""
import json
import os
import sys
import traceback

here = os.environ.get("TV_PLUGIN_DIR") or os.path.dirname(os.path.abspath(globals().get("__file__") or sys.argv[-1]))
sys.path.insert(0, here)
checks, failures = [], []


def check(ok, what):
    checks.append(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


def run():
    from qgis.utils import iface
    from qgis.core import Qgis, QgsSettings, QgsTemporalNavigationObject
    from qgis.PyQt.QtCore import QEventLoop, QTimer
    from qgis.PyQt.QtWidgets import QDockWidget, QAction
    from terrain_viewer import historical
    from terrain_viewer import historical_ui as hui
    from terrain_viewer.plugin import TerrainViewerPlugin

    def spin(ms=200):
        loop = QEventLoop()
        QTimer.singleShot(ms, loop.quit)
        loop.exec()

    QgsSettings().setValue("terrain_viewer/checkUpdates", "false")
    QgsSettings().setValue("terrain_viewer/appMode", "terrain")
    QgsSettings().setValue("terrain_viewer/backend", "remote")  # nothing started, nothing asked
    QgsSettings().setValue("terrain_viewer/service", "http://127.0.0.1:9")
    window = iface.mainWindow()
    tdock = window.findChild(QDockWidget, hui.TEMPORAL_DOCK)
    taction = window.findChild(QAction, hui.TEMPORAL_ACTION)
    check(tdock is not None and taction is not None and taction.isCheckable(),
          f"QGIS {Qgis.version()}: a dock named \"{hui.TEMPORAL_DOCK}\" (titled \"{tdock.windowTitle() if tdock else None}\") "
          f"and a checkable action {hui.TEMPORAL_ACTION}")
    check(isinstance(iface.mapCanvas().temporalController(), QgsTemporalNavigationObject),
          "the canvas's temporal controller is a QgsTemporalNavigationObject")
    plug = TerrainViewerPlugin(iface)
    plug.initGui()
    names = [a.objectName() or a.text() for a in iface.webToolBar().actions()]
    check(plug.action in iface.webToolBar().actions() and plug.historical_action in iface.webToolBar().actions()
          and not plug.historical_action.icon().isNull(), f"two buttons on the Web toolbar ({names})")
    plug.historical_action.trigger()
    hp = plug.dock.historical if plug.dock is not None else None
    if hp is not None:
        hp.paused = True  # no dates asked of Esri here
    spin(300)
    check(plug.dock is not None and plug.dock.mode == "historical" and plug.dock.isVisible() and hp.isVisible()
          and not plug.dock.terrain_page.isVisible() and plug.action.isChecked(),
          "the clock opens the panel in its Historical mode")
    check(hp.main_window() is window and hp.temporal_dock() is tdock and hp.temporal_action() is taction,
          "the panel finds QGIS's Temporal Controller panel and its action")
    was_hidden = tdock.isHidden() and not taction.isChecked()
    hp.temporal_btn.click()
    spin(300)
    check(was_hidden and tdock.isVisible() and taction.isChecked(),
          f"the Temporal Controller button shows QGIS's panel (hidden before: {was_hidden}; visible now: {tdock.isVisible()})")
    # Dates applied without any request: the navigation the panel drives is the application's.
    hp.sid = "eox-s2"
    hp.set_source("eox-s2")
    hp.listed_key = historical.place_key("eox-s2", 0, 0, 0)
    hp.apply(historical.eox_ticks(), True)
    nav = iface.mapCanvas().temporalController()
    check(nav.navigationMode() == hui.NAV_ANIMATED and nav.totalFrameCount() == len(historical.EOX_YEARS)
          and nav.currentFrameNumber() == len(historical.EOX_YEARS) - 1,
          f"the application's Temporal Controller steps through the panel's dates ({nav.totalFrameCount()} frames)")
    hp.set_step("month")
    check(nav.totalFrameCount() >= 12 * len(historical.EOX_YEARS) and hp.current_label.text() == str(historical.EOX_YEARS[-1]),
          f"step month: {nav.totalFrameCount()} frames, the date shown kept")
    nav.setCurrentFrameNumber(nav.totalFrameCount() - 1)
    last = [lyr.name() for lyr in hp.layers().values()
            if lyr.temporalProperties().isVisibleInTemporalRange(iface.mapCanvas().temporalRange())]
    check(last == [f"{historical.EOX_YEARS[-1]} · EOX Sentinel-2"] and hp.current_label.text() == str(historical.EOX_YEARS[-1]),
          f"its last frame, past the last date (QGIS counts 30-day months), still draws the newest ({last})")
    tdock.setUserVisible(False) if hasattr(tdock, "setUserVisible") else tdock.hide()
    spin(100)
    hp.temporal_btn.click()
    spin(200)
    check(tdock.isVisible(), "closed by hand, shown again by the button")
    hp.remove()
    plug.unload()
    check(plug.dock is None and plug.action is None and plug.historical_action is None, "unloaded: the panel and both buttons gone")


try:
    run()
except Exception:  # noqa: BLE001 - written to the result
    failures.append("exception")
    checks.append("FAIL " + traceback.format_exc())
out = os.environ.get("TV_APP_TEST_OUT")
if out:
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"ok": not failures, "failures": failures, "checks": checks}, f, indent=1)
print("\n".join(checks))
os._exit(1 if failures else 0)
