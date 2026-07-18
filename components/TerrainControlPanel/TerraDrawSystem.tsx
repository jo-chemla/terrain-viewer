import { useEffect, useRef, useState, type RefObject } from 'react'
import { atom, useAtom } from 'jotai'
import type { MapRef } from 'react-map-gl/maplibre'
import {
    TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode,
    TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode, TerraDrawSelectMode
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { Download, Upload, Trash2, MousePointer, MapPin, Minus, Pentagon, Square, Circle, Plus, Edit, Layers as LayersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HexAlphaColorPicker, HexColorInput } from 'react-colorful'
import bbox from '@turf/bbox'
import { v4 as uuidv4 } from 'uuid'
import { Section, CheckboxWithSlider, GroupHeading } from './controls-components'
import { truncate as turf_truncate } from '@turf/truncate'
import { downloadGeoJSON } from "@/lib/download-geojson"

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


// import { load } from '@loaders.gl/core';
// import { GeoPackageLoader } from '@loaders.gl/geopackage';
// import { transformGeoJsonCoords } from '@loaders.gl/gis';


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

// --- LAYERS ---

export interface DrawLayer {
    id: string
    name: string
    /** 8-digit hex (#rrggbbaa) — alpha lives in the color itself (picked via
     *  HexAlphaColorPicker) rather than a separate opacity slider. */
    strokeColor: string
    fillColor: string
    /** Outline/stroke width in px, 0.5–5, shared across every mode's outline-ish property. */
    strokeWidth: number
}

// Cycled through when a new layer is added, so successive layers are visually
// distinct from each other by default without the user having to pick a color.
const LAYER_COLOR_PALETTE = ['#3b82f6ff', '#ef4444ff', '#22c55eff', '#f59e0bff', '#a855f7ff', '#06b6d4ff']

// Terra Draw's color styling props want a plain 6-digit hex plus a separate
// 0-1 opacity number (see HexColorStyling in common.d.ts) — they don't accept
// an 8-digit hex with alpha baked in. So the 8-digit hex is only the UI's
// storage format; this splits it back into what terra-draw actually wants.
function splitHexAlpha(hex: string): { color: string; opacity: number } {
    const color = hex.length >= 7 ? hex.slice(0, 7) : hex
    const alphaHex = hex.length >= 9 ? hex.slice(7, 9) : 'ff'
    const parsed = parseInt(alphaHex, 16)
    return { color, opacity: Number.isFinite(parsed) ? parsed / 255 : 1 }
}

// Darkens the RGB part of an (possibly 8-digit, alpha-carrying) hex color by
// `amount` (0-1), keeping the alpha channel untouched.
function darkenHex(hex: string, amount: number): string {
    const { color, opacity } = splitHexAlpha(hex)
    const factor = 1 - amount
    const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n)) * factor).toString(16).padStart(2, '0')
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    const alphaHex = Math.round(opacity * 255).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}${alphaHex}`
}

function makeLayer(index: number, name: string): DrawLayer {
    const fillColor = LAYER_COLOR_PALETTE[index % LAYER_COLOR_PALETTE.length]
    return { id: uuidv4(), name, fillColor, strokeColor: darkenHex(fillColor, 0.2), strokeWidth: 2 }
}

const DEFAULT_LAYER = makeLayer(0, 'Layer 1')

export const drawingLayersAtom = atom<DrawLayer[]>([DEFAULT_LAYER])
export const activeLayerIdAtom = atom<string>(DEFAULT_LAYER.id)

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

function parseFeatures(rawFeatures: any[], defaultLayerId: string): GeoJSONFeature[] {
    const flattened = flattenFeatures(rawFeatures)  // <-- add this
    const output = flattened
        .filter((f) => f?.geometry)
        .flatMap((f) => {
            const mode = geometryTypeToMode(f.geometry.type)
            if (!mode) { console.log(mode, 'Unsupported geometry type:', f.geometry.type); return [] }
            return [{
                type: 'Feature' as const,
                id: uuidv4(),
                geometry: { ...f.geometry, coordinates: to2DCoords(f.geometry.coordinates) },
                // defaultLayerId goes first so a re-imported export (which already
                // carries its own layerId in properties) keeps its original layer
                // instead of being reassigned to whichever layer is active now.
                properties: { layerId: defaultLayerId, ...(f.properties || {}), mode },
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

// --- LAYER STYLING HELPERS ---

// Terra Draw styling props accept a function of the feature being rendered
// (see HexColorStyling in terra-draw's common.d.ts), so per-layer color is
// just a lookup from feature.properties.layerId into the current layers list.
// Features predating this layerId property (or with a stale/unknown id) fall
// back to the first layer rather than a hardcoded default.
function resolveLayer(layers: DrawLayer[], feature: any): DrawLayer {
    return layers.find((l) => l.id === feature?.properties?.layerId) ?? layers[0] ?? DEFAULT_LAYER
}

// Terra Draw's HexColorStyling type demands a `#${string}` template literal
// return type, which is more rigor than a user-editable color value can
// statically guarantee — these are typed `any` so the styles objects below
// satisfy each mode's styling interface without a wall of casts.
//
// fillColor is the "marker fill" — a point/marker's own dot, a polygon's
// interior, a drawn circle's interior, AND a linestring's only color (a line
// has no separate fill, and is visually closer to a filled stroke than an
// outline). strokeColor is the outline drawn around fill shapes (points,
// polygons, circles) — lines don't have one. strokeWidth is the thickness of
// that outline, and doubles as the linestring's own width.
function buildModeStyles(layersRef: { current: DrawLayer[] }) {
    const fillOf = (feature: any): any => splitHexAlpha(resolveLayer(layersRef.current, feature).fillColor).color
    const fillOpacityOf = (feature: any): any => splitHexAlpha(resolveLayer(layersRef.current, feature).fillColor).opacity
    const strokeOf = (feature: any): any => splitHexAlpha(resolveLayer(layersRef.current, feature).strokeColor).color
    const strokeOpacityOf = (feature: any): any => splitHexAlpha(resolveLayer(layersRef.current, feature).strokeColor).opacity
    const strokeWidthOf = (feature: any): any => resolveLayer(layersRef.current, feature).strokeWidth

    return {
        point: {
            pointColor: fillOf, pointOpacity: fillOpacityOf,
            pointOutlineColor: strokeOf, pointOutlineOpacity: strokeOpacityOf, pointOutlineWidth: strokeWidthOf,
        },
        linestring: { lineStringColor: fillOf, lineStringOpacity: fillOpacityOf, lineStringWidth: strokeWidthOf },
        polygon: {
            fillColor: fillOf, fillOpacity: fillOpacityOf,
            outlineColor: strokeOf, outlineOpacity: strokeOpacityOf, outlineWidth: strokeWidthOf,
        },
        rectangle: {
            fillColor: fillOf, fillOpacity: fillOpacityOf,
            outlineColor: strokeOf, outlineOpacity: strokeOpacityOf, outlineWidth: strokeWidthOf,
        },
        circle: {
            fillColor: fillOf, fillOpacity: fillOpacityOf,
            outlineColor: strokeOf, outlineOpacity: strokeOpacityOf, outlineWidth: strokeWidthOf,
        },
        select: {
            selectedPointColor: fillOf, selectedPointOpacity: fillOpacityOf,
            selectedPointOutlineColor: strokeOf, selectedPointOutlineOpacity: strokeOpacityOf, selectedPointOutlineWidth: strokeWidthOf,
            selectedLineStringColor: fillOf, selectedLineStringOpacity: fillOpacityOf, selectedLineStringWidth: strokeWidthOf,
            selectedPolygonColor: fillOf, selectedPolygonFillOpacity: fillOpacityOf,
            selectedPolygonOutlineColor: strokeOf, selectedPolygonOutlineOpacity: strokeOpacityOf, selectedPolygonOutlineWidth: strokeWidthOf,
        },
    }
}

