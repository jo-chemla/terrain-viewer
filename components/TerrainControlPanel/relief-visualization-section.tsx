import type React from "react"
import { perViewProps, modeOnVisibleView } from "@/lib/viz-views"
import { useAtom } from "jotai"
import { Section, CheckboxWithSlider, AdvancedModeToggle } from "./controls-components"
import { reliefVisualizationAdvancedAtom } from "@/lib/settings-atoms"
import { LrmFields } from "./lrm-options-section"
import { SvfFields } from "./svf-options-section"
import { OpennessFields } from "./openness-options-section"
import { LocalDominanceFields } from "./local-dominance-options-section"

// The other half of what used to be one merged "Slope and More" panel — the
// multi-scale relief/visibility modes (LRM, Sky View Factor, Openness), as
// opposed to TerrainAnalysisOptionsSection's per-pixel surface-derivative and
// neighborhood-statistic modes. Same master-checkbox-gates-this-whole-section
// pattern as every other options panel here.
export const ReliefVisualizationOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  // Actual tile grid size of the active terrain source (256/512, from its
  // maplibre source config) — used by LrmFields/SvfFields/OpennessFields to
  // display an accurate meters-equivalent for their radius controls, instead
  // of assuming 256.
  terrainTileSize: number
}> = ({ state, setState, isOpen, onOpenChange, terrainTileSize }) => {
  const perViewFor = perViewProps(state, setState)
  const [advanced, setAdvanced] = useAtom(reliefVisualizationAdvancedAtom)
  if (!state.showReliefVisualization) return null

  return (
    <Section
      id="tour-relief-visualization-section"
      title="Relief Visualization"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      pulseKey="showReliefVisualization"
      headerExtra={<AdvancedModeToggle advanced={advanced} onToggle={() => setAdvanced(!advanced)} />}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <CheckboxWithSlider perView={perViewFor("showLrm")}
            id="relief-visualization-lrm"
            label="Local Relief Model"
            tooltip="Elevation relative to a smoothed regional trend (wider neighborhood than Topographic Position). Somewhat like HAG (Height Above Ground), but the 'ground' is that smoothed local trend, not a classified bare-earth surface."
            checked={state.showLrm}
            onCheckedChange={(checked) => setState({ showLrm: checked })}
            sliderValue={state.lrmOpacity}
            onSliderChange={(value) => setState({ lrmOpacity: value })}
          />
          {modeOnVisibleView(state, "showLrm") && advanced && <LrmFields state={state} setState={setState} tileSize={terrainTileSize} />}
        </div>

        {/* Visibility-analysis modes: Sky View Factor, Openness — both built on the
            same "horizon angle in several directions" ray march (see
            lib/horizon-angle.ts), a simplest-first pass (8 directions, integer-pixel
            steps) rather than the literature's full anisotropic accuracy. Each pixel
            costs ~8x the ray-march work of a fixed 3x3/5x5 mode. The hourglass
            "slow" marks were dropped on 2026-11-17 once lib/horizon-kernel.ts made
            a tile 5-10x cheaper (Raster Compute in a Worker moves it off the main
            thread too). */}
        <div className="space-y-2">
          <CheckboxWithSlider perView={perViewFor("showSvf")}
            id="relief-visualization-svf"
            label="Sky View Factor"
            tooltip="Fraction of the sky hemisphere visible from each point — low in enclosed pits/canyons, high on open summits/ridges."
            checked={state.showSvf}
            onCheckedChange={(checked) => setState({ showSvf: checked })}
            sliderValue={state.svfOpacity}
            onSliderChange={(value) => setState({ svfOpacity: value })}
          />
          {modeOnVisibleView(state, "showSvf") && advanced && <SvfFields state={state} setState={setState} tileSize={terrainTileSize} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider perView={perViewFor("showOpenness")}
            id="relief-visualization-openness"
            label="Openness"
            tooltip="Mean angular distance from zenith to the horizon across several directions — reads above flat (90°) on ridges/summits (Positive mode) or in valleys/pits (Negative mode)."
            checked={state.showOpenness}
            onCheckedChange={(checked) => setState({ showOpenness: checked })}
            sliderValue={state.opennessOpacity}
            onSliderChange={(value) => setState({ opennessOpacity: value })}
          />
          {modeOnVisibleView(state, "showOpenness") && advanced && <OpennessFields state={state} setState={setState} tileSize={terrainTileSize} />}
        </div>

        <div className="space-y-2">
          <CheckboxWithSlider perView={perViewFor("showLocalDominance")}
            id="relief-visualization-local-dominance"
            label="Local Dominance"
            tooltip="Mean downward view angle onto the surrounding terrain over a ring of distances (Hesse 2016) — high on mounds/ridges that look down on their surroundings, low in enclosed depressions. Complements Openness for isolating closed mounds and pits."
            checked={state.showLocalDominance}
            onCheckedChange={(checked) => setState({ showLocalDominance: checked })}
            sliderValue={state.localDominanceOpacity}
            onSliderChange={(value) => setState({ localDominanceOpacity: value })}
          />
          {modeOnVisibleView(state, "showLocalDominance") && advanced && <LocalDominanceFields state={state} setState={setState} tileSize={terrainTileSize} />}
        </div>
      </div>
    </Section>
  )
}
