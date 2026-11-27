import { useControl } from "react-map-gl/maplibre"
import { AttributionControl as MaplibreAttributionControl, type Map as MaplibreMap } from "maplibre-gl"
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
 *
 * One line for the whole split. The vendor control credits the sources of
 * the map it sits on; here that is the bottom-right view only, so a basemap,
 * a terrain or an overlay shown in another view alone went uncredited.
 * `views` gives the maps of every visible view: before each update, the
 * credits of the sources the other views draw (the vendor's own rule: a
 * source a visible layer or the terrain uses) are handed over as
 * `customAttribution`, which the vendor merges and de-duplicates with its
 * own. The other maps' style, source and terrain events refresh the line.
 */
type WatchedMap = MaplibreMap & { style?: { tileManagers?: Record<string, { used?: boolean; usedForTerrain?: boolean; getSource(): { attribution?: string } }> } }

class CollapsedAttributionControl extends MaplibreAttributionControl {
  views: () => (MaplibreMap | null | undefined)[] = () => []
  private watched = new Set<MaplibreMap>()

  private watch(maps: MaplibreMap[]): void {
    for (const m of this.watched) if (!maps.includes(m)) { this.unwatch(m); this.watched.delete(m) }
    for (const m of maps) {
      if (this.watched.has(m)) continue
      m.on("styledata", this._updateData)
      m.on("sourcedata", this._updateData)
      m.on("terrain", this._updateData)
      this.watched.add(m)
    }
  }

  private unwatch(m: MaplibreMap): void {
    m.off("styledata", this._updateData)
    m.off("sourcedata", this._updateData)
    m.off("terrain", this._updateData)
  }

  _updateAttributions(): void {
    if (!this._map) return
    const others = this.views().filter((m): m is MaplibreMap => !!m && m !== this._map)
    this.watch(others)
    const credits: string[] = []
    for (const m of others) {
      const managers = (m as WatchedMap).style?.tileManagers ?? {}
      for (const id in managers) {
        const manager = managers[id]
        if (!manager.used && !manager.usedForTerrain) continue
        const credit = manager.getSource()?.attribution
        if (credit && !credits.includes(credit)) credits.push(credit)
      }
    }
    this.options.customAttribution = credits
    super._updateAttributions()
  }

  // A layout change (a view added or removed) resizes this map: the line is
  // recomputed for the views now on screen.
  private onResize = (): void => { this._updateAttributions() }

  onAdd(map: MaplibreMap): HTMLElement {
    const el = super.onAdd(map)
    map.on("resize", this.onResize)
    return el
  }

  onRemove(): void {
    this._map?.off("resize", this.onResize)
    for (const m of this.watched) this.unwatch(m)
    this.watched.clear()
    super.onRemove()
  }

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

export default function AttributionControlCollapsed({ position = "bottom-right", views }: {
  position?: ControlPosition
  /** The maps of every visible view (a stable getter): their sources are credited too. */
  views?: () => (MaplibreMap | null | undefined)[]
}) {
  useControl(() => {
    const control = new CollapsedAttributionControl({ compact: true })
    if (views) control.views = views
    return control
  }, { position })
  return null
}
