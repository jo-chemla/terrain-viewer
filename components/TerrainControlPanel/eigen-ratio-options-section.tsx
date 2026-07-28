import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { ColorRampSelectWithCustom, CustomRampStopsEditor } from "./custom-color-ramp"
import { colorRampsClassic, extractStops, DEFAULT_SLOPE_CUSTOM_STOPS } from "@/lib/color-ramps"

const DEFAULTS = {
  eigenRatioColorRamp: "eigen-ratio-default",
  eigenRatioMin: 0,
  eigenRatioMax: 100,
  eigenRatioInvertColorRamp: false,
  eigenRatioCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  eigenRatioCustomStopsDiscrete: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Eigenvalue Ratio" checkbox that conditionally renders this
// block underneath it. See blobness-options-section.tsx's header for why this
// is a standalone sibling rather than a shared mode selector.
export const EigenRatioFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isCustom = state.eigenRatioColorRamp === "custom"
  const isDiscrete = state.eigenRatioCustomStopsDiscrete ?? false
  const customStops = state.eigenRatioCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.eigenRatioColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["eigen-ratio-default"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.eigenRatioColorRamp])

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
          value={state.eigenRatioColorRamp}
          onValueChange={(value) => setState({
            eigenRatioColorRamp: value,
            eigenRatioMin: undefined,
            eigenRatioMax: undefined,
          })}
          anchorKey="slope-plantopo"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
      </div>

      {isCustom ? (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ eigenRatioCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ eigenRatioCustomStopsDiscrete: discrete })}
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Eigenvalue Ratio Range (%)</Label>
            <div className="flex items-center gap-2">
              <DraftBoundInput
                value={state.eigenRatioMin ?? rampBounds.min}
                onCommit={(v) => setState({ eigenRatioMin: clampMinCommit(v, state.eigenRatioMax ?? rampBounds.max) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
              <DraftBoundInput
                value={state.eigenRatioMax ?? rampBounds.max}
                onCommit={(v) => setState({ eigenRatioMax: clampMaxCommit(v, state.eigenRatioMin ?? rampBounds.min) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
            </div>
          </div>
          <MobileSlider
            sliderId="eigen-ratio:range"
            min={0}
            max={100}
            step={1}
            value={[state.eigenRatioMin ?? rampBounds.min, state.eigenRatioMax ?? rampBounds.max]}
            onValueChange={([min, max]) => setState({ eigenRatioMin: Math.min(min, max), eigenRatioMax: Math.max(min, max) })}
            className="w-full cursor-pointer"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="eigen-ratio-invert-color-ramp"
          checked={state.eigenRatioInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ eigenRatioInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="eigen-ratio-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
