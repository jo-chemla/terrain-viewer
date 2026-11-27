import type React from "react"
import { perViewProps, modeOnVisibleView } from "@/lib/viz-views"
import { useState, useCallback, useMemo } from "react"
import { useAtom, useAtomValue } from "jotai"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Section, CheckboxWithSlider, SliderControl, SegmentedToggle, AdvancedModeToggle } from "./controls-components"
import { LightDirectionControl } from "./light-direction-control"
import { useDebouncedState } from "./use-debounced-state"
import { activeProjectConfigAtom, buildingShadowStatsAtom, customVectorSourcesAtom, lightingEffectsAdvancedAtom, shadowLiveUnsupportedAtom } from "@/lib/settings-atoms"
import { buildingSourceEntry, isBuildingSource, DEFAULT_BUILDING_SOURCE_ID } from "@/lib/building-tiles"
import { allVectorSources, DEFAULT_HEIGHT_M } from "@/lib/vector-sources"
import { MATCAP_TEXTURES } from "@/lib/matcap-textures"
import { SHADOW_RADIUS_MAX_PX } from "@/lib/shadow-protocol"

// Common width for the Phong toggle groups (see SegmentedToggle in
// controls-components for the segmented-control styling + why the active pill
// is driven by an explicit value match rather than data-[state=on]).
const SEG_WIDTH = "w-[200px]"

const MATCAP_IDS = MATCAP_TEXTURES.map((t) => t.id)

// The Library's building sources as the shadow picker names them.
const BUILDING_SOURCE_LABELS: Record<string, string> = {
  [DEFAULT_BUILDING_SOURCE_ID]: "OpenStreetMap (OpenFreeMap)",
  "overture-buildings": "Overture Maps",
}
// Under this share of buildings stating a height, the line turns into a warning.
const FEW_HEIGHTS = 0.5

/** What the loaded building tiles hold: the share of buildings with a
 *  stated height, said louder when it is low (Overture outside North
 *  America: most buildings then cast the shadow of the default height). */
