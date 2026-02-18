import type React from "react"
import { useAtom } from "jotai"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { maxResolutionAtom } from "@/lib/settings-atoms"
import { buildGdalWmsXml } from "@/lib/build-gdal-xml"
import { type Bounds } from "@/lib/controls-utils"
import { GdalTabs } from "./gdal-tabs"

export const SourceInfoDialog: React.FC<{ sourceKey: string; config: any; getTilesUrl: (key: string) => string; getMapBounds: () => Bounds }> = ({ sourceKey, config, getTilesUrl, getMapBounds }) => {
  const [maxResolution] = useAtom(maxResolutionAtom)

  const bounds = getMapBounds()
  const tileUrl = getTilesUrl(sourceKey)
  const wmsXml = buildGdalWmsXml(tileUrl, config.sourceConfig.tileSize || 256)

  const gdalCommand = `gdal_translate -outsize ${maxResolution} 0 -projwin ${bounds.west} ${bounds.north} ${bounds.east} ${bounds.south} -projwin_srs EPSG:4326 "${wmsXml}" output.tif`

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="cursor-pointer">
          <Tooltip>
            <TooltipTrigger asChild>
              <span><Info className="h-4 w-4" /></span>
            </TooltipTrigger>
            <TooltipContent>View source details</TooltipContent>
          </Tooltip>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{config.name}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">
          ✕
        </DialogClose>

        <div className="space-y-4 text-sm">
          <div>
            <span className="font-semibold">Link:</span>
            <div className="flex items-center gap-2 mt-1">
              <a
                href={config.link.split("#")[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline flex-1 truncate"
              >
                {config.link.split("#")[0]}
              </a>
            </div>
          </div>

          <div>
            <span className="font-semibold">Encoding Type:</span> {config.encoding}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold">GDAL & TMS Access:</span>
            </div>
            <GdalTabs tileUrl={tileUrl} wmsXml={wmsXml} gdalCommand={gdalCommand} />
          </div>

          <div>
            <h4 className="font-semibold mb-1">High-resolution QGIS DEM export</h4>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Copy the DEM source URL</li>
              <li>In QGIS, go to Layer → Add Layers → TMS/XYZ Layer</li>
              <li>Paste the templated source URL</li>
              <li>Use encoding <strong>{config.encoding}</strong></li>
              <li>Set tile resolution <strong>{config.sourceConfig.tileSize || 256}</strong></li>
            </ul>
          </div>

          <div>
            <span className="font-semibold">Max Zoom:</span> {config.sourceConfig.maxzoom}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
