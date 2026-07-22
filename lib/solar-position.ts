// Lightweight solar-geometry helpers for the Phong "datetime-based light"
// mode (see lighting-effects-options-section.tsx). Given the viewport-center
// latitude/longitude, a day of the year and a time of day, these produce the
// sun's compass azimuth + altitude so the light direction can be driven from a
// physically-plausible sun position instead of a free XY-pad pick.
//
// Deliberately simple: time of day is treated as LOCAL SOLAR time (solar noon
// = 12:00), so there's no timezone/longitude-offset or equation-of-time
// correction — accurate enough to place the light and show a believable
// day-length range on a slider, not an ephemeris. Declination uses Cooper's
// formula; azimuth is measured clockwise from north (0 = N, 90 = E, 180 = S,
// 270 = W), matching MapLibre's `illuminationDirection` convention (the
// direction the light comes FROM).

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** Solar declination (degrees) for a day of year (1–365), Cooper's formula. */
export function solarDeclination(dayOfYear: number): number {
  return 23.45 * Math.sin(DEG * (360 * (284 + dayOfYear)) / 365)
}

export interface SunPosition {
  /** Compass azimuth of the sun, degrees clockwise from north. */
  azimuth: number
  /** Sun altitude above the horizon, degrees (negative = below horizon). */
  altitude: number
}

/**
 * Sun position for a latitude, day of year and local-solar hour (0–24).
 * Longitude is accepted for API symmetry but unused (local solar time already
 * folds it out).
 */
export function solarPosition(latDeg: number, _lngDeg: number, dayOfYear: number, hourLocalSolar: number): SunPosition {
  const phi = latDeg * DEG
  const delta = solarDeclination(dayOfYear) * DEG
  // Hour angle: 0 at solar noon, +15°/h in the afternoon, −15°/h in the morning.
  const H = (hourLocalSolar - 12) * 15 * DEG

  const sinAlt = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H)
  const altitude = Math.asin(clamp(sinAlt, -1, 1))

  const cosAz = (Math.sin(delta) - Math.sin(altitude) * Math.sin(phi)) / (Math.cos(altitude) * Math.cos(phi) || 1e-6)
  const az0 = Math.acos(clamp(cosAz, -1, 1)) * RAD
  // Morning (H < 0): sun in the east, 0–180°. Afternoon (H > 0): mirror to the
  // west, 180–360°.
  const azimuth = H > 0 ? 360 - az0 : az0

  return { azimuth, altitude: altitude * RAD }
}

export interface DayLength {
  /** Local-solar hour of sunrise (0–12), or 0 during polar day. */
  sunrise: number
  /** Local-solar hour of sunset (12–24), or 24 during polar day. */
  sunset: number
  /** Sun never sets on this day at this latitude. */
  polarDay: boolean
  /** Sun never rises on this day at this latitude. */
  polarNight: boolean
}

/** Sunrise/sunset in local solar time for a latitude + day of year. */
export function dayLength(latDeg: number, dayOfYear: number): DayLength {
  const phi = latDeg * DEG
  const delta = solarDeclination(dayOfYear) * DEG
  const cosH0 = -Math.tan(phi) * Math.tan(delta)
  if (cosH0 <= -1) return { sunrise: 0, sunset: 24, polarDay: true, polarNight: false }
  if (cosH0 >= 1) return { sunrise: 12, sunset: 12, polarDay: false, polarNight: true }
  const H0 = Math.acos(cosH0) * RAD // degrees
  return { sunrise: 12 - H0 / 15, sunset: 12 + H0 / 15, polarDay: false, polarNight: false }
}

/** Day-of-year (1–365) → calendar Date in the given (non-leap) year. */
export function dayOfYearToDate(dayOfYear: number, year = 2026): Date {
  const d = new Date(year, 0, 1)
  d.setDate(d.getDate() + (Math.round(dayOfYear) - 1))
  return d
}

/** Day-of-year (1–365) → "YYYY-MM-DD" (e.g. 121 → "2026-05-01"). */
export function formatDayOfYear(dayOfYear: number, year = 2026): string {
  const d = dayOfYearToDate(dayOfYear, year)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Fractional hour (e.g. 6.5) → "HH:MM" (e.g. "06:30"). */
export function formatHour(hour: number): string {
  const clamped = clamp(hour, 0, 24)
  let h = Math.floor(clamped)
  let m = Math.round((clamped - h) * 60)
  if (m === 60) { h += 1; m = 0 }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}