// --- HOOK ---

// export function useTerraDraw(mapRef: RefObject<MapRef>, mapsLoaded: boolean) {
//     const [draw, setDraw] = useState<TerraDraw | null>(null)
//     const [features, setFeatures] = useAtom(drawingFeaturesAtom)
//     const featuresRef = useRef(features)
//     const drawRef = useRef<TerraDraw | null>(null)

//     useEffect(() => { featuresRef.current = features }, [features])

//     useEffect(() => {
//         const map = mapRef.current?.getMap()
//         if (!map || !mapsLoaded) return

//         const createDraw = () => {
//             if (drawRef.current) {
//                 try { drawRef.current.stop() } catch (e) { console.error('Error stopping draw:', e) }
//                 drawRef.current = null
//                 setDraw(null)
//             }

//             setTimeout(() => {
//                 try {
//                     const adapter = new TerraDrawMapLibreGLAdapter({ map, renderBelowLayerId: undefined })
//                     const newDraw = new TerraDraw({
//                         adapter,
//                         modes: [
//                             new TerraDrawSelectMode({
//                                 flags: {
//                                     point: { feature: { draggable: true, coordinates: { draggable: true } } },
//                                     linestring: { feature: { draggable: true, coordinates: { draggable: true, deletable: true, addable: true } } },
//                                     polygon: { feature: { draggable: true, coordinates: { draggable: true, deletable: true, addable: true } } },
//                                     rectangle: { feature: { draggable: true, coordinates: { draggable: true } } },
//                                     circle: { feature: { draggable: true, coordinates: { draggable: true } } },
//                                     arbitrary: { feature: {} },
//                                 },
//                             }),
//                             new TerraDrawPointMode(),
//                             new TerraDrawLineStringMode(),
//                             new TerraDrawPolygonMode(),
//                             new TerraDrawRectangleMode(),
//                             new TerraDrawCircleMode(),
//                         ],
//                     })

//                     // newDraw.on('change', () => setFeatures(newDraw.getSnapshot() || []))
//                     newDraw.start()
//                     newDraw.setMode('select')

//                     if (featuresRef.current.length > 0) {
//                         setTimeout(() => {
//                             try { newDraw.addFeatures(featuresRef.current) } catch (e) {
//                                 console.error('Error restoring features:', e)
//                             }
//                         }, 100)
//                     }

//                     drawRef.current = newDraw
//                     setDraw(newDraw)
//                 } catch (err) {
//                     console.error('Error creating TerraDraw instance:', err)
//                 }
//             }, 500)
//         }

//         // Keep td-* layers on top after style changes
//         const handleStyleData = () => {
//             if (!map || !drawRef.current) return
//             try {
//                 const layers = map.getStyle()?.layers ?? []
//                 const tdLayers = layers.filter((l) => l.id.startsWith('td-'))
//                 if (tdLayers.length === 0) return
//                 if (!layers[layers.length - 1].id.startsWith('td-')) {
//                     tdLayers.forEach((l) => { try { map.moveLayer(l.id) } catch { } })
//                 }
//             } catch { }
//         }

//         // map.on('style.load', createDraw)
//         map.on('styledata', handleStyleData)
//         map.on('sourcedata', handleStyleData)
//         map.on('render', handleStyleData)
        
//         // map.on('data', (e) => { if (e.type === 'style' || e.type === 'source') handleStyleData() })

//         // // if (map.isStyleLoaded()) createDraw()
//         // map.once('style.load', () => {
//         //     requestAnimationFrame(() => createDraw());
//         // });

