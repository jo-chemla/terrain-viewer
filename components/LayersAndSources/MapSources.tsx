import { memo, useMemo, useState, useEffect } from "react"
import { Source } from "react-map-gl/maplibre"
import { useAtom, useAtomValue } from "jotai"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource, TerrainSourceConfig } from "@/lib/terrain-types"
import { useCogProtocolVsTitilerAtom, highResTerrainAtom, type CustomTerrainSource } from "@/lib/settings-atoms"
import { localFileVersionAtom, resolveLocalFileUrl, localFileId } from "@/lib/local-file-store"
import { probeMaxZoomAt } from "@/lib/tile-max-zoom"
import type { RasterDEMSourceSpecification } from 'maplibre-gl'
import { setColorFunction } from '@geomatico/maplibre-cog-protocol'
import { useCogMetadata, zoomRangeFromMetadata, type CogMetadata } from "@/lib/cog-metadata"
import { elevationToTerrainrgb, elevationToTerrarium } from "@/lib/elevation-encoding"
import { buildRasterTileSource } from "@/lib/source-builder"
import { buildSlopeProtocolUrl } from "@/lib/slope-protocol"
import { buildAspectProtocolUrl } from "@/lib/aspect-protocol"
import { buildTriProtocolUrl } from "@/lib/tri-protocol"
import { buildCurvatureProtocolUrl, type CurvatureMode } from "@/lib/curvature-protocol"
import { buildTpiProtocolUrl } from "@/lib/tpi-protocol"
import { buildRoughnessProtocolUrl } from "@/lib/roughness-protocol"
import { buildLrmProtocolUrl } from "@/lib/lrm-protocol"
import { buildBlobnessProtocolUrl } from "@/lib/blobness-protocol"
import { buildSvfProtocolUrl } from "@/lib/svf-protocol"
import { buildOpennessProtocolUrl, type OpennessMode } from "@/lib/openness-protocol"
import type { HorizonPrecision } from "@/lib/horizon-angle"
import { buildLocalDominanceProtocolUrl } from "@/lib/local-dominance-protocol"
import { buildTellsProtocolUrl, type TellsOptions } from "@/lib/tells-protocol"
import { buildMatcapProtocolUrl } from "@/lib/matcap-protocol"
import { buildPhongProtocolUrl } from "@/lib/phong-protocol"
import { buildShadowProtocolUrl } from "@/lib/shadow-protocol"
import { useResolvedWaybackRelease, waybackTileUrl } from "@/lib/wayback"
import { hlsTileUrl } from "@/lib/hls"
import { geHistoricalTileSource } from "@/lib/ge-historical"
import { planetTileUrl, PLANET_TILE_SIZE, PLANET_MAXZOOM } from "@/lib/planet"
import { eoxS2CloudlessTileUrl, EOX_S2_TILE_SIZE, EOX_S2_MAXZOOM } from "@/lib/eox-s2-cloudless"
import { HISTORICAL_BASEMAP_IDS } from "@/lib/historical-sources"
import { STATIC_BASEMAP_ATTRIBUTIONS } from "@/lib/basemap-attribution"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

const makeTerrainrgbColorFunction = (scale = 1, offset = 0, noData?: number) => (pixel: any, color: any) => {
    const raw = pixel[0]
    const elevation = raw === noData ? 0 : offset + raw * scale
    color.set(elevationToTerrainrgb(elevation))
}

const makeTerrariumColorFunction = (scale = 1, offset = 0, noData?: number) => (pixel: any, color: any) => {
    const raw = pixel[0]
    const elevation = raw === noData ? 0 : offset + raw * scale
    color.set(elevationToTerrarium(elevation))
}

// -------------------------
// Hook
// -------------------------

export interface TilejsonMetadata {
    encoding?: "terrarium" | "mapbox"
    bounds?: [number, number, number, number]
    minzoom?: number
    maxzoom?: number
    /** The manifest's own tile URL template — maplibre reads this natively for the
     *  primary DEM source (it's just handed the tilejson `url`), but slope-and-more
     *  bypasses maplibre's Source machinery to fetch neighbor tiles directly, so it
     *  needs the real template itself. */
    tiles?: string[]
}

// Most TileJSON DEM manifests (e.g. Mapterhorn's) declare their own "encoding" —
// fetch it instead of asking the user to guess, same spirit as useCogMetadata above.
function useTilejsonMetadata(tilejsonUrl: string | null): TilejsonMetadata | null {
    const [metadata, setMetadata] = useState<TilejsonMetadata | null>(null)
    useEffect(() => {
        if (!tilejsonUrl) { setMetadata(null); return }
        let cancelled = false
        fetch(tilejsonUrl).then(r => r.json()).then((json) => { if (!cancelled) setMetadata(json) }).catch(() => { if (!cancelled) setMetadata(null) })
        return () => { cancelled = true }
    }, [tilejsonUrl])
    return metadata
}

// -------------------------
// Raster basemap tile configs
// -------------------------

