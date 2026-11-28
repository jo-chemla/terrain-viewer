# Run by test_panel_units.py (exec, in its namespace: `check`). 0.12.2: the
# Python backend's server stopped while tiles are being answered. A request
# is answered in a thread of its own, and a building shadows tile is
# computed there with GDAL: stop() waits for those threads (up to
# HANDLER_GRACE_S), so that none still works while QGIS tears GDAL down.
# No network: the tiles are made here, slowly.
import threading as _sv_threading
import time as _sv_time
import urllib.request as _sv_request

from iconem_terrain_viewer.live import server as _sv


def _sv_run(seconds, n=4):
    """A private server (not the session's) whose tiles take `seconds`,
    asked `n` tiles, then stopped: (busy when stopped, still busy after,
    how long stop() took, what the clients got)."""
    srv = _sv.LiveServer(port=0)
    begun = _sv_threading.Event()

    def slow(source, mode, z, x, y, opts, ext):
        begun.set()
        _sv_time.sleep(seconds)
        return b"tile", {"wait_ms": 0.0, "fetch_ms": 0.0, "compute_ms": 0.0}

    srv.tile = slow
    got = []

    def ask(i):
        try:
            with _sv_request.urlopen(f"http://127.0.0.1:{srv.port}/slope/5/{i}/1.png", timeout=20) as r:
                got.append(r.read())
        except Exception as e:  # noqa: BLE001
            got.append(repr(e))

    clients = [_sv_threading.Thread(target=ask, args=(i,), daemon=True) for i in range(n)]
    for c in clients:
        c.start()
    begun.wait(5)
    until = _sv_time.monotonic() + 3
    while srv.httpd.active < n and _sv_time.monotonic() < until:
        _sv_time.sleep(0.01)
    busy = srv.httpd.active
    t0 = _sv_time.monotonic()
    srv.stop()
    took = _sv_time.monotonic() - t0
    left = srv.httpd.active
    return busy, left, took, got, clients


_busy, _left, _took, _got, _clients = _sv_run(0.6)
for _c in _clients:
    _c.join(5)
check(_busy == 4 and _left == 0 and _got == [b"tile"] * 4 and 0.2 < _took < _sv.HANDLER_GRACE_S,
      f"the Python backend's server stopped while 4 tiles are being answered: it waits for them ({_took:.2f} s), "
      f"none left working, the 4 answered")
_busy, _left, _took, _got, _clients = _sv_run(_sv.HANDLER_GRACE_S + 2.0, n=2)
check(_busy == 2 and _left == 2 and _sv.HANDLER_GRACE_S - 0.2 < _took < _sv.HANDLER_GRACE_S + 1.0,
      f"a tile that does not end: stop() gives up after {_sv.HANDLER_GRACE_S:g} s ({_took:.2f} s), QGIS is not held")
for _c in _clients:
    _c.join(6)
