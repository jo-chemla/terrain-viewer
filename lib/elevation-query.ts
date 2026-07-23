// Single-point elevation lookup for the Elevation Picker tool. Two distinct paths:
//
// - 3D/globe: MapLibre already decodes whatever raster-dem source is active via
//   `map.setTerrain()` (see TerrainViewer.tsx), so `map.queryTerrainElevation()` is
//   the source of truth — no re-fetching/decoding needed. It returns null when no
//   terrain is set, which is exactly the 2D case (TerrainViewer.tsx calls
//   `setTerrain(null)` there), so callers should route by view mode rather than
//   treating a null result as "try harder".
// - 2D: no terrain object exists, so we sample the same way lib/client-export.ts
//   exports a full bbox — fetch just the one tile (TMS) or windowed pixel (COG)
//   under the cursor and decode it, reusing those exact decoders so the two code
//   paths can never disagree about encoding.

import type { Map as MapLibreMap } from "maplibre-gl"
import { terrainrgbToElevation, terrariumToElevation } from "./elevation-encoding"
import { fetchTileMosaic, pickZoomForResolution } from "./tile-mosaic"
import { sampleCogPointElevation, type ClientExportSource } from "./client-export"

export interface ProfilePoint {
  lng: number
  lat: number
  /** Cumulative great-circle distance from the first point, in metres. */
  distanceM: number
  elevation: number | null
}

/** Divides out the terrain's exaggeration multiplier so the returned value is a
 *  true elevation in meters, matching what the 2D tile-sampling path returns. */
export function queryTerrainElevationAtPoint(
  map: MapLibreMap,
  lng: number,
  lat: number,
  exaggeration: number,
): number | null {
  const raw = map.queryTerrainElevation([lng, lat])
  if (raw === null || raw === undefined) return null
  return raw / (exaggeration || 1)
}

/** Fetches+decodes just the single tile/pixel under a point — the 2D-mode
 *  counterpart to lib/client-export.ts's full-bbox export. */
export async function sampleClientElevationAtPoint(
  source: ClientExportSource,
  lng: number,
  lat: number,
): Promise<number | null> {
  if (source.type === "cog") {
    return sampleCogPointElevation(source.url, lng, lat)
  }

  const eps = 1e-9
  const decodePixel = source.type === "terrainrgb" ? terrainrgbToElevation : terrariumToElevation

  // A source's declared maxzoom isn't always backed by 100% coverage at every
  // point (e.g. Mapterhorn declares 18 but plenty of real locations only go to
  // 17) — walk down the pyramid on 404, same as how MapLibre's own raster-dem
  // "overzoom" falls back to an ancestor tile, so a coverage gap at the exact
  // maxzoom doesn't make the whole point unreadable.
  let mosaic: Awaited<ReturnType<typeof fetchTileMosaic>> | null = null
  for (let zoom = source.maxzoom; zoom >= Math.max(0, source.maxzoom - 6); zoom--) {
    try {
      mosaic = await fetchTileMosaic({
        tileUrlTemplate: source.url,
        tileSize: source.tileSize,
        bbox: [lng - eps, lat - eps, lng + eps, lat + eps],
        zoom,
        decodePixel,
      })
      break
    } catch (err) {
      if (err instanceof Error && /\(404\)/.test(err.message)) continue
      throw err
    }
  }
  if (!mosaic) return null

  const { data, width, height, bbox } = mosaic
  const [west, south, east, north] = bbox
  const px = Math.min(width - 1, Math.max(0, Math.floor(((lng - west) / (east - west)) * width)))
  const py = Math.min(height - 1, Math.max(0, Math.floor(((north - lat) / (north - south)) * height)))
  const value = data[py * width + px]
  return Number.isFinite(value) ? value : null
}

/** Samples elevation at `samples` evenly-spaced points along the segment a→b.
 *  For a TMS source this fetches ONE tile mosaic covering the whole line's bbox
 *  and reads every sample out of it, instead of the naive one-tile-fetch-per-point
 *  the single-point sampler does — so a 150-sample profile costs a handful of tile
 *  fetches, not 150. COG has no cheap mosaic path, so it falls back to per-point
 *  windowed reads. Returns a raw elevation array aligned with the sample indices
 *  (the caller attaches lng/lat/distance); nulls mark no-data / out-of-coverage. */
