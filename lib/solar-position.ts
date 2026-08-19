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
function solarDeclination(dayOfYear: number): number {
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

export interface AzElPoint {
  azimuth: number
  elevation: number
}

/** Amplitude of solarDeclination() — the sun's actual annual declination
 *  range is exactly [-MAX_DECLINATION, +MAX_DECLINATION]. */
const MAX_DECLINATION = 23.45

/**
 * Every (azimuth, elevation) reachable by the sun on SOME day of the year at
 * this latitude — the XY-pad's full-dome "coverage" backdrop, independent of
 * any particular day/time selection. Membership test is an exact spherical-
 * astronomy identity dual to solarPosition's own altitude formula:
 *   sin(declination) = sin(lat)·sin(el) + cos(lat)·cos(el)·cos(az)
 * A given (az, el) is reachable on some day of the year exactly when the
 * declination it implies falls within the sun's real annual range, i.e.
 *   |sin(lat)·sin(el) + cos(lat)·cos(el)·cos(az)| <= sin(MAX_DECLINATION)
 * Solving that inequality symbolically for el (per fixed az) tangles in
 * spurious extraneous roots from the periodic sine solution; scanning
 * elevation densely per azimuth is cheap (computed once per lat, not per
 * frame — a few thousand evaluations) and exact in the limit.
 */
export function yearlySunEnvelope(latDeg: number, azimuthSteps = 72, elevationSteps = 90): { upper: AzElPoint[]; lower: AzElPoint[] } {
  const phi = latDeg * DEG
  const k = Math.sin(MAX_DECLINATION * DEG)
  const upper: AzElPoint[] = []
  const lower: AzElPoint[] = []
  for (let i = 0; i <= azimuthSteps; i++) {
    const azimuth = (i / azimuthSteps) * 360
    const cosAz = Math.cos(azimuth * DEG)
    let maxEl: number | null = null
    let minEl: number | null = null
    for (let j = 0; j <= elevationSteps; j++) {
      const elevation = (j / elevationSteps) * 90
      const f = Math.sin(phi) * Math.sin(elevation * DEG) + Math.cos(phi) * cosAz * Math.cos(elevation * DEG)
      if (Math.abs(f) <= k + 1e-9) {
        if (maxEl === null || elevation > maxEl) maxEl = elevation
        if (minEl === null || elevation < minEl) minEl = elevation
      }
    }
    if (maxEl !== null) upper.push({ azimuth, elevation: maxEl })
    if (minEl !== null) lower.push({ azimuth, elevation: minEl })
  }
  return { upper, lower }
}

/**
 * Same membership test as yearlySunEnvelope above, but as a direct O(1)
 * check for one exact (az, el) pair instead of a discretized scan — for live
 * feedback while dragging the XY pad (e.g. an invalid-direction indicator),
 * where interpolating the scanned envelope would both be more code and less
 * precise than just evaluating the closed form directly.
 *
 * toleranceDeg widens the boundary by that many degrees of DECLINATION
 * slack (i.e. as if the sun's max declination were briefly
 * MAX_DECLINATION + toleranceDeg) rather than padding azimuth/elevation
 * directly, since declination is the single quantity the whole membership
 * test is actually expressed in — a UI right on or barely past the true
 * boundary (e.g. a value carried over from a slightly different latitude,
 * or float rounding) can then still read as "reachable" instead of visually
 * flip-flopping red/primary a pixel either side of an exact line.
 */
export function isSunPositionReachable(latDeg: number, azimuthDeg: number, elevationDeg: number, toleranceDeg = 0): boolean {
  const phi = latDeg * DEG
  const f = Math.sin(phi) * Math.sin(elevationDeg * DEG) + Math.cos(phi) * Math.cos(azimuthDeg * DEG) * Math.cos(elevationDeg * DEG)
  return Math.abs(f) <= Math.sin((MAX_DECLINATION + toleranceDeg) * DEG) + 1e-9
}

function wrap24(h: number): number {
  return ((h % 24) + 24) % 24
}

/** Wraps a day-of-year value onto (0, 365] — matching the 1–365 convention
 *  used everywhere else in this file, rather than 0-indexed. */
function wrapDayOfYear(n: number): number {
  let d = n % 365
  if (d <= 0) d += 365
  return d
}

/** Shortest distance between two days of year around the 365-day wrap. */
function circularDayDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 365
  return Math.min(diff, 365 - diff)
}

