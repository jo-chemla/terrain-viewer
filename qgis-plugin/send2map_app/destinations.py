# -*- coding: utf-8 -*-
# ******************************************************************************
#
# Send2MapApp - the "Open in" destinations
# ---------------------------------------------------------
# Copyright (C) 2025-2026 Jonathan Chemla, Iconem
#
# This source is free software; you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free
# Software Foundation, either version 2 of the License, or (at your option)
# any later version. See LICENSE.
#
# ******************************************************************************
"""Where a place can be opened, as URL builders over a camera.

The web destinations are a port of OPEN_IN_DESTINATIONS in the web app's
components/TerrainControlPanel/open-in-links.tsx, same ids, same labels, same
URLs; qgis-plugin/test_open_in.py runs the TypeScript builders under Node and
fails when the two lists or their URLs drift apart. The destinations marked
`plugin_only` exist only here (Terrain Viewer itself, Maxar, Google Earth Pro
on the desktop).

Pure Python, no QGIS import, so the test runs without QGIS."""
import math
import time
from decimal import ROUND_HALF_UP, Decimal


class Context:
    """The camera, in the web app's conventions: zoom of 512 px tiles
    (MapLibre's), bearing in degrees clockwise from north (0-360), pitch in
    degrees from nadir, bounds in WGS84 or None."""

    def __init__(self, lat, lng, zoom, bearing=0.0, pitch=0.0, bounds=None, now_ms=None):
        self.lat = float(lat)
        self.lng = float(lng)
        self.zoom = float(zoom)
        self.bearing = float(bearing) % 360
        self.pitch = float(pitch)
        self.bounds = bounds  # dict west/south/east/north
        self.now_ms = int(time.time() * 1000) if now_ms is None else int(now_ms)


# -- JavaScript's number formatting, so the URLs match the app's byte for byte


def js_str(x):
    """String(x) for a JS number."""
    x = float(x)
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    r = repr(x)  # shortest round trip, as JS; only the exponent range differs
    if "e" in r and 1e-6 <= abs(x) < 1e21:
        r = format(Decimal(r), "f")
    elif "e" in r:
        mant, exp = r.split("e")
        r = f"{mant}e{'+' if int(exp) > 0 else '-'}{abs(int(exp))}"
    return r


def to_fixed(x, digits):
    """Number.prototype.toFixed: the exact binary value, ties away from zero."""
    x = float(x) or 0.0  # -0 prints as 0, as in JS
    return format(Decimal(x).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP), "f")


def js_round(x):
    """Math.round: halves go up."""
    return int(math.floor(float(x) + 0.5))


def _ge_altitude(c):
    return ((38000 * 4096) / math.pow(2, c.zoom)) * math.cos((c.lat * math.pi) / 180)


# -- the destinations ----------------------------------------------------------


class Destination:
    def __init__(self, id, label, build, icon=None, available=None, unavailable_hint=None, plugin_only=False, kind="url"):
        self.id = id
        self.label = label
        self.build = build  # Context -> url (or, for kind="kml", the KML text)
        self.icon = icon
        self.available = available
        self.unavailable_hint = unavailable_hint
        self.plugin_only = plugin_only
        self.kind = kind

    def is_available(self, c):
        return self.available is None or bool(self.available(c))


def _bing(c):
    eh = js_round((156543.034 * math.cos((c.lat * math.pi) / 180) / math.pow(2, c.zoom)) * 100)
    return (f"https://www.bing.com/maps?cp={js_str(c.lat)}~{js_str(c.lng)}&lvl={to_fixed(c.zoom, 1)}"
            f"&style=3d&eh={eh}&pi={to_fixed(c.pitch, 2)}&dir={to_fixed(c.bearing, 2)}")


def _terrain_viewer(host):
    # The app's own camera parameters (QUERY_STATE_PARSERS in TerrainViewer.tsx),
    # rounded as the app writes them.
    def build(c):
        url = f"https://{host}/?lat={to_fixed(c.lat, 4)}&lng={to_fixed(c.lng, 4)}&zoom={to_fixed(c.zoom, 2)}"
        if round(c.bearing, 2) % 360:
            b = c.bearing if c.bearing <= 180 else c.bearing - 360  # maplibre's signed bearing
            url += f"&bearing={to_fixed(b, 2)}"
        if c.pitch:
            url += f"&pitch={to_fixed(c.pitch, 2)}"
        return url
    return build


