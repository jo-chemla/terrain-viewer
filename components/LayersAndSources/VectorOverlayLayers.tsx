import type React from "react"
import { memo, useEffect, useMemo, useState } from "react"
import { Layer, Source, useMap } from "react-map-gl/maplibre"
import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl"
import { useAtomValue } from "jotai"
import { LAYER_SLOTS } from "./MapLayers"
import { customVectorSourcesAtom, vectorOverlaySharedAtom, vectorOverlayStylesAtom } from "@/lib/settings-atoms"
import type { VectorSourceEntry } from "@/lib/source-schema"
import { findVectorSource, needsResolving, resolveVectorUrl, vectorLayerSpecs, vectorParts, vectorSourceSpec, vectorStyleOf, type VectorOverlayStyle } from "@/lib/vector-sources"

/**
 * Vector overlays of one view: the vector sources (the Library's building
 * footprints and the user's own, lib/vector-sources.ts) named by `ids`, each as its own vector
 * source and its fill / line / fill-extrusion layers at the VECTOR_OVERLAYS
 * slot: above the shading, under the contours. Every view mounts its own
 * copy inside its <Map>, so a source on view B never touches view A's map.
 *
 * MapLibre drapes fill and line layers on the terrain itself and stands the
 * extrusions on it; nothing here knows whether terrain is on.
 */
export const VectorOverlayLayers = memo(({ ids, opacity = 1 }: { ids: string[]; opacity?: number }) => {
  const styles = useAtomValue(vectorOverlayStylesAtom)
  const customs = useAtomValue(customVectorSourcesAtom)
  const shared = useAtomValue(vectorOverlaySharedAtom)
  return (
    <>
      {ids.map((id) => {
        const entry = findVectorSource(id, customs)
        if (!entry) return null
        const style = vectorStyleOf(entry, styles[id], shared)
        const scaled = opacity === 1 ? style : { ...style, opacity: style.opacity * opacity }
        if (entry.type === "style") return <StyleOverlay key={`${id}|${entry.url}`} entry={entry} opacity={scaled.opacity} />
        // A dataset in several archives (points and shapes): one source each,
        // the companions first so the points draw over the shapes.
        return vectorParts(entry).reverse().map((part) => (
          <TileOverlay key={`${part.id}|${part.url}|${part.type}`} entry={part} style={scaled} />
        ))
      })}
    </>
  )
})
VectorOverlayLayers.displayName = "VectorOverlayLayers"

/** The entry's address: at once when it is fixed, after the resolver's
 *  answer when it rotates (Overture's release). */
