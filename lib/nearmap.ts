// Nearmap Tile API + Coverage API — historical aerial imagery (Plan §4.6 in
// MAXAR_SENTINEL_INTEGRATION_PLAN.md). UNTESTED SCAFFOLDING: no Nearmap API
// key exists, and no self-serve free trial was found in their docs
// (developer.nearmap.com) — access reads as requiring an existing paid
// subscription ("a valid Nearmap account with an active subscription").
// Written from their published docs (2026-08-13):
//  - Base domain: https://api.nearmap.com (confirmed live doc example).
//  - Auth: `apikey` query param (confirmed, e.g. a live Coverage API example
//    used `?apikey={YOUR_API_KEY}`).
//  - Coverage API (CONFIRMED endpoint shape, genuinely the same role as
//    Maxar's seamlines WFS): GET /coverage/v2/point/{lon},{lat} returns
//    survey metadata (dates/resolution/content types) for that location,
//    each survey carrying a `surveyId` that feeds the Tile API — real
//    per-location historical capture dates, not a synthetic cadence.
//  - Tile API (CONFIRMED path shape from docs): `{base}/{contentType}/{z}/
//    {x}/{y}.{format}` for the latest survey, or `{base}/surveys/{surveyId}/
//    {contentType}/{z}/{x}/{y}.{format}` for a specific dated survey. The
//    exact literal `contentType` value was NOT found in any reachable doc
//    page (every sub-page with a full worked example either 404'd or wasn't
//    rendered) — NEARMAP_CONTENT_TYPE below is an unverified placeholder,
//    must be confirmed against a real account/API explorer.
//  - Coverage is NOT global — Nearmap's own marketing names the US,
//    Australia, New Zealand, and Canada as its core markets, and the one
//    live doc example used an Australian coordinate. isInNearmapCoverageArea
//    below is a coarse bounding-box approximation of those four countries,
//    good enough to hide this source entirely outside its markets, not a
//    promise of real coverage everywhere inside the box (Nearmap shoots
//    specific urban/populated areas, not every square km of these countries).
import { useEffect, useMemo, useState } from "react"

const NEARMAP_BASE = "https://api.nearmap.com"

// UNVERIFIED placeholder — see header.
const NEARMAP_CONTENT_TYPE = "Vert"

export const NEARMAP_TILE_SIZE = 256
// Nearmap's real-world ~5-7cm GSD supports a very high zoom ceiling —
// unverified exact max, this is a reasonable ceiling matching other VHR
// sources in this file (e.g. Bing/Mapbox's own 21/22 in MapSources.tsx).
export const NEARMAP_MAXZOOM = 21

// Coarse bounding boxes for Nearmap's four named core markets —
// [minLat, minLng, maxLat, maxLng]. Not real coverage polygons.
const NEARMAP_COVERAGE_BOXES: [number, number, number, number][] = [
  [24, -125, 49, -66],   // contiguous US
  [-44, 112, -10, 154],  // Australia
  [-47, 166, -34, 179],  // New Zealand
  [42, -141, 60, -52],   // southern/populated Canada
]

export function isInNearmapCoverageArea(lat: number, lng: number): boolean {
  return NEARMAP_COVERAGE_BOXES.some(([minLat, minLng, maxLat, maxLng]) => lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng)
}

export function nearmapSurveyTileUrl(apiKey: string, surveyId: string): string {
  return `${NEARMAP_BASE}/surveys/${surveyId}/${NEARMAP_CONTENT_TYPE}/{z}/{x}/{y}.jpg?apikey=${apiKey}`
}

interface NearmapSurvey {
  surveyId: string
  captureDate: string
}

async function fetchNearmapCoverage(apiKey: string, lat: number, lng: number): Promise<NearmapSurvey[]> {
  try {
    // lon,lat order — matches the live Coverage API doc example
    // ("138.597...,-34.917...", an Adelaide-area point).
    const res = await fetch(`${NEARMAP_BASE}/coverage/v2/point/${lng},${lat}?apikey=${apiKey}`)
    if (!res.ok) return []
    const json = await res.json()
    // Field names (id/date vs surveyId/captureDate) are a best guess — the
    // exact response schema wasn't confirmed against a live response.
    return ((json?.surveys ?? []) as any[]).map((s) => ({
      surveyId: s.id ?? s.surveyId ?? "",
      captureDate: s.captureDate ?? s.date ?? "",
    })).filter((s) => s.surveyId)
  } catch {
    return []
  }
}

// Same debounce cadence as lib/bing.ts's own network-triggering location change.
const NEARMAP_DEBOUNCE_MS = 400

export interface NearmapTick {
  dateMs: number
  label: string
  surveyId: string
}

/** Real per-location capture dates from Nearmap's Coverage API — same "real
 *  per-location dates" flavor as useWaybackRealCaptureDates/
 *  useMaxarSeamlineTicks, not a synthetic fixed cadence. No-ops (empty
 *  ticks) when apiKey is empty or the location is outside Nearmap's core
 *  markets. */
export function useNearmapSurveyTicks(apiKey: string, lat: number, lng: number): { ticks: NearmapTick[]; loading: boolean } {
  const [ticks, setTicks] = useState<NearmapTick[]>([])
  const [loading, setLoading] = useState(false)
  const inCoverage = isInNearmapCoverageArea(lat, lng)

  useEffect(() => {
    if (!apiKey || !inCoverage) { setTicks([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const surveys = await fetchNearmapCoverage(apiKey, lat, lng)
      if (cancelled) return
      const result = surveys
        .map((s) => ({ dateMs: Date.parse(s.captureDate), label: s.captureDate.slice(0, 10), surveyId: s.surveyId }))
        .filter((t) => !isNaN(t.dateMs))
        .sort((a, b) => a.dateMs - b.dateMs)
      setTicks(result)
      setLoading(false)
    }, NEARMAP_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [apiKey, lat, lng, inCoverage])

  return { ticks, loading }
}

/** Resolves a scrubbed date back to the nearest survey's id — same
 *  "nearest, not exact equality" convention as lib/wayback.ts's
 *  useResolvedWaybackRelease, since the tick's own dateMs already came from
 *  this same coverage lookup, just possibly a render or two apart at a
 *  marginally different lat/lng. Fetches independently of
 *  useNearmapSurveyTicks (same duplication Wayback itself already has
 *  between the timeline panel's own ticks and MapSources.tsx's resolve
 *  hook) since MapSources.tsx only ever receives a plain epoch-ms date, not
 *  a surveyId. */
export function useResolvedNearmapSurvey(apiKey: string, lat: number, lng: number, dateMs: number): { surveyId: string | null } {
  const { ticks } = useNearmapSurveyTicks(apiKey, lat, lng)
  const surveyId = useMemo(() => {
    if (!dateMs || !ticks.length) return null
    let best = ticks[0]
    let bestDist = Math.abs(ticks[0].dateMs - dateMs)
    for (const t of ticks) {
      const dist = Math.abs(t.dateMs - dateMs)
      if (dist < bestDist) { best = t; bestDist = dist }
    }
    return best.surveyId
  }, [ticks, dateMs])
  return { surveyId }
}
