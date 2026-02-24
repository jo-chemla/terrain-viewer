import { useState, useRef, useEffect, useContext } from "react";
import { useAtom } from "jotai"
import { SectionIdContext } from "./controls-components"
import { cn } from "@/lib/utils"
import { transparentUiAtom, activeSliderAtom } from "@/lib/settings-atoms"

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
  sliderId?: string;
  fixedAzimuth?: number | null; // Fix azimuth to this value (degrees), allows only elevation changes
  fixedElevation?: number | null; // Fix elevation to this value (degrees), allows only azimuth changes
}

export function SphericalXYPad({
  width,
  height,
  margin = 12,
  pillRadius = 8,
  value = { azimuthDeg: 0, elevationDeg: 45 },
  onChange,
  showCardinalDirections = true,
  azimuthRange = [0, 360],
  elevationRange = [0, 90],
  sliderId = "xypad",
  fixedAzimuth = null,
  fixedElevation = null,
}: SphericalXYPadProps) {
  const [transparentUi, setTransparentUi] = useAtom(transparentUiAtom)
  
  const [activeSlider, setActiveSlider] = useAtom(activeSliderAtom)
  const sectionId = useContext(SectionIdContext)
  const fullSliderId = `${sectionId}:${sliderId}`
  const isDimmed = activeSlider !== null && activeSlider !== fullSliderId

  const containerRef = useRef<HTMLDivElement>(null);

  const [minElevationDeg, maxElevationDeg] = elevationRange;

  const normalizeAzimuth = (deg: number): number => {
    const [min, max] = azimuthRange;
    const range = max - min;
    let normalized = deg;
    while (normalized < min) normalized += range;
    while (normalized >= max) normalized -= range;
    return normalized;
  };

  const degToXY = ({ azimuthDeg, elevationDeg }: { azimuthDeg: number; elevationDeg: number }) => {
    // Apply constraints before converting to XY
    const constrainedAzimuth = fixedAzimuth !== null ? fixedAzimuth : azimuthDeg;
    const constrainedElevation = fixedElevation !== null ? fixedElevation : elevationDeg;
    
    let normalizedAz = constrainedAzimuth;
    if (azimuthRange[0] === -180) {
      normalizedAz = constrainedAzimuth < 0 ? constrainedAzimuth + 360 : constrainedAzimuth;
    }
    const az = ((90 - normalizedAz) * Math.PI) / 180;
    const el = (constrainedElevation * Math.PI) / 180;
    const r = Math.cos(el);
    return { x: r * Math.cos(az), y: -r * Math.sin(az) };
  };

  const xyToDeg = (x: number, y: number) => {
    const r = Math.sqrt(x * x + y * y);
    const mathAngle = Math.atan2(-y, x);
    let azimuthDeg = 90 - (mathAngle * 180) / Math.PI;
    while (azimuthDeg < 0) azimuthDeg += 360;
    while (azimuthDeg >= 360) azimuthDeg -= 360;
    azimuthDeg = normalizeAzimuth(azimuthDeg);
    const elevation = Math.acos(Math.min(r, 1));
    let elevationDeg = (elevation * 180) / Math.PI;
    elevationDeg = Math.max(minElevationDeg, Math.min(maxElevationDeg, elevationDeg));
    return { azimuthDeg, elevationDeg };
  };

  const [pos, setPos] = useState(() => degToXY(value));

  useEffect(() => {
    setPos(degToXY(value));
  }, [value, fixedAzimuth, fixedElevation]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left - margin) / (width - 2 * margin)) * 2 - 1;
    let y = ((e.clientY - rect.top - margin) / (height - 2 * margin)) * 2 - 1;

    const maxR = Math.cos((minElevationDeg * Math.PI) / 180);
    const minR = Math.cos((maxElevationDeg * Math.PI) / 180);

    // Handle fixed azimuth mode (constrain to a radial line)
    if (fixedAzimuth !== null) {
      const fixedAzPos = degToXY({ azimuthDeg: fixedAzimuth, elevationDeg: 45 });
      const angle = Math.atan2(fixedAzPos.y, fixedAzPos.x);
      
      // Project pointer position onto the fixed azimuth line
      const projectedR = x * Math.cos(angle) + y * Math.sin(angle);
      
      // Clamp to elevation range
      const clampedR = Math.max(minR, Math.min(maxR, Math.abs(projectedR)));
      
      x = clampedR * Math.cos(angle);
      y = clampedR * Math.sin(angle);
      
      setPos({ x, y });
      const result = xyToDeg(x, y);
      onChange?.({ azimuthDeg: fixedAzimuth, elevationDeg: result.elevationDeg });
      return;
    }

    // Handle fixed elevation mode (constrain to a circle)
    if (fixedElevation !== null) {
      const fixedR = Math.cos((fixedElevation * Math.PI) / 180);
      const mag = Math.sqrt(x * x + y * y);
      
      if (mag > 0) {
        x = (x / mag) * fixedR;
        y = (y / mag) * fixedR;
      }
      
      setPos({ x, y });
      const result = xyToDeg(x, y);
      onChange?.({ azimuthDeg: result.azimuthDeg, elevationDeg: fixedElevation });
      return;
    }

    // Handle unconstrained mode (original behavior)
    const mag = Math.sqrt(x * x + y * y);

    if (mag > maxR) {
      x = (x / mag) * maxR;
      y = (y / mag) * maxR;
    } else if (mag < minR && mag > 0) {
      x = (x / mag) * minR;
      y = (y / mag) * minR;
    }

    setPos({ x, y });
    onChange?.(xyToDeg(x, y));
  };

  const centerX = width / 2;
  const centerY = height / 2;
  const pillX = ((pos.x + 1) / 2) * (width - 2 * margin) + margin;
  const pillY = ((pos.y + 1) / 2) * (height - 2 * margin) + margin;

  const outerRadius = (width - 2 * margin) / 2;
  const minElevationRadius = outerRadius * Math.cos((minElevationDeg * Math.PI) / 180);
  const maxElevationRadius = outerRadius * Math.cos((maxElevationDeg * Math.PI) / 180);

  // Calculate constraint visualization
  const constraintCircleRadius = fixedElevation !== null 
    ? outerRadius * Math.cos((fixedElevation * Math.PI) / 180)
    : null;

  const constraintLineAngle = fixedAzimuth !== null
    ? ((90 - fixedAzimuth) * Math.PI) / 180
    : null;

  return (
      <div
        ref={containerRef}
        className={cn(
          "relative border border-border rounded-lg touch-none select-none",
          "transition-opacity duration-150",
          isDimmed && "opacity-20",
          transparentUi && "bg-background/50"
        )}
        style={{ width, height, userSelect: 'none', WebkitUserSelect: 'none' }}
        onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        handlePointerMove(e);
        if (transparentUi) setActiveSlider(fullSliderId)
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
        if (transparentUi) setActiveSlider(null)
      }}
      onPointerCancel={(e) => {
        if (transparentUi) setActiveSlider(null)
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

      {/* Fixed elevation constraint circle */}
      {constraintCircleRadius !== null && (
        <div
          className="absolute border-2 border-primary/50 rounded-full pointer-events-none"
          style={{
            width: constraintCircleRadius * 2,
            height: constraintCircleRadius * 2,
            left: centerX,
            top: centerY,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      {/* Fixed azimuth constraint line */}
      {constraintLineAngle !== null && (
        <svg className="absolute inset-0 pointer-events-none" style={{ width, height }}>
          <line
            x1={centerX + minElevationRadius * Math.cos(constraintLineAngle)}
            y1={centerY - minElevationRadius * Math.sin(constraintLineAngle)}
            x2={centerX + maxR * outerRadius * Math.cos(constraintLineAngle)}
            y2={centerY - maxR * outerRadius * Math.sin(constraintLineAngle)}
            stroke="var(--primary)"
            strokeOpacity="0.5"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        </svg>
      )}

      {/* Cardinal directions */}
      {showCardinalDirections && (
        <>
          <div className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: centerX, top: 4, transform: 'translateX(-50%)' }}>N</div>
          <div className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ right: 4, top: centerY, transform: 'translateY(-50%)' }}>E</div>
          <div className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: centerX, bottom: 4, transform: 'translateX(-50%)' }}>S</div>
          <div className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: 4, top: centerY, transform: 'translateY(-50%)' }}>W</div>
        </>
      )}

      {/* Line from origin to pill */}
      <svg className="absolute inset-0 pointer-events-none" style={{ width, height }}>
        <line
          x1={centerX} y1={centerY} x2={pillX} y2={pillY}
          stroke="var(--primary)" strokeLinecap="round" strokeWidth="2" opacity="1"
        />
      </svg>

      {/* Draggable pill */}
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