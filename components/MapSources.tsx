import { memo } from "react"
import { Source } from "react-map-gl/maplibre"
import { useAtom } from "jotai"
import { terrainSources } from "@/lib/terrain-sources"
import type { TerrainSource, TerrainSourceConfig } from "@/lib/terrain-types"
import { useCogProtocolVsTitilerAtom } from "@/lib/settings-atoms"
import type { RasterDEMSourceSpecification } from 'maplibre-gl';

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

        const getTilesUrl = (key: TerrainSource | string) => {
            const customTerrainSource = customTerrainSources.find((s) => s.id === key)
            if (customTerrainSource) {
                if (customTerrainSource.type === "cog") {
                    if (useCogProtocolVsTitiler) {
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
            cog: 'mapbox',
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
        const terrainRasterUrls: Record<string, string> = {
            osm: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            googlesat: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            google: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
            esri: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            mapbox: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token=${mapboxKey || "pk.eyJ1IjoiaWNvbmVtIiwiYSI6ImNpbXJycDBqODAwNG12cW0ydGF1NXZxa2sifQ.hgPcQvgkzpfYkHgfMRqcpw"}`,
            bing: `https://t0.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=854&mkt=en-US&token=Atq2nTytWfkqXjxxCDSsSPeT3PXjAl_ODeu3bnJRN44i3HKXs2DDCmQPA5u0M9z1`,
        }

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
                    tileSize={512}
                    {...sourceProps}
                />
            )
        }

        return (
            <Source
                id="raster-basemap-source"
                key={`raster-${basemapSource}`}
                type="raster"
                tiles={[terrainRasterUrls[basemapSource] || terrainRasterUrls.google]}
                tileSize={512}
            />
        )
    },
)
RasterBasemapSource.displayName = "RasterBasemapSource"
