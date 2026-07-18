import type React from "react"
import { useState, useMemo, useCallback, useEffect, useRef  } from "react"
import { useQueryStates } from "nuqs"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { PanelRightOpen, PanelRightClose, ChevronsDownUp, ChevronsUpDown, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { transparentUiAtom, activeSliderAtom, activeProjectConfigAtom, vizModePinnedAtom } from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"

import { useSourceConfig, useTheme, type Bounds } from "@/lib/controls-utils"
import { SettingsDialog } from "./settings-dialog"
import { GeneralSettings } from "./general-settings"
import { TerrainSourceSection } from "./terrain-source-section"
import { DownloadSection } from "./download-section"
import { VisualizationModesSection } from "./visualization-modes-section"
import { HillshadeOptionsSection } from "./hillshade-options-section"
import { HypsometricTintOptionsSection } from "./hypsometric-tint-options-section"
import { TerrainAnalysisOptionsSection } from "./terrain-analysis-section"
import { ReliefVisualizationOptionsSection } from "./relief-visualization-section"
import { DetectorMoundsSection } from "./detector-mounds-section"
import { RasterBasemapSection } from "./raster-basemap-section"
import { ContourOptionsSection } from "./contour-options-section"
import { BackgroundOptionsSection } from "./background-options-section"
import { FooterSection } from "./footer-section"
import { TooltipIconButton, MacroSeparator } from "./controls-components"

import { useTerraDraw, TerraDrawSection } from "./TerraDrawSystem"
import {AnimationSection, parseAsSnapshot} from "./CameraUtilities"
import { ElevationPickerSection } from "./ElevationPickerSection"
import { useIsMobile } from '@/hooks/use-mobile'
import { useSpaceToggleContext } from '@/lib/use-space-toggle-context'
import { useShiftTapToggle } from '@/lib/use-shift-tap-toggle'
import { useCtrlTapToggle } from '@/lib/use-ctrl-tap-toggle'
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
  "terrainAnalysis",
  "reliefVisualization",
  "tellsDetector",
  "rasterBasemap",
  "contour",
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
  terrainAnalysis: false,
  reliefVisualization: false,
  tellsDetector: false,
  rasterBasemap: false,
  contour: false,
  background: false,
  drawing: false,
  elevationPicker: false,
  animation: false,
}

export const sectionOpenAtom = atomWithStorage<SectionOpenState>("sectionOpen", DEFAULT_OPEN_STATE)
export const sidebarScrollAtom = atomWithStorage("sidebarScroll", 0)

// Fold state for the labeled macro-group separators (Sources/Options/Detectors/
// Tools) — each one collapses every section rendered between it and the next
// separator. Independent of per-section sectionOpenAtom (folding a group just
// hides its sections; each section's own open/closed state is preserved
// underneath and reappears as-is when the group is expanded again).
const MACRO_GROUP_KEYS = ["Sources", "Options", "Detectors", "Tools"] as const
type MacroGroupKey = (typeof MACRO_GROUP_KEYS)[number]
type MacroGroupOpenState = Record<MacroGroupKey, boolean>
export const macroGroupOpenAtom = atomWithStorage<MacroGroupOpenState>("macroGroupOpen", {
  Sources: true, Options: true, Detectors: true, Tools: true,
})

interface TerrainControlPanelProps {
  state: any
  // Second param mirrors nuqs's own setter signature (the real value always
  // passed in from TerrainViewer.tsx's useQueryStates) — `shallow: false` is
  // how AnimationSection's scrub-complete makes a frame's values shareable.
  setState: (updates: any, options?: { shallow?: boolean }) => void
  getMapBounds: () => Bounds
  mapRef: React.RefObject<MapRef>
}

