import type React from "react"
import { RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileSlider, DraftBoundInput } from "./controls-components"
import { colorRampsClassic } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"

const DEFAULTS = {
  aspectColorRamp: "aspect-compass",
  aspectMinDegrees: undefined,
  aspectMaxDegrees: undefined,
  aspectShiftDegrees: undefined,
  aspectInvertColorRamp: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Aspect" checkbox that conditionally renders this block underneath it.
export const AspectFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const shiftDegrees = state.aspectShiftDegrees ?? 0

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
          value={state.aspectColorRamp}
          onValueChange={(value) => setState({
            aspectColorRamp: value,
            aspectMinDegrees: undefined,
            aspectMaxDegrees: undefined,
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
