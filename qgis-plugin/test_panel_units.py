"""The panel's pieces that need no tile service and no network: the slider
ranges and symmetric pairs (settings_ui), share links (service), the Python
backend's mapping of the service's modes, settings and sources
(python_backend), the packaged assets, the widgets (the light pad, the
slider and its box), the sun's position (solar, against the app's
TypeScript), and the panel without a service (the backends' radio buttons,
the sun light, the canvas kept in place, the overlays' labels), in headless
QGIS:

  QT_QPA_PLATFORM=offscreen python-qgis test_panel_units.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qgis.core import QgsApplication  # noqa: E402

app = QgsApplication([], True)
app.initQgis()

from iconem_terrain_viewer import assets, python_backend as pyb  # noqa: E402
from iconem_terrain_viewer.service import split_link, link_params, clean_enum, query_dict  # noqa: E402
from iconem_terrain_viewer.settings_ui import slider_range, symmetric_pairs  # noqa: E402

failures = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        failures.append(what)


# settings_ui
check(slider_range("illuminationDir")[:2] == (0.0, 360.0), "sun azimuth slides 0 to 360")
check(slider_range("illuminationAlt")[:2] == (0.0, 90.0), "sun elevation slides 0 to 90")
check(slider_range("slopeOpacity")[:2] == (0.0, 1.0), "an opacity slides 0 to 1")
check(slider_range("maxElevation", 8100)[1] >= 8100, "a default beyond the usual range widens it")
check(slider_range("somethingElse") is None, "an unknown number gets a plain box")
check(slider_range("isolineFillOpacity", 0.35, 0, 1)[:2] == (0.0, 1.0), "the schema's range wins")
pairs = symmetric_pairs(["lrmMin", "lrmMax", "lrmSymmetric", "lrmRadius", "hypsoSymmetric", "minElevation", "maxElevation"])
check(pairs == {"lrmSymmetric": ("lrmMin", "lrmMax"), "hypsoSymmetric": ("minElevation", "maxElevation")}, f"symmetric pairs {pairs}")
check(clean_enum(["raster", 'live" as const']) == ["raster", "live"], "an enum loses a stray 'as const'")

# service: share links
link = ("https://terrain-viewer.iconem.com/?zoom=12.34&lat=45.8719&lng=7.8561&terrainSourceA=esri&showColorRelief=true"
        "&splitRatio=0.489&showTerrainAnalysis=true&slopeMaxDegrees=67&hillshadeOpacity=0.5")
q = split_link(link)
check(q.startswith("zoom=12.34") and q.endswith("hillshadeOpacity=0.5"), "a whole link: its query")
check(split_link("?" + q) == q and split_link(q) == q, "a bare query, with or without its ?")
check(split_link("terrain-viewer.iconem.com/?zoom=3#x") == "zoom=3", "no scheme, a fragment")
check(split_link("https://terrain-viewer.iconem.com/") == "", "an address with no query: nothing")
params = query_dict(q)
kept = link_params(params, {"terrainSource", "slopeMaxDegrees", "lightingEffectsOpacity", "splitRatio"}, {"slopeMaxDegrees"})
check(kept == {}, f"the app's own parameters stay out of the tiles: {kept}")
check(link_params({"lightingEffectsOpacity": "0.5"}, {"lightingEffectsOpacity"}, set()) == {"lightingEffectsOpacity": "0.5"},
      "a parameter some mode takes is kept")

# assets
cat = assets.catalog()
check(len(cat.get("tree", [])) > 3 and len(cat.get("colorramps", [])) > 100 and len(cat.get("sources", [])) > 20,
      "the packaged catalog: tree, ramps, sources")
check(assets.ramp_icon("mby") is not None and assets.ramp_icon("no-such-ramp") is None, "a ramp preview, by id")
items, default = assets.matcaps()
check(len(items) >= 20 and default == "clay_studio" and assets.matcap_icon("jade") is not None, "the matcaps and their previews")

# python_backend
reg = pyb.registry()
check(reg is not None, "live/'s registry (numpy)")
check(pyb.py_mode("colorRelief", None, reg) == "elevation", "colorRelief is live/'s elevation")
check(pyb.py_mode("hillshade", {"hillshadeMethod": "aspect-multidir"}, reg) == "hillshade",
      "every hillshade method is the hillshade (its colour tile draws the method: live/hillshade.py)")
check(pyb.py_mode("moundDetector", None, reg) == "moundDetector", "the mound detector is computed in Python (live/mounds.py)")
check(pyb.py_forms("moundDetector", {"colour", "vector"}, reg) == {"vector"}, "mound detector: the points only")
py, opts = pyb.py_opts("moundDetector", {"tellSize": 60, "tellsPolarity": "both", "tellVetoResolution": "fine"}, None, reg)
check(opts == {"size": 60.0, "polarity": "both", "vetoResolution": "fine"}, f"mound detector settings: {opts}")
for sid in ("shapeIndex", "blobness", "eigenRatio", "orientation", "localDominance", "buildingShadows", "planeSlicer",
            "graticules", "isoline"):
    check(pyb.py_mode(sid, None, reg) is not None, f"{sid} is computed in Python")
check(pyb.py_forms("isoline", {"colour", "vector"}, reg) == {"colour", "vector"}, "iso-line: raster and lines")
check(pyb.py_forms("buildingShadows", {"colour"}, reg) == {"colour"}, "building shadows: color (the service has no values)")
py, opts = pyb.py_opts("isoline", {"isolineMode": "interval", "isolineInterval": 20, "isolineMeasure": "slope"}, None, reg)
check(opts == {"at": "interval", "interval": 20.0}, f"iso-line settings: {opts}")
py, opts = pyb.py_opts("graticules", {"graticuleDensity": 2, "graticuleColor": "#ff0000"}, None, reg)
check(opts == {"density": 2.0, "color": "#ff0000"}, f"graticule settings: {opts}")
py, opts = pyb.py_opts("localDominance", {"localDominanceMaxRadius": 40}, None, reg)
check(opts == {"maxRadius": 40}, f"local dominance settings: {opts}")
missing = [m for m in reg if reg[m].get("python_supported", True) and m not in __import__("iconem_terrain_viewer.live.layers", fromlist=["ORDER"]).ORDER]
check(not missing, f"every Python mode is in live/layers.py's ORDER {missing}")
check(pyb.py_forms("hillshade", {"colour"}, reg) == {"colour"}, "hillshade: color only")
check(pyb.py_forms("slope", {"colour", "values"}, reg) == {"colour", "values"}, "slope: color and values")
check(pyb.py_forms("contours", {"colour", "vector"}, reg) == {"colour", "vector"}, "contours: raster and lines")
py, opts = pyb.py_opts("svf", {"svfRadius": 12, "svfColorRamp": "svf-default", "svfPrecision": "fast"}, (315.0, 45.0), reg)
check(py == "svf" and opts == {"radius": 12}, f"svf: the radius carries over; the default ramp and precision stay out: {opts}")
py, opts = pyb.py_opts("svf", {"svfColorRamp": "svf-transparent", "svfMin": 20, "svfMax": 100, "svfInvertColorRamp": True,
                               "svfPrecision": "precise"}, None, reg)
check(opts == {"svfColorRamp": "svf-transparent", "svfMin": "20", "svfInvertColorRamp": "true", "precision": "precise"},
      f"svf: the ramp settings by the service's names (live/ramps.py), the precision: {opts}")
py, opts = pyb.py_opts("colorRelief", {"colorRamp": "srtm", "customHypsoMinMax": True, "minElevation": 100,
                                       "maxElevation": 8100, "hypsoAutoRange": False}, None, reg)
check(py == "elevation" and opts == {"colorRamp": "srtm", "customHypsoMinMax": "true", "minElevation": "100"},
      f"colour relief: its ramp, range and switch as the service reads them: {opts}")
check(pyb.elevation_opts({"hypsoAutoRange": True}, {}, (812.0, 4410.5)) == {"customHypsoMinMax": "true",
      "minElevation": "812", "maxElevation": "4410.5"}, "the range that follows the view")
py, opts = pyb.py_opts("hillshade", {"hillshadeMethod": "igor", "shadowColor": "#203080", "hillshadeExag": 0.5}, None, reg)
check(opts == {"method": "igor", "shadowColor": "#203080", "exaggeration": 0.5}, f"hillshade: method, colours: {opts}")
py, opts = pyb.py_opts("phong", {"phongLightCount": 2, "phongLight2Color": "#ff0000"}, None, reg)
check(opts == {"lightCount": 2, "light2Color": "#ff0000"}, f"phong: its lights: {opts}")
py, opts = pyb.py_opts("contours", {"contourReferenceMode": "lrm", "contourWeight": 2, "contourColor": "#00ff00"}, None, reg)
check(opts == {"reference": "lrm", "weight": 2.0, "color": "#00ff00"}, f"contours: reference, weight, colour: {opts}")
# The panel settings live/ ignores: none left for the ramp modes.
for sid, keys in (("slope", ["slopeColorRamp", "slopeMinDegrees", "slopeMaxDegrees", "slopeInvertColorRamp", "slopeOpacity"]),
                  ("colorRelief", ["colorRamp", "customHypsoMinMax", "hypsoSymmetric", "hypsoAutoRange", "minElevation",
                                   "maxElevation", "invertColorRamp"]),
                  ("aspect", ["aspectColorRamp", "aspectMinDegrees", "aspectMaxDegrees", "aspectShiftDegrees", "aspectInvertColorRamp"]),
                  ("curvature", ["curvatureMode", "curvatureColorRamp", "curvatureMin", "curvatureMax", "curvatureSymmetric"]),
                  ("hillshade", ["hillshadeMethod", "shadowColor", "highlightColor", "accentColor", "hillshadeExag"])):
    check(pyb.unsupported_settings(sid, keys, reg) == set(), f"{sid}: every setting applies under Python "
          f"({pyb.unsupported_settings(sid, keys, reg)})")
# live/ramps.py: the app's colour relief rules.
from iconem_terrain_viewer.live import ramps  # noqa: E402
check(len(ramps.ramps()) > 200, "the packaged ramps' stops")
p = ramps.mode_paint("slope", {})
check([c for _v, c in p[2:4]] == ["rgba(0,0,0,0)"] * 2 and abs(p[3][0] - 29) < 1e-9, f"slope's default ramp, its own stops: {p[2:4]}")
p = ramps.mode_paint("slope", {"slopeMinDegrees": 10, "slopeMaxDegrees": 65, "slopeInvertColorRamp": True})
check(abs(p[2][0] - 10) < 1e-9 and abs(p[-1][0] - 65) < 1e-9 and p[2][1] == "rgb(216,37,37)", "remapped and inverted")
p = ramps.mode_paint("shapeIndex", {})
check(p[-1][0] == p[-2][0] + 0.25 and abs(p[3][0] - (-500.001)) < 1e-9, "shape index: discrete custom stops, x1000, top stop")
p = ramps.mode_paint("aspect", {"aspectShiftDegrees": 90})
check(p[2] == (0.0, (255, 255, 0, 1.0)), f"aspect shifted 90 degrees: east's colour at north ({p[2]})")
check(ramps.mode_paint("colorRelief", {"colorRamp": "no-such"}) is None, "an unknown ramp: no paint")
import numpy as np  # noqa: E402
c = ramps.colour("svf", np.array([[0.0, 1.0, np.nan]], np.float32), {})
check(c[0, 0].tolist() == [20, 20, 35, 255] and c[0, 1].tolist() == [255, 255, 255, 255] and c[0, 2, 3] == 0,
      f"svf's ramp on its natural 0-1 values, no data clear: {c.tolist()}")
# Sources: GDAL rasters and QGIS layers are the Python backend's (and a local service's).
check(pyb.is_local_source("C:/data/dem.tif") and pyb.is_local_source("/vsicurl/https://x.org/a.tif")
      and pyb.is_local_source("https://x.org/dem.vrt") and pyb.is_local_source("layer:abc")
      and not pyb.is_local_source("mapterhorn") and not pyb.is_local_source("https://x.org/{z}/{x}/{y}.png"),
      "what the Python backend hands to GDAL")
from iconem_terrain_viewer import local_files  # noqa: E402
check(local_files.is_loopback("http://localhost:3400") and local_files.is_loopback("http://127.0.0.1:3461/")
      and not local_files.is_loopback("https://tiles.example.com"), "a service on this machine")
src, why = local_files.service_source("https://tiles.example.com", __file__)
check(src is None and ".py" in why or "GeoTIFF" in why, f"a non-raster file is refused before asking: {why}")
check(local_files.remote_address("https://x.org/dem.tif") == '{"url":"https://x.org/dem.tif","type":"cog"}',
      "an https COG goes to the service as its address")
py, opts = pyb.py_opts("hillshade", {"hillshadeExag": 1.0}, (120.0, 30.0), reg)
check(opts == {"azimuth": 120.0, "altitude": 30.0}, f"hillshade: the shared light: {opts}")
py, opts = pyb.py_opts("matcap", {"matcapTextureId": "jade", "matcapRotationDeg": 0}, None, reg)
check(opts == {"texture": "jade"}, f"matcap: the texture: {opts}")
check(pyb.unsupported_settings("svf", ["svfRadius", "svfColorRamp", "svfOpacity"], reg) == set(),
      "svf: the ramp, the radius and the opacity all apply")
# A mode live/ adds under the service's id maps by itself, settings by their stripped names.
fake = dict(reg)
fake["shapeIndex"] = {"defaults": {"min": -1.0, "max": 1.0}, "kind": "ramp"}
check(pyb.py_mode("shapeIndex", None, fake) == "shapeIndex", "a mode added to live/ under the service's id")
check(pyb.setting_target("shapeIndex", "shapeIndexMax", "shapeIndex", fake) == "max", "its settings by their stripped names")
sid, why = pyb.source_spec("esri", cat["sources"], {})
check(sid is None and "lerc" in why.lower(), f"a LERC source needs a tile service: {why}")
sid, why = pyb.source_spec("mapbox", cat["sources"], {})
check(sid is None and "mapboxKey" in why, "Mapbox needs its key")
sid, _ = pyb.source_spec("mapbox", cat["sources"], {"mapboxKey": "pk.test"})
from iconem_terrain_viewer.live import dem  # noqa: E402
check(sid and sid.startswith("mapbox-") and "access_token=pk.test" in dem.SOURCES[sid]["url"], "Mapbox with its key")
check(pyb.source_spec(None, [], {})[0] == "mapterhorn", "no source: Mapterhorn")
sup = pyb.supported_sources(cat["sources"])
check("aws" in sup and "esri" not in sup and "mapbox" in sup, f"supported sources: {len(sup)}")

# widgets
from qgis.PyQt.QtCore import QPoint, Qt  # noqa: E402
from qgis.PyQt.QtTest import QTest  # noqa: E402
from iconem_terrain_viewer.widgets import LightPad, SliderSpin  # noqa: E402
pad = LightPad()
pad.resize(104, 104)
got = []
pad.changed.connect(lambda a, e: got.append((a, e)))
c = QPoint(pad.width() // 2, pad.height() // 2)
QTest.mouseClick(pad, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, c + QPoint(46, 0))
check(got and got[-1] == (90.0, 0.0), f"the pad: east rim is azimuth 90, elevation 0 ({got[-1:] or None})")
QTest.mouseClick(pad, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, c)
check(got[-1][1] == 90.0, "the pad: the centre is the zenith")
QTest.mouseClick(pad, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, c + QPoint(0, -23))
check(got[-1] == (0.0, 45.0), f"the pad: half way north is azimuth 0, elevation 45 ({got[-1]})")
s = SliderSpin(0, 1, 0.05, 0.5, hard=(0, 1))
seen = []
s.valueChanged.connect(seen.append)
s.slider.setValue(s.slider.maximum())
check(s.value() == 1.0 and seen[-1] == 1.0, "the slider drives its box")
s.spin.setValue(0.25)
check(s.slider.value() == 5 and seen[-1] == 0.25, "the box drives its slider")

# solar: the app's lib/solar-position.ts (Cooper's declination, true solar
# time), its values for these cases computed by the TypeScript itself
# (node --experimental-strip-types), and again live when Node is there.
from iconem_terrain_viewer import solar  # noqa: E402
SUN_CASES = [  # lat, lng, day of year, solar hour -> azimuth, altitude, sunrise, sunset
    (45.83, 6.86, 172, 15, 253.836619, 47.514487, 4.231942, 19.768058),
    (45.83, 6.86, 355, 9.5, 145.058696, 12.809362, 7.768058, 16.231942),
    (-33.9, 18.4, 80, 12, 0, 56.503653, 5.981917, 18.018083),
    (69.6, 18.9, 172, 0.5, 6.888278, 3.206766, 0, 24),
    (0, 0, 1, 6, 113.011637, 0, 6, 18),
    (51.5, -0.1, 300, 16.25, 240.916552, 4.642724, 7.197557, 16.802443),
]


def sun_matches(cases, what):
    worst = 0.0
    for lat, _lng, doy, hour, az, alt, rise, sset in cases:
        a, h = solar.solar_position(lat, doy, hour)
        r, s_ = solar.day_length(lat, doy)
        worst = max(worst, abs(((a - az + 180) % 360) - 180), abs(h - alt), abs(r - rise), abs(s_ - sset))
    check(worst < 1e-4, f"solar: {what} ({len(cases)} cases, worst {worst:.2e} degrees or hours)")


sun_matches(SUN_CASES, "the app's sun position and day length, recorded")
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
ts = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib", "solar-position.ts")
# QGIS's Python resets PATH: Node where it usually is, or $NODE.
node = os.environ.get("NODE") or shutil.which("node") or next(
    (p for p in (os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "nodejs", "node.exe"), "/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node")
     if os.path.exists(p)), None)
if not node:
    print("  skip the TypeScript comparison: no Node (set NODE)")
elif os.path.exists(ts):
    cases = [(lat, lng, doy, hour) for lat in (-60, -12.5, 0, 33.3, 45.83, 78) for lng in (0,) for doy in (1, 80, 172, 266, 355)
             for hour in (5, 9.25, 12, 15.5, 21)]
    script = ("import(process.argv[1]).then(m => console.log(JSON.stringify(JSON.parse(process.argv[2]).map(c => {"
              "const s = m.solarPosition(...c), d = m.dayLength(c[0], c[2]); return [...c, s.azimuth, s.altitude, d.sunrise, d.sunset] }))))")
    try:
        out = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "-e", script,
                              "file:///" + os.path.abspath(ts).replace("\\", "/"), json.dumps(cases)],
                             capture_output=True, text=True, timeout=60)
        sun_matches(json.loads(out.stdout), "the app's sun position and day length, from the TypeScript now")
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print(f"  skip the TypeScript comparison: {e}")
check(solar.day_of_year(1, 1) == 1 and solar.day_of_year(6, 21) == 172 and solar.day_of_year(12, 31) == 365,
      "solar: day of year as the app (2026, no leap day)")
check(solar.date_of_day(172, 2028) == (6, 21) and solar.day_of_year(*solar.date_of_day(60, 2024)) == 60,
      "solar: a day of year back to a date")
check(abs(solar.solar_hour_utc(12, 15) - 13) < 1e-9 and abs(solar.solar_hour_utc(1, -30) - 23) < 1e-9,
      "solar: UTC to solar time by the longitude")
check(solar.format_hour(6.5) == "06:30" and solar.format_hour(23.999) == "24:00", "solar: hours as HH:MM")

# The panel: radio buttons for the backends (renamed), Color forms, the sun
# light, the canvas kept where it is when the first layer joins an empty
# project, the labels of the overlays.
from qgis.PyQt.QtCore import QDateTime, QDate, QTime  # noqa: E402
from qgis.PyQt.QtWidgets import QRadioButton, QPushButton  # noqa: E402
from qgis.core import QgsProject, QgsRectangle, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsVectorTileLayer  # noqa: E402
from qgis.gui import QgsMapCanvas, QgsLayerTreeMapCanvasBridge  # noqa: E402
from iconem_terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from iconem_terrain_viewer import labels  # noqa: E402
from iconem_terrain_viewer.layers import vector_renderer  # noqa: E402
from qgis.PyQt.QtCore import QEventLoop, QTimer  # noqa: E402


def spin(ms=200):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


canvas = QgsMapCanvas()
canvas.resize(800, 600)
canvas.show()
bridge = QgsLayerTreeMapCanvasBridge(QgsProject.instance().layerTreeRoot(), canvas)
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
__import__("qgis.core", fromlist=["QgsSettings"]).QgsSettings().remove("terrain_viewer/appMode")  # a run that stopped in the Historical mode
dock = TerrainViewerDock(canvas, None, None, bridge)
labels_now = {b.text() for b in dock.backend_picker.buttons.values()}
check(labels_now == {"Packaged tile server", "Remote tile server", "Python backend"}
      and all(isinstance(b, QRadioButton) for b in dock.backend_picker.buttons.values()),
      f"backends: three radio buttons, renamed ({sorted(labels_now)})")
check(all(b.cursor().shape() == Qt.CursorShape.PointingHandCursor for b in dock.backend_picker.buttons.values()),
      "backends: a pointing hand over them")
python_page = dock.pages.widget([b for b in dock.backend_picker.buttons].index("python"))
check(not [b for b in python_page.findChildren(QPushButton) if b.text() == "Connect"],
      "Python backend: no Connect button")
row = dock.rows["slope"]
check(row.row.forms["colour"].text() == "Color" and row.color is row.row.forms["colour"], "a mode's form says Color")
check(row.row.header.cursor().shape() == Qt.CursorShape.PointingHandCursor and row.more.cursor().shape() == Qt.CursorShape.PointingHandCursor,
      "a mode's row and its cog: a pointing hand")

# The sun over Mont Blanc on the June solstice at 13:00 UTC.
dock.zoom_to(45.83, 6.86, 12)
lat, lng = dock.sun_place()
check(abs(lat - 45.83) < 0.01 and abs(lng - 6.86) < 0.01, f"sun: the canvas centre ({lat:.3f}, {lng:.3f})")
dock.sun_when.setDateTime(QDateTime(QDate(2026, 6, 21), QTime(13, 0), Qt.TimeSpec.UTC))
check(dock.sun_day.value() == 172 and abs(dock.sun_hour.value() - 13) < 1e-9, "sun: the day and hour follow the date picked")
before = dock.light_value()
check(before == (315.0, 45.0) and dock.sun_box.isHidden(), "sun: off by default, the light free")
dock.set_light_mode("sun")
az, alt, _sh = solar.sun_at(lat, lng, 6, 21, 13)
check(dock.light_value() == (float(round(az) % 360), float(round(alt))), f"sun: the light set to the sun ({dock.light_value()}, sun {az:.1f}, {alt:.1f})")
check((dock.light_pad.azimuth, dock.light_pad.elevation) == dock.light_value(), "sun: the pad shows it")
check(not dock.sun_box.isHidden(), "sun: its date, day and hour shown")
dock.sun_day.setValue(355, emit=True)
check(dock.sun_when.date() == QDate(2026, 12, 21), f"sun: the day of year moves the date ({dock.sun_when.date().toString()})")
az2, alt2, _ = solar.sun_at(lat, lng, 12, 21, 13)
check(dock.light_value() == (float(round(az2) % 360), float(round(alt2))), "sun: and the light follows")
dock.sun_hour.setValue(2, emit=True)  # night over the Alps
check(dock.light_value()[1] == 0.0 and "below the horizon" in dock.sun_info.text(), "sun: below the horizon, lit from it")
dock.light_pad.changed.emit(100.0, 20.0)  # dragged by hand
check(dock.light_mode.current() == "free" and dock.light_value() == (100.0, 20.0), "sun: the pad dragged goes back to Free")
dock.flush()

# The canvas kept where it is: the first layer added to a project with no
# layer used to zoom the canvas to the whole world (QGIS's bridge).
QgsProject.instance().clear()
spin()
here = QgsRectangle(700000, 5700000, 800000, 5800000)
canvas.setExtent(here)
spin()
kept = canvas.extent()
dock.stack.ranks = {}
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:4326"))
QgsProject.instance().setCrs(QgsCoordinateReferenceSystem("EPSG:4326"))
check(dock.project_fresh, "a new project is fresh")
dock.stack.ensure("hillshade", "Hillshade", ("Lighting",), "http://127.0.0.1:9/{z}/{x}/{y}.png", False)
spin(400)
ext = canvas.extent()
check(QgsProject.instance().crs().authid() == "EPSG:3857" and canvas.mapSettings().destinationCrs().authid() == "EPSG:3857",
      f"the panel's first layer in a fresh project: the project in EPSG:3857 ({QgsProject.instance().crs().authid()})")
check(ext.width() >= 2 * 20037508 - 1 or ext.height() >= 2 * 20037508 - 1,
      f"and the canvas on the whole world, as QGIS does ({ext.toString(0)})")
check(bridge.autoSetupOnFirstLayer(), "and QGIS's first-layer setup is on again afterwards")
dock.remove_layers("hillshade")
spin()
canvas.setExtent(here)
spin()
kept = canvas.extent()
dock.stack.ensure("hillshade", "Hillshade", ("Lighting",), "http://127.0.0.1:9/{z}/{x}/{y}.png", False)
spin(400)
ext = canvas.extent()
check(abs(ext.center().x() - kept.center().x()) < 1 and abs(ext.width() - kept.width()) < 1,
      f"every mode unchecked, then one checked again: the canvas stays where it was ({ext.toString(0)})")
check(bridge.autoSetupOnFirstLayer(), "and QGIS's first-layer setup is on again afterwards")
dock.remove_layers("hillshade")
spin()
check(abs(canvas.extent().width() - kept.width()) < 1, "every mode unchecked: the canvas stays")

# A row scheduled before a rebuild (another backend connected meanwhile) is
# not updated: unchecked, it removed the new row's layers of the same key.
old = dock.rows["contours"]
calls = []
old.update = lambda: calls.append("old")
dock.schedule(old)
dock.build()
dock.rows["contours"].update = lambda: calls.append("new")
dock.schedule(dock.rows["contours"])
dock.flush()
check(calls == ["new"], f"a row of the tree before a rebuild is not updated ({calls})")

# Labels: QGIS labelling on the overlays' lines, no label points.
r = vector_renderer("isoline", {})
check(not [st for st in r.styles() if st.styleName() == "points"], "iso-line tiles: no points drawn")
check([st for st in vector_renderer("moundDetector", {}).styles() if st.styleName() == "points"], "mound detector: its tells stay points")
vt = QgsVectorTileLayer("type=xyz&url=http://127.0.0.1:9/{z}/{x}/{y}.pbf&zmin=0&zmax=15", "contours")
check(labels.label_tile_layer(vt, "contours") and vt.labeling() is not None, "contour tiles: labelled")
st = vt.labeling().styles()[0]
fmt = st.labelSettings().format()
check(st.layerName() == "contours" and '"level" = 1' in st.filterExpression() and fmt.color().name() == "#000000"
      and fmt.buffer().enabled() and fmt.buffer().color().name() == "#ffffff",
      "contour labels: the major lines, black text in a white buffer")
check(abs(fmt.size() - 4.25) < 1e-6 and abs(fmt.buffer().size() - 0.5) < 1e-6,
      f"contour labels: half of 0.8.0's size, 4.25 pt in a 0.5 mm buffer ({fmt.size()}, {fmt.buffer().size()})")
check(all(labels.tile_labeling(m) is None for m in ("isoline", "planeSlicer", "graticules")),
      "iso-line, plane slicer and graticule tiles: no labels (only the contours keep theirs)")
from qgis.core import QgsVectorLayer  # noqa: E402
mem = QgsVectorLayer("LineString?crs=EPSG:3857&field=value:double", "iso", "memory")
check(not labels.label_memory_layer(mem, "isoline") and not mem.labelsEnabled(), "iso-line lines (Python backend): no labels")
mem2 = QgsVectorLayer("LineString?crs=EPSG:3857&field=elev:double&field=major:integer", "contours", "memory")
check(labels.label_memory_layer(mem2, "contours") and mem2.labelsEnabled(), "contour lines (Python backend): labelled")

# 0.9.0: the panel's order (hillshade first, the vector overlays), the
# backends' order and default, the opacity in the row, the plane slicer's
# reference, the source groups, no other source drawn in place of one the
# Python backend cannot read, the raw inputs, the light while dragged, updates.
from iconem_terrain_viewer.service import panel_tree  # noqa: E402
ids = list(dock.rows)
check(ids[:2] == ["hillshade", "colorRelief"], f"the panel: Hillshade above Elevation Hypso ({ids[:3]})")
check(ids[-5:] == ["contours", "isoline", "planeSlicer", "graticules", "moundDetector"],
      f"the panel: the overlays as Contours, Iso-line, Plane slicer, Graticule, Mound candidates ({ids[-5:]})")
pt = panel_tree(dock.catalog.tree)
ov = next(g for g in pt if g.get("group") == "Overlays")
check(ov["title"] == "Vector overlays" and dock.rows["contours"].path == ("Overlays",),
      "the overlays' group reads \"Vector overlays\" (the layer tree keeps \"Overlays\")")
from qgis.gui import QgsCollapsibleGroupBox  # noqa: E402
titles = [b.title() for b in dock.groups_host.findChildren(QgsCollapsibleGroupBox)]
check("Vector overlays" in titles and "Overlays" not in titles, f"the group boxes' titles ({titles})")
check(list(dock.backend_picker.buttons) == ["python", "local", "remote"], f"backends: Python first ({list(dock.backend_picker.buttons)})")
from iconem_terrain_viewer.dock import initial_backend  # noqa: E402


class FakeSettings(dict):
    def value(self, k, d=None):
        return self.get(k, d)

    def contains(self, k):
        return k in self


check(initial_backend(FakeSettings()) == "python", "a new user starts on the Python backend")
check(initial_backend(FakeSettings({"terrain_viewer/backend": "remote"})) == "remote", "a backend picked before is kept")
check(initial_backend(FakeSettings({"terrain_viewer/service": "http://localhost:3400"})) == "remote",
      "a user of 0.6.0 with an address keeps the remote tile server")
row = dock.rows["slope"]
labels_in_cog = [row.row.form_layout.itemAt(i, row.row.form_layout.ItemRole.LabelRole).widget().text()
                 for i in range(row.row.form_layout.rowCount())
                 if row.row.form_layout.itemAt(i, row.row.form_layout.ItemRole.LabelRole) is not None]
check(row.row.head.indexOf(row.opacity) == 1 and "Opacity" not in labels_in_cog,
      "the opacity sits in the row, between the name and the forms, no longer under the cog")
hidden_off = row.opacity.isHidden()
row.row.set_forms({"colour"})
check(hidden_off and not row.opacity.isHidden(), "the opacity shows while a drawn form is on, hidden (its room kept) otherwise")
row.set_opacity(0.4)
check(abs(row.opacity_value() - 0.4) < 1e-9 and row.opacity.label.text() == "40%", "the opacity reads and writes 0 to 1")
row.row.set_forms(set())
check(dock.rows["planeSlicer"].settings["planeSlicerReferenceMode"].get() == "absolute", "plane slicer: reference Absolute by default")
texts = [dock.source.itemText(i) for i in range(dock.source.count())]
check(texts.index("Worldwide defaults") < texts.index("Mapterhorn - Terrarium") < texts.index("Terrain library"),
      "sources: Worldwide defaults, then the terrain library")
hdr = dock.source.model().item(texts.index("Terrain library"))
check(not (hdr.flags() & Qt.ItemFlag.ItemIsSelectable), "a group title cannot be picked")
# A QGIS layer: plausible elevation only (one band of floats or Int16).
import tempfile  # noqa: E402
from osgeo import gdal  # noqa: E402
from qgis.core import QgsRasterLayer  # noqa: E402
tmpdir = tempfile.mkdtemp()
for fname, dt, bands in (("dem.tif", gdal.GDT_Float32, 1), ("rgb.tif", gdal.GDT_Byte, 3)):
    ds = gdal.GetDriverByName("GTiff").Create(os.path.join(tmpdir, fname), 8, 8, bands, dt)
    ds.SetGeoTransform((700000, 10, 0, 5800000, 0, -10))
    ds.SetProjection(QgsCoordinateReferenceSystem("EPSG:3857").toWkt())
    ds = None
dem_layer = QgsRasterLayer(os.path.join(tmpdir, "dem.tif"), "my dem")
rgb_layer = QgsRasterLayer(os.path.join(tmpdir, "rgb.tif"), "a photo")
QgsProject.instance().addMapLayers([dem_layer, rgb_layer])
spin()
texts = [dock.source.itemText(i) for i in range(dock.source.count())]
check(texts[0] == "QGIS elevation layers" and "QGIS layer: my dem" in texts and "QGIS layer: a photo" not in texts
      and texts.index("QGIS layer: my dem") < texts.index("Worldwide defaults"),
      "sources: the project's elevation layers first (a picture left out)")
QgsProject.instance().removeMapLayers([dem_layer.id(), rgb_layer.id()])
spin()
# The raw inputs: what GDAL opens for a library COG and a raw WMS.
ign = next(s for s in cat["sources"] if s["id"] == "custom-ign-lidarhd-dsm-wms-raw")
mrdem = next(s for s in cat["sources"] if s["id"] == "custom-ca-nrcan-mrdem30")
check(str(pyb.raw_input_address(mrdem)).startswith("/vsicurl/https://canelevation-dem.")
      and str(pyb.raw_input_address(ign)).startswith("<GDAL_WMS>") and "image/geotiff" in pyb.raw_input_address(ign)
      and "<DataType>Float32</DataType>" in pyb.raw_input_address(ign), "raw inputs: a COG by /vsicurl/, a WMS by a GDAL WMS description")
check(pyb.raw_input_address(next(s for s in cat["sources"] if s["id"] == "custom-nl-ahn-dtm")) is None
      and pyb.raw_input_address(next(s for s in cat["sources"] if s["id"] == "mapterhorn")) is None,
      "raw inputs: none for a WCS template or a pyramid")
dock.set_source("custom-ign-lidarhd-dsm-wms-raw")
check(dock.raw_btn.isEnabled(), "the raw input button: on for a raw WMS")
dock.set_source("mapterhorn")
check(not dock.raw_btn.isEnabled(), "and off for a pyramid")
# A source the Python backend cannot read: nothing drawn, never Mapterhorn.
dock.set_source("esri")
dock._py_sources.clear()
check(dock.python_source() is None and "draws nothing" in dock.warnings[-1], f"a LERC source under Python: nothing drawn ({dock.warnings[-1][:90]})")
dock.set_source("mapterhorn")

# The light while dragged: the shaded layers follow, throttled, instead of
# once half a second after the last move.
hill = dock.rows["hillshade"]
hill.row.set_forms({"colour"})
updates_seen = []


def fake_update():  # the layer rewritten, the canvas drawing it for 60 ms
    updates_seen.append(time.perf_counter())
    QTimer.singleShot(0, canvas.renderStarting.emit)
    QTimer.singleShot(60, canvas.mapCanvasRefreshed.emit)


hill.update = fake_update
dock.connected = "python"
import time  # noqa: E402
t0 = time.perf_counter()
for i in range(60):  # a one second drag at 60 moves a second
    dock.light_pad.changed.emit(float(200 + i), 40.0)
    spin(16)
during = len(updates_seen)
first = (updates_seen[0] - t0) * 1000 if updates_seen else None
dock.light_pad.released.emit()
spin(50)
check(during >= 5 and first is not None and first < 20,
      f"the light dragged for {1000 * (time.perf_counter() - t0):.0f} ms, the canvas drawing in 60 ms: {during} rewrites while "
      f"dragging, each once the last was drawn (the first after {first:.0f} ms; 0.8.0: none until 500 ms after the last "
      f"move), {len(updates_seen)} with the release")
check(dock.light_value() == (259.0, 40.0), "the last position applied")
dock.connected = None
del hill.update
hill.row.set_forms(set())

# 0.9.2: app links read as the app reads them (the parameters a link leaves
# out at the app's defaults), any address or a bare query; the light section
# open; contours black.
from iconem_terrain_viewer import links  # noqa: E402
check(dock.light_section.button.isChecked(), "the light section is open by default")
check(dock.rows["contours"].values().get("contourColor") == "#000000", "contours: black by default")
check(vector_renderer("contours", {}).styles()[0].symbol().color().name() == "#000000", "contours: black vector tiles without a color")
LINK1 = ("views://app/index.html?zoom=11.32&lat=44.5061&lng=4.0005&showHillshade=false&showTerrainAnalysis=true&slopeOpacity=0.8"
         "&slopeColorRamp=black-and-white&slopeMaxDegrees=45&openSections=download&closeSections=general")
LINK2 = ("https://terrain-viewer.iconem.com/?showRasterBasemap=true&splitRatio=0.489&illuminationDir=39.68&illuminationAlt=46.05"
         "&lightTimeOfDay=9.25&showReliefVisualization=true")
q1 = split_link(LINK1)
check(q1.startswith("zoom=11.32") and q1.endswith("closeSections=general"), "views://app/index.html?...: its query")
for variant in ("app/index.html?" + q1, "?" + q1, q1):
    check(split_link(variant) == q1, f"the same link as {variant[:24]}...: the same query")
modes = {item["id"]: item for _, item in __import__("iconem_terrain_viewer.service", fromlist=["walk_modes"]).walk_modes(cat["tree"])}
v1 = links.local_view(q1, modes)
check(v1["active"] == ["slope"], f"link 1: the slope alone (showTerrainAnalysis=true, showSlope's default true; hillshade off): {v1['active']}")
check(abs(v1["opacity"]["slope"] - 0.8) < 1e-9 and v1["opacity"]["aspect"] == 0.5, "link 1: slope at 0.8, the others at the app's defaults")
check(v1["camera"] == {"zoom": "11.32", "lat": "44.5061", "lng": "4.0005"}, f"link 1: its camera {v1['camera']}")
check(links.basemap(q1) is None, "link 1: no basemap (showRasterBasemap's default false)")
q2 = split_link(LINK2)
v2 = links.local_view(q2, modes)
check(sorted(v2["active"]) == ["hillshade", "lrm"], f"link 2: the local relief model (showLrm's default) over the hillshade (on by default): {v2['active']}")
b2 = links.basemap(q2)
check(b2 is not None and b2[0] == "ESRI World Imagery" and "World_Imagery/MapServer/tile/{z}/{y}/{x}" in b2[1] and b2[2] == 19,
      f"link 2: the app's default basemap, ESRI ({b2 and b2[:3]})")
check(links.basemap("showRasterBasemap=true&basemapSourceA=bing")[1].startswith("https://t.ssl.ak.tiles.virtualearth.net/tiles/a{q}"),
      "a Bing basemap: its quadkey as QGIS's {q}")
check(links.basemap("showRasterBasemap=true&basemapSourceA=mapbox")[0] == "ESRI World Imagery"
      and "{API_KEY}" not in links.basemap("showRasterBasemap=true&basemapSourceA=mapbox", {"mapboxKey": "k"})[1],
      "a keyed basemap: ESRI without its key, its own with it")
check(links.basemap("showRasterBasemap=true&basemapSourceA=wayback", None, "http://localhost:3400")[1].startswith("http://localhost:3400/basemap-tiles/{z}/{x}/{y}.jpg?"),
      "a dated basemap: through the tile service's /basemap-tiles")
check(links.basemap("showRasterBasemap=true&basemapUrl=https://tiles.example.com/{z}/{x}/{y}.png")[1] == "https://tiles.example.com/{z}/{x}/{y}.png",
      "an XYZ basemap address: as it is")

# The two links opened in the panel under the Python backend (the layers
# themselves not written: update stubbed).
QgsProject.instance().clear()
spin()
canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:2154"))
QgsProject.instance().setCrs(QgsCoordinateReferenceSystem("EPSG:2154"))
dock.connected = "python"
for r in dock.rows.values():
    r.update = lambda: None
dock.rows["contours"].settings["contourColor"].set("#ff0000")
dock.rows["lrm"].settings["lrmRadius"].set(40)
for variant in (LINK1, "app/index.html?" + q1, "?" + q1, q1):
    check(dock.open_link(variant), f"link 1 opened as {variant[:24]}...")
    on = sorted(k for k, r in dock.rows.items() if r.row.checked_forms())
    check(on == ["slope"], f"link 1: the slope checked, nothing else ({on})")
slope = dock.rows["slope"]
check(slope.settings["slopeColorRamp"].get() == "black-and-white" and float(slope.settings["slopeMaxDegrees"].get()) == 45
      and abs(slope.opacity_value() - 0.8) < 1e-6, "link 1: the slope's ramp, maximum and opacity")
check(float(slope.settings["slopeMinDegrees"].get()) == 0 if "slopeMinDegrees" in slope.settings else True, "link 1: the slope's other settings at their defaults")
check(dock.rows["contours"].settings["contourColor"].get() == "#000000" and float(dock.rows["lrm"].settings["lrmRadius"].get()) == 16,
      "link 1: settings the link leaves out back to their defaults (contours black, LRM radius 16)")
check(dock.stack.find("basemap") is None, "link 1: no basemap layer")
check(canvas.mapSettings().destinationCrs().authid() == "EPSG:2154", "link 1: the project's CRS kept")
c = QgsCoordinateTransform(canvas.mapSettings().destinationCrs(), QgsCoordinateReferenceSystem("EPSG:4326"), QgsProject.instance()).transform(canvas.extent().center())
check(abs(c.y() - 44.5061) < 0.01 and abs(c.x() - 4.0005) < 0.01, f"link 1: the canvas on its camera ({c.y():.4f}, {c.x():.4f})")
lat, lng, zoom = dock.place()
check(abs(zoom - 11.32) < 0.3, f"link 1: at its zoom ({zoom:.2f})")
check(dock.light_value() == (315.0, 45.0), f"link 1: the app's default light ({dock.light_value()})")
check(dock.open_link(LINK2), "link 2 opened")
on = sorted(k for k, r in dock.rows.items() if r.row.checked_forms())
check(on == ["hillshade", "lrm"], f"link 2: hillshade and LRM checked ({on})")
check(abs(dock.light_value()[0] - 39.68) < 0.51 and abs(dock.light_value()[1] - 46.05) < 0.51, f"link 2: its light ({dock.light_value()})")
bm = dock.stack.find("basemap")
check(bm is not None and bm.name() == "ESRI World Imagery" and "World_Imagery" in bm.source(), "link 2: the ESRI basemap as an XYZ layer")
root = dock.stack.root(create=False)
check(root is not None and root.children()[-1].layer() is bm if root and root.children() and hasattr(root.children()[-1], "layer") else False,
      "link 2: the basemap at the bottom of the live group")
check("over the basemap" in dock.status.text(), f"link 2: said ({dock.status.text()})")
check(dock.open_link(LINK1) and dock.stack.find("basemap") is None, "link 1 again: the basemap removed")

# 0.9.3: the basemap is a row of the tree, under Elevation Hypso: a checkbox,
# an opacity, a select of the app's built-in basemaps under its cog; the link
# reader drives the same row. And the raw elevation inputs stay under the modes.
from iconem_terrain_viewer.dock import BASEMAP_KEY, raw_stretch  # noqa: E402
brow = dock.basemap_row
lay = dock.groups_layout
order = [lay.itemAt(i).widget() for i in range(lay.count())]
check(brow is not None and brow.box in order and order.index(brow.box) == order.index(dock.rows["colorRelief"].box) + 1
      and order.index(dock.rows["hillshade"].box) < order.index(brow.box),
      "the Basemap row: right under Elevation Hypso, itself under Hillshade")
ids = [i for i, _n in links.basemap_choices({})]
check(ids == ["google", "bing", "esri", "googlesat"], f"its choices without a key: the app's built-ins that need none ({ids})")
check([i for i, _n in links.basemap_choices({"mapboxKey": "k", "hereKey": "k"})] == ["google", "bing", "esri", "mapbox", "here", "googlesat"],
      "a keyed basemap is offered once the panel holds its key, in the app's order")
check([brow.source.itemData(i) for i in range(brow.source.count())] == [i for i, _n in links.basemap_choices(dock.key_values())]
      and brow.current() == "esri", "the row's select lists them, ESRI World Imagery picked (the app's default)")
check(not brow.row.checked_forms() and brow.more.isHidden() and dock.stack.find(BASEMAP_KEY) is None, "unchecked: no layer, no cog")
brow.check.setChecked(True)
bm = dock.stack.find(BASEMAP_KEY)
check(bm is not None and bm.name() == "ESRI World Imagery" and "World_Imagery" in bm.source() and "zmax=19" in bm.source()
      and not brow.more.isHidden(), "checked: the ESRI layer, the cog shown")
brow.source.setCurrentIndex(brow.source.findData("bing"))
bm2 = dock.stack.find(BASEMAP_KEY)
check(bm2 is not None and bm2.id() == bm.id() and bm2.name() == "Bing Aerial" and "virtualearth" in bm2.source() and "%7Bq%7D" in bm2.source(),
      f"another source picked: the same layer re-pointed and renamed ({bm2 and bm2.name()})")
brow.opacity.setOpacity(0.4)
check(abs(bm2.renderer().opacity() - 0.4) < 1e-6, "its opacity is the layer's")
# Under every mode: a mode's layer added after it lands above it.
from qgis.core import QgsRasterLayer as _RL  # noqa: E402
dock.stack.ensure("slope", "Slope", ("Terrain Analysis", "Surface derivatives"), "http://127.0.0.1:9/slope/{z}/{x}/{y}.png", False, backend="python")
dock.stack.ensure("colorRelief", "Elevation Hypso", (), "http://127.0.0.1:9/elevation/{z}/{x}/{y}.png", False, backend="python")
root = dock.stack.root(create=False)
names = [c.name() for c in root.children()]
check(names[-1] == "Bing Aerial" and names.index("Elevation Hypso") < names.index("Bing Aerial") and len(names) == 3,
      f"the layer tree: the basemap under every mode and group ({names})")
# A raw elevation input group above the live group (0.9.2 put it there): moved under it.
tree_root = QgsProject.instance().layerTreeRoot()
rawg = tree_root.insertGroup(0, dock.RAW_ROOT)
rawg.setCustomProperty("terrain_viewer/raw_root", True)
check([c.name() for c in tree_root.children()][0] == dock.RAW_ROOT and dock.place_raw_group()
      and [c.name() for c in tree_root.children()] == [root.name(), dock.RAW_ROOT] and not dock.place_raw_group(),
      "\"Raw elevation inputs\" above the live group: moved right under it (it hid the modes)")
tree_root.removeChildNode(dock.raw_group())
rawg = tree_root.insertGroup(0, dock.RAW_ROOT)
rawg.setCustomProperty("terrain_viewer/raw_root", True)
dock.stack.ensure("aspect", "Aspect", ("Terrain Analysis", "Surface derivatives"), "http://127.0.0.1:9/aspect/{z}/{x}/{y}.png", False, backend="python")
check([c.name() for c in tree_root.children()] == [root.name(), dock.RAW_ROOT], "and again when a mode's layer joins the tree")
tree_root.removeChildNode(dock.raw_group())
for k in ("slope", "colorRelief", "aspect"):
    dock.remove_layers(k)
# A raw input's grey follows the canvas (a country's lowlands are not black).
from osgeo import gdal as _gdal, osr as _osr  # noqa: E402
import tempfile as _tf  # noqa: E402
import numpy as _np  # noqa: E402
_dir = _tf.mkdtemp()
_ds = _gdal.GetDriverByName("GTiff").Create(os.path.join(_dir, "dem.tif"), 64, 64, 1, _gdal.GDT_Float32)
_ds.SetGeoTransform((0, 100, 0, 6400, 0, -100))
_srs = _osr.SpatialReference()
_srs.ImportFromEPSG(3857)
_ds.SetProjection(_srs.ExportToWkt())
_ds.GetRasterBand(1).WriteArray(_np.linspace(0, 5900, 64 * 64, dtype=_np.float32).reshape(64, 64))
_ds = None
_raw = _RL(os.path.join(_dir, "dem.tif"), "raw", "gdal")
from qgis.core import QgsRasterMinMaxOrigin as _MMO  # noqa: E402
_mmo = _raw.renderer().minMaxOrigin() if raw_stretch(_raw) else None
check(_mmo is not None and _mmo.extent() == getattr(getattr(_MMO, "Extent", _MMO), "UpdatedCanvas")
      and _mmo.limits() == getattr(getattr(_MMO, "Limits", _MMO), "CumulativeCut"),
      "a raw elevation input: its grey stretched to the canvas's 2nd to 98th percentile, at every view")
del _raw, _mmo
# Removed by hand: the row unchecks; unchecked: the layer goes.
QgsProject.instance().removeMapLayer(bm2.id())
spin(50)
check(not brow.row.checked_forms() and not brow.check.isChecked(), "the basemap layer removed by hand: the row unchecked")
brow.check.setChecked(True)
check(dock.stack.find(BASEMAP_KEY) is not None and dock.stack.find(BASEMAP_KEY).name() == "Bing Aerial", "checked again: the source picked is kept")
brow.check.setChecked(False)
check(dock.stack.find(BASEMAP_KEY) is None and dock.stack.root(create=False) is None, "unchecked: the layer and the empty live group gone")
# The link reader drives the row.
check(dock.open_link("showRasterBasemap=true&basemapSourceA=google&rasterBasemapOpacity=0.6&showHillshade=false") and brow.check.isChecked()
      and brow.current() == "google" and abs(brow.opacity.opacity() - 0.6) < 1e-6
      and "lyrs%3Dy" in dock.stack.find(BASEMAP_KEY).source() and abs(dock.stack.find(BASEMAP_KEY).renderer().opacity() - 0.6) < 1e-6,
      "a link's basemapSourceA and opacity: the row checked on Google Hybrid at 60%")
check(dock.open_link("showRasterBasemap=true&basemapPerView=false&basemapSource=googlesat&showHillshade=false") and brow.current() == "googlesat",
      "basemapSource with basemapPerView=false")
check(dock.open_link("showRasterBasemap=true&showHillshade=false&basemapUrl=https://tiles.example.com/{z}/{x}/{y}.png")
      and brow.source.currentText() == "XYZ tiles (tiles.example.com)" and "tiles.example.com" in dock.stack.find(BASEMAP_KEY).source(),
      "a link's XYZ address: added to the select and drawn")
n_warn = len(dock.warnings)
check(dock.open_link("showRasterBasemap=true&showHillshade=false&basemapSourceA=wayback&date=2019-06-01")
      and brow.current() == "wayback" and dock.stack.find(BASEMAP_KEY).name() == "ESRI World Imagery" and len(dock.warnings) == n_warn + 1,
      f"a dated basemap under the Python backend: ESRI in its place, said once ({dock.warnings[-1][:60]})")
dock.connected, dock.base = "remote", "http://localhost:3400"
t = brow.tiles()
check(t[1].startswith("http://localhost:3400/basemap-tiles/{z}/{x}/{y}.jpg?") and "date=2019-06-01" in t[1] and "basemapSourceA=wayback" in t[1],
      "the same row under a tile server: the dated basemap through its /basemap-tiles, with the link's date")
brow.set_source("esri")
check(brow.tiles()[1].startswith("https://server.arcgisonline.com/"), "a built-in basemap under a tile server: its own address, no relay")
dock.connected, dock.base = "python", None
check(links.basemap_of_url(t[1])[0] == "wayback" and links.basemap_of_url(links.basemap_tiles("bing")[1]) == ("bing", {})
      and links.basemap_of_url(links.basemap_tiles("mapbox", {"mapboxKey": "k"})[1])[0] == "mapbox",
      "a saved project's basemap layer read back: its source from its address")
brow.adopt(dock.stack.find(BASEMAP_KEY))
check(brow.current() == "esri" and brow.check.isChecked(), "and into the row")
dock.build()
for r in dock.rows.values():
    r.update = lambda: None
check(dock.basemap_row is not brow and dock.basemap_row.check.isChecked() and dock.basemap_row.current() == "esri"
      and dock.stack.find(BASEMAP_KEY) is not None, "the tree rebuilt (another backend): the Basemap row keeps its state")
check(dock.open_link(LINK1) and dock.stack.find(BASEMAP_KEY) is None and not dock.basemap_row.check.isChecked(),
      "a link with no basemap: the row unchecked, the layer removed")
for r in dock.rows.values():
    r.row.set_forms(set())
    del r.update
dock.connected = None
QgsProject.instance().clear()
spin()

# 0.10.0: the Historical mode (the app's appMode=historical). The dated
# sources (historical.py) against a recorded Esri Wayback session at the
# Eiffel Tower (fixtures/wayback_paris.json: the catalog, the tilemap walk,
# the metadata of each release; no network), then the panel: the mode switch,
# one layer per capture date with its fixed temporal range, QGIS's temporal
# navigation stepping through them, both ways.
import json  # noqa: E402
import re as _re  # noqa: E402
from iconem_terrain_viewer import historical  # noqa: E402
from iconem_terrain_viewer import historical_ui as hui  # noqa: E402
from qgis.core import QgsTemporalNavigationObject, QgsSettings as _Settings  # noqa: E402
from qgis.PyQt.QtCore import Qt as _Qt  # noqa: E402

here_dir = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here_dir, "fixtures", "wayback_paris.json"), encoding="utf-8") as f:
    recorded = json.load(f)
PARIS = tuple(recorded["place"])
asked, missed = [], []


def recorded_fetch(url):
    asked.append(url)
    if url not in recorded["answers"]:
        missed.append(url)
        raise OSError("not recorded: " + url)
    return recorded["answers"][url].encode("utf-8")


def iso(dt):
    return dt.toString(_Qt.DateFormat.ISODate)


historical.set_store(None)  # nothing read from, or written to, the profile's own store
historical.reset_cache(store=True)
releases = historical.parse_wayback_config(recorded["answers"][historical.WAYBACK_CONFIG])
check(len(releases) > 150 and releases[0]["releaseMs"] > releases[-1]["releaseMs"] and releases[-1]["releaseLabel"] == "2014-02-20",
      f"Wayback's catalog: {len(releases)} releases, the newest first, back to 2014-02-20")
partial = []
ticks = historical.list_dates("wayback", *PARIS, fetch=recorded_fetch, report=lambda t, note, *_n: partial.append((list(t), note, _n)))
labels_h = [t["label"] for t in ticks]
check(not missed and len(ticks) == 9 and labels_h[0] == "2011-08-01" and labels_h[-1] == "2025-04-12",
      f"Wayback at the Eiffel Tower: 9 capture dates from 2011-08-01 to 2025-04-12 ({labels_h}; {len(missed)} requests not recorded)")
check(labels_h == sorted(set(labels_h)) and all(t["real"] for t in ticks), "one tick per capture date, the oldest first, all real dates")
check(ticks[0]["url"].endswith("/MapServer/tile/10/{z}/{y}/{x}") and ticks[0]["ref"] == "10" and "Microsoft" in ticks[0]["detail"],
      f"a tick names its release's tiles as an XYZ template and says who took it ({ticks[0]['detail']})")
n_walk = sum("/tilemap/" in u for u in asked)
check(len(asked) < 60 and n_walk < 30, f"{len(asked)} requests for the place ({n_walk} of the walk, not one per release)")
check(len(partial) > 5 and partial[0][0] == [] and all(t["real"] for p in partial for t in p[0])
      and len(partial[-1][0]) == 9 and "of 15 releases dated" in partial[-1][1] and partial[-1][2] == (15, 15),
      f"the dates are reported as they arrive, only the ones known ({partial[-1][1]})")
n_asked = len(asked)
check(historical.list_dates("wayback", PARIS[0] + 0.0002, PARIS[1], PARIS[2], fetch=recorded_fetch) is ticks and len(asked) == n_asked,
      "a small pan asks nothing again (the same quarter of a tile)")
check(historical.place_key("wayback", 48.90, 2.2945, 15) != historical.place_key("wayback", *PARIS)
      and historical.place_key("eox-s2", 1, 2, 3) == historical.place_key("eox-s2", 40, 50, 12),
      "the dates' key: the tile for Wayback, nothing for EOX")
two = historical.wayback_ticks(releases[:2], {releases[0]["releaseNum"]: None, releases[1]["releaseNum"]: None}, final=True)
check(len(two) == 2 and not two[0]["real"] and two[1]["label"].endswith("(release date)")
      and historical.wayback_ticks(releases[:2], {releases[0]["releaseNum"]: None}, final=False) == [],
      "a release whose capture date did not answer: at its release date, marked, and only once the list is final")
low = historical.list_dates("wayback", 20, 10, 3, fetch=recorded_fetch)
check(len(low) == 1 and low[0]["ref"] == "latest" and low[0]["wide"] and historical.too_wide("wayback", 3)
      and not historical.too_wide("wayback", 10) and not historical.too_wide("eox-s2", 3) and len(asked) == n_asked,
      f"zoomed out: the newest release alone ({low[0]['label']})")
eox = historical.list_dates("eox-s2", 0, 0, 0, fetch=recorded_fetch)
check([t["label"] for t in eox] == [str(y) for y in range(2016, 2026)]
      and eox[0]["url"] == "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"
      and "s2cloudless-2017_3857" in eox[1]["url"],
      "EOX Sentinel-2 cloudless: 2016 to 2025, the first mosaic under its bare layer name (EOX's WMTS capabilities)")
ts_path = os.path.join(here_dir, "..", "lib", "eox-s2-cloudless.ts")
if os.path.exists(ts_path):
    with open(ts_path, encoding="utf-8") as f:
        ts = f.read()
    years = [int(y) for y in _re.search(r"EOX_S2_YEARS = \[([^\]]+)\]", ts).group(1).split(",")]
    check(set(years) <= set(historical.EOX_YEARS) and "_3857/default/g/{z}/{y}/{x}.jpg" in ts and 'year === 2016 ? ""' in ts
          and eox[-1]["url"] == "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg",
          f"EOX's tiles are the app's (lib/eox-s2-cloudless.ts), every year of the app listed: {years}")
    with open(os.path.join(here_dir, "..", "lib", "dated-imagery.ts"), encoding="utf-8") as f:
        app_ids = _re.findall(r'^\s+id: "([a-z0-9-]+)", name:', f.read(), _re.M)
    known = {s["id"] for s in historical.SOURCES} | set(historical.LEFT_OUT)
    check(len(app_ids) >= 6 and set(app_ids) <= known, f"every dated source of the app is listed or left out with a reason ({app_ids})")
spans = historical.tick_ranges(ticks, now_ms=historical.utc_ms(2026, 11, 26))
check(all(a < b for a, b in spans) and all(spans[i][1] == spans[i + 1][0] for i in range(8))
      and spans[-1][1] == historical.utc_ms(2026, 11, 27),
      "a capture's span: until the next one, the newest until tomorrow, none overlapping")
espans = historical.tick_ranges(eox)
check(espans[0] == (historical.utc_ms(2016), historical.utc_ms(2017)) and espans[-1] == (historical.utc_ms(2025), historical.utc_ms(2026)),
      "a yearly mosaic's span is its year")
check(historical.nearest(ticks, historical.utc_ms(2015, 1, 1)) == 2 and historical.nearest(ticks, None) == 8
      and historical.index_at(ticks, historical.utc_ms(2019, 6, 1)) == 3 and historical.index_at(ticks, 0) == 0,
      "the tick nearest a date, the newest without one, the tick whose span holds a moment")

# The panel: the mode switch.
QgsProject.instance().clear()
spin()
dock.project_fresh = False  # an existing project: the first layer does not send the canvas to the whole world
check(list(dock.mode_switch.buttons) == ["terrain", "historical"] and dock.mode == "terrain"
      and not dock.mode_switch.buttons["historical"].icon().isNull() and dock.mode_switch.buttons["terrain"].isChecked(),
      "the mode switch: Terrain and Historical (a clock), Terrain first")
hp = dock.historical
hp.fetch = recorded_fetch
check(not dock.terrain_page.isHidden() and hp.isHidden(), "Terrain: the terrain panel shown, the historical one hidden")
# 0.11.0: a regular step, one week, is the default (0.10.1: source timestamps).
check(hui.DEFAULT_STEP == "week" and (hp.step == "week" or _Settings().contains("terrain_viewer/temporalStep"))
      and hp.step_box.currentData() == hp.step, f"the Temporal Controller's step starts on one week ({hp.step})")
hp.set_step("timestamps")  # the 0.10.0 checks below step date by date
canvas.freeze(True)  # nothing drawn: no tile asked from Esri or EOX
nav = QgsTemporalNavigationObject()
canvas.setTemporalController(nav)
dock.zoom_to(*PARIS)
spin(50)
hp.follow.setChecked(False)  # the test lists by hand
dock.mode_switch.buttons["historical"].click()
check(dock.mode == "historical" and dock.terrain_page.isHidden() and not hp.isHidden()
      and _Settings().value("terrain_viewer/appMode") == "historical",
      "Historical picked: its panel shown, the terrain panel hidden, the mode remembered")
hp.cancel_job()
hp.listed_key = None
check(hp.refresh(wait=True) and len(hp.ticks) == 9, f"the dates of the canvas centre listed ({hp.status.text()})")
group = hp.group()
names = [n.name() for n in group.findLayers()] if group is not None else []
check(group is not None and group.parent() is not None and group.parent().customProperty("terrain_viewer/root")
      and len(names) == 9 and names[0] == "2025-04-12 · Esri Wayback" and names[-1] == "2011-08-01 · Esri Wayback",
      f"one XYZ layer per date in \"{group.name() if group else None}\" of the live group, the newest on top")
first = hp.layers()["wayback:10"]
r0 = first.temporalProperties().fixedTemporalRange()
check(first.isValid() and first.temporalProperties().isActive() and first.temporalProperties().mode() == hui.FIXED_RANGE
      and iso(r0.begin()) == "2011-08-01T00:00:00Z" and iso(r0.end()) == "2013-08-20T00:00:00Z" and not r0.includeEnd(),
      "a date's layer has a fixed temporal range: its capture until the next one, half open")
check("/tile/10/{z}/{y}/{x}" in __import__("urllib.parse").parse.unquote(first.source()), "its tiles are that release's")


def drawn():
    tree = QgsProject.instance().layerTreeRoot()
    return sorted(lyr.name()[:10] for lyr in hp.layers().values()
                  if lyr.temporalProperties().isVisibleInTemporalRange(canvas.temporalRange()) and tree.findLayer(lyr.id()).isVisible())


def ticked():
    return [n.name()[:10] for n in hp.group().findLayers() if n.itemVisibilityChecked()]


check(nav.navigationMode() == hui.NAV_ANIMATED and nav.frameDuration().originalUnit() == hui.IRREGULAR
      and nav.totalFrameCount() == 9 and len(nav.availableTemporalRanges()) == 9,
      f"QGIS's temporal navigation: animated, step \"source timestamps\", one frame per date ({nav.totalFrameCount()})")
check(nav.currentFrameNumber() == 8 and drawn() == ["2025-04-12"] and hp.current_label.text() == "2025-04-12",
      f"the newest date first: its frame, its layer alone drawn ({drawn()})")
check(hp.pick(0) and nav.currentFrameNumber() == 0 and drawn() == ["2011-08-01"] and not hp.prev_btn.isEnabled() and hp.next_btn.isEnabled(),
      f"a date picked in the panel moves the Temporal Controller and swaps the imagery ({drawn()})")
nav.setCurrentFrameNumber(3)  # the controller's slider
check(hp.index == 3 and hp.current_label.text() == "2018-09-11" and drawn() == ["2018-09-11"] and hp.dates.currentRow() == 5
      and hp.strip.current == 3 and "Maxar" in hp.detail.text(),
      f"the controller's slider moved: the panel shows its date ({hp.current_label.text()}, {hp.detail.text()})")
hp.next_btn.click()
check(hp.index == 4 and nav.currentFrameNumber() == 4 and drawn() == ["2020-04-20"], "next: the following date")
hp.dates.setCurrentRow(0)
check(hp.index == 8 and drawn() == ["2025-04-12"], "a row of the list picks its date")
hp.strip.picked.emit(2)
check(hp.index == 2 and drawn() == ["2014-09-12"] and len(hp.strip.ticks) == 9, "a tick of the axis picks its date")
hp.strip.resize(300, 38)
hp.strip.repaint()
check(hp.strip.x_of(ticks[0]["dateMs"]) < hp.strip.x_of(ticks[1]["dateMs"]) < hp.strip.x_of(ticks[8]["dateMs"])
      and hp.strip.index_at(hp.strip.x_of(ticks[5]["dateMs"]) + 1) == 5, "the axis places each tick at its date")
nav.setNavigationMode(hui.NAV_OFF)  # the user turns the controller off
check(ticked() == ["2014-09-12"] and not hp.temporal_wanted,
      f"the controller turned off: the date's layer alone checked, not all nine drawn ({ticked()})")
hp.pick(5)
check(ticked() == ["2021-03-06"] and nav.navigationMode() == hui.NAV_OFF, "and a pick swaps the checked layer, the controller left off")
nav.setNavigationMode(hui.NAV_ANIMATED)
hp.pick(5)
check(len(ticked()) == 9 and drawn() == ["2021-03-06"], "turned on again: QGIS filters by time")

# The Temporal Controller's own widget: its slider has one stop per date.
from qgis.gui import QgsTemporalControllerWidget  # noqa: E402
from qgis.PyQt.QtWidgets import QSlider, QComboBox as _Combo  # noqa: E402
tcw = QgsTemporalControllerWidget()
canvas.setTemporalController(tcw.temporalController())
hp.pick(8)
slider = tcw.findChild(QSlider, "mAnimationSlider")
step_box = tcw.findChild(_Combo, "mTimeStepsComboBox")
check(slider.maximum() == 8 and slider.value() == 8 and step_box.currentText() == "source timestamps",
      f"QGIS's Temporal Controller: a slider of 9 stops, step \"{step_box.currentText()}\"")
slider.setValue(1)
check(hp.index == 1 and hp.current_label.text() == "2013-08-20" and drawn() == ["2013-08-20"],
      "dragging its slider swaps the imagery and the panel's date")
hp.apply(ticks[:5], True)
check(slider.maximum() == 4 and tcw.temporalController().totalFrameCount() == 5 and len(hp.layers()) == 5,
      f"another list of dates (a pan): the slider follows ({slider.maximum() + 1} stops), the layers too")
hp.apply(ticks, True)
check(slider.maximum() == 8 and len(hp.layers()) == 9 and hp.index == 1, "and back, the date asked for kept")

# Another source: EOX's yearly mosaics, no request; then a worldwide default.
n_asked = len(asked)
hp.target_ms = None
hp.source.setCurrentIndex(hp.source.findData("dated:eox-s2"))
keys_h = sorted(hp.layers())
check(len(keys_h) == 10 and keys_h[0] == "eox-s2:2016" and len(asked) == n_asked and hp.current_label.text() == "2025"
      and "EOX" in hp.group().name(), f"EOX Sentinel-2: one layer per year, no request, the Wayback layers gone ({hp.group().name()})")
r16 = hp.layers()["eox-s2:2016"].temporalProperties().fixedTemporalRange()
check(iso(r16.begin()) == "2016-01-01T00:00:00Z" and iso(r16.end()) == "2017-01-01T00:00:00Z", "the 2016 mosaic's range is 2016")
choices_h = [hp.source.itemData(i) for i in range(hp.source.count()) if hp.source.itemData(i)]
check(choices_h[:6] == ["dated:wayback", "dated:ge-historical", "dated:planet", "dated:planet-quarterly", "dated:hls", "dated:eox-s2"]
      and "basemap:esri" in choices_h and "basemap:mapbox" not in choices_h,
      f"the imagery select: the historical sources, then the worldwide defaults ({choices_h})")
hp.source.setCurrentIndex(hp.source.findData("basemap:esri"))
bm = dock.stack.find("basemap")
check(not hp.layers() and bm is not None and bm.name() == "ESRI World Imagery" and dock.basemap_row.row.on("colour")
      and hp.current_label.text() == "No date", "a worldwide default: no dates, the Basemap row draws it")
hp.source.setCurrentIndex(hp.source.findData("dated:wayback"))
check(len(hp.layers()) == 9 and dock.stack.find("basemap") is None and not dock.basemap_row.row.on("colour"),
      "a historical source again: the dated layers, the Basemap row unchecked (one basemap at a time)")
dock.zoom_to(PARIS[0] + 0.0002, PARIS[1], PARIS[2])
check(hp.refresh(wait=True) is False, "a small pan: the same dates, nothing listed again")
hp.remove()
hp.follow.setChecked(True)
hp.moved()
check(hp.group() is None and not hp.ticks and hp.paused and not hp.move_timer.isActive(),
      "Remove: the group and its layers out of the project, and a pan lists nothing again")
hp.follow.setChecked(False)

# A link in the app's historical mode: listed in a worker thread, the date asked for shown.
dock.set_mode("terrain")
spin(50)
date_2014 = historical.utc_ms(2014, 9, 12)
ok_link = dock.open_link(f"https://historical-satellite.iconem.com/?appMode=historical&lat={PARIS[0]}&lng={PARIS[1]}&zoom={PARIS[2]}"
                         f"&basemapSourceA=historical&historicalActiveSourceA=wayback&dateA={date_2014 + 5 * 86400000}")
# Listed again in the worker thread, Esri's metadata answering slowly: the
# dates fill in as they answer, the layers on screen staying meanwhile.
historical.reset_cache(store=True)


def slow_fetch(url):
    if "/query?" in url:
        time.sleep(0.7)
    return recorded_fetch(url)


hp.fetch = slow_fetch
hp.listed_key = None
hp.refresh()
on_screen = {lyr.id() for lyr in hp.layers().values()}
held = len(on_screen) == 9 and hp.job is not None and not hp.progress.isHidden()
partials, notices, bars, in_step = set(), set(), set(), True
for _ in range(300):
    spin(100)
    held = held and on_screen <= {lyr.id() for lyr in hp.layers().values()}
    if hp.job is not None and not hp.final:
        partials.add(len(hp.ticks))
        notices.add(hp.notice.text()[2:22])
        bars.add((hp.progress.value(), hp.progress.maximum()))
        in_step = in_step and hp.dates.count() == len(hp.ticks) == len(hp.strip.ticks) and not hp.notice.isHidden()
    if hp.job is None and hp.ticks:
        break
hp.fetch = recorded_fetch
held = held and len(hp.layers()) == 9
check(held, "while the place's dates are listed again, the layers shown stay (none taken away and brought back)")
check(in_step and len(partials) >= 2 and max(partials) < 9 and "Dates still arriving" in notices
      and any(m == 15 and 0 < v < 15 for v, m in bars),
      f"the dates are added to the list, the axis and the layers as they answer ({sorted(partials)} dates, then 9; "
      f"progress {sorted(bars)[:3]}...)")
check(hp.final and hp.notice.isHidden() and hp.progress.isHidden(), "once whole: no notice, no progress bar")
check(hp.ticks[-1]["label"] == "2025-04-12" and min(partials) >= 1 and "2014-09-12" in [t["label"] for t in hp.ticks],
      "the releases that can hold the date asked for are dated first")
check(ok_link and dock.mode == "historical" and len(hp.ticks) == 9 and hp.current_label.text() == "2014-09-12" and drawn() == ["2014-09-12"],
      f"a historical link: the mode, the source, the date nearest dateA, listed off the UI thread ({hp.current_label.text()}, {hp.status.text()})")
before_w = len(dock.warnings)
dock.open_link(f"appMode=historical&lat={PARIS[0]}&lng={PARIS[1]}&zoom={PARIS[2]}&historicalActiveSourceA=ge-historical")
check(len(dock.warnings) == before_w + 1 and "needs a tile server backend" in dock.warnings[-1] and hp.current()[1] == "wayback",
      f"a link's source that cannot be used now: said with the reason, Esri Wayback instead ({dock.warnings[-1][:90]}...)")
for _ in range(50):
    spin(100)
    if hp.job is None:
        break
exec(open(os.path.join(here_dir, "panel_historical_checks.py"), encoding="utf-8").read())  # 0.10.1, the same panel and canvas
hp.remove()
hp.follow.setChecked(True)
dock.set_mode("terrain")
spin(50)
check(not dock.terrain_page.isHidden() and hp.isHidden() and not hp.active, "back to Terrain")
_Settings().remove("terrain_viewer/appMode")
nav = QgsTemporalNavigationObject()  # kept: the canvas does not own its controller
canvas.setTemporalController(nav)
historical.reset_cache()
canvas.freeze(False)
canvas.stopRendering()
QgsProject.instance().clear()
spin()

# Updates: plugins.xml as make_zip.py writes it, read as QGIS reads it (the
# key before the first dot of file_name), a zip installed over a copy of
# the plugin, a tampered one refused.
import importlib.util  # noqa: E402
import shutil as _sh  # noqa: E402
import zipfile  # noqa: E402
from iconem_terrain_viewer import updates  # noqa: E402
spec_mz = importlib.util.spec_from_file_location("make_zip", os.path.join(os.path.dirname(os.path.abspath(__file__)), "make_zip.py"))
mz = importlib.util.module_from_spec(spec_mz)
spec_mz.loader.exec_module(mz)
up = tempfile.mkdtemp()
plugins_dir = os.path.join(up, "plugins")
_sh.copytree(os.path.join(os.path.dirname(os.path.abspath(__file__)), "iconem_terrain_viewer"), os.path.join(plugins_dir, "iconem_terrain_viewer"),
             ignore=_sh.ignore_patterns("__pycache__", "server"))
here_v = updates.installed_version(os.path.join(plugins_dir, "iconem_terrain_viewer"))
staged = os.path.join(up, "stage", "iconem_terrain_viewer")
_sh.copytree(os.path.join(plugins_dir, "iconem_terrain_viewer"), staged)
with open(os.path.join(staged, "metadata.txt"), encoding="utf-8") as f:
    meta = f.read().replace(f"version={here_v}", "version=9.9.9")
with open(os.path.join(staged, "metadata.txt"), "w", encoding="utf-8") as f:
    f.write(meta)
os.remove(os.path.join(staged, "solar.py"))  # a file the new version no longer has
dist = os.path.join(up, "dist")
os.makedirs(dist)
for name in mz.PLUGINS:
    zpath = os.path.join(dist, f"{name}-{mz.version_of(name) if name != 'iconem_terrain_viewer' else '9.9.9'}.zip")
    with zipfile.ZipFile(zpath, "w") as z:
        mz.add_tree(z, staged if name == "iconem_terrain_viewer" else os.path.join(mz.here, name), name)
orig_version_of = mz.version_of
mz.version_of = lambda n: "9.9.9" if n == "iconem_terrain_viewer" else orig_version_of(n)
real_read = mz.configparser.ConfigParser.read


def read_bumped(self, path, encoding=None):
    out = real_read(self, path, encoding=encoding)
    if "iconem_terrain_viewer" in str(path) and self.has_section("general"):
        self["general"]["version"] = "9.9.9"
    return out


mz.configparser.ConfigParser.read = read_bumped
xml_path = mz.plugins_xml("qgis-plugins-test", dist)
mz.configparser.ConfigParser.read = real_read
xml = open(xml_path, "rb").read()
info = updates.parse_plugins_xml(xml)
check(info and info["version"] == "9.9.9" and info["file_name"] == "iconem_terrain_viewer.9.9.9.zip"
      and info["download_url"].endswith("/releases/download/qgis-plugins-test/iconem_terrain_viewer-9.9.9.zip") and len(info["sha256"]) == 64,
      f"plugins.xml: the plugin keyed iconem_terrain_viewer, its zip on the release, its sha256 ({info and info['file_name']})")
check(b"@" not in xml.replace(b"https://", b""), "plugins.xml: no email anywhere")
check(xml.count(b"<experimental>False</experimental>") == 2 and b"<experimental>True" not in xml,
      "plugins.xml: neither plugin marked experimental (0.12.0: the flag follows metadata.txt)")
check(updates.parse_plugins_xml(xml, "send2map_app") is not None, "plugins.xml: Send2MapApp listed too")
data = open(os.path.join(dist, "iconem_terrain_viewer-9.9.9.zip"), "rb").read()
target = os.path.join(plugins_dir, "iconem_terrain_viewer")
os.makedirs(os.path.join(target, "server"))
open(os.path.join(target, "server", "keep.txt"), "w").close()
try:
    updates.install_zip(data, "0" * 64, target)
    check(False, "a tampered zip is refused")
except updates.UpdateError as e:
    check("sha256" in str(e) and updates.installed_version(target) == here_v, "a tampered zip is refused, nothing changed")
got_v = updates.install_zip(data, info["sha256"], target)
check(got_v == "9.9.9" and updates.installed_version(target) == "9.9.9" and not os.path.exists(os.path.join(target, "solar.py"))
      and os.path.exists(os.path.join(target, "server", "keep.txt")),
      "the update unpacked over the plugin: new version, a dropped file removed, server/ kept")
check(not updates.can_update(os.path.join(os.path.dirname(os.path.abspath(__file__)), "iconem_terrain_viewer"))[0],
      "a development copy (in a git checkout) is never overwritten")
check(updates.newer("0.10.0", "0.9.0") and not updates.newer("0.9.0", "0.9.0") and updates.newer("1.0", "0.99.9"), "versions compared as numbers")
dock.updates_answered(xml, "file:///plugins.xml")
check(not dock.update_box.isHidden() and "9.9.9" in dock.update_btn.text(), f"the panel offers the update ({dock.update_btn.text()})")
QgsSettings_ = __import__("qgis.core", fromlist=["QgsSettings"]).QgsSettings
QgsSettings_().remove("terrain_viewer/updateAvailable")
QgsSettings_().remove("terrain_viewer/updateCheckedAt")
_sh.rmtree(up, ignore_errors=True)
exec(open(os.path.join(here_dir, "panel_buildings_checks.py"), encoding="utf-8").read())  # 0.11.0: the building shadows' buildings
exec(open(os.path.join(here_dir, "panel_setup_checks.py"), encoding="utf-8").read())  # 0.12.0: Freeze's parameters, a setup saved and loaded
exec(open(os.path.join(here_dir, "panel_overlay_checks.py"), encoding="utf-8").read())  # 0.12.0: the app's Vector library as QGIS layers
dock.cleanup()

print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
import test_teardown  # noqa: E402 - the widgets deleted, exitQgis, the process ended as QGIS ends
test_teardown.leave(app, 1 if failures else 0, dock, bridge, canvas)
