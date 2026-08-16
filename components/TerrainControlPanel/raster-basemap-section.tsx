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
import { Section, CycleButtonGroup, SliderControl, SourceGridToggle, GroupHeading } from "./controls-components"
import { BasemapByodSection } from "./basemap-byod-section"
import { useBingCaptureDate } from "@/lib/bing"
import { useEsriLiveCaptureDate } from "@/lib/wayback"
import { activeViews, viewFieldName, type ViewId, type GridLayoutId } from "@/lib/grid-layouts"

// Kept as the full static list (including key-gated providers) so callers like
// TerrainViewer's isKnownId check still recognize a persisted "here" selection
// as built-in rather than an unknown/custom id — the API-key gate only affects
// which options RasterBasemapSection actually offers below.
// "historical" is the single combined entry covering all 4 nested sources
// (ESRI Wayback, HLS, Google Earth Historical, Planet Monthly Mosaic) — which
// one actually renders is picked via the bottom timeline panel's pills/ticks,
// not the sidebar (see lib/historical-sources.ts's resolveActiveHistoricalSource).
export const BUILTIN_BASEMAP_OPTIONS = [
  { value: "historical", label: "Historical Imagery", shortLabel: "Historical" },
  { value: "google", label: "Google Hybrid", shortLabel: "Google" },
  { value: "bing", label: "Bing Aerial", shortLabel: "Bing" },
  { value: "esri", label: "ESRI World Imagery", shortLabel: "ESRI" },
  { value: "mapbox", label: "Mapbox Satellite", shortLabel: "Mapbox" },
  { value: "here", label: "HERE Satellite", shortLabel: "HERE" },
  { value: "googlesat", label: "Google Satellite", shortLabel: "Google Sat" },
  { value: "osm", label: "OpenStreetMap", shortLabel: "OSM" },
]

// Lookup by id for the capture-date pill's compact source label — falls back
// to the raw basemap id (e.g. a custom BYOD source) when not one of the
// builtins above.
export const BASEMAP_SHORT_LABELS: Record<string, string> = Object.fromEntries(
  BUILTIN_BASEMAP_OPTIONS.map((o) => [o.value, o.shortLabel]),
)

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
  // Same idea for plain "ESRI World Imagery" — it's always showing whichever
  // Wayback release is currently newest at this location (see
  // useEsriLiveCaptureDate's own doc comment), so it has a real capture date
  // too, not just a static "always current" implication.
  const { label: esriCaptureLabel } = useEsriLiveCaptureDate(state.lat, state.lng, state.zoom)

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
  // "Simple" (one shared cycling control) while actually looking at two+
  // panes, so this reads as per-view regardless of the persisted
  // basemapPerView flag whenever split is on (see the hidden-toggle
  // comment below), without needing to overwrite that flag itself.
  const isSplit = state.splitStyle !== "off"
  const perViewEffective = state.basemapPerView || isSplit

  return (
    <Section id="tour-basemap-section" title="Basemap" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={withSeparator} pulseKey="showRasterBasemap">
      <Collapsible open={isWorldwideOpen} onOpenChange={setIsWorldwideOpen}>
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger className="flex-1 min-w-0 text-left cursor-pointer">
            <GroupHeading>Worldwide Defaults</GroupHeading>
          </CollapsibleTrigger>
          <div className="flex items-center gap-3 shrink-0">
            {/* Meaningless once the viewport itself is already split — split
                screen obviously wants a per-side basemap, so this toggle
                just disappears and perViewEffective below (being split
                already implies "Split") takes over instead of asking the
                user to also flip a second, redundant switch. */}
            {!isSplit && (
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
            isSplit ? (
              <div className="space-y-1.5">
                <GroupHeading>Basemaps</GroupHeading>
                {visibleBuiltinOptions.map(({ value, label }) => {
                  // Terrain mode's own split (Overlay or Side) is always
                  // forced to 2x1 (see TerrainViewer's effectiveGridLayout),
                  // but state.gridLayout itself isn't reset on a mode
                  // switch — without the !historicalMode check here, this
                  // picker kept showing whichever grid (e.g. 3x2, A-F) was
                  // last picked in Historical mode even after the map
                  // itself had already collapsed back to just A/B.
                  const gridLayout: GridLayoutId = (state.splitStyle === "overlay" || !historicalMode) ? "2x1" : state.gridLayout
                  const setAllViewsToThisSource = () => {
                    const patch: Record<string, string> = {}
                    for (const side of activeViews(gridLayout)) patch[viewFieldName(side, "basemapSource", true)] = value
                    setState(patch)
                  }
                  return (
                    <div key={value} className="flex items-center gap-2 min-w-0">
                      <SourceGridToggle
                        gridLayout={gridLayout}
                        // isSplit always means per-view basemap fields, even if
                        // basemapPerView's own persisted value happens to be
                        // false — see perViewEffective's header comment above.
                        isActive={(side: ViewId) => state[viewFieldName(side, "basemapSource", true)] === value}
                        onSelect={(side: ViewId) => setState({ [viewFieldName(side, "basemapSource", true)]: value })}
                      />
                      <Label
                        className="flex-1 text-sm truncate min-w-0 cursor-pointer"
                        title={`Set all views to ${label}`}
                        onClick={setAllViewsToThisSource}
                      >
                        {label}
                        {value === "bing" && bingCaptureLabel && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground font-normal tabular-nums">({bingCaptureLabel})</span>
                        )}
                        {value === "esri" && esriCaptureLabel && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground font-normal tabular-nums">({esriCaptureLabel})</span>
                        )}
                      </Label>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-1">
                <GroupHeading>Basemaps</GroupHeading>
                {/* py-1: unlike every other RadioGroup list in this app (terrain's
                    rows carry two h-8 icon buttons via SourceDetails/CustomSourceDetails,
                    and this same list's own split-mode rows carry SourceGridToggle's
                    buttons), a builtin basemap row is just a bare radio + one-line
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
                        {value === "esri" && esriCaptureLabel && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground font-normal tabular-nums">({esriCaptureLabel})</span>
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
