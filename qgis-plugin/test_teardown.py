"""How a headless test leaves QGIS: as the application does.

    import test_teardown
    test_teardown.leave(app, 1 if failures else 0, dock, bridge, canvas)

Why (found 2026-11-27, 0.12.2). The scripts ended with `app.exitQgis()` then
`sys.exit()`. `exitQgis()` destroys GDAL's drivers; `sys.exit()` then ends
the interpreter, which deletes whatever the script still holds: its
`QgsMapCanvas`, its GDAL datasets. Deleted after GDAL, these call into
drivers that are gone. On QGIS 3.44.11 `test_setup_live.py` and
`test_live.py` ended that way with an access violation after their "OK"
(exit code 0xC0000005), 8 runs of 34 of the first; QGIS 4.2 never.

The fault, read with a vectored exception handler (the main thread, inside
`Py_FinalizeEx`, a call to address 0 from gdal313.dll both times):

    test_setup_live.py   QgsMapCanvas::~QgsMapCanvas > cancelJobs >
                         QgsMapRendererCustomPainterJob::cancel >
                         futureFinished > cleanupJobs >
                         QgsRasterLayerRenderer::~QgsRasterLayerRenderer >
                         QgsRasterPipe::~QgsRasterPipe > gdal313.dll
    test_live.py         a module's names cleared (PyDict_Clear) >
                         _gdal.pyd (a dataset of osgeo freed) > gdal313.dll

(The canvas case needs its last render job to be still there, which is a
matter of timing: hence one run in four.)

The application cannot do this (QGIS 3.44, read in its source):

- `QgisApp::~QgisApp` (src/app/qgisapp.cpp) deletes the Python utilities,
  then every map canvas, then its panels, and ends on "This function
  *MUST* be the last one called, as it destroys in particular GDAL":
  `QgsApplication::exitQgis()`.
- It never ends the interpreter: `QgsPythonUtilsImpl::exitPython`
  (src/python/qgspythonutilsimpl.cpp) reads "// causes segfault!
  //Py_Finalize();". A Python object a plugin still holds when QGIS quits
  is never deleted at all.

So it was these scripts' teardown, not the plugin, and `leave` does what
QGIS does: the widgets deleted while GDAL is there, `exitQgis()`, and the
process ended without ending the interpreter. TV_TEARDOWN=old brings the
former ending back (to see the crash again).
"""
import os
import sys


def leave(app, code, *widgets):
    """Delete `widgets` in the order given (a panel before the canvas it
    draws on), empty the project, `app.exitQgis()`, then end the process
    with `code`, Python's exit functions run (a packaged tile server
    stopped) but the interpreter not finalized."""
    if os.environ.get("TV_TEARDOWN") == "old":
        app.exitQgis()
        sys.exit(code)
    try:
        from qgis.PyQt import sip
    except ImportError:  # an older PyQt5 layout
        import sip
    from qgis.PyQt.QtCore import QCoreApplication, QEvent
    from qgis.core import QgsProject
    for w in widgets:
        if w is None or sip.isdeleted(w):
            continue
        stop = getattr(w, "stopRendering", None)  # a canvas: its job ended while GDAL is here
        if stop is not None:
            stop()
        sip.delete(w)
    QgsProject.instance().clear()
    QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
    QCoreApplication.processEvents()
    app.exitQgis()
    try:
        import atexit
        atexit._run_exitfuncs()
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(code)
