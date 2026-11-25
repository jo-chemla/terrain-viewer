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

from terrain_viewer import assets, python_backend as pyb  # noqa: E402
from terrain_viewer.service import split_link, link_params, clean_enum, query_dict  # noqa: E402
from terrain_viewer.settings_ui import slider_range, symmetric_pairs  # noqa: E402

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
check(pyb.py_mode("hillshade", {"hillshadeMethod": "aspect-multidir"}, reg) == "multihillshade", "a multidirectional method")
check(pyb.py_mode("moundDetector", None, reg) is None, "the mound detector is not computed in Python")
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
missing = [m for m in reg if reg[m].get("python_supported", True) and m not in __import__("terrain_viewer.live.layers", fromlist=["ORDER"]).ORDER]
check(not missing, f"every Python mode is in live/layers.py's ORDER {missing}")
check(pyb.py_forms("hillshade", {"colour"}, reg) == {"colour"}, "hillshade: color only")
check(pyb.py_forms("slope", {"colour", "values"}, reg) == {"colour", "values"}, "slope: color and values")
check(pyb.py_forms("contours", {"colour", "vector"}, reg) == {"colour", "vector"}, "contours: raster and lines")
py, opts = pyb.py_opts("svf", {"svfRadius": 12, "svfColorRamp": "svf-default"}, (315.0, 45.0), reg)
check(py == "svf" and opts == {"radius": 12}, f"svf: the radius carries over, the ramp does not: {opts}")
py, opts = pyb.py_opts("hillshade", {"hillshadeExag": 1.0}, (120.0, 30.0), reg)
check(opts == {"azimuth": 120.0, "altitude": 30.0}, f"hillshade: the shared light: {opts}")
py, opts = pyb.py_opts("matcap", {"matcapTextureId": "jade", "matcapRotationDeg": 0}, None, reg)
check(opts == {"texture": "jade"}, f"matcap: the texture: {opts}")
check(pyb.unsupported_settings("svf", ["svfRadius", "svfColorRamp", "svfOpacity"], reg) == {"svfColorRamp"},
      "svf: the ramp is greyed out, the radius and opacity are not")
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
from terrain_viewer.live import dem  # noqa: E402
check(sid and sid.startswith("mapbox-") and "access_token=pk.test" in dem.SOURCES[sid]["url"], "Mapbox with its key")
check(pyb.source_spec(None, [], {})[0] == "mapterhorn", "no source: Mapterhorn")
sup = pyb.supported_sources(cat["sources"])
check("aws" in sup and "esri" not in sup and "mapbox" in sup, f"supported sources: {len(sup)}")

# widgets
from qgis.PyQt.QtCore import QPoint, Qt  # noqa: E402
from qgis.PyQt.QtTest import QTest  # noqa: E402
from terrain_viewer.widgets import LightPad, SliderSpin  # noqa: E402
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
from terrain_viewer import solar  # noqa: E402
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
from qgis.core import QgsProject, QgsRectangle, QgsCoordinateReferenceSystem, QgsVectorTileLayer  # noqa: E402
from qgis.gui import QgsMapCanvas, QgsLayerTreeMapCanvasBridge  # noqa: E402
from terrain_viewer.dock import TerrainViewerDock  # noqa: E402
from terrain_viewer import labels  # noqa: E402
from terrain_viewer.layers import vector_renderer  # noqa: E402
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
dock.stack.ensure("hillshade", "Hillshade", ("Lighting",), "http://127.0.0.1:9/{z}/{x}/{y}.png", False)
spin(400)
ext = canvas.extent()
check(abs(ext.center().x() - kept.center().x()) < 1 and abs(ext.width() - kept.width()) < 1,
      f"the first layer in an empty project leaves the canvas where it was ({ext.toString(0)})")
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
check(labels.tile_labeling("isoline").styles()[0].layerName() == "isoline"
      and labels.tile_labeling("planeSlicer").styles()[0].layerName() == "plane-slicer", "iso-line and plane slicer tiles: labelled")
from qgis.core import QgsVectorLayer  # noqa: E402
mem = QgsVectorLayer("LineString?crs=EPSG:3857&field=value:double", "iso", "memory")
check(labels.label_memory_layer(mem, "isoline") and mem.labelsEnabled(), "iso-line lines (Python backend): labelled")
mem2 = QgsVectorLayer("Polygon?crs=EPSG:3857&field=value:double&field=side:string", "slicer", "memory")
check(labels.label_memory_layer(mem2, "planeSlicer") and mem2.labelsEnabled(), "plane slicer areas (Python backend): labelled")
dock.cleanup()

print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
