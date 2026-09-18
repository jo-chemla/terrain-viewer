import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { MapRef } from 'react-map-gl/maplibre'
import {
    TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode,
    TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode, TerraDrawSelectMode
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { Download, Upload, Trash2, MousePointer, MapPin, Minus, Pentagon, Square, Circle, Plus, Edit, Layers as LayersIcon, Repeat2, ChevronLeft, ChevronRight, ChevronDown, Target, Link, Loader2 } from 'lucide-react'
import { fetchVector, parseVector, nameFromUrl, vectorFormatFromName, setDrawingUrlParam, VECTOR_FILE_ACCEPT } from '@/lib/remote-vector'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ColorAlphaSwatch } from './color-picker'
import bbox from '@turf/bbox'
import { v4 as uuidv4 } from 'uuid'
import { Section, CheckboxWithSlider, GroupHeading, DraftBoundInput } from './controls-components'
import { truncate as turf_truncate } from '@turf/truncate'
import { downloadGeoJSON, downloadGeoJSONByLayer } from "@/lib/download-geojson"
import { track } from "@/lib/analytics"
import { persistVectorLayerFeatures, readPersistedVectorLayerFeatures, deletePersistedVectorLayer } from "@/lib/opfs-vector-store"

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

// exportGeoJSON toggle (TerraDrawActions below): off (default) exports every
// layer's features flattened into one FeatureCollection — the existing
// behavior, and still the right default for "keep drawing into the same
// layer, export it all as one file" workflows. On splits by layer instead,
// one .geojson per layer bundled into a .zip (see downloadGeoJSONByLayer in
// lib/download-geojson.ts) — useful when layers represent genuinely separate
// deliverables that should stay separate files after export.
export const drawingExportPerLayerAtom = atomWithStorage("drawingExportPerLayer", false)
/** What the Export button writes: every layer flattened into one file, one
 *  file per layer in a zip, or just the layer currently selected by the
 *  radio. Supersedes drawingExportPerLayerAtom (kept so an old stored
 *  value still means "perLayer" on first read, see TerraDrawControls). */
export type DrawingExportScope = "flat" | "perLayer" | "active"
export const drawingExportScopeAtom = atomWithStorage<DrawingExportScope | null>("drawingExportScope", null)

// Single source of truth for "which TerraDraw mode is currently active",
// written at every point draw.setMode() itself is called (TerraDrawControls'
// mode buttons, its Escape-to-select handler) rather than re-derived by each
// consumer from TerraDraw's own 'change' event — that event only fires on
// feature store mutations (add/update/delete), never from a bare setMode()
// call, so a listener-only mirror of "is a drawing mode active" (as
// ElevationPickerSection/sun-shadow-calculator-section used to keep locally)
// goes stale the moment the user switches back to Select without the store
// itself changing, permanently disabling their own toggle until some
// unrelated feature mutation happens to fire 'change' again.
export const activeDrawModeAtom = atom<string>('select')

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
    /** Hidden layers still exist (features kept, exported, persisted) but
     *  draw at zero opacity and width — see buildModeStyles. */
    hidden?: boolean
    /** Set on a layer fed by the ?drawingUrl= parameter: its geometry is
     *  re-fetched from there on every load (into this same layer, so its
     *  name and colours survive) and therefore never written to OPFS. */
    sourceUrl?: string
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

// Fixed (not uuidv4()) on purpose: this is the layer a user draws into before
// ever touching layer controls (add/rename/recolor/delete) — and none of
// those actions run just from drawing into the default layer, so
// drawingLayersAtom's setter (the only thing that writes 'drawingLayers' to
// localStorage) never fires either. A random id here would get freshly
// re-rolled on every single page load (this is module-eval-time, not
// per-session), permanently orphaning whatever geometry got persisted to
// OPFS under the previous load's id — hydratePersistedVectorLayers below
// looks up OPFS by *current* layer ids, so a layer id that isn't stable
// across reloads can never be found again. A fixed id sidesteps needing
// drawingLayersAtom to have ever been explicitly written at all.
const DEFAULT_LAYER: DrawLayer = {
    id: 'default-layer',
    name: 'Layer 1',
    fillColor: LAYER_COLOR_PALETTE[0],
    strokeColor: darkenHex(LAYER_COLOR_PALETTE[0], 0.2),
    strokeWidth: 2,
}

// Layer metadata (id/name/color/stroke width) is small enough to persist
// directly in localStorage — this doubles as the list of layer ids whose
// *geometry* gets hydrated from OPFS on mount (see hydratePersistedVectorLayers
// below). activeLayerIdAtom is persisted alongside it so the previously-active
// layer id (read back from drawingLayersAtom) still resolves to a real layer
// after a reload instead of a freshly re-rolled DEFAULT_LAYER.id every load.
export const drawingLayersAtom = atomWithStorage<DrawLayer[]>('drawingLayers', [DEFAULT_LAYER])
const activeLayerIdAtom = atomWithStorage<string>('activeLayerId', DEFAULT_LAYER.id)

/** User-facing opt-out for OPFS vector-layer persistence — on by default,
 *  mirrors persistLocalCogsAtom (local-file-store.ts). Turning it off only
 *  stops *new* writes; existing persisted geometry survives until explicitly
 *  cleared (settings-dialog.tsx's "Clear persisted vector layers" action). */
export const persistVectorLayersAtom = atomWithStorage('persistVectorLayers', true)

// Ensures the OPFS->draw.addFeatures() restore in useTerraDraw only ever runs
// once per page load, not once per TerraDraw-instance-recreation (see the
// effect's own comment for why a module-level flag rather than a ref).
let hasHydratedVectorLayers = false

/** Reads every given layer's persisted geometry back from OPFS (skipping
 *  layers with none persisted), for the one-time hydration pass in
 *  useTerraDraw below. */