// maxzoom values mirror https://github.com/Iconem/historical-satellite/blob/main/src/utilities.tsx
const rasterBasemaps: Record<string, { url: string; tileSize: number; maxzoom: number }> = {
    osm:       { url: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png", tileSize: 256, maxzoom: 19 },
    googlesat: { url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", tileSize: 256, maxzoom: 21 },
    google:    { url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", tileSize: 256, maxzoom: 21 },
    esri:      { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}.jpg", tileSize: 256, maxzoom: 19 },
    mapbox:    { url: "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token={API_KEY}", tileSize: 256, maxzoom: 22 },
    // Public quadkey endpoint (no session token to expire), same one historical-satellite uses.
    bing:      { url: "https://t.ssl.ak.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=14603&n=z&prx=1", tileSize: 256, maxzoom: 21 },
    here:      { url: "https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?style=satellite.day&apiKey={API_KEY}", tileSize: 256, maxzoom: 20 },
}

// "wayback" isn't in rasterBasemaps above — its tile URL is per-release (see
// lib/wayback.ts), resolved at render time in RasterBasemapSource instead of
// a static template — but it shares the same maxzoom historical-satellite
// itself uses for World Imagery Wayback.
const WAYBACK_TILE_SIZE = 256
const WAYBACK_MAXZOOM = 19

// "hls" mirrors the wayback pattern above — per-date tile URL built at render
// time (see lib/hls.ts) rather than a static template. 16 matches HLS's own
// 30m native resolution reasonably well for the titiler-cmr rasterio backend.
const HLS_TILE_SIZE = 256
const HLS_MAXZOOM = 16

// -------------------------
// Helpers
// -------------------------

function builtinTileUrl(key: TerrainSource, mapboxKey: string, maptilerKey: string): string {
    const config: TerrainSourceConfig = (terrainSources as any)[key]
    if (!config) return ""
    return (config.sourceConfig.tiles?.[0] ?? "")
        .replace("{API_KEY}", key === "mapbox" ? mapboxKey : key === "maptiler" ? maptilerKey : "")
}

// -------------------------
// TerrainSources
// -------------------------

export const TerrainSources = memo(({
    // source, mapboxKey, maptilerKey, customTerrainSources, titilerEndpoint,
    source, mapboxKey, maptilerKey, customTerrainSources, titilerEndpoint, onZoomRangeChange, lat, lng,
}: {
    source: TerrainSource | string
    mapboxKey: string
    maptilerKey: string
    customTerrainSources: any[]
    titilerEndpoint: string
    onZoomRangeChange?: (range: { minzoom: number; maxzoom: number; isCustom: boolean }) => void
    /** Viewport-center lat/lng — used only to probe real per-location tile
     *  coverage (see probedMaxzoom below), not threaded into sourceConfig. */
    lat: number
    lng: number
}) => {
    const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
    const [highResTerrain] = useAtom(highResTerrainAtom)
    // Unused directly — read so this component re-renders when a local COG file
    // is (re-)picked (see custom-source-details.tsx's "Re-select file…" flow).
    useAtomValue(localFileVersionAtom)

    const customSource = customTerrainSources.find((s) => s.id === source)
    // A local file can only ever stream via the in-browser geomatico protocol —
    // there's no titiler server that could reach the user's disk — so it ignores
    // the useCogProtocolVsTitiler toggle entirely, unlike a remote "cog" source.
    const isCogLocal = customSource?.type === 'cog-local'
    const isCogProtocol = (customSource?.type === 'cog' && useCogProtocol) || isCogLocal
    const isTilejson = customSource?.type === 'tilejson'
    // For a local file, this session's blob: URL if the file has been picked (or
    // re-picked after a reload), else null — same "not ready yet" shape as a COG
    // still fetching its metadata below.
    const resolvedCogUrl = isCogLocal
        ? (customSource ? resolveLocalFileUrl(localFileId(customSource.url)) : null)
        : (customSource?.url ?? null)

    const { data: metadata } = useCogMetadata(isCogProtocol ? resolvedCogUrl : null)
    const tilejsonMetadata = useTilejsonMetadata(isTilejson ? customSource.url : null)
    const { minzoom, maxzoom: detectedMaxzoom } = useMemo(() => zoomRangeFromMetadata(metadata), [metadata])
    // A custom source's explicit maxzoom (e.g. WMS sources without COG metadata to auto-detect from)
    // wins over both the metadata-detected value and the 0-20 fallback.
    const maxzoom = customSource?.maxzoom ?? detectedMaxzoom

    useEffect(() => {
        if (isCogProtocol && !metadata) return  // don't fire until real metadata
        onZoomRangeChange?.({ minzoom, maxzoom, isCustom: !!customSource })
    }, [minzoom, maxzoom, metadata, isCogProtocol, onZoomRangeChange])

    // Register color function for COG protocol
    useEffect(() => {
        if (!isCogProtocol || !resolvedCogUrl) return
        const scale = metadata?.scale ?? 1
        const offset = metadata?.offset ?? 0
        const noData = metadata?.noData
        setColorFunction(
            resolvedCogUrl,
            highResTerrain
                ? makeTerrariumColorFunction(scale, offset, noData)
                : makeTerrainrgbColorFunction(scale, offset, noData)
        )
    }, [isCogProtocol, resolvedCogUrl, highResTerrain, metadata?.scale, metadata?.offset])

    const sourceConfig: RasterDEMSourceSpecification | null | undefined = useMemo(() => {
        if (customSource) {
            // For COG protocol, wait for metadata before rendering (this also covers a
            // local file not (re-)picked yet this session — resolvedCogUrl is null,
            // so useCogMetadata above never resolves); same for tilejson, whose
            // "encoding" field (when present) is fetched instead of asked upfront.
            if (isCogProtocol && !metadata) return null
            if (isTilejson && !tilejsonMetadata) return null

            const built = buildRasterTileSource({
                url: isCogLocal ? resolvedCogUrl! : customSource.url,
                type: isCogLocal ? 'cog' : customSource.type,
                useCogProtocol: isCogLocal ? true : useCogProtocol,
                titilerEndpoint,
                isDem: true,
            })
            const encoding = isCogProtocol
                ? highResTerrain ? 'terrarium' : 'mapbox'
                : isTilejson
                ? (tilejsonMetadata?.encoding === 'terrarium' ? 'terrarium' : tilejsonMetadata?.encoding === 'mapbox' ? 'mapbox' : (customSource.encoding ?? 'mapbox'))
                // float32demProtocol (float32dem-protocol.ts) re-encodes the WMS-raw
                // GeoTIFF as Terrarium (not Terrain-RGB) for its ~4mm vs 10cm precision —
                // must match here or maplibre would misdecode every pixel.
                : customSource.type === 'terrarium' || customSource.type === 'wms-raw' ? 'terrarium'
                : 'mapbox'  // terrainrgb
            return {
                type: "raster-dem",
                // wms-raw's URL requests a fixed WIDTH/HEIGHT (e.g. 514 = 512 + 1px buffer per side)
                // matching a 512px tile — see public/maplibre-raster-dem-wms-float32-generic.html.
                // TileJSON sources carry their own tileSize in the manifest maplibre fetches.
                ...(customSource.type === 'tilejson' ? {} : { tileSize: customSource.type === 'wms-raw' ? 512 : 256 }),
                minzoom,
                maxzoom,
                encoding,
                ...built,
            }
        }

        // Builtin source
        const base = (terrainSources as any)[source as TerrainSource]
        if (!base) return null
        return {
            ...base.sourceConfig,
            tiles: [builtinTileUrl(source as TerrainSource, mapboxKey, maptilerKey)],
        }
    }, [customSource, source, useCogProtocol, titilerEndpoint, highResTerrain, minzoom, maxzoom, isCogProtocol, isCogLocal, resolvedCogUrl, isTilejson, tilejsonMetadata, mapboxKey, maptilerKey, metadata])

    // A source's declared maxzoom (sourceConfig.maxzoom) isn't always backed by
    // real coverage at every location — most visibly Mapterhorn, which declares
    // 18 uniformly but plenty of locations only have real tiles to z15-17 (see
    // lib/tile-max-zoom.ts's header). Only genuine XYZ tile pyramids have this
    // problem — a COG/tilejson-COG URL has no {z}/{x}/{y} placeholders to probe
    // (its protocol resamples the actual file at whatever zoom is requested),
    // so this only fires for a real `{z}` template.
    const probeTileUrl = sourceConfig?.tiles?.[0]
    const configuredMaxzoom = sourceConfig?.maxzoom
    const [probedMaxzoom, setProbedMaxzoom] = useState<number | null>(null)
    // Rounded to ~11km — coarser than the underlying probe's own zoom-6 cache
    // bucket would need, but avoids re-running this effect on every sub-pixel
    // lat/lng nudge a live pan/zoom might otherwise produce.
    const roundedLat = typeof lat === "number" ? Math.round(lat * 10) / 10 : lat
    const roundedLng = typeof lng === "number" ? Math.round(lng * 10) / 10 : lng
    useEffect(() => {
        // Reset unconditionally (not just in the early-return branch below) —
        // otherwise a stale probe result from the PREVIOUS source/template
        // would keep clamping this new one until its own probe resolves.
        setProbedMaxzoom(null)
        if (!probeTileUrl || !probeTileUrl.includes("{z}") || configuredMaxzoom == null) return
        let cancelled = false
        probeMaxZoomAt(probeTileUrl, roundedLng, roundedLat, configuredMaxzoom).then((z) => {
            if (!cancelled) setProbedMaxzoom(z)
        })
        return () => { cancelled = true }
    }, [probeTileUrl, configuredMaxzoom, roundedLat, roundedLng])

    // Only ever lowers maxzoom (probedMaxzoom is always <= configuredMaxzoom by
    // construction) — clamping here just tells maplibre where to stop
    // descending the pyramid, so it overzooms (upsamples) the last real tile
    // instead of requesting one that 404s. The reported onZoomRangeChange above
    // deliberately still uses the unclamped, configured maxzoom — that's "how
    // far this pyramid can theoretically go" for the camera zoom UI, a
    // different question from "what does THIS exact viewport have."
    const effectiveSourceConfig = useMemo(() => {
        if (!sourceConfig || probedMaxzoom == null || sourceConfig.maxzoom == null || probedMaxzoom >= sourceConfig.maxzoom) return sourceConfig
        return { ...sourceConfig, maxzoom: probedMaxzoom }
    }, [sourceConfig, probedMaxzoom])

    if (!effectiveSourceConfig) return null

    return (
        <>
            {/* resolvedCogUrl in the key: re-picking a different file for the same
                "cog-local" source (id unchanged) must remount the Source rather than
                have maplibre patch tiles in place against a stale pyramid/cache keyed
                by the old blob: URL — same reasoning as LrmSource/CurvatureSource
                keying on radius/mode below. effectiveSourceConfig.maxzoom is in the
                key for the same reason: react-map-gl's <Source> only patches
                coordinates/url/tiles in place (see @vis.gl/react-maplibre's
                updateSource) — any other changed prop, maxzoom included, is silently
                no-op'd with a console warning rather than actually applied, so a
                probed maxzoom change has to force a remount to take effect. */}
            <Source id="terrainSource"  key={`terrain-${source}-${highResTerrain}-${resolvedCogUrl}-${effectiveSourceConfig.maxzoom}`}  {...effectiveSourceConfig} />
            <Source id="hillshadeSource" key={`hillshade-${source}-${highResTerrain}-${resolvedCogUrl}-${effectiveSourceConfig.maxzoom}`} {...effectiveSourceConfig} />
        </>
    )
})
TerrainSources.displayName = "TerrainSources"

// -------------------------
// RasterBasemapSource
// -------------------------

// Dragging the historical timeline's scrubber handle across many ticks
// (possibly belonging to several different sources at once, e.g. Wayback
// and HLS ticks interleaved on the same track) fires a state update — and so
// a new basemapSource/date prop pair here — on every intermediate pointer
// move. Each one would otherwise trigger a real tile source reload (or, when
// basemapSource itself flips between sources, a full <Source> remount via
// its key below) for a position the user is just passing through, not
// stopping on. Debounced just long enough to coalesce a fast drag's burst of
// intermediate values into the one the user actually lands on, short enough
// that a single deliberate click/step still feels instant.
const RASTER_SOURCE_DEBOUNCE_MS = 150

export const RasterBasemapSource = memo(({
    // basemapSource, mapboxKey, hereKey, customBasemapSources, titilerEndpoint,
    basemapSource: rawBasemapSource, mapboxKey, hereKey, planetKey, date: rawDate, latitude, longitude, zoom, customBasemapSources, titilerEndpoint, onZoomRangeChange, historicalBeta,
}: {
    basemapSource: string
    mapboxKey: string
    hereKey?: string
    planetKey?: string
    /** Settings > Beta > "Historical Imagery Sources" gate — when false, the
     *  historical sources (wayback/hls/ge-historical/planet/eox-s2) render
     *  nothing even if somehow still selected (e.g. a stale `?basemapSource=` URL). */
    historicalBeta?: boolean
    /** Epoch ms — the ONE date this side is scrubbed to, regardless of which
     *  concrete historical source is active (Wayback/HLS/GE/Planet/EOX-S2 all
     *  read the same field now; see lib/wayback.ts's useResolvedWaybackRelease
     *  for how Wayback specifically turns this into an actual release
     *  number). Ignored when basemapSource isn't one of those sources. */
    date?: number
    /** Current view center — only actually used to resolve Wayback's nearest
     *  release to `date` (every other source's date is already directly
     *  usable); ignored otherwise. */
    latitude: number
    longitude: number
    zoom: number
    customBasemapSources: any[]
    titilerEndpoint: string
    onZoomRangeChange?: (range: { minzoom: number; maxzoom: number; isCustom: boolean }) => void
}) => {
    const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
    // Unused directly — read so this component re-renders when a local COG file
    // is (re-)picked (see custom-source-details.tsx's "Re-select file…" flow).
    useAtomValue(localFileVersionAtom)

    const basemapSource = useDebouncedValue(rawBasemapSource, RASTER_SOURCE_DEBOUNCE_MS)
    const date = useDebouncedValue(rawDate, RASTER_SOURCE_DEBOUNCE_MS)
    // Only actually resolves network-side when basemapSource === "wayback" —
    // see useResolvedWaybackRelease's own hooks, which no-op (return null,
    // items.length 0) when `date` is falsy regardless of source, so calling
    // this unconditionally (hooks can't be conditional) costs nothing when
    // this side isn't on Wayback.
    const { item: resolvedWaybackItem } = useResolvedWaybackRelease(latitude, longitude, zoom, basemapSource === "wayback" ? date ?? 0 : 0)

    const customBasemap = customBasemapSources.find((s) => s.id === basemapSource)
    // A local file can only ever stream via the in-browser geomatico protocol —
    // there's no titiler server that could reach the user's disk — same as the
    // terrain side's TerrainSources component.
    const isCogLocal = customBasemap?.type === "cog-local"
    const resolvedCogUrl = isCogLocal
        ? (customBasemap ? resolveLocalFileUrl(localFileId(customBasemap.url)) : null)
        : null

    const sourceProps = useMemo(() => {
        if (customBasemap) {
            if (isCogLocal && !resolvedCogUrl) return null // not (re-)picked yet this session
            return buildRasterTileSource({
                url: isCogLocal ? resolvedCogUrl! : customBasemap.url,
                type: isCogLocal ? "cog" : customBasemap.type,
                useCogProtocol: isCogLocal ? true : useCogProtocol,
                titilerEndpoint,
                scheme: customBasemap.scheme,
            })
        }

        if (HISTORICAL_BASEMAP_IDS.has(basemapSource) && !historicalBeta) return null

        if (basemapSource === "wayback") {
            // Catalog still loading, or no release resolved yet for this date
            // (see lib/wayback.ts's useResolvedWaybackRelease) — render
            // nothing rather than a broken/stale tile request.
            if (!resolvedWaybackItem) return null
            // A constant pointer string, not the real per-view contributor —
            // react-map-gl's <Source> reconciler (node_modules/@vis.gl/
            // react-maplibre/src/components/source.ts's updateSource) has no
            // live-update path for `attribution` at all (any changed prop it
            // doesn't recognize just logs "Unable to update <Source> prop"
            // and is dropped), so a value that changes post-mount could never
            // reach the map through this prop anyway. The real value lives in
            // the sidebar's Source Info section instead (SourceInfoSection.tsx,
            // via useEsriDynamicAttribution) — resolved for the current view
            // there, not tied to this one Source instance.
            return { tiles: [waybackTileUrl(resolvedWaybackItem)], tileSize: WAYBACK_TILE_SIZE, maxzoom: WAYBACK_MAXZOOM, attribution: STATIC_BASEMAP_ATTRIBUTIONS.wayback }
        }

        if (basemapSource === "hls") {
            if (!date) return null
            return { tiles: [hlsTileUrl(date)], tileSize: HLS_TILE_SIZE, maxzoom: HLS_MAXZOOM, attribution: STATIC_BASEMAP_ATTRIBUTIONS.hls }
        }

        if (basemapSource === "ge-historical") {
            if (!date) return null
            // geHistoricalTileSource returns its own constant pointer string
            // (lib/ge-historical.ts) for the same reason as the wayback
            // branch above — the real per-tile provider lives in the
            // sidebar's Source Info section instead (useGeHistoricalDynamicAttribution).
            return geHistoricalTileSource(date)
        }

        if (basemapSource === "planet") {
            if (!date || !planetKey) return null
            return { tiles: [planetTileUrl(date, planetKey)], tileSize: PLANET_TILE_SIZE, maxzoom: PLANET_MAXZOOM, attribution: STATIC_BASEMAP_ATTRIBUTIONS.planet }
        }

        if (basemapSource === "eox-s2") {
            if (!date) return null
            return { tiles: [eoxS2CloudlessTileUrl(new Date(date).getUTCFullYear())], tileSize: EOX_S2_TILE_SIZE, maxzoom: EOX_S2_MAXZOOM, attribution: STATIC_BASEMAP_ATTRIBUTIONS["eox-s2"] }
        }

        const basemap = rasterBasemaps[basemapSource] ?? rasterBasemaps.google
        const tileUrl = basemapSource === "mapbox"
            ? basemap.url.replace("{API_KEY}", mapboxKey)
            : basemapSource === "here"
            ? basemap.url.replace("{API_KEY}", hereKey ?? "")
            : basemap.url
        return { tiles: [tileUrl], tileSize: basemap.tileSize, maxzoom: basemap.maxzoom, attribution: STATIC_BASEMAP_ATTRIBUTIONS[basemapSource] }
    }, [customBasemap, basemapSource, historicalBeta, resolvedWaybackItem, date, planetKey, useCogProtocol, titilerEndpoint, mapboxKey, hereKey, isCogLocal, resolvedCogUrl])

    const zoomRange = useMemo(() => {
        if (customBasemap) return { minzoom: customBasemap.minzoom ?? 0, maxzoom: customBasemap.maxzoom ?? 22, isCustom: true }
        if (HISTORICAL_BASEMAP_IDS.has(basemapSource) && !historicalBeta) return { minzoom: 0, maxzoom: 22, isCustom: false }
        if (basemapSource === "wayback") return { minzoom: 0, maxzoom: WAYBACK_MAXZOOM, isCustom: false }
        if (basemapSource === "hls") return { minzoom: 0, maxzoom: HLS_MAXZOOM, isCustom: false }
        if (basemapSource === "ge-historical") return { minzoom: 0, maxzoom: 23, isCustom: false }
        if (basemapSource === "planet") return { minzoom: 0, maxzoom: PLANET_MAXZOOM, isCustom: false }
        if (basemapSource === "eox-s2") return { minzoom: 0, maxzoom: EOX_S2_MAXZOOM, isCustom: false }
        const basemap = rasterBasemaps[basemapSource] ?? rasterBasemaps.google
        return { minzoom: 0, maxzoom: basemap.maxzoom, isCustom: false }
    }, [customBasemap, basemapSource, historicalBeta])

    useEffect(() => {
        onZoomRangeChange?.(zoomRange)
    }, [zoomRange, onZoomRangeChange])

    if (!sourceProps) return null

    return (
        <Source
            id="raster-basemap-source"
            // resolvedCogUrl in the key: re-picking a different file for the same
            // "cog-local" source (id unchanged) must remount the Source rather than
            // have maplibre patch tiles in place against a stale pyramid/cache keyed
            // by the old blob: URL.
            key={`raster-${basemapSource}-${resolvedCogUrl}`}
            type="raster"
            tileSize={256}
            // zoomRange.maxzoom (not a hardcoded 19) — buildRasterTileSource's
            // returned sourceProps never carries a custom source's own maxzoom
            // (only the built-in-basemap branch above adds one), so a hardcoded
            // 19 here silently overrode any narrower maxzoom a custom source
            // declared (e.g. a WMTS layer only published up to z6), causing
            // requests past its real tile pyramid. zoomRange already computes
            // the correct value for both the custom and built-in cases.
            minzoom={zoomRange.minzoom}
            maxzoom={zoomRange.maxzoom}
            {...sourceProps}
        />
    )
})
RasterBasemapSource.displayName = "RasterBasemapSource"

// -------------------------
// OverlayBasemapSources — 'overlay'-role custom basemap sources (see raster-basemap-
// section.tsx / basemap-byod-section.tsx), stacked on top of the active basemap
// instead of replacing it. Multiple can be active at once, unlike the single
// primary basemap above, so this renders one <Source> per selected id.
// -------------------------

export const OverlayBasemapSources = memo(({
    overlayIds, customBasemapSources, titilerEndpoint,
}: {
    overlayIds: string[]
    customBasemapSources: any[]
    titilerEndpoint: string
}) => {
    const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
    // Unused directly — read so this component re-renders when a local COG file
    // is (re-)picked (see custom-source-details.tsx's "Re-select file…" flow).
    useAtomValue(localFileVersionAtom)

    return (
        <>
            {overlayIds.map((id) => {
                const source = customBasemapSources.find((s) => s.id === id)
                if (!source) return null
                const isCogLocal = source.type === "cog-local"
                const resolvedCogUrl = isCogLocal ? resolveLocalFileUrl(localFileId(source.url)) : null
                if (isCogLocal && !resolvedCogUrl) return null // not (re-)picked yet this session
                const sourceProps = buildRasterTileSource({
                    url: isCogLocal ? resolvedCogUrl! : source.url,
                    type: isCogLocal ? "cog" : source.type,
                    useCogProtocol: isCogLocal ? true : useCogProtocol,
                    titilerEndpoint,
                    scheme: source.scheme,
                })
                return (
                    <Source
                        // resolvedCogUrl in the key: see the matching comment on
                        // RasterBasemapSource above.
                        key={`overlay-${id}-${resolvedCogUrl}`}
                        id={`overlay-basemap-source-${id}`}
                        type="raster"
                        tileSize={256}
                        // See the matching comment on RasterBasemapSource — a
                        // hardcoded 19 here overrode this source's own (possibly
                        // narrower) maxzoom, since buildRasterTileSource never
                        // includes one for a plain custom source.
                        minzoom={source.minzoom ?? 0}
                        maxzoom={source.maxzoom ?? 19}
                        {...sourceProps}
                    />
                )
            })}
        </>
    )
})
OverlayBasemapSources.displayName = "OverlayBasemapSources"

// -------------------------
// SlopeSource — PlanTopo slope-angle overlay, or a client-computed equivalent
// -------------------------
//
// https://plantopo.com/map#c=12/44.97009/6.50524&l=default~slope-angle.overlay
// PlanTopo runs a middleware "slope-server" in front of Mapterhorn's DEM: it
// fetches DEM tiles, computes the per-pixel slope angle, and re-encodes the
// result as a standard Mapbox terrain-rgb tile — so it can be consumed by any
// raster-dem client exactly like an elevation source, which is what lets the
// `color-relief` layer type (normally used for hypsometric elevation tinting,
// see ColorReliefLayer above) be repointed at "slope degrees" instead of
// "meters" for free, with zero maplibre-side special-casing.
//
// lib/slope-protocol.ts (`slope://`) implements the client-side equivalent
// described in https://github.com/Iconem/terrain-viewer/issues/8: it fetches the
// currently-active terrain source's own tiles (9 at a time, LRU-cached) and computes
// slope in-browser via GDAL's Horn kernel, removing the PlanTopo dependency at the
// cost of doing that work per-client instead of once, server-side, cached for everyone.
const SLOPE_SOURCE_URL = "https://tile.plantopo.com/slope/{z}/{x}/{y}"

export type SlopeSourceMode = "plantopo" | "client"

// ─── Shared client-upstream resolution ─────────────────────────────────────────
//
// Resolves "the tile URL template + encoding to fetch to get this terrain source's
// raw elevation" for every source type the app supports, so slope/aspect/TRI/
// curvature (which all fetch tiles themselves to run the Horn-kernel neighbor math,
// bypassing maplibre's own Source/tile machinery) work on the same terrain sources
// the primary hillshade/hypsometric-tint sources do — not just plain terrarium/
// terrainrgb XYZ tiles. COG/VRT/wms-raw (titiler mode) all go through the SAME
// buildRasterTileSource the primary TerrainSources component uses below — one
// source of truth for how each type resolves to a tile URL, instead of hand-
// rolling the titiler/cog:// URL format a second time here:
//  - COG (geomatico protocol mode): buildRasterTileSource returns a `cog://{url}#dem`
//    url (no z/x/y — maplibre normally appends those via a tilejson round-trip we
//    don't need); lib/normal-derived-protocol.ts calls the geomatico `cogProtocol`
//    function directly for these (the exact mechanism TerrainSources uses for the
//    primary elevation/hillshade/hypsometric sources, including the per-URL
//    setColorFunction it registers, which this reuses since it's keyed by the same
//    bare COG url). Encoding follows the same highResTerrain-gated choice
//    TerrainSources makes, since that's what the registered color function emits.
//  - COG (titiler mode) / VRT (titiler-only, geomatico can't stream VRT) / wms-raw
//    (titiler mode): all resolve to a plain titiler HTTPS tile URL — directly
//    fetchable, no protocol.
//  - wms-raw (geomatico mode): titiler isn't in the picture, so buildRasterTileSource
//    returns the client-side `float32dem://` protocol URL instead — but that's a
//    single GetMap template with its own unresolved `{bbox-epsg-3857}` placeholder,
//    not a per-tile `{z}/{x}/{y}` one, so it needs the `float32dem-bbox://` wrapper
//    (see normal-derived-protocol.ts) to substitute the right bbox per neighbor tile.
//  - TileJSON: fetches the manifest (useTilejsonMetadata) to read its real `tiles`
//    template + declared encoding, same as the primary source's own manifest read.
//  - stac / mosaicjson: not yet supported here — returns null (same as before), so
//    those layers simply don't render.
export interface ClientDemUpstream {
    template: string
    encoding: "terrarium" | "mapbox"
    tileSize: number
    // Left undefined where the source has no fixed native pyramid to clamp
    // against (e.g. WMS, which serves whatever resolution is requested).
    minzoom?: number
    maxzoom?: number
}

export const useClientDemUpstream = (
    terrainSource: TerrainSource | string,
    customTerrainSources: CustomTerrainSource[],
    mapboxKey: string,
    maptilerKey: string,
    titilerEndpoint: string,
    // Viewport-center lat/lng — optional, and only used to probe real
    // per-location tile coverage (see probedMaxzoom below), same reasoning as
    // TerrainSources' own lat/lng probe above. Left undefined by most callers
    // (unchanged behavior); LrmSource passes these through so the displayed
    // LRM layer stops requesting a maxzoom the Elevation Picker's LRM point-
    // sample has already learned (via its own 404 fallback) doesn't exist at
    // this location — otherwise the two could disagree at a coverage gap:
    // the displayed raster shows a blank/overzoomed tile at the declared
    // maxzoom while the point-sample cleanly falls back to a lower, real one.
    lat?: number,
    lng?: number,
) => {
    const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
    const [highResTerrain] = useAtom(highResTerrainAtom)
    // Unused directly — read so this re-renders when a local COG file is (re-)picked.
    const localFileVersion = useAtomValue(localFileVersionAtom)
    const customSource = customTerrainSources.find((s) => s.id === terrainSource)
    const isTilejson = customSource?.type === "tilejson"
    const tilejsonMetadata = useTilejsonMetadata(isTilejson ? customSource!.url : null)

    // Same COG-metadata-derived zoom clamp the primary terrain Source gets (see
    // TerrainSources above) — without it, a COG's fixed native pyramid has no
    // ceiling here, so overzooming past it doesn't fall back to a lower-zoom
    // parent tile the way maplibre's own raster-dem handling does; it instead
    // asks the geomatico protocol for a tile beyond the data it has, which can
    // render as a blank/degenerate tile instead of a harmless overzoom blur.
    const isCogLocal = customSource?.type === "cog-local"
    const isCogRemote = customSource?.type === "cog" && useCogProtocol
    const cogUrlForMetadata = isCogLocal
        ? resolveLocalFileUrl(localFileId(customSource!.url))
        : isCogRemote ? customSource!.url : null
    const { data: cogMetadata } = useCogMetadata(cogUrlForMetadata)
    const cogZoomRange = useMemo(() => zoomRangeFromMetadata(cogMetadata), [cogMetadata])

    const baseUpstream = useMemo<ClientDemUpstream | null>(() => {
        if (!customSource) {
            const builtin = (terrainSources as any)[terrainSource as TerrainSource]
            if (!builtin || builtin.encoding === "3dtiles") return null
            return {
                template: builtinTileUrl(terrainSource as TerrainSource, mapboxKey, maptilerKey),
                encoding: builtin.sourceConfig.encoding === "terrarium" ? "terrarium" as const : "mapbox" as const,
                tileSize: builtin.sourceConfig.tileSize,
                maxzoom: builtin.sourceConfig.maxzoom,
            }
        }

        if (customSource.type === "tilejson") {
            if (!tilejsonMetadata?.tiles?.length) return null
            return {
                template: tilejsonMetadata.tiles[0],
                encoding: (tilejsonMetadata.encoding === "terrarium" ? "terrarium" : tilejsonMetadata.encoding === "mapbox" ? "mapbox" : (customSource.encoding ?? "mapbox")) as "terrarium" | "mapbox",
                tileSize: 256,
                minzoom: tilejsonMetadata.minzoom,
                maxzoom: tilejsonMetadata.maxzoom,
            }
        }
        if (customSource.type === "vrt" && useCogProtocol) return null // titiler-only — see custom-terrain-source-modal.tsx
        if (customSource.type === "stac" || customSource.type === "mosaicjson") return null

        if (customSource.type === "cog-local") {
            // Always the geomatico protocol — no titiler server could reach the
            // user's disk — same `cog://<url>/{z}/{x}/{y}` shape the "cog" case
            // below builds, just pointed at this session's blob: object URL
            // instead of a remote https:// one.
            const resolvedUrl = resolveLocalFileUrl(localFileId(customSource.url))
            if (!resolvedUrl) return null // not (re-)picked yet this session
            if (!cogMetadata) return null // wait for real metadata, same as the primary terrain Source
            return {
                template: `cog://${resolvedUrl}/{z}/{x}/{y}`,
                encoding: (highResTerrain ? "terrarium" : "mapbox") as "terrarium" | "mapbox",
                tileSize: 256,
                minzoom: cogZoomRange.minzoom,
                maxzoom: cogZoomRange.maxzoom,
            }
        }

        if (customSource.type === "wms-raw" && useCogProtocol) {
            // No titiler in the picture — buildRasterTileSource's float32dem:// output
            // is a single GetMap template (its own {bbox-epsg-3857} placeholder, not
            // a per-tile one), so wrap it for per-tile bbox substitution instead of
            // using the built url/encoding directly. WMS serves whatever resolution
            // is requested rather than a fixed pyramid, so there's no native zoom
            // ceiling to auto-detect here — only the user-set maxzoom (custom-terrain-
            // source-modal.tsx's "Max Zoom (optional)" field) can supply one; when
            // that's also unset, MatcapSource/PhongSource fall back to a hardcoded
            // default themselves (a plain `type: "raster"` source can't take an
            // explicit `undefined` maxzoom at all).
            return {
                template: `float32dem-bbox://${encodeURIComponent(customSource.url.replace(/^https?:\/\//, ""))}/{z}/{x}/{y}`,
                encoding: "terrarium" as const,
                tileSize: 512,
                maxzoom: customSource.maxzoom,
            }
        }

        // Remote "cog" streamed directly via the in-browser geomatico protocol has
        // the exact same fixed-pyramid limitation as cog-local above.
        if (isCogRemote && !cogMetadata) return null

        const built = buildRasterTileSource({
            url: customSource.url,
            type: customSource.type,
            useCogProtocol,
            titilerEndpoint,
            isDem: true,
        })
        const encoding = (customSource.type === "cog" && useCogProtocol
            ? (highResTerrain ? "terrarium" : "mapbox")
            : customSource.type === "terrarium"
            ? "terrarium"
            : "mapbox") as "terrarium" | "mapbox"

        if ("url" in built) {
            // cog:// (geomatico mode) — append the z/x/y placeholders maplibre would
            // otherwise supply itself via a tilejson round-trip we bypass here.
            return {
                template: `${built.url}/{z}/{x}/{y}`, encoding, tileSize: 256,
                ...(isCogRemote ? { minzoom: cogZoomRange.minzoom, maxzoom: cogZoomRange.maxzoom } : {}),
            }
        }
        return { template: built.tiles[0], encoding, tileSize: 256 }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customSource, terrainSource, mapboxKey, maptilerKey, titilerEndpoint, useCogProtocol, highResTerrain, tilejsonMetadata, localFileVersion, cogMetadata, cogZoomRange, isCogRemote])

    // Same per-viewport real-coverage probe TerrainSources runs for the
    // primary elevation Source (see lib/tile-max-zoom.ts) — only actually
    // probes when a caller passes lat/lng (see this hook's own params above).
    // Only a real XYZ `{z}` template can be probed at all (a COG/tilejson-COG
    // url has no z/x/y placeholders — its protocol resamples the actual file
    // at whatever zoom is asked, so there's no coverage gap to hit).
    const probeTileUrl = baseUpstream?.template
    const configuredMaxzoom = baseUpstream?.maxzoom
    const [probedMaxzoom, setProbedMaxzoom] = useState<number | null>(null)
    const roundedLat = typeof lat === "number" ? Math.round(lat * 10) / 10 : lat
    const roundedLng = typeof lng === "number" ? Math.round(lng * 10) / 10 : lng
    useEffect(() => {
        setProbedMaxzoom(null)
        if (roundedLat == null || roundedLng == null) return
        if (!probeTileUrl || !probeTileUrl.includes("{z}") || configuredMaxzoom == null) return
        let cancelled = false
        probeMaxZoomAt(probeTileUrl, roundedLng, roundedLat, configuredMaxzoom).then((z) => {
            if (!cancelled) setProbedMaxzoom(z)
        })
        return () => { cancelled = true }
    }, [probeTileUrl, configuredMaxzoom, roundedLat, roundedLng])

    return useMemo<ClientDemUpstream | null>(() => {
        if (!baseUpstream || probedMaxzoom == null || baseUpstream.maxzoom == null || probedMaxzoom >= baseUpstream.maxzoom) return baseUpstream
        return { ...baseUpstream, maxzoom: probedMaxzoom }
    }, [baseUpstream, probedMaxzoom])
}

export const SlopeSource = memo(({
    enabled, sourceMode, terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}: {
    enabled: boolean
    sourceMode: SlopeSourceMode
    terrainSource: TerrainSource | string
    customTerrainSources: CustomTerrainSource[]
    mapboxKey: string
    maptilerKey: string
    titilerEndpoint: string
}) => {
    const resolvedUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
    const clientUpstream = sourceMode === "client" ? resolvedUpstream : null

    if (!enabled) return null

    if (clientUpstream) {
        const url = buildSlopeProtocolUrl(clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize)
        return (
            <Source
                id="slopeSource"
                // clientUpstream.template in the key: re-picking a different file for
                // the same "cog-local" source (id unchanged) must remount rather than
                // patch tiles against a stale pyramid keyed by the old blob: URL.
                key={`slope-client-${terrainSource}-${clientUpstream.template}`}
                type="raster-dem"
                tiles={[url]}
                tileSize={clientUpstream.tileSize}
                encoding="mapbox"
                minzoom={clientUpstream.minzoom}
                maxzoom={clientUpstream.maxzoom}
            />
        )
    }

    return (
        <Source
            id="slopeSource"
            key="slope-plantopo"
            type="raster-dem"
            tiles={[SLOPE_SOURCE_URL]}
            tileSize={256}
            encoding="mapbox"
        />
    )
})
SlopeSource.displayName = "SlopeSource"

// ─── Aspect / TRI / Curvature sources ──────────────────────────────────────────
//
// Unlike slope, these have no PlanTopo-style server fallback — when the active
// terrain source has no supported client-upstream (see useClientDemUpstream above:
// currently everything except wms-raw/stac/mosaicjson), this simply renders
// nothing (see AspectOptionsSection/TriOptionsSection/CurvatureOptionsSection,
// which don't offer a source-mode toggle for the same reason).
interface NormalDerivedSourceProps {
    enabled: boolean
    sourceId: string
    terrainSource: TerrainSource | string
    customTerrainSources: CustomTerrainSource[]
    mapboxKey: string
    maptilerKey: string
    titilerEndpoint: string
    buildUrl: (template: string, encoding: "terrarium" | "mapbox", tileSize: number) => string
    // Appended to the Source's remount key alongside terrainSource — lets a caller
    // (e.g. CurvatureSource, whose formula depends on curvatureMode) force a fresh
    // Source/tile-cache when something other than the terrain source changes.
    keySuffix?: string
    // Viewport-center lat/lng, forwarded to useClientDemUpstream's own probe —
    // see that hook's params for why this is optional (most callers don't pass
    // it; LrmSource does, so the displayed layer's maxzoom agrees with what
    // the Elevation Picker's LRM point-sample already falls back to).
    lat?: number
    lng?: number
}

const NormalDerivedSource = memo(({ enabled, sourceId, terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, buildUrl, keySuffix = "", lat, lng }: NormalDerivedSourceProps) => {
    const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, lat, lng)
    if (!enabled || !clientUpstream) return null
    const url = buildUrl(clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize)
    return (
        <Source
            id={sourceId}
            // clientUpstream.template: same re-pick staleness reasoning as SlopeSource above.
            key={`${sourceId}-${terrainSource}${keySuffix}-${clientUpstream.template}`}
            type="raster-dem"
            tiles={[url]}
            tileSize={clientUpstream.tileSize}
            // Terrarium, not mapbox/terrain-rgb — these tiles hold curvature/TRI/TPI/
            // roughness/openness/blobness/LRM values (see normal-derived-protocol.ts),
            // not real elevation, and Terrain-RGB's fixed 0.1 step was coarse enough
            // relative to their typical (often ×100-scaled, near-zero) range to show as
            // visible banding — Terrarium's 1/256 (~0.0039) step fixes that. Must match
            // whatever elevationTo* function normal-derived-protocol.ts/lrm-protocol.ts
            // actually encoded these tiles with.
            encoding="terrarium"
            minzoom={clientUpstream.minzoom}
            maxzoom={clientUpstream.maxzoom}
        />
    )
})
NormalDerivedSource.displayName = "NormalDerivedSource"

export const AspectSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource {...props} sourceId="aspectSource" buildUrl={buildAspectProtocolUrl} />
))
AspectSource.displayName = "AspectSource"

