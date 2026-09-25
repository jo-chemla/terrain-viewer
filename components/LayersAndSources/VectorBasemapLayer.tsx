import type React from "react"
import { useEffect, useState } from "react"
import { useMap } from "react-map-gl/maplibre"
import type { StyleSpecification, LayerSpecification, SourceSpecification } from "maplibre-gl"
import { useAtomValue } from "jotai"
import { LAYER_SLOTS } from "./MapLayers"
import { osmBuildings3dAtom } from "@/lib/settings-atoms"

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

export const VectorBasemapLayer: React.FC<{ opacity?: number; visible?: boolean }> = ({ opacity = 1, visible = true }) => {
  const { current: mapRef } = useMap()
  const buildings3d = useAtomValue(osmBuildings3dAtom)
  const [installed, setInstalled] = useState(0)

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
      setInstalled((n) => n + 1)
    }
    loadStyle().then(install).catch(() => {})
    return () => {
      cancelled = true
      if (!map.getStyle()) return
      for (const id of added.layers) { try { if (map.getLayer(id)) map.removeLayer(id) } catch { /* torn down */ } }
      for (const id of added.sources) { try { if (map.getSource(id)) map.removeSource(id) } catch { /* torn down */ } }
    }
  }, [mapRef])

  // 3D buildings: Liberty's fill-extrusion layer, toggled from the basemap list.
  useEffect(() => {
    const map = mapRef?.getMap()
    const id = `${PREFIX}building-3d`
    if (!map?.getStyle() || !map.getLayer(id)) return
    map.setLayoutProperty(id, "visibility", buildings3d ? "visible" : "none")
  }, [mapRef, buildings3d, installed])

  // "Basemap" viz toggle: hide every Liberty layer.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map?.getStyle()) return
    for (const layer of map.getStyle().layers ?? []) {
      if (!layer.id.startsWith(PREFIX)) continue
      if (layer.id === `${PREFIX}building-3d` && !buildings3d) continue
      try { map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none") } catch { /* not yet added */ }
    }
  }, [mapRef, visible, buildings3d, installed])

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
        // MapLibre 6 types the property name per layer type; p is one of
        // them, looked up by layer.type above.
        ;(map as unknown as { setPaintProperty: (id: string, name: string, value: number) => void }).setPaintProperty(layer.id, p, opacity)
        if (layer.type === "symbol") map.setPaintProperty(layer.id, "text-opacity", opacity)
      } catch { /* not yet added */ }
    }
  }, [mapRef, opacity, installed])

  return null
}
