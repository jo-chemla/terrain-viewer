import maplibregl from "maplibre-gl"
import { Underzoom } from "maplibre-xy"
import type { LngLatBoundsTuple } from "./max-bounds"

/**
 * Single shared Underzoom instance (maplibre-xy). It has to be shared because
 * two places need it: TerrainViewer applies it whenever the resolved map bounds
 * change, and the terrain source picker applies it a beat EARLIER — before its
 * fitBounds — since that fit runs synchronously from the click while the
 * TerrainViewer effect only re-resolves a tick later.
 *
 * extendScale is the whole reason a country ever fits on screen. maplibre's own
 * constrain insists the bounds COVER the viewport, so on a wide screen a tall
 * country can never be seen whole. Underzoom relaxes that to "the bounds may
 * shrink to `extendScale` of the viewport before I pull you back in".
 *
 * 0.6 is deliberate, not a default. With 1.0 the bounds are allowed to shrink to
 * exactly the viewport and no further — which silently cancels any fitBounds
 * padding, because the constrain immediately zooms back in to re-fill the frame.
 * At 0.6 a country may occupy 60% of the viewport, which leaves room for the
 * ~12% per-side padding the picker asks for and still leaves margin beyond it.
 */
export const underzoom = new Underzoom(maplibregl, { extendScale: 0.6, extendPan: 0.2 })

/** Padding fitBounds should use, as a fraction of the smaller viewport side. */
export const FIT_PADDING_RATIO = 0.12

/**
 * Point a map at a bounded extent: relaxed constrain first, then the bounds
 * themselves, so the new fence is evaluated against the relaxed rule rather
 * than snapping to stock behaviour for a frame. Pass null to release both.
 */
export function applyBoundedView(map: maplibregl.Map, rawBounds: LngLatBoundsTuple | null): void {
  const bounds = sanitizeBounds(rawBounds)
  ;(map.transform as unknown as { setConstrainOverride?: (fn: unknown) => void })
    ?.setConstrainOverride?.(bounds ? underzoom.transformConstrain : null)
  map.setMaxBounds(bounds ? [[bounds[0], bounds[1]], [bounds[2], bounds[3]]] : null)
}

const MAX_LAT = 85.051129

/** A footprint read from a file can poke past the world (GEDTM30's is
 *  -180.00125..180.00125 by -65..85.00125): maplibre's constrain then
 *  divides by an empty extent and throws inside setMaxBounds. Clamp to the
 *  Mercator world, and treat a footprint that IS the world as no constraint. */
export function sanitizeBounds(b: LngLatBoundsTuple | null): LngLatBoundsTuple | null {
  if (!b || b.some((v) => !Number.isFinite(v))) return null
  const west = Math.max(-180, Math.min(180, b[0])), east = Math.max(-180, Math.min(180, b[2]))
  const south = Math.max(-MAX_LAT, Math.min(MAX_LAT, b[1])), north = Math.max(-MAX_LAT, Math.min(MAX_LAT, b[3]))
  if (east - west < 1e-6 || north - south < 1e-6) return null
  // A full longitude span is the case maplibre's constrain cannot handle
  // (its lngRange maths divides by the wrapped width and returns null): a
  // worldwide file constrains nothing horizontally, so constrain nothing.
  if (east - west >= 359.9) return null
  return [west, south, east, north]
}

/** fitBounds padding in px for this map, clamped so it can't exceed the frame. */
export function fitPaddingFor(map: maplibregl.Map): number {
  const el = map.getContainer()
  const shorter = Math.min(el.clientWidth, el.clientHeight)
  return Math.max(20, Math.min(Math.round(shorter * FIT_PADDING_RATIO), Math.floor(shorter / 2) - 1))
}
