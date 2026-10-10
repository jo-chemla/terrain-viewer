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
import { pushToast } from "@/components/ui/toast"

// Once per session: the first tilt with an in-browser Allmaps map on.
let tiltToastShown = false

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

/** Allmaps' tile server: the same map warped server-side, cached, as XYZ. */
export const allmapsTileUrl = (annotationUrl: string) => `https://allmaps.xyz/{z}/{x}/{y}.png?url=${encodeURIComponent(annotationUrl)}`

export function AllmapsOverlayLayer({ id, annotationUrl, opacity, beforeId, alwaysTiles = false, bounds }: { id: string; annotationUrl: string; opacity: number; beforeId: string; alwaysTiles?: boolean; bounds?: [number, number, number, number] }) {
  const { current: mapRef } = useMap()
  const layerRef = useRef<any>(null)
  const layerId = `overlay-basemap-${id}`
  const removeColor = useAtomValue(allmapsRemoveColorAtom)
  const removeColorRef = useRef(removeColor)
  removeColorRef.current = removeColor
  const paperRef = useRef<PaperEstimate | null>(null)
  const opacityRef = useRef(opacity); opacityRef.current = opacity
  const alwaysTilesRef = useRef(alwaysTiles); alwaysTilesRef.current = alwaysTiles
  const syncRef = useRef<(() => void) | null>(null)
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
    // wrong place. While tilted (or always, with alwaysTiles) the same map
    // comes from Allmaps' tile server as a plain raster layer, which pitches
    // and drapes like any other.
    const tilesSource = `${layerId}-tiles-src`, tilesLayer = `${layerId}-tiles`
    const ensureTiles = () => {
      if (!map.getLayer(beforeId)) return
      if (!map.getSource(tilesSource)) map.addSource(tilesSource, { type: "raster", tiles: [allmapsTileUrl(annotationUrl)], tileSize: 256, maxzoom: 20, ...(bounds ? { bounds } : {}) })
      if (!map.getLayer(tilesLayer)) map.addLayer({ id: tilesLayer, type: "raster", source: tilesSource, paint: { "raster-opacity": opacityRef.current, "raster-resampling": "linear" }, layout: { visibility: "none" } }, beforeId)
    }
    const syncPitch = () => {
      const tilted = map.getPitch() > 0.5
      const useTiles = alwaysTilesRef.current || tilted
      if (tilted && !alwaysTilesRef.current && !tiltToastShown) {
        tiltToastShown = true
        pushToast({ key: "allmaps-tilt", tone: "warn", title: "Tilted view: Allmaps maps from the tile server", body: "Allmaps' in-browser warp draws flat views only, so the georeferenced maps come from allmaps.xyz while the view is tilted (coarser, cached). Back to the in-browser warp at pitch 0.", duration: 15000 })
      }
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", useTiles ? "none" : "visible")
      if (useTiles) ensureTiles()
      if (map.getLayer(tilesLayer)) map.setLayoutProperty(tilesLayer, "visibility", useTiles ? "visible" : "none")
    }
    syncRef.current = syncPitch
    map.on("pitch", syncPitch)
    add().catch((e) => console.error("[allmaps] layer failed:", e))
    // A style swap drops every layer: put it back once the style is there.
    const onStyleData = () => { if (layer && !map.getLayer(layerId) && map.getLayer(beforeId)) { map.addLayer(layer as CustomLayerInterface, beforeId); layer.setOpacity(opacity); syncPitch() } else if (map.getLayer(beforeId) && (alwaysTilesRef.current || map.getPitch() > 0.5) && !map.getLayer(tilesLayer)) syncPitch() }
    map.on("styledata", onStyleData)
    return () => {
      cancelled = true
      if (raf !== null) cancelAnimationFrame(raf)
      map.off("styledata", onStyleData)
      map.off("pitch", syncPitch)
      syncRef.current = null
      if (map.style && map.getLayer(tilesLayer)) map.removeLayer(tilesLayer)
      if (map.style && map.getSource(tilesSource)) map.removeSource(tilesSource)
      layerRef.current = null
      if (map.style && map.getLayer(layerId)) map.removeLayer(layerId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, layerId, annotationUrl, beforeId])

  useEffect(() => {
    try { layerRef.current?.setOpacity(opacity) } catch {}
    const map = mapRef?.getMap()
    const tl = `${layerId}-tiles`
    if (map?.getLayer(tl)) map.setPaintProperty(tl, "raster-opacity", opacity)
  }, [opacity])
  useEffect(() => { syncRef.current?.() }, [alwaysTiles])
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
