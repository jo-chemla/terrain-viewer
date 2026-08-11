import type React from "react"
import { useEffect, useRef } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { computeRgbLut, computeColorSpaceMapping, applyColorSpaceMapping, type ColorSpaceId } from "@/lib/histogram-matching"

// Live "match target's colors to reference" for the historical "Compare and
// Blend" feature (comparison-mix-section.tsx) — one instance per non-A view
// (overlay: just B; grid/side-by-side: one per active B..H), always matching
// onto view A as the reference. Rather than rewriting the target's actual
// raster tiles, this samples both views' CURRENTLY RENDERED canvases (i.e.
// whatever tiles are loaded in the viewport right now — see
// histogram-matching.ts), computes a CDF-matching mapping (scikit-image-
// style, ported from Iconem/historical-satellite), and applies it:
//  - "rgb": a per-channel 0-255 LUT, cheap enough as a live CSS SVG
//    feComponentTransfer filter directly on the target's own <canvas> — no
//    pixel data is ever touched, GPU-composited every frame for free.
//  - "hsl"/"hsv"/"lab"/"lch": feComponentTransfer can't express these (it
//    only ever operates on raw R/G/B output), so this path actually
//    converts pixels via a 3D LUT (see histogram-matching.ts's
//    applyColorSpaceMapping) and draws the result onto a pointer-events-none
//    overlay canvas stacked on top of the target's own canvas (which stays
//    live/interactive underneath). Runs at the target's own NATIVE
//    resolution — the LUT makes that affordable (measured ~100-400ms even at
//    high-DPI 3200x2000, comfortably inside the once/second budget; a naive
//    per-pixel conversion at the same resolution was 0.5-0.9s).
// Re-samples on every 'idle' (debounced to at most once/second) so it
// tracks whatever tiles happen to be loaded as you pan/zoom.
const SAMPLE_SIZE = 96

function toTableValues(lut: Float64Array) {
  let out = ""
  for (let i = 0; i < lut.length; i++) {
    out += (i === 0 ? "" : " ") + (lut[i] / 255).toFixed(4)
  }
  return out
}

