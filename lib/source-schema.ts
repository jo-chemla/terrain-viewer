// One schema for every tile source the app lists: the terrain sources (the
// Worldwide Defaults of lib/terrain-sources.ts, the terrain library of
// lib/custom-sources.json, the user's own in Bring Your Own Data) and the
// raster basemaps and overlays (the built-ins of lib/basemap-sources.ts, the
// basemap library, the user's own). A source is the same record wherever it
// is listed; only `section` says where it surfaces.
//
//   SourceEntryBase      the fields every source shares (address, zoom range,
//                        extent, documentation, provenance, library flags)
//   TerrainSourceEntry   + an elevation transport and its decoding knobs
//   RasterSourceEntry    + an imagery transport and its display knobs
//
// `kind` and `section` are optional on purpose: the lists saved in a
// browser's localStorage (customTerrainSources, customBasemapSources) and the
// library file predate them, and the list an entry sits in already says both
// (sourceKind / sourceSection below fill them in). Ids never change: a shared
// link names a source by id (?terrainSourceA=mapterhorn, ?sourceB=<library id>).
//
// Types only, plus a few pure helpers: lib/terrain-sources.ts imports it by
// type, and stays importable by Node without a bundler (docs/scripts and
// tile-server/build.mjs import it directly).

/** Elevation or imagery. */
export type SourceKind = "terrain" | "raster"

/** Where a source surfaces: "defaults" (the Worldwide Defaults / the built-in
 *  basemap picker, shipped with the app), "library" (the Library dialogs,
 *  lib/custom-sources.json), "custom" (the user's own list, Bring Your Own
 *  Data; a library entry keeps its id once added there). */
export type SourceSection = "defaults" | "library" | "custom"

/** The API key a source's tiles need, by the app's setting name (the jotai
 *  atom's storage key, and the tile service's request parameter). A `{API_KEY}`
 *  placeholder in `url` is filled with it; a source is hidden from the
 *  pickers until its key is set. */
export type SourceApiKey = "mapboxKey" | "maptilerKey" | "cesiumIonKey" | "hereKey" | "planetKey"

/** A Library entry's catalog search: the STAC preset (an id in
 *  lib/stac-presets.ts's STAC_PRESETS) and the collection to preselect in it.
 *  For an API catalog `collection` is the collection id; for a static one
 *  (OpenTopography, LINZ) it is the absolute URL of the child collection.json,
 *  which is how the search panel identifies those. Omitted, the whole catalog
 *  is searched. An entry carrying it gets a Browse button in the Library;
 *  see LibraryBrowseEntry for the ones that have nothing else. */
export interface LibraryStacLink {
  preset: string
  collection?: string
}

