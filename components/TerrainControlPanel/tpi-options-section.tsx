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
  tpiColorRamp: "tpi-diverging",
  tpiMin: undefined,
  tpiMax: undefined,
  tpiInvertColorRamp: false,
  tpiSymmetric: true,
  tpiCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  tpiCustomStopsDiscrete: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "TPI" checkbox that conditionally renders this block underneath it.
export const TpiFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isCustom = state.tpiColorRamp === "custom"
  const isDiscrete = state.tpiCustomStopsDiscrete ?? false
  const customStops = state.tpiCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.tpiColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["tpi-diverging"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.tpiColorRamp])

  // TPI is diverging around 0 (positions above vs. below the local neighborhood mean) —
  // a symmetric -V..+V range is the natural default, same as Curvature.
  const symmetric = state.tpiSymmetric ?? true
  const magnitude = Math.max(
    Math.abs(state.tpiMin ?? rampBounds.min),
    Math.abs(state.tpiMax ?? rampBounds.max),
  )

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
          value={state.tpiColorRamp}
          onValueChange={(value) => setState({
            tpiColorRamp: value,
            tpiMin: undefined,
            tpiMax: undefined,
          })}
          anchorKey="slope-plantopo"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
      </div>

      {isCustom ? (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ tpiCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ tpiCustomStopsDiscrete: discrete })}
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">TPI Range (m)</Label>
            {symmetric ? (
              <DraftBoundInput
                value={magnitude}
                onCommit={(v) => setState({ tpiMin: -Math.abs(v ?? 0), tpiMax: Math.abs(v ?? 0) })}
                className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
              />
            ) : (
              <div className="flex items-center gap-2">
                <DraftBoundInput
                  value={state.tpiMin ?? rampBounds.min}
                  onCommit={(v) => setState({ tpiMin: clampMinCommit(v, state.tpiMax ?? rampBounds.max) })}
                  className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                />
                <DraftBoundInput
                  value={state.tpiMax ?? rampBounds.max}
                  onCommit={(v) => setState({ tpiMax: clampMaxCommit(v, state.tpiMin ?? rampBounds.min) })}
                  className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                />
              </div>
            )}
          </div>
          {symmetric ? (
            <MobileSlider
              sliderId="tpi:range"
              min={0}
              max={100}
              step={1}
              value={[magnitude]}
              onValueChange={([v]) => setState({ tpiMin: -v, tpiMax: v })}
              className="w-full cursor-pointer"
            />
          ) : (
            <MobileSlider
              sliderId="tpi:range"
              min={-100}
              max={100}
              step={1}
              value={[state.tpiMin ?? rampBounds.min, state.tpiMax ?? rampBounds.max]}
              onValueChange={([min, max]) => setState({ tpiMin: Math.min(min, max), tpiMax: Math.max(min, max) })}
              className="w-full cursor-pointer"
            />
          )}
        </div>
      )}

      <div className="flex gap-2">
        {!isCustom && (
        <div className="flex flex-1 items-center gap-2">
          <Checkbox
            id="tpi-symmetric"
            checked={symmetric}
            onCheckedChange={(checked) => setState({ tpiSymmetric: checked === true })}
            className="cursor-pointer"
          />
          <Label htmlFor="tpi-symmetric" className="text-sm font-medium cursor-pointer">
            Symmetric Range
          </Label>
        </div>
        )}

        <div className="flex flex-1 items-center gap-2">
          <Checkbox
            id="tpi-invert-color-ramp"
            checked={state.tpiInvertColorRamp || false}
            onCheckedChange={(checked) => setState({ tpiInvertColorRamp: checked === true })}
            className="cursor-pointer"
          />
          <Label htmlFor="tpi-invert-color-ramp" className="text-sm font-medium cursor-pointer">
            Invert Ramp
          </Label>
        </div>
      </div>
    </div>
  )
}
