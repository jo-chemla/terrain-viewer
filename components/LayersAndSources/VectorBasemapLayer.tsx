import type React from "react"
import { useEffect } from "react"
import { useMap } from "react-map-gl/maplibre"
import type { StyleSpecification, LayerSpecification, SourceSpecification } from "maplibre-gl"
import { LAYER_SLOTS } from "./MapLayers"

/**
 * OpenFreeMap's Liberty style (OpenMapTiles schema, no key) as the "OSM"
 * basemap, in place of the raster osm.org tiles. The map's own style has no
 * glyphs or sprite, so the style's are installed on the map, then Liberty's
 * sources and its ~110 layers are inserted at the basemap slot, ids prefixed
 * so they never collide with ours. Everything is removed again on unmount.
 * Fetched once per session.
 */
export const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"
const PREFIX = "ofm-liberty-"

let stylePromise: Promise<StyleSpecification> | null = null
const loadStyle = () => (stylePromise ??= fetch(LIBERTY_STYLE_URL).then((r) => r.json() as Promise<StyleSpecification>).catch((e) => { stylePromise = null; throw e }))

export const VectorBasemapLayer: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => {
  const { current: mapRef } = useMap()

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    let cancelled = false
    const added: { sources: string[]; layers: string[] } = { sources: [], layers: [] }
    const install = (style: StyleSpecification) => {
      if (cancelled || !map.getStyle()) return
      if (style.glyphs && !map.getGlyphs()) map.setGlyphs(style.glyphs)
      if (style.sprite && !map.getSprite()?.length) map.setSprite(style.sprite as string)
      for (const [id, spec] of Object.entries(style.sources)) {
        const sid = PREFIX + id
        if (!map.getSource(sid)) { map.addSource(sid, spec as SourceSpecification); added.sources.push(sid) }
      }
      const before = map.getLayer(LAYER_SLOTS.BASEMAP) ? LAYER_SLOTS.BASEMAP : undefined
      for (const layer of style.layers) {
        const lid = PREFIX + layer.id
        if (map.getLayer(lid)) continue
        const spec = { ...layer, id: lid } as LayerSpecification & { source?: string }
        if (spec.source) spec.source = PREFIX + spec.source
        try { map.addLayer(spec, before); added.layers.push(lid) } catch { /* an unsupported layer must not sink the rest */ }
      }
    }
    loadStyle().then(install).catch(() => {})
    return () => {
      cancelled = true
      if (!map.getStyle()) return
      for (const id of added.layers) { try { if (map.getLayer(id)) map.removeLayer(id) } catch { /* torn down */ } }
      for (const id of added.sources) { try { if (map.getSource(id)) map.removeSource(id) } catch { /* torn down */ } }
    }
  }, [mapRef])

  // Basemap opacity: fade every Liberty layer with its own opacity property.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map?.getStyle()) return
    const prop: Record<string, string> = { background: "background-opacity", fill: "fill-opacity", line: "line-opacity", symbol: "icon-opacity", raster: "raster-opacity", "fill-extrusion": "fill-extrusion-opacity" }
    for (const layer of map.getStyle().layers ?? []) {
      if (!layer.id.startsWith(PREFIX)) continue
      const p = prop[layer.type]
      if (!p) continue
      try {
        map.setPaintProperty(layer.id, p, opacity)
        if (layer.type === "symbol") map.setPaintProperty(layer.id, "text-opacity", opacity)
      } catch { /* not yet added */ }
    }
  }, [mapRef, opacity])

  return null
}
