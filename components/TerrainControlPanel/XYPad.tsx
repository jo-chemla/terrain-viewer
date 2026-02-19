import { useState, useRef, useEffect } from "react";

interface SphericalXYPadProps {
  width: number;
  height: number;
  margin?: number;
  pillRadius?: number;
  value?: { azimuthDeg: number; elevationDeg: number }; // degrees
  onChange?: (val: { azimuthDeg: number; elevationDeg: number }) => void;
  showCardinalDirections?: boolean;
  azimuthRange?: [number, number]; // e.g., [-180, 180] or [0, 360]
  elevationRange?: [number, number]; // e.g., [1, 90] in degrees
}

export function SphericalXYPad({
  width,
  height,
  margin = 12,
  pillRadius = 12,
  value = { azimuthDeg: 0, elevationDeg: 45 },
  onChange,
  showCardinalDirections = true,
  azimuthRange = [0, 360],
  elevationRange = [0, 90],
}: SphericalXYPadProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [minElevationDeg, maxElevationDeg] = elevationRange;

  // Normalize azimuth to the specified range
  const normalizeAzimuth = (deg: number): number => {
    const [min, max] = azimuthRange;
    const range = max - min;
    let normalized = deg;
    
    while (normalized < min) normalized += range;
    while (normalized >= max) normalized -= range;
    
    return normalized;
  };

  // Convert degrees -> x/y on unit circle
  // Azimuth: 0° = North (top), 90° = East (right), 180° = South (bottom), 270° = West (left)
  const degToXY = ({ azimuthDeg, elevationDeg }: { azimuthDeg: number; elevationDeg: number }) => {
    // Normalize azimuth to [0, 360) for internal calculations
    let normalizedAz = azimuthDeg;
    if (azimuthRange[0] === -180) {
      // If input is in [-180, 180], convert to [0, 360]
      normalizedAz = azimuthDeg < 0 ? azimuthDeg + 360 : azimuthDeg;
    }
    
    // Standard compass: 0° is North (top), rotating clockwise
    // Convert to math coordinates: rotate by 90° so 0° points up
    const az = ((90 - normalizedAz) * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const r = Math.cos(el); // project onto xy-plane
    return { x: r * Math.cos(az), y: -r * Math.sin(az) }; // negate y to flip vertical axis
  };

  // Convert x/y -> degrees
  // x=0, y=-1 (top) should be 0° (North)
  // x=1, y=0 (right) should be 90° (East)
  const xyToDeg = (x: number, y: number) => {
    const r = Math.sqrt(x * x + y * y);
    // atan2 with negated y to account for screen coordinates
    const mathAngle = Math.atan2(-y, x);
    // Convert from math angle (0° = right) to compass azimuth (0° = up/north)
    let azimuthDeg = 90 - (mathAngle * 180) / Math.PI;
    // Normalize to [0, 360)
    while (azimuthDeg < 0) azimuthDeg += 360;
    while (azimuthDeg >= 360) azimuthDeg -= 360;
    
    // Convert to requested range
    azimuthDeg = normalizeAzimuth(azimuthDeg);
    
    // Calculate elevation and clamp to range
    const elevation = Math.acos(Math.min(r, 1));
    let elevationDeg = (elevation * 180) / Math.PI;
    elevationDeg = Math.max(minElevationDeg, Math.min(maxElevationDeg, elevationDeg));
    
    return { azimuthDeg, elevationDeg };
  };

  const [pos, setPos] = useState(() => degToXY(value));

  useEffect(() => {
    setPos(degToXY(value));
  }, [value]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left - margin) / (width - 2 * margin)) * 2 - 1;
    let y = ((e.clientY - rect.top - margin) / (height - 2 * margin)) * 2 - 1;

    // Calculate radii for min/max elevation constraints
    const maxR = Math.cos((minElevationDeg * Math.PI) / 180); // min elevation = max radius
    const minR = Math.cos((maxElevationDeg * Math.PI) / 180); // max elevation = min radius
    
    const mag = Math.sqrt(x * x + y * y);
    
    if (mag > maxR) {
      // Constrain to outer edge (minimum elevation)
      x = (x / mag) * maxR;
      y = (y / mag) * maxR;
    } else if (mag < minR && mag > 0) {
      // Constrain to inner edge (maximum elevation)
      x = (x / mag) * minR;
      y = (y / mag) * minR;
    }

    setPos({ x, y });
    onChange?.(xyToDeg(x, y));
  };

  // Calculate pixel positions
  const centerX = width / 2;
  const centerY = height / 2;
  const pillX = ((pos.x + 1) / 2) * (width - 2 * margin) + margin;
  const pillY = ((pos.y + 1) / 2) * (height - 2 * margin) + margin;

  // Calculate radii for visualization
  const outerRadius = (width - 2 * margin) / 2;
  const minElevationRadius = outerRadius * Math.cos((minElevationDeg * Math.PI) / 180);
  const maxElevationRadius = outerRadius * Math.cos((maxElevationDeg * Math.PI) / 180);

  return (
    <div
      ref={containerRef}
      className="relative border border-border rounded-lg touch-none select-none"
      style={{ width, height, userSelect: 'none', WebkitUserSelect: 'none' }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        handlePointerMove(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.preventDefault();
          handlePointerMove(e);
        }
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    >
      {/* Outer circle (minimum elevation) */}
      <div
        className="absolute border border-border rounded-full pointer-events-none"
        style={{
          width: minElevationRadius * 2,
          height: minElevationRadius * 2,
          left: centerX,
          top: centerY,
          transform: 'translate(-50%, -50%)',
        }}
      />

      {/* Inner circle (maximum elevation) - only show if different from center */}
      {maxElevationDeg < 90 && (
        <div
          className="absolute border border-border/50 rounded-full pointer-events-none"
          style={{
            width: maxElevationRadius * 2,
            height: maxElevationRadius * 2,
            left: centerX,
            top: centerY,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      {/* Cardinal directions */}
      {showCardinalDirections && (
        <>
          {/* N - Top */}
          <div
            className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: centerX, top: 4, transform: 'translateX(-50%)' }}
          >
            N
          </div>
          {/* E - Right */}
          <div
            className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ right: 4, top: centerY, transform: 'translateY(-50%)' }}
          >
            E
          </div>
          {/* S - Bottom */}
          <div
            className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: centerX, bottom: 4, transform: 'translateX(-50%)' }}
          >
            S
          </div>
          {/* W - Left */}
          <div
            className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: 4, top: centerY, transform: 'translateY(-50%)' }}
          >
            W
          </div>
        </>
      )}

      {/* Line from origin to pill */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ width, height }}
      >
        <line
          x1={centerX}
          y1={centerY}
          x2={pillX}
          y2={pillY}
          stroke="var(--primary)"
          strokeLinecap="round"
          strokeWidth="2"
          opacity="1"
        />
      </svg>

      {/* Draggable pill - shadcn style */}
      <div
        className="absolute rounded-full bg-background border-2 border-primary shadow-sm hover:shadow-md transition-shadow pointer-events-none"
        style={{
          width: pillRadius * 2,
          height: pillRadius * 2,
          left: `${pillX}px`,
          top: `${pillY}px`,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}