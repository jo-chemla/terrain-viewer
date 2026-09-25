import type React from "react"
import { useState, useMemo, useCallback, useEffect, useRef  } from "react"
import { useQueryStates } from "nuqs"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { PanelRightOpen, PanelRightClose, ChevronsDownUp, ChevronsUpDown, Home, ArrowLeftRight, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { transparentUiAtom, activeSliderAtom, activeProjectConfigAtom, vizModePinnedAtom, vizActivationAtom, type AppMode, revealSectionAtom, dataLayersModalOpenAtom } from "@/lib/settings-atoms"
import { useCoverageUseRequest } from "@/lib/use-coverage-use-request"
import { ProductTour } from "./product-tour"
import type { MapRef } from "react-map-gl/maplibre"

import { useSourceConfig, useTheme, type Bounds } from "@/lib/controls-utils"
import { SettingsDialog } from "./settings-dialog"
import { DataLayersModal } from "./data-layers-modal"
import { ModePicker } from "./ModePicker"
import { GeneralSettings } from "./general-settings"
import { ComparisonMixSection } from "./comparison-mix-section"
import { TerrainSourceSection } from "./terrain-source-section"
import { DownloadSection } from "./download-section"
import { BookmarksSection } from "./bookmarks-section"
import { VisualizationModesSection } from "./visualization-modes-section"
import { HillshadeOptionsSection } from "./hillshade-options-section"
import { LightingEffectsOptionsSection } from "./lighting-effects-options-section"
import { HypsometricTintOptionsSection } from "./hypsometric-tint-options-section"
import { TerrainAnalysisOptionsSection } from "./terrain-analysis-section"
import { ReliefVisualizationOptionsSection } from "./relief-visualization-section"
import { DetectorMoundsSection } from "./detector-mounds-section"
import { RasterBasemapSection } from "./raster-basemap-section"
import { ContourOptionsSection } from "./contour-options-section"
import { BackgroundOptionsSection } from "./background-options-section"
import { FooterSection } from "./footer-section"
import { TooltipIconButton, MacroSeparator } from "./controls-components"

import { useTerraDraw, TerraDrawSection, drawingUrlsAtom } from "./TerraDrawSystem"
import { coverageOverlaysAtom } from "@/lib/coverage-overlays"
import {AnimationSection, parseAsSnapshot} from "./CameraUtilities"
import { ElevationPickerSection } from "./ElevationPickerSection"
import { SunShadowCalculatorSection } from "./sun-shadow-calculator-section"
import { SourceInfoSection, isProvenanceSource } from "./SourceInfoSection"
import { useIsMobile } from '@/hooks/use-mobile'
import { useSpaceToggleContext } from '@/lib/use-space-toggle-context'
import { useShiftTapToggle } from '@/lib/use-shift-tap-toggle'
import { useCtrlTapToggle } from '@/lib/use-ctrl-tap-toggle'
import { useGeocoderShortcut } from '@/lib/use-geocoder-shortcut'
import { useUrlStateHistory } from "@/lib/use-url-state-history"
import { cn } from "@/lib/utils"

// --- Persisted state ---
export const isSidebarOpenAtom = atomWithStorage("isSidebarOpen", true)

export const SECTION_KEYS = [
  "general",
  "comparisonMix",
  "terrainSource",
  "download",
  "bookmarks",
  "visualizationModes",
  "hillshade",
  "lightingEffects",
  "hypsometricTint",
  "terrainAnalysis",
  "reliefVisualization",
  "tellsDetector",
  "rasterBasemap",
  "contour",
  "background",
  "drawing",
  "elevationPicker",
  "sunShadowCalculator",
  "animation",
  "sourceInfo",
  "footer"
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

/** ?scrollTo= value -> DOM id (the product tour's anchors). */
export const SCROLL_TARGETS: Record<string, string> = {
  general: "tour-general-settings",
  terrainSource: "tour-terrain-section",
  rasterBasemap: "tour-basemap-section",
  download: "tour-download-section",
  visualizationModes: "tour-viz-modes",
  hillshade: "tour-hillshade-section",
  hypsometricTint: "tour-hypso-section",
  lightingEffects: "tour-lighting-effects-section",
  reliefVisualization: "tour-relief-visualization-section",
  terrainAnalysis: "tour-terrain-analysis-section",
  contour: "tour-contour-section",
  tools: "tour-tools-group",
  drawing: "tour-drawing-section",
  elevationPicker: "tour-elevation-picker-section",
  sunShadowCalculator: "tour-sun-shadow-section",
  animation: "tour-animation-section",
  comparisonMix: "tour-historical-compare-blend",
}

/** Which macro group a reveal target lives under, so revealing it also
 *  expands the group it is buried in. Anything unlisted is in Options, which
 *  is where every visualization mode's own section sits. */
export const SECTION_MACRO_GROUP: Record<string, MacroGroupKey> = {
  terrainSource: "Sources",
  rasterBasemap: "Sources",
  tellsDetector: "Detectors",
  tools: "Tools",
  drawing: "Tools",
  elevationPicker: "Tools",
  sunShadowCalculator: "Tools",
  animation: "Tools",
}
type SectionOpenState = Record<SectionKey, boolean>

// Exported for ShareSection's "Copy URL with panel state" — the copied link
// only carries openSections/closeSections keys that DIFFER from these.
export const DEFAULT_OPEN_STATE: SectionOpenState = {
  general: true,
  comparisonMix: false,
  visualizationModes: true,
  download: false,
  bookmarks: false,
  terrainSource: false,
  hillshade: false,
  lightingEffects: false,
  hypsometricTint: false,
  terrainAnalysis: false,
  reliefVisualization: false,
  tellsDetector: false,
  rasterBasemap: false,
  contour: false,
  background: false,
  drawing: false,
  elevationPicker: false,
  sunShadowCalculator: false,
  animation: false,
  sourceInfo: false,
  footer: false,
}

export const sectionOpenAtom = atomWithStorage<SectionOpenState>("sectionOpen", DEFAULT_OPEN_STATE)
const sidebarScrollAtom = atomWithStorage("sidebarScroll", 0)

// Fold state for the labeled macro-group separators (Sources/Options/Detectors/
// Tools) — each one collapses every section rendered between it and the next
// separator. Independent of per-section sectionOpenAtom (folding a group just
// hides its sections; each section's own open/closed state is preserved
// underneath and reappears as-is when the group is expanded again).
export const MACRO_GROUP_KEYS = ["Sources", "Options", "Detectors", "Tools"] as const
export type MacroGroupKey = (typeof MACRO_GROUP_KEYS)[number]
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
  const [isDataLayersOpen, setIsDataLayersOpen] = useAtom(dataLayersModalOpenAtom)
  // "Use as terrain / basemap for view A" from the coverage click modal.
  useCoverageUseRequest(setState)
  const [isModePickerOpen, setIsModePickerOpen] = useState(false)
  // Nuqs-backed (state.appMode), like every other shareable field — not a
  // local jotai atom — so a link/bookmark can carry which sidebar layout was
  // showing. Historical mode is a deliberately stripped-down sidebar for
  // browsing historical imagery — see the ModePicker render below and its
  // gating throughout this component's JSX (Sources/Options/Detectors
  // groups, GeneralSettings' View Mode row, Tools' Elevation Picker/Source
  // Info).
  const appMode: AppMode = state.appMode
  const historicalMode = appMode === "historical"
  // ?openDataLayers=true - one-shot, like ?bookmarksGallery=true and
  // ?openLibrary=: opens the Data layers picker on arrival.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("openDataLayers") === "true") setIsDataLayersOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
  // Basemap section (terrain mode): any write that picks, restyles, adds or
  // stacks a basemap while the Basemap viz mode is off also turns it on.
  // Choosing imagery and seeing nothing change looked like a silent failure;
  // the add paths already did this, the pickers and sliders did not.
  // Historical mode always shows the basemap, so its section is left alone.
  const setBasemapState = useCallback((updates: Record<string, unknown>, options?: { shallow?: boolean }) => {
    const touchesBasemap = Object.keys(updates).some((k) =>
      k.startsWith("basemapSource") || k.startsWith("rasterBasemap") || k === "overlayBasemapIds" || k === "basemapPerView")
    if (touchesBasemap && !state.showRasterBasemap && !("showRasterBasemap" in updates)) setState({ ...updates, showRasterBasemap: true }, options)
    else setState(updates, options)
  }, [setState, state.showRasterBasemap])
  const { draw } = useTerraDraw(mapRef)
  // drawingUrl (state list) <-> drawingUrlsAtom, both ways: the URL seeds
  // the atom, and a layer imported with "Keep in the link" or deleted in the
  // Drawing panel writes back. Compared as strings so equal lists never loop.
  const [drawingUrls, setDrawingUrls] = useAtom(drawingUrlsAtom)
  const stateDrawingUrlKey = (state.drawingUrl as string[] | undefined ?? []).join("\n")
  const atomDrawingUrlKey = drawingUrls.join("\n")
  const drawingUrlSeededRef = useRef(false)
  useEffect(() => {
    if (!drawingUrlSeededRef.current) { drawingUrlSeededRef.current = true; setDrawingUrls(state.drawingUrl ?? []); return }
    if (stateDrawingUrlKey !== atomDrawingUrlKey) setDrawingUrls(state.drawingUrl ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateDrawingUrlKey])
  useEffect(() => {
    if (!drawingUrlSeededRef.current) return
    if (stateDrawingUrlKey !== atomDrawingUrlKey) setState({ drawingUrl: drawingUrls })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atomDrawingUrlKey])
  // coverageOverlays (state list) <-> coverageOverlaysAtom, both ways: the
  // URL seeds the picker and the picker writes back, so a selection made in
  // Source Info is shareable. Same shape as drawingUrl above.
  const [coverageOverlays, setCoverageOverlays] = useAtom(coverageOverlaysAtom)
  const stateCoverageKey = (state.coverageOverlays as string[] | undefined ?? []).join("\n")
  const atomCoverageKey = coverageOverlays.join("\n")
  const coverageSeededRef = useRef(false)
  useEffect(() => {
    if (!coverageSeededRef.current) { coverageSeededRef.current = true; setCoverageOverlays(state.coverageOverlays ?? []); return }
    if (stateCoverageKey !== atomCoverageKey) setCoverageOverlays(state.coverageOverlays ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCoverageKey])
  useEffect(() => {
    if (!coverageSeededRef.current) return
    if (stateCoverageKey !== atomCoverageKey) setState({ coverageOverlays })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atomCoverageKey])
  const isMobile = useIsMobile()
  // Space re-toggles the last-clicked viz-mode checkbox even after a map drag
  // steals focus onto the maplibre canvas (wheel-zoom never did) — see the hook.
  useSpaceToggleContext()
  // Tapping either Shift key alone toggles the raster basemap — a quick way
  // to peek at (or hide) satellite/street imagery under whatever terrain
  // visualization is active without reaching for the sidebar. (Alt was tried
  // first but the browser's own Alt-alone menu-bar-focus behavior conflicts
  // with it.)
  useShiftTapToggle(() => setState({ showRasterBasemap: !state.showRasterBasemap }), !historicalMode)
  // Ctrl/Cmd+K jumps focus to the geocoder search box from anywhere.
  useGeocoderShortcut()
  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or +Y) walk the URL state back and
  // forth: every control's change, camera excluded. See the hook.
  useUrlStateHistory(state, setState)
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
        showLightingEffects: state.showLightingEffects,
        showRasterBasemap: state.showRasterBasemap,
        showColorRelief: state.showColorRelief,
        showReliefVisualization: state.showReliefVisualization,
        showTerrainAnalysis: state.showTerrainAnalysis,
        showBackground: state.showBackground,
      }
      // The detector overlay stays: it is the thing being checked against
      // the imagery, not a rendering of the terrain.
      setState({
        showContoursAndGraticules: false,
        showHillshade: false,
        showLightingEffects: false,
        showRasterBasemap: true,
        showColorRelief: false,
        showReliefVisualization: false,
        showTerrainAnalysis: false,
        showBackground: false,
      })
    }
  }, !historicalMode)
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

  // Scroll-fade (shadcn/ui "scroll-fade" util): soften the top/bottom edges of
  // the panel with a mask gradient, but ONLY the edge that actually has more
  // content past it — so the very first/last row is never faded when there's
  // nothing to scroll to. `fade` holds which edges are currently active.
  const [fade, setFade] = useState({ top: false, bottom: false })
  const updateFade = useCallback((el: HTMLElement | null) => {
    if (!el) return
    const top = el.scrollTop > 4
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4
    setFade((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }))
  }, [])

  // Save scroll position on scroll (and refresh the fade edges).
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollPosition(el.scrollTop)
    updateFade(el)
  }, [setScrollPosition, updateFade])

  // Recompute fade when content height changes (sections expand/collapse) or the
  // panel resizes, not just on scroll — otherwise expanding a section below the
  // fold wouldn't turn the bottom fade on until the first scroll tick.
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    updateFade(el)
    const ro = new ResizeObserver(() => updateFade(el))
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [updateFade, isSidebarOpen])

  const FADE_PX = 56
  const scrollMask = `linear-gradient(to bottom, ${fade.top ? "transparent" : "#000"} 0, #000 ${FADE_PX}px, #000 calc(100% - ${FADE_PX}px), ${fade.bottom ? "transparent" : "#000"} 100%)`

  // Records when each viz-mode is switched on so the corresponding Section can
  // show its 3s breathing dot. Lives here (a component that never unmounts)
  // because the Options sections themselves unmount while off — see
  // vizActivationAtom. The first run only seeds the baseline (no pulse for
  // whatever's already on at load / URL-restored).
  const [, setVizActivation] = useAtom(vizActivationAtom)
  const prevVizRef = useRef<Record<string, boolean> | null>(null)
  useEffect(() => {
    const flags: Record<string, boolean> = {
      showHillshade: state.showHillshade, showColorRelief: state.showColorRelief,
      showRasterBasemap: state.showRasterBasemap, showContoursAndGraticules: state.showContoursAndGraticules,
      showBackground: state.showBackground, showLightingEffects: state.showLightingEffects,
      showReliefVisualization: state.showReliefVisualization, showTerrainAnalysis: state.showTerrainAnalysis,
    }
    const prev = prevVizRef.current
    if (prev) {
      const now = Date.now()
      const updates: Record<string, number> = {}
      for (const k in flags) if (flags[k] && !prev[k]) updates[k] = now
      if (Object.keys(updates).length) setVizActivation((p) => ({ ...p, ...updates }))
    }
    prevVizRef.current = flags
  }, [
    state.showHillshade, state.showColorRelief, state.showRasterBasemap, state.showContoursAndGraticules,
    state.showBackground, state.showLightingEffects, state.showReliefVisualization, state.showTerrainAnalysis,
    setVizActivation,
  ])


  const [sectionOpen, setSectionOpen] = useAtom(sectionOpenAtom)

  // ?scrollTo=<section key or DOM id> - one-shot: opens that section (when
  // the value is a section key) and scrolls the panel to it, so a link can
  // land on, say, the hillshade light pad. Targets resolve to the product
  // tour's own ids (SCROLL_TARGETS), then to any element id.
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("scrollTo")
    if (!target) return
    if ((SECTION_KEYS as readonly string[]).includes(target)) {
      setSectionOpen((prev) => ({ ...prev, [target]: true }))
      setIsSidebarOpen(true)
    }
    const t = setTimeout(() => {
      const id = SCROLL_TARGETS[target] ?? target
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [macroGroupOpen, setMacroGroupOpen] = useAtom(macroGroupOpenAtom)
  // revealSectionAtom: the runtime twin of ?scrollTo=. Opens the section (and
  // the macro group it lives in, or it would open inside something collapsed),
  // then scrolls to its anchor once it has actually mounted.
  const [revealSection, setRevealSection] = useAtom(revealSectionAtom)
  useEffect(() => {
    if (!revealSection) return
    setIsSidebarOpen(true)
    setMacroGroupOpen((prev) => ({ ...prev, [SECTION_MACRO_GROUP[revealSection] ?? "Options"]: true }))
    setSectionOpen((prev) => ({ ...prev, [revealSection]: true }))
    const id = SCROLL_TARGETS[revealSection] ?? revealSection
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })
      setRevealSection(null)
    }, 120)
    return () => clearTimeout(t)
  }, [revealSection, setRevealSection, setIsSidebarOpen, setMacroGroupOpen, setSectionOpen])
  const toggleMacroGroup = (key: MacroGroupKey) => setMacroGroupOpen((prev) => ({ ...prev, [key]: !prev[key] }))

  // Mound Candidates (Detectors) only shows in the sidebar while both its
  // beta flag AND its own Visualization Modes master checkbox
  // (showTellsDetector) are on — beta alone just unlocks the *option*, it
  // isn't a reason to already show a whole section of veto-threshold sliders
  // nobody asked for. showTellsDetector is deliberately a separate flag from
  // tellsMarkersVisible (the section's own "Show mound candidates" checkbox,
  // a pure paint-visibility toggle) — toggling markers visibility on/off
  // must never also collapse the section it lives in or uncheck the
  // Visualization Modes master switch. Live, not latched: unchecking the Viz
  // Modes checkbox hides the section again immediately — that's the one
  // control meant to do that; tellsMarkersVisible never does.
  const showDetectors = state.tellsBeta && state.showTellsDetector
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const [vizModePinned] = useAtom(vizModePinnedAtom)
  const hideSourcePanels = activeProjectConfig?.hideSourcePanels ?? false
  const hiddenSections = activeProjectConfig?.hiddenSections ?? []

  // Each section in the Options group returns null unless its viz mode is on
  // (Hillshade→showHillshade, Elevation Hypso→showColorRelief, etc.), so with
  // only Raster Basemap active the whole group is empty. Mirror those exact
  // gates here so the "Options" label+chevron row hides too instead of sitting
  // above nothing (raster-basemap options live in Sources / source meta).
  const optionsHasContent =
    (!hiddenSections.includes("contour") && state.showContoursAndGraticules) ||
    state.showHillshade ||
    state.showColorRelief ||
    (!hiddenSections.includes("reliefVisualization") && state.showReliefVisualization) ||
    (!hiddenSections.includes("terrainAnalysis") && state.showTerrainAnalysis) ||
    state.showLightingEffects

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
      lat: (activeProjectConfig?.initialState?.lat as number | undefined) ?? 21.4208,
      lng: (activeProjectConfig?.initialState?.lng as number | undefined) ?? 0,
      zoom: (activeProjectConfig?.initialState?.zoom as number | undefined) ?? 1.52,
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

  // Historical mode has no Visualization Modes / View Mode toggle to switch
  // out of 2D with (both are hidden entirely below) — this is the one place
  // enforcing that invariant, so nothing upstream (a restored bookmark, a
  // project's own initialViewMode, etc.) can leave the map in 3D/globe while
  // the simplified sidebar is showing.
  useEffect(() => {
    if (historicalMode && state.viewMode !== "2d") setState({ viewMode: "2d" })
  }, [historicalMode, state.viewMode, setState])

  // Same reasoning, for the raster basemap: historical mode has no
  // Visualization Modes checkbox to turn it back on with (it's the only
  // thing this mode shows at all), but the global Shift-tap/Ctrl-tap
  // shortcuts (useShiftTapToggle/useCtrlTapToggle above) can still flip
  // showRasterBasemap off regardless of app mode — leaving a blank map with
  // no visible way to recover. Keep it force-on continuously here, not just
  // as a one-time nudge when switching into the mode (handleSelectMode below).
  useEffect(() => {
    if (historicalMode && !state.showRasterBasemap) setState({ showRasterBasemap: true })
  }, [historicalMode, state.showRasterBasemap, setState])

  // Every other viz-mode master toggle (Hillshade/Lighting Effects/Shadows/
  // Color Relief/Terrain Analysis/Relief Visualization/Plane Slicer/Tells/
  // Contours+Graticules/Background) needs no equivalent reset effect here —
  // historical mode's whole Options/Visualization Modes/Detectors/Elevation
  // Picker groups are hidden entirely, but rather than un-checking a flag a
  // visitor left on from Terrain mode, TerrainViewer.tsx gates every one of
  // those Sources/Layers on `!isHistoricalMode` directly at render time, so
  // the underlying state is left untouched (still restorable on switching
  // back) and nothing ever actually renders while historical either way.

  const handleSelectMode = (next: AppMode) => {
    setState({ appMode: next })
    setIsModePickerOpen(false)
    // Only switching INTO historical mode needs a nudge beyond the two
    // continuous-enforcement effects above — it unlocks the beta flag gating
    // historical basemaps at all, and expands the raster-basemap section
    // (rather than leaving the visitor to find and open it themselves).
    // Switching back to Terrain needs no equivalent nudge; every one of its
    // sections is just hidden, not disabled, so nothing needs restoring.
    if (next === "historical" && !historicalMode) {
      setState({ historicalBeta: true, viewMode: "2d" })
      setSectionOpen((prev) => ({ ...prev, rasterBasemap: true }))
    }
  }

  useMemo(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  if (!isSidebarOpen) {
    return (
      <>
        <TooltipProvider delay={0} timeout={0}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="secondary" size="icon" className="absolute right-4 top-4 cursor-pointer" onClick={() => setIsSidebarOpen(true)}>
                  <PanelRightOpen className="h-5 w-5" />
                </Button>
              }
            />
            <TooltipContent>
              <p>Open sidebar</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* Same position (2nd child of this Fragment) as in the open-panel
            return below, so React keeps this instance mounted — not
            remounted — across an isSidebarOpen flip the tour itself
            triggers (see product-tour.tsx's "prepare" step). */}
        <ProductTour state={state} setState={setState} switchAppMode={handleSelectMode} mapRef={mapRef} />
      </>
    )
  }

  return (
    <>
    <TooltipProvider delay={0} timeout={0}>
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
        id="tour-sidepanel"
        className={cn(
          "absolute z-50 overflow-hidden flex flex-col p-0 gap-0 backdrop-blur-[2px] text-base",
          "right-0 top-0 bottom-0 w-80 rounded-none",
          "sm:right-4 sm:top-4 sm:bottom-4 sm:w-96 sm:rounded-xl",
          transparentUi && activeSlider
            ? "bg-background/20"
            : "bg-background/95",
          "transition-[background-color] duration-150"
        )}
      >
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3 border-b">
          <Tooltip>
            <TooltipTrigger
              render={
                <h2
                  id="tour-mode-label"
                  className="flex items-center gap-1.5 text-xl font-semibold cursor-pointer hover:text-muted-foreground"
                  onClick={() => setIsModePickerOpen(true)}
                >
                  {activeProjectConfig?.name || (historicalMode ? "Historical Satellite" : "Terrain Viewer")}
                  <ArrowLeftRight className="h-4 w-4 shrink-0 opacity-60" />
                </h2>
              }
            />
            <TooltipContent>
              <p>Switch mode</p>
            </TooltipContent>
          </Tooltip>
          <ModePicker open={isModePickerOpen} onOpenChange={setIsModePickerOpen} mode={appMode} onSelect={handleSelectMode} />
          <div className="flex gap-1 items-center">
            <TooltipIconButton
              icon={allFolded ? ChevronsUpDown : ChevronsDownUp}
              tooltip={allFolded ? "Expand all sections" : "Fold all sections"}
              onClick={handleFoldExpandAll}
            />
            {/* Also in the Visualization Modes section header, next to its
                pin. This copy exists because that header scrolls away with
                the list, and the picker is how you change layer from
                anywhere in the panel. */}
            {!historicalMode && (
              <TooltipIconButton
                icon={Layers}
                tooltip="Data layers: every visualization mode, with a picture"
                onClick={() => setIsDataLayersOpen(true)}
              />
            )}
            <DataLayersModal open={isDataLayersOpen} onOpenChange={setIsDataLayersOpen} state={state} setState={setState} />
            <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} state={state} setState={setState} historicalMode={historicalMode}/>
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
          style={{ maskImage: scrollMask, WebkitMaskImage: scrollMask }}
        >
        <GeneralSettings state={state} setState={setState} isOpen={sectionOpen.general} onOpenChange={toggle("general")} historicalMode={historicalMode} mapRef={mapRef} onGoHome={handleGoHome} />
        {/* Compare and Blend sits right under General Settings in historical
            mode, where comparing dates is the point, and under Visualization
            Modes in terrain mode, where picking what to draw comes first. */}
        {historicalMode && (
          <ComparisonMixSection state={state} setState={setState} isOpen={sectionOpen.comparisonMix} onOpenChange={toggle("comparisonMix")} historicalMode={historicalMode} mapRef={mapRef} />
        )}
        {!historicalMode && (
          <>
            <VisualizationModesSection state={state} setState={setState} isOpen={sectionOpen.visualizationModes} onOpenChange={toggle("visualizationModes")} />
            <ComparisonMixSection state={state} setState={setState} isOpen={sectionOpen.comparisonMix} onOpenChange={toggle("comparisonMix")} historicalMode={historicalMode} mapRef={mapRef} />
          </>
        )}
        {!hiddenSections.includes("bookmarks") && (
          <BookmarksSection state={state} setState={setState} mapRef={mapRef} isOpen={sectionOpen.bookmarks} onOpenChange={toggle("bookmarks")} />
        )}
        <DownloadSection state={state} getMapBounds={getMapBounds} getSourceConfig={getSourceConfig} mapRef={mapRef} isOpen={sectionOpen.download} onOpenChange={toggle("download")} historicalMode={historicalMode} />
        {/* Whole "Sources" group (label+chevron row AND its sections) is hidden
            when the project config hides source panels — otherwise the chevron/
            label row would sit there with nothing to expand. Historical mode
            drops the group header and terrain-source picker entirely too (only
            basemap imagery is a valid "source" there), but keeps Raster Basemap
            reachable, just ungrouped rather than under a "Sources" label. */}
        {!hideSourcePanels && !historicalMode && (
          <>
            <MacroSeparator label="Sources" isOpen={macroGroupOpen.Sources} onToggle={() => toggleMacroGroup("Sources")} />
            {macroGroupOpen.Sources && (
              <>
                <TerrainSourceSection state={state} setState={setState} getTilesUrl={getTilesUrl} getMapBounds={getMapBounds} mapRef={mapRef} isOpen={sectionOpen.terrainSource} onOpenChange={toggle("terrainSource")} />
                <RasterBasemapSection state={state} setState={setBasemapState} mapRef={mapRef} isOpen={sectionOpen.rasterBasemap} onOpenChange={toggle("rasterBasemap")} withSeparator={false} />
              </>
            )}
          </>
        )}
        {!hideSourcePanels && historicalMode && (
          <RasterBasemapSection state={state} setState={setState} mapRef={mapRef} isOpen={sectionOpen.rasterBasemap} onOpenChange={toggle("rasterBasemap")} withSeparator={false} historicalMode />
        )}
        {/* The whole Options group (contours/hillshade/hypso/relief/terrain
            analysis/lighting/background) is terrain-only — historical mode has
            no elevation source to derive any of it from. */}
        {!historicalMode && optionsHasContent && (
          <MacroSeparator label="Options" isOpen={macroGroupOpen.Options} onToggle={() => toggleMacroGroup("Options")} />
        )}
        {!historicalMode && optionsHasContent && macroGroupOpen.Options && (
          <>
            {!hiddenSections.includes("contour") && (
              <ContourOptionsSection state={state} setState={setState} isOpen={sectionOpen.contour} onOpenChange={toggle("contour")} mapRef={mapRef} />
            )}
            {/* Native Hillshade sits between Contours and Elevation Hypso here,
                mirroring Visualization Modes' own list order (Raster Basemap,
                the only mode between them there, lives under Sources instead). */}
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
              />
            )}
            {/* "Lighting Effects" (Matcap + Phong) is last in the Options group,
                after Terrain Analysis, matching Visualization Modes' own list
                order. */}
            <LightingEffectsOptionsSection state={state} setState={setState} isOpen={sectionOpen.lightingEffects} onOpenChange={toggle("lightingEffects")} />
            <BackgroundOptionsSection state={state} setState={setState} theme={theme as any} isOpen={sectionOpen.background} onOpenChange={toggle("background")} />
          </>
        )}
        {!historicalMode && !hiddenSections.includes("terrainAnalysis") && showDetectors && (
          <MacroSeparator label="Detectors" isOpen={macroGroupOpen.Detectors} onToggle={() => toggleMacroGroup("Detectors")} />
        )}
        {!historicalMode && !hiddenSections.includes("terrainAnalysis") && showDetectors && macroGroupOpen.Detectors && (
          <DetectorMoundsSection
            state={state}
            setState={setState}
            isOpen={sectionOpen.tellsDetector}
            onOpenChange={toggle("tellsDetector")}
            terrainTileSize={getSourceConfig(state.sourceA)?.tileSize ?? 256}
            mapRef={mapRef}
          />
        )}
        {!historicalMode && !hiddenSections.includes("terrainAnalysis") && showDetectors && <MacroSeparator />}
        {/* Single id spanning the separator AND every section below it (own
            "space-y-2" replicates the scroll container's own spacing, lost by
            wrapping — see controls-components.tsx) — so the product tour's
            own Tools step can spotlight the whole group as one block instead
            of just the separator's own thin label row. */}
        <div id="tour-tools-group" className="space-y-2 scroll-mt-[100px]">
          <MacroSeparator label="Tools" isOpen={macroGroupOpen.Tools} onToggle={() => toggleMacroGroup("Tools")} />
          {macroGroupOpen.Tools && (
            <>
              {/* Wrappers only exist to give the level-2 Tools walkthrough a
                  stable anchor per tool (product-tour.tsx's TOOLS_STEPS). */}
              <div id="tour-drawing-section" className="scroll-mt-[100px]">
                <TerraDrawSection draw={draw} mapRef={mapRef} isOpen={sectionOpen.drawing} onOpenChange={toggle("drawing")} />
              </div>
              {/* Elevation Picker reads elevation off the active terrain (DEM)
                  source — meaningless in historical mode, which has none. */}
              {!historicalMode && !hiddenSections.includes("elevationPicker") && (
                <div id="tour-elevation-picker-section" className="scroll-mt-[100px]">
                  <ElevationPickerSection state={state} setState={setState} mapRef={mapRef} draw={draw} isOpen={sectionOpen.elevationPicker} onOpenChange={toggle("elevationPicker")} />
                </div>
              )}
              {!hiddenSections.includes("sunShadowCalculator") && state.sunShadowBeta && (
                <div id="tour-sun-shadow-section" className="scroll-mt-[100px]">
                  <SunShadowCalculatorSection state={state} setState={setState} mapRef={mapRef} draw={draw} isOpen={sectionOpen.sunShadowCalculator} onOpenChange={toggle("sunShadowCalculator")} />
                </div>
              )}
              {/* Camera-pose animation has no meaning without a terrain/DEM
                  scene to fly a camera through — historical mode is a flat 2D
                  basemap view only. */}
              {!historicalMode && (
                <div id="tour-animation-section" className="scroll-mt-[100px]">
                <AnimationSection
                  mapRef={mapRef}
                  isOpen={sectionOpen.animation}
                  onOpenChange={toggle("animation")}
                  appState={state}
                  setAppState={setAppState}
                  setAppStateSafe={setAppState}
                  withSeparator={!hiddenSections.includes("sourceInfo") && (isProvenanceSource(state.sourceA) || state.showRasterBasemap)}
                />
                </div>
              )}
              {/* Shows terrain-source provenance (mapterhorn/another DEM,
                  meaningless in historical mode) AND/OR basemap attribution
                  (Esri/Wayback/GE Historical dynamic, everything else static)
                  — a raster basemap can be active in EITHER app mode (it's
                  just the only thing historical mode shows), so this isn't an
                  either/or gated on historicalMode; SourceInfoSection renders
                  whichever of its two blocks actually applies. */}
              {!hiddenSections.includes("sourceInfo") && (isProvenanceSource(state.sourceA) || state.showRasterBasemap) && (
                <SourceInfoSection state={state} mapRef={mapRef} historicalMode={historicalMode} isOpen={sectionOpen.sourceInfo} onOpenChange={toggle("sourceInfo")} />
              )}
            </>
          )}
        </div>
        <FooterSection isOpen={sectionOpen.footer} onOpenChange={toggle("footer")} />
        </div>
      </Card>
    </TooltipProvider>
    {/* Same position (2nd child of this Fragment) as in the closed-sidebar
        return above — see that branch's comment. */}
    <ProductTour state={state} setState={setState} switchAppMode={handleSelectMode} mapRef={mapRef} />
    </>
  )
}