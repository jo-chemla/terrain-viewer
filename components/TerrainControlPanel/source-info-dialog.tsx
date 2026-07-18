import type React from "react"
import { useState } from "react"
import { useAtom } from "jotai"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { maxResolutionAtom } from "@/lib/settings-atoms"
import { buildGdalWmsXml } from "@/lib/build-gdal-xml"
import { type Bounds } from "@/lib/controls-utils"
import { GdalTabs } from "./gdal-tabs"

export const SourceInfoDialog: React.FC<{ sourceKey: string; config: any; getTilesUrl: (key: string) => string; getMapBounds: () => Bounds; state?: any }> = ({ sourceKey, config, getTilesUrl, getMapBounds, state }) => {
  const [maxResolution] = useAtom(maxResolutionAtom)
  const [activeGdalTab, setActiveGdalTab] = useState("url")

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

  // gdaldem natively covers Hillshade, Slope, Aspect, Elevation Hypso (color-relief),
  // TRI, TPI and Roughness — same math as this app's client-side Slope-and-More modes.
  // LRM, Blobness, and the Plan/Det-Hessian/Combined curvature variants have no gdaldem
  // equivalent (they're custom implementations inspired by the RVT QGIS plugin), so
  // they're intentionally left out here. Slope/Aspect/TRI/TPI/Roughness get no extra
  // flags: this app only ever varies their color-ramp display, never their underlying
  // gdaldem-equivalent computation (degrees-slope, compass-aspect, Riley TRI), so the
  // bare commands already match what's rendered live.
  //
  // Hillshade Method DOES change the actual computation, and happens to map onto
  // gdaldem's own like-named shading flags almost exactly — this app's method names
  // were chosen to mirror them: "-combined"/"-igor"/"-multidirectional" are real
  // gdaldem hillshade flags, and each one's illumination-control support here
  // (supportsIlluminationDirection/Altitude in hillshade-options-section.tsx) matches
  // what that gdaldem flag actually consumes (-multidirectional ignores -az entirely;
  // -igor ignores -alt). "standard"/"basic" have no flag of their own — they're
  // gdaldem's plain classic Lambertian shading (its default, using -az/-alt).
  const HILLSHADE_ALG_FLAG: Record<string, string> = {
    combined: "-combined",
    igor: "-igor",
    "multidir-colors": "-multidirectional",
  }
  const hillshadeMethod = state?.hillshadeMethod ?? "combined"
  const supportsIlluminationDirection = ["standard", "combined", "igor", "basic"].includes(hillshadeMethod)
  const supportsIlluminationAltitude = ["combined", "basic"].includes(hillshadeMethod)
  const hillshadeFlags = [
    HILLSHADE_ALG_FLAG[hillshadeMethod],
    supportsIlluminationDirection ? `-az ${Number(state?.illuminationDir ?? 315).toFixed(1)}` : null,
    supportsIlluminationAltitude ? `-alt ${Number(state?.illuminationAlt ?? 45).toFixed(1)}` : null,
  ].filter(Boolean).join(" ")

  const demInputFile = decodeFormula ? "output_altitude.tif" : "output.tif"
  const hillshadeLine = `gdaldem hillshade ${demInputFile} hillshade.tif${hillshadeFlags ? " " + hillshadeFlags : ""}`
  // <color_text_file> is a placeholder, not a real filename — gdaldem color-relief
  // needs a text file of "elevation R G B [A]" rows (its own -q/-of flags don't
  // generate one), and this app doesn't currently export the active color ramp in
  // that format, so there's nothing real to point at yet.
  const gdalDemCommand = `# Run against the DEM exported above (${demInputFile}). Covers the Slope-and-More\n# modes gdaldem supports natively — LRM, Blobness, and the Plan/Det-Hessian/Combined\n# curvature variants have no gdaldem equivalent (custom, RVT-inspired implementations).\n${hillshadeLine}\ngdaldem slope ${demInputFile} slope.tif\ngdaldem aspect ${demInputFile} aspect.tif\ngdaldem color-relief ${demInputFile} <color_text_file> color-relief.tif\ngdaldem TRI ${demInputFile} tri.tif\ngdaldem TPI ${demInputFile} tpi.tif\ngdaldem roughness ${demInputFile} roughness.tif`

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
            <GdalTabs tileUrl={tileUrl} wmsXml={wmsXml} gdalCommand={fullGdalCommand} gdalDemCommand={gdalDemCommand} onTabChange={setActiveGdalTab} />
            {(activeGdalTab === "cmd" || activeGdalTab === "gdaldem") && (
              <p className="text-xs text-muted-foreground mt-1">
                Need GDAL?{" "}
                <a href="https://qgis.org/" target="_blank" rel="noopener noreferrer" className="underline">QGIS</a>
                {" "}bundles its own GDAL binaries — usually at{" "}
                <code>C:\Program Files\QGIS {"<version>"}\bin\gdal_translate.exe</code>. Otherwise,
                install it via{" "}
                <a href="https://trac.osgeo.org/osgeo4w/" target="_blank" rel="noopener noreferrer" className="underline">OSGeo4W</a>
                {" "}(run commands from its "OSGeo4W Shell"), or{" "}
                <code>conda install -c conda-forge gdal</code>.
              </p>
            )}
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
