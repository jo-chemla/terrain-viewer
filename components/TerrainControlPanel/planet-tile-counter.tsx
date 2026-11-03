import type React from "react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { allowMorePlanetTiles, PLANET_TILES_HIGH, PLANET_TILES_WARN, usePlanetTileUsage } from "@/lib/planet-tiles"

/** Planet tiles draw on a quota that has to last the whole grant: what this
 *  session has fetched stays in view, yellow then red, and stops at a limit. */
export const PlanetTileCounter: React.FC = () => {
  const { fetched, cached, limit } = usePlanetTileUsage()
  if (!fetched && !cached) return null
  const stopped = fetched >= limit
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={stopped ? allowMorePlanetTiles : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
              stopped && "cursor-pointer",
              fetched >= PLANET_TILES_HIGH ? "border-red-500 bg-red-500/15 text-red-700 dark:text-red-300"
                : fetched >= PLANET_TILES_WARN ? "border-yellow-500 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
                : "border-border text-muted-foreground",
            )}
          >
            {stopped ? `Planet stopped at ${fetched} tiles: allow more` : `Planet ${fetched} tiles`}
          </button>
        }
      />
      <TooltipContent>
        <div>{fetched} tiles fetched from Planet this session, {cached} from this browser's cache at no cost.</div>
        <div className="text-[10px] text-gray-400 mt-0.5">
          {stopped ? "No more tiles are fetched until you allow it." : `Fetching stops at ${limit}. Each new month is a full screen of tiles.`}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
