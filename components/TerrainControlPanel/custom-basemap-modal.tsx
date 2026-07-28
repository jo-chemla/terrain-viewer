import type React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useAtom, useSetAtom } from "jotai"
import { v4 as uuidv4 } from "uuid"
import { ChevronDown, Link, Settings2, Expand } from "lucide-react"
import type { MapRef } from "react-map-gl/maplibre"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SegmentedToggle } from "./controls-components"
import { type CustomBasemapSource, customTerrainSourcesAtom } from "@/lib/settings-atoms"
import { registerLocalFileAtom, makeLocalFileUrl, localFileId, getLocalFileName, validateLocalCogFile } from "@/lib/local-file-store"
import { NextGisQmsSearchPanel } from "./nextgis-qms-search-modal"
import { WmsPickerPanel } from "./wms-picker-panel"

type BasemapFormType = "cog" | "cog-local" | "tms" | "wms" | "wmts" | "qms" | "tilejson" | "wms-picker"

export const CustomBasemapModal: React.FC<{
  isOpen: boolean; onOpenChange: (open: boolean) => void; editingSource: CustomBasemapSource | null
  onSave: (source: Omit<CustomBasemapSource, "id"> & { id?: string }) => void
  // Applies opacity straight to the live source (bypassing onSave) as the
  // slider drags, so you can see the blend against the map while adjusting it
  // instead of only after committing — unlike every other field here (name,
  // url, type, role...), which stay purely local state until Save/Add is
  // clicked. Only meaningful while editing an existing (already-rendered)
  // source; there's nothing on the map yet for a brand-new one to preview
  // against, so this is omitted for the "Add New Basemap" flow.
  onLiveOpacityChange?: (opacity: number) => void
  mapRef?: React.RefObject<MapRef>
}> = ({ isOpen, onOpenChange, editingSource, onSave, onLiveOpacityChange, mapRef }) => {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [type, setType] = useState<BasemapFormType>("tms")
  const [description, setDescription] = useState("")
  const [role, setRole] = useState<CustomBasemapSource["role"]>("basemap")
  const [opacity, setOpacity] = useState(100)
  // Pairs this basemap/raster source with a terrain one (e.g. a fresco's
  // albedo photo COG paired with its own DTM) — "" means unlinked. See
  // CustomBasemapSource.linkedTerrainId; the reverse Select lives in
  // custom-terrain-source-modal.tsx and either side is enough to link the pair.
  const [linkedTerrainId, setLinkedTerrainId] = useState("")
  // [west, south, east, north] as free-text draft strings — mirrors
  // CustomBasemapSource.bounds, manually settable for sources (e.g. WMS/WMTS)
  // whose extent can't be auto-detected the way COG metadata is.
  const [boundsWest, setBoundsWest] = useState("")
  const [boundsSouth, setBoundsSouth] = useState("")
  const [boundsEast, setBoundsEast] = useState("")
  const [boundsNorth, setBoundsNorth] = useState("")
  // Folded by default — most sources need neither a linked pair nor manual
  // bounds, so this stays out of the way unless deliberately expanded.
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [customTerrainSources] = useAtom(customTerrainSourcesAtom)
  // The opacity editingSource had when the modal opened — restored on Cancel/
  // close-without-saving so a live-previewed drag doesn't stick if abandoned.
  const originalOpacityRef = useRef(100)
  const savedRef = useRef(false)
  const [localFileName, setLocalFileName] = useState<string | null>(null)
  const [localFileWarning, setLocalFileWarning] = useState<string | null>(null)
  const registerLocalFile = useSetAtom(registerLocalFileAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Guards against an in-flight validateLocalCogFile from a previous pick
  // resolving after (and clobbering the warning for) a newer one — a plain
  // event handler has no useEffect-style cleanup to cancel it with.
  const latestFileIdRef = useRef(0)

  useEffect(() => {
    // Only (re-)initialize on the open transition — this effect also depends
    // on isOpen so switching which source is being edited while the dialog
    // opens still picks up fresh values, but running it again on CLOSE would
    // reset savedRef.current to false right after handleSave had just set it
    // to true, making the close-revert effect below think Save was never
    // clicked and stomp the just-saved opacity back to its original value.
    if (!isOpen) return
    if (editingSource) {
      setName(editingSource.name)
      setUrl(editingSource.url)
      setType(editingSource.type)
      setDescription(editingSource.description || "")
      setRole(editingSource.role ?? "basemap")
      setOpacity(editingSource.opacity ?? 100)
      originalOpacityRef.current = editingSource.opacity ?? 100
      setLinkedTerrainId(editingSource.linkedTerrainId ?? "")
      setBoundsWest(editingSource.bounds ? String(editingSource.bounds[0]) : "")
      setBoundsSouth(editingSource.bounds ? String(editingSource.bounds[1]) : "")
      setBoundsEast(editingSource.bounds ? String(editingSource.bounds[2]) : "")
      setBoundsNorth(editingSource.bounds ? String(editingSource.bounds[3]) : "")
      setIsAdvancedOpen(!!editingSource.linkedTerrainId || !!editingSource.bounds)
      // Re-opening the modal on an existing "cog-local" source: the File itself
      // only lives in-memory for the session it was picked in, so after a reload
      // this is null until the user picks the file again via the button below.
      setLocalFileName(editingSource.type === "cog-local" ? getLocalFileName(localFileId(editingSource.url)) : null)
      setLocalFileWarning(null)
    } else {
      setName("")
      setUrl("")
      setType("tms")
      setDescription("")
      setRole("basemap")
      setOpacity(100)
      setLinkedTerrainId("")
      setBoundsWest("")
      setBoundsSouth("")
      setBoundsEast("")
      setBoundsNorth("")
      setIsAdvancedOpen(false)
      setLocalFileName(null)
      setLocalFileWarning(null)
    }
    savedRef.current = false
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

  // Roll back a live-previewed opacity if the dialog closes without Save —
  // fires on the isOpen:true->false transition, whichever way it closes
  // (Cancel, the X button, Escape, or an outside click all funnel through
  // Dialog's onOpenChange).
  useEffect(() => {
    if (isOpen) return
    if (!savedRef.current && editingSource && onLiveOpacityChange) {
      onLiveOpacityChange(originalOpacityRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleOpacityChange = useCallback((value: number) => {
    setOpacity(value)
    if (editingSource) onLiveOpacityChange?.(value)
  }, [editingSource, onLiveOpacityChange])

  const handleSave = useCallback(() => {
    if (!name || !url) return
    savedRef.current = true
    const boundsValues = [boundsWest, boundsSouth, boundsEast, boundsNorth].map((v) => Number(v))
    // All four or none — a partial bounds box isn't meaningful, so treat it the
    // same as unset rather than saving e.g. [NaN, 41, 9.8, 51.5].
    const parsedBounds = [boundsWest, boundsSouth, boundsEast, boundsNorth].every((v) => v !== "") && boundsValues.every(Number.isFinite)
      ? (boundsValues as [number, number, number, number])
      : undefined
    onSave({
      id: editingSource?.id, name, url, type: type as CustomBasemapSource["type"], description, role, opacity,
      linkedTerrainId: linkedTerrainId || undefined,
      bounds: parsedBounds,
    })
    onOpenChange(false)
  }, [name, url, type, description, role, opacity, linkedTerrainId, boundsWest, boundsSouth, boundsEast, boundsNorth, editingSource, onSave, onOpenChange])

  const url_placeholder = type === "cog" ?
    "https://example.com/basemap.cog.tiff" :
    (type === "tms") ?
      "https://example.com/tms/{z}/{x}/{y}.png" :
      type === "wms" ?
        "http://tiles.example.com/wms?bbox={bbox-epsg-3857}&format=image/png&service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&width=256&height=256&layers=example" :
        type === "tilejson" ?
          "https://example.com/basemap-tilejson.json" :
          "Not supported type"

  let helper_text = ""
  if (type === "tms") helper_text = '/{z}/{x}/{y}.png'
  else if (type === "wms") helper_text = 'bbox={bbox-epsg-3857}'
  
  // Only WMS URLs need this — re-serializing via `new URL(...).toString()` percent-
  // encodes literal `{`/`}` characters, which would corrupt a TMS/XYZ/TileJSON URL's
  // `{z}/{x}/{y}` placeholders (e.g. tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png
  // failing to fetch because its braces got encoded to %7Bz%7D etc).
  const normalizeBboxParam = (input: string) => {
    if (type !== "wms") return input
    try {
      const parsedUrl = new URL(input);
      if (parsedUrl.searchParams.has("bbox")) {
        parsedUrl.searchParams.set("bbox", "{bbox-epsg-3857}");
      }
      return parsedUrl.toString();
    } catch {
      return input;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {editingSource ? "Edit Basemap" : "Add New Basemap"}
          </DialogTitle>
          <DialogDescription>
            Add your own basemap from a raster tile or vector style endpoint.
          </DialogDescription>
        </DialogHeader>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">
          ✕
        </DialogClose>
        <div className="space-y-4 min-w-0">
          <div className="space-y-2">
            <Label htmlFor="basemap-type">Type *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
              <SelectTrigger id="basemap-type" className="cursor-pointer w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tms">TMS/XYZ (Raster Tile)</SelectItem>
                <SelectItem value="cog">COG (Cloud Optimized Geotiff)</SelectItem>
                {/* Streams straight off the user's disk via a blob: object URL — no
                    upload, no companion server. Only ever readable via the geomatico
                    cog:// protocol, and the picked file only lives in this browser
                    tab's memory — it isn't saved, so it needs re-picking after a
                    reload (mirrors "Local COG file" on the Terrain Source side). */}
                <SelectItem value="cog-local">Local COG file (this browser only)</SelectItem>
                <SelectItem value="wms">Raster (WMS / WMTS)</SelectItem>
                <SelectItem value="tilejson">TileJSON (Raster Basemap)</SelectItem>
                {!editingSource && <SelectItem value="wms-picker">WMS (list layers)</SelectItem>}
                {!editingSource && <SelectItem value="qms">NextGIS QMS (search)</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {type === "qms" ? (
            <NextGisQmsSearchPanel onSave={(source) => { onSave(source); onOpenChange(false) }} />
          ) : type === "wms-picker" ? (
            <WmsPickerPanel
              format="image/png"
              tileSize={256}
              onSave={(params) => { onSave({ ...params, type: "wms" }); onOpenChange(false) }}
            />
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="basemap-name">Name *</Label>
                <Input
                  id="basemap-name"
                  type="text"
                  placeholder="My Custom Basemap"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="cursor-text"
                />
              </div>
              {type === "cog-local" ? (
                <div className="space-y-2">
                  <Label htmlFor="basemap-local-file">COG file *</Label>
                  <p className="text-xs text-muted-foreground">
                    Must be a real COG (Cloud-Optimized GeoTIFF, internally tiled, with
                    overviews) in CRS EPSG:3857 (Web Mercator) — the in-browser reader
                    doesn't reproject, so any other CRS will show wrong bounds/zoom.
                  </p>
                  <input
                    ref={fileInputRef}
                    id="basemap-local-file"
                    type="file"
                    accept=".tif,.tiff,image/tiff"
                    className="hidden"
                    onChange={handleLocalFileChange}
                  />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="cursor-pointer">
                      Choose file…
                    </Button>
                    <span className="text-sm text-muted-foreground truncate min-w-0">
                      {localFileName ?? "No file selected"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Read directly from disk, never uploaded. This browser remembers it
                    locally between sessions (via OPFS) when that's supported and there's
                    room — otherwise you'll be asked to re-pick it next time.
                  </p>
                  {localFileWarning && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">{localFileWarning}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="basemap-url">
                    URL * {helper_text && <span className="select-text">(hint: {helper_text})</span>}
                  </Label>
                  <Input
                    id="basemap-url"
                    type="text"
                    placeholder={url_placeholder}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={(e) => {
                      const normalized = normalizeBboxParam(e.target.value);
                      setUrl(normalized);
                    }}
                    className="cursor-text"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Use as</Label>
                <SegmentedToggle
                  className="w-full"
                  value={(role ?? "basemap") as NonNullable<CustomBasemapSource["role"]>}
                  onChange={(value) => setRole(value)}
                  options={[
                    { value: "basemap" as NonNullable<CustomBasemapSource["role"]>, label: "Basemap" },
                    { value: "overlay" as NonNullable<CustomBasemapSource["role"]>, label: "Overlay" },
                  ]}
                />
                <p className="text-xs text-muted-foreground">
                  Overlays stack on top of the active basemap instead of replacing it — only available in Split/Radio basemap mode.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="basemap-description">
                  Description (optional)
                </Label>
                <Input
                  id="basemap-description"
                  type="text"
                  placeholder="Custom basemap from..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="cursor-text"
                />
              </div>
              {/* Named "Style" (rather than folded into the fields above) so it
                  reads as a display preference belonging to this saved source —
                  not a live per-session slider like the main Raster Basemap
                  Opacity control, which still applies on top of this one. */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Style</p>
                <div className="flex items-center justify-between">
                  <Label htmlFor="basemap-opacity" className="text-sm">Opacity</Label>
                  <span className="text-sm text-muted-foreground">{opacity}%</span>
                </div>
                <Slider
                  id="basemap-opacity"
                  min={0}
                  max={100}
                  step={1}
                  value={[opacity]}
                  onValueChange={([value]) => handleOpacityChange(value)}
                  className="cursor-pointer"
                />
              </div>
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
                    <Label className="flex items-center gap-1.5 text-sm">
                      <Link className="h-3.5 w-3.5" />
                      Linked Terrain Source{linkedTerrainId && " (set)"}
                    </Label>
                    <Select value={linkedTerrainId || "none"} onValueChange={(value) => setLinkedTerrainId(value === "none" ? "" : value)}>
                      <SelectTrigger id="basemap-linked-terrain" className="cursor-pointer w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {customTerrainSources.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Pairs this with a terrain/elevation source (e.g. a fresco's albedo photo
                      with its own DTM) — selecting either one as active auto-selects the other.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Source Bounds (optional)</Label>
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
                        title="Set to the map's current bounds"
                      >
                        <Expand className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <Input type="text" inputMode="decimal" placeholder="West" value={boundsWest} onChange={(e) => setBoundsWest(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="South" value={boundsSouth} onChange={(e) => setBoundsSouth(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="East" value={boundsEast} onChange={(e) => setBoundsEast(e.target.value)} className="cursor-text text-xs" />
                      <Input type="text" inputMode="decimal" placeholder="North" value={boundsNorth} onChange={(e) => setBoundsNorth(e.target.value)} className="cursor-text text-xs" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      [west, south, east, north] in degrees — powers "Fit to bounds" for sources
                      whose extent can't be auto-detected (e.g. a WMS/WMTS endpoint has no such
                      metadata). Leave any field empty to leave it unset.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!name || !url}
                  className="cursor-pointer"
                >
                  {editingSource ? "Save Changes" : "Add Basemap"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
