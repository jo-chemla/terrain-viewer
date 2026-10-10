// The second 2026-10-10 demo, in the slide decks' look (slides/slides/*/index.tsx):
// white cards in Geist with a mono eyebrow, a hairline rule and the mono footer;
// take six of the basic modes over Mont Blanc (video/takes/basic-modes-v6, with
// the Data layers picker), a "Historical Satellite" card, the third historical
// grid take over the Champ de Mars, an outro with both sites. Takes at 1x,
// white caption panels in the lower third of the map, cross-fades between scenes.
import type React from "react"
import type { CSSProperties, ReactNode } from "react"
import { AbsoluteFill, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from "remotion"
import { TransitionSeries, linearTiming } from "@remotion/transitions"
import { fade } from "@remotion/transitions/fade"

export const FPS = 30
export const TRANSITION = 12
const TITLE = 90
const CARD = 90
const OUTRO = 120

// The deck kit's palette and fonts (slides/slides/historical/index.tsx).
const ink = { text: "#0a0a0a", soft: "#404040", muted: "#6b6b6b", rule: "#e4e4e4", panel: "#f7f7f7", accent: "#1A237E" }
const SANS = '"Geist Variable", Geist, -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif'
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace'
const PAD_X = 120

// Geist is not installed on the render machine: load the variable latin file
// the decks bundle (@fontsource-variable/geist), copied into public/fonts.
const fontHandle = delayRender("Geist")
new FontFace("Geist Variable", `url(${staticFile("fonts/geist-latin-wght-normal.woff2")}) format("woff2")`, { weight: "100 900" })
  .load()
  .then((f) => {
    document.fonts.add(f)
    continueRender(fontHandle)
  })
  .catch(() => continueRender(fontHandle))

// ─── Cards ──────────────────────────────────────────────────────────────────

const fill: CSSProperties = { background: "#ffffff", color: ink.text, fontFamily: SANS, letterSpacing: "-0.01em", WebkitFontSmoothing: "antialiased" }

/** The deck's frame: the accent mark, a mono eyebrow, the mono footer with the card number. */
const Card: React.FC<{ eyebrow: string; foot: string; n: number; fadeIn?: boolean; children: ReactNode }> = ({ eyebrow, foot, n, fadeIn, children }) => {
  const frame = useCurrentFrame()
  const o = fadeIn ? interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1
  return (
    <AbsoluteFill style={fill}>
      <AbsoluteFill style={{ opacity: o }}>
        <div style={{ position: "absolute", left: PAD_X, top: 101, width: 16, height: 16, borderRadius: 4, background: ink.accent }} />
        <div style={{ position: "absolute", left: PAD_X + 32, top: 96, fontFamily: MONO, fontSize: 20, lineHeight: "26px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, color: ink.accent }}>{eyebrow}</div>
        {children}
        <div style={{ position: "absolute", left: PAD_X, right: PAD_X, bottom: 44, display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 20, letterSpacing: "0.08em", textTransform: "uppercase", color: ink.muted }}>
          <span>{foot}</span>
          <span>{String(n).padStart(2, "0")} / 03</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const h1: CSSProperties = { margin: 0, fontFamily: SANS, fontSize: 120, fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 1 }

/** The deck's cover without its picture: the title, one muted line, a hairline rule. */
export const TitleCard: React.FC<{ eyebrow: string; title: ReactNode; subtitle: string; foot: string; n: number; fadeIn?: boolean }> = ({ eyebrow, title, subtitle, foot, n, fadeIn }) => (
  <Card eyebrow={eyebrow} foot={foot} n={n} fadeIn={fadeIn}>
    <div style={{ position: "absolute", left: PAD_X, right: PAD_X, bottom: 340 }}>
      <h1 style={h1}>{title}</h1>
      <p style={{ margin: "40px 0 0", fontSize: 36, lineHeight: 1.3, color: ink.muted, whiteSpace: "nowrap" }}>{subtitle}</p>
    </div>
    <div style={{ position: "absolute", left: PAD_X, right: PAD_X, top: 800, borderTop: `1px solid ${ink.rule}` }} />
  </Card>
)

/** The deck's closing: the title over ruled mono rows numbered in the accent. */
export const OutroCard: React.FC = () => (
  <Card eyebrow="Terrain Viewer" foot="terrain viewer · demo · terrain-viewer.iconem.com" n={3}>
    <h1 style={{ ...h1, position: "absolute", left: PAD_X, top: 260 }}>Free, open, no install</h1>
    <div style={{ position: "absolute", left: PAD_X, right: PAD_X, top: 520, borderBottom: `1px solid ${ink.rule}` }}>
      {[
        ["terrain-viewer.iconem.com", "relief, slope and elevation of any place"],
        ["historical-satellite.iconem.com", "dated imagery, side by side and on a timeline"],
      ].map(([site, what], i) => (
        <div key={site} style={{ display: "flex", gap: 40, alignItems: "baseline", padding: "24px 0", borderTop: `1px solid ${ink.rule}`, fontFamily: MONO }}>
          <span style={{ fontSize: 20, color: ink.accent, letterSpacing: "0.08em" }}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{ fontSize: 34, color: ink.text, minWidth: 760 }}>{site}</span>
          <span style={{ fontSize: 24, color: ink.muted, fontFamily: SANS }}>{what}</span>
        </div>
      ))}
    </div>
  </Card>
)

// ─── Takes ──────────────────────────────────────────────────────────────────

/** Where a caption sits: its centre x and its bottom edge, in frame pixels. */
type Spot = { x: number; bottom: number; size?: number }
type Beat = { at: number; to: number; text: string; spot?: Spot }
export type Take = { src: string; in: number; out: number; spot: Spot; beats: Beat[] }

/** A white panel, one line of dark type, a plain fade with a 6 px rise. */
const Caption: React.FC<{ text: string; spot: Spot; duration: number }> = ({ text, spot, duration }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 8, duration - 8, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const y = interpolate(frame, [0, 10], [6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <div
      style={{
        position: "absolute", left: spot.x, bottom: spot.bottom, transform: `translate(-50%, ${y}px)`, opacity: o,
        background: "rgba(255,255,255,0.92)", border: `1px solid ${ink.rule}`, borderRadius: 12, padding: "14px 24px",
        boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.06), 0 1px 0 rgba(0, 0, 0, 0.025)",
        fontFamily: SANS, fontSize: spot.size ?? 38, fontWeight: 500, lineHeight: 1.1, letterSpacing: "-0.01em", color: ink.text, whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  )
}

export const takeFrames = (t: Take) => Math.round((t.out - t.in) * FPS)
const toFrame = (t: Take, s: number) => Math.max(0, Math.round((s - t.in) * FPS))

export const TakeScene: React.FC<{ take: Take }> = ({ take }) => (
  <AbsoluteFill style={{ background: "#ffffff" }}>
    <OffthreadVideo src={staticFile(take.src)} startFrom={Math.round(take.in * FPS)} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
    {take.beats.map((b, i) => {
      const from = toFrame(take, b.at)
      const end = Math.min(takeFrames(take), toFrame(take, b.to))
      return (
        <Sequence key={i} from={from} durationInFrames={end - from}>
          <Caption text={b.text} spot={b.spot ?? take.spot} duration={end - from} />
        </Sequence>
      )
    })}
  </AbsoluteFill>
)

// Source seconds, from the takes' scripts and their frames. The sidebar starts
// at x ≈ 1510 in both takes: captions centre on the map (x 760).
// Take six: the picker closes at 38.47 s and the Layers tooltip opens at 38.53 s
// and stays, so the take ends at 38.4 s, on the picker. The picker spans
// x 449..1470, y 82..997; its caption sits in the 83 px strip under it, left of
// the scale bar (x ≥ 1295).
const BASIC: Take = {
  src: "clip-basic-v6.mp4", in: 0.4, out: 38.4, spot: { x: 760, bottom: 90 }, beats: [
    { at: 0.9, to: 4.3, text: "Mont Blanc, a 2D hillshade" },
    { at: 4.6, to: 7.6, text: "Slope over the hillshade" },
    { at: 7.9, to: 12.2, text: "Slope range to 60°" },
    { at: 14.1, to: 18.8, text: "Hypsometric tint, another ramp" },
    { at: 19.4, to: 24.0, text: "Elevation bounds 1400 to 4300 m" },
    { at: 24.5, to: 27.2, text: "Scroll to zoom in" },
    { at: 28.9, to: 37.6, text: "Every mode, as a card", spot: { x: 960, bottom: 6, size: 36 } },
  ],
}
// The historical take's timeline covers y ≥ 900: captions sit above it.
const HISTORICAL: Take = {
  src: "clip-historical-v3.mp4", in: 0, out: 48.8, spot: { x: 760, bottom: 230 }, beats: [
    { at: 0.6, to: 4.4, text: "Champ de Mars, Esri Wayback 2024" },
    { at: 4.9, to: 13.1, text: "Swipe: Esri Wayback 2024 against Bing" },
    { at: 14.5, to: 19.4, text: "Three dates on the timeline" },
    // The grid replaces the 2x1 at 22.0 s; its new views stay white until ~23.1 s (in the take).
    { at: 21.6, to: 23.8, text: "Six dated views in a 3x2 grid" },
    { at: 24.0, to: 29.2, text: "Drag a handle to re-date a view" },
    { at: 30.4, to: 32.5, text: "Sort views by date" },
    { at: 32.8, to: 39.3, text: "Match Colors, on and off" },
    { at: 41.4, to: 47.4, text: "Difference blend: what changed" },
  ],
}

export const demo3Duration = () => TITLE + takeFrames(BASIC) + CARD + takeFrames(HISTORICAL) + OUTRO - 4 * TRANSITION

const crossFade = () => <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />

export const Demo3: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={TITLE}>
      <TitleCard fadeIn n={1} eyebrow="Terrain Viewer" title="Terrain Viewer" subtitle="Elevation and historical imagery, rendered in the browser" foot="terrain viewer · demo · terrain-viewer.iconem.com" />
    </TransitionSeries.Sequence>
    {crossFade()}
    <TransitionSeries.Sequence durationInFrames={takeFrames(BASIC)}>
      <TakeScene take={BASIC} />
    </TransitionSeries.Sequence>
    {crossFade()}
    <TransitionSeries.Sequence durationInFrames={CARD}>
      <TitleCard
        n={2}
        eyebrow="Historical Satellite"
        title={<>One timeline,<br />every archive</>}
        subtitle="Dated imagery, side by side and on a timeline"
        foot="terrain viewer · demo · historical-satellite.iconem.com"
      />
    </TransitionSeries.Sequence>
    {crossFade()}
    <TransitionSeries.Sequence durationInFrames={takeFrames(HISTORICAL)}>
      <TakeScene take={HISTORICAL} />
    </TransitionSeries.Sequence>
    {crossFade()}
    <TransitionSeries.Sequence durationInFrames={OUTRO}>
      <OutroCard />
    </TransitionSeries.Sequence>
  </TransitionSeries>
)
