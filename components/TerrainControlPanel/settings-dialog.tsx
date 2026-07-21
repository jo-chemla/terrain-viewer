import type React from "react"
import { useState, useCallback, useEffect } from "react"
import { useAtom, useSetAtom } from "jotai"
import { Moon, Sun, Settings, ExternalLink, Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  mapboxKeyAtom, googleKeyAtom, maptilerKeyAtom, titilerEndpointAtom,
  useCogProtocolVsTitilerAtom, transparentUiAtom, highResTerrainAtom,
  useClientExportAtom, customTerrainSourcesAtom, customBasemapSourcesAtom, cacheVizTilesAtom,
  customThemesAtom,
} from "@/lib/settings-atoms"
import { MAX_BOUNDS_MODES, type MaxBoundsMode } from "@/lib/max-bounds"
import { persistLocalCogsAtom } from "@/lib/local-file-store"
import { isOpfsSupported, estimateStorage, listPersistedCogs, clearAllPersistedCogs, formatBytes } from "@/lib/opfs-file-store"
import { listPersistedVectorLayers, clearAllPersistedVectorLayers } from "@/lib/opfs-vector-store"
import { persistVectorLayersAtom } from "./TerraDrawSystem"
import { useTheme } from "@/lib/controls-utils"
import { PasswordInput } from "./controls-components"
import { TooltipIconButton } from "./controls-components"
import { JsonEditor } from "@/components/ui/json-editor"
import { ColorThemeSelect, SOURCE_GROUPS } from "@/components/theme-switcher"
import { useTheme as useColorTheme } from "@/components/theme-provider"
import { ThemeEditorPanel } from "@/theme-editor"
import { sortedThemes } from "@/lib/themes-config"

// Built once at module scope (sortedThemes never changes at runtime) — the
// Basic section's "Load Preset" picker in the advanced theme editor, grouped
// the same way as ColorThemeSelect's own dropdown for a consistent picture of
// where each preset came from.
const PRESET_GROUPS = SOURCE_GROUPS
  .map((group) => ({
    label: group.label,
    options: sortedThemes.filter((t) => (t.source ?? "tweakcn") === group.key).map((t) => ({ value: t.name, label: t.title })),
  }))
  .filter((group) => group.options.length > 0)

