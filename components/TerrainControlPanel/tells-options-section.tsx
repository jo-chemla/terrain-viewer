import type React from "react"
import { useCallback, useState } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { Download } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { groundResolutionM } from "@/lib/normal-derived-protocol"
import { radiusToLevels } from "@/lib/lrm-protocol"
import { downloadGeoJSON } from "@/lib/download-geojson"
import { SliderControl, MobileSlider, DraftBoundInput } from "./controls-components"

function formatMeters(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

const TELL_RADIUS_DEFAULT = 4

// Fields-only (no Section wrapper/gate) — embedded inside DetectorMoundsSection,
// which owns the Tells style cycle button that sits above this block.
export const TellsFields: React.FC<{
  state: any
  setState: (updates: any) => void
  // Same purpose as LrmFields' own tileSize prop — the actual tile grid size of
  // the active terrain source, needed to turn a pixel radius into a real-world
  // distance for the "≈ Xm" readout below.
  tileSize?: number
  // Needed only for the "Export Viewport as GeoJSON" button below — reads the
  // already-fetched tellsSource vector tiles straight from the map instance, no
  // separate fetch. Optional so this component still works in contexts with no
  // map (there are none today, but keeps the prop symmetric with other Fields).
  mapRef?: React.RefObject<MapRef>
}> = ({ state, setState, tileSize = 256, mapRef }) => {
  const radiusPx = state.tellRadius ?? TELL_RADIUS_DEFAULT
  const radiusMeters = radiusPx * groundResolutionM(state.lat ?? 0, state.zoom ?? 0, tileSize)

  // Local-only (not persisted to the URL) — just which of the two parallel
  // tellsSource/tellsSourceUnfiltered vector sources (see TellsSource in
  // MapSources.tsx) the Export button reads from.
  const [exportUnfiltered, setExportUnfiltered] = useState(false)

  // querySourceFeatures (not queryRenderedFeatures) so this exports every
  // detected candidate currently in the source's loaded tiles regardless of the
  // marker style — including "hidden", where the tells-markers layer itself has
  // layout.visibility:none and would report zero features to queryRendered.
  const exportViewportGeoJSON = useCallback(() => {
    const map = mapRef?.current?.getMap()
    if (!map) return
    const sourceId = exportUnfiltered ? "tellsSourceUnfiltered" : "tellsSource"
    if (!map.getSource(sourceId)) return
    const features = map.querySourceFeatures(sourceId, { sourceLayer: "tells" })
    downloadGeoJSON(features as GeoJSON.Feature[], exportUnfiltered ? "tells-unfiltered" : "tells")
  }, [mapRef, exportUnfiltered])

  return (
    <div className="space-y-4 pl-6">
      <SliderControl
        label={`Tell Size: ${state.tellSize}m`}
        value={state.tellSize}
        onChange={(v) => setState({ tellSize: v })}
        min={20} max={300} step={10}
        hideValue
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">
            LRM Smoothing Radius (px)
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">≈ {formatMeters(radiusMeters)}</span>
            <DraftBoundInput
              value={radiusPx}
              onCommit={(v) => setState({ tellRadius: Math.pow(2, radiusToLevels(v ?? TELL_RADIUS_DEFAULT)) })}
              className="h-6 py-1 px-1 w-14 text-xs text-right bg-transparent border rounded"
            />
          </div>
        </div>
        <MobileSlider
          sliderId="tells:radius"
          min={1}
          max={6}
          step={1}
          value={[radiusToLevels(radiusPx)]}
          onValueChange={([exp]) => setState({ tellRadius: Math.pow(2, exp) })}
          className="w-full cursor-pointer"
        />
        <p className="text-xs text-muted-foreground">
          Background/regional-trend scale subtracted out by the detector — set this
          to match the LRM layer&apos;s own Smoothing Radius to align purple markers
          with the visible LRM peaks.
        </p>
      </div>

      <SliderControl
        label={`Min Relief: ${state.tellMinRelief.toFixed(2)}m`}
        value={state.tellMinRelief}
        onChange={(v) => setState({ tellMinRelief: v })}
        min={0} max={3} step={0.05}
        hideValue
      />
      {/* Ranges below are empirically calibrated, not guessed: with all three
          thresholds at 0 (so nothing is rejected), a live sample of 200+ real
          candidates showed blobness and det-Hessian both span roughly 0-0.4,
          while plan curvature (a ×100-scaled quantity, unlike the other two)
          spans roughly 0-75. The old 0-20/0-30 ranges were ~100x too coarse —
          any nonzero step past the first one or two ticks exceeded every real
          candidate's value and rejected the entire population. Det-Hessian got
          a further 10x range shrink (0-0.05) after field use showed real values
          cluster near the very bottom of the 0-0.4 span, making the first slider
          ticks of the wider range already reject nearly everything. */}
      <SliderControl
        label={`Blobness Veto Min: ${state.tellBlobnessMin.toFixed(2)}`}
        value={state.tellBlobnessMin}
        onChange={(v) => setState({ tellBlobnessMin: v })}
        min={0} max={0.5} step={0.01}
        hideValue
      />
      <SliderControl
        label={`Plan Curvature Veto Min: ${state.tellPlanMin.toFixed(0)}`}
        value={state.tellPlanMin}
        onChange={(v) => setState({ tellPlanMin: v })}
        min={0} max={100} step={1}
        hideValue
      />
      <SliderControl
        label={`Det-Hessian Veto Min: ${state.tellDetHessianMin.toFixed(3)}`}
        value={state.tellDetHessianMin}
        onChange={(v) => setState({ tellDetHessianMin: v })}
        min={0} max={0.05} step={0.001}
        hideValue
      />

      <div className="flex items-center gap-2">
        <Checkbox
          id="tells-veto-resolution"
          checked={state.tellVetoResolution === "fine"}
          onCheckedChange={(checked) => setState({ tellVetoResolution: checked ? "fine" : "coarse" })}
        />
        <Label htmlFor="tells-veto-resolution" className="text-sm cursor-pointer">
          Compute vetoes at fine (native) resolution instead of coarse
        </Label>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="tells-measure-scale"
            checked={state.tellMeasureScale === true}
            onCheckedChange={(checked) => setState({ tellMeasureScale: checked === true })}
          />
          <Label htmlFor="tells-measure-scale" className="text-sm cursor-pointer">
            Measure mound scale (half-max ray marching)
          </Label>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          Adds an estimated diameter to each detection (click a marker, or see
          the scaleM field in GeoJSON exports) by marching rays outward from the
          peak until relief drops to half — no extra tile fetches.
        </p>
        {state.tellMeasureScale === true && (
          <div className="flex items-center gap-2 pl-6">
            <Checkbox
              id="tells-scale-markers"
              checked={state.tellsScaleMarkers === true}
              onCheckedChange={(checked) => setState({ tellsScaleMarkers: checked === true })}
            />
            <Label htmlFor="tells-scale-markers" className="text-sm cursor-pointer">
              Size markers to
            </Label>
            <DraftBoundInput
              value={state.tellsScaleMultiplier ?? 20}
              onCommit={(v) => setState({ tellsScaleMultiplier: Math.min(40, Math.max(1, Math.round(v ?? 20))) })}
              className="h-6 py-1 px-1 w-12 text-xs text-right bg-transparent border rounded"
            />
            <Label htmlFor="tells-scale-markers" className="text-sm cursor-pointer">
              × the measured scale
            </Label>
          </div>
        )}
        {state.tellMeasureScale === true && state.tellsScaleMarkers === true && (
          <p className="text-xs text-muted-foreground pl-6">
            Drawn at {state.tellsScaleMultiplier ?? 20}× the mound's real diameter — true-to-scale markers
            are usually too small to see or click at normal zoom levels.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="tells-export-unfiltered"
          checked={exportUnfiltered}
          onCheckedChange={(checked) => setExportUnfiltered(checked === true)}
        />
        <Label htmlFor="tells-export-unfiltered" className="text-sm cursor-pointer">
          Export unfiltered (ignore veto thresholds)
        </Label>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full cursor-pointer"
        onClick={exportViewportGeoJSON}
        disabled={!mapRef}
      >
        <Download className="w-4 h-4 mr-2" />
        Export Viewport as GeoJSON
      </Button>
    </div>
  )
}
