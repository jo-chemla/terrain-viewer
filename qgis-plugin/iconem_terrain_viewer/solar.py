"""The sun's position for the panel's light, a port of the app's
lib/solar-position.ts (the Phong and hillshade "date and time" light), so a
date, a time and a place light the terrain as the app does.

As in the app, deliberately simple: the declination by Cooper's formula and
the hour angle from true solar time (solar noon at 12:00), no equation of
time. A UTC time becomes solar time by the longitude alone (15 degrees an
hour), as the app's UTC clock does. Azimuth from north, clockwise, the
direction the light comes from (MapLibre's illuminationDirection);
test_panel_units.py checks it against values from the TypeScript."""
import datetime
import math

DEG = math.pi / 180


def _clamp(v, lo, hi):
    return min(max(v, lo), hi)


def declination(day_of_year):
    """The sun's declination in degrees for a day of the year (1 to 365),
    Cooper's formula (solarDeclination)."""
    return 23.45 * math.sin(DEG * (360 * (284 + day_of_year)) / 365)


def solar_position(lat, day_of_year, solar_hour):
    """(azimuth, altitude) in degrees for a latitude, a day of the year and
    a true solar hour (0 to 24): solarPosition. The altitude is negative
    when the sun is below the horizon."""
    phi = lat * DEG
    delta = declination(day_of_year) * DEG
    h = (solar_hour - 12) * 15 * DEG
    sin_alt = math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.cos(h)
    alt = math.asin(_clamp(sin_alt, -1, 1))
    cos_az = (math.sin(delta) - math.sin(alt) * math.sin(phi)) / ((math.cos(alt) * math.cos(phi)) or 1e-6)
    az0 = math.degrees(math.acos(_clamp(cos_az, -1, 1)))
    return (360 - az0 if h > 0 else az0), math.degrees(alt)


def day_length(lat, day_of_year):
    """(sunrise, sunset) in solar hours, (0, 24) in polar day and (12, 12) in
    polar night: dayLength."""
    cos_h0 = -math.tan(lat * DEG) * math.tan(declination(day_of_year) * DEG)
    if cos_h0 <= -1:
        return 0.0, 24.0
    if cos_h0 >= 1:
        return 12.0, 12.0
    h0 = math.degrees(math.acos(cos_h0))
    return 12 - h0 / 15, 12 + h0 / 15


def day_of_year(month, day):
    """1 to 365 from a month and a day, any year read as 2026 (no leap day),
    as the app's dayOfYearFromDate: 29 February is the 28th."""
    if month == 2 and day > 28:
        day = 28
    return datetime.date(2026, month, day).timetuple().tm_yday


def date_of_day(day_of_year_, year):
    """The (month, day) of a day of the year (1 to 365), counted in 2026 (no
    leap day), so that day_of_year() reads it back in any year."""
    d = datetime.date(2026, 1, 1) + datetime.timedelta(days=int(round(_clamp(day_of_year_, 1, 365))) - 1)
    return d.month, d.day


def solar_hour_utc(utc_hour, lng):
    """True solar hour of a UTC hour at a longitude (the app's UTC clock)."""
    return (utc_hour + lng / 15) % 24


def sun_at(lat, lng, month, day, utc_hour):
    """(azimuth, altitude, solar hour) of the sun over (lat, lng) on that day
    at that UTC hour."""
    doy = day_of_year(month, day)
    sh = solar_hour_utc(utc_hour, lng)
    az, alt = solar_position(lat, doy, sh)
    return az % 360, alt, sh


def format_hour(hour):
    """6.5 -> "06:30" (formatHour)."""
    hour = _clamp(hour, 0, 24)
    h = int(math.floor(hour))
    m = int(round((hour - h) * 60))
    if m == 60:
        h, m = h + 1, 0
    return f"{h:02d}:{m:02d}"
