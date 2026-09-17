import { useCallback } from "react"
import { useAtom } from "jotai"
import { useQueryState, parseAsStringLiteral } from "nuqs"
import { terrainSources } from "@/lib/terrain-sources"
import { buildRasterTileSource } from "@/lib/source-builder"
import {
  mapboxKeyAtom, googleKeyAtom, maptilerKeyAtom, titilerEndpointAtom,
  customTerrainSourcesAtom, customBasemapSourcesAtom
} from "@/lib/settings-atoms"
import type { TerrainSource } from "@/lib/terrain-types"
import type { CustomTerrainSource, CustomBasemapSource } from "@/lib/settings-atoms"

export interface SourceConfig {
  encoding: string
  tileUrl: string
  tileSize: number
  /** True when this source type can't produce a {z}/{x}/{y} tile pyramid for
   *  buildGdalWmsXml to wrap (wms-raw's float32 GetMap URL, tilejson's manifest
   *  link) — titiler DTM export isn't possible for it. */
  unsupported?: boolean
}

export type Bounds = { west: number; east: number; north: number; south: number }

/** Whether "fit to bounds" should actually move the camera: only when the target
 *  bounds are fully inside the current viewport (zooming in on something already
 *  visible), or fully disjoint from it (nothing in common, worth flying there) —
 *  never when the target only partially overlaps the viewport, or fully contains
 *  it (e.g. a world-covering basemap), since either would yank the user's context
 *  away from where they're already looking. */
export function shouldZoomToBounds(viewport: Bounds, target: Bounds): boolean {
  const fullyWithin =
    target.west >= viewport.west && target.east <= viewport.east &&
    target.south >= viewport.south && target.north <= viewport.north
  const disjoint =
    target.east < viewport.west || target.west > viewport.east ||
    target.north < viewport.south || target.south > viewport.north
  return fullyWithin || disjoint
}

/**
 * Terrain variant of the rule above, reduced to a single invariant:
 *
 *   fit only when the viewport is NOT already fully inside the target bounds.
 *
 * A terrain source either declares a footprint or it doesn't. A worldwide one
 * (Mapterhorn, AWS) declares none, so selecting it never reaches here and never
 * moves the camera. A bounded one moves you only when you are not already
 * looking somewhere it covers. Every case then falls out:
 *
 *   Mapterhorn -> Spain            world view isn't inside Spain -> fly to Spain
 *   Spain -> Mapterhorn            no bounds                     -> stay put
 *   Madrid -> Mapterhorn -> Spain  Madrid IS inside Spain        -> stay on Madrid
 *   Netherlands -> Mexico          not inside Mexico             -> fly to Mexico
 *   Europe-wide -> Spain           viewport contains Spain, so is
 *                                  not inside it                 -> fly to Spain
 *
 * The last line is the deliberate difference from shouldZoomToBounds, which
 * moves when the target is fully inside the viewport but does NOTHING when the
 * two merely overlap. For terrain, partial overlap is the common case — picking
 * a country while looking at its neighbour — and staying put there is what made
 * switching sources feel broken.
 *
 * EPSILON absorbs float noise from a round-trip through the map's getBounds(),
 * so re-selecting the source you already have doesn't re-fly.
 */
export function shouldZoomToTerrainBounds(viewport: Bounds, target: Bounds): boolean {
  const EPSILON = 1e-6
  const viewportInsideTarget =
    viewport.west >= target.west - EPSILON && viewport.east <= target.east + EPSILON &&
    viewport.south >= target.south - EPSILON && viewport.north <= target.north + EPSILON
  return !viewportInsideTarget
}

export const useTheme = () => {
  const [theme, setTheme] = useQueryState(
    "theme",
    parseAsStringLiteral(["light", "dark"] as const).withDefault("light"),
  )
  const toggleTheme = useCallback(() => setTheme(theme === "light" ? "dark" : "light"), [theme, setTheme])
  return { theme, toggleTheme, setTheme }
}