export const TriSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource {...props} sourceId="triSource" buildUrl={buildTriProtocolUrl} />
))
TriSource.displayName = "TriSource"

export const CurvatureSource = memo(({ mode, ...props }: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl" | "keySuffix"> & { mode: CurvatureMode }) => (
    <NormalDerivedSource
        {...props}
        sourceId="curvatureSource"
        keySuffix={`-${mode}`}
        buildUrl={(template, encoding, tileSize) => buildCurvatureProtocolUrl(template, encoding, tileSize, mode)}
    />
))
CurvatureSource.displayName = "CurvatureSource"

export const TpiSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource {...props} sourceId="tpiSource" buildUrl={buildTpiProtocolUrl} />
))
TpiSource.displayName = "TpiSource"

// radius (the "Smoothing Radius" control) changes which pyramid level gets fetched
// (see radiusToLevels in lib/lrm-protocol.ts) — baked into the tile URL itself, so
// (like CurvatureSource's mode) it needs a keySuffix to force a fresh Source/tile
// cache when it changes, instead of maplibre reusing stale tiles keyed by a URL
// that's about to mean something different.
export const LrmSource = memo(({ radius, ...props }: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl" | "keySuffix"> & { radius: number }) => (
    <NormalDerivedSource
        {...props}
        sourceId="lrmSource"
        keySuffix={`-${radius}`}
        buildUrl={(template, encoding, tileSize) => buildLrmProtocolUrl(template, encoding, tileSize, radius)}
    />
))
LrmSource.displayName = "LrmSource"

