import type React from "react"
import { useMemo, useCallback, useState } from "react"
import { useAtom } from "jotai"
import { ChevronDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { customBasemapSourcesAtom } from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"
import { Section, CycleButtonGroup, SliderControl, SourceAbToggle, GroupHeading } from "./controls-components"
import { BasemapByodSection } from "./basemap-byod-section"

export const BUILTIN_BASEMAP_OPTIONS = [
  { value: "google", label: "Google Hybrid" },
  { value: "mapbox", label: "Mapbox Satellite" },
  { value: "esri", label: "ESRI World Imagery" },
  { value: "googlesat", label: "Google Satellite" },
  { value: "bing", label: "Bing Aerial" },
  { value: "osm", label: "OpenStreetMap" },
]

export const RasterBasemapSection: React.FC<{
  state: any; setState: (updates: any) => void; mapRef: React.RefObject<MapRef>;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
}> = ({ state, setState, mapRef, isOpen, onOpenChange, withSeparator }) => {
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [isWorldwideOpen, setIsWorldwideOpen] = useState(true)

  const basemapSourceOptions = useMemo(() => [
    ...BUILTIN_BASEMAP_OPTIONS,
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
    <Section title="Basemap" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={withSeparator} pulseKey="showRasterBasemap">
      <Collapsible open={isWorldwideOpen} onOpenChange={setIsWorldwideOpen}>
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger className="flex-1 min-w-0 text-left cursor-pointer">
            <GroupHeading>Worldwide Defaults</GroupHeading>
          </CollapsibleTrigger>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 cursor-pointer">
              <Label htmlFor="basemap-per-view" className="text-xs text-muted-foreground cursor-pointer">Simple</Label>
              <Switch
                id="basemap-per-view"
                checked={state.basemapPerView || false}
                onCheckedChange={(checked) => setState({ basemapPerView: checked })}
                className="h-5 w-9 bg-muted data-[state=checked]:bg-primary rounded-full p-1 cursor-pointer border-transparent"
              />
              <Label htmlFor="basemap-per-view" className="text-xs text-muted-foreground cursor-pointer">Split</Label>
            </div>
            <CollapsibleTrigger className="cursor-pointer">
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isWorldwideOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent className="space-y-2 pt-1 pl-2.5">
          <SliderControl
            label="Basemap Opacity"
            value={state.basemapSourceOpacity * 100}
            onChange={(v) => setState({ basemapSourceOpacity: v / 100 })}
            min={0} max={100} step={5}
            suffix="%"
            sliderId="raster-basemap-opacity"
          />

          {state.basemapPerView ? (
            state.splitScreen ? (
              <div className="space-y-2">
                {BUILTIN_BASEMAP_OPTIONS.map(({ value, label }) => (
                  <div key={value} className="flex items-center gap-2 min-w-0">
                    <SourceAbToggle
                      aActive={state.basemapSourceA === value}
                      bActive={state.basemapSourceB === value}
                      onSelectA={() => setState({ basemapSourceA: value })}
                      onSelectB={() => setState({ basemapSourceB: value })}
                    />
                    <Label className="flex-1 text-sm truncate min-w-0">{label}</Label>
                  </div>
                ))}
              </div>
            ) : (
              <RadioGroup value={state.basemapSourceA} onValueChange={(value) => setState({ basemapSourceA: value })} className="gap-2">
                {BUILTIN_BASEMAP_OPTIONS.map(({ value, label }) => (
                  <div key={value} className="flex items-center gap-2 min-w-0">
                    <RadioGroupItem value={value} id={`basemap-source-${value}`} className="cursor-pointer shrink-0" />
                    <Label htmlFor={`basemap-source-${value}`} className="flex-1 text-sm cursor-pointer truncate min-w-0">{label}</Label>
                  </div>
                ))}
              </RadioGroup>
            )
          ) : (
            <CycleButtonGroup
              value={state.basemapSource}
              options={basemapSourceOptions}
              onChange={(v) => setState({ basemapSource: v })}
              onCycle={cycleBasemapSource}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
      <BasemapByodSection state={state} setState={setState} mapRef={mapRef} />
    </Section>
  )
}
