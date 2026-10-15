import type React from "react"
import { useEffect, useState } from "react"
import { useMap } from "react-map-gl/maplibre"
import type { Map as MlMap, StyleSpecification, LayerSpecification, SourceSpecification } from "maplibre-gl"
import { useAtomValue } from "jotai"
import { LAYER_SLOTS } from "./MapLayers"
import { osmBuildings3dAtom, osmBuildingsStyleAtom, OSM_BUILDINGS_STYLE_DEFAULT, type OsmBuildingsStyle } from "@/lib/settings-atoms"

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

// The look of the extruded buildings (osmBuildingsStyleAtom): Liberty's own
// warm grey, white, black or a custom colour, an opacity (times the basemap's
// own), and footprint outlines. MapLibre's fill-extrusion draws no edges, so
// the outlines are a line layer from the same building tiles, inserted just
// under the extrusion: the fill covers its inner half, the outer half rims
// each footprint (draped on the terrain when there is one).
const BUILDING_FILLS: Record<Exclude<OsmBuildingsStyle["color"], "custom">, string> = { grey: "hsl(35,8%,85%)", white: "#ffffff", black: "#262626" }
const buildingsFill = (s: OsmBuildingsStyle) => (s.color === "custom" ? s.custom : BUILDING_FILLS[s.color])
// a dark rim on a light fill, a light rim on a dark one (custom colours by their luminance)
const buildingsRim = (s: OsmBuildingsStyle) => {
  if (s.color === "black") return "rgba(255,255,255,0.7)"
  if (s.color !== "custom") return "rgba(0,0,0,0.55)"
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s.custom)
  const lum = m ? (0.2126 * parseInt(m[1], 16) + 0.7152 * parseInt(m[2], 16) + 0.0722 * parseInt(m[3], 16)) / 255 : 1
  return lum < 0.45 ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.55)"
}
/** Paint the extrusion layer from the style and keep its outline layer in step
 *  (added under it when wanted, removed when not). mult is the basemap
 *  opacity the extrusion already followed; shown folds in the 3D toggle
 *  and the basemap visibility for the outline, which the extrusion's own
 *  effects do not know about. */
function applyBuildingsStyle(map: MlMap, extrusionId: string, outlineId: string, style: OsmBuildingsStyle, mult: number, shown: boolean) {
  if (!map.getStyle() || !map.getLayer(extrusionId)) return
  const s = { ...OSM_BUILDINGS_STYLE_DEFAULT, ...style }
  try {
    map.setPaintProperty(extrusionId, "fill-extrusion-color", buildingsFill(s))
    map.setPaintProperty(extrusionId, "fill-extrusion-opacity", s.opacity * mult)
  } catch { /* style changed */ }
  const have = !!map.getLayer(outlineId)
  if (!s.outlines) { if (have) { try { map.removeLayer(outlineId) } catch { /* torn down */ } } return }
  if (!have) {
    const spec = map.getStyle().layers.find((l) => l.id === extrusionId) as (LayerSpecification & { source?: string; "source-layer"?: string }) | undefined
    if (!spec?.source) return
    try {
      map.addLayer({ id: outlineId, type: "line", source: spec.source, "source-layer": spec["source-layer"], minzoom: spec.minzoom ?? 14, layout: { "line-join": "round" }, paint: { "line-width": 1 } }, extrusionId)
    } catch { return }
  }
  try {
    map.setPaintProperty(outlineId, "line-color", buildingsRim(s))
    map.setPaintProperty(outlineId, "line-opacity", mult)
    map.setLayoutProperty(outlineId, "visibility", shown ? "visible" : "none")
  } catch { /* style changed */ }
}

