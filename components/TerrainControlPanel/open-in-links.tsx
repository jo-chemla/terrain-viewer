import type React from "react"
import { useCallback, useState } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { SquareArrowOutUpRight, ChevronDown, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { MapRef } from "react-map-gl/maplibre"

type OpenInContext = {
  lat: number
  lng: number
  zoom: number
  bounds: { west: number; south: number; east: number; north: number } | null
  latestWaybackRelease: number | null
}

type OpenInDestination = {
  id: string
  label: string
  buildUrl: (ctx: OpenInContext) => string | null
  /** True only for user-added entries (customOpenInDestinationsAtom) — gates
   *  the delete icon in the dropdown row; the 5 built-in destinations below
   *  aren't removable. */
  isCustom?: boolean
}

// Viewport-aware "open the same spot in another historical-imagery viewer"
// launcher — URL templates adapted from Iconem's own historical-satellite
// LinksSection reference component (Google Earth Web, ESRI Wayback, BBBike
// MapCompare) plus two more Iconem tools (historical-satellite.iconem.com,
// search-eo-imagery.iconem.com), both using a #zoom/lat/lng fragment.
// Qiusheng Wu's Timelapse tool was dropped per request. Single-select only
// (not a multi-select "open several at once") — most browsers' popup
// blockers only reliably allow ONE window.open() per direct user gesture;
// looping over several synchronously still got silently blocked for every
// call after the first in practice.
export const OPEN_IN_DESTINATIONS: OpenInDestination[] = [
  {
    id: "iconem-river-rem",
    label: "Iconem River-REM",
    buildUrl: ({ lat, lng, zoom }) => `https://rem.prod.heritagewatch.ai/?lng=${lng}&lat=${lat}&zoom=${zoom}`,
  },
  {
    id: "iconem-search-eo",
    label: "Iconem Search-EO",
    buildUrl: ({ lat, lng, zoom }) => `https://search-eo-imagery.iconem.com/#${Math.round(zoom)}/${lat}/${lng}`,
  },
  {
    id: "esri-wayback",
    label: "ESRI Wayback Machine",
    buildUrl: ({ lat, lng, zoom, latestWaybackRelease }) => {
      if (!latestWaybackRelease) return null
      return `https://livingatlas.arcgis.com/wayback/#mapCenter=${lng}%2C${lat}%2C${Math.round(zoom)}&mode=explore&active=${latestWaybackRelease}`
    },
  },
  {
    id: "google-maps-3d",
    label: "Google Maps 3D",
    // Same opaque-altitude style as Google Earth Web above, applied to Maps'
    // own `@lat,lng,{altitude}a,{fov}y,{tilt}t/data=!3m1!1e3` 3D-mode URL
    // shape (reverse-engineered from a real "toggle 3D" session — the `y`
    // field stayed fixed at 35 across every capture, so it's hardcoded here
    // too rather than derived). `!3m1!1e3` is what actually selects the 3D
    // globe layer; `entry=ttu` matches real Maps-UI-originated links.
    buildUrl: ({ lat, lng, zoom }) => {
      const altitude = ((38000 * 4096) / Math.pow(2, zoom)) * Math.cos((lat * Math.PI) / 180)
      return `https://www.google.com/maps/@${lat},${lng},${altitude}a,35y,45t/data=!3m1!1e3?entry=ttu`
    },
  },
  {
    id: "google-earth-web",
    label: "Google Earth Historical (web)",
    // The `data=` payload is opaque protobuf, reverse-engineered from a
    // real Google Earth Web session rather than derived — captured
    // directly off a live "2D + Historical layer on" URL, tilt (`t`) fixed
    // at 0 for the top-down 2D framing.
    buildUrl: ({ lat, lng, zoom }) => {
      const altitude = ((38000 * 4096) / Math.pow(2, zoom)) * Math.cos((lat * Math.PI) / 180)
      return `https://earth.google.com/web/@${lat},${lng},0a,${altitude}d,35y,0h,0t,0r/data=CgwqBggBEgAYAUICCAE6AwoBMEICCABKDQj___________8BEAA`
    },
  },
  {
    id: "google-earth-web-3d",
    label: "Google Earth 3D (web)",
    // Same altitude formula as the Historical destination above; a
    // different (shorter) `data=` payload — the Historical-layer flag isn't
    // set in this one — and tilt (`t`) fixed at 60 for a 3D-oblique framing.
    buildUrl: ({ lat, lng, zoom }) => {
      const altitude = ((38000 * 4096) / Math.pow(2, zoom)) * Math.cos((lat * Math.PI) / 180)
      return `https://earth.google.com/web/@${lat},${lng},0a,${altitude}d,35y,0h,60t,0r/data=CgRCAggBOgMKATBCAggASg0I____________ARAA`
    },
  },
  {
    id: "bbbike-mapcompare",
    label: "BBBike MapCompare",
    buildUrl: ({ lat, lng, zoom }) =>
      `https://mc.bbbike.org/mc/?lon=${lng}&lat=${lat}&zoom=${Math.round(zoom)}&num=4&mt0=mapnik-german&mt1=cyclemap&mt2=bing-hybrid`,
  },
  // Commented out per request — kept for reference, not shown in the list.
  // {
  //   id: "google-3d-area-explorer",
  //   label: "Google 3D Area Explorer",
  //   // Same permalink already used by the "Google 3D Tiles" terrain source's
  //   // own documentation link (lib/terrain-sources.ts's google3dtiles.link,
  //   // opened via terrain-source-section.tsx's linkCallback/templateLink) —
  //   // a fixed-orbit 3D camera over Google's Photorealistic 3D Tiles at a
  //   // given lat/lng, independent of this app's own terrain/basemap sources.
  //   buildUrl: ({ lat, lng }) =>
  //     `https://goo.gle/3d-area-explorer-admin#camera.orbitType=fixed-orbit&location.coordinates.lat=${lat}&location.coordinates.lng=${lng}`,
  // },
  // {
  //   id: "iconem-historical",
  //   label: "Iconem Historical Satellite",
  //   buildUrl: ({ lat, lng, zoom }) => `https://historical-satellite.iconem.com/#${Math.round(zoom)}/${lat}/${lng}`,
  // },
  // TODO (noted for later, not yet implemented): "open in GeoLibre".
]

const DEFAULT_SELECTED = "google-earth-web"
export const openInSelectedAtom = atomWithStorage<string>("openInSelectedDestination", DEFAULT_SELECTED)

interface CustomOpenInDestination {
  id: string
  name: string
  /** e.g. "https://example.com/#{z}/{x}/{y}" or "https://example.com/?lat={lat}&lng={lng}&zoom={zoom}"
   *  — both placeholder families are supported (see buildCustomUrl below). */
  template: string
}
export const customOpenInDestinationsAtom = atomWithStorage<CustomOpenInDestination[]>("customOpenInDestinations", [])

/** Standard Web Mercator slippy-tile math (the same convention MapLibre/OSM/
 *  Bing all use) — lets a custom template address a specific {z}/{x}/{y}
 *  tile, not just a lat/lng/zoom viewer URL. */
function lngLatToTileXYZ(lng: number, lat: number, zoom: number): { z: number; x: number; y: number } {
  const z = Math.round(zoom)
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { z, x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) }
}

