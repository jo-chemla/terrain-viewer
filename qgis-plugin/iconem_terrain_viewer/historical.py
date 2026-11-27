"""The dated imagery of the app's historical mode, with no QGIS import: for
each source, the dates at a place and the XYZ tiles of a date. A port of the
entries of lib/dated-imagery.ts:

- Esri World Imagery Wayback (lib/wayback.ts): the release catalog, the walk
  of the releases that have their own imagery at a tile (tilemap), then each
  one's real capture date at the place (the metadata layers), one tick per
  capture date. The walk and the dates found are kept between sessions.
- Google Earth historical (lib/ge-historical.ts): its dates and its tiles
  come from a tile service (/imagery-dates/ge-historical and
  /basemap-tiles/ge-historical, reprojected to Web Mercator there); without
  a tile service connected the source is unavailable.
- Planet global basemaps, monthly (lib/planet.ts) and quarterly: computed
  ticks, tiles with the user's Planet key.
- NASA HLS (lib/hls.ts): a monthly cadence, composed by titiler-cmr.
- EOX Sentinel-2 cloudless (lib/eox-s2-cloudless.ts): one mosaic per year.

Left out, each for a reason (LEFT_OUT). But for Google Earth, the tiles are
the providers' own XYZ addresses, read by QGIS under every backend.

  list_dates("wayback", lat, lng, zoom, fetch=..., report=...) -> [tick]
  tick: {"dateMs", "label", "ref", "url", "maxzoom", "detail", "real",
         "startMs"?, "endMs"?}

Every request goes through `fetch(url) -> bytes` (urllib by default), called
from worker threads, never from the UI thread. A key (Planet's) is never
put in a message: scrub() takes it out of anything shown."""
import hashlib
import json
import math
import os
import re
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, quote

USER_AGENT = "terrain-viewer-qgis/0.11"
DAY_MS = 86400000
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

WAYBACK_CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json"
WAYBACK_SERVICE = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer"
WAYBACK_MAXZOOM = 19
# The walk starts this many chains across the catalog (lib/wayback.ts).
WALK_CHAINS = 8
META_WORKERS = 6
# The metadata layers: one per level, 23 (layer 0) down to 10 (layer 13).
META_MAX_LEVEL, META_MIN_LEVEL = 23, 10
# Wayback's capture dates are read at the map's centre from this zoom on (the
# app's zoom, 512 px tiles): a wider view has no one date, and up to z11 every
# release counts (some 200 layers). Below it, the newest release alone.
MIN_PLACE_ZOOM = 9.5

# Google Earth historical, through a tile service (tile-server/ge-historical.mjs).
GE_MAXZOOM = 21
GE_MAX_LEVEL = 23

# Planet's global basemaps (lib/planet.ts): the monthly ones from 2020-01,
# published some weeks after the month ends (two months back, as the app);
# the quarterly ones from 2016.
PLANET_TILES = "https://tiles.planet.com/basemaps/v1/planet-tiles"
PLANET_MAXZOOM = 15
PLANET_LAG_MONTHS = 2
PLANET_MONTHLY_START = (2020, 1)
PLANET_QUARTERLY_START = (2016, 1)

# NASA HLS (lib/hls.ts): true-color mosaics composed on request by the public
# titiler-cmr demonstration server from the granules within 15 days of a date.
HLS_BASE = "https://openveda.cloud/api/titiler-cmr"
HLS_COLLECTION = "C2021957295-LPCLOUD"
HLS_WINDOW_DAYS = 15
HLS_START = (2016, 1)
HLS_MAXZOOM = 16

EOX_BASE = "https://tiles.maps.eox.at/wmts/1.0.0"
EOX_MAXZOOM = 14
# The years EOX publishes, read from its WMTS capabilities (2026-11-26):
# every year from 2016, the first mosaic under the bare name "s2cloudless".
EOX_YEARS = (2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025)

