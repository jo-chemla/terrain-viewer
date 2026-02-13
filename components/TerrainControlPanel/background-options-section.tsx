import type React from "react"
import { useAtom } from "jotai"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isBackgroundOpenAtom, skyConfigAtom } from "@/lib/settings-atoms"
import { Section, SliderControl } from "./controls-components"

export const BackgroundOptionsSection: React.FC<{ state: any; setState: (updates: any) => void; theme?: 'light' | 'dark' }> = ({ state, setState, theme = 'light' }) => {
  const [isOpen, setIsOpen] = useAtom(isBackgroundOpenAtom)
  const [skyConfig, setSkyConfig] = useAtom(skyConfigAtom)

  if (!state.showBackground) return null

  const handleMatchThemeToggle = (checked: boolean | string) => {
    if (checked === true) {
      const themeColor = theme === 'light' ? '#ffffff' : '#000000'
      setSkyConfig({
        ...skyConfig,
        matchThemeColors: true,
        skyColor: themeColor,
        horizonColor: themeColor,
        fogColor: themeColor
      })
    } else {
      setSkyConfig({
        ...skyConfig,
        matchThemeColors: false
      })
    }
  }

  return (
    <Section title="Background Options" isOpen={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between py-0.5">
        <Checkbox
          id="match-theme"
          checked={skyConfig.matchThemeColors}
          onCheckedChange={handleMatchThemeToggle}
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
          </>
        )}
      </div>

      <div className="flex items-center justify-between py-0.5">
        <Checkbox
          id="bg-layer-active"
          checked={skyConfig.backgroundLayerActive}
          onCheckedChange={(checked) =>
            setSkyConfig({ ...skyConfig, backgroundLayerActive: checked === true })}
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
