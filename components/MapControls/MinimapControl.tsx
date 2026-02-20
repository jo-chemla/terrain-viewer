// import { useEffect, useRef, useState } from "react";
// import { createPortal } from "react-dom";
// import type { Map as MapLibreMap, LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
// import Map, { MapRef, Source, Layer } from "react-map-gl/maplibre";
// import { Maximize2, Minimize2 } from "lucide-react";

// type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";
// type Mode = "static" | "dynamic";

// interface Props {
//   parentMap?: MapLibreMap;
//   position?: Position;
//   mode?: Mode;
//   width?: number;
//   height?: number;
//   zoomLevelOffset?: number;
//   initialMinimized?: boolean;
//   initBounds?: LngLatBoundsLike;
//   style: StyleSpecification;
//   // Standard MapLibre paint properties
//   footprintFillPaint?: {
//     "fill-color"?: string;
//     "fill-opacity"?: number;
//     "fill-outline-color"?: string;
//   };
//   footprintLinePaint?: {
//     "line-color"?: string;
//     "line-width"?: number;
//     "line-opacity"?: number;
//     "line-dasharray"?: number[];
//   };
//   // Camera frustum
//   showFrustum?: boolean;
//   frustumFillPaint?: {
//     "fill-color"?: string;
//     "fill-opacity"?: number;
//   };
//   frustumLinePaint?: {
//     "line-color"?: string;
//     "line-width"?: number;
//     "line-opacity"?: number;
//     "line-dasharray"?: number[];
//   };
//   // Interactions
//   interactive?: boolean;
//   interactions?: {
//     dragPan?: boolean;
//     scrollZoom?: boolean;
//     boxZoom?: boolean;
//     dragRotate?: boolean;
//     keyboard?: boolean;
//     doubleClickZoom?: boolean;
//     touchZoomRotate?: boolean;
//   };
// }

// export function MinimapControl({
//   parentMap,
//   position = "bottom-right",
//   mode = "dynamic",
//   width = 260,
//   height = 180,
//   zoomLevelOffset = -4,
//   initialMinimized = false,
//   initBounds,
//   style,
//   footprintFillPaint = {
//     "fill-color": "#3b82f6",
//     "fill-opacity": 0.1,
//   },
//   footprintLinePaint = {
//     "line-color": "#3b82f6",
//     "line-width": 2,
//     "line-opacity": 1,
//   },
//   showFrustum = false,
//   frustumFillPaint = {
//     "fill-color": "#f59e0b",
//     "fill-opacity": 0.15,
//   },
//   frustumLinePaint = {
//     "line-color": "#f59e0b",
//     "line-width": 1.5,
//     "line-opacity": 0.8,
//     "line-dasharray": [2, 2],
//   },
//   interactive = false,
//   interactions = {
//     dragPan: true,
//     scrollZoom: true,
//     boxZoom: false,
//     dragRotate: false,
//     keyboard: false,
//     doubleClickZoom: true,
//     touchZoomRotate: true,
//   },
// }: Props) {
//   const containerRef = useRef<HTMLDivElement | null>(null);
//   const miniRef = useRef<MapRef | null>(null);
//   const [minimized, setMinimized] = useState(initialMinimized);
//   const [boundsGeoJSON, setBoundsGeoJSON] = useState<any>(null);
//   const [frustumGeoJSON, setFrustumGeoJSON] = useState<any>(null);
//   const rafRef = useRef<number | null>(null);
//   const isUpdatingRef = useRef(false);

//   // Calculate button position based on control position
//   const getButtonPosition = () => {
//     const positions = position.split("-");
//     const vertical = positions[0] as "top" | "bottom";
//     const horizontal = positions[1] as "left" | "right";
    
//     return {
//       [vertical]: "4px",
//       [horizontal]: "4px",
//     };
//   };

//   // Calculate camera frustum geometry
//   const calculateFrustum = (map: MapLibreMap) => {
//     const center = map.getCenter();
//     const bearing = (map.getBearing() * Math.PI) / 180;
//     const pitch = (map.getPitch() * Math.PI) / 180;
//     const zoom = map.getZoom();

//     console.log("🎥 Frustum Calculation:", {
//       center: { lng: center.lng, lat: center.lat },
//       bearing: map.getBearing(),
//       pitch: map.getPitch(),
//       zoom: zoom,
//     });

