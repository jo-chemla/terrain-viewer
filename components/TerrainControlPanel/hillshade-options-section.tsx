import type React from "react"
import { useState, useCallback } from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Section, CheckboxWithSlider, SliderControl } from "./controls-components"
import { SphericalXYPad } from './XYPad'
import { MATCAP_TEXTURES } from "@/lib/matcap-textures"

const MATCAP_IDS = MATCAP_TEXTURES.map((t) => t.id)

// "Lighting Effects" houses two independent shading sub-modes, mirroring
// Relief Visualization's LRM/SVF/Openness pattern (master checkbox+opacity at
// the top, each sub-mode its own CheckboxWithSlider + detail fields):
//  - "Matcap" (lib/matcap-gl-layer.ts): a material-capture lookup by surface
//    normal, drawn by a hand-written WebGL layer.
//  - "Phong" (lib/phong-gl-layer.ts): real ambient+diffuse+specular shading
//    from a compass-fixed light, same custom-layer approach.
// Both drape over 3D terrain via their own mesh (see either layer's module
// header) — unlike the raster-tile branch of this feature (main), rotation/
// light-direction/diffuse/specular are live shader uniforms here, not baked
// into a re-fetched tile, so no debouncing is needed: dragging any of these
// controls is exactly as responsive as MapLibre's own hillshade illumination
// controls, wired directly to setState like every other slider in this app.
export const HillshadeOptionsSection: React.FC<{
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

  const cycleMatcap = useCallback((direction: number) => {
    const currentIndex = MATCAP_IDS.indexOf(state.matcapTextureId)
    const newIndex = (currentIndex + direction + MATCAP_IDS.length) % MATCAP_IDS.length
    setState({ matcapTextureId: MATCAP_IDS[newIndex] })
  }, [state.matcapTextureId, setState])

  if (!state.showHillshade) return null

  return (
    <Section title="Lighting Effects" isOpen={isOpen} onOpenChange={onOpenChange}>
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
                value={state.matcapRotationDeg}
                onChange={(v) => setState({ matcapRotationDeg: v })}
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
              <Collapsible open={isLightDirOpen} onOpenChange={setIsLightDirOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                  Light Direction<ChevronDown className={`h-4 w-4 transition-transform ${isLightDirOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="flex justify-center pt-1 overflow-visible">
                  <SphericalXYPad
                    width={200}
                    height={200}
                    azimuthRange={[0, 360]}
                    elevationRange={[0, 90]}
                    sliderId="phong-light-xypad"
                    value={{ azimuthDeg: state.illuminationDir, elevationDeg: state.illuminationAlt }}
                    onChange={({ azimuthDeg, elevationDeg }) => {
                      setState({ illuminationDir: azimuthDeg, illuminationAlt: elevationDeg })
                    }}
                  />
                </CollapsibleContent>
              </Collapsible>
              <SliderControl
                label="Albedo (Raster Basemap Opacity)"
                value={state.rasterBasemapOpacity}
                onChange={(v) => setState({ rasterBasemapOpacity: v })}
                min={0} max={1} step={0.05} decimals={2}
                sliderId="phong-albedo"
              />
              <SliderControl
                label="Diffuse Strength"
                value={state.phongDiffuseStrength}
                onChange={(v) => setState({ phongDiffuseStrength: v })}
                min={0} max={1} step={0.05} decimals={2}
                sliderId="phong-diffuse"
              />
              <SliderControl
                label="Specular Strength"
                value={state.phongSpecularStrength}
                onChange={(v) => setState({ phongSpecularStrength: v })}
                min={0} max={1} step={0.05} decimals={2}
                sliderId="phong-specular"
              />
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