/** The fields every source shares, terrain or raster. */
export interface SourceEntryBase {
  /** Stable id: the URL state (?terrainSourceA=, ?basemapSourceA=) and every
   *  cross-reference (diff operands, linked pairs) name a source by it. */
  id: string
  name: string
  /** Compact label (a map pill, a capture-date chip); derived from `name`
   *  when absent (terrainShortLabel). */
  shortName?: string
  kind?: SourceKind
  section?: SourceSection
  /** Position within its section, lowest first; list order when absent. */
  order?: number
  /** The address: a tile template with {z}/{x}/{y} (or {bbox-epsg-3857}), a
   *  COG / VRT / TileJSON / annotation URL, one of the app's prefixes
   *  (pmtiles://, epsg3395://, epsg4326://, gem15://...), or, for type "cog-local" /
   *  "image-local", a `local://<id>` placeholder (lib/local-file-store.ts):
   *  the File itself only lives in this session. */
  url: string
  /** The key `url`'s {API_KEY} placeholder needs, if any. */
  apiKey?: SourceApiKey
  /** Lowest zoom to REQUEST TILES at, deliberately not a camera constraint
   *  (see the onZoomRangeChange comment in MapSources.tsx). */
  minzoom?: number
  /** Deepest native zoom: overrides the auto-detected (COG header, VRT index)
   *  or fallback range; MapLibre overzooms past it. */
  maxzoom?: number
  /** Tile size in pixels of a tiled source (default 256). */
  tileSize?: number
  /** [west, south, east, north] in degrees: Fit to bounds, the coverage
   *  footprints, the Library's scope sections, the camera fence. */
  bounds?: [west: number, south: number, east: number, north: number]
  description?: string
  /** Human landing page for the dataset (product page, catalog record,
   *  viewer), ideally stating the licence. */
  infoUrl?: string
  /** Provenance, filled in by the catalog pickers or the library. */
  attribution?: string
  /** The credit's map line, when `attribution` is long: agency short name
   *  and licence code ("MARI-GISLAB (Tulane), CC BY-NC-SA"). Entries of one
   *  publisher share it, so the map's attribution shows it once; the full
   *  `attribution` stays in Source Info (lib/source-credit.ts). */
  shortAttribution?: string
  licenseName?: string
  licenseUrl?: string
  /** Native ground resolution in metres (finest, for a mixed product). */
  resolutionM?: number
  /** Whether "Load Sample Sources" includes this entry (default true). false
   *  for project-specific datasets that should not clutter everyone's list;
   *  a shared link still loads them by id. */
  loadWithSamples?: boolean
  /** Extra words the Library's search matches, space-separated. */
  keywords?: string
  /** Always read this COG / VRT through titiler, ignoring the global
   *  in-browser-vs-titiler switch (a non-EPSG:3857 file, a host without CORS). */
  cogViaTitiler?: boolean
  /** Library entries only: a catalog search for the same data, offered by a
   *  Browse button beside Add. */
  stac?: LibraryStacLink
  /** Library entries only: a thematic group (a key of LIBRARY_GROUPS in
   *  lib/library-groups.ts, e.g. "relief") that lists the entry in its own
   *  section of the Library dialog instead of the scope sections. A key the
   *  registry does not know still gets a section, titled by the key. */
  libraryGroup?: string
}

/** How an elevation source's tiles are read (lib/terrain-tile-spec.ts). */
export type TerrainTransport =
  | "cog" | "cog-local" | "terrainrgb" | "terrarium" | "vrt" | "stac" | "mosaicjson"
  | "wms-raw" | "tilejson" | "dem-diff" | "lerc" | "quantized-mesh"

/** An elevation source. */
export interface TerrainSourceEntry extends SourceEntryBase {
  kind?: "terrain"
  type: TerrainTransport
  /** Vertical datum. Omitted means orthometric (above the geoid, "above sea
   *  level"), which almost every source is; an ellipsoidal one reads tens of
   *  metres high (about +49 m in the Alps). */
  datum?: "ellipsoidal"
  /** type "dem-diff" only: the two terrain source ids (built-in or custom, not
   *  another difference) whose per-tile difference this source is - the
   *  minuend (DSM) minus the subtrahend (DTM). `url` is a synthetic
   *  "diff://<a>-<b>" tag. See lib/demdiff-protocol.ts. */
  diffMinuendId?: string
  diffSubtrahendId?: string
  /** type "dem-diff": metres added to every difference (co-registration). */
  diffOffsetM?: number
  /** Fallback raster-dem encoding used only when a 'tilejson' source's
   *  manifest omits its own "encoding" field. */
  encoding?: "terrarium" | "mapbox"
  /** Paired basemap id, auto-selected with this source (either side of the
   *  pair may carry the link, see RasterSourceEntry.linkedTerrainId). */
  linkedBasemapId?: string
  /** Out-of-coverage handling in metres: at or below `nodataFloor` (and any
   *  non-finite sample) is a hole, filled with `nodataFill`. Honoured by the
   *  types decoded in the browser (supportsNodataControls in lib/nodata.ts). */
  nodataFloor?: number
  nodataFill?: number
  /** Custom RGB packing for a tiled raster-dem source that is neither
   *  Terrarium nor Terrain-RGB (MapLibre's `encoding: "custom"`):
   *  elevation = R*redFactor + G*greenFactor + B*blueFactor - baseShift.
   *  Any one set switches the source to custom encoding; the rest fall back
   *  to Terrain-RGB's (resolveCustomEncoding). */
  redFactor?: number
  greenFactor?: number
  blueFactor?: number
  baseShift?: number
  /** titiler's `nodata=` override for a 'cog' or 'vrt' source read through it
   *  (defaults 0 for COG, -999 for VRT). */
  titilerNodata?: number
  /** Finest grid the agency advertises for bulk download, when finer than
   *  what its live API serves. */
  bulkResolutionM?: number
}

