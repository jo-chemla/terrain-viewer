import type React from "react"
import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ChevronDown, Plus, Edit, Library, Crosshair, Braces, GripVertical } from "lucide-react"
import { SourceMetadataDialog, useSourceInfoDialog } from "./source-metadata"
import { sourcesEditModeAtom } from "@/lib/settings-atoms"
import { OpacityPill } from "@/components/ui/opacity-pill"
import { cn } from "@/lib/utils"
import { georefImageAtom, georefEditingIdAtom, georefActiveAtom, activeViewAtom } from "@/lib/settings-atoms"
import { sectionOpenAtom } from "./TerrainControlPanel"
import { pushToast } from "@/components/ui/toast"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { TooltipButton, SourceGridToggle, GroupHeading, ByodFilter, matchesByodQuery, BYOD_FILTER_MIN, SliderControl, CheckboxWithSlider, SegmentedToggle } from "./controls-components"
import { ColorAlphaSwatch } from "./color-picker"
import { allmapsRemoveColorAtom } from "@/lib/settings-atoms"
import { paperEstimateStore } from "@/lib/allmaps-paper"

/** Allmaps' "remove background": the warped maps' paper colour turns
 *  transparent, so a city plan sits on the imagery instead of on a sheet. */
const PaperControl: React.FC<{ maps: { id: string; name: string; key: string }[] }> = ({ maps }) => {
  const [rc, setRc] = useAtom(allmapsRemoveColorAtom)
  const papers = useSyncExternalStore(paperEstimateStore.subscribe, paperEstimateStore.getSnapshot)
  const auto = rc.auto ?? true
  const gain = rc.autoGain ?? 0.5
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <CheckboxWithSlider id="allmaps-remove-bg" label="Remove paper"
            tooltip={auto
              ? "The scanned sheets' paper turns transparent, warped (Allmaps) and tiled maps alike. Auto: each map's paper colour and threshold come from its own image, the luminance histogram's paper bell split from the ink by Otsu's method; the slider widens or narrows every detected threshold (middle = as detected)"
              : "Pixels within the threshold of the colour turn transparent, like the Allmaps viewer's magic wand; the slider is the threshold"}
            checked={rc.enabled} onCheckedChange={(v) => setRc({ ...rc, enabled: v })}
            sliderValue={auto ? gain : rc.threshold} onSliderChange={(v) => setRc(auto ? { ...rc, autoGain: v } : { ...rc, threshold: v })} />
        </div>
        <Tooltip>
          <TooltipTrigger render={
            <button type="button" className={cn("cursor-pointer shrink-0 rounded border px-1.5 text-[10px] leading-5", auto ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")} onClick={() => setRc({ ...rc, auto: !auto })}>Auto</button>
          } />
          <TooltipContent><p>{auto ? "Auto: per map, from its histogram. Click to pick one colour for all" : "One colour for every map. Click to detect each map's own"}</p></TooltipContent>
        </Tooltip>
        {!auto && <ColorAlphaSwatch title="Paper colour" color={rc.color} onChange={(hex) => setRc({ ...rc, color: hex })} className="rounded shrink-0" />}
      </div>
      {/* What auto found, per map: the paper colour, the threshold in use, the paper's share. */}
      {rc.enabled && auto && maps.map((m) => {
        const p = papers[m.key]
        return (
          <div key={m.id} className="flex items-center gap-1.5 pl-6 text-[10px] text-muted-foreground">
            <span className="h-3 w-3 rounded-sm border shrink-0" style={{ background: p?.color ?? "transparent" }} />
            <span className="truncate flex-1" title={m.name}>{m.name}</span>
            <span className="tabular-nums shrink-0" title={p ? `Luminance modes ${p.modes.map((x: number) => x.toFixed(2)).join(", ")}; ${Math.round(p.paperShare * 100)}% of the map within the threshold of the paper colour${p.confident ? "" : ". Left as it is: the drawing fills the sheet (no light paper making up at least 40% of it)"}` : undefined}>
              {p === undefined ? "…" : p === null ? "no image" : p.confident ? `${p.color} · ${(p.threshold * (0.5 + gain)).toFixed(2)} · ${Math.round(p.paperShare * 100)}%` : "no paper, kept"}
            </span>
          </div>
        )
      })}
    </div>
  )
}
import { allmapsAnnotationBounds } from "@/lib/allmaps-bounds"
import { viewFieldName, sourceFieldName, VIEW_IDS, fanOutWhenSingle, GRID_LAYOUTS, type GridLayoutId, type ViewId } from "@/lib/grid-layouts"
import {
  isBasemapByodOpenAtom, byodBasemapsOpenAtom, byodOverlaysOpenAtom, customBasemapSourcesAtom, customTerrainSourcesAtom,
  useCogProtocolVsTitilerAtom, titilerEndpointAtom,
  type CustomBasemapSource, type CustomTerrainSource, basemapLibraryOpenAtom, customBasemapLastTypeAtom, addBasemapRequestAtom } from "@/lib/settings-atoms"
import { getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import { resolveLocalFileUrl, localFileId } from "@/lib/local-file-store"
import type { MapRef } from "react-map-gl/maplibre"
import { CustomBasemapModal } from "./custom-basemap-modal"
import { BasemapBatchEditModal } from "./basemap-batch-edit-modal"
import { CustomSourceDetails } from "./custom-source-details"
import { SampleSourcesModal } from "./sample-sources-modal"
import { seedStacPreset } from "@/lib/stac-presets"
import { shouldZoomToBounds } from "@/lib/controls-utils"
import { resolveLinkedTerrainId } from "@/lib/linked-sources"

import customSources from "@/lib/custom-sources.json"
const SAMPLE_BASEMAP_SOURCES = customSources['SAMPLE_BASEMAPS_SOURCES']

export const BasemapByodSection: React.FC<{ state: any; setState: (updates: any) => void; mapRef: React.RefObject<MapRef> }> = ({ state, setState, mapRef }) => {
  const [isBasemapByodOpen, setIsBasemapByodOpen] = useAtom(isBasemapByodOpenAtom)
  const [basemapsOpen, setBasemapsOpen] = useAtom(byodBasemapsOpenAtom)
  const [overlaysOpen, setOverlaysOpen] = useAtom(byodOverlaysOpenAtom)
  // A group heading with a chevron: the Basemap and Overlays lists fold.
  const foldHeading = (label: string, open: boolean, toggle: () => void, count: number) => (
    <button type="button" className="flex items-center gap-1 w-full cursor-pointer text-left" onClick={toggle} aria-expanded={open}>
      <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />
      <GroupHeading>{label}</GroupHeading>
      {!open && <span className="text-[10px] text-muted-foreground tabular-nums ml-1">{count}</span>}
    </button>
  )
  const [customBasemapSources, setCustomBasemapSources] = useAtom(customBasemapSourcesAtom)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const [titilerEndpoint] = useAtom(titilerEndpointAtom)
  const [isAddBasemapModalOpen, setIsAddBasemapModalOpen] = useState(false)
  // Add Terrain's Auto hands over a URL only a basemap can take (an Allmaps map).
  const [addRequest, setAddRequest] = useAtom(addBasemapRequestAtom)
  const [handedUrl, setHandedUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!addRequest) return
    setHandedUrl(addRequest.url)
    setEditingBasemap(null)
    // After the terrain dialog's close animation; the request is cleared
    // once the dialog is open (clearing it first re-ran this effect and
    // cancelled the timer).
    const t = setTimeout(() => { setIsAddBasemapModalOpen(true); setAddRequest(null) }, 220)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRequest])
  const setLastBasemapType = useSetAtom(customBasemapLastTypeAtom)
  const [editingBasemap, setEditingBasemap] = useState<CustomBasemapSource | null>(null)
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false)
  const [editMode, setEditMode] = useAtom(sourcesEditModeAtom)
  const { infoId, open: openInfo, close: closeInfo } = useSourceInfoDialog()
  const [isSampleModalOpen, setIsSampleModalOpen] = useAtom(basemapLibraryOpenAtom)
  // Handing off from the Library to the Add dialog's catalog tab is done
  // SEQUENTIALLY rather than by opening the second while the first is still
  // up: overlapping dialog transitions are the shape of problem that left
  // ?openLibrary=both unusable, and one closing cleanly before the next opens
  // costs nothing. NOT verified in a real browser - the agent preview never
  // runs these transitions (no requestAnimationFrame), so every dialog reads
  // opacity 0 there whatever the state actually is.
  const [pendingStacBrowse, setPendingStacBrowse] = useState(false)
  useEffect(() => {
    if (!pendingStacBrowse || isSampleModalOpen) return
    const t = setTimeout(() => { setPendingStacBrowse(false); setIsAddBasemapModalOpen(true) }, 220)
    return () => clearTimeout(t)
  }, [pendingStacBrowse, isSampleModalOpen])
  const [useCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)

  // Resolves a basemap source's paired terrain NAME for CustomSourceDetails'
  // link badge (see CustomBasemapSource.linkedTerrainId) — falls back to a
  // reverse scan since the pairing may have been set from the terrain
  // source's own modal instead, same "either side works" logic as
  // lib/linked-sources.ts's resolvers below.
  const linkedTerrainName = useCallback((source: CustomBasemapSource) => {
    const id = source.linkedTerrainId ?? customTerrainSources.find((t) => t.linkedBasemapId === source.id)?.id
    return id ? customTerrainSources.find((t) => t.id === id)?.name : undefined
  }, [customTerrainSources])

  // Every basemap pick (split A/B, single, or per-view A) routes through
  // these so a linked terrain source is resolved once, imperatively, at the
  // moment of the click — see lib/linked-sources.ts's header for why this
  // replaced a pair of reactive effects that used to live in TerrainViewer.tsx.
  const selectBasemapA = useCallback((id: string) => {
    const linkedTerrainId = resolveLinkedTerrainId(id, customTerrainSources, customBasemapSources)
    setState(fanOutWhenSingle(state, linkedTerrainId ? { basemapSourceA: id, sourceA: linkedTerrainId } : { basemapSourceA: id }))
  }, [customTerrainSources, customBasemapSources, state, setState])

  // Every non-A view (B-F) — this whole branch only ever renders once
  // isSplit is true, which per viewFieldName's rule always means suffixed
  // fields regardless of basemapPerView's own persisted value (see
  // raster-basemap-section.tsx's perViewEffective comment for why).
  const selectBasemapSide = useCallback((side: ViewId, id: string) => {
    if (side === "A") { selectBasemapA(id); return }
    const linkedTerrainId = resolveLinkedTerrainId(id, customTerrainSources, customBasemapSources)
    setState(linkedTerrainId
      ? { [viewFieldName(side, "basemapSource", true)]: id, [sourceFieldName(side)]: linkedTerrainId }
      : { [viewFieldName(side, "basemapSource", true)]: id })
  }, [customTerrainSources, customBasemapSources, setState, selectBasemapA])

  // The label click in a split: the basemap on every view, with its linked
  // terrain on every view too (the terrain side's selectTerrainAll twin).
  const selectBasemapAll = useCallback((id: string) => {
    const linkedTerrainId = resolveLinkedTerrainId(id, customTerrainSources, customBasemapSources)
    const patch: Record<string, any> = { basemapSource: id }
    for (const side of VIEW_IDS) {
      patch[viewFieldName(side, "basemapSource", true)] = id
      if (linkedTerrainId) patch[sourceFieldName(side)] = linkedTerrainId
    }
    setState(patch)
  }, [customTerrainSources, customBasemapSources, setState])

  // An overlay's label in a split: on every active view, or off everywhere
  // when it already is on all of them.
  const toggleOverlayAll = useCallback((id: string) => {
    const views = activeViewsOf(state)
    const everywhere = views.every((side) => overlayIdsOf(side).includes(id))
    const patch: Record<string, any> = {}
    for (const side of views) {
      const field = overlayField(side)
      const current: string[] = state[field] || []
      patch[field] = everywhere ? current.filter((x) => x !== id) : (current.includes(id) ? current : [...current, id])
    }
    setState(patch)
    return !everywhere
  }, [state, setState])

  const selectBasemapSingle = useCallback((id: string) => {
    const linkedTerrainId = resolveLinkedTerrainId(id, customTerrainSources, customBasemapSources)
    setState(fanOutWhenSingle(state, linkedTerrainId ? { basemapSource: id, sourceA: linkedTerrainId } : { basemapSource: id }))
  }, [customTerrainSources, customBasemapSources, state, setState])

  const handleSaveCustomBasemap = useCallback((source: Omit<CustomBasemapSource, "id"> & { id?: string }) => {
    if (source.id) {
      setCustomBasemapSources(customBasemapSources.map((s) => s.id === source.id ? { ...s, ...source } as CustomBasemapSource : s))
    } else {
      const newSource: CustomBasemapSource = { ...source, id: `custom-basemap-${Date.now()}` } as CustomBasemapSource
      // Functional update: STAC search adds several from one open dialog.
      setCustomBasemapSources((prev) => [...prev, newSource])
      // A georeferenced IIIF map's extent comes from its annotation's
      // control points, fetched after the save (zoom-to-fit, coverage).
      if (newSource.type === "iiif" && !newSource.bounds) {
        allmapsAnnotationBounds(newSource.url).then((bounds) => { if (bounds) setCustomBasemapSources((prev) => prev.map((s) => (s.id === newSource.id && !s.bounds ? { ...s, bounds } : s))) })
      }
      // Newly added sources are the ones the user almost always wants to look at
      // immediately — auto-select it as the active basemap. Resolved directly
      // from newSource (see terrain-source-section.tsx's matching comment for
      // why: a brand-new id can't yet be a reverse-link target, and
      // customBasemapSources here is one render stale).
      // Both the single-view field and view A's per-view field, so it is
      // what shows whichever layout is active (view A in split / grid).
      // ...and make sure the basemap layer is actually shown - adding one
      // with "Basemap" unticked in Visualization looked like a silent failure.
      // An 'overlay'-role source (ELI flags some layers that way) is not in the
      // basemap list at all: it goes onto the overlay stack instead.
      const show = state.showRasterBasemap ? {} : { showRasterBasemap: true }
      if (newSource.role === "overlay") {
        const ids: string[] = state.overlayBasemapIds || []
        setState({ ...show, overlayBasemapIds: ids.includes(newSource.id) ? ids : [...ids, newSource.id] })
      } else if (newSource.linkedTerrainId) {
        setState(fanOutWhenSingle(state, { ...show, basemapSource: newSource.id, basemapSourceA: newSource.id, sourceA: newSource.linkedTerrainId }))
      } else {
        setState(fanOutWhenSingle(state, { ...show, basemapSource: newSource.id, basemapSourceA: newSource.id }))
      }
    }
  }, [customBasemapSources, setCustomBasemapSources, setState, state.showRasterBasemap, state.overlayBasemapIds])

  // Applies the Edit Basemap modal's opacity slider straight to the atom as
  // it drags — the modal itself only calls this while an existing source is
  // being edited (see its own comment), and reverts to the pre-edit value if
  // the dialog closes without Save.
  const handleLiveOpacityChange = useCallback((opacity: number) => {
    if (!editingBasemap) return
    setCustomBasemapSources(customBasemapSources.map((s) => s.id === editingBasemap.id ? { ...s, opacity } : s))
  }, [editingBasemap, customBasemapSources, setCustomBasemapSources])

  const handleDeleteCustomBasemap = useCallback((id: string) => {
    setCustomBasemapSources(customBasemapSources.filter((s) => s.id !== id))
    if (state.basemapSource === id) setState({ basemapSource: "osm" })
    // Every view (not just A/B) needs its own fallback — same reasoning as
    // terrain-source-section.tsx's handleDeleteCustomSource.
    const fallback: Record<ViewId, string> = { A: "esri", B: "google", C: "esri", D: "google", E: "esri", F: "google", G: "esri", H: "google" }
    const updates: Record<string, string> = {}
    for (const side of VIEW_IDS) {
      const field = viewFieldName(side, "basemapSource", true)
      if (state[field] === id) updates[field] = fallback[side]
    }
    if (Object.keys(updates).length > 0) setState(updates)
  }, [customBasemapSources, setCustomBasemapSources, state, setState])

  // `force` skips the smart-zoom heuristic and always moves the camera — used by
  // the dedicated "Fit to bounds" button. Without it (the default, used when a
  // source's label is clicked to activate it), the camera only moves when the
  // target bounds are fully inside the current viewport, or fully disjoint from
  // it — see shouldZoomToBounds — so activating a world-covering basemap (bounds
  // fully contain the viewport) or one that only partially overlaps it doesn't
  // yank the user's context away from wherever they're already looking.
  const attemptFitBounds = useCallback((bbox: [number, number, number, number], force = false) => {
    if (!mapRef.current) return
    const [west, south, east, north] = bbox
    if (!force) {
      const viewport = mapRef.current.getMap().getBounds()
      const target = { west, south, east, north }
      const viewportBounds = { west: viewport.getWest(), south: viewport.getSouth(), east: viewport.getEast(), north: viewport.getNorth() }
      if (!shouldZoomToBounds(viewportBounds, target)) return
    }
    mapRef.current.fitBounds([[west, south], [east, north]], { padding: 50, speed: 6 })
  }, [mapRef])

  const handleFitToBounds = useCallback(async (source: CustomBasemapSource, force = false) => {
    // Populated directly from WMS GetCapabilities (see wms-picker-panel.tsx) — no
    // fetch needed, unlike the type-specific detection below.
    if (source.bounds) {
      attemptFitBounds(source.bounds, force)
      return
    }
    if (source.type === 'tilejson') {
      try {
        const response = await fetch(source.url)
        const data = await response.json()
        if (data.bounds) attemptFitBounds(data.bounds, force)
      } catch (error) {
        console.error("Failed to fetch TileJSON bounds:", error)
      }
      return
    }
    if (!['cog', 'cog-local'].includes(source.type)) return
    // A local file can only ever stream via the in-browser geomatico protocol —
    // there's no titiler server that could reach the user's disk — same as the
    // terrain side ignoring useCogProtocolVsTitiler for "cog-local" sources.
    const isCogLocal = source.type === 'cog-local'
    const cogUrl = isCogLocal ? resolveLocalFileUrl(localFileId(source.url)) : source.url
    if (!cogUrl) return // not (re-)picked yet this session
    try {
      if (isCogLocal || useCogProtocolVsTitiler) {
        getCogMetadata(cogUrl).then(metadata => {
          if (metadata.bbox) attemptFitBounds(metadata.bbox, force)
        })
      } else {
        const infoUrl = `${titilerEndpoint}/cog/info.geojson?url=${encodeURIComponent(cogUrl)}`
        const response = await fetch(infoUrl)
        const data = await response.json()
        const bbox = data.bbox ?? data.properties.bounds
        if (bbox) attemptFitBounds(bbox, force)
      }
    } catch (error) {
      console.error("Failed to fetch COG bounds:", error)
    }
  }, [titilerEndpoint, useCogProtocolVsTitiler, attemptFitBounds])

  const handleEditBasemap = useCallback((sourceId: string) => {
    const source = customBasemapSources.find(s => s.id === sourceId)
    if (source) {
      setEditingBasemap(source)
      setIsAddBasemapModalOpen(true)
    }
  }, [customBasemapSources])

  // Picked from a modal, same as the terrain samples (see SampleSourcesModal).
  const handleLoadSample = useCallback(() => setIsSampleModalOpen(true), [])

  // 'overlay' sources stack on top of the active basemap (see OverlayBasemapSources/
  // Layers in MapSources.tsx/MapLayers.tsx) instead of being one themselves — keep
  // them out of the basemap radio/toggle lists below, and multi-select them in their
  // own checkbox list further down.
  const [byodQuery, setByodQuery] = useState("")
  const byodQ = byodQuery.trim().toLowerCase()
  // Timeline picks (transient) stay off these lists until kept.
  const basemapRoleSources = customBasemapSources.filter((s) => !s.transient && (s.role ?? "basemap") === "basemap" && matchesByodQuery(s, byodQ))
  const overlaySources = customBasemapSources.filter((s) => !s.transient && s.role === "overlay" && matchesByodQuery(s, byodQ))
  // The scanned maps on the views, for the paper removal: warped (Allmaps,
  // keyed by annotation URL) and tiled old maps (keyed by their template),
  // as overlays or as a view's basemap (a catalog pick).
  const scannedMaps = (() => {
    const onViews = new Set<string>()
    for (const side of VIEW_IDS) {
      for (const oid of (state[side === "A" ? "overlayBasemapIds" : `overlayBasemapIds${side}`] as string[] | undefined) ?? []) onViews.add(oid)
      const bid = state[viewFieldName(side, "basemapSource", state.basemapPerView)]
      if (typeof bid === "string") onViews.add(bid)
    }
    return customBasemapSources.filter((s) => onViews.has(s.id) && (s.type === "iiif" || s.oldMap)).map((s) => ({ id: s.id, name: s.name, key: s.url }))
  })()

  // Sends a saved picture back to Tools > Image Georeferencer with its points,
  // so they can be moved and the overlay updated in place.
  const setCustomTerrainSources = useSetAtom(customTerrainSourcesAtom)
  const activeView = useAtomValue(activeViewAtom)
  const setGeorefImage = useSetAtom(georefImageAtom)
  const [georefEditingId, setGeorefEditingId] = useAtom(georefEditingIdAtom)
  const setGeorefActive = useSetAtom(georefActiveAtom)
  const setSectionOpen = useSetAtom(sectionOpenAtom)
  const reopenGeoref = useCallback((source: CustomBasemapSource) => {
    const g = source.georef
    if (!g) return
    // Already open on this overlay: the same button closes the tool.
    if (georefEditingId === source.id) {
      setGeorefImage(null); setGeorefEditingId(null); setGeorefActive(false)
      setState({ georefGcps: "", georefImage: "" })
      return
    }
    const url = source.type === "image-local" ? resolveLocalFileUrl(localFileId(source.url)) : source.url
    if (!url) { pushToast({ key: "georef", title: "The picture is not available in this session", body: "Re-select its file first (the row offers it)." }); return }
    setGeorefImage({ url, width: g.width, height: g.height, name: source.name, fromDisk: source.type === "image-local" })
    setGeorefEditingId(source.id)
    setGeorefActive(true)
    setState({ georefBeta: true, georefGcps: g.gcps, georefType: g.type, georefImage: source.type === "image" ? source.url : "", showGeoref: true })
    setSectionOpen((prev: any) => ({ ...prev, georef: true }))
  }, [georefEditingId, setGeorefImage, setGeorefEditingId, setGeorefActive, setSectionOpen, setState])

  // The overlays' order (edit mode's drag handle): a dragged overlay lands
  // before the one it is dropped on; the list's first draws on top.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverAfter, setDragOverAfter] = useState(false)
  const moveOverlayAfter = useCallback((fromId: string, afterId: string) => {
    setCustomBasemapSources((prev) => {
      const from = prev.find((s) => s.id === fromId)
      if (!from) return prev
      const rest = prev.filter((s) => s.id !== fromId)
      const at = rest.findIndex((s) => s.id === afterId)
      if (at === -1) return prev
      return [...rest.slice(0, at + 1), from, ...rest.slice(at + 1)]
    })
  }, [setCustomBasemapSources])
  const moveOverlayBefore = useCallback((fromId: string, beforeId: string) => {
    setCustomBasemapSources((prev) => {
      const from = prev.find((s) => s.id === fromId)
      if (!from) return prev
      const rest = prev.filter((s) => s.id !== fromId)
      const at = rest.findIndex((s) => s.id === beforeId)
      if (at === -1) return prev
      return [...rest.slice(0, at), from, ...rest.slice(at)]
    })
  }, [setCustomBasemapSources])
  const handleToggleOverlay = useCallback((id: string, checked: boolean) => {
    const current: string[] = state.overlayBasemapIds || []
    setState({ overlayBasemapIds: checked ? [...current, id] : current.filter((x) => x !== id) })
    return checked
  }, [state.overlayBasemapIds, setState])
  // Per view, in split / grid with per-view basemaps: view A is the plain
  // overlayBasemapIds, the others overlayBasemapIds<side>.
  const overlayField = (side: ViewId) => (side === "A" ? "overlayBasemapIds" : `overlayBasemapIds${side}`)
  const activeViewsOf = (st: Record<string, any>): ViewId[] => st.splitStyle === "off" ? ["A"] : GRID_LAYOUTS[(st.splitStyle === "overlay" ? "2x1" : (st.gridLayout ?? "2x1")) as GridLayoutId].grid.flat()
  const overlayIdsOf = (side: ViewId): string[] => state[overlayField(side)] || []
  const toggleOverlaySide = useCallback((side: ViewId, id: string) => {
    const field = side === "A" ? "overlayBasemapIds" : `overlayBasemapIds${side}`
    const current: string[] = state[field] || []
    setState({ [field]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] })
  }, [state, setState])

  return (
    <>
      <Collapsible open={isBasemapByodOpen} onOpenChange={setIsBasemapByodOpen} className="mt-2">
        <CollapsibleTrigger className="flex items-center justify-between w-full py-1 cursor-pointer">
          <GroupHeading>Bring Your Own Data</GroupHeading>
          <ChevronDown className={`h-4 w-4 transition-transform ${isBasemapByodOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-2 pt-1 pl-2.5">
          {customBasemapSources.length >= BYOD_FILTER_MIN && (
            <ByodFilter value={byodQuery} onChange={setByodQuery} shown={basemapRoleSources.length + overlaySources.length} total={customBasemapSources.length} />
          )}
          <TooltipProvider>
            <div className="flex gap-2">
              <TooltipButton
                icon={Plus}
                label="Add Basemap"
                className="flex-1 min-w-0"
                tooltip="Add a new custom basemap source"
                onClick={() => { setEditingBasemap(null); setIsAddBasemapModalOpen(true) }}
              />
              <TooltipButton
                icon={Library}
                label="Library"
                className="flex-1 min-w-0"
                tooltip="Pick from the library of sample basemaps"
                onClick={handleLoadSample}
              />
              {/* Edit mode: on, each row shows edit and delete and the
                  batch JSON editor is offered; off, rows show info, fit and
                  the overlay's opacity only. Shared with the terrain list. */}
              {editMode && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button variant="outline" size="sm" className="cursor-pointer bg-transparent shrink-0 px-2" aria-label="Batch edit" onClick={() => setIsBatchEditModalOpen(true)}>
                        <Braces className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                    }
                  />
                  <TooltipContent><p>Batch edit: every source as JSON, Ctrl+Enter saves</p></TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant={editMode ? "default" : "outline"} size="sm" className={cn("cursor-pointer shrink-0 px-2", !editMode && "bg-transparent")} onClick={() => setEditMode(!editMode)}>
                      <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
                  }
                />
                <TooltipContent><p>{editMode ? "Done editing" : "Edit the sources"}</p></TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
          {basemapRoleSources.length > 0 && (
            <>
            {foldHeading("Basemap", basemapsOpen, () => setBasemapsOpen(!basemapsOpen), basemapRoleSources.length)}
            {basemapsOpen && (state.basemapPerView ? (
              state.splitStyle !== "off" ? (
                <div className="space-y-1.5">
                  {basemapRoleSources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2 min-w-0">
                      <SourceGridToggle
                        gridLayout={state.splitStyle === "overlay" ? "2x1" : state.gridLayout}
                        isActive={(side: ViewId) => state[viewFieldName(side, "basemapSource", true)] === source.id}
                        onSelect={(side: ViewId) => selectBasemapSide(side, source.id)}
                      />
                      <CustomSourceDetails
                        onInfo={openInfo}
                        source={source}
                        handleFitToBounds={handleFitToBounds}
                        handleEditSource={handleEditBasemap}
                        handleDeleteCustomSource={handleDeleteCustomBasemap}
                        onSelect={state.splitStyle !== "off" ? selectBasemapAll : selectBasemapA}
                        linkedSourceName={linkedTerrainName(source)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <RadioGroup value={state.basemapSourceA} onValueChange={selectBasemapA} className="gap-2">
                  {basemapRoleSources.map((source) => (
                    <div key={source.id} className="flex items-center gap-2 min-w-0">
                      <RadioGroupItem
                        value={source.id}
                        id={`basemap-${source.id}`}
                        className="cursor-pointer shrink-0"
                      />
                      <CustomSourceDetails
                        onInfo={openInfo}
                        source={source}
                        handleFitToBounds={handleFitToBounds}
                        handleEditSource={handleEditBasemap}
                        handleDeleteCustomSource={handleDeleteCustomBasemap}
                        onSelect={state.splitStyle !== "off" ? selectBasemapAll : selectBasemapA}
                        linkedSourceName={linkedTerrainName(source)}
                      />
                    </div>
                  ))}
                </RadioGroup>
              )
            ) : (
              <RadioGroup value={state.basemapSource} onValueChange={selectBasemapSingle} className="gap-2">
                {basemapRoleSources.map((source) => (
                  <div key={source.id} className="flex items-center gap-2 min-w-0">
                    <RadioGroupItem
                      value={source.id}
                      id={`basemap-${source.id}`}
                      className="cursor-pointer shrink-0"
                    />
                    <CustomSourceDetails
                      onInfo={openInfo}
                      source={source}
                      handleFitToBounds={handleFitToBounds}
                      handleEditSource={handleEditBasemap}
                      handleDeleteCustomSource={handleDeleteCustomBasemap}
                      onSelect={selectBasemapSingle}
                      linkedSourceName={linkedTerrainName(source)}
                    />
                  </div>
                ))}
              </RadioGroup>
            ))}
            </>
          )}
          {state.basemapPerView && overlaySources.length > 0 && (
            <div className="space-y-2 pt-2 mt-2 border-t">
              {foldHeading("Overlays", overlaysOpen, () => setOverlaysOpen(!overlaysOpen), overlaySources.length)}
              {overlaysOpen && (<>
              <SliderControl label="Overlays opacity" value={(state.overlaysOpacity ?? 1) * 100} onChange={(v) => setState({ overlaysOpacity: v / 100 })} min={0} max={100} step={1} suffix="%" sliderId="overlays-opacity" />
              {/* One stack position for every overlay (overlaysStack), so it
                  cannot fight the order of the list below. */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0" title="Where every overlay sits: under the hillshade and colour relief, above the colour relief but still shaded, or above every terrain layer">Stack</span>
                <SegmentedToggle className="flex-1" value={(state.overlaysStack ?? "under") as "under" | "relief" | "top"} onChange={(v) => setState({ overlaysStack: v })}
                  options={[{ value: "under" as const, label: "Under relief" }, { value: "relief" as const, label: "Over hypso" }, { value: "top" as const, label: "On top" }]} />
              </div>
              {scannedMaps.length > 0 && <PaperControl maps={scannedMaps} />}
              {editMode && overlaySources.length > 1 && <p className="text-[11px] text-muted-foreground">Drag the handles to order the overlays: the first draws on top.</p>}
              {(state.pitch ?? 0) > 0.5 && overlaySources.some((s) => s.type === "iiif" && !s.allmapsTiles) && <p className="text-[11px] text-muted-foreground">Tilted view: the georeferenced IIIF maps come from Allmaps' tile server (Allmaps' in-browser warp draws flat only); back to the sharper in-browser warp at pitch 0.</p>}
              {overlaySources.map((source) => (
                <div key={source.id} className="relative flex items-center gap-2 min-w-0"
                  onDragOver={editMode ? (e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; if (dragOverId !== source.id) setDragOverId(source.id); if (after !== dragOverAfter) setDragOverAfter(after) } : undefined}
                  onDragLeave={editMode ? (e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setDragOverId((d) => (d === source.id ? null : d)) } : undefined}
                  onDrop={editMode ? (e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/overlay-id") || dragId; const after = dragOverAfter; setDragOverId(null); setDragId(null); if (from && from !== source.id) (after ? moveOverlayAfter : moveOverlayBefore)(from, source.id) } : undefined}>
                  {/* Where the dragged overlay lands: before or after this one,
                      by which half of the row the pointer is in. */}
                  {editMode && dragOverId === source.id && dragId !== source.id && (
                    <div className={cn("pointer-events-none absolute left-0 right-0 h-0.5 rounded bg-primary", dragOverAfter ? "-bottom-1" : "-top-1")} />
                  )}
                  {editMode && (
                    <span draggable className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0" title="Drag to reorder: the first overlay draws on top"
                      onDragStart={(e) => { e.dataTransfer.setData("text/overlay-id", source.id); e.dataTransfer.effectAllowed = "move"; setDragId(source.id) }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null) }}>
                      <GripVertical className="h-4 w-4" />
                    </span>
                  )}
                  {state.basemapPerView && state.splitStyle !== "off" ? (
                    <SourceGridToggle
                      gridLayout={state.splitStyle === "overlay" ? "2x1" : state.gridLayout}
                      isActive={(side: ViewId) => overlayIdsOf(side).includes(source.id)}
                      onSelect={(side: ViewId) => toggleOverlaySide(side, source.id)}
                      allowUnpress
                      onlySide={activeView}
                    />
                  ) : (
                  <Checkbox
                    checked={(state.overlayBasemapIds || []).includes(source.id)}
                    onCheckedChange={(checked) => handleToggleOverlay(source.id, checked === true)}
                    className="cursor-pointer shrink-0"
                  />
                  )}
                  {/* The overlay's opacity, right after the view buttons. */}
                  <OpacityPill value={(source.opacity ?? 100) / 100} onChange={(v) => setCustomBasemapSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, opacity: Math.round(v * 100) } : s)))} title="This overlay's opacity" />
                  <CustomSourceDetails
                    onInfo={openInfo}
                    source={source}
                    handleFitToBounds={handleFitToBounds}
                    handleEditSource={handleEditBasemap}
                    handleDeleteCustomSource={handleDeleteCustomBasemap}
                    onSelect={(id) => (state.basemapPerView && state.splitStyle !== "off") ? toggleOverlayAll(id) : handleToggleOverlay(id, !(state.overlayBasemapIds || []).includes(id))}
                    extraActions={(source.type === "image" || source.type === "image-local") && source.georef ? (
                      <Button variant="ghost" size="icon" className={`h-8 w-8 shrink-0 cursor-pointer ${georefEditingId === source.id ? "bg-primary/15 text-primary" : ""}`} title={georefEditingId === source.id ? "Close the Image Georeferencer" : "Edit the control points in Tools > Image Georeferencer"} onClick={() => reopenGeoref(source)}>
                        <Crosshair className="h-4 w-4" />
                      </Button>
                    ) : undefined}
                  />
                </div>
              ))}
              </>)}
            </div>
          )}
        </CollapsibleContent>

      </Collapsible>
      <SampleSourcesModal
        open={isSampleModalOpen}
        onOpenChange={setIsSampleModalOpen}
        title="Basemap library"
        stacTarget="basemap"
        onBrowseStac={(presetId) => {
        // The Add dialog reads its own type back from the "last type" atom
        // when it opens for a NEW source, so pointing that at "stac" is all it
        // takes to land on the catalog tab - no extra prop, no second path
        // through the dialog's reset effect. seedStacPreset picks the
        // catalog itself. Off when the beta flag is off, since the tab would
        // not be there to land on.
          seedStacPreset("basemap", presetId)
          setLastBasemapType("stac")
          setEditingBasemap(null)
          setIsSampleModalOpen(false)
          setPendingStacBrowse(true)
        }}
        samples={SAMPLE_BASEMAP_SOURCES as CustomBasemapSource[]}
        current={customBasemapSources}
        setCurrent={(next) => {
          // Same fallback as the trash button for any view (or the simple
          // mode's basemapSource) left pointing at a removed id.
          const kept = new Set(next.map((s) => s.id))
          const removed = (id: string | undefined) => !!id && !kept.has(id) && customBasemapSources.some((s) => s.id === id)
          const fallback: Record<ViewId, string> = { A: "esri", B: "google", C: "esri", D: "google", E: "esri", F: "google", G: "esri", H: "google" }
          const updates: Record<string, string> = {}
          if (removed(state.basemapSource)) updates.basemapSource = "esri"
          for (const side of VIEW_IDS) {
            const field = viewFieldName(side, "basemapSource", true)
            if (removed(state[field])) updates[field] = fallback[side]
          }
          if (Object.keys(updates).length > 0) setState(updates)
          // A library basemap that names a terrain twin (linkedTerrainId)
          // brings that terrain into the user's list too.
          const before = new Set(customBasemapSources.map((s) => s.id))
          const wanted = next.filter((s) => !before.has(s.id)).map((s) => s.linkedTerrainId).filter((id): id is string => !!id)
          if (wanted.length) setCustomTerrainSources((prev) => {
            const have = new Set(prev.map((s) => s.id))
            const add = wanted.filter((id) => !have.has(id)).map((id) => (customSources.SAMPLE_TERRAIN_SOURCES as any[]).find((s) => s.id === id)).filter(Boolean) as CustomTerrainSource[]
            return add.length ? [...prev, ...add] : prev
          })
          setCustomBasemapSources(next)
        }}
      />
      <SourceMetadataDialog source={infoId ? customBasemapSources.find((s) => s.id === infoId) ?? null : null} onClose={closeInfo} onFit={(s) => handleFitToBounds(s, true)} />
      <CustomBasemapModal isOpen={isAddBasemapModalOpen} onOpenChange={(o) => { setIsAddBasemapModalOpen(o); if (!o) setHandedUrl(undefined) }} initialUrl={handedUrl} editingSource={editingBasemap} onSave={handleSaveCustomBasemap} onLiveOpacityChange={handleLiveOpacityChange} mapRef={mapRef} />
      <BasemapBatchEditModal
        isOpen={isBatchEditModalOpen}
        onOpenChange={setIsBatchEditModalOpen}
        sources={customBasemapSources}
        onSave={(sources) => { setCustomBasemapSources(sources); setIsBatchEditModalOpen(false) }}
      />
    </>
  )
}