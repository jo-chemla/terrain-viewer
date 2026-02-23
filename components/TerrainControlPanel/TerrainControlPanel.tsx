import type React from "react"
import { useState, useMemo, useCallback  } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { PanelRightOpen, PanelRightClose, ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { themeAtom } from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"

import { useSourceConfig, type Bounds } from "@/lib/controls-utils"
import { SettingsDialog } from "./settings-dialog"
import { GeneralSettings } from "./general-settings"
import { TerrainSourceSection } from "./terrain-source-section"
import { DownloadSection } from "./download-section"
import { VisualizationModesSection } from "./visualization-modes-section"
import { HillshadeOptionsSection } from "./hillshade-options-section"
import { HypsometricTintOptionsSection } from "./hypsometric-tint-options-section"
import { RasterBasemapSection } from "./raster-basemap-section"
import { ContourOptionsSection } from "./contour-options-section"
import { BackgroundOptionsSection } from "./background-options-section"
import { FooterSection } from "./footer-section"
import { TooltipIconButton } from "./controls-components"

import { useTerraDraw, TerraDrawSection } from "./TerraDrawSystem"
import { useIsMobile, activeSliderAtom } from "./controls-components"
import type { AnimState } from "./CameraUtilities"
import { cn } from "@/lib/utils"

// --- Persisted state ---
export const isSidebarOpenAtom = atomWithStorage("isSidebarOpen", true)

const SECTION_KEYS = [
  "general",
  "terrainSource",
  "download",
  "visualizationModes",
  "hillshade",
  "hypsometricTint",
  "rasterBasemap",
  "contour",
  "background",
  "drawing",
] as const

type SectionKey = (typeof SECTION_KEYS)[number]
type SectionOpenState = Record<SectionKey, boolean>

const DEFAULT_OPEN_STATE: SectionOpenState = {
  general: true,
  visualizationModes: true,
  download: false,
  terrainSource: false,
  hillshade: false,
  hypsometricTint: false,
  rasterBasemap: false,
  contour: false,
  background: false,
  drawing: false,
}

export const sectionOpenAtom = atomWithStorage<SectionOpenState>("sectionOpen", DEFAULT_OPEN_STATE)

interface TerrainControlPanelProps {
  state: any
  setState: (updates: any) => void
  getMapBounds: () => Bounds
  mapRef: React.RefObject<MapRef>
  mapsLoaded: boolean
  animState: AnimState
  setAnimState: (s: AnimState) => void
}

export function TerrainControlPanel({
  state,
  setState,
  getMapBounds,
  mapRef,
  mapsLoaded,
  animState,
  setAnimState,
}: TerrainControlPanelProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { getTilesUrl, getSourceConfig } = useSourceConfig()
  const [theme] = useAtom(themeAtom)
  const { draw } = useTerraDraw(mapRef, mapsLoaded)
  const isMobile = useIsMobile()
  const [activeSlider] = useAtom(activeSliderAtom)


  const [sectionOpen, setSectionOpen] = useAtom(sectionOpenAtom)

  const allFolded = SECTION_KEYS.every((k) => !sectionOpen[k])

  const handleFoldExpandAll = () => {
    const next = allFolded
    setSectionOpen(Object.fromEntries(SECTION_KEYS.map((k) => [k, next])) as SectionOpenState)
  }

  const toggle = (key: SectionKey) => (open: boolean) =>
    setSectionOpen((prev) => ({ ...prev, [key]: open }))

  useMemo(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  if (!isSidebarOpen) {
    return (
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" size="icon" className="absolute right-4 top-4 cursor-pointer" onClick={() => setIsSidebarOpen(true)}>
              <PanelRightOpen className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Open sidebar</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  // const [activeSlider, setActiveSlider] = useState<string | null>(null)


  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      {/* Mobile backdrop — tap outside to close */}
      {isMobile && isSidebarOpen &&  (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* <Card className="absolute right-4 top-4 bottom-4 w-96 overflow-y-auto p-4 gap-2 space-y-2 bg-background/95 backdrop-blur text-base"> */}
       {/* <Card className={cn(
         "absolute z-50 overflow-y-auto p-4 gap-2 space-y-2 backdrop-blur text-base",
         "right-0 top-0 bottom-0 w-80 rounded-none",
         "sm:right-4 sm:top-4 sm:bottom-4 sm:w-96 sm:rounded-xl",
        "bg-background/95 transition-[background-color] duration-150"
       )}> */}
        <Card className={cn(
        //  "absolute z-50 overflow-y-auto p-4 gap-2 space-y-2 backdrop-blur-sm backdrop-blur-[2px] text-base",
  "absolute z-50 overflow-y-auto p-4 gap-2 space-y-2 backdrop-blur-[2px] text-base",
         "right-0 top-0 bottom-0 w-80 rounded-none",
         "sm:right-4 sm:top-4 sm:bottom-4 sm:w-96 sm:rounded-xl",
        isMobile && activeSlider
          ? "bg-background/20"
          : "bg-background/95",
        "transition-[background-color] duration-150"
       )}>

        {/* Invisible per-slider overlay restorer — individual sliders set opacity-100 on their wrapper */}

        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Terrain Viewer</h2>
          <div className="flex gap-1 items-center">
            <TooltipIconButton
              icon={allFolded ? ChevronsUpDown : ChevronsDownUp}
              tooltip={allFolded ? "Expand all sections" : "Fold all sections"}
              onClick={handleFoldExpandAll}
            />
            <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
            <TooltipIconButton
              icon={PanelRightClose}
              tooltip="Close sidebar"
              onClick={() => setIsSidebarOpen(false)}
            />
          </div>
        </div>

        <GeneralSettings state={state} setState={setState} isOpen={sectionOpen.general} onOpenChange={toggle("general")} />
        <VisualizationModesSection state={state} setState={setState} isOpen={sectionOpen.visualizationModes} onOpenChange={toggle("visualizationModes")} />
        <DownloadSection state={state} getMapBounds={getMapBounds} getSourceConfig={getSourceConfig} mapRef={mapRef} isOpen={sectionOpen.download} onOpenChange={toggle("download")} />
        <TerrainSourceSection state={state} setState={setState} getTilesUrl={getTilesUrl} getMapBounds={getMapBounds} mapRef={mapRef} isOpen={sectionOpen.terrainSource} onOpenChange={toggle("terrainSource")} />
        <ContourOptionsSection state={state} setState={setState} isOpen={sectionOpen.contour} onOpenChange={toggle("contour")} />
        <HillshadeOptionsSection state={state} setState={setState} isOpen={sectionOpen.hillshade} onOpenChange={toggle("hillshade")} />
        <HypsometricTintOptionsSection state={state} setState={setState} isOpen={sectionOpen.hypsometricTint} onOpenChange={toggle("hypsometricTint")} mapRef={mapRef} />
        <RasterBasemapSection state={state} setState={setState} mapRef={mapRef} isOpen={sectionOpen.rasterBasemap} onOpenChange={toggle("rasterBasemap")} />
        <BackgroundOptionsSection state={state} setState={setState} theme={theme as any} isOpen={sectionOpen.background} onOpenChange={toggle("background")} />
        <TerraDrawSection draw={draw} mapRef={mapRef} isOpen={sectionOpen.drawing} onOpenChange={toggle("drawing")} state={state} setState={setState} setIsSidebarOpen={setIsSidebarOpen}        animState={animState} setAnimState={setAnimState} />
        <FooterSection />
      </Card>
    </TooltipProvider>
  )
}