async function hydratePersistedVectorLayers(layers: DrawLayer[]): Promise<GeoJSONFeature[]> {
    const perLayer = await Promise.all(
        layers.filter((l) => !l.sourceUrl).map((l) => readPersistedVectorLayerFeatures<GeoJSONFeature>(l.id)),
    )
    return perLayer.flatMap((features) => features ?? [])
}

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
export function resolveLayer(layers: DrawLayer[], feature: any): DrawLayer {
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
    // A hidden layer is drawn at zero opacity AND zero width — opacity alone
    // leaves a 1px hairline on some GPUs, width alone leaves polygon fills.
    const hiddenOf = (feature: any) => !!resolveLayer(layersRef.current, feature).hidden
    const fillOf = (feature: any): any => splitHexAlpha(resolveLayer(layersRef.current, feature).fillColor).color
    const fillOpacityOf = (feature: any): any => hiddenOf(feature) ? 0 : splitHexAlpha(resolveLayer(layersRef.current, feature).fillColor).opacity
    const strokeOf = (feature: any): any => splitHexAlpha(resolveLayer(layersRef.current, feature).strokeColor).color
    const strokeOpacityOf = (feature: any): any => hiddenOf(feature) ? 0 : splitHexAlpha(resolveLayer(layersRef.current, feature).strokeColor).opacity
    const strokeWidthOf = (feature: any): any => hiddenOf(feature) ? 0 : resolveLayer(layersRef.current, feature).strokeWidth
    const pointWidthOf = (feature: any): any => hiddenOf(feature) ? 0 : 6

    return {
        point: {
            pointColor: fillOf, pointOpacity: fillOpacityOf, pointWidth: pointWidthOf,
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
            selectedPointColor: fillOf, selectedPointOpacity: fillOpacityOf, selectedPointWidth: pointWidthOf,
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
/** Set once the ?drawingUrl= parameters have been loaded (module-level for
 *  the same reason as hasHydratedVectorLayers: a remount must not reload). */
let hasLoadedDrawingUrls = false

/**
 * Adds a parsed GeoJSON to the drawing as its own layer - the one funnel for
 * a picked file, a pasted URL and the ?drawingUrl= parameter (see
 * lib/remote-vector.ts for the parsing). Returns the number of features
 * added, throws with a readable message otherwise. With `sourceUrl`, an
 * existing layer already fed by that URL is refilled instead of duplicated.
 */
function useDrawingImport(draw: TerraDraw | null, mapRef: RefObject<MapRef>) {
    const setFeatures = useSetAtom(drawingFeaturesAtom)
    const [layers, setLayers] = useAtom(drawingLayersAtom)
    const setActiveLayerId = useSetAtom(activeLayerIdAtom)
    const layersRef = useRef(layers)
    layersRef.current = layers

    return useCallback((geojson: any, name: string, format: string, opts: { sourceUrl?: string; fit?: boolean } = {}): number => {
        // A bare .json also matches unrelated exports (a bookmarks file...):
        // check the obvious shape first, turf_truncate's own "Unknown Geometry
        // Type" is accurate but opaque.
        if (!geojson || (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature')) {
            throw new Error(`"${name}" doesn't look like GeoJSON (expected a Feature or FeatureCollection) — wrong file selected?`)
        }
        const truncated = turf_truncate(geojson, { precision: 6, coordinates: 2 })
        const raw = truncated.type === 'FeatureCollection' ? truncated.features : [truncated]
        const existing = opts.sourceUrl ? layersRef.current.find((l) => l.sourceUrl === opts.sourceUrl) : undefined
        // Each import lands in its own new layer named after the file, created
        // only once the data is known to hold real features (no phantom layer).
        const layer: DrawLayer = existing ?? { ...makeLayer(layersRef.current.length, name), ...(opts.sourceUrl ? { sourceUrl: opts.sourceUrl } : {}) }
        // parseFeatures keeps a feature's own properties.layerId (so a
        // re-imported export lands back in its layers); a remote layer owns
        // its features outright.
        const newFeatures = parseFeatures(raw, layer.id).map((f) => (opts.sourceUrl ? { ...f, properties: { ...f.properties, layerId: layer.id } } : f))
        if (newFeatures.length === 0) throw new Error(`"${name}" has no importable features.`)
        if (!existing) {
            layersRef.current = [...layersRef.current, layer]
            setLayers((prev) => [...prev, layer])
        }
        setActiveLayerId(layer.id)
        track("tools-drawing", { action: "import", features: newFeatures.length, format, remote: !!opts.sourceUrl })

        // Accumulates on top of whatever is already drawn. draw.addFeatures()
        // synchronously fires terra-draw's 'change', which useTerraDraw's
        // listener turns into setFeatures(getSnapshot()) - so no second
        // setFeatures on the success path, it would double-add.
        if (draw) {
            try {
                if (existing) {
                    const stale = draw.getSnapshot().filter((f) => f.properties?.layerId === layer.id).map((f) => f.id as string)
                    if (stale.length) draw.removeFeatures(stale)
                }
                draw.addFeatures(newFeatures)
            } catch (err) {
                console.error('Error adding features:', err)
                setFeatures((prev) => [...prev.filter((f) => !existing || f.properties?.layerId !== layer.id), ...newFeatures])
            }
        } else {
            setFeatures((prev) => [...prev.filter((f) => !existing || f.properties?.layerId !== layer.id), ...newFeatures])
        }

        const map = mapRef.current?.getMap()
        if (map) {
            setTerraDrawVisibility(map, true)
            setTerraDrawOpacity(map, 1)
            if (opts.fit !== false) {
                try {
                    const bounds = bbox(geojson)
                    if (bounds.length === 4 && !bounds.some(isNaN)) {
                        map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 40, duration: 800 })
                    }
                } catch (err) { console.error('Zoom error:', err) }
            }
        }
        return newFeatures.length
    }, [draw, mapRef, setFeatures, setLayers, setActiveLayerId])
}

export function useTerraDraw(mapRef: RefObject<MapRef>) {
    const [draw, setDraw] = useState<TerraDraw | null>(null)
    const [features, setFeatures] = useAtom(drawingFeaturesAtom)
    const [layers] = useAtom(drawingLayersAtom)
    const [activeLayerId] = useAtom(activeLayerIdAtom)
    const setActiveDrawMode = useSetAtom(activeDrawModeAtom)
    const featuresRef = useRef(features)
    const layersRef = useRef(layers)
    const activeLayerIdRef = useRef(activeLayerId)
    const drawRef = useRef<TerraDraw | null>(null)

    const persistVectorLayers = useAtomValue(persistVectorLayersAtom)
    // Gates the persist-on-change effect below until the OPFS restore has had
    // its chance to run (see that effect's own comment for why this matters —
    // without it, drawingFeaturesAtom's freshly-mounted empty [] can win a
    // race against the still-pending async restore and get written to OPFS
    // first, permanently clobbering the very data being restored).
    const [hasHydrated, setHasHydrated] = useState(false)

    useEffect(() => { featuresRef.current = features }, [features])
    useEffect(() => { layersRef.current = layers }, [layers])
    useEffect(() => { activeLayerIdRef.current = activeLayerId }, [activeLayerId])

    // One-shot, whenever a real TerraDraw instance first becomes available:
    // restore any features persisted to OPFS for the layers already
    // (synchronously) read back from drawingLayersAtom's localStorage-backed
    // state. Waiting for `draw` itself (rather than firing this on mount and
    // just writing into drawingFeaturesAtom) sidesteps a real race — map
    // style loading and this OPFS read have no ordering guarantee relative to
    // each other, so only feeding restored features through draw.addFeatures()
    // (which synchronously fires terra-draw's own 'change' listener, already
    // resyncing drawingFeaturesAtom — see below) guarantees they land in
    // terra-draw's actual internal store regardless of timing. Guarded by a
    // module-level flag (not a ref) so the actual OPFS read + addFeatures call
    // still only runs once even if `draw` gets recreated later (e.g. a mapRef
    // swap) — from then on, createDraw's own existing "featuresRef.current.
    // length > 0" restore path (below) already re-feeds the same, by-then-
    // hydrated atom into any new instance, so re-running this would just
    // re-add duplicates. A remount after that point still needs to flip this
    // hook instance's own (local, not module-level) hasHydrated so ITS persist
    // effect isn't permanently stuck waiting on a restore that already happened
    // in an earlier mount.
    useEffect(() => {
        if (!draw) return
        if (hasHydratedVectorLayers) {
            setHasHydrated(true)
            return
        }
        hasHydratedVectorLayers = true
        hydratePersistedVectorLayers(layersRef.current).then((restored) => {
            if (restored.length > 0) {
                try { draw.addFeatures(restored) } catch (e) { console.error('[TerraDraw] failed to restore persisted vector layers:', e) }
            }
            setHasHydrated(true)
        })
    }, [draw])

    // Debounced (drawing/dragging fires many rapid feature updates) best-effort
    // write of every layer's current feature subset to OPFS — covers hand-drawn,
    // imported, edited, and deleted (via the resulting empty array) geometry
    // alike, since it's just keyed off whatever `features`/`layers` currently
    // hold rather than any specific edit action. Withheld until hasHydrated
    // (see above) so a page load that never finishes restoring (or hasn't yet)
    // can't overwrite still-good OPFS data with drawingFeaturesAtom's blank
    // startup value.
    useEffect(() => {
        if (!persistVectorLayers || !hasHydrated) return
        const timer = setTimeout(() => {
            for (const layer of layers) {
                if (layer.sourceUrl) continue // re-fetched on load, see DrawLayer.sourceUrl
                const layerFeatures = features.filter((f) => (f.properties?.layerId ?? layers[0]?.id) === layer.id)
                persistVectorLayerFeatures(layer.id, layerFeatures)
            }
        }, 800)
        return () => clearTimeout(timer)
    }, [features, layers, persistVectorLayers, hasHydrated])

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
                // terra-draw's default pointerDistance is 40 px: any click that
                // close to the previous vertex is swallowed and one that close
                // to the closing point finishes the shape, which made fine
                // features impossible to trace. 8 px while drawing; select keeps
                // a slightly larger grab radius for vertex handles.
                const DRAW_POINTER_DISTANCE = 8
                const SELECT_POINTER_DISTANCE = 12
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
                            pointerDistance: SELECT_POINTER_DISTANCE,
                        }),
                        new TerraDrawPointMode({ styles: modeStyles.point, pointerDistance: DRAW_POINTER_DISTANCE }),
                        new TerraDrawLineStringMode({ styles: modeStyles.linestring, pointerDistance: DRAW_POINTER_DISTANCE }),
                        new TerraDrawPolygonMode({ styles: modeStyles.polygon, pointerDistance: DRAW_POINTER_DISTANCE }),
                        new TerraDrawRectangleMode({ styles: modeStyles.rectangle, pointerDistance: DRAW_POINTER_DISTANCE }),
                        new TerraDrawCircleMode({ styles: modeStyles.circle, pointerDistance: DRAW_POINTER_DISTANCE }),
                    ],
                })
                newDraw.start()
                newDraw.setMode('select')
                // A fresh instance (e.g. a mapRef swap) always resets to
                // 'select' internally regardless of whatever mode the old
                // instance was last left in — keep the shared atom in sync so
                // ElevationPickerSection/sun-shadow-calculator-section don't
                // stay stuck thinking a drawing mode is still active.
                setActiveDrawMode('select')

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

    // ?drawingUrl=<url> (repeatable): remote vector data loaded into the
    // drawing at startup, one layer per URL - for links and iframes that
    // point the app at someone else's data. Read straight off the address
    // bar rather than declared in nuqs: it is an instruction, not state the
    // app ever writes, and nuqs leaves unknown parameters in place, so the
    // link stays shareable. The camera only follows the data when the link
    // does not carry its own.
    const importDrawing = useDrawingImport(draw, mapRef)
    useEffect(() => {
        if (!draw || hasLoadedDrawingUrls) return
        hasLoadedDrawingUrls = true
        const params = new URLSearchParams(window.location.search)
        const urls = params.getAll("drawingUrl").filter(Boolean)
        const fit = !params.has("lat") && !params.has("lng")
        ;(async () => {
            for (const url of urls) {
                try {
                    const { geojson, format } = await fetchVector(url)
                    importDrawing(geojson, nameFromUrl(url), format, { sourceUrl: url, fit })
                } catch (e) {
                    console.error(`[TerraDraw] drawingUrl ${url}:`, e)
                }
            }
        })()
    }, [draw, importDrawing])

    return { draw, features, setFeatures }
}

