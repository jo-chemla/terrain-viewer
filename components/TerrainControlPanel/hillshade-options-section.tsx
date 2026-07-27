import type React from "react"
import { useMemo, useCallback, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Section, CycleButtonGroup, SliderControl } from "./controls-components"
import { LightDirectionControl } from "./light-direction-control"
import { isHillshadeXYPadOpenAtom, activeProjectConfigAtom } from "@/lib/settings-atoms"
import { useAtom } from "jotai"
import { ColorAlphaSwatch } from "./color-picker"

// Native MapLibre `type: "hillshade"` rendering (paint built by
// computeHillshadePaint in MapLayers.tsx) — an entirely independent viz mode
// from "Lighting Effects" (Matcap/Phong, see lighting-effects-options-section.tsx),
// which are hand-written WebGL layers, not this paint property. Hillshade
// method choices mirror gdaldem's own hillshade flags almost exactly (see the
// comment above HILLSHADE_ALG_FLAG in source-info-dialog.tsx) — "Aspect
// (Multidir Colors)" is a hand-tuned 4-direction RGBY illumination preset
// (computeHillshadePaint's "multidir-colors" branch), not a separate
// algorithm, useful for spotting subtle relief regardless of its orientation
// without hunting for one "correct" light angle.
export const HillshadeOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({
  state,
  setState,
  isOpen,
  onOpenChange,
}) => {
  const [isColorsOpen, setIsColorsOpen] = useState(false)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [isHillshadeXYPadOpen, setIsHillshadeXYPadOpen] = useAtom(isHillshadeXYPadOpenAtom)
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const hideAdvancedControls = activeProjectConfig?.hiddenSections?.includes("hillshadeAdvanced") ?? false

  const supportsIlluminationDirection = useMemo(() => ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])
  const supportsIlluminationAltitude = useMemo(() => ["combined", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])
  const supportsShadowColor = useMemo(() => ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])
  const supportsHighlightColor = useMemo(() => ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])
  const supportsAccentColor = useMemo(() => state.hillshadeMethod === "standard", [state.hillshadeMethod])
  const supportsExaggeration = useMemo(() => ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])

  // Set constraints based on what the current method supports
  // If direction is not supported, fix it to 315° (northwest)
  // If altitude is not supported, fix it to 45° (mid-elevation)
  const fixedIlluminationDirection = !supportsIlluminationDirection ? 315 : null
  const fixedIlluminationAltitude = !supportsIlluminationAltitude ? 45 : null

  const hillshadeMethodOptions = [
    { value: "combined", label: "Combined [2d]" }, { value: "standard", label: "Standard [1d]" },
    { value: "multidir-colors", label: "Aspect (Multidir Colors)" }, { value: "igor", label: "Igor [1d]" },
    { value: "basic", label: "Basic [2d]" },
    // { value: "aspect-multidir", label: "Aspect classic (Multidir Colors)" },
  ]
  const hillshadeMethodKeys = hillshadeMethodOptions.map(({ value }) => value)

  const cycleHillshadeMethod = useCallback((direction: number) => {
    const currentIndex = hillshadeMethodKeys.indexOf(state.hillshadeMethod)
    const newIndex = (currentIndex + direction + hillshadeMethodKeys.length) % hillshadeMethodKeys.length
    setState({ hillshadeMethod: hillshadeMethodKeys[newIndex] })
  }, [state.hillshadeMethod, hillshadeMethodKeys, setState])

  if (!state.showHillshade) return null

  return (
    <Section title="Hillshade" isOpen={isOpen} onOpenChange={onOpenChange} pulseKey="showHillshade">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Hillshade Method</Label>
        <CycleButtonGroup value={state.hillshadeMethod} options={hillshadeMethodOptions} onChange={(v) => setState({ hillshadeMethod: v })} onCycle={cycleHillshadeMethod} />
      </div>
      {/* XY Pad for illumination azimuth and/or elevation */}
      {(supportsIlluminationDirection || supportsIlluminationAltitude) && (
        <Collapsible open={isHillshadeXYPadOpen} onOpenChange={setIsHillshadeXYPadOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
             Illumination Azimuth and Elevation<ChevronDown className={`h-4 w-4 transition-transform ${isHillshadeXYPadOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 overflow-visible">
            <LightDirectionControl
              state={state}
              setState={setState}
              sliderId="illumination-xypad"
              debounceMs={0}
              elevationRange={[1, 90]}
              // Constrain based on what the current method supports
              fixedAzimuth={fixedIlluminationDirection}
              fixedElevation={fixedIlluminationAltitude}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Individual 1D sliders for illumination — folded by default, since the
          XY pad above already covers direction+altitude together at a glance;
          this is for precise numeric entry instead. Same folded-by-default
          pattern as "Hillshade Colors" below. */}
      {!hideAdvancedControls && (supportsIlluminationDirection || supportsIlluminationAltitude || supportsExaggeration) && (
        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
            Advanced<ChevronDown className={`h-4 w-4 transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pt-1">
            {supportsIlluminationDirection && <SliderControl label="Illumination Direction" value={state.illuminationDir} onChange={(v) => setState({ illuminationDir: v })} min={0} max={360} step={1} suffix="°" />}
            {supportsIlluminationAltitude && <SliderControl label="Illumination Altitude" value={state.illuminationAlt} onChange={(v) => setState({ illuminationAlt: v })} min={0} max={90} step={1} suffix="°" />}
            {supportsExaggeration && <SliderControl label="Hillshade Exaggeration" value={state.hillshadeExag} onChange={(v) => setState({ hillshadeExag: v })} min={0} max={1} step={0.01} decimals={2} />}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* hillshade colors */}
      {!hideAdvancedControls && (supportsShadowColor || supportsHighlightColor || supportsAccentColor) && (
        <Collapsible open={isColorsOpen} onOpenChange={setIsColorsOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
            Hillshade Colors<ChevronDown className={`h-4 w-4 transition-transform ${isColorsOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pt-1">
            <div className="flex gap-2" style={{ gridTemplateColumns: supportsAccentColor ? "repeat(3, 1fr)" : "repeat(2, 1fr)" }}>
              {supportsShadowColor && (
                <div className="flex flex-2 items-center gap-2">
                  <Label className="text-xs">Shadow Color</Label>
                  <ColorAlphaSwatch
                    title="Shadow color"
                    color={state.shadowColor}
                    onChange={(hex) => setState({ shadowColor: hex })}
                    className="rounded"
                  />
                </div>
              )}
              {supportsHighlightColor && (
                <div className="flex flex-2 items-center gap-2">
                  <Label className="text-xs">Highlight Color</Label>
                  <ColorAlphaSwatch
                    title="Highlight color"
                    color={state.highlightColor}
                    onChange={(hex) => setState({ highlightColor: hex })}
                    className="rounded"
                  />
                </div>
              )}
              {supportsAccentColor && (
                <div className="flex flex-2 items-center gap-2">
                  <Label className="text-xs">Accent</Label>
                  <ColorAlphaSwatch
                    title="Accent color"
                    color={state.accentColor}
                    onChange={(hex) => setState({ accentColor: hex })}
                    className="rounded"
                  />
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

    </Section>
  )
}
