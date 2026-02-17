import type React from "react"
import { Globe, RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Section } from "./controls-components"

export const GeneralSettings: React.FC<{
  state: any; setState: (updates: any) => void;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, isOpen, onOpenChange }) => {
  return (
    <Section title="General Settings" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={true}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">View Mode</Label>
        <ToggleGroup type="single" value={state.viewMode} onValueChange={(value) => value && setState({ viewMode: value })} className="border rounded-md w-[140px]">
          <ToggleGroupItem value="2d" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">2D</ToggleGroupItem>
          <ToggleGroupItem value="globe" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">
            <Globe className="h-4 w-4" strokeWidth={state.viewMode === 'globe' ? 2 : 1.5} />
          </ToggleGroupItem>
          <ToggleGroupItem value="3d" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">3D</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">Split Screen</Label>
        <ToggleGroup type="single" value={state.splitScreen ? "on" : "off"} onValueChange={(value) => value && setState({ splitScreen: value === "on" })} className="border rounded-md w-[140px]">
          <ToggleGroupItem value="off" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">Off</ToggleGroupItem>
          <ToggleGroupItem value="on" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">On</ToggleGroupItem>
        </ToggleGroup>
      </div>
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
