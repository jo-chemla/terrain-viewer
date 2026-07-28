import type React from "react"
import { useAtom } from "jotai"
import { Separator } from "@/components/ui/separator"
import { Section, CheckboxWithSlider, AdvancedModeToggle, GroupHeading } from "./controls-components"
import { terrainAnalysisAdvancedAtom } from "@/lib/settings-atoms"
import { SlopeFields } from "./slope-options-section"
import { AspectFields } from "./aspect-options-section"
import { TriFields } from "./tri-options-section"
import { CurvatureFields } from "./curvature-options-section"
import { TpiFields } from "./tpi-options-section"
import { RoughnessFields } from "./roughness-options-section"
import { ShapeIndexFields } from "./shape-index-options-section"
import { BlobnessFields } from "./blobness-options-section"
import { EigenRatioFields } from "./eigen-ratio-options-section"
import { OrientationFields } from "./orientation-options-section"

// Half of what used to be one merged "Slope and More" panel — the first-/second-
// order gradient-based modes (Surface derivatives) plus the neighborhood-statistic
// modes (Roughness/TRI/TPI), as opposed to ReliefVisualizationOptionsSection's
// multi-scale residual modes (LRM/SVF/Openness). Same pattern as ContourOptionsSection's
// "Contours & GeoGrid": one master checkbox in VisualizationModesSection gates this
// whole section; each sub-mode here has its own checkbox, and checking one appends
// its options block directly beneath it. Slope is the only sub-mode on by default.
export const TerrainAnalysisOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
}> = ({ state, setState, isOpen, onOpenChange, withSeparator }) => {
  const [advanced, setAdvanced] = useAtom(terrainAnalysisAdvancedAtom)
  if (!state.showTerrainAnalysis) return null

  return (
    <Section
      title="Terrain Analysis"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      withSeparator={withSeparator}
      pulseKey="showTerrainAnalysis"
      headerExtra={<AdvancedModeToggle advanced={advanced} onToggle={() => setAdvanced(!advanced)} />}
    >
      <div className="space-y-4">
        <GroupHeading>Surface derivatives</GroupHeading>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-slope"
            label="Slope"
            tooltip="Magnitude of the gradient."
            checked={state.showSlope}
            onCheckedChange={(checked) => setState({ showSlope: checked })}
            sliderValue={state.slopeOpacity}
            onSliderChange={(value) => setState({ slopeOpacity: value })}
          />
          {state.showSlope && advanced && <SlopeFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-aspect"
            label="Aspect"
            tooltip="Direction of the gradient."
            checked={state.showAspect}
            onCheckedChange={(checked) => setState({ showAspect: checked })}
            sliderValue={state.aspectOpacity}
            onSliderChange={(value) => setState({ aspectOpacity: value })}
          />
          {state.showAspect && advanced && <AspectFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-curvature"
            label="Curvature"
            tooltip="Rate of slope change — Profile, Plan/Divergence, Mean/Combined, or Gaussian curvature (Det Hessian). Useful for ridge/valley mapping — try the Diverging or Monochrome color ramp below."
            checked={state.showCurvature}
            onCheckedChange={(checked) => setState({ showCurvature: checked })}
            sliderValue={state.curvatureOpacity}
            onSliderChange={(value) => setState({ curvatureOpacity: value })}
          />
          {state.showCurvature && advanced && <CurvatureFields state={state} setState={setState} />}
        </div>

        <Separator />
        <GroupHeading>Neighborhood statistics</GroupHeading>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-tpi"
            label="Topographic Position"
            tooltip="Elevation relative to neighborhood mean."
            checked={state.showTpi}
            onCheckedChange={(checked) => setState({ showTpi: checked })}
            sliderValue={state.tpiOpacity}
            onSliderChange={(value) => setState({ tpiOpacity: value })}
          />
          {state.showTpi && advanced && <TpiFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-tri"
            label="Terrain Ruggedness"
            tooltip="TRI (Terrain Ruggedness Index): mean elevation difference to neighbors."
            checked={state.showTri}
            onCheckedChange={(checked) => setState({ showTri: checked })}
            sliderValue={state.triOpacity}
            onSliderChange={(value) => setState({ triOpacity: value })}
          />
          {state.showTri && advanced && <TriFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-roughness"
            label="Roughness"
            tooltip="Max − min elevation in a neighborhood."
            checked={state.showRoughness}
            onCheckedChange={(checked) => setState({ showRoughness: checked })}
            sliderValue={state.roughnessOpacity}
            onSliderChange={(value) => setState({ roughnessOpacity: value })}
          />
          {state.showRoughness && advanced && <RoughnessFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-shape-index"
            label="Shape Index"
            tooltip="Koenderink & van Doorn's scale-free local shape descriptor, from the same principal curvatures as Casorati Curvature (see Surface derivatives): +1 dome/peak, +0.5 ridge, 0 saddle, −0.5 valley, −1 pit/bowl."
            checked={state.showShapeIndex}
            onCheckedChange={(checked) => setState({ showShapeIndex: checked })}
            sliderValue={state.shapeIndexOpacity}
            onSliderChange={(value) => setState({ shapeIndexOpacity: value })}
          />
          {state.showShapeIndex && advanced && <ShapeIndexFields state={state} setState={setState} />}
        </div>

        <Separator />
        <GroupHeading>Principal Components</GroupHeading>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-blobness"
            label="Blobness"
            tooltip="Structure-tensor (2D PCA of the local gradient field) measure — det/trace, conflating shape with steepness: high at peaks/pits/saddles, low on a uniform slope or straight ridge."
            checked={state.showBlobness}
            onCheckedChange={(checked) => setState({ showBlobness: checked })}
            sliderValue={state.blobnessOpacity}
            onSliderChange={(value) => setState({ blobnessOpacity: value })}
          />
          {state.showBlobness && advanced && <BlobnessFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-eigen-ratio"
            label="Eigenvalue Ratio"
            tooltip="λmin/λmax of the same structure tensor as Blobness — shape only, independent of steepness: 0 = coherent edge (slope, ridge, or valley), 100 = isotropic blob (peak/pit/saddle)."
            checked={state.showEigenRatio}
            onCheckedChange={(checked) => setState({ showEigenRatio: checked })}
            sliderValue={state.eigenRatioOpacity}
            onSliderChange={(value) => setState({ eigenRatioOpacity: value })}
          />
          {state.showEigenRatio && advanced && <EigenRatioFields state={state} setState={setState} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider
            id="terrain-analysis-orientation"
            label="Dominant Orientation"
            tooltip="Axis (0-180°) of the structure tensor's dominant eigenvector — which way a linear feature (ridge, valley, fault line) runs. Most meaningful where Eigenvalue Ratio is low; closer to noise where it's high."
            checked={state.showOrientation}
            onCheckedChange={(checked) => setState({ showOrientation: checked })}
            sliderValue={state.orientationOpacity}
            onSliderChange={(value) => setState({ orientationOpacity: value })}
          />
          {state.showOrientation && advanced && <OrientationFields state={state} setState={setState} />}
        </div>
      </div>
    </Section>
  )
}