/** How an imagery source's tiles are read (lib/source-builder.ts). */
export type RasterTransport = "cog" | "cog-local" | "tms" | "wms" | "wmts" | "tilejson" | "image" | "image-local" | "iiif"

/** A basemap or an overlay. */
export interface RasterSourceEntry extends SourceEntryBase {
  kind?: "raster"
  /** "image" / "image-local": a picture placed from its four corners (Tools >
   *  Image Georeferencer). "iiif": a georeferenced IIIF map drawn from its
   *  Georeference Annotation (Allmaps; `url` is the annotation). */
  type: RasterTransport
  /** 'overlay' stacks over the active basemap and is multi-selectable;
   *  'basemap' (the default) replaces it. */
  role?: "basemap" | "overlay"
  /** Where an overlay sits: under the relief layers (default), above the
   *  colour relief but under hillshade ("relief"), or above every terrain
   *  layer ("top"). See OverlayBasemapLayers. */
  stack?: "under" | "relief" | "top"
  /** 'tms' for bottom-left-origin tile grids (MapLibre's raster `scheme`). */
  scheme?: "xyz" | "tms"
  /** 0-100 (default 100). */
  opacity?: number
  /** A class raster read through titiler with nearest neighbour. */
  categorical?: boolean
  /** A scanned map sheet: the paper removal applies (lib/unpaper-protocol.ts). */
  oldMap?: boolean
  /** "image" / "image-local": the corners in lng/lat, MapLibre image-source
   *  order (top-left, top-right, bottom-right, bottom-left). */
  coordinates?: [[number, number], [number, number], [number, number], [number, number]]
  /** "image" / "image-local": what produced the corners. */
  georef?: { gcps: string; type: string; width: number; height: number }
  /** Paired terrain id (see TerrainSourceEntry.linkedBasemapId). */
  linkedTerrainId?: string
  /** Registered by a timeline catalog pick, not by the user: listed on the
   *  map and the timeline, not among the user's own sources until kept. */
  transient?: boolean
  /** Set by the user: never removed by an automatic step. */
  locked?: boolean
  /** The catalog picker that produced the entry. */
  provider?: "qms" | "eli" | "allmaps"
  /** type "iiif": drawn from Allmaps' tile server instead of warped in the
   *  browser (shows in tilted and 3D views). */
  allmapsTiles?: boolean
  /** Every pixel with any alpha drawn fully opaque, no-data (alpha 0) left
   *  transparent: for services that bake a partial alpha into every tile
   *  (ArcGIS Online's 8-bit layers, ~50 %). Tiled http(s) and WMS templates
   *  only (lib/tile-transform-protocol.ts). Kept as an alias of alphaMode
   *  "opaque" for records stored before alphaMode. */
  forceOpaque?: boolean
  /** What the tiles' alpha becomes (lib/tile-transform-protocol.ts,
   *  TILE_ALPHA_MODES): "served" (as sent), "opaque" (any alpha to 255, the
   *  same as forceOpaque), "multiply" (dark opaque, light transparent: a grey
   *  render shades the imagery) or "screen" (light opaque, dark transparent).
   *  On a Library entry it is the default; on a user's source, their choice
   *  from the overlay row (it wins over the Library's). Tiled http(s) and WMS
   *  templates only. */
  alphaMode?: "served" | "opaque" | "multiply" | "screen"
  /** 1-3: zoom levels under `minzoom` where a tile is assembled from its
   *  children at `minzoom` (4, 16 or 64 requests, only those inside
   *  `bounds`), so a service with no overview tiles does not vanish when the
   *  view zooms out. Needs `minzoom`; best with `bounds`. */
  underzoom?: number
}

