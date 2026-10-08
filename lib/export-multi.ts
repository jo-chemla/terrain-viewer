// Batch historical-imagery export: for every export target (either the
// current map viewport as one bbox, or every drawn feature) × every
// selected historical source × every real capture date within a picked
// range, crop that source/date to the target's own (padded) extent and
// write one RGB GeoTIFF, bundled into a single .zip — see
// components/TerrainControlPanel/export-multi-dialog.tsx for the UI.
//
// Pixels come from the source's own tile pyramid (lib/rgb-tile-mosaic.ts),
// never from the map canvas: the zoom is the smallest one whose pixel grid
// reaches the requested resolution over the target's extent, the tiles are
// cropped to that extent and resampled to the requested size, and a polygon
// feature masks the pixels outside its ring through an alpha band.
import { zipSync } from "fflate"
import type { GeoJSONFeature, DrawLayer } from "@/components/TerrainControlPanel/TerraDrawSystem"
import type { Geometry, Position } from "geojson"
import { EXPORT_SOURCE_IDS, EXPORT_SOURCE_FILE_STEMS, EXPORT_SOURCE_LABELS, listExportTicks, type ExportSourceId, type ExportSourceKeys, type ExportTick } from "./historical-export-sources"
import { computeFeaturePaddedExtent, type Bbox4 } from "./feature-extent"
import { fetchRgbTileMosaic, mosaicPixelWindow } from "./rgb-tile-mosaic"
import { buildRgbGeoTiff } from "./rgb-geotiff"
import { lonLatToTileXY, tileXYToLonLat } from "./tile-mosaic"
import { hasGdalTemplate, hasGdalQuadkeyTemplate, buildGdalTranslateCommand, buildGdalSkipComment } from "./gdal-export"
import bbox from "@turf/bbox"

// Real per-location "which releases actually differ here" queries (Wayback,
// GE Historical) need SOME zoom to query at — this doesn't have to match the
// eventual export zoom (computed per-tick below from the resolution), just
// be representative enough that "does this release/date have distinct
// imagery at this spot" resolves sensibly. 16 sits comfortably inside every
// source's own pyramid (Wayback caps at 19, GE at 23, HLS at 16, EOX at 14).
/** Fallback zoom at which capture dates are listed per target when the
 *  caller does not pass the map's own zoom (see ExportMultiOptions.listingZoom). */
export const LISTING_ZOOM = 16
/** Older Wayback releases have no metadata above this; asking higher just
 *  returns nothing and falls back to the release date. */
export const LISTING_ZOOM_CAP = 18
/** Longest edge a written GeoTIFF may have; a larger request is scaled down
 *  to this and the export reports a warning. 8192 keeps the compositing
 *  canvas inside every browser's limit and a file under ~200 MB. */
export const MAX_EXPORT_PIXELS_PER_SIDE = 8192
/** Highest zoom the mosaic will ever be fetched at, whatever a source declares. */
const MAX_FETCH_ZOOM = 22

const METERS_PER_DEGREE_LAT = 111_320

/** How the output pixel size of each target is chosen. */
export type ExportResolutionSpec =
  /** Longest edge of the output in pixels (the other edge follows the
   *  extent's aspect). This is what `targetResolution` means. */
  | { kind: "pixels"; longestEdge: number }
  /** Ground sample distance at the target's centre latitude. */
  | { kind: "metersPerPixel"; metersPerPixel: number }
  /** Native pixels of one tile zoom level (capped by the source's pyramid). */
  | { kind: "zoom"; zoom: number }

/** Pixel size of a bbox at a zoom in the Web Mercator tile grid (fractional). */
function mercatorSpanPx(box: Bbox4, zoom: number, tileSize: number): [number, number] {
  const [west, south, east, north] = box
  const [x0, y0] = lonLatToTileXY(west, north, zoom)
  const [x1, y1] = lonLatToTileXY(east, south, zoom)
  return [Math.abs(x1 - x0) * tileSize, Math.abs(y1 - y0) * tileSize]
}

/** Ground size of a bbox in metres at its centre latitude. */
function groundSpanMeters(box: Bbox4): [number, number] {
  const [west, south, east, north] = box
  const centreLat = ((south + north) / 2) * (Math.PI / 180)
  return [(east - west) * METERS_PER_DEGREE_LAT * Math.cos(centreLat), (north - south) * METERS_PER_DEGREE_LAT]
}

