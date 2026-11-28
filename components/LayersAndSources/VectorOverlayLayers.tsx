import type React from "react"
import { memo, useEffect, useMemo, useState } from "react"
import { Layer, Source, useMap } from "react-map-gl/maplibre"
import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl"
import { useAtomValue } from "jotai"
import { LAYER_SLOTS } from "./MapLayers"
import { customVectorSourcesAtom, vectorOverlaySharedAtom, vectorOverlayStylesAtom } from "@/lib/settings-atoms"
import type { VectorSourceEntry } from "@/lib/source-schema"
import { appFileUrl, expandCompactGeoJSON, findVectorSource, needsResolving, resolveVectorUrl, vectorLayerSpecs, vectorParts, vectorSourceSpec, vectorStyleOf, type VectorOverlayStyle } from "@/lib/vector-sources"
import { routeGlyphs, spriteIdOf, spriteUrl, withSprite } from "@/lib/style-overlay"
import { VectorFeaturePopup } from "./VectorFeaturePopup"

/**
 * Vector overlays of one view: the vector sources (the Library's building
 * footprints and the user's own, lib/vector-sources.ts) named by `ids`, each as its own vector
 * source and its fill / line / fill-extrusion layers at the VECTOR_OVERLAYS
 * slot: above the shading, under the contours. Every view mounts its own
 * copy inside its <Map>, so a source on view B never touches view A's map.
 *
 * MapLibre drapes fill and line layers on the terrain itself and stands the
 * extrusions on it; nothing here knows whether terrain is on.
 *
 * A click on a feature opens its card (VectorFeaturePopup), per view.
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
      <VectorFeaturePopup ids={ids} />
    </>
  )
})
VectorOverlayLayers.displayName = "VectorOverlayLayers"

/** The entry's address: at once when it is fixed, after the resolver's
 *  answer when it rotates (Overture's release). */
function useResolvedUrl(entry: VectorSourceEntry): string | null {
  // A file the app serves itself ("/vector/…") sits under the site's base path.
  const fixed = appFileUrl(entry.url, import.meta.env.BASE_URL)
  const [url, setUrl] = useState<string | null>(needsResolving(entry) ? null : fixed)
  useEffect(() => {
    if (!needsResolving(entry)) { setUrl(fixed); return }
    let cancelled = false
    resolveVectorUrl(entry).then((u) => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [entry, fixed])
  return url
}

// A KML or GPX source is fetched and converted to GeoJSON here (the drawing
// tools' reader, lib/remote-vector.ts), once per address and session; a
// "compact" GeoJSON file (short keys, shared values said once) is put back
// into plain features by expandCompactGeoJSON.
const converted = new Map<string, Promise<GeoJSON.FeatureCollection>>()
function useConvertedData(entry: VectorSourceEntry, url: string | null): GeoJSON.FeatureCollection | null | undefined {
  const [data, setData] = useState<GeoJSON.FeatureCollection | null>(null)
  const format = entry.type === "geojson" ? entry.format : undefined
  useEffect(() => {
    if (!format || !url) { setData(null); return }
    let cancelled = false
    let p = converted.get(url)
    if (!p) {
      p = (format === "compact"
        ? fetch(url).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return expandCompactGeoJSON((await res.json()) as GeoJSON.FeatureCollection)
        })
        : import("@/lib/remote-vector").then(async ({ parseVector }) => {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return parseVector(await res.arrayBuffer(), format) as Promise<GeoJSON.FeatureCollection>
        })
      ).catch((e) => { converted.delete(url); throw e })
      converted.set(url, p)
    }
    p.then((fc) => { if (!cancelled) setData(fc) }).catch((e) => console.warn(`[vector overlay] ${entry.id}: ${e instanceof Error ? e.message : e}`))
    return () => { cancelled = true }
  }, [format, url, entry.id])
  // undefined: nothing to convert, the address is the data.
  return format ? data : undefined
}

// <Layer> typed per layer type; the specs of lib/vector-sources.ts are plain
// objects (validated against MapLibre's style spec in its test).
const SpecLayer = Layer as unknown as React.ComponentType<Record<string, unknown>>