//         // KEY FIX: handle both cases
//         if (map.isStyleLoaded()) {
//             requestAnimationFrame(() => createDraw())
//         } else {
//             map.once('style.load', () => requestAnimationFrame(() => createDraw()))
//         }


//         return () => {
//             // map.off('style.load', createDraw)
//             map.off('styledata', handleStyleData)
//             map.off('sourcedata', handleStyleData)
//             map.off('render', handleStyleData)
//             if (drawRef.current) {
//                 try { drawRef.current.stop() } catch { }
//                 drawRef.current = null
//             }
//         }
//     }, [mapRef, setFeatures, mapsLoaded])

//     return { draw, features, setFeatures }
// }
export function useTerraDraw(mapRef: RefObject<MapRef>) {
    const [draw, setDraw] = useState<TerraDraw | null>(null)
    const [features, setFeatures] = useAtom(drawingFeaturesAtom)
    const [layers] = useAtom(drawingLayersAtom)
    const [activeLayerId] = useAtom(activeLayerIdAtom)
    const featuresRef = useRef(features)
    const layersRef = useRef(layers)
    const activeLayerIdRef = useRef(activeLayerId)
    const drawRef = useRef<TerraDraw | null>(null)

    useEffect(() => { featuresRef.current = features }, [features])
    useEffect(() => { layersRef.current = layers }, [layers])
    useEffect(() => { activeLayerIdRef.current = activeLayerId }, [activeLayerId])

    // Layer color edits shouldn't tear down and recreate the whole draw instance
    // (createDraw below is expensive and would drop the active drawing mode) —
    // just push the freshly-colored style functions into each mode in place.
    // The functions themselves already read layersRef.current lazily, so this
    // exists only to trigger terra-draw's re-render, not to change what they read.
    useEffect(() => {
        if (!draw) return
        try {
            const styles = buildModeStyles(layersRef)
            draw.updateModeOptions<typeof TerraDrawPointMode>('point', { styles: styles.point })
            draw.updateModeOptions<typeof TerraDrawLineStringMode>('linestring', { styles: styles.linestring })
            draw.updateModeOptions<typeof TerraDrawPolygonMode>('polygon', { styles: styles.polygon })
            draw.updateModeOptions<typeof TerraDrawRectangleMode>('rectangle', { styles: styles.rectangle })
            draw.updateModeOptions<typeof TerraDrawCircleMode>('circle', { styles: styles.circle })
            draw.updateModeOptions<typeof TerraDrawSelectMode>('select', { styles: styles.select })
        } catch (e) { console.error('Error restyling drawing layers:', e) }
    }, [draw, layers])

    useEffect(() => {
        // Guards the 'change' listener below against firing after this effect generation
        // has been torn down (e.g. this effect re-running because mapRef changed,
        // recreating a new TerraDraw instance while the old one's `stop()` hasn't
        // actually detached its own 'change' listener yet). Without this, a stale listener
        // from a superseded instance can call setFeatures(oldSnapshot) after a newer
        // instance already accumulated more features (e.g. from an import), making the
        // "Features: N" counter silently drop back down even though nothing was deleted.
        let isCurrent = true
        // Tracks which map the styledata/sourcedata/render listeners below are
        // currently attached to, so tryInit() can attach them exactly once.
        let mapWithListeners: maplibregl.Map | null = null

        const handleStyleData = () => {
            const map = mapRef.current?.getMap()
            if (!map || !drawRef.current) return
            try {
                const styleLayers = map.getStyle()?.layers ?? []
                const tdLayers = styleLayers.filter((l) => l.id.startsWith('td-'))
                if (tdLayers.length === 0) return
                if (!styleLayers[styleLayers.length - 1].id.startsWith('td-')) {
                    tdLayers.forEach((l) => { try { map.moveLayer(l.id) } catch { } })
                }
            } catch { }
        }

        const createDraw = (map: maplibregl.Map) => {
            if (drawRef.current) {
                try { drawRef.current.stop() } catch (e) { console.error('Error stopping draw:', e) }
                drawRef.current = null
                setDraw(null)
            }

            try {
                const adapter = new TerraDrawMapLibreGLAdapter({ map, renderBelowLayerId: undefined })
                const modeStyles = buildModeStyles(layersRef)
                const newDraw = new TerraDraw({
                    adapter,
                    modes: [
                        new TerraDrawSelectMode({
                            flags: {
                                point: { feature: { draggable: true, coordinates: { draggable: true } } },
                                // `addable` (clicking a line/edge to insert a new coordinate) isn't a real
                                // ModeFlags.coordinates property in the installed terra-draw version —
                                // it's a no-op here either way, so dropping it changes nothing at runtime.
                                linestring: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
                                polygon: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
                                rectangle: { feature: { draggable: true, coordinates: { draggable: true } } },
                                circle: { feature: { draggable: true, coordinates: { draggable: true } } },
                                arbitrary: { feature: {} },
                            },
                            styles: modeStyles.select,
                        }),
                        new TerraDrawPointMode({ styles: modeStyles.point }),
                        new TerraDrawLineStringMode({ styles: modeStyles.linestring }),
                        new TerraDrawPolygonMode({ styles: modeStyles.polygon }),
                        new TerraDrawRectangleMode({ styles: modeStyles.rectangle }),
                        new TerraDrawCircleMode({ styles: modeStyles.circle }),
                    ],
                })
                newDraw.start()
                newDraw.setMode('select')

                // Freehand drawing (point/line/polygon tools) only ever updated TerraDraw's
                // own internal store — nothing synced it back to drawingFeaturesAtom, so
                // "Features: N" and Export both silently ignored anything drawn on the map
                // (only imported features, which call setFeatures directly, ever showed up).
                newDraw.on('change', () => {
                    if (!isCurrent) return
                    try { setFeatures(newDraw.getSnapshot() as GeoJSONFeature[]) } catch { }

                    // Tag any feature that just entered the store without a layer yet, so it
                    // renders (and counts) as belonging to whichever layer is active. Deferred
                    // one tick so this doesn't run reentrantly inside terra-draw's own
                    // change-dispatch. IMPORTANT: only pass the new `layerId` key here, never
                    // `...f.properties` — every feature's properties already carries `mode`,
                    // which terra-draw treats as a reserved property name, so spreading it
                    // back into updateFeatureProperties() throws "You are trying to update a
                    // reserved property name: mode" on every single call. That was caught
                    // silently by the try/catch below, so the tag never actually stuck and
                    // every drawn feature fell back to layers[0] no matter which layer was
                    // selected as active — this is what was actually causing "always draws
                    // into the first layer".
                    setTimeout(() => {
                        if (!isCurrent) return
                        try {
                            const snapshot = newDraw.getSnapshot() as GeoJSONFeature[]
                            snapshot.forEach((f) => {
                                if (f.id == null || f.properties?.layerId != null) return
                                try {
                                    newDraw.updateFeatureProperties(f.id as any, { layerId: activeLayerIdRef.current })
                                } catch (e) { console.error('[TerraDraw] failed to tag feature with layer:', f.id, e) }
                            })
                        } catch (e) { console.error('[TerraDraw] failed to read snapshot for layer tagging:', e) }
                    }, 0)
                })

                if (featuresRef.current.length > 0) {
                    setTimeout(() => {
                        try { newDraw.addFeatures(featuresRef.current) } catch (e) {
                            console.error('Error restoring features:', e)
                        }
                    }, 100)
                }

                drawRef.current = newDraw
                setDraw(newDraw)
                console.log('[TerraDraw] ✅ draw instance set successfully')
            } catch (err) {
                console.error('[TerraDraw] ❌ Error creating TerraDraw instance:', err)
            }
        }

        const tryInit = () => {
            const map = mapRef.current?.getMap()
            if (!map) return false

            // Attached as soon as the map object exists, independent of the style
            // being loaded yet — handleStyleData no-ops until drawRef.current is
            // set, so this is safe early, and only needs doing once per map.
            if (mapWithListeners !== map) {
                map.on('styledata', handleStyleData)
                map.on('sourcedata', handleStyleData)
                map.on('render', handleStyleData)
                mapWithListeners = map
            }

            if (!map.isStyleLoaded()) return false
            requestAnimationFrame(() => createDraw(map))
            return true
        }

        // Previously gated on the parent's full map "load" event (fires only once
        // every tile for the current viewport has rendered — slow with this app's
        // terrain/DEM/contour sources) before even checking readiness here. All
        // terra-draw's adapter actually needs is the *style* loaded
        // (map.isStyleLoaded()), which is available much earlier — this polls for
        // the map object and its style directly instead of waiting on that slower
        // signal, which was the dominant delay before the drawing tools UI appeared.
        let pollTimer: ReturnType<typeof setInterval> | null = null
        if (!tryInit()) {
            pollTimer = setInterval(() => {
                if (tryInit() && pollTimer) {
                    clearInterval(pollTimer)
                    pollTimer = null
                }
            }, 100)
        }

        return () => {
            isCurrent = false
            if (mapWithListeners) {
                mapWithListeners.off('styledata', handleStyleData)
                mapWithListeners.off('sourcedata', handleStyleData)
                mapWithListeners.off('render', handleStyleData)
            }
            if (pollTimer) clearInterval(pollTimer)
            if (drawRef.current) {
                try { drawRef.current.stop() } catch { }
                drawRef.current = null
            }
        }

    }, [mapRef, setFeatures])

    return { draw, features, setFeatures }
}

