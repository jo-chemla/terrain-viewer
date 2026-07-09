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
  triColorRamp: "tri-default",
  triMin: undefined,
  triMax: undefined,
  triInvertColorRamp: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside SlopeAndMoreOptionsSection,
// which owns the "Terrain Ruggedness" checkbox that conditionally renders this block
// underneath it.
export const TriFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.triColorRamp] ?? colorRampsClassic["tri-default"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.triColorRamp])

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
          value={state.triColorRamp}
          onValueChange={(value) => setState({
            triColorRamp: value,
            triMin: undefined,
            triMax: undefined,
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
          <Label className="text-sm font-medium">TRI Range (m)</Label>
          <div className="flex items-center gap-2">
            <DraftBoundInput
              value={state.triMin ?? rampBounds.min}
              onCommit={(v) => setState({ triMin: v })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
            <DraftBoundInput
              value={state.triMax ?? rampBounds.max}
              onCommit={(v) => setState({ triMax: v })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="tri:range"
          min={0}
          max={200}
          step={1}
          value={[state.triMin ?? rampBounds.min, state.triMax ?? rampBounds.max]}
          onValueChange={([min, max]) => setState({ triMin: Math.min(min, max), triMax: Math.max(min, max) })}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="tri-invert-color-ramp"
          checked={state.triInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ triInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="tri-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
