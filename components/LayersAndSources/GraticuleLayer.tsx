"use client"

import "geogrid-maplibre-gl/dist/geogrid.css"

import { useEffect, useRef, useCallback } from "react"
import { useMap } from "react-map-gl/maplibre"
import { GeoGrid } from "geogrid-maplibre-gl"

// Auto density snapped to the intervals a map reader expects. geogrid's own
// per-zoom table sets the coverage (4-8 lines across the view) but lands on
// 7.5 deg, 0.75 deg, 0.075 deg and the like, which no graticule uses. Each of
// its values is snapped to the nearest (in log space) whole number of
// degrees, or round number of arc-minutes or arc-seconds, halving and
// quartering the way survey grids do; past its table the spacing halves.
const NICE_DEGREES = [
    45, 30, 20, 15, 10, 5, 2, 1,
    30 / 60, 20 / 60, 15 / 60, 10 / 60, 5 / 60, 2 / 60, 1 / 60,
    30 / 3600, 20 / 3600, 15 / 3600, 10 / 3600, 5 / 3600, 2 / 3600, 1 / 3600,
]
const GEOGRID_DENSITY: Record<number, number> = { 0: 30, 1: 15, 2: 10, 3: 7.5, 4: 5, 5: 3, 6: 2, 7: 1.5, 8: 0.75, 9: 0.5, 10: 0.25, 11: 0.125, 12: 0.075, 13: 0.05, 14: 0.025 }
export function niceGraticuleDensity(zoom: number): number {
    const z = Math.max(0, Math.floor(zoom))
    const raw = z <= 14 ? GEOGRID_DENSITY[z] : GEOGRID_DENSITY[14] / 2 ** (z - 14)
    let best = NICE_DEGREES[0], bestD = Infinity
    for (const d of NICE_DEGREES) {
        const dist = Math.abs(Math.log(d / raw))
        if (dist < bestD - 1e-9) { best = d; bestD = dist }
    }
    return best
}

export interface GraticuleLayerProps {
    showGraticules: boolean
    graticuleColor?: string
    graticuleWidth?: number
    showLabels?: boolean
    dasharray?: number[]
    gridDensity?: number | ((zoom: number) => number)
    zoomLevelRange?: [number, number]
    labelFontSize?: string
    labelColor?: string
    labelTextShadow?: string
    labelFontFamily?: string
    beforeLayerId?: string
}

const PLUGIN_PREFIX = "geogrid"
const PARALLELS_LAYER = `${PLUGIN_PREFIX}_parallers`
const MERIDIANS_LAYER = `${PLUGIN_PREFIX}_meridians`
const PARALLELS_SOURCE = `${PLUGIN_PREFIX}_parallers_source`
const MERIDIANS_SOURCE = `${PLUGIN_PREFIX}_meridians_source`
const LABELS_CLASS = PLUGIN_PREFIX

function hardRemove(map: any) {
    for (const id of [PARALLELS_LAYER, MERIDIANS_LAYER]) {
        try { if (map.getLayer(id)) map.removeLayer(id) } catch { /* ignore */ }
    }
    for (const id of [PARALLELS_SOURCE, MERIDIANS_SOURCE]) {
        try { if (map.getSource(id)) map.removeSource(id) } catch { /* ignore */ }
    }
    const container = map.getContainer()
    container.querySelectorAll(`.${LABELS_CLASS}`).forEach((el: Element) => {
        try { container.removeChild(el) } catch { /* ignore */ }
    })
}

