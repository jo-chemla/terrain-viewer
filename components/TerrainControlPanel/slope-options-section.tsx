import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { colorRampsClassic, extractStops } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"

const DEFAULTS = {
  slopeColorRamp: "slope-plantopo",
  slopeMinDegrees: undefined,
  slopeMaxDegrees: undefined,
  slopeInvertColorRamp: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside SlopeAndMoreOptionsSection,
// which owns the "Slope" checkbox that conditionally renders this block underneath it.
export const SlopeFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.slopeColorRamp] ?? colorRampsClassic["slope-plantopo"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.slopeColorRamp])

  return (
    <div className="space-y-4 pl-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Color Ramp</Label>
          <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={() => setState(DEFAULTS)}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <Select
          value={state.slopeColorRamp}
          onValueChange={(value) => setState({
            slopeColorRamp: value,
            slopeMinDegrees: undefined,
            slopeMaxDegrees: undefined,
          })}
        >
          <SelectTrigger className="w-full cursor-pointer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(colorRampsClassic).map(([key, ramp]: [string, any]) => (
              <SelectItem key={key} value={key}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-12 h-4 rounded-sm"
                    style={{ background: `linear-gradient(to right, ${getGradientColors(ramp.colors)})` }}
                  />
                  <span>{ramp.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
