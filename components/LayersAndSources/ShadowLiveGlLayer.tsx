// React wrapper for lib/shadow-live-gl-layer.ts's ShadowLiveLayer, the live
// (GPU) renderer of Hard Shadows; the shadow:// tile pair (ShadowSource +
// ShadowRasterLayer) is the other one. Same mount/update split as
// PhongLiveGlLayer.tsx: a remount only when the upstream DEM changes, the sun
// and opacity through updateOptions() (uniforms, every slider frame).
import { useEffect, useRef } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import type { CustomLayerInterface } from "maplibre-gl"
import { useSetAtom } from "jotai"
import type { TerrainSource } from "@/lib/terrain-types"
import { shadowLiveUnsupportedAtom, type CustomTerrainSource } from "@/lib/settings-atoms"
import { ShadowLiveLayer, type ShadowLiveOptions } from "@/lib/shadow-live-gl-layer"
import { useClientDemUpstream } from "./MapSources"
import { LAYER_SLOTS } from "./MapLayers"

const LIVE_LAYER_ID = "shadow-live"

export function ShadowLiveGlLayer({
  mapRef, enabled, lightDir, lightAlt, soft, opacity,
  terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}: {
  mapRef: React.RefObject<MapRef | null>
  enabled: boolean
  /** Sun azimuth (compass degrees) and altitude (degrees): state.illuminationDir / illuminationAlt, undebounced. */
  lightDir: number
  lightAlt: number
  /** Soft edge from the sun's disc (state.shadowSoft). */
  soft: boolean
  opacity: number
  terrainSource: TerrainSource | string
  customTerrainSources: CustomTerrainSource[]
  mapboxKey: string
  maptilerKey: string
  titilerEndpoint: string
}) {
  const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
  const layerRef = useRef<ShadowLiveLayer | null>(null)
  const setUnsupported = useSetAtom(shadowLiveUnsupportedAtom)

  useEffect(() => {
    if (!enabled || !clientUpstream) return
    const map = mapRef.current?.getMap()
    if (!map) return
    const options: ShadowLiveOptions = {
      upstreamTemplate: clientUpstream.template,
      encoding: clientUpstream.encoding,
      tileSize: clientUpstream.tileSize,
      minzoom: clientUpstream.minzoom,
      maxzoom: clientUpstream.maxzoom,
      azimuthDeg: lightDir, altitudeDeg: lightAlt, opacity, soft,
    }
    const layer = new ShadowLiveLayer(LIVE_LAYER_ID, options)
    layer.onUnsupported = (reason) => setUnsupported(reason)
    layerRef.current = layer
    let cancelled = false
    let rafHandle: number | null = null
    // The slot marker may not exist yet (first mount, a style swap): retry
    // across frames, as PhongLiveGlLayer.tsx does.
    const tryAddLayer = () => {
      if (cancelled) return
      if (!map.getLayer(LIVE_LAYER_ID) && map.getLayer(LAYER_SLOTS.SHADOWS)) {
        map.addLayer(layer as unknown as CustomLayerInterface, LAYER_SLOTS.SHADOWS)
        return
      }
      if (!map.getLayer(LIVE_LAYER_ID)) rafHandle = requestAnimationFrame(tryAddLayer)
    }
    tryAddLayer()
    const onStyleData = () => {
      if (!map.getLayer(LIVE_LAYER_ID)) tryAddLayer()
    }
    map.on("styledata", onStyleData)
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__shadowLive = layer
    return () => {
      cancelled = true
      if (rafHandle !== null) cancelAnimationFrame(rafHandle)
      map.off("styledata", onStyleData)
      layerRef.current = null
      // Same teardown guard as PhongLiveGlLayer.tsx (the map may be gone).
      if (map.style && map.getLayer(LIVE_LAYER_ID)) map.removeLayer(LIVE_LAYER_ID)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clientUpstream?.template, clientUpstream?.encoding, clientUpstream?.tileSize, clientUpstream?.minzoom, clientUpstream?.maxzoom, mapRef])

  useEffect(() => {
    layerRef.current?.updateOptions({ azimuthDeg: lightDir, altitudeDeg: lightAlt, opacity, soft })
  }, [lightDir, lightAlt, opacity, soft])

  return null
}
