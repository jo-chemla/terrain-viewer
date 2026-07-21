// Imperative mount/update of MatcapGlLayer (lib/matcap-gl-layer.ts) — a hand-
// written CustomLayerInterface, not a declarative react-map-gl <Layer>, since
// react-map-gl has no first-class support for a raw CustomLayerInterface
// instance. Mirrors the same "ref + effect that adds/removes an imperative
// maplibre object" pattern this app already uses for MapControls (Geocoder/
// Minimap), just for a layer instead of a control.
import { useEffect, useRef } from "react"
import type React from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { useClientDemUpstream } from "./MapSources"
import { LAYER_SLOTS } from "./MapLayers"
import { MatcapGlLayer } from "@/lib/matcap-gl-layer"
import { MATCAP_TEXTURES, DEFAULT_MATCAP_ID } from "@/lib/matcap-textures"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import type { TerrainSource } from "@/lib/terrain-types"

function matcapUrlFor(textureId: string): string {
  return (MATCAP_TEXTURES.find((t) => t.id === textureId) ?? MATCAP_TEXTURES.find((t) => t.id === DEFAULT_MATCAP_ID)!).url
}

export const MatcapLayer: React.FC<{
  mapRef: React.RefObject<MapRef>
  enabled: boolean
  /** True in 3D/globe view mode — baked into the layer's renderingMode at
   *  construction (can't change on a live instance), so this recreates the
   *  layer rather than live-updating it. */
  drapeEnabled: boolean
  exaggeration: number
  opacity: number
  textureId: string
  rotationDeg: number
  debugNormals: boolean
  terrainSource: TerrainSource | string
  customTerrainSources: CustomTerrainSource[]
  mapboxKey: string
  maptilerKey: string
  titilerEndpoint: string
}> = ({
  mapRef, enabled, drapeEnabled, exaggeration, opacity, textureId, rotationDeg, debugNormals,
  terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}) => {
  const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
  const layerRef = useRef<MatcapGlLayer | null>(null)
  const active = enabled && !!clientUpstream

  // Recreates the whole GL layer (and its tile-texture cache) only when the
  // upstream DEM identity actually changes, the mode is toggled, or
  // drapeEnabled flips — everything else (opacity/textureId/rotationDeg/
  // debugNormals/exaggeration) updates live via updateOptions below instead,
  // so switching materials or dragging rotation never re-fetches a single tile.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !active || !clientUpstream) return

    const layer = new MatcapGlLayer({
      upstreamTemplate: clientUpstream.template,
      encoding: clientUpstream.encoding,
      tileSize: clientUpstream.tileSize,
      maxzoom: clientUpstream.maxzoom ?? 18,
      matcapUrl: matcapUrlFor(textureId),
      opacity,
      rotationDeg,
      debugNormals,
      drapeEnabled,
      exaggeration,
    })
    layerRef.current = layer

    // map.isStyleLoaded() only reflects the *style's own* sources/sprites/
    // glyphs being ready — it says nothing about whether LayerOrderSlots
    // (MapLayers.tsx), a sibling declarative <Layer>, has actually committed
    // its invisible ordering-marker layers to the map yet. That's a genuine
    // race: this effect and LayerOrderSlots' own mount effect can both fire
    // within the same passive-effect flush. Poll for the actual precondition
    // instead of trusting map.isStyleLoaded()/'styledata'.
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
    // textureId/opacity/rotationDeg/debugNormals/exaggeration intentionally
    // omitted — handled by the live-update effect below instead of
    // recreating the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, active, drapeEnabled, clientUpstream?.template, clientUpstream?.encoding, clientUpstream?.tileSize, clientUpstream?.maxzoom])

  useEffect(() => {
    layerRef.current?.updateOptions({ matcapUrl: matcapUrlFor(textureId), opacity, rotationDeg, debugNormals, exaggeration })
  }, [textureId, opacity, rotationDeg, debugNormals, exaggeration])

  return null
}