def google_earth_kml(c):
    """A placemark Google Earth Pro flies to, the original send2google_earth
    behaviour."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
        "<Document>\n"
        "  <name>QGIS</name>\n"
        "  <Placemark>\n"
        "    <name>QGIS</name>\n"
        "    <LookAt>\n"
        f"      <longitude>{js_str(c.lng)}</longitude>\n"
        f"      <latitude>{js_str(c.lat)}</latitude>\n"
        f"      <range>{round(_ge_altitude(c), 1)}</range>\n"
        f"      <heading>{to_fixed(c.bearing, 2)}</heading>\n"
        f"      <tilt>{to_fixed(c.pitch, 2)}</tilt>\n"
        "    </LookAt>\n"
        f"    <Point><coordinates>{js_str(c.lng)},{js_str(c.lat)},0</coordinates></Point>\n"
        "  </Placemark>\n"
        "</Document>\n"
        "</kml>\n"
    )


DESTINATIONS = [
    # Plugin only, first: the user's own viewers.
    Destination("terrain-viewer", "Terrain Viewer", _terrain_viewer("terrain-viewer.iconem.com"),
                icon="icon-calendar_22.png", plugin_only=True),
    Destination("iconem-historical", "Iconem Historical Satellite", _terrain_viewer("historical-satellite.iconem.com"),
                icon="icon-calendar_22.png", plugin_only=True),
    # The web app's list (open-in-links.tsx), in its order.
    Destination("iconem-river-rem", "Iconem River-REM",
                lambda c: f"https://rem.prod.heritagewatch.ai/?lng={js_str(c.lng)}&lat={js_str(c.lat)}&zoom={js_str(c.zoom)}"),
    Destination("iconem-search-eo", "Iconem Search-EO",
                lambda c: f"https://search-eo-imagery.iconem.com/#{js_round(c.zoom)}/{js_str(c.lat)}/{js_str(c.lng)}",
                icon="icon-search-eo_22.png"),
    Destination("esri-wayback", "ESRI Wayback Machine",
                lambda c: f"https://livingatlas.arcgis.com/wayback/#mapCenter={js_str(c.lng)}%2C{js_str(c.lat)}%2C{js_round(c.zoom)}&mode=explore",
                icon="icon-esri_22.png"),
    Destination("google-maps-3d", "Google Maps 3D",
                lambda c: f"https://www.google.com/maps/@{js_str(c.lat)},{js_str(c.lng)},{js_str(_ge_altitude(c))}a,35y,45t/data=!3m1!1e3?entry=ttu"),
    Destination("google-earth-web", "Google Earth Historical (web)",
                lambda c: f"https://earth.google.com/web/@{js_str(c.lat)},{js_str(c.lng)},0a,{js_str(_ge_altitude(c))}d,35y,0h,0t,0r/data=CgwqBggBEgAYAUICCAE6AwoBMEICCABKDQj___________8BEAA",
                icon="icon-Google_Earth_22.png"),
    Destination("google-earth-web-3d", "Google Earth 3D (web)",
                lambda c: f"https://earth.google.com/web/@{js_str(c.lat)},{js_str(c.lng)},0a,{js_str(_ge_altitude(c))}d,35y,0h,60t,0r/data=CgRCAggBOgMKATBCAggASg0I____________ARAA",
                icon="icon-Google_Earth_22.png"),
    Destination("bing-maps-3d", "Bing Maps 3D", _bing),
    Destination("shademap", "ShadeMap (sun and shadows)",
                lambda c: f"https://shademap.app/@{to_fixed(c.lat, 5)},{to_fixed(c.lng, 5)},{to_fixed(c.zoom, 2)}z,{c.now_ms}t,{to_fixed(c.bearing, 1)}b,{to_fixed(c.pitch, 1)}p,0m"),
    Destination("lidarlens", "LiDAR Lens (Britain and Ireland)",
                lambda c: f"https://lidarlens.sarsen.org/#map={js_round(c.zoom)}/{to_fixed(c.lat, 5)}/{to_fixed(c.lng, 5)}",
                available=lambda c: 48.85 <= c.lat <= 61.6 and -16 <= c.lng <= 9,
                unavailable_hint="LiDAR Lens covers Britain and Ireland only"),
    Destination("bbbike-mapcompare", "BBBike MapCompare",
                lambda c: f"https://mc.bbbike.org/mc/?lon={js_str(c.lng)}&lat={js_str(c.lat)}&zoom={js_round(c.zoom)}&num=4&mt0=mapnik-german&mt1=cyclemap&mt2=bing-hybrid"),
    # Plugin only, kept from the earlier Send2MapApp.
    Destination("maxar", "Maxar (pro.maxar.com)",
                lambda c: f"https://pro.maxar.com/?lat={js_str(c.lat)}&lon={js_str(c.lng)}&zoom={js_round(c.zoom)}",
                icon="icon-maxar_22.png", plugin_only=True),
    # The original plugin: a KML opened in Google Earth Pro.
    Destination("google-earth-pro", "Google Earth Pro (desktop)", google_earth_kml,
                icon="icon-Google_Earth_22.png", plugin_only=True, kind="kml"),
]

BY_ID = {d.id: d for d in DESTINATIONS}
DEFAULT_ID = "terrain-viewer"