# id, name, short name, whether the dates depend on the place, what the dates
# are; "key": the key the tiles need; "service": listed and drawn by a tile
# service.
SOURCES = (
    {"id": "wayback", "name": "Esri World Imagery Wayback", "short": "Esri Wayback", "per_place": True,
     "maxzoom": WAYBACK_MAXZOOM,
     "about": "Every archived release of Esri World Imagery since 2014; the dates are the real capture dates at the "
              "map's centre, one per distinct capture."},
    {"id": "ge-historical", "name": "Google Earth historical", "short": "Google Earth", "per_place": True,
     "maxzoom": GE_MAXZOOM, "service": True,
     "about": "Every dated capture Google Earth holds at the map's centre. Listed and drawn through a tile server "
              "backend, which reads Google Earth's own tiles and reprojects them to Web Mercator."},
    {"id": "planet", "name": "Planet monthly basemaps", "short": "Planet monthly", "per_place": False,
     "maxzoom": PLANET_MAXZOOM, "key": "planetKey",
     "about": "Planet's global monthly mosaics, from 2020, two months behind; needs a Planet key (every tile counts "
              "against its quota)."},
    {"id": "planet-quarterly", "name": "Planet quarterly basemaps", "short": "Planet quarterly", "per_place": False,
     "maxzoom": PLANET_MAXZOOM, "key": "planetKey",
     "about": "Planet's global quarterly mosaics, from 2016; needs a Planet key whose plan includes them."},
    {"id": "hls", "name": "NASA Harmonized Landsat Sentinel-2", "short": "NASA HLS", "per_place": False,
     "maxzoom": HLS_MAXZOOM,
     "about": "Monthly true-color mosaics of HLS (30 m), each the granules within 15 days of the date, composed on "
              "request by a public demonstration server (slow, sometimes down). A monthly cadence, not captures "
              "found at the place."},
    {"id": "eox-s2", "name": "EOX Sentinel-2 cloudless", "short": "EOX Sentinel-2", "per_place": False,
     "maxzoom": EOX_MAXZOOM,
     "about": "EOX's yearly cloudless Sentinel-2 mosaics (10 m), one per published year, the same everywhere."},
)
# The keys of the dated sources (QGIS settings terrain_viewer/<name>), with their label.
KEYS = (("planetKey", "Planet"),)
# The app's other dated sources, and why this panel does not list them yet.
LEFT_OUT = {
    "bing": "Bing Aerial: one current mosaic, no series (it is one of the Basemap row's sources)",
    "catalogs": "The national series and the STAC catalogs (lib/national-dated.ts, lib/stac-dated.ts): not ported yet",
}


class HistoricalError(Exception):
    pass


def source(sid):
    return next((s for s in SOURCES if s["id"] == sid), None)


def scrub(text):
    """A message without any key in it (an address quoted by an error)."""
    return re.sub(r"((?:api_key|key|token)=)[^&\s\"'<>]+", r"\1...", str(text), flags=re.I)


def unavailable(sid, keys=None, service=None):
    """Why a source cannot be used now, or None: a key the panel does not
    hold, no tile service connected."""
    s = source(sid)
    if s is None:
        return "not a source of this panel"
    if s.get("key") and not (keys or {}).get(s["key"]):
        return "needs a Planet key (API keys, below)"
    if s.get("service") and not service:
        return "needs a tile server backend (Packaged or Remote tile server: pick one and Connect)"
    return None


def fetch_url(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def utc_ms(year, month=1, day=1):
    return int((datetime(year, month, day, tzinfo=timezone.utc) - EPOCH).total_seconds() * 1000)


def ymd(ms):
    """(year, month, day) of a date in milliseconds, UTC (a date before 1970
    too: Google Earth holds photographs of the 1940s)."""
    d = EPOCH + timedelta(milliseconds=ms)
    return d.year, d.month, d.day


def day_label(ms):
    return "%04d-%02d-%02d" % ymd(ms)


def iso(ms):
    """A moment as JavaScript's toISOString writes it."""
    d = EPOCH + timedelta(milliseconds=ms)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)


def add_months(year, month, by):
    m = year * 12 + (month - 1) + by
    return m // 12, m % 12 + 1


# -- the place ---------------------------------------------------------------
def quantize(lat, lng, zoom):
    """The place snapped to a quarter of the tile that covers it (the app's
    quantizeLocation): imagery metadata at the view's centre cannot change
    within that, so a small pan asks nothing again."""
    level = int(round(zoom))
    step = 360.0 / (2 ** level) / 4
    return round(lat / step) * step, round(lng / step) * step, level


