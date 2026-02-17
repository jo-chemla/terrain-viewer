import { useEffect, useRef, useState, type RefObject, memo } from 'react'
import { atom, useAtom } from 'jotai'
import type { MapRef } from 'react-map-gl/maplibre'
import { TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode, TerraDrawSelectMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { Download, Upload, Trash2, MousePointer, MapPin, Minus, Pentagon, Square, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import bbox from '@turf/bbox'
import { v4 as uuidv4 } from 'uuid';
import { Section, SliderControl } from "./controls-components"

// --- ATOM ---
export interface GeoJSONFeature {
    type: 'Feature'
    geometry: any
    properties: any
    id?: string
}

export const drawingFeaturesAtom = atom<GeoJSONFeature[]>([])

// --- HOOK ---
export function useTerraDraw(mapRef: RefObject<MapRef>, mapsLoaded: boolean) {
    const [draw, setDraw] = useState<TerraDraw | null>(null)
    const [features, setFeatures] = useAtom(drawingFeaturesAtom)

    console.log('--- useTerraDraw: current features count ---', features.length)
    const featuresRef = useRef(features)
    const drawRef = useRef<TerraDraw | null>(null)

    useEffect(() => {
        featuresRef.current = features
    }, [features])

    useEffect(() => {
        const map = mapRef.current?.getMap()
        if (!map || !mapsLoaded) return

        const createDraw = () => {
            console.log('--- TerraDraw: createDraw triggered ---')
            if (drawRef.current) {
                console.log('--- TerraDraw: Stopping previous instance ---')
                try { drawRef.current.stop() } catch (e) { console.error('Error stopping draw:', e) }
                drawRef.current = null
                setDraw(null)
            }

            setTimeout(() => {
                try {
                    console.log('--- TerraDraw: Initializing new instance ---')
                    const adapter = new TerraDrawMapLibreGLAdapter({
                        map,
                        renderBelowLayerId: undefined
                    })

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
                                    arbitrary: { feature: {} }
                                }
                            }),
                            new TerraDrawPointMode(),
                            new TerraDrawLineStringMode(),
                            new TerraDrawPolygonMode(),
                            new TerraDrawRectangleMode(),
                            new TerraDrawCircleMode(),
                        ],
                    })

                    newDraw.on('change', (ids, type) => {
                        const snapshot = newDraw.getSnapshot()
                        console.log(`--- TerraDraw: change event [${type}] ---`, {
                            featureCount: snapshot?.length || 0,
                            ids
                        })
                        setFeatures(snapshot || [])
                    })

                    if (!newDraw.enabled) {
                        newDraw.start()
                        console.log('--- TerraDraw: Started ---')
                    }

                    const currentFeatures = featuresRef.current
                    if (currentFeatures && currentFeatures.length > 0) {
                        console.log('--- TerraDraw: Restoring features ---', currentFeatures.length)
                        setTimeout(() => {
                            try {
                                newDraw.addFeatures(currentFeatures)
                            } catch (e) {
                                console.error('--- TerraDraw: Error adding features during init ---', e)
                            }
                        }, 100)
                    }

                    newDraw.setMode('select')
                    drawRef.current = newDraw
                    setDraw(newDraw)
                } catch (err) {
                    console.error('--- TerraDraw: Error creating instance ---', err)
                }
            }, 500)
        }

        const handleStyleData = () => {
            if (!map || !drawRef.current) return

            try {
                const style = map.getStyle()
                if (!style || !style.layers) return

                const layers = style.layers
                const tdLayers = layers.filter(l => l.id.startsWith('td-'))
                if (tdLayers.length === 0) return

                const lastLayer = layers[layers.length - 1]
                if (!lastLayer.id.startsWith('td-')) {
                    tdLayers.forEach(l => {
                        try {
                            map.moveLayer(l.id)
                        } catch (e) { }
                    })
                }
            } catch (e) { }
        }

        map.on('style.load', createDraw)
        map.on('styledata', handleStyleData)
        map.on('sourcedata', handleStyleData)
        map.on('render', handleStyleData)
        map.on('data', (e) => {
            if (e.type === 'style' || e.type === 'source') {
                handleStyleData()
            }
        })

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
        const update = () => {
            try {
                const mode = draw.getMode()
                console.log('--- TerraDrawControls: mode changed ---', mode)
                if (mode && ['select', 'point', 'linestring', 'polygon', 'rectangle', 'circle'].includes(mode)) {
                    setActiveMode(mode)
                }
            } catch { }
        }
        draw.on('change', update)
        return () => {
            try { draw.off('change', update) } catch { }
        }
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
                {modes.map((mode) => {
                    const Icon = mode.icon
                    const active = activeMode === mode.id
                    return (
                        <Button
                            key={mode.id}
                            variant={active ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                                draw.setMode(mode.id)
                                setActiveMode(mode.id)
                            }}
                            className="cursor-pointer"
                        >
                            <Icon className="h-4 w-4 mr-1" />
                            {mode.label}
                        </Button>
                    )
                })}
            </div>
        </div>
    )
}