export async function sampleClientElevationProfile(
  source: ClientExportSource,
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
  samples: number,
): Promise<(number | null)[]> {
  const lerpLng = (t: number) => a.lng + (b.lng - a.lng) * t
  const lerpLat = (t: number) => a.lat + (b.lat - a.lat) * t
  const tAt = (i: number) => (samples <= 1 ? 0 : i / (samples - 1))

  if (source.type === "cog") {
    const out: (number | null)[] = []
    for (let i = 0; i < samples; i++) {
      try {
        out.push(await sampleCogPointElevation(source.url, lerpLng(tAt(i)), lerpLat(tAt(i))))
      } catch {
        out.push(null)
      }
    }
    return out
  }

  const eps = 1e-9
  const west = Math.min(a.lng, b.lng) - eps
  const east = Math.max(a.lng, b.lng) + eps
  const south = Math.min(a.lat, b.lat) - eps
  const north = Math.max(a.lat, b.lat) + eps
  const bbox: [number, number, number, number] = [west, south, east, north]
  const decodePixel = source.type === "terrainrgb" ? terrainrgbToElevation : terrariumToElevation

  // Enough grid resolution to resolve every sample without over-fetching: for a
  // short line pickZoomForResolution saturates at maxzoom (a tile or two); for a
  // long one it drops to a coarser zoom so the mosaic stays a handful of tiles.
  const targetPx = Math.max(64, Math.min(1024, samples * 2))
  const startZoom = Math.min(source.maxzoom, pickZoomForResolution(bbox, targetPx, targetPx, source.tileSize, source.maxzoom))

  let mosaic: Awaited<ReturnType<typeof fetchTileMosaic>> | null = null
  for (let zoom = startZoom; zoom >= Math.max(0, startZoom - 6); zoom--) {
    try {
      mosaic = await fetchTileMosaic({ tileUrlTemplate: source.url, tileSize: source.tileSize, bbox, zoom, decodePixel })
      break
    } catch (err) {
      if (err instanceof Error && /\(404\)/.test(err.message)) continue
      throw err
    }
  }
  if (!mosaic) return new Array(samples).fill(null)

  const { data, width, height, bbox: mb } = mosaic
  const [mWest, mSouth, mEast, mNorth] = mb
  const out: (number | null)[] = []
  for (let i = 0; i < samples; i++) {
    const lng = lerpLng(tAt(i))
    const lat = lerpLat(tAt(i))
    const px = Math.min(width - 1, Math.max(0, Math.floor(((lng - mWest) / (mEast - mWest)) * width)))
    const py = Math.min(height - 1, Math.max(0, Math.floor(((mNorth - lat) / (mNorth - mSouth)) * height)))
    const v = data[py * width + px]
    out.push(Number.isFinite(v) ? v : null)
  }
  return out
}

/** Like sampleClientElevationProfile but along an arbitrary polyline (a routed
 *  path, not a straight segment) — one mosaic covering the whole path's bbox for
 *  TMS, per-point windowed reads for COG. `coords` is [lng, lat] pairs, assumed
 *  already resampled to a bounded count by the caller (see lib/routing.ts's
 *  resamplePath). Returns elevations aligned with `coords`. */
export async function sampleClientElevationPath(
  source: ClientExportSource,
  coords: [number, number][],
): Promise<(number | null)[]> {
  if (coords.length === 0) return []

  if (source.type === "cog") {
    const out: (number | null)[] = []
    for (const [lng, lat] of coords) {
      try { out.push(await sampleCogPointElevation(source.url, lng, lat)) } catch { out.push(null) }
    }
    return out
  }

  const eps = 1e-9
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  for (const [lng, lat] of coords) {
    west = Math.min(west, lng); east = Math.max(east, lng)
    south = Math.min(south, lat); north = Math.max(north, lat)
  }
  const bbox: [number, number, number, number] = [west - eps, south - eps, east + eps, north + eps]
  const decodePixel = source.type === "terrainrgb" ? terrainrgbToElevation : terrariumToElevation
  const targetPx = Math.max(128, Math.min(2048, coords.length * 4))
  const startZoom = Math.min(source.maxzoom, pickZoomForResolution(bbox, targetPx, targetPx, source.tileSize, source.maxzoom))

  let mosaic: Awaited<ReturnType<typeof fetchTileMosaic>> | null = null
  for (let zoom = startZoom; zoom >= Math.max(0, startZoom - 6); zoom--) {
    try {
      mosaic = await fetchTileMosaic({ tileUrlTemplate: source.url, tileSize: source.tileSize, bbox, zoom, decodePixel })
      break
    } catch (err) {
      if (err instanceof Error && /\(404\)/.test(err.message)) continue
      throw err
    }
  }
  if (!mosaic) return new Array(coords.length).fill(null)

  const { data, width, height, bbox: mb } = mosaic
  const [mWest, mSouth, mEast, mNorth] = mb
  return coords.map(([lng, lat]) => {
    const px = Math.min(width - 1, Math.max(0, Math.floor(((lng - mWest) / (mEast - mWest)) * width)))
    const py = Math.min(height - 1, Math.max(0, Math.floor(((mNorth - lat) / (mNorth - mSouth)) * height)))
    const v = data[py * width + px]
    return Number.isFinite(v) ? v : null
  })
}
