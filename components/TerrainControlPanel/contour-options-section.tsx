import type React from "react"
import { Section, SliderControl } from "./controls-components"

export const ContourOptionsSection: React.FC<{
  state: any; setState: (updates: any) => void;
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, setState, isOpen, onOpenChange }) => {
  if (!state.showContours) return null
  return (
    <Section title="Contour Options" isOpen={isOpen} onOpenChange={onOpenChange}>
      <SliderControl label="Minor Interval (m)" value={state.contourMinor} onChange={(v) => setState({ contourMinor: v })} min={10} max={100} step={10} suffix="m" />
      <SliderControl label="Major Interval (m)" value={state.contourMajor} onChange={(v) => setState({ contourMajor: v })} min={50} max={500} step={50} suffix="m" />
    </Section>
  )
}
