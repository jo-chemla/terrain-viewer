import { memo, useMemo, useState, useEffect } from "react"
import { Source } from "react-map-gl/maplibre"
import { useAtom, useAtomValue } from "jotai"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource, TerrainSourceConfig } from "@/lib/terrain-types"
import { useCogProtocolVsTitilerAtom, highResTerrainAtom, type CustomTerrainSource } from "@/lib/settings-atoms"
import { localFileVersionAtom, resolveLocalFileUrl, localFileId } from "@/lib/local-file-store"
import type { RasterDEMSourceSpecification } from 'maplibre-gl'
import { setColorFunction, getCogMetadata, type CogMetadata } from '@geomatico/maplibre-cog-protocol'
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
import { buildTellsProtocolUrl, type TellsOptions } from "@/lib/tells-protocol"

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

export function useCogMetadata(cogUrl: string | null): CogMetadata | null {
    const [metadata, setMetadata] = useState<CogMetadata | null>(null)
    useEffect(() => {
        // Without this reset, switching from a COG source to any other type (e.g. a
        // wms-raw IGN source) left `metadata` holding the PREVIOUS COG's bbox/zoom
        // images — TerrainSources' onZoomRangeChange effect below doesn't gate on
        // isCogProtocol being true, so it happily reported that stale COG's zoom
        // range as if it belonged to the newly-selected (unrelated) source, causing
        // an incorrect min/max zoom clamp and wrong "fit to bounds" behavior.
        if (!cogUrl) { setMetadata(null); return }
        let cancelled = false
        getCogMetadata(cogUrl).then((m) => { if (!cancelled) setMetadata(m) }).catch(() => { if (!cancelled) setMetadata(null) })
        return () => { cancelled = true }
    }, [cogUrl])
    return metadata
}

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
export function useTilejsonMetadata(tilejsonUrl: string | null): TilejsonMetadata | null {
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

const rasterBasemaps: Record<string, { url: string; tileSize: number; maxzoom: number }> = {
    osm:       { url: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png", tileSize: 256, maxzoom: 19 },
    googlesat: { url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", tileSize: 256, maxzoom: 20 },
    google:    { url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", tileSize: 256, maxzoom: 20 },
    // maxzoom 18, not the service's nominal 19: plenty of regions have no z19
    // imagery and Esri serves "Map Data Not Yet Available" placeholder tiles
    // there instead of 404s — capping at 18 makes maplibre overzoom real z18
    // pixels instead of fetching placeholders.
    esri:      { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", tileSize: 256, maxzoom: 18 },
    mapbox:    { url: "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token={API_KEY}", tileSize: 256, maxzoom: 22 },
    bing:      { url: "https://t0.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=854&mkt=en-US&token=Atq2nTytWfkqXjxxCDSsSPeT3PXjAl_ODeu3bnJRN44i3HKXs2DDCmQPA5u0M9z1", tileSize: 256, maxzoom: 19 },
}

// -------------------------
// Helpers
// -------------------------

// geomatico's zoomFromResolution (log2(earthCircumference / (256 * resolutionM)))
// is uncapped — a real sub-meter/cm-resolution COG (a drone DSM/ortho export is
// the common case for a *local* file) can estimate a "native" zoom well past
// MapLibre's hard z25 tile-coordinate limit. Requesting DEM tiles that deep for
// `map.setTerrain()`'s elevation sampling throws "z=27 outside of bounds...",
// which was also cascading into "Attempting to run(), but is already running"
// errors (an uncaught exception mid-render left maplibre's render loop in a
// broken state for the next frame). Clamp to 22 — the ceiling this app already
// treats as its practical max elsewhere (see e.g. client-export.ts's cog
// maxzoom fallback) and comfortably clear of the z25 hard limit.
const MAX_SAFE_COG_ZOOM = 22

function zoomRangeFromMetadata(metadata: CogMetadata | null): { minzoom: number; maxzoom: number } {
    if (!metadata?.images?.length) return { minzoom: 0, maxzoom: 20 }
    const zooms = metadata.images.filter(img => !img.isMask).map(img => img.zoom)
    // Both bounds are clamped into the SAME [0, MAX_SAFE_COG_ZOOM] range (not just
    // maxzoom from above) — a single-resolution-level COG (common for a local,
    // un-tiled export) has minzoom === maxzoom === that one estimate, so clamping
    // only maxzoom downward while leaving an over-22 minzoom unclamped produced
    // an inverted minzoom > maxzoom range, which maplibre's setMinZoom/setMaxZoom
    // then rejected outright ("minZoom must be between -2 and the current maxZoom").
    //
    // maxzoom specifically floors rather than rounds: zoomFromResolution gives a
    // fractional estimate (e.g. z13.7), and rounding that UP to 14 tells maplibre
    // "this source has clean z14 detail" when the real native resolution is closer
    // to z13 — the protocol then has to upsample past what the data actually
    // supports at every z14 request, which shows up as visible tile-grid/pixel-
    // border artifacts (confirmed against a real custom COG source) rather than
    // the harmless uniform blur of overzooming past a correctly-conservative
    // maxzoom. minzoom isn't as sensitive (it only governs how far out the same
    // pyramid is queried) but floors too for consistency.
    const clamp = (z: number) => Math.max(0, Math.min(MAX_SAFE_COG_ZOOM, Math.floor(z)))
    return {
        minzoom: clamp(Math.min(...zooms)),
        maxzoom: clamp(Math.max(...zooms)),
    }
}

export function builtinTileUrl(key: TerrainSource, mapboxKey: string, maptilerKey: string): string {
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
    source, mapboxKey, maptilerKey, customTerrainSources, titilerEndpoint, onZoomRangeChange,
}: {
    source: TerrainSource | string
    mapboxKey: string
    maptilerKey: string
    customTerrainSources: any[]
    titilerEndpoint: string
    onZoomRangeChange?: (range: { minzoom: number; maxzoom: number; isCustom?: boolean }) => void
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

    const metadata = useCogMetadata(isCogProtocol ? resolvedCogUrl : null)
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

    if (!sourceConfig) return null

    return (
        <>
            {/* resolvedCogUrl in the key: re-picking a different file for the same
                "cog-local" source (id unchanged) must remount the Source rather than
                have maplibre patch tiles in place against a stale pyramid/cache keyed
                by the old blob: URL — same reasoning as LrmSource/CurvatureSource
                keying on radius/mode below. */}
            <Source id="terrainSource"  key={`terrain-${source}-${highResTerrain}-${resolvedCogUrl}`}  {...sourceConfig} />
            <Source id="hillshadeSource" key={`hillshade-${source}-${highResTerrain}-${resolvedCogUrl}`} {...sourceConfig} />
        </>
    )
})
TerrainSources.displayName = "TerrainSources"

// -------------------------
// RasterBasemapSource
// -------------------------

export const RasterBasemapSource = memo(({
    // basemapSource, mapboxKey, customBasemapSources, titilerEndpoint,
    basemapSource, mapboxKey, customBasemapSources, titilerEndpoint, onZoomRangeChange,
}: {
    basemapSource: string
    mapboxKey: string
    customBasemapSources: any[]
    titilerEndpoint: string
    onZoomRangeChange?: (range: { minzoom: number; maxzoom: number; isCustom?: boolean }) => void
}) => {
    const [useCogProtocol] = useAtom(useCogProtocolVsTitilerAtom)

    const customBasemap = customBasemapSources.find((s) => s.id === basemapSource)

    const sourceProps = useMemo(() => {
        if (customBasemap) {
            return buildRasterTileSource({
                url: customBasemap.url,
                type: customBasemap.type,
                useCogProtocol,
                titilerEndpoint,
                scheme: customBasemap.scheme,
            })
        }

        const basemap = rasterBasemaps[basemapSource] ?? rasterBasemaps.google
        const tileUrl = basemapSource === "mapbox"
            ? basemap.url.replace("{API_KEY}", mapboxKey)
            : basemap.url
        return { tiles: [tileUrl], tileSize: basemap.tileSize, maxzoom: basemap.maxzoom }
    }, [customBasemap, basemapSource, useCogProtocol, titilerEndpoint, mapboxKey])

    const zoomRange = useMemo(() => {
        if (customBasemap) return { minzoom: customBasemap.minzoom ?? 0, maxzoom: customBasemap.maxzoom ?? 22, isCustom: true }
        const basemap = rasterBasemaps[basemapSource] ?? rasterBasemaps.google
        return { minzoom: 0, maxzoom: basemap.maxzoom, isCustom: false }
    }, [customBasemap, basemapSource])

    useEffect(() => {
        onZoomRangeChange?.(zoomRange)
    }, [zoomRange, onZoomRangeChange])

    return (
        <Source
            id="raster-basemap-source"
            key={`raster-${basemapSource}`}
            type="raster"
            tileSize={256}
            maxzoom={19}
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

    return (
        <>
            {overlayIds.map((id) => {
                const source = customBasemapSources.find((s) => s.id === id)
                if (!source) return null
                const sourceProps = buildRasterTileSource({
                    url: source.url,
                    type: source.type,
                    useCogProtocol,
                    titilerEndpoint,
                    scheme: source.scheme,
                })
                return (
                    <Source
                        key={`overlay-${id}`}
                        id={`overlay-basemap-source-${id}`}
                        type="raster"
                        tileSize={256}
                        maxzoom={19}
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
interface ClientDemUpstream {
    template: string
    encoding: "terrarium" | "mapbox"
    tileSize: number
    // Left undefined where the source has no fixed native pyramid to clamp
    // against (e.g. WMS, which serves whatever resolution is requested).
    minzoom?: number
    maxzoom?: number
}

const useClientDemUpstream = (
    terrainSource: TerrainSource | string,
    customTerrainSources: CustomTerrainSource[],
    mapboxKey: string,
    maptilerKey: string,
    titilerEndpoint: string,
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
    const cogMetadata = useCogMetadata(cogUrlForMetadata)
    const cogZoomRange = useMemo(() => zoomRangeFromMetadata(cogMetadata), [cogMetadata])

    return useMemo<ClientDemUpstream | null>(() => {
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
            // ceiling to clamp against here.
            return {
                template: `float32dem-bbox://${encodeURIComponent(customSource.url.replace(/^https?:\/\//, ""))}/{z}/{x}/{y}`,
                encoding: "terrarium" as const,
                tileSize: 512,
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
}

const NormalDerivedSource = memo(({ enabled, sourceId, terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint, buildUrl, keySuffix = "" }: NormalDerivedSourceProps) => {
    const clientUpstream = useClientDemUpstream(terrainSource, customTerrainSources, mapboxKey, maptilerKey, titilerEndpoint)
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
            encoding="mapbox"
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

export const BlobnessSource = memo((props: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl">) => (
    <NormalDerivedSource {...props} sourceId="blobnessSource" buildUrl={buildBlobnessProtocolUrl} />
))
BlobnessSource.displayName = "BlobnessSource"

// radius (the "Search Radius" control) is a literal same-zoom pixel count baked
// into the tile URL (unlike LrmSource's radius, which maps to a pyramid level) —
// same keySuffix reasoning as LrmSource/CurvatureSource above.
export const SvfSource = memo(({ radius, ...props }: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl" | "keySuffix"> & { radius: number }) => (
    <NormalDerivedSource
        {...props}
        sourceId="svfSource"
        keySuffix={`-${radius}`}
        buildUrl={(template, encoding, tileSize) => buildSvfProtocolUrl(template, encoding, tileSize, radius)}
    />
))
SvfSource.displayName = "SvfSource"

export const OpennessSource = memo(({ radius, mode, ...props }: Omit<NormalDerivedSourceProps, "sourceId" | "buildUrl" | "keySuffix"> & { radius: number; mode: OpennessMode }) => (
    <NormalDerivedSource
        {...props}
        sourceId="opennessSource"
        keySuffix={`-${radius}-${mode}`}
        buildUrl={(template, encoding, tileSize) => buildOpennessProtocolUrl(template, encoding, tileSize, radius, mode)}
    />
))
OpennessSource.displayName = "OpennessSource"

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