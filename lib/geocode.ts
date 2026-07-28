// Reverse geocoding for default bookmark names ("France - Paris") — reuses
// Photon (komoot), the same free/no-key OSM-based geocoder
// MapControls/GeocoderControl.tsx already uses for the search box, just its
// /reverse endpoint instead of the forward one.

interface PhotonProperties {
  name?: string
  city?: string
  state?: string
  county?: string
  country?: string
}

/** "Country - Region/City" (e.g. "France - Paris"), or null if the lookup
 *  fails or returns nothing usable — callers should fall back to a
 *  non-geocoded default name in that case. */
export async function reverseGeocodeLabel(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`, { signal })
    const data = await res.json()
    const p: PhotonProperties | undefined = data?.features?.[0]?.properties
    if (!p) return null
    const region = p.city ?? p.state ?? p.county ?? p.name
    const country = p.country
    if (country && region && country !== region) return `${country} - ${region}`
    return country ?? region ?? null
  } catch {
    return null
  }
}
