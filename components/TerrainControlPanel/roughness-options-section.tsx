import type React from "react"
import { useMemo } from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileSlider, DraftBoundInput } from "./controls-components"
import { colorRampsClassic, extractStops } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"

const DEFAULTS = {
  roughnessColorRamp: "roughness-default",
  roughnessMin: undefined,
  roughnessMax: undefined,
  roughnessInvertColorRamp: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside SlopeAndMoreOptionsSection,
// which owns the "Roughness" checkbox that conditionally renders this block
// underneath it.
export const RoughnessFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.roughnessColorRamp] ?? colorRampsClassic["roughness-default"]
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
        <Select
          value={state.roughnessColorRamp}
          onValueChange={(value) => setState({
            roughnessColorRamp: value,
            roughnessMin: undefined,
            roughnessMax: undefined,
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
          <Label className="text-sm font-medium">Roughness Range (m)</Label>
          <div className="flex items-center gap-2">
            <DraftBoundInput
              value={state.roughnessMin ?? rampBounds.min}
              onCommit={(v) => setState({ roughnessMin: v })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
            <DraftBoundInput
              value={state.roughnessMax ?? rampBounds.max}
              onCommit={(v) => setState({ roughnessMax: v })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="roughness:range"
          min={0}
          max={200}
          step={1}
          value={[state.roughnessMin ?? rampBounds.min, state.roughnessMax ?? rampBounds.max]}
          onValueChange={([min, max]) => setState({ roughnessMin: Math.min(min, max), roughnessMax: Math.max(min, max) })}
          className="w-full cursor-pointer"
        />
      </div>

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
