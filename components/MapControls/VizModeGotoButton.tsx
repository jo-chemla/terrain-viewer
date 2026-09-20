import { useEffect, useRef, useState } from "react"
import { useSetAtom } from "jotai"
import { ArrowRightToLine } from "lucide-react"
import { revealSectionAtom } from "@/lib/settings-atoms"

/**
 * A small "go to this mode's options" affordance that follows the cursor over
 * the map. Clicking it opens the side-panel section for whichever
 * visualization mode is currently on top and scrolls to it.
 *
 * Why at the cursor rather than in a corner: the question it answers is "what
 * is making THIS look like this, and where do I change it", which you ask
 * while looking at a particular patch of map. A corner button makes you leave
 * the thing you were looking at to find it.
 *
 * It is an action, never a state - nothing about it is remembered, and it
 * changes no map state. Hidden while a gesture is in progress, and sits well
 * to the LEFT of the pointer so it never covers what is being inspected, nor
 * sits under the pointer when you meant to drag.
 */

/** The visible mode with the highest draw order wins — the one you are
 *  actually looking at is the one painted last. Mirrors LAYER_SLOTS' order
 *  (see /dev/layer-order), bottom to top. */
const MODE_SECTIONS: { on: (s: any) => boolean; section: string; label: string }[] = [
  { on: (s) => s.showColorRelief, section: "hypsometricTint", label: "Hypsometric tint" },
  { on: (s) => s.showTerrainAnalysis, section: "terrainAnalysis", label: "Terrain analysis" },
  { on: (s) => s.showReliefVisualization, section: "reliefVisualization", label: "Relief visualization" },
  { on: (s) => s.showHillshade, section: "hillshade", label: "Hillshade" },
  { on: (s) => s.showLightingEffects || s.showShadows, section: "lightingEffects", label: "Lighting effects" },
  { on: (s) => s.showContoursAndGraticules || s.showContours, section: "contour", label: "Contours" },
]

export function VizModeGotoButton({ state }: { state: any }) {
  const reveal = useSetAtom(revealSectionAtom)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const frame = useRef(0)

  // Topmost active mode. Nothing on -> nothing to point at.
  const target = [...MODE_SECTIONS].reverse().find((m) => m.on(state))

  useEffect(() => {
    if (!target) { setPos(null); return }
    const onMove = (e: PointerEvent) => {
      const el = e.target
      // Only over an actual map canvas: not the sidebar, the timeline, or any
      // popup floating above the map.
      const overMap = el instanceof Element && el.closest(".maplibregl-canvas-container") && !el.closest("[data-viz-goto]")
      if (!overMap || e.buttons !== 0) { setPos(null); return }
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        setPos({ x: e.clientX, y: e.clientY })
      })
    }
    const onLeave = () => setPos(null)
    window.addEventListener("pointermove", onMove, { passive: true })
    window.addEventListener("pointerdown", onLeave, { passive: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerdown", onLeave)
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [target])

  if (!target || !pos) return null

  return (
    <div
      data-viz-goto
      className="pointer-events-none fixed z-40"
      // Left of the pointer and slightly above its line, so it never covers
      // the pixel being inspected.
      style={{ left: pos.x - 46, top: pos.y - 14 }}
    >
      <button
        type="button"
        title={`Go to ${target.label} options`}
        aria-label={`Go to ${target.label} options`}
        onClick={() => reveal(target.section)}
        className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground cursor-pointer"
      >
        <ArrowRightToLine className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
