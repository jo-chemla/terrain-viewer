import type React from "react"
import { useEffect, useRef } from "react"
import { useAtom } from "jotai"
import { activeProjectConfigAtom } from "@/lib/settings-atoms"
import { Section, CheckboxWithSlider } from "./controls-components"

export const VisualizationModesSection: React.FC<{
  state: any; setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, isOpen, onOpenChange }) => {
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const hideContours = activeProjectConfig?.hiddenSections?.includes("contour") ?? false
  const hideSlopeAndMore = activeProjectConfig?.hiddenSections?.includes("slopeAndMore") ?? false

  // The Tells toggle below maps the multi-valued tellsStyle onto a checkbox:
  // checked = any non-hidden style. Remember the last visible style (whether it
  // was picked here or via DetectorMoundsSection's cycle group) so re-checking
  // restores it instead of always resetting to the outline default.
  const lastVisibleTellsStyle = useRef("outline")
  useEffect(() => {
    if (state.tellsStyle !== "hidden") lastVisibleTellsStyle.current = state.tellsStyle
  }, [state.tellsStyle])

  return (
    <Section title="Visualization Modes" isOpen={isOpen} onOpenChange={onOpenChange}>
      {!hideContours && (
        <CheckboxWithSlider id="contours" checked={state.showContoursAndGraticules} onCheckedChange={(checked) => setState({ showContoursAndGraticules: checked })} label="Contours + GeoGrid" hideSlider={true} />
      )}
      <CheckboxWithSlider id="hillshade" checked={state.showHillshade} onCheckedChange={(checked) => setState({ showHillshade: checked })} label="Hillshade" sliderValue={state.hillshadeOpacity} onSliderChange={(value) => setState({ hillshadeOpacity: value })} />
      <CheckboxWithSlider id="color-relief" checked={state.showColorRelief} onCheckedChange={(checked) => setState({ showColorRelief: checked })} label="Elevation Hypso" sliderValue={state.colorReliefOpacity} onSliderChange={(value) => setState({ colorReliefOpacity: value })} />
      {!hideSlopeAndMore && (
        <CheckboxWithSlider
          id="slope-and-more"
          checked={state.showSlopeAndMore}
          onCheckedChange={(checked) => setState({ showSlopeAndMore: checked })}
          label="Slope, LRM and More"
          sliderValue={state.slopeAndMoreOpacity}
          onSliderChange={(value) => setState({ slopeAndMoreOpacity: value })}
        />
      )}
      <CheckboxWithSlider id="terrain-raster" checked={state.showRasterBasemap} onCheckedChange={(checked) => setState({ showRasterBasemap: checked })} label="Raster Basemap" sliderValue={state.rasterBasemapOpacity} onSliderChange={(value) => setState({ rasterBasemapOpacity: value })} />
      {/* Fog/sky only affects maplibre's 3D/globe rendering pipeline — meaningless
          (and was rendering a dead control) in flat 2D. */}
      {(state.viewMode === "3d" || state.viewMode === "globe") && (
        <CheckboxWithSlider id="background" checked={state.showBackground} onCheckedChange={(checked) => setState({ showBackground: checked })} label="Background + Fog/Sky" sliderValue={state.backgroundOpacity} onSliderChange={(value) => setState({ backgroundOpacity: value })} hideSlider />
      )}
      {state.tellsBeta && (
        <CheckboxWithSlider
          id="tells-visibility"
          checked={state.tellsStyle !== "hidden"}
          onCheckedChange={(checked) => setState({ tellsStyle: checked ? lastVisibleTellsStyle.current : "hidden" })}
          label="Tells (Mound Detector)"
          tooltip="Show/hide the experimental mound-candidate markers. Marker style and detector settings live in the Detector: Mound Candidates section."
          hideSlider
        />
      )}
    </Section>
  )
}
