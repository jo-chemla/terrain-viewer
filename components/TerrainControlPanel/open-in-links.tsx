import type React from "react"
import { useCallback } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { SquareArrowOutUpRight, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
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
    id: "google-earth-web",
    label: "Google Earth Web",
    buildUrl: ({ lat, lng, zoom }) => {
      const altitude = ((38000 * 4096) / Math.pow(2, zoom)) * Math.cos((lat * Math.PI) / 180)
      return `https://earth.google.com/web/@${lat},${lng},0a,${altitude}d,35y,0h,0t,0r/data=CgwqBggBEgAYAUICCAE6AwoBMEoNCP___________wEQAA`
    },
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
    id: "bbbike-mapcompare",
    label: "BBBike MapCompare",
    buildUrl: ({ lat, lng, zoom }) =>
      `https://mc.bbbike.org/mc/?lon=${lng}&lat=${lat}&zoom=${Math.round(zoom)}&num=4&mt0=mapnik-german&mt1=cyclemap&mt2=bing-hybrid`,
  },
  {
    id: "iconem-historical",
    label: "Iconem Historical Satellite",
    buildUrl: ({ lat, lng, zoom }) => `https://historical-satellite.iconem.com/#${Math.round(zoom)}/${lat}/${lng}`,
  },
  {
    id: "iconem-search-eo",
    label: "Iconem Search-EO",
    buildUrl: ({ lat, lng, zoom }) => `https://search-eo-imagery.iconem.com/#${Math.round(zoom)}/${lat}/${lng}`,
  },
]

const DEFAULT_SELECTED = "google-earth-web"
export const openInSelectedAtom = atomWithStorage<string>("openInSelectedDestination", DEFAULT_SELECTED)

export const OpenInLinksButton: React.FC<{
  state: any
  mapRef: React.RefObject<MapRef>
  waybackLatestRelease: number | null
}> = ({ state, mapRef, waybackLatestRelease }) => {
  const [selectedId, setSelectedId] = useAtom(openInSelectedAtom)

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
    const dest = OPEN_IN_DESTINATIONS.find((d) => d.id === id)
    const url = dest?.buildUrl(buildContext())
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }, [buildContext])

  // Picking a destination from the dropdown both opens it immediately AND
  // remembers it as the default — so next time, just click the main button.
  const selectAndOpen = useCallback((id: string) => {
    setSelectedId(id)
    openDestination(id)
  }, [setSelectedId, openDestination])

  const handleOpen = useCallback(() => openDestination(selectedId), [openDestination, selectedId])

  const buttonLabel = OPEN_IN_DESTINATIONS.find((d) => d.id === selectedId)?.label ?? OPEN_IN_DESTINATIONS[0].label

  return (
    <div className="flex items-stretch rounded-md border border-border/60 overflow-hidden shrink-0">
      <button
        type="button"
        onClick={handleOpen}
        className="cursor-pointer flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title={`Open in ${buttonLabel}`}
      >
        <SquareArrowOutUpRight className="h-3 w-3 shrink-0" />
        <span>Open in {buttonLabel}</span>
      </button>
      <DropdownMenu>
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
            {OPEN_IN_DESTINATIONS.map((dest) => (
              <DropdownMenuRadioItem key={dest.id} value={dest.id}>
                {dest.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
