"""Updating the plugin itself, without plugins.qgis.org. Two ways, both from
the repository's GitHub releases:

- A QGIS plugin repository: every qgis-plugins-* release attaches a
  plugins.xml (make_zip.py --plugins-xml), also copied to the fixed release
  `qgis-plugins-repository`, whose address never changes (REPOSITORY_XML).
  Added once in Plugins > Manage and Install Plugins > Settings > Add, QGIS
  then lists the plugins and offers their updates as for any repository.
- The panel: at most once a day it reads that same plugins.xml in the
  background; a newer version shows "Update to x.y.z", which downloads the
  zip, checks its sha256 (in plugins.xml), unpacks it over this plugin's
  folder and offers to reload the plugin (or restart QGIS).

No email anywhere: plugins.xml names the author (Iconem) only.

  parse_plugins_xml(data, "iconem_terrain_viewer") -> {"version", "download_url", "sha256", ...} or None
  install_zip(data, sha256, folder)          -> the version installed, or raises UpdateError
"""
import configparser
import hashlib
import io
import os
import shutil
import tempfile
import zipfile
from xml.etree import ElementTree

# The plugin's folder, which is its id in QGIS and its key in plugins.xml
# (terrain_viewer up to 0.12.0: an unrelated plugin on plugins.qgis.org has
# that folder name, and QGIS merges plugins by folder name).
PLUGIN = "iconem_terrain_viewer"
REPOSITORY_TAG = "qgis-plugins-repository"
REPOSITORY_XML = f"https://github.com/Iconem/terrain-viewer/releases/download/{REPOSITORY_TAG}/plugins.xml"
CHECK_EVERY_S = 24 * 3600
# Left in place by an update: a tile service unpacked for development.
KEEP = {"server", "__pycache__"}


class UpdateError(Exception):
    pass


def parse_version(v):
    """"0.9.0" -> (0, 9, 0); a suffix is dropped ("1.0.0-rc1" -> (1, 0, 0))."""
    out = []
    for part in str(v or "").strip().split("."):
        digits = ""
        for ch in part:
            if not ch.isdigit():
                break
            digits += ch
        out.append(int(digits or 0))
    while len(out) < 3:
        out.append(0)
    return tuple(out)


def newer(candidate, current):
    return parse_version(candidate) > parse_version(current)


def plugin_dir():
    return os.path.dirname(os.path.abspath(__file__))


def installed_version(folder=None):
    meta = configparser.ConfigParser(interpolation=None)
    meta.read(os.path.join(folder or plugin_dir(), "metadata.txt"), encoding="utf-8")
    return meta["general"]["version"]


def parse_plugins_xml(data, name=PLUGIN):
    """The entry of plugin `name` in a QGIS plugin repository XML (its key is
    the part of <file_name> before the first dot, as QGIS reads it): a dict
    of its version, download_url, sha256 (this repository's own element,
    which QGIS ignores) and qgis_minimum_version; None when it is not
    listed."""
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as e:
        raise UpdateError(f"plugins.xml: {e}")
    for node in root.iter("pyqgis_plugin"):
        file_name = (node.findtext("file_name") or "").strip()
        if file_name.partition(".")[0] != name:
            continue
        out = {k: (node.findtext(k) or "").strip() for k in
               ("version", "download_url", "sha256", "file_name", "qgis_minimum_version", "qgis_maximum_version")}
        out["name"] = node.get("name", name)
        return out
    return None


def can_update(folder=None):
    """(True, "") when this plugin's folder is a plain install the panel may
    overwrite; (False, why) for a development copy (a link into a checkout,
    or a folder inside a git repository)."""
    folder = folder or plugin_dir()
    if os.path.islink(folder) or os.path.realpath(folder) != os.path.abspath(folder):
        return False, "this plugin is a link to a development copy: update it with git"
    d = os.path.dirname(os.path.abspath(folder))
    for _ in range(6):
        if os.path.exists(os.path.join(d, ".git")):
            return False, "this plugin is inside a git checkout: update it with git"
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    if not os.access(folder, os.W_OK):
        return False, f"{folder} is not writable"
    return True, ""


def install_zip(data, sha256, folder=None, name=PLUGIN):
    """A plugin zip checked (its sha256, one top folder named `name` with a
    metadata.txt, no path leaving it) and unpacked over `folder`: its files
    replace this version's, files the new version no longer has are
    removed (a development tile service, server/, and caches stay).
    Returns the version installed."""
    folder = folder or plugin_dir()
    got = hashlib.sha256(data).hexdigest()
    if sha256 and got != sha256.lower():
        raise UpdateError(f"sha256 {got}, plugins.xml says {sha256}: download corrupted or replaced, not installed")
    if not sha256:
        raise UpdateError("plugins.xml gives no sha256 for it: not installed")
    tmp = tempfile.mkdtemp(prefix="terrain-viewer-update-")
    try:
        root = os.path.realpath(tmp)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                target = os.path.realpath(os.path.join(tmp, info.filename))
                if not target.startswith(root + os.sep) or not info.filename.replace("\\", "/").startswith(name + "/"):
                    raise UpdateError(f"unexpected path in the zip: {info.filename}")
            z.extractall(tmp)
        new = os.path.join(tmp, name)
        if not os.path.isfile(os.path.join(new, "metadata.txt")):
            raise UpdateError(f"no {name}/metadata.txt in the zip")
        version = installed_version(new)
        new_files = set()
        for r, dirs, files in os.walk(new):
            dirs[:] = [d for d in dirs if d not in KEEP]
            for f in files:
                rel = os.path.relpath(os.path.join(r, f), new)
                new_files.add(os.path.normcase(rel))
                dest = os.path.join(folder, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(os.path.join(r, f), dest)
        for r, dirs, files in os.walk(folder, topdown=True):
            dirs[:] = [d for d in dirs if d not in KEEP]
            for f in files:
                rel = os.path.relpath(os.path.join(r, f), folder)
                if os.path.normcase(rel) not in new_files:
                    try:
                        os.remove(os.path.join(r, f))
                    except OSError:
                        pass
        return version
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def request(url, timeout_ms=20000):
    """A QNetworkRequest for `url`: redirects followed (GitHub sends release
    assets from another host), never from QGIS's cache (a cached plugins.xml
    would hide a release)."""
    from qgis.PyQt.QtCore import QUrl
    from qgis.PyQt.QtNetwork import QNetworkRequest
    req = QNetworkRequest(QUrl(url))
    req.setTransferTimeout(timeout_ms)
    policy = getattr(QNetworkRequest, "RedirectPolicy", QNetworkRequest)
    req.setAttribute(QNetworkRequest.Attribute.RedirectPolicyAttribute, policy.NoLessSafeRedirectPolicy)
    req.setAttribute(QNetworkRequest.Attribute.CacheLoadControlAttribute, QNetworkRequest.CacheLoadControl.AlwaysNetwork)
    req.setAttribute(QNetworkRequest.Attribute.CacheSaveControlAttribute, False)
    return req


def fetch(url, timeout_ms=60000):
    """Bytes at `url` through QGIS's network manager (its proxy and SSL),
    blocking (a plugin zip is about 150 KB)."""
    from qgis.core import QgsBlockingNetworkRequest
    blocking = QgsBlockingNetworkRequest()
    err = blocking.get(request(url, timeout_ms), True)
    codes = getattr(QgsBlockingNetworkRequest, "ErrorCode", QgsBlockingNetworkRequest)
    if err != codes.NoError:
        raise UpdateError(f"{url}: {blocking.errorMessage()}")
    return bytes(blocking.reply().content())
