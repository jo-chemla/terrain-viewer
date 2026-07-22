import type React from "react"
import { useAtom } from "jotai"
import { Globe, RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Section, SegmentedToggle } from "./controls-components"
import { activeProjectConfigAtom } from "@/lib/settings-atoms"

export const GeneralSettings: React.FC<{
  state: any; setState: (updates: any) => void;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, isOpen, onOpenChange }) => {
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const disabledViewModes = activeProjectConfig?.disableViewModes ?? []
  const hideSplitScreen = activeProjectConfig?.hiddenSections?.includes("splitScreen") ?? false

  return (
    <Section title="General Settings" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={true}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">View Mode</Label>
        <SegmentedToggle
          className="w-[140px]"
          value={state.viewMode}
          onChange={(value) => setState({ viewMode: value })}
          options={[
            !disabledViewModes.includes("2d") && { value: "2d", label: "2D" },
            !disabledViewModes.includes("globe") && { value: "globe", label: <Globe className="h-4 w-4 mx-auto" strokeWidth={state.viewMode === "globe" ? 2 : 1.5} /> },
            !disabledViewModes.includes("3d") && { value: "3d", label: "3D" },
          ].filter(Boolean) as { value: string; label: React.ReactNode }[]}
        />
      </div>
      {!hideSplitScreen && (
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">Split Screen</Label>
          <SegmentedToggle
            className="w-[140px]"
            value={state.splitScreen ? "on" : "off"}
            onChange={(value) => setState({ splitScreen: value === "on" })}
            options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
          />
        </div>
      )}
      {(state.viewMode === "3d" || state.viewMode === "globe") && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Terrain Exaggeration</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{state.exaggeration.toFixed(1)}x</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={() => setState({ exaggeration: 1 })}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <Slider value={[state.exaggeration]} onValueChange={([value]) => setState({ exaggeration: value })} min={0.1} max={10} step={0.1} className="cursor-pointer" />
        </div>
      )}
    </Section>
  )
}
