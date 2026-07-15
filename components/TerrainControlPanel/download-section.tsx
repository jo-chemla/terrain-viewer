import type React from "react"
import { useState, useCallback } from "react"
import { useAtom } from "jotai"
import { Download, Camera, Copy, Loader2, MountainSnow } from "lucide-react"
import { titilerEndpointAtom, maxResolutionAtom, useClientExportAtom, customTerrainSourcesAtom, activeProjectConfigAtom } from "@/lib/settings-atoms"
import { buildGdalWmsXml } from "@/lib/build-gdal-xml"
import { fromArrayBuffer, writeArrayBuffer } from "geotiff"
import saveAs from "file-saver"
import type { MapRef } from "react-map-gl/maplibre"
import { Section } from "./controls-components"
import { type SourceConfig, useSourceConfig, captureAndCopyMapToClipboard, captureMapScreenshot } from "@/lib/controls-utils"
import { getClientExportSource, exportElevationClientSide } from "@/lib/client-export"
import { downloadGeoJSON } from "@/lib/download-geojson"
import { mergeContourLines } from "@/lib/merge-contours"
import { ShareButton } from "./ShareSection"
import { TooltipButton } from "./controls-components"
import { Progress } from "@/components/ui/progress"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

export const DownloadSection: React.FC<{
  state: any
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  getSourceConfig: (key: string) => SourceConfig | null
  mapRef: React.RefObject<MapRef>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, getMapBounds, getSourceConfig, mapRef, isOpen, onOpenChange }) => {
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [maxResolution, setMaxResolution] = useAtom(maxResolutionAtom)
  const [useClientExport] = useAtom(useClientExportAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const hideContoursExport = activeProjectConfig?.hiddenSections?.includes("contour") ?? false
  const { getTilesUrl } = useSourceConfig()
  const [isExporting, setIsExporting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [exportError, setExportError] = useState("")

  const getTitilerDownloadUrl = useCallback(() => {
    const sourceConfig = getSourceConfig(state.sourceA)
    if (!sourceConfig) return ""
    const wmsXml = buildGdalWmsXml(sourceConfig.tileUrl, sourceConfig.tileSize)
    const bounds = getMapBounds()
    return `${titilerEndpoint}/cog/bbox/${bounds.west},${bounds.south},${bounds.east},${bounds.north}/${maxResolution}x${maxResolution}.tif?url=${encodeURIComponent(wmsXml)}`
  }, [state.sourceA, getSourceConfig, getMapBounds, maxResolution, titilerEndpoint])

  const copySnapshotToClipboard = useCallback(async () => {
    if (!mapRef.current || isCopying) return
    
    setIsCopying(true)
    try {
      const success = await captureAndCopyMapToClipboard(mapRef)
      if (success) {
        console.log("Snapshot copied to clipboard")
      } else {
        console.error("Failed to copy snapshot")
      }
    } catch (error) {
      console.error("Failed to copy snapshot:", error)
    } finally {
      // Keep the loading state visible briefly for user feedback
      setTimeout(() => setIsCopying(false), 500)
    }
  }, [mapRef, isCopying])

  const downloadScreenshot = useCallback(async () => {
    if (!mapRef.current) return
    const filename = `terrain-composited-${new Date().toISOString()}${state.viewMode === "2d" ? "-epsg4326" : ""}`

    try {
      // Use JPEG for faster screenshot generation and smaller file size
      const blob = await captureMapScreenshot(mapRef, "jpeg")
      if (!blob) {
        console.error("Failed to capture screenshot")
        return
      }
      
      saveAs(blob, `${filename}.jpg`)

      // Generate world file if in 2D mode
      if (state.viewMode === "2d") {
        const canvas = mapRef.current.getMap().getCanvas()
        const { clientWidth: width, clientHeight: height } = canvas
        const bounds = getMapBounds()
        const pixelSizeX = (bounds.east - bounds.west) / width
        const pixelSizeY = (bounds.north - bounds.south) / height
        const pgwContent = [
          pixelSizeX.toFixed(10),
          "0.0",
          "0.0",
          (-pixelSizeY).toFixed(10),
          bounds.west.toFixed(10),
          bounds.north.toFixed(10),
        ].join("\n")
        // Use .jgw for JPEG world file (instead of .pgw for PNG)
        saveAs(new Blob([pgwContent], { type: "text/plain" }), `${filename}.jgw`)
      }
    } catch (error) {
      console.error("Failed to download screenshot:", error)
    }
  }, [mapRef, state.viewMode, getMapBounds])

  const saveElevationGeoTiff = useCallback(async (
    elevationData: Float32Array, width: number, height: number,
    bbox: { west: number; south: number; east: number; north: number },
  ) => {
    const pixelSizeX = (bbox.east - bbox.west) / width
    const pixelSizeY = (bbox.north - bbox.south) / height
    const metadata = {
      GTModelTypeGeoKey: 2,
      GeographicTypeGeoKey: 4326,
      GeogCitationGeoKey: "WGS 84",
      height,
      width,
      ModelPixelScale: [pixelSizeX, pixelSizeY, 0],
      ModelTiepoint: [0, 0, 0, bbox.west, bbox.north, 0],
      SamplesPerPixel: 1,
      BitsPerSample: [32],
      SampleFormat: [3],
      PlanarConfiguration: 1,
      PhotometricInterpretation: 1,
    }
    const outputArrayBuffer = await writeArrayBuffer(elevationData, metadata)
    const blob = new Blob([outputArrayBuffer], { type: "image/tiff" })
    saveAs(blob, `terrain-dtm-${Date.now()}.tif`)
  }, [])

  const exportDTMClientSide = useCallback(async () => {
    const clientSource = getClientExportSource(state.sourceA, customTerrainSources, getTilesUrl)
    if (!clientSource) {
      setExportError("This source isn't supported for client-side export (only COG, TerrainRGB and Terrarium sources are) — switch off Client-side mode to export via Titiler instead.")
      return
    }
    const bounds = getMapBounds()
    const result = await exportElevationClientSide({
      source: clientSource,
      bbox: [bounds.west, bounds.south, bounds.east, bounds.north],
      targetResolution: maxResolution,
      onProgress: setExportProgress,
    })
    await saveElevationGeoTiff(result.data, result.width, result.height, {
      west: result.bbox[0], south: result.bbox[1], east: result.bbox[2], north: result.bbox[3],
    })
  }, [state.sourceA, customTerrainSources, getTilesUrl, getMapBounds, maxResolution, saveElevationGeoTiff])

  const exportDTMViaTitiler = useCallback(async () => {
    const sourceConfig = getSourceConfig(state.sourceA)
    if (!sourceConfig) {
      setExportError("Source config not found")
      return
    }
    if (sourceConfig.unsupported) {
      setExportError("This source type can't be exported via Titiler (no tile pyramid to mosaic) — try Client-side mode for COG/TerrainRGB/Terrarium sources instead.")
      return
    }

    const url = getTitilerDownloadUrl()
    const response = await fetch(url)
    if (!response.ok) {
      window.open(url, "_blank")
      return
    }

    const arrayBuffer = await response.arrayBuffer()
    const tiff = await fromArrayBuffer(arrayBuffer)
    const image = await tiff.getImage()
    const rasters = await image.readRasters()

    const width = image.getWidth()
    const height = image.getHeight()
    const encoding = sourceConfig.encoding

    const elevationData = new Float32Array(width * height)
    const r = rasters[0] as any
    const g = rasters[1] as any
    const b = rasters[2] as any

    for (let i = 0; i < width * height; i++) {
      if (encoding === "terrainrgb") {
        elevationData[i] = -10000 + (r[i] * 256 * 256 + g[i] * 256 + b[i]) * 0.1
      } else {
        elevationData[i] = r[i] * 256 + g[i] + b[i] / 256 - 32768
      }
    }

    await saveElevationGeoTiff(elevationData, width, height, getMapBounds())
  }, [getTitilerDownloadUrl, getSourceConfig, state.sourceA, getMapBounds, saveElevationGeoTiff])

  const exportDTM = useCallback(async () => {
    if (isExporting) return

    setIsExporting(true)
    setExportError("")
    setExportProgress(useClientExport ? 0 : null)
    try {
      if (useClientExport) {
        await exportDTMClientSide()
      } else {
        await exportDTMViaTitiler()
      }
    } catch (error) {
      console.error("Failed to export DTM:", error)
      if (useClientExport) {
        setExportError(error instanceof Error ? error.message : "Client-side export failed")
      } else {
        const url = getTitilerDownloadUrl()
        window.open(url, "_blank")
      }
    } finally {
      setIsExporting(false)
      setExportProgress(null)
    }
  }, [isExporting, useClientExport, exportDTMClientSide, exportDTMViaTitiler, getTitilerDownloadUrl])

  // Moved here from ContourOptionsSection — contour export is a download action like
  // the others in this section, not a contour-rendering option.
  const exportContours = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const features = map.queryRenderedFeatures({ layers: ['contour-lines'] })
    // Stitches contour segments that were only cut apart by tile boundaries back
    // into single continuous lines — see lib/merge-contours.ts.
    downloadGeoJSON(mergeContourLines(features as GeoJSON.Feature[]), 'contours')
  }, [mapRef])

  return (
    <Section title="Download and Snapshot" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <TooltipButton
            icon={Camera}
            label="Snapshot"
            tooltip="Download Snapshot to Disk"
            onClick={downloadScreenshot}
            className="flex-1 bg-transparent"
          />
          <TooltipButton
            icon={isExporting ? Loader2 : Download}
            label={isExporting ? "Exporting…" : "DEM GeoTiff"}
            tooltip="Export DTM as GeoTIFF"
            onClick={exportDTM}
            disabled={isExporting}
            className={`flex-1 ${isExporting ? "[&_svg]:animate-spin" : ""}`}
          />
        </div>
        {exportProgress !== null && (
          <Progress value={exportProgress * 100} className="h-1" />
        )}
        {exportError && (
          <p className="text-xs text-red-500">{exportError}</p>
        )}
        <div className="flex gap-2">
          {!hideContoursExport && (
            <TooltipButton
              icon={MountainSnow}
              label="Contours"
              tooltip={state.showContoursAndGraticules && state.showContours
                ? "Export the contour lines currently rendered in the viewport as GeoJSON"
                : "Contours must be activated in visualization mode first."}
              onClick={exportContours}
              // Matches the actual layer-visibility condition in TerrainViewer.tsx
              // (showContoursAndGraticules is the "Contours & GeoGrid" viz-mode master
              // toggle, showContours is the sub-checkbox for the lines specifically) —
              // checking showContours alone left this enabled even when the whole
              // contours feature was off, since showContours defaults to true.
              disabled={!(state.showContoursAndGraticules && state.showContours)}
              className="flex-1 bg-transparent"
            />
          )}
          <TooltipButton
            icon={isCopying ? Loader2 : Copy}
            label="Copy"
            tooltip="Copy snapshot to clipboard"
            onClick={copySnapshotToClipboard}
            disabled={isCopying}
            className={`flex-1 bg-transparent ${isCopying ? "[&_svg]:animate-spin" : ""}`}
          />
          <ShareButton mapRef={mapRef} />
        </div>
        {/* Lived in the Settings modal — moved next to the export buttons it
            actually parameterizes (DEM GeoTIFF size cap, both export paths). */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Label htmlFor="max-resolution" className="text-sm">Max Download Resolution (px)</Label>
          <Input
            id="max-resolution"
            type="number"
            placeholder="4096"
            value={maxResolution}
            onChange={(e) => setMaxResolution(Number.parseFloat(e.target.value))}
            className="cursor-text h-7 w-24 text-right"
          />
        </div>
      </div>
    </Section>
  )
}