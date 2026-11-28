import type React from "react"
import { useCallback, useMemo, useState } from "react"
import { useAtomValue } from "jotai"
import { Loader2, RotateCcw, Sigma } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { pushToast } from "@/components/ui/toast"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { ColorRampSelectWithCustom, CustomRampStopsEditor } from "./custom-color-ramp"
import { SourceCombobox } from "./source-combobox"
import { measureDifference } from "./diff-auto-offset"
import { colorRampsClassic, extractStops, DEFAULT_SLOPE_CUSTOM_STOPS } from "@/lib/color-ramps"
import { customTerrainSourcesAtom, mapboxKeyAtom, maptilerKeyAtom, titilerEndpointAtom } from "@/lib/settings-atoms"
import { findTerrainSource, withWorldwideDefaults } from "@/lib/terrain-catalog"
import { NDSM_PRESETS, withNdsmSubtrahend } from "@/lib/ndsm-mode"
import { activeViews } from "@/lib/grid-layouts"
import { effectiveGridLayout, parseVizViews, viewDrawsMode } from "@/lib/viz-views"
import { useClientDemUpstream } from "@/components/LayersAndSources/MapSources"

const DEFAULTS = {
  ...NDSM_PRESETS.heights,
  ndsmCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  ndsmCustomStopsDiscrete: false,
}

/** The first view that draws the mode: its terrain is the one named in the
 *  formula line and sampled by the offset measurement. */
function firstNdsmView(state: Record<string, any>): string {
  if (!state.splitStyle || state.splitStyle === "off" || state.vizSync !== false) return "A"
  const v = parseVizViews(state.vizViews || "")
  return activeViews(effectiveGridLayout(state)).find((side) => viewDrawsMode(v, "showNdsm", side) && viewDrawsMode(v, "showReliefVisualization", side)) ?? "A"
}