export function GraticuleLayer({
    showGraticules,
    graticuleColor = "#333333",
    graticuleWidth = 1,
    showLabels = true,
    dasharray,
    gridDensity,
    zoomLevelRange = [0, 20],
    labelFontSize = "12px",
    labelColor,
    labelTextShadow = [
        '-1px -1px 0 #fff', '1px -1px 0 #fff',
        '-1px 1px 0 #fff', '1px 1px 0 #fff',
        '-2px 0 0 #fff', '2px 0 0 #fff',
        '0 -2px 0 #fff', '0 2px 0 #fff',
    ].join(', '),
    labelFontFamily,
    beforeLayerId,
}: GraticuleLayerProps) {
    const { current: mapRef } = useMap()
    const gridRef = useRef<GeoGrid | null>(null)
    // Guards against stacking multiple styledata retry listeners while waiting
    // for the beforeId slot layer to appear (see updateGrid).
    const pendingRetryRef = useRef(false)

    const resolvedLabelColor = labelColor ?? graticuleColor

    const propsRef = useRef({
        showGraticules, graticuleColor, resolvedLabelColor,
        graticuleWidth, showLabels, dasharray, gridDensity,
        zoomLevelRange, labelFontSize, labelTextShadow,
        labelFontFamily, beforeLayerId,
    })
    propsRef.current = {
        showGraticules, graticuleColor, resolvedLabelColor,
        graticuleWidth, showLabels, dasharray, gridDensity,
        zoomLevelRange, labelFontSize, labelTextShadow,
        labelFontFamily, beforeLayerId,
    }

    const buildOptions = (map: any) => {
        const p = propsRef.current
        const gridStyle: any = { color: p.graticuleColor, width: p.graticuleWidth }
        if (p.dasharray?.length) gridStyle.dasharray = p.dasharray

        const labelStyle: any = {
            color: p.resolvedLabelColor,
            fontSize: p.labelFontSize,
            padding: '2px',
            textShadow: p.labelTextShadow,
            ...(p.labelFontFamily ? { fontFamily: p.labelFontFamily } : {}),
        }

        const opts: any = {
            map,
            gridStyle,
            labelStyle,
            zoomLevelRange: p.zoomLevelRange,
            formatLabels: p.showLabels ? undefined : () => "",
        }

        if (p.beforeLayerId) opts.beforeLayerId = p.beforeLayerId

        if (p.gridDensity !== undefined && p.gridDensity !== 0) {
            opts.gridDensity = typeof p.gridDensity === "number"
                ? (_z: number) => p.gridDensity as number
                : p.gridDensity
        } else {
            opts.gridDensity = niceGraticuleDensity
        }

        return opts
    }

    const updateGrid = useCallback((map: any) => {
        if (gridRef.current) {
            try { gridRef.current.remove() } catch { /* ignore */ }
            gridRef.current = null
        }
        hardRemove(map)

        if (!propsRef.current.showGraticules) return

        // geogrid-maplibre-gl inserts its layers `beforeId` this slot. On a fresh
        // load LayerOrderSlots (MapLayers.tsx) may not have committed slot-contours
        // to the style yet, so add() — including geogrid's OWN deferred styledata
        // re-add — throws "Cannot add layer … before non-existing layer …". Wait
        // (once, guarded against listener pileup) for the slot to actually exist
        // before creating the grid at all; the next styledata re-runs this.
        const beforeId = propsRef.current.beforeLayerId
        if (beforeId && !map.getLayer(beforeId)) {
            if (!pendingRetryRef.current) {
                pendingRetryRef.current = true
                map.once("styledata", () => { pendingRetryRef.current = false; updateGrid(map) })
            }
            return
        }

        gridRef.current = new GeoGrid(buildOptions(map))
        try { gridRef.current.add() } catch { /* transient; a later updateGrid re-adds */ }
    }, [showGraticules])

    useEffect(() => {
        if (!mapRef) return
        const map = mapRef.getMap()
        if (!map.isStyleLoaded()) return
        updateGrid(map)
    }, [
        showGraticules,
        graticuleColor,
        resolvedLabelColor,
        graticuleWidth,
        showLabels,
        JSON.stringify(dasharray),
        gridDensity,
        JSON.stringify(zoomLevelRange),
        labelFontSize,
        labelTextShadow,
        labelFontFamily,
        beforeLayerId,
        updateGrid,
    ])

    useEffect(() => {
        if (!mapRef) return
        const map = mapRef.getMap()

        const init = () => updateGrid(map)

        if (map.isStyleLoaded()) init()
        else map.once("styledata", init)

        return () => {
            map.off("styledata", init)
            if (gridRef.current) {
                try { gridRef.current.remove() } catch { /* ignore */ }
                gridRef.current = null
            }
            hardRemove(map)
        }
    }, [mapRef, updateGrid])

    return null
}