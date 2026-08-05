// Harmonized Landsat Sentinel-2 (HLS) as a second historical/date-driven
// basemap source, alongside ESRI Wayback (lib/wayback.ts). Tiles come from
// the public NASA/VEDA titiler-cmr demo deployment, which composites
// on-the-fly true-color mosaics straight from NASA's Common Metadata
// Repository (CMR) — no fixed "release" catalog like Wayback has; any date
// works, and the server picks whatever granules exist in a window around it.
// This is a public, unauthenticated DEMO instance (not an SLA'd production
// service) — expect occasional slow tiles or downtime.
const TITILER_CMR_BASE = "https://openveda.cloud/api/titiler-cmr"

// HLSS30.002 (Sentinel-2-based Harmonized Landsat Sentinel surface
// reflectance), CMR concept id from LP DAAC. Picked over HLSL30 for its
// ~5-day revisit (vs ~16 for Landsat-only), giving a denser timeline for the
// same search window.
const HLS_COLLECTION_CONCEPT_ID = "C2021957295-LPCLOUD"

const HLS_WINDOW_DAYS = 15
// Sentinel-2 (and so HLSS30) coverage only becomes reliably dense from
// ~2016 onward — used purely to bound the synthetic tick range below, not a
// hard cutoff for what dates can be requested.
const HLS_COVERAGE_START_MS = Date.parse("2016-01-01T00:00:00Z")

// HLS surface reflectance bands are stored as raw scaled int16 DNs (scale
// factor 0.0001 → reflectance 0-1, so valid land-surface values top out
// around 3000-4000 out of a theoretical 0-10000 range) — titiler-cmr's
// /rasterio/tiles endpoint does NOT infer a sensible display range on its
// own; omitting `rescale` entirely left it stretching against the full
// int16 domain, crushing real reflectance values down to near-black. One
// `rescale=min,max` per requested band (titiler's own documented repeatable
// query-param format) fixes this — 0-3000 is the conventional natural-color
// stretch for Sentinel-2/HLS surface reflectance.
const HLS_RESCALE_RANGE = "0,3000"

/** Builds a MapLibre raster tile URL template for a true-color HLS mosaic
 *  centered on `centerDateMs`, compositing granules within a +/-15 day window. */
export function hlsTileUrl(centerDateMs: number): string {
  const start = new Date(centerDateMs - HLS_WINDOW_DAYS * 86_400_000).toISOString()
  const end = new Date(centerDateMs + HLS_WINDOW_DAYS * 86_400_000).toISOString()
  const params = new URLSearchParams({
    collection_concept_id: HLS_COLLECTION_CONCEPT_ID,
    temporal: `${start}/${end}`,
    assets_regex: "B0[2-4]",
    color_formula: "Gamma RGB 1.3 Saturation 1.5 Sigmoidal RGB 8 0.35",
  })
  params.append("assets", "B04")
  params.append("assets", "B03")
  params.append("assets", "B02")
  params.append("rescale", HLS_RESCALE_RANGE)
  params.append("rescale", HLS_RESCALE_RANGE)
  params.append("rescale", HLS_RESCALE_RANGE)
  return `${TITILER_CMR_BASE}/rasterio/tiles/WebMercatorQuad/{z}/{x}/{y}?${params.toString()}`
}

/** No per-location release catalog exists for HLS the way Wayback has one —
 *  this generates evenly-spaced monthly points across the archive's coverage
 *  span purely so the timeline has something to tick/scrub against. These are
 *  NOT verified real capture dates at any given spot (unlike Wayback's
 *  getWaybackItemsWithLocalChanges), just a placeholder cadence until
 *  per-tile CMR granule search is wired up as a follow-up. */
// Day 3 of the month (not day 1) — see the matching comment in
// lib/planet.ts: each synthetic monthly/yearly source uses a different
// day-of-month offset so their otherwise-identical cadences never land on
// the exact same tick date. hlsTileUrl only ever uses this as the CENTER of
// a +/-15 day search window, so a couple days' shift is immaterial to which
// granules actually get composited.
export function syntheticHlsTicks(): { dateMs: number; label: string }[] {
  const nowMs = Date.now()
  const ticks: { dateMs: number; label: string }[] = []
  const d = new Date(HLS_COVERAGE_START_MS)
  d.setUTCDate(3)
  while (d.getTime() <= nowMs) {
    ticks.push({ dateMs: d.getTime(), label: d.toISOString().slice(0, 7) })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return ticks
}