// Fields-only (no Section wrapper/gate) — embedded inside
// ReliefVisualizationOptionsSection under the "nDSM / Difference"
// checkbox. The subtrahend and the direction always show (the mode draws
// nothing without a subtrahend); the ramp, the range and the offset are the
// section's advanced settings, as for its neighbors.
export const NdsmFields: React.FC<{
  state: any; setState: (updates: any) => void
  advanced: boolean
  mapRef?: React.RefObject<MapRef | null>
}> = ({ state, setState, advanced, mapRef }) => {
  const customTerrainSources = useAtomValue(customTerrainSourcesAtom)
  const mapboxKey = useAtomValue(mapboxKeyAtom)
  const maptilerKey = useAtomValue(maptilerKeyAtom)
  const titilerEndpoint = useAtomValue(titilerEndpointAtom)

  const subtrahend: string = state.ndsmSubtrahend ?? ""
  const side = firstNdsmView(state)
  const terrainId: string = state[`source${side}`] ?? state.sourceA
  // Every terrain source but differences (one level, as for the difference
  // source), plus the current subtrahend when a link named a library entry
  // the user has not added.
  const sources = useMemo(() => withNdsmSubtrahend(customTerrainSources, subtrahend), [customTerrainSources, subtrahend])
  const options = useMemo(
    () => withWorldwideDefaults(sources).filter((s) => s.type !== "dem-diff").map((s) => ({ id: s.id, name: s.name })),
    [sources],
  )
  const terrainName = findTerrainSource(terrainId, sources)?.name ?? terrainId
  const subtrahendName = findTerrainSource(subtrahend, sources)?.name
  const invert = state.ndsmInvert ?? false

  // The offset measurement samples the same two templates the layer draws.
  const opTerrain = useClientDemUpstream(subtrahend ? terrainId : "", sources, mapboxKey, maptilerKey, titilerEndpoint)
  const opSubtrahend = useClientDemUpstream(subtrahend, sources, mapboxKey, maptilerKey, titilerEndpoint)
  const [busy, setBusy] = useState(false)
  const offset: number = state.ndsmOffset ?? 0
  const measure = useCallback(async () => {
    const map = mapRef?.current?.getMap()
    if (!map || !opTerrain || !opSubtrahend) {
      pushToast({ key: "ndsm-offset", tone: "warn", title: "Cannot sample the difference yet", body: "Both sources have to be resolvable first: one is still loading its metadata, or no subtrahend is chosen." })
      return
    }
    setBusy(true)
    try {
      const m = invert ? await measureDifference(map, opSubtrahend, opTerrain) : await measureDifference(map, opTerrain, opSubtrahend)
      if (!m.ok) {
        pushToast({ key: "ndsm-offset", tone: "warn", title: "Not enough overlap on screen", body: `Only ${m.count} pixels had both sources here. Move to where both have data and try again.` })
        return
      }
      // The offset is added to the difference: minus what was measured.
      const next = Math.round(-m.mean * 10) / 10
      setState({ ndsmOffset: next })
      pushToast({
        key: "ndsm-offset",
        title: `Offset set to ${next > 0 ? "+" : ""}${next} m`,
        body: `Interquartile mean of ${m.count.toLocaleString()} samples over ${m.tiles} tile${m.tiles === 1 ? "" : "s"} at z${m.z} (median ${m.median >= 0 ? "+" : ""}${m.median.toFixed(1)} m). The difference now centers on zero for this area; press again to reset.`,
        duration: 8000,
      })
    } finally {
      setBusy(false)
    }
  }, [mapRef, opTerrain, opSubtrahend, invert, setState])

  const isCustom = state.ndsmColorRamp === "custom"
  const isDiscrete = state.ndsmCustomStopsDiscrete ?? false
  const customStops = state.ndsmCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.ndsmColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["ndsm-heights"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.ndsmColorRamp])
  const symmetric = state.ndsmSymmetric ?? false
  const min: number = state.ndsmMin ?? rampBounds.min
  const max: number = state.ndsmMax ?? rampBounds.max
  const magnitude = Math.max(Math.abs(min), Math.abs(max))
  const sliderMax = Math.max(100, Math.ceil(magnitude))
  const isPreset = (p: Record<string, unknown>) => Object.entries(p).every(([k, v]) => state[k] === v)
  const hasOffset = offset !== 0
  const sameAsTerrain = !!subtrahend && subtrahend === terrainId

  return (
    <div className="space-y-4 pl-6 min-w-0">
      <div className="space-y-2 min-w-0">
        <Label htmlFor="ndsm-subtrahend" className="text-sm font-medium">Subtract (e.g. a DTM, or an earlier date)</Label>
        <SourceCombobox id="ndsm-subtrahend" value={subtrahend} onChange={(id) => setState({ ndsmSubtrahend: id })} options={options} placeholder="Search a terrain source…" />
        {sameAsTerrain ? (
          <p className="text-xs text-destructive break-words">This is view {side}'s own terrain: the difference would be 0 everywhere. Pick another source.</p>
        ) : subtrahendName ? (
          <p className="text-xs text-muted-foreground break-words" title="What the layer shows, in meters">
            = {invert ? subtrahendName : terrainName} − {invert ? terrainName : subtrahendName}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground break-words">
            {subtrahend ? "This source is not in your list: add it from the terrain library." : "The layer shows this view's terrain minus the source chosen here. The view keeps its own terrain for hillshade and 3D."}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id="ndsm-invert"
            checked={invert}
            onCheckedChange={(checked) => setState({ ndsmInvert: checked === true })}
            className="cursor-pointer"
          />
          <Label htmlFor="ndsm-invert" className="text-sm font-medium cursor-pointer">
            Invert (subtracted source − terrain)
          </Label>
        </div>
      </div>

      {advanced && (<>
        <div className="space-y-2 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <Label className="text-sm font-medium">Color Ramp</Label>
            <div className="flex items-center gap-1 min-w-0">
              <Button variant={isPreset(NDSM_PRESETS.heights) ? "secondary" : "ghost"} size="sm" className="h-6 px-2 text-xs cursor-pointer" title="Heights above ground: 0 to 30 m, the ground left untinted" onClick={() => setState(NDSM_PRESETS.heights)}>
                Heights
              </Button>
              <Button variant={isPreset(NDSM_PRESETS.change) ? "secondary" : "ghost"} size="sm" className="h-6 px-2 text-xs cursor-pointer" title="Change between two dates: diverging, symmetric around 0, ±10 m" onClick={() => setState(NDSM_PRESETS.change)}>
                Change
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" title="Reset the ramp and range" onClick={() => setState(DEFAULTS)}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <ColorRampSelectWithCustom
            ramps={colorRampsClassic}
            value={state.ndsmColorRamp}
            onValueChange={(value) => setState({ ndsmColorRamp: value })}
            anchorKey="ndsm-heights"
            customStops={customStops}
            customStopsDiscrete={isDiscrete}
          />
        </div>

        {isCustom ? (
          <CustomRampStopsEditor
            customStops={customStops}
            onStopsChange={(stops) => setState({ ndsmCustomStops: stops })}
            isDiscrete={isDiscrete}
            onDiscreteChange={(discrete) => setState({ ndsmCustomStopsDiscrete: discrete })}
          />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Range (m)</Label>
              {symmetric ? (
                <DraftBoundInput
                  value={magnitude}
                  onCommit={(v) => setState({ ndsmMin: -Math.abs(v ?? 0), ndsmMax: Math.abs(v ?? 0) })}
                  className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <DraftBoundInput
                    value={min}
                    onCommit={(v) => setState({ ndsmMin: clampMinCommit(v, max) })}
                    className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                  />
                  <DraftBoundInput
                    value={max}
                    onCommit={(v) => setState({ ndsmMax: clampMaxCommit(v, min) })}
                    className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                  />
                </div>
              )}
            </div>
            {symmetric ? (
              <MobileSlider
                sliderId="ndsm:range"
                min={1}
                max={sliderMax}
                step={1}
                value={Math.max(1, magnitude)}
                onValueChange={(v) => setState({ ndsmMin: -(v as number), ndsmMax: v as number })}
                className="w-full cursor-pointer"
              />
            ) : (
              <MobileSlider
                sliderId="ndsm:range"
                min={-sliderMax}
                max={sliderMax}
                step={1}
                value={[min, max]}
                onValueChange={([lo, hi]) => setState({ ndsmMin: Math.min(lo, hi), ndsmMax: Math.max(lo, hi) })}
                className="w-full cursor-pointer"
              />
            )}
          </div>
        )}

        <div className="flex gap-2">
          {!isCustom && (
            <div className="flex flex-1 items-center gap-2">
              <Checkbox
                id="ndsm-symmetric"
                checked={symmetric}
                onCheckedChange={(checked) => setState(checked === true ? { ndsmSymmetric: true, ndsmMin: -magnitude, ndsmMax: magnitude } : { ndsmSymmetric: false })}
                className="cursor-pointer"
              />
              <Label htmlFor="ndsm-symmetric" className="text-sm font-medium cursor-pointer">
                Symmetric Range
              </Label>
            </div>
          )}
          <div className="flex flex-1 items-center gap-2">
            <Checkbox
              id="ndsm-invert-color-ramp"
              checked={state.ndsmInvertColorRamp || false}
              onCheckedChange={(checked) => setState({ ndsmInvertColorRamp: checked === true })}
              className="cursor-pointer"
            />
            <Label htmlFor="ndsm-invert-color-ramp" className="text-sm font-medium cursor-pointer">
              Invert Ramp
            </Label>
          </div>
        </div>

        {/* The same offset as the difference source's (diff-auto-offset.tsx):
            typed, or measured from the tiles on screen. */}
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">Offset</Label>
          <div className="flex items-center gap-1.5">
            <DraftBoundInput
              value={offset}
              onCommit={(v) => setState({ ndsmOffset: v && Number.isFinite(v) ? Math.round(v * 10) / 10 : 0 })}
              placeholder="0"
              className="h-6 py-1 px-1 w-16 min-w-0 text-xs text-right bg-transparent border rounded tabular-nums"
              step={0.1}
            />
            <span className="text-xs text-muted-foreground">m</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 cursor-pointer" disabled={busy} aria-label={hasOffset ? "Reset the offset" : "Measure the offset"}
                    onClick={() => (hasOffset ? setState({ ndsmOffset: 0 }) : void measure())}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : hasOffset ? <RotateCcw className="h-3.5 w-3.5" /> : <Sigma className="h-3.5 w-3.5" />}
                  </Button>
                }
              />
              <TooltipContent>
                <p className="max-w-[260px] break-words">
                  {hasOffset
                    ? "Reset the offset to 0 m. Use this for a true nDSM: zero means bare earth, and the measured constant was the height of what stands on it."
                    : "Measure the constant between the two sources over the area on screen (interquartile mean) and set the offset so the difference centers on zero: for a datum or co-registration difference, or two dates of the same ground."}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </>)}
    </div>
  )
}
