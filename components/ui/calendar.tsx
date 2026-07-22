import "react-day-picker/style.css"
import type * as React from "react"
import { DayPicker } from "react-day-picker"
import { cn } from "@/lib/utils"

// Thin wrapper over react-day-picker (the library shadcn's date picker is built
// on). We import the library's own stylesheet for layout and re-tint it to the
// app palette via react-day-picker's CSS custom properties, so it re-themes
// live with every preset the same way the rest of the UI does.
export type CalendarProps = React.ComponentProps<typeof DayPicker>

export function Calendar({ className, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays
      className={cn("p-3 text-sm", className)}
      style={{
        // react-day-picker v10 exposes these; map them onto the app tokens.
        ["--rdp-accent-color" as string]: "var(--primary)",
        ["--rdp-accent-background-color" as string]: "color-mix(in oklab, var(--primary) 15%, transparent)",
        ["--rdp-today-color" as string]: "var(--primary)",
        ["--rdp-range_middle-background-color" as string]: "color-mix(in oklab, var(--primary) 15%, transparent)",
      } as React.CSSProperties}
      {...props}
    />
  )
}
