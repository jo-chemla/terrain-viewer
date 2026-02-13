import type React from "react"
import { useAtom } from "jotai"
import { isVizModesOpenAtom } from "@/lib/settings-atoms"
import { Section, CheckboxWithSlider } from "./controls-components"

export const VisualizationModesSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isVizModesOpenAtom)
  return (
    <Section title="Visualization Modes" isOpen={isOpen} onOpenChange={setIsOpen}>
      <CheckboxWithSlider id="hillshade" checked={state.showHillshade} onCheckedChange={(checked) => setState({ showHillshade: checked })} label="Hillshade" sliderValue={state.hillshadeOpacity} onSliderChange={(value) => setState({ hillshadeOpacity: value })} />
      <CheckboxWithSlider id="contours" checked={state.showContours} onCheckedChange={(checked) => setState({ showContours: checked })} label="Contour Lines" hideSlider={true} sliderValue={0} onSliderChange={() => null} />
      <CheckboxWithSlider id="color-relief" checked={state.showColorRelief} onCheckedChange={(checked) => setState({ showColorRelief: checked })} label="Elevation Hypso" sliderValue={state.colorReliefOpacity} onSliderChange={(value) => setState({ colorReliefOpacity: value })} />
      <CheckboxWithSlider id="terrain-raster" checked={state.showRasterBasemap} onCheckedChange={(checked) => setState({ showRasterBasemap: checked })} label="Raster Basemap" sliderValue={state.rasterBasemapOpacity} onSliderChange={(value) => setState({ rasterBasemapOpacity: value })} />
      <CheckboxWithSlider id="background" checked={state.showBackground} onCheckedChange={(checked) => setState({ showBackground: checked })} label="Background + Fog/Sky" sliderValue={state.backgroundOpacity} onSliderChange={(value) => setState({ backgroundOpacity: value })} />
    </Section>
  )
}
