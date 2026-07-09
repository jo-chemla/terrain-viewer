import type React from "react"
import { Section, CheckboxWithSlider } from "./controls-components"
import { SlopeFields } from "./slope-options-section"
import { AspectFields } from "./aspect-options-section"
import { TriFields } from "./tri-options-section"
import { CurvatureFields } from "./curvature-options-section"

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
            checked={state.showTri}
            onCheckedChange={(checked) => setState({ showTri: checked })}
            sliderValue={state.triOpacity}
            onSliderChange={(value) => setState({ triOpacity: value })}
          />
          {state.showTri && <TriFields state={state} setState={setState} />}
        </div>
      </div>
    </Section>
  )
}
