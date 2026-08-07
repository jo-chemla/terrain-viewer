// Batch historical-imagery export: for every selected drawn feature × every
// selected historical source × every real capture date within a picked
// range, crop that source/date to the feature's own (padded) extent and
// write one RGB GeoTIFF, bundled into a single .zip — see
// components/TerrainControlPanel/export-multi-dialog.tsx for the UI.
import { zipSync } from "fflate"
import type { GeoJSONFeature, DrawLayer } from "@/components/TerrainControlPanel/TerraDrawSystem"
import { EXPORT_SOURCE_IDS, listExportTicks, type ExportSourceId, type ExportTick } from "./historical-export-sources"
import { computeFeaturePaddedExtent, type Bbox4 } from "./feature-extent"
import { fetchRgbTileMosaic } from "./rgb-tile-mosaic"
import { buildRgbGeoTiff } from "./rgb-geotiff"
import { pickZoomForResolution } from "./tile-mosaic"
import bbox from "@turf/bbox"

// Real per-location "which releases actually differ here" queries (Wayback,
// GE Historical) need SOME zoom to query at — this doesn't have to match the
// eventual export zoom (computed per-tick below from targetResolution), just
// be representative enough that "does this release/date have distinct
// imagery at this spot" resolves sensibly. 16 sits comfortably inside every
// source's own pyramid (Wayback caps at 19, GE at 23, HLS at 16, EOX at 14).
const LISTING_ZOOM = 16

export interface ExportMultiOptions {
  features: GeoJSONFeature[]
  layers: DrawLayer[]
  sourceIds: ExportSourceId[]
  startMs: number
  endMs: number
  pointPaddingMeters: number
  percentPadding: number
  /** Same convention as maxResolutionAtom — target pixel width/height per
   *  exported tile; the source's own real tile pyramid may cap it lower. */
  targetResolution: number
  planetKey?: string
  onProgress?: (info: { phase: "listing" | "exporting"; completed: number; total: number; label: string }) => void
  signal?: AbortSignal
}

export interface ExportMultiSkip {
  feature: string
  source: ExportSourceId
  reason: string
}

export interface ExportMultiResult {
  zipBlob: Blob
  fileCount: number
  skipped: ExportMultiSkip[]
}

/** Filesystem-safe-ish stem — collapses anything outside word chars/dash
 *  into "-", same convention as lib/download-geojson.ts's slugifyLayerName. */
function slugify(text: string): string {
  return text.trim().replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "feature"
}

function featureLabel(feature: GeoJSONFeature, layers: DrawLayer[], index: number): string {
  const name = feature.properties?.name
  if (typeof name === "string" && name.trim()) return slugify(name)
  const layer = layers.find((l) => l.id === feature.properties?.layerId)
  const shortId = (feature.id ?? "").toString().slice(0, 8)
  return slugify(`${layer?.name ?? "feature"}-${index + 1}${shortId ? `-${shortId}` : ""}`)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export async function exportMultiHistorical(opts: ExportMultiOptions): Promise<ExportMultiResult> {
  const { features, layers, sourceIds, startMs, endMs, pointPaddingMeters, percentPadding, targetResolution, planetKey, onProgress, signal } = opts

  // Phase 1: resolve every feature's padded extent + every (feature, source)
  // pair's real ticks in range — the total export count isn't known until
  // this finishes, since it depends on each source's real capture calendar
  // at each feature's own location.
  const plan: { feature: GeoJSONFeature; label: string; paddedBbox: Bbox4; extentDescriptor: string; source: ExportSourceId; tick: ExportTick }[] = []
  const skipped: ExportMultiSkip[] = []

  let listed = 0
  const listingTotal = features.length * sourceIds.length
  for (let i = 0; i < features.length; i++) {
    const feature = features[i]
    const label = featureLabel(feature, layers, i)
    const { bbox: paddedBbox, descriptor } = computeFeaturePaddedExtent(feature, { pointPaddingMeters, percentPadding })
    const [west, south, east, north] = bbox(feature) as Bbox4
    const centerLat = (south + north) / 2
    const centerLng = (west + east) / 2

    for (const sourceId of sourceIds) {
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError")
      onProgress?.({ phase: "listing", completed: listed, total: listingTotal, label: `${label} — ${sourceId}` })
      try {
        const ticks = await listExportTicks(sourceId, centerLat, centerLng, LISTING_ZOOM, startMs, endMs, planetKey)
        if (!ticks.length) skipped.push({ feature: label, source: sourceId, reason: "No capture found in the selected date range" })
        for (const tick of ticks) plan.push({ feature, label, paddedBbox, extentDescriptor: descriptor, source: sourceId, tick })
      } catch (err) {
        skipped.push({ feature: label, source: sourceId, reason: err instanceof Error ? err.message : "Failed to list dates" })
      }
      listed++
    }
  }

  // Phase 2: fetch + write one GeoTIFF per plan entry.
  const entries: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()
  let done = 0
  for (const item of plan) {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError")
    onProgress?.({ phase: "exporting", completed: done, total: plan.length, label: `${item.label} — ${item.source} — ${item.tick.label}` })
    try {
      const zoom = Math.min(
        pickZoomForResolution(item.paddedBbox, targetResolution, targetResolution, item.tick.tileSpec.tileSize),
        item.tick.tileSpec.maxzoom,
      )
      const mosaic = await fetchRgbTileMosaic({
        tileUrlTemplate: item.tick.tileSpec.tileUrlTemplate,
        buildTileUrl: item.tick.tileSpec.buildTileUrl,
        tileSize: item.tick.tileSpec.tileSize,
        bbox: item.paddedBbox,
        zoom,
        signal,
      })
      const tiffBlob = await buildRgbGeoTiff(mosaic.r, mosaic.g, mosaic.b, mosaic.width, mosaic.height, {
        west: mosaic.bbox[0], south: mosaic.bbox[1], east: mosaic.bbox[2], north: mosaic.bbox[3],
      })
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError")

      let name = `${item.label}_${item.extentDescriptor}_${item.source}_${item.tick.label}`
      if (usedNames.has(name)) {
        let n = 2
        while (usedNames.has(`${name}-${n}`)) n++
        name = `${name}-${n}`
      }
      usedNames.add(name)
      entries[`${name}.tif`] = new Uint8Array(await tiffBlob.arrayBuffer())
    } catch (err) {
      if (isAbortError(err)) throw err
      skipped.push({ feature: item.label, source: item.source, reason: err instanceof Error ? err.message : "Export failed" })
    }
    done++
  }

  const bytes = zipSync(entries, { level: 0 })
  return { zipBlob: new Blob([bytes as BlobPart], { type: "application/zip" }), fileCount: Object.keys(entries).length, skipped }
}

export { EXPORT_SOURCE_IDS }
export type { ExportSourceId }
