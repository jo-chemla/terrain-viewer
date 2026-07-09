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
import { fetchTileMosaic } from "./tile-mosaic"
import { exportCogWindow, type ClientExportSource } from "./client-export"

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
    // A literal zero-size bbox trips up geotiff.js's windowed read — pad by a
    // sub-meter epsilon so it still resolves to (effectively) this exact pixel.
    const eps = 1e-6
    const result = await exportCogWindow(source.url, [lng - eps, lat - eps, lng + eps, lat + eps], 1, 1)
    const value = result.data[0]
    return Number.isFinite(value) ? value : null
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