/** Output size a resolution asks for over a bbox; null for "zoom" (native). */
export function wantedPixelsFor(box: Bbox4, spec: ExportResolutionSpec): [number, number] | null {
  if (spec.kind === "zoom") return null
  if (spec.kind === "metersPerPixel") {
    const [wM, hM] = groundSpanMeters(box)
    const gsd = Math.max(1e-6, spec.metersPerPixel)
    return [Math.max(1, Math.round(wM / gsd)), Math.max(1, Math.round(hM / gsd))]
  }
  // The aspect is the Mercator one so the pixels stay square on the map.
  const [w, h] = mercatorSpanPx(box, 0, 256)
  const longest = Math.max(1, Math.round(spec.longestEdge))
  return w >= h
    ? [longest, Math.max(1, Math.round((longest * h) / w))]
    : [Math.max(1, Math.round((longest * w) / h)), longest]
}

/** Smallest zoom (up to maxZoom) whose pixel grid covers the bbox with at
 *  least the wanted pixels on both axes - a coarser zoom would have to be
 *  upsampled. For "zoom" specs, the zoom itself, capped. */
export function pickExportZoom(box: Bbox4, spec: ExportResolutionSpec, tileSize: number, maxZoom: number): number {
  if (spec.kind === "zoom") return Math.min(maxZoom, Math.max(0, Math.round(spec.zoom)))
  const wanted = wantedPixelsFor(box, spec)!
  for (let z = 0; z <= maxZoom; z++) {
    const [w, h] = mercatorSpanPx(box, z, tileSize)
    if (w >= wanted[0] && h >= wanted[1]) return z
  }
  return maxZoom
}

/** The zoom a target's tiles will be fetched at for a given resolution,
 *  which is also the zoom its dates should be listed at (see listingZoom).
 *  `targetResolution` is the longest edge in pixels unless `resolution`
 *  says otherwise. */
export function fetchZoomFor(box: Bbox4, targetResolution: number, resolution?: ExportResolutionSpec): number {
  const spec = resolution ?? { kind: "pixels", longestEdge: targetResolution }
  return Math.min(LISTING_ZOOM_CAP, Math.max(1, pickExportZoom(box, spec, 256, MAX_FETCH_ZOOM)))
}

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
  /** Longest edge of each output in pixels (same convention as
   *  maxResolutionAtom); ignored when `resolution` is given. */
  targetResolution: number
  /** Metres per pixel or a fixed tile zoom instead of a pixel count. */
  resolution?: ExportResolutionSpec
  /** Longest edge above which an output is scaled down (with a warning).
   *  Default MAX_EXPORT_PIXELS_PER_SIDE. */
  maxPixelsPerSide?: number
  /** Feature mode, Polygon / MultiPolygon features: write an alpha band that
   *  masks the pixels outside the ring (the file is still the padded bbox).
   *  Default true. */
  maskToFeature?: boolean
  planetKey?: string
  /** Mapbox / HERE keys for their "current" basemap exports. */
  keys?: ExportSourceKeys
  /** Zoom used to list capture dates, and it matters: Wayback's release
   *  set and capture dates genuinely differ between zoom levels.
   *
   *  - "fetch" (default): each target lists at the zoom its tiles will be
   *    fetched at (from the resolution, capped by LISTING_ZOOM_CAP), so
   *    the dates describe the pixels that end up in the file. Re-queries
   *    Esri / Google when that zoom differs from the map's.
   *  - a number (the map's zoom): reuse what the historical timeline has
   *    already resolved at that zoom - every listing cache in lib/wayback.ts
   *    and lib/ge-historical.ts is keyed on (location to 3 decimals, rounded
   *    zoom) - so listing is instant and matches the ticks on screen, at
   *    the cost of possibly describing a coarser mosaic level than the one
   *    exported. */
  listingZoom?: number | "fetch"
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

/** One written GeoTIFF, as listed in the zip's manifest.json / README.txt. */
export interface ExportMultiManifestEntry {
  /** Path inside the zip, e.g. "esri-wayback/viewport_esri-wayback_2019-04-03.tif". */
  path: string
  target: string
  source: ExportSourceId
  sourceLabel: string
  /** yyyy-mm-dd, or "latest" for a current basemap without a known date. */
  date: string
  /** [west, south, east, north] of the written pixels (EPSG:4326). */
  bbox: Bbox4
  width: number
  height: number
  /** Ground sample distance at the centre latitude, metres per pixel. */
  metersPerPixel: number
  /** Tile zoom the pixels were fetched at. */
  zoom: number
  /** Whether a fourth (alpha) band masks the pixels outside the feature. */
  masked: boolean
}

