"""The dated imagery of the app's historical mode, with no QGIS import: for
each source, the dates at a place and the XYZ tiles of a date. A port of the
entries of lib/dated-imagery.ts whose dates can be listed without a key and
whose tiles are plain https addresses:

- Esri World Imagery Wayback (lib/wayback.ts): the release catalog, the walk
  of the releases that have their own imagery at a tile (tilemap), then each
  one's real capture date at the place (the metadata layers), one tick per
  capture date.
- EOX Sentinel-2 cloudless (lib/eox-s2-cloudless.ts): one mosaic per year.

Left out, each for a reason (LEFT_OUT). No tile service lists dates, and
its /basemap-tiles draws dated imagery with the browser engine only, so the
tiles are read from the providers under every backend.

  list_dates("wayback", lat, lng, zoom, fetch=..., report=...) -> [tick]
  tick: {"dateMs", "label", "ref", "url", "maxzoom", "detail", "real", "endMs"?}

Every request goes through `fetch(url) -> bytes` (urllib by default), called
from worker threads, never from the UI thread."""
import json
import math
import re
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlencode

USER_AGENT = "terrain-viewer-qgis/0.10"
DAY_MS = 86400000

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

EOX_BASE = "https://tiles.maps.eox.at/wmts/1.0.0"
EOX_MAXZOOM = 14
# The years EOX publishes, read from its WMTS capabilities (2026-11-26):
# every year from 2016, the first mosaic under the bare name "s2cloudless".
# lib/eox-s2-cloudless.ts differs on two points: it leaves 2017 out, and
# names 2016 "s2cloudless-2016", a layer the server does not have (404).
EOX_YEARS = (2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025)

# id, name, short name, whether the dates depend on the place, what the dates are.
SOURCES = (
    {"id": "wayback", "name": "Esri World Imagery Wayback", "short": "Esri Wayback", "per_place": True,
     "maxzoom": WAYBACK_MAXZOOM,
     "about": "Every archived release of Esri World Imagery since 2014; the dates are the real capture dates at the "
              "map's centre, one per distinct capture."},
    {"id": "eox-s2", "name": "EOX Sentinel-2 cloudless", "short": "EOX Sentinel-2", "per_place": False,
     "maxzoom": EOX_MAXZOOM,
     "about": "EOX's yearly cloudless Sentinel-2 mosaics (10 m), one per published year, the same everywhere."},
)
# The app's other dated sources, and why this panel does not list them yet.
LEFT_OUT = {
    "ge-historical": "Google Earth historical: its dates and tiles are read from Google Earth's own quadtree packets "
                     "by a scheme of the app (gehist://), not a tile address QGIS can ask",
    "planet": "Planet monthly basemaps: needs a Planet key, which the panel does not hold",
    "hls": "NASA HLS: a monthly cadence (about 130 dates that are not captures found at the place), composed on "
           "request by a public demonstration server",
    "bing": "Bing Aerial: one current mosaic, no series (it is one of the Basemap row's sources)",
    "catalogs": "The national series and the STAC catalogs (lib/national-dated.ts, lib/stac-dated.ts): not ported yet",
}


class HistoricalError(Exception):
    pass


def source(sid):
    return next((s for s in SOURCES if s["id"] == sid), None)


def fetch_url(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def utc_ms(year, month=1, day=1):
    return int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)


def ymd(ms):
    """(year, month, day) of a date in milliseconds, UTC."""
    d = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    return d.year, d.month, d.day


def day_label(ms):
    return "%04d-%02d-%02d" % ymd(ms)


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


def place_key(sid, lat, lng, zoom):
    """What a source's list of dates depends on: nothing for a source that is
    the same everywhere, the tile at the centre for Wayback."""
    s = source(sid)
    if s is None or not s["per_place"]:
        return sid
    if zoom < MIN_PLACE_ZOOM:
        return f"{sid}:latest"
    qlat, qlng, _ = quantize(lat, lng, zoom)
    level = wayback_level(zoom)
    col, row = tile_of(qlat, qlng, level)
    return f"{sid}:{level}/{col}/{row}:{qlat:.5f},{qlng:.5f}"


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


