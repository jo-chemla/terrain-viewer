import * as React from "react"
import { CalendarDays } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { clampIsoDate, isoFromLocalDate, localDateFromIso, parseDateInput } from "@/lib/date-input"

/**
 * A calendar-day field: the "YYYY-MM-DD" text is an input (click, type any
 * of "2021-03-12", "12/03/2021", "12 March 2021", "March 2021", "2021";
 * Enter or blur commits, Escape or unparseable text reverts) and the icon
 * opens the Calendar in a popover. Values are day strings end to end, so no
 * timezone ever touches them (see lib/date-input.ts).
 */
export const DateField: React.FC<{
  /** "YYYY-MM-DD" ("" shows the placeholder). */
  value: string
  onChange: (iso: string) => void
  /** Inclusive bounds ("YYYY-MM-DD"); typed dates are clamped, calendar days outside are disabled. */
  min?: string
  max?: string
  /** Range of the calendar's year dropdown. Defaults: 1930 to this month. */
  startMonth?: Date
  endMonth?: Date
  placeholder?: string
  size?: "default" | "sm"
  className?: string
  align?: "start" | "end" | "center"
  "aria-label"?: string
}> = ({ value, onChange, min, max, startMonth, endMonth, placeholder = "YYYY-MM-DD", size = "default", className, align = "start", "aria-label": ariaLabel }) => {
  const [draft, setDraft] = React.useState<string | null>(null) // null = not editing, show value
  const inputRef = React.useRef<HTMLInputElement>(null)

  const commit = React.useCallback(() => {
    if (draft === null) return
    const parsed = parseDateInput(draft)
    if (parsed) {
      const next = clampIsoDate(parsed, min, max)
      if (next !== value) onChange(next)
    }
    setDraft(null) // invalid text reverts to the current value
  }, [draft, min, max, value, onChange])

  const selected = localDateFromIso(value)
  const minDate = localDateFromIso(min)
  const maxDate = localDateFromIso(max)
  const h = size === "sm" ? "h-8" : "h-9"

  return (
    <Popover>
      <div
        className={cn(
          "flex items-center rounded-md border border-input bg-background dark:bg-input/30 shadow-xs transition-[color,box-shadow]",
          "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          h, className,
        )}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={draft ?? value}
          onFocus={() => setDraft(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); inputRef.current?.blur() }
            else if (e.key === "Escape") { e.preventDefault(); setDraft(null); inputRef.current?.blur() }
          }}
          className={cn("flex-1 min-w-0 w-0 bg-transparent px-3 py-1 outline-none tabular-nums placeholder:text-muted-foreground cursor-text", size === "sm" ? "text-sm" : "text-base md:text-sm")}
        />
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Open calendar"
              className={cn("shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer rounded-r-md", size === "sm" ? "w-7 h-full" : "w-8 h-full")}
            >
              <CalendarDays className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
            </button>
          }
        />
      </div>
      <PopoverContent align={align} className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          startMonth={startMonth ?? new Date(1930, 0)}
          endMonth={endMonth ?? new Date()}
          disabled={[
            ...(minDate ? [{ before: minDate }] : []),
            ...(maxDate ? [{ after: maxDate }] : []),
          ]}
          onSelect={(d) => { if (d) onChange(isoFromLocalDate(d)) }}
        />
      </PopoverContent>
    </Popover>
  )
}
