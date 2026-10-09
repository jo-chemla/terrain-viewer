// The 2026-10-10 demo: a title, take five of the basic modes over Mont Blanc
// (video/takes/basic-modes-v5), a focus pull, a "Historical Satellite" card,
// the historical grid take over the Champ de Mars (video/takes/historical-grid),
// an outro with both URLs. Takes at 1x, captions on their clicks, kept left of
// the sidebar (x ≥ 1520) and, in the historical take, above the timeline.
import type React from "react"
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, interpolate, Easing } from "remotion"
import { TransitionSeries, linearTiming } from "@remotion/transitions"
import { FocusBlurResolve } from "@/components/remocn/focus-blur-resolve"
import { StaggeredFadeUp } from "@/components/remocn/staggered-fade-up"
import { focusPull } from "@/components/remocn/focus-pull"
import { ShaderGrainGradient } from "@/components/remocn/shader-grain-gradient"

export const FPS = 30
const BLUES = ["#1a237e", "#283593", "#3f51b5"]
const FONT = '"Geist", "Inter", -apple-system, "Segoe UI", system-ui, sans-serif'
const TRANSITION = 18
const TITLE = 90
const CARD = 75
const OUTRO = 120
// The sidebar's left edge in both takes, plus a margin: captions centre on the map.
const SIDEBAR = 400

type Beat = { at: number; to?: number; text: string }
type Take = { src: string; in: number; out: number; bottom: number; beats: Beat[] }

/** Lower-third caption: a dark frosted card, white type, readable over imagery. */
const Caption: React.FC<{ text: string; bottom: number; duration: number }> = ({ text, bottom, duration }) => {
  const frame = useCurrentFrame()
  const ease = Easing.bezier(0.22, 1, 0.36, 1)
  const y = interpolate(frame, [0, 14], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease })
  const o = interpolate(frame, [0, 10, duration - 8, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: bottom, paddingRight: SIDEBAR, fontFamily: FONT }}>
      <div style={{ transform: `translateY(${y}px)`, opacity: o, background: "rgba(10,14,40,0.72)", backdropFilter: "blur(14px)", borderRadius: 16, padding: "18px 36px 22px", boxShadow: "0 0 0 1px rgba(255,255,255,0.10), 0 12px 32px -12px rgba(0,0,0,0.5)", maxWidth: 1300, textAlign: "center", lineHeight: 1.25 }}>
        <StaggeredFadeUp inline by="word" text={text} fontSize={44} color="#ffffff" fontWeight={500} staggerDelay={2} distance={10} />
      </div>
    </AbsoluteFill>
  )
}

const takeFrames = (t: Take) => Math.round((t.out - t.in) * FPS)
const toFrame = (t: Take, s: number) => Math.max(0, Math.round((s - t.in) * FPS))

/** A take at 1x from its in-point, with its captions; a beat holds until its
 *  `to` or the next beat. */
const TakeScene: React.FC<{ take: Take }> = ({ take }) => {
  const total = takeFrames(take)
  return (
    <AbsoluteFill style={{ background: "#0a0a0a" }}>
      <OffthreadVideo src={staticFile(take.src)} startFrom={Math.round(take.in * FPS)} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
      {take.beats.map((b, i) => {
        const from = toFrame(take, b.at)
        const end = Math.min(total, toFrame(take, b.to ?? take.beats[i + 1]?.at ?? take.out))
        return (
          <Sequence key={i} from={from} durationInFrames={end - from}>
            <Caption text={b.text} bottom={take.bottom} duration={end - from} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

const TitleCard: React.FC<{ title: string; subtitle: string; size?: number; lines?: string[] }> = ({ title, subtitle, size = 132, lines }) => (
  <AbsoluteFill>
    <ShaderGrainGradient colors={BLUES} colorBack="#0d1240" softness={0.7} intensity={0.25} noise={0.18} speed={0.6} />
    <AbsoluteFill style={{ flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 28, fontFamily: FONT }}>
      {lines ? (
        lines.map((l, i) => (
          <Sequence key={i} from={i * 10} layout="none">
            <FocusBlurResolve inline text={l} fontSize={size} color="#ffffff" fontWeight={600} blur={18} />
          </Sequence>
        ))
      ) : (
        <FocusBlurResolve inline text={title} fontSize={size} color="#ffffff" fontWeight={600} blur={18} />
      )}
      <Sequence from={14} layout="none">
        <StaggeredFadeUp inline by="word" text={subtitle} fontSize={40} color="rgba(255,255,255,0.82)" fontWeight={400} staggerDelay={3} distance={12} />
      </Sequence>
    </AbsoluteFill>
  </AbsoluteFill>
)

// Source seconds, from the takes' scripts (video/takes/*): in/out trim the
// head and the tail, the beats land on the clicks.
const BASIC: Take = {
  src: "clip-basic-v5.mp4", in: 0.4, out: 28.0, bottom: 90, beats: [
    { at: 0.6, to: 4.2, text: "Mont Blanc, a 2D hillshade" },
    { at: 4.6, text: "Terrain Analysis: slope over the hillshade" },
    { at: 7.9, to: 12.4, text: "Slope range to 60°" },
    { at: 14.1, to: 18.8, text: "Hypsometric tint, another ramp" },
    { at: 19.4, to: 24.0, text: "Elevation bounds 1400 to 4300 m" },
    { at: 24.5, text: "Scroll to zoom in" },
  ],
}
// The historical take's timeline covers y ≥ 900: captions sit above it.
const HISTORICAL: Take = {
  src: "clip-historical.mp4", in: 0, out: 33.3, bottom: 230, beats: [
    { at: 0.4, to: 6.8, text: "Swipe: Esri Wayback 2024 against Bing" },
    { at: 7.0, to: 12.8, text: "Scrub the timeline: 2013, 2017, 2025" },
    { at: 13.0, to: 15.8, text: "Side by side" },
    { at: 16.0, to: 19.8, text: "Six dated views in a 3x2 grid" },
    { at: 20.0, to: 23.6, text: "Re-date a view by its timeline handle" },
    { at: 24.0, to: 30.0, text: "Sort views by date" },
  ],
}

export const demo2Duration = () => TITLE + takeFrames(BASIC) + CARD + takeFrames(HISTORICAL) + OUTRO - 4 * TRANSITION

const pull = () => <TransitionSeries.Transition presentation={focusPull({ blur: 18 })} timing={linearTiming({ durationInFrames: TRANSITION })} />

export const Demo2: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={TITLE}>
      <TitleCard title="Terrain Viewer" subtitle="Relief, slope and elevation of any place, in the browser" />
    </TransitionSeries.Sequence>
    {pull()}
    <TransitionSeries.Sequence durationInFrames={takeFrames(BASIC)}>
      <TakeScene take={BASIC} />
    </TransitionSeries.Sequence>
    {pull()}
    <TransitionSeries.Sequence durationInFrames={CARD}>
      <TitleCard title="Historical Satellite" subtitle="Dated imagery, side by side and on a timeline" size={112} />
    </TransitionSeries.Sequence>
    {pull()}
    <TransitionSeries.Sequence durationInFrames={takeFrames(HISTORICAL)}>
      <TakeScene take={HISTORICAL} />
    </TransitionSeries.Sequence>
    {pull()}
    <TransitionSeries.Sequence durationInFrames={OUTRO}>
      <TitleCard title="" lines={["terrain-viewer.iconem.com", "historical-satellite.iconem.com"]} subtitle="Free, open, no install" size={80} />
    </TransitionSeries.Sequence>
  </TransitionSeries>
)
