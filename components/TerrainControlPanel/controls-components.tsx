import type React from "react"
import { useState, useEffect, forwardRef, createContext, useContext, useId } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, Eye, EyeOff } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { LucideIcon } from "lucide-react"
import { atom, useAtom } from "jotai"
import { cn } from "@/lib/utils"
import { activeSliderAtom, transparentUiAtom } from "@/lib/settings-atoms"


// ─── Active-slider atom (global, no prop drilling) ────────────────────────────

// ─── Section context (module-level, not inside component) ────────────────────

export const SectionIdContext = createContext<string>("")

// ─── MobileSlider ─────────────────────────────────────────────────────────────

export const MobileSlider = forwardRef<
  React.ElementRef<typeof Slider>,
  React.ComponentPropsWithoutRef<typeof Slider> & { sliderId?: string }
>(({ sliderId, className, onPointerDown, onPointerUp, onPointerCancel, ...props }, ref) => {
  const [transparentUi, setTransparentUi] = useAtom(transparentUiAtom)
  
  const [, setActiveSlider] = useAtom(activeSliderAtom)
  const id = sliderId ?? (props as any)["aria-label"] ?? "slider"

  // Radix's own Slider prop types are internally inconsistent here — its ref
  // element type (ElementRef<typeof Slider>) is HTMLSpanElement, but its
  // onPointerDown/Up/Cancel props expect PointerEvent<HTMLDivElement>. Same
  // underlying DOM PointerEvent either way; the cast below only papers over
  // that upstream generic-parameter mismatch, not an actual type difference.
  const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (transparentUi) setActiveSlider(id)
    onPointerDown?.(e as unknown as React.PointerEvent<HTMLDivElement>)
  }
  const handlePointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (transparentUi) setActiveSlider(null)
    onPointerUp?.(e as unknown as React.PointerEvent<HTMLDivElement>)
  }
  const handlePointerCancel = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (transparentUi) setActiveSlider(null)
    onPointerCancel?.(e as unknown as React.PointerEvent<HTMLDivElement>)
  }

  return (
    <Slider
      ref={ref}
      className={cn(className, transparentUi ? "relative z-[1]" : "")}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      {...props}
    />
  )
})
MobileSlider.displayName = "MobileSlider"

// ─── PasswordInput ────────────────────────────────────────────────────────────

export const PasswordInput = forwardRef<HTMLInputElement, any>(({ className, ...props }, ref) => {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="relative">
      <Input
        type={showPassword ? "text" : "password"}
        className={`pr-10 ${className || ''}`}
        ref={ref}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent cursor-pointer"
        onClick={() => setShowPassword(!showPassword)}
      >
        {showPassword ? (
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Eye className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  )
})
PasswordInput.displayName = "PasswordInput"

// ─── Section ──────────────────────────────────────────────────────────────────

export const Section: React.FC<{
  title: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
  // Extra control (e.g. AdvancedModeToggle) rendered in the header row, right
  // before the chevron — sits at the SAME right edge as every section's own
  // expand/collapse chevron, for free, instead of being positioned inside
  // CollapsibleContent with ad-hoc margins trying to fake that alignment.
  // Radix supports multiple CollapsibleTrigger instances sharing one
  // Collapsible (both just call the same onOpenToggle), so splitting the
  // header into a title-trigger and a chevron-trigger with this slot between
  // them doesn't change the "click anywhere in the header to expand" feel.
  headerExtra?: React.ReactNode
  children: React.ReactNode
}> = ({ title, isOpen, onOpenChange, withSeparator = true, headerExtra, children }) => {
  const [activeSlider] = useAtom(activeSliderAtom)
  const autoId = useId()
  const isMine = activeSlider !== null && activeSlider.startsWith(autoId + ":")
  const dim = activeSlider !== null && !isMine

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <div className={cn(
          "flex items-center justify-between w-full py-1 transition-opacity duration-150",
          dim && "opacity-20"
        )}>
          <CollapsibleTrigger className="flex-1 min-w-0 text-base font-medium text-left cursor-pointer">
            <span className="text-left">{title}</span>
          </CollapsibleTrigger>
          <div className="flex items-center gap-2 shrink-0">
            {headerExtra}
            <CollapsibleTrigger className="cursor-pointer">
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
          </div>
        </div>
        <SectionIdContext.Provider value={autoId}>
          <CollapsibleContent className={cn(
            "space-y-2 pt-1 transition-opacity duration-150",
            dim && "opacity-20"
          )}>
            {children}
          </CollapsibleContent>
        </SectionIdContext.Provider>
      </Collapsible>
       {withSeparator && (
         <Separator className={cn("transition-opacity duration-150", activeSlider !== null && "opacity-20")} />
      )}
    </>
  )
}

