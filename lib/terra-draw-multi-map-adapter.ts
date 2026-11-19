import type * as maplibregl from "maplibre-gl"
import { TerraDrawExtend, type TerraDrawChanges, type TerraDrawStylingFunction, type SetCursor } from "terra-draw"

/**
 * One Terra Draw adapter over every view of the split.
 *
 * Terra Draw reaches the map through its adapter only: the adapter listens
 * for pointer and key events on one canvas and renders the store into td-*
 * layers on one map. The stock MapLibre adapter does both for a single map,
 * which is why drawing used to work on view A alone while B..H showed a
 * read-only copy. This one does both for a set of maps:
 *
 * - input: the same Terra Draw listeners on every map's canvas. The map an
 *   event comes from becomes the "current" map, and that event is projected
 *   with its camera (the views can differ in pitch, projection or terrain).
 * - output: the same td-* sources and layers on every map, styled once per
 *   render and pushed to each map.
 * - one store: features, selection and the shape in progress are shared, so
 *   a shape can be started on one view and finished on another.
 *
 * Maps come and go (a layout change mounts a view, leaving the split removes
 * one): attach() and detach() can be called at any time.
 *
 * It relies on two protected members of TerraDrawBaseAdapter (terra-draw
 * 1.37): `getAdapterListeners()` and each listener's public `callback`. The
 * base class would register those listeners on one element; here they are
 * added to every canvas instead.
 */

/**
 * One source per kind. "Guide" holds Terra Draw's helper points (selection
 * and mid-points, a shape's closing point): they change on every pointer
 * move, and in the same source as the drawn points each move would restyle
 * and resend all of those (64 ms a move with 32,751 points on four views,
 * measured 2026-11-19).
 */
type GeometryKind = "Point" | "Guide" | "LineString" | "Polygon"
const KINDS: GeometryKind[] = ["Polygon", "LineString", "Point", "Guide"]
const kindOf = (f: { geometry: { type: string }; properties: any }): GeometryKind =>
  f.geometry.type === "Point" ? (f.properties?.mode === "point" ? "Point" : "Guide") : (f.geometry.type as GeometryKind)
const noChange = () => ({ all: false, Point: false, Guide: false, LineString: false, Polygon: false })
const noData = (): Record<GeometryKind, Feature[]> => ({ Point: [], Guide: [], LineString: [], Polygon: [] })
type Feature = TerraDrawChanges["created"][number]
type Listener = { name: string; callback: (e: any) => void }

interface AttachedMap {
  map: maplibregl.Map
  canvas: HTMLCanvasElement
  dragPan: boolean
  dragRotate: boolean
  /** [event name, handler] pairs added to the canvas. */
  handlers: [string, (e: Event) => void][]
  onStyleData: () => void
}

/** Render timings of the last frames, for the dev console (window.__drawPerf). */
export const drawPerf = { renders: 0, lastMs: 0, maxMs: 0, lastFeatures: 0, lastMaps: 0, syncs: 0, lastSyncMs: 0 }

export class TerraDrawMultiMapAdapter extends TerraDrawExtend.TerraDrawBaseAdapter {
  private _prefix: string
  private _attached = new Map<maplibregl.Map, AttachedMap>()
  private _current: AttachedMap | null = null
  private _nextRender: number | undefined
  private _changed = noChange()
  /** What each source holds now, to fill a map attached later. */
  private _data = noData()
  /** The kind of every feature seen, so a deletion marks one source only. */
  private _kindById = new Map<string | number, GeometryKind>()
  private _visible = true
  private _opacity = 1

  constructor(config: { maps: maplibregl.Map[]; prefixId?: string } & TerraDrawExtend.BaseAdapterConfig) {
    super(config)
    this._prefix = config.prefixId || "td"
    for (const map of config.maps) this.attach(map)
  }

  // --- maps ---

  get maps(): maplibregl.Map[] { return [...this._attached.keys()] }
  has(map: maplibregl.Map): boolean { return this._attached.has(map) }

  attach(map: maplibregl.Map): void {
    if (this._attached.has(map)) return
    const entry: AttachedMap = {
      map,
      canvas: map.getCanvas(),
      dragPan: map.dragPan.isEnabled(),
      dragRotate: map.dragRotate.isEnabled(),
      handlers: [],
      onStyleData: () => this.onStyleData(entry),
    }
    this._attached.set(map, entry)
    if (!this._current) this._current = entry
    if (this._currentModeCallbacks) this.registerMap(entry)
  }

