import { useEffect, useRef, useState, type RefObject } from 'react'
import { atom, useAtom } from 'jotai'
import type { MapRef } from 'react-map-gl/maplibre'
import {
    TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode,
    TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode, TerraDrawSelectMode
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { Download, Upload, Trash2, MousePointer, MapPin, Minus, Pentagon, Square, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import bbox from '@turf/bbox'
import { v4 as uuidv4 } from 'uuid'
import { Section, CheckboxWithSlider } from './controls-components'
import { truncate as turf_truncate } from '@turf/truncate'
import { CameraButtons } from "./CameraUtilities"
import * as toGeoJSON from '@tmcw/togeojson'
// import { load } from '@loaders.gl/core'
// import { GeoPackageLoader } from '@loaders.gl/geopackage'
// import sqlInit from 'sql.js/dist/sql-wasm-browser.js'
// const initSqlJs = sqlInit.default ?? sqlInit
// import { Geometry } from 'wkx'
// const wkbToGeoJSON = (buf: Uint8Array) =>
//     Geometry.parse(Buffer.from(buf)).toGeoJSON() as any
import { Geometry } from 'wkx'
import { Buffer } from 'buffer'
import proj4 from 'proj4'

const wkbToGeoJSON = (buf: Uint8Array) =>
    Geometry.parse(Buffer.from(buf)).toGeoJSON() as any

function loadSqlJs(): Promise<any> {
    return new Promise((resolve, reject) => {
        if ((window as any).initSqlJs) return resolve((window as any).initSqlJs)
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.min.js'
        script.onload = () => resolve((window as any).initSqlJs)
        script.onerror = () => reject(new Error('Failed to load sql.js'))
        document.head.appendChild(script)
    })
}


// --- TYPES & ATOM ---

export interface GeoJSONFeature {
    type: 'Feature'
    geometry: any
    properties: any
    id?: string
}

export const drawingFeaturesAtom = atom<GeoJSONFeature[]>([])

// --- HELPERS ---

function to2DCoords(coords: any): any {
    if (typeof coords[0] === 'number') return coords.slice(0, 2)
    return coords.map(to2DCoords)
}

function geometryTypeToMode(geometryType: string): string | null {
    switch (geometryType) {
        case 'Point': return 'point'
        case 'LineString': return 'linestring'
        case 'Polygon':
        case 'MultiPolygon': return 'polygon'
        default:
            console.warn('Unsupported geometry type:', geometryType)
            return null
    }
}

function parseFeatures(rawFeatures: any[]): GeoJSONFeature[] {
    const flattened = flattenFeatures(rawFeatures)  // <-- add this
    const output = flattened
        .filter((f) => f?.geometry)
        .flatMap((f) => {
            const mode = geometryTypeToMode(f.geometry.type)
            if (!mode) { console.log(mode, 'Unsupported geometry type:', f.geometry.type); return [] }
            return [{
                type: 'Feature',
                id: uuidv4(),
                geometry: { ...f.geometry, coordinates: to2DCoords(f.geometry.coordinates) },
                properties: { ...(f.properties || {}), mode },
            }]
        })

    console.log('parseFeatures', rawFeatures, rawFeatures
        .filter((f) => f?.geometry), output)

    return output
}

// --- LAYER VISIBILITY HELPERS ---

function getTerraDrawLayers(map: maplibregl.Map): string[] {
    return (map.getStyle()?.layers ?? [])
        .map((l) => l.id)
        .filter((id) => id.startsWith('td-'))
}

function setTerraDrawVisibility(map: maplibregl.Map, visible: boolean) {
    getTerraDrawLayers(map).forEach((id) => {
        try {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
        } catch { }
    })
}

function setTerraDrawOpacity(map: maplibregl.Map, opacity: number) {
    getTerraDrawLayers(map).forEach((id) => {
        try {
            const layer = map.getLayer(id)
            if (!layer) return
            const type = layer.type
            // Each layer type uses a different paint property for opacity
            if (type === 'fill') map.setPaintProperty(id, 'fill-opacity', opacity)
            else if (type === 'line') map.setPaintProperty(id, 'line-opacity', opacity)
            else if (type === 'circle') {
                map.setPaintProperty(id, 'circle-opacity', opacity)
                map.setPaintProperty(id, 'circle-stroke-opacity', opacity)
            } else if (type === 'symbol') map.setPaintProperty(id, 'icon-opacity', opacity)
        } catch { }
    })
}
async function getProj4String(srsId: number): Promise<string | null> {
    if (srsId === 4326) return null // already WGS84
    try {
        const res = await fetch(`https://epsg.io/${srsId}.proj4`)
        if (!res.ok) throw new Error(`No proj4 string for EPSG:${srsId}`)
        return await res.text()
    } catch (err) {
        console.error('[gpkg] failed to fetch proj4 string:', err)
        return null
    }
}

function reprojectCoords(coords: any, fromProj: string): any {
    if (typeof coords[0] === 'number') {
        const [x, y] = proj4(fromProj, 'WGS84', [coords[0], coords[1]])
        return [x, y]
    }
    return coords.map((c: any) => reprojectCoords(c, fromProj))
}

function reprojectGeometry(geometry: any, fromProj: string): any {
    return { ...geometry, coordinates: reprojectCoords(geometry.coordinates, fromProj) }
}

// --- HOOK ---

export function useTerraDraw(mapRef: RefObject<MapRef>, mapsLoaded: boolean) {
    const [draw, setDraw] = useState<TerraDraw | null>(null)
    const [features, setFeatures] = useAtom(drawingFeaturesAtom)
    const featuresRef = useRef(features)
    const drawRef = useRef<TerraDraw | null>(null)

    useEffect(() => { featuresRef.current = features }, [features])

    useEffect(() => {
        const map = mapRef.current?.getMap()
        if (!map || !mapsLoaded) return

        const createDraw = () => {
            if (drawRef.current) {
                try { drawRef.current.stop() } catch (e) { console.error('Error stopping draw:', e) }
                drawRef.current = null
                setDraw(null)
            }

            setTimeout(() => {
                try {
                    const adapter = new TerraDrawMapLibreGLAdapter({ map, renderBelowLayerId: undefined })
                    const newDraw = new TerraDraw({
                        adapter,
                        modes: [
                            new TerraDrawSelectMode({
                                flags: {
                                    point: { feature: { draggable: true, coordinates: { draggable: true } } },
                                    linestring: { feature: { draggable: true, coordinates: { draggable: true, deletable: true, addable: true } } },
                                    polygon: { feature: { draggable: true, coordinates: { draggable: true, deletable: true, addable: true } } },
                                    rectangle: { feature: { draggable: true, coordinates: { draggable: true } } },
                                    circle: { feature: { draggable: true, coordinates: { draggable: true } } },
                                    arbitrary: { feature: {} },
                                },
                            }),
                            new TerraDrawPointMode(),
                            new TerraDrawLineStringMode(),
                            new TerraDrawPolygonMode(),
                            new TerraDrawRectangleMode(),
                            new TerraDrawCircleMode(),
                        ],
                    })

                    // newDraw.on('change', () => setFeatures(newDraw.getSnapshot() || []))
                    newDraw.start()
                    newDraw.setMode('select')

                    if (featuresRef.current.length > 0) {
                        setTimeout(() => {
                            try { newDraw.addFeatures(featuresRef.current) } catch (e) {
                                console.error('Error restoring features:', e)
                            }
                        }, 100)
                    }

                    drawRef.current = newDraw
                    setDraw(newDraw)
                } catch (err) {
                    console.error('Error creating TerraDraw instance:', err)
                }
            }, 500)
        }

        // Keep td-* layers on top after style changes
        const handleStyleData = () => {
            if (!map || !drawRef.current) return
            try {
                const layers = map.getStyle()?.layers ?? []
                const tdLayers = layers.filter((l) => l.id.startsWith('td-'))
                if (tdLayers.length === 0) return
                if (!layers[layers.length - 1].id.startsWith('td-')) {
                    tdLayers.forEach((l) => { try { map.moveLayer(l.id) } catch { } })
                }
            } catch { }
        }

        map.on('style.load', createDraw)
        map.on('styledata', handleStyleData)
        map.on('sourcedata', handleStyleData)
        map.on('render', handleStyleData)
        map.on('data', (e) => { if (e.type === 'style' || e.type === 'source') handleStyleData() })

        if (map.isStyleLoaded()) createDraw()

        return () => {
            map.off('style.load', createDraw)
            map.off('styledata', handleStyleData)
            map.off('sourcedata', handleStyleData)
            map.off('render', handleStyleData)
            if (drawRef.current) {
                try { drawRef.current.stop() } catch { }
                drawRef.current = null
            }
        }
    }, [mapRef, setFeatures, mapsLoaded])

    return { draw, features, setFeatures }
}

// --- CONTROLS COMPONENT ---

export function TerraDrawControls({ draw }: { draw: TerraDraw | null }) {
    const [activeMode, setActiveMode] = useState<string>('select')

    useEffect(() => {
        if (!draw) return
        const update = () => { try { const m = draw.getMode(); if (m) setActiveMode(m) } catch { } }
        draw.on('change', update)
        return () => { try { draw.off('change', update) } catch { } }
    }, [draw])

    if (!draw) return <div className="text-sm text-muted-foreground py-2">Initializing drawing tools...</div>

    const modes = [
        { id: 'select', label: 'Select', icon: MousePointer },
        { id: 'point', label: 'Point', icon: MapPin },
        { id: 'linestring', label: 'Line', icon: Minus },
        { id: 'polygon', label: 'Polygon', icon: Pentagon },
        { id: 'rectangle', label: 'Rectangle', icon: Square },
        { id: 'circle', label: 'Circle', icon: Circle },
    ]

    return (
        <div className="space-y-2">
            <Label className="text-sm font-medium">Drawing Mode</Label>
            <div className="grid grid-cols-3 gap-2">
                {modes.map(({ id, label, icon: Icon }) => (
                    <Button
                        key={id}
                        variant={activeMode === id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => { draw.setMode(id); setActiveMode(id) }}
                        className="cursor-pointer"
                    >
                        <Icon className="h-4 w-4 mr-1" />
                        {label}
                    </Button>
                ))}
            </div>
        </div>
    )
}

// --- ACTIONS COMPONENT ---
function flattenGeometry(geometry: any): any[] {
    if (!geometry) return []
    switch (geometry.type) {
        case 'Point':
        case 'LineString':
        case 'Polygon':
            return [geometry]
        case 'MultiPoint':
            return geometry.coordinates.map((c: any) => ({ type: 'Point', coordinates: c }))
        case 'MultiLineString':
            return geometry.coordinates.map((c: any) => ({ type: 'LineString', coordinates: c }))
        case 'MultiPolygon':
            return geometry.coordinates.map((c: any) => ({ type: 'Polygon', coordinates: c }))
        case 'GeometryCollection':
            return geometry.geometries.flatMap(flattenGeometry)
        default:
            console.warn('Skipping unsupported geometry type:', geometry.type)
            return []
    }
}

function flattenFeatures(features: any[]): any[] {
    return features.flatMap((f) => {
        if (!f?.geometry) return []
        return flattenGeometry(f.geometry).map((geom) => ({
            ...f,
            geometry: geom,
            properties: f.properties ?? {},
        }))
    })
}

export function TerraDrawActions({ draw, mapRef }: { draw: TerraDraw | null; mapRef: RefObject<MapRef> }) {
    const [features, setFeatures] = useAtom(drawingFeaturesAtom)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [visible, setVisible] = useState(true)
    const [opacity, setOpacity] = useState(1)

    const getMap = () => mapRef.current?.getMap()

    const handleVisibilityChange = (checked: boolean) => {
        setVisible(checked)
        const map = getMap()
        if (map) setTerraDrawVisibility(map, checked)
    }

    const handleOpacityChange = (value: number) => {
        const newOpacity = value
        setOpacity(newOpacity)
        const map = getMap()
        if (map) setTerraDrawOpacity(map, newOpacity)
    }

    const exportGeoJSON = () => {
        const geojson = { type: 'FeatureCollection', features }
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `drawings-${Date.now()}.geojson`
        a.click()
        URL.revokeObjectURL(url)
    }

    const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return
        const ext = file.name.split('.').pop()?.toLowerCase()

        const reader = new FileReader()
        const handleGeojson = (geojson: any) => {
            const truncated = turf_truncate(geojson, { precision: 6, coordinates: 2 })
            const raw = truncated.type === 'FeatureCollection' ? truncated.features : [truncated]
            const newFeatures = parseFeatures(raw)
            if (newFeatures.length === 0) return

            if (draw) {
                try {
                    draw.clear()
                    draw.addFeatures(newFeatures)
                    setFeatures(newFeatures)
                } catch (err) {
                    console.error('Error adding features:', err)
                    setFeatures(newFeatures)
                }
            } else {
                setFeatures(newFeatures)
            }

            // Reset visibility & opacity on import
            setVisible(true)
            setOpacity(1)

            const map = getMap()
            if (map) {
                setTerraDrawVisibility(map, true)
                setTerraDrawOpacity(map, 1)
                try {
                    const bounds = bbox(geojson)
                    if (bounds.length === 4 && !bounds.some(isNaN)) {
                        map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 40, duration: 800 })
                    }
                } catch (err) { console.error('Zoom error:', err) }
            }
        }

        // @loaders.gl has deep ESM/CJS issues that make it fundamentally broken in Vite's dev server regardless of config. Cut your losses and drop it — use sql.js directly instead, which is what GeoPackageLoader uses under the hood anyway.
        // if (ext === 'gpkg') {
        //     const { load } = await import('@loaders.gl/core')
        //     const { GeoPackageLoader } = await import('@loaders.gl/geopackage')

        //     load(file, GeoPackageLoader, { gis: { format: 'geojson' } })
        //         .then((tables: Record<string, any[]>) => {
        //             const features = Object.values(tables).flat()
        //             handleGeojson({ type: 'FeatureCollection', features })
        //         })
        //         .catch((err) => console.error('GeoPackage import error:', err))
        // --
        // OR 
        // --
        // const { load } = await import('@loaders.gl/core')
        // const { GeoPackageLoader } = await import('@loaders.gl/geopackage')

        // const tables = await load(file, GeoPackageLoader, { gis: { format: 'geojson' } })
        // const features = Object.values(tables).flat()
        // handleGeojson({ type: 'FeatureCollection', features })

        if (ext === 'gpkg') {

            const initSqlJs = await loadSqlJs()
            const arrayBuffer = await file.arrayBuffer()
            console.log('[gpkg] file size:', arrayBuffer.byteLength)

            function getGpkgHeaderSize(geomBytes: Uint8Array): number {
                // Byte 3 is flags: bits 1-3 encode envelope type
                const flags = geomBytes[3]
                const envelopeType = (flags >> 1) & 0x07
                // Envelope sizes in bytes: 0=none, 1=bbox(32), 2=bbox+Z(48), 3=bbox+M(48), 4=bbox+ZM(64)
                const envelopeBytes = [0, 32, 48, 48, 64][envelopeType] ?? 0
                return 8 + envelopeBytes
            }

            const SQL = await initSqlJs({
                locateFile: (f: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`
            })
            const db = new SQL.Database(new Uint8Array(arrayBuffer))

            // Log all tables in the DB for debugging
            const allTables = db.exec(`SELECT name FROM sqlite_master WHERE type='table'`)
            console.log('[gpkg] all tables:', allTables[0]?.values.map((r: any) => r[0]))

            const tables = db.exec(`SELECT table_name, data_type FROM gpkg_contents`)
            console.log('[gpkg] gpkg_contents:', tables[0]?.values)

            const featureTables = db.exec(`SELECT table_name FROM gpkg_contents WHERE data_type='features'`)
            const tableNames: string[] = featureTables[0]?.values.map((r: any) => r[0]) ?? []
            console.log('[gpkg] feature tables:', tableNames)

            const allFeatures: any[] = []
            for (const table of tableNames) {
                // Get the SRS for this table
                const srsQuery = db.exec(
                    `SELECT gc.srs_id FROM gpkg_geometry_columns gc WHERE gc.table_name='${table}'`
                )
                const srsId: number = srsQuery[0]?.values[0]?.[0] as number ?? 4326
                console.log('[gpkg] SRS for', table, ':', srsId)

                const proj4String = await getProj4String(srsId)
                if (srsId !== 4326 && !proj4String) {
                    console.warn('[gpkg] cannot reproject table', table, '— skipping')
                    continue
                }


                const rows = db.exec(`SELECT * FROM "${table}" LIMIT 3`)
                if (!rows[0]) { console.warn('[gpkg] no rows in table:', table); continue }

                const cols = rows[0].columns
                console.log('[gpkg] columns in', table, ':', cols)

                // Log the actual gpkg_geometry_columns to find the real geom column name
                const geomColQuery = db.exec(
                    `SELECT column_name FROM gpkg_geometry_columns WHERE table_name='${table}'`
                )
                const geomColName: string = geomColQuery[0]?.values[0]?.[0] as string
                    ?? cols.find((c: string) => !['id', 'fid'].includes(c.toLowerCase()) && !c.toLowerCase().includes('_id'))
                    ?? cols[1]
                console.log('[gpkg] geometry column for', table, ':', geomColName)

                // Now fetch all rows
                const allRows = db.exec(`SELECT * FROM "${table}"`)
                if (!allRows[0]) continue

                for (const row of allRows[0].values) {
                    const props: Record<string, any> = {}
                    allRows[0].columns.forEach((c: string, i: number) => { if (c !== geomColName) props[c] = row[i] })
                    const geomBytes: Uint8Array = row[allRows[0].columns.indexOf(geomColName)] as Uint8Array
                    const headerSize = getGpkgHeaderSize(geomBytes)
                    if (!geomBytes) { console.warn('[gpkg] null geom in row, props:', props); continue }

                    try {
                        // GeoPackage WKB header: 2 magic bytes + 1 version + 1 flags + 4 srs_id = 8 bytes minimum
                        // But if envelope is present, header is longer — read flags to get actual offset
                        const flags = geomBytes[3]
                        const envelopeType = (flags >> 1) & 0x07
                        const envelopeSizes = [0, 32, 48, 48, 64] // bytes for envelope types 0-4
                        const headerSize = 8 + (envelopeSizes[envelopeType] ?? 0)
                        console.log('[gpkg] geomBytes length:', geomBytes.length, 'flags:', flags, 'envelopeType:', envelopeType, 'headerSize:', headerSize)

                        const wkb = geomBytes.slice(headerSize)
                        const geojsonGeom = wkbToGeoJSON(wkb)
                        console.log('[gpkg] parsed geom type:', geojsonGeom?.type)
                        allFeatures.push({ type: 'Feature', geometry: geojsonGeom, properties: props })
                    } catch (err) {
                        console.error('[gpkg] wkb parse error:', err, 'bytes (hex):', Array.from(geomBytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '))
                    }

                    try {
                        const wkb = geomBytes.slice(headerSize)
                        let geojsonGeom = wkbToGeoJSON(wkb)

                        // Reproject if needed
                        if (proj4String) {
                            geojsonGeom = reprojectGeometry(geojsonGeom, proj4String)
                        }

                        allFeatures.push({ type: 'Feature', geometry: geojsonGeom, properties: props })
                    } catch (err) {
                        console.error('[gpkg] error:', err)
                    }
                }
            }

            console.log('[gpkg] total features parsed:', allFeatures.length)
            db.close()
            handleGeojson({ type: 'FeatureCollection', features: allFeatures })
        } else if (ext === 'kml') {
            reader.onload = (e) => {
                try {
                    const xml = new DOMParser().parseFromString(e.target?.result as string, 'text/xml')
                    const geojson = toGeoJSON.kml(xml)
                    handleGeojson(geojson)
                } catch (err) { console.error('KML import error:', err) }
            }
            reader.readAsText(file)
        } else {
            // Default: GeoJSON / JSON
            reader.onload = (e) => {
                try {
                    const geojson = JSON.parse(e.target?.result as string)
                    handleGeojson(geojson)
                } catch (err) { console.error('Import error:', err) }
            }
            reader.readAsText(file)
        }

        // reader.readAsText(file)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const clearDrawings = () => {
        if (confirm('Clear all drawings?')) {
            draw?.clear()
            setFeatures([])
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Drawing Tools</Label> 
                <Label className="text-sm font-medium">Features: {features.length}</Label>
            </div>

            {/* Visibility & Opacity */}
            <div className="space-y-2">
                <CheckboxWithSlider id="td-visible" checked={visible} onCheckedChange={(checked) => handleVisibilityChange(checked === true)} label="Show drawings" sliderValue={opacity} onSliderChange={handleOpacityChange}  />
            </div>
            
            <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="cursor-pointer" title="Import GeoJSON, KML, or GeoPackage">
                    <Upload className="h-4 w-4 mr-1" /> Import
                </Button>
                <Button variant="outline" size="sm" onClick={exportGeoJSON} disabled={features.length === 0} className="cursor-pointer">
                    <Download className="h-4 w-4 mr-1" /> Export
                </Button>
                <Button variant="outline" size="sm" onClick={clearDrawings} disabled={features.length === 0} className="cursor-pointer">
                    <Trash2 className="h-4 w-4 mr-1" /> Clear
                </Button>
            </div>
            <input ref={fileInputRef} type="file" accept=".geojson,.json,.kml,.gpkg" onChange={importFile} className="hidden" />
            {/* <input ref={fileInputRef} type="file" accept=".geojson,.json" onChange={importGeoJSON} className="hidden" /> */}
        </div>
    )
}

// --- SECTION COMPONENT ---

interface TerraDrawSectionProps {
    draw: TerraDraw | null
    mapRef: RefObject<MapRef>
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    state: Record<string, unknown>
    setState: (state: Record<string, unknown>) => void
    setIsSidebarOpen: (open: boolean) => void
}

export function TerraDrawSection({ draw, mapRef, isOpen, onOpenChange, state, setState, setIsSidebarOpen }: TerraDrawSectionProps) {
    return (
        <Section title="Tools / WIP" isOpen={isOpen} onOpenChange={onOpenChange}>
            <TerraDrawActions draw={draw} mapRef={mapRef} />
            <TerraDrawControls draw={draw} />
            <Label className="text-sm font-medium mt-4">Animation Tools</Label>
            <CameraButtons
                mapRef={mapRef}
                // appState={state}
                // onAppStateChange={setState}
                state={state}
                setState={setState}
                setIsSidebarOpen={setIsSidebarOpen}         
            />
        </Section>
    )
}