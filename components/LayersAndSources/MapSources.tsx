import { memo, useMemo, useState, useEffect, useRef } from "react"
import { VectorBasemapLayer, OsmBuildingsLayer } from "./VectorBasemapLayer"
import { Source } from "react-map-gl/maplibre"
import { useAtom, useAtomValue } from "jotai"
import { findTerrainSource } from "@/lib/terrain-catalog"
import { builtinBasemap } from "@/lib/basemap-sources"
import { findDatedImagery } from "@/lib/dated-imagery"
import { entryUrl } from "@/lib/source-schema"
import type { TerrainSource } from "@/lib/terrain-types"
import { useCogProtocolVsTitilerAtom, highResTerrainAtom, viewportCenterAtom, cesiumDetailOffsetAtom, osmBuildings3dAtom, allmapsRemoveColorAtom, geHiDpiTilesAtom, type CustomTerrainSource, type AllmapsRemoveColor } from "@/lib/settings-atoms"
import { buildUnpaperUrl, sampleTileFor } from "@/lib/unpaper-protocol"

/** A scanned map's tile template through unpaper:// when the paper removal
 *  is on (Allmaps' option, applied to tiled old maps too); anything else
 *  unchanged. Only {z}/{x}/{y} and WMS bbox templates: not a COG or TileJSON. */