// ─── AdvancedModeToggle ────────────────────────────────────────────────────────
//
// Basic/Advanced switch for a Terrain Analysis / Relief Visualization section
// (one atom per section — see terrainAnalysisAdvancedAtom/
// reliefVisualizationAdvancedAtom in settings-atoms.ts, folding one doesn't
// affect the other): Basic collapses every sub-mode to just its
// checkbox/title/opacity slider, same as the everything-off look; Advanced
// (default) shows each sub-mode's full options block (color ramp, range
// sliders, etc.) as before. Deliberately does NOT swap between two different
// icons — a shadcn Toggle (radix pressed/unpressed styling) instead keeps the
// same "collapse" glyph always and communicates state via the button's own
// pressed look (data-[state=on]:bg-accent), pressed meaning "currently
// collapsed to basic" — more explicit than an icon-swap once you already know
// what the icon means.
export const AdvancedModeToggle: React.FC<{ advanced: boolean; onToggle: () => void }> = ({ advanced, onToggle }) => (
  <Tooltip delayDuration={0}>
    {/* TooltipTrigger asChild merges its own data-state (tooltip open/closed)
        onto its direct child — Toggle needs data-state (pressed on/off) for
        its own styling, so it can't be that direct child or the two collide
        and the tooltip's wins. A plain wrapping span (same trick TooltipButton
        above uses) keeps them on separate elements. */}
    <TooltipTrigger asChild>
      <span>
        <Toggle
          pressed={!advanced}
          onPressedChange={() => onToggle()}
          size="sm"
          aria-label={advanced ? "Collapse to basic — hide sub-mode options" : "Expand to advanced — show sub-mode options"}
          className="cursor-pointer"
        >
          <ChevronsDownUp className="h-4 w-4" />
        </Toggle>
      </span>
    </TooltipTrigger>
    <TooltipContent><p>{advanced ? "Collapse to basic (hide sub-mode options)" : "Expand to advanced (show sub-mode options)"}</p></TooltipContent>
  </Tooltip>
)

// ─── MacroSeparator ────────────────────────────────────────────────────────────
// A bolder, higher-contrast divider dropped between macro groups of sections
// (Sources / Options / Tools, etc) — every Section already renders its own thin
// Separator after itself, so this is an extra, more visible line layered on top
// of that rhythm specifically at the handful of spots that mark a bigger jump.
// Which Section ends up immediately before a MacroSeparator varies at runtime
// (many sections conditionally render nothing), so rather than threading a
// "the section before me is skipped" computation through every optional
// section, a plain sibling-based CSS rule (see index.css) hides whichever
// ordinary Separator ends up directly adjacent to one of these — regardless
// of which section that turns out to be.
export const MacroSeparator: React.FC = () => (
  <Separator className="macro-separator data-[orientation=horizontal]:h-[2px] bg-foreground/20 rounded-full" />
)

// ─── SliderControl ────────────────────────────────────────────────────────────

export const SliderControl: React.FC<{
  label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number
  suffix?: string; decimals?: number; disabled?: boolean; hideValue?: boolean
  sliderId?: string
}> = ({ label, value, onChange, min, max, step, suffix = "", decimals = 0, disabled = false, hideValue = false, sliderId }) => {
  const [activeSlider] = useAtom(activeSliderAtom)
  const sectionId = useContext(SectionIdContext)
  const id = `${sectionId}:${sliderId ?? label}`
  const isDimmed = activeSlider !== null && activeSlider !== id

  return (
    <div className={cn("space-y-1 transition-opacity duration-150", isDimmed && "opacity-20")}>
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        {!hideValue && <span className="text-sm text-muted-foreground">{value.toFixed(decimals)}{suffix}</span>}
      </div>
      <MobileSlider sliderId={id} value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} className="cursor-pointer" disabled={disabled} />
    </div>
  )
}

// ─── CheckboxWithSlider ───────────────────────────────────────────────────────

export const CheckboxWithSlider: React.FC<{
  // ReactNode (not just string) so a mode that's slow to compute can append an
  // inline icon (e.g. SVF/Openness's hourglass) that inherits the label's own
  // text color, instead of a colored emoji glyph.
  id: string; label: React.ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void
  sliderValue?: number; onSliderChange?: (value: number) => void; hideSlider?: boolean; disabled?: boolean
  tooltip?: string
}> = ({ id, label, checked, onCheckedChange, sliderValue = 0, onSliderChange = () => null, hideSlider = false, disabled = false, tooltip }) => {
  const [activeSlider] = useAtom(activeSliderAtom)
  const sectionId = useContext(SectionIdContext)
  const fullId = `${sectionId}:${id}`
  const isDimmed = activeSlider !== null && activeSlider !== fullId

  const labelEl = <Label htmlFor={id} className={`text-sm cursor-pointer ${hideSlider ? "col-span-2" : ""}`}>{label}</Label>

  return (
    <div className={cn("grid grid-cols-[auto_1fr_1fr] gap-2 items-center transition-opacity duration-150", isDimmed && "opacity-20")}>
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} className="cursor-pointer" disabled={disabled} />
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{labelEl}</TooltipTrigger>
          <TooltipContent><p>{tooltip}</p></TooltipContent>
        </Tooltip>
      ) : labelEl}
      {!hideSlider && (
        <MobileSlider sliderId={fullId} value={[sliderValue]} onValueChange={([v]) => onSliderChange(v)} min={0} max={1} step={0.1} className="cursor-pointer" disabled={!checked || disabled} />
      )}
    </div>
  )
}

