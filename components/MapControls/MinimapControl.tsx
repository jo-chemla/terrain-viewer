import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Map, { useMap, useControl } from 'react-map-gl/maplibre';
import { Minimize2, Map as MapIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MapRef, LngLatBoundsLike, ControlPosition } from 'react-map-gl/maplibre';
import type { Map as MapLibreMap, StyleSpecification, IControl } from 'maplibre-gl';

import * as turf from '@turf/turf';

// At the top of your file, define EPSG:3857 bounds
const EPSG3857_BOUNDS = {
  west: -180,
  south: -85.051129, // Web Mercator max latitude
  east: 180,
  north: 85.051129
};

interface MinimapControlProps {
  parentMap?: MapLibreMap;
  position?: ControlPosition;
  mode?: 'static' | 'dynamic';
  width?: number;
  height?: number;
  zoomLevelOffset?: number;
  initialMinimized?: boolean;
  initBounds?: LngLatBoundsLike;
  style?: string | StyleSpecification;
  
  footprintFillPaint?: {
    "fill-color"?: string;
    "fill-opacity"?: number;
    "fill-outline-color"?: string;
  };
  footprintLinePaint?: {
    "line-color"?: string;
    "line-width"?: number;
    "line-opacity"?: number;
    "line-dasharray"?: number[];
  };

  showFrustum?: boolean;
  frustumFillPaint?: {
    "fill-color"?: string;
    "fill-opacity"?: number;
  };
  frustumLinePaint?: {
    "line-color"?: string;
    "line-width"?: number;
    "line-opacity"?: number;
    "line-dasharray"?: number[];
  };

  interactive?: boolean;
  interactions?: {
    dragPan?: boolean;
    scrollZoom?: boolean;
    boxZoom?: boolean;
    dragRotate?: boolean;
    keyboard?: boolean;
    doubleClickZoom?: boolean;
    touchZoomRotate?: boolean;
  };
}

