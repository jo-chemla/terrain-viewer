"""Installing the local tile service: the bundle of this platform downloaded
from the GitHub release pinned in service_pins.json (Node, the tile service,
its node_modules with that platform's sharp, about 50 MB), its sha256
checked against the pin, unpacked into the plugin's data folder
(local_server.installed_dir()). Downloaded through QGIS's network manager
(QgsBlockingNetworkRequest: QGIS's proxy and SSL settings), so it runs in a
QgsTask; `fetch` can be replaced (tests).

  install(progress=lambda done, total: ...)  -> the folder, or raises InstallError
  uninstall()

WhiteboxTools' QGIS plugin downloads its binary the same way on first use;
SAGA, GRASS and OTB come with QGIS (OSGeo4W, the installers) or are installed
apart, the plugins only point at them."""
import hashlib
import io
import os
import shutil
import zipfile

from . import local_server


class InstallError(Exception):
    pass


def asset(p=None, plat=None):
    """(url, file, sha256, size) of this platform's pinned bundle."""
    p = p if p is not None else local_server.pins()
    plat = plat or local_server.platform_label()
    a = (p.get("assets") or {}).get(plat)
    if not plat or not a:
        raise InstallError(f"no tile service bundle for this platform ({plat or 'unknown'})")
    return f"{p['base'].rstrip('/')}/{a['file']}", a["file"], a["sha256"].lower(), int(a.get("size") or 0)


def fetch_qgis(url, progress=None):
    """The bytes at `url`, through QGIS's network manager (redirects followed:
    GitHub sends release assets from another host)."""
    from qgis.core import QgsBlockingNetworkRequest
    from qgis.PyQt.QtCore import QUrl
    from qgis.PyQt.QtNetwork import QNetworkRequest

    req = QNetworkRequest(QUrl(url))
    attr = getattr(QNetworkRequest, "Attribute", QNetworkRequest)
    policy = getattr(QNetworkRequest, "RedirectPolicy", QNetworkRequest)
    req.setAttribute(attr.RedirectPolicyAttribute, policy.NoLessSafeRedirectPolicy)
    blocking = QgsBlockingNetworkRequest()
    if progress is not None:
        blocking.downloadProgress.connect(lambda done, total: progress(int(done), int(total)))
    err = blocking.get(req, True)
    codes = getattr(QgsBlockingNetworkRequest, "ErrorCode", QgsBlockingNetworkRequest)
    if err != codes.NoError:
        raise InstallError(f"{url}: {blocking.errorMessage()}")
    return bytes(blocking.reply().content())


def _extract(data, dest):
    """The zip unpacked into `dest` (made fresh), no path leaving it."""
    root = os.path.realpath(dest)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            target = os.path.realpath(os.path.join(dest, info.filename))
            if not (target == root or target.startswith(root + os.sep)):
                raise InstallError(f"unsafe path in the bundle: {info.filename}")
        z.extractall(dest)


def install(progress=None, fetch=None, p=None, plat=None):
    """Downloads, checks and unpacks the pinned bundle; returns its folder.
    Earlier releases' folders are removed once the new one is in place."""
    p = p if p is not None else local_server.pins()
    url, name, sha, size = asset(p, plat)
    dest = local_server.installed_dir(p, plat)
    data = (fetch or fetch_qgis)(url, progress)
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        raise InstallError(f"{name}: sha256 {got}, the plugin expects {sha} (download corrupted or replaced): not installed")
    if size and len(data) != size:
        raise InstallError(f"{name}: {len(data)} bytes, the plugin expects {size}: not installed")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part"
    shutil.rmtree(part, ignore_errors=True)
    _extract(data, part)
    if not local_server.bundled(part):
        shutil.rmtree(part, ignore_errors=True)
        raise InstallError(f"{name}: no bin/node and server.mjs inside")
    local_server.stop_instance()  # a running copy holds files open on Windows
    shutil.rmtree(dest, ignore_errors=True)
    os.replace(part, dest)
    home = local_server.service_home()
    for other in os.listdir(home):
        if other != p["release"]:
            shutil.rmtree(os.path.join(home, other), ignore_errors=True)
    return dest


def uninstall():
    """Removes every downloaded service (the running one stopped first)."""
    local_server.stop_instance()
    home = local_server.service_home()
    if os.path.isdir(home):
        shutil.rmtree(home, ignore_errors=True)
