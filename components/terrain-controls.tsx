"use client"

import type React from "react"
import { useState, useCallback, useMemo, forwardRef } from "react"
import { useAtom } from "jotai"
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Info,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Settings,
  Sun,
  Plus,
  Edit,
  Trash2,
  Globe,
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
  DialogClose
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
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
  customTerrainSourcesAtom,
  isByodOpenAtom,
  type CustomTerrainSource,
} from "@/lib/settings-atoms"
import type { MapRef } from "react-map-gl/maplibre"
import { domToPng } from "modern-screenshot"
import { fromArrayBuffer, writeArrayBuffer } from "geotiff"
import saveAs from "file-saver"
import type { TerrainSource } from "@/lib/terrain-types"

// ============================================================================
// TYPES
// ============================================================================

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

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

const useTheme = () => {
  const [theme, setTheme] = useAtom(themeAtom)

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light")
  }, [theme, setTheme])

  return { theme, toggleTheme }
}

const useSourceConfig = () => {
  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)
  const [googleKey] = useAtom(googleKeyAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)

  const getTilesUrl = useCallback(
    (key: TerrainSource): string => {
      const source = terrainSources[key]
      let tileUrl = source.sourceConfig.tiles[0] || ""

      if (key === "mapbox") {
        tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
      } else if (key === "maptiler") {
        tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")
      } else if (key === "google3dtiles") {
        tileUrl = tileUrl.replace("{API_KEY}", googleKey || "")
      }

      return tileUrl
    },
    [mapboxKey, maptilerKey, googleKey]
  )

  const getCustomSourceUrl = useCallback((source: CustomTerrainSource): string => {
    if (source.type === "cog") {
      return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?url=${encodeURIComponent(source.url)}&algorithm=terrarium`
    }
    return source.url
  }, [titilerEndpoint])

  const getSourceConfig = useCallback(
    (sourceKey: string): SourceConfig | null => {
      if (terrainSources[sourceKey]) {
        const source = terrainSources[sourceKey]
        return {
          encoding: source.encoding,
          tileUrl: getTilesUrl(sourceKey),
          tileSize: source.sourceConfig.tileSize || 256,
        }
      }

      const customSource = customTerrainSources.find((s) => s.id === sourceKey)
      if (customSource) {
        const encoding = customSource.type === "terrainrgb" ? "terrainrgb" : "terrarium"
        const tileUrl = getCustomSourceUrl(customSource)
        return { encoding, tileUrl, tileSize: 256 }
      }

      return null
    },
    [customTerrainSources, getTilesUrl, getCustomSourceUrl]
  )

  return { getTilesUrl, getSourceConfig, getCustomSourceUrl }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getGradientColors = (colors: any[]): string => {
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

const templateLink = (link: string, lat: string, lng: string): string =>
  link.replace("{LAT}", lat).replace("{LNG}", lng)

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text)
}

// ============================================================================
// SETTINGS DIALOG COMPONENT
// ============================================================================

const SettingsDialog: React.FC<{
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ isOpen, onOpenChange }) => {
  const { theme, toggleTheme } = useTheme()
  const [mapboxKey, setMapboxKey] = useAtom(mapboxKeyAtom)
  const [googleKey, setGoogleKey] = useAtom(googleKeyAtom)
  const [maptilerKey, setMaptilerKey] = useAtom(maptilerKeyAtom)
  const [titilerEndpoint, setTitilerEndpoint] = useAtom(titilerEndpointAtom)
  const [maxResolution, setMaxResolution] = useAtom(maxResolutionAtom)
  const [batchEditMode, setBatchEditMode] = useState(false)
  const [batchApiKeys, setBatchApiKeys] = useState("")

  const handleBatchToggle = useCallback(() => {
    if (!batchEditMode) {
      const keys = [
        `maptiler_api_key=${maptilerKey}`,
        `mapbox_access_token=${mapboxKey}`,
        `google_api_key=${googleKey}`,
      ]
      setBatchApiKeys(keys.join("\n"))
    } else {
      const lines = batchApiKeys.split("\n")
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
  }, [batchEditMode, batchApiKeys, mapboxKey, googleKey, maptilerKey, setMapboxKey, setGoogleKey, setMaptilerKey])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="cursor-pointer">
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto" showCloseButton={false}>
        <DialogClose
          className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100"
          aria-label="Close"
        >
          ✕
        </DialogClose>
        <DialogHeader>
          <DialogTitle>Settings & Resources</DialogTitle>
          <DialogDescription>
            Configure API keys, application settings, and explore related resources
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {/* Theme Settings */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Appearance</h3>
            <div className="flex items-center justify-between">
              <Label>Theme</Label>
              <Button variant="outline" size="sm" onClick={toggleTheme} className="cursor-pointer">
                {theme === "light" ? <Moon className="h-4 w-4 mr-2" /> : <Sun className="h-4 w-4 mr-2" />}
                {theme === "light" ? "Dark" : "Light"}
              </Button>
            </div>
          </div>

          <Separator />

          {/* API Keys */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">API Keys</h3>
              <Button variant="outline" size="sm" onClick={handleBatchToggle} className="cursor-pointer">
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
              </>
            )}
          </div>

          <Separator />

          {/* Titiler Settings */}
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

          {/* Terrain Encoding Functions */}
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

          {/* MapLibre GL Features */}
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

          {/* Color Ramp Resources */}
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
  )
}

// ============================================================================
// SOURCE INFO DIALOG
// ============================================================================

const SourceInfoDialog: React.FC<{
  sourceKey: string
  config: any
  getTilesUrl: (key: string) => string
}> = ({ sourceKey, config, getTilesUrl }) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer">
          <Info className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{config.name}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <DialogClose
          className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100"
          aria-label="Close"
        >
          ✕
        </DialogClose>
        <div className="space-y-4 text-sm">
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
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold">URL Template:</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 cursor-pointer"
                onClick={() => copyToClipboard(getTilesUrl(sourceKey))}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <code className="block p-3 bg-muted rounded text-xs break-all">{getTilesUrl(sourceKey)}</code>
          </div>
          <div>
            <span className="font-semibold">Max Zoom:</span> {config.sourceConfig.maxzoom}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// GENERAL SETTINGS SECTION
// ============================================================================

const GeneralSettings: React.FC<{
  state: any
  setState: (updates: any) => void
}> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isGeneralOpenAtom)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
        General Settings
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1">
        {/* View Mode */}
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

        {/* Split Screen */}
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

        {/* Terrain Exaggeration */}
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
  )
}

// ============================================================================
// CUSTOM SOURCE MODAL
// ============================================================================

const CustomSourceModal: React.FC<{
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  editingSource: CustomTerrainSource | null
  onSave: (source: Omit<CustomTerrainSource, "id"> & { id?: string }) => void
}> = ({ isOpen, onOpenChange, editingSource, onSave }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [type, setType] = useState<"cog" | "terrainrgb" | "terrarium">("cog")
  const [description, setDescription] = useState("")

  // Reset form when modal opens with editing source
  useState(() => {
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
  })

  const handleSave = useCallback(() => {
    if (!name || !url) return

    onSave({
      id: editingSource?.id,
      name,
      url,
      type,
      description,
    })

    onOpenChange(false)
  }, [name, url, type, description, editingSource, onSave, onOpenChange])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{editingSource ? "Edit Terrain Dataset" : "Add New Terrain Dataset"}</DialogTitle>
          <DialogDescription>
            Add your own terrain data source from a TerrainRGB, Terrarium or COG endpoint. COGs are tiled via the user-defined TiTiler instance - might be slow and have COG has to be well-formed, with no bizarre elevation inside mask/nodata value, correctly clamped - otherwise safer to visualize COG in 2D + test your COG url eg in qgis first.
          </DialogDescription>
        </DialogHeader>
        <DialogClose
          className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100"
          aria-label="Close"
        >
          ✕
        </DialogClose>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-name">Name *</Label>
            <Input
              id="source-name"
              type="text"
              placeholder="My Custom Terrain"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="cursor-text"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-url">URL *</Label>
            <Input
              id="source-url"
              type="text"
              placeholder="https://example.com/terrain/{z}/{x}/{y}.png"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="cursor-text"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-type">Type *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
              <SelectTrigger id="source-type" className="cursor-pointer w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cog">COG (Cloud Optimized GeoTIFF)</SelectItem>
                <SelectItem value="terrainrgb">TerrainRGB</SelectItem>
                <SelectItem value="terrarium">Terrarium</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-description">Description (optional)</Label>
            <Input
              id="source-description"
              type="text"
              placeholder="Custom terrain data from..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="cursor-text"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name || !url}
              className="cursor-pointer"
            >
              {editingSource ? "Save Changes" : "Add Source"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// TERRAIN SOURCE SECTION
// ============================================================================

const TerrainSourceSection: React.FC<{
  state: any
  setState: (updates: any) => void
  getTilesUrl: (key: string) => string
}> = ({ state, setState, getTilesUrl }) => {
  const [isOpen, setIsOpen] = useAtom(isTerrainSourceOpenAtom)
  const [isByodOpen, setIsByodOpen] = useAtom(isByodOpenAtom)
  const [customTerrainSources, setCustomTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<CustomTerrainSource | null>(null)

  const linkCallback = useCallback(
    (link: string) => () => window.open(templateLink(link, state.lat, state.lng), "_blank"),
    [state.lat, state.lng]
  )

  const handleSaveCustomSource = useCallback((source: Omit<CustomTerrainSource, "id"> & { id?: string }) => {
    if (source.id) {
      // Edit existing
      setCustomTerrainSources(
        customTerrainSources.map((s) =>
          s.id === source.id ? { ...s, ...source } as CustomTerrainSource : s
        )
      )
    } else {
      // Add new
      const newSource: CustomTerrainSource = {
        ...source,
        id: `custom-${Date.now()}`,
      } as CustomTerrainSource
      setCustomTerrainSources([...customTerrainSources, newSource])
    }
  }, [customTerrainSources, setCustomTerrainSources])

  const handleDeleteCustomSource = useCallback((id: string) => {
    setCustomTerrainSources(customTerrainSources.filter((s) => s.id !== id))
    if (state.sourceA === id) setState({ sourceA: "aws" })
    if (state.sourceB === id) setState({ sourceB: "mapterhorn" })
  }, [customTerrainSources, setCustomTerrainSources, state, setState])

  const openAddModal = useCallback(() => {
    setEditingSource(null)
    setIsAddSourceModalOpen(true)
  }, [])

  const openEditModal = useCallback((source: CustomTerrainSource) => {
    setEditingSource(source)
    setIsAddSourceModalOpen(true)
  }, [])

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          Terrain Source
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
                    className={`border rounded-md shrink-0 ${key !== "google3dtiles" ? "cursor-pointer" : "cursor-not-allowed"}`}
                    disabled={key === "google3dtiles"}
                  >
                    <ToggleGroupItem value="a" className="px-3 cursor-pointer data-[state=on]:font-bold">
                      A
                    </ToggleGroupItem>
                    <ToggleGroupItem value="b" className="px-3 cursor-pointer data-[state=on]:font-bold">
                      B
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <Label
                    className={`flex-1 text-sm ${key !== "google3dtiles" ? "cursor-pointer" : "cursor-not-allowed"}`}
                  >
                    {config.name}
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <SourceInfoDialog sourceKey={key} config={config} getTilesUrl={getTilesUrl} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>View source details</p>
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 cursor-pointer"
                    onClick={linkCallback(config.link)}
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
                  <RadioGroupItem
                    value={key}
                    id={`source-${key}`}
                    className="cursor-pointer"
                    disabled={key === "google3dtiles"}
                  />
                  <Label
                    htmlFor={`source-${key}`}
                    className={`flex-1 text-sm ${key !== "google3dtiles" ? "cursor-pointer" : "cursor-not-allowed"}`}
                  >
                    {config.name}
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <SourceInfoDialog sourceKey={key} config={config} getTilesUrl={getTilesUrl} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>View source details</p>
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 cursor-pointer"
                    onClick={linkCallback(config.link)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </RadioGroup>
          )}

          {/* Bring Your Own Data */}
          <Collapsible open={isByodOpen} onOpenChange={setIsByodOpen} className="mt-4">
            <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-sm font-medium cursor-pointer pl-2.5">
              Bring Your Own Data
              <ChevronDown className={`h-4 w-4 transition-transform ${isByodOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full cursor-pointer bg-transparent"
                onClick={openAddModal}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add new terrain dataset
              </Button>

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
                            <ToggleGroupItem value="a" className="px-3 cursor-pointer data-[state=on]:font-bold">
                              A
                            </ToggleGroupItem>
                            <ToggleGroupItem value="b" className="px-3 cursor-pointer data-[state=on]:font-bold">
                              B
                            </ToggleGroupItem>
                          </ToggleGroup>
                          <Label className="flex-1 text-sm cursor-pointer truncate">{source.name}</Label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 cursor-pointer"
                            onClick={() => openEditModal(source)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 cursor-pointer"
                            onClick={() => handleDeleteCustomSource(source.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </>
                  ) : (
                    <RadioGroup value={state.sourceA} onValueChange={(value) => setState({ sourceA: value })}>
                      {customTerrainSources.map((source) => (
                        <div key={source.id} className="flex items-center gap-2">
                          <RadioGroupItem value={source.id} id={`source-${source.id}`} className="cursor-pointer" />
                          <Label htmlFor={`source-${source.id}`} className="flex-1 text-sm cursor-pointer truncate">
                            {source.name}
                          </Label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 cursor-pointer"
                            onClick={() => openEditModal(source)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 cursor-pointer"
                            onClick={() => handleDeleteCustomSource(source.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </RadioGroup>
                  )}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CollapsibleContent>
      </Collapsible>

      <CustomSourceModal
        isOpen={isAddSourceModalOpen}
        onOpenChange={setIsAddSourceModalOpen}
        editingSource={editingSource}
        onSave={handleSaveCustomSource}
      />
    </>
  )
}

// ============================================================================
// VISUALIZATION MODES SECTION
// ============================================================================

const VisualizationModesSection: React.FC<{
  state: any
  setState: (updates: any) => void
}> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isVizModesOpenAtom)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
        Visualization Modes
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
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

        {/* Hypsometric Tint */}
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
          <Checkbox
            id="color-relief"
            checked={state.showColorRelief}
            onCheckedChange={(checked) => setState({ showColorRelief: checked })}
            className="cursor-pointer"
          />
          <Label htmlFor="color-relief" className="text-sm cursor-pointer">
            Elevation Hypso
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

        {/* Raster Basemap */}
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
          <Checkbox
            id="terrain-raster"
            checked={state.showRasterBasemap}
            onCheckedChange={(checked) => setState({ showRasterBasemap: checked })}
            className="cursor-pointer"
          />
          <Label htmlFor="terrain-raster" className="text-sm cursor-pointer">
            Raster Basemap
          </Label>
          <Slider
            value={[state.rasterBasemapOpacity]}
            onValueChange={([value]) => setState({ rasterBasemapOpacity: value })}
            min={0}
            max={1}
            step={0.1}
            className="cursor-pointer"
            disabled={!state.showRasterBasemap}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ============================================================================
// HILLSHADE OPTIONS SECTION
// ============================================================================

const HillshadeOptionsSection: React.FC<{
  state: any
  setState: (updates: any) => void
}> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isHillshadeOpenAtom)
  const [isColorsOpen, setIsColorsOpen] = useState(false)

  const hillshadeMethodKeys = useMemo(() =>
    ["standard", "combined", "igor", "basic", "multidirectional", "multidir-colors"],
    []
  )

  const cycleHillshadeMethod = useCallback((direction: number) => {
    const currentIndex = hillshadeMethodKeys.indexOf(state.hillshadeMethod)
    const newIndex = (currentIndex + direction + hillshadeMethodKeys.length) % hillshadeMethodKeys.length
    setState({ hillshadeMethod: hillshadeMethodKeys[newIndex] })
  }, [state.hillshadeMethod, hillshadeMethodKeys, setState])

  const supportsIlluminationDirection = useMemo(() =>
    ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod),
    [state.hillshadeMethod]
  )

  const supportsIlluminationAltitude = useMemo(() =>
    ["combined", "basic"].includes(state.hillshadeMethod),
    [state.hillshadeMethod]
  )

  const supportsShadowColor = useMemo(() =>
    ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod),
    [state.hillshadeMethod]
  )

  const supportsHighlightColor = useMemo(() =>
    ["standard", "combined", "igor", "basic"].includes(state.hillshadeMethod),
    [state.hillshadeMethod]
  )

  const supportsAccentColor = useMemo(() =>
    state.hillshadeMethod === "standard",
    [state.hillshadeMethod]
  )

  const supportsExaggeration = useMemo(() =>
    ["standard", "combined", "multidirectional", "multidir-colors"].includes(state.hillshadeMethod),
    [state.hillshadeMethod]
  )

  if (!state.showHillshade) return null

  return (
    <>
      <Separator />
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          Hillshade Options
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-1">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Hillshade Method</Label>
            <div className="flex gap-2">
              <Select
                value={state.hillshadeMethod}
                onValueChange={(value) => setState({ hillshadeMethod: value })}
              >
                <SelectTrigger className="flex-1 cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="combined">Combined</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="multidir-colors">Aspect (Multidir Colors)</SelectItem>
                  <SelectItem value="igor">Igor</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="multidirectional">Multidirectional</SelectItem>
                  <SelectItem value="aspect-multidir">Aspect classic (Multidir Colors)</SelectItem>
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
    </>
  )
}

// ============================================================================
// HYPSOMETRIC TINT OPTIONS SECTION
// ============================================================================

const HypsometricTintOptionsSection: React.FC<{
  state: any
  setState: (updates: any) => void
}> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isHypsoOpenAtom)
  const [showAdvancedRamps, setShowAdvancedRamps] = useState(false)

  const colorRampKeys = useMemo(() => Object.keys(colorRamps), [])

  const cycleColorRamp = useCallback((direction: number) => {
    const currentIndex = colorRampKeys.indexOf(state.colorRamp)
    const newIndex = (currentIndex + direction + colorRampKeys.length) % colorRampKeys.length
    setState({ colorRamp: colorRampKeys[newIndex] })
  }, [state.colorRamp, colorRampKeys, setState])

  if (!state.showColorRelief) return null

  return (
    <>
      <Separator />
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          Hypsometric Tint Options
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
    </>
  )
}

// ============================================================================
// RASTER BASEMAP OPTIONS SECTION
// ============================================================================

const RasterBasemapOptionsSection: React.FC<{
  state: any
  setState: (updates: any) => void
}> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isTerrainRasterOpenAtom)

  const terrainSourceKeys = useMemo(() => ["osm", "google", "esri", "mapbox"], [])

  const cycleTerrainSource = useCallback((direction: number) => {
    const currentIndex = terrainSourceKeys.indexOf(state.terrainSource)
    const newIndex = (currentIndex + direction + terrainSourceKeys.length) % terrainSourceKeys.length
    setState({ terrainSource: terrainSourceKeys[newIndex] })
  }, [state.terrainSource, terrainSourceKeys, setState])

  if (!state.showRasterBasemap) return null

  return (
    <>
      <Separator />
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          Raster Basemap Options
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
                  <SelectItem value="google">Google Hybrid</SelectItem>
                  <SelectItem value="mapbox">Mapbox Satellite</SelectItem>
                  <SelectItem value="esri">ESRI World Imagery</SelectItem>
                  <SelectItem value="googlesat">Google Satellite</SelectItem>
                  <SelectItem value="bing">Bing Aerial</SelectItem>
                  <SelectItem value="osm">OpenStreetMap</SelectItem>
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
    </>
  )
}

