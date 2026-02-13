import type React from "react"
import { useAtom } from "jotai"
import { isContoursOpenAtom } from "@/lib/settings-atoms"
import { Section, SliderControl } from "./controls-components"

export const ContourOptionsSection: React.FC<{ state: any; setState: (updates: any) => void }> = ({ state, setState }) => {
  const [isOpen, setIsOpen] = useAtom(isContoursOpenAtom)
  if (!state.showContours) return null
  return (
    <Section title="Contour Options" isOpen={isOpen} onOpenChange={setIsOpen}>
      <SliderControl label="Minor Interval (m)" value={state.contourMinor} onChange={(v) => setState({ contourMinor: v })} min={10} max={100} step={10} suffix="m" />
      <SliderControl label="Major Interval (m)" value={state.contourMajor} onChange={(v) => setState({ contourMajor: v })} min={50} max={500} step={50} suffix="m" />
    </Section>
  )
}
