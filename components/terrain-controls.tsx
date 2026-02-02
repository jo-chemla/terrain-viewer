"use client"

import type React from "react"
import { useState, useCallback, useMemo, useRef, useEffect, forwardRef } from "react"
import { useAtom } from "jotai"
import {
  Camera, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Info,
  Moon, PanelRightClose, PanelRightOpen, RotateCcw, Settings, Sun, Plus, Edit, Trash2, Globe, MapPin,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { terrainSources } from "@/lib/terrain-sources"
import { colorRamps, extractStops, colorRampsFlat } from "@/lib/color-ramps"
import { buildGdalWmsXml } from "@/lib/build-gdal-xml"
import {
  mapboxKeyAtom, googleKeyAtom, maptilerKeyAtom, titilerEndpointAtom, maxResolutionAtom, themeAtom,
  isGeneralOpenAtom, isTerrainSourceOpenAtom, isVizModesOpenAtom, isHillshadeOpenAtom, isTerrainRasterOpenAtom,
  isHypsoOpenAtom, isContoursOpenAtom, isDownloadOpenAtom, customTerrainSourcesAtom, isByodOpenAtom, useCogProtocolVsTitilerAtom, colorRampTypeAtom, licenseFilterAtom, isBackgroundOpenAtom, skyConfigAtom,
  type CustomTerrainSource,
} from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"
import { domToPng } from "modern-screenshot"
import { fromArrayBuffer, writeArrayBuffer } from "geotiff"
import saveAs from "file-saver"
import type { TerrainSource } from "@/lib/terrain-types"
import { Light as SyntaxHighlighter } from "react-syntax-highlighter"
import xml from "react-syntax-highlighter/dist/esm/languages/hljs/xml"
import bash from "react-syntax-highlighter/dist/esm/languages/hljs/bash"
import { vs } from "react-syntax-highlighter/dist/esm/styles/hljs"
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs"
import { Eye, EyeOff } from 'lucide-react';
import { getCogMetadata } from '@geomatico/maplibre-cog-protocol';

SyntaxHighlighter.registerLanguage("xml", xml)
SyntaxHighlighter.registerLanguage("bash", bash)


interface TerrainControlsProps {
  state: any
  setState: (updates: any) => void
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  mapRef: React.RefObject<MapRef>
}

interface SourceConfig {
  encoding: string
  tileUrl: string
  tileSize: number
}
type Bounds = { west: number; east: number; north: number; south: number }

const useTheme = () => {
  const [theme, setTheme] = useAtom(themeAtom)
  const toggleTheme = useCallback(() => setTheme(theme === "light" ? "dark" : "light"), [theme, setTheme])
  return { theme, toggleTheme }
}


// Reusable PasswordInput component that manages its own visibility state
const PasswordInput = forwardRef(({ className, ...props }, ref) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative">
      <Input
        type={showPassword ? "text" : "password"}
        className={`pr-10 ${className || ''}`}
        ref={ref}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
        onClick={() => setShowPassword(!showPassword)}
      >
        {showPassword ? (
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Eye className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
});

const useSourceConfig = () => {
  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)
  const [googleKey] = useAtom(googleKeyAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)

  const getTilesUrl = useCallback((key: TerrainSource): string => {
    const source = terrainSources[key]
    let tileUrl = source.sourceConfig.tiles[0] || ""
    if (key === "mapbox") tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
    else if (key === "maptiler") tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")
    else if (key === "google3dtiles") tileUrl = tileUrl.replace("{API_KEY}", googleKey || "")
    return tileUrl
  }, [mapboxKey, maptilerKey, googleKey])

  const getCustomSourceUrl = useCallback((source: CustomTerrainSource): string => {
    if (source.type === "cog") {
      return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?url=${encodeURIComponent(source.url)}&algorithm=terrarium`
    }
    return source.url
  }, [titilerEndpoint])

  const getSourceConfig = useCallback((sourceKey: string): SourceConfig | null => {
    if (terrainSources[sourceKey]) {
      const source = terrainSources[sourceKey]
      return { encoding: source.encoding, tileUrl: getTilesUrl(sourceKey), tileSize: source.sourceConfig.tileSize || 256 }
    }
    const customSource = customTerrainSources.find((s) => s.id === sourceKey)
    if (customSource) {
      const encoding = customSource.type === "terrainrgb" ? "terrainrgb" : "terrarium"
      const tileUrl = getCustomSourceUrl(customSource)
      return { encoding, tileUrl, tileSize: 256 }
    }
    return null
  }, [customTerrainSources, getTilesUrl, getCustomSourceUrl])

  return { getTilesUrl, getSourceConfig, getCustomSourceUrl }
}

const Section: React.FC<{
  title: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
  children: React.ReactNode
}> = ({ title, isOpen, onOpenChange, withSeparator = true, children }) => (
  <>
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
        {title}
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1">{children}</CollapsibleContent>
    </Collapsible>
    {withSeparator && <Separator />}
  </>
)

const SliderControl: React.FC<{
  label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number
  suffix?: string; decimals?: number; disabled?: boolean
}> = ({ label, value, onChange, min, max, step, suffix = "", decimals = 0, disabled = false }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <span className="text-sm text-muted-foreground">{value.toFixed(decimals)}{suffix}</span>
    </div>
    <Slider value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} className="cursor-pointer" disabled={disabled} />
  </div>
)

const CheckboxWithSlider: React.FC<{
  id: string; label: string; checked: boolean; onCheckedChange: (checked: boolean) => void
  sliderValue: number; onSliderChange: (value: number) => void; hideSlider?: boolean
}> = ({ id, label, checked, onCheckedChange, sliderValue, onSliderChange, hideSlider = false }) => (
  <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
    <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} className="cursor-pointer" />
    <Label htmlFor={id} className={`text-sm cursor-pointer ${hideSlider ? "col-span-2" : ""}`}>{label}</Label>
    {!hideSlider && (
      <Slider value={[sliderValue]} onValueChange={([v]) => onSliderChange(v)} min={0} max={1} step={0.1} className="cursor-pointer" disabled={!checked} />
    )}
  </div>
)

const CycleButtonGroup: React.FC<{
  value: string; options: { value: string; label: string | JSX.Element }[]
  onChange: (value: string) => void; onCycle: (direction: number) => void
}> = ({ value, options, onChange, onCycle }) => (
  <div className="flex gap-2">
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="flex-1 cursor-pointer"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
      </SelectContent>
    </Select>
    <div className="flex border rounded-md shrink-0">
      <Button variant="ghost" size="icon" onClick={() => onCycle(-1)} className="rounded-r-none border-r cursor-pointer">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onCycle(1)} className="rounded-l-none cursor-pointer">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  </div>
)


const getGradientColors = (colors: any[]): string => {
  const colorValues: string[] = []
  for (let i = 4; i < colors.length; i += 2) {
    if (i < colors.length) colorValues.push(colors[i])
  }
  if (colorValues.length < 2) colorValues.push(colorValues[0] || "#000000")
  return colorValues.join(", ")
}

const templateLink = (link: string, lat: string, lng: string): string => link.replace("{LAT}", lat).replace("{LNG}", lng)
const copyToClipboard = (text: string) => navigator.clipboard.writeText(text)

const SettingsDialog: React.FC<{ isOpen: boolean; onOpenChange: (open: boolean) => void }> = ({ isOpen, onOpenChange }) => {
  const { theme, toggleTheme } = useTheme()
  const [mapboxKey, setMapboxKey] = useAtom(mapboxKeyAtom)
  const [googleKey, setGoogleKey] = useAtom(googleKeyAtom)
  const [maptilerKey, setMaptilerKey] = useAtom(maptilerKeyAtom)
  const [titilerEndpoint, setTitilerEndpoint] = useAtom(titilerEndpointAtom)
  const [maxResolution, setMaxResolution] = useAtom(maxResolutionAtom)
  const [batchEditMode, setBatchEditMode] = useState(false)
  const [batchApiKeys, setBatchApiKeys] = useState("")
  const [useCogProtocolVsTitiler, setUseCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)

  const handleBatchToggle = useCallback(() => {
    if (!batchEditMode) {
      setBatchApiKeys([`maptiler_api_key=${maptilerKey}`, `mapbox_access_token=${mapboxKey}`, `google_api_key=${googleKey}`].join("\n"))
    } else {
      batchApiKeys.split("\n").forEach((line) => {
        const [key, value] = line.split("=")
        if (key && value) {
          if (key.trim() === "maptiler_api_key") setMaptilerKey(value.trim())
          if (key.trim() === "mapbox_access_token") setMapboxKey(value.trim())
          if (key.trim() === "google_api_key") setGoogleKey(value.trim())
        }
      })
    }
    setBatchEditMode(!batchEditMode)
  }, [batchEditMode, batchApiKeys, mapboxKey, googleKey, maptilerKey, setMapboxKey, setGoogleKey, setMaptilerKey])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" className="cursor-pointer"><Settings className="h-5 w-5" /></Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto" showCloseButton={false}>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
        <DialogHeader>
          <DialogTitle>Settings & Resources</DialogTitle>
          <DialogDescription>Configure API keys, application settings, and explore related resources</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Appearance</h3>
            <div className="flex items-center justify-between">
              <Label>Theme</Label>
              <Button variant="outline" size="sm" onClick={toggleTheme} className="cursor-pointer">
                {theme === "light" ? <><Moon className="h-4 w-4 mr-2" />Dark</> : <><Sun className="h-4 w-4 mr-2" />Light</>}
              </Button>
            </div>
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">API Keys</h3>
              <Button variant="outline" size="sm" onClick={handleBatchToggle} className="cursor-pointer">{batchEditMode ? "Save" : "Batch Edit"}</Button>
            </div>
            {batchEditMode ? (
              <div className="space-y-2">
                <Label htmlFor="batch-keys">API Keys (one per line: key=value)</Label>
                <textarea id="batch-keys" className="w-full min-h-[120px] p-2 border rounded-md font-mono text-sm" value={batchApiKeys} onChange={(e) => setBatchApiKeys(e.target.value)} />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="maptiler-key">MapTiler API Key</Label>
                  <PasswordInput
                    id="maptiler-key"
                    value={maptilerKey}
                    onChange={(e) => setMaptilerKey(e.target.value)}
                    className="cursor-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mapbox-key">Mapbox Access Token</Label>
                  <PasswordInput
                    id="mapbox-key"
                    value={mapboxKey}
                    onChange={(e) => setMapboxKey(e.target.value)}
                    className="cursor-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="google-key">Google Maps API Key</Label>
                  <PasswordInput
                    id="google-key"
                    value={googleKey}
                    onChange={(e) => setGoogleKey(e.target.value)}
                    className="cursor-text"
                  />
                </div>
              </>
            )}
          </div>
          <Separator />


          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">COG Streaming Settings</Label>
              <ToggleGroup
                type="single"
                value={useCogProtocolVsTitiler ? "cogprotocol" : "titiler"}
                onValueChange={(value) => value && setUseCogProtocolVsTitiler(value == "cogprotocol")}
                className="border rounded-md"
              // disabled
              >
                <ToggleGroupItem
                  value="cogprotocol"
                  className="px-3 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
                >
                  MapLibre
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="titiler"
                  className="px-3 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
                >
                  Titiler
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
              <p className="mb-1">
                <span className="font-semibold">MapLibre COG Protocol from Geomatico:</span> Direct COG client consumption.
                Faster and avoids overflooding Titiler, but may encounter CORS errors
                (bypass via Allow-CORS browser plugin or enabling CORS on the COG server).
              </p>
              <p>
                <span className="font-semibold">Titiler:</span> Middleware service that fetches remote COG
                and streams TMS tiles via TMS endpoint (assembles COG tiles from downsampled, memory-contiguous fetches to the COG hierarchy).
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="titiler-endpoint">Titiler Endpoint</Label>
              <Input id="titiler-endpoint" type="text" placeholder="https://titiler.xyz" value={titilerEndpoint} onChange={(e) => setTitilerEndpoint(e.target.value)} className="cursor-text" />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="max-resolution">Max Download Resolution (px)</Label>
              <Input id="max-resolution" type="number" placeholder="4096" value={maxResolution} onChange={(e) => setMaxResolution(Number.parseFloat(e.target.value))} className="cursor-text" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">The max resolution limit for GeoTIFF DEM download via Titiler is usually 2k to 4k. If higher-resolution is needed, use the QGIS or GDAL workflows described in the panel for each source details.</p>

          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Terrain Encoding Functions</h3>
            <div className="space-y-2 text-sm font-mono bg-muted p-3 rounded">
              <div><span className="font-semibold">TerrainRGB:</span><br /><code>height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)</code></div>
              <div className="mt-2"><span className="font-semibold">Terrarium:</span><br /><code>height = (R * 256 + G + B / 256) - 32768</code></div>
            </div>
          </div>
          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">MapLibre GL Features</h3>
            <div className="space-y-2 text-sm">

              <a href="https://github.com/maplibre/maplibre-style-spec/issues/1374" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>New Normal-Derived Methods like slope, aspect etc (Design Proposal #1374)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
              <a href="https://github.com/maplibre/maplibre-gl-js/pull/5768" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>Additional Hillshade Methods (combined, igor, multidir, PR #5768)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
              <a href="https://github.com/maplibre/maplibre-gl-js/pull/5913" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>Hypsometric Tint color-relief (PR #5913)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
              <a href="https://github.com/maplibre/maplibre-style-spec/issues/583#issuecomment-2028639772" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>Contour Lines and onthegomap/maplibre-contour plugin (Issue #583)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
              <a href="https://labs.geomatico.es/maplibre-cog-protocol-examples/#/en/pirineo" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>Geomatico COG Protocol for Maplibre</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
              <a href="https://github.com/maplibre/maplibre-gl-js/discussions/3378" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>3D Tiles early Discussion (#3378)</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
            </div>
          </div>
          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Color Ramp Resources</h3>
            <div className="space-y-2 text-sm">
              <a href="http://seaviewsensing.com/pub/cpt-city/views/topobath.html" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>CPT City - Topobath</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
              <a href="http://seaviewsensing.com/pub/cpt-city/views/topo.html" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>CPT City - Topo</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
              <a href="https://www.npmjs.com/package/cpt2js" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                <span>cpt2js Package</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
              </a>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog >
  )
}


export const GdalTabs: React.FC<{
  tileUrl: string
  wmsXml: string
  gdalCommand: string
}> = ({ tileUrl, wmsXml, gdalCommand }) => {
  const [activeTab, setActiveTab] = useState("url")

  const handleCopy = () => {
    if (activeTab === "url") copyToClipboard(tileUrl)
    else if (activeTab === "xml") copyToClipboard(wmsXml)
    else copyToClipboard(gdalCommand)
  }

  return (
    <Tabs
      defaultValue="url"
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full"
    >
      <div className="bg-muted/60 dark:bg-zinc-900 rounded-lg overflow-hidden border border-border">
        {/* --- Header with tabs and copy --- */}
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <TabsList className="bg-transparent p-0 space-x-1">
            <TabsTrigger
              value="url"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground cursor-pointer rounded-md"
            >
              URL Template
            </TabsTrigger>
            <TabsTrigger
              value="xml"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground cursor-pointer rounded-md"
            >
              GDAL_WMS XML
            </TabsTrigger>
            <TabsTrigger
              value="cmd"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground cursor-pointer rounded-md"
            >
              gdal_translate
            </TabsTrigger>
          </TabsList>



          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={handleCopy}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{
              activeTab === "url"
                ? "Copy TMS URL template"
                : activeTab === "xml"
                  ? "Copy GDAL_WMS XML"
                  : "Copy gdal_translate command"
            }</p></TooltipContent>
          </Tooltip>


        </div>

        {/* --- Tab content--- */}
        <div className="max-h-64 overflow-auto">
          <TabsContent value="url" className="p-3 pt-2 text-xs font-mono">
            <SyntaxHighlighter
              language="bash"
              style={atomOneDark}
              customStyle={{
                background: "transparent",
                fontSize: "0.75rem",
                margin: 0,
                padding: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              wrapLongLines
            >
              {tileUrl}
            </SyntaxHighlighter>
          </TabsContent>

          <TabsContent value="xml" className="p-3 pt-2 text-xs font-mono">
            <SyntaxHighlighter
              language="xml"
              style={atomOneDark}
              customStyle={{
                background: "transparent",
                fontSize: "0.75rem",
                margin: 0,
                padding: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              wrapLongLines
            >
              {wmsXml}
            </SyntaxHighlighter>
          </TabsContent>

          <TabsContent value="cmd" className="p-3 pt-2 text-xs font-mono">
            <SyntaxHighlighter
              language="bash"
              style={atomOneDark}
              customStyle={{
                background: "transparent",
                fontSize: "0.75rem",
                margin: 0,
                padding: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              wrapLongLines
            >
              {gdalCommand}
            </SyntaxHighlighter>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  )
}

const SourceInfoDialog: React.FC<{ sourceKey: string; config: any; getTilesUrl: (key: string) => string; getMapBounds: () => Bounds }> = ({ sourceKey, config, getTilesUrl, getMapBounds }) => {
  const [maxResolution] = useAtom(maxResolutionAtom)

  const bounds = getMapBounds()
  const tileUrl = getTilesUrl(sourceKey)
  const wmsXml = buildGdalWmsXml(tileUrl, config.sourceConfig.tileSize || 256)

  // Make single-line, word-wrapped command
  const gdalCommand = `gdal_translate -outsize ${maxResolution} 0 -projwin ${bounds.west} ${bounds.north} ${bounds.east} ${bounds.south} -projwin_srs EPSG:4326 "${wmsXml}" output.tif`

  return (
    <Dialog>

      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="cursor-pointer">
          <Tooltip>
            <TooltipTrigger asChild>
              <span><Info className="h-4 w-4" /></span>
            </TooltipTrigger>
            <TooltipContent>View source details</TooltipContent>
          </Tooltip>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{config.name}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">
          ✕
        </DialogClose>

        <div className="space-y-4 text-sm">
          {/* --- Link --- */}
          <div>
            <span className="font-semibold">Link:</span>
            <div className="flex items-center gap-2 mt-1">
              <a
                href={config.link.split("#")[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline flex-1 truncate"
              >
                {config.link.split("#")[0]}
              </a>
            </div>
          </div>

          <div>
            <span className="font-semibold">Encoding Type:</span> {config.encoding}
          </div>

          {/* --- GDAL Tabs --- */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold">GDAL & TMS Access:</span>
            </div>

            <GdalTabs tileUrl={tileUrl} wmsXml={wmsXml} gdalCommand={gdalCommand} />
          </div>

          {/* --- QGIS Procedure --- */}
          <div>
            <h4 className="font-semibold mb-1">High-resolution QGIS DEM export</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Copy the DEM source URL</li>
              <li>In QGIS, go to <em>Layers → Add Layers → TMS/XYZ Layer</em></li>
              <li>Paste the templated source URL</li>
              <li>Use encoding <strong>{config.encoding}</strong> (bottom dropdown)</li>
              <li>Set tile resolution <strong>{config.sourceConfig.tileSize || 256}</strong></li>
              <li>
                Use your desired symbology or export raw elevation data (avoid color-coded values).
                Optionally apply elevation formulas in <em>Raster Calculator</em> (Settings modal).
              </li>
              <li>You can also use the <strong>gdal_translate</strong> command above with your bounds.</li>
            </ul>
          </div>

          <div>
            <span className="font-semibold">Max Zoom:</span> {config.sourceConfig.maxzoom}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const GeneralSettings: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isGeneralOpenAtom)
  return (
    <Section title="General Settings" isOpen={isOpen} onOpenChange={setIsOpen} withSeparator={true}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">View Mode</Label>
        <ToggleGroup type="single" value={state.viewMode} onValueChange={(value) => value && setState({ viewMode: value })} className="border rounded-md w-[140px]">
          <ToggleGroupItem value="2d" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">2D</ToggleGroupItem>
          <ToggleGroupItem value="globe" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"><Globe className="h-4 w-4 text-foreground" /></ToggleGroupItem>
          <ToggleGroupItem value="3d" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">3D</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">Split Screen</Label>
        <ToggleGroup type="single" value={state.splitScreen ? "on" : "off"} onValueChange={(value) => value && setState({ splitScreen: value === "on" })} className="border rounded-md w-[140px]">
          <ToggleGroupItem value="off" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">Off</ToggleGroupItem>
          <ToggleGroupItem value="on" className="flex-1 cursor-pointer data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal">On</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {(state.viewMode === "3d" || state.viewMode === "globe") && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Terrain Exaggeration</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{state.exaggeration.toFixed(1)}x</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={() => setState({ exaggeration: 1 })}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <Slider value={[state.exaggeration]} onValueChange={([value]) => setState({ exaggeration: value })} min={0.1} max={10} step={0.1} className="cursor-pointer" />
        </div>
      )}
    </Section>
  )
}


const CustomSourceModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomTerrainSource | null
  onSave: (source: Omit<CustomTerrainSource, "id"> & { id?: string }) => void
}> = ({ isOpen, onOpenChange, editingSource, onSave }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [type, setType] = useState<"cog" | "terrainrgb" | "terrarium" | "vrt">("cog")
  const [description, setDescription] = useState("")

  useEffect(() => {
    if (editingSource) {
      setName(editingSource.name)
      setUrl(editingSource.url)
      setType(editingSource.type)
      setDescription(editingSource.description || "")
    } else {
      setName("")
      setUrl("")
      setType("cog")
      setDescription("")
    }
  }, [editingSource, isOpen])

  const handleSave = useCallback(() => {
    if (!name || !url) return
    onSave({ id: editingSource?.id, name, url, type, description })
    onOpenChange(false)
  }, [name, url, type, description, editingSource, onSave, onOpenChange])

  const url_placeholder = type === "cog" ?
    "https://example.com/terrain-dtm.cog.tiff" :
    "https://example.com/tms/{z}/{x}/{y}.png"

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{editingSource ? "Edit Terrain Dataset" : "Add New Terrain Dataset"}</DialogTitle>
          <DialogDescription>Add your own terrain data source from a TerrainRGB, Terrarium or COG endpoint.</DialogDescription>
        </DialogHeader>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-name">Name *</Label>
            <Input id="source-name" type="text" placeholder="My Custom Terrain" value={name} onChange={(e) => setName(e.target.value)} className="cursor-text" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-url">URL *</Label>
            <Input id="source-url" type="text" placeholder={url_placeholder} value={url} onChange={(e) => setUrl(e.target.value)} className="cursor-text" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-type">Type *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
              <SelectTrigger id="source-type" className="cursor-pointer w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cog">COG (Cloud Optimized GeoTIFF)</SelectItem>
                <SelectItem value="terrainrgb">TMS (TerrainRGB)</SelectItem>
                <SelectItem value="terrarium">TMS (Terrarium)</SelectItem>
                <SelectItem value="vrt">VRT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-description">Description (optional)</Label>
            <Input id="source-description" type="text" placeholder="Custom terrain data from..." value={description} onChange={(e) => setDescription(e.target.value)} className="cursor-text" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
            <Button onClick={handleSave} disabled={!name || !url} className="cursor-pointer">{editingSource ? "Save Changes" : "Add Source"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const SourceDetails: React.FC<{
  sourceKey: string; config: any; getTilesUrl: any; linkCallback: any; getMapBounds: () => Bounds
}> = ({ sourceKey, config, getTilesUrl, linkCallback, getMapBounds }) => (
  <>
    <Label htmlFor={`source-${sourceKey}`} className={`flex-1 text-sm ${sourceKey !== "google3dtiles" ? "cursor-pointer" : "cursor-not-allowed"}`}>
      {config.name}
    </Label>
    <SourceInfoDialog sourceKey={sourceKey} config={config} getTilesUrl={getTilesUrl} getMapBounds={getMapBounds} />
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={linkCallback(config.link)}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent><p>Open documentation</p></TooltipContent>
    </Tooltip>
  </>
)

const CustomSourceDetails: React.FC<{
  source: any; handleFitToBounds: any; handleEditSource: any; handleDeleteCustomSource: any
}> = ({ source, handleFitToBounds, handleEditSource, handleDeleteCustomSource }) => (
  <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Label htmlFor={`source-${source.id}`} className="flex-1 text-sm cursor-pointer truncate min-w-0">
          {source.name}
        </Label>
      </TooltipTrigger>
      <TooltipContent> <p>{source.name}</p> </TooltipContent>
    </Tooltip>

    {['cog', 'vrt'].includes(source.type) && (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleFitToBounds(source)}>
            <MapPin className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent><p>Fit to bounds</p></TooltipContent>
      </Tooltip>
    )}
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={(e) => handleEditSource(source.id)}>
          <Edit className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent><p>Edit</p></TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleDeleteCustomSource(source.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent><p>Delete</p></TooltipContent>
    </Tooltip>
  </>
)

const TerrainSourceSection: React.FC<{ state: any; setState: (updates: any) => void; getTilesUrl: (key: string) => string; getMapBounds: () => Bounds; mapRef: React.RefObject<MapRef> }> = ({ state, setState, getTilesUrl, getMapBounds, mapRef }) => {
  const [isOpen, setIsOpen] = useAtom(isTerrainSourceOpenAtom)
  const [isByodOpen, setIsByodOpen] = useAtom(isByodOpenAtom)
  const [customTerrainSources, setCustomTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<CustomTerrainSource | null>(null)
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false)
  const [batchEditJson, setBatchEditJson] = useState("")
  const [batchEditError, setBatchEditError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [theme] = useAtom(themeAtom)
  const [useCogProtocolVsTitiler, _] = useAtom(useCogProtocolVsTitilerAtom)

  const linkCallback = useCallback((link: string) => () => window.open(templateLink(link, state.lat, state.lng), "_blank"), [state.lat, state.lng])

  const handleSaveCustomSource = useCallback((source: Omit<CustomTerrainSource, "id"> & { id?: string }) => {
    if (source.id) {
      setCustomTerrainSources(customTerrainSources.map((s) => s.id === source.id ? { ...s, ...source } as CustomTerrainSource : s))
    } else {
      const newSource: CustomTerrainSource = { ...source, id: `custom-${Date.now()}` } as CustomTerrainSource
      setCustomTerrainSources([...customTerrainSources, newSource])
    }
  }, [customTerrainSources, setCustomTerrainSources])

  const handleDeleteCustomSource = useCallback((id: string) => {
    setCustomTerrainSources(customTerrainSources.filter((s) => s.id !== id))
    if (state.sourceA === id) setState({ sourceA: "aws" })
    if (state.sourceB === id) setState({ sourceB: "mapterhorn" })
  }, [customTerrainSources, setCustomTerrainSources, state, setState])

  const handleFitToBounds = useCallback(async (source: CustomTerrainSource) => {

    if (!['cog', 'vrt'].includes(source.type)) return
    try {
      if (useCogProtocolVsTitiler) {
        getCogMetadata(source.url).then(metadata => {
          console.log('COG metadata from geomatico/maplibre-cog-protocol', metadata)
          const bbox = metadata.bbox
          const [west, south, east, north] = bbox
          if (bbox && mapRef.current) {
            mapRef.current.fitBounds([[west, south], [east, north]], { padding: 50, speed: 6 })
          }
        })
      } else {
        // call titiler endpoint to get bounds
        let infoUrl
        if (source.type == 'cog') {
          infoUrl = `${titilerEndpoint}/cog/info.geojson?url=${encodeURIComponent(source.url)}`
        } else if (source.type == 'vrt') {
          infoUrl = `${titilerEndpoint}/cog/info.geojson?url=vrt:///vsicurl/${encodeURIComponent(source.url)}`
        }
        const response = await fetch(infoUrl)
        const data = await response.json()
        console.log('COG info/metadata from titiler', data)
        const bbox = data.bbox ?? data.properties.bounds
        const [west, south, east, north] = bbox
        if (bbox && mapRef.current) {
          mapRef.current.fitBounds([[west, south], [east, north]], { padding: 50, speed: 6 })
        }
      }
    } catch (error) {
      console.error("Failed to fetch COG bounds:", error)
    }
  }, [titilerEndpoint, mapRef, useCogProtocolVsTitiler])

  const handleOpenBatchEdit = useCallback(() => {
    setBatchEditJson(JSON.stringify(customTerrainSources, null, 2))
    setBatchEditError("")
    setIsBatchEditModalOpen(true)
  }, [customTerrainSources])

  const handleSaveBatchEdit = useCallback(() => {
    try {
      const parsed = JSON.parse(batchEditJson)
      if (!Array.isArray(parsed)) {
        setBatchEditError("Input must be a valid JSON array")
        return
      }
      // Validate structure
      for (const source of parsed) {
        if (!source.id || !source.name || !source.url || !source.type) {
          setBatchEditError("Each source must have id, name, url, and type fields")
          return
        }
      }
      setCustomTerrainSources(parsed)
      setIsBatchEditModalOpen(false)
    } catch (error) {
      setBatchEditError("Invalid JSON: " + (error as Error).message)
    }
  }, [batchEditJson, setCustomTerrainSources])

  const handleLoadFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      try {
        JSON.parse(content)
        setBatchEditJson(content)
        setBatchEditError("")
      } catch (error) {
        setBatchEditError("Invalid JSON file: " + (error as Error).message)
      }
    }
    reader.readAsText(file)

    e.target.value = ""
  }, [])

  const handleExportSources = useCallback(() => {
    const blob = new Blob([batchEditJson], { type: "application/json" })
    saveAs(blob, `terrain-sources-${Date.now()}.json`)
  }, [batchEditJson])

  const handleEditSource = useCallback((sourceId: string) => {
    const source = customTerrainSources.find(s => s.id === sourceId)
    if (source) {
      setEditingSource(source)
      setIsAddSourceModalOpen(true)
    } else {
      console.error('Source not found!')
    }
  }, [customTerrainSources])

  return (
    <>
      <Section title="Terrain Source" isOpen={isOpen} onOpenChange={setIsOpen}>
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
                  className={`border rounded-md shrink-0 ${key !== "google3dtiles" ? "cursor-pointer" : "cursor-not-allowed"}`}
                  disabled={key === "google3dtiles"}
                >
                  <ToggleGroupItem value="a" className="px-3 cursor-pointer data-[state=on]:font-bold">A</ToggleGroupItem>
                  <ToggleGroupItem value="b" className="px-3 cursor-pointer data-[state=on]:font-bold">B</ToggleGroupItem>
                </ToggleGroup>
                <SourceDetails sourceKey={key} config={config} getTilesUrl={getTilesUrl} linkCallback={linkCallback} getMapBounds={getMapBounds} />
              </div>
            ))}
          </>
        ) : (
          <RadioGroup value={state.sourceA} onValueChange={(value) => setState({ sourceA: value })}>
            {Object.entries(terrainSources).map(([key, config]) => (
              <div key={key} className="flex items-center gap-2">
                <RadioGroupItem value={key} id={`source-${key}`} className="cursor-pointer" disabled={key === "google3dtiles"} />
                <SourceDetails sourceKey={key} config={config} getTilesUrl={getTilesUrl} linkCallback={linkCallback} getMapBounds={getMapBounds} />
              </div>
            ))}
          </RadioGroup>
        )}

        <Collapsible open={isByodOpen} onOpenChange={setIsByodOpen} className="mt-4">
          <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-m font-medium cursor-pointer pl-2.5">
            Bring Your Own Data
            <ChevronDown className={`h-4 w-4 transition-transform ${isByodOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-2 pt-1">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 cursor-pointer bg-transparent"
                onClick={() => { setEditingSource(null); setIsAddSourceModalOpen(true) }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Dataset
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 cursor-pointer bg-transparent"
                onClick={handleOpenBatchEdit}
              >
                <Edit className="h-3 w-3 mr-2" />
                Batch Edit
              </Button>
            </div>
            {customTerrainSources.length > 0 && (
              <div className="space-y-2">
                {state.splitScreen ? (
                  <>
                    {customTerrainSources.map((source) => (
                      <div key={source.id} className="flex items-center gap-2">
                        <ToggleGroup
                          type="single"
                          value={state.sourceA === source.id ? "a" : state.sourceB === source.id ? "b" : ""}
                          onValueChange={(value) => {
                            if (value === "a") setState({ sourceA: source.id })
                            else if (value === "b") setState({ sourceB: source.id })
                          }}
                          className="border rounded-md shrink-0 cursor-pointer"
                        >
                          <ToggleGroupItem value="a" className="px-3 cursor-pointer data-[state=on]:font-bold">A</ToggleGroupItem>
                          <ToggleGroupItem value="b" className="px-3 cursor-pointer data-[state=on]:font-bold">B</ToggleGroupItem>
                        </ToggleGroup>
                        <CustomSourceDetails {...{ source, handleFitToBounds, handleEditSource, handleDeleteCustomSource }} />
                      </div>
                    ))}
                  </>
                ) : (
                  <RadioGroup value={state.sourceA} onValueChange={(value) => setState({ sourceA: value })}>
                    {customTerrainSources.map((source) => (
                      <div key={source.id} className="flex items-center gap-2 min-w-0">
                        <RadioGroupItem value={source.id} id={`source-${source.id}`} className="cursor-pointer shrink-0" />
                        <CustomSourceDetails {...{ source, handleFitToBounds, handleEditSource, handleDeleteCustomSource }} />

                      </div>
                    ))}
                  </RadioGroup>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </Section>
      <CustomSourceModal isOpen={isAddSourceModalOpen} onOpenChange={setIsAddSourceModalOpen} editingSource={editingSource} onSave={handleSaveCustomSource} />
      <Dialog open={isBatchEditModalOpen} onOpenChange={setIsBatchEditModalOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Batch Edit Terrain Sources</DialogTitle>
            <DialogDescription>
              Edit all custom terrain sources as JSON. Each source must have id, name, url, and type fields.
            </DialogDescription>
          </DialogHeader>
          <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">
            ✕
          </DialogClose>
          <div className="space-y-4 overflow-y-auto px-1">
            <div className="space-y-2">
              <textarea
                className="w-full min-h-[400px] p-3 border rounded-md font-mono text-xs bg-background text-foreground resize-none outline-none focus:ring-2 focus:ring-ring"
                value={batchEditJson}
                onChange={(e) => {
                  setBatchEditJson(e.target.value)
                  setBatchEditError("")
                }}
                spellCheck={false}
                placeholder='[{"id": "custom-1", "name": "My Terrain", "url": "https://...", "type": "cog"}]'
              />
              {batchEditError && (
                <p className="text-sm text-red-500">{batchEditError}</p>
              )}
            </div>
            <div className="flex justify-between gap-2 flex-wrap">
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={handleLoadFile}
                  className="cursor-pointer"
                >
                  <Download className="h-4 w-4 mr-2 rotate-180" />
                  Load File
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportSources}
                  className="cursor-pointer"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsBatchEditModalOpen(false)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveBatchEdit}
                  className="cursor-pointer"
                >
                  Validate & Save
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const VisualizationModesSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isVizModesOpenAtom)
  return (
    <Section title="Visualization Modes" isOpen={isOpen} onOpenChange={setIsOpen}>
      <CheckboxWithSlider id="hillshade" checked={state.showHillshade} onCheckedChange={(checked) => setState({ showHillshade: checked })} label="Hillshade" sliderValue={state.hillshadeOpacity} onSliderChange={(value) => setState({ hillshadeOpacity: value })} />
      <CheckboxWithSlider id="contours" checked={state.showContours} onCheckedChange={(checked) => setState({ showContours: checked })} label="Contour Lines" hideSlider={true} sliderValue={0} onSliderChange={() => null} />
      <CheckboxWithSlider id="color-relief" checked={state.showColorRelief} onCheckedChange={(checked) => setState({ showColorRelief: checked })} label="Elevation Hypso" sliderValue={state.colorReliefOpacity} onSliderChange={(value) => setState({ colorReliefOpacity: value })} />
      <CheckboxWithSlider id="terrain-raster" checked={state.showRasterBasemap} onCheckedChange={(checked) => setState({ showRasterBasemap: checked })} label="Raster Basemap" sliderValue={state.rasterBasemapOpacity} onSliderChange={(value) => setState({ rasterBasemapOpacity: value })} />
      <CheckboxWithSlider id="background" checked={state.showBackground} onCheckedChange={(checked) => setState({ showBackground: checked })} label="Background + Fog/Sky" sliderValue={state.backgroundOpacity} onSliderChange={(value) => setState({ backgroundOpacity: value })} />
    </Section>
  )
}

const HillshadeOptionsSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isHillshadeOpenAtom)
  const [isColorsOpen, setIsColorsOpen] = useState(false)
  const hillshadeMethodKeys = useMemo(() => ["standard", "combined", "igor", "basic", "multidirectional", "multidir-colors"], [])
  const cycleHillshadeMethod = useCallback((direction: number) => {
    const currentIndex = hillshadeMethodKeys.indexOf(state.hillshadeMethod)
    const newIndex = (currentIndex + direction + hillshadeMethodKeys.length) % hillshadeMethodKeys.length
    setState({ hillshadeMethod: hillshadeMethodKeys[newIndex] })
  }, [state.hillshadeMethod, hillshadeMethodKeys, setState])

  const supportsIlluminationDirection = useMemo(() => ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])
  const supportsIlluminationAltitude = useMemo(() => ["combined", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])
  const supportsShadowColor = useMemo(() => ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])
  const supportsHighlightColor = useMemo(() => ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod), [state.hillshadeMethod])
  const supportsAccentColor = useMemo(() => state.hillshadeMethod === "standard", [state.hillshadeMethod])
  const supportsExaggeration = useMemo(() => ["standard", "combined", "multidirectional", "multidir-colors"].includes(state.hillshadeMethod), [state.hillshadeMethod])

  if (!state.showHillshade) return null

  const hillshadeMethodOptions = [
    { value: "combined", label: "Combined" }, { value: "standard", label: "Standard" },
    { value: "multidir-colors", label: "Aspect (Multidir Colors)" }, { value: "igor", label: "Igor" },
    { value: "basic", label: "Basic" }, { value: "multidirectional", label: "Multidirectional" },
    { value: "aspect-multidir", label: "Aspect classic (Multidir Colors)" },
  ]

  return (
    <Section title="Hillshade Options" isOpen={isOpen} onOpenChange={setIsOpen}>
      <div className="space-y-2">
        <Label className="text-sm font-medium">Hillshade Method</Label>
        <CycleButtonGroup value={state.hillshadeMethod} options={hillshadeMethodOptions} onChange={(v) => setState({ hillshadeMethod: v })} onCycle={cycleHillshadeMethod} />
      </div>
      {supportsIlluminationDirection && <SliderControl label="Illumination Direction" value={state.illuminationDir} onChange={(v) => setState({ illuminationDir: v })} min={0} max={360} step={1} suffix="°" />}
      {supportsIlluminationAltitude && <SliderControl label="Illumination Altitude" value={state.illuminationAlt} onChange={(v) => setState({ illuminationAlt: v })} min={0} max={90} step={1} suffix="°" />}
      {supportsExaggeration && <SliderControl label="Hillshade Exaggeration" value={state.hillshadeExag} onChange={(v) => setState({ hillshadeExag: v })} min={0} max={1} step={0.01} decimals={2} />}
      {(supportsShadowColor || supportsHighlightColor || supportsAccentColor) && (
        <Collapsible open={isColorsOpen} onOpenChange={setIsColorsOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
            Hillshade Colors<ChevronDown className={`h-4 w-4 transition-transform ${isColorsOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pt-1">
            <div className="grid gap-2" style={{ gridTemplateColumns: supportsAccentColor ? "repeat(3, 1fr)" : "repeat(2, 1fr)" }}>
              {supportsShadowColor && (<div className="space-y-1"><Label className="text-xs">Shadow</Label><Input type="color" value={state.shadowColor} onChange={(e) => setState({ shadowColor: e.target.value })} className="h-9 p-1 cursor-pointer border-none" /></div>)}
              {supportsHighlightColor && (<div className="space-y-1"><Label className="text-xs">Highlight</Label><Input type="color" value={state.highlightColor} onChange={(e) => setState({ highlightColor: e.target.value })} className="h-9 p-1 cursor-pointer border-none" /></div>)}
              {supportsAccentColor && (<div className="space-y-1"><Label className="text-xs">Accent</Label><Input type="color" value={state.accentColor} onChange={(e) => setState({ accentColor: e.target.value })} className="h-9 p-1 cursor-pointer border-none" /></div>)}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Section>
  )
}

const HypsometricTintOptionsSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isHypsoOpenAtom)
  const [colorRampType, setColorRampType] = useAtom(colorRampTypeAtom)
  const [licenseFilter, setLicenseFilter] = useAtom(licenseFilterAtom)

  function filterColorRamps(colorRamps_, colorRampType_, licenseFilter_) {
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

  function resetCustomMinMax() {
    const stops = extractStops(colorRampsFlat[state.colorRamp].colors)
    const rampMin = Math.min(...stops)
    const rampMax = Math.max(...stops)
    setState({ customMin: rampMin, customMax: rampMax })
  }

  // Filter color ramps based on type and license
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
      {/* Color Ramp Type Toggle */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Color Ramp Type</Label>
        <ToggleGroup
          type="single"
          value={colorRampType}
          onValueChange={(value) => {
            value && setColorRampType(value)
            if (true) {
              const filteredNow = filterColorRamps(colorRamps, value, licenseFilter)
              if (!filteredNow[state.colorRamp]) {
                const first = Object.values(filteredNow)[0].name
                setState({ colorRamp: first.toLowerCase() })
              }
            }
          }}
          className="grid grid-cols-5 w-full"
        >
          <ToggleGroupItem
            value="classic"
            aria-label="Classic color ramps"
            className="w-full data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
          >
            Classic
          </ToggleGroupItem>
          <ToggleGroupItem
            value="topo"
            aria-label="Topo color ramps"
            className="w-full data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
          >
            Topo
          </ToggleGroupItem>
          <ToggleGroupItem
            value="topobath"
            aria-label="Topobath color ramps"
            className="w-full data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
          >
            Topo+bath
          </ToggleGroupItem>
          <ToggleGroupItem
            value="temp"
            aria-label="Temperature color ramps"
            className="w-full data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
          >
            Temp
          </ToggleGroupItem>
          <ToggleGroupItem
            value="topqgs"
            aria-label="Temperature color ramps"
            className="w-full data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=off]:text-muted-foreground data-[state=off]:font-normal"
          >
            Top Qgs
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="space-y-4">
        {/* Color Ramp Selection */}
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
                  <p>Load advanced color ramps from cpt-city topobath</p>
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
                {
                  Object.entries(filteredColorRamps)
                    .map(([key, ramp]: [string, any]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-12 h-4 rounded-sm"
                            style={{ background: `linear-gradient(to right, ${getGradientColors(ramp.colors)})` }}
                          />
                          <span>{ramp.name}</span>
                        </div>
                      </SelectItem>
                    ))
                }
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


        {/* License Type Filter */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">License Type</Label>
          <Select value={licenseFilter}
            onValueChange={(value) => {
              value && setLicenseFilter(value)
              if (true) {
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

        {/* Custom Min/Max */}
        <div className="w-full gap-1 flex items-center">
          <div className="flex-[2] flex items-center">
            <div className="flex items-center justify-between py-0.5 w-full">
              <Checkbox
                id="bg-layer-active"
                checked={state.customHypsoMinMax}
                onCheckedChange={(checked) =>
                  setState({ customHypsoMinMax: checked === true })}
              />
              <div className="flex items-center flex-1 ml-2 gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label htmlFor="bg-layer-active" className="text-sm font-medium cursor-pointer">
                      Edit Min/Max
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent><p>Edit Color-Ramp min/max </p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer" onClick={resetCustomMinMax}>
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Reset to colorramp default min/max</p></TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
          <div className="flex-1 flex items-center">
            <Input
              type="number"
              step="any"
              placeholder="Min (optional)"
              className="h-8 py-1 text-sm"
              value={state.customMin ?? ""}
              onChange={(e) => setState({ customMin: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
          <div className="flex-1 flex items-center">
            <Input
              type="number"
              step="any"
              placeholder="Max (optional)"
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

const RasterBasemapOptionsSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isTerrainRasterOpenAtom)
  const terrainSourceKeys = useMemo(() => ["osm", "google", "esri", "mapbox"], [])
  const cycleTerrainSource = useCallback((direction: number) => {
    const currentIndex = terrainSourceKeys.indexOf(state.terrainSource)
    const newIndex = (currentIndex + direction + terrainSourceKeys.length) % terrainSourceKeys.length
    setState({ terrainSource: terrainSourceKeys[newIndex] })
  }, [state.terrainSource, terrainSourceKeys, setState])

  if (!state.showRasterBasemap) return null

  const terrainSourceOptions = [
    { value: "google", label: "Google Hybrid" }, { value: "mapbox", label: "Mapbox Satellite" },
    { value: "esri", label: "ESRI World Imagery" }, { value: "googlesat", label: "Google Satellite" },
    { value: "bing", label: "Bing Aerial" }, { value: "osm", label: "OpenStreetMap" },
  ]

  return (
    <Section title="Raster Basemap Options" isOpen={isOpen} onOpenChange={setIsOpen}>
      <div className="space-y-2">
        <Label className="text-sm">Source</Label>
        <CycleButtonGroup value={state.terrainSource} options={terrainSourceOptions} onChange={(v) => setState({ terrainSource: v })} onCycle={cycleTerrainSource} />
      </div>
    </Section>
  )
}

const ContourOptionsSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isContoursOpenAtom)
  if (!state.showContours) return null
  return (
    <Section title="Contour Options" isOpen={isOpen} onOpenChange={setIsOpen}>
      <SliderControl label="Minor Interval (m)" value={state.contourMinor} onChange={(v) => setState({ contourMinor: v })} min={10} max={100} step={10} suffix="m" />
      <SliderControl label="Major Interval (m)" value={state.contourMajor} onChange={(v) => setState({ contourMajor: v })} min={50} max={500} step={50} suffix="m" />
    </Section>
  )
}

const BackgroundOptionsSection: React.FC<{ state: any; setState: (updates: any) => void; theme?: 'light' | 'dark' }> = ({ state, setState, theme = 'light' }) => {
  const [isOpen, setIsOpen] = useAtom(isBackgroundOpenAtom)

  const [skyConfig, setSkyConfig] = useAtom(skyConfigAtom)

  if (!state.showBackground) return null

  const handleMatchThemeToggle = (checked: boolean) => {
    if (checked === true) {
      const themeColor = theme === 'light' ? '#ffffff' : '#000000'
      // setState({
      //   matchThemeColors: checked,
      //   skyColor: themeColor,
      //   horizonColor: themeColor,
      //   fogColor: themeColor
      // })
      setSkyConfig({
        ...skyConfig,
        matchThemeColors: true,
        skyColor: themeColor,
        horizonColor: themeColor,
        fogColor: themeColor
      })
    } else {
      setSkyConfig({
        ...skyConfig,
        matchThemeColors: false
      })
    }
  }

  // useEffect(() => {
  //   handleMatchThemeToggle(state.matchThemeColors)
  // }, [theme, state.matchThemeColors])

  return (
    <Section title="Background Options" isOpen={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between py-0.5">
        <Checkbox
          id="match-theme"
          checked={skyConfig.matchThemeColors}
          onCheckedChange={handleMatchThemeToggle}
        />
        <Label htmlFor="match-theme" className="text-sm font-medium cursor-pointer flex-1 ml-2">
          Match Theme Colors
        </Label>
      </div>

      <div className="space-y-2 pt-1">

        {skyConfig.matchThemeColors ? (

          <SliderControl label="Fog Blend" value={skyConfig.fogGroundBlend * 100} onChange={(v) =>
            setSkyConfig({ ...skyConfig, fogGroundBlend: v / 100 })}
            min={0} max={100} step={1} suffix="%" />
        ) :
          (
            <>
              <div className="flex gap-3">
                <Input
                  type="color"
                  value={skyConfig.fogColor}
                  onChange={(e) =>
                    setSkyConfig({ ...skyConfig, fogColor: e.target.value })}
                  className="h-8 w-12 p-1 cursor-pointer border-none flex-shrink-0"
                />
                <div className="grow">
                  <SliderControl
                    label="Fog Color Blend"
                    value={skyConfig.fogGroundBlend * 100}
                    onChange={(v) =>
                      setSkyConfig({ ...skyConfig, fogGroundBlend: v / 100 })}
                    min={0} max={100} step={1} suffix="%"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Input
                  type="color"
                  value={skyConfig.horizonColor}
                  onChange={(e) =>
                    setSkyConfig({ ...skyConfig, horizonColor: e.target.value })}
                  className="h-8 w-12 p-1 cursor-pointer border-none flex-shrink-0"
                />
                <div className="grow">
                  <SliderControl
                    label="Horizon Color Blend"
                    value={skyConfig.horizonFogBlend * 100}
                    onChange={(v) =>
                      setSkyConfig({ ...skyConfig, horizonFogBlend: v / 100 })}
                    min={0} max={100} step={1} suffix="%"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Input
                  type="color"
                  value={skyConfig.skyColor}
                  onChange={(e) =>
                    setSkyConfig({ ...skyConfig, skyColor: e.target.value })}
                  className="h-8 w-12 p-1 cursor-pointer border-none flex-shrink-0"
                />
                <div className="grow">
                  <SliderControl
                    label="Sky Color Blend"
                    value={skyConfig.skyHorizonBlend * 100}
                    onChange={(v) =>
                      setSkyConfig({ ...skyConfig, skyHorizonBlend: v / 100 })}
                    min={0} max={100} step={1} suffix="%"
                  />
                </div>
              </div>
            </>
          )}
      </div>

      <div className="flex items-center justify-between py-0.5">
        <Checkbox
          id="bg-layer-active"
          checked={skyConfig.backgroundLayerActive}
          onCheckedChange={(checked) =>
            setSkyConfig({ ...skyConfig, backgroundLayerActive: checked === true })}
        />
        <div className="flex items-center flex-1 ml-2 gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Label htmlFor="bg-layer-active" className="text-sm font-medium cursor-pointer">
                Map Background Layer
              </Label>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle off if hillshade or other layers have display issues</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </Section >
  )
}

const DownloadSection: React.FC<{
  state: any; getMapBounds: () => { west: number; south: number; east: number; north: number }
  getSourceConfig: (key: string) => SourceConfig | null; mapRef: React.RefObject<MapRef>
}> = ({ state, getMapBounds, getSourceConfig, mapRef }) => {
  const [isOpen, setIsOpen] = useAtom(isDownloadOpenAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [maxResolution] = useAtom(maxResolutionAtom)
  const [isExporting, setIsExporting] = useState(false)

  const getTitilerDownloadUrl = useCallback(() => {
    const sourceConfig = getSourceConfig(state.sourceA)
    if (!sourceConfig) return ""
    const wmsXml = buildGdalWmsXml(sourceConfig.tileUrl, sourceConfig.tileSize)
    const bounds = getMapBounds()
    const width = maxResolution
    const height = maxResolution
    return `${titilerEndpoint}/cog/bbox/${bounds.west},${bounds.south},${bounds.east},${bounds.north}/${width}x${height}.tif?url=${encodeURIComponent(wmsXml)}`
  }, [state.sourceA, getSourceConfig, getMapBounds, maxResolution, titilerEndpoint])

  const getSourceUrl = useCallback(() => {
    const sourceConfig = getSourceConfig(state.sourceA)
    return sourceConfig?.tileUrl || ""
  }, [state.sourceA, getSourceConfig])

  const takeScreenshot = useCallback(async () => {
    if (!mapRef.current) return
    let filename = `terrain-composited-${new Date().toISOString()}`
    if (state.viewMode === "2d") filename += "-epsg4326"

    try {
      const canvas = mapRef.current.getMap().getCanvas()
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const dpr = window.devicePixelRatio

      domToPng(canvas, { width, height, scale: dpr }).then((blob) => saveAs(blob, `${filename}.png`))

      if (state.viewMode === "2d") {
        const bounds = getMapBounds()
        const pixelSizeX = (bounds.east - bounds.west) / width
        const pixelSizeY = (bounds.north - bounds.south) / height
        const pgwContent = [pixelSizeX.toFixed(10), "0.0", "0.0", (-pixelSizeY).toFixed(10), bounds.west.toFixed(10), bounds.north.toFixed(10)].join("\n")
        const pgwBlob = new Blob([pgwContent], { type: "text/plain" })
        saveAs(pgwBlob, `${filename}.pgw`)
      }
    } catch (error) {
      console.error("Failed to take screenshot:", error)
    }
  }, [mapRef, state.viewMode, getMapBounds])

  const exportDTM = useCallback(async () => {
    setIsExporting(true)
    try {
      const url = getTitilerDownloadUrl()
      const response = await fetch(url)
      if (!response.ok) {
        window.open(url, "_blank")
        return
      }

      const arrayBuffer = await response.arrayBuffer()
      const tiff = await fromArrayBuffer(arrayBuffer)
      const image = await tiff.getImage()
      const rasters = await image.readRasters()

      const width = image.getWidth()
      const height = image.getHeight()
      const sourceConfig = getSourceConfig(state.sourceA)
      if (!sourceConfig) {
        console.error("Source config not found")
        return
      }
      const encoding = sourceConfig.encoding

      const elevationData = new Float32Array(width * height)
      const r = rasters[0]
      const g = rasters[1]
      const b = rasters[2]

      for (let i = 0; i < width * height; i++) {
        if (encoding === "terrainrgb") {
          elevationData[i] = -10000 + (r[i] * 256 * 256 + g[i] * 256 + b[i]) * 0.1
        } else {
          elevationData[i] = r[i] * 256 + g[i] + b[i] / 256 - 32768
        }
      }

      const bounds = getMapBounds()
      const pixelSizeX = (bounds.east - bounds.west) / width
      const pixelSizeY = (bounds.north - bounds.south) / height

      const metadata = {
        GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326, GeogCitationGeoKey: "WGS 84",
        height, width, ModelPixelScale: [pixelSizeX, pixelSizeY, 0],
        ModelTiepoint: [0, 0, 0, bounds.west, bounds.north, 0],
        SamplesPerPixel: 1, BitsPerSample: [32], SampleFormat: [3],
        PlanarConfiguration: 1, PhotometricInterpretation: 1,
      }

      const outputArrayBuffer = await writeArrayBuffer(elevationData, metadata)
      const blob = new Blob([outputArrayBuffer], { type: "image/tiff" })
      saveAs(blob, `terrain-dtm-${Date.now()}.tif`)
    } catch (error) {
      console.error("Failed to export DTM:", error)
      const url = getTitilerDownloadUrl()
      window.open(url, "_blank")
    } finally {
      setIsExporting(false)
    }
  }, [getTitilerDownloadUrl, getSourceConfig, state.sourceA, getMapBounds])

  return (
    <Section title="Download" isOpen={isOpen} onOpenChange={setIsOpen}>
      <div className="flex gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" className="flex-[2] bg-transparent cursor-pointer" onClick={exportDTM}>
              <Download className="h-4 w-4 mr-2" />Export DTM
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Export DTM as GeoTIFF (raw Float32 elevation values)</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" className="flex-1 bg-transparent cursor-pointer" onClick={takeScreenshot}>
              <Camera className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Export Screenshot (composited with hillshade, hypsometric tint, contours, raster basemap, etc)</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" className="flex-1 bg-transparent cursor-pointer" onClick={() => copyToClipboard(getSourceUrl())}>
              <Copy className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>Copy TMS/XYZ tileset source URL for QGIS import, uses {getSourceConfig(state.sourceA)?.encoding || "unknown"} encoding</p></TooltipContent>
        </Tooltip>
      </div>
      <p className="text-xs text-muted-foreground">
        Export DEM terrain as GeoTIFF (via Titiler), take screenshot, or copy source URL for QGIS & co. If in 2D view-mode, screenshot will be georeferenced png + pgw (epsg:4326).
      </p>
    </Section>
  )
}

const FooterSection: React.FC = () => (
  <div className="text-xs text-muted-foreground space-y-1">
    <p>Made by <a href="https://github.com/jo-chemla/" target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">jo-chemla</a>, <a href="https://iconem.com" target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">Iconem</a></p>
    <p>Inspired by:</p>
    <ul className="space-y-0.5">
      <li className="flex items-center justify-between">
        <a href="https://tangrams.github.io/heightmapper/#6.65833/43.860/10.023" target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">
          Tangram Height Mapper
        </a>
        <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
      </li>
      <li className="flex items-center justify-between">
        <a href="https://impasto.dev/" target="_blank" rel="noopener noreferrer" className="hover:underline flex-1 cursor-pointer">
          Impasto CAS Viewer
        </a>
        <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
      </li>
      <li className="flex items-center justify-between">
        <p>
          Codetard threejs terrain demos: {" "}
          <a href="https://x.com/codetaur/status/1968896182744207599" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">ui</a>
          {", "}
          <a href="https://x.com/codetaur/status/1967783305866252557" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">modes</a>
          {", "}
          <a href="https://x.com/codetaur/status/1986614344957006075" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">globe</a>
          {", "}
          <a href="https://github.com/ngwnos/threegs" target="_blank" rel="noopener noreferrer" className="hover:underline cursor-pointer">repo</a>
        </p>
        <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
      </li>
    </ul>
  </div>
)

export function TerrainControls({ state, setState, getMapBounds, mapRef }: TerrainControlsProps) {
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
        <RasterBasemapOptionsSection state={state} setState={setState} />
        <ContourOptionsSection state={state} setState={setState} />
        <BackgroundOptionsSection state={state} setState={setState} theme={theme} />
        <FooterSection />
      </Card>
    </TooltipProvider>
  )
}