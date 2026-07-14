import type React from "react"
import { SliderControl } from "./controls-components"

// Fields-only (no Section wrapper/gate) — embedded inside SlopeAndMoreOptionsSection
// as its last sub-mode, which owns the "Tells" checkbox (itself gated behind
// tellsBetaEnabledAtom) that conditionally renders this block underneath it.
export const TellsFields: React.FC<{
  state: any
  setState: (updates: any) => void
}> = ({ state, setState }) => {
  return (
    <div className="space-y-4 pl-6">
      <p className="text-xs text-muted-foreground">
        Experimental archaeological mound detector: local maxima of a Difference-
        of-Gaussians relief signal, filtered by blobness/curvature to reject
        ridges and saddles.
      </p>

      <SliderControl
        label={`Tell Size: ${state.tellSize}m`}
        value={state.tellSize}
        onChange={(v) => setState({ tellSize: v })}
        min={20} max={300} step={10}
        hideValue
      />
      <SliderControl
        label={`Min Relief: ${state.tellMinRelief.toFixed(2)}m`}
        value={state.tellMinRelief}
        onChange={(v) => setState({ tellMinRelief: v })}
        min={0} max={3} step={0.05}
        hideValue
      />
      <SliderControl
        label={`Blobness Veto Min: ${state.tellBlobnessMin.toFixed(1)}`}
        value={state.tellBlobnessMin}
        onChange={(v) => setState({ tellBlobnessMin: v })}
        min={0} max={30} step={0.5}
        hideValue
      />
      <SliderControl
        label={`Plan Curvature Veto Min: ${state.tellPlanMin.toFixed(1)}`}
        value={state.tellPlanMin}
        onChange={(v) => setState({ tellPlanMin: v })}
        min={0} max={20} step={0.5}
        hideValue
      />
      <SliderControl
        label={`Det-Hessian Veto Min: ${state.tellDetHessianMin.toFixed(1)}`}
        value={state.tellDetHessianMin}
        onChange={(v) => setState({ tellDetHessianMin: v })}
        min={0} max={20} step={0.5}
        hideValue
      />
    </div>
  )
}
