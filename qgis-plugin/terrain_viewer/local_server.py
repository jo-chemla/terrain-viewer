"""The local tile service: Node, the service and its node_modules with the
platform's sharp, as one folder (qgis-plugin/make_zip.py --service-bundle).
The plain plugin does not carry it: "Install local tile service" in the
panel downloads the bundle of this platform from the GitHub release named in
service_pins.json (that version, its sha256 checked) into the plugin's data
folder (service_install.py). A copy unpacked as terrain_viewer/server/ (a
0.4 platform zip, a developer's build) is used first.

Off by default: it is started only when "Local tile service" is checked in
the panel and the panel connects, on this machine only (127.0.0.1), on a
port of its own, and stopped when the box is unchecked, the plugin unloads
or QGIS quits. It also stops by itself when its standard input closes, i.e.
if QGIS goes without stopping it. It has no browser engine (no
playwright-core, no Chrome or Edge looked for): QGIS asks for flat, north-up
tiles, which the direct engine draws; anything else answers 501.

No QGIS widget here (and no QGIS import at load: smoke_bundled.py loads this
file alone): the panel shows `status()`; the tests drive it as is."""
import atexit
import json
import os
import platform
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LEGACY_DIR = os.path.join(HERE, "server")
PINS = os.path.join(HERE, "service_pins.json")
# The port asked first, so the layers of a saved project find the service
# again next time; another free one when it is taken.
PREFERRED_PORT = 3410


def platform_label():
    """This machine as the bundles name it, or None when there is none for it."""
    m = platform.machine().lower()
    arm, x64 = m in ("arm64", "aarch64"), m in ("amd64", "x86_64", "x64")
    if sys.platform == "win32" and x64:
        return "windows-x64"
    if sys.platform == "darwin":
        return "macos-arm64" if arm else "macos-x64"
    if sys.platform.startswith("linux") and x64:
        return "linux-x64"
    return None


def pins():
    """service_pins.json: the release, the base address and, per platform,
    the bundle's file name, sha256 and size."""
    try:
        with open(PINS, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def service_home():
    """Where downloaded services live: the plugin's data folder in the QGIS
    profile (TV_SERVICE_HOME overrides it, e.g. for tests)."""
    if os.environ.get("TV_SERVICE_HOME"):
        return os.environ["TV_SERVICE_HOME"]
    try:
        from qgis.core import QgsApplication
        base = QgsApplication.qgisSettingsDirPath()
    except Exception:  # noqa: BLE001 - outside QGIS
        base = os.path.join(os.path.expanduser("~"), ".terrain_viewer")
    return os.path.join(base, "terrain_viewer", "tile-service")


def installed_dir(p=None, plat=None):
    """The folder the pinned bundle of this platform is (or would be) unpacked in."""
    p = p if p is not None else pins()
    plat = plat or platform_label()
    if not p.get("release") or not plat:
        return None
    return os.path.join(service_home(), p["release"], plat)


def current_dir():
    """The service this plugin runs: terrain_viewer/server/ when there is
    one, else the installed one (None when neither)."""
    if bundled(LEGACY_DIR):
        return LEGACY_DIR
    d = installed_dir()
    return d if d and bundled(d) else None


def installable():
    """Whether a bundle is pinned for this platform."""
    return bool(platform_label() and platform_label() in pins().get("assets", {}))


def node_path(server_dir):
    return os.path.join(server_dir, "bin", "node.exe" if sys.platform == "win32" else "node")


def bundled(server_dir=None):
    """Whether a tile service is at hand (in `server_dir`, or the one this plugin runs)."""
    server_dir = server_dir or current_dir()
    return bool(server_dir) and os.path.isfile(node_path(server_dir)) and os.path.isfile(os.path.join(server_dir, "server.mjs"))


def bundle_info(server_dir=None):
    server_dir = server_dir or current_dir()
    if not server_dir:
        return {}
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

    def __init__(self, server_dir=None):
        self.server_dir = server_dir  # None: current_dir() when it starts
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
            return f"Local tile service running on {self.url} (process {self.proc.pid})"
        if self.error:
            return f"Local tile service stopped: {self.error}"
        if self.proc is not None:  # started, then gone without stop()
            return f"Local tile service stopped (exit code {self.proc.returncode}, log: {self.log_path})"
        return "Local tile service not started"

    def start(self, earthdata_token="", timeout=60):
        """Start the service if it is not running, wait until it answers
        /health; returns its address. Raises RuntimeError with the reason
        (and the end of its log) otherwise."""
        if self.running():
            return self.url
        server_dir = self.server_dir or current_dir()
        if not bundled(server_dir):
            raise RuntimeError("no local tile service installed (Install local tile service, in the panel)")
        node = node_path(server_dir)
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
            # Flat, north-up tiles only: never look for Chrome or Edge.
            "TV_NO_BROWSER": "1",
            # No .env is read next to the service: the token, if any, is the
            # one set in the plugin's settings.
            "TV_ENV_FILE": os.path.join(server_dir, "no-such.env"),
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
        self.proc = subprocess.Popen([node, "server.mjs"], cwd=server_dir, env=env, stdin=subprocess.PIPE,
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