def tile_of(lat, lng, level):
    """(column, row) of the tile holding a point (wayback-core's long2tile, lat2tile)."""
    n = 2 ** level
    lat = max(-85.0511, min(85.0511, lat))
    col = int(math.floor((lng + 180.0) / 360.0 * n))
    row = int(math.floor((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n))
    return max(0, min(n - 1, col)), max(0, min(n - 1, row))


def wayback_level(zoom):
    """The tile level asked about: the app's zoom rounded (as lib/wayback.ts),
    within what Wayback serves."""
    return max(1, min(WAYBACK_MAXZOOM, int(round(zoom))))


def ge_level(zoom):
    """The Keyhole level of the tiles QGIS draws at the app's zoom: its XYZ
    provider asks 256 px tiles one level finer than the app's 512 px zoom
    (the app's geKeyholeLevelForZoom), and a Mercator tile of level z is
    built from Keyhole level z."""
    return max(1, min(GE_MAX_LEVEL, int(round(zoom)) + 1))


def keyhole_tile(lat, lng, level):
    """(column, row) of Google Earth's tile holding a point: a plate carrée
    grid of 360 / 2^level degrees a side, rows counted northward."""
    n = 2 ** level
    return (max(0, min(n - 1, int(math.floor((lng + 180.0) / 360.0 * n)))),
            max(0, min(n - 1, int(math.floor((lat + 180.0) / 360.0 * n)))))


def key_tag(key):
    """A key as a short tag for a cache name: never the key itself."""
    return hashlib.sha1(str(key).encode("utf-8")).hexdigest()[:8] if key else "nokey"


def place_key(sid, lat, lng, zoom, keys=None, service=None):
    """What a source's list of dates depends on: nothing for a source that is
    the same everywhere (its key for Planet), the tile at the centre for
    Wayback, Google Earth's node and the service asked for Google Earth."""
    s = source(sid)
    if s is None:
        return sid
    if s.get("key"):
        return f"{sid}:{key_tag((keys or {}).get(s['key']))}"
    if not s["per_place"]:
        return sid
    if sid == "ge-historical":
        level = ge_level(zoom)
        col, row = keyhole_tile(lat, lng, level)
        return f"{sid}:{service or ''}:{level}/{col}/{row}"
    if zoom < MIN_PLACE_ZOOM:
        return f"{sid}:latest"
    qlat, qlng, _ = quantize(lat, lng, zoom)
    level = wayback_level(zoom)
    col, row = tile_of(qlat, qlng, level)
    return f"{sid}:{level}/{col}/{row}:{qlat:.5f},{qlng:.5f}"


def too_wide(sid, zoom):
    """True when the view is too wide for a per-place source to have dates of
    its own (Esri Wayback below MIN_PLACE_ZOOM: the newest release alone)."""
    return sid == "wayback" and zoom < MIN_PLACE_ZOOM


# -- what was found, kept between sessions -------------------------------------
# A release's imagery date at a place never changes, and a walk only ages
# when a new release comes out (lib/wayback.ts keeps the same in the
# browser's localStorage): {"walks": {tile: [newest release when walked,
# kept releases...]}, "dates": {place: {release: meta}}}. The most recent
# 300 places of each.
STORE_MAX_PLACES = 300
_store = {"walks": {}, "dates": {}}
_store_path = None
_store_lock = threading.Lock()


def set_store(path):
    """The file the walks and dates are kept in (None: this session only)."""
    global _store, _store_path
    with _store_lock:
        _store_path = path
        _store = {"walks": {}, "dates": {}}
        if path and os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data.get("walks"), dict) and isinstance(data.get("dates"), dict):
                    _store = {"walks": data["walks"], "dates": data["dates"]}
            except (OSError, ValueError, AttributeError):
                pass  # unreadable: starts empty


def save_store():
    with _store_lock:
        if not _store_path:
            return
        for part in _store.values():
            for k in list(part)[:max(0, len(part) - STORE_MAX_PLACES)]:
                del part[k]
        try:
            os.makedirs(os.path.dirname(_store_path), exist_ok=True)
            tmp = f"{_store_path}.{os.getpid()}.part"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(_store, f, separators=(",", ":"))
            os.replace(tmp, _store_path)
        except OSError:
            pass  # this session's memory still has it


def _remember(part, key, value):
    with _store_lock:
        _store[part].pop(key, None)  # the newest last
        _store[part][key] = value


# -- Esri Wayback -------------------------------------------------------------
_catalog = None
_catalog_lock = threading.Lock()


def parse_wayback_config(data):
    """The releases of waybackconfig.json, newest first: {"releaseNum",
    "releaseLabel" (YYYY-MM-DD, from the item's title), "releaseMs",
    "itemURL", "metadataLayerUrl"}."""
    cfg = json.loads(data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else data)
    items = []
    for key, item in cfg.items():
        if not str(key).isdigit() or not isinstance(item, dict):
            continue
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(item.get("itemTitle", "")))
        if not m or not item.get("itemURL") or not item.get("metadataLayerUrl"):
            continue
        items.append({"releaseNum": int(key), "releaseLabel": m.group(0),
                      "releaseMs": utc_ms(int(m.group(1)), int(m.group(2)), int(m.group(3))),
                      "itemURL": item["itemURL"], "metadataLayerUrl": item["metadataLayerUrl"]})
    items.sort(key=lambda it: (it["releaseMs"], it["releaseNum"]), reverse=True)
    return items