export interface ExportMultiResult {
  zipBlob: Blob
  fileCount: number
  skipped: ExportMultiSkip[]
  /** Non-fatal notes: outputs scaled down to the pixel cap, or coarser than
   *  asked because the source's pyramid stops short. */
  warnings: string[]
  manifest: ExportMultiManifestEntry[]
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
  /** The polygon rings to mask to, when the target is a polygon feature. */
  maskRings?: Position[][]
}

function polygonRings(geometry: Geometry): Position[][] | undefined {
  if (geometry.type === "Polygon") return geometry.coordinates
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat()
  return undefined
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
    return { label, paddedBbox, extentDescriptor: descriptor, centerLat: (south + north) / 2, centerLng: (west + east) / 2, maskRings: polygonRings(feature.geometry) }
  })
}

/** Alpha band (255 inside, 0 outside) for the rings over an output raster
 *  whose pixel (col, row) covers the zoom's global pixel grid from
 *  `originPx` scaled by native/output. Even-odd scanline fill: every ring
 *  (outer or hole) toggles, so holes come out transparent. Each output row
 *  sits at one latitude (Mercator rows are horizontal), so the crossings
 *  are solved once per row in lon/lat and converted to columns. */
function rasterizeRingsMask(
  rings: Position[][], width: number, height: number,
  originPx: [number, number], nativeWidth: number, nativeHeight: number, zoom: number, tileSize: number,
): Uint8Array {
  const alpha = new Uint8Array(width * height)
  const sx = nativeWidth / width
  const sy = nativeHeight / height
  const n = 2 ** zoom
  const lonToCol = (lon: number) => (((lon + 180) / 360) * n * tileSize - originPx[0]) / sx
  const crossings: number[] = []
  for (let row = 0; row < height; row++) {
    const [, lat] = tileXYToLonLat(0, (originPx[1] + (row + 0.5) * sy) / tileSize, zoom)
    crossings.length = 0
    for (const ring of rings) {
      for (let i = 0, m = ring.length; i < m; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % m]
        if ((y1 > lat) === (y2 > lat)) continue
        crossings.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1))
      }
    }
    if (crossings.length < 2) continue
    crossings.sort((a, b) => a - b)
    const rowOffset = row * width
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const c0 = Math.max(0, Math.round(lonToCol(crossings[i])))
      const c1 = Math.min(width, Math.round(lonToCol(crossings[i + 1])))
      if (c1 > c0) alpha.fill(255, rowOffset + c0, rowOffset + c1)
    }
  }
  return alpha
}

