"""The building shadows' buildings, for real (network), under both backends:
OpenFreeMap's OSM buildings, Overture's (a PMTiles archive read by
live/pmtiles.py), an address of the user's own, and a polygon layer of the
QGIS project with its height field, written as GeoJSON and burnt by the
Python backend, registered with a tile service and swept by it. The two
backends are compared tile by tile: the same buildings, the same sun.

  TERRAIN_VIEWER_SERVICE=http://localhost:3400 QT_QPA_PLATFORM=offscreen python-qgis test_buildings_live.py

Without TERRAIN_VIEWER_SERVICE only the Python backend is checked. The tile
service must be on this machine (it reads the layer's GeoJSON from disk) and
one that answers /building-sources.
"""
import math
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication  # noqa: E402

app = QgsApplication([], True)
app.initQgis()
import numpy as np  # noqa: E402
from qgis.core import (  # noqa: E402
    QgsProject, QgsCoordinateReferenceSystem, QgsVectorLayer, QgsFeature, QgsGeometry, QgsRectangle, QgsDataSourceUri,
)
from qgis.gui import QgsMapCanvas, QgsLayerTreeMapCanvasBridge  # noqa: E402
from qgis.PyQt.QtCore import QEventLoop, QTimer  # noqa: E402
from qgis.PyQt.QtGui import QImage  # noqa: E402
from iconem_terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from iconem_terrain_viewer.live import buildings as lb  # noqa: E402
from iconem_terrain_viewer import links  # noqa: E402

failures = []
service = (os.environ.get("TERRAIN_VIEWER_SERVICE") or "").rstrip("/")
# La Défense's edge, Courbevoie: towers and houses; z16, 256 px tiles.
LAT, LNG, Z = 48.8925, 2.2420, 16
SUN = (135.0, 25.0)


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what, flush=True)
    if not ok:
        failures.append(what)


def spin(ms=200):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


def tile_of(lat, lon, z):
    n = 1 << z
    return (int((lon + 180) / 360 * n),
            int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n))


def shaded_of(url):
    """(256, 256) bool: the pixels a tile draws in shadow (dark, opaque)."""
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "terrain-viewer-qgis-test"}), timeout=180) as r:
        img = QImage.fromData(r.read()).convertToFormat(QImage.Format.Format_RGBA8888)
    a = np.frombuffer(bytes(img.constBits().asstring(img.sizeInBytes())), np.uint8).reshape(img.height(), img.bytesPerLine() // 4, 4)
    a = a[:, :img.width()]
    return (a[..., 0].astype(int) < 128) & (a[..., 3] > 128)


def layer_url(layer, z, x, y):
    uri = QgsDataSourceUri()
    uri.setEncodedUri(layer.source())
    return uri.param("url").replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))


TX, TY = tile_of(LAT, LNG, Z)
entries = {e["id"]: e for e in links.building_sources()}

# -- the Python backend's readers ---------------------------------------------------
results = {}
for name, spec in (("OpenFreeMap (the default)", None), ("Overture (PMTiles)", entries["overture-buildings"]),
                   ("an address of your own (OpenFreeMap's TileJSON)",
                    {"type": "tilejson", "url": "https://tiles.openfreemap.org/planet", "sourceLayers": ["building"], "heightField": "render_height"})):
    key = lb.register(spec)
    t0 = time.perf_counter()
    try:
        lit, own = lb.shadows(Z, TX, TY, 256, *SUN, key)
    except Exception as e:  # noqa: BLE001 - a source down is one failure
        check(False, f"{name}: not read ({str(e)[:120]})")
        continue
    results[name] = (lit, own)
    check((lit == 0).mean() > 0.03 and (own > 0).mean() > 0.03 and own.max() > 8 and not ((lit == 0) & (own > 0)).any(),
          f"Python backend, {name}: {100 * (own > 0).mean():.0f} % of the tile is roofs (tallest {own.max():.0f} m), "
          f"{100 * (lit == 0).mean():.0f} % in shadow, the roofs lit, {time.perf_counter() - t0:.1f} s")
