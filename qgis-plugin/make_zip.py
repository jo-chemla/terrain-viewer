"""The plugin as a zip QGIS installs (Plugins > Manage and Install Plugins >
Install from ZIP): python make_zip.py -> dist/terrain_viewer-<version>.zip"""
import configparser
import os
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "terrain_viewer")
meta = configparser.ConfigParser()
meta.read(os.path.join(src, "metadata.txt"), encoding="utf-8")
version = meta["general"]["version"]
os.makedirs(os.path.join(here, "dist"), exist_ok=True)
out = os.path.join(here, "dist", f"terrain_viewer-{version}.zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in files:
            if f.endswith((".pyc", ".pyo")):
                continue
            path = os.path.join(root, f)
            z.write(path, os.path.relpath(path, here))
print(out)