function BuildingHeightsLine({ heights, hasFloors, derived }: { heights: { buildings: number; stated: number; floors: number; pending: number; error?: string }; hasFloors: boolean; derived: boolean }) {
  if (heights.error) return <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400 break-words">This source could not be read ({heights.error}).</p>
  if (!heights.buildings) return heights.pending ? <p className="text-[11px] leading-snug text-muted-foreground">Loading buildings…</p> : null
  // OpenFreeMap's tiles give every building a rendering height (5 m when OSM
  // has none) and merge neighbours into one feature: a share would say nothing.
  if (derived) return null
  const share = heights.stated / heights.buildings
  const percent = (n: number) => `${n > 0 && n < 0.01 ? "<1" : Math.round(n * 100)} %`
  const few = share < FEW_HEIGHTS
  const floors = hasFloors && heights.floors > 0 ? `, ${percent(heights.floors / heights.buildings)} only floors (3.2 m each)` : ""
  return (
    <p data-building-heights={share.toFixed(3)} className={`text-[11px] leading-snug break-words ${few ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
      {few ? "Few heights here: " : "Heights: "}{percent(share)} of {heights.buildings.toLocaleString("en-US")} buildings state one{floors}{few ? `; the others cast the shadow of a ${DEFAULT_HEIGHT_M} m building.` : "."}{heights.pending ? " Loading more…" : ""}
    </p>
  )
}

// "Lighting Effects" houses two independent shading sub-modes, mirroring
// Relief Visualization's LRM/SVF/Openness pattern (master checkbox+opacity at
// the top, each sub-mode its own CheckboxWithSlider + detail fields):
//  - "Matcap" (lib/matcap-protocol.ts): a material-capture lookup by surface
//    normal, rendered as a plain draped raster tile.
//  - "Phong" (lib/phong-protocol.ts): real ambient+diffuse+specular shading
//    from a compass-fixed light, same raster-tile approach.
// Both are plain `raster` layers draped over 3D terrain AND globe
// automatically — see either protocol module's header for why that's a
// prior hand-written WebGL layer (with its own mesh/depth-buffer handling
// AND its own globe-projection matrix) unnecessary, and the whole reason
// dragging any of these controls is debounced above: unlike a native
// `type: "hillshade"` paint property (a pure GPU uniform update), every
// change here re-fetches/recomputes a raster tile.
export const LightingEffectsOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({
  state,
  setState,
  isOpen,
  onOpenChange,
}) => {
  const perViewFor = perViewProps(state, setState)
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  // Opaque hiddenSections identifier, same pattern as splitScreen/sourceInfo —
  // drops the whole Shadows sub-mode (checkbox + detail fields) for embeds.
  const hideShadows = activeProjectConfig?.hiddenSections?.includes("shadows") ?? false
  // Same Basic/Advanced fold as Terrain Analysis / Relief Visualization
  // (AdvancedModeToggle in the header): Basic collapses each sub-mode
  // (Phong/Matcap/Shadows) to just its checkbox + opacity row.
  const [advanced, setAdvanced] = useAtom(lightingEffectsAdvancedAtom)
  const [isLightDirOpen, setIsLightDirOpen] = useState(true)
  const [isIntensitiesOpen, setIsIntensitiesOpen] = useState(true)
  // Shadows' own copy of the Light Direction fold — the pad edits the SAME
  // shared illuminationDir/illuminationAlt as Phong/Hillshade, it's just
  // surfaced here too so turning Shadows on alone doesn't require opening
  // Phong to move the light. Default closed (Phong's stays the primary).
  const [isShadowLightDirOpen, setIsShadowLightDirOpen] = useState(false)
  const shadowLiveUnsupported = useAtomValue(shadowLiveUnsupportedAtom)
  // Building shadows: the vector sources with a height (the Library's and
  // the user's own), and what the views have loaded of the chosen one.
  const customVectorSources = useAtomValue(customVectorSourcesAtom)
  // The default first, then the Library's order, then the user's own.
  const buildingSources = useMemo(() => allVectorSources(customVectorSources).filter(isBuildingSource).sort((a, b) => Number(b.id === DEFAULT_BUILDING_SOURCE_ID) - Number(a.id === DEFAULT_BUILDING_SOURCE_ID)), [customVectorSources])
  const buildingSource = buildingSourceEntry(state.buildingShadowSource, customVectorSources)
  const buildingSourceItems = useMemo(() => Object.fromEntries(buildingSources.map((s) => [s.id, BUILDING_SOURCE_LABELS[s.id] ?? s.shortName ?? s.name])), [buildingSources])
  const buildingStats = useAtomValue(buildingShadowStatsAtom)
  const buildingHeights = useMemo(() => {
    let buildings = 0, stated = 0, floors = 0, pending = 0, error: string | undefined
    for (const v of Object.values(buildingStats)) {
      if (v.sourceId !== buildingSource.id) continue
      buildings += v.buildings; stated += v.stated; floors += v.floors; pending += v.pending
      error ??= v.error
    }
    return { buildings, stated, floors, pending, error }
  }, [buildingStats, buildingSource.id])

  // Same live-vs-raster debounce split as Phong below — "live" is a GPU
  // uniform with zero tile refetch (0ms), "raster" re-fetches a tile per
  // change (the gentler 150ms default).
  const matcapDebounceMs = state.matcapRenderer === "live" ? 0 : 150
  const [matcapRotationDeg, setMatcapRotationDeg] = useDebouncedState(
    state.matcapRotationDeg, useCallback((v: number) => setState({ matcapRotationDeg: v }), [setState]), matcapDebounceMs,
  )
  // The material picker gets a debounce in BOTH renderers (rotation only
  // needs one for raster): a texture change is never free — raster
  // re-fetches every visible tile, and even live fetches + uploads a new
  // material image — so rapid chevron-cycling through the list should only
  // commit the one the user lands on. The local value keeps the Select and
  // cycle buttons instantly responsive meanwhile.
  const [matcapTextureId, setMatcapTextureId] = useDebouncedState(
    state.matcapTextureId, useCallback((v: string) => setState({ matcapTextureId: v }), [setState]), 250,
  )
  const cycleMatcap = useCallback((direction: number) => {
    const currentIndex = MATCAP_IDS.indexOf(matcapTextureId)
    const newIndex = (currentIndex + direction + MATCAP_IDS.length) % MATCAP_IDS.length
    setMatcapTextureId(MATCAP_IDS[newIndex])
  }, [matcapTextureId, setMatcapTextureId])
  // The "live" (2D Fast) renderer updates via GPU uniforms with zero tile
  // refetch, so it isn't debounced at all (0ms — every drag frame applies
  // immediately); "raster" (3D Slow) re-fetches every visible tile per change,
  // so it keeps the gentler 150ms debounce.
  const phongDebounceMs = state.phongRenderer === "live" ? 0 : 150
  const [phongDiffuseStrength, setPhongDiffuseStrength] = useDebouncedState(
    state.phongDiffuseStrength, useCallback((v: number) => setState({ phongDiffuseStrength: v }), [setState]), phongDebounceMs,
  )
  const [phongSpecularStrength, setPhongSpecularStrength] = useDebouncedState(
    state.phongSpecularStrength, useCallback((v: number) => setState({ phongSpecularStrength: v }), [setState]), phongDebounceMs,
  )
  const [phongFresnelStrength, setPhongFresnelStrength] = useDebouncedState(
    state.phongFresnelStrength, useCallback((v: number) => setState({ phongFresnelStrength: v }), [setState]), phongDebounceMs,
  )
  const [phongFresnelPower, setPhongFresnelPower] = useDebouncedState(
    state.phongFresnelPower, useCallback((v: number) => setState({ phongFresnelPower: v }), [setState]), phongDebounceMs,
  )
  // Live terrain shadows take every slider frame (uniforms); tiles and
  // building shadows keep the 150 ms debounce.
  const shadowLiveDraws = state.showShadows && state.shadowRenderer === "live" && !shadowLiveUnsupported
  if (!state.showLightingEffects) return null

  return (
    <Section id="tour-lighting-effects-section" title="Lighting Effects" isOpen={isOpen} onOpenChange={onOpenChange} pulseKey="showLightingEffects" headerExtra={<AdvancedModeToggle advanced={advanced} onToggle={() => setAdvanced(!advanced)} />}>
      <div className="space-y-4">
        {/* ─── Phong sub-mode ─── */}
        <div className="space-y-2">
          <CheckboxWithSlider perView={perViewFor("showPhong")}
            id="lighting-phong"
            label="Phong"
            tooltip="Ambient+diffuse+specular shading against the raster basemap as albedo, with a movable light — a physically-flavored alternative to a matcap material."
            checked={state.showPhong}
            onCheckedChange={(checked) => setState({ showPhong: checked })}
            sliderValue={state.phongOpacity}
            onSliderChange={(value) => setState({ phongOpacity: value })}
          />
          {modeOnVisibleView(state, "showPhong") && advanced && (
            <div className="space-y-3 pl-1">
              {/* Renderer: live is the default and the only path offered; the
                  raster ("legacy") pipeline stays reachable through the
                  phongRenderer / matcapRenderer URL parameters for captures. */}
              {/* Intensities — albedo/diffuse/specular, foldable, above Light Anchor. */}
              <Collapsible open={isIntensitiesOpen} onOpenChange={setIsIntensitiesOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                  Intensities<ChevronDown className={`h-4 w-4 transition-transform ${isIntensitiesOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-1">
                  <SliderControl label="Albedo (Raster Basemap Opacity)" value={state.rasterBasemapOpacity} onChange={(v) => setState({ rasterBasemapOpacity: v })} min={0} max={1} step={0.05} decimals={2} sliderId="phong-albedo" />
                  <SliderControl label="Diffuse Strength" value={phongDiffuseStrength} onChange={setPhongDiffuseStrength} min={0} max={1} step={0.05} decimals={2} sliderId="phong-diffuse" />
                  <SliderControl label="Specular Strength" value={phongSpecularStrength} onChange={setPhongSpecularStrength} min={0} max={1} step={0.05} decimals={2} sliderId="phong-specular" />
                  {/* Fresnel rim: view dependent (the camera's own direction),
                      so the live renderer only; the raster path ignores it. */}
                  <SliderControl label="Fresnel Rim" value={phongFresnelStrength} onChange={setPhongFresnelStrength} min={0} max={1} step={0.05} decimals={2} sliderId="phong-fresnel" />
                  {phongFresnelStrength > 0 && (
                    <SliderControl label="Rim Falloff" value={phongFresnelPower} onChange={setPhongFresnelPower} min={1} max={16} step={0.5} decimals={1} sliderId="phong-fresnel-power" />
                  )}
                </CollapsibleContent>
              </Collapsible>
              {/* Light Anchor: Absolute keeps the light fixed to compass
                  directions; Camera makes it a headlamp fixed to the view.
                  Only 2D Fast (live) can do a true per-frame camera headlamp,
                  so this is disabled + forced to Absolute in 3D Slow (raster),
                  which always renders absolute (see TerrainViewer.tsx). */}
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">Light Anchor</Label>
                <SegmentedToggle
                  className={SEG_WIDTH}
                  disabled={state.phongRenderer === "raster"}
                  value={state.phongRenderer === "raster" ? "absolute" : (state.phongLightRelativeToCamera ? "relative" : "absolute")}
                  onChange={(value) => setState({ phongLightRelativeToCamera: value === "relative" })}
                  options={[
                    { value: "absolute", label: "Absolute", tooltip: "Light stays fixed to compass directions as you rotate the map — matches maplibre's own hillshade illumination direction." },
                    { value: "relative", label: "Camera", tooltip: state.phongRenderer === "raster" ? "Camera-relative light is only available in the Live renderer." : "Light stays fixed relative to the camera — it appears to follow you as you rotate the map, like a headlamp." },
                  ]}
                />
              </div>
              {/* Same group key as the pad inside: its fold title stays lit with it. */}
              <Collapsible data-slider-group="phong-light" open={isLightDirOpen} onOpenChange={setIsLightDirOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                  Light Direction<ChevronDown className={`h-4 w-4 transition-transform ${isLightDirOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1 overflow-visible">
                  <LightDirectionControl
                    state={state}
                    setState={setState}
                    sliderId="phong-light"
                    debounceMs={phongDebounceMs}
                    // Camera ("headlamp") anchor reinterprets azimuth as an
                    // offset from the camera heading — show screen-relative
                    // arrows on the pad instead of compass N/E/S/W. Only the
                    // Live renderer honors the Camera anchor (raster forces
                    // Absolute), hence the renderer check too.
                    cameraRelative={state.phongRenderer === "live" && state.phongLightRelativeToCamera}
                    multiLight={state.phongRenderer === "live"}
                  />
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>

        {/* ─── Matcap sub-mode ─── */}
        <div className="space-y-2">
          <CheckboxWithSlider perView={perViewFor("showMatcap")}
            id="lighting-matcap"
            label="Matcap"
            tooltip="Shades the terrain surface from a material-capture image (like a 3D sculpting tool) instead of a directional light."
            checked={state.showMatcap}
            onCheckedChange={(checked) => setState({ showMatcap: checked })}
            sliderValue={state.matcapOpacity}
            onSliderChange={(value) => setState({ matcapOpacity: value })}
          />
          {modeOnVisibleView(state, "showMatcap") && advanced && (
            <div className="space-y-3 pl-1">
              {/* Renderer: live is the default and the only path offered; the
                  raster ("legacy") pipeline stays reachable through the
                  phongRenderer / matcapRenderer URL parameters for captures. */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Material</Label>
                <div className="flex gap-2">
                  <Select
                    value={matcapTextureId}
                    onValueChange={(value) => value && setMatcapTextureId(value)}
                    items={MATCAP_TEXTURES.map((tex) => ({ value: tex.id, label: tex.name }))}
                  >
                    <SelectTrigger className="flex-1 min-w-0 w-full cursor-pointer">
                      <SelectValue>
                        {(() => {
                          const current = MATCAP_TEXTURES.find((tex) => tex.id === matcapTextureId)
                          return (
                            <div className="flex items-center gap-2">
                              {current && <img src={current.url} alt="" className="w-5 h-5 rounded-full object-cover border shrink-0" />}
                              <span>{current?.name ?? matcapTextureId}</span>
                            </div>
                          )
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MATCAP_TEXTURES.map((tex) => (
                        <SelectItem key={tex.id} value={tex.id}>
                          <div className="flex items-center gap-2">
                            <img src={tex.url} alt="" className="w-6 h-6 rounded-full object-cover border shrink-0" />
                            <span>{tex.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex border rounded-md shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => cycleMatcap(-1)} className="rounded-r-none border-r cursor-pointer">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => cycleMatcap(1)} className="rounded-l-none cursor-pointer">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <SliderControl
                label="Sphere Rotation"
                value={matcapRotationDeg}
                onChange={setMatcapRotationDeg}
                min={0} max={360} step={1} suffix="°"
                sliderId="matcap-rotation"
              />
              {/* Light Anchor: Absolute samples the material by the
                  tile-space normal (pinned to compass directions, identical
                  convention to the 3D Slow raster pipeline); Camera samples
                  by the view-space normal — the classic matcap look,
                  tracking the camera's real pitch/bearing live. Only 2D Fast
                  (live) can do the latter — disabled + forced Absolute in 3D
                  Slow (raster), same convention as Phong's toggle below.
                  Same convention as Phong's toggle above. See
                  lib/matcap-live-gl-layer.ts's header for why the older
                  per-fragment reflected-ray construction was scrapped. */}
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">Light Anchor</Label>
                <SegmentedToggle
                  className={SEG_WIDTH}
                  disabled={state.matcapRenderer === "raster"}
                  value={state.matcapRenderer === "raster" ? "absolute" : (state.matcapLightRelativeToCamera ? "relative" : "absolute")}
                  onChange={(value) => setState({ matcapLightRelativeToCamera: value === "relative" })}
                  options={[
                    { value: "absolute", label: "Absolute", tooltip: "Material pinned to compass directions — an east-facing slope always samples the same spot on the sphere, whatever the camera does." },
                    { value: "relative", label: "Camera", tooltip: state.matcapRenderer === "raster" ? "Camera-relative material is only available in the Live renderer." : "Classic matcap: the material follows the camera's real pitch and bearing, like a sphere held up to the current view." },
                  ]}
                />
              </div>
            </div>
          )}
        </div>

        {/* ─── Shadows sub-group: terrain and buildings ─── */}
        {!hideShadows && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Shadows</div>
          <CheckboxWithSlider perView={perViewFor("showShadows")}
            id="lighting-shadows"
            label="Terrain (+ buildings if DSM)"
            tooltip="Cast shadows of the elevation source: the bare ground with a terrain model (DTM, e.g. Mapterhorn), buildings and trees too with a surface model (DSM). Darkens a pixel wherever the ground between it and the sun rises above the sun's own angle in the sky. Live (GPU, default) marches every pixel's ray over the view and tens of kilometres beyond, Earth's curvature included, so the sun moves in real time; Tiles (CPU) computes them per tile within the Search Radius (256 px by default). Shares Phong/Hillshade's light direction (same pad below). On real relief most slopes are under 30°, so long shadows need a low sun: the outer rim of the pad."
            checked={state.showShadows}
            onCheckedChange={(checked) => setState({ showShadows: checked })}
            sliderValue={state.shadowOpacity}
            onSliderChange={(value) => setState({ shadowOpacity: value })}
          />
          {modeOnVisibleView(state, "showShadows") && advanced && (
            <div className="space-y-3 pl-1">
              {/* Live: lib/shadow-live-gl-layer.ts (GPU, whole view); Tiles:
                  the shadow:// tiles, what exports and the Iso-line use, and
                  the fallback when the live layer cannot draw here. */}
              <div className="flex items-center justify-between gap-2 min-w-0">
                <Label className="text-sm font-medium">Renderer</Label>
                <SegmentedToggle
                  className={SEG_WIDTH}
                  value={shadowLiveUnsupported ? "raster" : state.shadowRenderer}
                  disabled={!!shadowLiveUnsupported}
                  onChange={(value) => setState({ shadowRenderer: value as "live" | "raster" })}
                  options={[
                    { value: "live", label: "Live (GPU)", tooltip: shadowLiveUnsupported ? `The GPU renderer could not run here (${shadowLiveUnsupported}); using tiles.` : "Rays marched per pixel on the GPU over the view, then over a coarser mosaic reaching tens of kilometres beyond it, Earth's curvature included: the sun moves in real time, no radius." },
                    { value: "raster", label: "Tiles (CPU)", tooltip: "Computed per tile on the CPU within the Search Radius: the same pixels exports and the Iso-line use." },
                  ]}
                />
              </div>
              {state.shadowRenderer === "live" && !shadowLiveUnsupported && (
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <Label className="text-sm font-medium">Edge</Label>
                  <SegmentedToggle
                    className={SEG_WIDTH}
                    value={state.shadowSoft ? "soft" : "hard"}
                    onChange={(value) => setState({ shadowSoft: value === "soft" })}
                    options={[
                      { value: "soft", label: "Soft", tooltip: "Penumbra from the sun's 0.53° disc: the share of the disc above the horizon, so an edge widens with its distance from the ridge casting it (about 90 m at 10 km)." },
                      { value: "hard", label: "Hard", tooltip: "In or out of shadow at the sun's centre, as the tiles and exports." },
                    ]}
                  />
                </div>
              )}
              {(state.shadowRenderer === "raster" || shadowLiveUnsupported) && (
                <SliderControl
                  label="Search Radius (px)"
                  value={state.shadowRadiusPx}
                  onChange={(v) => setState({ shadowRadiusPx: v })}
                  min={2} max={SHADOW_RADIUS_MAX_PX} step={1}
                  sliderId="shadow-radius"
                />
              )}
            </div>
          )}
          <CheckboxWithSlider perView={perViewFor("showBuildingShadows")}
            id="lighting-building-shadows"
            label="Buildings (Vector shadows)"
            tooltip="Shadows cast by buildings, from the footprints and heights of a vector source: OpenStreetMap through OpenFreeMap by default (OSM height or levels), Overture Maps, or a source of your own with a height field. Drawn on flat ground at each building's foot: fast, recomputed when the map settles, from zoom 13. Draped over 3D terrain but not bent by it. Same light as terrain shadows."
            checked={state.showBuildingShadows}
            onCheckedChange={(checked) => setState({ showBuildingShadows: checked })}
            sliderValue={state.buildingShadowOpacity}
            onSliderChange={(value) => setState({ buildingShadowOpacity: value })}
          />
          {modeOnVisibleView(state, "showBuildingShadows") && (
            <div className="space-y-1 pl-1">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <Label className="text-sm font-medium shrink-0" title="The vector source the footprints and heights are read from: any source of the Library or of your own (Bring Your Own Data, Vector overlays) that has a height field. The overlay itself need not be on.">Buildings from</Label>
                <Select value={buildingSource.id} onValueChange={(value) => value && setState({ buildingShadowSource: value })} items={buildingSourceItems}>
                  <SelectTrigger id="lighting-building-shadow-source" className="h-8 text-xs flex-1 min-w-0 cursor-pointer"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {buildingSources.map((s) => <SelectItem key={s.id} value={s.id}>{buildingSourceItems[s.id]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <BuildingHeightsLine heights={buildingHeights} hasFloors={!!buildingSource.floorsField} derived={buildingSource.id === DEFAULT_BUILDING_SOURCE_ID} />
            </div>
          )}
          {/* Same shared illuminationDir/illuminationAlt pad Phong shows,
              for both kinds of shadow, so either works standalone. Debounced
              150 ms: terrain shadows recompute tiles per change. */}
          {(modeOnVisibleView(state, "showShadows") || modeOnVisibleView(state, "showBuildingShadows")) && advanced && (
            <Collapsible data-slider-group="shadow-light" open={isShadowLightDirOpen} onOpenChange={setIsShadowLightDirOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                Light Direction (shared with Phong/Hillshade)<ChevronDown className={`h-4 w-4 transition-transform ${isShadowLightDirOpen ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1 overflow-visible">
                <LightDirectionControl
                  state={state}
                  setState={setState}
                  sliderId="shadow-light"
                  debounceMs={shadowLiveDraws ? 0 : 150}
                />
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
        )}
      </div>
    </Section>
  )
}