// ============================================================================
// CONTOUR OPTIONS SECTION
// ============================================================================

const ContourOptionsSection: React.FC<{
  state: any
  setState: (updates: any) => void
}> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isContoursOpenAtom)

  if (!state.showContours) return null

  return (
    <>
      <Separator />
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
          Contour Options
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
    </>
  )
}

// ============================================================================
// DOWNLOAD SECTION
// ============================================================================

const DownloadSection: React.FC<{
  state: any
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  getSourceConfig: (key: string) => SourceConfig | null
  mapRef: React.RefObject<MapRef>
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
    if (state.viewMode === "2d") {
      filename += "-epsg4326"
    }

    try {
      const canvas = mapRef.current.getMap().getCanvas()
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const dpr = window.devicePixelRatio

      domToPng(canvas, {
        width: width,
        height: height,
        scale: dpr,
      }).then((blob) => {
        saveAs(blob, `${filename}.png`)
      })

      if (state.viewMode === "2d") {
        const bounds = getMapBounds()
        const pixelSizeX = (bounds.east - bounds.west) / width
        const pixelSizeY = (bounds.north - bounds.south) / height

        const pgwContent = [
          pixelSizeX.toFixed(10),
          "0.0",
          "0.0",
          (-pixelSizeY).toFixed(10),
          bounds.west.toFixed(10),
          bounds.north.toFixed(10),
        ].join("\n")

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
        GTModelTypeGeoKey: 2,
        GeographicTypeGeoKey: 4326,
        GeogCitationGeoKey: "WGS 84",
        height: height,
        width: width,
        ModelPixelScale: [pixelSizeX, pixelSizeY, 0],
        ModelTiepoint: [0, 0, 0, bounds.west, bounds.north, 0],
        SamplesPerPixel: 1,
        BitsPerSample: [32],
        SampleFormat: [3],
        PlanarConfiguration: 1,
        PhotometricInterpretation: 1,
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
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-1 text-base font-medium cursor-pointer">
        Download
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1">
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" className="flex-1 bg-transparent cursor-pointer" onClick={takeScreenshot}>
                <Camera className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                Export Screenshot (composited with hillshade, hypsometric tint, raster basemap, etc)
              </p>
            </TooltipContent>
          </Tooltip>

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
                Copy TMS/XYZ tileset source URL, uses {getSourceConfig(state.sourceA)?.encoding || "unknown"} encoding
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-xs text-muted-foreground">
          Export DEM terrain as GeoTIFF (via Titiler), take screenshot, or copy source URL for QGIS & co. If in 2D view-mode, screenshot will be georeferenced png + pgw (epsg:4326).
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ============================================================================
// FOOTER SECTION
// ============================================================================

const FooterSection: React.FC = () => {
  return (
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
        <li className="flex items-center justify-between">
          <>
            {"Codetard threejs terrain demos : "}
            <a
              href="https://x.com/codetaur/status/1968896182744207599"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline cursor-pointer"
            >
              ui
            </a>
            {", "}
            <a
              href="https://x.com/codetaur/status/1967783305866252557"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline cursor-pointer"
            >
              modes
            </a>
            {", "}
            <a
              href="https://x.com/codetaur/status/1986614344957006075"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline cursor-pointer"
            >
              globe
            </a>
            {", "}
            <a
              href="https://github.com/ngwnos/threegs"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline cursor-pointer"
            >
              repo
            </a>
          </>
          <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
        </li>
      </ul>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TerrainControls({ state, setState, getMapBounds, mapRef }: TerrainControlsProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { getTilesUrl, getSourceConfig } = useSourceConfig()

  // Sync theme with document
  const [theme] = useAtom(themeAtom)
  useMemo(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

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
    // <TooltipProvider>
    <Card className="absolute right-4 top-4 bottom-4 w-96 overflow-y-auto p-4 gap-2 space-y-2 bg-background/95 backdrop-blur text-base">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Terrain Viewer</h2>
        <div className="flex gap-1">
          <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)} className="cursor-pointer">
            <PanelRightClose className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* General Settings */}
      <GeneralSettings state={state} setState={setState} />

      <Separator />

      {/* Terrain Source */}
      <TerrainSourceSection state={state} setState={setState} getTilesUrl={getTilesUrl} />

      <Separator />

      {/* Download */}
      <DownloadSection
        state={state}
        getMapBounds={getMapBounds}
        getSourceConfig={getSourceConfig}
        mapRef={mapRef}
      />

      <Separator />

      {/* Visualization Modes */}
      <VisualizationModesSection state={state} setState={setState} />

      {/* <Separator /> */}

      {/* Hillshade Options */}
      <HillshadeOptionsSection state={state} setState={setState} />

      {/* Hypsometric Tint Options */}
      <HypsometricTintOptionsSection state={state} setState={setState} />

      {/* Raster Basemap Options */}
      <RasterBasemapOptionsSection state={state} setState={setState} />

      {/* Contour Options */}
      <ContourOptionsSection state={state} setState={setState} />

      <Separator />

      {/* Footer */}
      <FooterSection />
    </Card>
    // </TooltipProvider>
  )
}