import { useState, useRef, useEffect, useContext, useMemo } from "react";
import { useAtom } from "jotai"
import { SectionIdContext } from "./controls-components"
import { cn } from "@/lib/utils"
import { transparentUiAtom, activeSliderAtom } from "@/lib/settings-atoms"
import { yearlySunEnvelope, isSunPositionReachable, type AzElPoint } from "@/lib/solar-position"

// Degrees of declination slack for the pill's unreachable-border check (see
// isSunPositionReachable's own doc comment) — small enough to stay a "right
// on the line" allowance, not a visible loosening of the actual boundary.
const UNREACHABLE_TOLERANCE_DEG = 2;

interface SphericalXYPadProps {
  width: number;
  height: number;
  margin?: number;
  pillRadius?: number;
  value?: { azimuthDeg: number; elevationDeg: number }; // degrees
  onChange?: (val: { azimuthDeg: number; elevationDeg: number }) => void;
  showCardinalDirections?: boolean;
  /** Ring labels as [top, right, bottom, left] — defaults to compass
   *  N/E/S/W. Phong's camera-relative ("headlamp") anchor swaps in
   *  screen-relative arrows, since azimuth there is an offset from the
   *  camera heading, not a compass direction. */
  cardinalLabels?: [string, string, string, string];
  azimuthRange?: [number, number]; // e.g., [-180, 180] or [0, 360]
  elevationRange?: [number, number]; // e.g., [1, 90] in degrees
  sliderId?: string;
  fixedAzimuth?: number | null; // Fix azimuth to this value (degrees), allows only elevation changes
  fixedElevation?: number | null; // Fix elevation to this value (degrees), allows only azimuth changes
  // Datetime-mode backdrop (see light-direction-control.tsx): when a latitude
  // is given, hatches every position the sun can NEVER reach at that
  // latitude, leaving the reachable lens plain — hatching the excluded area
  // (rather than tinting the included one) reads unambiguously as "off
  // limits," where a plain fill over the reachable area could just as easily
  // be misread as "restricted" instead of "available." Also drives a live
  // reachability check while dragging (see isUnreachable below): the pill's
  // border turns destructive-red the moment the pointer is over a direction
  // the real sun never actually reaches at this latitude.
  sunEnvelopeLat?: number;
}

