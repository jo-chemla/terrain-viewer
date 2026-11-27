# Run by test_panel_units.py (exec, in its namespace: the panel `hp` in the
# Historical mode at the Eiffel Tower, nine Esri Wayback dates listed from the
# recorded session, the canvas frozen, its temporal navigation the Temporal
# Controller widget's). 0.10.1: the Temporal Controller button, the
# controller's step, the notices (the map moved, the view too wide), the
# dates kept between sessions, Planet, NASA HLS, Google Earth through a tile
# service, the second toolbar button, and a QGIS layer's symbology playing no
# part in the elevation read. No network.
from urllib.parse import unquote as _unquote  # noqa: E402
from qgis.PyQt.QtWidgets import QMainWindow, QDockWidget, QAction  # noqa: E402
from qgis.gui import QgsMapCanvas as _Canvas  # noqa: E402

NOW = historical.utc_ms(2026, 11, 26)


def settle(n=150):
    """Until the listing in the worker thread has been read by the panel."""
    for _ in range(n):
        spin(60)
        if hp.job is None:
            return True
    return False


# -- the Temporal Controller button ------------------------------------------------
# In QGIS the panel is the dock named "Temporal Controller" (its title is
# translated, its object name is not) and View > Panels' action is
# mActionTemporalController, checkable, which shows it: read from QGIS 4.2
# and 3.44 themselves (test_app_window.py does it in the application).
check(hp.temporal_dock() is None and hp.temporal_action() is None and not hp.show_temporal_controller()
      and "View > Panels" in hp.status.text(), "no Temporal Controller panel to find: said, nothing else")
win = QMainWindow()
tdock = QDockWidget("Contrôleur temporel", win)
tdock.setObjectName(hui.TEMPORAL_DOCK)
win.addDockWidget(Qt.DockWidgetArea.TopDockWidgetArea, tdock)
tact = QAction("Contrôleur temporel", win)
tact.setObjectName(hui.TEMPORAL_ACTION)
tact.setCheckable(True)
tact.toggled.connect(tdock.setVisible)
win.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, dock)
win.show()
tdock.hide()
spin(50)
tnav = canvas.temporalController()
tnav.setNavigationMode(hui.NAV_OFF)
check(hp.main_window() is win and hp.temporal_dock() is tdock and hp.temporal_action() is tact and tdock.isHidden()
      and not hp.temporal_wanted, "QGIS's Temporal Controller panel and its action are found by their object names")
hp.temporal_btn.click()
spin(50)
check(not tdock.isHidden() and tact.isChecked() and hp.temporal_wanted and tnav.navigationMode() == hui.NAV_ANIMATED,
      "the Temporal Controller button shows QGIS's panel (its action checked, as a click on the toolbar's clock) and "
      "turns the navigation on")
tdock.hide()
hp.temporal_btn.click()
check(not tdock.isHidden(), "and again when the panel was closed while its action stayed checked")
other = QDockWidget("Zeitsteuerung", win)
other.setObjectName("SomeTemporalPanel")
tdock.setObjectName("renamed")
check(hp.temporal_dock() is other, "a panel whose object name merely holds \"temporal\" is the fallback")
tdock.setObjectName(hui.TEMPORAL_DOCK)
other.setParent(None)

# -- the controller's step ---------------------------------------------------------
hp.target_ms = None
hp.pick(8)
check(hp.step == "timestamps" and [hp.step_box.itemData(i) for i in range(hp.step_box.count())] == ["day", "week", "month", "year", "timestamps"],
      "the step select: day, week (the default), month, year, then source timestamps")
check(hp.frame_label.isHidden() and hp.frame_text() == "", "source timestamps: the frame is the capture, no frame line")
first_ms, last_ms = hp.ticks[0]["dateMs"], hp.ticks[-1]["dateMs"]
for step in ("day", "week", "month", "year"):
    hp.step_box.setCurrentIndex(hp.step_box.findData(step))
    total = tnav.totalFrameCount()
    unit_ok = tnav.frameDuration().originalUnit() == hp.step_unit() and tnav.frameDuration().originalDuration() == 1
    same, holds, spread, shared = True, True, True, 0
    for i in range(9):
        asked_label = ticks[i]["label"]
        hp.pick(i)
        frame = tnav.currentFrameNumber()
        rng = tnav.dateTimeRangeForFrameNumber(frame)
        cur = hp.ticks[hp.index]
        shared += cur["label"] != asked_label
        same = same and bool(drawn()) and max(drawn()) == hp.current_label.text() == cur["label"]
        holds = holds and rng.begin().toMSecsSinceEpoch() <= cur["dateMs"] < rng.end().toMSecsSinceEpoch()
        # The slider's position is the date's place in time, to a frame.
        spread = spread and abs(frame / max(1, total - 1) - (cur["dateMs"] - first_ms) / (NOW - first_ms)) < 0.03 + 1.5 / total
    check(unit_ok and same and holds and spread and _Settings().value("terrain_viewer/temporalStep") == step,
          f"step {step}: {total} frames of equal duration, each date's frame holds it and draws it, the slider "
          f"proportional to time ({shared} dates sharing a frame with a newer one: the newer drawn, and shown by the panel)")
