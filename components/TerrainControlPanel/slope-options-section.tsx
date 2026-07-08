import type React from "react"
import { useMemo } from "react"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MobileSlider, Section, DraftBoundInput } from "./controls-components"
import { colorRampsClassic, extractStops } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"

// Simplified sibling of HypsometricTintOptionsSection — same "color-relief layer"
// underpinning (see computeColorReliefPaint usage in TerrainViewer.tsx), but slope
// doesn't need the cpt-city category tabs or license filter: just a handful of
// classic ramps (including "Slope (PlanTopo)", the app's own default), a min/max
// degrees range, and an invert toggle.
export const SlopeOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, isOpen, onOpenChange }) => {
  const rampBounds = useMemo(() => {
    const ramp = colorRampsClassic[state.slopeColorRamp] ?? colorRampsClassic["slope-plantopo"]
    const stops = extractStops(ramp.colors)
    return { min: Math.min(...stops), max: Math.max(...stops) }
  }, [state.slopeColorRamp])

  if (!state.showSlope) return null

  return (
    <Section title="Options: Slope" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">Source</Label>
          <ToggleGroup
            type="single"
            value={state.slopeSourceMode ?? "client"}
            onValueChange={(value) => value && setState({ slopeSourceMode: value })}
            className="border rounded-md"
          >
            <ToggleGroupItem
              value="client"
              className="px-3 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
            >
              Client (protocol)
            </ToggleGroupItem>
            <ToggleGroupItem
              value="plantopo"
              className="px-3 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
            >
              Server (PlanTopo)
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Color Ramp</Label>
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
                onCommit={(v) => setState({ slopeMinDegrees: v })}
                className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
              />
              <DraftBoundInput
                value={state.slopeMaxDegrees ?? rampBounds.max}
                onCommit={(v) => setState({ slopeMaxDegrees: v })}
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
    </Section>
  )
}