/** Any source. */
export type SourceEntry = TerrainSourceEntry | RasterSourceEntry

/** A Library row with no single mosaic to add, only a STAC collection of
 *  strips or tiles (EarthDEM, ArcticDEM strips...): listed with Browse in
 *  place of Add. Kept in custom-sources.json's own SAMPLE_*_BROWSE_ONLY
 *  lists, away from SAMPLE_TERRAIN_SOURCES, because everything else that
 *  reads the library expects an entry to have a URL to load. */
export interface LibraryBrowseEntry extends Pick<SourceEntryBase, "id" | "name" | "description" | "infoUrl" | "resolutionM" | "bounds" | "loadWithSamples" | "kind" | "libraryGroup"> {
  stac: LibraryStacLink
}

const TERRAIN_ONLY = new Set<string>(["terrainrgb", "terrarium", "vrt", "stac", "mosaicjson", "wms-raw", "dem-diff", "lerc", "quantized-mesh"])

/** An entry's kind: its own field, else read from its transport ("cog",
 *  "cog-local" and "tilejson" exist on both sides, and default to terrain
 *  only when nothing else says). */
export function sourceKind(entry: { kind?: SourceKind; type?: string; role?: string }): SourceKind {
  if (entry.kind) return entry.kind
  if (entry.role) return "raster"
  return entry.type && !TERRAIN_ONLY.has(entry.type) && entry.type !== "cog" && entry.type !== "cog-local" && entry.type !== "tilejson" ? "raster" : "terrain"
}

/** An entry's section: its own field, else "custom" (what a saved list holds). */
export function sourceSection(entry: { section?: SourceSection }): SourceSection {
  return entry.section ?? "custom"
}

/** The API keys a caller holds, by setting name. */
export type SourceKeys = Partial<Record<SourceApiKey, string>>

/** The entry's address with its `{API_KEY}` placeholder filled from `keys`
 *  (left empty without the key: the tiles then answer 401, as the picker
 *  hides such a source anyway). Cesium ion's token is not a placeholder: the
 *  quantized-mesh protocol holds it (setCesiumIonToken). */
export function entryUrl(entry: { url: string; apiKey?: SourceApiKey }, keys: SourceKeys = {}): string {
  return entry.apiKey && entry.url.includes("{API_KEY}") ? entry.url.split("{API_KEY}").join(keys[entry.apiKey] ?? "") : entry.url
}

/** Whether the caller holds the key the entry's tiles need (true when it
 *  needs none). The pickers hide a source until this is true. */
export function hasEntryKey(entry: { apiKey?: SourceApiKey }, keys: SourceKeys = {}): boolean {
  return !entry.apiKey || !!keys[entry.apiKey]?.trim()
}

// ── Dated imagery ───────────────────────────────────────────────────────────
// The sources whose tiles depend on a date as well as a place: Esri Wayback,
// NASA HLS, Google Earth historical, Planet's monthly mosaics, EOX's yearly
// Sentinel-2 cloudless, and Bing's one current mosaic with its capture date.
// A RasterSourceEntry has one address; one of these has a catalog of dates
// at a place and an address per date. The registry is lib/dated-imagery.ts.
// The national and regional series (lib/national-historical.ts: an agency's
// flights, Google Earth Timelapse, Planetary Computer's mosaics) are dated
// sources too, one layer per date, in the "library" section
// (lib/national-dated.ts). So are STAC catalogs (OpenAerialMap, Maxar Open
// Data...), their items grouped by day of acquisition, in the "catalog"
// section (lib/stac-dated.ts).

/** A place the catalog is asked about: the view's centre and its zoom. */
export interface DatedImageryPlace { lat: number; lng: number; zoom: number }

