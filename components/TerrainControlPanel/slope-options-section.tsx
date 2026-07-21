import type React from "react"
import { useMemo } from "react"
import { RotateCcw, Plus, Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { colorRampsClassic, extractStops, buildCustomRampColors, DEFAULT_SLOPE_CUSTOM_STOPS, type CustomRampStop } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"

const DEFAULTS = {
  slopeColorRamp: "slope-plantopo",
  slopeMinDegrees: undefined,
  slopeMaxDegrees: undefined,
  slopeInvertColorRamp: false,
  slopeCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
}

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Slope" checkbox that conditionally renders this block underneath it.
export const SlopeFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isCustom = state.slopeColorRamp === "custom"

  const rampBounds = useMemo(() => {
    // "custom" has no colorRampsClassic entry — its bounds come from the
    // user's own stops instead of a registry ramp's fixed stops.
    if (isCustom) {
      const stops = extractStops(buildCustomRampColors(state.slopeCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS))
      return { min: Math.min(...stops), max: Math.max(...stops) }
    }
    const ramp = colorRampsClassic[state.slopeColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["slope-plantopo"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [isCustom, state.slopeColorRamp, state.slopeCustomStops])

  const customStops: CustomRampStop[] = state.slopeCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

  const updateStop = (index: number, patch: Partial<CustomRampStop>) => {
    const next = customStops.map((s, i) => (i === index ? { ...s, ...patch } : s))
    setState({ slopeCustomStops: next })
  }
  const removeStop = (index: number) => {
    if (customStops.length <= 2) return
    setState({ slopeCustomStops: customStops.filter((_, i) => i !== index) })
  }
  const addStop = () => {
    const maxValue = Math.max(...customStops.map((s) => s.value))
    setState({ slopeCustomStops: [...customStops, { value: maxValue + 5, color: "#888888" }] })
  }

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
            <SelectItem value="custom">
              <div className="flex items-center gap-2">
                <div
                  className="w-12 h-4 rounded-sm"
                  style={{ background: `linear-gradient(to right, ${getGradientColors(buildCustomRampColors(customStops))})` }}
                />
                <span>Custom</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isCustom ? (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Custom Stops</Label>
          <div className="space-y-1.5">
            {customStops.map((stop, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="color"
                  value={stop.color}
                  onChange={(e) => updateStop(i, { color: e.target.value })}
                  className="h-8 w-8 p-1 cursor-pointer border-none shrink-0"
                />
                <DraftBoundInput
                  value={stop.value}
                  onCommit={(v) => v !== undefined && updateStop(i, { value: v })}
                  className="h-8 py-1 px-2 flex-1 text-xs bg-transparent border rounded"
                />
                <span className="text-xs text-muted-foreground shrink-0">°</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 cursor-pointer"
                  disabled={customStops.length <= 2}
                  onClick={() => removeStop(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="w-full cursor-pointer" onClick={addStop}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Stop
          </Button>
        </div>
      ) : (
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
      )}

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
