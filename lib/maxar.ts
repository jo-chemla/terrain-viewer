// Maxar Basemaps (WMTS mosaic) + Seamlines (WFS) — UNTESTED SCAFFOLDING.
// No Maxar API key exists yet (see MAXAR_SENTINEL_INTEGRATION_PLAN.md §3) —
// this module is written directly from Maxar's own published docs (the WMTS
// basemap guide, the WFS seamlines guide, the API key guide) but has never
// made a real request against api.maxar.com. Treat every endpoint/param
// name below as "documented, not verified" until someone with a real key
// actually calls it — in particular, the plan doc's §3.6 open questions:
//  - MAXAR_VHR_PRODUCT_NAMES/MAXAR_MEDIUM_PRODUCT_NAMES below are
//    placeholders, not a confirmed taxonomy.
//  - Whether cql_filter genuinely supports a `<=` date comparison on the
//    WMTS GetTile endpoint (Maxar's own docs only show exact/BBOX/IN on the
//    WFS side) — smoke-test in the CQL Playground first.
//  - Which seamline date field (acq_time_earliest vs acq_time_latest) is
//    the right one to key a tick's position on — this uses acq_time_latest
//    throughout, unverified.
//  - The WFS bbox param order below (minLat,minLon,maxLat,maxLon) matches
//    Maxar's own doc example, not WFS 2.0.0's usual lon/lat convention —
//    confirm against a live response.
import { useEffect, useState } from "react"

const MAXAR_WMTS_BASE = "https://api.maxar.com/basemaps/v1/ogc/gwc/service/wmts"
const MAXAR_SEAMLINES_WFS_BASE = "https://api.maxar.com/basemaps/v1/seamlines/wfs"

export const MAXAR_TILE_SIZE = 256
// Matches the other VHR commercial-satellite basemaps already in
// MapSources.tsx's rasterBasemaps (googlesat/bing/mapbox all declare 21).
export const MAXAR_MAXZOOM = 21

// UNVERIFIED placeholders — Maxar's own WMTS/WFS doc examples mention
// "VIVID_STANDARD_30" as a VHR product but never enumerate the full
// taxonomy or name a medium-resolution counterpart. Must be replaced with
// the real enum values once a key exists (query the WFS with no
// product_name filter and inspect what comes back).
export const MAXAR_VHR_PRODUCT_NAMES = ["VIVID_STANDARD_30"]
export const MAXAR_MEDIUM_PRODUCT_NAMES = ["VIVID_BASIC_30"]

export type MaxarResolutionTier = "vhr" | "medium"

function productNamesFor(tier: MaxarResolutionTier): string[] {
  return tier === "vhr" ? MAXAR_VHR_PRODUCT_NAMES : MAXAR_MEDIUM_PRODUCT_NAMES
}

function productNameClause(tier: MaxarResolutionTier): string {
  return `(${productNamesFor(tier).map((p) => `product_name='${p}'`).join(" OR ")})`
}

/** Always-latest WMTS mosaic tile URL — no cql_filter, so this is whatever
 *  Maxar's basemap layer currently considers newest at each tile (the
 *  "latest mosaic" branch, modeled on Bing's always-current single mosaic —
 *  see lib/bing.ts). */
export function maxarLatestTileUrl(apiKey: string): string {
  const params = new URLSearchParams({
    service: "WMTS", request: "GetTile", layer: "Maxar:Imagery",
    tileMatrixSet: "EPSG:3857", format: "image/jpeg",
    maxar_api_key: apiKey,
  })
  return `${MAXAR_WMTS_BASE}?${params.toString()}&tileMatrix=EPSG:3857:{z}&tileCol={x}&tileRow={y}`
}

/** WMTS mosaic tile URL restricted to imagery captured on or before
 *  `beforeOrOnDateMs`, within the given resolution tier — the "historical"
 *  branch's CQL date filter (plan doc §3.3 step 3 / §3.4). See this
 *  module's header for why the `<=` comparison itself is unverified. */
export function maxarHistoricalTileUrl(apiKey: string, beforeOrOnDateMs: number, tier: MaxarResolutionTier): string {
  const dateStr = new Date(beforeOrOnDateMs).toISOString().slice(0, 10)
  const params = new URLSearchParams({
    service: "WMTS", request: "GetTile", layer: "Maxar:Imagery",
    tileMatrixSet: "EPSG:3857", format: "image/jpeg",
    maxar_api_key: apiKey,
    cql_filter: `acq_date<='${dateStr}' AND ${productNameClause(tier)}`,
  })
  return `${MAXAR_WMTS_BASE}?${params.toString()}&tileMatrix=EPSG:3857:{z}&tileCol={x}&tileRow={y}`
}

