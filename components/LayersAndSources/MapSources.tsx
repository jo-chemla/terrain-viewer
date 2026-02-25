import { memo } from "react"
import { Source } from "react-map-gl/maplibre"
import { useAtom } from "jotai"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource, TerrainSourceConfig } from "@/lib/terrain-types"
import { useCogProtocolVsTitilerAtom, highResTerrainAtom } from "@/lib/settings-atoms"
import type { RasterDEMSourceSpecification } from 'maplibre-gl';
import {setColorFunction} from '@geomatico/maplibre-cog-protocol'

// Terrarium color function - declared once outside component
const terrariumColorFunction = (pixel: any, color: any) => {
    const height = pixel[0];
    const v = height + 32768;
    const r = Math.floor(v / 256);
    const g = Math.floor(v % 256);
    const b = Math.floor((v - Math.floor(v)) * 256);
    color.set([r, g, b, 255]);
};

// Sources Component - loads once per source change
export const TerrainSources = memo(
    ({
        source,
        mapboxKey,
        maptilerKey,
        customTerrainSources,
        titilerEndpoint,
    }: {
        source: TerrainSource | string,
        mapboxKey: string,
        maptilerKey: string,
        customTerrainSources: any[],
        titilerEndpoint: string
    }) => {
        const [useCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)
        const [highResTerrain] = useAtom(highResTerrainAtom)

        const getTilesUrl = (key: TerrainSource | string) => {
            const customTerrainSource = customTerrainSources.find((s) => s.id === key)
            if (customTerrainSource) {
                if (customTerrainSource.type === "cog") {
                    if (useCogProtocolVsTitiler) {
                        // Register color function only if high-res mode is enabled
                        if (highResTerrain) {
                            setColorFunction(customTerrainSource.url, terrariumColorFunction);
                        }
                        return `cog://${customTerrainSource.url}#dem`
                        
                    } else {
                        return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=0&resampling=bilinear&algorithm=terrainrgb&url=${encodeURIComponent(customTerrainSource.url)}`
                    }
                }
                else if (customTerrainSource.type === "vrt") {
                    if (useCogProtocolVsTitiler) {
                        console.warn('Warning, VRT can only work with TiTiler COG streaming')
                        return customTerrainSource.url
                    } else {
                        return `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?&nodata=-999&resampling=bilinear&algorithm=terrainrgb&url=vrt:///vsicurl/${encodeURIComponent(customTerrainSource.url)}`
                    }
                }
                return customTerrainSource.url
            }

            const sourceConfig: TerrainSourceConfig = (terrainSources as any)[key as TerrainSource]
            if (!sourceConfig) return ""
            let tileUrl = sourceConfig.sourceConfig.tiles[0] || ""
            if (key === "mapbox") {
                tileUrl = tileUrl.replace("{API_KEY}", mapboxKey || "")
            } else if (key === "maptiler") {
                tileUrl = tileUrl.replace("{API_KEY}", maptilerKey || "")
            }
            return tileUrl
        }
        
        const encodingsMap: any = {
            terrainrgb: 'mapbox',
            // Use terrarium encoding for COG only when high-res mode is enabled
            cog: highResTerrain ? 'terrarium' : 'mapbox',
            terrarium: 'terrarium',
        }
        
        const customTerrainSource = customTerrainSources.find((s) => s.id === source)
        if (customTerrainSource) {
            const tileUrl = getTilesUrl(source)
            const sourceConfig: RasterDEMSourceSpecification = {
                type: "raster-dem" as const,
                tileSize: 512,
                maxzoom: 20,
                encoding: encodingsMap[customTerrainSource.type],
            }
            if ((customTerrainSource.type == 'cog') && useCogProtocolVsTitiler) {
                sourceConfig.url = tileUrl
            } else {
                sourceConfig.tiles = [tileUrl]
            }


            return (
                <>
                    <Source id="terrainSource" key={`terrain-${source}`} {...sourceConfig} />
                    <Source id="hillshadeSource" key={`hillshade-${source}`} {...sourceConfig} />
                </>
            )
        }

        const baseSource = (terrainSources as any)[source as TerrainSource];
        if (!baseSource) return null;

        const sourceConfig = { ...baseSource.sourceConfig }
        sourceConfig.tiles = [getTilesUrl(source)]

        return (
            <>
                <Source id="terrainSource" key={`terrain-${source}`} {...sourceConfig} />
                <Source id="hillshadeSource" key={`hillshade-${source}`} {...sourceConfig} />
            </>
        )
    },
)
TerrainSources.displayName = "TerrainSources"

// Raster basemap definitions with tile URL, tileSize, and maxzoom
const rasterBasemaps: Record<string, { url: string; tileSize: number; maxzoom: number }> = {
    osm: {
        url: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        tileSize: 256,
        maxzoom: 19,
    },
    googlesat: {
        url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        tileSize: 256,
        maxzoom: 20,
    },
    google: {
        url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        tileSize: 256,
        maxzoom: 20,
    },
    esri: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        tileSize: 256,
        maxzoom: 19,
    },
    mapbox: {
        url: "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token={API_KEY}",
        tileSize: 256,
        maxzoom: 22,
    },
    bing: {
        url: "https://t0.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=854&mkt=en-US&token=Atq2nTytWfkqXjxxCDSsSPeT3PXjAl_ODeu3bnJRN44i3HKXs2DDCmQPA5u0M9z1",
        tileSize: 256,
        maxzoom: 19,
    },
}

// Raster Source
export const RasterBasemapSource = memo(
    ({
        basemapSource,
        mapboxKey,
        customBasemapSources,
        titilerEndpoint,
    }: {
        basemapSource: string
        mapboxKey: string
        customBasemapSources: any[],
        titilerEndpoint: string,
    }) => {
        const [useCogProtocolVsTitiler] = useAtom(useCogProtocolVsTitilerAtom)

        // Check if it's a custom basemap
        const customBasemap = customBasemapSources.find((s) => s.id === basemapSource)
        if (customBasemap) {
            let tileUrl = customBasemap.url
            if (customBasemap.type === "cog") {
                if (useCogProtocolVsTitiler) {
                    tileUrl = `cog://${(customBasemap.url)}`
                } else {
                    tileUrl = `${titilerEndpoint}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(customBasemap.url)}`
                }
            }
            const sourceProps = (customBasemap.type === "cog" && useCogProtocolVsTitiler)
                ? { url: tileUrl }
                : { tiles: [tileUrl] }

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
        }

        const basemap = rasterBasemaps[basemapSource] ?? rasterBasemaps.google
        const tileUrl = basemapSource === "mapbox"
            ? basemap.url.replace("{API_KEY}", mapboxKey || "pk.eyJ1IjoiaWNvbmVtIiwiYSI6ImNpbXJycDBqODAwNG12cW0ydGF1NXZxa2sifQ.hgPcQvgkzpfYkHgfMRqcpw")
            : basemap.url

        return (
            <Source
                id="raster-basemap-source"
                key={`raster-${basemapSource}`}
                type="raster"
                tiles={[tileUrl]}
                tileSize={basemap.tileSize}
                maxzoom={basemap.maxzoom}
            />
        )
    },
)
RasterBasemapSource.displayName = "RasterBasemapSource"