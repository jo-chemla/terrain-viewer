/**
 * CameraButtons.tsx
 *
 * Three shadcn <Button> components for the TerrainControlPanel.
 *
 * Usage:
 *   <CameraButtons mapRef={mapRef} />
 */

import { useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "../ui/label"

interface CameraButtonsProps {
    mapRef: React.RefObject<MapRef>
}

function getMap(mapRef: React.RefObject<MapRef>) {
    return mapRef.current?.getMap() ?? null
}

// smooth step: 3t²-2t³
function smoothstep(t: number) {
    return t * t * (3 - 2 * t)
}

const CRUISE_DEG_PER_MS = 360 / 30000 // full rotation in 30s
const EASE_MS = 1500                  // ease-in and ease-out ramp duration
const FOV_ANIM_MS = 800               // FOV transition duration

export function CameraButtons({ mapRef }: CameraButtonsProps) {
    const rafRef = useRef<number | null>(null)
    const stoppingRef = useRef<number | null>(null) // timestamp when ease-out started
    const lastRef = useRef<number | null>(null)
    const elapsedRef = useRef(0)
    const [spinning, setSpinning] = useState(false)

    const fovRafRef = useRef<number | null>(null)

    // ── FOV helper with ease-in/out animation ─────────────────────────────────
    const setVFov = useCallback((targetDeg: number) => {
        const map = getMap(mapRef)
        if (!map) return

        // Cancel any existing FOV animation
        if (fovRafRef.current !== null) {
            cancelAnimationFrame(fovRafRef.current)
            fovRafRef.current = null
        }

        const startFov = map.getVerticalFieldOfView()
        const startTime = performance.now()

        const tick = (now: number) => {
            const elapsed = now - startTime
            const t = Math.min(elapsed / FOV_ANIM_MS, 1)
            const eased = smoothstep(t)

            const currentFov = startFov + (targetDeg - startFov) * eased
            map.setVerticalFieldOfView(currentFov)
            map.triggerRepaint()

            if (t < 1) {
                fovRafRef.current = requestAnimationFrame(tick)
            } else {
                fovRafRef.current = null
                // Force tile recalculation at end
                requestAnimationFrame(() => {
                    map.resize()
                })
            }
        }

        fovRafRef.current = requestAnimationFrame(tick)
    }, [mapRef])

    // ── Stop: begins ease-out; rAF loop self-cancels when deceleration done ──
    const triggerStop = useCallback(() => {
        if (rafRef.current !== null && stoppingRef.current === null) {
            stoppingRef.current = performance.now()
        }
    }, [])

    // ── Start turnaround ──────────────────────────────────────────────────────
    const startSpin = useCallback(() => {
        const map = getMap(mapRef)
        if (!map) return

        lastRef.current = null
        elapsedRef.current = 0
        stoppingRef.current = null
        setSpinning(true)

        const tick = (now: number) => {
            const delta = lastRef.current !== null ? now - lastRef.current : 0
            lastRef.current = now
            elapsedRef.current += delta

            // Ease-in speed: ramps 0→1 over first EASE_MS
            const tIn = Math.min(elapsedRef.current / EASE_MS, 1)
            const speedIn = smoothstep(tIn)

            let speedMul: number

            if (stoppingRef.current !== null) {
                // Ease-out: ramps 1→0 over EASE_MS from when stop was triggered,
                // multiplied by speedIn so we can't overshoot if stop is hit early.
                const tOut = Math.min((now - stoppingRef.current) / EASE_MS, 1)
                speedMul = (1 - smoothstep(tOut)) * speedIn

                if (tOut >= 1) {
                    stoppingRef.current = null
                    rafRef.current = null
                    setSpinning(false)
                    return
                }
            } else {
                speedMul = speedIn
            }

            map.setBearing((map.getBearing() + CRUISE_DEG_PER_MS * delta * speedMul) % 360)
            rafRef.current = requestAnimationFrame(tick)
        }

        rafRef.current = requestAnimationFrame(tick)
    }, [mapRef])

    // ── Toggle ────────────────────────────────────────────────────────────────
    const toggleTurnaround = useCallback(() => {
        if (spinning) {
            triggerStop()
        } else {
            startSpin()
        }
    }, [spinning, triggerStop, startSpin])

    // ── Render ────────────────────────────────────────────────────────────────
    return (<>
        <Label className="text-sm font-medium">WIP Tests: Animation & ~Ortho</Label>
        <div className="flex gap-2">
            {/* Wide perspective */}
            <Button
                variant="outline"
                className="flex-[2] bg-transparent cursor-pointer"
                onClick={() => setVFov(40)}
            >
                VFOV 40°
            </Button>

            {/* Turnaround toggle */}
            <Button
                variant={spinning ? "default" : "outline"}
                className="flex-[2] cursor-pointer"
                onClick={toggleTurnaround}
            >
                {spinning ? "Stop" : "360"}
            </Button>

            {/* Orthographic equivalent */}
            <Button
                variant="outline"
                className="flex-[2] bg-transparent cursor-pointer"
                onClick={() => setVFov(10) /* maplibre doesn't support true orthographic, but a very narrow FOV approximates it */}
            >
                VFOV 10°
            </Button>
        </div>
    </>
    )
}