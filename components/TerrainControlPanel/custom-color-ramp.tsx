import type React from "react"
import { Fragment, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DraftBoundInput } from "./controls-components"
import {
  buildCustomRampColors, buildQuickRampStops, type CustomRampStop, type QuickRampShape, type QuickRampFade,
} from "@/lib/color-ramps"
import { getGradientColors } from "@/lib/controls-utils"

const TOGGLE_ITEM_CLASS = "flex-1 cursor-pointer text-xs text-muted-foreground font-normal data-pressed:bg-white data-pressed:font-bold data-pressed:text-foreground"

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
  <Select
    value={value}
    onValueChange={(v) => v && onValueChange(v)}
    items={[
      ...Object.entries(ramps).map(([key, ramp]) => ({ value: key, label: ramp.name })),
      { value: "custom", label: "-- Custom Colorramp Stops --" },
    ]}
  >
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

/** One-shot generator for the two "shapes" behind most of this app's own
 *  hand-built diverging/sequential ramps (see buildQuickRampStops) — Apply
 *  overwrites the current custom stops with a fresh 2-4 stop set spanning
 *  whichever [min, max] the stops already cover, which stays just as editable
 *  afterward (individually, below) as any hand-built stop list. Deliberately
 *  not itself a persisted "ramp type" — it only ever writes into the same
 *  customStops array every mode already has. */
const QuickRampBuilder: React.FC<{
  currentStops: CustomRampStop[]
  onApply: (stops: CustomRampStop[]) => void
}> = ({ currentStops, onApply }) => {
  const [shape, setShape] = useState<QuickRampShape>("diverging")
  const [fade, setFade] = useState<QuickRampFade>("center")
  const [colorA, setColorA] = useState("#2166ac")
  const [colorB, setColorB] = useState("#b2182b")

  const apply = () => {
    const values = currentStops.map((s) => s.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    onApply(buildQuickRampStops(shape, fade, colorA, colorB, min, max))
  }

  const swatchClass = "h-8 w-8 p-0 cursor-pointer border rounded-sm shrink-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch-wrapper]:p-0"

  return (
    <div className="space-y-2 rounded-md border p-2">
      <Label className="text-xs font-medium text-muted-foreground">Quick Build</Label>
      <ToggleGroup
        value={[shape]}
        onValueChange={([value]) => value && setShape(value as QuickRampShape)}
        className="border rounded-md w-full"
      >
        <ToggleGroupItem value="sequential" className={TOGGLE_ITEM_CLASS} title="One color, fading in from transparent (flip direction with Invert Ramp below).">
          1D
        </ToggleGroupItem>
        <ToggleGroupItem value="diverging" className={TOGGLE_ITEM_CLASS} title="Two colors, one on each side of the middle.">
          Diverging
        </ToggleGroupItem>
      </ToggleGroup>
      {shape === "diverging" && (
        <ToggleGroup
          value={[fade]}
          onValueChange={([value]) => value && setFade(value as QuickRampFade)}
          className="border rounded-md w-full"
        >
          <ToggleGroupItem value="center" className={TOGGLE_ITEM_CLASS} title="Color at both edges, transparent in the middle (e.g. a diverging curvature ramp).">
            Transparent Center
          </ToggleGroupItem>
          <ToggleGroupItem value="edges" className={TOGGLE_ITEM_CLASS} title="Color in the middle, transparent at both edges (e.g. highlighting values near zero).">
            Transparent Edges
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      <div className="flex items-center gap-2">
        <Input type="color" value={colorA} onChange={(e) => setColorA(e.target.value)} className={swatchClass} title={shape === "diverging" ? "Negative-side color" : "Color"} />
        {shape === "diverging" && (
          <Input type="color" value={colorB} onChange={(e) => setColorB(e.target.value)} className={swatchClass} title="Positive-side color" />
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="cursor-pointer" onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  )
}

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
      {/* Paused per user feedback (not the UI they had in mind) — kept intact,
          just not rendered, for another pass later. Component/logic still
          exported above (QuickRampBuilder / buildQuickRampStops). */}
      {/* <QuickRampBuilder currentStops={customStops} onApply={onStopsChange} /> */}
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">Custom Stops</Label>
        <ToggleGroup
          value={[isDiscrete ? "discrete" : "continuous"]}
          onValueChange={([value]) => value && onDiscreteChange(value === "discrete")}
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
