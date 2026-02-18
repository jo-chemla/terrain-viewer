"use client"

import "geogrid-maplibre-gl/dist/geogrid.css"

import { useEffect, useRef, useCallback } from "react"
import { useMap } from "react-map-gl/maplibre"
import { GeoGrid } from "geogrid-maplibre-gl"

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

        gridRef.current = new GeoGrid(buildOptions(map))
        gridRef.current.add()
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