// ─── CycleButtonGroup ─────────────────────────────────────────────────────────

export const CycleButtonGroup: React.FC<{
  value: string; options: { value: string; label: string | JSX.Element }[]
  onChange: (value: string) => void; onCycle: (direction: number) => void
  /** Optional extra control (e.g. a color swatch) slotted between the select
   *  and the chevron pair. */
  middle?: React.ReactNode
}> = ({ value, options, onChange, onCycle, middle }) => (
  <div className="flex gap-2">
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="flex-1 h-8 cursor-pointer"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
      </SelectContent>
    </Select>
    {middle}
    <div className="flex border rounded-md shrink-0 h-8">
      <Button variant="ghost" size="icon" onClick={() => onCycle(-1)} className="rounded-r-none border-r cursor-pointer h-7 w-7">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onCycle(1)} className="rounded-l-none cursor-pointer h-7 w-7">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  </div>
)

// ─── TooltipButton ────────────────────────────────────────────────────────────

interface TooltipButtonProps {
  icon: LucideIcon
  label: string
  tooltip: string
  onClick: () => void
  disabled?: boolean
  className?: string
}

export const TooltipButton: React.FC<TooltipButtonProps> = ({
  icon: Icon,
  label,
  tooltip,
  onClick,
  disabled = false,
  className = "flex-1"
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Wrapping span keeps the tooltip working when disabled — a native disabled
            button doesn't dispatch pointer/hover events, so the trigger would never
            open if the Button itself were the trigger. */}
        <span className={className}>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="cursor-pointer bg-transparent min-w-0 w-full"
            onClick={onClick}
          >
            <Icon className="h-3 w-3 sm:h-4 sm:w-4 mr-1 shrink-0" />
            <span className="truncate text-xs sm:text-sm">{label}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

// ─── TooltipIconButton ────────────────────────────────────────────────────────

interface TooltipIconButtonProps {
  icon: LucideIcon
  tooltip: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
}

export const TooltipIconButton = forwardRef<HTMLButtonElement, TooltipIconButtonProps>(({
  icon: Icon,
  tooltip,
  onClick,
  disabled = false,
  className = "",
  variant = "ghost",
  size = "icon",
}, ref) => {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          ref={ref}  // ← forward to the actual button
          variant={variant}
          size={size}
          onClick={onClick}
          disabled={disabled}
          className={`cursor-pointer ${className}`}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
})

// ─── DraftBoundInput ────────────────────────────────────────────────────────────
//
// Text input for a slider min/max bound that tolerates in-progress typing (e.g. a
// lone "-", or clearing the field to retype) without ever committing or displaying
// NaN. Deliberately does NOT commit on every keystroke — typing "100" digit-by-digit
// used to commit 1, then 10, then 100 in quick succession, visibly jerking the slider
// track as its range changed mid-type. Validation/commit only happens on Enter or blur.
export const DraftBoundInput: React.FC<{
  value: number | undefined
  onCommit: (value: number | undefined) => void
  placeholder?: string
  className: string
}> = ({ value, onCommit, placeholder, className }) => {
  const [draft, setDraft] = useState<string>(value === undefined ? "" : String(value))

  // Keep the draft in sync when the bound changes externally (ramp switch, reset button, etc.)
  useEffect(() => {
    setDraft(value === undefined ? "" : String(value))
  }, [value])

  const commit = () => {
    if (draft === "") { onCommit(undefined); return }
    const parsed = parseFloat(draft)
    if (Number.isFinite(parsed)) onCommit(parsed)
    else setDraft(value === undefined ? "" : String(value)) // revert an incomplete draft (e.g. a lone "-")
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      className={className}
      value={draft}
      onChange={(e) => {
        const next = e.target.value
        // Only accept strings that could become a valid number: optional leading
        // minus, digits, optional single decimal point — lets "-" sit there uncommitted
        // while the user keeps typing instead of being rejected/reverted immediately.
        if (!/^-?\d*\.?\d*$/.test(next)) return
        setDraft(next)
      }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
      onBlur={commit}
    />
  )
}
TooltipIconButton.displayName = "TooltipIconButton"

// ─── Range-bound clamping ─────────────────────────────────────────────────────
//
// For a two-input min/max range (DraftBoundInput pair), the paired-slider variant
// already sorts its two values with Math.min/Math.max on every drag so min can
// never end up above max. The two independent text inputs commit one bound at a
// time though, so without this same sort a user typing a min above the current
// max (or vice versa) produces an inverted range — which color-relief-color
// consumers (via remapColorRampStops) turn into non-ascending paint stops that
// maplibre's style validator rejects outright.
export function clampMinCommit(v: number | undefined, currentMax: number): number | undefined {
  return v === undefined ? undefined : Math.min(v, currentMax)
}
export function clampMaxCommit(v: number | undefined, currentMin: number): number | undefined {
  return v === undefined ? undefined : Math.max(v, currentMin)
}