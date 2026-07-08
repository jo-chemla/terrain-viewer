import { memo, useMemo, useState, useEffect } from "react"
import { Source } from "react-map-gl/maplibre"
import { useAtom } from "jotai"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource, TerrainSourceConfig } from "@/lib/terrain-types"
import { useCogProtocolVsTitilerAtom, highResTerrainAtom, type CustomTerrainSource } from "@/lib/settings-atoms"
import type { RasterDEMSourceSpecification } from 'maplibre-gl'
import { setColorFunction, getCogMetadata, type CogMetadata } from '@geomatico/maplibre-cog-protocol'
import { elevationToTerrainrgb, elevationToTerrarium } from "@/lib/elevation-encoding"
import { buildRasterTileSource } from "@/lib/source-builder"
import { buildSlopeProtocolUrl } from "@/lib/slope-protocol"

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
        if (!cogUrl) return
        getCogMetadata(cogUrl).then(setMetadata).catch(() => setMetadata(null))
    }, [cogUrl])
    return metadata
}

export interface TilejsonMetadata {
    encoding?: "terrarium" | "mapbox"
    bounds?: [number, number, number, number]
    minzoom?: number
    maxzoom?: number
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
    esri:      { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", tileSize: 256, maxzoom: 19 },
    mapbox:    { url: "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token={API_KEY}", tileSize: 256, maxzoom: 22 },
    bing:      { url: "https://t0.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=854&mkt=en-US&token=Atq2nTytWfkqXjxxCDSsSPeT3PXjAl_ODeu3bnJRN44i3HKXs2DDCmQPA5u0M9z1", tileSize: 256, maxzoom: 19 },
}

// -------------------------
// Helpers
// -------------------------

function zoomRangeFromMetadata(metadata: CogMetadata | null): { minzoom: number; maxzoom: number } {
    if (!metadata?.images?.length) return { minzoom: 0, maxzoom: 20 }
    const zooms = metadata.images.filter(img => !img.isMask).map(img => img.zoom)
    return { minzoom: Math.round(Math.min(...zooms)), maxzoom: Math.round(Math.max(...zooms)) }
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

    const customSource = customTerrainSources.find((s) => s.id === source)
    const isCogProtocol = customSource?.type === 'cog' && useCogProtocol
    const isTilejson = customSource?.type === 'tilejson'

    const metadata = useCogMetadata(isCogProtocol ? customSource.url : null)
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
        if (!isCogProtocol) return
        const scale = metadata?.scale ?? 1
        const offset = metadata?.offset ?? 0
        const noData = metadata?.noData
        setColorFunction(
            customSource.url,
            highResTerrain
                ? makeTerrariumColorFunction(scale, offset, noData)
                : makeTerrainrgbColorFunction(scale, offset, noData)
        )
    }, [isCogProtocol, customSource?.url, highResTerrain, metadata?.scale, metadata?.offset])

    const sourceConfig: RasterDEMSourceSpecification | null | undefined = useMemo(() => {
        if (customSource) {
            // For COG protocol, wait for metadata before rendering; same for tilejson,
            // whose "encoding" field (when present) is fetched instead of asked upfront.
            if (isCogProtocol && !metadata) return null
            if (isTilejson && !tilejsonMetadata) return null

            const built = buildRasterTileSource({
                url: customSource.url,
                type: customSource.type,
                useCogProtocol,
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
    }, [customSource, source, useCogProtocol, titilerEndpoint, highResTerrain, minzoom, maxzoom, isCogProtocol, isTilejson, tilejsonMetadata, mapboxKey, maptilerKey, metadata])

    if (!sourceConfig) return null

    return (
        <>
            <Source id="terrainSource"  key={`terrain-${source}-${highResTerrain}`}  {...sourceConfig} />
            <Source id="hillshadeSource" key={`hillshade-${source}-${highResTerrain}`} {...sourceConfig} />
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

export const SlopeSource = memo(({
    enabled, sourceMode, terrainSource, customTerrainSources, mapboxKey, maptilerKey,
}: {
    enabled: boolean
    sourceMode: SlopeSourceMode
    terrainSource: TerrainSource | string
    customTerrainSources: CustomTerrainSource[]
    mapboxKey: string
    maptilerKey: string
}) => {
    // The client protocol only supports plain XYZ raster-dem tile templates it can
    // `fetch()` directly (builtin sources, or custom terrarium/terrainrgb TMS sources) —
    // COG/VRT/WMS-raw/tilejson sources go through maplibre-internal protocols/manifests
    // it can't easily re-invoke standalone, so those fall back to the PlanTopo default.
    const clientUpstream = useMemo(() => {
        if (sourceMode !== "client") return null
        const customSource = customTerrainSources.find((s) => s.id === terrainSource)
        if (customSource) {
            if (customSource.type !== "terrarium" && customSource.type !== "terrainrgb") return null
            return {
                template: customSource.url,
                encoding: customSource.type === "terrarium" ? "terrarium" as const : "mapbox" as const,
                tileSize: 256,
            }
        }
        const builtin = (terrainSources as any)[terrainSource as TerrainSource]
        if (!builtin || builtin.encoding === "3dtiles") return null
        return {
            template: builtinTileUrl(terrainSource as TerrainSource, mapboxKey, maptilerKey),
            encoding: builtin.sourceConfig.encoding === "terrarium" ? "terrarium" as const : "mapbox" as const,
            tileSize: builtin.sourceConfig.tileSize,
        }
    }, [sourceMode, terrainSource, customTerrainSources, mapboxKey, maptilerKey])

    if (!enabled) return null

    if (clientUpstream) {
        const url = buildSlopeProtocolUrl(clientUpstream.template, clientUpstream.encoding, clientUpstream.tileSize)
        return (
            <Source
                id="slopeSource"
                key={`slope-client-${terrainSource}`}
                type="raster-dem"
                tiles={[url]}
                tileSize={clientUpstream.tileSize}
                encoding="mapbox"
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