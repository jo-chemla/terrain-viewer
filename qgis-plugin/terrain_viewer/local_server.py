"""The bundled tile service: the platform zips of the plugin carry one in
terrain_viewer/server/ (Node, the service, its node_modules with that
platform's sharp; qgis-plugin/make_zip.py --bundled). It is started on this
machine only (127.0.0.1), on a port of its own, when the panel connects to
it, and stopped when the plugin unloads or QGIS quits. It also stops by
itself when its standard input closes, i.e. if QGIS goes without stopping it.

No QGIS widget here: the panel shows `status()`; the test drives it as is."""
import atexit
import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.join(HERE, "server")
# The port asked first, so the layers of a saved project find the service
# again next time; another free one when it is taken.
PREFERRED_PORT = 3410


def node_path(server_dir=SERVER_DIR):
    return os.path.join(server_dir, "bin", "node.exe" if sys.platform == "win32" else "node")


def bundled(server_dir=SERVER_DIR):
    """Whether this copy of the plugin carries a tile service."""
    return os.path.isfile(node_path(server_dir)) and os.path.isfile(os.path.join(server_dir, "server.mjs"))


def bundle_info(server_dir=SERVER_DIR):
    try:
        with open(os.path.join(server_dir, "bundle.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url, timeout):
    # Straight to localhost: no proxy, whatever the machine's settings.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=timeout) as r:
        return r.status, r.read()


class LocalServer:
    """One bundled service process."""

    def __init__(self, server_dir=SERVER_DIR):
        self.server_dir = server_dir
        self.proc = None
        self.port = None
        self.log_path = os.path.join(tempfile.gettempdir(), "terrain-viewer-qgis-tile-service.log")
        self.error = None
        atexit.register(self.stop)

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}" if self.port else None

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def status(self):
        if self.running():
            return f"Bundled tile service running on {self.url} (process {self.proc.pid})"
        if self.error:
            return f"Bundled tile service stopped: {self.error}"
        return "Bundled tile service not started"

    def start(self, earthdata_token="", timeout=60):
        """Start the service if it is not running, wait until it answers
        /health; returns its address. Raises RuntimeError with the reason
        (and the end of its log) otherwise."""
        if self.running():
            return self.url
        if not bundled(self.server_dir):
            raise RuntimeError("this copy of the plugin has no bundled tile service (install a platform zip)")
        node = node_path(self.server_dir)
        if sys.platform != "win32":
            # QGIS's zip installer drops the executable bits.
            mode = os.stat(node).st_mode
            if not mode & stat.S_IXUSR:
                os.chmod(node, mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        self.port = PREFERRED_PORT if _port_free(PREFERRED_PORT) else _free_port()
        env = {k: v for k, v in os.environ.items() if k not in ("EARTHDATA_TOKEN", "NODE_OPTIONS", "PORT")}
        env.update({
            "PORT": str(self.port),
            "TV_HOST": "127.0.0.1",
            "TV_EXIT_WITH_STDIN": "1",
            # No .env is read next to the service: the token, if any, is the
            # one set in the plugin's settings.
            "TV_ENV_FILE": os.path.join(self.server_dir, "no-such.env"),
        })
        if earthdata_token:
            env["EARTHDATA_TOKEN"] = earthdata_token
        kwargs = {}
        if sys.platform == "win32":
            kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW: no console window
        else:
            kwargs["start_new_session"] = True  # Ctrl+C in QGIS's terminal is not for it
        log = open(self.log_path, "wb")
        self.error = None
        self.proc = subprocess.Popen([node, "server.mjs"], cwd=self.server_dir, env=env, stdin=subprocess.PIPE,
                                     stdout=log, stderr=subprocess.STDOUT, **kwargs)
        log.close()
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                self.error = f"exited with code {self.proc.returncode}: {self.log_tail()}"
                self.proc = None
                raise RuntimeError(self.error)
            try:
                code, _ = _get(f"{self.url}/health", 2)
                if code == 200:
                    return self.url
            except OSError:
                pass
            time.sleep(0.25)
        self.stop()
        self.error = f"no answer within {timeout} s: {self.log_tail()}"
        raise RuntimeError(self.error)

    def stop(self):
        proc, self.proc = self.proc, None
        if proc is None or proc.poll() is not None:
            return
        try:
            proc.stdin.close()  # the service stops when its input closes
        except OSError:
            pass
        try:
            proc.wait(3)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(3)

    def log_tail(self, n=600):
        try:
            with open(self.log_path, "rb") as f:
                return f.read().decode("utf-8", "replace")[-n:].strip()
        except OSError:
            return ""


_instance = None


def instance():
    """The one service of this QGIS session."""
    global _instance
    if _instance is None:
        _instance = LocalServer()
    return _instance


def stop_instance():
    if _instance is not None:
        _instance.stop()
