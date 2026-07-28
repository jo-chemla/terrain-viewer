import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { ColorRampSelectWithCustom, CustomRampStopsEditor } from "./custom-color-ramp"
import { colorRampsClassic, extractStops, DEFAULT_SHAPE_INDEX_CUSTOM_STOPS } from "@/lib/color-ramps"

// Defaults straight into the 5-band discrete classification (dome/ridge/
// saddle/valley/bowl) via the custom-stops editor — see
// DEFAULT_SHAPE_INDEX_CUSTOM_STOPS's own comment for why that, not a
// colorRampsClassic preset, is this app's only real way to get a discrete look.
const DEFAULTS = {
  shapeIndexColorRamp: "custom",
  shapeIndexMin: undefined,
  shapeIndexMax: undefined,
  shapeIndexInvertColorRamp: false,
  shapeIndexSymmetric: true,
  shapeIndexCustomStops: DEFAULT_SHAPE_INDEX_CUSTOM_STOPS,
  shapeIndexCustomStopsDiscrete: true,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Shape Index" checkbox that conditionally renders this block underneath it.
export const ShapeIndexFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isCustom = (state.shapeIndexColorRamp ?? DEFAULTS.shapeIndexColorRamp) === "custom"
  const isDiscrete = state.shapeIndexCustomStopsDiscrete ?? true
  const customStops = state.shapeIndexCustomStops ?? DEFAULT_SHAPE_INDEX_CUSTOM_STOPS

  const rampBounds = useMemo(() => {
    if (isCustom) return { min: -1, max: 1 }
    const ramp = colorRampsClassic[state.shapeIndexColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["curvature-diverging"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.shapeIndexColorRamp, isCustom])

  // Always in [-1, 1] by construction (see lib/curvature-protocol.ts's
  // computeShapeIndex) — symmetric around 0 (saddle) is the natural default.
  const symmetric = state.shapeIndexSymmetric ?? true
  const magnitude = Math.max(
    Math.abs(state.shapeIndexMin ?? rampBounds.min),
    Math.abs(state.shapeIndexMax ?? rampBounds.max),
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
          value={state.shapeIndexColorRamp ?? DEFAULTS.shapeIndexColorRamp}
          onValueChange={(value) => setState({
            shapeIndexColorRamp: value,
            shapeIndexMin: undefined,
            shapeIndexMax: undefined,
          })}
          anchorKey="slope-plantopo"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
      </div>

      {isCustom ? (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ shapeIndexCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ shapeIndexCustomStopsDiscrete: discrete })}
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Shape Index Range</Label>
            {symmetric ? (
              <DraftBoundInput
                value={magnitude}
                onCommit={(v) => setState({ shapeIndexMin: -Math.abs(v ?? 0), shapeIndexMax: Math.abs(v ?? 0) })}
                className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
                step={0.02}
              />
            ) : (
              <div className="flex items-center gap-2">
                <DraftBoundInput
                  value={state.shapeIndexMin ?? rampBounds.min}
                  onCommit={(v) => setState({ shapeIndexMin: clampMinCommit(v, state.shapeIndexMax ?? rampBounds.max) })}
                  className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                  step={0.02}
                />
                <DraftBoundInput
                  value={state.shapeIndexMax ?? rampBounds.max}
                  onCommit={(v) => setState({ shapeIndexMax: clampMaxCommit(v, state.shapeIndexMin ?? rampBounds.min) })}
                  className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                  step={0.02}
                />
              </div>
            )}
          </div>
          {symmetric ? (
            <MobileSlider
              sliderId="shape-index:range"
              min={0}
              max={1}
              step={0.02}
              value={[magnitude]}
              onValueChange={([v]) => setState({ shapeIndexMin: -v, shapeIndexMax: v })}
              className="w-full cursor-pointer"
            />
          ) : (
            <MobileSlider
              sliderId="shape-index:range"
              min={-1}
              max={1}
              step={0.02}
              value={[state.shapeIndexMin ?? rampBounds.min, state.shapeIndexMax ?? rampBounds.max]}
              onValueChange={([min, max]) => setState({ shapeIndexMin: Math.min(min, max), shapeIndexMax: Math.max(min, max) })}
              className="w-full cursor-pointer"
            />
          )}
        </div>
      )}

      <div className="flex gap-2">
        {!isCustom && (
        <div className="flex flex-1 items-center gap-2">
          <Checkbox
            id="shape-index-symmetric"
            checked={symmetric}
            onCheckedChange={(checked) => setState({ shapeIndexSymmetric: checked === true })}
            className="cursor-pointer"
          />
          <Label htmlFor="shape-index-symmetric" className="text-sm font-medium cursor-pointer">
            Symmetric Range
          </Label>
        </div>
        )}

        <div className="flex flex-1 items-center gap-2">
          <Checkbox
            id="shape-index-invert-color-ramp"
            checked={state.shapeIndexInvertColorRamp || false}
            onCheckedChange={(checked) => setState({ shapeIndexInvertColorRamp: checked === true })}
            className="cursor-pointer"
          />
          <Label htmlFor="shape-index-invert-color-ramp" className="text-sm font-medium cursor-pointer">
            Invert Ramp
          </Label>
        </div>
      </div>
    </div>
  )
}
