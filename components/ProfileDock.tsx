// The elevation profile docked under the map: a strip across the bottom of
// the map area (above the historical timeline when it is open, clear of the
// left map controls and of the sidebar), showing the same chart the
// Elevation Picker section draws, fed through profileChartAtom. Hovering it
// moves the picker's marker on the map like the sidebar chart does.
import type React from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { PanelBottomClose } from "lucide-react"
import { ElevationProfileChart } from "@/components/TerrainControlPanel/elevation-profile-chart"
import { profileChartAtom, profileDockedAtom, profileHoverIndexAtom } from "@/lib/settings-atoms"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const ProfileDock: React.FC<{ style: React.CSSProperties }> = ({ style }) => {
  const [docked, setDocked] = useAtom(profileDockedAtom)
  const chart = useAtomValue(profileChartAtom)
  const setHover = useSetAtom(profileHoverIndexAtom)
  if (!docked || !chart) return null
  return (
    <div data-snapshot-ignore className="absolute z-10 rounded-md border border-border bg-background/90 backdrop-blur-sm shadow-sm px-2 pt-1 pb-1.5" style={style}>
      <div className="flex items-center justify-between gap-2 pb-0.5">
        <span className="text-[11px] font-medium text-muted-foreground truncate">Elevation profile<span className="hidden sm:inline"> · hover for the point on the map, wheel to zoom, drag to pan</span><span className="sm:hidden"> · drag along it for the point on the map</span></span>
        <Tooltip>
          <TooltipTrigger render={
            <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Back to the side panel" onClick={() => setDocked(false)}>
              <PanelBottomClose className="h-3.5 w-3.5" />
            </button>
          } />
          <TooltipContent><p>Back to the side panel</p></TooltipContent>
        </Tooltip>
      </div>
      <div className="h-[130px] [&>svg]:h-full">
        <ElevationProfileChart points={chart.points} poleHeightM={chart.poleHeightM} onHover={setHover} />
      </div>
    </div>
  )
}