export const HistogramMatchFilter: React.FC<{
  id: string
  enabled: boolean
  colorSpace: ColorSpaceId
  referenceMapRef: React.RefObject<MapRef | null>
  targetMapRef: React.RefObject<MapRef | null>
  referenceLoaded: boolean
  targetLoaded: boolean
}> = ({ id, enabled, colorSpace, referenceMapRef, targetMapRef, referenceLoaded, targetLoaded }) => {
  const funcRRef = useRef<SVGFEFuncRElement>(null)
  const funcGRef = useRef<SVGFEFuncGElement>(null)
  const funcBRef = useRef<SVGFEFuncBElement>(null)
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const filterId = `histogram-match-to-reference-${id}`

  useEffect(() => {
    const targetMap = targetMapRef.current?.getMap()
    const cleanupTarget = () => {
      if (!targetMap) return
      targetMap.getCanvas().style.filter = ""
      overlayCanvasRef.current?.remove()
      overlayCanvasRef.current = null
    }
    if (!enabled || !referenceLoaded || !targetLoaded) {
      cleanupTarget()
      return
    }
    const referenceMap = referenceMapRef.current?.getMap()
    if (!referenceMap || !targetMap) return

    if (!sampleCanvasRef.current) sampleCanvasRef.current = document.createElement("canvas")
    const sampleCanvas = sampleCanvasRef.current
    sampleCanvas.width = SAMPLE_SIZE
    sampleCanvas.height = SAMPLE_SIZE
    const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true })
    if (!sampleCtx) return

    const sampleCanvasPixels = (source: HTMLCanvasElement) => {
      if (source.width === 0 || source.height === 0) return null
      sampleCtx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      sampleCtx.drawImage(source, 0, 0, source.width, source.height, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      return sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
    }

    const ensureOverlayCanvas = () => {
      if (overlayCanvasRef.current) return overlayCanvasRef.current
      const canvas = document.createElement("canvas")
      canvas.style.position = "absolute"
      canvas.style.inset = "0"
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      canvas.style.pointerEvents = "none"
      // Starts hidden — this is a static snapshot, redrawn at most once/
      // second, sitting on top of the target's own live canvas. Left
      // visible during a pan/zoom it would just sit there not moving while
      // the real map underneath does, reading as "did my input register?".
      // Hidden on movestart, faded back in once the next recompute lands
      // (see hideOverlay/recompute below) — during the gesture you see the
      // live (uncorrected-color) map moving, which is the point: motion
      // feedback over color accuracy while something's actively changing.
      canvas.style.opacity = "0"
      canvas.style.transition = "opacity 150ms ease-out"
      const container = targetMap.getCanvas().parentElement
      container?.appendChild(canvas)
      overlayCanvasRef.current = canvas
      return canvas
    }
    const hideOverlay = () => {
      if (overlayCanvasRef.current) overlayCanvasRef.current.style.opacity = "0"
    }

    let raf = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const recompute = () => {
      const referenceData = sampleCanvasPixels(referenceMap.getCanvas())
      const targetCanvas = targetMap.getCanvas()
      const targetSampleData = sampleCanvasPixels(targetCanvas)
      if (!referenceData || !targetSampleData) return

      if (colorSpace === "rgb") {
        overlayCanvasRef.current?.remove()
        overlayCanvasRef.current = null
        const lut = computeRgbLut(targetSampleData, referenceData)
        if (funcRRef.current) funcRRef.current.setAttribute("tableValues", toTableValues(lut.r))
        if (funcGRef.current) funcGRef.current.setAttribute("tableValues", toTableValues(lut.g))
        if (funcBRef.current) funcBRef.current.setAttribute("tableValues", toTableValues(lut.b))
        targetCanvas.style.filter = `url(#${filterId})`
        return
      }

      // Non-RGB: real per-pixel conversion via a 3D LUT (see
      // histogram-matching.ts), at the target's own native resolution —
      // drawn straight into the overlay canvas (no separate downsampled
      // working copy needed; the LUT is what makes native res affordable).
      targetCanvas.style.filter = ""
      const overlay = ensureOverlayCanvas()
      overlay.width = targetCanvas.width
      overlay.height = targetCanvas.height
      const overlayCtx = overlay.getContext("2d", { willReadFrequently: true })
      if (!overlayCtx) return
      overlayCtx.drawImage(targetCanvas, 0, 0)
      const imageData = overlayCtx.getImageData(0, 0, overlay.width, overlay.height)
      const mapping = computeColorSpaceMapping(targetSampleData, referenceData, colorSpace)
      applyColorSpaceMapping(imageData, mapping)
      overlayCtx.putImageData(imageData, 0, 0)
      overlay.style.opacity = "1"
    }
    // Debounced to at most once/second — a burst of 'idle' events (both maps,
    // every tile load) collapses into a single recompute, and re-running the
    // CDF/LUT computation on every tile settle during a fast pan/zoom would
    // otherwise be needlessly frequent for something that's only ever a
    // coarse 96x96 sample (or capped-resolution redraw) anyway.
    const RECOMPUTE_INTERVAL_MS = 1000
    const scheduleRecompute = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { raf = requestAnimationFrame(recompute) }, RECOMPUTE_INTERVAL_MS)
    }

    scheduleRecompute()
    referenceMap.on("idle", scheduleRecompute)
    targetMap.on("idle", scheduleRecompute)
    // Either map moving invalidates the overlay: the reference moving means
    // the sample it was matched against no longer reflects what's on screen;
    // the target moving means the overlay itself (a static image) is now
    // misaligned with the live canvas underneath it. 'movestart' covers
    // pan/zoom/rotate/pitch uniformly (whatever kicks off any camera change).
    referenceMap.on("movestart", hideOverlay)
    targetMap.on("movestart", hideOverlay)

    return () => {
      referenceMap.off("idle", scheduleRecompute)
      targetMap.off("idle", scheduleRecompute)
      referenceMap.off("movestart", hideOverlay)
      targetMap.off("movestart", hideOverlay)
      if (timer) clearTimeout(timer)
      cancelAnimationFrame(raf)
      cleanupTarget()
    }
  }, [id, enabled, colorSpace, referenceLoaded, targetLoaded, referenceMapRef, targetMapRef, filterId])

  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR ref={funcRRef} type="table" tableValues="0 1" />
            <feFuncG ref={funcGRef} type="table" tableValues="0 1" />
            <feFuncB ref={funcBRef} type="table" tableValues="0 1" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  )
}
