// A georeferenced IIIF map drawn from its Georeference Annotation (the
// Allmaps / IIIF Georeference extension format): Allmaps' WarpedMapLayer
// warps the IIIF tiles on the GPU from the annotation's control points and
// mask, so nothing is pre-rendered. Mounted imperatively, like the live
// Phong layer: a custom layer has no declarative form in react-map-gl.
// One layer per overlay source of type "iiif"; the annotation URL is the
// source's url (https://annotations.allmaps.org/maps/<id>, or any URL
// serving an annotation, a manifest's or an image's).
import { useEffect, useRef } from "react"
import { useMap } from "react-map-gl/maplibre"
import type { CustomLayerInterface } from "maplibre-gl"

export function AllmapsOverlayLayer({ id, annotationUrl, opacity, beforeId }: { id: string; annotationUrl: string; opacity: number; beforeId: string }) {
  const { current: mapRef } = useMap()
  const layerRef = useRef<any>(null)
  const layerId = `overlay-basemap-${id}`

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return
    let cancelled = false
    let raf: number | null = null
    let layer: any = null
    const add = async () => {
      const { WarpedMapLayer } = await import("@allmaps/maplibre")
      if (cancelled) return
      layer = new WarpedMapLayer({ layerId })
      layerRef.current = layer
      const tryAdd = () => {
        if (cancelled) return
        if (map.getLayer(layerId)) return
        if (map.getLayer(beforeId)) {
          map.addLayer(layer as CustomLayerInterface, beforeId)
          layer.setOpacity(opacity)
          layer.addGeoreferenceAnnotationByUrl(annotationUrl).catch((e: unknown) => console.error("[allmaps] annotation failed:", annotationUrl, e))
          return
        }
        raf = requestAnimationFrame(tryAdd)
      }
      tryAdd()
    }
    add().catch((e) => console.error("[allmaps] layer failed:", e))
    // A style swap drops every layer: put it back once the style is there.
    const onStyleData = () => { if (layer && !map.getLayer(layerId) && map.getLayer(beforeId)) { map.addLayer(layer as CustomLayerInterface, beforeId); layer.setOpacity(opacity) } }
    map.on("styledata", onStyleData)
    return () => {
      cancelled = true
      if (raf !== null) cancelAnimationFrame(raf)
      map.off("styledata", onStyleData)
      layerRef.current = null
      if (map.style && map.getLayer(layerId)) map.removeLayer(layerId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, layerId, annotationUrl, beforeId])

  useEffect(() => {
    try { layerRef.current?.setOpacity(opacity) } catch {}
  }, [opacity])

  return null
}
