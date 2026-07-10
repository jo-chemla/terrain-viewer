import type React from "react"
import { Section, CheckboxWithSlider } from "./controls-components"
import { SlopeFields } from "./slope-options-section"
import { AspectFields } from "./aspect-options-section"
import { TriFields } from "./tri-options-section"
import { CurvatureFields } from "./curvature-options-section"
import { TpiFields } from "./tpi-options-section"
import { RoughnessFields } from "./roughness-options-section"

// Merged panel for every normal-derived terrain visualization — same pattern as
// ContourOptionsSection's "Contours & GeoGrid" (one master viz-mode checkbox in
// VisualizationModesSection gates this whole section; each sub-mode here has its
// own checkbox, and checking one appends its options block directly beneath it).
// Slope is the only sub-mode on by default (showSlope defaults true; the other
// three default false) so turning "Slope and More" on for the first time behaves
// exactly like the old standalone Slope toggle used to.
export const SlopeAndMoreOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, isOpen, onOpenChange }) => {
  if (!state.showSlopeAndMore) return null

  return (
    <Section title="Options: Slope and More" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-4">
        <div className="space-y-2">
          <CheckboxWithSlider
            id="slope-and-more-slope"
            label="Slope"
            tooltip="Magnitude of the gradient."
            checked={state.showSlope}
            onCheckedChange={(checked) => setState({ showSlope: checked })}
            sliderValue={state.slopeOpacity}
            onSliderChange={(value) => setState({ slopeOpacity: value })}
          />
          {state.showSlope && <SlopeFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="slope-and-more-curvature"
            label="Curvature"
            tooltip="Rate of slope change (Profile, Plan or Combined)."
            checked={state.showCurvature}
            onCheckedChange={(checked) => setState({ showCurvature: checked })}
            sliderValue={state.curvatureOpacity}
            onSliderChange={(value) => setState({ curvatureOpacity: value })}
          />
          {state.showCurvature && <CurvatureFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="slope-and-more-aspect"
            label="Aspect"
            tooltip="Direction of the gradient."
            checked={state.showAspect}
            onCheckedChange={(checked) => setState({ showAspect: checked })}
            sliderValue={state.aspectOpacity}
            onSliderChange={(value) => setState({ aspectOpacity: value })}
          />
          {state.showAspect && <AspectFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="slope-and-more-tri"
            label="Terrain Ruggedness"
            tooltip="TRI (Terrain Ruggedness Index): mean elevation difference to neighbors."
            checked={state.showTri}
            onCheckedChange={(checked) => setState({ showTri: checked })}
            sliderValue={state.triOpacity}
            onSliderChange={(value) => setState({ triOpacity: value })}
          />
          {state.showTri && <TriFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="slope-and-more-tpi"
            label="Topographic Position"
            tooltip="Elevation relative to neighborhood mean."
            checked={state.showTpi}
            onCheckedChange={(checked) => setState({ showTpi: checked })}
            sliderValue={state.tpiOpacity}
            onSliderChange={(value) => setState({ tpiOpacity: value })}
          />
          {state.showTpi && <TpiFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="slope-and-more-roughness"
            label="Roughness"
            tooltip="Max − min elevation in a neighborhood."
            checked={state.showRoughness}
            onCheckedChange={(checked) => setState({ showRoughness: checked })}
            sliderValue={state.roughnessOpacity}
            onSliderChange={(value) => setState({ roughnessOpacity: value })}
          />
          {state.showRoughness && <RoughnessFields state={state} setState={setState} />}
        </div>
      </div>
    </Section>
  )
}
