// React wrapper for lib/phong-live-gl-layer.ts's PhongLiveLayer — the "Fast"
// (flat, live-uniform) alternative to PhongSource/PhongRasterLayer's raster-
// protocol pipeline (see that file's header for why it's flat-only). Mounted
// imperatively via map.addLayer/removeLayer since react-map-gl's declarative
// <Layer> doesn't support `type: "custom"`, matching the mount/update split
// the prior (deleted) PhongGlLayer wrapper used: a full remount only when the
// upstream DEM changes (every cached normal texture would otherwise be for
// the wrong terrain), light/strength/exaggeration/opacity changes go through
// updateOptions() instead — a live uniform write, never a remount.
import { useEffect, useRef } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import type { CustomLayerInterface } from "maplibre-gl"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource } from "@/lib/settings-atoms"
import { PhongLiveLayer as PhongLiveLayerImpl, type PhongLiveOptions } from "@/lib/phong-live-gl-layer"
import { useClientDemUpstream } from "./MapSources"
import { LAYER_SLOTS } from "./MapLayers"

const LIVE_LAYER_ID = "phong-live"

export function PhongLiveGlLayer({
  mapRef, enabled,
  diffuseStrength, specularStrength, lightDir, lightAlt, lightRelativeToCamera, exaggeration, opacity,
  terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}: {
  mapRef: React.RefObject<MapRef>
  enabled: boolean
  diffuseStrength: number
  specularStrength: number
  lightDir: number
  lightAlt: number
  lightRelativeToCamera: boolean
  exaggeration: number
  opacity: number
  terrainSource: TerrainSource | string
  customTerrainSources: CustomTerrainSource[]
  mapboxKey: string
  maptilerKey: string
  titilerEndpoint: string
}) {
  const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
  const layerRef = useRef<PhongLiveLayerImpl | null>(null)

  useEffect(() => {
    if (!enabled || !clientUpstream) return
    const map = mapRef.current?.getMap()
    if (!map) return

    const options: PhongLiveOptions = {
      upstreamTemplate: clientUpstream.template,
      encoding: clientUpstream.encoding,
      tileSize: clientUpstream.tileSize,
      minzoom: clientUpstream.minzoom,
      maxzoom: clientUpstream.maxzoom,
      diffuseStrength, specularStrength, lightDir, lightAlt, lightRelativeToCamera, exaggeration, opacity,
    }
    const layer = new PhongLiveLayerImpl(LIVE_LAYER_ID, options)
    layerRef.current = layer
    let cancelled = false
    let rafHandle: number | null = null

    // The LAYER_SLOTS.PHONG marker (a `background`-type layer rendered by
    // MapLayers.tsx's LayerOrderSlots) must already exist for `beforeId` to
    // resolve — on first mount/a basemap style swap that isn't guaranteed to
    // be true yet, so retry across frames rather than assuming a single
    // effect run wins the race (same reasoning the prior, now-deleted
    // PhongGlLayer wrapper had for the same problem).
    const tryAddLayer = () => {
      if (cancelled) return
      if (!map.getLayer(LIVE_LAYER_ID) && map.getLayer(LAYER_SLOTS.PHONG)) {
        map.addLayer(layer as unknown as CustomLayerInterface, LAYER_SLOTS.PHONG)
        return
      }
      if (!map.getLayer(LIVE_LAYER_ID)) rafHandle = requestAnimationFrame(tryAddLayer)
    }
    tryAddLayer()

    // A basemap style swap (map.setStyle) clears every layer, including ones
    // added imperatively outside react-map-gl's own bookkeeping — re-add once
    // the new style has finished loading rather than silently staying gone.
    const onStyleData = () => {
      if (!map.getLayer(LIVE_LAYER_ID)) tryAddLayer()
    }
    map.on("styledata", onStyleData)

    return () => {
      cancelled = true
      if (rafHandle !== null) cancelAnimationFrame(rafHandle)
      map.off("styledata", onStyleData)
      layerRef.current = null
      if (map.getLayer(LIVE_LAYER_ID)) map.removeLayer(LIVE_LAYER_ID)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clientUpstream?.template, clientUpstream?.encoding, clientUpstream?.tileSize, clientUpstream?.minzoom, clientUpstream?.maxzoom, mapRef])

  useEffect(() => {
    layerRef.current?.updateOptions({ diffuseStrength, specularStrength, lightDir, lightAlt, lightRelativeToCamera, exaggeration, opacity })
  }, [diffuseStrength, specularStrength, lightDir, lightAlt, lightRelativeToCamera, exaggeration, opacity])

  return null
}
