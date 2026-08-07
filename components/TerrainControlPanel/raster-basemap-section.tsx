import type React from "react"
import { useMemo, useCallback, useState } from "react"
import { useAtom } from "jotai"
import { ChevronDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { customBasemapSourcesAtom, hereKeyAtom, mapboxKeyAtom, planetKeyAtom } from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"
import { Section, CycleButtonGroup, SliderControl, SourceAbToggle, GroupHeading } from "./controls-components"
import { BasemapByodSection } from "./basemap-byod-section"
import { useBingCaptureDate } from "@/lib/bing"

// Kept as the full static list (including key-gated providers) so callers like
// TerrainViewer's isKnownId check still recognize a persisted "here" selection
// as built-in rather than an unknown/custom id — the API-key gate only affects
// which options RasterBasemapSection actually offers below.
// "historical" is the single combined entry covering all 4 nested sources
// (ESRI Wayback, HLS, Google Earth Historical, Planet Monthly Mosaic) — which
// one actually renders is picked via the bottom timeline panel's pills/ticks,
// not the sidebar (see lib/historical-sources.ts's resolveActiveHistoricalSource).
export const BUILTIN_BASEMAP_OPTIONS = [
  { value: "historical", label: "Historical Imagery" },
  { value: "google", label: "Google Hybrid" },
  { value: "bing", label: "Bing Aerial" },
  { value: "esri", label: "ESRI World Imagery" },
  { value: "mapbox", label: "Mapbox Satellite" },
  { value: "here", label: "HERE Satellite" },
  { value: "googlesat", label: "Google Satellite" },
  { value: "osm", label: "OpenStreetMap" },
]

// Providers that need an API key to actually load tiles — hidden from the
// picker until a key is set (Settings > API Keys, or a local VITE_*_API_KEY/
// VITE_MAPBOX_ACCESS_TOKEN in .env) so users don't select a basemap that just
// fails to render. Both mapboxKeyAtom and hereKeyAtom default to "" unless
// that local .env var is present — see settings-atoms.ts.
const KEY_GATED_BASEMAPS = { here: hereKeyAtom, mapbox: mapboxKeyAtom, planet: planetKeyAtom } as const

export const RasterBasemapSection: React.FC<{
  state: any; setState: (updates: any) => void; mapRef: React.RefObject<MapRef>;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
  historicalMode?: boolean
}> = ({ state, setState, mapRef, isOpen, onOpenChange, withSeparator, historicalMode = false }) => {
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [hereKey] = useAtom(hereKeyAtom)
  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [planetKey] = useAtom(planetKeyAtom)
  const [isWorldwideOpen, setIsWorldwideOpen] = useState(true)
  // Real "as-of" capture date for Bing's single live mosaic (see lib/bing.ts)
  // — read from the current view center's tile, not per-row/per-selection.
  const { label: bingCaptureLabel } = useBingCaptureDate(state.lat, state.lng, state.zoom)

  const gatedKeyValues: Record<string, string> = { here: hereKey, mapbox: mapboxKey, planet: planetKey }
  const visibleBuiltinOptions = useMemo(
    () => BUILTIN_BASEMAP_OPTIONS
      .filter((o) => !(o.value in KEY_GATED_BASEMAPS) || !!gatedKeyValues[o.value])
      .filter((o) => state.historicalBeta || o.value !== "historical"),
    [hereKey, mapboxKey, planetKey, state.historicalBeta],
  )

  const basemapSourceOptions = useMemo(() => [
    ...visibleBuiltinOptions,
    ...customBasemapSources.map(s => ({ value: s.id, label: s.name }))
  ], [visibleBuiltinOptions, customBasemapSources])

  const sourceKeys = useMemo(() => basemapSourceOptions.map(b => b.value), [basemapSourceOptions])

  const cycleBasemapSource = useCallback((direction: number) => {
    const currentIndex = sourceKeys.indexOf(state.basemapSource)
    const newIndex = (currentIndex + direction + sourceKeys.length) % sourceKeys.length
    setState({ basemapSource: sourceKeys[newIndex] })
  }, [state.basemapSource, sourceKeys, setState])

  // Split screen always wants a per-side basemap — no reason to ever be in
  // "Simple" (one shared cycling control) while actually looking at two
  // panes, so this reads as per-view regardless of the persisted
  // basemapPerView flag whenever splitScreen is on (see the hidden-toggle
  // comment below), without needing to overwrite that flag itself.
  const perViewEffective = state.basemapPerView || state.splitScreen

  return (
    <Section title="Basemap" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={withSeparator} pulseKey="showRasterBasemap">
      <Collapsible open={isWorldwideOpen} onOpenChange={setIsWorldwideOpen}>
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger className="flex-1 min-w-0 text-left cursor-pointer">
            <GroupHeading>Worldwide Defaults</GroupHeading>
          </CollapsibleTrigger>
          <div className="flex items-center gap-3 shrink-0">
            {/* Meaningless once the viewport itself is already split — split
                screen obviously wants a per-side basemap, so this toggle
                just disappears and perViewEffective below (splitScreen alone
                already implies "Split") takes over instead of asking the
                user to also flip a second, redundant switch. */}
            {!state.splitScreen && (
              <div className="flex items-center gap-2 cursor-pointer">
                <Label htmlFor="basemap-per-view" className="text-xs text-muted-foreground cursor-pointer">Simple</Label>
                <Switch
                  id="basemap-per-view"
                  checked={state.basemapPerView || false}
                  onCheckedChange={(checked) => setState({ basemapPerView: checked })}
                  className="h-5 w-9 bg-muted data-checked:bg-primary rounded-full p-1 cursor-pointer border-transparent"
                />
                <Label htmlFor="basemap-per-view" className="text-xs text-muted-foreground cursor-pointer">Split</Label>
              </div>
            )}
            <CollapsibleTrigger className="cursor-pointer">
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isWorldwideOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent className="space-y-2 pt-1 pl-2.5">
          {/* Historical mode has exactly one visualization mode (this
              basemap) at full opacity by construction — nothing else to
              blend it against, so the slider has no effect to show for. */}
          {!historicalMode && (
            <SliderControl
              label="Basemap Opacity"
              value={state.basemapSourceOpacity * 100}
              onChange={(v) => setState({ basemapSourceOpacity: v / 100 })}
              min={0} max={100} step={5}
              suffix="%"
              sliderId="raster-basemap-opacity"
            />
          )}

          {perViewEffective ? (
            state.splitScreen ? (
              <div className="space-y-1.5">
                <GroupHeading>Basemaps</GroupHeading>
                {visibleBuiltinOptions.map(({ value, label }) => (
                  <div key={value} className="flex items-center gap-2 min-w-0">
                    <SourceAbToggle
                      aActive={state.basemapSourceA === value}
                      bActive={state.basemapSourceB === value}
                      onSelectA={() => setState({ basemapSourceA: value })}
                      onSelectB={() => setState({ basemapSourceB: value })}
                    />
                    <Label className="flex-1 text-sm truncate min-w-0">
                      {label}
                      {value === "bing" && bingCaptureLabel && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground font-normal tabular-nums">({bingCaptureLabel})</span>
                      )}
                    </Label>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                <GroupHeading>Basemaps</GroupHeading>
                {/* py-1: unlike every other RadioGroup list in this app (terrain's
                    rows carry two h-8 icon buttons via SourceDetails/CustomSourceDetails,
                    and this same list's own split-mode rows carry SourceAbToggle's h-9
                    A/B buttons), a builtin basemap row is just a bare radio + one-line
                    Label — with no button padding to give it height, gap-2 alone reads
                    as visibly more compact than every other list even though the gap
                    value is identical. This restores that height without touching the
                    shared gap. */}
                <RadioGroup value={state.basemapSourceA} onValueChange={(value) => setState({ basemapSourceA: value })} className="gap-2">
                  {visibleBuiltinOptions.map(({ value, label }) => (
                    <div key={value} className="flex items-center gap-2 min-w-0 py-1">
                      <RadioGroupItem value={value} id={`basemap-source-${value}`} className="cursor-pointer shrink-0" />
                      <Label htmlFor={`basemap-source-${value}`} className="flex-1 text-sm cursor-pointer truncate min-w-0">
                        {label}
                        {value === "bing" && bingCaptureLabel && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground font-normal tabular-nums">({bingCaptureLabel})</span>
                        )}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
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
