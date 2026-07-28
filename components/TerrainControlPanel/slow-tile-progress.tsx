import type React from "react"
import { useAtomValue } from "jotai"
import { Loader2 } from "lucide-react"
import { slowTileStatsAtom, statsKey, type SlowVizMode } from "@/lib/tile-timing-stats"
import type { HorizonPrecision } from "@/lib/horizon-angle"

const EMPTY_STATS = { avgMs: null, requestedCount: 0, completedCount: 0, maxConcurrency: 1 }

/** "Computing… ~Ns remaining (a/b tiles)" for the slow, ray-marched relief
 *  modes (SVF/Openness/Local Dominance) — see lib/tile-timing-stats.ts. Shows
 *  immediately once tiles are pending (even before a first real sample
 *  exists to time-estimate from — that's the point where a "nothing's
 *  happening" impression is most likely), and renders nothing once the
 *  viewport's tiles have all resolved.
 *
 *  `precision` (SVF/Openness only — Local Dominance has none) selects which
 *  precision-qualified stats bucket to read, so switching Fast/Precise shows
 *  that mode's OWN rolling average immediately instead of whichever one
 *  happened to run most recently (see statsKey's comment). */
export const SlowTileProgress: React.FC<{ mode: SlowVizMode; precision?: HorizonPrecision }> = ({ mode, precision }) => {
  const stats = useAtomValue(slowTileStatsAtom)[statsKey(mode, precision)] ?? EMPTY_STATS
  const pending = stats.requestedCount - stats.completedCount
  if (pending <= 0) return null

  let label = "Computing…"
  if (stats.avgMs !== null) {
    // Tiles are genuinely in flight together (maplibre issues several
    // requests concurrently, each awaiting network I/O) — dividing by the
    // observed concurrency instead of treating them as strictly sequential
    // is what keeps this from running too conservative.
    const secondsRemaining = (pending / stats.maxConcurrency * stats.avgMs) / 1000
    const time = secondsRemaining >= 10 ? `~${Math.round(secondsRemaining)}s` : `~${secondsRemaining.toFixed(1)}s`
    label = `Computing… ${time} remaining`
  }

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      {label} ({stats.completedCount}/{stats.requestedCount} tiles)
    </p>
  )
}