// --- ACTIONS COMPONENT ---
export function TerraDrawActions({ draw, mapRef }: { draw: TerraDraw | null, mapRef: RefObject<MapRef> }) {
    const [features, setFeatures] = useAtom(drawingFeaturesAtom)
    const fileInputRef = useRef<HTMLInputElement>(null)

    console.log('--- TerraDrawActions: current features count ---', features.length)

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

    const importGeoJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
        console.log('--- TerraDraw: importGeoJSON triggered ---')
        const file = event.target.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = (e) => {
            try {
                const geojson = JSON.parse(e.target?.result as string)
                console.log('--- TerraDraw: Parsed GeoJSON ---', geojson.type)

                const rawFeatures = geojson.type === 'FeatureCollection' ? geojson.features : [geojson]
                console.log('--- TerraDraw: rawFeatures count ---', rawFeatures.length)

                const newFeatures = rawFeatures
                    .filter((f: any) => f && f.geometry)
                    .map((f: any) => {
                        const geometryType = f.geometry.type
                        let mode = 'select'

                        if (geometryType === 'Point') mode = 'point'
                        else if (geometryType === 'LineString') mode = 'linestring'
                        else if (geometryType === 'Polygon') mode = 'polygon'

                        const feature = {
                            type: 'Feature',
                            id: String(f.id || Math.random().toString(36).substring(2, 11)),
                            geometry: f.geometry,
                            properties: {
                                ...f.properties,
                                mode
                            }
                        }
                        console.log(`Mapping feature: geom=${geometryType} -> mode=${mode}`)
                        return feature
                    })

                console.log('--- TerraDraw: mapped newFeatures count ---', newFeatures.length)
                if (newFeatures.length > 0) {
                    console.log('--- TerraDraw: first feature sample ---', JSON.stringify(newFeatures[0]).substring(0, 200))
                }

                if (draw) {
                    try {
                        console.log('--- TerraDraw: Calling addFeatures ---', newFeatures)

                        const updatedFeatures = newFeatures.map((feature: any) => {
                            let mode = "static";

                            switch (feature.geometry.type) {
                                case "Point":
                                    mode = "point";
                                    break;
                                case "Polygon":
                                case "MultiPolygon":
                                    mode = "polygon";
                                    break;
                                default:
                                    console.warn("Unsupported geometry type:", feature.geometry.type);
                            }

                            return {
                                ...feature,
                                id: uuidv4(),
                                properties: {
                                    ...(feature.properties || {}),
                                    mode,
                                },
                            };
                        });

                        draw.clear()
                        draw.addFeatures(updatedFeatures)

                        const snapshot = draw.getSnapshot()
                        console.log('--- TerraDraw: Snapshot after addFeatures ---', snapshot?.length || 0)
                        setFeatures(snapshot || [])
                    } catch (err) {
                        console.error('--- TerraDraw: Error in addFeatures ---', err)
                        setFeatures(prev => [...prev, ...newFeatures])
                    }
                } else {
                    console.log('--- TerraDraw: No draw instance, updating atom only ---')
                    setFeatures(prev => [...prev, ...newFeatures])
                }

                const map = mapRef.current?.getMap()
                if (map && newFeatures.length > 0) {
                    try {
                        const bounds = bbox(geojson)
                        if (bounds && bounds.length === 4 && !bounds.some(isNaN)) {
                            map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 40, duration: 800 })
                        }
                    } catch (err) { console.error('--- TerraDraw: Zoom error ---', err) }
                }
            } catch (error) {
                console.error('--- TerraDraw: Import error ---', error)
            }
        }
        reader.readAsText(file)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const clearDrawings = () => {
        if (confirm('Clear all drawings?')) {
            if (draw) draw.clear()
            setFeatures([])
        }
    }

    return (
        <div className="space-y-2">
            <Label className="text-sm font-medium">Features: {features.length}</Label>
            <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-1" /> Import
                </Button>
                <Button variant="outline" size="sm" onClick={exportGeoJSON} disabled={features.length === 0} className="cursor-pointer">
                    <Download className="h-4 w-4 mr-1" /> Export
                </Button>
                <Button variant="outline" size="sm" onClick={clearDrawings} disabled={features.length === 0} className="cursor-pointer">
                    <Trash2 className="h-4 w-4 mr-1" /> Clear
                </Button>
            </div>
            <input ref={fileInputRef} type="file" accept=".geojson,.json" onChange={importGeoJSON} className="hidden" />
        </div>
    )
}

// --- SECTION COMPONENT ---
// Matches the BackgroundOptionsSection pattern:
//   - owns its <Section> wrapper
//   - accepts isOpen + onOpenChange from the parent
//   - receives draw + mapRef as props (no closed-over variables)
interface TerraDrawSectionProps {
    draw: TerraDraw | null
    mapRef: RefObject<MapRef>
    isOpen: boolean
    onOpenChange: (open: boolean) => void
}

export function TerraDrawSection({ draw, mapRef, isOpen, onOpenChange }: TerraDrawSectionProps) {
    return (
        <Section title="Drawing Tools" isOpen={isOpen} onOpenChange={onOpenChange}>
            <TerraDrawActions draw={draw} mapRef={mapRef} />
            <TerraDrawControls draw={draw} />
        </Section>
    )
}