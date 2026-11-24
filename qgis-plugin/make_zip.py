"""The plugins as zips QGIS installs (Plugins > Manage and Install Plugins >
Install from ZIP):
  python make_zip.py                 -> dist/terrain_viewer-<version>.zip and dist/send2map_app-<version>.zip
  python make_zip.py send2map_app    -> only that one"""
import configparser
import os
import sys
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
PLUGINS = ["terrain_viewer", "send2map_app"]
SKIP_DIRS = {"__pycache__", "logos-hd"}  # logos-hd: the icons' sources, not used by the plugin


def build(name):
    src = os.path.join(here, name)
    meta = configparser.ConfigParser(interpolation=None)
    meta.read(os.path.join(src, "metadata.txt"), encoding="utf-8")
    version = meta["general"]["version"]
    os.makedirs(os.path.join(here, "dist"), exist_ok=True)
    out = os.path.join(here, "dist", f"{name}-{version}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if f.endswith((".pyc", ".pyo")):
                    continue
                path = os.path.join(root, f)
                z.write(path, os.path.relpath(path, here))
    return out


for name in sys.argv[1:] or PLUGINS:
    print(build(name))
