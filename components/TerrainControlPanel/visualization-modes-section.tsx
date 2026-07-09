import type React from "react"
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

  return (
    <Section title="Visualization Modes" isOpen={isOpen} onOpenChange={onOpenChange}>
      {!hideContours && (
        <CheckboxWithSlider id="contours" checked={state.showContoursAndGraticules} onCheckedChange={(checked) => setState({ showContoursAndGraticules: checked })} label="Contours + GeoGrid" hideSlider={true} />
      )}
      <CheckboxWithSlider id="hillshade" checked={state.showHillshade} onCheckedChange={(checked) => setState({ showHillshade: checked })} label="Hillshade" sliderValue={state.hillshadeOpacity} onSliderChange={(value) => setState({ hillshadeOpacity: value })} />
      <CheckboxWithSlider id="color-relief" checked={state.showColorRelief} onCheckedChange={(checked) => setState({ showColorRelief: checked })} label="Elevation Hypso" sliderValue={state.colorReliefOpacity} onSliderChange={(value) => setState({ colorReliefOpacity: value })} />
      <CheckboxWithSlider
        id="slope-and-more"
        checked={state.showSlopeAndMore}
        onCheckedChange={(checked) => setState({ showSlopeAndMore: checked })}
        label="Slope and More"
        sliderValue={state.slopeAndMoreOpacity}
        onSliderChange={(value) => setState({ slopeAndMoreOpacity: value })}
      />
      <CheckboxWithSlider id="terrain-raster" checked={state.showRasterBasemap} onCheckedChange={(checked) => setState({ showRasterBasemap: checked })} label="Raster Basemap" sliderValue={state.rasterBasemapOpacity} onSliderChange={(value) => setState({ rasterBasemapOpacity: value })} />
      {/* Fog/sky only affects maplibre's 3D/globe rendering pipeline — meaningless
          (and was rendering a dead control) in flat 2D. */}
      {(state.viewMode === "3d" || state.viewMode === "globe") && (
        <CheckboxWithSlider id="background" checked={state.showBackground} onCheckedChange={(checked) => setState({ showBackground: checked })} label="Background + Fog/Sky" sliderValue={state.backgroundOpacity} onSliderChange={(value) => setState({ backgroundOpacity: value })} hideSlider />
      )}
    </Section>
  )
}
