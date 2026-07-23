// Micro routing client for the Elevation Picker's "routed" mode — instead of a
// straight great-circle line between the two picks ("vol d'oiseau"), fetch an
// actual trail/path route between them from a public OSM routing API and sample
// the elevation profile along THAT geometry. Two engines, both free public
// endpoints, no key:
//  - BRouter (brouter.de) — the bikepacking/hiking community standard, elevation-
//    aware trail routing with named profiles. GeoJSON out.
//  - Valhalla (valhalla1.openstreetmap.de, FOSSGIS fair-use) — pedestrian/bicycle
//    costing, returns an encoded polyline (precision 6). NOTE: the bare
//    valhalla.openstreetmap.de host does NOT send CORS headers (browser fetch
//    fails); the numbered `valhalla1` backend does, so we hit that directly.
// We only take the geometry and sample elevation ourselves from the active DEM,
// so the profile always agrees with the rest of the app rather than each API's
// own elevation model.

export type RoutingEngine = "brouter" | "valhalla"
export type RoutingProfile = "foot" | "bike"

export interface RouteResult {
  /** Route geometry as [lng, lat] pairs. */
  coords: [number, number][]
  /** Total route length in metres, if the API reported it. */
  distanceM: number | null
}

// BRouter ships many profiles; these two are the sensible hiking / bike-touring
// defaults. Valhalla's costing model is coarser (just a travel mode).
const BROUTER_PROFILE: Record<RoutingProfile, string> = { foot: "hiking-mountain", bike: "trekking" }
const VALHALLA_COSTING: Record<RoutingProfile, string> = { foot: "pedestrian", bike: "bicycle" }

// Valhalla returns Google-style encoded polylines but at precision 6 (not the
// classic 5) — decode accordingly.
function decodePolyline6(str: string): [number, number][] {
  let index = 0, lat = 0, lng = 0
  const coords: [number, number][] = []
  const factor = 1e6
  while (index < str.length) {
    let shift = 0, result = 0, byte = 0
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)
    shift = 0; result = 0
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)
    coords.push([lng / factor, lat / factor])
  }
  return coords
}

export async function fetchRoute(
  engine: RoutingEngine,
  profile: RoutingProfile,
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
  signal?: AbortSignal,
): Promise<RouteResult> {
  if (engine === "brouter") {
    const url = `https://brouter.de/brouter?lonlats=${a.lng},${a.lat}|${b.lng},${b.lat}&profile=${BROUTER_PROFILE[profile]}&alternativeidx=0&format=geojson`
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`BRouter routing failed (${res.status})`)
    const gj = await res.json()
    const feat = gj?.features?.[0]
    const coords: [number, number][] = (feat?.geometry?.coordinates ?? []).map((c: number[]) => [c[0], c[1]])
    if (coords.length === 0) throw new Error("BRouter returned no route")
    const len = feat?.properties?.["track-length"]
    return { coords, distanceM: len != null ? Number(len) : null }
  }

  // Valhalla — POST-style request passed via the `json` query param (its GET API).
  const body = {
    locations: [{ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }],
    costing: VALHALLA_COSTING[profile],
    directions_options: { units: "kilometers" },
  }
  const url = `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(body))}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Valhalla routing failed (${res.status})`)
  const data = await res.json()
  const legs = data?.trip?.legs ?? []
  const coords: [number, number][] = []
  for (const leg of legs) if (typeof leg?.shape === "string") coords.push(...decodePolyline6(leg.shape))
  if (coords.length === 0) throw new Error("Valhalla returned no route")
  const km = data?.trip?.summary?.length
  return { coords, distanceM: km != null ? km * 1000 : null }
}

/** Resample a polyline to `n` points evenly spaced by arc length (planar approx,
 *  fine at the scale of a picked route) — keeps the elevation profile bounded and
 *  smooth no matter how many vertices the router returned. */
export function resamplePath(coords: [number, number][], n: number): [number, number][] {
  if (coords.length <= 1 || n <= 1) return coords.slice(0, Math.max(1, n))
  const cum = [0]
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0]
    const dy = coords[i][1] - coords[i - 1][1]
    cum.push(cum[i - 1] + Math.hypot(dx, dy))
  }
  const total = cum[cum.length - 1]
  if (total === 0) return [coords[0]]
  const out: [number, number][] = []
  let seg = 0
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1)
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++
    const segLen = cum[seg + 1] - cum[seg] || 1
    const t = (target - cum[seg]) / segLen
    out.push([
      coords[seg][0] + (coords[seg + 1][0] - coords[seg][0]) * t,
      coords[seg][1] + (coords[seg + 1][1] - coords[seg][1]) * t,
    ])
  }
  return out
}
