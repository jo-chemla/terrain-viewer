import type React from "react"
import { useState, forwardRef } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { LucideIcon } from "lucide-react"

export const PasswordInput = forwardRef<HTMLInputElement, any>(({ className, ...props }, ref) => {
  const [showPassword, setShowPassword] = useState(false);

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
  );
});

PasswordInput.displayName = "PasswordInput";

export const Section: React.FC<{
  title: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
  children: React.ReactNode
}> = ({ title, isOpen, onOpenChange, withSeparator = true, children }) => (
  <>
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
        {title}
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1">{children}</CollapsibleContent>
    </Collapsible>
    {withSeparator && <Separator />}
  </>
)

export const SliderControl: React.FC<{
  label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number
  suffix?: string; decimals?: number; disabled?: boolean; hideValue?: boolean
}> = ({ label, value, onChange, min, max, step, suffix = "", decimals = 0, disabled = false, hideValue = false }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      {!hideValue && <span className="text-sm text-muted-foreground">{value.toFixed(decimals)}{suffix}</span>}
    </div>
    <Slider value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} className="cursor-pointer" disabled={disabled} />
  </div>
)

export const CheckboxWithSlider: React.FC<{
  id: string; label: string; checked: boolean; onCheckedChange: (checked: boolean) => void
  sliderValue?: number; onSliderChange?: (value: number) => void; hideSlider?: boolean; disabled?: boolean
}> = ({ id, label, checked, onCheckedChange, sliderValue = 0, onSliderChange = () => null, hideSlider = false, disabled = false }) => (
  <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
    <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} className="cursor-pointer" disabled={disabled} />
    <Label htmlFor={id} className={`text-sm cursor-pointer ${hideSlider ? "col-span-2" : ""}`}>{label}</Label>
    {!hideSlider && (
      <Slider value={[sliderValue]} onValueChange={([v]) => onSliderChange(v)} min={0} max={1} step={0.1} className="cursor-pointer" disabled={!checked || disabled} />
    )}
  </div>
)

export const CycleButtonGroup: React.FC<{
  value: string; options: { value: string; label: string | JSX.Element }[]
  onChange: (value: string) => void; onCycle: (direction: number) => void
}> = ({ value, options, onChange, onCycle }) => (
  <div className="flex gap-2">
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="flex-1 h-8 cursor-pointer"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
      </SelectContent>
    </Select>
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

interface TooltipButtonProps {
  icon: LucideIcon
  label: string
  tooltip: string
  onClick: () => void
  className?: string
}

export const TooltipButton: React.FC<TooltipButtonProps> = ({
  icon: Icon,
  label,
  tooltip,
  onClick,
  className = "flex-1"
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`cursor-pointer bg-transparent ${className}`}
          onClick={onClick}
        >
          <Icon className="h-3 w-3 mr-2" />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}


interface TooltipIconButtonProps {
  icon: LucideIcon
  tooltip: string
  onClick?: () => void
  className?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
}

export const TooltipIconButton = forwardRef<HTMLButtonElement, TooltipIconButtonProps>(({
  icon: Icon,
  tooltip,
  onClick,
  className = "",
  variant = "ghost",
  size = "icon",
}, ref) => {
  return (
    <Tooltip delayDuration={0} skipDelayDuration={300}>
      <TooltipTrigger asChild>
        <Button
          ref={ref}  // ← forward to the actual button
          variant={variant}
          size={size}
          onClick={onClick}
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
TooltipIconButton.displayName = "TooltipIconButton"