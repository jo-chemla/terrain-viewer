// Batch historical-imagery export: for every export target (either the
// current map viewport as one bbox, or every drawn feature) × every
// selected historical source × every real capture date within a picked
// range, crop that source/date to the target's own (padded) extent and
// write one RGB GeoTIFF, bundled into a single .zip — see
// components/TerrainControlPanel/export-multi-dialog.tsx for the UI.
import { zipSync } from "fflate"
import type { GeoJSONFeature, DrawLayer } from "@/components/TerrainControlPanel/TerraDrawSystem"
import { EXPORT_SOURCE_IDS, listExportTicks, type ExportSourceId, type ExportTick } from "./historical-export-sources"
import { computeFeaturePaddedExtent, type Bbox4 } from "./feature-extent"
import { fetchRgbTileMosaic } from "./rgb-tile-mosaic"
import { buildRgbGeoTiff } from "./rgb-geotiff"
import { pickZoomForResolution } from "./tile-mosaic"
import { hasGdalTemplate, hasGdalQuadkeyTemplate, buildGdalTranslateCommand, buildGdalSkipComment } from "./gdal-export"
import bbox from "@turf/bbox"

// Real per-location "which releases actually differ here" queries (Wayback,
// GE Historical) need SOME zoom to query at — this doesn't have to match the
// eventual export zoom (computed per-tick below from targetResolution), just
// be representative enough that "does this release/date have distinct
// imagery at this spot" resolves sensibly. 16 sits comfortably inside every
// source's own pyramid (Wayback caps at 19, GE at 23, HLS at 16, EOX at 14).
const LISTING_ZOOM = 16

export type ExportMultiMode = "viewport" | "feature"

