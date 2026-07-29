import type React from "react"
import { useContext } from "react"
import { useAtom } from "jotai"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MobileSlider, DraftBoundInput, SectionIdContext } from "./controls-components"
import { ElevationReferenceToggle } from "./elevation-reference-toggle"
import { ColorAlphaSwatch } from "./color-picker"
import { activeSliderAtom } from "@/lib/settings-atoms"
import { cn } from "@/lib/utils"

const TOGGLE_ITEM_CLASS = "flex-1 cursor-pointer text-muted-foreground font-normal data-pressed:bg-white data-pressed:font-bold data-pressed:text-foreground"

// Paints everything above OR below a user-chosen elevation/height plane a
// solid custom color — e.g. a quick flood-level preview (Absolute) or
// isolating ridges/depressions relative to their local neighborhood (LRM).
// Lives under Elevation Picker (both are "pick a reference value on this
// terrain" tools) rather than under Terrain Analysis/Relief Visualization,
// since it's a single flat threshold rather than a continuous derived
// scalar field. See computePlaneSlicerPaint in MapLayers.tsx for the paint
// itself — a near-instantaneous "interpolate" ramp faking a hard cutoff,
// since color-relief-color only ever evaluates through maplibre's
// interpolate path (a "step" expression there silently renders transparent).
export const PlaneSlicerFields: React.FC<{
  state: any; setState: (updates: any) => void
}> = ({ state, setState }) => {
  const isLrm = state.planeSlicerReferenceMode === "lrm"

  // Absolute is metres of real elevation; LRM is height above/below the local
  // mean. Both allow going slightly below zero (−100) so a threshold can sit
  // just under sea level / the local trend. Keep in sync with the SliderControl.
  const boundsFor = (mode: string) =>
    mode === "lrm" ? { min: -100, max: 100 } : { min: -100, max: 8000 }

  // Absolute and LRM each keep their own threshold value (planeSlicerValue vs.
  // planeSlicerValueLrm) — switching reference just reads/writes the field for
  // the active mode, so each frame restores its own last value rather than one
  // number being dragged (or clamped) across two very different ranges.
  const valueField = isLrm ? "planeSlicerValueLrm" : "planeSlicerValue"
  const value = state[valueField] ?? 0
  const bounds = boundsFor(state.planeSlicerReferenceMode)

  // Same "dim everything except the control being dragged" behavior
  // CheckboxWithSlider gives every other master row — replicated by hand here
  // since this row is a bespoke Switch (matching "Pick elevation on click"
  // right above it in ElevationPickerSection) rather than CheckboxWithSlider's
  // checkbox-on-the-left layout.
  const [activeSlider] = useAtom(activeSliderAtom)
  const sectionId = useContext(SectionIdContext)
  const fullId = `${sectionId}:plane-slicer`
  const isDimmed = activeSlider !== null && activeSlider !== fullId

  return (
    <div className="space-y-2">
      <Separator />
      <div className={cn("grid grid-cols-[1fr_1fr_auto] gap-2 items-center transition-opacity duration-150", isDimmed && "opacity-20")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Label htmlFor="plane-slicer" className="text-sm cursor-pointer">Plane Slicer</Label>
          </TooltipTrigger>
          <TooltipContent><p>Colors everything above or below a chosen elevation/height plane — a quick flood-level preview or ridge/valley cutoff.</p></TooltipContent>
        </Tooltip>
        <MobileSlider
          sliderId={fullId}
          value={[state.planeSlicerOpacity]}
          onValueChange={([v]) => setState({ planeSlicerOpacity: v })}
          min={0} max={1} step={0.1}
          className="cursor-pointer"
          disabled={!state.showPlaneSlicer}
        />
        <Switch
          id="plane-slicer"
          checked={state.showPlaneSlicer}
          onCheckedChange={(checked) => setState({ showPlaneSlicer: checked })}
          className="cursor-pointer"
        />
      </div>
      {state.showPlaneSlicer && (
        <div className="space-y-3 pl-6">
          <ElevationReferenceToggle
            value={state.planeSlicerReferenceMode}
            onChange={(v) => setState({ planeSlicerReferenceMode: v })}
          />

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{isLrm ? "Height" : "Altitude"}</Label>
              <div className="flex items-center gap-1">
                <DraftBoundInput
                  value={value}
                  onCommit={(v) => v !== undefined && setState({ [valueField]: Math.min(bounds.max, Math.max(bounds.min, Math.round(v))) })}
                  className="h-6 py-1 px-1 w-16 text-xs text-right bg-transparent border rounded"
                />
                <span className="text-xs text-muted-foreground">m</span>
              </div>
            </div>
            <MobileSlider
              sliderId="plane-slicer:value"
              value={[value]}
              onValueChange={([v]) => setState({ [valueField]: v })}
              min={bounds.min}
              max={bounds.max}
              step={1}
              className="w-full cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Paint Side</Label>
            <ToggleGroup
              value={[state.planeSlicerSide]}
              onValueChange={([value]) => value && setState({ planeSlicerSide: value })}
              className="border rounded-md w-[180px]"
            >
              <ToggleGroupItem value="below" className={TOGGLE_ITEM_CLASS} title="Paint the region below the plane.">
                Below
              </ToggleGroupItem>
              <ToggleGroupItem value="above" className={TOGGLE_ITEM_CLASS} title="Paint the region above the plane.">
                Above
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Color</Label>
            <ColorAlphaSwatch
              title="Plane Slicer color"
              color={state.planeSlicerColor}
              onChange={(hex) => setState({ planeSlicerColor: hex })}
              className="rounded"
            />
          </div>
        </div>
      )}
    </div>
  )
}
