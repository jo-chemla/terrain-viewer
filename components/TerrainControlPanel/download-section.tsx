import type React from "react"
import { useState, useCallback } from "react"
import { useAtom } from "jotai"
import { Download, Camera, Copy, Loader2 } from "lucide-react"
import { titilerEndpointAtom, maxResolutionAtom } from "@/lib/settings-atoms"
import { buildGdalWmsXml } from "@/lib/build-gdal-xml"
import { fromArrayBuffer, writeArrayBuffer } from "geotiff"
import saveAs from "file-saver"
import type { MapRef } from "react-map-gl/maplibre"
import { Section } from "./controls-components"
import { type SourceConfig, captureAndCopyMapToClipboard, captureMapScreenshot } from "@/lib/controls-utils"
import { ShareButton } from "./ShareSection"
import { TooltipButton, TooltipIconButton } from "./controls-components"

export const DownloadSection: React.FC<{
  state: any
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  getSourceConfig: (key: string) => SourceConfig | null
  mapRef: React.RefObject<MapRef>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}> = ({ state, getMapBounds, getSourceConfig, mapRef, isOpen, onOpenChange }) => {
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [maxResolution] = useAtom(maxResolutionAtom)
  const [isExporting, setIsExporting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)

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

  const exportDTM = useCallback(async () => {
    if (isExporting) return
    
    setIsExporting(true)
    try {
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
      const sourceConfig = getSourceConfig(state.sourceA)
      if (!sourceConfig) {
        console.error("Source config not found")
        return
      }
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

      const bounds = getMapBounds()
      const pixelSizeX = (bounds.east - bounds.west) / width
      const pixelSizeY = (bounds.north - bounds.south) / height

      const metadata = {
        GTModelTypeGeoKey: 2,
        GeographicTypeGeoKey: 4326,
        GeogCitationGeoKey: "WGS 84",
        height,
        width,
        ModelPixelScale: [pixelSizeX, pixelSizeY, 0],
        ModelTiepoint: [0, 0, 0, bounds.west, bounds.north, 0],
        SamplesPerPixel: 1,
        BitsPerSample: [32],
        SampleFormat: [3],
        PlanarConfiguration: 1,
        PhotometricInterpretation: 1,
      }

      const outputArrayBuffer = await writeArrayBuffer(elevationData, metadata)
      const blob = new Blob([outputArrayBuffer], { type: "image/tiff" })
      saveAs(blob, `terrain-dtm-${Date.now()}.tif`)
    } catch (error) {
      console.error("Failed to export DTM:", error)
      const url = getTitilerDownloadUrl()
      window.open(url, "_blank")
    } finally {
      setIsExporting(false)
    }
  }, [getTitilerDownloadUrl, getSourceConfig, state.sourceA, getMapBounds, isExporting])

  return (
    <Section title="Download" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="flex gap-2">
        <TooltipButton
          icon={isExporting ? Loader2 : Download}
          label={isExporting ? "Exporting…" : "Export DTM"}
          tooltip="Export DTM as GeoTIFF"
          onClick={exportDTM}
          disabled={isExporting}
          className={`flex-[2] ${isExporting ? "animate-spin" : ""}`}
        />
        <TooltipIconButton
          icon={Camera}
          tooltip="Download Snapshot to Disk"
          onClick={downloadScreenshot}
          variant="outline"
          className="flex-1 bg-transparent"
        />
        <TooltipIconButton
          icon={isCopying ? Loader2 : Copy}
          tooltip="Copy snapshot to clipboard"
          onClick={copySnapshotToClipboard}
          disabled={isCopying}
          variant="outline"
          className={`flex-1 bg-transparent ${isCopying ? "[&_svg]:animate-spin" : ""}`}
        />
        <ShareButton mapRef={mapRef} />
      </div>
    </Section>
  )
}