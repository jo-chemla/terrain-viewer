// Real (DST-aware) local-clock-time support for the "UTC vs Local" toggle in
// light-direction-control.tsx. tz-lookup resolves a lat/lng to the IANA
// timezone whose political/DST rules actually apply there (offline grid
// lookup, no network call); Intl.DateTimeFormat then resolves that zone's
// actual UTC offset for a specific date, which is the only reliable way to
// account for a given country's real DST transition dates (they vary — this
// deliberately does NOT approximate DST from latitude/season, see
// solar-position.ts's own "deliberately simple" header for the contrast: solar
// time there ignores time zones entirely, this module is the opposite half —
// real civil clock time).
import tzLookup from "tz-lookup"

/** IANA timezone name at a given lat/lng (e.g. "Europe/Paris"). Falls back to
 *  "UTC" for the rare coordinates tz-lookup can't resolve (e.g. open ocean). */
export function timezoneAt(latDeg: number, lngDeg: number): string {
  try {
    return tzLookup(latDeg, lngDeg)
  } catch {
    return "UTC"
  }
}

/** UTC offset (hours, fractional — e.g. 5.5 for India) in effect for an IANA
 *  timezone at a specific instant, correctly reflecting whether DST is
 *  active on that date. */
export function utcOffsetHours(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return (asUtc - date.getTime()) / 3_600_000
}

/** UTC offset (hours) at a lat/lng for a given date — timezoneAt + utcOffsetHours combined. */
export function utcOffsetHoursAt(latDeg: number, lngDeg: number, date: Date): number {
  return utcOffsetHours(timezoneAt(latDeg, lngDeg), date)
}

/** A client-machine-independent instant for a day-of-year in a (non-leap)
 *  year — noon UTC on that calendar date. Deliberately NOT solar-position.ts's
 *  own `dayOfYearToDate` (`new Date(year, month, day)`): that constructor
 *  resolves year/month/day in the BROWSER's own local timezone, so the exact
 *  instant it produces — and therefore the DST state utcOffsetHoursAt resolves
 *  for it — would silently depend on which machine happens to be running the
 *  app, not just the viewport's lat/lng (e.g. a colleague in New York and one
 *  in France computing the same viewport + day would get different offsets). */
export function utcInstantForDayOfYear(dayOfYear: number, year = 2026): Date {
  return new Date(Date.UTC(year, 0, 1, 12) + (Math.round(dayOfYear) - 1) * 86_400_000)
}