interface MaxarSeamlineFeature {
  productName: string
  acqTimeLatest: string
}

// Roughly a ~1km box at the equator — a starting guess for "small enough to
// stay a manageable feature count, large enough to reliably hit at least the
// seamline actually under the viewport center" — UNVERIFIED against real
// seamline polygon sizes, which can be much larger than 1km per side.
const MAXAR_BBOX_DELTA_DEG = 0.01

/** Small-bbox WFS GetFeature query around a point — shared by both the
 *  "as of" badge lookup (latest branch) and the historical tick discovery
 *  (historical branch). `tier` is omitted for the "as of" lookup (any
 *  product counts toward "the current mosaic's latest date") and passed for
 *  the historical tick lookup (only this tier's footprints should offer
 *  ticks). */
async function fetchSeamlinesNearViewport(apiKey: string, lat: number, lng: number, tier?: MaxarResolutionTier): Promise<MaxarSeamlineFeature[]> {
  const bbox = `${lat - MAXAR_BBOX_DELTA_DEG},${lng - MAXAR_BBOX_DELTA_DEG},${lat + MAXAR_BBOX_DELTA_DEG},${lng + MAXAR_BBOX_DELTA_DEG}`
  const cqlParts = [`BBOX(seamline_geometry,${bbox})`]
  if (tier) cqlParts.push(productNameClause(tier))
  const params = new URLSearchParams({
    service: "WFS", request: "GetFeature", version: "2.0.0", typeNames: "seamline",
    outputFormat: "application/json",
    cql_filter: cqlParts.join(" AND "),
  })
  try {
    const res = await fetch(`${MAXAR_SEAMLINES_WFS_BASE}?${params.toString()}`, { headers: { "maxar-api-key": apiKey } })
    if (!res.ok) return []
    const json = await res.json()
    return ((json?.features ?? []) as any[]).map((f) => ({
      productName: f.properties?.product_name ?? "",
      acqTimeLatest: f.properties?.acq_time_latest ?? "",
    }))
  } catch {
    return []
  }
}

// Same debounce cadence as lib/bing.ts's own network-triggering location
// change.
const MAXAR_DEBOUNCE_MS = 400

/** "As of <date>" badge for the always-latest basemap branch — the newest
 *  acq_time_latest among seamlines covering the current viewport center,
 *  same role as lib/bing.ts's useBingCaptureDate. No-ops (returns nulls)
 *  when apiKey is empty, so this is safe to call unconditionally before a
 *  real key exists. */
export function useMaxarLatestCaptureDate(apiKey: string, lat: number, lng: number): { label: string | null; dateMs: number | null; loading: boolean } {
  const [label, setLabel] = useState<string | null>(null)
  const [dateMs, setDateMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!apiKey) { setLabel(null); setDateMs(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const features = await fetchSeamlinesNearViewport(apiKey, lat, lng)
      if (cancelled) return
      const latest = features.reduce<number | null>((max, f) => {
        const t = Date.parse(f.acqTimeLatest)
        return isNaN(t) ? max : (max === null || t > max ? t : max)
      }, null)
      setDateMs(latest)
      setLabel(latest ? new Date(latest).toISOString().slice(0, 10) : null)
      setLoading(false)
    }, MAXAR_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [apiKey, lat, lng])

  return { label, dateMs, loading }
}

export interface MaxarSeamlineTick { dateMs: number; label: string }

/** Real per-location capture dates for the historical branch — distinct
 *  acq_time_latest values among seamlines covering the current viewport
 *  center, restricted to the given resolution tier (plan doc §3.3/§3.4).
 *  Same "real per-location dates" flavor as useWaybackRealCaptureDates/
 *  useGeHistoricalDates, not a synthetic fixed cadence. No-ops when apiKey
 *  is empty. */
export function useMaxarSeamlineTicks(apiKey: string, lat: number, lng: number, tier: MaxarResolutionTier): { ticks: MaxarSeamlineTick[]; loading: boolean } {
  const [ticks, setTicks] = useState<MaxarSeamlineTick[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!apiKey) { setTicks([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const features = await fetchSeamlinesNearViewport(apiKey, lat, lng, tier)
      if (cancelled) return
      const seenDates = new Set<number>()
      const result: MaxarSeamlineTick[] = []
      for (const f of features) {
        const t = Date.parse(f.acqTimeLatest)
        if (isNaN(t) || seenDates.has(t)) continue
        seenDates.add(t)
        result.push({ dateMs: t, label: new Date(t).toISOString().slice(0, 10) })
      }
      result.sort((a, b) => a.dateMs - b.dateMs)
      setTicks(result)
      setLoading(false)
    }, MAXAR_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [apiKey, lat, lng, tier])

  return { ticks, loading }
}