export const SettingsDialog: React.FC<{ isOpen: boolean; onOpenChange: (open: boolean) => void; state: any, setState: any }> = ({ isOpen, onOpenChange, state, setState }) => {
  const { theme, toggleTheme, setTheme: setAppTheme } = useTheme()
  const { setTheme: setColorTheme } = useColorTheme()
  const [showThemeEditor, setShowThemeEditor] = useState(false)
  const setCustomThemes = useSetAtom(customThemesAtom)
  // The theme-editor package has no built-in preset library (see README) — this
  // just hands its "Load Preset" picker off to the same setter ColorThemeSelect
  // uses. That flips this app's own data-theme attribute, which the editor's
  // MutationObserver (useThemeEditor.ts) already watches and re-snapshots from,
  // so no extra plumbing is needed on the editor's side.
  const handleLoadPreset = useCallback((name: string) => setColorTheme(name), [setColorTheme])
  // Auto-suffixes if the name collides with a BUILT-IN preset — otherwise two
  // [data-theme="cyberpunk-light"] rules (the real preset's + a same-named
  // custom save) would exist at once, and Radix Select would have two items
  // sharing one value. Saving over an EXISTING custom theme under the same
  // name is still a normal upsert (that's the "update" path), just never a
  // built-in one.
  const handleSaveTheme = useCallback((name: string, css: string) => {
    const isBuiltInCollision = sortedThemes.some((t) => t.name === name)
    const safeName = isBuiltInCollision ? `${name}-custom` : name
    const safeCss = isBuiltInCollision
      ? css.split(`"${name}-light"`).join(`"${safeName}-light"`).split(`"${name}-dark"`).join(`"${safeName}-dark"`)
      : css
    setCustomThemes((prev) => [...prev.filter((t) => t.name !== safeName), { name: safeName, css: safeCss }])
  }, [setCustomThemes])
  // The theme-editor package has no way to see this app's own light/dark
  // toggle, so Randomize's coin-flipped mode is synced back here. Sets the
  // ABSOLUTE target rather than comparing against `theme` and conditionally
  // toggling — rapid repeated calls (e.g. mashing the dice button) fire
  // faster than React re-renders, so a comparison against the `theme`
  // closure can read a stale value and desync from what was actually just
  // randomized; an idempotent direct set can't drift regardless of timing.
  const handleModeChange = useCallback((isDark: boolean) => {
    setAppTheme(isDark ? "dark" : "light")
  }, [setAppTheme])
  // const theme = state.theme
  // const setTheme = useCallback((v: string) => setState({theme: v}), [setState])
  // const toggleTheme = useCallback(() => setTheme(theme === "light" ? "dark" : "light"), [theme, setTheme])
  
  const [mapboxKey, setMapboxKey] = useAtom(mapboxKeyAtom)
  const [googleKey, setGoogleKey] = useAtom(googleKeyAtom)
  const [maptilerKey, setMaptilerKey] = useAtom(maptilerKeyAtom)
  const [titilerEndpoint, setTitilerEndpoint] = useAtom(titilerEndpointAtom)
  const [batchEditMode, setBatchEditMode] = useState(false)
  const [batchApiKeys, setBatchApiKeys] = useState("")
  const [useCogProtocolVsTitiler, setUseCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)
  const [isTransparentUi, setTransparentUi] = useAtom(transparentUiAtom)
  const [highResTerrain, setHighResTerrain] = useAtom(highResTerrainAtom)
  const [useClientExport, setUseClientExport] = useAtom(useClientExportAtom)
  const [cacheVizTiles, setCacheVizTiles] = useAtom(cacheVizTilesAtom)
  const [persistLocalCogs, setPersistLocalCogs] = useAtom(persistLocalCogsAtom)
  const [persistVectorLayers, setPersistVectorLayers] = useAtom(persistVectorLayersAtom)
  const opfsSupported = isOpfsSupported()
  const [opfsSummary, setOpfsSummary] = useState<{ count: number; bytes: number; quotaBytes: number | null } | null>(null)
  const [opfsVectorSummary, setOpfsVectorSummary] = useState<{ count: number; bytes: number; quotaBytes: number | null } | null>(null)
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

  const refreshOpfsSummary = useCallback(async () => {
    if (!opfsSupported) return
    const [entries, estimate] = await Promise.all([listPersistedCogs(), estimateStorage()])
    setOpfsSummary({
      count: entries.length,
      bytes: entries.reduce((sum, e) => sum + e.size, 0),
      quotaBytes: estimate.quotaBytes,
    })
  }, [opfsSupported])

  const refreshOpfsVectorSummary = useCallback(async () => {
    if (!opfsSupported) return
    const [entries, estimate] = await Promise.all([listPersistedVectorLayers(), estimateStorage()])
    setOpfsVectorSummary({
      count: entries.length,
      bytes: entries.reduce((sum, e) => sum + e.size, 0),
      quotaBytes: estimate.quotaBytes,
    })
  }, [opfsSupported])

  // Refresh whenever the dialog opens — cheap, and the persisted set can
  // change any time a local COG or drawn/imported vector layer is added/
  // deleted elsewhere in the sidebar.
  useEffect(() => {
    if (isOpen) {
      refreshOpfsSummary()
      refreshOpfsVectorSummary()
    }
  }, [isOpen, refreshOpfsSummary, refreshOpfsVectorSummary])

  const handleClearPersistedCogs = useCallback(async () => {
    await clearAllPersistedCogs()
    refreshOpfsSummary()
  }, [refreshOpfsSummary])

  const handleClearPersistedVectorLayers = useCallback(async () => {
    await clearAllPersistedVectorLayers()
    refreshOpfsVectorSummary()
  }, [refreshOpfsVectorSummary])

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
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Keyboard Shortcuts</h3>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">Shift</kbd> <span className="mx-1">(tap alone, either side)</span> — toggle the Raster Basemap on/off, without opening the sidebar.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">Ctrl</kbd> <span className="mx-1">(tap alone, either side)</span> — hide every visualization mode down to just the plain basemap; tap again to restore whichever modes were on.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">Space</kbd> — re-toggle whichever visualization-mode checkbox you last clicked, even after a map drag has moved keyboard focus onto the map canvas.</div>
              <div><kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-foreground">L</kbd> <span className="mx-1">(hold)</span> + drag — set the Hillshade illumination direction/altitude directly on the map instead of panning it; release L or the mouse to exit.</div>
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

            <div className="flex items-center justify-between pt-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="cache-viz-tiles">Cache Computed Viz-Mode Tiles</Label>
                <span className="text-xs text-muted-foreground">
                  Keeps finished Slope-and-More / detector tiles in memory (up to ~96MB) so re-toggling a mode is instant instead of recomputing
                </span>
              </div>
              <Switch
                id="cache-viz-tiles"
                checked={cacheVizTiles}
                className="cursor-pointer"
                onCheckedChange={setCacheVizTiles}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="titiler-endpoint">Titiler Endpoint</Label>
            <Input id="titiler-endpoint" type="text" placeholder="https://titiler.xyz" value={titilerEndpoint} onChange={(e) => setTitilerEndpoint(e.target.value)} className="cursor-text" />
          </div>

          <Separator />
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Browser Local Storage Persistence</h3>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Local COG Files</Label>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="persist-local-cogs" className="sr-only">Remember local COG files between sessions</Label>
                  <span className="text-xs text-muted-foreground">
                    {opfsSupported
                      ? "Remember local COG files between sessions — copies picked local COG files into this browser's private storage (OPFS) so you don't need to re-pick them after a reload."
                      : "Not supported in this browser — local COG files will always need re-picking after a reload."}
                  </span>
                </div>
                <Switch
                  id="persist-local-cogs"
                  checked={persistLocalCogs}
                  disabled={!opfsSupported}
                  className="cursor-pointer"
                  onCheckedChange={setPersistLocalCogs}
                />
              </div>
              {opfsSupported && opfsSummary && (
                <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                  <span>
                    {opfsSummary.count === 0
                      ? "No local COG files persisted yet"
                      : `${opfsSummary.count} file${opfsSummary.count === 1 ? "" : "s"} persisted — ${formatBytes(opfsSummary.bytes)}${opfsSummary.quotaBytes ? ` (browser storage quota for this site: ~${formatBytes(opfsSummary.quotaBytes)}, shared with everything else this site stores)` : ""}`}
                  </span>
                  {opfsSummary.count > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer text-muted-foreground hover:text-destructive" onClick={handleClearPersistedCogs}>
                      <Trash2 className="h-3 w-3 mr-1" /> Clear
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Vector Layers (TerraDraw)</Label>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="persist-vector-layers" className="sr-only">Remember drawn/imported layers between sessions</Label>
                  <span className="text-xs text-muted-foreground">
                    {opfsSupported
                      ? "Remember drawn/imported layers between sessions — copies drawn and imported vector layers (Tools: Drawing) into this browser's private storage (OPFS) so they survive a reload."
                      : "Not supported in this browser — drawn/imported layers will always be lost on a reload."}
                  </span>
                </div>
                <Switch
                  id="persist-vector-layers"
                  checked={persistVectorLayers}
                  disabled={!opfsSupported}
                  className="cursor-pointer"
                  onCheckedChange={setPersistVectorLayers}
                />
              </div>
              {opfsSupported && opfsVectorSummary && (
                <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                  <span>
                    {opfsVectorSummary.count === 0
                      ? "No vector layers persisted yet"
                      : `${opfsVectorSummary.count} layer${opfsVectorSummary.count === 1 ? "" : "s"} persisted — ${formatBytes(opfsVectorSummary.bytes)}${opfsVectorSummary.quotaBytes ? ` (browser storage quota for this site: ~${formatBytes(opfsVectorSummary.quotaBytes)}, shared with everything else this site stores)` : ""}`}
                  </span>
                  {opfsVectorSummary.count > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 cursor-pointer text-muted-foreground hover:text-destructive" onClick={handleClearPersistedVectorLayers}>
                      <Trash2 className="h-3 w-3 mr-1" /> Clear
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

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
            <p className="text-xs text-muted-foreground">
              Most of these modes are supported by — and inspired by — <span className="font-semibold text-foreground">gdaldem</span>{" "}
              and the <span className="font-semibold text-foreground">RVT (Relief Visualization Toolbox)</span> QGIS plugin.
            </p>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div><span className="font-semibold text-foreground">Slope:</span> magnitude of the gradient</div>
              <div><span className="font-semibold text-foreground">Aspect:</span> direction of the gradient</div>
              <div>
                <div><span className="font-semibold text-foreground">Curvature:</span> rate of slope change — Profile, Plan, Mean/Combined, or Gaussian (Det Hessian)</div>
                <ul className="list-disc pl-5 pt-1 space-y-1">
                  <li><span className="font-medium text-foreground">Profile (Flow Acceleration):</span> rate of slope change along the steepest-descent direction, affects flow acceleration</li>
                  <li><span className="font-medium text-foreground">Plan (Convergence/Divergence):</span> rate of aspect change across contours, affects flow convergence/divergence — equivalent to the divergence of the normalized gradient field, div(∇z/|∇z|)</li>
                  <li><span className="font-medium text-foreground">Mean/Combined:</span> discrete Laplacian (∇²z) — mean curvature H = (κ₁+κ₂)/2, general surface bending that doesn't separate flow direction from contour direction</li>
                  <li><span className="font-medium text-foreground">Gaussian Curvature (Det Hessian):</span> determinant of the Hessian (fxx·fyy − fxy²) — Gaussian curvature K = κ₁·κ₂, a blob/saddle detector, positive at bowl/dome-shaped extrema and negative at saddle points</li>
                </ul>
              </div>
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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Tells (Mound Candidates) Detection</h3>
              <div className="flex items-center gap-2">
                <Label htmlFor="tells-beta" className="text-xs font-normal text-muted-foreground">Beta</Label>
                <Switch
                  id="tells-beta"
                  checked={state.tellsBeta}
                  className="cursor-pointer"
                  onCheckedChange={(checked) => setState({ tellsBeta: checked })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Computes a <span className="font-semibold text-foreground">Difference-of-Gaussians of the LRM</span>{" "}
              (DoG-of-LRM) as the primary bump signal, keeps only its local maxima
              (non-maximum suppression scaled to the configured tell size), then vetoes
              candidates that fail any of three shape filters: <span className="font-semibold text-foreground">Blobness</span>{" "}
              (structure-tensor peak/pit detector), <span className="font-semibold text-foreground">Plan Curvature / Divergence</span>{" "}
              (rejects saddles and ridges where flow diverges outward across contours), and{" "}
              <span className="font-semibold text-foreground">Det-Hessian</span> (rejects saddle points, keeps bowl/dome shapes).
            </p>
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
            <h3 className="text-sm font-semibold">Map Bounds</h3>
            <p className="text-xs text-muted-foreground">
              Constrains panning/zooming to a bounding box, instead of the one-shot camera
              fly-to above. "Terrain"/"Raster"/"Union" are resolved automatically from the
              active source(s) (COG/tilejson metadata) and update if you switch sources.
            </p>
            <div className="space-y-1">
              <Label>Mode</Label>
              <Select value={state.maxBoundsMode} onValueChange={(value) => setState({ maxBoundsMode: value as MaxBoundsMode })}>
                <SelectTrigger className="w-full cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_BOUNDS_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {{
                        none: "None",
                        terrain: "Terrain Source Bounds",
                        raster: "Raster Basemap Bounds",
                        union: "Union (Terrain + Raster)",
                        custom: "Custom (WSNE)",
                      }[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {state.maxBoundsMode !== "none" && (
              <div className="space-y-1">
                <Label htmlFor="max-bounds-buffer">Buffer (degrees)</Label>
                <Input
                  id="max-bounds-buffer"
                  type="number"
                  step="0.01"
                  min="0"
                  value={state.maxBoundsBuffer}
                  onChange={(e) => setState({ maxBoundsBuffer: Number.parseFloat(e.target.value) || 0 })}
                  className="cursor-text"
                />
              </div>
            )}
            {state.maxBoundsMode === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="max-bounds-west">West</Label>
                  <Input id="max-bounds-west" type="number" value={state.maxBoundsWest} onChange={(e) => setState({ maxBoundsWest: Number.parseFloat(e.target.value) || 0 })} className="cursor-text" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="max-bounds-south">South</Label>
                  <Input id="max-bounds-south" type="number" value={state.maxBoundsSouth} onChange={(e) => setState({ maxBoundsSouth: Number.parseFloat(e.target.value) || 0 })} className="cursor-text" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="max-bounds-east">East</Label>
                  <Input id="max-bounds-east" type="number" value={state.maxBoundsEast} onChange={(e) => setState({ maxBoundsEast: Number.parseFloat(e.target.value) || 0 })} className="cursor-text" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="max-bounds-north">North</Label>
                  <Input id="max-bounds-north" type="number" value={state.maxBoundsNorth} onChange={(e) => setState({ maxBoundsNorth: Number.parseFloat(e.target.value) || 0 })} className="cursor-text" />
                </div>
              </div>
            )}
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

          <Separator />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Color Theme</h3>
            <p className="text-xs text-muted-foreground">
              Preset UI color palette (<a href="https://github.com/BankkRoll/tweakcn-theme-picker" target="_blank" rel="noopener noreferrer" className="underline">tweakcn</a>) —
              light/dark still follows the Theme toggle under Appearance above.
            </p>
            <ColorThemeSelect />
            <Button variant="outline" size="sm" className="w-full cursor-pointer" onClick={() => setShowThemeEditor(true)}>
              Advanced Theme Editor
            </Button>
            <p className="text-xs text-muted-foreground">
              Live-edit every color/radius/shadow/font token (see theme-editor/README.md)
              and copy the result as a new preset CSS block.
            </p>
          </div>
        </div>
      </DialogContent>
      {showThemeEditor && (
        <ThemeEditorPanel
          onClose={() => setShowThemeEditor(false)}
          onSaveTheme={handleSaveTheme}
          onModeChange={handleModeChange}
          presetGroups={PRESET_GROUPS}
          onLoadPreset={handleLoadPreset}
        />
      )}
    </Dialog >
  )
}