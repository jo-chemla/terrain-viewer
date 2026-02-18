import type React from "react"
import { ExternalLink } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type Bounds } from "@/lib/controls-utils"
import { SourceInfoDialog } from "./source-info-dialog"

export const SourceDetails: React.FC<{
  sourceKey: string; config: any; getTilesUrl: any; linkCallback: any; getMapBounds: () => Bounds
}> = ({ sourceKey, config, getTilesUrl, linkCallback, getMapBounds }) => (
  <>
    <Label htmlFor={`source-${sourceKey}`} className={`flex-1 text-sm ${sourceKey !== "google3dtiles" ? "cursor-pointer" : "cursor-not-allowed"}`}>
      {config.name}
    </Label>
    <SourceInfoDialog sourceKey={sourceKey} config={config} getTilesUrl={getTilesUrl} getMapBounds={getMapBounds} />
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={linkCallback(config.link)}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent><p>Open documentation</p></TooltipContent>
    </Tooltip>
  </>
)