def wayback_catalog(fetch=fetch_url):
    """The release catalog, read once per session (a worldwide, slowly
    changing list)."""
    global _catalog
    with _catalog_lock:
        if _catalog is None:
            items = parse_wayback_config(fetch(WAYBACK_CONFIG))
            if not items:
                raise HistoricalError("Esri Wayback's catalog lists no release")
            _catalog = items
        return _catalog


def reset_cache(store=False):
    """Forget the session's lists (and, with `store`, what is kept between
    sessions: the tests)."""
    global _catalog
    with _catalog_lock:
        _catalog = None
    with _lists_lock:
        _lists.clear()
    _planet_checked.clear()
    if store:
        with _store_lock:
            _store["walks"].clear()
            _store["dates"].clear()


def wayback_tile_url(item):
    """A release's tiles as an XYZ template (its WMTS address names level,
    row and col)."""
    return item["itemURL"].replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}")


def distinct_releases(found, level):
    """Consecutive releases whose tile has the same size count as one image,
    kept at its oldest (the SDK's size heuristic; up to z11 all are kept)."""
    if level <= 11:
        return [f[0] for f in found]
    out = []
    for i, (num, size) in enumerate(found):
        if i > 0 and size == found[i - 1][1]:
            out[-1] = num
        else:
            out.append(num)
    return out