//     // Calculate frustum distance based on zoom and pitch
//     const baseDistance = 0.8 * Math.pow(2, 8 - zoom);
//     const pitchFactor = 1 + pitch * 1.5;
    
//     // Front distance affected by pitch
//     const frontDist = baseDistance * pitchFactor;
//     const nearDist = baseDistance * 0.2;
    
//     console.log("📏 Frustum Distances:", {
//       baseDistance,
//       pitchFactor,
//       frontDist,
//       nearDist,
//     });
    
//     // FOV angle for frustum width (approximate MapLibre's default ~53° horizontal FOV)
//     const halfFOV = 0.46; // ~26.5 degrees in radians
    
//     // Calculate frustum corners
//     const leftAngle = bearing - halfFOV;
//     const rightAngle = bearing + halfFOV;

//     const offsetPoint = (angle: number, distance: number): [number, number] => {
//       const dx = Math.sin(angle) * distance;
//       const dy = Math.cos(angle) * distance;
//       // Simple lat/lng approximation (works for small distances)
//       return [
//         center.lng + dx / Math.cos((center.lat * Math.PI) / 180),
//         center.lat + dy,
//       ];
//     };

//     // Create trapezoid shape (wider at far end due to perspective)
//     const nearLeft = offsetPoint(leftAngle, nearDist);
//     const nearRight = offsetPoint(rightAngle, nearDist);
//     const farLeft = offsetPoint(leftAngle, frontDist);
//     const farRight = offsetPoint(rightAngle, frontDist);

//     const frustum = {
//       type: "Feature",
//       geometry: {
//         type: "Polygon",
//         coordinates: [[nearLeft, nearRight, farRight, farLeft, nearLeft]],
//       },
//     };

//     console.log("📐 Frustum Polygon:", frustum);

//     return frustum;
//   };

//   // Attach control container to MapLibre corner
//   useEffect(() => {
//     if (!parentMap) return;

//     const container = document.createElement("div");
//     container.className = "maplibregl-ctrl maplibregl-ctrl-group";
//     containerRef.current = container;

//     const corner = parentMap.getContainer().querySelector(`.maplibregl-ctrl-${position}`);
//     if (!corner) return;
    
//     corner.appendChild(container);

//     return () => {
//       if (rafRef.current) cancelAnimationFrame(rafRef.current);
//       container.remove();
//     };
//   }, [parentMap, position]);

//   // Sync minimap with parent map
//   useEffect(() => {
//     if (!miniRef.current || !parentMap || minimized) return;
    
//     const mini = miniRef.current.getMap();

//     const update = () => {
//       // Prevent overlapping RAF calls
//       if (isUpdatingRef.current) return;
//       isUpdatingRef.current = true;

//       // Cancel any pending RAF
//       if (rafRef.current) {
//         cancelAnimationFrame(rafRef.current);
//       }

//       rafRef.current = requestAnimationFrame(() => {
//         try {
//           const bounds = parentMap.getBounds();
//           const west = bounds.getWest();
//           const south = bounds.getSouth();
//           const east = bounds.getEast();
//           const north = bounds.getNorth();

//           console.log("🗺️ Parent Map Bounds:", {
//             west,
//             south,
//             east,
//             north,
//             width: east - west,
//             height: north - south,
//           });

//           const coords = [
//             [
//               [west, south],
//               [east, south],
//               [east, north],
//               [west, north],
//               [west, south],
//             ],
//           ];

//           const boundsFeature = {
//             type: "Feature",
//             geometry: {
//               type: "Polygon",
//               coordinates: coords,
//             },
//           };

//           console.log("📦 Bounds GeoJSON:", boundsFeature);

//           setBoundsGeoJSON(boundsFeature);

//           // Calculate frustum if enabled
//           if (showFrustum) {
//             const frustum = calculateFrustum(parentMap);
//             setFrustumGeoJSON(frustum);
//           }

//           // Update minimap view in dynamic mode
//           if (mode === "dynamic") {
//             const center = parentMap.getCenter();
//             const zoom = parentMap.getZoom();
//             console.log("🎯 Updating minimap:", {
//               center: { lng: center.lng, lat: center.lat },
//               zoom: zoom + zoomLevelOffset,
//             });

//             mini.jumpTo({
//               center: center,
//               zoom: zoom + zoomLevelOffset,
//               bearing: 0,
//               pitch: 0,
//             });
//           }
//         } finally {
//           isUpdatingRef.current = false;
//         }
//       });
//     };

