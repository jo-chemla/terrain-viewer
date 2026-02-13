import type React from "react"
import { useState, useMemo } from "react"
import { useAtom } from "jotai"
import { PanelRightOpen, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { TooltipProvider } from "@/components/ui/tooltip"
import { themeAtom } from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"

import { useSourceConfig, type Bounds } from "./controls-utility"
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

interface TerrainControlPanelProps {
  state: any
  setState: (updates: any) => void
  getMapBounds: () => Bounds
  mapRef: React.RefObject<MapRef>
}

export function TerrainControlPanel({ state, setState, getMapBounds, mapRef }: TerrainControlPanelProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { getTilesUrl, getSourceConfig } = useSourceConfig()
  const [theme] = useAtom(themeAtom)

  useMemo(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  if (!isSidebarOpen) {
    return (
      <Button variant="secondary" size="icon" className="absolute right-4 top-4 cursor-pointer" onClick={() => setIsSidebarOpen(true)}>
        <PanelRightOpen className="h-5 w-5" />
      </Button>
    )
  }

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Card className="absolute right-4 top-4 bottom-4 w-96 overflow-y-auto p-4 gap-2 space-y-2 bg-background/95 backdrop-blur text-base">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Terrain Viewer</h2>
          <div className="flex gap-1">
            <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
            <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)} className="cursor-pointer">
              <PanelRightClose className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <GeneralSettings state={state} setState={setState} />
        <TerrainSourceSection state={state} setState={setState} getTilesUrl={getTilesUrl} getMapBounds={getMapBounds} mapRef={mapRef} />
        <DownloadSection state={state} getMapBounds={getMapBounds} getSourceConfig={getSourceConfig} mapRef={mapRef} />
        <VisualizationModesSection state={state} setState={setState} />
        <HillshadeOptionsSection state={state} setState={setState} />
        <HypsometricTintOptionsSection state={state} setState={setState} />
        <RasterBasemapSection state={state} setState={setState} mapRef={mapRef} />
        <ContourOptionsSection state={state} setState={setState} />
        <BackgroundOptionsSection state={state} setState={setState} theme={theme as any} />
        <FooterSection />
      </Card>
    </TooltipProvider>
  )
}
