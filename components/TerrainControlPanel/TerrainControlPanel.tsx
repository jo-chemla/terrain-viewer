import type React from "react"
import { useState, useMemo, useCallback, useEffect, useRef  } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { PanelRightOpen, PanelRightClose, ChevronsDownUp, ChevronsUpDown, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { transparentUiAtom, activeSliderAtom, activeProjectConfigAtom } from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"

import { useSourceConfig, useTheme, type Bounds } from "@/lib/controls-utils"
import { SettingsDialog } from "./settings-dialog"
import { GeneralSettings } from "./general-settings"
import { TerrainSourceSection } from "./terrain-source-section"
import { DownloadSection } from "./download-section"
import { VisualizationModesSection } from "./visualization-modes-section"
import { HillshadeOptionsSection } from "./hillshade-options-section"
import { HypsometricTintOptionsSection } from "./hypsometric-tint-options-section"
import { SlopeAndMoreOptionsSection } from "./slope-and-more-section"
import { RasterBasemapSection } from "./raster-basemap-section"
import { ContourOptionsSection } from "./contour-options-section"
import { TellsOptionsSection } from "./tells-options-section"
import { BackgroundOptionsSection } from "./background-options-section"
import { FooterSection } from "./footer-section"
import { TooltipIconButton } from "./controls-components"

import { useTerraDraw, TerraDrawSection } from "./TerraDrawSystem"
import {AnimationSection} from "./CameraUtilities"
import { ElevationPickerSection } from "./ElevationPickerSection"
import { useIsMobile } from '@/hooks/use-mobile'
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
  "slopeAndMore",
  "rasterBasemap",
  "contour",
  "tells",
  "background",
  "drawing",
  "elevationPicker",
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
  slopeAndMore: false,
  rasterBasemap: false,
  contour: false,
  tells: false,
  background: false,
  drawing: false,
  elevationPicker: false,
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
}