//     // Listen to both move and pitch/bearing changes
//     parentMap.on("move", update);
//     if (showFrustum) {
//       parentMap.on("pitch", update);
//       parentMap.on("rotate", update);
//     }
    
//     // Initial update
//     update();

//     return () => {
//       parentMap.off("move", update);
//       if (showFrustum) {
//         parentMap.off("pitch", update);
//         parentMap.off("rotate", update);
//       }
//       if (rafRef.current) {
//         cancelAnimationFrame(rafRef.current);
//       }
//       isUpdatingRef.current = false;
//     };
//   }, [parentMap, mode, zoomLevelOffset, minimized, showFrustum]);

//   // Static mode initialization
//   useEffect(() => {
//     if (!miniRef.current || mode !== "static") return;
//     const mini = miniRef.current.getMap();

//     if (initBounds) {
//       mini.fitBounds(initBounds, { animate: false });
//     } else {
//       mini.jumpTo({ center: [0, 20], zoom: 1.2 });
//     }
//   }, [mode, initBounds]);

//   if (!containerRef.current) {
//     return null;
//   }

//   return createPortal(
//     <div style={{ position: "relative" }}>
//       {!minimized && (
//         <div
//           style={{
//             width,
//             height,
//             borderRadius: "4px",
//             overflow: "hidden",
//             position: "relative",
//             backgroundColor: "transparent", // Ensure container is transparent
//           }}
//         >
//           <Map
//             ref={miniRef}
//             mapLib={import("maplibre-gl")}
//             initialViewState={{
//               longitude: 0,
//               latitude: 0,
//               zoom: 1,
//             }}
//             interactive={interactive}
//             dragPan={interactive && interactions.dragPan}
//             scrollZoom={interactive && interactions.scrollZoom}
//             boxZoom={interactive && interactions.boxZoom}
//             dragRotate={interactive && interactions.dragRotate}
//             keyboard={interactive && interactions.keyboard}
//             doubleClickZoom={interactive && interactions.doubleClickZoom}
//             touchZoomRotate={interactive && interactions.touchZoomRotate}
//             attributionControl={false}
//             style={{ width: "100%", height: "100%" }}
//             mapStyle={style}
//           >
//             {/* Frustum layer (behind footprint) */}
//             {showFrustum && frustumGeoJSON && (
//               <Source id="frustum" type="geojson" data={structuredClone(frustumGeoJSON)}>
//                 <Layer id="frustum-fill" type="fill" paint={frustumFillPaint}/>
//                 <Layer id="frustum-line" type="line" paint={frustumLinePaint}/>
//               </Source>
//             )}

//             {/* {showFrustum && frustumGeoJSON && (
//               <Source id="frustum" type="geojson" data={frustumGeoJSON}>
//                 <Layer
//                   id="frustum-fill"
//                   type="fill"
//                   paint={frustumFillPaint}
//                 />
//                 <Layer
//                   id="frustum-line"
//                   type="line"
//                   paint={frustumLinePaint}
//                 />
//               </Source>
//             )} */}

//             {/* Footprint layer */}
//             {boundsGeoJSON && (
//               <Source id="bounds" type="geojson" data={structuredClone(boundsGeoJSON)}>
//                 <Layer id="bounds-fill" type="fill" paint={footprintFillPaint}/>
//                 <Layer id="bounds-outline" type="line" paint={footprintLinePaint}/>
//               </Source>
//             )}

//             {/* {boundsGeoJSON && (
//               <Source id="bounds" type="geojson" data={boundsGeoJSON}>
//                 <Layer
//                   id="bounds-fill"
//                   type="fill"
//                   paint={footprintFillPaint}
//                 />
//                 <Layer
//                   id="bounds-outline"
//                   type="line"
//                   paint={footprintLinePaint}
//                 />
//               </Source>
//             )} */}
//           </Map>

//           {/* Collapse button positioned inside minimap - FIXED STYLING */}
//           <button
//             onClick={() => setMinimized(true)}
//             style={{
//               position: "absolute",
//               zIndex: 10,
//               display: "flex",
//               alignItems: "center",
//               justifyContent: "center",
//               width: "28px",
//               height: "28px",
//               borderRadius: "4px",
//               border: "1px solid rgba(0, 0, 0, 0.1)",
//               backgroundColor: "white",
//               cursor: "pointer",
//               boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
//               ...getButtonPosition(),
//             }}
//             onMouseEnter={(e) => {
//               e.currentTarget.style.backgroundColor = "#f3f4f6";
//             }}
//             onMouseLeave={(e) => {
//               e.currentTarget.style.backgroundColor = "white";
//             }}
//             aria-label="Minimize minimap"
//           >
//             <Minimize2 size={14} style={{ color: "#374151" }} />
//           </button>
//         </div>
//       )}

