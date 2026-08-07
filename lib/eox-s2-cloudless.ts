// EOX IT Services' "Sentinel-2 cloudless" — a free (non-commercial use,
// attribution required), no-API-key yearly true-color Sentinel-2 mosaic,
// served as a plain WMTS tile template. One mosaic per calendar year, not a
// continuous archive like Wayback/GE Historical — closer in spirit to
// Planet's monthly mosaics, just yearly instead of monthly. See
// https://s2maps.eu and https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml.
const EOX_S2_BASE = "https://tiles.maps.eox.at/wmts/1.0.0"

export const EOX_S2_TILE_SIZE = 256
// EOX's own capabilities doc caps this layer at zoom 14 — a global 10m-
// native mosaic doesn't hold up much past that anyway.
export const EOX_S2_MAXZOOM = 14

// Years EOX has actually published a s2cloudless-{year} layer for (confirmed
// against their WMTS capabilities) — note 2017 is missing from the series.
export const EOX_S2_YEARS = [2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]

/** Builds a MapLibre raster tile URL template for the given year's mosaic. */
export function eoxS2CloudlessTileUrl(year: number): string {
  return `${EOX_S2_BASE}/s2cloudless-${year}_3857/default/g/{z}/{y}/{x}.jpg`
}

/** One tick per published year, oldest first. Jan 4 (not Jan 1) — see the
 *  matching comment in lib/planet.ts: each synthetic monthly/yearly source
 *  uses a different day-of-month offset so their cadences never land on the
 *  exact same tick date (Planet/HLS's monthly ticks both include Jan 1 of
 *  every year). eoxS2CloudlessTileUrl only ever reads the year, so this is
 *  purely a display/positioning nudge. */
export function eoxS2CloudlessTicks(): { dateMs: number; label: string }[] {
  return EOX_S2_YEARS.map((year) => ({ dateMs: Date.UTC(year, 0, 4), label: String(year) }))
}
