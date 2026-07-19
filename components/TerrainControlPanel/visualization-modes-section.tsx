import type React from "react"
import { useState } from "react"
import { useAtom } from "jotai"
import { activeProjectConfigAtom, vizModePinnedAtom } from "@/lib/settings-atoms"
import { Section, CheckboxWithSlider, PinToggle } from "./controls-components"

export const VisualizationModesSection: React.FC<{
  state: any; setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, isOpen, onOpenChange }) => {
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const [vizModePinned, setVizModePinned] = useAtom(vizModePinnedAtom)
  // EXPERIMENTAL: while pinned, this section's own chevron can't collapse it
  // either (not just "Fold all sections") — clicking it is a no-op that shakes
  // the pin icon instead, forcing an explicit unpin first.
  const [wiggleNonce, setWiggleNonce] = useState(0)
  const handleOpenChange = (open: boolean) => {
    if (!open && vizModePinned) {
      setWiggleNonce((n) => n + 1)
      return
    }
    onOpenChange(open)
  }
  const hideContours = activeProjectConfig?.hiddenSections?.includes("contour") ?? false
  const hideTerrainAnalysis = activeProjectConfig?.hiddenSections?.includes("terrainAnalysis") ?? false
  const hideReliefVisualization = activeProjectConfig?.hiddenSections?.includes("reliefVisualization") ?? false

  return (
    <Section
      title="Visualization Modes"
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      headerExtra={<PinToggle pinned={vizModePinned} onToggle={() => setVizModePinned(!vizModePinned)} wiggleNonce={wiggleNonce} />}
    >
      {!hideContours && (
        <CheckboxWithSlider id="contours" checked={state.showContoursAndGraticules} onCheckedChange={(checked) => setState({ showContoursAndGraticules: checked })} label="Contours + GeoGrid" hideSlider={true} />
      )}
      <CheckboxWithSlider id="hillshade" checked={state.showHillshade} onCheckedChange={(checked) => setState({ showHillshade: checked })} label="Hillshade" sliderValue={state.hillshadeOpacity} onSliderChange={(value) => setState({ hillshadeOpacity: value })} />
      <CheckboxWithSlider id="terrain-raster" checked={state.showRasterBasemap} onCheckedChange={(checked) => setState({ showRasterBasemap: checked })} label="Raster Basemap" sliderValue={state.rasterBasemapOpacity} onSliderChange={(value) => setState({ rasterBasemapOpacity: value })} />
      <CheckboxWithSlider id="color-relief" checked={state.showColorRelief} onCheckedChange={(checked) => setState({ showColorRelief: checked })} label="Elevation Hypso" sliderValue={state.colorReliefOpacity} onSliderChange={(value) => setState({ colorReliefOpacity: value })} />
      {/* What used to be one merged "Slope, LRM and More" toggle is now two —
          Relief Visualization (multi-scale relief/visibility: LRM/SVF/Openness)
          and Terrain Analysis (surface derivatives + neighborhood statistics: Slope/
          Aspect/Curvature/Blobness/TPI/TRI/Roughness) — see
          relief-visualization-section.tsx / terrain-analysis-section.tsx. */}
      {!hideReliefVisualization && (
        <CheckboxWithSlider
          id="relief-visualization"
          checked={state.showReliefVisualization}
          onCheckedChange={(checked) => setState({ showReliefVisualization: checked })}
          label="Relief Visualization"
          sliderValue={state.reliefVisualizationOpacity}
          onSliderChange={(value) => setState({ reliefVisualizationOpacity: value })}
        />
      )}
      {!hideTerrainAnalysis && (
        <CheckboxWithSlider
          id="terrain-analysis"
          checked={state.showTerrainAnalysis}
          onCheckedChange={(checked) => setState({ showTerrainAnalysis: checked })}
          label="Terrain Analysis"
          sliderValue={state.terrainAnalysisOpacity}
          onSliderChange={(value) => setState({ terrainAnalysisOpacity: value })}
        />
      )}
      {state.tellsBeta && (
        <CheckboxWithSlider
          id="tells-visibility"
          checked={state.showTellsDetector}
          onCheckedChange={(checked) => setState({ showTellsDetector: checked === true })}
          label="Tells (Mound Detector)"
          tooltip="Turns the experimental mound detector on/off — its own Mound Candidates section (style, thresholds, a separate marker-visibility toggle) appears once this is on."
          hideSlider
        />
      )}
      {/* Fog/sky only affects maplibre's 3D/globe rendering pipeline — meaningless
          (and was rendering a dead control) in flat 2D — but lives last in this
          list whenever it does apply. */}
      {(state.viewMode === "3d" || state.viewMode === "globe") && (
        <CheckboxWithSlider id="background" checked={state.showBackground} onCheckedChange={(checked) => setState({ showBackground: checked })} label="Background + Fog/Sky" sliderValue={state.backgroundOpacity} onSliderChange={(value) => setState({ backgroundOpacity: value })} hideSlider />
      )}
    </Section>
  )
}
