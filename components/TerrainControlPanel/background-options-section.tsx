import type React from "react"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Section, SliderControl } from "./controls-components"
import { ColorAlphaSwatch } from "./color-picker"

export const BackgroundOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void; theme?: 'light' | 'dark';
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, theme = 'light', isOpen, onOpenChange }) => {
  if (!state.showBackground) return null

  // Only flips the flag — never overwrites skyColor/horizonColor/fogColor, so the
  // user's custom colors survive a toggle-on-then-off round trip. TerrainViewer.tsx's
  // getSkyConfig() resolves the actual applied color (theme vs. custom) at render time.
  const handleMatchThemeToggle = (checked: boolean | string) => {
    setState({ matchThemeColors: checked === true })
  }

  return (
    <Section title="Background" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={false} pulseKey="showBackground">
      <div className="flex items-center justify-between py-0.5">
        <Checkbox
          id="match-theme"
          checked={state.matchThemeColors}
          onCheckedChange={handleMatchThemeToggle}
          className="cursor-pointer"
        />
        <Label htmlFor="match-theme" className="text-sm font-medium cursor-pointer flex-1 ml-2">
          Match Theme Colors
        </Label>
      </div>

      <div className="space-y-2 pt-1">
        {state.matchThemeColors ? (
          <SliderControl label="Fog Blend" value={state.fogGroundBlend * 100} onChange={(v) =>
            setState({ fogGroundBlend: v / 100 })}
            min={0} max={100} step={1} suffix="%" />
        ) : (
          <>
            <div className="flex gap-3">
              <ColorAlphaSwatch
                title="Sky color"
                color={state.skyColor}
                onChange={(hex) => setState({ skyColor: hex })}
                className="rounded shrink-0"
              />
              <div className="grow">
                <SliderControl
                  label="Sky Color Blend"
                  value={state.skyHorizonBlend * 100}
                  onChange={(v) => setState({ skyHorizonBlend: v / 100 })}
                  min={0} max={100} step={1} suffix="%"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <ColorAlphaSwatch
                title="Horizon color"
                color={state.horizonColor}
                onChange={(hex) => setState({ horizonColor: hex })}
                className="rounded shrink-0"
              />
              <div className="grow">
                <SliderControl
                  label="Horizon Color Blend"
                  value={state.horizonFogBlend * 100}
                  onChange={(v) => setState({ horizonFogBlend: v / 100 })}
                  min={0} max={100} step={1} suffix="%"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <ColorAlphaSwatch
                title="Fog color"
                color={state.fogColor}
                onChange={(hex) => setState({ fogColor: hex })}
                className="rounded shrink-0"
              />
              <div className="grow">
                <SliderControl
                  label="Fog Color Blend"
                  value={state.fogGroundBlend * 100}
                  onChange={(v) => setState({ fogGroundBlend: v / 100 })}
                  min={0} max={100} step={1} suffix="%"
                />
              </div>
            </div>

          </>
        )}
      </div>

      <div className="flex items-center justify-between py-0.5">
        <Checkbox
          id="bg-layer-active"
          checked={state.backgroundLayerActive}
          onCheckedChange={(checked) =>
            setState({ backgroundLayerActive: checked === true })
          }
          className="cursor-pointer"
        />
        <div className="flex items-center flex-1 ml-2 gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Label htmlFor="bg-layer-active" className="text-sm font-medium cursor-pointer">
                  Map Background Layer
                </Label>
              }
            />
            <TooltipContent>
              <p>Toggle off if layers have display issues</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </Section >
  )
}
