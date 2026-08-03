import type React from "react"
import { Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// Floating replacement for the historical timeline panel's full header bar
// while it's collapsed — sits bottom-left, just below the minimap (see
// TerrainViewer.tsx's --minimap-offset: it grows from the unified 16px
// control margin to 3.5rem whenever this button is showing, to leave room
// for it below the minimap control). widthPx matches the minimap's OWN
// current width (260 expanded / 40 minimized, see MinimapControl.tsx) so the
// two stack as a visually consistent column instead of a narrow icon button
// under a much wider (or, when minimized, differently-sized) minimap.
export const HistoricalTimelineToggle: React.FC<{ onExpand: () => void; widthPx: number }> = ({ onExpand, widthPx }) => (
  <TooltipProvider delay={0} timeout={0}>
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            className="fixed z-10 left-4 bottom-4 cursor-pointer shadow"
            style={{ width: widthPx }}
            onClick={onExpand}
          >
            <Clock className="h-5 w-5" />
          </Button>
        }
      />
      <TooltipContent>
        <p>Expand historical timeline</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)
