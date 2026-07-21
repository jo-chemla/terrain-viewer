import type React from "react"
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
}> = ({ points, poleHeightM }) => {
  const valid = points.filter((p) => p.elevation !== null)
  if (valid.length < 2) {
    return <p className="text-xs text-muted-foreground">Not enough terrain data along this line to draw a profile.</p>
  }

  const totalDistanceM = valid[valid.length - 1].distanceM
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

  const x = (d: number) => PAD.l + (totalDistanceM > 0 ? d / totalDistanceM : 0) * (W - PAD.l - PAD.r)
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-foreground" preserveAspectRatio="none" role="img" aria-label="Terrain elevation profile">
      {/* frame */}
      <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} />
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
      {/* labels */}
      <text x={PAD.l + 2} y={PAD.t + 8} fontSize={9} fill="currentColor" fillOpacity={0.6}>{Math.round(maxE)} m</text>
      <text x={PAD.l + 2} y={H - PAD.b - 2} fontSize={9} fill="currentColor" fillOpacity={0.6}>{Math.round(minE)} m</text>
      <text x={W - PAD.r - 2} y={H - PAD.b - 2} fontSize={9} fill="currentColor" fillOpacity={0.6} textAnchor="end">{fmt(totalDistanceM)}</text>
    </svg>
  )
}