export const VectorBasemapLayer: React.FC<{ opacity?: number; visible?: boolean }> = ({ opacity = 1, visible = true }) => {
  const { current: mapRef } = useMap()
  const buildings3d = useAtomValue(osmBuildings3dAtom)
  const buildingsStyle = useAtomValue(osmBuildingsStyleAtom)
  const [installed, setInstalled] = useState(0)

  // The outline layer (added by applyBuildingsStyle) goes before the sources
  // do: declared first so its cleanup runs first.
  useEffect(() => {
    const map = mapRef?.getMap()
    return () => { try { if (map?.getStyle() && map.getLayer(`${PREFIX}building-outline`)) map.removeLayer(`${PREFIX}building-outline`) } catch { /* torn down */ } }
  }, [mapRef])

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
    // Liberty's flat footprint layer stops at z14 (the extrusion takes over
    // above). With the extrusion off, extend the footprints to every zoom so
    // the buildings stay drawn flat; restore the style's own range with it on.
    const flat = `${PREFIX}building`
    const flatLayer = map.getLayer(flat)
    if (flatLayer) {
      try { map.setLayerZoomRange(flat, flatLayer.minzoom ?? 13, buildings3d ? 14 : 24) } catch { /* style changed */ }
    }
  }, [mapRef, buildings3d, installed])

  // "Basemap" viz toggle: hide every Liberty layer.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map?.getStyle()) return
    for (const layer of map.getStyle().layers ?? []) {
      if (!layer.id.startsWith(PREFIX)) continue
      if ((layer.id === `${PREFIX}building-3d` || layer.id === `${PREFIX}building-outline`) && !buildings3d) continue
      try { map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none") } catch { /* not yet added */ }
    }
  }, [mapRef, visible, buildings3d, installed])

  // The buildings' own style (colour, opacity, outlines), on top of the basemap opacity.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    applyBuildingsStyle(map, `${PREFIX}building-3d`, `${PREFIX}building-outline`, buildingsStyle, opacity, visible && buildings3d)
  }, [mapRef, buildingsStyle, opacity, visible, buildings3d, installed])

  // Basemap opacity: fade every Liberty layer with its own opacity property.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map?.getStyle()) return
    const prop: Record<string, string> = { background: "background-opacity", fill: "fill-opacity", line: "line-opacity", symbol: "icon-opacity", raster: "raster-opacity", "fill-extrusion": "fill-extrusion-opacity" }
    for (const layer of map.getStyle().layers ?? []) {
      if (!layer.id.startsWith(PREFIX)) continue
      if (layer.id === `${PREFIX}building-3d` || layer.id === `${PREFIX}building-outline`) continue
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

/**
 * The 3D buildings alone, over any other basemap: when the "3D" switch next
 * to OSM (OpenFreeMap Liberty) is on but another basemap is selected, this
 * installs Liberty's OpenMapTiles source and its fill-extrusion layer only,
 * above the basemap slot, so the extruded buildings draw over Google, Esri or
 * a terrain-only view. Removed on unmount; the switch off unmounts it.
 */
export const OsmBuildingsLayer: React.FC = () => {
  const { current: mapRef } = useMap()
  const buildingsStyle = useAtomValue(osmBuildingsStyleAtom)
  const [installed, setInstalled] = useState(0)
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    let cancelled = false
    const added: { sources: string[]; layers: string[] } = { sources: [], layers: [] }
    const install = (style: StyleSpecification) => {
      if (cancelled || !map.getStyle()) return
      const layer = style.layers.find((l) => l.id === "building-3d") as (LayerSpecification & { source?: string }) | undefined
      if (!layer?.source) return
      const sid = PREFIX + layer.source
      if (!map.getSource(sid)) { map.addSource(sid, style.sources[layer.source] as SourceSpecification); added.sources.push(sid) }
      const lid = `${PREFIX}building-3d-only`
      if (!map.getLayer(lid)) {
        const before = map.getLayer(LAYER_SLOTS.OVERLAYS) ? LAYER_SLOTS.OVERLAYS : undefined
        try { map.addLayer({ ...layer, id: lid, source: sid } as LayerSpecification, before); added.layers.push(lid) } catch { /* style changed */ }
      }
      setInstalled((n) => n + 1)
    }
    loadStyle().then(install).catch(() => {})
    return () => {
      cancelled = true
      if (!map.getStyle()) return
      try { if (map.getLayer(`${PREFIX}building-outline-only`)) map.removeLayer(`${PREFIX}building-outline-only`) } catch { /* torn down */ }
      for (const id of added.layers) { try { if (map.getLayer(id)) map.removeLayer(id) } catch { /* torn down */ } }
      for (const id of added.sources) { try { if (map.getSource(id)) map.removeSource(id) } catch { /* torn down */ } }
    }
  }, [mapRef])
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    applyBuildingsStyle(map, `${PREFIX}building-3d-only`, `${PREFIX}building-outline-only`, buildingsStyle, 1, true)
  }, [mapRef, buildingsStyle, installed])
  return null
}