const TEMPLATE_PLACEHOLDER_RE = /\{lat\}|\{lng\}|\{zoom\}|\{z\}|\{x\}|\{y\}/

function buildCustomUrl(template: string, { lat, lng, zoom }: OpenInContext): string {
  const { z, x, y } = lngLatToTileXYZ(lng, lat, zoom)
  return template
    .replace(/\{lat\}/g, String(lat))
    .replace(/\{lng\}/g, String(lng))
    .replace(/\{zoom\}/g, String(zoom))
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y))
}

const AddCustomDestinationModal: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (dest: CustomOpenInDestination) => void
}> = ({ open, onOpenChange, onAdd }) => {
  const [name, setName] = useState("")
  const [template, setTemplate] = useState("")
  const hasPlaceholder = TEMPLATE_PLACEHOLDER_RE.test(template)
  const canAdd = name.trim().length > 0 && hasPlaceholder

  const handleAdd = () => {
    if (!canAdd) return
    onAdd({ id: `custom-${Date.now()}`, name: name.trim(), template: template.trim() })
    setName("")
    setTemplate("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add a custom "Open in…" destination</DialogTitle>
          <DialogDescription>
            A URL template for the current view — either a lat/lng/zoom viewer or a specific tile.
          </DialogDescription>
        </DialogHeader>
        <DialogClose className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100">✕</DialogClose>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="custom-open-in-name">Name *</Label>
            <Input id="custom-open-in-name" type="text" placeholder="My Viewer" value={name} onChange={(e) => setName(e.target.value)} className="cursor-text" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-open-in-template">URL template *</Label>
            <Input
              id="custom-open-in-template"
              type="text"
              placeholder="https://example.com/#{z}/{x}/{y}"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="cursor-text font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Supports <code>{"{z}/{x}/{y}"}</code> (standard slippy-tile coordinates, derived from the current
              view) or <code>{"{lat}/{lng}/{zoom}"}</code> — at least one placeholder is required.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
          <Button onClick={handleAdd} disabled={!canAdd} className="cursor-pointer">Add</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export const OpenInLinksButton: React.FC<{
  state: any
  mapRef: React.RefObject<MapRef>
  waybackLatestRelease: number | null
  /** e.g. "w-full" when this is the only control on its row (sidebar usage)
   *  instead of paired against a Label in a justify-between row (its
   *  original, narrower, timeline-footer usage). */
  className?: string
}> = ({ state, mapRef, waybackLatestRelease, className }) => {
  const [selectedId, setSelectedId] = useAtom(openInSelectedAtom)
  const [customDestinations, setCustomDestinations] = useAtom(customOpenInDestinationsAtom)
  // Controlled (not left to the menu's own default close-on-select) — the
  // popup should close as soon as a destination is picked, not linger while
  // window.open() spins up the new tab.
  const [menuOpen, setMenuOpen] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)

  // User-added entries slot in after the built-ins — same lookup-by-id shape
  // (buildUrl) as the built-ins, so every existing selectAndOpen/handleOpen/
  // buttonLabel codepath below works on either kind with no branching.
  const allDestinations: OpenInDestination[] = [
    ...OPEN_IN_DESTINATIONS,
    ...customDestinations.map((c): OpenInDestination => ({
      id: c.id,
      label: c.name,
      buildUrl: (ctx) => buildCustomUrl(c.template, ctx),
      isCustom: true,
    })),
  ]

  const buildContext = useCallback((): OpenInContext => {
    const bounds = mapRef.current?.getMap()?.getBounds()
    return {
      lat: state.lat,
      lng: state.lng,
      zoom: state.zoom,
      bounds: bounds ? { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() } : null,
      latestWaybackRelease: waybackLatestRelease,
    }
  }, [mapRef, state.lat, state.lng, state.zoom, waybackLatestRelease])

  const openDestination = useCallback((id: string) => {
    const dest = allDestinations.find((d) => d.id === id)
    const url = dest?.buildUrl(buildContext())
    if (url) window.open(url, "_blank", "noopener,noreferrer")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildContext, customDestinations])

  // Picking a destination from the dropdown both opens it immediately AND
  // remembers it as the default — so next time, just click the main button.
  // Closes the popup FIRST, before window.open() — a new tab stealing focus
  // can otherwise race the popup's own closing animation and leave it stuck
  // open behind the new tab.
  const selectAndOpen = useCallback((id: string) => {
    setSelectedId(id)
    setMenuOpen(false)
    openDestination(id)
  }, [setSelectedId, openDestination])

  const handleOpen = useCallback(() => openDestination(selectedId), [openDestination, selectedId])

  const removeCustomDestination = useCallback((id: string) => {
    setCustomDestinations((list) => list.filter((d) => d.id !== id))
    // A removed entry can't stay the remembered default — falls back to the
    // same default the very first visit would have.
    if (selectedId === id) setSelectedId(DEFAULT_SELECTED)
  }, [setCustomDestinations, selectedId, setSelectedId])

  const buttonLabel = allDestinations.find((d) => d.id === selectedId)?.label ?? OPEN_IN_DESTINATIONS[0].label

  return (
    <div className={cn("flex items-stretch rounded-md border border-border/60 overflow-hidden shrink-0", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={handleOpen}
              className="cursor-pointer flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <SquareArrowOutUpRight className="h-3 w-3 shrink-0" />
              <span>Open in {buttonLabel}</span>
            </button>
          }
        />
        <TooltipContent><p>Open in {buttonLabel}</p></TooltipContent>
      </Tooltip>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                // No explicit height class here deliberately — the wrapper's
                // own height is content-driven (not an explicit px/rem
                // value), so a child's "height: 100%" (h-full) can't resolve
                // against it and silently falls back to auto (a classic CSS
                // percentage-height footgun), leaving this button shorter
                // than its sibling and the hover background clipped to just
                // the icon. Omitting it lets the wrapper's own
                // items-stretch do its job instead, sizing this button to
                // match the row's actual height.
                "cursor-pointer flex items-center px-1 py-0.5 rounded-r-md text-muted-foreground border-l border-border/60",
                "hover:bg-accent hover:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground",
              )}
              aria-label="Choose destination"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuRadioGroup value={selectedId} onValueChange={selectAndOpen}>
            {allDestinations.map((dest) => (
              <DropdownMenuRadioItem key={dest.id} value={dest.id}>
                <span className="flex-1 truncate">{dest.label}</span>
                {dest.isCustom && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Remove ${dest.label}`}
                          onClick={(e) => { e.stopPropagation(); removeCustomDestination(dest.id) }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="cursor-pointer shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      }
                    />
                    <TooltipContent><p>Remove {dest.label}</p></TooltipContent>
                  </Tooltip>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => { setMenuOpen(false); setAddModalOpen(true) }}
            className="cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add custom…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddCustomDestinationModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        onAdd={(dest) => {
          setCustomDestinations((list) => [...list, dest])
          selectAndOpen(dest.id)
        }}
      />
    </div>
  )
}
