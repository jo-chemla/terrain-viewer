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
  suffix?: string; decimals?: number; disabled?: boolean
}> = ({ label, value, onChange, min, max, step, suffix = "", decimals = 0, disabled = false }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <span className="text-sm text-muted-foreground">{value.toFixed(decimals)}{suffix}</span>
    </div>
    <Slider value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} className="cursor-pointer" disabled={disabled} />
  </div>
)

export const CheckboxWithSlider: React.FC<{
  id: string; label: string; checked: boolean; onCheckedChange: (checked: boolean) => void
  sliderValue: number; onSliderChange: (value: number) => void; hideSlider?: boolean
}> = ({ id, label, checked, onCheckedChange, sliderValue, onSliderChange, hideSlider = false }) => (
  <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
    <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} className="cursor-pointer" />
    <Label htmlFor={id} className={`text-sm cursor-pointer ${hideSlider ? "col-span-2" : ""}`}>{label}</Label>
    {!hideSlider && (
      <Slider value={[sliderValue]} onValueChange={([v]) => onSliderChange(v)} min={0} max={1} step={0.01} className="cursor-pointer" disabled={!checked} />
    )}
  </div>
)

export const CycleButtonGroup: React.FC<{
  value: string; options: { value: string; label: string | JSX.Element }[]
  onChange: (value: string) => void; onCycle: (direction: number) => void
}> = ({ value, options, onChange, onCycle }) => (
  <div className="flex gap-2">
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="flex-1 cursor-pointer"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
      </SelectContent>
    </Select>
    <div className="flex border rounded-md shrink-0">
      <Button variant="ghost" size="icon" onClick={() => onCycle(-1)} className="rounded-r-none border-r cursor-pointer">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onCycle(1)} className="rounded-l-none cursor-pointer">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  </div>
)
