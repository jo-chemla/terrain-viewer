import type React from "react"
import { useMemo, useCallback, useRef, useContext } from "react"
import { useAtom } from "jotai"
import { ChevronLeft, ChevronRight, ExternalLink, RotateCcw, Mountain, MountainSnow } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import {
  colorRampTypeAtom, licenseFilterAtom, activeSliderAtom
} from "@/lib/settings-atoms"
import { colorRamps, extractStops, colorRampsFlat } from "@/lib/color-ramps"
// import { Section, TooltipIconButton } from "./controls-components"
import { Section, TooltipIconButton, MobileSlider, SectionIdContext } from "./controls-components"
import { cn } from "@/lib/utils"
import { getGradientColors } from "@/lib/controls-utils"
import { useEffect } from "react"
import type { MapRef } from "react-map-gl/maplibre"

export const HypsometricTintOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mapRef: React.RefObject<MapRef>
}> = ({ state, setState, isOpen, onOpenChange, mapRef }) => {
  const [colorRampType, setColorRampType] = useAtom(colorRampTypeAtom)
  const [licenseFilter, setLicenseFilter] = useAtom(licenseFilterAtom)
  const isUserActionRef = useRef(false)

  // Calculate the bounds for the current color ramp
  const rampBounds = useMemo(() => {
    const stops = extractStops(colorRampsFlat[state.colorRamp].colors)
    return {
      min: Math.min(...stops),
      max: Math.max(...stops)
    }
  }, [state.colorRamp])

  // Reset slider bounds when color ramp changes
  useEffect(() => {
    const stops = extractStops(colorRampsFlat[state.colorRamp].colors)
    const newMin = Math.floor(Math.min(...stops))
    const newMax = Math.ceil(Math.max(...stops))

    setState({
      hypsoSliderMinBound: newMin,
      hypsoSliderMaxBound: newMax
    })
  }, [state.colorRamp, setState])

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

  const resetminElevationMax = useCallback(() => {
    setState({
      minElevation: rampBounds.min,
      maxElevation: rampBounds.max,
      hypsoSliderMinBound: Math.floor(rampBounds.min),
      hypsoSliderMaxBound: Math.ceil(rampBounds.max)
    })
  }, [rampBounds, setState])

  const filteredColorRamps = useMemo(() => {
    return filterColorRamps(colorRamps, colorRampType, licenseFilter)
  }, [colorRampType, licenseFilter])

  const colorRampKeys = useMemo(() => Object.keys(filteredColorRamps), [filteredColorRamps])

  const cycleColorRamp = useCallback((direction: number) => {
    const currentIndex = colorRampKeys.indexOf(state.colorRamp)
    const newIndex = (currentIndex + direction + colorRampKeys.length) % colorRampKeys.length
    setState({
      colorRamp: colorRampKeys[newIndex],
      hypsoSliderMinBound: undefined,
      hypsoSliderMaxBound: undefined
    })
  }, [state.colorRamp, colorRampKeys, setState])

  // Get current slider values, defaulting to ramp bounds if not set
  const sliderValues = useMemo(() => [
    state.minElevation ?? rampBounds.min,
    state.maxElevation ?? rampBounds.max
  ], [state.minElevation, state.maxElevation, rampBounds])

  // Get slider bounds, defaulting to ramp bounds if not set
  const sliderBounds = useMemo(() => ({
    min: state.hypsoSliderMinBound ?? Math.floor(rampBounds.min),
    max: state.hypsoSliderMaxBound ?? Math.ceil(rampBounds.max)
  }), [state.hypsoSliderMinBound, state.hypsoSliderMaxBound, rampBounds])

  const handleSliderChange = useCallback((values: number[]) => {
    // Ensure min doesn't exceed max
    const [newMin, newMax] = values
    const clampedMin = Math.min(newMin, newMax)
    const clampedMax = Math.max(newMin, newMax)
    setState({ minElevation: clampedMin, maxElevation: clampedMax, customHypsoMinMax: true })
  }, [setState])

  // SET ELEVATION
  const getLoadedTilesElevationRange = useCallback(() => {
    if (!mapRef.current) return null;
    
    const mapInstance = mapRef.current.getMap();
    const terrain = (mapInstance as any).painter?.renderToTexture?.terrain;
    
    if (!terrain) return null;
    
    const style = (mapInstance as any).style;
    const tileManager = style?.tileManagers?.[terrain.options.source];
    
    if (!tileManager) return null;
    
    // Get current zoom level
    const currentZoom = Math.floor(mapInstance.getZoom());
    
    // Use _inViewTiles to get only viewport tiles
    const inViewTiles = tileManager._inViewTiles;
    const tileIds = inViewTiles.getAllIds(); // This gets only in-view tiles
    
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    
    for (const tileId of tileIds) {
      const tile = inViewTiles.getTileById(tileId);
      
      // Filter: only tiles at current zoom or one level below
      if (tile?.dem && 
          tile.tileID.overscaledZ >= currentZoom - 1 && 
          tile.tileID.overscaledZ <= currentZoom) {
        min = Math.min(min, tile.dem.min * terrain.exaggeration);
        max = Math.max(max, tile.dem.max * terrain.exaggeration);
        count++;
      }
    }
    
    return count > 0 ? { min, max, tilesCount: count } : null;
  }, [mapRef]);

  const setElevFromLoadedTiles = useCallback( 
    () => {
      const elevationRange = getLoadedTilesElevationRange()
      console.log({elevationRange})
      // alert(elevationRange ? `Loaded tiles elevation range: ${elevationRange.min.toFixed(2)} to ${elevationRange.max.toFixed(2)} (based on ${elevationRange.tilesCount} tiles)` : "No terrain tiles loaded or elevation data unavailable.")
      const minElevation = elevationRange?.min || state.minElevation
      const maxElevation = elevationRange?.max || state.maxElevation
      const factor = 0.2
      const hypsoSliderMinBound = Math.floor(minElevation - (maxElevation - minElevation) * factor)
      const hypsoSliderMaxBound = Math.ceil(maxElevation + (maxElevation - minElevation) * factor) 
      setState({
        customHypsoMinMax: true,
        minElevation,
        maxElevation,
        hypsoSliderMinBound,
        hypsoSliderMaxBound,
      })
    } , 
    [mapRef, state.minElevation, state.maxElevation]
  )

  // All hooks (useRef, useEffect, useCallback, useMemo, useAtom etc) must be above that early return statement
  if (!state.showColorRelief) return null

  return (
    <Section title="Hypsometric Tint Options" isOpen={isOpen} onOpenChange={onOpenChange}>
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
          </div>        <Tabs
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
                setState({
                  colorRamp: first.toLowerCase(),
                  hypsoSliderMinBound: undefined,
                  hypsoSliderMaxBound: undefined
                })
              }
              // }
            }
          }}
          className="w-full"
        >
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="classic">Classic</TabsTrigger>
            <TabsTrigger value="topo">Topo</TabsTrigger>
            <TabsTrigger value="topobath">TopoBath</TabsTrigger>
            <TabsTrigger value="temp">Temp</TabsTrigger>
            <TabsTrigger value="topqgs">Top Qgs</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select value={state.colorRamp} onValueChange={(value) => setState({
              colorRamp: value,
              hypsoSliderMinBound: undefined,
              hypsoSliderMaxBound: undefined
            })}>
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
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">License Type</Label>
            <Select value={licenseFilter} onValueChange={(value) => {
              if (value) {
                setLicenseFilter(value)
                const filteredNow = filterColorRamps(colorRamps, colorRampType, value)
                if (!filteredNow[state.colorRamp]) {
                  const first = Object.values(filteredNow)[0].name
                  setState({
                    colorRamp: first.toLowerCase(),
                    hypsoSliderMinBound: undefined,
                    hypsoSliderMaxBound: undefined
                  })
                }
              }
            }}>
              <SelectTrigger className="h-8 w-[210px] cursor-pointer text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open-license-only">Open License Only</SelectItem>
                <SelectItem value="distribute-ok">Qgis-Distribute=Yes Only</SelectItem>
                <SelectItem value="open-distribute">Open License & Distribute Yes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>



        <div className="space-y-2">
          <div className="w-full gap-1 flex items-center">
            <div className="flex-[2] flex items-center">
              <div className="flex items-center justify-between py-0.5 w-full">
                <Checkbox id="hypso-min-max" checked={state.customHypsoMinMax} onCheckedChange={(checked) => setState({ customHypsoMinMax: checked === true })} />
                <div className="flex items-center flex-1 ml-2 gap-1">
                  
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label htmlFor="hypso-min-max" className="text-sm font-medium cursor-pointer">Min/Max</Label>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Set custom bounds/elevation range for hypsometric tinting</p>
                      </TooltipContent>
                    </Tooltip>

                    <TooltipIconButton
                      icon={RotateCcw}
                      tooltip="Reset Elevation Bounds to Color-ramp default min/max"
                      onClick={resetminElevationMax}
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 cursor-pointer"
                    />
                    <TooltipIconButton
                      icon={MountainSnow}
                      tooltip="Auto set elevation range from terrain tiles loaded in viewport"
                      onClick={setElevFromLoadedTiles}
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 cursor-pointer"
                    />
                  </TooltipProvider>
                </div>
              </div>
            </div>
            <div className="flex-1 flex items-center">
              <Input
                type="number"
                step="any"
                placeholder="Min"
                className="h-8 py-1 text-sm"
                value={state.minElevation ?? ""}
                onChange={(e) => setState({ minElevation: e.target.value === "" ? undefined : parseFloat(e.target.value), customHypsoMinMax: true })}
              />
            </div>
            <div className="flex-1 flex items-center">
              <Input
                type="number"
                step="any"
                placeholder="Max"
                className="h-8 py-1 text-sm"
                value={state.maxElevation ?? ""}
                onChange={(e) => setState({ maxElevation: e.target.value === "" ? undefined : parseFloat(e.target.value), customHypsoMinMax: true })}
              />
            </div>
          </div>

          {/* <div className="px-2">
            <Slider
              min={sliderBounds.min}
              max={sliderBounds.max}
              step={1}
              value={sliderValues}
              onValueChange={handleSliderChange}
              className="w-full"
            /> */}
          <HypsoDoubleRangeSlider
            sliderBounds={sliderBounds}
            sliderValues={sliderValues}
            handleSliderChange={handleSliderChange}
            state={state}
            setState={setState}
          />

        </div>
      </div>
    </Section>
  )
}


const HypsoDoubleRangeSlider: React.FC<{
  sliderBounds: { min: number; max: number };
  sliderValues: number[];
  handleSliderChange: (values: number[]) => void;
  state: any;
  setState: (updates: any) => void;
}> = ({ sliderBounds, sliderValues, handleSliderChange, state, setState }) => {
  const [activeSlider] = useAtom(activeSliderAtom)
  const sectionId = useContext(SectionIdContext)
  const hypsoSliderId = `${sectionId}:hypso-range`
  const isHypsoDimmed = activeSlider !== null && activeSlider !== hypsoSliderId

  return (
    <div className={cn("px-2 transition-opacity duration-150", isHypsoDimmed && "opacity-20")}>
      <MobileSlider
        sliderId={hypsoSliderId}
        min={sliderBounds.min}
        max={sliderBounds.max}
        step={1}
        value={sliderValues}
        onValueChange={handleSliderChange}
        className="w-full"
      />
      <div className="flex items-center justify-between gap-2 mt-1">
        {/* ... same input fields for min/max bounds ... */}
      </div>
    </div>
  )
}