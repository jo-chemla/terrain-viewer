import { useCallback } from "react"
import { embedImageMetadata, attributionOnScreen } from "@/lib/image-metadata"
import { useAtom } from "jotai"
import { useQueryState, parseAsStringLiteral } from "nuqs"
import { findTerrainSource } from "@/lib/terrain-catalog"
import { gdalTileSource } from "@/lib/terrain-tile-spec"
import {
  mapboxKeyAtom, maptilerKeyAtom, titilerEndpointAtom,
  customTerrainSourcesAtom, customBasemapSourcesAtom
} from "@/lib/settings-atoms"
import type { CustomBasemapSource } from "@/lib/settings-atoms"

export interface SourceConfig {
  encoding: string
  tileUrl: string
  tileSize: number
  /** True when this source type can't produce a {z}/{x}/{y} tile pyramid for
   *  buildGdalWmsXml to wrap (see gdalTileSource in lib/terrain-tile-spec.ts):
   *  titiler DTM export isn't possible for it. */
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
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)

  // Any terrain source, a Worldwide Default included, as the plain tile
  // pyramid GDAL reads (gdalTileSource): the info dialog's GDAL commands,
  // the titiler export. "" when only the app's own protocols read it.
  const getTilesUrl = useCallback((key: string): string => (
    gdalTileSource(findTerrainSource(key, customTerrainSources), { titilerEndpoint, mapboxKey, maptilerKey })?.tileUrl ?? ""
  ), [customTerrainSources, titilerEndpoint, mapboxKey, maptilerKey])

  const getCustomBasemapUrl = useCallback((source: CustomBasemapSource): string => {
    if (source.type === "cog") {
      return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${TITILER_CACHE_KEY}&url=${encodeURIComponent(source.url)}`
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
    const entry = findTerrainSource(sourceKey, customTerrainSources)
    if (!entry) return null
    const gdal = gdalTileSource(entry, { titilerEndpoint, mapboxKey, maptilerKey })
    // LERC, quantized mesh, a difference, a cell-routed mosaic, STAC,
    // MosaicJSON, TileJSON: no {z}/{x}/{y} pyramid for buildGdalWmsXml to
    // wrap, so no titiler export (the client export reads them).
    return gdal ?? { encoding: "terrainrgb", tileUrl: "", tileSize: 256, unsupported: true }
  }, [customTerrainSources, titilerEndpoint, mapboxKey, maptilerKey])

  return { getTilesUrl, getSourceConfig, getCustomBasemapUrl, getBasemapSourceConfig }
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
import { canvasBlendOp, edgeFilterPrimitives, EDGE_FILTER_ID, type CompositeStep } from "./grid-layouts"
import { TITILER_CACHE_KEY } from "@/lib/titiler-health"

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

const stripSelectionEmphasis = (cloned: Node) => {
  if (!(cloned instanceof Element)) return
  cloned.querySelectorAll<HTMLElement>("[data-snapshot-plain]").forEach((el) => {
    el.style.fontWeight = "inherit"
    el.style.outline = "none"
  })
}

const isHidden = (el: Element, stopAt: Element) => {
  for (let n: Element | null = el; n && n !== stopAt; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (cs.display === "none" || cs.visibility === "hidden") return true
  }
  return false
}

/** The edges composite's filter for a canvas, in the page for the time of
 *  one draw (a canvas filter can only name a filter of the document). */
function mountEdgeFilter(scale: number): { id: string; remove: () => void } {
  const id = `${EDGE_FILTER_ID}-snapshot`
  const holder = document.createElement("div")
  holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden"
  holder.innerHTML = `<svg width="0" height="0"><filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">${edgeFilterPrimitives(scale)}</filter></svg>`
  document.body.appendChild(holder)
  return { id, remove: () => holder.remove() }
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
    ctx.globalCompositeOperation = canvasBlendOp(paneStyle.mixBlendMode) as GlobalCompositeOperation
    const paneOpacity = parseFloat(paneStyle.opacity)

    // A two-date composite works on a pane before it is blended in (the
    // boxes TerrainViewer.tsx lays over it, kept out of the DOM pass, and
    // for the edges the filter on its canvas container): the pane is drawn
    // apart, the same fills go over the part the boxes cover, and that
    // picture is blended in.
    const stepsBox = pane.querySelector<HTMLElement>("[data-composite-steps]")
    const tmp = stepsBox ? document.createElement("canvas") : null
    if (tmp) { tmp.width = out.width; tmp.height = out.height }
    const target = tmp ? tmp.getContext("2d")! : ctx
    const b = stepsBox?.getBoundingClientRect()
    const box: [number, number, number, number] | null = b ? [(b.left - rootRect.left) * dpr, (b.top - rootRect.top) * dpr, b.width * dpr, b.height * dpr] : null
    // The edges: the same primitives as on screen, with radii in device
    // pixels since this canvas is. Drawn a second time, filtered, inside
    // the box only (A keeps its colors left of the wipe).
    const edgeFilter = stepsBox?.dataset.compositeFilter ? mountEdgeFilter(dpr) : null

    const drawCanvases = (extraFilter: string) => {
      for (const c of canvases) {
        if (!c.width || !c.height) continue
        const r = c.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        const cs = getComputedStyle(c)
        const alpha = (Number.isFinite(paneOpacity) ? paneOpacity : 1) * (parseFloat(cs.opacity) || 0)
        if (alpha === 0) continue
        // Apart, the pane's opacity is applied once, when it is blended in.
        target.globalAlpha = tmp ? (parseFloat(cs.opacity) || 0) : alpha
        target.filter = [cs.filter && cs.filter !== "none" ? cs.filter : "", extraFilter].filter(Boolean).join(" ") || "none"
        target.drawImage(c, (r.left - rootRect.left) * dpr, (r.top - rootRect.top) * dpr, r.width * dpr, r.height * dpr)
      }
    }
    drawCanvases("")
    if (tmp && stepsBox && box) {
      const t = tmp.getContext("2d")!
      if (edgeFilter) {
        t.save()
        t.beginPath(); t.rect(...box); t.clip()
        drawCanvases(`url(#${edgeFilter.id})`)
        t.restore()
        edgeFilter.remove()
      }
      t.globalAlpha = 1
      t.filter = "none"
      for (const step of JSON.parse(stepsBox.dataset.compositeSteps || "[]") as CompositeStep[]) {
        t.globalCompositeOperation = step.blend
        t.fillStyle = step.color
        t.fillRect(...box)
      }
      ctx.globalAlpha = Number.isFinite(paneOpacity) ? paneOpacity : 1
      ctx.filter = "none"
      ctx.drawImage(tmp, 0, 0)
    }
    ctx.restore()
  }

  if (withChrome) {
    try {
      const chrome = await domToCanvas(root, {
        width: rootRect.width, height: rootRect.height, scale: dpr, backgroundColor: null,
        // Selection emphasis (the bold label of the pane the timeline acts
        // on, the extra circle on its timeline handle) is interface state:
        // every pill and handle reads the same in the picture.
        onCloneNode: stripSelectionEmphasis,
        // Canvases are already drawn above; the split drag handle is a
        // control, not part of the picture; and of maplibre's own controls
        // only the scale bar (and the attribution the imagery licences ask
        // for) say something about the image - geocoder, zoom, compass and
        // geolocate are buttons.
        filter: (node) => {
          if (node instanceof HTMLCanvasElement) return false
          if (!(node instanceof Element)) return true
          if (node.getAttribute("role") === "separator" || node.hasAttribute("data-snapshot-ignore")) return false
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
          onCloneNode: stripSelectionEmphasis,
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
  mapRef: React.RefObject<MapRef | null>,
  format: ImageFormat = "png",
  opts: { chrome?: boolean } = {},
): Promise<Blob | null> {
  const blob = await captureMapPixels(mapRef, format, opts)
  if (!blob) return blob
  // The file says where it comes from: the link that reopens this view and
  // the data credits on screen (EXIF in a JPEG, text chunks in a PNG).
  const credits = attributionOnScreen()
  return embedImageMetadata(blob, {
    url: window.location.href,
    description: `Terrain Viewer view: ${window.location.href}`,
    copyright: credits ? `Map data: ${credits}. Rendered with Terrain Viewer (Iconem CTO, Jonathan Chemla).` : "Rendered with Terrain Viewer (Iconem CTO, Jonathan Chemla). Data credits: see the sources of the linked view.",
    software: "Terrain Viewer (https://terrain-viewer.iconem.com)",
  })
}

async function captureMapPixels(
  mapRef: React.RefObject<MapRef | null>,
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
  mapRef: React.RefObject<MapRef | null>,
  maxWidth = 960,
): Promise<string | null> {
  if (!mapRef.current) return null
  const downscale = (source: HTMLCanvasElement, sw: number, sh: number): string | null => {
    const scale = Math.min(1, maxWidth / sw)
    const width = Math.round(sw * scale)
    const height = Math.round(sh * scale)
    const thumbCanvas = document.createElement("canvas")
    thumbCanvas.width = width
    thumbCanvas.height = height
    const ctx = thumbCanvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, width, height)
    return thumbCanvas.toDataURL("image/jpeg", 0.5)
  }
  // Every visible view, composited the way a snapshot is (split, grid and
  // overlay included; the strips under the sidebar and the timeline cropped
  // off; no pills or buttons), so the thumbnail shows the whole comparison,
  // not view A alone.
  const root = getSnapshotRoot(mapRef)
  if (root) {
    try {
      const composite = await compositeViews(root, false, false)
      return downscale(composite, composite.width, composite.height)
    } catch (error) {
      console.error("Failed to composite the views for the thumbnail, falling back to view A:", error)
    }
  }
  try {
    const canvas = mapRef.current.getMap().getCanvas()
    return downscale(canvas, canvas.clientWidth, canvas.clientHeight)
  } catch (error) {
    console.error("Failed to capture bookmark thumbnail:", error)
    return null
  }
}

/**
 * Copies the link of the view, then a picture of it, to the clipboard: two
 * writes, so a clipboard history (Win+V, or a clipboard manager) holds both
 * and a plain paste gives the picture. The link goes first because the
 * picture copied by a browser is re-encoded and loses the link written in the
 * file. It is written before the capture, while the click still counts as a
 * user gesture; a refused link write does not stop the picture.
 * Both writes are started before anything is awaited: Safari refuses a
 * clipboard write that comes after an await (WebKit bug 222262), so the
 * picture is handed over as a promise the browser waits for. A browser that
 * does not take a promise there gets the picture once it is ready.
 * Uses PNG for clipboard (better compatibility, supports transparency)
 */
export async function captureAndCopyMapToClipboard(
  mapRef: React.RefObject<MapRef | null>
): Promise<boolean> {
  try {
    const link = navigator.clipboard.writeText(window.location.href).catch(() => {})
    const picture = captureMapScreenshot(mapRef, "png").then((blob) => {
      if (!blob) throw new Error("The map could not be captured")
      return blob
    })
    picture.catch(() => {})
    let write: Promise<void>
    try {
      write = navigator.clipboard.write([new ClipboardItem({ "image/png": picture })])
    } catch {
      write = picture.then(copyBlobToClipboard)
    }
    await link
    await write
    return true
  } catch (error) {
    console.error("Failed to copy map screenshot to clipboard:", error)
    return false
  }
}
