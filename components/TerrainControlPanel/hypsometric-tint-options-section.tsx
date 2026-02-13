import type React from "react"
import { useMemo, useCallback, useRef } from "react"
import { useAtom } from "jotai"
import { ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import {
  isHypsoOpenAtom, colorRampTypeAtom, licenseFilterAtom
} from "@/lib/settings-atoms"
import { colorRamps, extractStops, colorRampsFlat } from "@/lib/color-ramps"
import { Section } from "./controls-components"
import { getGradientColors } from "./controls-utility"
import { useEffect } from "react"

export const HypsometricTintOptionsSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isHypsoOpenAtom)
  const [colorRampType, setColorRampType] = useAtom(colorRampTypeAtom)
  const [licenseFilter, setLicenseFilter] = useAtom(licenseFilterAtom)
  const isUserActionRef = useRef(false)

  // Initialize/sync colorRampType based on current colorRamp (for URL sharing)
  useEffect(() => {
    // Skip if this was a user-initiated change
    if (isUserActionRef.current) {
      isUserActionRef.current = false
      return
    }

    // Find which category contains the current ramp
    for (const [category, ramps] of Object.entries(colorRamps)) {
      if (ramps[state.colorRamp]) {
        setColorRampType(category)
        return
      }
    }
    // Fallback if ramp not found
    setColorRampType('classic')
  }, [state.colorRamp, setColorRampType])

  function filterColorRamps(colorRamps_: any, colorRampType_: string, licenseFilter_: string) {
    const ramps = colorRamps_[colorRampType_] || {}
    if (colorRampType_ == 'classic') { return ramps }
    const rampsArray = Object.values(ramps)

    if (licenseFilter_ === 'all') {
      return ramps
    }

    const filteredEntries = rampsArray.filter((ramp: any) => {
      if (licenseFilter_ === 'open-license-only') {
        return ['gpl', 'gplv2', 'cc3', 'ccnc'].includes(ramp.license)
      } else if (licenseFilter_ === 'distribute-ok') {
        return ramp.distribute === 'yes'
      } else if (licenseFilter_ === 'open-distribute') {
        return ['gpl', 'gplv2', 'cc3', 'ccnc'].includes(ramp.license) || ramp.distribute === 'yes'
      }
      return true
    })

    return Object.fromEntries(
      filteredEntries.map((ramp: any, index: number) => [
        Object.keys(ramps).find(key => ramps[key] === ramp) || `ramp-${index}`,
        ramp
      ])
    )
  }

  const resetCustomMinMax = useCallback(() => {
    const stops = extractStops(colorRampsFlat[state.colorRamp].colors)
    const rampMin = Math.min(...stops)
    const rampMax = Math.max(...stops)
    setState({ customMin: rampMin, customMax: rampMax })
  }, [state.colorRamp, setState])

  const filteredColorRamps = useMemo(() => {
    return filterColorRamps(colorRamps, colorRampType, licenseFilter)
  }, [colorRampType, licenseFilter])

  const colorRampKeys = useMemo(() => Object.keys(filteredColorRamps), [filteredColorRamps])

  const cycleColorRamp = useCallback((direction: number) => {
    const currentIndex = colorRampKeys.indexOf(state.colorRamp)
    const newIndex = (currentIndex + direction + colorRampKeys.length) % colorRampKeys.length
    setState({ colorRamp: colorRampKeys[newIndex] })
  }, [state.colorRamp, colorRampKeys, setState])

  if (!state.showColorRelief) return null

  return (
    <Section title="Hypsometric Tint Options" isOpen={isOpen} onOpenChange={setIsOpen}>
      <div className="space-y-2">
        <Label className="text-sm font-medium">Color Ramp Type</Label>
        <ToggleGroup
          type="single"
          value={colorRampType}
          onValueChange={(value) => {
            if (value) {
              isUserActionRef.current = true
              setColorRampType(value)
              const filteredNow = filterColorRamps(colorRamps, value, licenseFilter)
              // Always switch to first ramp in the new category
              // if (!filteredNow[state.colorRamp]) {
              const first = Object.values(filteredNow)[0].name
              if (first) {
                setState({ colorRamp: first.toLowerCase() })
              }
              // }
            }
          }}
          className="grid grid-cols-5 w-full"
        >
          <ToggleGroupItem value="classic" className="w-full data-[state=on]:font-bold">Classic</ToggleGroupItem>
          <ToggleGroupItem value="topo" className="w-full data-[state=on]:font-bold">Topo</ToggleGroupItem>
          <ToggleGroupItem value="topobath" className="w-full data-[state=on]:font-bold">Topo+bath</ToggleGroupItem>
          <ToggleGroupItem value="temp" className="w-full data-[state=on]:font-bold">Temp</ToggleGroupItem>
          <ToggleGroupItem value="topqgs" className="w-full data-[state=on]:font-bold">Top Qgs</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Color Ramp</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="http://seaviewsensing.com/pub/cpt-city/index.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>cpt-city</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Load advanced color ramps</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex gap-2">
            <Select value={state.colorRamp} onValueChange={(value) => setState({ colorRamp: value })}>
              <SelectTrigger className="flex-1 cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(filteredColorRamps).map(([key, ramp]: [string, any]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-12 h-4 rounded-sm"
                        style={{ background: `linear-gradient(to right, ${getGradientColors(ramp.colors)})` }}
                      />
                      <span>{ramp.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex border rounded-md shrink-0">
              <Button variant="ghost" size="icon" onClick={() => cycleColorRamp(-1)} className="rounded-r-none border-r cursor-pointer">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => cycleColorRamp(1)} className="rounded-l-none cursor-pointer">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">License Type</Label>
          <Select value={licenseFilter} onValueChange={(value) => {
            if (value) {
              setLicenseFilter(value)
              const filteredNow = filterColorRamps(colorRamps, colorRampType, value)
              if (!filteredNow[state.colorRamp]) {
                const first = Object.values(filteredNow)[0].name
                setState({ colorRamp: first.toLowerCase() })
              }
            }
          }}>
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open-license-only">Open License Only</SelectItem>
              <SelectItem value="distribute-ok">Qgis Distribute Yes</SelectItem>
              <SelectItem value="open-distribute">Open License + Distribute Yes</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-full gap-1 flex items-center">
          <div className="flex-[2] flex items-center">
            <div className="flex items-center justify-between py-0.5 w-full">
              <Checkbox id="hypso-min-max" checked={state.customHypsoMinMax} onCheckedChange={(checked) => setState({ customHypsoMinMax: checked === true })} />
              <div className="flex items-center flex-1 ml-2 gap-1">
                <Label htmlFor="hypso-min-max" className="text-sm font-medium cursor-pointer">Edit Min/Max</Label>
                <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={resetCustomMinMax}>
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex-1 flex items-center">
            <Input
              type="number"
              step="any"
              placeholder="Min"
              className="h-8 py-1 text-sm"
              value={state.customMin ?? ""}
              onChange={(e) => setState({ customMin: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
          <div className="flex-1 flex items-center">
            <Input
              type="number"
              step="any"
              placeholder="Max"
              className="h-8 py-1 text-sm"
              value={state.customMax ?? ""}
              onChange={(e) => setState({ customMax: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
        </div>
      </div>
    </Section>
  )
}
