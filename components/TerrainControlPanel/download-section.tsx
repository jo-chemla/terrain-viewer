import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { useAtom } from "jotai"
import { Download, Camera, Copy, Loader2, MountainSnow, X, Images } from "lucide-react"
import { ExportMultiDialog } from "./export-multi-dialog"
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
import { track } from "@/lib/analytics"
import { ShareButton } from "./ShareSection"
import { TooltipButton } from "./controls-components"
import { Progress } from "@/components/ui/progress"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Cooperative cancellation only — an already in-flight synchronous decode
 *  step (e.g. the pixel loop below, or geotiff.js resampling a read that's
 *  already started) can't be interrupted mid-step, so a cancel takes effect
 *  at the next checkpoint: the next tile fetch, the next network request, or
 *  (checked explicitly) right before the final GeoTIFF is written to disk —
 *  never after. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export const DownloadSection: React.FC<{
  state: any
  getMapBounds: () => { west: number; south: number; east: number; north: number }
  getSourceConfig: (key: string) => SourceConfig | null
  mapRef: React.RefObject<MapRef>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  withSeparator?: boolean
  // Historical mode has no terrain/DEM source and no contour layer to export
  // — just the three actions that apply to any 2D view (Snapshot/Copy/Share),
  // shown as one equal-width row instead of the full DEM/Contours layout.
  historicalMode?: boolean
}> = ({ state, getMapBounds, getSourceConfig, mapRef, isOpen, onOpenChange, withSeparator, historicalMode = false }) => {
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [maxResolution, setMaxResolution] = useAtom(maxResolutionAtom)
  const [useClientExport] = useAtom(useClientExportAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [activeProjectConfig] = useAtom(activeProjectConfigAtom)
  const hideContoursExport = activeProjectConfig?.hiddenSections?.includes("contour") ?? false
  const { getTilesUrl } = useSourceConfig()
  const [isExporting, setIsExporting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isExportMultiOpen, setIsExportMultiOpen] = useState(false)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [exportError, setExportError] = useState("")
  // Non-fatal — the download still saved, but at less than the configured Max
  // Resolution because the source's tile pyramid ran out of zoom over this
  // bbox (see ClientExportResult.resolutionLimited in lib/client-export.ts).
  const [exportWarning, setExportWarning] = useState("")
  // Owns the currently in-flight DTM export's cancellation — see exportDTM
  // (creates it) and cancelExportDTM (the Cancel button, aborts it).
  const exportAbortControllerRef = useRef<AbortController | null>(null)
  // Most exports finish in well under a second, so a Cancel affordance would
  // just be noise flashing in and out — it only appears once an export has
  // been running for a bit, meaning it's actually worth cancelling.
  const [canCancelExport, setCanCancelExport] = useState(false)
  useEffect(() => {
    if (!isExporting) {
      setCanCancelExport(false)
      return
    }
    const timer = setTimeout(() => setCanCancelExport(true), 1500)
    return () => clearTimeout(timer)
  }, [isExporting])

  // Auto-dismiss the resolution-limited warning — it's informational, not
  // something that needs an explicit ack, so it shouldn't linger indefinitely
  // after a since-completed export.
  useEffect(() => {
    if (!exportWarning) return
    const timer = setTimeout(() => setExportWarning(""), 10000)
    return () => clearTimeout(timer)
  }, [exportWarning])

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
        track("actions-export", { kind: "snapshot-clipboard" })
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
      track("actions-export", { kind: "screenshot", viewMode: state.viewMode })

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
    // geotiff.js's own .d.ts types `values` as `any[]` but at runtime accepts
    // (and expects) a single TypedArray for a single-band raster like this.
    const outputArrayBuffer = await writeArrayBuffer(elevationData as unknown as any[], metadata)
    const blob = new Blob([outputArrayBuffer], { type: "image/tiff" })
    saveAs(blob, `terrain-dtm-${Date.now()}.tif`)
  }, [])

  const exportDTMClientSide = useCallback(async (signal: AbortSignal) => {
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
      signal,
    })
    // Every network step above already honours `signal`, but the pixel
    // decode + mosaic assembly around it doesn't — check once more right
    // before committing to a save, so a cancel that lands after the last
    // fetch resolves still doesn't produce a download.
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError")
    if (result.resolutionLimited) {
      setExportWarning(
        `Exported at ${result.width}×${result.height}px, below the ${maxResolution}px Max Resolution setting — this source has no deeper zoom data over the selected area.`,
      )
    }
    await saveElevationGeoTiff(result.data, result.width, result.height, {
      west: result.bbox[0], south: result.bbox[1], east: result.bbox[2], north: result.bbox[3],
    })
  }, [state.sourceA, customTerrainSources, getTilesUrl, getMapBounds, maxResolution, saveElevationGeoTiff])

  const exportDTMViaTitiler = useCallback(async (signal: AbortSignal) => {
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
    const response = await fetch(url, { signal })
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

    // The single `fetch` above is the only network step in this path — the
    // rest is a synchronous decode, so this is the last point a cancel can
    // still stop the file from being written.
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError")
    await saveElevationGeoTiff(elevationData, width, height, getMapBounds())
  }, [getTitilerDownloadUrl, getSourceConfig, state.sourceA, getMapBounds, saveElevationGeoTiff])

  const exportDTM = useCallback(async () => {
    if (isExporting) return

    const controller = new AbortController()
    exportAbortControllerRef.current = controller

    setIsExporting(true)
    setExportError("")
    setExportWarning("")
    setExportProgress(useClientExport ? 0 : null)
    track("actions-export", { kind: "dtm", mode: useClientExport ? "client" : "titiler" })
    try {
      if (useClientExport) {
        await exportDTMClientSide(controller.signal)
      } else {
        await exportDTMViaTitiler(controller.signal)
      }
    } catch (error) {
      if (isAbortError(error)) {
        track("actions-export", { kind: "dtm-cancelled" })
      } else {
        console.error("Failed to export DTM:", error)
        if (useClientExport) {
          setExportError(error instanceof Error ? error.message : "Client-side export failed")
        } else {
          const url = getTitilerDownloadUrl()
          window.open(url, "_blank")
        }
      }
    } finally {
      exportAbortControllerRef.current = null
      setIsExporting(false)
      setExportProgress(null)
    }
  }, [isExporting, useClientExport, exportDTMClientSide, exportDTMViaTitiler, getTitilerDownloadUrl])

  const cancelExportDTM = useCallback(() => {
    exportAbortControllerRef.current?.abort()
  }, [])

  // Moved here from ContourOptionsSection — contour export is a download action like
  // the others in this section, not a contour-rendering option.
  const exportContours = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const features = map.queryRenderedFeatures({ layers: ['contour-lines'] })
    // Stitches contour segments that were only cut apart by tile boundaries back
    // into single continuous lines — see lib/merge-contours.ts.
    downloadGeoJSON(mergeContourLines(features as GeoJSON.Feature[]), 'contours')
    track("actions-export", { kind: "contours" })
  }, [mapRef])

  if (historicalMode) {
    return (
      <Section title="Download and Snapshot" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={withSeparator}>
        <div className="flex gap-2">
          <TooltipButton
            icon={Camera}
            label="Snapshot"
            tooltip="Download Snapshot to Disk"
            onClick={downloadScreenshot}
            className="flex-1 bg-transparent"
          />
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
        <TooltipButton
          icon={Images}
          label="Export Historical GeoTiffs"
          tooltip="Batch-export historical imagery GeoTIFFs per drawn feature × source × date"
          onClick={() => setIsExportMultiOpen(true)}
          className="w-full bg-transparent"
        />
        <ExportMultiDialog open={isExportMultiOpen} onOpenChange={setIsExportMultiOpen} getMapBounds={getMapBounds} />
      </Section>
    )
  }

  return (
    <Section title="Download and Snapshot" isOpen={isOpen} onOpenChange={onOpenChange} withSeparator={withSeparator}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <TooltipButton
            icon={Camera}
            label="Snapshot"
            tooltip="Download Snapshot to Disk"
            onClick={downloadScreenshot}
            className="flex-1 bg-transparent"
          />
          {/* While exporting, an absolutely-positioned "Cancel" button sits on
              top of the (disabled, inert) spinner button and fades in on
              hover via group-hover — pure-CSS, no local hover state needed.
              pointer-events-none until hovered so it can't be clicked by
              accident the instant the export starts. Only mounted once
              canCancelExport flips true (see the effect above) — a fast
              export never shows a cancel affordance at all. */}
          <div className="relative flex-1 group">
            <TooltipButton
              icon={isExporting ? Loader2 : Download}
              label={isExporting ? "Exporting…" : "DEM GeoTiff"}
              tooltip="Export DTM as GeoTIFF"
              onClick={exportDTM}
              disabled={isExporting}
              // The hover-fade-to-Cancel behavior only applies once
              // canCancelExport is true (the Cancel button is only mounted
              // then) — gating group-hover:opacity-0 on isExporting alone
              // meant hovering during the first 1.5s faded this button to
              // nothing with no Cancel button underneath to replace it.
              className={cn(
                "block w-full",
                isExporting && "[&_svg]:animate-spin",
                isExporting && canCancelExport && "transition-opacity group-hover:opacity-0",
              )}
            />
            {isExporting && canCancelExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={cancelExportDTM}
                // Standard page background (bg-background — white in light
                // theme, dark in dark theme), pinned the same in rest/hover/
                // light/dark so it never shifts to the outline variant's own
                // accent hover fill — only the text and border use the
                // destructive token, in both rest and hover states.
                // dark:border-destructive is needed alongside plain
                // border-destructive — the outline variant's own
                // dark:border-input is a *different* tailwind-merge conflict
                // group than plain border-*, so it otherwise survives
                // untouched in dark mode (same reasoning as the dark:hover:bg
                // override below it).
                className="cursor-pointer absolute inset-0 min-w-0 bg-background hover:bg-background dark:bg-background dark:hover:bg-background border-destructive dark:border-destructive text-destructive hover:text-destructive opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto"
              >
                <X className="h-3 w-3 sm:h-4 sm:w-4 mr-1 shrink-0" />
                <span className="truncate text-xs sm:text-sm">Cancel</span>
              </Button>
            )}
          </div>
        </div>
        {exportProgress !== null && (
          <Progress value={exportProgress * 100} className="h-1" />
        )}
        {exportError && (
          <p className="text-xs text-red-500">{exportError}</p>
        )}
        {exportWarning && (
          <p className="text-xs text-amber-600 dark:text-amber-500">{exportWarning}</p>
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
        <TooltipButton
          icon={Images}
          label="Export Historical GeoTiffs"
          tooltip="Batch-export historical imagery GeoTIFFs per drawn feature × source × date"
          onClick={() => setIsExportMultiOpen(true)}
          className="w-full bg-transparent"
        />
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
      <ExportMultiDialog open={isExportMultiOpen} onOpenChange={setIsExportMultiOpen} getMapBounds={getMapBounds} />
    </Section>
  )
}