export const useSourceConfig = () => {
  const [mapboxKey] = useAtom(mapboxKeyAtom)
  const [maptilerKey] = useAtom(maptilerKeyAtom)
  const [googleKey] = useAtom(googleKeyAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)

  // Widened from TerrainSource to string: callers (TerrainSourceSection et al.)
  // pass arbitrary custom-source ids through here too, and the lookup below is
  // already defensive against a key that isn't a real builtin (`if (!source)
  // return ""`) — the narrower annotation didn't reflect that.
  const getTilesUrl = useCallback((key: string): string => {
    const source = (terrainSources as any)[key]
    if (!source) return ""
    let tileUrl = source.sourceConfig.tiles[0] || ""
    if (key === "mapbox") tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
    else if (key === "maptiler") tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")
    else if (key === "google3dtiles") tileUrl = tileUrl.replace("{API_KEY}", googleKey || "")
    return tileUrl
  }, [mapboxKey, maptilerKey, googleKey])

  // Titiler DTM export always needs a real {z}/{x}/{y} tile template to wrap in a
  // GDAL WMS descriptor — never the cog:// pseudo-protocol MapLibre uses for live
  // rendering — so useCogProtocol is hardcoded false here regardless of the user's
  // live-map rendering preference (useCogProtocolVsTitilerAtom).
  const getCustomSourceUrl = useCallback((source: CustomTerrainSource): string => {
    const built = buildRasterTileSource({
      url: source.url,
      // 'stac'/'mosaicjson' aren't real RasterSourceType members (they're not even
      // selectable in custom-terrain-source-modal.tsx) and callers already route
      // those, along with wms-raw/tilejson, away from this function — see the
      // `unsupported` branch in getSourceConfig below.
      type: source.type as Parameters<typeof buildRasterTileSource>[0]["type"],
      useCogProtocol: false,
      titilerEndpoint,
      isDem: true,
    })
    return "tiles" in built ? built.tiles[0] : built.url
  }, [titilerEndpoint])

  const getCustomBasemapUrl = useCallback((source: CustomBasemapSource): string => {
    if (source.type === "cog") {
      return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(source.url)}`
    }
    return source.url
  }, [titilerEndpoint])

  const getBasemapSourceConfig = useCallback((sourceKey: string): SourceConfig | null => {
    const customSource = customBasemapSources.find((s) => s.id === sourceKey)
    if (customSource) {
      const tileUrl = getCustomBasemapUrl(customSource)
      return {
        encoding: customSource.type === "cog" ? "cog" : "tms",
        tileUrl,
        tileSize: 256
      }
    }
    return null
  }, [customBasemapSources, getCustomBasemapUrl])

  const getSourceConfig = useCallback((sourceKey: string): SourceConfig | null => {
    if ((terrainSources as any)[sourceKey]) {
      const source = (terrainSources as any)[sourceKey]
      return { encoding: source.encoding, tileUrl: getTilesUrl(sourceKey as TerrainSource), tileSize: source.sourceConfig.tileSize || 256 }
    }
    const customSource = customTerrainSources.find((s) => s.id === sourceKey)
    if (!customSource) return null

    if (customSource.type === "wms-raw" || customSource.type === "tilejson" || customSource.type === "stac" || customSource.type === "mosaicjson") {
      // wms-raw's float32 GetMap URL and tilejson's manifest link are not
      // {z}/{x}/{y} tile pyramids buildGdalWmsXml can wrap; stac/mosaicjson need
      // server-side GDAL mosaicking this app doesn't build a URL for at all.
      return { encoding: "terrainrgb", tileUrl: "", tileSize: 256, unsupported: true }
    }
    // cog/vrt always come back from titiler already re-encoded as terrainrgb
    // (source-builder's isDem branch hardcodes algorithm=terrainrgb); terrainrgb/
    // terrarium/stac/mosaicjson custom sources are used as-is, in their own encoding.
    const encoding = customSource.type === "cog" || customSource.type === "vrt" ? "terrainrgb" : customSource.type
    const tileUrl = getCustomSourceUrl(customSource)
    return { encoding, tileUrl, tileSize: 256 }
  }, [customTerrainSources, getTilesUrl, getCustomSourceUrl])

  return { getTilesUrl, getSourceConfig, getCustomSourceUrl, getCustomBasemapUrl, getBasemapSourceConfig }
}

export const getGradientColors = (colors: any[]): string => {
  const colorValues: string[] = []
  for (let i = 4; i < colors.length; i += 2) {
    if (i < colors.length) colorValues.push(colors[i])
  }
  if (colorValues.length < 2) colorValues.push(colorValues[0] || "#000000")
  return colorValues.join(", ")
}

export const templateLink = (link: string, lat: string, lng: string): string => link.replace("{LAT}", lat).replace("{LNG}", lng)

export const copyToClipboard = (text: string) => navigator.clipboard.writeText(text)

import { domToBlob, domToCanvas } from "modern-screenshot"
import type { MapRef } from "react-map-gl/maplibre"
import { getDefaultStore } from "jotai"
import { snapshotIncludeTimelineAtom } from "./settings-atoms"

export type ImageFormat = "png" | "jpeg"

/** The element holding every map pane (TerrainViewer's split container),
 *  found from view A's map. Null outside the app's own layout. */
export function getSnapshotRoot(mapRef: React.RefObject<MapRef | null>): HTMLElement | null {
  return mapRef.current?.getMap().getContainer().closest<HTMLElement>("[data-snapshot-root]") ?? null
}

/** Width of the strip the open side panel covers on the right of the map
 *  area, measured from the panel itself (#tour-sidepanel). The maps run
 *  underneath it and their camera padding centres the view in what is left
 *  (see mapPaddingFor / getSidebarFootprintPx), so that strip is blank space
 *  as far as a picture is concerned and the subject would sit off-centre with
 *  it kept. Zero on mobile, where the panel covers nearly everything and no
 *  padding is applied for it either. */
function sidePanelCropPx(rootRect: DOMRect): number {
  if (!window.matchMedia("(min-width: 640px)").matches) return 0
  const panel = document.getElementById("tour-sidepanel")
  if (!panel) return 0
  const r = panel.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return 0
  const crop = rootRect.right - r.left
  // Never crop more than half: a panel that wide is not a margin any more.
  return crop > 0 && crop < rootRect.width / 2 ? crop : 0
}

export const SNAPSHOT_TIMELINE_ID = "tour-historical-timeline"

/** The historical timeline panel, when it is on screen. */
function visibleTimeline(): HTMLElement | null {
  const el = document.getElementById(SNAPSHOT_TIMELINE_ID)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width >= 1 && r.height >= 1 ? el : null
}

/** Same reasoning as sidePanelCropPx, bottom edge: the timeline docks over
 *  the last row and the camera padding clears it, so without the timeline in
 *  the picture that strip is blank space. */
function timelineCropPx(rootRect: DOMRect): number {
  const el = visibleTimeline()
  if (!el) return 0
  const crop = rootRect.bottom - el.getBoundingClientRect().top
  return crop > 0 && crop < rootRect.height / 2 ? crop : 0
}

/** True when view A's canvas fills the whole snapshot, i.e. a single view or
 *  the overlay split (both panes share one extent): only then does a world
 *  file computed from view A's bounds describe the saved image. */
export function snapshotMatchesViewA(mapRef: React.RefObject<MapRef | null>): boolean {
  const root = getSnapshotRoot(mapRef)
  const canvas = mapRef.current?.getMap().getCanvas()
  if (!root || !canvas) return true
  const r = root.getBoundingClientRect(), c = canvas.getBoundingClientRect()
  // The right-hand crop (sidePanelCropPx) does not matter here: a world file
  // is the top-left origin plus a pixel size, both unchanged by it.
  return Math.abs(r.width - c.width) < 2 && Math.abs(r.height - c.height) < 2
}

const isHidden = (el: Element, stopAt: Element) => {
  for (let n: Element | null = el; n && n !== stopAt; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (cs.display === "none" || cs.visibility === "hidden") return true
  }
  return false
}

/**
 * Every visible map view composited the way the screen shows them: each
 * pane's canvases drawn at their on-screen rectangle, with the pane's own
 * clip-path / mix-blend-mode / opacity (the overlay split's wipe and blend)
 * and any CSS filter on the canvas itself (the "match colors" LUT). The DOM
 * chrome inside the split container (date pills, coloured borders, pane
 * dividers, maplibre controls, markers) is rendered on top by
 * modern-screenshot; the sidebar and timeline live outside that container
 * and are never part of it. The map canvases are drawn by hand rather than
 * left to modern-screenshot because it cannot reproduce blend modes between
 * cloned canvases, and re-encodes each one as a data URL.
 */
async function compositeViews(root: HTMLElement, withChrome: boolean, includeTimeline: boolean): Promise<HTMLCanvasElement> {
  const dpr = window.devicePixelRatio || 1
  const rootRect = root.getBoundingClientRect()
  const out = document.createElement("canvas")
  // Everything below is drawn at its on-screen position; a narrower output
  // simply cuts the side panel's strip off the right.
  const outWidthCss = rootRect.width - sidePanelCropPx(rootRect)
  out.width = Math.max(1, Math.round(outWidthCss * dpr))
  const outHeightCss = rootRect.height - (includeTimeline ? 0 : timelineCropPx(rootRect))
  out.height = Math.max(1, Math.round(outHeightCss * dpr))
  const ctx = out.getContext("2d")!
  // JPEG has no alpha, and unloaded tiles are transparent: paint the page
  // background first so they do not come out black.
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#ffffff"
  ctx.fillRect(0, 0, out.width, out.height)

  for (const pane of Array.from(root.children) as HTMLElement[]) {
    const canvases = Array.from(pane.querySelectorAll("canvas")).filter((c) => !isHidden(c, root))
    if (!canvases.length) continue
    const paneRect = pane.getBoundingClientRect()
    if (paneRect.width < 1 || paneRect.height < 1) continue
    const paneStyle = getComputedStyle(pane)
    if (paneStyle.display === "none" || paneStyle.visibility === "hidden") continue

    ctx.save()
    // clip-path: polygon(x% y%, ...) in the pane's own box.
    const poly = /^polygon\((.+)\)$/.exec(paneStyle.clipPath)
    if (poly) {
      const toPx = (v: string, size: number) => (v.trim().endsWith("%") ? (parseFloat(v) / 100) * size : parseFloat(v))
      ctx.beginPath()
      poly[1].split(",").forEach((pt, i) => {
        const [px, py] = pt.trim().split(/\s+/)
        const x = (paneRect.left - rootRect.left + toPx(px, paneRect.width)) * dpr
        const y = (paneRect.top - rootRect.top + toPx(py, paneRect.height)) * dpr
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.clip()
    }
    const blend = paneStyle.mixBlendMode
    ctx.globalCompositeOperation = (blend && blend !== "normal" ? blend : "source-over") as GlobalCompositeOperation
    const paneOpacity = parseFloat(paneStyle.opacity)

    for (const c of canvases) {
      if (!c.width || !c.height) continue
      const r = c.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const cs = getComputedStyle(c)
      ctx.globalAlpha = (Number.isFinite(paneOpacity) ? paneOpacity : 1) * (parseFloat(cs.opacity) || 0)
      if (ctx.globalAlpha === 0) continue
      ctx.filter = cs.filter && cs.filter !== "none" ? cs.filter : "none"
      ctx.drawImage(c, (r.left - rootRect.left) * dpr, (r.top - rootRect.top) * dpr, r.width * dpr, r.height * dpr)
    }
    ctx.restore()
  }

  if (withChrome) {
    try {
      const chrome = await domToCanvas(root, {
        width: rootRect.width, height: rootRect.height, scale: dpr, backgroundColor: null,
        // Canvases are already drawn above; the split drag handle is a
        // control, not part of the picture; and of maplibre's own controls
        // only the scale bar (and the attribution the imagery licences ask
        // for) say something about the image - geocoder, zoom, compass and
        // geolocate are buttons.
        filter: (node) => {
          if (node instanceof HTMLCanvasElement) return false
          if (!(node instanceof Element)) return true
          if (node.getAttribute("role") === "separator") return false
          const c = node.classList
          return !c.contains("maplibregl-ctrl") || c.contains("maplibregl-ctrl-scale") || c.contains("maplibregl-ctrl-attrib")
        },
      })
      ctx.globalCompositeOperation = "source-over"
      ctx.globalAlpha = 1
      ctx.filter = "none"
      ctx.drawImage(chrome, 0, 0, Math.round(rootRect.width * dpr), Math.round(rootRect.height * dpr))
      // The timeline is a sibling of the split container, not a child.
      const timeline = includeTimeline ? visibleTimeline() : null
      if (timeline) {
        const r = timeline.getBoundingClientRect()
        const img = await domToCanvas(timeline, { width: r.width, height: r.height, scale: dpr, backgroundColor: null,
          style: { position: "static", inset: "auto", margin: "0", transform: "none" } })
        ctx.drawImage(img, (r.left - rootRect.left) * dpr, (r.top - rootRect.top) * dpr, r.width * dpr, r.height * dpr)
      }
    } catch (error) {
      console.warn("Snapshot: map chrome (pills, controls) could not be rendered, saving the views alone:", error)
    }
  }
  return out
}

/**
 * Captures what the map area shows as an image Blob: a single view, or every
 * view of a split / grid / overlay layout, with date pills and map controls
 * (never the side panel).
 * @param format - 'png' (lossless, default) or 'jpeg' (lossy, faster, smaller)
 */
export async function captureMapScreenshot(
  mapRef: React.RefObject<MapRef>,
  format: ImageFormat = "png",
  { chrome = true }: { chrome?: boolean } = {},
): Promise<Blob | null> {
  if (!mapRef.current) return null

  const root = getSnapshotRoot(mapRef)
  if (root) {
    try {
      const canvas = await compositeViews(root, chrome, getDefaultStore().get(snapshotIncludeTimelineAtom))
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, format === "jpeg" ? "image/jpeg" : "image/png", format === "jpeg" ? 0.95 : undefined))
    } catch (error) {
      console.error("Failed to composite the map views, falling back to view A:", error)
    }
  }

  try {
    const canvas = mapRef.current.getMap().getCanvas()
    const { clientWidth: width, clientHeight: height } = canvas
    const dpr = window.devicePixelRatio

    // domToBlob accepts type option for both PNG and JPEG
    const blob = await domToBlob(canvas, {
      width,
      height,
      scale: dpr,
      type: format === "jpeg" ? "image/jpeg" : "image/png",
      quality: format === "jpeg" ? 0.95 : undefined, // Quality only for JPEG
    })

    return blob
  } catch (error) {
    console.error("Failed to capture map screenshot:", error)
    return null
  }
}

/**
 * Copies a Blob to the system clipboard
 */
export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ])
}

/** Captures the map canvas downscaled to a small JPEG data: URL — for a
 *  bookmark thumbnail (lib/bookmarks.ts), not a real export: those all live
 *  in localStorage's small (~5-10MB) shared quota, so this deliberately
 *  trades quality for size rather than reusing captureMapScreenshot's
 *  full-resolution PNG/JPEG. maxWidth=960 at JPEG quality 0.5 lands around
 *  60-100KB per thumbnail — quality 0.5 (down from the old 320px version's
 *  0.6) claws back some of the ~9x pixel-count increase from tripling the
 *  linear resolution, keeping dozens of bookmarks well within quota. */
export async function captureBookmarkThumbnail(
  mapRef: React.RefObject<MapRef>,
  maxWidth = 960,
): Promise<string | null> {
  if (!mapRef.current) return null
  try {
    const canvas = mapRef.current.getMap().getCanvas()
    const scale = Math.min(1, maxWidth / canvas.clientWidth)
    const width = Math.round(canvas.clientWidth * scale)
    const height = Math.round(canvas.clientHeight * scale)
    const thumbCanvas = document.createElement("canvas")
    thumbCanvas.width = width
    thumbCanvas.height = height
    const ctx = thumbCanvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(canvas, 0, 0, width, height)
    return thumbCanvas.toDataURL("image/jpeg", 0.5)
  } catch (error) {
    console.error("Failed to capture bookmark thumbnail:", error)
    return null
  }
}

/**
 * Captures the map canvas and copies it to clipboard
 * Uses PNG for clipboard (better compatibility, supports transparency)
 */
export async function captureAndCopyMapToClipboard(
  mapRef: React.RefObject<MapRef>
): Promise<boolean> {
  try {
    // Use PNG for clipboard (better compatibility, supports transparency)
    const blob = await captureMapScreenshot(mapRef, "png")
    if (!blob) return false

    await copyBlobToClipboard(blob)
    return true
  } catch (error) {
    console.error("Failed to copy map screenshot to clipboard:", error)
    return false
  }
}