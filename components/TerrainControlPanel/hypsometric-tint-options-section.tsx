import type React from "react"
import { useMemo, useCallback, useRef, useContext, useState } from "react"
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
import { Section, TooltipIconButton, MobileSlider, SectionIdContext, DraftBoundInput, clampMinCommit, clampMaxCommit } from "./controls-components"
import { cn } from "@/lib/utils"
import { getGradientColors } from "@/lib/controls-utils"
import { useEffect } from "react"
import type { MapRef } from "react-map-gl/maplibre"

function computeStep(min: number, max: number) {
  // return the magnitude order of the range divided by 100 (to get ~100 steps across the whole range), rounded down to the nearest power of 10
  const range = max - min;
  const rawStep = range / 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  return magnitude;
}

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

  // Reset slider bounds when color ramp changes, so the slider track always starts
  // out matching the newly-selected ramp's own min/max. This used to be keyed on
  // [state.colorRamp, setState], but nuqs's setState reference isn't stable across
  // renders, so the effect actually re-ran on every render (verified: it fired dozens
  // of times on a single idle page load) and kept silently overwriting any
  // just-committed hypsoSliderMinBound/MaxBound back to the ramp default — e.g. typing
  // a custom min bound and blurring would revert a moment later. Gate on a ref holding
  // the previous colorRamp so the body only actually runs on a genuine ramp change,
  // not on every unrelated re-render.
  const prevColorRampRef = useRef(state.colorRamp)
  useEffect(() => {
    if (prevColorRampRef.current === state.colorRamp) return
    prevColorRampRef.current = state.colorRamp
    const stops = extractStops(colorRampsFlat[state.colorRamp].colors)
    setState({
      hypsoSliderMinBound: Math.floor(Math.min(...stops)),
      hypsoSliderMaxBound: Math.ceil(Math.max(...stops)),
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

  function filterColorRamps(colorRamps_: any, colorRampType_: string, licenseFilter_: string): Record<string, any> {
    const ramps = colorRamps_[colorRampType_] || {}
    // classic is hand-curated by this app rather than pulled from an external archive, so it
    // doesn't carry per-ramp license/distribute metadata — skip the license filter for it.
    if (colorRampType_ == 'classic') { return ramps }
    const rampsArray = Object.values(ramps)

    if (licenseFilter_ === 'all') {
      return ramps
    }

    const filteredEntries = rampsArray.filter((ramp: any) => {
      if (licenseFilter_ === 'open-license-only') {
        return ['gpl', 'gplv2', 'gpl3', 'cc3', 'cc4', 'ccnc'].includes(ramp.license)
      } else if (licenseFilter_ === 'distribute-ok') {
        return ramp.distribute === 'yes'
      } else if (licenseFilter_ === 'open-distribute') {
        return ['gpl', 'gplv2', 'gpl3', 'cc3', 'cc4', 'ccnc'].includes(ramp.license) || ramp.distribute === 'yes'
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
    // hypsoSliderMinBound/MaxBound reset themselves via the colorRamp-change effect above.
    setState({ colorRamp: colorRampKeys[newIndex] })
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
    const tileManager = style?.tileManagers?.[terrain.options?.source];

    if (!tileManager) return null;

    // Get current zoom level
    const currentZoom = Math.floor(mapInstance.getZoom());

    // Use _inViewTiles to get only viewport tiles. This is an internal maplibre
    // field that isn't always populated yet (e.g. right after a source switch,
    // slower terrain load on mobile) — bail out rather than crashing.
    const inViewTiles = tileManager._inViewTiles;
    if (!inViewTiles) return null;
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
    <Section title="Elevation Color (Hypsometric)" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-2">

        {/* Colorramp Labels */}
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Color Ramp</Label>
          <TooltipProvider>
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://colorcet.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>CET</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Peter Kovesi&apos;s perceptually-uniform CET colormaps</p>
                </TooltipContent>
              </Tooltip>
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
            </div>
          </TooltipProvider>
        </div>
          
        {/* Tabs for colorramp type */}
        <Tabs
          value={colorRampType}
          onValueChange={(value) => {
            if (value) {
              isUserActionRef.current = true
              setColorRampType(value)
              const filteredNow = filterColorRamps(colorRamps, value, licenseFilter)
              // Always switch to first ramp in the new category
              // if (!filteredNow[state.colorRamp]) {
              const first = Object.values(filteredNow)[0].name
              // hypsoSliderMinBound/MaxBound reset themselves via the colorRamp-change effect above.
              if (first) setState({ colorRamp: first.toLowerCase() })
              // }
            }
          }}
          className="w-full"
        >
          {/* grid-cols-N hard-codes N equal-width columns, which breaks as soon as a category
              gets added (labels start clipping/wrapping) — a horizontally-scrollable flex row
              scales to any number of categories instead. */}
          <TabsList className="flex h-12 w-full overflow-x-auto justify-start gap-1 [&>*]:shrink-0">
            <TabsTrigger value="classic" className="cursor-pointer">Classic</TabsTrigger>
            <TabsTrigger value="topqgs" className="cursor-pointer">Top Qgs</TabsTrigger>
            <TabsTrigger value="topo" className="cursor-pointer">Topo</TabsTrigger>
            <TabsTrigger value="cet" className="cursor-pointer">CET</TabsTrigger>
            <TabsTrigger value="sdr" className="cursor-pointer">SDR</TabsTrigger>
            <TabsTrigger value="temp" className="cursor-pointer">Temp</TabsTrigger>
            <TabsTrigger value="topobath" className="cursor-pointer">TopoBath</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select value={state.colorRamp} onValueChange={(value) => setState({ colorRamp: value })}>
              <SelectTrigger className="flex-1 min-w-0 w-full cursor-pointer">
                <SelectValue className="min-w-0 truncate" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(filteredColorRamps).map(([key, ramp]: [string, any]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-12 h-4 rounded-sm shrink-0"
                        style={{ background: `linear-gradient(to right, ${getGradientColors(ramp.colors)})` }}
                      />
                      <span className="truncate">
                        {!ramp.continuous ? ' (D) ' : ' (C) '}
                        {ramp.name}
                      </span>
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
                  // hypsoSliderMinBound/MaxBound reset themselves via the colorRamp-change effect above.
                  setState({ colorRamp: first.toLowerCase() })
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

        {/* Custom min/max elevation */}
        <div className="space-y-2">
          <div className="w-full gap-1 flex items-center">
            <div className="flex-[2] flex items-center">
              <div className="flex items-center justify-between py-0.5 w-full">
                <Checkbox 
                  id="hypso-min-max" 
                  checked={state.customHypsoMinMax} 
                  onCheckedChange={(checked) => setState({ customHypsoMinMax: checked === true })}
                  className="cursor-pointer" 
                />
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
              <DraftBoundInput
                value={state.minElevation}
                onCommit={(v) => setState({ minElevation: clampMinCommit(v, state.maxElevation), customHypsoMinMax: true })}
                placeholder="Min"
                className="h-8 py-1 px-2 text-sm w-full min-w-0 rounded-md border border-input bg-transparent shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </div>
            <div className="flex-1 flex items-center">
              <DraftBoundInput
                value={state.maxElevation}
                onCommit={(v) => setState({ maxElevation: clampMaxCommit(v, state.minElevation), customHypsoMinMax: true })}
                placeholder="Max"
                className="h-8 py-1 px-2 text-sm w-full min-w-0 rounded-md border border-input bg-transparent shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </div>
          </div>

          <HypsoDoubleRangeSlider
            sliderBounds={sliderBounds}
            sliderValues={sliderValues}
            handleSliderChange={handleSliderChange}
            state={state}
            setState={setState}
          />

        </div>
        
        {/* Invert Color Ramp */}
        {state.customHypsoMinMax && 
          <div className="flex items-center gap-2">
            <Checkbox 
              id="invert-color-ramp" 
              checked={state.invertColorRamp || false} 
              onCheckedChange={(checked) => setState({ invertColorRamp: checked === true })} 
              className="cursor-pointer"
            />
            <Label htmlFor="invert-color-ramp" className="text-sm font-medium cursor-pointer">
              Invert Color Ramp
            </Label>
          </div>
        }

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
        // step={1}
        step={computeStep(state.hypsoSliderMinBound, state.hypsoSliderMaxBound)}
        value={sliderValues}
        onValueChange={handleSliderChange}
        className="w-full cursor-pointer"
      />
        <div className="flex items-center justify-between gap-2 mt-1">
          <DraftBoundInput
            value={state.hypsoSliderMinBound}
            onCommit={(v) => setState({ hypsoSliderMinBound: v })}
            placeholder="Min"
            className="h-6 py-1 px-0 text-xs text-muted-foreground bg-transparent border-0 outline-none focus:outline-none text-left w-16"
          />
          <DraftBoundInput
            value={state.hypsoSliderMaxBound}
            onCommit={(v) => setState({ hypsoSliderMaxBound: v })}
            placeholder="Max"
            className="h-6 py-1 px-0 text-xs text-muted-foreground bg-transparent border-0 outline-none focus:outline-none text-right w-16"
          />
        </div>
    </div>
  )
}