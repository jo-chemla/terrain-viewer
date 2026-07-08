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

  // GDAL's WMS/TMS driver has no native decoder for terrarium or Mapbox terrain-rgb — it just
  // reads the tile bytes as plain RGB imagery, so gdal_translate above only exports the raw
  // encoded pixels. gdal_calc.py decodes them into real-world altitude (meters) as a second step.
  const decodeFormula = config.encoding === "terrarium"
    ? "(A.astype(float)*256+B+C/256.0)-32768"
    : config.encoding === "terrainrgb"
      ? "-10000+((A.astype(float)*65536+B*256+C)*0.1)"
      : undefined

  const fullGdalCommand = decodeFormula
    ? `${gdalCommand}\n\n# GDAL has no native ${config.encoding} decoder — decode raw elevation (Float32 meters):\ngdal_calc.py -A output.tif --A_band=1 -B output.tif --B_band=2 -C output.tif --C_band=3 \\\n  --outfile=output_altitude.tif --type=Float32 \\\n  --calc="${decodeFormula}"`
    : gdalCommand

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
            <GdalTabs tileUrl={tileUrl} wmsXml={wmsXml} gdalCommand={fullGdalCommand} />
            <p className="text-xs text-muted-foreground mt-1">
              Need GDAL? If you already have{" "}
              <a href="https://qgis.org/" target="_blank" rel="noopener noreferrer" className="underline">QGIS</a>
              {" "}installed, it bundles its own GDAL binaries — on Windows they're usually at{" "}
              <code>C:\Program Files\QGIS {"<version>"}\bin\gdal_translate.exe</code> (autocomplete
              from <code>C:\Program Files\</code> to find your installed version). Otherwise, install
              it via{" "}
              <a href="https://trac.osgeo.org/osgeo4w/" target="_blank" rel="noopener noreferrer" className="underline">OSGeo4W</a>
              {" "}(run commands from its "OSGeo4W Shell"), or{" "}
              <code>conda install -c conda-forge gdal</code>.
            </p>
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
