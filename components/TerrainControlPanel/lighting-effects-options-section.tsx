import type React from "react"
import { useState, useCallback } from "react"
import { useAtom } from "jotai"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Section, CheckboxWithSlider, SliderControl, SegmentedToggle } from "./controls-components"
import { LightDirectionControl } from "./light-direction-control"
import { useDebouncedState } from "./use-debounced-state"
import { cn } from "@/lib/utils"
import { activeSliderAtom } from "@/lib/settings-atoms"
import { MATCAP_TEXTURES } from "@/lib/matcap-textures"

// Common width for the Phong toggle groups (see SegmentedToggle in
// controls-components for the segmented-control styling + why the active pill
// is driven by an explicit value match rather than data-[state=on]).
const SEG_WIDTH = "w-[200px]"

const MATCAP_IDS = MATCAP_TEXTURES.map((t) => t.id)

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
  const [isLightDirOpen, setIsLightDirOpen] = useState(true)
  const [isIntensitiesOpen, setIsIntensitiesOpen] = useState(true)

  // When ANY slider (a MobileSlider/SphericalXYPad) is actively being dragged,
  // everything that isn't the active control dims (the transparent-UI "silence
  // everything except what I'm editing" behavior). Toggle groups + section
  // labels aren't sliders so they never set/own the active id — so dim them
  // whenever an active slider exists. The datetime Date/Time sliders + the XY
  // pad share the "phong-light" id, so editing them dims these toggle rows
  // while keeping only the pad + sliders lit, as requested.
  const [activeSlider] = useAtom(activeSliderAtom)
  const dimWhenSliding = cn("transition-opacity duration-150", activeSlider !== null && "opacity-20")

  const cycleMatcap = useCallback((direction: number) => {
    const currentIndex = MATCAP_IDS.indexOf(state.matcapTextureId)
    const newIndex = (currentIndex + direction + MATCAP_IDS.length) % MATCAP_IDS.length
    setState({ matcapTextureId: MATCAP_IDS[newIndex] })
  }, [state.matcapTextureId, setState])

  const [matcapRotationDeg, setMatcapRotationDeg] = useDebouncedState(
    state.matcapRotationDeg, useCallback((v: number) => setState({ matcapRotationDeg: v }), [setState]),
  )
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
  if (!state.showLightingEffects) return null

  return (
    <Section title="Lighting Effects" isOpen={isOpen} onOpenChange={onOpenChange} pulseKey="showLightingEffects">
      <div className="space-y-4">
        {/* ─── Matcap sub-mode ─── */}
        <div className="space-y-2">
          <CheckboxWithSlider
            id="lighting-matcap"
            label="Matcap"
            tooltip="Shades the terrain surface from a material-capture image (like a 3D sculpting tool) instead of a directional light."
            checked={state.showMatcap}
            onCheckedChange={(checked) => setState({ showMatcap: checked })}
            sliderValue={state.matcapOpacity}
            onSliderChange={(value) => setState({ matcapOpacity: value })}
          />
          {state.showMatcap && (
            <div className="space-y-3 pl-1">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Material</Label>
                <div className="flex gap-2">
                  <Select value={state.matcapTextureId} onValueChange={(value) => setState({ matcapTextureId: value })}>
                    <SelectTrigger className="flex-1 min-w-0 w-full cursor-pointer">
                      <SelectValue />
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
            </div>
          )}
        </div>

        {/* ─── Phong sub-mode ─── */}
        <div className="space-y-2">
          <CheckboxWithSlider
            id="lighting-phong"
            label="Phong"
            tooltip="Ambient+diffuse+specular shading against the raster basemap as albedo, with a movable light — a physically-flavored alternative to a matcap material."
            checked={state.showPhong}
            onCheckedChange={(checked) => setState({ showPhong: checked })}
            sliderValue={state.phongOpacity}
            onSliderChange={(value) => setState({ phongOpacity: value })}
          />
          {state.showPhong && (
            <div className="space-y-3 pl-1">
              <div className={cn("flex items-center justify-between gap-2", dimWhenSliding)}>
                <Label className="text-sm font-medium">Renderer</Label>
                <SegmentedToggle
                  className={SEG_WIDTH}
                  value={state.phongRenderer}
                  onChange={(value) => setState({ phongRenderer: value })}
                  options={[
                    { value: "raster", label: "3D Slow", tooltip: "Drapes correctly over 3D terrain exaggeration and globe, but every light/strength change re-fetches a tile (~150ms debounced)." },
                    { value: "live", label: "2D Fast", tooltip: "A live GPU shader, instant light/strength updates, zero tile refetch — projects correctly under mercator and globe, but flat only: doesn't drape onto 3D terrain elevation." },
                  ]}
                />
              </div>
              {/* Intensities — albedo/diffuse/specular, foldable, above Light Anchor. */}
              <Collapsible open={isIntensitiesOpen} onOpenChange={setIsIntensitiesOpen}>
                <CollapsibleTrigger className={cn("flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer", dimWhenSliding)}>
                  Intensities<ChevronDown className={`h-4 w-4 transition-transform ${isIntensitiesOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-1">
                  <SliderControl label="Albedo (Raster Basemap Opacity)" value={state.rasterBasemapOpacity} onChange={(v) => setState({ rasterBasemapOpacity: v })} min={0} max={1} step={0.05} decimals={2} sliderId="phong-albedo" />
                  <SliderControl label="Diffuse Strength" value={phongDiffuseStrength} onChange={setPhongDiffuseStrength} min={0} max={1} step={0.05} decimals={2} sliderId="phong-diffuse" />
                  <SliderControl label="Specular Strength" value={phongSpecularStrength} onChange={setPhongSpecularStrength} min={0} max={1} step={0.05} decimals={2} sliderId="phong-specular" />
                </CollapsibleContent>
              </Collapsible>
              {/* Light Anchor: Absolute keeps the light fixed to compass
                  directions; Camera makes it a headlamp fixed to the view.
                  Only 2D Fast (live) can do a true per-frame camera headlamp,
                  so this is disabled + forced to Absolute in 3D Slow (raster),
                  which always renders absolute (see TerrainViewer.tsx). */}
              <div className={cn("flex items-center justify-between gap-2", dimWhenSliding)}>
                <Label className="text-sm font-medium">Light Anchor</Label>
                <SegmentedToggle
                  className={SEG_WIDTH}
                  disabled={state.phongRenderer === "raster"}
                  value={state.phongRenderer === "raster" ? "absolute" : (state.phongLightRelativeToCamera ? "relative" : "absolute")}
                  onChange={(value) => setState({ phongLightRelativeToCamera: value === "relative" })}
                  options={[
                    { value: "absolute", label: "Absolute", tooltip: "Light stays fixed to compass directions as you rotate the map — matches maplibre's own hillshade illumination direction." },
                    { value: "relative", label: "Camera", tooltip: state.phongRenderer === "raster" ? "Camera-relative light is only available in 2D Fast." : "Light stays fixed relative to the camera — it appears to follow you as you rotate the map, like a headlamp." },
                  ]}
                />
              </div>
              <Collapsible open={isLightDirOpen} onOpenChange={setIsLightDirOpen}>
                <CollapsibleTrigger className={cn("flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer", dimWhenSliding)}>
                  Light Direction<ChevronDown className={`h-4 w-4 transition-transform ${isLightDirOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1 overflow-visible">
                  <LightDirectionControl
                    state={state}
                    setState={setState}
                    sliderId="phong-light"
                    debounceMs={phongDebounceMs}
                  />
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
