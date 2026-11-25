"""The panel's pieces that need no tile service and no network: the slider
ranges and symmetric pairs (settings_ui), share links (service), the Python
backend's mapping of the service's modes, settings and sources
(python_backend), the packaged assets, and the widgets (the light pad, the
slider and its box), in headless QGIS:

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
check(pyb.py_forms("buildingShadows", {"colour"}, reg) == {"colour"}, "building shadows: colour (the service has no values)")
py, opts = pyb.py_opts("isoline", {"isolineMode": "interval", "isolineInterval": 20, "isolineMeasure": "slope"}, None, reg)
check(opts == {"at": "interval", "interval": 20.0}, f"iso-line settings: {opts}")
py, opts = pyb.py_opts("graticules", {"graticuleDensity": 2, "graticuleColor": "#ff0000"}, None, reg)
check(opts == {"density": 2.0, "color": "#ff0000"}, f"graticule settings: {opts}")
py, opts = pyb.py_opts("localDominance", {"localDominanceMaxRadius": 40}, None, reg)
check(opts == {"maxRadius": 40}, f"local dominance settings: {opts}")
missing = [m for m in reg if reg[m].get("python_supported", True) and m not in __import__("terrain_viewer.live.layers", fromlist=["ORDER"]).ORDER]
check(not missing, f"every Python mode is in live/layers.py's ORDER {missing}")
check(pyb.py_forms("hillshade", {"colour"}, reg) == {"colour"}, "hillshade: colour only")
check(pyb.py_forms("slope", {"colour", "values"}, reg) == {"colour", "values"}, "slope: colour and values")
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

print("FAILURES:" if failures else "OK", *failures, sep="\n  ")
app.exitQgis()
sys.exit(1 if failures else 0)
