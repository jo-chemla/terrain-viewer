import type React from "react"
import { useMemo, useCallback } from "react"
import { useAtom } from "jotai"
import { Label } from "@/components/ui/label"
import { customBasemapSourcesAtom } from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"
import { Section, CycleButtonGroup } from "./controls-components"
import { BasemapByodSection } from "./basemap-byod-section"

export const RasterBasemapSection: React.FC<{
  state: any; setState: (updates: any) => void; mapRef: React.RefObject<MapRef>;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, mapRef, isOpen, onOpenChange }) => {
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)

  const basemapSourceOptions = useMemo(() => [
    { value: "google", label: "Google Hybrid" },
    { value: "mapbox", label: "Mapbox Satellite" },
    { value: "esri", label: "ESRI World Imagery" },
    { value: "googlesat", label: "Google Satellite" },
    { value: "bing", label: "Bing Aerial" },
    { value: "osm", label: "OpenStreetMap" },
    ...customBasemapSources.map(s => ({ value: s.id, label: s.name }))
  ], [customBasemapSources])

  const sourceKeys = useMemo(() => basemapSourceOptions.map(b => b.value), [basemapSourceOptions])

  const cycleBasemapSource = useCallback((direction: number) => {
    const currentIndex = sourceKeys.indexOf(state.basemapSource)
    const newIndex = (currentIndex + direction + sourceKeys.length) % sourceKeys.length
    setState({ basemapSource: sourceKeys[newIndex] })
  }, [state.basemapSource, sourceKeys, setState])

  if (!state.showRasterBasemap) return null

  return (
    <Section title="Raster Basemap Options" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-2">
        <Label className="text-sm">Source</Label>
        <CycleButtonGroup
          value={state.basemapSource}
          options={basemapSourceOptions}
          onChange={(v) => setState({ basemapSource: v })}
          onCycle={cycleBasemapSource}
        />
      </div>
      <BasemapByodSection state={state} setState={setState} mapRef={mapRef} />
    </Section>
  )
}