export function TerrainControlPanel({
  state,
  setState,
  getMapBounds,
  mapRef,
}: TerrainControlPanelProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { getTilesUrl, getSourceConfig } = useSourceConfig()
  const { theme } = useTheme()

  // animPose1Delta/animPose2Delta live in AnimationSection's own useQueryStates
  // (CameraUtilities.tsx), not in the shared `state` bag above — Object.keys(state)
  // in handleGoHome below never touches them. nuqs supports multiple independent
  // useQueryStates hooks targeting the same URL keys (they all stay in sync), so
  // this second declaration is just for Home to be able to null them out too.
  const [, setAnimPoseParams] = useQueryStates({
    animPose1Delta: parseAsSnapshot.withDefault(null as any),
    animPose2Delta: parseAsSnapshot.withDefault(null as any),
  }, { shallow: true })

  // AnimationSection's "complete" mode interpolates numeric leaves of this app state;
  // shallow defaults true so per-frame animation writes don't spam browser history —
  // callers (e.g. manual scrub) can pass shallow=false to make a value shareable.
  const setAppState = useCallback((updates: Record<string, unknown>, shallow = true) => {
    setState(updates, { shallow })
  }, [setState])
  const { draw } = useTerraDraw(mapRef)
  const isMobile = useIsMobile()
  // Space re-toggles the last-clicked viz-mode checkbox even after a map drag
  // steals focus onto the maplibre canvas (wheel-zoom never did) — see the hook.
  useSpaceToggleContext()
  // Tapping either Shift key alone toggles the raster basemap — a quick way
  // to peek at (or hide) satellite/street imagery under whatever terrain
  // visualization is active without reaching for the sidebar. (Alt was tried
  // first but the browser's own Alt-alone menu-bar-focus behavior conflicts
  // with it.)
  useShiftTapToggle(() => setState({ showRasterBasemap: !state.showRasterBasemap }))
  // Tapping either Ctrl key alone hides every overlay visualization mode down
  // to just the plain basemap imagery, and restores every mode's previous
  // on/off state on the next tap — a quick "what's actually under here"
  // toggle, complementary to Shift's "peek at the basemap underneath"
  // (which leaves the other modes running). Saved state lives in a ref, not
  // component state, since it's a one-shot stash/restore rather than
  // something any UI needs to read.
  const savedVizModesRef = useRef<Record<string, unknown> | null>(null)
  useCtrlTapToggle(() => {
    if (savedVizModesRef.current) {
      setState(savedVizModesRef.current)
      savedVizModesRef.current = null
    } else {
      savedVizModesRef.current = {
        showContoursAndGraticules: state.showContoursAndGraticules,
        showHillshade: state.showHillshade,
        showRasterBasemap: state.showRasterBasemap,
        showColorRelief: state.showColorRelief,
        showReliefVisualization: state.showReliefVisualization,
        showTerrainAnalysis: state.showTerrainAnalysis,
        showBackground: state.showBackground,
        tellsStyle: state.tellsStyle,
      }
      setState({
        showContoursAndGraticules: false,
        showHillshade: false,
        showRasterBasemap: true,
        showColorRelief: false,
        showReliefVisualization: false,
        showTerrainAnalysis: false,
        showBackground: false,
        tellsStyle: "hidden",
      })
    }
  })
  const [activeSlider] = useAtom(activeSliderAtom)
  const [transparentUi, setTransparentUi] = useAtom(transparentUiAtom)

  // Add scroll position management
  const [scrollPosition, setScrollPosition] = useAtom(sidebarScrollAtom)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Restore scroll position when the sidebar opens — deliberately depends only
  // on isSidebarOpen, not scrollPosition. handleScroll below updates
  // scrollPosition on every scroll event, so including it here would re-run
  // this effect (and re-assert scrollTop) on every tick of a live scroll —
  // during a fast fling, React's render lags the flurry of native scroll
  // events enough that the value being re-applied is already a tick stale,
  // which fought the browser's own momentum scrolling and showed up as the
  // panel visibly jumping/jittering with no further input.
  useEffect(() => {
    if (isSidebarOpen && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollPosition
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSidebarOpen])

  // Save scroll position on scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop
    setScrollPosition(scrollTop)
  }, [setScrollPosition])


  const [sectionOpen, setSectionOpen] = useAtom(sectionOpenAtom)
  const [macroGroupOpen, setMacroGroupOpen] = useAtom(macroGroupOpenAtom)
  const toggleMacroGroup = (key: MacroGroupKey) => setMacroGroupOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const [vizModePinned] = useAtom(vizModePinnedAtom)
  const hideSourcePanels = activeProjectConfig?.hideSourcePanels ?? false
  const hiddenSections = activeProjectConfig?.hiddenSections ?? []

  // A pinned section (currently just Visualization Modes, via its own pin
  // toggle) is excluded from the "is everything folded" check and left
  // untouched when folding — it only ever closes via its own chevron.
  const isPinned = (k: SectionKey) => k === "visualizationModes" && vizModePinned
  const allFolded = SECTION_KEYS.every((k) => isPinned(k) || !sectionOpen[k])

  const handleFoldExpandAll = () => {
    const next = allFolded
    setSectionOpen((prev) => Object.fromEntries(SECTION_KEYS.map((k) =>
      [k, isPinned(k) && !next ? prev[k] : next]
    )) as SectionOpenState)
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
    setAnimPoseParams({ animPose1Delta: null, animPose2Delta: null })
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
      {/* The header (title + fold-all/home/settings/close buttons) lives OUTSIDE
          the scrolling area entirely now, as its own flex sibling — a real,
          non-scrolling element rather than `sticky`. That's what actually fixes
          the "button group shifts left/right when the scrollbar pops in/out"
          issue: previously the header was `sticky` INSIDE the scrolling div, so
          its own layout width was still computed against that div's content box,
          which shrank/grew a few pixels whenever a real scrollbar appeared. Now
          only the plain content div below the header scrolls, and the header's
          width comes from Card's own (fixed, scrollbar-independent) box.
          Card owns the rounded corners directly (no separate clipping wrapper
          needed) — its scrollbar, produced by the nested content div, sits well
          inside Card's own padding rather than flush against Card's rounded
          edge, so it never has the old "scrollbar squares off the corner"
          problem despite Card itself carrying `overflow-hidden`. */}
      <Card
        className={cn(
          "absolute z-50 overflow-hidden flex flex-col p-0 gap-0 backdrop-blur-[2px] text-base",
          "right-0 top-0 bottom-0 w-80 rounded-none",
          "sm:right-4 sm:top-4 sm:bottom-4 sm:w-96 sm:rounded-xl",
          transparentUi && activeSlider
            ? "bg-background/20"
            : "bg-background/95",
          "transition-[background-color] duration-150"
        )}
        style={{ height: isMobile ? 'calc(var(--vh, 1vh) * 100)' : undefined }}
      >
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3 border-b">
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

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          // min-h-0 is required for a flex child to actually shrink below its
          // content's natural height — without it, overflow-y-auto here would
          // never kick in and this div would just keep growing Card taller.
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-4 space-y-2"
        >
        <GeneralSettings state={state} setState={setState} isOpen={sectionOpen.general} onOpenChange={toggle("general")} />
        <VisualizationModesSection state={state} setState={setState} isOpen={sectionOpen.visualizationModes} onOpenChange={toggle("visualizationModes")} />
        <DownloadSection state={state} getMapBounds={getMapBounds} getSourceConfig={getSourceConfig} mapRef={mapRef} isOpen={sectionOpen.download} onOpenChange={toggle("download")} withSeparator={false} />
        <MacroSeparator label="Sources" isOpen={macroGroupOpen.Sources} onToggle={() => toggleMacroGroup("Sources")} />
        {macroGroupOpen.Sources && (
          <>
            {!hideSourcePanels && (
              <TerrainSourceSection state={state} setState={setState} getTilesUrl={getTilesUrl} getMapBounds={getMapBounds} mapRef={mapRef} isOpen={sectionOpen.terrainSource} onOpenChange={toggle("terrainSource")} />
            )}
            {!hideSourcePanels && (
              <RasterBasemapSection state={state} setState={setState} mapRef={mapRef} isOpen={sectionOpen.rasterBasemap} onOpenChange={toggle("rasterBasemap")} withSeparator={false} />
            )}
          </>
        )}
        <MacroSeparator label="Options" isOpen={macroGroupOpen.Options} onToggle={() => toggleMacroGroup("Options")} />
        {macroGroupOpen.Options && (
          <>
            {!hiddenSections.includes("contour") && (
              <ContourOptionsSection state={state} setState={setState} isOpen={sectionOpen.contour} onOpenChange={toggle("contour")} mapRef={mapRef} />
            )}
            <HillshadeOptionsSection state={state} setState={setState} isOpen={sectionOpen.hillshade} onOpenChange={toggle("hillshade")} />
            <HypsometricTintOptionsSection state={state} setState={setState} isOpen={sectionOpen.hypsometricTint} onOpenChange={toggle("hypsometricTint")} mapRef={mapRef} />
            {!hiddenSections.includes("reliefVisualization") && (
              <ReliefVisualizationOptionsSection
                state={state}
                setState={setState}
                isOpen={sectionOpen.reliefVisualization}
                onOpenChange={toggle("reliefVisualization")}
                terrainTileSize={getSourceConfig(state.sourceA)?.tileSize ?? 256}
              />
            )}
            {!hiddenSections.includes("terrainAnalysis") && (
              <TerrainAnalysisOptionsSection
                state={state}
                setState={setState}
                isOpen={sectionOpen.terrainAnalysis}
                onOpenChange={toggle("terrainAnalysis")}
                withSeparator={!state.tellsBeta}
              />
            )}
          </>
        )}
        {!hiddenSections.includes("terrainAnalysis") && state.tellsBeta && (
          <MacroSeparator label="Detectors" isOpen={macroGroupOpen.Detectors} onToggle={() => toggleMacroGroup("Detectors")} />
        )}
        {!hiddenSections.includes("terrainAnalysis") && macroGroupOpen.Detectors && (
          <DetectorMoundsSection
            state={state}
            setState={setState}
            isOpen={sectionOpen.tellsDetector}
            onOpenChange={toggle("tellsDetector")}
            terrainTileSize={getSourceConfig(state.sourceA)?.tileSize ?? 256}
            mapRef={mapRef}
          />
        )}
        {!hiddenSections.includes("terrainAnalysis") && state.tellsBeta && <MacroSeparator />}
        <BackgroundOptionsSection state={state} setState={setState} theme={theme as any} isOpen={sectionOpen.background} onOpenChange={toggle("background")} />
        <MacroSeparator label="Tools" isOpen={macroGroupOpen.Tools} onToggle={() => toggleMacroGroup("Tools")} />
        {macroGroupOpen.Tools && (
          <>
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
          </>
        )}
        <MacroSeparator />
        <FooterSection />
        </div>
      </Card>
    </TooltipProvider>
  )
}