export const RoughnessSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource {...props} sourceId="roughnessSource" buildUrl={buildRoughnessProtocolUrl} />
))
RoughnessSource.displayName = "RoughnessSource"

// Shape Index reuses the curvature:// protocol (see buildCurvatureProtocolUrl)
// with its mode fixed rather than user-selectable — it moved out of Curvature's
// own mode dropdown into its own standalone toggle (Neighborhood statistics),
// so it needs its own sourceId to coexist with whatever mode the main
// Curvature layer is showing at the same time.
export const ShapeIndexSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource
        {...props}
        sourceId="shapeIndexSource"
        buildUrl={(template, encoding, tileSize) => buildCurvatureProtocolUrl(template, encoding, tileSize, "shape-index")}
    />
))
ShapeIndexSource.displayName = "ShapeIndexSource"

// Principal Components: Blobness/Eigenvalue Ratio/Dominant Orientation are
// three independent toggles (siblings), not one mode-switched layer like
// Curvature's — each is its own always-fixed-mode blobness:// source/sourceId
// so all three can be shown at once.
export const BlobnessSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource
        {...props}
        sourceId="blobnessSource"
        buildUrl={(template, encoding, tileSize) => buildBlobnessProtocolUrl(template, encoding, tileSize, "blobness")}
    />
))
BlobnessSource.displayName = "BlobnessSource"

