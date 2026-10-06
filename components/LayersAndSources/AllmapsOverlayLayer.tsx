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
import { useAtomValue } from "jotai"
import { allmapsRemoveColorAtom, type AllmapsRemoveColor } from "@/lib/settings-atoms"
import { estimatePaper, type PaperEstimate } from "@/lib/allmaps-paper"

/** The warped maps' per-map render options for the background removal
 *  (Allmaps' own "remove background colour": pixels within `threshold` of
 *  the colour turn transparent, `hardness` the edge's sharpness). In auto
 *  mode the map's own detected paper and threshold, scaled by the gain;
 *  until the estimate lands, nothing is removed. */
const removeColorOptions = (o: AllmapsRemoveColor, paper: PaperEstimate | null) => {
  const auto = o.auto ?? true
  // No estimate yet, or a map with no paper to speak of: nothing removed.
  if (!o.enabled || (auto && !paper?.confident)) return { removeColor: false }
  const color = auto ? paper!.color : o.color
  const threshold = auto ? paper!.threshold * (0.5 + (o.autoGain ?? 0.5)) : o.threshold
  return { removeColor: true, removeColorColor: color, removeColorThreshold: threshold, removeColorHardness: o.hardness }
}

export function AllmapsOverlayLayer({ id, annotationUrl, opacity, beforeId }: { id: string; annotationUrl: string; opacity: number; beforeId: string }) {
  const { current: mapRef } = useMap()
  const layerRef = useRef<any>(null)
  const layerId = `overlay-basemap-${id}`
  const removeColor = useAtomValue(allmapsRemoveColorAtom)
  const removeColorRef = useRef(removeColor)
  removeColorRef.current = removeColor
  const paperRef = useRef<PaperEstimate | null>(null)
  const apply = () => { try { layerRef.current?.setMapsOptions(() => removeColorOptions(removeColorRef.current, paperRef.current)) } catch {} }

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
          syncPitch()
          layer.addGeoreferenceAnnotationByUrl(annotationUrl)
            .then(() => apply())
            .catch((e: unknown) => console.error("[allmaps] annotation failed:", annotationUrl, e))
          return
        }
        raf = requestAnimationFrame(tryAdd)
      }
      tryAdd()
    }
    // Allmaps' WarpedMapLayer draws from a flat viewport (the four screen
    // corners unprojected, a centre, a scale, a rotation): it has no pitch,
    // and in a tilted view the map lands flat over the perspective, in the
    // wrong place. Hidden while the view is tilted, back when it is flat.
    const syncPitch = () => { if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", map.getPitch() > 0.5 ? "none" : "visible") }
    map.on("pitch", syncPitch)
    add().catch((e) => console.error("[allmaps] layer failed:", e))
    // A style swap drops every layer: put it back once the style is there.
    const onStyleData = () => { if (layer && !map.getLayer(layerId) && map.getLayer(beforeId)) { map.addLayer(layer as CustomLayerInterface, beforeId); layer.setOpacity(opacity); syncPitch() } }
    map.on("styledata", onStyleData)
    return () => {
      cancelled = true
      if (raf !== null) cancelAnimationFrame(raf)
      map.off("styledata", onStyleData)
      map.off("pitch", syncPitch)
      layerRef.current = null
      if (map.style && map.getLayer(layerId)) map.removeLayer(layerId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, layerId, annotationUrl, beforeId])

  useEffect(() => {
    try { layerRef.current?.setOpacity(opacity) } catch {}
  }, [opacity])
  // The map's own paper, estimated once per annotation (cached) when the
  // removal is on in auto mode.
  const wantsEstimate = removeColor.enabled && (removeColor.auto ?? true)
  useEffect(() => {
    if (!wantsEstimate) return
    let cancelled = false
    estimatePaper(annotationUrl).then((p) => {
      if (cancelled) return
      paperRef.current = p
      apply()
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsEstimate, annotationUrl])
  useEffect(() => { apply() }, [removeColor]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