/** One date of a dated source: a capture, a release, a month or a year. */
export interface DatedImageryTick {
  dateMs: number
  /** yyyy-mm-dd, yyyy-mm or yyyy, as the timeline and filenames show it. */
  label: string
  /** The source's own handle for that date when the date alone does not
   *  name the tiles (a Wayback release). */
  ref?: unknown
  /** The source's own name for that date when it says more than the label
   *  (a national layer: "Orthofoto 1956-57 (B/W)"). */
  title?: string
}

/** The tiles of one date. */
export interface DatedImageryTiles {
  /** What the map's raster source takes ({z}/{x}/{y}, {quadkey}, or one of
   *  the app's schemes: gehist://, planet://). */
  tiles: string[]
  tileSize: number
  maxzoom: number
  /** Shallowest zoom with tiles, when not 0 (Planetary Computer's mosaics). */
  minzoom?: number
  /** [west, south, east, north]: where the tiles of that date exist. */
  bounds?: [west: number, south: number, east: number, north: number]
  /** A plain https template, when the map's is an app scheme (Planet, for
   *  the GDAL script of an export). */
  urlTemplate?: string
  /** Builds a tile's address where no template fits (Bing's quadkeys). */
  buildTileUrl?: (z: number, x: number, y: number) => string
  /** Bing only: the template with a literal {quadkey} (GDAL's VirtualEarth). */
  quadkeyUrlTemplate?: string
  /** Fetches a tile where the browser's fetch cannot (an app scheme, a key
   *  kept out of the address). */
  fetchTileBlob?: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Blob>
}

/** A dated imagery source. */
export interface DatedImagerySource extends Pick<SourceEntryBase, "id" | "name" | "shortName" | "description" | "infoUrl" | "apiKey"> {
  kind: "raster"
  /** "defaults": the timeline's own sources (lib/dated-imagery.ts);
   *  "library": the national and regional series, a catalog the timeline
   *  lists per place (lib/national-dated.ts); "catalog": a STAC catalog,
   *  its items grouped by day (lib/stac-dated.ts). */
  section: "defaults" | "library" | "catalog"
  /** What a date is: a capture dated per tile ("capture"), a monthly,
   *  quarterly or yearly mosaic, a flight year or period ("year"), or the
   *  one current mosaic ("current", Bing). */
  granularity: "capture" | "month" | "quarter" | "year" | "current"
  /** false when the dates are a placeholder cadence rather than real
   *  captures (HLS: one tick a month, the mosaic of a 30-day window). */
  realDates: boolean
  /** Offered inside the sidebar's single "Historical Imagery" entry (Bing
   *  is a plain basemap there, but has a pill on the timeline). */
  historicalEntry: boolean
  tileSize: number
  /** Deepest zoom with real tiles: the map overzooms past it, the camera's
   *  ceiling follows it. */
  maxzoom: number
  /** The constant string the map's attribution control shows: react-map-gl
   *  cannot update a source's attribution after it is mounted, so the real
   *  per-place credit is shown by the sidebar's Source Info section. */
  attribution: string
  /** [west, south, east, north]: where the source has any date (a national
   *  series); unset: worldwide. */
  bounds?: [west: number, south: number, east: number, north: number]
  /** The data's licence, when the source states one. */
  licence?: string
  /** Filename stem and label of an export. */
  fileStem: string
  exportLabel: string
  /** The dates known without a request (a fixed cadence or list), for the
   *  timeline to show at once. Absent: only listDates knows them. */
  fixedDates?: (keys: SourceKeys) => DatedImageryTick[]
  /** The catalog: every date at a place within [startMs, endMs], oldest first. */
  listDates: (place: DatedImageryPlace, startMs: number, endMs: number, keys: SourceKeys) => Promise<DatedImageryTick[]>
  /** The tiles of a date (a tick, or a date alone with dateMs and no ref);
   *  null when they cannot be named yet (a Wayback date not resolved to a
   *  release, a missing key, no date). `hd`: Google Earth's 512 px tiles. */
  tiles: (tick: Pick<DatedImageryTick, "dateMs" | "ref">, opts?: { keys?: SourceKeys; hd?: boolean }) => DatedImageryTiles | null
}
