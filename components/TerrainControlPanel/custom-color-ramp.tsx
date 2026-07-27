import type React from "react"
import { Fragment } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DraftBoundInput } from "./controls-components"
import { buildCustomRampColors, type CustomRampStop } from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"

const TOGGLE_ITEM_CLASS = "flex-1 cursor-pointer text-xs data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"

/** The Select for a mode's color ramp registry, with a synthetic "-- Custom
 *  Colorramp Stops --" entry injected right after `anchorKey` — same registry-
 *  gradient-preview + Fragment-injection pattern this file's sibling
 *  slope-options-section.tsx originated. Shared by every viz mode that offers
 *  a plain single-registry ramp picker (Aspect/TRI/Curvature/Openness/Local
 *  Dominance) — Hypsometric Tint's category+ramp two-Select layout is
 *  different enough (cpt-city categories, not one flat registry) that it
 *  injects its own "custom" entry directly rather than using this component. */
export const ColorRampSelectWithCustom: React.FC<{
  ramps: Record<string, { name: string; colors: any[] }>
  value: string
  onValueChange: (value: string) => void
  /** Ramp key after which the synthetic "custom" entry is injected — pick
   *  whichever ramp this mode's default/most-common choice is, so custom
   *  sits next to the ramp it's most likely to be tweaked from. */
  anchorKey: string
  customStops: CustomRampStop[]
  customStopsDiscrete: boolean
}> = ({ ramps, value, onValueChange, anchorKey, customStops, customStopsDiscrete }) => (
  <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger className="w-full cursor-pointer">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {Object.entries(ramps).map(([key, ramp]) => (
        <Fragment key={key}>
          <SelectItem value={key}>
            <div className="flex items-center gap-2">
              <div
                className="w-12 h-4 rounded-sm"
                style={{ background: `linear-gradient(to right, ${getGradientColors(ramp.colors)})` }}
              />
              <span>{ramp.name}</span>
            </div>
          </SelectItem>
          {key === anchorKey && (
            <SelectItem value="custom">
              <div className="flex items-center gap-2">
                <div
                  className="w-12 h-4 rounded-sm"
                  style={{ background: `linear-gradient(to right, ${getGradientColors(buildCustomRampColors(customStops, customStopsDiscrete))})` }}
                />
                <span>-- Custom Colorramp Stops --</span>
              </div>
            </SelectItem>
          )}
        </Fragment>
      ))}
    </SelectContent>
  </Select>
)

/** The stop-editing UI itself (continuous/discrete toggle + per-stop color/
 *  value rows + add button) — appears in place of whatever range-slider UI a
 *  mode normally shows once its ramp Select is set to "custom", since a
 *  custom ramp's own stop values ARE its range (no separate min/max needed).
 *  Extracted from slope-options-section.tsx's original inline "isCustom"
 *  block so every other mode gets the exact same editing behavior (self-
 *  healing ascending-order stop edits, minimum 2 stops, etc.) for free. */
export const CustomRampStopsEditor: React.FC<{
  customStops: CustomRampStop[]
  onStopsChange: (stops: CustomRampStop[]) => void
  isDiscrete: boolean
  onDiscreteChange: (discrete: boolean) => void
}> = ({ customStops, onStopsChange, isDiscrete, onDiscreteChange }) => {
  const updateStop = (index: number, patch: Partial<CustomRampStop>) => {
    onStopsChange(customStops.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }
  // Editing a stop's value must keep the list strictly ascending (an interpolate
  // ramp requires it — see buildCustomRampColors). The edited value is treated as
  // authoritative: any later stop that would now sit at or below it is bumped up
  // to prev+1, and any earlier stop at or above it is pulled down to next−1, so a
  // mid-list edit like 0-25-30-35 → 0-25-20-35 self-heals instead of silently
  // producing a broken ramp.
  const commitStopValue = (index: number, v: number | undefined) => {
    if (v === undefined) return
    const next = customStops.map((s) => ({ ...s }))
    next[index].value = v
    for (let j = index + 1; j < next.length; j++) {
      if (next[j].value <= next[j - 1].value) next[j].value = next[j - 1].value + 1
    }
    for (let j = index - 1; j >= 0; j--) {
      if (next[j].value >= next[j + 1].value) next[j].value = next[j + 1].value - 1
    }
    onStopsChange(next)
  }
  const removeStop = (index: number) => {
    if (customStops.length <= 2) return
    onStopsChange(customStops.filter((_, i) => i !== index))
  }
  const addStop = () => {
    const maxValue = Math.max(...customStops.map((s) => s.value))
    onStopsChange([...customStops, { value: maxValue + 5, color: "#888888" }])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">Custom Stops</Label>
        <ToggleGroup
          type="single"
          value={isDiscrete ? "discrete" : "continuous"}
          onValueChange={(value) => value && onDiscreteChange(value === "discrete")}
          className="border rounded-md w-[170px]"
        >
          <ToggleGroupItem value="continuous" className={TOGGLE_ITEM_CLASS} title="Smoothly interpolate colors between stops.">
            Continuous
          </ToggleGroupItem>
          <ToggleGroupItem value="discrete" className={TOGGLE_ITEM_CLASS} title="Hard bands — each color holds until the next stop's value.">
            Discrete
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {/* space-y-0 + borderless, square, zero-padding color inputs make the
          swatches abut top-to-bottom into one continuous strip (previewing
          the ramp itself) — deliberately kept as the plain native color input,
          not the ColorAlphaSwatch popover used elsewhere, so this list stays
          exactly as it was. */}
      <div className="space-y-0">
        {customStops.map((stop, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="color"
              value={stop.color}
              onChange={(e) => updateStop(i, { color: e.target.value })}
              className="h-8 w-8 p-0 cursor-pointer border-none rounded-none shrink-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-none [&::-webkit-color-swatch-wrapper]:p-0"
            />
            <DraftBoundInput
              value={stop.value}
              onCommit={(v) => commitStopValue(i, v)}
              className="h-8 py-1 px-2 w-16 text-xs bg-transparent border rounded shrink-0"
            />
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 cursor-pointer"
              disabled={customStops.length <= 2}
              onClick={() => removeStop(i)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="w-full cursor-pointer" onClick={addStop}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Add Stop
      </Button>
    </div>
  )
}