function useResolvedUrl(entry: VectorSourceEntry): string | null {
  const [url, setUrl] = useState<string | null>(needsResolving(entry) ? null : entry.url)
  useEffect(() => {
    if (!needsResolving(entry)) { setUrl(entry.url); return }
    let cancelled = false
    resolveVectorUrl(entry).then((u) => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [entry])
  return url
}

// <Layer> typed per layer type; the specs of lib/vector-sources.ts are plain
// objects (validated against MapLibre's style spec in its test).
const SpecLayer = Layer as unknown as React.ComponentType<Record<string, unknown>>

const TileOverlay: React.FC<{ entry: VectorSourceEntry; style: VectorOverlayStyle }> = ({ entry, style }) => {
  const url = useResolvedUrl(entry)
  const sourceId = `vector-overlay-${entry.id}`
  const source = useMemo(() => (url ? vectorSourceSpec(entry, url) : null), [entry, url])
  const layers = useMemo(() => vectorLayerSpecs(entry, style, sourceId), [entry, style, sourceId])
  if (!source) return null
  // Keyed on the address: react-map-gl does not move a mounted source to
  // another URL, and a <Layer>'s source is fixed when it is created. The
  // layer ids carry their type (-fill, -line, -3d), so flat to 3D mounts
  // new layers instead of retyping one.
  return (
    <Source key={url} id={sourceId} {...(source as SourceSpecification & { type: "vector" })}>
      {layers.map((l) => (
        <SpecLayer key={l.id} beforeId={LAYER_SLOTS.VECTOR_OVERLAYS} {...l} source={sourceId} />
      ))}
    </Source>
  )
}

const stylePromises = new Map<string, Promise<StyleSpecification>>()
const loadStyle = (url: string) => {
  let p = stylePromises.get(url)
  if (!p) {
    p = fetch(url).then((r) => r.json() as Promise<StyleSpecification>).catch((e) => { stylePromises.delete(url); throw e })
    stylePromises.set(url, p)
  }
  return p
}
const OPACITY_PROPS: Record<string, string[]> = { fill: ["fill-opacity"], line: ["line-opacity"], symbol: ["icon-opacity", "text-opacity"], raster: ["raster-opacity"], "fill-extrusion": ["fill-extrusion-opacity"] }

/**
 * A whole MapLibre style drawn as an overlay (OpenFreeMap's Liberty): its
 * layers of the entry's `styleLayerTypes` and the sources they read are
 * installed on the map at the vector slot, ids prefixed, and removed on
 * unmount. The map's own style has no glyphs or sprite, so the style's are
 * set when none is. Same approach as VectorBasemapLayer, which draws the
 * full style as the OSM basemap.
 */
const StyleOverlay: React.FC<{ entry: VectorSourceEntry; opacity: number }> = ({ entry, opacity }) => {
  const { current: mapRef } = useMap()
  const [installed, setInstalled] = useState(0)
  const prefix = `vector-overlay-${entry.id}-`

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    let cancelled = false
    const added: { sources: string[]; layers: string[] } = { sources: [], layers: [] }
    const install = (style: StyleSpecification) => {
      if (cancelled || !map.getStyle()) return
      const types = new Set<string>(entry.styleLayerTypes ?? ["fill", "line", "symbol", "fill-extrusion", "raster"])
      const layers = style.layers.filter((l) => types.has(l.type))
      if (style.glyphs && !map.getGlyphs()) map.setGlyphs(style.glyphs)
      if (style.sprite && !map.getSprite()?.length) map.setSprite(style.sprite as string)
      const used = new Set(layers.map((l) => (l as { source?: string }).source).filter((s): s is string => !!s))
      for (const id of used) {
        const sid = prefix + id
        if (!map.getSource(sid) && style.sources[id]) { map.addSource(sid, style.sources[id] as SourceSpecification); added.sources.push(sid) }
      }
      const before = map.getLayer(LAYER_SLOTS.VECTOR_OVERLAYS) ? LAYER_SLOTS.VECTOR_OVERLAYS : undefined
      for (const layer of layers) {
        const lid = prefix + layer.id
        if (map.getLayer(lid)) continue
        const spec = { ...layer, id: lid } as LayerSpecification & { source?: string }
        if (spec.source) spec.source = prefix + spec.source
        try { map.addLayer(spec, before); added.layers.push(lid) } catch { /* an unsupported layer must not sink the rest */ }
      }
      setInstalled((n) => n + 1)
    }
    loadStyle(entry.url).then(install).catch(() => {})
    return () => {
      cancelled = true
      if (!map.getStyle()) return
      for (const id of added.layers) { try { if (map.getLayer(id)) map.removeLayer(id) } catch { /* torn down */ } }
      for (const id of added.sources) { try { if (map.getSource(id)) map.removeSource(id) } catch { /* torn down */ } }
    }
  }, [mapRef, entry, prefix])

  // The overlay's opacity times each layer's own. A layer whose opacity is an
  // expression (Liberty fades some by zoom) keeps it at full opacity and
  // takes the plain number below it: a zoom expression cannot be multiplied.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map?.getStyle()) return
    const set = map as unknown as { setPaintProperty: (id: string, name: string, value: unknown) => void }
    loadStyle(entry.url).then((style) => {
      if (!map.getStyle()) return
      for (const layer of style.layers) {
        const lid = prefix + layer.id
        if (!map.getLayer(lid)) continue
        const paint = ((layer as { paint?: Record<string, unknown> }).paint ?? {})
        for (const p of OPACITY_PROPS[layer.type] ?? []) {
          const own = paint[p]
          const value = typeof own === "number" ? own * opacity : own === undefined ? opacity : opacity >= 1 ? own : opacity
          try { set.setPaintProperty(lid, p, value) } catch { /* removed meanwhile */ }
        }
      }
    }).catch(() => {})
  }, [mapRef, opacity, installed, prefix, entry.url])

  return null
}