export const EigenRatioSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource
        {...props}
        sourceId="eigenRatioSource"
        buildUrl={(template, encoding, tileSize) => buildBlobnessProtocolUrl(template, encoding, tileSize, "eigen-ratio")}
    />
))
EigenRatioSource.displayName = "EigenRatioSource"

export const OrientationSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource
        {...props}
        sourceId="orientationSource"
        buildUrl={(template, encoding, tileSize) => buildBlobnessProtocolUrl(template, encoding, tileSize, "orientation")}
    />
))
OrientationSource.displayName = "OrientationSource"

// radius (the "Search Radius" control) is a literal same-zoom pixel count baked
// into the tile URL (unlike LrmSource's radius, which maps to a pyramid level) —
// same keySuffix reasoning as LrmSource/CurvatureSource above.
export const SvfSource = memo(({ radius, precision, ...props }: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl" | "keySuffix"> & { radius: number; precision: HorizonPrecision }) => (
    <NormalDerivedSource
        {...props}
        sourceId="svfSource"
        keySuffix={`-${radius}-${precision}`}
        buildUrl={(template, encoding, tileSize) => buildSvfProtocolUrl(template, encoding, tileSize, radius, precision)}
    />
))
SvfSource.displayName = "SvfSource"

export const OpennessSource = memo(({ radius, mode, precision, ...props }: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl" | "keySuffix"> & { radius: number; mode: OpennessMode; precision: HorizonPrecision }) => (
    <NormalDerivedSource
        {...props}
        sourceId="opennessSource"
        keySuffix={`-${radius}-${mode}-${precision}`}
        buildUrl={(template, encoding, tileSize) => buildOpennessProtocolUrl(template, encoding, tileSize, radius, mode, precision)}
    />
))
OpennessSource.displayName = "OpennessSource"