  detach(map: maplibregl.Map): void {
    const entry = this._attached.get(map)
    if (!entry) return
    this.unregisterMap(entry)
    this._attached.delete(map)
    if (this._current === entry) this._current = this._attached.values().next().value ?? null
  }

  private sourceId(kind: GeometryKind) { return `${this._prefix}-${kind.toLowerCase()}` }

  /** The style document is in (not isStyleLoaded(), which waits for every tile). */
  private styleReady(map: maplibregl.Map): boolean {
    return !!(map as any).style?._loaded
  }

  private registerMap(entry: AttachedMap): void {
    for (const l of this._listeners as unknown as Listener[]) {
      const handler = (e: Event) => { this.setCurrent(entry); l.callback(e) }
      entry.canvas.addEventListener(l.name, handler)
      entry.handlers.push([l.name, handler])
    }
    entry.map.on("styledata", entry.onStyleData)
    this.ensureLayers(entry)
  }

  private unregisterMap(entry: AttachedMap): void {
    for (const [name, handler] of entry.handlers) entry.canvas.removeEventListener(name, handler)
    entry.handlers = []
    // A map that was removed (the view unmounted) throws on any style call.
    try {
      entry.map.off("styledata", entry.onStyleData)
      for (const id of this.layerIds()) if (entry.map.getLayer(id)) entry.map.removeLayer(id)
      for (const kind of KINDS) if (entry.map.getSource(this.sourceId(kind))) entry.map.removeSource(this.sourceId(kind))
    } catch { /* map already gone */ }
  }

  private setCurrent(entry: AttachedMap): void {
    if (this._current === entry) return
    // Terra Draw's hover cursor stays on the view the pointer left otherwise.
    this._current?.canvas.style.removeProperty("cursor")
    this._current = entry
  }

  // --- layers ---

  private layerIds(): string[] {
    const p = this._prefix
    return [`${p}-polygon`, `${p}-polygon-outline`, `${p}-linestring`, `${p}-point`, `${p}-guide`]
  }

  private opacityOf(property: string): any {
    return this._opacity === 1 ? ["get", property] : ["*", ["get", property], this._opacity]
  }

  private paintOpacities(): [string, string, any][] {
    const p = this._prefix
    return [
      [`${p}-polygon`, "fill-opacity", this.opacityOf("polygonFillOpacity")],
      [`${p}-polygon-outline`, "line-opacity", this.opacityOf("polygonOutlineOpacity")],
      [`${p}-linestring`, "line-opacity", this.opacityOf("lineStringOpacity")],
      [`${p}-point`, "circle-opacity", this.opacityOf("pointOpacity")],
      [`${p}-point`, "circle-stroke-opacity", this.opacityOf("pointOutlineOpacity")],
      [`${p}-guide`, "circle-opacity", this.opacityOf("pointOpacity")],
      [`${p}-guide`, "circle-stroke-opacity", this.opacityOf("pointOutlineOpacity")],
    ]
  }

  /** Adds the td-* sources and layers when the map's style holds none (first
   *  attach, or a style reload that dropped them) and fills them. */
  private ensureLayers(entry: AttachedMap): void {
    const { map } = entry
    try {
      if (!this.styleReady(map) || map.getSource(this.sourceId("Point"))) return
      const p = this._prefix
      const visibility = this._visible ? "visible" : "none"
      for (const kind of KINDS) {
        map.addSource(this.sourceId(kind), { type: "geojson", data: { type: "FeatureCollection", features: this._data[kind] as any }, tolerance: 0 })
      }
      map.addLayer({
        id: `${p}-polygon`, source: `${p}-polygon`, type: "fill",
        layout: { "fill-sort-key": ["get", "zIndex"], visibility },
        paint: { "fill-color": ["get", "polygonFillColor"], "fill-opacity": this.opacityOf("polygonFillOpacity") },
      })
      map.addLayer({
        id: `${p}-polygon-outline`, source: `${p}-polygon`, type: "line",
        layout: { "line-sort-key": ["get", "zIndex"], visibility },
        paint: { "line-width": ["get", "polygonOutlineWidth"], "line-color": ["get", "polygonOutlineColor"], "line-opacity": this.opacityOf("polygonOutlineOpacity") },
      })
      map.addLayer({
        id: `${p}-linestring`, source: `${p}-linestring`, type: "line",
        layout: { "line-sort-key": ["get", "zIndex"], visibility },
        paint: { "line-width": ["get", "lineStringWidth"], "line-color": ["get", "lineStringColor"], "line-opacity": this.opacityOf("lineStringOpacity") },
      })
      for (const id of [`${p}-point`, `${p}-guide`]) {
        map.addLayer({
          id, source: id, type: "circle",
          layout: { "circle-sort-key": ["get", "zIndex"], visibility },
          paint: {
            "circle-radius": ["get", "pointWidth"], "circle-color": ["get", "pointColor"], "circle-opacity": this.opacityOf("pointOpacity"),
            "circle-stroke-color": ["get", "pointOutlineColor"], "circle-stroke-width": ["get", "pointOutlineWidth"], "circle-stroke-opacity": this.opacityOf("pointOutlineOpacity"),
          },
        })
      }
    } catch (e) { console.error("[TerraDraw] could not add the drawing layers:", e) }
  }

