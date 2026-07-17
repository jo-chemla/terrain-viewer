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
  blobnessColorRamp: "blobness-default",
  blobnessMin: undefined,
  blobnessMax: undefined,
  blobnessInvertColorRamp: false,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Blobness" checkbox that conditionally renders this block
// underneath it.
export const BlobnessFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.blobnessColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["blobness-default"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.blobnessColorRamp])

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
          value={state.blobnessColorRamp}
          onValueChange={(value) => setState({
            blobnessColorRamp: value,
            blobnessMin: undefined,
            blobnessMax: undefined,
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
          <Label className="text-sm font-medium">Blobness Range</Label>
          <div className="flex items-center gap-2">
            <DraftBoundInput
              value={state.blobnessMin ?? rampBounds.min}
              onCommit={(v) => setState({ blobnessMin: clampMinCommit(v, state.blobnessMax ?? rampBounds.max) })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
            <DraftBoundInput
              value={state.blobnessMax ?? rampBounds.max}
              onCommit={(v) => setState({ blobnessMax: clampMaxCommit(v, state.blobnessMin ?? rampBounds.min) })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="blobness:range"
          min={0}
          max={10}
          step={0.02}
          value={[state.blobnessMin ?? rampBounds.min, state.blobnessMax ?? rampBounds.max]}
          onValueChange={([min, max]) => setState({ blobnessMin: Math.min(min, max), blobnessMax: Math.max(min, max) })}
          className="w-full cursor-pointer"
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="blobness-invert-color-ramp"
          checked={state.blobnessInvertColorRamp || false}
          onCheckedChange={(checked) => setState({ blobnessInvertColorRamp: checked === true })}
          className="cursor-pointer"
        />
        <Label htmlFor="blobness-invert-color-ramp" className="text-sm font-medium cursor-pointer">
          Invert Color Ramp
        </Label>
      </div>
    </div>
  )
}
