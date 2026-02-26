import type React from "react"
import { useMemo, useCallback, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Section, CycleButtonGroup, SliderControl } from "./controls-components"
import {SphericalXYPad} from './XYPad'
import { isHillshadeXYPadOpenAtom } from "@/lib/settings-atoms"
import { useAtom } from "jotai"

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
  const [isHillshadeXYPadOpen, setIsHillshadeXYPadOpen] = useAtom(isHillshadeXYPadOpenAtom)

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

  if (!state.showHillshade) return null

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


  return (
    <Section title="Hillshade Options" isOpen={isOpen} onOpenChange={onOpenChange}>
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
          <CollapsibleContent className="flex justify-center pt-1 overflow-visible">
            <SphericalXYPad
              width={200}
              height={200}
              azimuthRange={[0, 360]}
              // azimuthRange={[-180, 180]}
              elevationRange={[1, 90]}
              sliderId="illumination-xypad"
              value={{ azimuthDeg: state.illuminationDir, elevationDeg: state.illuminationAlt }}
              onChange={({ azimuthDeg, elevationDeg }) => {
                setState({ illuminationDir: azimuthDeg, illuminationAlt: elevationDeg })
              }}
              // Constrain based on what the current method supports
              fixedAzimuth={fixedIlluminationDirection}
              fixedElevation={fixedIlluminationAltitude}
            />
          </CollapsibleContent>
        </Collapsible>
      )}
      
      {/*Individual 1D Sliders for illumination */}
      {supportsIlluminationDirection && <SliderControl label="Illumination Direction" value={state.illuminationDir} onChange={(v) => setState({ illuminationDir: v })} min={0} max={360} step={1} suffix="°" />}
      {supportsIlluminationAltitude && <SliderControl label="Illumination Altitude" value={state.illuminationAlt} onChange={(v) => setState({ illuminationAlt: v })} min={0} max={90} step={1} suffix="°" />}
      {supportsExaggeration && <SliderControl label="Hillshade Exaggeration" value={state.hillshadeExag} onChange={(v) => setState({ hillshadeExag: v })} min={0} max={1} step={0.01} decimals={2} />}

      {/* hillshade colors */}
      {(supportsShadowColor || supportsHighlightColor || supportsAccentColor) && (
        <Collapsible open={isColorsOpen} onOpenChange={setIsColorsOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
            Hillshade Colors<ChevronDown className={`h-4 w-4 transition-transform ${isColorsOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pt-1">
            <div className="grid gap-2" style={{ gridTemplateColumns: supportsAccentColor ? "repeat(3, 1fr)" : "repeat(2, 1fr)" }}>
              {supportsShadowColor && (<div className="space-y-1"><Label className="text-xs">Shadow</Label><Input type="color" value={state.shadowColor} onChange={(e) => setState({ shadowColor: e.target.value })} className="h-9 p-1 cursor-pointer border-none" /></div>)}
              {supportsHighlightColor && (<div className="space-y-1"><Label className="text-xs">Highlight</Label><Input type="color" value={state.highlightColor} onChange={(e) => setState({ highlightColor: e.target.value })} className="h-9 p-1 cursor-pointer border-none" /></div>)}
              {supportsAccentColor && (<div className="space-y-1"><Label className="text-xs">Accent</Label><Input type="color" value={state.accentColor} onChange={(e) => setState({ accentColor: e.target.value })} className="h-9 p-1 cursor-pointer border-none" /></div>)}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

    </Section>
  )
}