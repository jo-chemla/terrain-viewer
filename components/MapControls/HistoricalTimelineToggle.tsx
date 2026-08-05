import type React from "react"
import { Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// Floating replacement for the historical timeline panel's full header bar
// while it's collapsed — sits bottom-left, just below the minimap (see
// TerrainViewer.tsx's --minimap-offset: it grows from the unified 16px
// control margin to 3.5rem whenever this button is showing, to leave room
// for it below the minimap control). widthPx only matches the minimap when
// IT is also minimized (both read as a matched pair of small icon-sized
// controls, 40px) — when the minimap is fully expanded (260px), stretching
// this button to the same width would look oversized for a plain icon
// button, so it keeps its own natural size instead (widthPx omitted).
//
// Styling matches MinimapControl's own minimized-state button EXACTLY
// (components/MapControls/MinimapControl.tsx: "rounded-md border bg-
// background shadow-lg" outer look, "ghost" variant, no icon color
// override) rather than approximating it — same rounded-square card, same
// light background, same border/shadow weight, same icon color.
export const HistoricalTimelineToggle: React.FC<{ onExpand: () => void; widthPx?: number }> = ({ onExpand, widthPx }) => (
  <TooltipProvider delay={0} timeout={0}>
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="fixed z-10 left-4 bottom-4 h-10 w-10 cursor-pointer rounded-md border bg-background shadow-lg hover:bg-accent"
            style={widthPx ? { width: widthPx } : undefined}
            onClick={onExpand}
          >
            <Clock className="h-4 w-4" />
          </Button>
        }
      />
      <TooltipContent>
        <p>Expand historical timeline</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)