function formatGsd(m: number): string {
  return m >= 10 ? `${m.toFixed(1)} m` : m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(1)} cm`
}

export async function exportMultiHistorical(opts: ExportMultiOptions): Promise<ExportMultiResult> {
  const { sourceIds, startMs, endMs, targetResolution, planetKey, keys, includeGdalScript, onProgress, signal } = opts
  const resolution: ExportResolutionSpec = opts.resolution ?? { kind: "pixels", longestEdge: targetResolution }
  const maxPixelsPerSide = Math.max(1, opts.maxPixelsPerSide ?? MAX_EXPORT_PIXELS_PER_SIDE)
  const maskToFeature = opts.maskToFeature ?? true
  const listingZoomFor = (target: ExportTarget) =>
    opts.listingZoom === undefined || opts.listingZoom === "fetch"
      ? fetchZoomFor(target.paddedBbox, targetResolution, resolution)
      : Math.round(opts.listingZoom)

  const targets = buildTargets(opts)
  const warnings: string[] = []
  const manifest: ExportMultiManifestEntry[] = []

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
        const ticks = await listExportTicks(sourceId, target.centerLat, target.centerLng, listingZoomFor(target), startMs, endMs, planetKey, keys)
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
    const fileLabel = `${item.target.label} / ${EXPORT_SOURCE_LABELS[item.source]} ${item.tick.label}`
    try {
      const { tileSize, maxzoom } = item.tick.tileSpec
      const sourceMaxZoom = Math.min(maxzoom, MAX_FETCH_ZOOM)
      const idealZoom = pickExportZoom(item.target.paddedBbox, resolution, tileSize, MAX_FETCH_ZOOM)
      const wantedZoom = Math.min(idealZoom, sourceMaxZoom)
      const wanted = wantedPixelsFor(item.target.paddedBbox, resolution)

      // Output size for a given fetch zoom: the wanted pixels, never more
      // than the zoom's native grid (no upsampling), never more than the cap.
      const outputSizeAt = (zoom: number): { width: number; height: number; capped: boolean; coarser: boolean } => {
        const [x0, y0, x1, y1] = mosaicPixelWindow(item.target.paddedBbox, zoom, tileSize, true)
        const nativeW = x1 - x0
        const nativeH = y1 - y0
        let width = nativeW
        let height = nativeH
        let coarser = false
        if (wanted) {
          if (nativeW >= wanted[0] && nativeH >= wanted[1]) {
            width = wanted[0]
            height = wanted[1]
          } else {
            // The zoom is below what the resolution asks for (source
            // pyramid cap, or a step-down below): keep the native grid.
            coarser = true
          }
        }
        const longest = Math.max(width, height)
        const capped = longest > maxPixelsPerSide
        if (capped) {
          const k = maxPixelsPerSide / longest
          width = Math.max(1, Math.round(width * k))
          height = Math.max(1, Math.round(height * k))
        }
        return { width, height, capped, coarser }
      }

      // A source's declared maxzoom is a ceiling, not a promise: an older
      // Wayback release often stops at z17 where the current one reaches
      // z19, and Google Earth's older dates thin out at high zoom the same
      // way, so the first request 404s on a tile and the whole capture used
      // to be skipped. Step down a few zooms before giving up — a coarser
      // file beats no file, and the reason records what was tried.
      const MAX_STEP_DOWN = 3
      let mosaic: Awaited<ReturnType<typeof fetchRgbTileMosaic>> | null = null
      let size: ReturnType<typeof outputSizeAt> | null = null
      let lastError: unknown = null
      for (let zoom = wantedZoom; zoom >= Math.max(1, wantedZoom - MAX_STEP_DOWN); zoom--) {
        const candidate = outputSizeAt(zoom)
        try {
          mosaic = await fetchRgbTileMosaic({
            tileUrlTemplate: item.tick.tileSpec.tileUrlTemplate,
            buildTileUrl: item.tick.tileSpec.buildTileUrl,
            fetchTileBlob: item.tick.tileSpec.fetchTileBlob,
            tileSize,
            bbox: item.target.paddedBbox,
            zoom,
            crop: true,
            outputWidth: candidate.width,
            outputHeight: candidate.height,
            signal,
          })
          size = candidate
          break
        } catch (err) {
          if (isAbortError(err)) throw err
          lastError = err
        }
      }
      if (!mosaic || !size) {
        throw new Error(`No tiles at z${wantedZoom}–z${Math.max(1, wantedZoom - MAX_STEP_DOWN)}: ${lastError instanceof Error ? lastError.message : "fetch failed"}`)
      }
      if (size.capped) warnings.push(`${fileLabel}: scaled down to ${mosaic.width}×${mosaic.height} px (cap ${maxPixelsPerSide} px a side).`)
      if (size.coarser) warnings.push(`${fileLabel}: ${mosaic.width}×${mosaic.height} px at z${mosaic.zoom}, coarser than asked (the source has no finer tiles here).`)

      const alpha = maskToFeature && item.target.maskRings
        ? rasterizeRingsMask(item.target.maskRings, mosaic.width, mosaic.height, mosaic.originPx, mosaic.nativeWidth, mosaic.nativeHeight, mosaic.zoom, tileSize)
        : undefined
      const tiffBlob = await buildRgbGeoTiff(mosaic.r, mosaic.g, mosaic.b, mosaic.width, mosaic.height, {
        west: mosaic.bbox[0], south: mosaic.bbox[1], east: mosaic.bbox[2], north: mosaic.bbox[3],
      }, alpha)
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError")

      // The viewport target's label and extent descriptor are both
      // "viewport"; don't repeat it (viewport_viewport_bing_...).
      const stem = item.target.extentDescriptor === item.target.label ? item.target.label : `${item.target.label}_${item.target.extentDescriptor}`
      const folder = EXPORT_SOURCE_FILE_STEMS[item.source]
      let name = `${folder}/${stem}_${folder}_${item.tick.label}`
      if (usedNames.has(name)) {
        let n = 2
        while (usedNames.has(`${name}-${n}`)) n++
        name = `${name}-${n}`
      }
      usedNames.add(name)
      const path = `${name}.tif`
      entries[path] = new Uint8Array(await tiffBlob.arrayBuffer())
      const [gW] = groundSpanMeters(mosaic.bbox)
      manifest.push({
        path, target: item.target.label, source: item.source, sourceLabel: EXPORT_SOURCE_LABELS[item.source], date: item.tick.label,
        bbox: mosaic.bbox, width: mosaic.width, height: mosaic.height, metersPerPixel: gW / mosaic.width, zoom: mosaic.zoom, masked: !!alpha,
      })
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
    const wantedFor = new Map<ExportTarget, [number, number] | null>()
    const wantedOf = (target: ExportTarget) => {
      if (!wantedFor.has(target)) wantedFor.set(target, wantedPixelsFor(target.paddedBbox, resolution))
      return wantedFor.get(target)!
    }
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
          const filename = `${item.target.extentDescriptor === label ? label : `${label}_${item.target.extentDescriptor}`}_${EXPORT_SOURCE_FILE_STEMS[item.source]}_${item.tick.label}_gdal`
          // Same width the browser export aims for: the wanted pixels, or
          // the native width at the zoom a "zoom" resolution names.
          const zoomWindow = mosaicPixelWindow(item.target.paddedBbox, pickExportZoom(item.target.paddedBbox, resolution, 256, MAX_FETCH_ZOOM), 256, true)
          const outsizeWidth = Math.min(maxPixelsPerSide, wantedOf(item.target)?.[0] ?? zoomWindow[2] - zoomWindow[0])
          lines.push(buildGdalTranslateCommand({ tileUrlTemplate: template, quadkeyUrlTemplate: quadkeyTemplate, bbox: item.target.paddedBbox, filename, outsizeWidth }))
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

  // Root manifest: the same list twice, for scripts and for people.
  const resolutionText = resolution.kind === "pixels" ? `${resolution.longestEdge} px longest edge`
    : resolution.kind === "metersPerPixel" ? `${resolution.metersPerPixel} m/px` : `tile zoom ${resolution.zoom}`
  if (manifest.length) {
    entries["manifest.json"] = JSON.stringify({
      generator: "Terrain Viewer historical export",
      generatedAt: new Date().toISOString(),
      crs: "EPSG:4326",
      resolution,
      dateRange: { start: new Date(startMs).toISOString().slice(0, 10), end: new Date(endMs).toISOString().slice(0, 10) },
      files: manifest,
      skipped,
      warnings,
    }, null, 2)
    const readme: string[] = [
      "Terrain Viewer historical imagery export",
      `Generated ${new Date().toISOString()} - ${manifest.length} GeoTIFF${manifest.length === 1 ? "" : "s"}, one folder per source, EPSG:4326, requested resolution ${resolutionText}.`,
      "Columns: file | source | date | bbox [west, south, east, north] | size (px) | GSD at centre latitude | tile zoom | alpha mask",
      "",
    ]
    for (const f of manifest) {
      readme.push(`${f.path} | ${f.sourceLabel} | ${f.date} | [${f.bbox.map((v) => v.toFixed(6)).join(", ")}] | ${f.width}x${f.height} | ${formatGsd(f.metersPerPixel)}/px | z${f.zoom} | ${f.masked ? "yes" : "no"}`)
    }
    if (warnings.length) readme.push("", "Warnings:", ...warnings.map((w) => `- ${w}`))
    if (skipped.length) readme.push("", "Skipped:", ...skipped.map((s) => `- ${s.feature} / ${EXPORT_SOURCE_LABELS[s.source]}: ${s.reason}`))
    entries["README.txt"] = readme.join("\n") + "\n"
  }

  const zipInput: Record<string, Uint8Array> = {}
  for (const [name, value] of Object.entries(entries)) {
    zipInput[name] = typeof value === "string" ? new TextEncoder().encode(value) : value
  }
  const bytes = zipSync(zipInput, { level: 0 })
  return { zipBlob: new Blob([bytes as BlobPart], { type: "application/zip" }), fileCount: manifest.length, skipped, warnings, manifest }
}

export { EXPORT_SOURCE_IDS }
export type { ExportSourceId }