export function TerrainControlPanel({
  state,
  setState,
  getMapBounds,
  mapRef,
  mapLoaded,
}: TerrainControlPanelProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { getTilesUrl, getSourceConfig } = useSourceConfig()
  const { theme } = useTheme()

  // AnimationSection's "complete" mode interpolates numeric leaves of this app state;
  // shallow defaults true so per-frame animation writes don't spam browser history —
  // callers (e.g. manual scrub) can pass shallow=false to make a value shareable.
  const setAppState = useCallback((updates: Record<string, unknown>, shallow = true) => {
    setState(updates, { shallow })
  }, [setState])
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
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const hideSourcePanels = activeProjectConfig?.hideSourcePanels ?? false
  const hiddenSections = activeProjectConfig?.hiddenSections ?? []

  const allFolded = SECTION_KEYS.every((k) => !sectionOpen[k])

  const handleFoldExpandAll = () => {
    const next = allFolded
    setSectionOpen(Object.fromEntries(SECTION_KEYS.map((k) => [k, next])) as SectionOpenState)
  }

  // With a project active, clears every other URL param back to default, then
  // re-applies that project's own initialState/initialViewMode on top — `project`
  // stays sticky so there's always somewhere to "go home" to (see
  // lib/project-config.ts). Re-applying is needed because nulling alone would only
  // restore the app's generic hardcoded defaults, not the project's curated view;
  // the original implementation got this "for free" via a full page reload (which
  // re-ran the once-only embed-config effect from scratch), but a plain reset
  // still needs it done explicitly. Without a project, a bare reset would fall
  // back to the hardcoded Mont Blanc default view, which isn't "home" in any
  // meaningful sense — so zoom out to the whole world instead.
  //
  // Camera fields (lat/lng/zoom/pitch/bearing) are excluded from the setState
  // batch and commanded on the map directly instead: react-map-gl's
  // `initialViewState` (see TerrainViewer.tsx) only seeds the camera once on
  // mount and is otherwise uncontrolled — only the map's own onMoveEnd writes
  // those fields back into the URL. A setState alone would just get silently
  // overwritten by the next moveend firing with the (unchanged) current camera.
  const CAMERA_KEYS = ["lat", "lng", "zoom", "pitch", "bearing"] as const
  const handleGoHome = () => {
    const resets: Record<string, unknown> = {}
    for (const key of Object.keys(state)) {
      if (key === "project") continue
      resets[key] = null
    }
    if (activeProjectConfig) {
      Object.assign(resets, activeProjectConfig.initialState)
      if (activeProjectConfig.initialViewMode) resets.viewMode = activeProjectConfig.initialViewMode
    }
    const camera = {
      lat: (activeProjectConfig?.initialState?.lat as number | undefined) ?? 20,
      lng: (activeProjectConfig?.initialState?.lng as number | undefined) ?? 0,
      zoom: (activeProjectConfig?.initialState?.zoom as number | undefined) ?? 1,
      pitch: (activeProjectConfig?.initialState?.pitch as number | undefined) ?? 0,
      bearing: (activeProjectConfig?.initialState?.bearing as number | undefined) ?? 0,
    }
    for (const key of CAMERA_KEYS) delete resets[key]
    setState(resets)
    mapRef.current?.getMap()?.jumpTo({
      center: [camera.lng, camera.lat],
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    })
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
          // Reserves the scrollbar's width up front so it doesn't appear/disappear
          // as content grows past the fold, which used to shift the sticky header's
          // right-aligned buttons left by the scrollbar's width when it popped in.
          scrollbarGutter: 'stable',
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
          <h2 className="text-xl font-semibold">{activeProjectConfig?.name || "Terrain Viewer"}</h2>
          <div className="flex gap-1 items-center">
            <TooltipIconButton
              icon={allFolded ? ChevronsUpDown : ChevronsDownUp}
              tooltip={allFolded ? "Expand all sections" : "Fold all sections"}
              onClick={handleFoldExpandAll}
            />
            <TooltipIconButton
              icon={Home}
              tooltip="Home"
              onClick={handleGoHome}
            />
            <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} state={state} setState={setState}/>
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
        {!hideSourcePanels && (
          <TerrainSourceSection state={state} setState={setState} getTilesUrl={getTilesUrl} getMapBounds={getMapBounds} mapRef={mapRef} isOpen={sectionOpen.terrainSource} onOpenChange={toggle("terrainSource")} />
        )}
        {!hideSourcePanels && (
          <RasterBasemapSection state={state} setState={setState} mapRef={mapRef} isOpen={sectionOpen.rasterBasemap} onOpenChange={toggle("rasterBasemap")} />
        )}
        {!hiddenSections.includes("contour") && (
          <ContourOptionsSection state={state} setState={setState} isOpen={sectionOpen.contour} onOpenChange={toggle("contour")} mapRef={mapRef} />
        )}
        <TellsOptionsSection state={state} setState={setState} isOpen={sectionOpen.tells} onOpenChange={toggle("tells")} />
        <HillshadeOptionsSection state={state} setState={setState} isOpen={sectionOpen.hillshade} onOpenChange={toggle("hillshade")} />
        <HypsometricTintOptionsSection state={state} setState={setState} isOpen={sectionOpen.hypsometricTint} onOpenChange={toggle("hypsometricTint")} mapRef={mapRef} />
        {!hiddenSections.includes("slopeAndMore") && (
          <SlopeAndMoreOptionsSection
            state={state}
            setState={setState}
            isOpen={sectionOpen.slopeAndMore}
            onOpenChange={toggle("slopeAndMore")}
            terrainTileSize={getSourceConfig(state.sourceA)?.tileSize ?? 256}
          />
        )}
        <BackgroundOptionsSection state={state} setState={setState} theme={theme as any} isOpen={sectionOpen.background} onOpenChange={toggle("background")} />
        <TerraDrawSection draw={draw} mapRef={mapRef} isOpen={sectionOpen.drawing} onOpenChange={toggle("drawing")} />
        {!hiddenSections.includes("elevationPicker") && (
          <ElevationPickerSection state={state} mapRef={mapRef} draw={draw} isOpen={sectionOpen.elevationPicker} onOpenChange={toggle("elevationPicker")} />
        )}
        <AnimationSection
          mapRef={mapRef}
          isOpen={sectionOpen.animation}
          onOpenChange={toggle("animation")}
          appState={state}
          setAppState={setAppState}
          setAppStateSafe={setAppState}
        />
        <FooterSection />
      </Card>
      </div>
    </TooltipProvider>
  )
}