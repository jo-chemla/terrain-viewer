import type React from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CheckboxWithSlider, SliderControl } from "./controls-components"

const TOGGLE_ITEM_CLASS = "flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"

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

  return (
    <div className="space-y-2">
      <Separator />
      <CheckboxWithSlider
        id="plane-slicer"
        label="Plane Slicer"
        tooltip="Colors everything above or below a chosen elevation/height plane — a quick flood-level preview or ridge/valley cutoff."
        checked={state.showPlaneSlicer}
        onCheckedChange={(checked) => setState({ showPlaneSlicer: checked })}
        sliderValue={state.planeSlicerOpacity}
        onSliderChange={(value) => setState({ planeSlicerOpacity: value })}
      />
      {state.showPlaneSlicer && (
        <div className="space-y-3 pl-6">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Reference</Label>
            <ToggleGroup
              type="single"
              value={state.planeSlicerReferenceMode}
              onValueChange={(value) => value && setState({ planeSlicerReferenceMode: value })}
              className="border rounded-md w-[180px]"
            >
              <ToggleGroupItem value="absolute" className={TOGGLE_ITEM_CLASS} title="Reference is real elevation in meters.">
                Absolute
              </ToggleGroupItem>
              <ToggleGroupItem value="lrm" className={TOGGLE_ITEM_CLASS} title="Reference is height above/below the local neighborhood mean (Local Relief Model).">
                LRM
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <SliderControl
            label={isLrm ? "Height" : "Altitude"}
            value={state.planeSlicerValue}
            onChange={(v) => setState({ planeSlicerValue: v })}
            min={isLrm ? -50 : 0}
            max={isLrm ? 50 : 8000}
            step={1}
            suffix=" m"
            sliderId="plane-slicer:value"
          />

          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Paint Side</Label>
            <ToggleGroup
              type="single"
              value={state.planeSlicerSide}
              onValueChange={(value) => value && setState({ planeSlicerSide: value })}
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
            <Input
              type="color"
              value={state.planeSlicerColor}
              onChange={(e) => setState({ planeSlicerColor: e.target.value })}
              className="h-8 w-16 p-1 cursor-pointer border-none"
            />
          </div>
        </div>
      )}
    </div>
  )
}
