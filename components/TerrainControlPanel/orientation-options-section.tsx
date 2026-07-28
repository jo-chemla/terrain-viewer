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
  orientationColorRamp: "orientation-default",
  orientationMin: 0,
  orientationMax: 180,
  orientationInvertColorRamp: false,
  orientationCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  orientationCustomStopsDiscrete: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Dominant Orientation" checkbox that conditionally renders this
// block underneath it. See blobness-options-section.tsx's header for why this
// is a standalone sibling rather than a shared mode selector.
export const OrientationFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isCustom = state.orientationColorRamp === "custom"
  const isDiscrete = state.orientationCustomStopsDiscrete ?? false
  const customStops = state.orientationCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.orientationColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["orientation-default"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.orientationColorRamp])

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
          value={state.orientationColorRamp}
          onValueChange={(value) => setState({
            orientationColorRamp: value,
            orientationMin: undefined,
            orientationMax: undefined,
          })}
          anchorKey="slope-plantopo"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
      </div>

      {isCustom ? (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ orientationCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ orientationCustomStopsDiscrete: discrete })}
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Orientation Range (°)</Label>
            <div className="flex items-center gap-2">
              <DraftBoundInput
                value={state.orientationMin ?? rampBounds.min}
                onCommit={(v) => setState({ orientationMin: clampMinCommit(v, state.orientationMax ?? rampBounds.max) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
              <DraftBoundInput
                value={state.orientationMax ?? rampBounds.max}
                onCommit={(v) => setState({ orientationMax: clampMaxCommit(v, state.orientationMin ?? rampBounds.min) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
            </div>
          </div>
          <MobileSlider
            sliderId="orientation:range"
            min={0}
            max={180}
            step={1}
            value={[state.orientationMin ?? rampBounds.min, state.orientationMax ?? rampBounds.max]}
            onValueChange={([min, max]) => setState({ orientationMin: Math.min(min, max), orientationMax: Math.max(min, max) })}
            className="w-full cursor-pointer"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="orientation-invert-color-ramp"
          checked={state.orientationInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ orientationInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="orientation-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
