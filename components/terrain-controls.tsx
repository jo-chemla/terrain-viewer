"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useAtom } from "jotai"
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Info,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Settings,
  Sun,
} from "lucide-react"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { terrainSources } from "@/lib/terrain-sources"
import { colorRamps } from "@/lib/color-ramps"
import { buildGdalWmsXml } from "@/lib/build-gdal-xml"
import {
  mapboxKeyAtom,
  googleKeyAtom,
  maptilerKeyAtom,
  titilerEndpointAtom,
  maxResolutionAtom,
  themeAtom,
  isGeneralOpenAtom,
  isTerrainSourceOpenAtom,
  isVizModesOpenAtom,
  isHillshadeOpenAtom,
  isTerrainRasterOpenAtom,
  isHypsoOpenAtom,
  isContoursOpenAtom,
  isDownloadOpenAtom,
} from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"

interface TerrainControlsProps {
  state: any
  setState: any
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  mapRef: React.RefObject<MapRef>
}

export function TerrainControls({ state, setState, getMapBounds, mapRef }: TerrainControlsProps) {
  const [isColorsOpen, setIsColorsOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isGeneralOpen, setIsGeneralOpen] = useAtom(isGeneralOpenAtom)
  const [isTerrainSourceOpen, setIsTerrainSourceOpen] = useAtom(isTerrainSourceOpenAtom)
  const [isVizModesOpen, setIsVizModesOpen] = useAtom(isVizModesOpenAtom)
  const [isHillshadeOpen, setIsHillshadeOpen] = useAtom(isHillshadeOpenAtom)
  const [isTerrainRasterOpen, setIsTerrainRasterOpen] = useAtom(isTerrainRasterOpenAtom)
  const [isHypsoOpen, setIsHypsoOpen] = useAtom(isHypsoOpenAtom)
  const [isContoursOpen, setIsContoursOpen] = useAtom(isContoursOpenAtom)
  const [isDownloadOpen, setIsDownloadOpen] = useAtom(isDownloadOpenAtom)
  const [showAdvancedRamps, setShowAdvancedRamps] = useState(false)
  const [batchEditMode, setBatchEditMode] = useState(false)
  const [batchApiKeys, setBatchApiKeys] = useState("")
  const [isExporting, setIsExporting] = useState(false) // ADDED: isExporting state for spinner

  const [mapboxKey, setMapboxKey] = useAtom(mapboxKeyAtom)
  const [googleKey, setGoogleKey] = useAtom(googleKeyAtom)
  const [maptilerKey, setMaptilerKey] = useAtom(maptilerKeyAtom)
  const [titilerEndpoint, setTitilerEndpoint] = useAtom(titilerEndpointAtom)
  const [maxResolution, setMaxResolution] = useAtom(maxResolutionAtom)
  const [theme, setTheme] = useAtom(themeAtom)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  const supportsIlluminationDirection = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsIlluminationAltitude = ["combined", "basic"].includes(state.hillshadeMethod)
  const supportsShadowColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsHighlightColor = ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod)
  const supportsAccentColor = state.hillshadeMethod === "standard"
  const supportsExaggeration = ["standard", "combined", "multidirectional", "multidir-colors"].includes(
    state.hillshadeMethod,
  )

  const colorRampKeys = Object.keys(colorRamps)
  const hillshadeMethodKeys = ["standard", "combined", "igor", "basic", "multidirectional", "multidir-colors"]
  const terrainSourceKeys = ["osm", "google", "esri", "mapbox"]

  const cycleColorRamp = (direction: number) => {
    const currentIndex = colorRampKeys.indexOf(state.colorRamp)
    const newIndex = (currentIndex + direction + colorRampKeys.length) % colorRampKeys.length
    setState({ colorRamp: colorRampKeys[newIndex] })
  }

  const cycleHillshadeMethod = (direction: number) => {
    const currentIndex = hillshadeMethodKeys.indexOf(state.hillshadeMethod)
    const newIndex = (currentIndex + direction + hillshadeMethodKeys.length) % hillshadeMethodKeys.length
    setState({ hillshadeMethod: hillshadeMethodKeys[newIndex] })
  }

  const cycleTerrainSource = (direction: number) => {
    const currentIndex = terrainSourceKeys.indexOf(state.terrainSource)
    const newIndex = (currentIndex + direction + terrainSourceKeys.length) % terrainSourceKeys.length
    setState({ terrainSource: terrainSourceKeys[newIndex] })
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const getTitilerDownloadUrl = () => {
    const source = terrainSources[state.sourceA]
    if (!source?.sourceConfig?.tiles?.[0]) return ""
    const tileUrl = source.sourceConfig.tiles[0]
    const tileSize = source.sourceConfig.tileSize || 256
    const wmsXml = buildGdalWmsXml(tileUrl, tileSize)
    const bounds = getMapBounds()
    const width = maxResolution // Use maxResolution from Jotai atom
    const height = maxResolution // Use maxResolution from Jotai atom
    return `${titilerEndpoint}/cog/bbox/${bounds.west},${bounds.south},${bounds.east},${bounds.north}/${width}x${height}.tif?url=${encodeURIComponent(wmsXml)}`
  }

  const getSourceUrl = () => {
    const source = terrainSources[state.sourceA]
    return source?.sourceConfig?.tiles?.[0] || ""
  }

  const takeScreenshot = async () => {
    if (!mapRef.current) return
    try {
      const { domToPng } = await import("modern-screenshot")
      const canvas = mapRef.current.getMap().getCanvas()
      const parentElement = canvas.parentElement

      if (!parentElement) {
        console.error("Canvas parent element not found")
        return
      }

      const filter = (node: HTMLElement) => {
        const exclusionClasses = [
          "mapboxgl-ctrl-group",
          "maplibregl-ctrl-group",
          "mapboxgl-ctrl-geocoder",
          "maplibregl-ctrl-geocoder",
          "mapboxgl-ctrl-logo",
          "maplibregl-ctrl-logo",
          "terradraw-group",
        ]
        return !exclusionClasses.some((classname) => node.classList?.contains(classname))
      }

      const width = parentElement.clientWidth
      const height = parentElement.clientHeight
      const dpr = window.devicePixelRatio

      mapRef.current?.resize()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const dataUrl = await domToPng(parentElement, {
        filter: filter,
        width: width,
        height: height,
        scale: dpr,
      })

      const { saveAs } = await import("file-saver")
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      saveAs(blob, `terrain-screenshot-${Date.now()}.png`)

      if (state.viewMode === "2d") {
        const bounds = getMapBounds()
        const pixelSizeX = (bounds.east - bounds.west) / width
        const pixelSizeY = (bounds.north - bounds.south) / height

        // PGW format: pixel size X, rotation, rotation, pixel size Y (negative), top-left X, top-left Y
        const pgwContent = [
          pixelSizeX.toFixed(10),
          "0.0",
          "0.0",
          (-pixelSizeY).toFixed(10),
          bounds.west.toFixed(10),
          bounds.north.toFixed(10),
        ].join("\n")

        const pgwBlob = new Blob([pgwContent], { type: "text/plain" })
        saveAs(pgwBlob, `terrain-screenshot-${Date.now()}.pgw`)
      }
    } catch (error) {
      console.error("Failed to take screenshot:", error)
    }
  }

  const exportDTM = async () => {
    setIsExporting(true) // ADDED: Set isExporting state for spinner
    try {
      const url = getTitilerDownloadUrl()
      const response = await fetch(url)
      if (!response.ok) {
        window.open(url, "_blank")
        return
      }

      const arrayBuffer = await response.arrayBuffer()
      const { fromArrayBuffer, writeArrayBuffer } = await import("geotiff")
      const tiff = await fromArrayBuffer(arrayBuffer)
      const image = await tiff.getImage()
      const rasters = await image.readRasters()

      const width = image.getWidth()
      const height = image.getHeight()
      const source = terrainSources[state.sourceA]
      const encoding = source.encoding

      const elevationData = new Float32Array(width * height)
      const r = rasters[0]
      const g = rasters[1]
      const b = rasters[2]

      for (let i = 0; i < width * height; i++) {
        if (encoding === "terrainrgb") {
          // TerrainRGB: height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
          elevationData[i] = -10000 + (r[i] * 256 * 256 + g[i] * 256 + b[i]) * 0.1
        } else {
          // Terrarium: height = (R * 256 + G + B / 256) - 32768
          elevationData[i] = r[i] * 256 + g[i] + b[i] / 256 - 32768
        }
      }

      const bounds = getMapBounds()
      const pixelSizeX = (bounds.east - bounds.west) / width
      const pixelSizeY = (bounds.north - bounds.south) / height

      const metadata = {
        GTModelTypeGeoKey: 2,
        GeographicTypeGeoKey: 4326,
        GeogCitationGeoKey: "WGS 84",
        height: height,
        width: width,
        ModelPixelScale: [pixelSizeX, pixelSizeY, 0],
        ModelTiepoint: [0, 0, 0, bounds.west, bounds.north, 0],
        SamplesPerPixel: 1,
        BitsPerSample: [32],
        SampleFormat: [3], // Float
        PlanarConfiguration: 1,
        PhotometricInterpretation: 1,
      }

      const outputArrayBuffer = await writeArrayBuffer(elevationData, metadata)
      const { saveAs } = await import("file-saver")
      const blob = new Blob([outputArrayBuffer], { type: "image/tiff" })
      saveAs(blob, `terrain-dtm-${Date.now()}.tif`)
    } catch (error) {
      console.error("Failed to export DTM:", error)
      const url = getTitilerDownloadUrl()
      window.open(url, "_blank")
    } finally {
      setIsExporting(false) // ADDED: Set isExporting state for spinner
    }
  }

  if (!isSidebarOpen) {
    return (
      <Button
        variant="secondary"
        size="icon"
        className="absolute right-4 top-4 cursor-pointer"
        onClick={() => setIsSidebarOpen(true)}
      >
        <PanelRightOpen className="h-5 w-5" />
      </Button>
    )
  }

  return (
    <Card className="absolute right-4 top-4 bottom-4 w-96 overflow-y-auto p-4 gap-2 space-y-2 bg-background/95 backdrop-blur text-base">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Terrain Viewer</h2>
        <div className="flex gap-1">
          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="cursor-pointer">
                <Settings className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Settings & Resources</DialogTitle>
                <DialogDescription>
                  Configure API keys, application settings, and explore related resources
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Appearance</h3>
                  <div className="flex items-center justify-between">
                    <Label>Theme</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTheme(theme === "light" ? "dark" : "light")
                      }}
                      className="cursor-pointer"
                    >
                      {theme === "light" ? <Moon className="h-4 w-4 mr-2" /> : <Sun className="h-4 w-4 mr-2" />}
                      {theme === "light" ? "Dark" : "Light"}
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">API Keys</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!batchEditMode) {
                          // Entering batch mode - populate with current values
                          const keys = [
                            `maptiler_api_key=${maptilerKey}`,
                            `mapbox_access_token=${mapboxKey}`,
                            `google_api_key=${googleKey}`,
                          ]
                          setBatchApiKeys(keys.join("\n"))
                        } else {
                          // Exiting batch mode - parse and save
                          const lines = batchApiKeys.split("\n")
                          const updates: any = {}
                          lines.forEach((line) => {
                            const [key, value] = line.split("=")
                            if (key && value) {
                              if (key.trim() === "maptiler_api_key") setMaptilerKey(value.trim())
                              if (key.trim() === "mapbox_access_token") setMapboxKey(value.trim())
                              if (key.trim() === "google_api_key") setGoogleKey(value.trim())
                            }
                          })
                        }
                        setBatchEditMode(!batchEditMode)
                      }}
                      className="cursor-pointer"
                    >
                      {batchEditMode ? "Save" : "Batch Edit"}
                    </Button>
                  </div>
                  {batchEditMode ? (
                    <div className="space-y-2">
                      <Label htmlFor="batch-keys">API Keys (one per line: key=value)</Label>
                      <textarea
                        id="batch-keys"
                        className="w-full min-h-[120px] p-2 border rounded-md font-mono text-sm"
                        value={batchApiKeys}
                        onChange={(e) => setBatchApiKeys(e.target.value)}
                        placeholder="maptiler_api_key=&#10;mapbox_access_token=&#10;google_api_key="
                      />
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="maptiler-key">MapTiler API Key</Label>
                        <Input
                          id="maptiler-key"
                          type="text"
                          placeholder="Your MapTiler API key"
                          value={maptilerKey}
                          onChange={(e) => setMaptilerKey(e.target.value)}
                          className="cursor-text"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mapbox-key">Mapbox Access Token</Label>
                        <Input
                          id="mapbox-key"
                          type="text"
                          placeholder="pk.your_mapbox_token_here"
                          value={mapboxKey}
                          onChange={(e) => setMapboxKey(e.target.value)}
                          className="cursor-text"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="google-key">Google Maps API Key</Label>
                        <Input
                          id="google-key"
                          type="text"
                          placeholder="Your Google Maps API key"
                          value={googleKey}
                          onChange={(e) => setGoogleKey(e.target.value)}
                          className="cursor-text"
                        />
                      </div>
                      {/* Removed ESRI and Bing keys as they are not part of the batch edit */}
                    </>
                  )}
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">Titiler Settings</h3>
                  <div className="space-y-2">
                    <Label htmlFor="titiler-endpoint">Titiler Endpoint</Label>
                    <Input
                      id="titiler-endpoint"
                      type="text"
                      placeholder="https://titiler.xyz"
                      value={titilerEndpoint}
                      onChange={(e) => setTitilerEndpoint(e.target.value)}
                      className="cursor-text"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-resolution">Max Resolution (px)</Label>
                    <Input
                      id="max-resolution"
                      type="number"
                      placeholder="4096"
                      value={maxResolution}
                      onChange={(e) => setMaxResolution(Number.parseFloat(e.target.value))}
                      className="cursor-text"
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Terrain Encoding Functions</h3>
                  <div className="space-y-2 text-sm font-mono bg-muted p-3 rounded">
                    <div>
                      <span className="font-semibold">TerrainRGB:</span>
                      <br />
                      <code>height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)</code>
                    </div>
                    <div className="mt-2">
                      <span className="font-semibold">Terrarium:</span>
                      <br />
                      <code>height = (R * 256 + G + B / 256) - 32768</code>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">MapLibre GL Features</h3>
                  <div className="space-y-2 text-sm">
                    <a
                      href="https://github.com/maplibre/maplibre-gl-js/pull/5768"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer"
                    >
                      <span>Hillshade Methods (PR #5768)</span>
                      <ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                    </a>
                    <a
                      href="https://github.com/maplibre/maplibre-gl-js/pull/5913"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer"
                    >
                      <span>Hypsometric Tint (PR #5913)</span>
                      <ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                    </a>
                    <a
                      href="https://github.com/maplibre/maplibre-style-spec/issues/583#issuecomment-2028639772"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer"
                    >
                      <span>Contour Lines (Issue #583)</span>
                      <ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                    </a>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Color Ramp Resources</h3>
                  <div className="space-y-2 text-sm">
                    <a
                      href="http://seaviewsensing.com/pub/cpt-city/views/topobath.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer"
                    >
                      <span>CPT City - Topobath</span>
                      <ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                    </a>
                    <a
                      href="http://seaviewsensing.com/pub/cpt-city/views/topo.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer"
                    >
                      <span>CPT City - Topo</span>
                      <ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                    </a>
                    <a
                      href="https://www.npmjs.com/package/cpt2js"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer"
                    >
                      <span>cpt2js Package</span>
                      <ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                    </a>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)} className="cursor-pointer">
            <PanelRightClose className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <Separator />

      <Collapsible open={isGeneralOpen} onOpenChange={setIsGeneralOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          General Settings
          <ChevronDown className={`h-4 w-4 transition-transform ${isGeneralOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-1">
          {/* MOVED: View Mode before Split Screen */}
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">View Mode</Label>
            <ToggleGroup
              type="single"
              value={state.viewMode}
              onValueChange={(value) => value && setState({ viewMode: value })}
              className="border rounded-md w-[140px]"
            >
              <ToggleGroupItem
                value="2d"
                className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
              >
                2D
              </ToggleGroupItem>
              <ToggleGroupItem
                value="globe"
                className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
              >
                <Globe className="h-4 w-4 text-foreground" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="3d"
                className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
              >
                3D
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Split Screen</Label>
            <ToggleGroup
              type="single"
              value={state.splitScreen ? "on" : "off"}
              onValueChange={(value) => value && setState({ splitScreen: value === "on" })}
              className="border rounded-md w-[140px]"
            >
              <ToggleGroupItem
                value="off"
                className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
              >
                Off
              </ToggleGroupItem>
              <ToggleGroupItem
                value="on"
                className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
              >
                On
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {(state.viewMode === "3d" || state.viewMode === "globe") && (
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Terrain Exaggeration</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{state.exaggeration.toFixed(1)}x</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 cursor-pointer"
                    onClick={() => setState({ exaggeration: 1 })}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <Slider
                value={[state.exaggeration]}
                onValueChange={([value]) => setState({ exaggeration: value })}
                min={0.1}
                max={10}
                step={0.1}
                className="cursor-pointer"
              />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      <Collapsible open={isTerrainSourceOpen} onOpenChange={setIsTerrainSourceOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          Terrain Source
          <ChevronDown className={`h-4 w-4 transition-transform ${isTerrainSourceOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-1">
          {state.splitScreen ? (
            <>
              {Object.entries(terrainSources).map(([key, config]) => (
                <div key={key} className="flex items-center gap-2">
                  <ToggleGroup
                    type="single"
                    value={state.sourceA === key ? "a" : state.sourceB === key ? "b" : ""}
                    onValueChange={(value) => {
                      if (value === "a") setState({ sourceA: key })
                      else if (value === "b") setState({ sourceB: key })
                    }}
                    className="border rounded-md shrink-0"
                  >
                    <ToggleGroupItem value="a" className="px-3 cursor-pointer data-[state=on]:font-bold">
                      A
                    </ToggleGroupItem>
                    <ToggleGroupItem value="b" className="px-3 cursor-pointer data-[state=on]:font-bold">
                      B
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <Label className="flex-1 text-sm cursor-pointer">{config.name}</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer">
                              <Info className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-lg">
                            <DialogHeader>
                              <DialogTitle>{config.name}</DialogTitle>
                              <DialogDescription>{config.description}</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 text-sm">
                              <div>
                                <span className="font-semibold">Link:</span>
                                <div className="flex items-center gap-2 mt-1">
                                  <a
                                    href={config.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline flex-1 truncate"
                                  >
                                    {config.link}
                                  </a>
                                </div>
                              </div>
                              <div>
                                <span className="font-semibold">Encoding Type:</span> {config.encoding}
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-semibold">URL Template:</span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 cursor-pointer"
                                    onClick={() => copyToClipboard(config.sourceConfig.tiles[0])}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                </div>
                                <code className="block p-3 bg-muted rounded text-xs break-all">
                                  {config.sourceConfig.tiles[0]}
                                </code>
                              </div>
                              <div>
                                <span className="font-semibold">Max Zoom:</span> {config.sourceConfig.maxzoom}
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>View source details</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 cursor-pointer"
                    onClick={() => window.open(config.link, "_blank")}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </>
          ) : (
            <RadioGroup value={state.sourceA} onValueChange={(value) => setState({ sourceA: value })}>
              {Object.entries(terrainSources).map(([key, config]) => (
                <div key={key} className="flex items-center gap-2">
                  <RadioGroupItem value={key} id={`source-${key}`} className="cursor-pointer" />
                  <Label htmlFor={`source-${key}`} className="flex-1 text-sm cursor-pointer">
                    {config.name}
                  </Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer">
                              <Info className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-lg">
                            <DialogHeader>
                              <DialogTitle>{config.name}</DialogTitle>
                              <DialogDescription>{config.description}</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 text-sm">
                              <div>
                                <span className="font-semibold">Link:</span>
                                <div className="flex items-center gap-2 mt-1">
                                  <a
                                    href={config.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline flex-1 truncate"
                                  >
                                    {config.link}
                                  </a>
                                </div>
                              </div>
                              <div>
                                <span className="font-semibold">Encoding Type:</span> {config.encoding}
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-semibold">URL Template:</span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 cursor-pointer"
                                    onClick={() => copyToClipboard(config.sourceConfig.tiles[0])}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                </div>
                                <code className="block p-3 bg-muted rounded text-xs break-all">
                                  {config.sourceConfig.tiles[0]}
                                </code>
                              </div>
                              <div>
                                <span className="font-semibold">Max Zoom:</span> {config.sourceConfig.maxzoom}
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>View source details</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 cursor-pointer"
                    onClick={() => window.open(config.link, "_blank")}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </RadioGroup>
          )}
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* MOVED: Download section between Terrain Source and Visualization Modes */}
      <Collapsible open={isDownloadOpen} onOpenChange={setIsDownloadOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          Download
          <ChevronDown className={`h-4 w-4 transition-transform ${isDownloadOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-1">
          <div className="flex gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* ADDED: Make export button right-clickable to copy URL, add spinner */}
                  <Button
                    variant="outline"
                    className="flex-[2] bg-transparent cursor-pointer"
                    onClick={exportDTM}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const url = getTitilerDownloadUrl()
                      copyToClipboard(url)
                    }}
                    disabled={isExporting}
                  >
                    {isExporting ? (
                      <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Export DTM
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Export DTM as GeoTIFF (raw Float32 elevation values)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" className="flex-1 bg-transparent cursor-pointer" onClick={takeScreenshot}>
                    <Camera className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    Export Screenshot (composited with hillshade, hypsometric tint, raster basemap, etc) - warning, WIP
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    className="flex-1 bg-transparent cursor-pointer"
                    onClick={() => {
                      const url = getSourceUrl()
                      copyToClipboard(url)
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    Copy TMS/XYZ tileset source URL, uses {terrainSources[state.sourceA].encoding} encoding
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-xs text-muted-foreground">
            Export terrain as GeoTIFF via Titiler, take screenshot, or copy source URL for QGIS
          </p>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      <Collapsible open={isVizModesOpen} onOpenChange={setIsVizModesOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          Visualization Modes
          <ChevronDown className={`h-4 w-4 transition-transform ${isVizModesOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-1">
          {/* Hillshade */}
          <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
            <Checkbox
              id="hillshade"
              checked={state.showHillshade}
              onCheckedChange={(checked) => setState({ showHillshade: checked })}
              className="cursor-pointer"
            />
            <Label htmlFor="hillshade" className="text-sm cursor-pointer">
              Hillshade
            </Label>
            <Slider
              value={[state.hillshadeOpacity]}
              onValueChange={([value]) => setState({ hillshadeOpacity: value })}
              min={0}
              max={1}
              step={0.1}
              className="cursor-pointer"
              disabled={!state.showHillshade}
            />
          </div>

          {/* Hypsometric Tint */}
          <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
            <Checkbox
              id="color-relief"
              checked={state.showColorRelief}
              onCheckedChange={(checked) => setState({ showColorRelief: checked })}
              className="cursor-pointer"
            />
            <Label htmlFor="color-relief" className="text-sm cursor-pointer">
              Hypso Tint
            </Label>
            <Slider
              value={[state.colorReliefOpacity]}
              onValueChange={([value]) => setState({ colorReliefOpacity: value })}
              min={0}
              max={1}
              step={0.1}
              className="cursor-pointer"
              disabled={!state.showColorRelief}
            />
          </div>

          {/* Contour Lines */}
          <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
            <Checkbox
              id="contours"
              checked={state.showContours}
              onCheckedChange={(checked) => setState({ showContours: checked })}
              className="cursor-pointer"
            />
            <Label htmlFor="contours" className="text-sm cursor-pointer col-span-2">
              Contour Lines
            </Label>
          </div>

          <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
            <Checkbox
              id="terrain-raster"
              checked={state.showTerrain}
              onCheckedChange={(checked) => setState({ showTerrain: checked })}
              className="cursor-pointer"
            />
            <Label htmlFor="terrain-raster" className="text-sm cursor-pointer">
              Raster Basemap
            </Label>
            <Slider
              value={[state.terrainOpacity]}
              onValueChange={([value]) => setState({ terrainOpacity: value })}
              min={0}
              max={1}
              step={0.1}
              className="cursor-pointer"
              disabled={!state.showTerrain}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {state.showHillshade && (
        <>
          <Collapsible open={isHillshadeOpen} onOpenChange={setIsHillshadeOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
              Hillshade Options
              <ChevronDown className={`h-4 w-4 transition-transform ${isHillshadeOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-1">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Hillshade Method</Label>
                <div className="flex gap-2">
                  <Select value={state.hillshadeMethod} onValueChange={(value) => setState({ hillshadeMethod: value })}>
                    <SelectTrigger className="flex-1 cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="combined">Combined</SelectItem>
                      <SelectItem value="igor">Igor</SelectItem>
                      <SelectItem value="basic">Basic</SelectItem>
                      <SelectItem value="multidirectional">Multidirectional</SelectItem>
                      <SelectItem value="multidir-colors">Multidir Colors</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex border rounded-md shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cycleHillshadeMethod(-1)}
                      className="rounded-r-none border-r cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cycleHillshadeMethod(1)}
                      className="rounded-l-none cursor-pointer"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {supportsIlluminationDirection && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Illumination Direction</Label>
                    <span className="text-sm text-muted-foreground">{state.illuminationDir}°</span>
                  </div>
                  <Slider
                    value={[state.illuminationDir]}
                    onValueChange={([value]) => setState({ illuminationDir: value })}
                    min={0}
                    max={360}
                    step={1}
                    className="cursor-pointer"
                  />
                </div>
              )}

              {supportsIlluminationAltitude && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Illumination Altitude</Label>
                    <span className="text-sm text-muted-foreground">{state.illuminationAlt}°</span>
                  </div>
                  <Slider
                    value={[state.illuminationAlt]}
                    onValueChange={([value]) => setState({ illuminationAlt: value })}
                    min={0}
                    max={90}
                    step={1}
                    className="cursor-pointer"
                  />
                </div>
              )}

              {supportsExaggeration && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Hillshade Exaggeration</Label>
                    <span className="text-sm text-muted-foreground">{state.hillshadeExag.toFixed(1)}</span>
                  </div>
                  <Slider
                    value={[state.hillshadeExag]}
                    onValueChange={([value]) => setState({ hillshadeExag: value })}
                    min={0}
                    max={1}
                    step={0.1}
                    className="cursor-pointer"
                  />
                </div>
              )}

              {(supportsShadowColor || supportsHighlightColor || supportsAccentColor) && (
                <Collapsible open={isColorsOpen} onOpenChange={setIsColorsOpen}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                    Hillshade Colors
                    <ChevronDown className={`h-4 w-4 transition-transform ${isColorsOpen ? "rotate-180" : ""}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 pt-1">
                    <div
                      className="grid gap-2"
                      style={{
                        gridTemplateColumns: supportsAccentColor ? "repeat(3, 1fr)" : "repeat(2, 1fr)",
                      }}
                    >
                      {supportsShadowColor && (
                        <div className="space-y-1">
                          <Label className="text-xs">Shadow</Label>
                          <Input
                            type="color"
                            value={state.shadowColor}
                            onChange={(e) => setState({ shadowColor: e.target.value })}
                            className="h-9 p-1 cursor-pointer border-none"
                          />
                        </div>
                      )}
                      {supportsHighlightColor && (
                        <div className="space-y-1">
                          <Label className="text-xs">Highlight</Label>
                          <Input
                            type="color"
                            value={state.highlightColor}
                            onChange={(e) => setState({ highlightColor: e.target.value })}
                            className="h-9 p-1 cursor-pointer border-none"
                          />
                        </div>
                      )}
                      {supportsAccentColor && (
                        <div className="space-y-1">
                          <Label className="text-xs">Accent</Label>
                          <Input
                            type="color"
                            value={state.accentColor}
                            onChange={(e) => setState({ accentColor: e.target.value })}
                            className="h-9 p-1 cursor-pointer border-none"
                          />
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CollapsibleContent>
          </Collapsible>
          <Separator />
        </>
      )}

      {state.showColorRelief && (
        <>
          <Collapsible open={isHypsoOpen} onOpenChange={setIsHypsoOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
              Hypsometric Tint Options
              <ChevronDown className={`h-4 w-4 transition-transform ${isHypsoOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-1">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Color Ramp</Label>
                <div className="flex gap-2">
                  <Select value={state.colorRamp} onValueChange={(value) => setState({ colorRamp: value })}>
                    <SelectTrigger className="flex-1 cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(colorRamps).map(([key, ramp]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-12 h-4 rounded-sm"
                              style={{
                                background: `linear-gradient(to right, ${getGradientColors(ramp.colors)})`,
                              }}
                            />
                            <span>{ramp.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex border rounded-md shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cycleColorRamp(-1)}
                      className="rounded-r-none border-r cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cycleColorRamp(1)}
                      className="rounded-l-none cursor-pointer"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="advanced-ramps"
                  checked={showAdvancedRamps}
                  onCheckedChange={(checked) => setShowAdvancedRamps(!!checked)}
                  className="cursor-pointer"
                  disabled
                />
                <Label htmlFor="advanced-ramps" className="text-sm cursor-pointer text-muted-foreground">
                  Load advanced color ramps (cpt2js)
                </Label>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <Separator />
        </>
      )}

      {state.showTerrain && (
        <>
          <Collapsible open={isTerrainRasterOpen} onOpenChange={setIsTerrainRasterOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
              Raster Basemap Options
              <ChevronDown className={`h-4 w-4 transition-transform ${isTerrainRasterOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-1">
              <div className="space-y-2">
                <Label className="text-sm">Source</Label>
                <div className="flex gap-2">
                  <Select value={state.terrainSource} onValueChange={(value) => setState({ terrainSource: value })}>
                    <SelectTrigger className="flex-1 cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="osm">OpenStreetMap</SelectItem>
                      <SelectItem value="google">Google Satellite</SelectItem>
                      <SelectItem value="esri">ESRI World Imagery</SelectItem>
                      <SelectItem value="bing">Bing Aerial</SelectItem>
                      <SelectItem value="mapbox">Mapbox Satellite</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex border rounded-md shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cycleTerrainSource(-1)}
                      className="rounded-r-none border-r cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cycleTerrainSource(1)}
                      className="rounded-l-none cursor-pointer"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <Separator />
        </>
      )}

      {state.showContours && (
        <>
          <Collapsible open={isContoursOpen} onOpenChange={setIsContoursOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
              Contour Options
              <ChevronDown className={`h-4 w-4 transition-transform ${isContoursOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-1">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Minor Interval (m)</Label>
                  <span className="text-sm text-muted-foreground">{state.contourMinor}m</span>
                </div>
                <Slider
                  value={[state.contourMinor]}
                  onValueChange={([value]) => setState({ contourMinor: value })}
                  min={10}
                  max={100}
                  step={10}
                  className="cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Major Interval (m)</Label>
                  <span className="text-sm text-muted-foreground">{state.contourMajor}m</span>
                </div>
                <Slider
                  value={[state.contourMajor]}
                  onValueChange={([value]) => setState({ contourMajor: value })}
                  min={50}
                  max={500}
                  step={50}
                  className="cursor-pointer"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
          <Separator />
        </>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p>Inspired by:</p>
        <ul className="space-y-0.5">
          <li className="flex items-center justify-between">
            <a
              href="https://tangrams.github.io/heightmapper/#6.65833/43.860/10.023"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline flex-1 cursor-pointer"
            >
              Tangram Height Mapper
            </a>
            <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
          </li>
          <li className="flex items-center justify-between">
            <a
              href="https://impasto.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline flex-1 cursor-pointer"
            >
              Impasto CAS Viewer
            </a>
            <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
          </li>
        </ul>
      </div>
    </Card>
  )
}

function getGradientColors(colors: any[]): string {
  const colorValues: string[] = []
  for (let i = 4; i < colors.length; i += 2) {
    if (i < colors.length) {
      colorValues.push(colors[i])
    }
  }
  if (colorValues.length < 2) {
    colorValues.push(colorValues[0] || "#000000")
  }
  return colorValues.join(", ")
}