# One week, the default: every frame draws the latest capture at or before
# its end, each layer standing from its true capture date until the next.
hp.set_step("week")
hp.pick(0)
wk0 = tnav.currentFrameNumber()
weekly_ok, changes, checked_frames = True, 0, 0
last_label = None
for fr in list(range(wk0, tnav.totalFrameCount(), 37)) + [tnav.totalFrameCount() - 1]:
    tnav.setCurrentFrameNumber(fr)
    wr = tnav.dateTimeRangeForFrameNumber(fr)
    a_ms, b_ms = wr.begin().toMSecsSinceEpoch(), wr.end().toMSecsSinceEpoch()
    want = max((t for t in ticks if t["dateMs"] < b_ms), key=lambda t: t["dateMs"])  # the latest capture begun by the frame's end
    weekly_ok = weekly_ok and hp.current_label.text() == want["label"] == max(drawn()) and b_ms - a_ms == 7 * 86400000 \
        and wr.begin().date().dayOfWeek() == 1 and want["label"] in hp.frame_text()
    changes += want["label"] != last_label
    last_label = want["label"]
    checked_frames += 1
check(weekly_ok and changes >= 8 and checked_frames > 15,
      f"one week a frame: {tnav.totalFrameCount()} frames from a Monday; at {checked_frames} of them the panel and the layers "
      f"drawn are the latest capture at or before the frame's end ({changes} captures met)")
tnav.setCurrentFrameNumber(tnav.findBestFrameNumberForFrameStart(hui.qdatetime(historical.utc_ms(2019, 6, 3))))
check(hp.current_label.text() == "2018-09-11" and not hp.frame_label.isHidden()
      and hp.frame_label.text() == "Controller: week of 2019-06-03. Imagery: captured 2018-09-11, the latest at or before it."
      and [l.name() for l in hp.layers().values() if l.temporalProperties().isVisibleInTemporalRange(canvas.temporalRange())] == ["2018-09-11 · Esri Wayback"],
      f"the week of 2019-06-03 draws the capture of 2018-09-11, and the panel says both ({hp.frame_label.text()})")
hp.pick(5)
check("in this frame" in hp.frame_label.text() and ticks[5]["label"] in hp.frame_label.text(),
      f"a date picked: its week's frame, which holds the capture ({hp.frame_label.text()})")
tnav.setNavigationMode(hui.NAV_OFF)
check(hp.frame_label.isHidden(), "the controller turned off: no frame line")
tnav.setNavigationMode(hui.NAV_ANIMATED)
hp.temporal_wanted = True
hp.set_step("month")
hp.pick(0)
f0 = tnav.currentFrameNumber()
tnav.setCurrentFrameNumber(f0 + 5)  # the controller's slider, five months on: no capture since
r5 = tnav.dateTimeRangeForFrameNumber(f0 + 5)
check(iso(r5.begin()) == "2012-01-01T00:00:00Z" and iso(r5.end()) == "2012-02-01T00:00:00Z" and hp.current_label.text() == "2011-08-01"
      and drawn() == ["2011-08-01"], "month: frames are calendar months; a frame with no new capture draws the one current then")
check(slider.maximum() + 1 == tnav.totalFrameCount() and step_box.currentText() == "months" and tnav.totalFrameCount() > 170,
      f"QGIS's Temporal Controller: step \"{step_box.currentText()}\", {slider.maximum() + 1} stops")
tnav.setCurrentFrameNumber(tnav.findBestFrameNumberForFrameStart(hui.qdatetime(historical.utc_ms(2019, 6, 1))))
check(hp.current_label.text() == "2018-09-11" and drawn() == ["2018-09-11"],
      "its slider at June 2019: the capture of 2018-09-11, the panel showing that date")
