// Imperative mount/update of PhongGlLayer (lib/phong-gl-layer.ts), mirroring
// MatcapLayer.tsx's "ref + effect that adds/removes an imperative maplibre
// object" pattern exactly — see that file's header for why a raw
// CustomLayerInterface needs this instead of a declarative react-map-gl
// <Layer>.
import { useEffect, useRef } from "react"
import type React from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { useClientDemUpstream } from "./MapSources"
import { LAYER_SLOTS } from "./MapLayers"
import { PhongGlLayer } from "@/lib/phong-gl-layer"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import type { TerrainSource } from "@/lib/terrain-types"

export const PhongLayer: React.FC<{
  mapRef: React.RefObject<MapRef>
  enabled: boolean
  /** True in 3D/globe view mode — baked into the layer's renderingMode at
   *  construction (can't change on a live instance), so this recreates the
   *  layer rather than live-updating it. */
  drapeEnabled: boolean
  exaggeration: number
  opacity: number
  diffuseStrength: number
  specularStrength: number
  lightDir: number
  lightAlt: number
  terrainSource: TerrainSource | string
  customTerrainSources: CustomTerrainSource[]
  mapboxKey: string
  maptilerKey: string
  titilerEndpoint: string
}> = ({
  mapRef, enabled, drapeEnabled, exaggeration, opacity, diffuseStrength, specularStrength, lightDir, lightAlt,
  terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}) => {
  const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
  const layerRef = useRef<PhongGlLayer | null>(null)
  const active = enabled && !!clientUpstream

  // Recreates the whole GL layer (and its tile cache) only when the upstream
  // DEM identity actually changes, the mode is toggled, or drapeEnabled flips
  // — everything else (opacity/diffuseStrength/specularStrength/lightDir/
  // lightAlt/exaggeration) updates live via updateOptions below instead, so
  // dragging the light-direction pad never re-fetches a single tile.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !active || !clientUpstream) return

    const layer = new PhongGlLayer({
      upstreamTemplate: clientUpstream.template,
      encoding: clientUpstream.encoding,
      tileSize: clientUpstream.tileSize,
      maxzoom: clientUpstream.maxzoom ?? 18,
      opacity,
      diffuseStrength,
      specularStrength,
      lightDir,
      lightAlt,
      drapeEnabled,
      exaggeration,
    })
    layerRef.current = layer

    // Same race as MatcapLayer.tsx against LayerOrderSlots (MapLayers.tsx)
    // not having committed its marker layers yet — see that file's comment
    // for the full explanation. Poll for the actual precondition instead of
    // trusting map.isStyleLoaded()/'styledata'.
    let cancelled = false
    let rafId: number | null = null
    const tryAddLayer = () => {
      if (cancelled || map.getLayer(layer.id)) return
      if (map.getLayer(LAYER_SLOTS.CONTOURS)) {
        map.addLayer(layer, LAYER_SLOTS.CONTOURS)
      } else {
        rafId = requestAnimationFrame(tryAddLayer)
      }
    }
    tryAddLayer()

    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      layerRef.current = null
      try { if (map.getLayer(layer.id)) map.removeLayer(layer.id) } catch { /* style already torn down */ }
    }
    // opacity/diffuseStrength/specularStrength/lightDir/lightAlt/exaggeration
    // intentionally omitted — handled by the live-update effect below instead
    // of recreating the layer (and re-fetching every tile) on every slider drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, active, drapeEnabled, clientUpstream?.template, clientUpstream?.encoding, clientUpstream?.tileSize, clientUpstream?.maxzoom])

  useEffect(() => {
    layerRef.current?.updateOptions({ opacity, diffuseStrength, specularStrength, lightDir, lightAlt, exaggeration })
  }, [opacity, diffuseStrength, specularStrength, lightDir, lightAlt, exaggeration])

  return null
}
