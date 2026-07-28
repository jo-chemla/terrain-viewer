import type React from "react"
import { useCallback, useMemo } from "react"
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileSlider, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { ColorRampSelectWithCustom, CustomRampStopsEditor } from "./custom-color-ramp"
import { colorRampsClassic, extractStops, DEFAULT_SLOPE_CUSTOM_STOPS } from "@/lib/color-ramps"
import type { BlobnessMode } from "@/lib/blobness-protocol"

const DEFAULTS = {
  blobnessMode: "blobness" as BlobnessMode,
  blobnessColorRamp: "blobness-default",
  blobnessMin: undefined,
  blobnessMax: undefined,
  blobnessInvertColorRamp: false,
  blobnessCustomStops: DEFAULT_SLOPE_CUSTOM_STOPS,
  blobnessCustomStopsDiscrete: false,
}

// All three modes are naturally 0-based (unlike Curvature's diverging modes), just
// with very different scales — a shape-only ratio/orientation shouldn't share
// "blobness"'s 0-10-ish slider track (it'd collapse to a sliver at one end).
const BLOBNESS_MODE_OPTIONS: { value: BlobnessMode; label: string; tooltip: string; defaultMin: number; defaultMax: number; sliderMax: number; sliderStep: number }[] = [
  {
    value: "blobness",
    label: "Blobness (det/trace)",
    tooltip: "Structure-tensor measure of how much the gradient direction varies across a small window — high at peaks/pits/saddles, low on a uniform slope or straight ridge. Conflates shape with steepness.",
    defaultMin: 0,
    defaultMax: 10,
    sliderMax: 10,
    sliderStep: 0.02,
  },
  {
    value: "eigen-ratio",
    label: "Eigenvalue Ratio",
    tooltip: "λmin/λmax of the same structure tensor, as a percentage — shape only, independent of steepness: 0 = coherent edge (slope, ridge, or valley), 100 = isotropic blob (peak/pit/saddle).",
    defaultMin: 0,
    defaultMax: 100,
    sliderMax: 100,
    sliderStep: 1,
  },
  {
    value: "orientation",
    label: "Dominant Orientation",
    tooltip: "Axis (0-180°) of the structure tensor's dominant eigenvector — which way a linear feature (ridge, valley, fault line) runs. Most meaningful where Eigenvalue Ratio is low; closer to noise where it's high.",
    defaultMin: 0,
    defaultMax: 180,
    sliderMax: 180,
    sliderStep: 1,
  },
]

// Fields-only (no Section wrapper/gate) — embedded inside TerrainAnalysisOptionsSection,
// which owns the "Blobness" checkbox that conditionally renders this block
// underneath it.
export const BlobnessFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isCustom = state.blobnessColorRamp === "custom"
  const isDiscrete = state.blobnessCustomStopsDiscrete ?? false
  const customStops = state.blobnessCustomStops ?? DEFAULT_SLOPE_CUSTOM_STOPS

  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.blobnessColorRamp as keyof typeof colorRampsClassic] ?? colorRampsClassic["blobness-default"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.blobnessColorRamp])

  const activeModeOption = BLOBNESS_MODE_OPTIONS.find((opt) => opt.value === (state.blobnessMode ?? "blobness")) ?? BLOBNESS_MODE_OPTIONS[0]

  // Switching mode also resets the range to that mode's calibrated default —
  // otherwise e.g. switching from Orientation (0-180) to Eigenvalue Ratio (0-100)
  // would keep whatever range Orientation was last set to.
  const applyMode = useCallback((value: string) => {
    const opt = BLOBNESS_MODE_OPTIONS.find((o) => o.value === value)
    setState({
      blobnessMode: value,
      blobnessMin: opt?.defaultMin,
      blobnessMax: opt?.defaultMax,
    })
  }, [setState])

  const cycleBlobnessMode = useCallback((direction: number) => {
    const currentIndex = BLOBNESS_MODE_OPTIONS.findIndex((opt) => opt.value === (state.blobnessMode ?? "blobness"))
    const newIndex = (currentIndex + direction + BLOBNESS_MODE_OPTIONS.length) % BLOBNESS_MODE_OPTIONS.length
    applyMode(BLOBNESS_MODE_OPTIONS[newIndex].value)
  }, [state.blobnessMode, applyMode])

  return (
    <div className="space-y-4 pl-6">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Mode</Label>
        <div className="flex gap-2">
          <Select
            value={state.blobnessMode ?? "blobness"}
            onValueChange={applyMode}
          >
            <SelectTrigger className="flex-1 min-w-0 w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BLOBNESS_MODE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex border rounded-md shrink-0">
            <Button variant="ghost" size="icon" onClick={() => cycleBlobnessMode(-1)} className="rounded-r-none border-r cursor-pointer">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => cycleBlobnessMode(1)} className="rounded-l-none cursor-pointer">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{activeModeOption.tooltip}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Color Ramp</Label>
          <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={() => setState(DEFAULTS)}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <ColorRampSelectWithCustom
          ramps={colorRampsClassic}
          value={state.blobnessColorRamp}
          onValueChange={(value) => setState({
            blobnessColorRamp: value,
            blobnessMin: undefined,
            blobnessMax: undefined,
          })}
          anchorKey="slope-plantopo"
          customStops={customStops}
          customStopsDiscrete={isDiscrete}
        />
      </div>

      {isCustom ? (
        <CustomRampStopsEditor
          customStops={customStops}
          onStopsChange={(stops) => setState({ blobnessCustomStops: stops })}
          isDiscrete={isDiscrete}
          onDiscreteChange={(discrete) => setState({ blobnessCustomStopsDiscrete: discrete })}
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{activeModeOption.label} Range</Label>
            <div className="flex items-center gap-2">
              <DraftBoundInput
                value={state.blobnessMin ?? rampBounds.min}
                onCommit={(v) => setState({ blobnessMin: clampMinCommit(v, state.blobnessMax ?? rampBounds.max) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                step={activeModeOption.sliderStep}
              />
              <DraftBoundInput
                value={state.blobnessMax ?? rampBounds.max}
                onCommit={(v) => setState({ blobnessMax: clampMaxCommit(v, state.blobnessMin ?? rampBounds.min) })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
                step={activeModeOption.sliderStep}
              />
            </div>
          </div>
          <MobileSlider
            sliderId="blobness:range"
            min={0}
            max={activeModeOption.sliderMax}
            step={activeModeOption.sliderStep}
            value={[state.blobnessMin ?? rampBounds.min, state.blobnessMax ?? rampBounds.max]}
            onValueChange={([min, max]) => setState({ blobnessMin: Math.min(min, max), blobnessMax: Math.max(min, max) })}
            className="w-full cursor-pointer"
          />
        </div>
      )}

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
