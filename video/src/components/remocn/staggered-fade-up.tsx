"use client";

import { interpolate, useCurrentFrame } from "remotion";

export interface StaggeredFadeUpProps {
  text: string;
  staggerDelay?: number;
  distance?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  speed?: number;
  className?: string;
  /** Local: render the text alone, inside a layout of ours (no full-frame white box). */
  inline?: boolean;
  /** Local: stagger words instead of characters. */
  by?: "char" | "word";
}

export function StaggeredFadeUp({
  text,
  staggerDelay = 4,
  distance = 20,
  fontSize = 72,
  color = "#171717",
  fontWeight = 600,
  speed = 1,
  className,
  inline = false,
  by = "char",
}: StaggeredFadeUpProps) {
  const frame = useCurrentFrame() * speed;

  const words = by === "word" ? text.split(" ") : text.split("");

  const body = (
      <span
        className={className}
        style={{
          fontSize,
          fontWeight,
          color,
          letterSpacing: "-0.03em",
          fontFamily:
            "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        {words.map((word, i) => {
          const local = frame - i * staggerDelay;
          const opacity = interpolate(local, [0, 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const y = interpolate(local, [0, 12], [distance, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: by === "word" ? "0.25em" : 0,
                whiteSpace: "pre",
                opacity,
                translate: `0 ${y}px`,
              }}
            >
              {word}
            </span>
          );
        })}
      </span>
  );
  if (inline) return body;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "white",
      }}
    >
      {body}
    </div>
  );
}