export function SphericalXYPad({
  width,
  height,
  margin = 12,
  pillRadius = 8,
  value = { azimuthDeg: 0, elevationDeg: 45 },
  onChange,
  showCardinalDirections = true,
  cardinalLabels = ["N", "E", "S", "W"],
  azimuthRange = [0, 360],
  elevationRange = [0, 90],
  sliderId = "xypad",
  fixedAzimuth = null,
  fixedElevation = null,
  sunEnvelopeLat,
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

  // Same projection as degToXY, minus the fixedAzimuth/fixedElevation
  // substitution — the analemma plots real per-day sun positions and must
  // never get collapsed onto whatever fixed value the pill itself is locked to.
  const projectPoint = (azimuthDeg: number, elevationDeg: number) => {
    let normalizedAz = azimuthDeg;
    if (azimuthRange[0] === -180) {
      normalizedAz = azimuthDeg < 0 ? azimuthDeg + 360 : azimuthDeg;
    }
    const az = ((90 - normalizedAz) * Math.PI) / 180;
    const el = (Math.max(minElevationDeg, Math.min(maxElevationDeg, elevationDeg)) * Math.PI) / 180;
    const r = Math.cos(el);
    return { x: r * Math.cos(az), y: -r * Math.sin(az) };
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

  // Same normalized-xy → pixel mapping as pillX/pillY above, factored out so
  // the sun-envelope path below uses the exact same coordinate frame (it'd
  // otherwise silently drift out of alignment with the pill).
  const toPx = (x: number, y: number) => ({
    px: ((x + 1) / 2) * (width - 2 * margin) + margin,
    py: ((y + 1) / 2) * (height - 2 * margin) + margin,
  });

  const sunEnvelope = useMemo(() => {
    if (sunEnvelopeLat === undefined) return null;
    const { upper, lower } = yearlySunEnvelope(sunEnvelopeLat);
    if (!upper.length) return null;
    const toPoint = (p: AzElPoint) => {
      const { x, y } = projectPoint(p.azimuth, p.elevation);
      const { px, py } = toPx(x, y);
      return `${px.toFixed(2)} ${py.toFixed(2)}`;
    };
    // The reachable lens itself, as a plain outline (no fill — the hatch
    // below carries the visual weight, this is just a crisp boundary line).
    const lensPath =
      upper.map((p, i) => `${i === 0 ? "M" : "L"} ${toPoint(p)}`).join(" ") +
      " " +
      [...lower].reverse().map((p) => `L ${toPoint(p)}`).join(" ") +
      " Z";
    // Outer pad circle MINUS the lens, via fill-rule="evenodd": one subpath
    // traces the full outer circle, the other traces the same lens polygon
    // above — evenodd fills between the two (the unreachable area) and
    // leaves the lens itself a genuine hole, rather than painting over it
    // with a solid color that could mismatch the pad's own background.
    const outerCirclePath = `M ${centerX + minElevationRadius} ${centerY} A ${minElevationRadius} ${minElevationRadius} 0 1 0 ${centerX - minElevationRadius} ${centerY} A ${minElevationRadius} ${minElevationRadius} 0 1 0 ${centerX + minElevationRadius} ${centerY} Z`;
    return { lensPath, hatchPath: `${outerCirclePath} ${lensPath}` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunEnvelopeLat, width, height, margin]);

  // Live "is this exact drag position ever reached by the real sun" check —
  // O(1) closed-form test (see isSunPositionReachable's own doc comment),
  // recomputed from the pill's own live (unconstrained) position, not the
  // debounced `value` prop, so the red-border feedback below is instant.
  // A small tolerance keeps the border primary right on/near the boundary
  // (e.g. a value carried over from a slightly different latitude, or just
  // float rounding) rather than flip-flopping red the instant it's a
  // fraction of a degree past the true edge.
  const currentDeg = xyToDeg(pos.x, pos.y);
  const isUnreachable = sunEnvelopeLat !== undefined && !isSunPositionReachable(sunEnvelopeLat, currentDeg.azimuthDeg, currentDeg.elevationDeg, UNREACHABLE_TOLERANCE_DEG);

  const hatchId = `sun-unreachable-hatch-${sliderId}`;

  return (
      <div
        ref={containerRef}
        className={cn(
          "relative border border-border rounded-lg touch-none select-none cursor-pointer",
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

      {/* Datetime-mode sun backdrop: hatches the region the sun can NEVER
          reach at this latitude (see light-direction-control.tsx), leaving
          the reachable lens a plain hole — see sunEnvelope's own comment for
          why hatching the excluded area, not tinting the included one. */}
      {sunEnvelope && (
        <svg className="absolute inset-0 pointer-events-none" style={{ width, height }}>
          <defs>
            <pattern id={hatchId} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />
            </pattern>
          </defs>
          <path d={sunEnvelope.hatchPath} fill={`url(#${hatchId})`} fillRule="evenodd" />
          <path d={sunEnvelope.lensPath} fill="none" stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />
        </svg>
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
            x2={centerX + maxElevationRadius * Math.cos(constraintLineAngle)}
            y2={centerY - maxElevationRadius * Math.sin(constraintLineAngle)}
            stroke="var(--primary)"
            strokeOpacity="0.5"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        </svg>
      )}

      {/* Datetime-mode sun backdrop: hatches the region the sun can NEVER
          reach at this latitude (see light-direction-control.tsx), leaving
          the reachable lens a plain hole — see sunEnvelope's own comment for
          why hatching the excluded area, not tinting the included one. */}
      {sunEnvelope && (
        <svg className="absolute inset-0 pointer-events-none" style={{ width, height }}>
          <defs>
            <pattern id={hatchId} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />
            </pattern>
          </defs>
          <path d={sunEnvelope.hatchPath} fill={`url(#${hatchId})`} fillRule="evenodd" />
          <path d={sunEnvelope.lensPath} fill="none" stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />
        </svg>
      )}

      {/* Cardinal directions */}
      {showCardinalDirections && (
        <>
          <div className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: centerX, top: 4, transform: 'translateX(-50%)' }}>{cardinalLabels[0]}</div>
          <div className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ right: 4, top: centerY, transform: 'translateY(-50%)' }}>{cardinalLabels[1]}</div>
          <div className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: centerX, bottom: 4, transform: 'translateX(-50%)' }}>{cardinalLabels[2]}</div>
          <div className="absolute text-xs text-muted-foreground font-medium pointer-events-none"
            style={{ left: 4, top: centerY, transform: 'translateY(-50%)' }}>{cardinalLabels[3]}</div>
        </>
      )}

      {/* Line from origin to pill */}
      <svg className="absolute inset-0 pointer-events-none" style={{ width, height }}>
        <line
          x1={centerX} y1={centerY} x2={pillX} y2={pillY}
          stroke="var(--primary)" strokeLinecap="round" strokeWidth="2" opacity="1"
        />
      </svg>

      {/* Draggable pill — border turns destructive-red while the live drag
          position is somewhere the real sun never reaches at this latitude
          (see isUnreachable above), independent of the hatch fill so it's
          readable even mid-drag before the hatch pattern registers visually. */}
      <div
        className={cn(
          "absolute rounded-full bg-background border-2 shadow-sm hover:shadow-md transition-shadow pointer-events-none cursor-pointer",
          isUnreachable ? "border-destructive" : "border-primary",
        )}
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