if len(results) == 3:
    a, b, c = (results[k] for k in results)
    check(np.array_equal(a[0], c[0]) and np.array_equal(a[1], c[1]), "an address of your own draws as the Library's entry of the same tiles")
    both = ((a[1] > 0) & (b[1] > 0)).sum() / max(1, ((a[1] > 0) | (b[1] > 0)).sum())
    check(both > 0.5, f"Overture's footprints and OpenStreetMap's overlap here ({100 * both:.0f} % of their union)")
src = lb.source_of(lb.register(entries["overture-buildings"]))
check(src.archive is not None and src.zoom == 14 and "{release}" not in src.archive.url,
      f"Overture: read at zoom {src.zoom} from {src.archive.url if src.archive else '?'}")

# -- a polygon layer of the project, under both backends -------------------------------
canvas = QgsMapCanvas()
canvas.resize(800, 600)
canvas.show()
bridge = QgsLayerTreeMapCanvasBridge(QgsProject.instance().layerTreeRoot(), canvas)
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
canvas.freeze(True)
dock = TerrainViewerDock(canvas, None, None, bridge)
dock.project_fresh = False
dock.zoom_to(LAT, LNG, 15)
spin(100)
# Six blocks in Lambert-93 around the tile's centre: 15 to 120 m, one with a hole.
n = 1 << Z
size = 2 * lb.WORLD / n
cx, cy = -lb.WORLD + (TX + 0.5) * size, lb.WORLD - (TY + 0.5) * size
from qgis.core import QgsCoordinateTransform, QgsPointXY  # noqa: E402
to93 = QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:3857"), QgsCoordinateReferenceSystem("EPSG:2154"), QgsProject.instance())
c93 = to93.transform(QgsPointXY(cx, cy))
bati = QgsVectorLayer("Polygon?crs=EPSG:2154&field=hauteur:double&field=niveaux:integer", "bati test", "memory")
feats = []
for i, (dx, dy, w, h) in enumerate(((-120, -60, 40, 15.0), (-40, -80, 30, 60.0), (30, -20, 50, 25.0), (-100, 40, 25, 120.0), (60, 60, 35, 40.0))):
    f = QgsFeature(bati.fields())
    f.setGeometry(QgsGeometry.fromRect(QgsRectangle(c93.x() + dx, c93.y() + dy, c93.x() + dx + w, c93.y() + dy + w)))
    f.setAttributes([h, int(h // 3)])
    feats.append(f)
ring = QgsFeature(bati.fields())
ring.setGeometry(QgsGeometry.fromWkt(
    f"POLYGON(({c93.x() - 20} {c93.y() + 20}, {c93.x() + 40} {c93.y() + 20}, {c93.x() + 40} {c93.y() + 80}, {c93.x() - 20} {c93.y() + 80}, {c93.x() - 20} {c93.y() + 20}),"
    f"({c93.x()} {c93.y() + 40}, {c93.x()} {c93.y() + 60}, {c93.x() + 20} {c93.y() + 60}, {c93.x() + 20} {c93.y() + 40}, {c93.x()} {c93.y() + 40}))"))
ring.setAttributes([30.0, 10])
bati.dataProvider().addFeatures(feats + [ring])
bati.updateExtents()
dock.keep_extent()
QgsProject.instance().addMapLayer(bati)
spin(100)
dock.set_light(*SUN, schedule=False)

dock.set_backend("python")
spin(300)
row = dock.rows["buildingShadows"]
bf = row.buildings
bf.source.setCurrentIndex(bf.source.findData("layer:" + bati.id()))
check(bf.field.currentData() == "hauteur", "the layer picked under \"Buildings from\", its height field found")
row.check.setChecked(True)
dock.flush()
spin(200)
py_layer = dock.stack.find("buildingShadows")
py_url = layer_url(py_layer, Z, TX, TY) if py_layer is not None else ""
check(py_layer is not None and "buildings=" in py_url and "6 buildings of bati test" in bf.note.text(),
      f"Python backend: the layer's address names the buildings written for it ({bf.note.text()})")
py_shade = shaded_of(py_url) if py_url else None
if py_shade is not None:
    key, _why = bf.python_key()
    lit, own = lb.shadows(Z, TX, TY, 256, *SUN, key)
    check(py_shade.mean() > 0.02 and own.max() == 120.0 and np.array_equal(py_shade, lit == 0),
          f"its tile from the plugin's server: {100 * py_shade.mean():.1f} % in shadow, roofs up to {own.max():.0f} m")

if not service:
    print("  skip the tile service: none given (set TERRAIN_VIEWER_SERVICE=http://localhost:3400)")
else:
    dock.url.setText(service)
    dock.set_backend("remote")
    spin(500)
    check(dock.connected == "remote" and dock.catalog.building_sources and any(e["id"] == "overture-buildings" for e in dock.catalog.building_sources),
          f"the tile service lists its building sources (/building-sources: {len(dock.catalog.building_sources or [])})")
    row = dock.rows["buildingShadows"]
    bf = row.buildings
    check(bf.kind() == ("layer", bati.id()) and row.row.on("colour"), "the choice and the checked mode kept across the backends")
    dock.flush()
    spin(300)
    sv_layer = dock.stack.find("buildingShadows")
    sv_url = layer_url(sv_layer, Z, TX, TY) if sv_layer is not None else ""
    check("buildingShadowSource=file%3A" in sv_url or "buildingShadowSource=file:" in sv_url,
          f"tile service: the layer's GeoJSON registered with it, file:<id> in the address ({dock.warnings[-1][:90] if dock.warnings else 'no warning'})")
    if "buildingShadowSource=file" in sv_url:
        sv_shade = shaded_of(sv_url + "&buildingShadowOpacity=1")
        inter, union = (sv_shade & py_shade).sum(), (sv_shade | py_shade).sum()
        check(union > 500 and inter / union > 0.85,
              f"the same layer swept by the tile service and burnt by the Python backend: {100 * inter / union:.1f} % of the "
              f"shaded pixels agree ({sv_shade.sum()} and {py_shade.sum()} px)")
        # The other sources through the service, against the Python backend's.
        for sid, label in (("osm-buildings-openfreemap", "OpenFreeMap (the default)"), ("overture-buildings", "Overture (PMTiles)")):
            bf.set_params({"buildingShadowSource": sid})
            u = row.urls()["buildingShadows"][0].replace("{z}", str(Z)).replace("{x}", str(TX)).replace("{y}", str(TY))
            try:
                s = shaded_of(u)
            except Exception as e:  # noqa: BLE001
                check(False, f"tile service, {sid}: {str(e)[:100]}")
                continue
            p = results.get(label)
            if p is not None:
                pm = p[0] == 0
                inter, union = (s & pm).sum(), (s | pm).sum()
                check(("buildingShadowSource=overture-buildings" in u) == (sid == "overture-buildings") and inter / max(1, union) > 0.8,
                      f"tile service, {sid}: {100 * s.mean():.0f} % in shadow, {100 * inter / max(1, union):.0f} % agreeing with the Python backend")
row.check.setChecked(False)
dock.flush()
QgsProject.instance().removeEntry("terrain_viewer", "buildingsFrom")
dock.cleanup()
from iconem_terrain_viewer.live.server import LiveServer  # noqa: E402
LiveServer.shutdown()
print("FAILURES:" if failures else "OK", *failures, sep="\n  ", flush=True)
canvas.stopRendering()
QgsProject.instance().clear()
spin(200)
app.exitQgis()
sys.exit(1 if failures else 0)