// --- CONTROLS COMPONENT ---

function TerraDrawControls({ draw, mapRef }: { draw: TerraDraw | null; mapRef: RefObject<MapRef> }) {
    // Shared with ElevationPickerSection/sun-shadow-calculator-section (see
    // activeDrawModeAtom's own comment) — written here at every point
    // draw.setMode() itself is called, not re-derived from draw's 'change'
    // event (which never fires from a bare setMode() call, only from feature
    // store mutations).
    const [activeDrawMode, setActiveDrawMode] = useAtom(activeDrawModeAtom)

    useEffect(() => {
        if (!draw) return
        // Fallback only — covers any mode change this component didn't itself
        // initiate (there currently is none, but this keeps the atom honest
        // if one gets added later without also being routed through
        // setActiveDrawMode).
        const update = () => { try { const m = draw.getMode(); if (m) setActiveDrawMode(m) } catch { } }
        draw.on('change', update)
        return () => { try { draw.off('change', update) } catch { } }
    }, [draw, setActiveDrawMode])

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

    // Escape bails out of whatever drawing mode is active (circle, point,
    // polygon…) back to Select — a quick "never mind" without having to
    // click the Select button, matching the usual escape-cancels-tool
    // convention. Skipped while typing in a text field for the same reason
    // the feature iterator's own shortcuts are.
    useEffect(() => {
        if (!draw) return
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || draw.getMode() === 'select') return
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
            draw.setMode('select')
            setActiveDrawMode('select')
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
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
            <GroupHeading>Mode</GroupHeading>
            <div className="grid grid-cols-3 gap-2">
                {modes.map(({ id, label, icon: Icon }) => (
                    <Button
                        key={id}
                        variant={activeDrawMode === id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => { draw.setMode(id); setActiveDrawMode(id); if (id !== "select") track("tools-drawing", { action: "mode", mode: id }) }}
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

function TerraDrawLayers({ draw, mapRef }: { draw: TerraDraw | null; mapRef: RefObject<MapRef> }) {
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

    // Both atoms are independently persisted (localStorage) — self-heal if
    // they're ever out of sync (e.g. activeLayerId points at a layer deleted
    // in a session that didn't get to run its own setActiveLayerId fallback)
    // rather than leaving drawing attribution pointed at a non-existent layer.
    useEffect(() => {
        if (layers.length > 0 && !layers.some((l) => l.id === activeLayerId)) {
            setActiveLayerId(layers[0].id)
        }
    }, [layers, activeLayerId, setActiveLayerId])

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

    const setLayerHidden = (layerId: string, hidden: boolean) => {
        setLayers(layers.map((l) => (l.id === layerId ? { ...l, hidden: hidden || undefined } : l)))
    }

    const deleteLayer = (layerId: string) => {
        if (layers.length <= 1) return
        const idsToDelete = features.filter((f) => f.properties?.layerId === layerId).map((f) => f.id).filter(Boolean) as string[]
        if (idsToDelete.length > 0) {
            try { draw?.removeFeatures(idsToDelete) } catch (e) { console.error('Error removing layer features:', e) }
            setFeatures((prev) => prev.filter((f) => f.properties?.layerId !== layerId))
        }
        const remaining = layers.filter((l) => l.id !== layerId)
        const gone = layers.find((l) => l.id === layerId)
        if (gone?.sourceUrl) setDrawingUrlParam(gone.sourceUrl, false)
        setLayers(remaining)
        if (activeLayerId === layerId) setActiveLayerId(remaining[0].id)
        deletePersistedVectorLayer(layerId)
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

    // --- Feature Iterator ---
    // "Loop through" one layer's features one at a time (Repeat2 toggle on the
    // layer row), each one auto-framed on the map: a polyline/polygon gets
    // fitBounds with a 20%-of-viewport margin on every side (its own computed
    // zoom); a point has no extent to fit, so it's just centered at either a
    // user-chosen fixed zoom or whatever zoom the map is already at.
    const [iteratorLayerId, setIteratorLayerId] = useState<string | null>(null)
    const [iteratorIndex, setIteratorIndex] = useState(0)
    // null = "keep the map's current zoom untouched" for point features.
    const [iteratorZoom, setIteratorZoom] = useState<number | null>(null)
    const iteratorFeatures = iteratorLayerId
        ? features.filter((f) => (f.properties?.layerId ?? layers[0]?.id) === iteratorLayerId)
        : []
    const iteratorTotal = iteratorFeatures.length

    // Jumping to a brand-new layer (or one that's now empty) starts over at
    // the first feature rather than carrying over an index that may no
    // longer exist there.
    useEffect(() => { setIteratorIndex(0) }, [iteratorLayerId])
    // A layer shrinking (features deleted) while its iterator is open could
    // otherwise leave the index pointing past the end.
    useEffect(() => {
        if (iteratorTotal > 0 && iteratorIndex >= iteratorTotal) setIteratorIndex(iteratorTotal - 1)
    }, [iteratorTotal, iteratorIndex])

    const flyToIteratorFeature = (feature: GeoJSONFeature) => {
        const map = mapRef.current?.getMap()
        if (!map || !feature?.geometry) return
        if (feature.geometry.type === 'Point') {
            const [lng, lat] = feature.geometry.coordinates
            map.easeTo({ center: [lng, lat], zoom: iteratorZoom ?? map.getZoom(), duration: 500 })
            return
        }
        try {
            const bounds = bbox(feature as any)
            if (bounds.length === 4 && !bounds.some((n: number) => Number.isNaN(n))) {
                const container = map.getContainer()
                const padX = container.clientWidth * 0.2
                const padY = container.clientHeight * 0.2
                map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
                    padding: { top: padY, bottom: padY, left: padX, right: padX },
                    duration: 500,
                })
            }
        } catch (e) { console.error('Error zooming to feature bounds:', e) }
    }

    // Fires on genuine navigation (index or active layer changing) only —
    // deliberately NOT on iteratorFeatures/flyToIteratorFeature identity
    // changes (a re-render for an unrelated reason shouldn't re-trigger a
    // camera move to the same feature it's already framing).
    useEffect(() => {
        if (!iteratorLayerId) return
        const feature = iteratorFeatures[iteratorIndex]
        if (!feature) return
        flyToIteratorFeature(feature)
        // Deliberately NOT calling draw.selectFeature here — it looked odd
        // (TerraDraw's own selection handles appearing on every navigate) and
        // could leave stale selection state behind when D/Delete removed a
        // feature whose handles were currently showing. The iterator has its
        // own D/Delete-key deletion (below) and doesn't need TerraDraw's
        // select mode for that.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [iteratorLayerId, iteratorIndex])

    const goToIteratorIndex = (i: number) => {
        if (iteratorTotal === 0) return
        setIteratorIndex(((i % iteratorTotal) + iteratorTotal) % iteratorTotal) // wraps both ways, matching the Repeat2/"loop through" framing
    }

    // Clicking a feature on the map (TerraDraw's own select mode, not
    // anything the iterator drives — see the "Deliberately NOT calling
    // draw.selectFeature" comment above) jumps the iterator to match it, the
    // reverse direction of the effect above. Only when the click landed on a
    // feature that's actually IN the currently-iterated layer — clicking one
    // of another layer's features leaves the iterator wherever it was.
    useEffect(() => {
        if (!draw || !iteratorLayerId) return
        const handleSelect = (id: string | number) => {
            const idx = iteratorFeatures.findIndex((f) => f.id === id)
            if (idx !== -1) setIteratorIndex(idx)
        }
        draw.on('select', handleSelect)
        return () => { try { draw.off('select', handleSelect) } catch { } }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draw, iteratorLayerId, iteratorFeatures])

    const deleteIteratorFeature = () => {
        const feature = iteratorFeatures[iteratorIndex]
        if (!feature?.id) return
        try { draw?.removeFeatures([feature.id]) } catch (e) { console.error('Error removing feature:', e) }
        setFeatures((prev) => prev.filter((f) => f.id !== feature.id))
        // iteratorIndex/iteratorTotal re-clamp themselves via the effect above,
        // but that only changes iteratorIndex's VALUE when the deleted feature
        // was the last one — otherwise the same index now refers to what was
        // the next feature, and the nav effect (keyed on index/layer identity)
        // won't re-fire to fly there. Fly to it explicitly here instead.
        const remaining = iteratorFeatures.filter((f) => f.id !== feature.id)
        if (remaining.length > 0) {
            const nextIndex = iteratorIndex >= remaining.length ? remaining.length - 1 : iteratorIndex
            flyToIteratorFeature(remaining[nextIndex])
        }
    }

    // D or Delete deletes the currently-framed feature; Right/N step to the
    // next one, Left/P to the previous — active only while the iterator
    // is open, and only when focus isn't in a text field (so typing a layer
    // name or a "go to index" value doesn't get eaten). Capture phase +
    // stopPropagation so Left/Right win over MapLibre's own arrow-key camera
    // pan when the map canvas happens to have focus, rather than doing both
    // at once.
    useEffect(() => {
        if (!iteratorLayerId) return
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
            if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') { e.preventDefault(); e.stopPropagation(); goToIteratorIndex(iteratorIndex + 1) }
            else if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') { e.preventDefault(); e.stopPropagation(); goToIteratorIndex(iteratorIndex - 1) }
            else if (e.key === 'd' || e.key === 'D' || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); deleteIteratorFeature() }
        }
        window.addEventListener('keydown', handler, true)
        return () => window.removeEventListener('keydown', handler, true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [iteratorLayerId, iteratorIndex, iteratorTotal])

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <GroupHeading>Layers</GroupHeading>
                <div className="flex items-center gap-1">
                    {multiLayerMode && (
                        <Tooltip>
                            <TooltipTrigger
                                delay={0}
                                render={
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
                                }
                            />
                            <TooltipContent><p>{editMode ? 'Done editing' : 'Edit layer names, colors and width'}</p></TooltipContent>
                        </Tooltip>
                    )}
                    <Tooltip>
                        <TooltipTrigger
                            delay={0}
                            render={
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
                            }
                        />
                        <TooltipContent><p>{multiLayerMode ? 'Multiple layers (click for single layer)' : 'Single layer (click to enable multiple)'}</p></TooltipContent>
                    </Tooltip>
                </div>
            </div>

            {multiLayerMode && (
                <>
                    {/* Checkbox = shown or hidden. Clicking a name makes it the
                        layer new drawings go to — shown in bold, no radio. */}
                    <div className="flex flex-col gap-2">
                        {layers.map((layer) => (
                            <div key={layer.id} className="flex items-center gap-2 min-w-0">
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <span className="flex shrink-0">
                                                <Checkbox
                                                    checked={!layer.hidden}
                                                    onCheckedChange={(checked) => setLayerHidden(layer.id, checked !== true)}
                                                    aria-label={layer.hidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
                                                    className="cursor-pointer"
                                                />
                                            </span>
                                        }
                                    />
                                    <TooltipContent><p>{layer.hidden ? "Hidden — click to show" : "Shown — click to hide"}</p></TooltipContent>
                                </Tooltip>

                                {layer.sourceUrl && (
                                    <Tooltip>
                                        <TooltipTrigger render={<span className="shrink-0 text-muted-foreground"><Link className="h-3 w-3" /></span>} />
                                        <TooltipContent><p>Linked layer: re-fetched from {layer.sourceUrl} on every load (carried by the link's drawingUrl parameter), not stored in this browser</p></TooltipContent>
                                    </Tooltip>
                                )}
                                {editMode ? (
                                    <Input
                                        value={layer.name}
                                        onChange={(e) => renameLayer(layer.id, e.target.value)}
                                        className="h-8 flex-1 min-w-0 text-sm"
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => layer.id === activeLayerId ? setLayerHidden(layer.id, !layer.hidden) : setActiveLayerId(layer.id)}
                                        title={layer.id === activeLayerId ? `Active layer — new drawings go here. Click again to ${layer.hidden ? "show" : "hide"} it` : "Click to draw on this layer"}
                                        className={`flex-1 text-left text-sm truncate min-w-0 cursor-pointer ${layer.id === activeLayerId ? "font-bold" : "font-normal"} ${layer.hidden ? "text-muted-foreground" : ""}`}
                                    >
                                        {layer.name} <span className="text-muted-foreground font-normal">({featureCount(layer.id)})</span>
                                    </button>
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
                                    // Editable even outside edit mode — recoloring a layer is common
                                    // enough (and low-risk enough) that it shouldn't require toggling
                                    // into the full name/stroke/width editing UI just for this.
                                    <ColorAlphaSwatch
                                        title={`${layer.name} fill color`}
                                        color={layer.fillColor}
                                        onChange={(hex) => setLayerColor(layer.id, 'fillColor', hex)}
                                        className="rounded"
                                    />
                                )}

                                {editMode && (
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Slider
                                                    value={layer.strokeWidth}
                                                    onValueChange={(v) => setLayerStrokeWidth(layer.id, v as number)}
                                                    min={0.5}
                                                    max={5}
                                                    step={0.5}
                                                    className="w-12 shrink-0"
                                                />
                                            }
                                        />
                                        <TooltipContent><p>Stroke width: {layer.strokeWidth}px</p></TooltipContent>
                                    </Tooltip>
                                )}

                                {!editMode && (
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0 cursor-pointer"
                                                    disabled={featureCount(layer.id) === 0}
                                                    onClick={() => zoomToLayer(layer.id)}
                                                >
                                                    <MapPin className="h-4 w-4" />
                                                </Button>
                                            }
                                        />
                                        <TooltipContent><p>Zoom to layer bounds</p></TooltipContent>
                                    </Tooltip>
                                )}

                                {!editMode && (
                                    <Tooltip>
                                        {/* The extra span (matching every other disablable toggle in this
                                            file) keeps the tooltip firing while disabled — a native
                                            disabled control doesn't dispatch pointer/hover events, so the
                                            trigger would never open if Toggle itself were the render target. */}
                                        <TooltipTrigger
                                            render={
                                                <span>
                                                    <Toggle
                                                        pressed={iteratorLayerId === layer.id}
                                                        onPressedChange={(pressed) => setIteratorLayerId(pressed ? layer.id : null)}
                                                        size="sm"
                                                        disabled={featureCount(layer.id) === 0}
                                                        className="h-8 w-8 shrink-0 cursor-pointer p-0"
                                                    >
                                                        <Repeat2 className="h-4 w-4" />
                                                    </Toggle>
                                                </span>
                                            }
                                        />
                                        <TooltipContent>
                                            {iteratorLayerId === layer.id ? <p>Stop Feature Iterator</p> : (
                                                <p>
                                                    <span className="font-medium">Feature Iterator</span> — loop through this layer's features one at a time, auto-framing each on the map.<br />
                                                    Use ←/→ (N for next, or the index field) to navigate, D to delete the current feature.
                                                </p>
                                            )}
                                        </TooltipContent>
                                    </Tooltip>
                                )}

                                {editMode && (
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0 cursor-pointer"
                                                    disabled={layers.length <= 1}
                                                    onClick={() => deleteLayer(layer.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            }
                                        />
                                        <TooltipContent><p>{layers.length <= 1 ? "Can't delete the only layer" : 'Delete layer (and its features)'}</p></TooltipContent>
                                    </Tooltip>
                                )}
                            </div>
                        ))}
                    </div>

                    {iteratorLayerId && iteratorTotal > 0 && (
                        <div className="space-y-2 rounded-md border p-2">
                            <Tooltip>
                                <TooltipTrigger
                                    delay={0}
                                    render={
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground cursor-default">
                                            <Repeat2 className="h-3.5 w-3.5" />
                                            Feature Iterator
                                        </div>
                                    }
                                />
                                <TooltipContent>
                                    <p>
                                        Loop through this layer's features one at a time, auto-framing each on the map.<br />
                                        Use ←/→ (N for next, or the index field) to navigate, D to delete the current feature.
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                            <div className="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 cursor-pointer" onClick={() => goToIteratorIndex(iteratorIndex - 1)}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <DraftBoundInput
                                    value={iteratorIndex + 1}
                                    onCommit={(v) => { if (v !== undefined) goToIteratorIndex(Math.round(v) - 1) }}
                                    className="h-7 w-[8ch] px-1 text-center text-sm bg-transparent border rounded"
                                />
                                <span className="text-xs text-muted-foreground shrink-0">/{iteratorTotal}</span>
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 cursor-pointer" onClick={() => goToIteratorIndex(iteratorIndex + 1)}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="flex items-center justify-center gap-1">
                                <Tooltip>
                                    <TooltipTrigger render={<Label className="text-xs text-muted-foreground shrink-0 cursor-default">Zoom</Label>} />
                                    <TooltipContent><p>Zoom level to center a point feature at — only applies to points (polylines/polygons always auto-fit to their own extent). Empty keeps whatever zoom the map is already at.</p></TooltipContent>
                                </Tooltip>
                                <DraftBoundInput
                                    value={iteratorZoom ?? undefined}
                                    onCommit={(v) => setIteratorZoom(v ?? null)}
                                    placeholder="Current"
                                    className="h-7 w-[7ch] px-1 text-xs text-right bg-transparent border rounded"
                                    step={0.5}
                                />
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 shrink-0 cursor-pointer"
                                                onClick={() => {
                                                    const zoom = mapRef.current?.getMap()?.getZoom()
                                                    setIteratorZoom(zoom === undefined ? null : Math.round(zoom * 10) / 10)
                                                }}
                                            >
                                                <Target className="h-3.5 w-3.5" />
                                            </Button>
                                        }
                                    />
                                    <TooltipContent><p>Set to the map's current zoom</p></TooltipContent>
                                </Tooltip>
                                <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 shrink-0 cursor-pointer"
                                                onClick={() => {
                                                    const feature = iteratorFeatures[iteratorIndex]
                                                    if (feature) flyToIteratorFeature(feature)
                                                }}
                                            >
                                                <MapPin className="h-4 w-4" />
                                            </Button>
                                        }
                                    />
                                    <TooltipContent><p>Zoom to this feature again (e.g. after panning away)</p></TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 cursor-pointer" onClick={deleteIteratorFeature}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        }
                                    />
                                    <TooltipContent><p>Delete this feature (D)</p></TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                    )}

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

function TerraDrawActions({ draw, mapRef }: { draw: TerraDraw | null; mapRef: RefObject<MapRef> }) {
    const [features, setFeatures] = useAtom(drawingFeaturesAtom)
    const [layers, setLayers] = useAtom(drawingLayersAtom)
    const [activeLayerId, setActiveLayerId] = useAtom(activeLayerIdAtom)
    const [exportPerLayerLegacy] = useAtom(drawingExportPerLayerAtom)
    const [exportScopeStored, setExportScope] = useAtom(drawingExportScopeAtom)
    const exportScope: DrawingExportScope = exportScopeStored ?? (exportPerLayerLegacy ? "perLayer" : "flat")
    const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0]
    const activeLayerFeatureCount = features.filter((f) => (f.properties?.layerId ?? layers[0]?.id) === activeLayer?.id).length
    const EXPORT_SCOPE_LABEL: Record<DrawingExportScope, string> = {
        flat: "Export — every layer flattened into one .geojson",
        perLayer: "Export — one .geojson per layer, bundled into a .zip",
        active: `Export — only "${activeLayer?.name ?? "the active layer"}" as one .geojson`,
    }
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [visible, setVisible] = useState(true)
    const [opacity, setOpacity] = useState(1)
    // Surfaced under the Import/Export/Clear row — picking a file that isn't
    // actually GeoJSON/KML (e.g. a bookmarks export, which also ends in
    // .json) used to fail completely silently: the reader's try/catch only
    // console.error'd, so nothing visible told you the import didn't work.
    const [importError, setImportError] = useState<string | null>(null)
    const importErrorTimer = useRef<NodeJS.Timeout | null>(null)
    const reportImportError = (message: string) => {
        if (importErrorTimer.current) clearTimeout(importErrorTimer.current)
        setImportError(message)
        importErrorTimer.current = setTimeout(() => setImportError(null), 6000)
    }

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
        track("tools-drawing", { action: "export", features: features.length, scope: exportScope })
        if (exportScope === "perLayer") downloadGeoJSONByLayer(features, layers, 'drawings')
        else if (exportScope === "active") {
            const own = features.filter((f) => (f.properties?.layerId ?? layers[0]?.id) === activeLayer?.id)
            downloadGeoJSON(own, `drawings-${(activeLayer?.name ?? "layer").trim().replace(/[^\w\- ]+/g, "-").replace(/\s+/g, "_")}`)
        }
        else downloadGeoJSON(features, 'drawings')
    }

    const importDrawing = useDrawingImport(draw, mapRef)
    const [importUrl, setImportUrl] = useState("")
    const [isImportingUrl, setIsImportingUrl] = useState(false)
    const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false)
    const [keepInLink, setKeepInLink] = useState(false)
    const afterImport = () => { setVisible(true); setOpacity(1) }

    const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (!file) return
        setImportError(null)
        try {
            const format = vectorFormatFromName(file.name)
            if (!format) throw new Error(`"${file.name}": unsupported format (GeoJSON, KML, GPX or FlatGeobuf expected).`)
            const geojson = await parseVector(await file.arrayBuffer(), format)
            importDrawing(geojson, file.name.replace(/\.[^./]+$/, '') || file.name, format)
            afterImport()
        } catch (err) {
            console.error('Import error:', err)
            reportImportError(err instanceof Error ? err.message : `Failed to import "${file.name}".`)
        }
    }

    // Same funnel from a URL. By default a one-off copy: the layer is
    // persisted like any imported file and not re-fetched. "Keep in the
    // link" instead makes it a ?drawingUrl= layer (see useTerraDraw): the
    // address bar gains the parameter, so the link carries the data, and the
    // layer is re-fetched on every load rather than stored.
    const importFromUrl = async () => {
        const url = importUrl.trim()
        if (!url || isImportingUrl) return
        setImportError(null)
        setIsImportingUrl(true)
        try {
            const { geojson, format } = await fetchVector(url)
            importDrawing(geojson, nameFromUrl(url), format, keepInLink ? { sourceUrl: url } : {})
            if (keepInLink) setDrawingUrlParam(url, true)
            afterImport()
            setImportUrl("")
            setIsUrlDialogOpen(false)
        } catch (err) {
            console.error('URL import error:', err)
            reportImportError(`${nameFromUrl(url)} ${err instanceof Error ? err.message : "could not be imported"}`)
        } finally {
            setIsImportingUrl(false)
        }
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

            <div className="flex items-center gap-2">
                {/* Same split-button shape as Export: the main button is the
                    default (a file), the chevron holds the alternative (a URL). */}
                <div className="flex flex-1 min-w-0">
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="cursor-pointer flex-1 min-w-0 rounded-r-none border-r-0">
                                    <Upload className="h-4 w-4 mr-1 shrink-0" /> <span className="truncate">Import</span>
                                </Button>
                            }
                        />
                        <TooltipContent><p>Import a GeoJSON, KML, GPX or FlatGeobuf file</p></TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={
                                <Button variant="outline" size="sm" className="cursor-pointer rounded-l-none px-1 shrink-0" aria-label="Import options">
                                    <ChevronDown className="h-4 w-4" />
                                </Button>
                            }
                        />
                        <DropdownMenuContent align="start" className="w-48">
                            <DropdownMenuItem className="cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                <Upload className="h-4 w-4" /> From a file…
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer" onClick={() => { setImportError(null); setIsUrlDialogOpen(true) }}>
                                <Link className="h-4 w-4" /> From a URL…
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <div className="flex flex-1 min-w-0">
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={exportGeoJSON}
                                    disabled={features.length === 0}
                                    className="cursor-pointer flex-1 min-w-0 rounded-r-none border-r-0"
                                >
                                    <Download className="h-4 w-4 mr-1 shrink-0" /> <span className="truncate">Export</span>
                                </Button>
                            }
                        />
                        <TooltipContent><p>{EXPORT_SCOPE_LABEL[exportScope]}</p></TooltipContent>
                    </Tooltip>
                    <Popover>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <PopoverTrigger
                                        render={
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={features.length === 0}
                                                className="cursor-pointer rounded-l-none px-1 shrink-0"
                                                aria-label="Export options"
                                            >
                                                <ChevronDown className="h-4 w-4" />
                                            </Button>
                                        }
                                    />
                                }
                            />
                            <TooltipContent><p>Export options</p></TooltipContent>
                        </Tooltip>
                        <PopoverContent className="w-72 space-y-2">
                            <Label className="text-xs font-medium">Export scope</Label>
                            <RadioGroup value={exportScope} onValueChange={(v) => setExportScope(v as DrawingExportScope)} className="gap-1.5">
                                {([
                                    ["flat", "All layers, flattened", "Every feature in one .geojson (each keeps its layerId)"],
                                    ["perLayer", "One file per layer", "A .geojson per layer, bundled into a .zip"],
                                    ["active", "Selected layer only", `Just "${activeLayer?.name ?? "the active layer"}" (${activeLayerFeatureCount} feature${activeLayerFeatureCount === 1 ? "" : "s"}), one .geojson`],
                                ] as const).map(([value, label, hint]) => (
                                    <div key={value} className="flex items-start gap-2">
                                        <RadioGroupItem value={value} id={`td-export-${value}`} className="cursor-pointer shrink-0 mt-0.5" />
                                        <Label htmlFor={`td-export-${value}`} className="cursor-pointer flex flex-col items-start text-left gap-0.5">
                                            <span className="text-xs font-medium">{label}</span>
                                            <span className="text-[11px] text-muted-foreground font-normal">{hint}</span>
                                        </Label>
                                    </div>
                                ))}
                            </RadioGroup>
                        </PopoverContent>
                    </Popover>
                </div>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={clearDrawings}
                                disabled={features.length === 0}
                                className="cursor-pointer shrink-0"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        }
                    />
                    <TooltipContent><p>Clear all vector drawings</p></TooltipContent>
                </Tooltip>
            </div>
            <input ref={fileInputRef} type="file" accept={VECTOR_FILE_ACCEPT} onChange={importFile} className="hidden" />
            {/* <input ref={fileInputRef} type="file" accept=".geojson,.json,.kml,.gpkg" onChange={importFile} className="hidden" /> */}
            {/* <input ref={fileInputRef} type="file" accept=".geojson,.json" onChange={importGeoJSON} className="hidden" /> */}
            <Dialog open={isUrlDialogOpen} onOpenChange={(open) => { if (!isImportingUrl) setIsUrlDialogOpen(open) }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Import from a URL</DialogTitle>
                        <DialogDescription>
                            GeoJSON, KML, GPX, FlatGeobuf or Shapefile (its .dbf and .prj are fetched alongside). Geometry and attributes only; the server must allow cross-origin requests.
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        autoFocus
                        value={importUrl}
                        onChange={(e) => setImportUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") importFromUrl() }}
                        placeholder="https://host/features.geojson"
                        className="cursor-text"
                        aria-label="URL of the vector data"
                    />
                    <div className="flex items-start gap-2">
                        <Checkbox id="td-url-keep" checked={keepInLink} onCheckedChange={(v) => setKeepInLink(v === true)} className="cursor-pointer mt-0.5" />
                        <Label htmlFor="td-url-keep" className="cursor-pointer flex flex-col items-start gap-0.5">
                            <span className="text-xs font-medium">Keep in the link</span>
                            <span className="text-[11px] text-muted-foreground font-normal">Adds <code>drawingUrl=</code> to the address bar so a shared link or iframe loads this data; the layer is re-fetched on every load instead of stored.</span>
                        </Label>
                    </div>
                    {importError && <p className="text-xs text-destructive">{importError}</p>}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setIsUrlDialogOpen(false)} disabled={isImportingUrl}>Cancel</Button>
                        <Button size="sm" className="cursor-pointer" onClick={importFromUrl} disabled={!importUrl.trim() || isImportingUrl}>
                            {isImportingUrl && <Loader2 className="h-4 w-4 animate-spin" />} Import
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            {importError && !isUrlDialogOpen && (
                <p className="text-xs text-destructive">{importError}</p>
            )}
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
