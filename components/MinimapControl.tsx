import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MapLibreMap, LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import Map, { MapRef, Source, Layer } from "react-map-gl/maplibre";
import { Maximize2, Minimize2 } from "lucide-react";

type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Mode = "static" | "dynamic";

interface Props {
  parentMap?: MapLibreMap;
  position?: Position;
  mode?: Mode;
  width?: number;
  height?: number;
  zoomLevelOffset?: number;
  initialMinimized?: boolean;
  initBounds?: LngLatBoundsLike;
  style: StyleSpecification;
  // Standard MapLibre paint properties
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
  // Camera frustum
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

export function MinimapControl({
  parentMap,
  position = "bottom-right",
  mode = "dynamic",
  width = 260,
  height = 180,
  zoomLevelOffset = -4,
  initialMinimized = false,
  initBounds,
  style,
  footprintFillPaint = {
    "fill-color": "#3b82f6",
    "fill-opacity": 0.1,
  },
  footprintLinePaint = {
    "line-color": "#3b82f6",
    "line-width": 2,
    "line-opacity": 1,
  },
  showFrustum = false,
  frustumFillPaint = {
    "fill-color": "#f59e0b",
    "fill-opacity": 0.15,
  },
  frustumLinePaint = {
    "line-color": "#f59e0b",
    "line-width": 1.5,
    "line-opacity": 0.8,
    "line-dasharray": [2, 2],
  },
  interactive = false,
  interactions = {
    dragPan: true,
    scrollZoom: true,
    boxZoom: false,
    dragRotate: false,
    keyboard: false,
    doubleClickZoom: true,
    touchZoomRotate: true,
  },
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const miniRef = useRef<MapRef | null>(null);
  const [minimized, setMinimized] = useState(initialMinimized);
  const [boundsGeoJSON, setBoundsGeoJSON] = useState<any>(null);
  const [frustumGeoJSON, setFrustumGeoJSON] = useState<any>(null);
  const rafRef = useRef<number | null>(null);
  const isUpdatingRef = useRef(false);

  // Calculate button position based on control position
  const getButtonPosition = () => {
    const positions = position.split("-");
    const vertical = positions[0] as "top" | "bottom";
    const horizontal = positions[1] as "left" | "right";
    
    return {
      [vertical]: "4px",
      [horizontal]: "4px",
    };
  };

  // Calculate camera frustum geometry
  const calculateFrustum = (map: MapLibreMap) => {
    const center = map.getCenter();
    const bearing = (map.getBearing() * Math.PI) / 180;
    const pitch = (map.getPitch() * Math.PI) / 180;
    const zoom = map.getZoom();

    console.log("🎥 Frustum Calculation:", {
      center: { lng: center.lng, lat: center.lat },
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      zoom: zoom,
    });

    // Calculate frustum distance based on zoom and pitch
    const baseDistance = 0.8 * Math.pow(2, 8 - zoom);
    const pitchFactor = 1 + pitch * 1.5;
    
    // Front distance affected by pitch
    const frontDist = baseDistance * pitchFactor;
    const nearDist = baseDistance * 0.2;
    
    console.log("📏 Frustum Distances:", {
      baseDistance,
      pitchFactor,
      frontDist,
      nearDist,
    });
    
    // FOV angle for frustum width (approximate MapLibre's default ~53° horizontal FOV)
    const halfFOV = 0.46; // ~26.5 degrees in radians
    
    // Calculate frustum corners
    const leftAngle = bearing - halfFOV;
    const rightAngle = bearing + halfFOV;

    const offsetPoint = (angle: number, distance: number): [number, number] => {
      const dx = Math.sin(angle) * distance;
      const dy = Math.cos(angle) * distance;
      // Simple lat/lng approximation (works for small distances)
      return [
        center.lng + dx / Math.cos((center.lat * Math.PI) / 180),
        center.lat + dy,
      ];
    };

    // Create trapezoid shape (wider at far end due to perspective)
    const nearLeft = offsetPoint(leftAngle, nearDist);
    const nearRight = offsetPoint(rightAngle, nearDist);
    const farLeft = offsetPoint(leftAngle, frontDist);
    const farRight = offsetPoint(rightAngle, frontDist);

    const frustum = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[nearLeft, nearRight, farRight, farLeft, nearLeft]],
      },
    };

    console.log("📐 Frustum Polygon:", frustum);