//       {minimized && (
//         <button
//           onClick={() => setMinimized(false)}
//           className="maplibregl-ctrl-icon flex h-[29px] w-[29px] items-center justify-center hover:bg-accent"
//           aria-label="Show minimap"
//         >
//           <Maximize2 size={14} style={{"margin": "auto"}} />
//         </button>
//       )}
//     </div>,
//     containerRef.current
//   );
// }


import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Map, { useMap, Source, Layer, useControl } from 'react-map-gl/maplibre';
import { Minimize2, Map as MapIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MapRef, LngLatBoundsLike, ControlPosition } from 'react-map-gl/maplibre';
import type { Map as MapLibreMap, StyleSpecification, IControl } from 'maplibre-gl';

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
  
  // Footprint styling (Rectangular area)
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

  // Frustum styling (Perspective trapezoid)
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

  // Interactions
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
  footprintFillPaint,
  footprintLinePaint,
  showFrustum = true,
  frustumFillPaint,
  frustumLinePaint,
  interactive = false,
  interactions = {}, 
  position = 'bottom-right',
}: MinimapControlProps) {
  const { current: internalParentMap } = useMap();
  const parentMap = externalParentMap || internalParentMap;
  
  const [minimized, setMinimized] = useState(initialMinimized);
  const [footprintData, setFootprintData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [frustumData, setFrustumData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [viewState, setViewState] = useState({
    longitude: 0,
    latitude: 0,
    zoom: 0,
    pitch: 0,
    bearing: 0
  });
  
  const minimapRef = useRef<MapRef>(null);

  useEffect(() => {
    if (!parentMap || mode === 'static') return;

    const onMove = () => {
      const center = parentMap.getCenter();
      const zoom = parentMap.getZoom();
      
      const newViewState = {
        longitude: center.lng,
        latitude: center.lat,
        zoom: zoom + zoomLevelOffset,
        pitch: 0,
        bearing: 0
      };
      
      setViewState(newViewState);

      // 1. Calculate rectangular footprint (bounding box)
      try {
        const bounds = parentMap.getBounds();
        if (bounds) {
          // CCW: BL, BR, TR, TL, BL
          const footprintCoords = [
            [bounds.getWest(), bounds.getSouth()],
            [bounds.getEast(), bounds.getSouth()],
            [bounds.getEast(), bounds.getNorth()],
            [bounds.getWest(), bounds.getNorth()],
            [bounds.getWest(), bounds.getSouth()]
          ];

          const newFootprint: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Polygon', coordinates: [footprintCoords] }
            }]
          };
          console.log("📦 Bounds GeoJSON:", newFootprint);

          setFootprintData(newFootprint);
        }
      } catch (e) {
        console.error('🗺️ Minimap: Error calculating footprint', e);
      }

      // 2. Calculate perspective frustum (trapezoid)
      try {
        const canvas = parentMap.getCanvas();
        const w = canvas.width / window.devicePixelRatio;
        const h = canvas.height / window.devicePixelRatio;

        // Try to unproject corners. When pitched, top corners might be above horizon (null)
        // Order for CCW: BL, BR, TR, TL, BL
        const p1 = parentMap.unproject([0, h]); // BL
        const p2 = parentMap.unproject([w, h]); // BR
        const p3 = parentMap.unproject([w, 0]); // TR
        const p4 = parentMap.unproject([0, 0]); // TL

        if (p1 && p2 && p3 && p4) {
          const frustumCoords = [
            [p1.lng, p1.lat],
            [p2.lng, p2.lat],
            [p3.lng, p3.lat],
            [p4.lng, p4.lat],
            [p1.lng, p1.lat]
          ];

          const newFrustum: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Polygon', coordinates: [frustumCoords] }
            }]
          };

    console.log("📏 Frustum:", newFrustum);
          setFrustumData(newFrustum);
        } else {
          // If top corners are above horizon, we might want to approximate or just not show
          setFrustumData(null);
        }
      } catch (e) {
        console.error('🗺️ Minimap: Error calculating frustum', e);
      }
    };

    parentMap.on('move', onMove);
    onMove();

    return () => {
      parentMap.off('move', onMove);
    };
  }, [parentMap, mode, zoomLevelOffset]);

  useEffect(() => {
    if (mode === 'static' && initBounds && minimapRef.current) {
      minimapRef.current.fitBounds(initBounds, { animate: false, padding: 10 });
    }
  }, [mode, initBounds]);

  const containerStyle = minimized ? {
    width: '40px',
    height: '40px'
  } : {
    width: `${width}px`,
    height: `${height}px`
  };

  // Interactions logic - only applies when interactive is true
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

  // Use variables for source/layer props to avoid JSX property injection errors
  const footprintSourceProps = useMemo(() => ({
    id: 'footprint-source',
    type: 'geojson' as const,
    data: footprintData || { type: 'FeatureCollection' as const, features: [] }
  }), [footprintData]);

  const frustumSourceProps = useMemo(() => ({
    id: 'frustum-source',
    type: 'geojson' as const,
    data: frustumData || { type: 'FeatureCollection' as const, features: [] }
  }), [frustumData]);

  const footprintFillLayerProps = useMemo(() => ({
    id: 'footprint-fill',
    type: 'fill' as const,
    paint: {
      'fill-color': '#000',
      'fill-opacity': 0.05,
      ...footprintFillPaint
    }
  }), [footprintFillPaint]);

  const footprintLineLayerProps = useMemo(() => ({
    id: 'footprint-line',
    type: 'line' as const,
    paint: {
      'line-color': '#000',
      'line-width': 1,
      'line-opacity': 0.3,
      ...footprintLinePaint
    }
  }), [footprintLinePaint]);

  const frustumFillLayerProps = useMemo(() => ({
    id: 'frustum-fill',
    type: 'fill' as const,
    paint: {
      'fill-color': '#3b82f6',
      'fill-opacity': 0.1,
      ...frustumFillPaint
    }
  }), [frustumFillPaint]);

  const frustumLineLayerProps = useMemo(() => ({
    id: 'frustum-line',
    type: 'line' as const,
    paint: {
      'line-color': '#3b82f6',
      'line-width': 2,
      ...frustumLinePaint
    }
  }), [frustumLinePaint]);

  // Returns Tailwind classes for button positioning based on maplibre control position
  const getButtonPositionClasses = (position: string) => {
    const positions = position.split("-");
    const vertical = positions[0] as "top" | "bottom";
    const horizontal = positions[1] as "left" | "right";
    
    const verticalClass = vertical === "top" ? "top-1" : "bottom-1";
    const horizontalClass = horizontal === "left" ? "left-1" : "right-1";
    
    return `${verticalClass} ${horizontalClass}`;
  };

  console.log('🔍 Minimap Render:', {
    minimized,
    containerStyle,
    position,
    interactionProps, 
    frustumData,  
    footprintData,
    frustumSourceProps, 
    footprintSourceProps
  });

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
          className="h-full w-full rounded-none hover:cursor-pointer "
          onClick={() => setMinimized(false)}
        >
          <MapIcon className="h-4 w-4" />
        </Button>
      ) : (
        <div className="relative h-full w-full group/minimap">
          <Map
            ref={minimapRef}
            {...viewState}
            mapStyle={style || "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"}
            attributionControl={false}
            {...interactionProps}
            onMove={evt => {
              if (mode === 'static' && interactive) setViewState(evt.viewState);
            }}
          >
            {footprintData && (
              <Source {...footprintSourceProps}>
                <Layer {...footprintFillLayerProps} />
                <Layer {...footprintLineLayerProps} />
              </Source>
            )}

            {showFrustum && frustumData && (
              <Source {...frustumSourceProps}>
                <Layer {...frustumFillLayerProps} />
                <Layer {...frustumLineLayerProps} />
              </Source>
            )}
          </Map>
<div className="minimap-ui">

          <Button
            className={cn(
              "absolute h-7 w-7 rounded-sm opacity-10 group-hover/minimap:opacity-100 transition-opacity z-50 shadow-md border bg-background/90 hover:bg-background/90 hover:opacity-100 hover:cursor-pointer",
              getButtonPositionClasses(position) // e.g., "bottom-1 left-1"
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