// minRadius/maxRadius are literal same-zoom pixel counts baked into the tile URL
// (the [min,max] viewing annulus — see lib/local-dominance-protocol.ts); same
// keySuffix reasoning as SvfSource/OpennessSource above.
export const LocalDominanceSource = memo(({ minRadius, maxRadius, ...props }: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl" | "keySuffix"> & { minRadius: number; maxRadius: number }) => (
    <NormalDerivedSource
        {...props}
        sourceId="localDominanceSource"
        keySuffix={`-${minRadius}-${maxRadius}`}
        buildUrl={(template, encoding, tileSize) => buildLocalDominanceProtocolUrl(template, encoding, tileSize, minRadius, maxRadius)}
    />
))
LocalDominanceSource.displayName = "LocalDominanceSource"

// ─── Matcap / Phong sources ─────────────────────────────────────────────────────
//
// Unlike the raster-dem NormalDerivedSource sources above (which re-pack a
// scalar as pseudo-elevation for maplibre's color-relief paint to interpret),
// matcap:// and phong:// (lib/matcap-protocol.ts, lib/phong-protocol.ts)
// already produce final RGB colors per pixel — a plain `type: "raster"`
// source/layer pair, identical in kind to the raster basemap itself, is all
// that's needed. That's also exactly why these drape over 3D terrain (AND
// globe) for free: maplibre's terrain/globe renderer drapes any raster
// source automatically, the same mechanism the raster basemap already
// relies on — no custom WebGL layer, no hand-rolled mesh, no custom
// projection matrix required (a prior attempt at a hand-written
// CustomLayerInterface needed all three, and still only ever worked under
// plain mercator projection).
export const MatcapSource = memo(({
    enabled, matcapUrl, rotationDeg, exaggeration, terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}: {
    enabled: boolean
    matcapUrl: string
    rotationDeg: number
    exaggeration: number
    terrainSource: TerrainSource | string
    customTerrainSources: CustomTerrainSource[]
    mapboxKey: string
    maptilerKey: string
    titilerEndpoint: string
}) => {
    const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
    if (!enabled || !clientUpstream) return null
    const url = buildMatcapProtocolUrl(matcapUrl, rotationDeg, exaggeration, clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize)
    return (
        <Source
            id="matcapSource"
            key={`matcapSource-${terrainSource}-${clientUpstream.template}`}
            type="raster"
            tiles={[url]}
            tileSize={clientUpstream.tileSize}
            // clientUpstream.minzoom/maxzoom are only set for some upstream kinds
            // (e.g. a COG's real pyramid floor/ceiling, or a WMS source's user-set
            // "Max Zoom" field) — a plain `type: "raster"` source's strict validator
            // rejects an explicit `minzoom`/`maxzoom: undefined` outright (this is
            // the "sources.matcapSource.maxzoom: number expected, undefined found"
            // error a WMS DSM with no configured maxzoom used to hit), so these need
            // the same fallback RasterBasemapSource's own zoomRange already uses
            // rather than passing the fields through as-is.
            minzoom={clientUpstream.minzoom ?? 0}
            maxzoom={clientUpstream.maxzoom ?? 20}
        />
    )
})
MatcapSource.displayName = "MatcapSource"

