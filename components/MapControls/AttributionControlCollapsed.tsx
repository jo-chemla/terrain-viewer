import { useControl } from "react-map-gl/maplibre"
import { AttributionControl as MaplibreAttributionControl } from "maplibre-gl"
import type { ControlPosition } from "react-map-gl/maplibre"

/**
 * MapLibre's attribution control, always compact and only ever opened by the
 * user.
 *
 * The vendor control opens itself: `_updateCompact` sets `open` and
 * `maplibregl-compact-show` the first time attribution text arrives (and on
 * a wide map with `compact: false`, always). This app mounts the control on
 * whichever view sits bottom-right, so it is re-created on layout changes;
 * at `onAdd` it computes the credits while its container is still detached,
 * so a MutationObserver on the document never saw that opening and the box
 * came up expanded across the map (with the Maya renders on, a paragraph).
 *
 * Here `_updateCompact` (an arrow-function field the control calls after
 * every credit change and on resize) only keeps the compact class and closes
 * the `<details>` unless the user opened it. The user's own clicks still go
 * through the vendor's `_toggleAttribution` plus the native `<details>`
 * toggle: shown is `open` + `maplibregl-compact-show`, collapsed is neither.
 */
class CollapsedAttributionControl extends MaplibreAttributionControl {
  _updateCompact = (): void => {
    const el = this._container
    if (!el) return
    el.classList.add("maplibregl-compact")
    if (!el.classList.contains("maplibregl-compact-show")) el.removeAttribute("open")
  }

  // A map drag folds an opened box, as the vendor does, but closes the
  // <details> too: the vendor leaves `open` set, and the next click on the
  // "i" then toggles the two out of step (class shown, details closed).
  _updateCompactMinimize = (): void => {
    const el = this._container
    if (!el?.classList.contains("maplibregl-compact-show")) return
    el.classList.remove("maplibregl-compact-show")
    el.removeAttribute("open")
  }
}

export default function AttributionControlCollapsed({ position = "bottom-right" }: { position?: ControlPosition }) {
  useControl(() => new CollapsedAttributionControl({ compact: true }), { position })
  return null
}
