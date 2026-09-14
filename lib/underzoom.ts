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
export function applyBoundedView(map: maplibregl.Map, bounds: LngLatBoundsTuple | null): void {
  ;(map.transform as unknown as { setConstrainOverride?: (fn: unknown) => void })
    ?.setConstrainOverride?.(bounds ? underzoom.transformConstrain : null)
  map.setMaxBounds(bounds ? [[bounds[0], bounds[1]], [bounds[2], bounds[3]]] : null)
}

/** fitBounds padding in px for this map, clamped so it can't exceed the frame. */
export function fitPaddingFor(map: maplibregl.Map): number {
  const el = map.getContainer()
  const shorter = Math.min(el.clientWidth, el.clientHeight)
  return Math.max(20, Math.min(Math.round(shorter * FIT_PADDING_RATIO), Math.floor(shorter / 2) - 1))
}
