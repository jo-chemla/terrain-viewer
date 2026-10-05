// The Terrain Viewer demo: a title on Remocn's grain-gradient shader, two
// clips recorded by agent-browser (record.sh) with their captions, Remocn
// focus-pull transitions between the scenes, and an outro. 1920×1080, 30 fps.
// Colours follow the slides: white type on the HeritageWatch AI blues.
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

/** A scene's caption: a frosted card low on the frame, a line per beat. */
const Caption: React.FC<{ kicker: string; text: string }> = ({ kicker, text }) => {
  const frame = useCurrentFrame()
  const y = interpolate(frame, [0, 14], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) })
  const o = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 72, paddingRight: 560, fontFamily: FONT }}>
      <div style={{ transform: `translateY(${y}px)`, opacity: o, background: "rgba(255,255,255,0.88)", backdropFilter: "blur(12px)", borderRadius: 18, padding: "22px 40px 26px", boxShadow: "0 0 0 1px rgba(0,0,0,0.06), 0 12px 32px -12px rgba(0,0,0,0.25)", maxWidth: 1500 }}>
        <div style={{ fontSize: 22, letterSpacing: "0.08em", textTransform: "uppercase", color: "#3f51b5", fontWeight: 600, textAlign: "center", marginBottom: 8 }}>{kicker}</div>
        <div style={{ textAlign: "center", lineHeight: 1.25 }}>
          <StaggeredFadeUp inline by="word" text={text} fontSize={40} color="#0a0a0a" fontWeight={500} staggerDelay={2} distance={10} />
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** A recorded clip, full frame, from its in-point at its speed (the takes
 *  carry a few seconds of tool start-up between clicks), with its captions. */
const ClipScene: React.FC<{ src: string; startFrom: number; rate: number; beats: { from: number; kicker: string; text: string }[]; duration: number }> = ({ src, startFrom, rate, beats, duration }) => (
  <AbsoluteFill style={{ background: "#0a0a0a" }}>
    <OffthreadVideo src={staticFile(src)} startFrom={startFrom} playbackRate={rate} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
    {beats.map((b, i) => (
      <Sequence key={i} from={b.from} durationInFrames={(beats[i + 1]?.from ?? duration) - b.from}>
        <Caption kicker={b.kicker} text={b.text} />
      </Sequence>
    ))}
  </AbsoluteFill>
)

const TitleCard: React.FC<{ title: string; subtitle: string; size?: number }> = ({ title, subtitle, size = 132 }) => (
  <AbsoluteFill>
    <ShaderGrainGradient colors={BLUES} colorBack="#0d1240" softness={0.7} intensity={0.25} noise={0.18} speed={0.6} />
    <AbsoluteFill style={{ flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 28, fontFamily: FONT }}>
      <FocusBlurResolve inline text={title} fontSize={size} color="#ffffff" fontWeight={600} blur={18} />
      <Sequence from={14} layout="none">
        <StaggeredFadeUp inline by="word" text={subtitle} fontSize={40} color="rgba(255,255,255,0.82)" fontWeight={400} staggerDelay={3} distance={12} />
      </Sequence>
    </AbsoluteFill>
  </AbsoluteFill>
)

export type DemoProps = { paperFrames: number; isolineFrames: number }

// Each take's in-point (source frames) and speed, and when its clicks land
// (source seconds, read from the capture's frame timings): clip A turns the
// paper removal on at 10 s, off at 22.5 s, on again at 28 s; clip B switches
// to "every interval" at 10 s (lines in by 13 s) and back at 22.5 s.
const PAPER = { startFrom: 150, rate: 1.5 }
const ISO = { startFrom: 90, rate: 1.3 }
const at = (clip: { startFrom: number; rate: number }, sourceSeconds: number) => Math.max(0, Math.round((sourceSeconds * FPS - clip.startFrom) / clip.rate))
const sceneFrames = (clip: { startFrom: number; rate: number }, sourceFrames: number) => Math.floor((sourceFrames - clip.startFrom) / clip.rate) - 2

export const demoDuration = ({ paperFrames, isolineFrames }: DemoProps) => 105 + sceneFrames(PAPER, paperFrames) + sceneFrames(ISO, isolineFrames) + 120 - 3 * TRANSITION

export const Demo: React.FC<DemoProps> = (props) => {
  const paperFrames = sceneFrames(PAPER, props.paperFrames)
  const isolineFrames = sceneFrames(ISO, props.isolineFrames)
  return (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={105}>
      <TitleCard title="Terrain Viewer" subtitle="Old maps and terrain, in the browser" />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={focusPull({ blur: 18 })} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence durationInFrames={paperFrames}>
      <ClipScene src="clip-paper.mp4" {...PAPER} duration={paperFrames} beats={[
        { from: 8, kicker: "Allmaps · David Rumsey Map Collection", text: "An old atlas of Paris, warped onto today's imagery" },
        { from: at(PAPER, 10), kicker: "Remove the maps' paper · Auto", text: "Each map's paper colour and threshold from its own histogram" },
        { from: at(PAPER, 22.5), kicker: "Before", text: "The sheet as scanned" },
        { from: at(PAPER, 28), kicker: "After", text: "Only the ink: old streets over today's roofs" },
      ]} />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={focusPull({ blur: 18 })} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence durationInFrames={isolineFrames}>
      <ClipScene src="clip-isoline.mp4" {...ISO} duration={isolineFrames} beats={[
        { from: 8, kicker: "Iso-line · Matterhorn", text: "An iso-slope at 45°, its fill from the same polygons" },
        { from: at(ISO, 10), kicker: "Every interval", text: "Contours of the slope itself, every 10°" },
        { from: at(ISO, 22.5), kicker: "Any measure", text: "Elevation, slope, curvature, local relief, the Phong shading" },
      ]} />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={focusPull({ blur: 18 })} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence durationInFrames={120}>
      <TitleCard title="terrain-viewer.iconem.com" subtitle="Free, open, no install" size={96} />
    </TransitionSeries.Sequence>
  </TransitionSeries>
  )
}