// --- CONTROLS COMPONENT ---

export function TerraDrawControls({ draw, mapRef }: { draw: TerraDraw | null; mapRef: RefObject<MapRef> }) {
    const [activeDrawMode, setActiveDrawMode] = useState<string>('select')

    useEffect(() => {
        if (!draw) return
        const update = () => { try { const m = draw.getMode(); if (m) setActiveDrawMode(m) } catch { } }
        draw.on('change', update)
        return () => { try { draw.off('change', update) } catch { } }
    }, [draw])

    // Terra Draw's own modes already default to a crosshair cursor on start(),
    // but maplibre's drag-pan handler keeps re-setting the canvas cursor during
    // interaction and stomps it — same issue and same fix as the Elevation
    // Picker's cursor (see .terradraw-drawing-active in src/index.css).
    useEffect(() => {
        const map = mapRef.current?.getMap()
        if (!map) return
        const container = map.getContainer()
        container.classList.toggle('terradraw-drawing-active', activeDrawMode !== 'select')
        return () => { container.classList.remove('terradraw-drawing-active') }
    }, [activeDrawMode, mapRef])

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
            <GroupHeading>Mode</GroupHeading>
            <div className="grid grid-cols-3 gap-2">
                {modes.map(({ id, label, icon: Icon }) => (
                    <Button
                        key={id}
                        variant={activeDrawMode === id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => { draw.setMode(id); setActiveDrawMode(id) }}
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

// --- LAYERS COMPONENT ---

// A color swatch that opens a popover with an alpha-aware picker. Native
// <input type="color"> can't carry an alpha channel at all (browsers strip
// it), and shadcn/ui doesn't ship a color picker of its own — the common
// pattern is react-colorful's HexAlphaColorPicker inside a Popover, which is
// what this pairs with the project's own Popover primitive.
function ColorAlphaSwatch({
    color, onChange, title, className,
}: { color: string; onChange: (hex: string) => void; title: string; className?: string }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title={title}
                    className={`h-6 w-6 shrink-0 p-0 m-0 border cursor-pointer ${className ?? ''}`}
                    style={{
                        // Two stacked background layers: the layer's own (possibly
                        // semi-transparent) color on top of a checkerboard, so partial
                        // alpha is visible on the swatch itself rather than just
                        // blending invisibly into the sidebar background.
                        backgroundImage: `linear-gradient(${color}, ${color}), repeating-conic-gradient(#80808080 0% 25%, transparent 0% 50%)`,
                        backgroundSize: 'auto, 8px 8px',
                    }}
                />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3 space-y-2">
                <HexAlphaColorPicker color={color} onChange={onChange} />
                <HexColorInput
                    color={color}
                    onChange={onChange}
                    alpha
                    prefixed
                    className="flex h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                />
            </PopoverContent>
        </Popover>
    )
}

export function TerraDrawLayers({ draw, mapRef }: { draw: TerraDraw | null; mapRef: RefObject<MapRef> }) {
    const [layers, setLayers] = useAtom(drawingLayersAtom)
    const [activeLayerId, setActiveLayerId] = useAtom(activeLayerIdAtom)
    const [features, setFeatures] = useAtom(drawingFeaturesAtom)
    // Multi-layer mode gates the whole feature — off behaves like the app did
    // before layers existed (a single implicit layer, no add/delete/style UI).
    // Edit mode gates the per-row styling controls specifically, so day-to-day
    // use (pick a layer to draw into, zoom to one) isn't cluttered by them.
    const [multiLayerMode, setMultiLayerMode] = useState(true)
    const [editMode, setEditMode] = useState(false)

    // Legacy/imported features without a layerId fall back to the first layer,
    // matching resolveLayer's rendering fallback so the count shown here always
    // agrees with which layer a given feature actually renders as.
    const featureCount = (layerId: string) =>
        features.filter((f) => (f.properties?.layerId ?? layers[0]?.id) === layerId).length

    // With multi-layer mode off there's only ever one layer in use — pin the
    // active one to the first so drawing/import always lands there even if a
    // different layer had been selected before switching modes off.
    useEffect(() => {
        if (!multiLayerMode && layers.length > 0 && activeLayerId !== layers[0].id) {
            setActiveLayerId(layers[0].id)
        }
    }, [multiLayerMode, layers, activeLayerId, setActiveLayerId])

    const addLayer = () => {
        const layer = makeLayer(layers.length, `Layer ${layers.length + 1}`)
        setLayers([...layers, layer])
        setActiveLayerId(layer.id)
    }

    const renameLayer = (layerId: string, name: string) => {
        setLayers(layers.map((l) => (l.id === layerId ? { ...l, name } : l)))
    }

    const setLayerColor = (layerId: string, key: 'strokeColor' | 'fillColor', value: string) => {
        setLayers(layers.map((l) => (l.id === layerId ? { ...l, [key]: value } : l)))
    }

    const setLayerStrokeWidth = (layerId: string, strokeWidth: number) => {
        setLayers(layers.map((l) => (l.id === layerId ? { ...l, strokeWidth } : l)))
    }

    const deleteLayer = (layerId: string) => {
        if (layers.length <= 1) return
        const idsToDelete = features.filter((f) => f.properties?.layerId === layerId).map((f) => f.id).filter(Boolean) as string[]
        if (idsToDelete.length > 0) {
            try { draw?.removeFeatures(idsToDelete) } catch (e) { console.error('Error removing layer features:', e) }
            setFeatures((prev) => prev.filter((f) => f.properties?.layerId !== layerId))
        }
        const remaining = layers.filter((l) => l.id !== layerId)
        setLayers(remaining)
        if (activeLayerId === layerId) setActiveLayerId(remaining[0].id)
    }

    const zoomToLayer = (layerId: string) => {
        const layerFeatures = features.filter((f) => (f.properties?.layerId ?? layers[0]?.id) === layerId)
        const map = mapRef.current?.getMap()
        if (layerFeatures.length === 0 || !map) return
        try {
            const bounds = bbox({ type: 'FeatureCollection', features: layerFeatures } as any)
            if (bounds.length === 4 && !bounds.some((n: number) => Number.isNaN(n))) {
                map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 40, duration: 800 })
            }
        } catch (e) { console.error('Error zooming to layer bounds:', e) }
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <GroupHeading>Layers</GroupHeading>
                <div className="flex items-center gap-1">
                    {multiLayerMode && (
                        <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                                <span>
                                    <Toggle
                                        pressed={editMode}
                                        onPressedChange={setEditMode}
                                        size="sm"
                                        aria-label={editMode ? 'Done editing layers' : 'Edit layer names, colors and width'}
                                        className="cursor-pointer"
                                    >
                                        <Edit className="h-4 w-4" />
                                    </Toggle>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent><p>{editMode ? 'Done editing' : 'Edit layer names, colors and width'}</p></TooltipContent>
                        </Tooltip>
                    )}
                    <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                            <span>
                                <Toggle
                                    pressed={multiLayerMode}
                                    onPressedChange={setMultiLayerMode}
                                    size="sm"
                                    aria-label={multiLayerMode ? 'Switch to a single layer' : 'Enable multiple layers'}
                                    className="cursor-pointer"
                                >
                                    <LayersIcon className="h-4 w-4" />
                                </Toggle>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent><p>{multiLayerMode ? 'Multiple layers (click for single layer)' : 'Single layer (click to enable multiple)'}</p></TooltipContent>
                    </Tooltip>
                </div>
            </div>

            {multiLayerMode && (
                <>
                    <RadioGroup value={activeLayerId} onValueChange={setActiveLayerId} className="gap-2">
                        {layers.map((layer) => (
                            <div key={layer.id} className="flex items-center gap-2 min-w-0">
                                <RadioGroupItem value={layer.id} id={`draw-layer-${layer.id}`} className="cursor-pointer shrink-0" />

                                {editMode ? (
                                    <Input
                                        value={layer.name}
                                        onChange={(e) => renameLayer(layer.id, e.target.value)}
                                        className="h-8 flex-1 min-w-0 text-sm"
                                    />
                                ) : (
                                    <Label htmlFor={`draw-layer-${layer.id}`} className="flex-1 text-sm truncate min-w-0 cursor-pointer">
                                        {layer.name} <span className="text-muted-foreground">({featureCount(layer.id)})</span>
                                    </Label>
                                )}

                                {editMode ? (
                                    // Fill first (it's the dominant color — a marker/polygon/circle's
                                    // own fill, and now also a line's color), then stroke; the two
                                    // swatches share a border and sit flush with no gap between them.
                                    <div className="flex shrink-0">
                                        <ColorAlphaSwatch
                                            title="Fill color (marker/polygon/circle fill, line color)"
                                            color={layer.fillColor}
                                            onChange={(hex) => setLayerColor(layer.id, 'fillColor', hex)}
                                            className="rounded-r-none border-r-0"
                                        />
                                        <ColorAlphaSwatch
                                            title="Stroke color (outline)"
                                            color={layer.strokeColor}
                                            onChange={(hex) => setLayerColor(layer.id, 'strokeColor', hex)}
                                            className="rounded-l-none"
                                        />
                                    </div>
                                ) : (
                                    <div
                                        className="h-6 w-6 shrink-0 rounded border"
                                        title={`${layer.name} fill color`}
                                        style={{
                                            backgroundImage: `linear-gradient(${layer.fillColor}, ${layer.fillColor}), repeating-conic-gradient(#80808080 0% 25%, transparent 0% 50%)`,
                                            backgroundSize: 'auto, 6px 6px',
                                        }}
                                    />
                                )}

                                {editMode && (
                                    <Slider
                                        value={[layer.strokeWidth]}
                                        onValueChange={([v]) => setLayerStrokeWidth(layer.id, v)}
                                        min={0.5}
                                        max={5}
                                        step={0.5}
                                        title={`Stroke width: ${layer.strokeWidth}px`}
                                        className="w-12 shrink-0"
                                    />
                                )}

                                {!editMode && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 shrink-0 cursor-pointer"
                                                disabled={featureCount(layer.id) === 0}
                                                onClick={() => zoomToLayer(layer.id)}
                                            >
                                                <MapPin className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Zoom to layer bounds</p></TooltipContent>
                                    </Tooltip>
                                )}

                                {editMode && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 shrink-0 cursor-pointer"
                                                disabled={layers.length <= 1}
                                                onClick={() => deleteLayer(layer.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>{layers.length <= 1 ? "Can't delete the only layer" : 'Delete layer (and its features)'}</p></TooltipContent>
                                    </Tooltip>
                                )}
                            </div>
                        ))}
                    </RadioGroup>
                    <Button variant="outline" size="sm" onClick={addLayer} className="cursor-pointer w-full">
                        <Plus className="h-4 w-4 mr-1" /> Add Layer
                    </Button>
                </>
            )}
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
    const [layers, setLayers] = useAtom(drawingLayersAtom)
    const [, setActiveLayerId] = useAtom(activeLayerIdAtom)
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

    const exportGeoJSON = () => downloadGeoJSON(features, 'drawings')

    const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return
        const ext = file.name.split('.').pop()?.toLowerCase()

        // Each import lands in its own new layer named after the file, rather than
        // whatever layer happened to be selected — that made multi-file imports
        // (or importing without first remembering to create/pick a layer) dump
        // everything into one layer by default.
        const importLayer = makeLayer(layers.length, file.name.replace(/\.[^./]+$/, '') || file.name)
        setLayers((prev) => [...prev, importLayer])
        setActiveLayerId(importLayer.id)

        const reader = new FileReader()
        const handleGeojson = (geojson: any) => {
            const truncated = turf_truncate(geojson, { precision: 6, coordinates: 2 })
            const raw = truncated.type === 'FeatureCollection' ? truncated.features : [truncated]
            const newFeatures = parseFeatures(raw, importLayer.id)
            if (newFeatures.length === 0) return

            // Accumulate on top of whatever's already drawn/imported instead of
            // wiping it — importing a second file (or re-importing after a manual
            // edit) used to draw.clear() first, silently discarding prior features.
            if (draw) {
                try {
                    // draw.addFeatures() synchronously fires terra-draw's own 'change'
                    // event (see terra-draw's Store.load -> _onChange, called before
                    // addFeatures returns), which the 'change' listener in useTerraDraw
                    // already handles by calling setFeatures(newDraw.getSnapshot()) —
                    // an authoritative full resync that already includes newFeatures.
                    // A second setFeatures(prev => [...prev, ...newFeatures]) here would
                    // double-add every imported feature on top of that resync, since
                    // both run synchronously in the same call stack.
                    draw.addFeatures(newFeatures)
                } catch (err) {
                    console.error('Error adding features:', err)
                    setFeatures((prev) => [...prev, ...newFeatures])
                }
            } else {
                setFeatures((prev) => [...prev, ...newFeatures])
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
        if (ext === 'gpkg') {
            const { load } = await import('@loaders.gl/core')
            const { GeoPackageLoader } = await import('@loaders.gl/geopackage')

            // load(file, GeoPackageLoader, { gis: { format: 'geojson' } })
            //     // .then((tables: Record<string, any[]>) => {
            //     .then((tables: any) => {
            //         console.log({tables})
            //         const features = Object.values(tables).flat()
            //         handleGeojson({ type: 'FeatureCollection', features })
            //     })
            //     .catch((err) => console.error('GeoPackage import error:', err))


            
            // const data = await load(file, GeoPackageLoader, {
            //     gis: { format: 'geojson' },
            //     worker: false,
            //     geopackage: {
            //         sqlJsWorkerUrl: 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js'
            //     }
            // });
            
            // console.log('Raw loaded data:', data);

            // let combinedFeatures: any[] = [];

            // if (data && typeof data === 'object') {
            // if ('shape' in data && data.shape === 'tables' && Array.isArray(data.tables)) {
            //     for (const item of data.tables) {
            //     if (item.table && Array.isArray(item.table.features)) {
            //         combinedFeatures = [...combinedFeatures, ...item.table.features];
            //     }
            //     }
            // } else {
            //     const tables = Array.isArray(data) ? data : Object.values(data);
            //     for (const table of tables) {
            //     if (table && typeof table === 'object' && 'features' in table && Array.isArray(table.features)) {
            //         combinedFeatures = [...combinedFeatures, ...table.features];
            //     }
            //     }
            // }
            // }

            // if (combinedFeatures.length === 0) {
            // throw new Error('No features found in GPKG.');
            // }

            // let fc = {
            // type: 'FeatureCollection',
            // features: combinedFeatures
            // };

            // // Check first feature coordinates to see if they need reprojection
            // const firstFeature = combinedFeatures[0];
            // if (firstFeature && firstFeature.geometry && firstFeature.geometry.coordinates) {
            // const coords = firstFeature.geometry.type === 'Point' 
            //     ? firstFeature.geometry.coordinates 
            //     : firstFeature.geometry.type === 'LineString'
            //     ? firstFeature.geometry.coordinates[0]
            //     : firstFeature.geometry.coordinates[0][0];
            
            // console.log('Sample coordinates:', coords);
            
            // // If coordinates are large, they are likely EPSG:3857 (Web Mercator)
            // if (Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90) {
            //     console.log('Detected non-WGS84 coordinates, attempting reprojection from EPSG:3857');
            //     // Simple Web Mercator to WGS84 conversion if transformGeoJsonCoords doesn't handle it automatically
            //     // loaders.gl transformGeoJsonCoords takes a transform function
            //     fc.features = transformGeoJsonCoords(fc.features, (coord) => {
            //     const x = coord[0];
            //     const y = coord[1];
            //     const lon = (x * 180) / 20037508.34;
            //     let lat = (y * 180) / 20037508.34;
            //     lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
            //     return [lon, lat];
            //     }) as any[];
            // }
            // }

            
        // --
        // OR 
        // --
        // const { load } = await import('@loaders.gl/core')
        // const { GeoPackageLoader } = await import('@loaders.gl/geopackage')

        // const tables = await load(file, GeoPackageLoader, { gis: { format: 'geojson' } })
        // const features = Object.values(tables).flat()
        // handleGeojson({ type: 'FeatureCollection', features })

        // if (ext === 'gpkg') {
            
            // try {
            //     const data = await load(url, GeoPackageLoader);
                
            //     // loaders.gl geopackage loader usually returns an object with layers
            //     // We need to check for CRS and reproject if needed.
            //     // The structure depends on the geopackage file.
                
            //     const features = data.features || [];
            //     const crs = data.crs || 'EPSG:4326';
                
            //     if (crs !== 'EPSG:4326') {
            //     console.log(`Reprojecting from ${crs} to EPSG:4326`);
                
            //     return {
            //         ...data,
            //         features: features.map((f: any) => reprojectFeature(f, crs, 'EPSG:4326'))
            //     };
            //     }
                
            //     return data;
            // } catch (error) {
            //     console.error('Failed to load GPKG:', error);
            //     throw error;
            // }

            // const initSqlJs = await loadSqlJs()
            // const arrayBuffer = await file.arrayBuffer()
            // console.log('[gpkg] file size:', arrayBuffer.byteLength)

            // function getGpkgHeaderSize(geomBytes: Uint8Array): number {
            //     // Byte 3 is flags: bits 1-3 encode envelope type
            //     const flags = geomBytes[3]
            //     const envelopeType = (flags >> 1) & 0x07
            //     // Envelope sizes in bytes: 0=none, 1=bbox(32), 2=bbox+Z(48), 3=bbox+M(48), 4=bbox+ZM(64)
            //     const envelopeBytes = [0, 32, 48, 48, 64][envelopeType] ?? 0
            //     return 8 + envelopeBytes
            // }

            // const SQL = await initSqlJs({
            //     locateFile: (f: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`
            // })
            // const db = new SQL.Database(new Uint8Array(arrayBuffer))

            // // Log all tables in the DB for debugging
            // const allTables = db.exec(`SELECT name FROM sqlite_master WHERE type='table'`)
            // console.log('[gpkg] all tables:', allTables[0]?.values.map((r: any) => r[0]))

            // const tables = db.exec(`SELECT table_name, data_type FROM gpkg_contents`)
            // console.log('[gpkg] gpkg_contents:', tables[0]?.values)

            // const featureTables = db.exec(`SELECT table_name FROM gpkg_contents WHERE data_type='features'`)
            // const tableNames: string[] = featureTables[0]?.values.map((r: any) => r[0]) ?? []
            // console.log('[gpkg] feature tables:', tableNames)

            // const allFeatures: any[] = []
            // for (const table of tableNames) {
            //     // Get the SRS for this table
            //     const srsQuery = db.exec(
            //         `SELECT gc.srs_id FROM gpkg_geometry_columns gc WHERE gc.table_name='${table}'`
            //     )
            //     const srsId: number = srsQuery[0]?.values[0]?.[0] as number ?? 4326
            //     console.log('[gpkg] SRS for', table, ':', srsId)

            //     const proj4String = await getProj4String(srsId)
            //     if (srsId !== 4326 && !proj4String) {
            //         console.warn('[gpkg] cannot reproject table', table, '— skipping')
            //         continue
            //     }


            //     const rows = db.exec(`SELECT * FROM "${table}" LIMIT 3`)
            //     if (!rows[0]) { console.warn('[gpkg] no rows in table:', table); continue }

            //     const cols = rows[0].columns
            //     console.log('[gpkg] columns in', table, ':', cols)

            //     // Log the actual gpkg_geometry_columns to find the real geom column name
            //     const geomColQuery = db.exec(
            //         `SELECT column_name FROM gpkg_geometry_columns WHERE table_name='${table}'`
            //     )
            //     const geomColName: string = geomColQuery[0]?.values[0]?.[0] as string
            //         ?? cols.find((c: string) => !['id', 'fid'].includes(c.toLowerCase()) && !c.toLowerCase().includes('_id'))
            //         ?? cols[1]
            //     console.log('[gpkg] geometry column for', table, ':', geomColName)

            //     // Now fetch all rows
            //     const allRows = db.exec(`SELECT * FROM "${table}"`)
            //     if (!allRows[0]) continue

            //     for (const row of allRows[0].values) {
            //         const props: Record<string, any> = {}
            //         allRows[0].columns.forEach((c: string, i: number) => { if (c !== geomColName) props[c] = row[i] })
            //         const geomBytes: Uint8Array = row[allRows[0].columns.indexOf(geomColName)] as Uint8Array
            //         const headerSize = getGpkgHeaderSize(geomBytes)
            //         if (!geomBytes) { console.warn('[gpkg] null geom in row, props:', props); continue }

            //         try {
            //             // GeoPackage WKB header: 2 magic bytes + 1 version + 1 flags + 4 srs_id = 8 bytes minimum
            //             // But if envelope is present, header is longer — read flags to get actual offset
            //             const flags = geomBytes[3]
            //             const envelopeType = (flags >> 1) & 0x07
            //             const envelopeSizes = [0, 32, 48, 48, 64] // bytes for envelope types 0-4
            //             const headerSize = 8 + (envelopeSizes[envelopeType] ?? 0)
            //             console.log('[gpkg] geomBytes length:', geomBytes.length, 'flags:', flags, 'envelopeType:', envelopeType, 'headerSize:', headerSize)

            //             const wkb = geomBytes.slice(headerSize)
            //             const geojsonGeom = wkbToGeoJSON(wkb)
            //             console.log('[gpkg] parsed geom type:', geojsonGeom?.type)
            //             allFeatures.push({ type: 'Feature', geometry: geojsonGeom, properties: props })
            //         } catch (err) {
            //             console.error('[gpkg] wkb parse error:', err, 'bytes (hex):', Array.from(geomBytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '))
            //         }

            //         try {
            //             const wkb = geomBytes.slice(headerSize)
            //             let geojsonGeom = wkbToGeoJSON(wkb)

            //             // Reproject if needed
            //             if (proj4String) {
            //                 geojsonGeom = reprojectGeometry(geojsonGeom, proj4String)
            //             }

            //             allFeatures.push({ type: 'Feature', geometry: geojsonGeom, properties: props })
            //         } catch (err) {
            //             console.error('[gpkg] error:', err)
            //         }
            //     }
            // }

            // console.log('[gpkg] total features parsed:', allFeatures.length)
            // db.close()
            // handleGeojson({ type: 'FeatureCollection', features: allFeatures })

            
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
        draw?.clear()
        setFeatures([])
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <GroupHeading>Import / Export</GroupHeading>
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
            <input ref={fileInputRef} type="file" accept=".geojson,.json,.kml" onChange={importFile} className="hidden" />
            {/* <input ref={fileInputRef} type="file" accept=".geojson,.json,.kml,.gpkg" onChange={importFile} className="hidden" /> */}
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
}

export function TerraDrawSection({ draw, mapRef, isOpen, onOpenChange }: TerraDrawSectionProps) {
    return (
        <Section title="Drawing" isOpen={isOpen} onOpenChange={onOpenChange}>
            <TerraDrawActions draw={draw} mapRef={mapRef} />
            <TerraDrawControls draw={draw} mapRef={mapRef} />
            <TerraDrawLayers draw={draw} mapRef={mapRef} />
        </Section>
    )
}


// import { load } from '@loaders.gl/core';
// import { GeoPackageLoader } from '@loaders.gl/geopackage';

// // Common CRS definitions
// proj4.defs([
//   ["EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs"],
//   ["EPSG:2154", "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"]
// ]);

// export async function loadGpkgUrl(url: string) {
//   try {
//     const data = await load(url, GeoPackageLoader);
    
//     // loaders.gl geopackage loader usually returns an object with layers
//     // We need to check for CRS and reproject if needed.
//     // The structure depends on the geopackage file.
    
//     const features = data.features || [];
//     const crs = data.crs || 'EPSG:4326';
    
//     if (crs !== 'EPSG:4326') {
//       console.log(`Reprojecting from ${crs} to EPSG:4326`);
      
//       return {
//         ...data,
//         features: features.map((f: any) => reprojectFeature(f, crs, 'EPSG:4326'))
//       };
//     }
    
//     return data;
//   } catch (error) {
//     console.error('Failed to load GPKG:', error);
//     throw error;
//   }
// }

// function reprojectFeature(feature: any, fromCrs: string, toCrs: string) {
//   const transformed = { ...feature };
  
//   if (feature.geometry && feature.geometry.coordinates) {
//     transformed.geometry = {
//       ...feature.geometry,
//       coordinates: reprojectCoordinates(feature.geometry.coordinates, fromCrs, toCrs)
//     };
//   }
  
//   return transformed;
// }

// function reprojectCoordinates(coords: any, fromCrs: string, toCrs: string): any {
//   if (typeof coords[0] === 'number') {
//     return proj4(fromCrs, toCrs, coords);
//   }
//   return coords.map((c: any) => reprojectCoordinates(c, fromCrs, toCrs));
// }
