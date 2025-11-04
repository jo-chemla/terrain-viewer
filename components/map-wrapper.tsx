"use client"

import type React from "react"

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react"
import type { Map as MapLibreMap } from "maplibre-gl"

interface MapWrapperProps {
  initialViewState: {
    latitude: number
    longitude: number
    zoom: number
    pitch: number
    bearing: number
  }
  onMove?: (evt: any) => void
  maxPitch?: number
  pitchWithRotate?: boolean
  dragRotate?: boolean
  touchZoomRotate?: boolean
  terrain?: {
    source: string
    exaggeration: number
  }
  projection?: { type: string }
  children?: React.ReactNode
  style?: React.CSSProperties
}

export interface MapRef {
  getMap: () => MapLibreMap
  jumpTo: (options: any) => void
}

export const MapWrapper = forwardRef<MapRef, MapWrapperProps>(
  (
    {
      initialViewState,
      onMove,
      maxPitch = 85,
      pitchWithRotate = true,
      dragRotate = true,
      touchZoomRotate = true,
      terrain,
      projection,
      children,
      style,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<MapLibreMap | null>(null)
    const sourcesRef = useRef<Map<string, any>>(new Map())
    const layersRef = useRef<Set<string>>(new Set())

    useImperativeHandle(ref, () => ({
      getMap: () => mapRef.current!,
      jumpTo: (options: any) => {
        if (mapRef.current) {
          mapRef.current.jumpTo(options)
        }
      },
    }))

    // Initialize map
    useEffect(() => {
      if (!containerRef.current || mapRef.current || !(window as any).maplibregl) return

      const maplibregl = (window as any).maplibregl

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {},
          layers: [],
        },
        center: [initialViewState.longitude, initialViewState.latitude],
        zoom: initialViewState.zoom,
        pitch: initialViewState.pitch,
        bearing: initialViewState.bearing,
        maxPitch,
        pitchWithRotate,
        dragRotate,
        touchZoomRotate,
      })

      map.on("move", () => {
        if (onMove) {
          const center = map.getCenter()
          onMove({
            viewState: {
              latitude: center.lat,
              longitude: center.lng,
              zoom: map.getZoom(),
              pitch: map.getPitch(),
              bearing: map.getBearing(),
            },
          })
        }
      })

      mapRef.current = map

      return () => {
        map.remove()
        mapRef.current = null
      }
    }, [])

    // Update projection
    useEffect(() => {
      if (!mapRef.current) return
      if (projection?.type === "globe") {
        mapRef.current.setProjection({ type: "globe" })
      } else {
        mapRef.current.setProjection({ type: "mercator" })
      }
    }, [projection?.type])

    // Update terrain
    useEffect(() => {
      if (!mapRef.current) return

      if (terrain) {
        mapRef.current.setTerrain({
          source: terrain.source,
          exaggeration: terrain.exaggeration,
        })
      } else {
        mapRef.current.setTerrain(null)
      }
    }, [terrain])

    // Update interaction settings
    useEffect(() => {
      if (!mapRef.current) return

      if (pitchWithRotate) {
        mapRef.current.touchPitch.enable()
      } else {
        mapRef.current.touchPitch.disable()
      }

      if (dragRotate) {
        mapRef.current.dragRotate.enable()
      } else {
        mapRef.current.dragRotate.disable()
      }

      if (touchZoomRotate) {
        mapRef.current.touchZoomRotate.enable()
      } else {
        mapRef.current.touchZoomRotate.disable()
      }
    }, [pitchWithRotate, dragRotate, touchZoomRotate])

    return (
      <div ref={containerRef} style={{ width: "100%", height: "100%", ...style }}>
        {mapRef.current && children}
      </div>
    )
  },
)

MapWrapper.displayName = "MapWrapper"

// Source component
export function Source({ id, children, ...sourceConfig }: any) {
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    // Find the map instance from parent context
    const findMap = () => {
      const maps = document.querySelectorAll(".maplibregl-map")
      if (maps.length > 0) {
        return (maps[0] as any)._map || (maps[maps.length - 1] as any)._map
      }
      return null
    }

    const map = findMap()
    if (!map) return

    mapRef.current = map

    // Add or update source
    if (!map.getSource(id)) {
      map.addSource(id, sourceConfig)
    }

    return () => {
      // Cleanup handled by layers
    }
  }, [id, JSON.stringify(sourceConfig)])

  return <>{children}</>
}

// Layer component
export function Layer({ id, source, type, paint, layout, filter, ...props }: any) {
  useEffect(() => {
    const findMap = () => {
      const maps = document.querySelectorAll(".maplibregl-map")
      if (maps.length > 0) {
        return (maps[0] as any)._map || (maps[maps.length - 1] as any)._map
      }
      return null
    }

    const map = findMap()
    if (!map) return

    // Wait for source to be ready
    const checkSource = () => {
      if (!map.getSource(source)) {
        setTimeout(checkSource, 50)
        return
      }

      // Add or update layer
      if (!map.getLayer(id)) {
        map.addLayer({
          id,
          type,
          source,
          paint: paint || {},
          layout: layout || {},
          filter: filter,
          ...props,
        })
      } else {
        // Update paint properties
        if (paint) {
          Object.entries(paint).forEach(([key, value]) => {
            map.setPaintProperty(id, key, value)
          })
        }
        // Update layout properties
        if (layout) {
          Object.entries(layout).forEach(([key, value]) => {
            map.setLayoutProperty(id, key, value)
          })
        }
        // Update filter
        if (filter) {
          map.setFilter(id, filter)
        }
      }
    }

    checkSource()

    return () => {
      if (map.getLayer(id)) {
        map.removeLayer(id)
      }
    }
  }, [id, source, type, JSON.stringify(paint), JSON.stringify(layout), JSON.stringify(filter)])

  return null
}

// Navigation Control
export function NavigationControl({ position = "top-right" }: { position?: string }) {
  useEffect(() => {
    const findMap = () => {
      const maps = document.querySelectorAll(".maplibregl-map")
      if (maps.length > 0) {
        return (maps[0] as any)._map || (maps[maps.length - 1] as any)._map
      }
      return null
    }

    const map = findMap()
    if (!map || !(window as any).maplibregl) return

    const maplibregl = (window as any).maplibregl
    const nav = new maplibregl.NavigationControl()
    map.addControl(nav, position)

    return () => {
      map.removeControl(nav)
    }
  }, [position])

  return null
}

// Geolocate Control
export function GeolocateControl({ position = "top-right" }: { position?: string }) {
  useEffect(() => {
    const findMap = () => {
      const maps = document.querySelectorAll(".maplibregl-map")
      if (maps.length > 0) {
        return (maps[0] as any)._map || (maps[maps.length - 1] as any)._map
      }
      return null
    }

    const map = findMap()
    if (!map || !(window as any).maplibregl) return

    const maplibregl = (window as any).maplibregl
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
    })
    map.addControl(geolocate, position)

    return () => {
      map.removeControl(geolocate)
    }
  }, [position])

  return null
}
