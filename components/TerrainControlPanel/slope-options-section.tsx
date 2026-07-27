import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { ColorRampSelectWithCustom, CustomRampStopsEditor } from "./custom-color-ramp"
import { colorRampsClassic, extractStops, buildCustomRampColors, DEFAULT_SLOPE_CUSTOM_STOPS, type CustomRampStop } from "@/lib/color-ramps"

const DEFAULTS = {
  slopeColorRamp: "slope-plantopo",
  slopeMinDegrees: undefined,
  slopeMaxDegrees: undefined,
  slopeInvertColorRamp: false,
  slopeCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  slopeCustomStopsDiscrete: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Slope" checkbox that conditionally renders this block underneath it.
export const SlopeFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isCustom = state.slopeColorRamp === "custom"
  const isDiscrete = state.slopeCustomStopsDiscrete ?? false

  const rampBounds = useMemo(() => {
    // "custom" has no colorRampsClassic entry — its bounds come from the
    // user's own stops instead of a registry ramp's fixed stops.
    if (isCustom) {
      const stops = extractStops(buildCustomRampColors(state.slopeCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS))
      return { min: Math.min(...stops), max: Math.max(...stops) }
    }
    const ramp = colorRampsClassic[state.slopeColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["slope-plantopo"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [isCustom, state.slopeColorRamp, state.slopeCustomStops])

  const customStops: CustomRampStop[] = state.slopeCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

  return (
    <div className="space-y-4 pl-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Color Ramp</Label>
          <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={() => setState(DEFAULTS)}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <ColorRampSelectWithCustom
          ramps={colorRampsClassic}
          value={state.slopeColorRamp}
          onValueChange={(value) => setState({
            slopeColorRamp: value,
            slopeMinDegrees: undefined,
            slopeMaxDegrees: undefined,
          })}
          anchorKey="slope-plantopo"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
      </div>

      {isCustom ? (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ slopeCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ slopeCustomStopsDiscrete: discrete })}
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Slope Range (°)</Label>
            <div className="flex items-center gap-2">
              <DraftBoundInput
                value={state.slopeMinDegrees ?? rampBounds.min}
                onCommit={(v) => setState({ slopeMinDegrees: clampMinCommit(v, state.slopeMaxDegrees ?? rampBounds.max) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
              <DraftBoundInput
                value={state.slopeMaxDegrees ?? rampBounds.max}
                onCommit={(v) => setState({ slopeMaxDegrees: clampMaxCommit(v, state.slopeMinDegrees ?? rampBounds.min) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
            </div>
          </div>
          <MobileSlider
            sliderId="slope:range"
            min={0}
            max={90}
            step={1}
            value={[state.slopeMinDegrees ?? rampBounds.min, state.slopeMaxDegrees ?? rampBounds.max]}
            onValueChange={([min, max]) => setState({ slopeMinDegrees: Math.min(min, max), slopeMaxDegrees: Math.max(min, max) })}
            className="w-full cursor-pointer"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="slope-invert-color-ramp"
          checked={state.slopeInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ slopeInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="slope-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
