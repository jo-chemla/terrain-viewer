import type React from "react"
import { useAtom } from "jotai"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { skyConfigAtom } from "@/lib/settings-atoms"
import { Section, SliderControl } from "./controls-components"

export const BackgroundOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void; theme?: 'light' | 'dark';
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, theme = 'light', isOpen, onOpenChange }) => {
  const [skyConfig, setSkyConfig] = useAtom(skyConfigAtom)

  if (!state.showBackground) return null

  // Only flips the flag — never overwrites skyColor/horizonColor/fogColor, so the
  // user's custom colors survive a toggle-on-then-off round trip. TerrainViewer.tsx's
  // getSkyConfig() resolves the actual applied color (theme vs. custom) at render time.
  const handleMatchThemeToggle = (checked: boolean | string) => {
    setSkyConfig({ ...skyConfig, matchThemeColors: checked === true })
  }

  return (
    <Section title="Background" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={false} pulseKey="showBackground">
      <div className="flex items-center justify-between py-0.5">
        <Checkbox
          id="match-theme"
          checked={skyConfig.matchThemeColors}
          onCheckedChange={handleMatchThemeToggle}
          className="cursor-pointer"
        />
        <Label htmlFor="match-theme" className="text-sm font-medium cursor-pointer flex-1 ml-2">
          Match Theme Colors
        </Label>
      </div>

      <div className="space-y-2 pt-1">
        {skyConfig.matchThemeColors ? (
          <SliderControl label="Fog Blend" value={skyConfig.fogGroundBlend * 100} onChange={(v) =>
            setSkyConfig({ ...skyConfig, fogGroundBlend: v / 100 })}
            min={0} max={100} step={1} suffix="%" />
        ) : (
          <>
            <div className="flex gap-3">
              <Input
                type="color"
                value={skyConfig.skyColor}
                onChange={(e) => setSkyConfig({ ...skyConfig, skyColor: e.target.value })}
                className="h-8 w-12 p-1 cursor-pointer border-none flex-shrink-0"
              />
              <div className="grow">
                <SliderControl
                  label="Sky Color Blend"
                  value={skyConfig.skyHorizonBlend * 100}
                  onChange={(v) => setSkyConfig({ ...skyConfig, skyHorizonBlend: v / 100 })}
                  min={0} max={100} step={1} suffix="%"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Input
                type="color"
                value={skyConfig.horizonColor}
                onChange={(e) => setSkyConfig({ ...skyConfig, horizonColor: e.target.value })}
                className="h-8 w-12 p-1 cursor-pointer border-none flex-shrink-0"
              />
              <div className="grow">
                <SliderControl
                  label="Horizon Color Blend"
                  value={skyConfig.horizonFogBlend * 100}
                  onChange={(v) => setSkyConfig({ ...skyConfig, horizonFogBlend: v / 100 })}
                  min={0} max={100} step={1} suffix="%"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Input
                type="color"
                value={skyConfig.fogColor}
                onChange={(e) => setSkyConfig({ ...skyConfig, fogColor: e.target.value })}
                className="h-8 w-12 p-1 cursor-pointer border-none flex-shrink-0"
              />
              <div className="grow">
                <SliderControl
                  label="Fog Color Blend"
                  value={skyConfig.fogGroundBlend * 100}
                  onChange={(v) => setSkyConfig({ ...skyConfig, fogGroundBlend: v / 100 })}
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
          checked={skyConfig.backgroundLayerActive}
          onCheckedChange={(checked) =>
            setSkyConfig({ ...skyConfig, backgroundLayerActive: checked === true })
          }
          className="cursor-pointer"
        />
        <div className="flex items-center flex-1 ml-2 gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Label htmlFor="bg-layer-active" className="text-sm font-medium cursor-pointer">
                Map Background Layer
              </Label>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle off if layers have display issues</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </Section >
  )
}
