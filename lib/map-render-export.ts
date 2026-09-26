import type * as maplibregl from "maplibre-gl"
import type { GeoBbox } from "./float-geotiff"

// Exports of what MapLibre draws, as opposed to the values behind it:
// hillshade and hypso are shaded on the GPU from the DEM, lighting and the
// coloured modes are colour ramps over values, the basemap is imagery. The
// only way to get them out as pixels is to render them. A render is only a
// georeferenced raster when the map is a flat, north-up Web Mercator view:
// then every canvas pixel is an axis-aligned cell in EPSG:3857.

const EARTH_RADIUS = 6378137
const mercX = (lng: number) => EARTH_RADIUS * (lng * Math.PI) / 180
const mercY = (lat: number) => EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** Why the current view cannot be exported as a georeferenced render, or
 *  null when it can. */
export function renderExportBlocker(map: maplibregl.Map): string | null {
  const projection = (map.getProjection?.() as { type?: unknown } | undefined)?.type
  if (projection && projection !== "mercator") return "Switch to 2D: a globe view is not a flat raster"
  if (map.getPitch() > 0.5) return "Switch to 2D: a tilted view is not a flat raster"
  if (Math.abs(map.getBearing()) > 0.01) return "Reset north: a rotated view does not line up with the grid"
  return null
}

/** The view's extent in EPSG:3857 metres, edge to edge of the canvas. */
function viewBbox3857(map: maplibregl.Map): GeoBbox {
  const c = map.getCanvas()
  const nw = map.unproject([0, 0])
  const se = map.unproject([c.clientWidth, c.clientHeight])
  return { west: mercX(nw.lng), north: mercY(nw.lat), east: mercX(se.lng), south: mercY(se.lat) }
}

const waitForIdle = (map: maplibregl.Map, timeoutMs: number) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, timeoutMs)
  map.once("idle", () => { clearTimeout(t); resolve() })
  map.triggerRepaint()
})

/** Renders the map with only the `keep` layers visible (all of them when
 *  `keep` is null), reads the canvas at its device resolution, and restores
 *  every layer's visibility. Hidden layers are switched with
 *  layout.visibility, which MapLibre also accepts for custom layers; their
 *  tiles stay in MapLibre's own tile cache and come back on restore. */
export async function renderLayers(map: maplibregl.Map, keep: Set<string> | null): Promise<{ rgba: Uint8ClampedArray; width: number; height: number; bbox: GeoBbox }> {
  const saved: [string, unknown][] = []
  if (keep) {
    for (const layer of map.getStyle().layers) {
      if (keep.has(layer.id)) continue
      const v = map.getLayoutProperty(layer.id, "visibility")
      if (v === "none") continue
      saved.push([layer.id, v])
      map.setLayoutProperty(layer.id, "visibility", "none")
    }
  }
  try {
    await waitForIdle(map, 30000)
    // preserveDrawingBuffer is on (TerrainViewer.tsx), so the canvas still
    // holds the frame that was just drawn.
    const gl = map.getCanvas()
    const out = document.createElement("canvas")
    out.width = gl.width
    out.height = gl.height
    const ctx = out.getContext("2d", { willReadFrequently: true })!
    ctx.drawImage(gl, 0, 0)
    return { rgba: ctx.getImageData(0, 0, out.width, out.height).data, width: out.width, height: out.height, bbox: viewBbox3857(map) }
  } finally {
    for (const [id, v] of saved) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", (v as "visible" | undefined) ?? "visible")
    }
    map.triggerRepaint()
  }
}

/** The zoom MapLibre is drawing a source's tiles at, or null when it has
 *  none on screen. Exporting at this zoom reads tiles already cached. */
export function displayedTileZoom(map: maplibregl.Map, sourceIds: string[]): number | null {
  const managers = (map as unknown as { style?: { tileManagers?: Record<string, { getVisibleCoordinates(): { canonical: { z: number } }[] }> } }).style?.tileManagers
  for (const id of sourceIds) {
    const z = managers?.[id]?.getVisibleCoordinates()[0]?.canonical.z
    if (z != null) return z
  }
  return null
}
