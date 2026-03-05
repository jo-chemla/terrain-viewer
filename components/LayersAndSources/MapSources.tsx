import { memo, useMemo, useState, useEffect } from "react"
import { Source } from "react-map-gl/maplibre"
import { useAtom } from "jotai"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource, TerrainSourceConfig } from "@/lib/terrain-types"
import { useCogProtocolVsTitilerAtom, highResTerrainAtom } from "@/lib/settings-atoms"
import type { RasterDEMSourceSpecification } from 'maplibre-gl'
import { setColorFunction, getCogMetadata, type CogMetadata } from '@geomatico/maplibre-cog-protocol'

// -------------------------
// Color functions, inspired by https://github.com/geomatico/maplibre-cog-protocol/blob/main/src/render/renderTerrain.ts
// -------------------------
const elevationToTerrainrgb = (elevation: number) => {
    const base = -10000
    const interval = 0.1
    const v = (elevation - base) / interval
    return [
        Math.floor(v / 256 / 256) % 256,
        Math.floor(v / 256) % 256,
        Math.floor(v) % 256,
        255
    ]
}

const elevationToTerrarium = (elevation: number) => {
    const v = elevation + 32768
    return [
        Math.floor(v / 256),
        Math.floor(v % 256),
        Math.floor((v - Math.floor(v)) * 256),
        255
    ]
}

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

function cogTileUrl(url: string, useCogProtocol: boolean, titilerEndpoint: string, type: 'cog' | 'vrt'): string {
    if (type === 'cog') {
        return useCogProtocol
            ? `cog://${url}#dem`
            : `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=0&resampling=bilinear&algorithm=terrainrgb&url=${encodeURIComponent(url)}`
    }
    // vrt
    if (useCogProtocol) {
        console.warn('Warning, VRT can only work with TiTiler COG streaming')
        return url
    }
    return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=-999&resampling=bilinear&algorithm=terrainrgb&url=vrt:///vsicurl/${encodeURIComponent(url)}`
}

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

    const metadata = useCogMetadata(isCogProtocol ? customSource.url : null)
    const { minzoom, maxzoom } = useMemo(() => zoomRangeFromMetadata(metadata), [metadata])

    useEffect(() => {
        onZoomRangeChange?.({ minzoom, maxzoom })
    }, [minzoom, maxzoom, onZoomRangeChange])

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

    const sourceConfig: RasterDEMSourceSpecification = useMemo(() => {
        if (customSource) {
            const tileUrl = cogTileUrl(customSource.url, useCogProtocol, titilerEndpoint, customSource.type)
            const encoding = isCogProtocol
                ? highResTerrain ? 'terrarium' : 'mapbox'
                : customSource.type === 'terrarium' ? 'terrarium'
                : 'mapbox'  // terrainrgb

            return {
                type: "raster-dem",
                tileSize: 256,
                minzoom,
                maxzoom,
                encoding,
                ...(isCogProtocol ? { url: tileUrl } : { tiles: [tileUrl] }),
            }
        }

        // Builtin source
        const base = (terrainSources as any)[source as TerrainSource]
        if (!base) return null
        return {
            ...base.sourceConfig,
            tiles: [builtinTileUrl(source as TerrainSource, mapboxKey, maptilerKey)],
        }
    }, [customSource, source, useCogProtocol, titilerEndpoint, highResTerrain, minzoom, maxzoom, isCogProtocol, mapboxKey, maptilerKey])

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
            const isCog = customBasemap.type === "cog"
            const tileUrl = isCog
                ? useCogProtocol
                    ? `cog://${customBasemap.url}`
                    : `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(customBasemap.url)}`
                : customBasemap.url
            return isCog && useCogProtocol ? { url: tileUrl } : { tiles: [tileUrl] }
        }

        const basemap = rasterBasemaps[basemapSource] ?? rasterBasemaps.google
        const tileUrl = basemapSource === "mapbox"
            ? basemap.url.replace("{API_KEY}", mapboxKey)
            : basemap.url
        return { tiles: [tileUrl], tileSize: basemap.tileSize, maxzoom: basemap.maxzoom }
    }, [customBasemap, basemapSource, useCogProtocol, titilerEndpoint, mapboxKey])

    const zoomRange = useMemo(() => {
        if (customBasemap) return { minzoom: 0, maxzoom: 22, isCustom: true }
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