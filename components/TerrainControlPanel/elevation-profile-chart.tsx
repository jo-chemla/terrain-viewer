import type React from "react"
import { useRef, useState } from "react"
import type { ProfilePoint } from "@/lib/elevation-query"

// Straight line-of-sight between the two endpoints, optionally raised by an equal
// mast/pole height at each end. A terrain sample "intrudes" when its ground rises
// above that sight line — i.e. it would block a view (or a taut cable) between the
// two masts. This is a 1-D line check, not a viewshed: it only answers "is the
// direct path between these two points clear?".
export interface LineOfSight {
  clear: boolean
  /** Greatest height (m) by which terrain rises above the sight line; 0 if clear. */
  maxIntrusionM: number
  totalDistanceM: number
}

function losElevationAt(distanceM: number, startElev: number, endElev: number, totalDistanceM: number): number {
  const t = totalDistanceM > 0 ? distanceM / totalDistanceM : 0
  return startElev + (endElev - startElev) * t
}

export function computeLineOfSight(points: ProfilePoint[], poleHeightM: number): LineOfSight | null {
  const valid = points.filter((p) => p.elevation !== null)
  if (valid.length < 2) return null
  const first = valid[0]
  const last = valid[valid.length - 1]
  const totalDistanceM = last.distanceM
  const startElev = (first.elevation as number) + poleHeightM
  const endElev = (last.elevation as number) + poleHeightM

  let maxIntrusionM = 0
  // Endpoints are the observers themselves — only the terrain strictly between
  // them can block the path.
  for (const p of valid) {
    if (p === first || p === last || p.elevation === null) continue
    const los = losElevationAt(p.distanceM, startElev, endElev, totalDistanceM)
    maxIntrusionM = Math.max(maxIntrusionM, p.elevation - los)
  }
  return { clear: maxIntrusionM <= 0, maxIntrusionM, totalDistanceM }
}

const W = 320
const H = 150
const PAD = { l: 4, r: 4, t: 10, b: 4 }

