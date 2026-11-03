// Calendar-day helpers for the date fields (export dialog, STAC search).
//
// A calendar day is a "YYYY-MM-DD" string everywhere in the UI. The two
// conversions below are deliberately asymmetric about timezones:
// - react-day-picker hands back (and takes) LOCAL-midnight Dates, so those
//   are read and built with the local getters (toISOString() on a local
//   midnight is the previous day anywhere east of Greenwich: the "pick the
//   8th, get the 7th" bug).
// - Timestamps (ms) that come from the timeline or go to the listing code
//   are UTC, so those use the UTC getters.

export const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const pad2 = (n: number) => String(n).padStart(2, "0")
const toIso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`

/** True when y-m-d (1-based month) is a real calendar day. */
export function isValidDay(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function isValidIsoDate(iso: string): boolean {
  const m = ISO_DATE_RE.exec(iso)
  return !!m && isValidDay(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** A local-midnight Date (what the calendar gives) -> "YYYY-MM-DD". */
export function isoFromLocalDate(d: Date): string {
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** "YYYY-MM-DD" -> local-midnight Date (what the calendar wants); undefined when malformed. */
export function localDateFromIso(iso: string | undefined | null): Date | undefined {
  if (!iso) return undefined
  const m = ISO_DATE_RE.exec(iso)
  if (!m || !isValidDay(Number(m[1]), Number(m[2]), Number(m[3]))) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** A UTC timestamp -> the "YYYY-MM-DD" of that instant in UTC. */
export function isoFromUtcMs(ms: number): string {
  const d = new Date(ms)
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

const DAY_MS = 86_400_000

/** A catalog's date string -> ms. A time with no zone is read as UTC, not as
 *  the visitor's own clock, so one item has one date on every machine. */
export function parseUtcMs(value: string): number {
  return Date.parse(/T\d{2}(:?\d{2}(:?\d{2}(\.\d+)?)?)?$/.test(value) ? `${value}Z` : value)
}

/** Whether a timestamp carries a time of day. Midnight, or a second either
 *  side of it, is how catalogs write a plain day (NOAA's 00:00:01, an extent's
 *  23:59:59), so those count as no time. */
export function hasUtcTime(ms: number): boolean {
  const sinceMidnight = ((ms % DAY_MS) + DAY_MS) % DAY_MS
  return sinceMidnight > 1000 && sinceMidnight < DAY_MS - 1000
}

/** "YYYY-MM-DD HH:MM:SS" of a timestamp's UTC fields, without seconds when they are zero. */
function dayAndClock(ms: number): string {
  const clock = new Date(ms).toISOString().slice(11, 19)
  return `${isoFromUtcMs(ms)} ${clock.endsWith(":00") ? clock.slice(0, 5) : clock}`
}

/** A timestamp for display: "2023-04-18" when it is a plain day, "2023-04-18 10:32:41 UTC" otherwise. */
export function formatUtcDate(ms: number): string {
  return hasUtcTime(ms) ? `${dayAndClock(ms)} UTC` : isoFromUtcMs(ms)
}

/** The same instant on a clock `offsetHours` from UTC: "2023-04-18 16:02:41 (UTC+5:30)". */
export function formatAtOffset(ms: number, offsetHours: number): string {
  const minutes = Math.round(Math.abs(offsetHours) * 60)
  const offset = `${offsetHours < 0 ? "-" : "+"}${Math.floor(minutes / 60)}${minutes % 60 ? `:${pad2(minutes % 60)}` : ""}`
  return `${dayAndClock(ms + offsetHours * 3_600_000)} (UTC${offset})`
}

/** "YYYY-MM-DD" -> ms at UTC midnight (start) or 23:59:59 (end of day). */
export function utcMsFromIso(iso: string, edge: "start" | "end" = "start"): number {
  const m = ISO_DATE_RE.exec(iso)
  if (!m) return NaN
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return edge === "end" ? base + 86_400_000 - 1000 : base
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
function monthFromName(name: string): number | null {
  const n = name.toLowerCase().replace(/\.$/, "")
  if (n.length < 3) return null
  const i = MONTHS.findIndex((m) => m === n || m.startsWith(n))
  return i < 0 ? null : i + 1
}

/**
 * Loose parser for a typed date. Accepts, in order of precedence:
 *   "2021"                      -> 2021-01-01 (a bare year is January 1st)
 *   "2021-03", "2021/3", "3/2021", "March 2021" -> the 1st of that month
 *   "2021-03-12", "2021/3/12"   -> year first
 *   "12/03/2021", "12.03.2021", "12-03-2021" -> DAY first (European order)
 *   "12 March 2021", "12 mar 2021", "March 12, 2021", "Mar 12 2021"
 * Returns the "YYYY-MM-DD" string, or null when the text is not a date
 * (unknown month name, day 31 in a 30-day month, year outside 1000-9999).
 */
export function parseDateInput(text: string): string | null {
  const s = text.trim().replace(/\s+/g, " ")
  if (!s) return null
  // Already canonical.
  if (ISO_DATE_RE.test(s)) return isValidIsoDate(s) ? s : null
  const done = (y: number, m: number, d: number) => (isValidDay(y, m, d) ? toIso(y, m, d) : null)
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})$/.exec(s))) return done(Number(m[1]), 1, 1)
  if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(s))) return done(Number(m[1]), Number(m[2]), 1)
  if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(s))) return done(Number(m[2]), Number(m[1]), 1)
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return done(Number(m[1]), Number(m[2]), Number(m[3]))
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) return done(Number(m[3]), Number(m[2]), Number(m[1]))
  // "12 March 2021", "12 mar. 2021"
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+\.?),? (\d{4})$/i.exec(s))) {
    const mo = monthFromName(m[2])
    return mo ? done(Number(m[3]), mo, Number(m[1])) : null
  }
  // "March 12, 2021", "Mar 12 2021"
  if ((m = /^([a-z]+\.?) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(s))) {
    const mo = monthFromName(m[1])
    return mo ? done(Number(m[3]), mo, Number(m[2])) : null
  }
  // "March 2021", "mar 2021"
  if ((m = /^([a-z]+\.?),? (\d{4})$/i.exec(s))) {
    const mo = monthFromName(m[1])
    return mo ? done(Number(m[2]), mo, 1) : null
  }
  return null
}

/** Keep iso inside [min, max] (either bound optional); iso strings compare lexically. */
export function clampIsoDate(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min
  if (max && iso > max) return max
  return iso
}
