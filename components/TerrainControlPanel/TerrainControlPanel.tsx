import type React from "react"
import { useState, useMemo, useCallback, useEffect, useRef  } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { PanelRightOpen, PanelRightClose, ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { themeAtom, transparentUiAtom, activeSliderAtom } from "@/lib/settings-atoms"
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
import {AnimationSection} from "./CameraUtilities"
import { useIsMobile } from '@/hooks/use-mobile'
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
  "animation"
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
  animation: false,
}

export const sectionOpenAtom = atomWithStorage<SectionOpenState>("sectionOpen", DEFAULT_OPEN_STATE)
export const sidebarScrollAtom = atomWithStorage("sidebarScroll", 0)

interface TerrainControlPanelProps {
  state: any
  setState: (updates: any) => void
  getMapBounds: () => Bounds
  mapRef: React.RefObject<MapRef>
  mapLoaded: boolean
  animState: AnimState
  // setAnimState: (s: AnimState) => void
  setAnimState?: React.Dispatch<React.SetStateAction<AnimState>>
}

export function TerrainControlPanel({
  state,
  setState,
  getMapBounds,
  mapRef,
  mapLoaded,
  animState,
  setAnimState,
}: TerrainControlPanelProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { getTilesUrl, getSourceConfig } = useSourceConfig()
  const [theme] = useAtom(themeAtom)
  const { draw } = useTerraDraw(mapRef, mapLoaded)
  const isMobile = useIsMobile()
  const [activeSlider] = useAtom(activeSliderAtom)
  const [transparentUi, setTransparentUi] = useAtom(transparentUiAtom)

  // Add scroll position management
  const [scrollPosition, setScrollPosition] = useAtom(sidebarScrollAtom)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Restore scroll position when sidebar opens
  useEffect(() => {
    if (isSidebarOpen && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollPosition
    }
  }, [isSidebarOpen, scrollPosition])
  // Save scroll position on scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop
    setScrollPosition(scrollTop)
  }, [setScrollPosition])


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

  // Handle dynamic viewport height for mobile browsers
  useEffect(() => {
    if (!isMobile) return

    const setVH = () => {
      const vh = window.innerHeight * 0.01
      document.documentElement.style.setProperty('--vh', `${vh}px`)
    }

    setVH()
    window.addEventListener('resize', setVH)
    window.addEventListener('orientationchange', setVH)

    return () => {
      window.removeEventListener('resize', setVH)
      window.removeEventListener('orientationchange', setVH)
    }
  }, [isMobile])

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

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      {/* Mobile backdrop — tap outside to close */}
      {isMobile && isSidebarOpen &&  (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onPointerDown={() => setIsSidebarOpen(false)}
        />
      )}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={cn(
          "absolute z-50 overflow-y-auto",
          "right-0 top-0 bottom-0 w-80 rounded-none",
          "sm:right-4 sm:top-4 sm:bottom-4 sm:w-96 sm:rounded-xl",
        )}
        style={{ 
          height: isMobile ? 'calc(var(--vh, 1vh) * 100)' : undefined
        }}
      >
        <Card 
          className={cn(
            "p-4 pt-0 gap-2 space-y-2 backdrop-blur-[2px] text-base min-h-full",
            "w-full rounded-none",
            "sm:rounded-xl",
            transparentUi && activeSlider
              ? "bg-background/20"
              : "bg-background/95",
            "transition-[background-color] duration-150"
          )}
        >

        {/* Sticky header row */}
        <div className={cn(
          "sticky top-0 z-10 flex items-center justify-between -mx-4 px-4 -mt-4 pt-4 pb-3 border-b backdrop-blur-[2px] mb-6",
          transparentUi && activeSlider ? "bg-background/20" : "bg-background/95"
        )}>
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
        <TerraDrawSection draw={draw} mapRef={mapRef} isOpen={sectionOpen.drawing} onOpenChange={toggle("drawing")} state={state} setState={setState} setIsSidebarOpen={setIsSidebarOpen} animState={animState} setAnimState={setAnimState} />
        <AnimationSection mapRef={mapRef} isOpen={sectionOpen.animation} onOpenChange={toggle("animation")} state={state} setState={setState} setIsSidebarOpen={setIsSidebarOpen} animState={animState} setAnimState={setAnimState} />
        <FooterSection />
      </Card>
      </div>
    </TooltipProvider>
  )
}