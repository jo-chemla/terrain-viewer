// Attribution strings for the raster basemap sources in MapSources.tsx's
// RasterBasemapSource — most providers don't expose any way to know the real
// copyright holder for a given tile short of a fixed, provider-wide string
// (Planet/NASA-USGS/EOX below). Esri World Imagery (+ Wayback), Google Earth
// Historical, AND Bing all DO have a real per-location/zoom(/date)
// attribution — see useEsriDynamicAttribution here, useGeHistoricalDynamic-
// Attribution in lib/ge-historical.ts, and useBingDynamicAttribution in
// lib/bing.ts (Bing's real per-tile capture-date-range is a deliberately
// CORS-exposed response header on the tile image itself — no API key
// needed, unlike its official Imagery Metadata API's full per-provider
// contributor breakdown, which does). Rather than try to keep any of this
// live on the map's own corner control (which can't actually live-update —
// see the "esri"/"wayback" entries below), Esri/Wayback and GE Historical
// get a short static pointer here instead, with the real resolved value
// shown in the sidebar's Source Info section (SourceInfoSection.tsx, which
// also shows Bing's real date range there for the same reason).
import { useEffect, useState } from "react"

// Applied directly as each <Source>'s own `attribution` prop — MapLibre's
// AttributionControl reads it automatically.
export const STATIC_BASEMAP_ATTRIBUTIONS: Record<string, string> = {
  osm: "© OpenStreetMap contributors",
  google: "© Google",
  googlesat: "© Google",
  mapbox: "© Mapbox © OpenStreetMap",
  here: "© HERE",
  // Kept as a plain descriptive string (not a "see sidebar" pointer like
  // esri/wayback below) since useBingDynamicAttribution already falls back
  // to this exact string when no per-tile date is available — the Source's
  // own baseline attribution and the dynamic hook's fallback are the same
  // value, just not literally live-updated here (see header comment).
  bing: "© Microsoft Corporation, Earthstar Geographics SIO",
  hls: "NASA/USGS Harmonized Landsat Sentinel-2 (HLS)",
  planet: "© Planet Labs PBC",
  "eox-s2": "Sentinel-2 cloudless — Copernicus Sentinel data, processed by EOX IT Services GmbH",
  // These two DO have a real dynamic value (see header comment) — this
  // string is deliberately just a pointer to it, not the value itself,
  // since a <Source>'s `attribution` prop can never be live-updated post-
  // mount anyway (react-map-gl's updateSource has no case for it at all —
  // see the fuller explanation this used to carry, now in SourceInfoSection
  // and lib/ge-historical.ts instead).
  esri: "Esri, see dynamic attribution in source panel",
  wayback: "Esri, see dynamic attribution in source panel",
}

// -------------------------
// Esri World Imagery dynamic attribution
// -------------------------

interface EsriCoverageArea {
  // Confirmed against the live feed (not [west, south, east, north] as the
  // GeoJSON-bbox convention would suggest) — a global sample area came back
  // as [-84.94, -179.66, 84.94, 179.66], which only makes sense as lat/lng
  // pairs (positions 0/2 are latitude-range-shaped, 1/3 longitude-range-
  // shaped). Getting this backwards silently broke every regional/local
  // contributor match (a real lat/lng essentially never falls inside a
  // narrow bbox's OTHER axis), leaving only the handful of true-global
  // entries to ever match — which read as attribution being "stuck" on
  // whichever broad contributor happened to win, regardless of where you
  // actually panned to.
  bbox: [number, number, number, number] // [minLat, minLng, maxLat, maxLng]
  zoomMin: number
  zoomMax: number
  score: number
}

interface EsriContributor {
  attribution: string
  coverageAreas: EsriCoverageArea[]
}

// Esri publishes World Imagery's real contributor list (Maxar, Airbus,
// USDA, various state/local providers, etc.) as a public, keyless JSON feed
// — the same data that powers the "Powered by Esri | Maxar, ..." attribution
// on Esri's own World Imagery / Wayback web apps, which changes as you pan
// because different contributors cover different regions and zoom ranges.
// Catalog-wide and slowly-changing, so fetched once per session via a
// module-level cached promise (same pattern as lib/wayback.ts's
// cachedItemsPromise).
const ESRI_ATTRIBUTION_URL = "https://static.arcgis.com/attribution/World_Imagery"
let cachedContributorsPromise: Promise<EsriContributor[]> | null = null

function fetchEsriContributors(): Promise<EsriContributor[]> {
  if (!cachedContributorsPromise) {
    cachedContributorsPromise = fetch(ESRI_ATTRIBUTION_URL)
      .then((r) => r.json())
      .then((json) => (json?.contributors ?? []) as EsriContributor[])
      .catch(() => [])
    // Don't cache a failure — a transient network error shouldn't poison the
    // whole session (mirrors lib/wayback.ts's getCachedLocalChanges).
    cachedContributorsPromise.then((result) => { if (!result.length) cachedContributorsPromise = null })
  }
  return cachedContributorsPromise
}

// Generic, provider-wide fallback — shown while the fetch above is in
// flight, if it fails, or if no contributor's declared coverage happens to
// match this exact spot/zoom (their coverage data has gaps at some very
// remote locations). "Esri - " prefix matches the STATIC_BASEMAP_ATTRIBUTIONS
// style above (provider name first, e.g. "© Planet Labs PBC") — here the
// brand is Esri and the resolved contributor(s) are who actually captured
// the imagery within Esri's mosaic (e.g. "Esri - Vantor, Earthstar
// Geographics").
const ESRI_FALLBACK_CONTRIBUTORS = "Maxar, Earthstar Geographics"

function resolveEsriAttribution(contributors: EsriContributor[], lat: number, lng: number, zoom: number): string {
  const matches = contributors
    .flatMap((c) => c.coverageAreas
      .filter((a) => zoom >= a.zoomMin && zoom <= a.zoomMax && lat >= a.bbox[0] && lat <= a.bbox[2] && lng >= a.bbox[1] && lng <= a.bbox[3])
      .map((a) => ({ attribution: c.attribution, score: a.score })))
    .sort((a, b) => b.score - a.score)
  const names = [...new Set(matches.map((m) => m.attribution))]
  return `Esri - ${names.length ? names.join(", ") : ESRI_FALLBACK_CONTRIBUTORS}`
}

const ESRI_ATTRIBUTION_DEBOUNCE_MS = 400

/** Real, current-view attribution for Esri World Imagery / Wayback — updates
 *  as the map pans/zooms or a different location's Wayback release is picked,
 *  unlike the fixed strings in STATIC_BASEMAP_ATTRIBUTIONS above. Debounced
 *  on the same cadence as lib/wayback.ts's own location-keyed lookups so a
 *  fast pan doesn't fire a resolve on every intermediate frame. */
export function useEsriDynamicAttribution(lat: number, lng: number, zoom: number): string {
  const [attribution, setAttribution] = useState(`Esri - ${ESRI_FALLBACK_CONTRIBUTORS}`)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      fetchEsriContributors().then((contributors) => {
        if (!cancelled) setAttribution(resolveEsriAttribution(contributors, lat, lng, zoom))
      })
    }, ESRI_ATTRIBUTION_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [lat, lng, zoom])

  return attribution
}