def reset_cache():
    global _catalog
    with _catalog_lock:
        _catalog = None
    with _lists_lock:
        _lists.clear()


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
    """The releases with their own imagery at a tile, newest first. Each
    tilemap answer names the release holding the asked release's imagery, so
    the next one to ask is the one after it; several chains started across
    the catalog cover it in a fraction of one chain's time, a chain stopping
    where it meets another (lib/wayback.ts startWalk)."""
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
    by = {it["releaseNum"]: it for it in catalog}
    return [by[n] for n in distinct_releases(chain, level) if n in by]


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


def list_wayback(lat, lng, zoom, fetch=fetch_url, report=None, cancelled=None):
    """Wayback's capture dates at a place. `report(ticks, note)` is called as
    the dates arrive (the metadata service answers in 1 to 30 s a query);
    `cancelled()` true stops asking."""
    qlat, qlng, _ = quantize(lat, lng, zoom)
    level = wayback_level(zoom)
    col, row = tile_of(qlat, qlng, level)
    stop = cancelled or (lambda: False)
    catalog = wayback_catalog(fetch)
    if zoom < MIN_PLACE_ZOOM:
        newest = catalog[0]
        return [{"dateMs": newest["releaseMs"], "label": f"latest (release of {newest['releaseLabel']})",
                 "ref": "latest", "url": wayback_tile_url(newest), "maxzoom": WAYBACK_MAXZOOM, "real": False,
                 "detail": f"World Imagery release of {newest['releaseLabel']}, the newest",
                 "hint": "zoom in (zoom 10 or more) to list the capture dates at the map's centre"}]
    if report:
        report([], "Esri Wayback: looking for the releases with imagery here...")
    items = wayback_walk(catalog, level, row, col, fetch, stop)
    if not items:
        return []
    metas, lock = {}, threading.Lock()

    def one(item):
        if stop():
            return
        meta = None
        for _attempt in range(2):  # the metadata service times out now and then: once more
            if stop():
                return
            try:
                meta = wayback_meta(item, qlat, qlng, level, fetch)
                break
            except Exception:  # noqa: BLE001 - twice: the release stands at its release date
                continue
        with lock:
            metas[item["releaseNum"]] = meta
            snapshot = dict(metas)
        if report and not stop():
            report(wayback_ticks(items, snapshot, final=False),
                   f"Esri Wayback: {len(snapshot)} of {len(items)} releases dated...")

    with ThreadPoolExecutor(max_workers=META_WORKERS) as pool:
        list(pool.map(one, items))
    if stop():
        return None
    return wayback_ticks(items, metas, final=True)


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


def cached(sid, lat, lng, zoom):
    with _lists_lock:
        return _lists.get(place_key(sid, lat, lng, zoom))


def list_dates(sid, lat, lng, zoom, fetch=fetch_url, report=None, cancelled=None):
    """The ticks of a source at a place, oldest first; None when cancelled.
    A finished list is kept for the session by place_key."""
    if source(sid) is None:
        raise HistoricalError(f"no dated source \"{sid}\"")
    key = place_key(sid, lat, lng, zoom)
    with _lists_lock:
        if key in _lists:
            return _lists[key]
    ticks = eox_ticks() if sid == "eox-s2" else list_wayback(lat, lng, zoom, fetch, report, cancelled)
    if ticks is not None:
        with _lists_lock:
            while len(_lists) >= _LISTS_MAX:
                _lists.pop(next(iter(_lists)))
            _lists[key] = ticks
    return ticks


def tick_ranges(ticks, now_ms=None):
    """[(start, end)] in milliseconds, the time each tick's imagery stands
    for: its own span when it has one (a yearly mosaic's year), else from its
    capture to the next one, the newest until tomorrow. Half open, so no two
    overlap."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    out = []
    for i, t in enumerate(ticks):
        end = t.get("endMs")
        if not end:
            end = ticks[i + 1]["dateMs"] if i + 1 < len(ticks) else max(now_ms, t["dateMs"]) + DAY_MS
        out.append((t["dateMs"], max(end, t["dateMs"] + 1)))
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
