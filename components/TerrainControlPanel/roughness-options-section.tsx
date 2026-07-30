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
  roughnessColorRamp: "roughness-default",
  roughnessMin: undefined,
  roughnessMax: undefined,
  roughnessInvertColorRamp: false,
  roughnessCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  roughnessCustomStopsDiscrete: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Roughness" checkbox that conditionally renders this block
// underneath it.
export const RoughnessFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isCustom = state.roughnessColorRamp === "custom"
  const isDiscrete = state.roughnessCustomStopsDiscrete ?? false
  const customStops = state.roughnessCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.roughnessColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["roughness-default"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.roughnessColorRamp])

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
          value={state.roughnessColorRamp}
          onValueChange={(value) => setState({
            roughnessColorRamp: value,
            roughnessMin: undefined,
            roughnessMax: undefined,
          })}
          anchorKey="slope-plantopo"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
      </div>

      {isCustom ? (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ roughnessCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ roughnessCustomStopsDiscrete: discrete })}
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Roughness Range (m)</Label>
            <div className="flex items-center gap-2">
              <DraftBoundInput
                value={state.roughnessMin ?? rampBounds.min}
                onCommit={(v) => setState({ roughnessMin: clampMinCommit(v, state.roughnessMax ?? rampBounds.max) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
              <DraftBoundInput
                value={state.roughnessMax ?? rampBounds.max}
                onCommit={(v) => setState({ roughnessMax: clampMaxCommit(v, state.roughnessMin ?? rampBounds.min) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
            </div>
          </div>
          <MobileSlider
            sliderId="roughness:range"
            min={0}
            max={250}
            step={1}
            value={[state.roughnessMin ?? rampBounds.min, state.roughnessMax ?? rampBounds.max]}
            onValueChange={([min, max]) => setState({ roughnessMin: Math.min(min, max), roughnessMax: Math.max(min, max) })}
            className="w-full cursor-pointer"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="roughness-invert-color-ramp"
          checked={state.roughnessInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ roughnessInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="roughness-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
