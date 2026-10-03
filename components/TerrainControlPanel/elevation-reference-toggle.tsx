import type React from "react"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const ELEVATION_REFERENCE_TOGGLE_ITEM_CLASS = "flex-1 cursor-pointer text-muted-foreground font-normal data-pressed:bg-white data-pressed:font-bold data-pressed:text-foreground"

// Shared Absolute/LRM picker — introduced by Plane Slicer, now also driving
// Contours and the Elevation Picker: all three ultimately read elevation off
// one of the same two references — real altitude from the terrain source, or
// LRM's height above/below the local neighborhood mean (lib/lrm-protocol.ts).
// Contours add a third reference behind a beta flag: "threshold", one
// outline where the DEM crosses a value (lib/threshold-protocol.ts).
export function ElevationReferenceToggle<T extends string = "absolute" | "lrm">({ value, onChange, label = "Reference", className, threshold = false }: {
  value: T
  onChange: (v: T) => void
  label?: string
  className?: string
  /** Show the Threshold item (contours only). */
  threshold?: boolean
}) {
  return (
  <div className="flex items-center justify-between gap-2">
    <Label className="text-sm font-medium">{label}</Label>
    <ToggleGroup
      value={[value]}
      onValueChange={([v]) => v && onChange(v as T)}
      className={cn("border rounded-md", threshold ? "w-[240px]" : "w-[180px]", className)}
    >
      {/* Tooltip via render={<ToggleGroupItem/>} merges the trigger props onto
          the item itself, so the ToggleGroup still sees its items as direct
          children (a wrapper element would break the group). */}
      <Tooltip>
        <TooltipTrigger render={<ToggleGroupItem value="absolute" className={ELEVATION_REFERENCE_TOGGLE_ITEM_CLASS}>Absolute</ToggleGroupItem>} />
        <TooltipContent><p>Reference is real elevation in meters.</p></TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<ToggleGroupItem value="lrm" className={ELEVATION_REFERENCE_TOGGLE_ITEM_CLASS}>LRM</ToggleGroupItem>} />
        <TooltipContent><p>Reference is height above/below the local neighborhood mean (Local Relief Model).</p></TooltipContent>
      </Tooltip>
      {threshold && (
        <Tooltip>
          <TooltipTrigger render={<ToggleGroupItem value="threshold" className={ELEVATION_REFERENCE_TOGGLE_ITEM_CLASS}>Threshold</ToggleGroupItem>} />
          <TooltipContent><p>One outline where the terrain crosses the value below (beta): canopy or buildings on an nDSM, a flood level on a DEM.</p></TooltipContent>
        </Tooltip>
      )}
    </ToggleGroup>
  </div>
  )
}
