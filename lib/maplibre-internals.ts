import type { Map as MapLibreMap } from "maplibre-gl"

/** The map's transform, which MapLibre 6 moved off `Map` (Map now composes a
 *  Camera instead of extending it, and `map.transform` is gone). The camera
 *  sync in TerrainViewer.tsx still needs the transform's own setters - they
 *  do not call `stop()`, so they are safe while a pointer is held - as do
 *  the live GL layers (getProjectionData) and the bounds fence
 *  (setConstrainOverride). One accessor, so the next rename is one edit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTransform(map: MapLibreMap): any {
  const m = map as unknown as { transform?: unknown; _camera?: { transform?: unknown } }
  return m.transform ?? m._camera?.transform
}

/** Puts a read-only `map.transform` back on a MapLibre 6 map for plugins
 *  written against 5 (geogrid-maplibre-gl reads
 *  `map.transform.isLocationOccluded` on every move and threw on the switch
 *  to globe). A getter, so it always follows the camera's live transform;
 *  a no-op on 5, where the property already exists. */
export function ensureLegacyTransform(map: MapLibreMap): void {
  const m = map as unknown as { transform?: unknown; _camera?: { transform?: unknown } }
  if ("transform" in m || !m._camera) return
  Object.defineProperty(m, "transform", { configurable: true, get() { return this._camera?.transform } })
}
