// The elevation profile docked as a bottom panel: the lowest strip of the
// bottom stack, between the left edge and the sidebar (where the timeline
// panel sits when it is the only one). It reports its height through
// profileDockHeightAtom so everything else at the bottom moves up by it, the
// same way the historical timeline panel does: the timeline panel itself (or
// its collapsed button), the minimap, the scale bar and attribution, the
// view pills and the camera's bottom padding (TerrainViewer.tsx). Same chart
// as the Elevation Picker section, fed through profileChartAtom; hovering it
// moves the picker's marker on the map.
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { PanelBottomClose } from "lucide-react"
import { ElevationProfileChart } from "@/components/TerrainControlPanel/elevation-profile-chart"
import { profileChartAtom, profileDockedAtom, profileHoverIndexAtom } from "@/lib/settings-atoms"
import { profileDockHeightAtom } from "@/lib/layout-constants"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export const ProfileDock: React.FC<{ isMobile: boolean; rightOffset: string }> = ({ isMobile, rightOffset }) => {
  const [docked, setDocked] = useAtom(profileDockedAtom)
  const chart = useAtomValue(profileChartAtom)
  const setHover = useSetAtom(profileHoverIndexAtom)
  const setHeight = useSetAtom(profileDockHeightAtom)
  const observerRef = useRef<ResizeObserver | null>(null)
  // A callback ref: the panel mounts and unmounts with the chart, and its
  // height (0 when gone) is what lifts the rest of the bottom stack.
  const measure = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) { setHeight(0); return }
    const obs = new ResizeObserver(() => setHeight(el.getBoundingClientRect().height))
    obs.observe(el)
    observerRef.current = obs
    setHeight(el.getBoundingClientRect().height)
  }, [setHeight])
  useEffect(() => () => { observerRef.current?.disconnect(); setHeight(0) }, [setHeight])
  // The chart draws at the strip's real width, so its labels keep their shape.
  const [chartWidth, setChartWidth] = useState(0)
  const chartObsRef = useRef<ResizeObserver | null>(null)
  const measureChart = useCallback((el: HTMLDivElement | null) => {
    chartObsRef.current?.disconnect()
    chartObsRef.current = null
    if (!el) return
    const obs = new ResizeObserver(() => setChartWidth(Math.round(el.getBoundingClientRect().width)))
    obs.observe(el)
    chartObsRef.current = obs
    setChartWidth(Math.round(el.getBoundingClientRect().width))
  }, [])
  if (!docked || !chart) return null
  return (
    <div
      ref={measure}
      data-snapshot-ignore
      className={cn(
        "absolute z-10 border border-border bg-background/95 backdrop-blur-[2px] shadow-sm px-2 pt-1 pb-1.5 transition-[right] duration-150",
        isMobile ? "bottom-0 left-0 right-0 rounded-none pb-[calc(0.375rem+env(safe-area-inset-bottom))]" : "bottom-4 left-4 rounded-xl",
      )}
      style={isMobile ? undefined : { right: rightOffset }}
    >
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
      <div ref={measureChart} className={cn(isMobile ? "h-[110px]" : "h-[130px]", "[&>svg]:h-full")}>
        <ElevationProfileChart points={chart.points} poleHeightM={chart.poleHeightM} onHover={setHover} width={chartWidth} height={isMobile ? 110 : 130} />
      </div>
    </div>
  )
}
