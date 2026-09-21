import type React from "react"
import { ExternalLink } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type Bounds } from "@/lib/controls-utils"
import { SourceInfoDialog } from "./source-info-dialog"

export const SourceDetails: React.FC<{
  sourceKey: string; config: any; getTilesUrl: any; linkCallback: any; getMapBounds: () => Bounds; state?: any
}> = ({ sourceKey, config, getTilesUrl, linkCallback, getMapBounds, state }) => (
  <>
    <Label htmlFor={`source-${sourceKey}`} className={`flex-1 text-sm truncate min-w-0 ${sourceKey !== "google3dtiles" ? "cursor-pointer" : "cursor-not-allowed"}`}>
      {config.name}
    </Label>
    {config.datum === "ellipsoidal" && (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 cursor-help">
              ellipsoidal
            </span>
          }
        />
        <TooltipContent>
          <p className="max-w-[260px]">
            Heights are above the WGS84 <b>ellipsoid</b>, not the geoid — about <b>+49 m</b> in the Alps, and
            anywhere from −107 m to +85 m worldwide. Almost every other source here is orthometric
            (&ldquo;above sea level&rdquo;). Load the EGM96 geoid entry from the Library to see the offset itself.
          </p>
        </TooltipContent>
      </Tooltip>
    )}
    <SourceInfoDialog sourceKey={sourceKey} config={config} getTilesUrl={getTilesUrl} getMapBounds={getMapBounds} state={state} />
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={linkCallback(config.link)}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        }
      />
      <TooltipContent><p>Open documentation</p></TooltipContent>
    </Tooltip>
  </>
)
