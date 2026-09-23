import type React from "react"
import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react"
import { useAtom, useSetAtom } from "jotai"
import { v4 as uuidv4 } from "uuid"
import { ChevronDown, Link, Settings2, Expand, Copy, Check, Info, ExternalLink } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import { type CustomTerrainSource, useCogProtocolVsTitilerAtom, customBasemapSourcesAtom, customTerrainSourcesAtom, customTerrainLastTypeAtom, stacSearchBetaEnabledAtom } from "@/lib/settings-atoms"
import { supportsNodataControls } from "@/lib/nodata"
import { terrainSources } from "@/lib/terrain-sources"
import { registerLocalFileAtom, makeLocalFileUrl, localFileId, getLocalFileName, validateLocalCogFile, resolveLocalFileUrl } from "@/lib/local-file-store"
import { copyToClipboard } from "@/lib/controls-utils"
import { useCogMetadata, useCogResolution, zoomRangeFromMetadata, formatGsd } from "@/lib/cog-metadata"
import { WmsPickerPanel } from "./wms-picker-panel"
const StacSearchPanel = lazy(() => import("./stac-search-panel").then((m) => ({ default: m.StacSearchPanel })))

type TerrainFormType = CustomTerrainSource["type"] | "wms-picker" | "stac"

export const CustomTerrainSourceModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomTerrainSource | null
  onSave: (source: Omit<CustomTerrainSource, "id"> & { id?: string }) => void
  mapRef?: React.RefObject<MapRef>
}> = ({ isOpen, onOpenChange, editingSource, onSave, mapRef }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [lastType, setLastType] = useAtom(customTerrainLastTypeAtom)
  const [stacSearchBeta] = useAtom(stacSearchBetaEnabledAtom)
  const fitTo = (b?: [number, number, number, number]) => { const m = mapRef?.current?.getMap(); if (m && b) m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, speed: 6 }) }
  const [type, setTypeState] = useState<TerrainFormType>(lastType as TerrainFormType)
  // Remember the choice for the next "Add Dataset" (not while editing).
  const setType = useCallback((t: TerrainFormType) => {
    setTypeState(t)
    if (!editingSource) setLastType(t)
  }, [editingSource, setLastType])
  // Brief "copied!" confirmation on the template hint's copy button — same
  // 2s-timeout pattern as ShareSection's CopyUrlButton.
  const [templateCopied, setTemplateCopied] = useState(false)
  const handleCopyTemplate = useCallback((text: string) => {
    copyToClipboard(text)
    setTemplateCopied(true)
    setTimeout(() => setTemplateCopied(false), 1000)
  }, [])
  const [description, setDescription] = useState("")
  const [maxzoom, setMaxzoom] = useState("")
  // Pairs this terrain source with a basemap/raster one (e.g. a fresco's DTM
  // paired with its own albedo photo COG) — "" means unlinked. See
  // CustomTerrainSource.linkedBasemapId; the reverse Select lives in
  // custom-basemap-modal.tsx and either side is enough to link the pair.
  const [linkedBasemapId, setLinkedBasemapId] = useState("")
  // type "dem-diff": the two operand terrain sources (see CustomTerrainSource.diffMinuendId).
  const [diffMinuendId, setDiffMinuendId] = useState("")
  const [diffSubtrahendId, setDiffSubtrahendId] = useState("")
  const [diffOffset, setDiffOffset] = useState("")
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  const isDemDiff = type === "dem-diff"
  // Operands: every built-in and custom terrain source except differences
  // (one level only) and the source being edited.
  const diffOperands = useMemo(() => [
    ...Object.entries(terrainSources).filter(([, cfg]) => (cfg as any).encoding !== "3dtiles").map(([id, cfg]) => ({ id, name: (cfg as any).name as string })),
    ...customTerrainSources.filter((s) => s.type !== "dem-diff" && s.id !== editingSource?.id).map((s) => ({ id: s.id, name: s.name })),
  ], [customTerrainSources, editingSource?.id])
  const diffReady = !!diffMinuendId && !!diffSubtrahendId && diffMinuendId !== diffSubtrahendId
  // The trigger shows the label from `items`; a 90-character library name
  // there widened the whole dialog past its max width (the value span does
  // not shrink inside Base UI's trigger), so the trigger gets a clipped label
  // and the list keeps the full one.
  const shortLabel = (n: string) => (n.length > 48 ? n.slice(0, 47) + "…" : n)
  const diffItems = Object.fromEntries([["none", "Choose…"], ...diffOperands.map((o) => [o.id, shortLabel(o.name)])])
  // [west, south, east, north] as free-text draft strings — mirrors
  // CustomTerrainSource.bounds, manually settable for sources (e.g. WMS) whose
  // extent can't be auto-detected the way COG metadata is.
  const [boundsWest, setBoundsWest] = useState("")
  const [boundsSouth, setBoundsSouth] = useState("")
  const [boundsEast, setBoundsEast] = useState("")
  const [boundsNorth, setBoundsNorth] = useState("")
  // Out-of-coverage floor/fill in metres, as free-text drafts — see lib/nodata.ts.
  const [nodataFloor, setNodataFloor] = useState("")
  const [nodataFill, setNodataFill] = useState("")
  // Custom RGB elevation packing for TMS pyramids that are neither Terrarium nor
  // Terrain-RGB — see resolveCustomEncoding in lib/elevation-encoding.ts.
  const [redFactor, setRedFactor] = useState("")
  const [greenFactor, setGreenFactor] = useState("")
  const [blueFactor, setBlueFactor] = useState("")
  const [baseShift, setBaseShift] = useState("")
  const [cogViaTitiler, setCogViaTitiler] = useState(false)
  // Folded by default — most sources need neither a linked pair nor manual
  // bounds, so this stays out of the way unless deliberately expanded.
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [localFileName, setLocalFileName] = useState<string | null>(null)
  const [localFileWarning, setLocalFileWarning] = useState<string | null>(null)
  const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
  const [customBasemapSources] = useAtom(customBasemapSourcesAtom)
  const registerLocalFile = useSetAtom(registerLocalFileAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Guards against an in-flight validateLocalCogFile from a previous pick
  // resolving after (and clobbering the warning for) a newer one — a plain
  // event handler has no useEffect-style cleanup to cancel it with.
  const latestFileIdRef = useRef(0)

  useEffect(() => {
    if (editingSource) {
      setName(editingSource.name)
      setUrl(editingSource.url)
      setType(editingSource.type)
      setDescription(editingSource.description || "")
      setMaxzoom(editingSource.maxzoom === undefined ? "" : String(editingSource.maxzoom))
      setLinkedBasemapId(editingSource.linkedBasemapId ?? "")
      setDiffMinuendId(editingSource.diffMinuendId ?? "")
      setDiffSubtrahendId(editingSource.diffSubtrahendId ?? "")
      setDiffOffset(editingSource.diffOffsetM === undefined ? "" : String(editingSource.diffOffsetM))
      setBoundsWest(editingSource.bounds ? String(editingSource.bounds[0]) : "")
      setBoundsSouth(editingSource.bounds ? String(editingSource.bounds[1]) : "")
      setBoundsEast(editingSource.bounds ? String(editingSource.bounds[2]) : "")
      setBoundsNorth(editingSource.bounds ? String(editingSource.bounds[3]) : "")
      setNodataFloor(editingSource.nodataFloor === undefined ? "" : String(editingSource.nodataFloor))
      setNodataFill(editingSource.nodataFill === undefined ? "" : String(editingSource.nodataFill))
      const str = (v: number | undefined) => (v === undefined ? "" : String(v))
      setRedFactor(str(editingSource.redFactor))
      setGreenFactor(str(editingSource.greenFactor))
      setBlueFactor(str(editingSource.blueFactor))
      setBaseShift(str(editingSource.baseShift))
      setCogViaTitiler(!!editingSource.cogViaTitiler)
      // Description deliberately excluded — it alone shouldn't pop Advanced open;
      // only fields whose value actually diverges from doing-nothing should.
      setIsAdvancedOpen(editingSource.maxzoom !== undefined || !!editingSource.linkedBasemapId || !!editingSource.bounds
        || editingSource.nodataFloor !== undefined || editingSource.nodataFill !== undefined
        || editingSource.redFactor !== undefined || editingSource.greenFactor !== undefined
        || editingSource.blueFactor !== undefined || editingSource.baseShift !== undefined
        || !!editingSource.cogViaTitiler)
      // Re-opening the modal on an existing "cog-local" source: the File itself
      // only lives in-memory for the session it was picked in, so after a reload
      // this is null until the user picks the file again via the button below.
      setLocalFileName(editingSource.type === "cog-local" ? getLocalFileName(localFileId(editingSource.url)) : null)
      setLocalFileWarning(null)
    } else {
      setName("")
      setUrl("")
      setTypeState(((stacSearchBeta || lastType !== "stac") ? lastType : "cog") as TerrainFormType || "cog")
      setDescription("")
      setMaxzoom("")
      setLinkedBasemapId("")
      setDiffMinuendId("")
      setDiffSubtrahendId("")
      setDiffOffset("")
      setBoundsWest("")
      setBoundsSouth("")
      setBoundsEast("")
      setBoundsNorth("")
      setNodataFloor("")
      setNodataFill("")
      setRedFactor("")
      setGreenFactor("")
      setBlueFactor("")
      setBaseShift("")
      setCogViaTitiler(false)
      setIsAdvancedOpen(false)
      setLocalFileName(null)
      setLocalFileWarning(null)
    }
  }, [editingSource, isOpen])

  const handleLocalFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-picking the same filename later without a no-op change event
    if (!file) return
    const id = uuidv4() // crypto.randomUUID() throws on a non-secure context (plain HTTP)
    registerLocalFile({ id, file })
    setUrl(makeLocalFileUrl(id))
    setLocalFileName(file.name)
    setLocalFileWarning(null)
    if (!name) setName(file.name.replace(/\.(tif|tiff)$/i, ""))

    const thisFileId = ++latestFileIdRef.current
    validateLocalCogFile(file).then((result) => {
      if (latestFileIdRef.current !== thisFileId || !result) return
      if (!result.isTiled) {
        setLocalFileWarning(
          "This file is strip-organized, not internally tiled — it isn't a real Cloud-Optimized GeoTIFF, and streaming it in the browser can be very slow or crash on anything but tiny files. Re-export it with GDAL, e.g. gdal_translate -of COG src.tif out_cog.tif.",
        )
      } else if (result.epsg !== null && result.epsg !== 3857) {
        setLocalFileWarning(
          `This file is in EPSG:${result.epsg}, not Web Mercator (EPSG:3857) — the in-browser COG reader assumes 3857 and doesn't reproject, so its detected bounds/zoom range (and "Fit to bounds") will be wrong. Reproject it first, e.g. gdalwarp -t_srs EPSG:3857 -of COG src.tif out_3857.tif.`,
        )
      } else if (!result.hasOverviews) {
        setLocalFileWarning(
          "This file has no overviews (only one resolution level) — it'll work, but zoomed-out views will be slower to render since every zoom reads from the same full-resolution data.",
        )
      }
    })
  }, [name, registerLocalFile])

  // Only the types this app decodes itself can honour a nodata floor/fill —
  // titiler-mode and plain XYZ sources have no interception point (lib/nodata.ts).
  // Declared above handleSave because its dependency array reads it at render time.
  // A remote COG can opt out of the in-browser reader per source (non-3857
  // files); nodata controls only exist on that reader, so they follow it.
  // VRT is on this list too: lib/vrt-protocol.ts reads a mosaic in-browser, but
  // it needs CORS on every source file it Range-reads and refuses a tile
  // spanning more than 40 of them, so a per-source pin back to titiler is the
  // difference between "works" and "does not" for a fair number of mosaics.
  const showTitilerToggle = type === "cog" || type === "vrt"
  const showNodataFields = supportsNodataControls(type, useCogProtocol && !(showTitilerToggle && cogViaTitiler))
  // Terrain-RGB only. Terrarium is a single fixed packing with nothing to vary,
  // and cog:// / wms-raw are re-encoded to Terrarium by our own protocols before
  // maplibre sees them (see MapSources.tsx), so exposing it there would only
  // break them. Custom factors are therefore a Terrain-RGB *variant*.
  const showEncodingFields = type === "terrainrgb"

  const handleSave = useCallback(() => {
    if (!name || (isDemDiff ? !diffReady : !url)) return
    const parsedMaxzoom = maxzoom === "" ? undefined : Number(maxzoom)
    const boundsValues = [boundsWest, boundsSouth, boundsEast, boundsNorth].map((v) => Number(v))
    // All four or none — a partial bounds box isn't meaningful, so treat it the
    // same as unset rather than saving e.g. [NaN, 41, 9.8, 51.5].
    const parsedBounds = [boundsWest, boundsSouth, boundsEast, boundsNorth].every((v) => v !== "") && boundsValues.every(Number.isFinite)
      ? (boundsValues as [number, number, number, number])
      : undefined
    // Dropped entirely for a type that can't honour them, so switching type
    // doesn't leave an invisible setting behind on the saved source.
    const parseNodata = (v: string) => (!showNodataFields || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v))
    const parseEncoding = (v: string) => (!showEncodingFields || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v))
    onSave({
      id: editingSource?.id, name, url: isDemDiff ? `diff://${diffMinuendId}-${diffSubtrahendId}` : url, type: type as CustomTerrainSource["type"], description, maxzoom: parsedMaxzoom,
      ...(isDemDiff ? { diffMinuendId, diffSubtrahendId, diffOffsetM: diffOffset !== "" && Number.isFinite(Number(diffOffset)) ? Number(diffOffset) : undefined } : {}),
      linkedBasemapId: linkedBasemapId || undefined,
      bounds: parsedBounds,
      nodataFloor: parseNodata(nodataFloor),
      nodataFill: parseNodata(nodataFill),
      // Same drop-on-type-change rule as the nodata pair.
      redFactor: parseEncoding(redFactor),
      greenFactor: parseEncoding(greenFactor),
      blueFactor: parseEncoding(blueFactor),
      baseShift: parseEncoding(baseShift),
      cogViaTitiler: showTitilerToggle && cogViaTitiler ? true : undefined,
    })
    onOpenChange(false)
  }, [isDemDiff, diffReady, diffMinuendId, diffSubtrahendId, diffOffset, name, url, type, description, maxzoom, linkedBasemapId, boundsWest, boundsSouth, boundsEast, boundsNorth, nodataFloor, nodataFill, showNodataFields, redFactor, greenFactor, blueFactor, baseShift, showEncodingFields, cogViaTitiler, showTitilerToggle, editingSource, onSave, onOpenChange])

  // COG/cog-local sources detect their own zoom range from file metadata via
  // geomatico (below) rather than needing a manual field — but MapSources.tsx's
  // TerrainSources already lets customSource.maxzoom win over that detected value
  // (`customSource?.maxzoom ?? detectedMaxzoom`), so surfacing the field here too
  // (with the inferred value as a starting point) just exposes an override that
  // already worked, silently, before this. VRT has no such detection at all — it
  // streams through titiler, which doesn't report back a native zoom — so it falls
  // back to the same generic 0-20 range as WMS/TMS/TileJSON unless overridden here.
  const showMaxzoomField = type === "wms-raw" || type === "terrainrgb" || type === "terrarium" || type === "tilejson" || type === "cog" || type === "cog-local" || type === "lerc"

  const isCogType = type === "cog" || type === "cog-local"
  const cogUrlForMetadata = !isCogType ? null : type === "cog-local" ? resolveLocalFileUrl(localFileId(url)) : (url || null)
  const { data: cogMetadata, status: cogMetadataStatus } = useCogMetadata(cogUrlForMetadata)
  const inferredCogZoomRange = useMemo(() => zoomRangeFromMetadata(cogMetadata), [cogMetadata])
  const { data: cogResolution } = useCogResolution(cogUrlForMetadata)

  const url_placeholder = type === "cog" ?
    "https://example.com/terrain-dtm.cog.tiff" :
    type === "wms-raw" ?
    "https://example.com/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=...&FORMAT=image%2Fgeotiff&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=514&HEIGHT=514" :
    type === "tilejson" ?
    "https://example.com/terrain-tilejson.json" :
    "https://example.com/tms/{z}/{x}/{y}.png"

  let helper_text = ""
  if (type === "terrarium" || type === "terrainrgb") helper_text = "/{z}/{x}/{y}.png"
  else if (type === "wms-raw") helper_text = "BBOX={bbox-epsg-3857}"
  // ArcGIS orders the tile placeholders z/y/x, not z/x/y - maplibre substitutes
  // each one wherever it appears, so the native order is what to paste.
  else if (type === "lerc") helper_text = ".../ImageServer/tile/{z}/{y}/{x}"

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto" showCloseButton={false}>
        {/* pr-8: the absolute close button below sits over the header's right
            edge, and a long description ran underneath it. */}
        <DialogHeader className="pr-8 min-w-0">
          <DialogTitle className="break-words">{editingSource ? "Edit Terrain Dataset" : "Add New Terrain Dataset"}</DialogTitle>
          <DialogDescription className="break-words">{editingSource ? "Change this terrain source's settings." : "Add your own terrain data: a COG, TerrainRGB or Terrarium tiles, a WMS, or a difference of two sources."}</DialogDescription>
        </DialogHeader>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-name">Name *</Label>
            <Input id="source-name" type="text" placeholder="My Custom Terrain" value={name} onChange={(e) => setName(e.target.value)} className="cursor-text" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-type">Type *</Label>
            <Select
              value={type}
              onValueChange={(value: any) => setType(value)}
              items={{
                cog: "COG (Cloud Optimized GeoTIFF)",
                "cog-local": "Local COG file (this browser only)",
                terrarium: "TMS (Terrarium)",
                terrainrgb: "TMS (TerrainRGB)",
                "wms-picker": "WMS (list layers)",
                stac: "STAC catalog search (beta)",
                "wms-raw": "WMS (raw Float32 elevation)",
                "lerc": "ArcGIS tiled elevation (LERC)",
                tilejson: "TileJSON",
                "dem-diff": "Difference of two sources (DSM − DTM)",
                vrt: `VRT${useCogProtocol ? " (titiler mode only)" : ""}`,
              }}
            >
              <SelectTrigger id="source-type" className="cursor-pointer w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Cloud Optimized GeoTIFF</SelectLabel>
                  <SelectItem value="cog">COG (Cloud Optimized GeoTIFF)</SelectItem>
                  {/* Streams straight off the user's disk via a blob: object URL — no
                      upload, no companion server. Only ever readable via the geomatico
                      cog:// protocol (there's no titiler server that could reach a local
                      file), and the picked file only lives in this browser tab's memory —
                      it isn't saved, so it needs re-picking after a reload. */}
                  <SelectItem value="cog-local">Local COG file (this browser only)</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Tile and map services</SelectLabel>
                  <SelectItem value="terrarium">TMS (Terrarium)</SelectItem>
                  <SelectItem value="terrainrgb">TMS (TerrainRGB)</SelectItem>
                  <SelectItem value="wms-raw">WMS (raw Float32 elevation)</SelectItem>
                  <SelectItem value="lerc">ArcGIS tiled elevation (LERC)</SelectItem>
                  <SelectItem value="tilejson">TileJSON</SelectItem>
                  {/* Both modes now: titiler opens it as vrt:///vsicurl/, and in
                      browser mode lib/vrt-protocol.ts parses the mosaic's own XML
                      index and Range-reads the COGs it points at. "Always serve via
                      titiler" below is the escape hatch when the sources have no
                      CORS or a tile spans too many files. */}
                  <SelectItem value="vrt">VRT mosaic</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Derived</SelectLabel>
                  <SelectItem value="dem-diff">Difference of two sources (DSM − DTM)</SelectItem>
                </SelectGroup>
                {!editingSource && (
                  <SelectGroup>
                    <SelectLabel>Search a catalog</SelectLabel>
                    <SelectItem value="wms-picker">WMS (list layers)</SelectItem>
                    {stacSearchBeta && <SelectItem value="stac">STAC catalog search (beta)</SelectItem>}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          {type === "stac" ? (
            <Suspense fallback={<p className="text-sm text-muted-foreground py-4 text-center">Loading STAC search…</p>}>
              <StacSearchPanel target="terrain" mapRef={mapRef} onSave={(source) => { onSave({ ...source, type: "cog" }); fitTo(source.bounds) }} />
            </Suspense>
          ) : type === "wms-picker" ? (
            <WmsPickerPanel
              format="image/geotiff"
              tileSize={514}
              onSave={(params) => { onSave({ ...params, type: "wms-raw" }); onOpenChange(false) }}
            />
          ) : (
            <>
              {isDemDiff ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">A normalised height model: every tile of the first source minus the same tile of the second.</p>
                    <p>A surface model (DSM: canopy, roofs) minus a terrain model (DTM: bare ground) gives the height of what stands on the ground, with the ground itself flattened: 0 is bare earth, 25 m is a 25 m tree. Any two sources can be subtracted, e.g. two dates of the same survey for change.</p>
                    <p>The result is a terrain source like any other: 3D terrain shows those heights, and hillshade, hypsometric tint (try a 0–40 m ramp), slope, contours and the rest read the difference as elevation. Where either source has no data the difference is 0.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source-diff-a">First source (minuend, e.g. a DSM) *</Label>
                    <Select value={diffMinuendId || "none"} onValueChange={(v: any) => setDiffMinuendId(v === "none" ? "" : v)} items={diffItems}>
                      <SelectTrigger id="source-diff-a" className="cursor-pointer w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger>
                      <SelectContent className="w-[var(--anchor-width)] max-w-[calc(100vw-2rem)]">
                        <SelectItem value="none">Choose…</SelectItem>
                        {diffOperands.map((o) => <SelectItem key={o.id} value={o.id}><span className="truncate">{o.name}</span></SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source-diff-b">Second source (subtrahend, e.g. a DTM) *</Label>
                    <Select value={diffSubtrahendId || "none"} onValueChange={(v: any) => setDiffSubtrahendId(v === "none" ? "" : v)} items={diffItems}>
                      <SelectTrigger id="source-diff-b" className="cursor-pointer w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger>
                      <SelectContent className="w-[var(--anchor-width)] max-w-[calc(100vw-2rem)]">
                        <SelectItem value="none">Choose…</SelectItem>
                        {diffOperands.map((o) => <SelectItem key={o.id} value={o.id}><span className="truncate">{o.name}</span></SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {diffMinuendId && diffMinuendId === diffSubtrahendId && <p className="text-xs text-destructive">Pick two different sources.</p>}
                  <div className="space-y-2">
                    <Label htmlFor="source-diff-offset">Vertical offset added to the result (m, optional)</Label>
                    <Input id="source-diff-offset" type="number" step="0.1" placeholder="0" value={diffOffset} onChange={(e) => setDiffOffset(e.target.value)} className="cursor-text" />
                    <p className="text-[11px] text-muted-foreground">Co-registration: a 30 m reference cannot follow a gorge floor and sits above a fine DSM there, so "post-event minus GLO-30" reads several metres negative along a whole river. Sample a stable spot (a road, bare rock) with the elevation picker on both sources and enter the difference here to move the zero back.</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Both sources are read at the same tile coordinates, so they line up whatever their native resolutions; the coarser one sets the useful detail. The two must be loaded in the app (built-in or in this list), not just any URL.</p>
                </div>
              ) : type === "cog-local" ? (
                <div className="space-y-2 min-w-0 max-w-full overflow-hidden">
                  <Label htmlFor="source-local-file">COG file *</Label>
                  <input
                    ref={fileInputRef}
                    id="source-local-file"
                    type="file"
                    accept=".tif,.tiff,image/tiff"
                    className="hidden"
                    onChange={handleLocalFileChange}
                  />
                  <div className="flex items-center gap-2 min-w-0 max-w-full overflow-hidden">
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="cursor-pointer shrink-0">
                      Choose file…
                    </Button>
                    <Tooltip>
                      <TooltipTrigger render={<span className="block text-sm text-muted-foreground truncate min-w-0 flex-1 max-w-full">{localFileName ?? "No file selected"}</span>} />
                      {localFileName && <TooltipContent><p className="break-all max-w-xs">{localFileName}</p></TooltipContent>}
                    </Tooltip>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Must be:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>a real COG (Cloud-Optimized GeoTIFF, internally tiled, with overviews)</li>
                      <li>in CRS EPSG:3857 (Web Mercator)</li>
                    </ul>
                    <p>
                      No live reprojection is performed on the client, so any other CRS
                      will show wrong bounds/zoom. Directly read from disk, never
                      uploaded, and remembered locally between sessions (via OPFS) when
                      there's room — otherwise you'll be asked to re-pick it next time.
                    </p>
                  </div>
                  {localFileWarning && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">{localFileWarning}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="source-url">
                    URL * {helper_text && (
                      <span className="select-text inline-flex items-center">
                        (hint: {helper_text}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                onClick={() => handleCopyTemplate(helper_text)}
                                className="ml-1.5 cursor-pointer hover:opacity-70"
                                aria-label="Copy template"
                              >
                                {templateCopied ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            }
                          />
                          <TooltipContent><p>{templateCopied ? "Copied!" : "Copy template"}</p></TooltipContent>
                        </Tooltip>
                        )
                      </span>
                    )}
                  </Label>
                  <Input id="source-url" type="text" placeholder={url_placeholder} value={url} onChange={(e) => setUrl(e.target.value)} className="cursor-text" />
                  {type === "cog" && /^https?:\/\//.test(url.trim()) && (
                    <p className="text-[11px] text-muted-foreground">
                      Inspect this COG in the{" "}
                      <a href={`https://source-cooperative.github.io/cog-viewer/?url=${encodeURIComponent(url.trim())}`} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">source.coop viewer <ExternalLink className="h-3 w-3" /></a>
                      {" "}or{" "}
                      <a href={`https://web.geolibre.app/?data=${encodeURIComponent(url.trim())}`} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">GeoLibre <ExternalLink className="h-3 w-3" /></a>
                    </p>
                  )}
                </div>
              )}
              <Separator className="my-3" />
              <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-0.5 text-sm font-medium cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Settings2 className="h-3.5 w-3.5" />
                    Advanced
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="source-description">Description (optional)</Label>
                    <Input id="source-description" type="text" placeholder="Custom terrain data from..." value={description} onChange={(e) => setDescription(e.target.value)} className="cursor-text" />
                  </div>
                  {showMaxzoomField && (
                    <div className="space-y-2">
                      <Label htmlFor="source-maxzoom">Max Zoom (optional)</Label>
                      {isCogType && (
                        <p className="text-xs text-muted-foreground">
                          {cogUrlForMetadata === null
                            ? "Inferred native resolution zoom appears once a file/URL is set."
                            : cogMetadataStatus === "error"
                            ? "Couldn't read this file's metadata (blocked by CORS, or a network error) — set Max Zoom manually below."
                            : cogMetadata
                            ? `Inferred native resolution: zoom ${inferredCogZoomRange.maxzoom}${cogResolution ? ` (~${formatGsd(cogResolution.meanGsd)} GSD)` : ""} — override below if it's wrong.`
                            : "Detecting native resolution…"}
                        </p>
                      )}
                      <Input
                        id="source-maxzoom"
                        type="number"
                        min={0}
                        max={24}
                        placeholder={isCogType && cogMetadata ? `${inferredCogZoomRange.maxzoom} (inferred)` : "Native resolution zoom level, e.g. 17"}
                        value={maxzoom}
                        onChange={(e) => setMaxzoom(e.target.value)}
                        className="cursor-text"
                      />
                    </div>
                  )}
                  {showTitilerToggle && (
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="source-cog-via-titiler" className="block text-sm leading-snug cursor-pointer">
                        <span className="font-medium">Always serve via titiler</span>{" "}
                        <span className="font-normal text-muted-foreground">
                          {type === "vrt"
                            ? "for a mosaic whose source files have no CORS, or whose tiles span too many of them to Range-read in the browser. Overrides the global streaming setting for this source only."
                            : "for a COG not in EPSG:3857: the in-browser reader does not reproject, titiler warps it server-side. Overrides the global COG setting for this source only."}
                        </span>
                      </Label>
                      <Switch id="source-cog-via-titiler" checked={cogViaTitiler} onCheckedChange={setCogViaTitiler} className="cursor-pointer shrink-0" />
                    </div>
                  )}
                  {showEncodingFields && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5 text-sm">
                        Custom RGB Encoding (optional)
                        <Tooltip>
                          <TooltipTrigger render={<span><Info className="h-3.5 w-3.5 text-muted-foreground" /></span>} />
                          <TooltipContent>
                            <p className="max-w-xs">
                              For tile pyramids that pack elevation as neither Terrarium nor
                              Terrain-RGB: elevation = R×red + G×green + B×blue − baseShift.
                              Leave all four empty to use the encoding implied by the source type.
                              Terrarium is 256 / 1 / 0.00390625 / 32768; Terrain-RGB is
                              6553.6 / 25.6 / 0.1 / 10000.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </Label>
                      <div className="grid grid-cols-4 gap-1.5">
                        <Input type="number" inputMode="decimal" placeholder="red" value={redFactor} onChange={(e) => setRedFactor(e.target.value)} className="cursor-text text-xs" />
                        <Input type="number" inputMode="decimal" placeholder="green" value={greenFactor} onChange={(e) => setGreenFactor(e.target.value)} className="cursor-text text-xs" />
                        <Input type="number" inputMode="decimal" placeholder="blue" value={blueFactor} onChange={(e) => setBlueFactor(e.target.value)} className="cursor-text text-xs" />
                        <Input type="number" inputMode="decimal" placeholder="baseShift" value={baseShift} onChange={(e) => setBaseShift(e.target.value)} className="cursor-text text-xs" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Any one value switches this source to custom decoding; the others default
                        to the Terrain-RGB factors.
                      </p>
                    </div>
                  )}
                  {showNodataFields && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5 text-sm">
                        No-Data Floor / Fill (optional)
                        <Tooltip>
                          <TooltipTrigger render={<span><Info className="h-3.5 w-3.5 text-muted-foreground" /></span>} />
                          <TooltipContent>
                            <p className="max-w-xs">
                              Elevations at or below the floor are treated as out-of-coverage and
                              replaced with the fill, removing the spikes and pits a sentinel like
                              -9999 decodes to. Set the floor below the lowest real elevation in the
                              data. Either field alone sets both. Values are in metres after the
                              source&apos;s own scale/offset are applied. NaN samples are always
                              filled, even with both fields empty.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </Label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          id="source-nodata-floor"
                          type="number"
                          inputMode="decimal"
                          placeholder="Floor, e.g. -20"
                          value={nodataFloor}
                          onChange={(e) => setNodataFloor(e.target.value)}
                          className="cursor-text text-xs"
                        />
                        <Input
                          id="source-nodata-fill"
                          type="number"
                          inputMode="decimal"
                          placeholder="Fill, e.g. 0"
                          value={nodataFill}
                          onChange={(e) => setNodataFill(e.target.value)}
                          className="cursor-text text-xs"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {/* A COG's own SCALE/OFFSET tags decide what "metres" means here, and
                            they are not always the identity — Dura Europos' 0.5mm DSM carries
                            SCALE=-4000, which puts its whole model at NEGATIVE elevations. A
                            floor of 0 then sits above every pixel and flattens the entire
                            surface to the fill, with no error to explain it. So state the
                            transform whenever it isn't a no-op. */}
                        {isCogType && cogMetadata && (cogMetadata.scale !== 1 || cogMetadata.offset !== 0)
                          ? `Metres, after this source's own scale ×${cogMetadata.scale} / offset ${cogMetadata.offset} — set the floor below that transformed range, not the raw values. Empty = pass through untouched.`
                          : "Metres, after this source's scale/offset. Empty = pass through untouched."}
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-sm">
                      Linked Basemap Source{linkedBasemapId && " (set)"}
                      <Link className="h-3.5 w-3.5" />
                    </Label>
                    <Select
                      value={linkedBasemapId || "none"}
                      onValueChange={(value) => value && setLinkedBasemapId(value === "none" ? "" : value)}
                      items={{ none: "None", ...Object.fromEntries(customBasemapSources.map((b) => [b.id, b.name])) }}
                    >
                      <SelectTrigger id="source-linked-basemap" className="cursor-pointer w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {customBasemapSources.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Pairs this with a basemap/raster source (e.g. a fresco's DTM with its own
                      albedo photo) — selecting either one as active auto-selects the other.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Source Bounds (optional)</Label>
                      <Tooltip>
                        {/* Span wrapper keeps the tooltip working when the
                            button is disabled (no mapRef) — a disabled button
                            doesn't dispatch hover events. */}
                        <TooltipTrigger
                          render={
                            <span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 cursor-pointer"
                                disabled={!mapRef}
                                onClick={() => {
                                  const bounds = mapRef?.current?.getMap()?.getBounds()
                                  if (!bounds) return
                                  setBoundsWest(bounds.getWest().toFixed(6))
                                  setBoundsSouth(bounds.getSouth().toFixed(6))
                                  setBoundsEast(bounds.getEast().toFixed(6))
                                  setBoundsNorth(bounds.getNorth().toFixed(6))
                                }}
                              >
                                <Expand className="h-3.5 w-3.5" />
                              </Button>
                            </span>
                          }
                        />
                        <TooltipContent><p>Set to the map&apos;s current bounds</p></TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <Input type="text" inputMode="decimal" placeholder="West" value={boundsWest} onChange={(e) => setBoundsWest(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="South" value={boundsSouth} onChange={(e) => setBoundsSouth(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="East" value={boundsEast} onChange={(e) => setBoundsEast(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="North" value={boundsNorth} onChange={(e) => setBoundsNorth(e.target.value)} className="cursor-text text-xs" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      [west, south, east, north] in degrees — powers "Fit to bounds" for sources
                      whose extent can't be auto-detected (e.g. a WMS endpoint has no such
                      metadata). Leave any field empty to leave it unset.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
                <Button onClick={handleSave} disabled={!name || (isDemDiff ? !diffReady : !url)} className="cursor-pointer">{editingSource ? "Save Changes" : "Add Source"}</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