same_year = [dict(ticks[0], dateMs=historical.utc_ms(2014, 3, 1), label="2014-03-01", ref="a"), ticks[2]]
hp.apply(same_year, True)
hp.set_step("year")
hp.pick(0)
check(hp.current_label.text() == "2014-09-12" and "same year" in hp.status.text() and "2014-03-01" in hp.status.text(),
      f"two captures of one year under the year step: the newer is drawn and shown, and said ({hp.status.text()[:60]}...)")
hp.apply(ticks, True)
hp.step_box.setCurrentIndex(hp.step_box.findData("timestamps"))
check(hp.step == "timestamps" and tnav.totalFrameCount() == 9 and tnav.frameDuration().originalUnit() == hui.IRREGULAR
      and step_box.currentText() == "source timestamps", "back to source timestamps: nine stops again")
_Settings().remove("terrain_viewer/temporalStep")
check(hui.floor_ms("week", historical.utc_ms(2026, 11, 26)) == historical.utc_ms(2026, 11, 23)
      and hui.floor_ms("month", historical.utc_ms(1943, 12, 31)) == historical.utc_ms(1943, 12, 1)
      and hui.scale_text(254321) == "1:250 000", "a week starts on its Monday; a date before 1970; a scale to two figures")

# -- the notices: the map moved, the view too wide ---------------------------------
hp.target_ms = None
hp.pick(8)
check(hp.notice.isHidden() and "Esri Wayback needs no backend" in hp.origin.text() and "provider's own XYZ" in hp.origin.text(),
      f"one quiet line says where the tiles come from ({hp.origin.text()[:60]}...)")
check(not hp.needs_backend() and dock.terrain_layout.indexOf(dock.backend_box) == 0 and hp.backend_slot.indexOf(dock.backend_box) < 0,
      "Esri Wayback needs no backend: the backend control stays on the Terrain page")
hp.follow.setChecked(True)
dock.zoom_to(48.90, 2.2945, 15)
hp.moved()
check(not hp.notice.isHidden() and "these dates are of the previous place" in hp.notice.text() and "Updating" in hp.notice.text()
      and hp.move_timer.isActive() and len(hp.ticks) == 9, f"the map moved to another tile: said at once ({hp.notice.text()})")
hp.move_timer.stop()
hp.follow.setChecked(False)
hp.moved()
check("Follow the map is off" in hp.notice.text() and not hp.move_timer.isActive(), "with Follow the map off: said, and how to update")
dock.zoom_to(*PARIS)
hp.moved()
check(hp.notice.isHidden(), "back at the place of the dates: no notice")
dock.zoom_to(20, 10, 3)
hp.moved()
wide_first = hp.notice.text()
check(hp.refresh(wait=True) and len(hp.ticks) == 1 and "Zoom in to see the capture dates" in hp.notice.text() == wide_first
      and "from zoom 10 on (about 1:" in hp.notice.text() and "the map is at zoom 3" in hp.notice.text()
      and "newest release" in hp.notice.text() and hp.current_label.text().startswith("latest"),
      f"a view too wide for capture dates: said, with the zoom needed ({hp.notice.text()[:110]}...)")
dock.zoom_to(*PARIS)
check(hp.refresh(wait=True) and len(hp.ticks) == 9 and hp.notice.isHidden() and len(hp.layers()) == 9, "zoomed in again: the nine dates, no notice")

# -- the walk and the dates kept between sessions ----------------------------------
store_file = os.path.join(tempfile.mkdtemp(), "sub", "wayback-dates.json")
historical.set_store(store_file)
historical.reset_cache(store=True)
n0 = len(asked)
t1 = historical.list_dates("wayback", *PARIS, fetch=recorded_fetch)
n1 = len(asked) - n0
historical.reset_cache()  # QGIS restarted: the session's lists are gone, the file stays
t2 = historical.list_dates("wayback", *PARIS, fetch=recorded_fetch)
n2 = len(asked) - n0 - n1
historical.set_store(store_file)  # read from the file
historical.reset_cache()
t3 = historical.list_dates("wayback", *PARIS, fetch=recorded_fetch)
n3 = len(asked) - n0 - n1 - n2
with open(store_file, encoding="utf-8") as f:
    kept = json.load(f)
check(n1 > 20 and n2 == 1 and n3 == 1 and [t["label"] for t in t3] == [t["label"] for t in t1] == labels_h
      and t3[0]["detail"] == t1[0]["detail"] and len(kept["walks"]) == 1 and len(kept["dates"]) == 1,
      f"a place listed before costs one request, the catalog ({n1} the first time, then {n2}, then {n3} from the file)")
