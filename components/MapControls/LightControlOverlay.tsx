import type React from "react"
import { useEffect, useRef, useState, useCallback } from "react"
import { useAtom } from "jotai"
import type { MapRef } from "react-map-gl/maplibre"
import { isSidebarOpenAtom } from "@/components/TerrainControlPanel/TerrainControlPanel"
import { useIsMobile } from "@/hooks/use-mobile"

// Visual diameter of the light dome overlay, centered in the available
// viewport space — the drag itself isn't bounded to this circle (see
// applyFromPointer below), it's just where the indicator is drawn.
const PAD_SIZE = 300
const RADIUS = PAD_SIZE / 2

// Mirrors the sidebar Card's own sizing in TerrainControlPanel.tsx
// ("right-0 w-80" mobile, "sm:right-4 sm:w-96" desktop) — used to compute how
// much width it occupies so the dome can center itself in the space actually
// left over, rather than querying the DOM for the rendered Card's bounds.
const SIDEBAR_WIDTH_MOBILE = 320 // w-80
const SIDEBAR_WIDTH_DESKTOP = 384 // sm:w-96
const SIDEBAR_GAP_DESKTOP = 16 // sm:right-4

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || (target as HTMLElement).isContentEditable) return true
  // Also don't hijack clicks landing on the sidebar itself while L happens to
  // be held down (e.g. left over from an earlier gesture).
  return !!target.closest('[data-slot="card"]')
}

// Same conversion as SphericalXYPad (components/TerrainControlPanel/XYPad.tsx)
// — x,y normalized so r=0 (center) is straight-overhead light (90° altitude)
// and r=1 (dome edge) is grazing light (0° altitude). Duplicated rather than
// imported: XYPad's pointer handling is entangled with its own small bounded
// box, whereas a drag here can start and continue anywhere in the viewport.
function xyToLight(x: number, y: number) {
  const r = Math.sqrt(x * x + y * y)
  const mathAngle = Math.atan2(-y, x)
  let azimuthDeg = 90 - (mathAngle * 180) / Math.PI
  while (azimuthDeg < 0) azimuthDeg += 360
  while (azimuthDeg >= 360) azimuthDeg -= 360
  const elevationDeg = (Math.acos(Math.min(r, 1)) * 180) / Math.PI
  return { azimuthDeg, elevationDeg: Math.max(0, Math.min(90, elevationDeg)) }
}

function lightToXY(azimuthDeg: number, elevationDeg: number) {
  const az = ((90 - azimuthDeg) * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  const r = Math.cos(el)
  return { x: r * Math.cos(az), y: -r * Math.sin(az) }
}

// RTI-viewer ("open-lime") style light control: hold L, then mousedown+drag
// anywhere in the viewport sets the Hillshade illumination direction/altitude
// instead of panning the map, with a translucent light-dome indicator
// centered in whatever viewport space is left of the sidebar (matching the
// Hillshade sidebar's own XY pad, just overlaid full-screen). Releasing
// either L or the mouse ends the gesture and hands drag/rotate back to the
// map. Experimental — only wired to the primary map (mapRef), not
// split-screen's second view.
export const LightControlOverlay: React.FC<{
  state: any
  setState: (updates: any) => void
  mapRef: React.RefObject<MapRef>
}> = ({ state, setState, mapRef }) => {
  const [active, setActive] = useState(false)
  const [isSidebarOpen] = useAtom(isSidebarOpenAtom)
  const isMobile = useIsMobile()
  // Always-mounted (not conditional on `active`) so its bounds are available
  // the instant a gesture starts — sized to the space left of the sidebar, so
  // its rect IS "center of available space" with no extra math needed.
  const containerRef = useRef<HTMLDivElement>(null)

  const applyFromPointer = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let x = (clientX - cx) / RADIUS
    let y = (clientY - cy) / RADIUS
    const mag = Math.sqrt(x * x + y * y)
    if (mag > 1) { x /= mag; y /= mag }
    const { azimuthDeg, elevationDeg } = xyToLight(x, y)
    setState({ illuminationDir: azimuthDeg, illuminationAlt: elevationDeg })
  }, [setState])

  useEffect(() => {
    // Plain closure vars, not state — these track a fast, transient physical
    // gesture (key+mouse both held), not something the UI needs to react to
    // on its own; `active` is the only piece that needs to trigger a render.
    let lHeld = false
    let dragging = false

    const endGesture = () => {
      if (!dragging) return
      dragging = false
      setActive(false)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.key.toLowerCase() !== "l" || isEditableTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      lHeld = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "l") return
      lHeld = false
      endGesture()
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!lHeld || isEditableTarget(e.target)) return
      e.preventDefault()
      dragging = true
      setActive(true)
      applyFromPointer(e.clientX, e.clientY)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      applyFromPointer(e.clientX, e.clientY)
    }
    const onPointerUp = () => endGesture()
    // Alt-tabbing away, or focus leaving the window entirely, mid-gesture
    // shouldn't leave the map stuck non-draggable.
    const onBlur = () => { lHeld = false; endGesture() }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("blur", onBlur)
    }
  }, [applyFromPointer])

  // Hand map dragPan/dragRotate back the moment the gesture ends, unmounts,
  // or mapRef changes — never leave the map stuck non-draggable.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    if (active) {
      map.dragPan.disable()
      map.dragRotate.disable()
    } else {
      map.dragPan.enable()
      map.dragRotate.enable()
    }
    return () => {
      map.dragPan.enable()
      map.dragRotate.enable()
    }
  }, [active, mapRef])

  const sidebarWidth = isSidebarOpen
    ? (isMobile ? SIDEBAR_WIDTH_MOBILE : SIDEBAR_WIDTH_DESKTOP + SIDEBAR_GAP_DESKTOP)
    : 0

  const pos = lightToXY(state.illuminationDir ?? 315, state.illuminationAlt ?? 45)
  const dotX = RADIUS + pos.x * RADIUS
  const dotY = RADIUS + pos.y * RADIUS

  return (
    <div
      ref={containerRef}
      className="absolute inset-y-0 left-0 z-30 flex items-center justify-center pointer-events-none transition-[width] duration-200"
      style={{ width: `calc(100% - ${sidebarWidth}px)` }}
    >
      {active && (
        <div
          className="relative rounded-full border border-white/40 bg-black/10"
          style={{ width: PAD_SIZE, height: PAD_SIZE }}
        >
          <div className="absolute text-xs text-white/70 font-medium" style={{ left: "50%", top: 6, transform: "translateX(-50%)" }}>N</div>
          <div className="absolute rounded-full bg-white/70" style={{ width: 6, height: 6, left: RADIUS - 3, top: RADIUS - 3 }} />
          {/* Same stroke/fill as SphericalXYPad's own line+pill (components/TerrainControlPanel/XYPad.tsx) — var(--primary)/bg-background so this stays black-on-white in light theme (and flips correctly in dark) instead of a hardcoded white/black pair. */}
          <svg className="absolute inset-0" style={{ width: PAD_SIZE, height: PAD_SIZE }}>
            <line x1={RADIUS} y1={RADIUS} x2={dotX} y2={dotY} stroke="var(--primary)" strokeLinecap="round" strokeWidth="2" />
          </svg>
          <div
            className="absolute rounded-full bg-background border-2 border-primary shadow"
            style={{ width: 16, height: 16, left: dotX - 8, top: dotY - 8 }}
          />
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs text-white/90 bg-black/40 px-2 py-1 rounded whitespace-nowrap">
            Light Control — release L or the mouse to exit
          </div>
        </div>
      )}
    </div>
  )
}