// Self-contained inline-SVG elevation profile: filled terrain area + top line,
// the dashed straight line-of-sight between endpoints, and any terrain that
// intrudes above that sight line redrawn in red. Scales to its container width.
export const ElevationProfileChart: React.FC<{
  points: ProfilePoint[]
  poleHeightM: number
  /** The sample under the pointer (an index into `points`), null when the
   *  pointer leaves: the picker drops a marker on the map at that sample. */
  onHover?: (index: number | null) => void
}> = ({ points, poleHeightM, onHover }) => {
  const svgRef = useRef<SVGSVGElement | null>(null)
  // Zoomed window along the line, as a fraction of the total distance:
  // wheel zooms around the cursor, drag pans, double-click resets.
  const [win, setWin] = useState<[number, number]>([0, 1])
  const dragRef = useRef<{ x: number; win: [number, number] } | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const valid = points.filter((p) => p.elevation !== null)
  if (valid.length < 2) {
    return <p className="text-xs text-muted-foreground">Not enough terrain data along this line to draw a profile.</p>
  }

  const fullDistanceM = valid[valid.length - 1].distanceM
  const totalDistanceM = fullDistanceM
  const startElev = (valid[0].elevation as number) + poleHeightM
  const endElev = (valid[valid.length - 1].elevation as number) + poleHeightM

  const elevs = valid.map((p) => p.elevation as number)
  const losElevs = valid.map((p) => losElevationAt(p.distanceM, startElev, endElev, totalDistanceM))
  let minE = Math.min(...elevs, ...losElevs)
  let maxE = Math.max(...elevs, ...losElevs)
  if (maxE === minE) { maxE += 1; minE -= 1 }
  // A little headroom so the top line / LOS aren't flush against the frame.
  const margin = (maxE - minE) * 0.08
  minE -= margin
  maxE += margin

  // Horizontal scale over the zoomed window.
  const d0 = win[0] * fullDistanceM, d1 = win[1] * fullDistanceM
  const x = (d: number) => PAD.l + (d1 > d0 ? (d - d0) / (d1 - d0) : 0) * (W - PAD.l - PAD.r)
  // Pointer x (client) -> distance along the line, through the viewBox scale.
  const distanceAt = (clientX: number): number => {
    const svg = svgRef.current
    if (!svg) return 0
    const r = svg.getBoundingClientRect()
    const vx = ((clientX - r.left) / r.width) * W
    return d0 + Math.min(1, Math.max(0, (vx - PAD.l) / (W - PAD.l - PAD.r))) * (d1 - d0)
  }
  const nearestIndex = (d: number): number => {
    let best = 0, bestDiff = Infinity
    for (let i = 0; i < points.length; i++) {
      if (points[i].elevation === null) continue
      const diff = Math.abs(points[i].distanceM - d)
      if (diff < bestDiff) { bestDiff = diff; best = i }
    }
    return best
  }
  const setHover = (i: number | null) => { setHoverIdx(i); onHover?.(i) }
  // Mouse: hover follows, drag pans. Touch: a finger along the chart scrubs
  // the point on the map (no hover on a phone), double-tap resets the zoom.
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") { setHover(nearestIndex(distanceAt(e.clientX))); return }
    if (dragRef.current) {
      const svg = svgRef.current!
      const r = svg.getBoundingClientRect()
      const dxFrac = ((e.clientX - dragRef.current.x) / r.width) * (dragRef.current.win[1] - dragRef.current.win[0])
      let a = dragRef.current.win[0] - dxFrac, b = dragRef.current.win[1] - dxFrac
      if (a < 0) { b -= a; a = 0 }
      if (b > 1) { a -= b - 1; b = 1 }
      setWin([a, b])
      return
    }
    setHover(nearestIndex(distanceAt(e.clientX)))
  }
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const d = distanceAt(e.clientX) / (fullDistanceM || 1)
    const factor = e.deltaY > 0 ? 1.25 : 0.8
    let a = d - (d - win[0]) * factor, b = d + (win[1] - d) * factor
    if (b - a > 1) { a = 0; b = 1 }
    if (b - a < 0.02) return
    if (a < 0) { b -= a; a = 0 }
    if (b > 1) { a -= b - 1; b = 1 }
    setWin([a, b])
  }
  const hovered = hoverIdx !== null && points[hoverIdx] && points[hoverIdx].elevation !== null ? points[hoverIdx] : null
  const y = (e: number) => PAD.t + (1 - (e - minE) / (maxE - minE)) * (H - PAD.t - PAD.b)

  const terrainPts = valid.map((p) => `${x(p.distanceM).toFixed(1)},${y(p.elevation as number).toFixed(1)}`)
  const terrainLine = terrainPts.join(" ")
  const areaPath = `M ${x(valid[0].distanceM).toFixed(1)},${(H - PAD.b).toFixed(1)} L ${terrainPts.join(" L ")} L ${x(totalDistanceM).toFixed(1)},${(H - PAD.b).toFixed(1)} Z`

  // Intruding terrain segments (both endpoints above the sight line) drawn red.
  const intrusionSegments: string[] = []
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1]
    const b = valid[i]
    const aOver = (a.elevation as number) > losElevationAt(a.distanceM, startElev, endElev, totalDistanceM)
    const bOver = (b.elevation as number) > losElevationAt(b.distanceM, startElev, endElev, totalDistanceM)
    if (aOver || bOver) {
      intrusionSegments.push(`M ${x(a.distanceM).toFixed(1)},${y(a.elevation as number).toFixed(1)} L ${x(b.distanceM).toFixed(1)},${y(b.elevation as number).toFixed(1)}`)
    }
  }

  const fmt = (m: number) => (Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-foreground cursor-crosshair select-none" preserveAspectRatio="none" role="img" aria-label="Terrain elevation profile"
      style={{ touchAction: "none" }}
      onPointerMove={onMove} onPointerLeave={(e) => { dragRef.current = null; if (e.pointerType !== "touch") setHover(null) }} onWheel={onWheel}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); setHover(nearestIndex(distanceAt(e.clientX))); return }
        dragRef.current = { x: e.clientX, win }
      }}
      onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}
      onDoubleClick={() => setWin([0, 1])}>
      <defs><clipPath id="profile-clip"><rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} /></clipPath></defs>
      {/* frame */}
      <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} />
      <g clipPath="url(#profile-clip)">
      {/* terrain */}
      <path d={areaPath} fill="currentColor" fillOpacity={0.12} />
      <polyline points={terrainLine} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      {/* line of sight */}
      <line x1={x(0)} y1={y(startElev)} x2={x(totalDistanceM)} y2={y(endElev)} stroke="#f59e0b" strokeWidth={1.25} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      {/* intrusions */}
      {intrusionSegments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#ef4444" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
      {/* endpoint dots (match the map marker colors) */}
      <circle cx={x(0)} cy={y(valid[0].elevation as number)} r={3} fill="#3b82f6" />
      <circle cx={x(totalDistanceM)} cy={y(valid[valid.length - 1].elevation as number)} r={3} fill="#ef4444" />
      {/* hover: a vertical rule and the sample, mirrored on the map */}
      {hovered && (
        <>
          <line x1={x(hovered.distanceM)} y1={PAD.t} x2={x(hovered.distanceM)} y2={H - PAD.b} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={x(hovered.distanceM)} cy={y(hovered.elevation as number)} r={3.5} fill="#ffffff" stroke="#111827" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        </>
      )}
      </g>
      {hovered && (
        <text x={Math.min(W - PAD.r - 2, Math.max(PAD.l + 2, x(hovered.distanceM)))} y={PAD.t + 18} fontSize={9} fill="currentColor" textAnchor={x(hovered.distanceM) > W / 2 ? "end" : "start"}>{Math.round(hovered.elevation as number)} m · {fmt(hovered.distanceM)}</text>
      )}
      {/* labels */}
      <text x={PAD.l + 2} y={PAD.t + 8} fontSize={9} fill="currentColor" fillOpacity={0.6}>{Math.round(maxE)} m</text>
      <text x={PAD.l + 2} y={H - PAD.b - 2} fontSize={9} fill="currentColor" fillOpacity={0.6}>{Math.round(minE)} m</text>
      <text x={W - PAD.r - 2} y={H - PAD.b - 2} fontSize={9} fill="currentColor" fillOpacity={0.6} textAnchor="end">{win[0] > 0 || win[1] < 1 ? `${fmt(d0)} – ${fmt(d1)}` : fmt(totalDistanceM)}</text>
    </svg>
  )
}