def wayback_walk(catalog, level, row, col, fetch=fetch_url, cancelled=None):
    """The releases with their own imagery at a tile, newest first: of some
    200 releases, the 10 to 30 where the imagery changed here. Each tilemap
    answer names the release holding the asked release's imagery, so the
    next one to ask is the one after it; several chains started across the
    catalog cover it in a fraction of one chain's time, a chain stopping
    where it meets another (lib/wayback.ts startWalk). A walk made while
    the same release was the newest is read from the store, no request."""
    by = {it["releaseNum"]: it for it in catalog}
    tile = f"{level}/{col}/{row}"
    with _store_lock:
        stored = _store["walks"].get(tile)
    if stored and stored[0] == catalog[0]["releaseNum"]:
        return [by[n] for n in stored[1:] if n in by]
    index_of = {it["releaseNum"]: i for i, it in enumerate(catalog)}
    answers, asked, found = {}, set(), set()
    lock = threading.Lock()

    def walk_from(start):
        i = start
        while i < len(catalog):
            if cancelled is not None and cancelled():
                return
            asking = catalog[i]["releaseNum"]
            with lock:
                if asking in asked:
                    return
                asked.add(asking)
            j = json.loads(fetch(f"{WAYBACK_SERVICE}/tilemap/{asking}/{level}/{row}/{col}").decode("utf-8"))
            answer = None
            if (j.get("data") or [0])[0]:
                select = (j.get("select") or [0])[0]
                answer = (int(select) if select else asking, (j.get("size") or [0])[0])
            with lock:
                answers[asking] = answer
                reached = answer is not None and answer[0] in found
                if answer is not None:
                    found.add(answer[0])
            at = index_of.get(answer[0]) if answer is not None else None
            if reached or at is None or at < i:
                return
            i = at + 1

    starts = sorted({(n * len(catalog)) // WALK_CHAINS for n in range(WALK_CHAINS)})
    with ThreadPoolExecutor(max_workers=len(starts)) as pool:
        for f in [pool.submit(walk_from, s) for s in starts]:
            f.result()
    if cancelled is not None and cancelled():
        return []
    chain, i = [], 0
    while i < len(catalog):
        answer = answers.get(catalog[i]["releaseNum"])
        if not answer:
            break
        chain.append(answer)
        at = index_of.get(answer[0])
        if at is None or at < i:
            break
        i = at + 1
    kept = [n for n in distinct_releases(chain, level) if n in by]
    _remember("walks", tile, [catalog[0]["releaseNum"]] + kept)
    return [by[n] for n in kept]


def wayback_meta_url(item, lat, lng, level):
    layer = META_MAX_LEVEL - max(META_MIN_LEVEL, min(META_MAX_LEVEL, level))
    query = urlencode({
        "f": "json", "where": "1=1", "outFields": "SRC_DATE2,NICE_DESC,SRC_DESC,SAMP_RES,SRC_ACC",
        "geometry": json.dumps({"spatialReference": {"wkid": 4326}, "x": round(lng, 6), "y": round(lat, 6)},
                               separators=(",", ":")),
        "returnGeometry": "false", "geometryType": "esriGeometryPoint", "spatialRel": "esriSpatialRelIntersects"})
    return f"{item['metadataLayerUrl']}/{layer}/query?{query}"


def wayback_meta(item, lat, lng, zoom, fetch=fetch_url):
    """What a release shows at a point: {"dateMs", "provider", "source",
    "resolution"}, or None. The metadata layers have holes (a record with no
    date at one level, a dated one a level finer): up to three finer levels
    are asked, as the app does."""
    best = None
    levels = []
    for up in range(4):
        lv = max(META_MIN_LEVEL, min(META_MAX_LEVEL, int(round(zoom)) + up))
        if lv not in levels:
            levels.append(lv)
    for lv in levels:
        j = json.loads(fetch(wayback_meta_url(item, lat, lng, lv)).decode("utf-8"))
        if j.get("error"):
            raise HistoricalError(str(j["error"].get("message") or j["error"]))
        feature = (j.get("features") or [None])[0]
        if not feature:
            continue
        a = feature.get("attributes") or {}
        meta = {"dateMs": a.get("SRC_DATE2"), "provider": a.get("NICE_DESC"), "source": a.get("SRC_DESC"),
                "resolution": a.get("SAMP_RES")}
        if meta["dateMs"]:
            return meta
        best = best or meta
    return best


def wayback_ticks(items, metas, final=True):
    """One tick per capture date, oldest first: several releases in a row
    often carry the same imagery at a place, and the newest release of a
    date is kept. `metas`, {releaseNum: meta or None}. While the dates still
    arrive (`final` false) only the releases whose date is known count: a
    release date is not a capture date (at Palmyra the release of 2014 holds
    imagery of 2009). Once final, a release without a date stands at its
    release date, marked "real": False."""
    by_date = {}
    for item in items:  # newest release first
        meta = metas.get(item["releaseNum"])
        date = meta.get("dateMs") if meta else None
        if not date:
            if not final or item["releaseNum"] not in metas:
                continue
        day = int((date or item["releaseMs"]) // DAY_MS) * DAY_MS
        if day in by_date:
            continue
        detail = []
        if meta and (meta.get("provider") or meta.get("source")):
            detail.append(f"{meta.get('provider') or ''} ({meta.get('source')})".strip() if meta.get("source")
                          else str(meta.get("provider")))
        if meta and meta.get("resolution"):
            detail.append(f"{round(float(meta['resolution']), 2):g} m")
        detail.append(f"World Imagery release of {item['releaseLabel']}")
        by_date[day] = {"dateMs": day, "label": day_label(day) + ("" if date else " (release date)"),
                        "ref": str(item["releaseNum"]), "url": wayback_tile_url(item), "maxzoom": WAYBACK_MAXZOOM,
                        "detail": ", ".join(detail), "real": bool(date)}
    return [by_date[d] for d in sorted(by_date)]


def dating_order(items, target_ms=None):
    """The order the releases are dated in: imagery is never newer than its
    release, so the releases that can hold the date asked for are the first
    at or after it and the one before (lib/wayback.ts's priority queue); then
    outward from there. Without a date, the newest first: it is the one
    shown."""
    if not target_ms:
        return list(items)
    asc = sorted(items, key=lambda it: it["releaseMs"])
    after = next((i for i, it in enumerate(asc) if it["releaseMs"] >= target_ms), len(asc) - 1)
    return sorted(items, key=lambda it: abs(asc.index(it) - after - 0.25))


def list_wayback(lat, lng, zoom, fetch=fetch_url, report=None, cancelled=None, target_ms=None):
    """Wayback's capture dates at a place. `report(ticks, note, done, total)`
    is called as the dates arrive (the metadata service answers in 1 to 30 s
    a query); `cancelled()` true stops asking. Dates found at this place
    before (this session or an earlier one) are not asked again."""
    qlat, qlng, _ = quantize(lat, lng, zoom)
    level = wayback_level(zoom)
    col, row = tile_of(qlat, qlng, level)
    stop = cancelled or (lambda: False)
    catalog = wayback_catalog(fetch)
    if zoom < MIN_PLACE_ZOOM:
        newest = catalog[0]
        return [{"dateMs": newest["releaseMs"], "label": f"latest (release of {newest['releaseLabel']})",
                 "ref": "latest", "url": wayback_tile_url(newest), "maxzoom": WAYBACK_MAXZOOM, "real": False,
                 "detail": f"World Imagery release of {newest['releaseLabel']}, the newest", "wide": True}]
    if report:
        report([], "Esri Wayback: looking for the releases whose imagery changed here...", 0, 0)
    items = wayback_walk(catalog, level, row, col, fetch, stop)
    if stop():
        return None
    if not items:
        return []
    place = f"{qlat:.3f}:{qlng:.3f}:{level}"
    with _store_lock:
        known = dict(_store["dates"].get(place) or {})
    metas = {it["releaseNum"]: known[str(it["releaseNum"])] for it in items if str(it["releaseNum"]) in known}
    lock = threading.Lock()

    def tell():
        if report and not stop():
            with lock:
                snapshot = dict(metas)
            report(wayback_ticks(items, snapshot, final=False),
                   f"Esri Wayback: {len(snapshot)} of {len(items)} releases dated...", len(snapshot), len(items))

    tell()

    def one(item):
        if stop():
            return
        meta, answered = None, False
        for _attempt in range(2):  # the metadata service times out now and then: once more
            if stop():
                return
            try:
                meta = wayback_meta(item, qlat, qlng, level, fetch)
                answered = True
                break
            except Exception:  # noqa: BLE001 - twice: the release stands at its release date
                continue
        with lock:
            metas[item["releaseNum"]] = meta
        if answered and meta and meta.get("dateMs"):
            # Only a date that answered is kept: a failure is asked again next time.
            with _store_lock:
                dates = _store["dates"].pop(place, None) or {}
                dates[str(item["releaseNum"])] = meta
                _store["dates"][place] = dates
        tell()

    todo = [it for it in dating_order(items, target_ms) if it["releaseNum"] not in metas]
    if todo:
        with ThreadPoolExecutor(max_workers=META_WORKERS) as pool:
            list(pool.map(one, todo))
        save_store()
    if stop():
        return None
    return wayback_ticks(items, metas, final=True)


# -- Google Earth historical, through a tile service -----------------------------
def ge_dates_url(service, lat, lng, level):
    return f"{service}/imagery-dates/ge-historical?" + urlencode({"lat": round(lat, 6), "lng": round(lng, 6), "zoom": level})


def ge_tile_url(service, date):
    return f"{service}/basemap-tiles/ge-historical/{{z}}/{{x}}/{{y}}.jpg?imageryDate={date}"


def parse_ge_dates(data, service):
    """The ticks of a tile service's /imagery-dates/ge-historical answer,
    oldest first."""
    j = json.loads(data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else data)
    ticks = []
    for d in j.get("dates") or []:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})$", str(d.get("date", "")))
        if not m:
            continue
        ms = utc_ms(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        detail = [d["provider"]] if d.get("provider") else []
        detail.append(f"Google Earth, level {j.get('level')}" if j.get("level") else "Google Earth")
        ticks.append({"dateMs": ms, "label": m.group(0), "ref": m.group(0), "url": ge_tile_url(service, m.group(0)),
                      "maxzoom": GE_MAXZOOM, "detail": ", ".join(detail), "real": True})
    ticks.sort(key=lambda t: t["dateMs"])
    return ticks


def list_ge(lat, lng, zoom, service, fetch=fetch_url):
    """Google Earth's dated captures at a place, asked of a tile service."""
    if not service:
        raise HistoricalError("Google Earth historical " + unavailable("ge-historical"))
    service = service.rstrip("/")
    try:
        data = fetch(ge_dates_url(service, lat, lng, ge_level(zoom)))
    except Exception as e:  # noqa: BLE001 - said in the panel
        code = getattr(e, "code", None)
        if code == 404:
            raise HistoricalError("this tile service has no /imagery-dates (it is older than 2026-11-26): update it, "
                                  "or connect a newer one") from e
        raise HistoricalError(f"the tile service did not list Google Earth's dates ({scrub(e) or type(e).__name__})") from e
    return parse_ge_dates(data, service)


# -- Planet ---------------------------------------------------------------------
def planet_tile_url(name, key):
    return f"{PLANET_TILES}/{name}/gmap/{{z}}/{{x}}/{{y}}.png?api_key={quote(str(key), safe='')}"


def planet_ticks(kind, key, now_ms=None):
    """Planet's global mosaics as ticks, computed as the app computes them
    (lib/planet.ts planetMonthlyTicks), not listed from Planet's catalog.
    Monthly: global_monthly_YYYY_MM_mosaic from 2020-01 to two months back.
    Quarterly: global_quarterly_YYYYqN_mosaic from 2016, a quarter counted
    once it ended two months ago. Each stands for its month or quarter."""
    y_now, m_now, _ = ymd(int(time.time() * 1000) if now_ms is None else now_ms)
    last = add_months(y_now, m_now, -PLANET_LAG_MONTHS)
    ticks = []
    if kind == "quarterly":
        y, q = PLANET_QUARTERLY_START
        while add_months(y, 3 * q, 0) <= last:  # the quarter's last month
            name = f"global_quarterly_{y}q{q}_mosaic"
            ny, nq = (y, q + 1) if q < 4 else (y + 1, 1)
            ticks.append({"dateMs": utc_ms(y, 3 * q - 2, 2), "startMs": utc_ms(y, 3 * q - 2), "endMs": utc_ms(ny, 3 * nq - 2),
                          "label": f"{y} Q{q}", "ref": name, "url": planet_tile_url(name, key), "maxzoom": PLANET_MAXZOOM,
                          "detail": f"Planet global quarterly basemap, {y} quarter {q}", "real": True})
            y, q = ny, nq
        return ticks
    y, m = PLANET_MONTHLY_START
    while (y, m) <= last:
        name = f"global_monthly_{y}_{m:02d}_mosaic"
        ny, nm = add_months(y, m, 1)
        # The 2nd of the month, as the app's ticks (a link's dateA lands on it).
        ticks.append({"dateMs": utc_ms(y, m, 2), "startMs": utc_ms(y, m), "endMs": utc_ms(ny, nm), "label": f"{y}-{m:02d}",
                      "ref": name, "url": planet_tile_url(name, key), "maxzoom": PLANET_MAXZOOM,
                      "detail": f"Planet global monthly basemap of {y}-{m:02d}", "real": True})
        y, m = ny, nm
    return ticks


_planet_checked = {}


def planet_check(key, ticks, fetch=fetch_url):
    """One world tile of the newest mosaic, once a session and a key: a key
    Planet refuses is said in the panel instead of 80 layers of blank tiles."""
    tag = key_tag(key)
    if tag in _planet_checked or not ticks:
        return
    try:
        fetch(ticks[-1]["url"].replace("{z}", "0").replace("{x}", "0").replace("{y}", "0"))
    except Exception as e:  # noqa: BLE001
        code = getattr(e, "code", None)
        if code in (401, 403):
            raise HistoricalError(f"Planet refused the key (HTTP {code}): check it under API keys, and that its plan "
                                  "includes these basemaps") from e
        # Anything else (the network, a mosaic not published yet): the tiles will tell.
    _planet_checked[tag] = True


# -- NASA HLS -------------------------------------------------------------------
def hls_tile_url(center_ms):
    """A true-color HLS mosaic of the granules within 15 days of a date
    (lib/hls.ts hlsTileUrl, the same query in the same order)."""
    window = HLS_WINDOW_DAYS * DAY_MS
    params = [("collection_concept_id", HLS_COLLECTION), ("temporal", f"{iso(center_ms - window)}/{iso(center_ms + window)}"),
              ("assets_regex", "B0[2-4]"), ("color_formula", "Gamma RGB 1.3 Saturation 1.5 Sigmoidal RGB 8 0.35"),
              ("assets", "B04"), ("assets", "B03"), ("assets", "B02"), ("rescale", "0,3000"), ("rescale", "0,3000"),
              ("rescale", "0,3000")]
    return f"{HLS_BASE}/rasterio/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}?{urlencode(params)}"


def hls_ticks(now_ms=None):
    """A monthly cadence from 2016, the 3rd of each month (the app's
    syntheticHlsTicks): not captures found at the place. Each stands for
    the 30 days its mosaic is made of."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    ticks = []
    y, m = HLS_START
    while utc_ms(y, m, 3) <= now_ms:
        ms = utc_ms(y, m, 3)
        ny, nm = add_months(y, m, 1)
        ticks.append({"dateMs": ms, "startMs": ms - HLS_WINDOW_DAYS * DAY_MS, "endMs": utc_ms(ny, nm, 3) - HLS_WINDOW_DAYS * DAY_MS,
                      "label": f"{y}-{m:02d}", "ref": f"{y}-{m:02d}", "url": hls_tile_url(ms), "maxzoom": HLS_MAXZOOM,
                      "detail": f"HLS Sentinel-2 granules within {HLS_WINDOW_DAYS} days of {day_label(ms)}, composed by NASA's "
                                "titiler-cmr demonstration server", "real": False})
        y, m = ny, nm
    return ticks


# -- EOX Sentinel-2 cloudless ---------------------------------------------------
def eox_tile_url(year):
    layer = "s2cloudless" if year == 2016 else f"s2cloudless-{year}"
    return f"{EOX_BASE}/{layer}_3857/default/g/{{z}}/{{y}}/{{x}}.jpg"


def eox_ticks():
    """One tick per published year, each standing for its calendar year."""
    return [{"dateMs": utc_ms(y), "endMs": utc_ms(y + 1), "label": str(y), "ref": str(y), "url": eox_tile_url(y),
             "maxzoom": EOX_MAXZOOM, "detail": f"Sentinel-2 cloudless mosaic of {y}, 10 m, EOX IT Services",
             "real": True} for y in EOX_YEARS]


# -- every source -----------------------------------------------------------------
_lists = {}
_lists_lock = threading.Lock()
_LISTS_MAX = 60


def forget(key):
    with _lists_lock:
        _lists.pop(key, None)


def cached(sid, lat, lng, zoom, keys=None, service=None):
    with _lists_lock:
        return _lists.get(place_key(sid, lat, lng, zoom, keys, service))


def list_dates(sid, lat, lng, zoom, fetch=fetch_url, report=None, cancelled=None, keys=None, service=None,
               target_ms=None, now_ms=None):
    """The ticks of a source at a place, oldest first; None when cancelled.
    A finished list is kept for the session by place_key. `keys`: the
    panel's keys ({"planetKey": ...}); `service`: the tile service
    connected, or None; `target_ms`: the date wanted, dated first."""
    s = source(sid)
    if s is None:
        raise HistoricalError(f"no dated source \"{sid}\"")
    why = unavailable(sid, keys, service)
    if why:
        raise HistoricalError(f"{s['short']} {why}")
    key = place_key(sid, lat, lng, zoom, keys, service)
    with _lists_lock:
        if key in _lists:
            return _lists[key]
    if sid == "eox-s2":
        ticks = eox_ticks()
    elif sid == "hls":
        ticks = hls_ticks(now_ms)
    elif sid in ("planet", "planet-quarterly"):
        ticks = planet_ticks("quarterly" if sid == "planet-quarterly" else "monthly", keys[s["key"]], now_ms)
        planet_check(keys[s["key"]], ticks, fetch)
    elif sid == "ge-historical":
        ticks = list_ge(lat, lng, zoom, service, fetch)
    else:
        ticks = list_wayback(lat, lng, zoom, fetch, report, cancelled, target_ms)
    if ticks is not None:
        with _lists_lock:
            while len(_lists) >= _LISTS_MAX:
                _lists.pop(next(iter(_lists)))
            _lists[key] = ticks
    return ticks


def tick_ranges(ticks, now_ms=None):
    """[(start, end)] in milliseconds, the time each tick's imagery stands
    for: its own span when it has one (a yearly mosaic's year, a month),
    else from its capture to the next one, the newest until tomorrow. Half
    open, so no two overlap."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    out = []
    for i, t in enumerate(ticks):
        start = t.get("startMs", t["dateMs"])
        end = t.get("endMs")
        if not end:
            end = ticks[i + 1].get("startMs", ticks[i + 1]["dateMs"]) if i + 1 < len(ticks) else max(now_ms, t["dateMs"]) + DAY_MS
        out.append((start, max(end, start + 1)))
    return out


def nearest(ticks, date_ms):
    """The index of the tick nearest a date; the newest when no date is given."""
    if not ticks:
        return -1
    if not date_ms:
        return len(ticks) - 1
    return min(range(len(ticks)), key=lambda i: abs(ticks[i]["dateMs"] - date_ms))


def index_at(ticks, ms, now_ms=None):
    """The tick whose span holds a moment (the Temporal Controller's frame),
    else the last one that began before it, else the first."""
    if not ticks:
        return -1
    ranges = tick_ranges(ticks, now_ms)
    for i, (a, b) in enumerate(ranges):
        if a <= ms < b:
            return i
    before = [i for i, (a, _b) in enumerate(ranges) if a <= ms]
    return before[-1] if before else 0


def index_in(ticks, start_ms, end_ms, now_ms=None):
    """The tick a frame [start, end) of a regular step shows: the newest one
    whose span meets the frame (QGIS draws every layer whose range overlaps
    it, the newest on top), else as index_at of its start."""
    if not ticks:
        return -1
    ranges = tick_ranges(ticks, now_ms)
    meets = [i for i, (a, b) in enumerate(ranges) if a < end_ms and b > start_ms]
    return meets[-1] if meets else index_at(ticks, start_ms, now_ms)