export const PhongSource = memo(({
    enabled, diffuseStrength, specularStrength, lightDir, lightAlt, exaggeration,
    terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}: {
    enabled: boolean
    diffuseStrength: number
    specularStrength: number
    lightDir: number
    lightAlt: number
    exaggeration: number
    terrainSource: TerrainSource | string
    customTerrainSources: CustomTerrainSource[]
    mapboxKey: string
    maptilerKey: string
    titilerEndpoint: string
}) => {
    const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
    if (!enabled || !clientUpstream) return null
    const url = buildPhongProtocolUrl(diffuseStrength, specularStrength, lightDir, lightAlt, exaggeration, clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize)
    return (
        <Source
            id="phongSource"
            key={`phongSource-${terrainSource}-${clientUpstream.template}`}
            type="raster"
            tiles={[url]}
            tileSize={clientUpstream.tileSize}
            // See the matching comment on MatcapSource above.
            minzoom={clientUpstream.minzoom ?? 0}
            maxzoom={clientUpstream.maxzoom ?? 20}
        />
    )
})
PhongSource.displayName = "PhongSource"

export const ShadowSource = memo(({
    enabled, lightDir, lightAlt, radiusPx, terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}: {
    enabled: boolean
    lightDir: number
    lightAlt: number
    radiusPx: number
    terrainSource: TerrainSource | string
    customTerrainSources: CustomTerrainSource[]
    mapboxKey: string
    maptilerKey: string
    titilerEndpoint: string
}) => {
    const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
    if (!enabled || !clientUpstream) return null
    const url = buildShadowProtocolUrl(lightDir, lightAlt, radiusPx, clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize)
    return (
        <Source
            id="shadowSource"
            key={`shadowSource-${terrainSource}-${clientUpstream.template}`}
            type="raster"
            tiles={[url]}
            tileSize={clientUpstream.tileSize}
            // See the matching comment on MatcapSource above.
            minzoom={clientUpstream.minzoom ?? 0}
            maxzoom={clientUpstream.maxzoom ?? 20}
        />
    )
})
ShadowSource.displayName = "ShadowSource"