function withPaperRemoval(built: { url: string } | { tiles: string[]; scheme?: "xyz" | "tms" }, source: { oldMap?: boolean; bounds?: [number, number, number, number]; minzoom?: number }, rc: AllmapsRemoveColor) {
    if (!rc.enabled || !source.oldMap || !("tiles" in built) || built.tiles.length !== 1 || /^[a-z0-9-]+:\/\//.test(built.tiles[0]) && !/^https?:/.test(built.tiles[0])) return built
    const auto = rc.auto ?? true
    return { ...built, tiles: [buildUnpaperUrl(built.tiles[0], { color: auto ? "auto" : rc.color, threshold: rc.threshold, hardness: rc.hardness, gain: rc.autoGain ?? 0.5, sample: sampleTileFor(source.bounds, source.minzoom) })] }
}
import { localFileVersionAtom, resolveLocalFileUrl, localFileId } from "@/lib/local-file-store"
import { isTitilerTemplate, probeMaxZoomAt, probeWorthwhile } from "@/lib/tile-max-zoom"
import { pushToast } from "@/components/ui/toast"
import type { RasterDEMSourceSpecification } from 'maplibre-gl'
import { setColorFunction } from '@geomatico/maplibre-cog-protocol'
import { useCogMetadata, zoomRangeFromMetadata, cogSourceMaxzoomCap, type CogMetadata } from "@/lib/cog-metadata"
import { writeTerrainrgb, writeTerrarium, resolveCustomEncoding } from "@/lib/elevation-encoding"
import { resolveNodata } from "@/lib/nodata"
import { buildRasterTileSource } from "@/lib/source-builder"
import { buildSlopeProtocolUrl } from "@/lib/slope-protocol"
import { isCellRoutedUrl } from "@/lib/vrt-protocol"
import { terrainTileSpec, terrainTileInputs, pyramidTileSize, makeElevationColorFunction, type TilejsonMetadata } from "@/lib/terrain-tile-spec"
import { useVrtInfo } from "@/lib/use-vrt-info"
import { withQuantizedMeshDetail } from "@/lib/quantized-mesh-protocol"
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
import { useResolvedWaybackRelease } from "@/lib/wayback"
import { HISTORICAL_BASEMAP_IDS } from "@/lib/historical-sources"
import { STATIC_BASEMAP_ATTRIBUTIONS } from "@/lib/basemap-attribution"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

// -------------------------
// Hook
// -------------------------

export type { TilejsonMetadata }

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

// The built-in basemaps with a fixed tile address are entries of the shared
// schema (lib/basemap-sources.ts). "osm" is a vector style (VectorBasemapLayer);
// its ceiling is OpenFreeMap's.
const OSM_MAXZOOM = 19
// The dated imagery (Wayback, HLS, Google Earth historical, Planet, EOX) has
// an address per date: entries of the dated schema (lib/dated-imagery.ts),
// with their tile size and ceiling.

// -------------------------
// TerrainSources
// -------------------------

export const TerrainSources = memo(({
    // source, mapboxKey, maptilerKey, customTerrainSources, titilerEndpoint,
    source, mapboxKey, maptilerKey, customTerrainSources, titilerEndpoint, onZoomRangeChange, lat, lng, zoom,
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
    /** Current zoom, primary view only - drives the "zoom in" notice below. */
    zoom?: number
}) => {
    const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
    const cesiumDetailOffset = useAtomValue(cesiumDetailOffsetAtom)
    const [highResTerrain] = useAtom(highResTerrainAtom)
    // Unused directly — read so this component re-renders when a local COG file
    // is (re-)picked (see custom-source-details.tsx's "Re-select file…" flow).
    useAtomValue(localFileVersionAtom)

    // Every source is an entry, a Worldwide Default included (lib/terrain-catalog.ts).
    const customSource = findTerrainSource(source, customTerrainSources)
    // A local file can only ever stream via the in-browser geomatico protocol —
    // there's no titiler server that could reach the user's disk — so it ignores
    // the useCogProtocolVsTitiler toggle entirely, unlike a remote "cog" source.
    const isCogLocal = customSource?.type === 'cog-local'
    // A source can opt out of the in-browser reader (non-3857 COG, see
    // CustomTerrainSource.cogViaTitiler); it then behaves as if the global
    // toggle were set to titiler for this source only.
    const useCogProtocolForSource = useCogProtocol && !customSource?.cogViaTitiler
    const isCogProtocol = (customSource?.type === 'cog' && useCogProtocolForSource) || isCogLocal
    const isTilejson = customSource?.type === 'tilejson'
    // A VRT read in-browser (vrt://) has no COG header to detect a zoom range
    // from — its own XML index supplies one instead.
    const isVrtClient = customSource?.type === 'vrt' && (useCogProtocolForSource || isCellRoutedUrl(customSource.url))
    const vrtInfo = useVrtInfo(isVrtClient ? customSource!.url : null)
    // For a local file, this session's blob: URL if the file has been picked (or
    // re-picked after a reload), else null — same "not ready yet" shape as a COG
    // still fetching its metadata below.
    const resolvedCogUrl = isCogLocal
        ? (customSource ? resolveLocalFileUrl(localFileId(customSource.url)) : null)
        : (customSource?.url ?? null)

    const { data: metadata } = useCogMetadata(isCogProtocol ? resolvedCogUrl : null)
    const tilejsonMetadata = useTilejsonMetadata(isTilejson ? customSource.url : null)
    // "dem-diff" (DSM minus DTM, lib/demdiff-protocol.ts): its tiles are the
    // difference of two other sources' tiles, resolved the way the client-side
    // viz modes resolve any upstream - so the primary terrain and every viz
    // mode read the same derived grid.
    const diffUpstream = useClientDemUpstream(source, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
    const { minzoom, maxzoom: cogDetectedMaxzoom } = useMemo(() => zoomRangeFromMetadata(metadata), [metadata])
    const detectedMaxzoom = vrtInfo?.maxzoom ?? cogDetectedMaxzoom
    // A custom source's explicit maxzoom (e.g. WMS sources without COG metadata to auto-detect from)
    // wins over both the metadata-detected value and the 0-20 fallback.
    const maxzoom = customSource?.maxzoom ?? detectedMaxzoom
    // Same override shape as maxzoom: a source that errors on huge tiles can
    // declare the lowest zoom it actually serves (see CustomTerrainSource.minzoom).
    // A client-read VRT gets one from its index whether or not the entry
    // declares it: below that zoom a single tile spans more source files than
    // the protocol will Range-read, so it would fail rather than blur. It goes
    // here and NOT into `minzoom` above precisely because this one does not
    // clamp the camera.
    const effectiveMinzoom = customSource?.minzoom ?? vrtInfo?.minzoom ?? minzoom

    // Below a source's own floor the map is simply blank, because the camera
    // is deliberately NOT clamped (see above) and the protocol refuses rather
    // than blurs: a VRT tile down there would touch more of the mosaic's
    // files than the browser will Range-read. Nothing said why. This does -
    // once per crossing, not once per tile, hence the ref. Any source with a
    // real floor gets it, VRT (derived from its index) or a declared minzoom.
    const zoomFloor = customSource?.minzoom ?? vrtInfo?.minzoom
    const belowFloorRef = useRef(false)
    useEffect(() => {
        const below = zoom != null && zoomFloor != null && zoom < zoomFloor - 0.05
        if (below && !belowFloorRef.current) {
            const name = customSource?.name ?? (typeof source === "string" ? source : "this source")
            pushToast({
                key: `zoom-in:${typeof source === "string" ? source : name}`,
                tone: "warn", title: `Zoom in to z${Math.ceil(zoomFloor!)} for ${name}`,
                body: vrtInfo?.minzoom != null && customSource?.minzoom == null
                    ? "Below that, one tile spans more of the mosaic's files than the browser will read, so nothing loads rather than everything blurring."
                    : "This source does not serve tiles below that zoom.",
                duration: 7000,
            })
        }
        belowFloorRef.current = below
    }, [zoom, zoomFloor, source, customSource?.name, customSource?.minzoom, vrtInfo?.minzoom])

    useEffect(() => {
        if (isCogProtocol && !metadata) return  // don't fire until real metadata
        // Deliberately reports the DETECTED minzoom, not customSource.minzoom.
        // TerrainViewer feeds this into effectiveMinZoom -> map.setMinZoom(), so a
        // source-declared minzoom would clamp the user's camera and stop them
        // zooming out at all. That field exists only to stop us *requesting* tiles
        // a service can't answer (see CustomTerrainSource.minzoom); below it the
        // terrain should simply not render, while the viewport stays free.
        onZoomRangeChange?.({ minzoom, maxzoom, isCustom: !!customSource })
    }, [minzoom, maxzoom, metadata, isCogProtocol, onZoomRangeChange])

    // Register color function for COG protocol
    useEffect(() => {
        if (!isCogProtocol || !resolvedCogUrl) return
        const scale = metadata?.scale ?? 1
        const offset = metadata?.offset ?? 0
        const noData = metadata?.noData
        // null when the source sets neither — the file's own noData tag and the
        // non-finite guard still apply, so Dura-style NaN borders are fixed
        // without any per-source configuration.
        const nodata = resolveNodata(customSource ?? {})
        setColorFunction(
            resolvedCogUrl,
            makeElevationColorFunction(
                highResTerrain ? writeTerrarium : writeTerrainrgb,
                scale, offset, noData, nodata,
            )
        )
    }, [isCogProtocol, resolvedCogUrl, highResTerrain, metadata?.scale, metadata?.offset, metadata?.noData, customSource?.nodataFloor, customSource?.nodataFill])

    const sourceConfig: RasterDEMSourceSpecification | null | undefined = useMemo(() => {
        if (customSource?.type === "dem-diff") {
            if (!diffUpstream) return null
            return {
                type: "raster-dem",
                tileSize: 256,
                tiles: [diffUpstream.template],
                encoding: "mapbox",
                minzoom: diffUpstream.minzoom ?? 0,
                // Two levels past the finer operand's native pyramid: the camera
                // ceiling follows this (effectiveMaxZoom in TerrainViewer), and
                // the protocol upsamples from ancestor tiles for anything an
                // operand cannot serve, so over-requesting costs nothing.
                maxzoom: Math.min(22, (diffUpstream.maxzoom ?? 20) + 2),
            }
        }
        if (customSource) {
            // For COG protocol, wait for metadata before rendering (this also covers a
            // local file not (re-)picked yet this session — resolvedCogUrl is null,
            // so useCogMetadata above never resolves); same for tilejson, whose
            // "encoding" field (when present) is fetched instead of asked upfront.
            if (isCogProtocol && !metadata) return null
            if (isTilejson && !tilejsonMetadata) return null
            // Same reason: mounting a client-read VRT before its index is
            // parsed would declare a 0-20 range and let maplibre ask for the
            // whole-mosaic tiles the protocol refuses.
            if (isVrtClient && !vrtInfo) return null

            const built = buildRasterTileSource({
                url: isCogLocal ? resolvedCogUrl! : entryUrl(customSource, { mapboxKey, maptilerKey }),
                type: isCogLocal ? 'cog' : customSource.type as Parameters<typeof buildRasterTileSource>[0]['type'],
                useCogProtocol: isCogLocal ? true : useCogProtocolForSource,
                titilerEndpoint,
                isDem: true,
                nodata: customSource,
                titilerNodata: customSource.titilerNodata,
            })
            const encoding = isCogProtocol
                ? highResTerrain ? 'terrarium' : 'mapbox'
                : isTilejson
                ? (tilejsonMetadata?.encoding === 'terrarium' ? 'terrarium' : tilejsonMetadata?.encoding === 'mapbox' ? 'mapbox' : (customSource.encoding ?? 'mapbox'))
                // float32demProtocol (float32dem-protocol.ts) re-encodes the WMS-raw
                // GeoTIFF as Terrarium (not Terrain-RGB) for its ~4mm vs 10cm precision —
                // must match here or maplibre would misdecode every pixel.
                // lerc:// and quantized-mesh:// re-encode to Terrarium too (same
                // reason as wms-raw: ~4 mm vs Terrain-RGB's 10 cm). Missing them
                // here made a library LERC source read 832354 m in the elevation
                // picker - Terrarium bytes decoded with Terrain-RGB's factors -
                // with the hillshade and hypsometric ramp wrecked to match.
                : customSource.type === 'terrarium' || customSource.type === 'wms-raw'
                  || customSource.type === 'lerc' || customSource.type === 'quantized-mesh' ? 'terrarium'
                : 'mapbox'  // terrainrgb
            // Custom RGB packing, for plain tile pyramids that use neither named
            // encoding — e.g. Mexico's INEGI, which is Terrain-RGB's factors with
            // baseShift 1000 instead of 10000 and reads ~9 km too low otherwise.
            // Deliberately restricted to the TMS family: cog:// and wms-raw tiles
            // reach maplibre already re-encoded to Terrarium by our own protocols,
            // so overriding their encoding would corrupt every pixel.
            const customEncoding = customSource.type === 'terrarium' || customSource.type === 'terrainrgb'
                ? resolveCustomEncoding(customSource)
                : null
            const sourceMaxzoom = isCogProtocol ? (customSource.maxzoom ?? cogSourceMaxzoomCap(metadata)) : maxzoom
            return {
                type: "raster-dem",
                // wms-raw's URL requests a fixed WIDTH/HEIGHT (e.g. 514 = 512 + 1px buffer per side)
                // matching a 512px tile — see public/maplibre-raster-dem-wms-float32-generic.html.
                // TileJSON sources carry their own tileSize in the manifest maplibre fetches.
                ...(customSource.type === 'tilejson' ? {} : { tileSize: customSource.type === 'wms-raw' ? (customSource.tileSize ?? 512) : pyramidTileSize(customSource) }),
                // Omitted rather than undefined: MapLibre 6 validates raster-dem
                // sources on addSource and rejects a present-but-undefined key
                // ("minzoom: number expected, undefined found"), which dropped
                // every derived layer of the source.
                ...(effectiveMinzoom != null ? { minzoom: effectiveMinzoom } : {}),
                // A cog:// source is declared by `url`, so the protocol's own
                // TileJSON carries the finest level and MapLibre overzooms its
                // last tile past it, instead of the protocol upsampling blocks
                // (geomatico/maplibre-cog-protocol issue 56). An explicit
                // maxzoom would override that TileJSON, so only a user-set
                // ceiling, or the z22 safety cap, is passed; the detected
                // range above still clamps the camera (onZoomRangeChange).
                ...(sourceMaxzoom != null ? { maxzoom: sourceMaxzoom } : {}),
                encoding: customEncoding ? 'custom' : encoding,
                ...(customEncoding ?? {}),
                ...("tiles" in built ? { ...built, tiles: built.tiles.map((t) => withQuantizedMeshDetail(t, cesiumDetailOffset)) } : built),
            }
        }

        return null
    }, [diffUpstream, customSource, source, useCogProtocolForSource, titilerEndpoint, highResTerrain, effectiveMinzoom, maxzoom, isCogProtocol, isCogLocal, resolvedCogUrl, isTilejson, tilejsonMetadata, isVrtClient, vrtInfo, mapboxKey, maptilerKey, metadata, cesiumDetailOffset])

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
    const probedForRef = useRef("")
    // Rounded to ~11km — coarser than the underlying probe's own zoom-6 cache
    // bucket would need, but avoids re-running this effect on every sub-pixel
    // lat/lng nudge a live pan/zoom might otherwise produce.
    const roundedLat = typeof lat === "number" ? Math.round(lat * 10) / 10 : lat
    const roundedLng = typeof lng === "number" ? Math.round(lng * 10) / 10 : lng
    // Deferred until the view is deep enough for the clamp to matter: a
    // boolean, so the effect re-runs only when the view crosses that line.
    const viewZoom = useAtomValue(viewportCenterAtom)?.zoom
    const probeNeeded = configuredMaxzoom != null && probeWorthwhile(viewZoom, configuredMaxzoom)
    useEffect(() => {
        // Reset when the SOURCE changed: a stale probe result from the
        // previous template must not clamp the new one. Not when only the
        // place changed: the reset put the declared maxzoom back in the
        // Source key, so every move past 0.1 degree remounted the terrain
        // and hillshade sources twice (declared, then probed) and the view
        // went blank each time. The previous place's clamp holds until the
        // new probe answers, and an equal answer changes nothing.
        const probeKey = `${probeTileUrl}|${configuredMaxzoom}`
        const sameSource = probedForRef.current === probeKey
        probedForRef.current = probeKey
        if (!probeTileUrl || !probeTileUrl.includes("{z}") || configuredMaxzoom == null || !probeNeeded) { setProbedMaxzoom(null); return }
        if (!sameSource) setProbedMaxzoom(null)
        // A titiler tile exists at every zoom inside the file (see isTitilerTemplate).
        if (isTitilerTemplate(probeTileUrl, titilerEndpoint)) return
        let cancelled = false
        probeMaxZoomAt(probeTileUrl, roundedLng, roundedLat, configuredMaxzoom).then((z) => {
            if (!cancelled) setProbedMaxzoom(z)
        })
        return () => { cancelled = true }
    }, [probeTileUrl, configuredMaxzoom, roundedLat, roundedLng, probeNeeded, titilerEndpoint])

    // Only ever lowers maxzoom (probedMaxzoom is always <= configuredMaxzoom by
    // construction) — clamping here just tells maplibre where to stop
    // descending the pyramid, so it overzooms (upsamples) the last real tile
    // instead of requesting one that 404s. The reported onZoomRangeChange above
    // deliberately still uses the unclamped, configured maxzoom — that's "how
    // far this pyramid can theoretically go" for the camera zoom UI, a
    // different question from "what does THIS exact viewport have."
    const effectiveSourceConfig = useMemo(() => {
        if (!sourceConfig || probedMaxzoom == null || sourceConfig.maxzoom == null || probedMaxzoom >= sourceConfig.maxzoom) return sourceConfig
        // Never below the source's own minzoom: a maxzoom under minzoom makes
        // maplibre request no tile at any zoom, so the source draws nothing.
        return { ...sourceConfig, maxzoom: Math.max(probedMaxzoom, sourceConfig.minzoom ?? 0) }
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
            <Source id="terrainSource"  key={`terrain-${source}-${highResTerrain}-${resolvedCogUrl}-${effectiveSourceConfig.maxzoom}-${JSON.stringify((effectiveSourceConfig as any).tiles ?? (effectiveSourceConfig as any).url)}`}  {...effectiveSourceConfig} />
            <Source id="hillshadeSource" key={`hillshade-${source}-${highResTerrain}-${resolvedCogUrl}-${effectiveSourceConfig.maxzoom}-${JSON.stringify((effectiveSourceConfig as any).tiles ?? (effectiveSourceConfig as any).url)}`} {...effectiveSourceConfig} />
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
// Planet tiles draw down a quota, and every month is a full screen of new ones
// (45 at 1920x1080): a month is only asked for once the timeline rests on it,
// not while stepping or dragging past it.
const PLANET_DATE_DEBOUNCE_MS = 800

export const RasterBasemapSource = memo(({
    // basemapSource, mapboxKey, hereKey, customBasemapSources, titilerEndpoint,
    basemapSource: rawBasemapSource, mapboxKey, maptilerKey, hereKey, planetKey, date: rawDate, latitude, longitude, zoom, customBasemapSources, titilerEndpoint, onZoomRangeChange,
    vectorVisible = true, vectorOpacity = 1,
}: {
    /** For the OSM (Liberty) vector basemap, which has no raster layer to
     *  inherit the "Basemap" viz toggle and opacity from. */
    vectorVisible?: boolean
    vectorOpacity?: number
    basemapSource: string
    mapboxKey: string
    maptilerKey?: string
    hereKey?: string
    planetKey?: string
    /** Settings > Beta > "Historical Imagery Sources" gate — when false, the
     *  historical sources (wayback/hls/ge-historical/planet/eox-s2) render
     *  nothing even if somehow still selected (e.g. a stale `?basemapSource=` URL). */
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
    const cesiumDetailOffset = useAtomValue(cesiumDetailOffsetAtom)
    const osmBuildings3d = useAtomValue(osmBuildings3dAtom)
    // Unused directly — read so this component re-renders when a local COG file
    // is (re-)picked (see custom-source-details.tsx's "Re-select file…" flow).
    useAtomValue(localFileVersionAtom)

    const basemapSource = useDebouncedValue(rawBasemapSource, RASTER_SOURCE_DEBOUNCE_MS)
    const date = useDebouncedValue(rawDate, rawBasemapSource === "planet" ? PLANET_DATE_DEBOUNCE_MS : RASTER_SOURCE_DEBOUNCE_MS)
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
    // Streamed by the in-browser cog:// protocol: declared by `url`, so its
    // TileJSON sets the finest level (see TerrainSources above).
    const isCogProtocolBasemap = isCogLocal || (customBasemap?.type === "cog" && useCogProtocol && !customBasemap.cogViaTitiler)

    const removeColor = useAtomValue(allmapsRemoveColorAtom)
    const geHiDpi = useAtomValue(geHiDpiTilesAtom)
    const sourceProps = useMemo(() => {
        // "None": overlays only, no base imagery underneath.
        if (basemapSource === "none") return null
        if (customBasemap) {
            if (isCogLocal && !resolvedCogUrl) return null // not (re-)picked yet this session
            return withPaperRemoval(buildRasterTileSource({
                url: isCogLocal ? resolvedCogUrl! : customBasemap.url,
                type: isCogLocal ? "cog" : customBasemap.type,
                useCogProtocol: isCogLocal ? true : useCogProtocol && !customBasemap.cogViaTitiler,
                titilerEndpoint,
                scheme: customBasemap.scheme,
                categorical: customBasemap.categorical,
            }), customBasemap, removeColor)
        }


        // The dated imagery (lib/dated-imagery.ts): the tiles of this view's
        // date. A Wayback date names its tiles through the release serving it
        // here (useResolvedWaybackRelease); null while that, the date or a
        // key is missing, which renders nothing rather than a broken request.
        // The attribution is the source's constant pointer string: react-map-
        // gl's <Source> reconciler (node_modules/@vis.gl/react-maplibre/src/
        // components/source.ts's updateSource) has no live-update path for
        // `attribution`, so the real per-view credit lives in the sidebar's
        // Source Info section (SourceInfoSection.tsx). Bing, a dated source
        // too (its one current mosaic), is drawn as a built-in basemap below.
        const dated = findDatedImagery(basemapSource)
        if (dated?.historicalEntry) {
            const spec = dated.tiles({ dateMs: date ?? 0, ref: dated.id === "wayback" ? resolvedWaybackItem ?? undefined : undefined }, { keys: { planetKey }, hd: geHiDpi })
            return spec ? { tiles: spec.tiles, tileSize: spec.tileSize, maxzoom: spec.maxzoom, attribution: dated.attribution } : null
        }

        const basemap = builtinBasemap(basemapSource) ?? builtinBasemap("google")!
        const tileUrl = entryUrl(basemap, { mapboxKey, maptilerKey, hereKey })
        return { tiles: [tileUrl], tileSize: basemap.tileSize ?? 256, maxzoom: basemap.maxzoom, attribution: STATIC_BASEMAP_ATTRIBUTIONS[basemap.id] }
    }, [customBasemap, basemapSource, resolvedWaybackItem, date, planetKey, useCogProtocol, titilerEndpoint, mapboxKey, maptilerKey, hereKey, isCogLocal, resolvedCogUrl, removeColor, geHiDpi])

    const zoomRange = useMemo(() => {
        if (customBasemap) return { minzoom: customBasemap.minzoom ?? 0, maxzoom: customBasemap.maxzoom ?? 22, isCustom: true }
        const dated = findDatedImagery(basemapSource)
        if (dated?.historicalEntry) return { minzoom: 0, maxzoom: dated.maxzoom, isCustom: false }
        if (basemapSource === "osm") return { minzoom: 0, maxzoom: OSM_MAXZOOM, isCustom: false }
        return { minzoom: 0, maxzoom: (builtinBasemap(basemapSource) ?? builtinBasemap("google")!).maxzoom ?? 22, isCustom: false }
    }, [customBasemap, basemapSource])

    useEffect(() => {
        onZoomRangeChange?.(zoomRange)
    }, [zoomRange, onZoomRangeChange])

    // "osm" is OpenFreeMap's Liberty vector style, not raster tiles: the
    // layers are inserted at the basemap slot by VectorBasemapLayer.
    if (basemapSource === "osm") return <VectorBasemapLayer visible={vectorVisible} opacity={vectorOpacity} />
    // The 3D switch next to OSM draws the extruded buildings over any other
    // basemap too (and over a terrain-only view): Liberty's extrusion layer alone.
    const buildings = osmBuildings3d ? <OsmBuildingsLayer /> : null
    if (!sourceProps) return buildings

    return (<>
        {buildings}
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
            // A cog:// basemap only gets a maxzoom the user set: the 22
            // fallback overrode the protocol's TileJSON and had it upsample
            // the finest level into blocks (geomatico/maplibre-cog-protocol
            // issue 56); without it MapLibre overzooms the last tile.
            minzoom={zoomRange.minzoom}
            {...(isCogProtocolBasemap && customBasemap?.maxzoom == null ? {} : { maxzoom: zoomRange.maxzoom })}
            {...sourceProps}
        />
    </>)
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
    const cesiumDetailOffset = useAtomValue(cesiumDetailOffsetAtom)
    const removeColor = useAtomValue(allmapsRemoveColorAtom)
    // Unused directly — read so this component re-renders when a local COG file
    // is (re-)picked (see custom-source-details.tsx's "Re-select file…" flow).
    useAtomValue(localFileVersionAtom)

    return (
        <>
            {overlayIds.map((id) => {
                const source = customBasemapSources.find((s) => s.id === id)
                if (!source) return null
                // A georeferenced picture: MapLibre's image source from its
                // four corners (Tools > Image Georeferencer). Keyed on the
                // resolved url: a re-picked local file is a new source.
                // A georeferenced IIIF map draws from its own custom layer
                // (MapLayers.tsx, AllmapsOverlayLayer): no MapLibre source.
                if (source.type === "iiif") return null
                if ((source.type === "image" || source.type === "image-local") && source.coordinates) {
                    const imgUrl = source.type === "image-local" ? resolveLocalFileUrl(localFileId(source.url)) : source.url
                    if (!imgUrl) return null
                    return (
                        <Source key={`overlay-${id}-${imgUrl}`} id={`overlay-basemap-source-${id}`} type="image" url={imgUrl} coordinates={source.coordinates} />
                    )
                }
                const isCogLocal = source.type === "cog-local"
                const resolvedCogUrl = isCogLocal ? resolveLocalFileUrl(localFileId(source.url)) : null
                if (isCogLocal && !resolvedCogUrl) return null // not (re-)picked yet this session
                const sourceProps = withPaperRemoval(buildRasterTileSource({
                    url: isCogLocal ? resolvedCogUrl! : source.url,
                    type: isCogLocal ? "cog" : source.type,
                    // Same per-source titiler pin as the main basemap path -
                    // a 4326 / UTM COG stacked as an overlay was blank without it.
                    useCogProtocol: isCogLocal ? true : useCogProtocol && !source.cogViaTitiler,
                    titilerEndpoint,
                    scheme: source.scheme,
                    categorical: source.categorical,
                }), source, removeColor)
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
                        // A cog:// overlay leaves maxzoom to the protocol's
                        // TileJSON unless the user set one (see RasterBasemapSource).
                        {...(source.maxzoom == null && (isCogLocal || (source.type === "cog" && useCogProtocol && !source.cogViaTitiler)) ? {} : { maxzoom: source.maxzoom ?? 19 })}
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

/** Settings the derived modes' URLs depend on - the same state the mounted
 *  sources below receive from TerrainViewer. */
export interface DerivedModeParams {
    curvatureMode: CurvatureMode
    lrmRadius: number
    svfRadius: number
    svfPrecision: HorizonPrecision
    opennessRadius: number
    opennessMode: OpennessMode
    opennessPrecision: HorizonPrecision
    localDominanceMinRadius: number
    localDominanceMaxRadius: number
}

/** A derived mode's tile template without its source on the map - for the
 *  layer export of modes whose group is switched off (a mode's source is
 *  mounted whenever its group is on, see TerrainViewer). Built with the same
 *  builders and arguments as the Source components below. Slope re-encodes
 *  as Terrain-RGB, every other mode as Terrarium. */
export function derivedModeTemplate(sourceId: string, up: ClientDemUpstream, p: DerivedModeParams): { template: string; encoding: "terrarium" | "mapbox"; tileSize: number; maxzoom?: number } | null {
    const t = up.template, e = up.encoding, n = up.tileSize
    const url = (() => {
        switch (sourceId) {
            case "slopeSource": return buildSlopeProtocolUrl(t, e, n)
            case "aspectSource": return buildAspectProtocolUrl(t, e, n)
            case "triSource": return buildTriProtocolUrl(t, e, n)
            case "curvatureSource": return buildCurvatureProtocolUrl(t, e, n, p.curvatureMode)
            case "tpiSource": return buildTpiProtocolUrl(t, e, n)
            case "roughnessSource": return buildRoughnessProtocolUrl(t, e, n)
            case "shapeIndexSource": return buildCurvatureProtocolUrl(t, e, n, "shape-index")
            case "blobnessSource": return buildBlobnessProtocolUrl(t, e, n, "blobness")
            case "eigenRatioSource": return buildBlobnessProtocolUrl(t, e, n, "eigen-ratio")
            case "orientationSource": return buildBlobnessProtocolUrl(t, e, n, "orientation")
            case "lrmSource": return buildLrmProtocolUrl(t, e, n, p.lrmRadius)
            case "svfSource": return buildSvfProtocolUrl(t, e, n, p.svfRadius, p.svfPrecision)
            case "opennessSource": return buildOpennessProtocolUrl(t, e, n, p.opennessRadius, p.opennessMode, p.opennessPrecision)
            case "localDominanceSource": return buildLocalDominanceProtocolUrl(t, e, n, p.localDominanceMinRadius, p.localDominanceMaxRadius)
            default: return null
        }
    })()
    if (!url) return null
    return { template: url, encoding: sourceId === "slopeSource" ? "mapbox" : "terrarium", tileSize: n, maxzoom: up.maxzoom }
}

/** Settings the lighting tiles depend on. The raster (tile) renderer of
 *  Matcap and Phong takes the light as an absolute direction; the live
 *  renderer's "light follows the camera" option does not apply to them. */
export interface LightingParams {
    matcapUrl: string
    matcapRotationDeg: number
    phongDiffuse: number
    phongSpecular: number
    phongFresnelStrength?: number
    phongFresnelPower?: number
    phongFresnelDark?: boolean
    lightDir: number
    lightAlt: number
    exaggeration: number
    shadowRadiusPx: number
}

/** Matcap, Phong or hard-shadow tile template over the terrain upstream,
 *  built like MatcapSource/PhongSource/ShadowSource below, whether or not the
 *  map currently draws them with the live GL renderer. Tiles are RGBA. */
export function lightingTemplate(kind: "matcap" | "phong" | "shadow", up: ClientDemUpstream, p: LightingParams): { template: string; tileSize: number; maxzoom?: number } {
    const t = up.template, e = up.encoding, n = up.tileSize
    const template = kind === "matcap" ? buildMatcapProtocolUrl(p.matcapUrl, p.matcapRotationDeg, p.exaggeration, t, e, n)
        : kind === "phong" ? buildPhongProtocolUrl(p.phongDiffuse, p.phongSpecular, p.lightDir, p.lightAlt, p.exaggeration, t, e, n, { strength: p.phongFresnelStrength ?? 0, power: p.phongFresnelPower ?? 3, dark: p.phongFresnelDark ?? false })
        : buildShadowProtocolUrl(p.lightDir, p.lightAlt, p.shadowRadiusPx, t, e, n)
    return { template, tileSize: n, maxzoom: up.maxzoom }
}

// Split in two so react-refresh's signature graph has no cycle: a hook that
// calls itself (this one did, for the two operands of a "dem-diff" source)
// sends Fast Refresh's computeFullKey into infinite recursion at load in dev
// ("Maximum call stack size exceeded" from @react-refresh). The leaf hook
// resolves one source and takes the operands as values; the exported hook
// calls the leaf three times.
export const useClientDemUpstreamOne = (
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
    latProp?: number,
    lngProp?: number,
    /** Set when resolving one operand of a "dem-diff" source, so a
     *  difference of differences stops at one level. */
    _nested = false,
    /** The resolved operands of a "dem-diff" source (null when not one, or
     *  when nested). */
    diffA: ClientDemUpstream | null = null,
    diffB: ClientDemUpstream | null = null,
): ClientDemUpstream | null => {
    const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)
    const cesiumDetailOffset = useAtomValue(cesiumDetailOffsetAtom)
    const [highResTerrain] = useAtom(highResTerrainAtom)
    // A "dem-diff" source is the difference of two other sources' tiles (see
    // lib/demdiff-protocol.ts): resolve both operands with this same hook and
    // wrap their templates. Operands that are themselves differences resolve
    // to null.
    // Callers that pass lat/lng win; everyone else probes at the primary
    // viewport centre (see viewportCenterAtom), so no viz source is left with
    // a declared maxzoom the tiles at this location cannot honour.
    const viewportCenter = useAtomValue(viewportCenterAtom)
    const lat = latProp ?? viewportCenter?.lat
    const lng = lngProp ?? viewportCenter?.lng
    // Unused directly — read so this re-renders when a local COG file is (re-)picked.
    const localFileVersion = useAtomValue(localFileVersionAtom)
    const customSource = findTerrainSource(terrainSource, customTerrainSources)
    const isTilejson = customSource?.type === "tilejson"
    const tilejsonMetadata = useTilejsonMetadata(isTilejson ? customSource!.url : null)

    // Same COG-metadata-derived zoom clamp the primary terrain Source gets (see
    // TerrainSources above) — without it, a COG's fixed native pyramid has no
    // ceiling here, so overzooming past it doesn't fall back to a lower-zoom
    // parent tile the way maplibre's own raster-dem handling does; it instead
    // asks the geomatico protocol for a tile beyond the data it has, which can
    // render as a blank/degenerate tile instead of a harmless overzoom blur.
    const isCogLocal = customSource?.type === "cog-local"
    // A source pinned to titiler (cogViaTitiler: non-Mercator file, or a host
    // without CORS) must stay on titiler here too - the primary source honours
    // the pin, and this resolver used to ignore it, so every client-computed
    // mode (and the difference source) tried the in-browser reader instead:
    // no CORS, no metadata, no tiles. (terrainTileInputs applies the pin.)
    const inputs = terrainTileInputs(customSource, useCogProtocol)
    const cogUrlForMetadata = isCogLocal
        ? resolveLocalFileUrl(localFileId(customSource!.url))
        : inputs.cogUrl
    const { data: cogMetadata } = useCogMetadata(cogUrlForMetadata)
    const cogZoomRange = useMemo(() => zoomRangeFromMetadata(cogMetadata), [cogMetadata])
    // A VRT read in-browser needs the same treatment from its own XML index:
    // it has no COG header, and its minzoom is a real floor (below it one tile
    // spans more source files than vrt-protocol.ts will Range-read).
    const vrtInfo = useVrtInfo(inputs.vrtUrl)

    // The resolution itself is pure (lib/terrain-tile-spec.ts, shared with the
    // tile service's direct engine); this hook supplies what it waits for.
    const baseUpstream = useMemo<ClientDemUpstream | null>(() => {
        const spec = terrainTileSpec(terrainSource, customSource, {
            titilerEndpoint, useCogProtocol, highResTerrain, cesiumDetailOffset, mapboxKey, maptilerKey,
            tilejson: tilejsonMetadata,
            cogZoomRange: cogMetadata ? cogZoomRange : null,
            vrtInfo,
            localFileUrl: isCogLocal ? resolveLocalFileUrl(localFileId(customSource!.url)) : null,
            diffOperands: !_nested && diffA && diffB ? [diffA, diffB] : null,
        })
        if (!spec) return null
        // ClientDemUpstream's fields only: bounds and a custom packing are
        // not passed on to the browser's consumers.
        const { template, encoding, tileSize, minzoom, maxzoom } = spec
        return { template, encoding, tileSize, ...(minzoom !== undefined ? { minzoom } : {}), ...(maxzoom !== undefined ? { maxzoom } : {}) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diffA, diffB, _nested, customSource, terrainSource, mapboxKey, maptilerKey, titilerEndpoint, useCogProtocol, highResTerrain, tilejsonMetadata, localFileVersion, cogMetadata, cogZoomRange, isCogLocal, vrtInfo])

    // Same per-viewport real-coverage probe TerrainSources runs for the
    // primary elevation Source (see lib/tile-max-zoom.ts) — only actually
    // probes when a caller passes lat/lng (see this hook's own params above).
    // Only a real XYZ `{z}` template can be probed at all (a COG/tilejson-COG
    // url has no z/x/y placeholders — its protocol resamples the actual file
    // at whatever zoom is asked, so there's no coverage gap to hit).
    const probeTileUrl = baseUpstream?.template
    const configuredMaxzoom = baseUpstream?.maxzoom
    const [probedMaxzoom, setProbedMaxzoom] = useState<number | null>(null)
    const probedForRef = useRef("")
    const roundedLat = typeof lat === "number" ? Math.round(lat * 10) / 10 : lat
    const roundedLng = typeof lng === "number" ? Math.round(lng * 10) / 10 : lng
    const viewZoom = useAtomValue(viewportCenterAtom)?.zoom
    const probeNeeded = configuredMaxzoom != null && probeWorthwhile(viewZoom, configuredMaxzoom)
    useEffect(() => {
        // Same rule as the terrain source above: reset on a new source,
        // keep the last answer while only the place changes.
        const probeKey = `${probeTileUrl}|${configuredMaxzoom}`
        const sameSource = probedForRef.current === probeKey
        probedForRef.current = probeKey
        if (roundedLat == null || roundedLng == null || !probeTileUrl || !probeTileUrl.includes("{z}") || configuredMaxzoom == null || !probeNeeded) { setProbedMaxzoom(null); return }
        if (!sameSource) setProbedMaxzoom(null)
        if (isTitilerTemplate(probeTileUrl, titilerEndpoint)) return
        let cancelled = false
        probeMaxZoomAt(probeTileUrl, roundedLng, roundedLat, configuredMaxzoom).then((z) => {
            if (!cancelled) setProbedMaxzoom(z)
        })
        return () => { cancelled = true }
    }, [probeTileUrl, configuredMaxzoom, roundedLat, roundedLng, probeNeeded, titilerEndpoint])

    return useMemo<ClientDemUpstream | null>(() => {
        if (!baseUpstream || probedMaxzoom == null || baseUpstream.maxzoom == null || probedMaxzoom >= baseUpstream.maxzoom) return baseUpstream
        return { ...baseUpstream, maxzoom: Math.max(probedMaxzoom, baseUpstream.minzoom ?? 0) }
    }, [baseUpstream, probedMaxzoom])
}

export const useClientDemUpstream = (
    terrainSource: TerrainSource | string,
    customTerrainSources: CustomTerrainSource[],
    mapboxKey: string,
    maptilerKey: string,
    titilerEndpoint: string,
    latProp?: number,
    lngProp?: number,
): ClientDemUpstream | null => {
    // A "dem-diff" source is the difference of two other sources' tiles (see
    // lib/demdiff-protocol.ts): both operands resolve first, with the same
    // leaf hook, and the source's own resolution wraps their templates.
    // Operands that are themselves differences resolve to null.
    const found = findTerrainSource(terrainSource, customTerrainSources)
    const diffSource = found?.type === "dem-diff" ? found : undefined
    const diffA = useClientDemUpstreamOne(diffSource?.diffMinuendId ?? "", customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, latProp, lngProp, true, null, null)
    const diffB = useClientDemUpstreamOne(diffSource?.diffSubtrahendId ?? "", customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, latProp, lngProp, true, null, null)
    return useClientDemUpstreamOne(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, latProp, lngProp, false, diffA, diffB)
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
                // maxzoom too: react-map-gl never applies a changed maxzoom to a
                // mounted Source, so the per-location coverage probe (see
                // useClientDemUpstream) has to remount to take effect.
                key={`slope-client-${terrainSource}-${clientUpstream.template}-z${clientUpstream.maxzoom}`}
                type="raster-dem"
                tiles={[url]}
                tileSize={clientUpstream.tileSize}
                encoding="mapbox"
                {...(clientUpstream.minzoom != null ? { minzoom: clientUpstream.minzoom } : {})}
                {...(clientUpstream.maxzoom != null ? { maxzoom: clientUpstream.maxzoom } : {})}
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
            key={`${sourceId}-${terrainSource}${keySuffix}-${clientUpstream.template}-z${clientUpstream.maxzoom}`}
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
            {...(clientUpstream.minzoom != null ? { minzoom: clientUpstream.minzoom } : {})}
            {...(clientUpstream.maxzoom != null ? { maxzoom: clientUpstream.maxzoom } : {})}
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
            key={`matcapSource-${terrainSource}-${clientUpstream.template}-z${clientUpstream.maxzoom}`}
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
    enabled, diffuseStrength, specularStrength, fresnelStrength = 0, fresnelPower = 3, fresnelDark = false, lightDir, lightAlt, exaggeration,
    terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint,
}: {
    enabled: boolean
    diffuseStrength: number
    specularStrength: number
    fresnelStrength?: number
    fresnelPower?: number
    fresnelDark?: boolean
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
    const url = buildPhongProtocolUrl(diffuseStrength, specularStrength, lightDir, lightAlt, exaggeration, clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize, { strength: fresnelStrength, power: fresnelPower, dark: fresnelDark })
    return (
        <Source
            id="phongSource"
            key={`phongSource-${terrainSource}-${clientUpstream.template}-z${clientUpstream.maxzoom}`}
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
            key={`shadowSource-${terrainSource}-${clientUpstream.template}-z${clientUpstream.maxzoom}`}
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
    // "Frozen" (see the tellsFrozen nuqs state and its capture effect in
    // TerrainViewer.tsx) swaps this source from the live tells:// vector
    // tiles to a static geojson snapshot of whatever was already loaded the
    // instant freezing began — panning/zooming a frozen map no longer
    // fetches new tiles or changes what's shown. Only meaningful for the
    // "filtered" variant: the unfiltered source only ever exists for the
    // Export button's on-demand querySourceFeatures, which freezing has no
    // reason to affect.
    frozen?: boolean
    frozenSnapshot?: GeoJSON.FeatureCollection | null
}

export const TellsSource = memo(({ enabled, terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, tellsOptions, variant = "filtered", frozen = false, frozenSnapshot = null }: TellsSourceProps) => {
    const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
    if (!enabled || !clientUpstream) return null
    const effectiveOptions = variant === "unfiltered"
        ? { ...tellsOptions, blobnessMin: 0, planMin: 0, detHessianMin: 0 }
        : tellsOptions
    const sourceId = variant === "unfiltered" ? "tellsSourceUnfiltered" : "tellsSource"
    const url = buildTellsProtocolUrl(clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize, effectiveOptions)
    // The live vector source stays mounted (under its own stable key) even
    // while frozen — TellsMarkersLayer stops referencing it (switches to
    // "tellsSourceFrozen" instead, see MapLayers.tsx), which per MapLibre's
    // own "no visible layer -> no tile fetch" behavior already satisfies
    // Frozen's "pan/zoom won't refresh them" contract, without ever calling
    // removeSource on a source that may still have tiles in flight. Actually
    // removing/re-adding "tellsSource" the instant Frozen flips on raced
    // MapLibre's worker tile-transfer teardown ("DataCloneError: ArrayBuffer
    // ... already detached") whenever a tile request was still in flight at
    // that exact moment.
    return (
        <>
            <Source
                id={sourceId}
                key={`${sourceId}-${terrainSource}-${clientUpstream.template}-z${clientUpstream.maxzoom}-${effectiveOptions.tellSizeMeters}-${effectiveOptions.radiusPx}-${effectiveOptions.minReliefMeters}-${effectiveOptions.blobnessMin}-${effectiveOptions.planMin}-${effectiveOptions.detHessianMin}-${effectiveOptions.measureScale}-${effectiveOptions.vetoResolution}-${effectiveOptions.polarity}`}
                type="vector"
                tiles={[url]}
                maxzoom={15}
            />
            {variant === "filtered" && frozen && frozenSnapshot && (
                <Source id="tellsSourceFrozen" key="tellsSourceFrozen" type="geojson" data={frozenSnapshot} />
            )}
        </>
    )
})
TellsSource.displayName = "TellsSource"