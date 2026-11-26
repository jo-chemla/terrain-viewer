import type React from "react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Layer, Popup, Source, useMap } from "react-map-gl/maplibre"
import type { MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl"
import { useAtomValue } from "jotai"
import { ExternalLink, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LAYER_SLOTS } from "./MapLayers"
import { customVectorSourcesAtom, elevationPickerActiveAtom, georefActiveAtom, sunShadowActiveAtom, vectorOverlaySharedAtom, vectorOverlayStylesAtom } from "@/lib/settings-atoms"
import { activeDrawModeAtom } from "@/components/TerrainControlPanel/TerraDrawSystem"
import type { VectorSourceEntry } from "@/lib/source-schema"
import { findVectorSource, vectorLayerSpecs, vectorParts, vectorStyleOf } from "@/lib/vector-sources"
import { featureCard, geometryBounds, type FeatureProperties } from "@/lib/vector-popup"

/** Pixels around the pointer a feature may be: a 3 px point is hard to hit. */
const HIT_PX = 5
const HIGHLIGHT = "#22d3ee"

interface Selected {
  entry: VectorSourceEntry
  properties: FeatureProperties
  /** The clicked piece: for a polygon, what the tile under the pointer holds of it. */
  geometry: GeoJSON.Geometry
  lngLat: [number, number]
}

/**
 * The card of a clicked vector feature, for one view: a click on a feature of
 * a vector overlay of this view opens a popup with the feature's name, its
 * properties and its links (lib/vector-popup.ts, from the entry's `popup`),
 * a Zoom to button, and a highlight of the feature. Mounted inside the
 * view's <Map> by VectorOverlayLayers, so each view of a split has its own.
 *
 * Nothing opens while a tool owns the map's clicks (the elevation picker, the
 * sun calculator, the georeferencer, a drawing mode), nor on a click that
 * lands on a drawn feature (the drawing tools select it). A style overlay
 * (OpenStreetMap roads and labels) is a backdrop: its features are not
 * clickable.
 */
export const VectorFeaturePopup = memo(({ ids }: { ids: string[] }) => {
  const { current: mapRef } = useMap()
  const styles = useAtomValue(vectorOverlayStylesAtom)
  const customs = useAtomValue(customVectorSourcesAtom)
  const shared = useAtomValue(vectorOverlaySharedAtom)
  const pickerActive = useAtomValue(elevationPickerActiveAtom)
  const sunActive = useAtomValue(sunShadowActiveAtom)
  const georefActive = useAtomValue(georefActiveAtom)
  const drawMode = useAtomValue(activeDrawModeAtom)
  const toolActive = pickerActive || sunActive || georefActive || drawMode !== "select"
  const toolActiveRef = useRef(toolActive)
  toolActiveRef.current = toolActive
  const [selected, setSelected] = useState<Selected | null>(null)

  // Layer id to the entry it draws: the ids vectorLayerSpecs gives each part
  // (exact ids, so "…-osm" never claims the layers of "…-osm-condition").
  const layerEntries = useMemo(() => {
    const out = new Map<string, VectorSourceEntry>()
    for (const id of ids) {
      const entry = findVectorSource(id, customs)
      if (!entry || entry.type === "style") continue
      const style = vectorStyleOf(entry, styles[id], shared)
      for (const part of vectorParts(entry)) for (const l of vectorLayerSpecs(part, style, `vector-overlay-${part.id}`)) out.set(l.id, entry)
    }
    return out
  }, [ids, customs, styles, shared])
  const layerEntriesRef = useRef(layerEntries)
  layerEntriesRef.current = layerEntries

  // A card whose overlay was switched off, or a tool taking the map, closes.
  useEffect(() => { if (toolActive) setSelected(null) }, [toolActive])
  useEffect(() => { setSelected((s) => (s && !ids.includes(s.entry.id) ? null : s)) }, [ids])

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    const hit = (e: MapMouseEvent): MapGeoJSONFeature | null => {
      if (!layerEntriesRef.current.size || !map.getStyle()) return null
      const box: [[number, number], [number, number]] = [[e.point.x - HIT_PX, e.point.y - HIT_PX], [e.point.x + HIT_PX, e.point.y + HIT_PX]]
      // A drawn feature under the pointer belongs to the drawing tools.
      const drawn = map.getStyle().layers.filter((l) => l.id.startsWith("td-")).map((l) => l.id)
      if (drawn.length && map.queryRenderedFeatures(box, { layers: drawn }).length) return null
      const layers = [...layerEntriesRef.current.keys()].filter((id) => map.getLayer(id))
      if (!layers.length) return null
      // Topmost first, as drawn: a point over the footprint it stands on.
      return map.queryRenderedFeatures(box, { layers })[0] ?? null
    }
    const onClick = (e: MapMouseEvent) => {
      if (toolActiveRef.current || e.defaultPrevented) return
      const f = hit(e)
      if (!f) { setSelected(null); return }
      const entry = layerEntriesRef.current.get(f.layer.id)
      if (!entry) return
      // A point's card sits on the point; a shape's, where it was clicked.
      const at: [number, number] = f.geometry.type === "Point" ? [f.geometry.coordinates[0], f.geometry.coordinates[1]] : [e.lngLat.lng, e.lngLat.lat]
      setSelected({ entry, properties: (f.properties ?? {}) as FeatureProperties, geometry: f.geometry, lngLat: at })
    }
    // The pointer says a feature is clickable. Checked once a frame at most,
    // and written only on a change so a tool's own cursor survives.
    let wasHit = false, frame = 0, last: MapMouseEvent | null = null
    const onMove = (e: MapMouseEvent) => {
      last = e
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const over = !!last && !toolActiveRef.current && !map.isMoving() && !!hit(last)
        if (over !== wasHit) { wasHit = over; map.getCanvas().style.cursor = over ? "pointer" : "" }
      })
    }
    map.on("click", onClick)
    map.on("mousemove", onMove)
    return () => {
      map.off("click", onClick)
      map.off("mousemove", onMove)
      if (frame) cancelAnimationFrame(frame)
      if (wasHit) map.getCanvas().style.cursor = ""
    }
  }, [mapRef])

  const card = useMemo(() => (selected ? featureCard(selected.entry, selected.properties) : null), [selected])
  const highlight = useMemo(() => (selected ? { type: "Feature" as const, properties: {}, geometry: selected.geometry } : null), [selected])
  if (!selected || !card || !highlight) return null

  const zoomTo = () => {
    const map = mapRef?.getMap()
    if (!map) return
    const b = geometryBounds(selected.geometry as { type?: string; coordinates?: unknown })
    // A point, or a shape smaller than a few metres: fly to it.
    if (!b || (b[2] - b[0] < 1e-4 && b[3] - b[1] < 1e-4)) map.flyTo({ center: selected.lngLat, zoom: Math.max(map.getZoom(), 16), duration: 900 })
    else map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 18, duration: 900 })
  }
  const kind = selected.geometry.type
  return (
    <>
      <Source id="vector-feature-selected" type="geojson" data={highlight}>
        <Layer id="vector-feature-selected-line" type="line" beforeId={LAYER_SLOTS.VECTOR_OVERLAYS}
          filter={["match", ["geometry-type"], ["Polygon", "MultiPolygon", "LineString", "MultiLineString"], true, false]}
          layout={{ "line-join": "round", "line-cap": "round" }} paint={{ "line-color": HIGHLIGHT, "line-width": 3, "line-opacity": 0.95 }} />
        <Layer id="vector-feature-selected-point" type="circle" beforeId={LAYER_SLOTS.VECTOR_OVERLAYS}
          filter={["match", ["geometry-type"], ["Point", "MultiPoint"], true, false]}
          paint={{ "circle-radius": 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": HIGHLIGHT, "circle-stroke-width": 3 }} />
      </Source>
      <Popup longitude={selected.lngLat[0]} latitude={selected.lngLat[1]} onClose={() => setSelected(null)} closeOnClick={false}
        offset={kind === "Point" || kind === "MultiPoint" ? 12 : 4} maxWidth="min(20rem, calc(100vw - 2rem))" className="vector-feature-popup">
        <div className="w-64 max-w-full min-w-0 space-y-2 text-xs text-popover-foreground" data-vector-feature-card={selected.entry.id}>
          {card.image && <PopupImage src={card.image} />}
          <div className="min-w-0 pr-5">
            <p className="text-sm font-semibold leading-snug break-words">{card.title}</p>
            {card.subtitle && <p className="text-muted-foreground break-words">{card.subtitle}</p>}
            <p className="text-[10px] text-muted-foreground truncate" title={selected.entry.name}>{selected.entry.shortName ?? selected.entry.name}</p>
          </div>
          {card.rows.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 max-h-48 overflow-y-auto pr-1">
              {card.rows.map((r) => (
                <div key={r.key} className="contents">
                  <dt className="text-muted-foreground max-w-28 truncate" title={r.key}>{r.label}</dt>
                  <dd className="min-w-0 break-words">
                    {r.href ? <a href={r.href} target="_blank" rel="noopener noreferrer" className="underline break-all">{r.value}</a> : r.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <Button variant="outline" size="sm" className="h-7 cursor-pointer bg-transparent px-2 text-xs" onClick={zoomTo} title="Zoom to this feature">
              <Maximize2 className="h-3.5 w-3.5" /> Zoom to
            </Button>
            {card.links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline min-w-0">
                <span className="truncate">{l.label}</span> <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      </Popup>
    </>
  )
})
VectorFeaturePopup.displayName = "VectorFeaturePopup"

/** The card's picture; gone when it does not load. */
const PopupImage: React.FC<{ src: string }> = ({ src }) => {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed) return null
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="block h-32 w-full rounded object-cover" />
}