export interface InverseSunPosition {
  dayOfYear: number
  hourLocalSolar: number
}

/**
 * Inverse of solarPosition(): given a target (azimuth, elevation) at a
 * latitude, back-solve the day-of-year + local-solar hour that would produce
 * it — "Free" mode's freely-dragged direction still corresponds to a real
 * sun position, generically twice a year (Cooper's declination curve is a
 * sine wave, not injective over the year), so referenceDayOfYear picks
 * whichever of the two candidate days is nearer (wrapped around the 365-day
 * year) to the day currently set, rather than always preferring one.
 *
 * Both the hour-angle and declination steps are exact spherical-astronomy
 * identities dual to solarPosition's own formulas — verified by round-
 * tripping solarPosition's own output back through this function to machine
 * precision across latitudes/days/hours:
 *   sin(declination) = sin(lat)·sin(el) + cos(lat)·cos(el)·cos(az)
 *   H = atan2(sin(az), cos(az)·sin(lat) − tan(el)·cos(lat)) + 180°, wrapped to −180..180
 *   N₁ = 365/360 · asin(declination / MAX_DECLINATION) − 284           (mod 365)
 *   N₂ = 365/360 · (180° − asin(declination / MAX_DECLINATION)) − 284  (mod 365)
 */
export function inverseSunPosition(latDeg: number, azimuthDeg: number, elevationDeg: number, referenceDayOfYear: number): InverseSunPosition {
  const phi = latDeg * DEG
  const az = azimuthDeg * DEG
  const el = elevationDeg * DEG

  const sinDelta = Math.sin(phi) * Math.sin(el) + Math.cos(phi) * Math.cos(el) * Math.cos(az)
  const delta = Math.asin(clamp(sinDelta, -1, 1)) * RAD

  const cosPhi = Math.cos(phi)
  let H = Math.abs(cosPhi) < 1e-9
    ? 0 // hour angle is degenerate exactly at the poles; arbitrary but harmless
    : Math.atan2(Math.sin(az), Math.cos(az) * Math.sin(phi) - Math.tan(el) * cosPhi) * RAD + 180
  while (H > 180) H -= 360
  while (H <= -180) H += 360
  const hourLocalSolar = wrap24(12 + H / 15)

  const asinTerm = Math.asin(clamp(delta / MAX_DECLINATION, -1, 1)) * RAD
  const n1 = wrapDayOfYear((365 / 360) * asinTerm - 284)
  const n2 = wrapDayOfYear((365 / 360) * (180 - asinTerm) - 284)
  const dayOfYear = circularDayDistance(n1, referenceDayOfYear) <= circularDayDistance(n2, referenceDayOfYear) ? n1 : n2

  return { dayOfYear: Math.round(dayOfYear), hourLocalSolar }
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

/** Day-of-year (1–365) → "Mon D" (e.g. 121 → "May 1") — no year, since
 *  day-of-year is inherently year-agnostic (see dayOfYearFromDate). */
export function formatDayOfYear(dayOfYear: number, year = 2026): string {
  const d = dayOfYearToDate(dayOfYear, year)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** "YYYY-MM-DD" → day-of-year (1–365); ignores the year (month/day only).
 *  Returns null for an unparseable string. */
function dateStrToDayOfYear(str: string, year = 2026): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)
  if (!m) return null
  const month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  const jan1 = new Date(year, 0, 1)
  const doy = Math.round((d.getTime() - jan1.getTime()) / 86400000) + 1
  return Math.min(365, Math.max(1, doy))
}

/** Date → day-of-year (1–365); month/day only, year ignored. */
export function dayOfYearFromDate(d: Date, year = 2026): number {
  const jan1 = new Date(year, 0, 1)
  const doy = Math.round((new Date(year, d.getMonth(), d.getDate()).getTime() - jan1.getTime()) / 86400000) + 1
  return Math.min(365, Math.max(1, doy))
}

/** Fractional hour (e.g. 6.5) → "HH:MM" (e.g. "06:30"). */
export function formatHour(hour: number): string {
  const clamped = clamp(hour, 0, 24)
  let h = Math.floor(clamped)
  let m = Math.round((clamped - h) * 60)
  if (m === 60) { h += 1; m = 0 }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}
