// The catalog list and the panel's cross-mount memory, kept out of
// stac-search-panel.tsx so the Library dialog and the BYOD sections can read
// them without pulling in the panel itself - that file is deliberately
// lazy-loaded (it is large and map-bound), and a static import of any symbol
// from it would drag the whole thing into the initial bundle.
import type { StacItem, StacCollection } from "@/components/TerrainControlPanel/stac-search-panel"

export interface StacPreset {
  id: string
  name: string
  url: string
  kind: "api" | "static" | "discovery"
  /** Which modal offers it: imagery-only catalogs are pointless for terrain. */
  target: "basemap" | "terrain" | "both"
  /** "Yours" is reserved for catalogs the visitor saved themselves. */
  group: "Imagery" | "Elevation" | "Mixed" | "Registries" | "Yours"
  note?: string
}

export const STAC_PRESETS: StacPreset[] = [
  // Mixed imagery + elevation
  { id: "oam", name: "OpenAerialMap (HOT)", url: "https://api.imagery.hotosm.org/stac", kind: "api", target: "both", group: "Mixed",
    note: "Drone and aerial scenes from OpenAerialMap plus Maxar and Vantor open-data events, NOAA emergency response imagery and Copernicus GLO-30 - all keyless COGs." },
  { id: "earth-search", name: "Earth Search (AWS, Element 84)", url: "https://earth-search.aws.element84.com/v1", kind: "api", target: "both", group: "Mixed",
    note: "Sentinel-2 L2A (use the `visual` asset), Landsat, NAIP, Copernicus DEM - keyless, CORS-open." },
  { id: "eoapi", name: "eoAPI demo (Development Seed)", url: "https://stac.eoapi.dev", kind: "api", target: "both", group: "Mixed",
    note: "Maxar open-data events, OpenAerialMap, LA 2025 wildfires, Sentinel-2 mosaics, Copernicus DEM." },
  { id: "veda", name: "NASA VEDA", url: "https://openveda.cloud/api/stac", kind: "api", target: "both", group: "Mixed",
    note: "NASA's disaster and climate collections, including PlanetScope pre/post event imagery." },
  { id: "geoadmin", name: "swisstopo (data.geo.admin.ch)", url: "https://data.geo.admin.ch/api/stac/v1", kind: "api", target: "both", group: "Mixed",
    note: "SWISSIMAGE orthophotos and swissALTI3D 0.5 m COGs. Assets are in LV95 (EPSG:2056), so they are routed through titiler." },
  { id: "linz-imagery", name: "LINZ New Zealand Imagery", url: "https://nz-imagery.s3.ap-southeast-2.amazonaws.com/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Toitū Te Whenua's aerial imagery archive as COGs (NZTM2000, EPSG:2193 - routed through titiler)." },
  { id: "opentopography", name: "OpenTopography raster DEMs", url: "https://portal.opentopography.org/stac/raster_catalog.json", kind: "static", target: "terrain", group: "Elevation",
    note: "283 OpenTopography-hosted LiDAR and DEM rasters as COGs, keyless. Static catalog: collections are filtered to the view, items crawled." },
  { id: "linz-elevation", name: "LINZ New Zealand Elevation", url: "https://nz-elevation.s3.ap-southeast-2.amazonaws.com/catalog.json", kind: "static", target: "terrain", group: "Elevation",
    note: "1 m LiDAR DEM and DSM tiles (EPSG:2193 - routed through titiler)." },
  // Disaster imagery
  { id: "maxar-opendata", name: "Maxar Open Data - disaster events", url: "https://maxar-opendata.s3.dualstack.us-west-2.amazonaws.com/events/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Pre/post-event 30-50 cm ARD COGs per event (CC BY-NC 4.0). Static catalog: pick an event, items are crawled." },
  { id: "vantor-opendata", name: "Vantor Open Data - disaster events", url: "https://vantor-opendata.s3.amazonaws.com/events/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Maxar's successor programme, 2025 onwards (CC BY-NC 4.0)." },
  { id: "planet-disaster", name: "Planet disaster data releases", url: "https://data.source.coop/planet/disasterdata/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Planet Crisis Response Program imagery for major events, mirrored on Source Cooperative (Portolan registry)." },
  { id: "umbra", name: "Umbra Open SAR Data", url: "https://s3.us-west-2.amazonaws.com/umbra-open-data-catalog/stac/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Up to 16 cm synthetic-aperture radar over ~20 recurring sites, AWS Open Data. Static catalog nested by year, so crawling is slow; the geocoded (GEC) GeoTIFF of each collect is the one to load as a basemap. Radar amplitude, not an elevation model." },
  { id: "capella", name: "Capella Open SAR Data", url: "https://capella-open-data.s3.us-west-2.amazonaws.com/stac/catalog.json", kind: "static", target: "basemap", group: "Imagery",
    note: "Capella Space's open SAR sample archive on AWS. Same shape as Umbra: geocoded GeoTIFFs per collect, radar amplitude rather than terrain." },
  { id: "lgln-dop", name: "Lower Saxony orthophotos (LGLN)", url: "https://dop.stac.lgln.niedersachsen.de", kind: "api", target: "basemap", group: "Imagery",
    note: "Digital orthophotos of Niedersachsen, Germany (EPSG:25832 - routed through titiler)." },
  { id: "spot-canada", name: "SPOT orthoimages of Canada 2005-2010", url: "https://canada-spot-ortho.s3.amazonaws.com/canada_spot_orthoimages/catalog.json", kind: "static", target: "basemap", group: "Imagery" },
  // Elevation
  { id: "pgc", name: "Polar Geospatial Center (ArcticDEM, REMA, EarthDEM)", url: "https://stac.pgc.umn.edu/api/v1", kind: "api", target: "terrain", group: "Elevation",
    note: "2 m stereo-photogrammetric DEMs: ArcticDEM (>60 N) and REMA (Antarctica) as seamless mosaics or per-scene strips, and EarthDEM everywhere else as strips only - there is no EarthDEM mosaic, which is why it has no Library entry. Polar stereographic and UTM, routed through titiler. ArcticDEM and REMA are CC BY 4.0; EARTHDEM IS NOT OPENLY LICENSED - PGC restricts it to US federal employees, US federal contractors and researchers funded by the US government, so check you are eligible before using an earthdem-* collection." },
  // Federated discovery
  { id: "discovery", name: "Federated collection discovery (MAAP)", url: "https://discover-api.dit.maap-project.org", kind: "discovery", target: "both", group: "Registries",
    note: "Development Seed's stac-fastapi-collection-discovery: one collection search across several upstream STAC APIs; items come from the chosen collection's own API." },
]

export type Remembered = { presetId: string; customUrl: string; collectionId: string; startDate: string; endDate: string; viewportOnly: boolean; items: StacItem[]; collections: StacCollection[] }
export const remembered: Partial<Record<"basemap" | "terrain", Remembered>> = {}

/** Preselect a catalog for the next time the panel mounts for `target`.
 *  The Library's Catalogs section calls this on its way to opening the Add
 *  dialog, so "Browse" lands on the right catalog instead of on whatever was
 *  last used. Any remembered results are dropped: they belong to the previous
 *  catalog and would be listed under the new one's name until the first
 *  search replaced them. */
export function seedStacPreset(target: "basemap" | "terrain", presetId: string) {
  const prev = remembered[target]
  remembered[target] = {
    startDate: prev?.startDate ?? "",
    endDate: prev?.endDate ?? "",
    viewportOnly: prev?.viewportOnly ?? true,
    presetId,
    customUrl: "",
    collectionId: "",
    items: [],
    collections: [],
  }
}

