import type React from "react"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

export const ELEVATION_REFERENCE_TOGGLE_ITEM_CLASS = "flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"

// Shared Absolute/LRM picker — introduced by Plane Slicer, now also driving
// Contours and the Elevation Picker: all three ultimately read elevation off
// one of the same two references — real altitude from the terrain source, or
// LRM's height above/below the local neighborhood mean (lib/lrm-protocol.ts).
export const ElevationReferenceToggle: React.FC<{
  value: "absolute" | "lrm"
  onChange: (v: "absolute" | "lrm") => void
  label?: string
  className?: string
}> = ({ value, onChange, label = "Reference", className }) => (
  <div className="flex items-center justify-between gap-2">
    <Label className="text-sm font-medium">{label}</Label>
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as "absolute" | "lrm")}
      className={cn("border rounded-md w-[180px]", className)}
    >
      <ToggleGroupItem value="absolute" className={ELEVATION_REFERENCE_TOGGLE_ITEM_CLASS} title="Reference is real elevation in meters.">
        Absolute
      </ToggleGroupItem>
      <ToggleGroupItem value="lrm" className={ELEVATION_REFERENCE_TOGGLE_ITEM_CLASS} title="Reference is height above/below the local neighborhood mean (Local Relief Model).">
        LRM
      </ToggleGroupItem>
    </ToggleGroup>
  </div>
)