historical.set_store(None)
historical.reset_cache(store=True)
order = historical.dating_order(releases[:30], releases[10]["releaseMs"])
check([o["releaseNum"] for o in order[:3]] == [releases[i]["releaseNum"] for i in (10, 9, 11)] and len(order) == 30
      and historical.dating_order(releases[:5]) == releases[:5],
      "the releases are dated from the date asked for outward (its release, the next, the one before); the newest first without one")


def run_ts(lib_file, script, *args):
    """A function of the app's TypeScript run by Node, or None without Node."""
    path = os.path.join(here_dir, "..", "lib", lib_file)
    if not node or not os.path.exists(path):
        return None
    try:
        out = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "-e",
                              f"import(process.argv[1]).then(m => console.log(JSON.stringify({script})))",
                              "file:///" + os.path.abspath(path).replace("\\", "/"), *[json.dumps(a) for a in args]],
                             capture_output=True, text=True, timeout=60)
        return json.loads(out.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


# -- Planet, NASA HLS: the dates and the tiles as the app's ---------------------------
pm, pq = historical.planet_ticks("monthly", "k", NOW), historical.planet_ticks("quarterly", "k", NOW)
check(len(pm) == 81 and pm[0]["ref"] == "global_monthly_2020_01_mosaic" and pm[-1]["ref"] == "global_monthly_2026_09_mosaic"
      and pm[0]["dateMs"] == historical.utc_ms(2020, 1, 2)
      and historical.tick_ranges(pm)[0] == (historical.utc_ms(2020, 1), historical.utc_ms(2020, 2))
      and pm[0]["url"] == "https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2020_01_mosaic/gmap/{z}/{x}/{y}.png?api_key=k",
      f"Planet monthly: {len(pm)} mosaics, 2020-01 to two months back, each standing for its month")
check(len(pq) == 43 and pq[0]["ref"] == "global_quarterly_2016q1_mosaic" and pq[-1]["ref"] == "global_quarterly_2026q3_mosaic"
      and pq[-1]["label"] == "2026 Q3" and historical.tick_ranges(pq)[-1] == (historical.utc_ms(2026, 7), historical.utc_ms(2026, 10)),
      f"Planet quarterly: {len(pq)} mosaics, 2016 Q1 to the last quarter ended two months ago")
app_planet = run_ts("planet.ts", "m.planetMonthlyTicks(+process.argv[2]).map(t => [t.dateMs, t.label, m.planetTileUrl(t.dateMs, 'k')])", NOW)
if app_planet is None:
    print("  skip Planet against lib/planet.ts: no Node")
else:
    check(app_planet == [[t["dateMs"], t["label"], t["url"]] for t in pm], "Planet monthly: the app's ticks and tile addresses (lib/planet.ts, run by Node)")
hl = historical.hls_ticks(NOW)
check(len(hl) == 131 and hl[0]["label"] == "2016-01" and hl[-1]["label"] == "2026-11" and not hl[0]["real"]
      and historical.tick_ranges(hl)[0] == (historical.utc_ms(2015, 12, 19), historical.utc_ms(2016, 1, 19))
      and all(a[1] == b[0] for a, b in zip(historical.tick_ranges(hl), historical.tick_ranges(hl)[1:])),
      f"NASA HLS: a monthly cadence from 2016 ({len(hl)} dates), each standing for the 30 days of its mosaic")
app_hls = run_ts("hls.ts", "[m.hlsTileUrl(+process.argv[2]), m.syntheticHlsTicks()[0]]", hl[40]["dateMs"])
if app_hls is None:
    print("  skip HLS against lib/hls.ts: no Node")
else:
    check(app_hls[0] == hl[40]["url"] and app_hls[1] == {"dateMs": hl[0]["dateMs"], "label": hl[0]["label"]},
          "HLS: the app's tile address, character for character, and its first tick (lib/hls.ts, run by Node)")
with open(os.path.join(here_dir, "..", "lib", "dated-imagery.ts"), encoding="utf-8") as f:
    app_ids = _re.findall(r'^\s+id: "([a-z0-9-]+)", name:', f.read(), _re.M)
check({"wayback", "hls", "ge-historical", "planet", "eox-s2"} <= {s["id"] for s in historical.SOURCES} and set(app_ids) - {"bing"} <= {s["id"] for s in historical.SOURCES},
      f"every dated source of the app's timeline is a source of the panel ({app_ids}; Bing is a Basemap source)")

# -- Planet in the panel: the key, never shown ----------------------------------------
KEY = "pl-test-0123456789abcdef"
i_p, i_q = hp.source.findData("dated:planet"), hp.source.findData("dated:planet-quarterly")
check(not (hp.source.model().item(i_p).flags() & Qt.ItemFlag.ItemIsEnabled) and "needs a Planet key" in hp.source.itemText(i_p)
      and "needs a Planet key" in historical.unavailable("planet", {}, None) and not hp.keys_section.is_open(),
      "Planet without a key: greyed out in the select, with the reason; the key under a folded \"API keys\"")
hp.keys["planetKey"].setText(KEY)
hp.keys_changed()
check(bool(hp.source.model().item(i_p).flags() & Qt.ItemFlag.ItemIsEnabled) and hp.source.itemText(i_p) == "Planet monthly basemaps"
      and _Settings().value("terrain_viewer/planetKey") == KEY and hp.keys["planetKey"].echoMode() == hp.keys["planetKey"].EchoMode.Password
      and "planetKey" not in dock.keys and "planetKey" not in dock.common_params(),
      "a Planet key typed: kept in QGIS's settings, the source offered; it is no key of the Terrain mode (never sent to a tile service)")
planet_asked = []


def planet_fetch(url):
    planet_asked.append(url)
    return b"\x89PNG"


historical.reset_cache()
hp.fetch = planet_fetch
hp.source.setCurrentIndex(i_p)
settle()
lay_p = hp.layers()
first_p = lay_p.get("planet:global_monthly_2020_01_mosaic")
rp = first_p.temporalProperties().fixedTemporalRange() if first_p is not None else None
check(first_p is not None and len(lay_p) == len(historical.planet_ticks("monthly", KEY)) > 80
      and f"global_monthly_2020_01_mosaic/gmap/{{z}}/{{x}}/{{y}}.png?api_key={KEY}" in _unquote(first_p.source())
      and first_p.name() == "2020-01 · Planet monthly" and iso(rp.begin()) == "2020-01-01T00:00:00Z" and iso(rp.end()) == "2020-02-01T00:00:00Z"
      and not hp.group().isExpanded(),
      f"Planet monthly: one layer per mosaic ({len(lay_p)}), its tiles with the key, its range the month, the group folded")
check(len(planet_asked) == 1 and planet_asked[0].endswith(f"/gmap/0/0/0.png?api_key={KEY}"),
      "the key is checked with one world tile of the newest mosaic, once a session")
said = " ".join([hp.status.text(), hp.notice.text(), hp.origin.text(), hp.detail.text(), hp.current_label.text(), hp.group().name()]
                + dock.warnings + [lyr.name() for lyr in lay_p.values()] + [hp.source.itemText(i) for i in range(hp.source.count())]
                + [str(hp.source.itemData(i, Qt.ItemDataRole.ToolTipRole)) for i in range(hp.source.count())]
                + list(lay_p) + [historical.place_key("planet", 0, 0, 0, {"planetKey": KEY})])
check(KEY not in said and len(said) > 2000, "the key is in no text of the panel, no layer name, no warning, no cache name")


def refused_fetch(url):
    e = OSError(f"HTTP Error 401: Unauthorized ({url})")
    e.code = 401
    raise e


historical.reset_cache()
hp.fetch = refused_fetch
hp.refresh(force=True)
settle()
check("Planet refused the key (HTTP 401)" in hp.status.text() and KEY not in hp.status.text() + dock.warnings[-1]
      and historical.scrub(f"https://x/0.png?api_key={KEY}&a=1") == "https://x/0.png?api_key=...&a=1",
      f"a key Planet refuses: said in the panel, without the key ({hp.status.text()[:70]}...)")
historical.reset_cache()
hp.fetch = planet_fetch
hp.source.setCurrentIndex(i_q)
settle()
check(len(hp.layers()) == len(historical.planet_ticks("quarterly", KEY)) > 40 and "planet-quarterly:global_quarterly_2016q1_mosaic" in hp.layers()
      and hp.current_label.text().endswith(("Q1", "Q2", "Q3", "Q4")) and "quarterly" in hp.group().name(),
      f"Planet quarterly: one layer per quarter ({len(hp.layers())}), the monthly layers gone")
hp.keys["planetKey"].setText("")
hp.keys_changed()
check(not hp.layers() and "needs a Planet key" in hp.status.text() and not _Settings().value("terrain_viewer/planetKey"),
      "the key removed: the Planet layers go, the status says what is missing")
_Settings().remove("terrain_viewer/planetKey")

# -- NASA HLS in the panel ------------------------------------------------------------
n_asked = len(asked)
hp.fetch = recorded_fetch
hp.source.setCurrentIndex(hp.source.findData("dated:hls"))
lay_h = hp.layers()
newest_h = lay_h[max(lay_h)]
check(len(lay_h) == len(historical.hls_ticks()) > 130 and len(asked) == n_asked and hp.job is None
      and "openveda.cloud/api/titiler-cmr/rasterio/tiles/WebMercatorQuad/{z}/{x}/{y}?collection_concept_id=" in _unquote(newest_h.source())
      and "rescale=0,3000&rescale=0,3000&rescale=0,3000" in _unquote(_unquote(newest_h.source())).replace("%2C", ",")
      and newest_h.name().endswith("· NASA HLS") and len(hp.dates) == len(lay_h),
      f"NASA HLS: one layer per month ({len(lay_h)}), no request, the provider's tile address")

# -- Google Earth historical, through a tile service ------------------------------------
with open(os.path.join(here_dir, "fixtures", "ge_dates_paris.json"), encoding="utf-8") as f:
    ge = json.load(f)
gt = historical.parse_ge_dates(json.dumps(ge["answer"]).encode("utf-8"), ge["service"])
check(len(gt) == len(ge["answer"]["dates"]) > 30 and gt[0]["label"] == "1943-12-31" and gt[0]["dateMs"] < 0
      and historical.day_label(gt[0]["dateMs"]) == "1943-12-31" and gt == sorted(gt, key=lambda t: t["dateMs"])
      and gt[-1]["url"] == f"http://tiles.test/basemap-tiles/ge-historical/{{z}}/{{x}}/{{y}}.jpg?imageryDate={gt[-1]['label']}"
      and "Airbus" in gt[-1]["detail"] and "level 16" in gt[-1]["detail"],
      f"Google Earth's dates as a tile service answers them (recorded): {len(gt)} captures from {gt[0]['label']} to {gt[-1]['label']}, "
      "each with its tile address and who took it")
check(historical.ge_level(15) == 16 and historical.ge_dates_url("http://tiles.test", PARIS[0], PARIS[1], 16) == ge["url"]
      and historical.keyhole_tile(48.8584, 2.2945, 1) == (1, 1)
      and historical.place_key("ge-historical", *PARIS, service="http://a") != historical.place_key("ge-historical", *PARIS, service="http://b")
      and historical.place_key("ge-historical", *PARIS, service="http://a") != historical.place_key("ge-historical", PARIS[0], PARIS[1], 16, service="http://a"),
      "the dates are asked at the Keyhole level of the tiles QGIS draws (the app's zoom + 1), per node and per service")
i_g = hp.source.findData("dated:ge-historical")
check(bool(hp.source.model().item(i_g).flags() & Qt.ItemFlag.ItemIsEnabled) and "needs a tile server backend" in hp.source.itemText(i_g)
      and "Connect" in str(hp.source.itemData(i_g, Qt.ItemDataRole.ToolTipRole)) and hp.service() is None,
      "Google Earth historical without a tile server backend: named so, and still to pick (the backend control comes with it)")
# 0.11.0: the backend control on the Historical page while a source needs it.
backend_before = dock.backend
hp.source.setCurrentIndex(i_g)
spin(50)
check(hp.needs_backend() and hp.backend_slot.indexOf(dock.backend_box) == 0 and dock.terrain_layout.indexOf(dock.backend_box) < 0
      and not dock.backend_box.isHidden() and dock.backend_picker.parent() is dock.backend_box and dock.status.parent() is dock.backend_box
      and "Pick Packaged tile server or Remote tile server below" in hp.origin.text() and not hp.layers()
      and "needs a tile server backend" in hp.status.text(),
      "Google Earth historical picked with no tile server: the panel's backend control (radio buttons, options, status) "
      "is on the Historical page, the very widget of the Terrain page")
dock.backend_picker.set("remote", emit=False)
dock.set_backend("remote", connect=False)
check(dock.backend == "remote" and _Settings().value("terrain_viewer/backend") == "remote" and dock.pages.currentWidget() is dock.page_of["remote"],
      "a backend picked there is the panel's one backend (one setting)")
dock.set_mode("terrain")
spin(20)
check(dock.terrain_layout.indexOf(dock.backend_box) == 0 and dock.backend_picker.current() == "remote" and not dock.backend_box.isHidden(),
      "back on the Terrain page: the same control, at its top, with the backend picked on the Historical page")
dock.set_mode("historical")
spin(20)
check(hp.backend_slot.indexOf(dock.backend_box) == 0, "and on the Historical page again with Google Earth still picked")
hp.source.setCurrentIndex(hp.source.findData("dated:eox-s2"))
spin(20)
check(dock.terrain_layout.indexOf(dock.backend_box) == 0 and "EOX Sentinel-2 needs no backend" in hp.origin.text(),
      "a source that needs no backend: the control leaves the page, and the line says so")
dock.set_backend(backend_before, connect=False)
hp.source.setCurrentIndex(hp.source.findData("dated:wayback"))
settle()
ge_asked = []


def ge_fetch(url):
    ge_asked.append(url)
    if url.startswith("http://tiles.test/imagery-dates/ge-historical?lat=48.858") and url.endswith("&zoom=16"):
        return json.dumps(ge["answer"]).encode("utf-8")
    raise OSError("not recorded: " + url)


dock.base = ge["service"]
dock.connected = "remote"  # a tile service connected (the Terrain mode's Connect)
spin(80)
check(bool(hp.source.model().item(i_g).flags() & Qt.ItemFlag.ItemIsEnabled) and hp.source.itemText(i_g) == "Google Earth historical"
      and hp.service() == "http://tiles.test", "a tile server backend connected: Google Earth historical is offered")
historical.reset_cache()
hp.fetch = ge_fetch
hp.target_ms = None
hp.source.setCurrentIndex(i_g)
settle()
lay_g = hp.layers()
old_g = lay_g.get("ge-historical:1943-12-31")
rg = old_g.temporalProperties().fixedTemporalRange() if old_g is not None else None
check(old_g is not None and len(lay_g) == len(gt) and len(ge_asked) == 1 and old_g.name() == "1943-12-31 · Google Earth"
      and "http://tiles.test/basemap-tiles/ge-historical/{z}/{x}/{y}.jpg?imageryDate=1943-12-31" in _unquote(old_g.source())
      and iso(rg.begin()) == "1943-12-31T00:00:00Z" and hp.current_label.text() == gt[-1]["label"]
      and "tile server backend at http://tiles.test" in hp.origin.text(),
      f"Google Earth historical: {len(lay_g)} dated layers, their tiles the tile service's, from one request ({hp.origin.text()[:50]}...)")


def old_service(url):
    e = OSError("HTTP Error 404: Not Found")
    e.code = 404
    raise e


historical.reset_cache()
hp.fetch = old_service
hp.refresh(force=True)
settle()
check("older than 2026-11-26" in hp.status.text() and "/imagery-dates" in hp.status.text(),
      f"a tile service without the endpoint (an older one): said ({hp.status.text()[:80]}...)")
dock.connected = None
spin(80)
check(not hp.layers() and "needs a tile server backend" in hp.status.text() and "below and Connect" in hp.origin.text()
      and hp.backend_slot.indexOf(dock.backend_box) == 0,
      "the tile service gone: the Google Earth layers go, the panel says what is needed, the backend control at hand")
dock.base = None
historical.reset_cache()
hp.fetch = recorded_fetch
hp.source.setCurrentIndex(hp.source.findData("dated:wayback"))
settle()
check(len(hp.layers()) == 9 and all(k.startswith("wayback:") for k in hp.layers()) and not missed, "Esri Wayback again: its nine dates")

# -- a second toolbar button, straight to the Historical mode ---------------------------
from iconem_terrain_viewer.plugin import TerrainViewerPlugin  # noqa: E402
tools, menus = [], []


class FakeIface:
    def __init__(self):
        self.canvas = _Canvas()

    def mainWindow(self):
        return win

    def mapCanvas(self):
        return self.canvas

    def messageBar(self):
        return None

    def addWebToolBarIcon(self, a):
        tools.append(a)

    def removeWebToolBarIcon(self, a):
        tools.remove(a)

    def addPluginToWebMenu(self, name, a):
        menus.append((name, a))

    def removePluginWebMenu(self, name, a):
        menus.remove((name, a))

    def addDockWidget(self, area, d):
        win.addDockWidget(area, d)

    def removeDockWidget(self, d):
        win.removeDockWidget(d)


_Settings().setValue("terrain_viewer/appMode", "terrain")
_Settings().setValue("terrain_viewer/checkUpdates", "false")
plug = TerrainViewerPlugin(FakeIface())
plug.initGui()
check(len(tools) == 2 and len(menus) == 2 and tools[1].objectName() == "terrainViewerHistorical" and not tools[1].icon().isNull()
      and not tools[1].isCheckable() and "istorical" in tools[1].text() and tools[0].isCheckable(),
      "two buttons on the Web toolbar: Terrain Viewer, and a clock for the Historical mode")
tools[1].trigger()
plug.dock.historical.paused = True  # the test asks Esri nothing
spin(100)
check(plug.dock is not None and plug.dock.mode == "historical" and not plug.dock.isHidden() and not plug.dock.historical.isHidden()
      and plug.dock.terrain_page.isHidden() and plug.action.isChecked(), "the clock opens the panel in its Historical mode")
plug.dock.set_mode("terrain")
plug.dock.hide()
spin(50)
tools[1].trigger()
plug.dock.historical.paused = True
spin(100)
check(plug.dock.mode == "historical" and not plug.dock.isHidden(), "and again when the panel was closed in the Terrain mode")
plug.unload()
check(not tools and not menus and plug.dock is None, "unloading the plugin removes both buttons")
_Settings().remove("terrain_viewer/checkUpdates")
_Settings().setValue("terrain_viewer/appMode", "historical")
historical.set_store(None)

# -- a QGIS layer as the elevation: its symbology plays no part ---------------------------
from qgis.core import (QgsHillshadeRenderer, QgsSingleBandPseudoColorRenderer, QgsRasterShader, QgsColorRampShader,  # noqa: E402
                       QgsContrastEnhancement, QgsSingleBandGrayRenderer)
from qgis.PyQt.QtGui import QColor as _Color  # noqa: E402
from iconem_terrain_viewer.live.gdal_source import layer_spec, make_dem  # noqa: E402
sym_dir = tempfile.mkdtemp()
sym_path = os.path.join(sym_dir, "heights.tif")
ds = gdal.GetDriverByName("GTiff").Create(sym_path, 64, 64, 1, gdal.GDT_Float32)
ds.SetGeoTransform((700000, 40, 0, 5800000, 0, -40))
ds.SetProjection(QgsCoordinateReferenceSystem("EPSG:3857").toWkt())
raw = (1500 + np.add.outer(np.arange(64) * 7.5, np.arange(64) * 3.25)).astype(np.float32)
ds.GetRasterBand(1).WriteArray(raw)
ds = None
sym_layer = QgsRasterLayer(sym_path, "heights")
QgsProject.instance().addMapLayer(sym_layer, False)
tz = 13
n_t = 2 ** tz
tx, ty = int((701280 + 20037508.342789244) / (2 * 20037508.342789244) * n_t), int((20037508.342789244 - 5798720) / (2 * 20037508.342789244) * n_t)


def read_heights():
    spec = layer_spec(sym_layer)
    return spec, np.array(make_dem(spec).tile(tz, tx, ty), dtype=np.float32)


spec0, plain = read_heights()
prov = sym_layer.dataProvider()
sym_layer.setRenderer(QgsHillshadeRenderer(prov, 1, 315, 45))
spec1, shaded = read_heights()
ramp_shader = QgsColorRampShader(1500, 2200)
ramp_shader.setColorRampItemList([QgsColorRampShader.ColorRampItem(1500, _Color("#000080")), QgsColorRampShader.ColorRampItem(2200, _Color("#ff0000"))])
shader = QgsRasterShader()
shader.setRasterShaderFunction(ramp_shader)
sym_layer.setRenderer(QgsSingleBandPseudoColorRenderer(prov, 1, shader))
spec2, ramped = read_heights()
gray = QgsSingleBandGrayRenderer(prov, 1)
stretch = QgsContrastEnhancement(prov.dataType(1))
stretch.setContrastEnhancementAlgorithm(QgsContrastEnhancement.ContrastEnhancementAlgorithm.StretchToMinimumMaximum)
stretch.setMinimumValue(1600)
stretch.setMaximumValue(1700)
gray.setContrastEnhancement(stretch)
sym_layer.setRenderer(gray)
sym_layer.renderer().setOpacity(0.3)
spec3, stretched = read_heights()
finite = plain[np.isfinite(plain)]
check(finite.size > 100 and float(finite.min()) >= 1500 and float(finite.max()) <= float(raw.max()) and float(finite.max()) > 1700,
      f"a QGIS raster layer as the elevation: the Python backend reads its raw values through GDAL ({finite.min():.0f} to {finite.max():.0f} m)")
check(all(np.array_equal(plain, other, equal_nan=True) for other in (shaded, ramped, stretched)) and spec0 == spec1 == spec2 == spec3
      and spec0.get("gdal") == sym_path and "renderer" not in json.dumps(spec0, default=str).lower(),
      "the same elevations whatever the layer's symbology: a hillshade renderer, a color ramp, a grey stretch at 30% opacity")
QgsProject.instance().removeMapLayer(sym_layer.id())