function MinimapInternal({
  parentMap: externalParentMap,
  mode = 'dynamic',
  width = 200,
  height = 150,
  zoomLevelOffset = -3,
  initialMinimized = false,
  initBounds,
  style,
  footprintFillPaint = {
    'fill-color': '#000',
    'fill-opacity': 0.05,
  },
  footprintLinePaint = {
    'line-color': '#000',
    'line-width': 1,
    'line-opacity': 0.3,
  },
  showFrustum = true,
  frustumFillPaint = {
    'fill-color': '#3b82f6',
    'fill-opacity': 0.1,
  },
  frustumLinePaint = {
    'line-color': '#3b82f6',
    'line-width': 2,
  },
  interactive = false,
  interactions = {}, 
  position = 'bottom-right',
}: MinimapControlProps) {
  const { current: internalParentMap } = useMap();
  const parentMap = externalParentMap || internalParentMap;
  
  const [minimized, setMinimized] = useState(initialMinimized);
  const [footprintData, setFootprintData] = useState<GeoJSON.Feature | null>(null);
  const [frustumData, setFrustumData] = useState<GeoJSON.Feature | null>(null);
  const [viewState, setViewState] = useState({
    longitude: 0,
    latitude: 0,
    zoom: 0,
    pitch: 0,
    bearing: 0
  });
  
  const minimapRef = useRef<MapRef>(null);
  const mapInstanceRef = useRef<MapLibreMap | null>(null);

  // Memoize base style to prevent recreation
  const baseStyle = useMemo(() => {
    if (typeof style === 'string') {
      return style;
    }
    return style || {
      version: 8,
      sources: {
        'basemap': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256
        }
      },
      layers: [
        {
          id: 'basemap-layer',
          type: 'raster',
          source: 'basemap'
        }
      ]
    };
  }, []); // Only create once

  const updateGeometries = useCallback(() => {
    if (!parentMap) return;

    // Calculate footprint (bounding box)
    try {
      const bounds = parentMap.getBounds();
      if (bounds) {
        const footprintCoords = [
          [bounds.getWest(), bounds.getSouth()],
          [bounds.getEast(), bounds.getSouth()],
          [bounds.getEast(), bounds.getNorth()],
          [bounds.getWest(), bounds.getNorth()],
          [bounds.getWest(), bounds.getSouth()]
        ];

        const newFootprint: GeoJSON.Feature = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [footprintCoords] }
        };

        setFootprintData(newFootprint);
      }
    } catch (e) {
      console.error('🗺️ Minimap: Error calculating footprint', e);
    }

    // Calculate frustum (perspective-correct trapezoid)
    // if (showFrustum) {
    //   try {
    //     const canvas = parentMap.getCanvas();
        
    //     // Get CSS pixel dimensions (what unproject expects)
    //     const containerWidth = canvas.clientWidth;
    //     const containerHeight = canvas.clientHeight;

    //     // Sample the four corners in CSS pixels
    //     const corners = [
    //       [0, containerHeight],              // Bottom-left
    //       [containerWidth, containerHeight], // Bottom-right  
    //       [containerWidth, 0],               // Top-right
    //       [0, 0]                             // Top-left
    //     ];

    //     const unprojectedCorners = corners.map(([x, y]) => parentMap.unproject([x, y]));

    //     // Check if all corners are valid (not above horizon)
    //     const allValid = unprojectedCorners.every(p => 
    //       p && isFinite(p.lng) && isFinite(p.lat) &&
    //       Math.abs(p.lng) <= 180 && Math.abs(p.lat) <= 90
    //     );

    //     if (allValid) {
    //       const frustumCoords = unprojectedCorners.map(p => [p.lng, p.lat]);
    //       frustumCoords.push(frustumCoords[0]); // Close the polygon

    //       const newFrustum: GeoJSON.Feature = {
    //         type: 'Feature',
    //         properties: {},
    //         geometry: { type: 'Polygon', coordinates: [frustumCoords] }
    //       };

    //       setFrustumData(newFrustum);
    //     } else {
    //       // At very high pitch, some corners might be above horizon
    //       setFrustumData(null);
    //     }
    //   } catch (e) {
    //     console.error('🗺️ Minimap: Error calculating frustum', e);
    //     setFrustumData(null);
    //   }
    // }

    // Simple validation using Turf.js
    function isValidPolygon(coords: number[][]): boolean {
      if (coords.length < 4) {
        console.warn('Polygon has too few points:', coords.length);
        return false;
      }
      
      try {
        const poly = turf.polygon([coords]);
        const kinks = turf.kinks(poly);
        if (kinks.features.length > 0) {
          console.warn('Polygon has', kinks.features.length, 'self-intersections');
          return false;
        }
        console.log('Polygon is valid');
        return true;
      } catch (e) {
        console.error('Polygon validation error:', e);
        return false;
      }
    }

    // Updated frustum calculation with detailed logging
    if (showFrustum) {
      try {
        const canvas = parentMap.getCanvas();
        const containerWidth = canvas.clientWidth;
        const containerHeight = canvas.clientHeight;
        const aspectRatio = containerWidth / containerHeight;

        console.log('🗺️ Calculating frustum, canvas:', { containerWidth, containerHeight, aspectRatio });

        const corners = [
          [0, containerHeight],              // Bottom-left
          [containerWidth, containerHeight], // Bottom-right  
          [containerWidth, 0],               // Top-right
          [0, 0]                             // Top-left
        ];

        const unprojectedCorners = corners.map(([x, y]) => parentMap.unproject([x, y]));
        
        console.log('📍 Unprojected corners:', unprojectedCorners);

        const allValid = unprojectedCorners.every(p => 
          p && isFinite(p.lng) && isFinite(p.lat) &&
          Math.abs(p.lng) <= 180 && Math.abs(p.lat) <= 85.051129
        );

        console.log('✅ All corners valid?', allValid);

        if (allValid) {
      const frustumCoords = unprojectedCorners.map(p => [p.lng, p.lat]);
      frustumCoords.push(frustumCoords[0]);

      if (isValidPolygon(frustumCoords)) {
        console.log('✨ Using normal frustum trapezoid');
        
        let frustumPolygon = turf.polygon([frustumCoords]);
          setFrustumData(frustumPolygon as GeoJSON.Feature);

      } else {
        console.warn('Invalid polygon, keeping previous frustum');
        // Don't update - preserves last good frustum
      }
    } 
      } catch (e) {
        console.error('Minimap frustum calculation error:', e);
        setFrustumData(null);
      }
    }

  }, [parentMap, showFrustum]);

  // Handle parent map movement
  useEffect(() => {
    if (!parentMap) return;

    const onMove = () => {
      const center = parentMap.getCenter();
      const zoom = parentMap.getZoom();
      
      if (mode === 'dynamic') {
        setViewState({
          longitude: center.lng,
          latitude: center.lat,
          zoom: zoom + zoomLevelOffset,
          pitch: 0,
          bearing: 0
        });
      }

      updateGeometries();
    };

    parentMap.on('move', onMove);
    
    // Initial update
    onMove();

    return () => {
      parentMap.off('move', onMove);
    };
  }, [parentMap, mode, zoomLevelOffset, updateGeometries]);

  // Static mode: initial bounds + update geometries when map loads
  useEffect(() => {
    if (mode === 'static' && minimapRef.current) {
      const miniMap = minimapRef.current.getMap();
      
      const onLoad = () => {
        if (initBounds) {
          miniMap.fitBounds(initBounds, { animate: false, padding: 10 });
        }
        // Trigger initial geometry calculation for static mode
        updateGeometries();
      };

      if (miniMap.loaded()) {
        onLoad();
      } else {
        miniMap.once('load', onLoad);
      }
    }
  }, [mode, initBounds, updateGeometries]);

  // Update sources when data changes
  useEffect(() => {
    if (!mapInstanceRef.current || !mapInstanceRef.current.loaded()) return;

    const map = mapInstanceRef.current;

    try {
      // Update footprint source
      if (map.getSource('footprint-source')) {
        const source = map.getSource('footprint-source') as any;
        if (footprintData) {
          source.setData(footprintData);
        }
      } else if (footprintData) {
        map.addSource('footprint-source', {
          type: 'geojson',
          data: footprintData
        });
        
        map.addLayer({
          id: 'footprint-fill',
          type: 'fill',
          source: 'footprint-source',
          paint: footprintFillPaint
        });
        
        map.addLayer({
          id: 'footprint-line',
          type: 'line',
          source: 'footprint-source',
          paint: footprintLinePaint
        });
      }

      // Update frustum source
      if (showFrustum) {
        if (map.getSource('frustum-source')) {
          const source = map.getSource('frustum-source') as any;
          if (frustumData) {
            source.setData(frustumData);
          }
        } else if (frustumData) {
          map.addSource('frustum-source', {
            type: 'geojson',
            data: frustumData
          });
          
          map.addLayer({
            id: 'frustum-fill',
            type: 'fill',
            source: 'frustum-source',
            paint: frustumFillPaint
          });
          
          map.addLayer({
            id: 'frustum-line',
            type: 'line',
            source: 'frustum-source',
            paint: frustumLinePaint
          });
        }
      }
    } catch (e) {
      console.error('Error updating minimap sources:', e);
    }
  }, [footprintData, frustumData, showFrustum, footprintFillPaint, footprintLinePaint, frustumFillPaint, frustumLinePaint]);

  const containerStyle = minimized ? {
    width: '40px',
    height: '40px'
  } : {
    width: `${width}px`,
    height: `${height}px`
  };

  const interactionProps = useMemo(() => {
    if (!interactive) {
      return {
        dragPan: false,
        scrollZoom: false,
        boxZoom: false,
        dragRotate: false,
        keyboard: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
      };
    }
    return {
      dragPan: interactions.dragPan ?? true,
      scrollZoom: interactions.scrollZoom ?? true,
      boxZoom: interactions.boxZoom ?? true,
      dragRotate: interactions.dragRotate ?? false,
      keyboard: interactions.keyboard ?? true,
      doubleClickZoom: interactions.doubleClickZoom ?? true,
      touchZoomRotate: interactions.touchZoomRotate ?? true,
    };
  }, [interactive, interactions]);

  const getButtonPositionClasses = (position: string) => {
    const positions = position.split("-");
    const vertical = positions[0] as "top" | "bottom";
    const horizontal = positions[1] as "left" | "right";
    
    const verticalClass = vertical === "top" ? "top-1" : "bottom-1";
    const horizontalClass = horizontal === "left" ? "left-1" : "right-1";
    
    return `${verticalClass} ${horizontalClass}`;
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border bg-background shadow-lg transition-all duration-300 ease-in-out group"
      )}
      style={containerStyle}
    >
      {minimized ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-full rounded-none hover:cursor-pointer"
          onClick={() => setMinimized(false)}
        >
          <MapIcon className="h-4 w-4" />
        </Button>
      ) : (
        <div className="relative h-full w-full group/minimap">
          <Map
            ref={minimapRef}
            {...viewState}
            mapStyle={baseStyle}
            attributionControl={false}
            {...interactionProps}
            onLoad={(e) => {
              mapInstanceRef.current = e.target;
            }}
            onMove={evt => {
              if (mode === 'static' && interactive) {
                setViewState(evt.viewState);
              }
            }}
          />

          <div className="minimap-ui">
            <Button
              className={cn(
                "absolute h-7 w-7 rounded-sm opacity-10 group-hover/minimap:opacity-100 transition-opacity z-50 shadow-md border bg-background/90 hover:bg-background/90 hover:opacity-100 hover:cursor-pointer",
                getButtonPositionClasses(position)
              )}
              onClick={(e) => {
                e.stopPropagation();
                setMinimized(true);
              }}
              variant="ghost"
            >
              <Minimize2 className="h-4 w-4 text-foreground" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

class MinimapControlImpl implements IControl {
  private _container: HTMLDivElement | null = null;
  private _onAdd: (container: HTMLDivElement) => void;
  private _onRemove: () => void;

  constructor(onAdd: (container: HTMLDivElement) => void, onRemove: () => void) {
    this._onAdd = onAdd;
    this._onRemove = onRemove;
  }

  onAdd(map: MapLibreMap) {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl !border-none !bg-transparent !shadow-none';
    this._onAdd(this._container);
    return this._container;
  }

  onRemove() {
    this._onRemove();
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
  }
}

export function MinimapControl(props: MinimapControlProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const { position = 'bottom-right' } = props;

  const controlCreator = useCallback(() => new MinimapControlImpl(
    (div) => setContainer(div),
    () => setContainer(null)
  ), []);

  useControl(controlCreator, { position });

  if (!container) return null;

  return createPortal(<MinimapInternal {...props} />, container);
}