export interface ExportMultiOptions {
  /** "viewport": exports exactly one target, the current map bounds — no
   *  drawing required. "feature": one target per drawn feature (existing
   *  behavior), padded per pointPaddingMeters/percentPadding below. */
  mode: ExportMultiMode
  /** Only read when mode === "feature". */
  features: GeoJSONFeature[]
  layers: DrawLayer[]
  /** Only read when mode === "viewport" — the live map bounds at run time. */
  viewportBbox?: Bbox4
  sourceIds: ExportSourceId[]
  startMs: number
  endMs: number
  pointPaddingMeters: number
  percentPadding: number
  /** Same convention as maxResolutionAtom — target pixel width/height per
   *  exported tile; the source's own real tile pyramid may cap it lower. */
  targetResolution: number
  planetKey?: string
  /** Also write one `<target>_gdal_commands.bat` per target into the zip,
   *  with a gdal_translate command per (source, capture date) that has a
   *  real fetchable tile URL — see lib/gdal-export.ts for which sources
   *  qualify and why the rest are REM-commented instead of included. */
  includeGdalScript?: boolean
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

interface ExportTarget {
  label: string
  paddedBbox: Bbox4
  extentDescriptor: string
  centerLat: number
  centerLng: number
}

function buildTargets(opts: ExportMultiOptions): ExportTarget[] {
  if (opts.mode === "viewport") {
    if (!opts.viewportBbox) return []
    const [west, south, east, north] = opts.viewportBbox
    return [{ label: "viewport", paddedBbox: opts.viewportBbox, extentDescriptor: "viewport", centerLat: (south + north) / 2, centerLng: (west + east) / 2 }]
  }
  return opts.features.map((feature, i) => {
    const label = featureLabel(feature, opts.layers, i)
    const { bbox: paddedBbox, descriptor } = computeFeaturePaddedExtent(feature, { pointPaddingMeters: opts.pointPaddingMeters, percentPadding: opts.percentPadding })
    const [west, south, east, north] = bbox(feature) as Bbox4
    return { label, paddedBbox, extentDescriptor: descriptor, centerLat: (south + north) / 2, centerLng: (west + east) / 2 }
  })
}

export async function exportMultiHistorical(opts: ExportMultiOptions): Promise<ExportMultiResult> {
  const { sourceIds, startMs, endMs, targetResolution, planetKey, includeGdalScript, onProgress, signal } = opts

  const targets = buildTargets(opts)

  // Phase 1: resolve every target's real ticks in range — the total export
  // count isn't known until this finishes, since it depends on each
  // source's real capture calendar at each target's own location.
  const plan: { target: ExportTarget; source: ExportSourceId; tick: ExportTick }[] = []
  const skipped: ExportMultiSkip[] = []

  let listed = 0
  const listingTotal = targets.length * sourceIds.length
  for (const target of targets) {
    for (const sourceId of sourceIds) {
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError")
      onProgress?.({ phase: "listing", completed: listed, total: listingTotal, label: `${target.label} — ${sourceId}` })
      try {
        const ticks = await listExportTicks(sourceId, target.centerLat, target.centerLng, LISTING_ZOOM, startMs, endMs, planetKey)
        if (!ticks.length) skipped.push({ feature: target.label, source: sourceId, reason: "No capture found in the selected date range" })
        for (const tick of ticks) plan.push({ target, source: sourceId, tick })
      } catch (err) {
        skipped.push({ feature: target.label, source: sourceId, reason: err instanceof Error ? err.message : "Failed to list dates" })
      }
      listed++
    }
  }

  // Phase 2: fetch + write one GeoTIFF per plan entry.
  const entries: Record<string, Uint8Array | string> = {}
  const usedNames = new Set<string>()
  let done = 0
  for (const item of plan) {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError")
    onProgress?.({ phase: "exporting", completed: done, total: plan.length, label: `${item.target.label} — ${item.source} — ${item.tick.label}` })
    try {
      const zoom = Math.min(
        pickZoomForResolution(item.target.paddedBbox, targetResolution, targetResolution, item.tick.tileSpec.tileSize),
        item.tick.tileSpec.maxzoom,
      )
      const mosaic = await fetchRgbTileMosaic({
        tileUrlTemplate: item.tick.tileSpec.tileUrlTemplate,
        buildTileUrl: item.tick.tileSpec.buildTileUrl,
        tileSize: item.tick.tileSpec.tileSize,
        bbox: item.target.paddedBbox,
        zoom,
        signal,
      })
      const tiffBlob = await buildRgbGeoTiff(mosaic.r, mosaic.g, mosaic.b, mosaic.width, mosaic.height, {
        west: mosaic.bbox[0], south: mosaic.bbox[1], east: mosaic.bbox[2], north: mosaic.bbox[3],
      })
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError")

      let name = `${item.target.label}_${item.target.extentDescriptor}_${item.source}_${item.tick.label}`
      if (usedNames.has(name)) {
        let n = 2
        while (usedNames.has(`${name}-${n}`)) n++
        name = `${name}-${n}`
      }
      usedNames.add(name)
      entries[`${name}.tif`] = new Uint8Array(await tiffBlob.arrayBuffer())
    } catch (err) {
      if (isAbortError(err)) throw err
      skipped.push({ feature: item.target.label, source: item.source, reason: err instanceof Error ? err.message : "Export failed" })
    }
    done++
  }

  // Phase 3 (optional): one gdal_translate .bat per target, aggregating a
  // command per plan entry that has a real fetchable tile URL — see
  // lib/gdal-export.ts for exactly which sources qualify.
  if (includeGdalScript) {
    const byTarget = new Map<string, typeof plan>()
    for (const item of plan) {
      if (!byTarget.has(item.target.label)) byTarget.set(item.target.label, [])
      byTarget.get(item.target.label)!.push(item)
    }
    for (const [label, items] of byTarget.entries()) {
      const lines: string[] = [
        "REM gdal_translate commands — re-fetch these exact tiles outside the browser, at full native resolution.",
        `REM ${label}`,
        "",
      ]
      let currentSource: ExportSourceId | null = null
      for (const item of items) {
        if (item.source !== currentSource) {
          currentSource = item.source
          lines.push(`REM === ${item.source} ===`)
        }
        const template = item.tick.tileSpec.tileUrlTemplate
        const quadkeyTemplate = item.tick.tileSpec.quadkeyUrlTemplate
        if (hasGdalTemplate(template) || hasGdalQuadkeyTemplate(quadkeyTemplate)) {
          const filename = `${label}_${item.target.extentDescriptor}_${item.source}_${item.tick.label}_gdal`
          lines.push(buildGdalTranslateCommand({ tileUrlTemplate: template, quadkeyUrlTemplate: quadkeyTemplate, bbox: item.target.paddedBbox, filename, outsizeWidth: targetResolution }))
        } else {
          lines.push(buildGdalSkipComment(
            `${item.source} ${item.tick.label}`,
            item.source === "ge-historical"
              ? "Google Earth Historical has no public tile URL — this app resolves it internally, gdal_translate can't"
              : "no direct tile URL available",
          ))
        }
      }
      entries[`${label}_gdal_commands.bat`] = lines.join("\n")
    }
  }

  const zipInput: Record<string, Uint8Array> = {}
  for (const [name, value] of Object.entries(entries)) {
    zipInput[name] = typeof value === "string" ? new TextEncoder().encode(value) : value
  }
  const bytes = zipSync(zipInput, { level: 0 })
  return { zipBlob: new Blob([bytes as BlobPart], { type: "application/zip" }), fileCount: Object.keys(entries).filter((n) => n.endsWith(".tif")).length, skipped }
}

export { EXPORT_SOURCE_IDS }
export type { ExportSourceId }
