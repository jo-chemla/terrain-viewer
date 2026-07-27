import type React from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MobileSlider, DraftBoundInput } from "./controls-components"
import { ColorRampSelectWithCustom, CustomRampStopsEditor } from "./custom-color-ramp"
import { colorRampsClassic, DEFAULT_SLOPE_CUSTOM_STOPS } from "@/lib/color-ramps"

const DEFAULTS = {
  aspectColorRamp: "aspect-compass",
  aspectMinDegrees: undefined,
  aspectMaxDegrees: undefined,
  aspectShiftDegrees: undefined,
  aspectInvertColorRamp: false,
  aspectCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  aspectCustomStopsDiscrete: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Aspect" checkbox that conditionally renders this block underneath it.
export const AspectFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const shiftDegrees = state.aspectShiftDegrees ?? 0
  const isCustom = state.aspectColorRamp === "custom"
  const isDiscrete = state.aspectCustomStopsDiscrete ?? false
  const customStops = state.aspectCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

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
          value={state.aspectColorRamp}
          onValueChange={(value) => setState({
            aspectColorRamp: value,
            aspectMinDegrees: undefined,
            aspectMaxDegrees: undefined,
          })}
          anchorKey="slope-plantopo"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
      </div>

      {isCustom && (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ aspectCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ aspectCustomStopsDiscrete: discrete })}
        />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Aspect Shift (°)</Label>
          <DraftBoundInput
            value={shiftDegrees}
            onCommit={(v) => setState({ aspectShiftDegrees: ((Math.round(v ?? 0) % 360) + 360) % 360 })}
            className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
          />
        </div>
        <MobileSlider
          sliderId="aspect:shift"
          min={0}
          max={360}
          step={1}
          value={[shiftDegrees]}
          onValueChange={([v]) => setState({ aspectShiftDegrees: v })}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="aspect-invert-color-ramp"
          checked={state.aspectInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ aspectInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="aspect-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