    return frustum;
  };

  // Attach control container to MapLibre corner
  useEffect(() => {
    if (!parentMap) return;

    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    containerRef.current = container;

    const corner = parentMap.getContainer().querySelector(`.maplibregl-ctrl-${position}`);
    if (!corner) return;
    
    corner.appendChild(container);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      container.remove();
    };
  }, [parentMap, position]);

  // Sync minimap with parent map
  useEffect(() => {
    if (!miniRef.current || !parentMap || minimized) return;
    
    const mini = miniRef.current.getMap();

    const update = () => {
      // Prevent overlapping RAF calls
      if (isUpdatingRef.current) return;
      isUpdatingRef.current = true;

      // Cancel any pending RAF
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        try {
          const bounds = parentMap.getBounds();
          const west = bounds.getWest();
          const south = bounds.getSouth();
          const east = bounds.getEast();
          const north = bounds.getNorth();

          console.log("🗺️ Parent Map Bounds:", {
            west,
            south,
            east,
            north,
            width: east - west,
            height: north - south,
          });

          const coords = [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ];

          const boundsFeature = {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: coords,
            },
          };

          console.log("📦 Bounds GeoJSON:", boundsFeature);

          setBoundsGeoJSON(boundsFeature);

          // Calculate frustum if enabled
          if (showFrustum) {
            const frustum = calculateFrustum(parentMap);
            setFrustumGeoJSON(frustum);
          }

          // Update minimap view in dynamic mode
          if (mode === "dynamic") {
            const center = parentMap.getCenter();
            const zoom = parentMap.getZoom();
            console.log("🎯 Updating minimap:", {
              center: { lng: center.lng, lat: center.lat },
              zoom: zoom + zoomLevelOffset,
            });

            mini.jumpTo({
              center: center,
              zoom: zoom + zoomLevelOffset,
              bearing: 0,
              pitch: 0,
            });
          }
        } finally {
          isUpdatingRef.current = false;
        }
      });
    };

    // Listen to both move and pitch/bearing changes
    parentMap.on("move", update);
    if (showFrustum) {
      parentMap.on("pitch", update);
      parentMap.on("rotate", update);
    }
    
    // Initial update
    update();

    return () => {
      parentMap.off("move", update);
      if (showFrustum) {
        parentMap.off("pitch", update);
        parentMap.off("rotate", update);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      isUpdatingRef.current = false;
    };
  }, [parentMap, mode, zoomLevelOffset, minimized, showFrustum]);

  // Static mode initialization
  useEffect(() => {
    if (!miniRef.current || mode !== "static") return;
    const mini = miniRef.current.getMap();

    if (initBounds) {
      mini.fitBounds(initBounds, { animate: false });
    } else {
      mini.jumpTo({ center: [0, 20], zoom: 1.2 });
    }
  }, [mode, initBounds]);

  if (!containerRef.current) {
    return null;
  }

  return createPortal(
    <div style={{ position: "relative" }}>
      {!minimized && (
        <div
          style={{
            width,
            height,
            borderRadius: "4px",
            overflow: "hidden",
            position: "relative",
            backgroundColor: "transparent", // Ensure container is transparent
          }}
        >
          <Map
            ref={miniRef}
            mapLib={import("maplibre-gl")}
            initialViewState={{
              longitude: 0,
              latitude: 0,
              zoom: 1,
            }}
            interactive={interactive}
            dragPan={interactive && interactions.dragPan}
            scrollZoom={interactive && interactions.scrollZoom}
            boxZoom={interactive && interactions.boxZoom}
            dragRotate={interactive && interactions.dragRotate}
            keyboard={interactive && interactions.keyboard}
            doubleClickZoom={interactive && interactions.doubleClickZoom}
            touchZoomRotate={interactive && interactions.touchZoomRotate}
            attributionControl={false}
            style={{ width: "100%", height: "100%" }}
            mapStyle={style}
          >
            {/* Frustum layer (behind footprint) */}
            {showFrustum && frustumGeoJSON && (
              <Source id="frustum" type="geojson" data={structuredClone(frustumGeoJSON)}>
                <Layer id="frustum-fill" type="fill" paint={frustumFillPaint}/>
                <Layer id="frustum-line" type="line" paint={frustumLinePaint}/>
              </Source>
            )}

            {/* {showFrustum && frustumGeoJSON && (
              <Source id="frustum" type="geojson" data={frustumGeoJSON}>
                <Layer
                  id="frustum-fill"
                  type="fill"
                  paint={frustumFillPaint}
                />
                <Layer
                  id="frustum-line"
                  type="line"
                  paint={frustumLinePaint}
                />
              </Source>
            )} */}

            {/* Footprint layer */}
            {boundsGeoJSON && (
              <Source id="bounds" type="geojson" data={structuredClone(boundsGeoJSON)}>
                <Layer id="bounds-fill" type="fill" paint={footprintFillPaint}/>
                <Layer id="bounds-outline" type="line" paint={footprintLinePaint}/>
              </Source>
            )}

            {/* {boundsGeoJSON && (
              <Source id="bounds" type="geojson" data={boundsGeoJSON}>
                <Layer
                  id="bounds-fill"
                  type="fill"
                  paint={footprintFillPaint}
                />
                <Layer
                  id="bounds-outline"
                  type="line"
                  paint={footprintLinePaint}
                />
              </Source>
            )} */}
          </Map>

          {/* Collapse button positioned inside minimap - FIXED STYLING */}
          <button
            onClick={() => setMinimized(true)}
            style={{
              position: "absolute",
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "28px",
              borderRadius: "4px",
              border: "1px solid rgba(0, 0, 0, 0.1)",
              backgroundColor: "white",
              cursor: "pointer",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
              ...getButtonPosition(),
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f3f4f6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "white";
            }}
            aria-label="Minimize minimap"
          >
            <Minimize2 size={14} style={{ color: "#374151" }} />
          </button>
        </div>
      )}

      {minimized && (
        <button
          onClick={() => setMinimized(false)}
          className="maplibregl-ctrl-icon flex h-[29px] w-[29px] items-center justify-center hover:bg-accent"
          aria-label="Show minimap"
        >
          <Maximize2 size={14} style={{"margin": "auto"}} />
        </button>
      )}
    </div>,
    containerRef.current
  );
}