const TileOverlay: React.FC<{ entry: VectorSourceEntry; style: VectorOverlayStyle }> = ({ entry, style }) => {
  const url = useResolvedUrl(entry)
  const sourceId = `vector-overlay-${entry.id}`
  const data = useConvertedData(entry, url)
  const source = useMemo(() => (!url || data === null ? null : data ? { ...vectorSourceSpec(entry, url), data } : vectorSourceSpec(entry, url)), [entry, url, data])
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
 * unmount. Same approach as VectorBasemapLayer, which draws the full style
 * as the OSM basemap. Several styles share the map, each with its fonts and
 * its images (lib/style-overlay.ts): the map's glyphs address is the app's
 * router, told where this style's fonts are served, and the style's sprite
 * is added under an id of its own, its image names prefixed with it.
 */
const StyleOverlay: React.FC<{ entry: VectorSourceEntry; opacity: number }> = ({ entry, opacity }) => {
  const { current: mapRef } = useMap()
  const [installed, setInstalled] = useState(0)
  const prefix = `vector-overlay-${entry.id}-`
  // A style the app serves itself ("/styles/…") sits under the site's base path.
  const url = appFileUrl(entry.url, import.meta.env.BASE_URL)

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    let cancelled = false
    const added: { sources: string[]; layers: string[]; sprite?: string } = { sources: [], layers: [] }
    const install = (style: StyleSpecification) => {
      if (cancelled || !map.getStyle()) return
      const types = new Set<string>(entry.styleLayerTypes ?? ["fill", "line", "symbol", "fill-extrusion", "raster"])
      const layers = style.layers.filter((l) => types.has(l.type))
      routeGlyphs(map, layers as { layout?: Record<string, unknown> }[], style.glyphs)
      const sprite = spriteUrl(style.sprite, url, window.location.href)
      const spriteId = spriteIdOf(entry.id)
      if (sprite && !map.getSprite().some((s) => s.id === spriteId)) {
        try { map.addSprite(spriteId, sprite); added.sprite = spriteId } catch { /* the layers draw without their icons */ }
      }
      const used = new Set(layers.map((l) => (l as { source?: string }).source).filter((s): s is string => !!s))
      for (const id of used) {
        const sid = prefix + id
        if (!map.getSource(sid) && style.sources[id]) { map.addSource(sid, style.sources[id] as SourceSpecification); added.sources.push(sid) }
      }
      const before = map.getLayer(LAYER_SLOTS.VECTOR_OVERLAYS) ? LAYER_SLOTS.VECTOR_OVERLAYS : undefined
      for (const layer of layers) {
        const lid = prefix + layer.id
        if (map.getLayer(lid)) continue
        const spec = { ...(sprite ? withSprite(layer as { layout?: Record<string, unknown>; paint?: Record<string, unknown> }, spriteId) : layer), id: lid } as LayerSpecification & { source?: string }
        if (spec.source) spec.source = prefix + spec.source
        try { map.addLayer(spec, before); added.layers.push(lid) } catch { /* an unsupported layer must not sink the rest */ }
      }
      setInstalled((n) => n + 1)
    }
    loadStyle(url).then(install).catch(() => {})
    return () => {
      cancelled = true
      if (!map.getStyle()) return
      for (const id of added.layers) { try { if (map.getLayer(id)) map.removeLayer(id) } catch { /* torn down */ } }
      for (const id of added.sources) { try { if (map.getSource(id)) map.removeSource(id) } catch { /* torn down */ } }
      if (added.sprite) { try { if (map.getSprite().some((s) => s.id === added.sprite)) map.removeSprite(added.sprite) } catch { /* torn down */ } }
    }
  }, [mapRef, entry, prefix, url])

  // The overlay's opacity times each layer's own. A layer whose opacity is an
  // expression (Liberty fades some by zoom) keeps it at full opacity and
  // takes the plain number below it: a zoom expression cannot be multiplied.
  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map?.getStyle()) return
    const set = map as unknown as { setPaintProperty: (id: string, name: string, value: unknown) => void }
    loadStyle(url).then((style) => {
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
  }, [mapRef, opacity, installed, prefix, url])

  return null
}
