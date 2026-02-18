import type React from "react"
import { useState, useCallback } from "react"
import { useAtom } from "jotai"
import { Moon, Sun, Settings, ExternalLink } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  mapboxKeyAtom, googleKeyAtom, maptilerKeyAtom, titilerEndpointAtom,
  maxResolutionAtom, useCogProtocolVsTitilerAtom
} from "@/lib/settings-atoms"
import { useTheme } from "@/lib/controls-utils"
import { PasswordInput } from "./controls-components"
import { TooltipIconButton } from "./controls-components"

export const SettingsDialog: React.FC<{ isOpen: boolean; onOpenChange: (open: boolean) => void }> = ({ isOpen, onOpenChange }) => {
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
      <DialogTrigger asChild>
        <TooltipIconButton
          icon={Settings}
          tooltip="Settings"
        />
      </DialogTrigger>

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
                    onChange={(e: any) => setMaptilerKey(e.target.value)}
                    className="cursor-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mapbox-key">Mapbox Access Token</Label>
                  <PasswordInput
                    id="mapbox-key"
                    value={mapboxKey}
                    onChange={(e: any) => setMapboxKey(e.target.value)}
                    className="cursor-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="google-key">Google Maps API Key</Label>
                  <PasswordInput
                    id="google-key"
                    value={googleKey}
                    onChange={(e: any) => setGoogleKey(e.target.value)}
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
                Faster and avoids overflooding Titiler, but may encounter CORS errors.
              </p>
              <p>
                <span className="font-semibold">Titiler:</span> Middleware service that fetches remote COG
                and streams TMS tiles.
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
          <p className="text-xs text-muted-foreground">The max resolution limit for GeoTIFF DEM download via Titiler is usually 2k to 4k.</p>

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

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Resources: MapLibre GL Features</h3>
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
                <a href="https://www.npmjs.com/package/cpt2js" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Color-ramps (Topo, topobath etc) distributed from cpt2js Package</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog >
  )
}
