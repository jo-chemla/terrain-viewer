import type React from "react"
import { useState, useCallback } from "react"
import { useAtom } from "jotai"
import { Moon, Sun, Settings, ExternalLink } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  mapboxKeyAtom, googleKeyAtom, maptilerKeyAtom, titilerEndpointAtom,
  maxResolutionAtom, useCogProtocolVsTitilerAtom, transparentUiAtom, highResTerrainAtom,
  useClientExportAtom, customTerrainSourcesAtom, customBasemapSourcesAtom,
} from "@/lib/settings-atoms"
import { useTheme } from "@/lib/controls-utils"
import { PasswordInput } from "./controls-components"
import { TooltipIconButton } from "./controls-components"
import { JsonEditor } from "@/components/ui/json-editor"

export const SettingsDialog: React.FC<{ isOpen: boolean; onOpenChange: (open: boolean) => void; state: any, setState: any }> = ({ isOpen, onOpenChange, state, setState }) => {
  const { theme, toggleTheme } = useTheme()
  // const theme = state.theme
  // const setTheme = useCallback((v: string) => setState({theme: v}), [setState])
  // const toggleTheme = useCallback(() => setTheme(theme === "light" ? "dark" : "light"), [theme, setTheme])
  
  const [mapboxKey, setMapboxKey] = useAtom(mapboxKeyAtom)
  const [googleKey, setGoogleKey] = useAtom(googleKeyAtom)
  const [maptilerKey, setMaptilerKey] = useAtom(maptilerKeyAtom)
  const [titilerEndpoint, setTitilerEndpoint] = useAtom(titilerEndpointAtom)
  const [maxResolution, setMaxResolution] = useAtom(maxResolutionAtom)
  const [batchEditMode, setBatchEditMode] = useState(false)
  const [batchApiKeys, setBatchApiKeys] = useState("")
  const [useCogProtocolVsTitiler, setUseCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)
  const [isTransparentUi, setTransparentUi] = useAtom(transparentUiAtom)
  const [highResTerrain, setHighResTerrain] = useAtom(highResTerrainAtom)
  const [useClientExport, setUseClientExport] = useAtom(useClientExportAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [projectId, setProjectId] = useState("")
  const [projectName, setProjectName] = useState("")
  const [projectCopied, setProjectCopied] = useState(false)

  // Excluded from initialState: `project` itself (avoid self-reference) and
  // terrainUrl/basemapUrl (the *other* embed mechanism — redundant/conflicting
  // with a project preset, which seeds full custom-source objects instead).
  const EXCLUDED_STATE_KEYS = ["project", "terrainUrl", "basemapUrl"]

  const handleCopyProjectJson = useCallback(() => {
    const initialState: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(state)) {
      if (!EXCLUDED_STATE_KEYS.includes(key)) initialState[key] = value
    }

    // Any referenced source that isn't a builtin needs to travel WITH the preset —
    // a fresh visitor's browser has never seen it, so pull it out of the current
    // customTerrainSources/customBasemapSources lists by id.
    const referencedTerrainIds = [state.sourceA, state.sourceB].filter(Boolean)
    const referencedBasemapIds = [state.basemapSource, state.basemapSourceA, state.basemapSourceB, ...(state.overlayBasemapIds || [])].filter(Boolean)
    const usedTerrainSources = customTerrainSources.filter((s) => referencedTerrainIds.includes(s.id))
    const usedBasemapSources = customBasemapSources.filter((s) => referencedBasemapIds.includes(s.id))

    const config: Record<string, unknown> = {
      id: projectId || "my-project",
      name: projectName || "My Project",
      initialState,
    }
    if (usedTerrainSources.length) config.customTerrainSources = usedTerrainSources
    if (usedBasemapSources.length) config.customBasemapSources = usedBasemapSources

    const snippet = JSON.stringify({ [projectId || "my-project"]: config }, null, 2)
    navigator.clipboard.writeText(snippet)
    setProjectCopied(true)
    setTimeout(() => setProjectCopied(false), 2000)
  }, [state, projectId, projectName, customTerrainSources, customBasemapSources])

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
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <Label htmlFor="transparent-ui">Transparent UI</Label>
                <span className="text-sm text-muted-foreground">
                  Useful for editing symbology on mobile
                </span>
              </div>

              <Switch
                id="transparent-ui"
                checked={isTransparentUi}
                className="cursor-pointer"
                onCheckedChange={setTransparentUi}
              />
            </div>
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">API Keys</h3>
              <div className="flex gap-2">
                {batchEditMode && (
                  <Button variant="outline" size="sm" onClick={() => setBatchEditMode(false)} className="cursor-pointer">
                    Cancel
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleBatchToggle} className="cursor-pointer">{batchEditMode ? "Save" : "Batch Edit"}</Button>
              </div>
            </div>
            {batchEditMode ? (
              <div className="space-y-2">
                <Label htmlFor="batch-keys">API Keys (one per line: key=value)</Label>
                <JsonEditor
                  language="properties"
                  value={batchApiKeys}
                  onChange={setBatchApiKeys}
                  className="min-h-[120px]"
                />
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

            <div className="flex items-center justify-between pt-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="use-client-export">DTM Export without Titiler</Label>
                <span className="text-xs text-muted-foreground">
                  Browser range-reads and mosaics tiles/COGs directly, bypassing Titiler's server-side size limit
                </span>
              </div>
              <Switch
                id="use-client-export"
                checked={useClientExport}
                className="cursor-pointer"
                onCheckedChange={setUseClientExport}
              />
            </div>

            {useCogProtocolVsTitiler && (
              <div className="flex items-center justify-between pt-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="high-res-terrain">High-Precision Elevation Quantization </Label>
                  <span className="text-xs text-muted-foreground">
                    Slower Streaming, Higher quantization steps (3.9mm vs 10cm) for COGs via Terrarium (vs TerrainRGB)
                  </span>
                </div>
                <Switch
                  id="high-res-terrain"
                  checked={highResTerrain}
                  className="cursor-pointer"
                  onCheckedChange={setHighResTerrain}
                />
              </div>
            )}
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
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Slope and More Modes</h3>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><span className="font-semibold text-foreground">Slope:</span> magnitude of the gradient</div>
              <div><span className="font-semibold text-foreground">Aspect:</span> direction of the gradient</div>
              <div><span className="font-semibold text-foreground">Curvature:</span> rate of slope change (Profile, Plan, Det Hessian or Combined). Curvature is usually split into profile curvature (rate of slope change along the steepest-descent direction, affects flow acceleration) and plan curvature (rate of aspect change across contours, affects flow convergence/divergence — equivalent to the divergence of the normalized gradient field, div(∇z/|∇z|)); Det Hessian (fxx·fyy − fxy²) is instead a blob/saddle detector, positive at bowl/dome-shaped extrema and negative at saddle points</div>
              <div><span className="font-semibold text-foreground">TRI (Terrain Ruggedness Index):</span> mean elevation difference to neighbors</div>
              <div><span className="font-semibold text-foreground">TPI (Topographic Position Index):</span> elevation relative to neighborhood mean</div>
              <div><span className="font-semibold text-foreground">Roughness:</span> max−min elevation in a neighborhood</div>
              <div><span className="font-semibold text-foreground">Blobness:</span> structure-tensor measure of how much the gradient direction varies across a small window (det/trace of the smoothed gradient outer-product matrix) — high at peaks, pits, saddles and knolls, near zero on a uniform slope or straight ridge/valley</div>
              <div><span className="font-semibold text-foreground">LRM (Local Relief Model):</span> raw elevation minus a low-pass-filtered version, isolating small features from large-scale topography — the low-pass mean is bilinearly interpolated from a lower-resolution tile further up the pyramid tree</div>
              <div className="pt-1 italic">Neighborhood usually refers to a 3×3 kernel centered on the pixel.</div>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Smart Bounds Zoom</h3>
            <p className="text-xs text-muted-foreground">
              Clicking a source's name (Terrain Source / Basemap Source lists) only flies to its
              bounds when they're fully inside the current viewport or fully disjoint from it — a
              world-covering basemap or a partially-overlapping COG preserves your camera viewport
              instead of yanking your context away.
            </p>
          </div>
          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Save Project Preset</h3>
            <p className="text-xs text-muted-foreground">
              Copies the current view/sources/viz settings as a project-preset JSON snippet you can
              paste into lib/projects.json (as a new top-level key) to make it loadable via
              <code className="mx-1 bg-muted px-1 rounded">?project=your-id</code>.
            </p>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="project-id">Project ID</Label>
                <Input id="project-id" type="text" placeholder="my-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="cursor-text" />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="project-name">Project Name</Label>
                <Input id="project-name" type="text" placeholder="My Project" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="cursor-text" />
              </div>
            </div>
            <Button onClick={handleCopyProjectJson} className="cursor-pointer w-full" variant="outline">
              {projectCopied ? "Copied!" : "Copy Project JSON"}
            </Button>
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
                <a href="https://github.com/dzfranklin/plantopo/issues/258" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>PlanTopo slope-server — custom maplibre protocol inspiration</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://www.npmjs.com/package/cpt2js" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>Color-ramps (Topo, topobath etc) distributed from cpt2js Package</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://rfspace.com/RFSPACE/SpectraFlux/colormaps/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>RFSpace/SpectraFlux Colormaps — mostly a wrapper around Kovesi&apos;s CET, matplotlib and SDR community ramps</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
                <a href="https://colorcet.com/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer">
                  <span>CET — Peter Kovesi&apos;s perceptually-uniform colormaps</span><ExternalLink className="h-4 w-4 ml-auto shrink-0" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog >
  )
}