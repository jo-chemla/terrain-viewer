import type React from "react"
import { useAtomValue } from "jotai"
import { Loader2 } from "lucide-react"
import { slowTileStatsAtom, type SlowVizMode } from "@/lib/tile-timing-stats"

/** "Computing… ~Ns remaining (a/b tiles)" for the slow, ray-marched relief
 *  modes (SVF/Openness/Local Dominance) — see lib/tile-timing-stats.ts. Renders
 *  nothing once the viewport's tiles have all resolved, or before there's a
 *  single real (non-cached) sample to estimate from. */
export const SlowTileProgress: React.FC<{ mode: SlowVizMode }> = ({ mode }) => {
  const stats = useAtomValue(slowTileStatsAtom)[mode]
  const pending = stats.requestedCount - stats.completedCount
  if (pending <= 0 || stats.avgMs === null) return null

  const secondsRemaining = (pending * stats.avgMs) / 1000
  const label = secondsRemaining >= 10 ? `~${Math.round(secondsRemaining)}s` : `~${secondsRemaining.toFixed(1)}s`

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      Computing… {label} remaining ({stats.completedCount}/{stats.requestedCount} tiles)
    </p>
  )
}