  /** After any style change: put the layers back if the style lost them, and
   *  keep them above layers added since (getLayersOrder is a cheap copy of
   *  the id list; getStyle() would serialise the whole style). */
  private onStyleData(entry: AttachedMap): void {
    if (!this._currentModeCallbacks) return
    const { map } = entry
    try {
      if (!this.styleReady(map)) return
      this.ensureLayers(entry)
      const order = map.getLayersOrder()
      const ids = this.layerIds()
      const top = order.slice(-ids.length)
      if (ids.every((id, i) => top[i] === id)) return
      for (const id of ids) if (map.getLayer(id)) map.moveLayer(id)
    } catch { /* style mid-swap */ }
  }

  /** The Drawings panel's show checkbox, on every view. */
  setVisible(visible: boolean): void {
    this._visible = visible
    for (const { map } of this._attached.values()) {
      for (const id of this.layerIds()) {
        try { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none") } catch { }
      }
    }
  }

  /** The Drawings panel's opacity slider, on every view: a factor on each
   *  feature's own opacity, so a layer's alpha and a hidden layer stand. */
  setOpacity(opacity: number): void {
    this._opacity = opacity
    const paints = this.paintOpacities()
    for (const { map } of this._attached.values()) {
      for (const [id, property, value] of paints) {
        try { if (map.getLayer(id)) map.setPaintProperty(id, property as any, value) } catch { }
      }
    }
  }

  // --- TerraDrawBaseAdapter ---

  register(callbacks: TerraDrawExtend.TerraDrawCallbacks): void {
    this._currentModeCallbacks = callbacks
    this._listeners = this.getAdapterListeners()
    for (const entry of this._attached.values()) this.registerMap(entry)
    callbacks.onReady?.()
  }

  unregister(): void {
    if (this._nextRender) { cancelAnimationFrame(this._nextRender); this._nextRender = undefined }
    for (const entry of this._attached.values()) this.unregisterMap(entry)
    this._data = noData()
    this._changed = noChange()
    this._kindById.clear()
    this._currentModeCallbacks?.onClear()
    this._currentModeCallbacks = undefined
    this._lastDrawEvent = undefined
    this._listeners = []
  }

  getMapEventElement(): HTMLElement {
    return this._current!.canvas
  }

  getLngLatFromEvent(event: PointerEvent | MouseEvent): { lng: number; lat: number } {
    const { left, top } = this._current!.canvas.getBoundingClientRect()
    return this.unproject(event.clientX - left, event.clientY - top)
  }

  project(lng: number, lat: number): { x: number; y: number } {
    const { x, y } = this._current!.map.project({ lng, lat })
    return { x, y }
  }

  unproject(x: number, y: number): { lng: number; lat: number } {
    const { lng, lat } = this._current!.map.unproject({ x, y } as any)
    return { lng, lat }
  }

  setCursor(cursor: Parameters<SetCursor>[0]): void {
    const canvas = this._current?.canvas
    if (!canvas) return
    if (cursor === "unset") canvas.style.removeProperty("cursor")
    else canvas.style.cursor = cursor
  }

  /** Every view: a drag that starts on one view can end on another, and the
   *  one it ends on is the one Terra Draw re-enables. */
  setDraggability(enabled: boolean): void {
    for (const { map, dragPan, dragRotate } of this._attached.values()) {
      try {
        if (dragRotate) { if (enabled) map.dragRotate.enable(); else map.dragRotate.disable() }
        if (dragPan) { if (enabled) map.dragPan.enable(); else map.dragPan.disable() }
      } catch { }
    }
  }

  setDoubleClickToZoom(enabled: boolean): void {
    for (const { map } of this._attached.values()) {
      try { if (enabled) map.doubleClickZoom.enable(); else map.doubleClickZoom.disable() } catch { }
    }
  }

  render(changes: TerraDrawChanges, styling: TerraDrawStylingFunction): void {
    const changed = this._changed
    for (const f of changes.created) { const k = kindOf(f); changed[k] = true; if (f.id != null) this._kindById.set(f.id, k) }
    for (const f of changes.updated) { const k = kindOf(f); changed[k] = true; if (f.id != null) this._kindById.set(f.id, k) }
    for (const id of changes.deletedIds) {
      const k = this._kindById.get(id)
      if (k) { changed[k] = true; this._kindById.delete(id) } else changed.all = true
    }
    // No change at all is a restyle (a layer's colour, a mode's options).
    if (!changes.created.length && !changes.updated.length && !changes.deletedIds.length) changed.all = true

    if (this._nextRender) cancelAnimationFrame(this._nextRender)
    this._nextRender = requestAnimationFrame(() => {
      this._nextRender = undefined
      if (!this._currentModeCallbacks) return
      const t0 = performance.now()
      const all = changed.all
      const dirty: Record<GeometryKind, boolean> = {
        Point: all || changed.Point, Guide: all || changed.Guide, LineString: all || changed.LineString, Polygon: all || changed.Polygon,
      }
      const next = noData()
      // Only the kinds that changed are styled and sent again: moving one
      // vertex of a line beside 30,000 points restyles no point.
      let count = 0
      for (const list of [changes.created, changes.updated, changes.unchanged]) {
        for (let i = 0; i < list.length; i++) {
          const feature = list[i]
          const kind = kindOf(feature)
          if (!dirty[kind]) continue
          const properties = feature.properties as Record<string, unknown>
          const style = styling[properties.mode as string](feature)
          properties.zIndex = style.zIndex
          if (kind === "Point" || kind === "Guide") {
            properties.pointColor = style.pointColor
            properties.pointOutlineColor = style.pointOutlineColor
            properties.pointOutlineWidth = style.pointOutlineWidth
            properties.pointOutlineOpacity = style.pointOutlineOpacity ?? 1
            properties.pointWidth = style.pointWidth
            properties.pointOpacity = style.pointOpacity ?? 1
          } else if (kind === "LineString") {
            properties.lineStringColor = style.lineStringColor
            properties.lineStringWidth = style.lineStringWidth
            properties.lineStringOpacity = style.lineStringOpacity ?? 1
          } else {
            properties.polygonFillColor = style.polygonFillColor
            properties.polygonFillOpacity = style.polygonFillOpacity
            properties.polygonOutlineColor = style.polygonOutlineColor
            properties.polygonOutlineWidth = style.polygonOutlineWidth
            properties.polygonOutlineOpacity = style.polygonOutlineOpacity ?? 1
          }
          next[kind].push(feature)
          count++
        }
      }
      for (const kind of KINDS) {
        if (!dirty[kind]) continue
        this._data[kind] = next[kind]
        const data = { type: "FeatureCollection" as const, features: next[kind] as any }
        for (const { map } of this._attached.values()) {
          try { (map.getSource(this.sourceId(kind)) as maplibregl.GeoJSONSource | undefined)?.setData(data) } catch { }
        }
      }
      this._changed = noChange()
      const ms = performance.now() - t0
      drawPerf.renders++
      drawPerf.lastMs = ms
      drawPerf.maxMs = Math.max(drawPerf.maxMs, ms)
      drawPerf.lastFeatures = count
      drawPerf.lastMaps = this._attached.size
    })
  }

  clear(): void {
    if (!this._currentModeCallbacks) return
    this._currentModeCallbacks.onClear()
    if (this._nextRender) { cancelAnimationFrame(this._nextRender); this._nextRender = undefined }
    this._data = noData()
    this._kindById.clear()
    const empty = { type: "FeatureCollection" as const, features: [] }
    for (const { map } of this._attached.values()) {
      for (const kind of KINDS) {
        try { (map.getSource(this.sourceId(kind)) as maplibregl.GeoJSONSource | undefined)?.setData(empty) } catch { }
      }
    }
  }
}
