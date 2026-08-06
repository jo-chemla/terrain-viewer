// Attribution strings for the raster basemap sources in MapSources.tsx's
// RasterBasemapSource — most providers don't expose any way to know the real
// copyright holder for a given tile short of a fixed, provider-wide string
// (Planet/NASA-USGS/EOX/Google Earth below); Esri World Imagery (and Wayback,
// its historical-release sibling) is the one exception with a genuinely
// dynamic, publicly-queryable per-location/zoom attribution — see
// useEsriDynamicAttribution below.

import { useEffect, useState } from "react"

// Every non-Esri basemap id gets a fixed string here, applied directly as
// the <Source>'s own `attribution` prop (MapLibre's AttributionControl reads
// it automatically). "esri" and "wayback" are deliberately absent — they're
// rendered through the dynamic badge instead (see MapControls/
// DynamicAttributionBadge.tsx) so the generic fallback text below never sits
// next to a more precise, already-resolved dynamic string for the same
// source.
export const STATIC_BASEMAP_ATTRIBUTIONS: Record<string, string> = {
  osm: "© OpenStreetMap contributors",
  google: "© Google",
  googlesat: "© Google",
  mapbox: "© Mapbox © OpenStreetMap",
  here: "© HERE",
  // Bing's own Imagery Metadata API can report real per-location contributor
  // attribution the same way Esri's does below, but it requires a Bing Maps
  // API key (a different credential from the public quadkey tile endpoint
  // this app already uses) that isn't currently configured anywhere in this
  // app — see the header comment on useEsriDynamicAttribution for why a key
  // is unavoidable there. Static fallback until one is added.
  bing: "© Microsoft Corporation, Earthstar Geographics SIO",
  hls: "NASA/USGS Harmonized Landsat Sentinel-2 (HLS)",
  planet: "© Planet Labs PBC",
  "eox-s2": "Sentinel-2 cloudless — Copernicus Sentinel data, processed by EOX IT Services GmbH",
  // "ge-historical" isn't here — lib/ge-historical.ts's geHistoricalTileSource
  // already returns its own `attribution` ("Imagery © Google") straight from
  // the vendored ge-timemachine client, and MapSources.tsx passes that
  // through untouched.
}

// -------------------------
// Esri World Imagery dynamic attribution
// -------------------------

interface EsriCoverageArea {
  bbox: [number, number, number, number] // [west, south, east, north]
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
      .filter((a) => zoom >= a.zoomMin && zoom <= a.zoomMax && lng >= a.bbox[0] && lng <= a.bbox[2] && lat >= a.bbox[1] && lat <= a.bbox[3])
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