// ─── Tells (archaeological mound candidate) source ─────────────────────────────
//
// Unlike the raster-dem NormalDerivedSource sources above, tells:// returns an MVT
// vector tile (point features), so this needs its own `type: "vector"` Source
// rather than delegating to NormalDerivedSource. Still reuses the exact same
// useClientDemUpstream resolution — the protocol just needs an upstream DEM tile
// template/encoding/tileSize like every other terrain-derivative here.
export interface TellsSourceProps {
    enabled: boolean
    terrainSource: TerrainSource | string
    customTerrainSources: CustomTerrainSource[]
    mapboxKey: string
    maptilerKey: string
    titilerEndpoint: string
    tellsOptions: TellsOptions
    // "unfiltered" mounts a second, parallel source (id "tellsSourceUnfiltered")
    // with every veto threshold forced to 0 — same tellSize/radius/minRelief, so
    // its candidates are a superset of the filtered source's. Exists only so the
    // Export button (tells-options-section.tsx) can query an unfiltered
    // candidate set on demand: the tells:// protocol bakes veto filtering into
    // the tile content itself (see buildTellsProtocolUrl), so querySourceFeatures
    // on the regular "tellsSource" can never see rejected candidates without a
    // second differently-configured source like this one.
    variant?: "filtered" | "unfiltered"
}

export const TellsSource = memo(({ enabled, terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, tellsOptions, variant = "filtered" }: TellsSourceProps) => {
    const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
    if (!enabled || !clientUpstream) return null
    const effectiveOptions = variant === "unfiltered"
        ? { ...tellsOptions, blobnessMin: 0, planMin: 0, detHessianMin: 0 }
        : tellsOptions
    const sourceId = variant === "unfiltered" ? "tellsSourceUnfiltered" : "tellsSource"
    const url = buildTellsProtocolUrl(clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize, effectiveOptions)
    return (
        <Source
            id={sourceId}
            key={`${sourceId}-${terrainSource}-${clientUpstream.template}-${effectiveOptions.tellSizeMeters}-${effectiveOptions.radiusPx}-${effectiveOptions.minReliefMeters}-${effectiveOptions.blobnessMin}-${effectiveOptions.planMin}-${effectiveOptions.detHessianMin}-${effectiveOptions.measureScale}-${effectiveOptions.vetoResolution}`}
            type="vector"
            tiles={[url]}
            maxzoom={15}
        />
    )
})
TellsSource.displayName = "TellsSource"