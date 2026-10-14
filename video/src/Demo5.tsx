// The 2026-10-14 cut: Demo4 with the two takes re-recorded after the
// see-through panel fix (video/takes/basic-modes-v8, historical-grid-v5):
// the basic take loses its last caption (the picker needs one line), the
// historical take has four Match Colors clicks instead of five and ends on
// the Difference blend with the divider swept to the right edge, a new beat.
// Captions are a narrator's sentences, 4 to 6 s each; cards of about 4 s; 1x.
import type React from "react"
import { TransitionSeries, linearTiming } from "@remotion/transitions"
import { fade } from "@remotion/transitions/fade"
import { OutroCard, TakeScene, TitleCard, TRANSITION, takeFrames, type Take } from "./Demo3"

// Each card stays about 4 s in full, the cross-fades come on top.
const TITLE = 126
const CARD = 132
const OUTRO = 135

// Video seconds, read on the frames (the script's log runs ~0.5 s ahead).
// The picker closes at 50.37 s and the Layers tooltip shows 50.5..50.9 s: the
// take ends on the picker. Its caption sits in the strip under the picker.
const BASIC: Take = {
  src: "clip-basic-v8.mp4", in: 0.3, out: 50.35, spot: { x: 760, bottom: 90 }, beats: [
    { at: 0.4, to: 4.6, text: "Mont Blanc in 2D, with a hillshade." },
    { at: 5.0, to: 9.8, text: "We add slope over the hillshade." },
    { at: 10.2, to: 16.2, text: "Then narrow its range to 60 degrees." },
    { at: 19.8, to: 25.8, text: "Now the hypsometric tint, with another ramp." },
    { at: 28.0, to: 32.6, text: "Its bounds pulled in to 1,400 and 4,300 metres." },
    { at: 32.8, to: 37.0, text: "Or fitted to the view in one click, from the tiles loaded." },
    { at: 37.2, to: 41.4, text: "Zooming in for detail." },
    { at: 41.6, to: 50.35, text: "Every visualization mode, as a card.", spot: { x: 940, bottom: 6, size: 36 } },
  ],
}

// The timeline covers y ≥ 900: captions sit above it. Video seconds are the
// take log's marks plus about 0.4 s (take-hist5-rec.log); the take ends at 84.2 s.
const HISTORICAL: Take = {
  src: "clip-historical-v5.mp4", in: 0, out: 83.8, spot: { x: 760, bottom: 230 }, beats: [
    { at: 0.5, to: 6.5, text: "The Champ de Mars on Esri Wayback, October 2024." },
    { at: 6.8, to: 12.6, text: "Split modes: off, overlay with a swipe, or side by side, all on the same centre." },
    { at: 13.0, to: 18.8, text: "Here Wayback against Bing: two dates on one map." },
    { at: 21.0, to: 27.0, text: "Three more dates from the timeline: 2013, 2017, 2025." },
    { at: 34.2, to: 40.0, text: "Six dated views in a grid." },
    { at: 41.8, to: 46.8, text: "A view re-dated by its timeline handle." },
    { at: 47.2, to: 51.4, text: "And another, to Wayback 2024." },
    { at: 50.2, to: 53.6, text: "Sort views by date." },
    { at: 54.0, to: 58.0, text: "Match Colors brings them to one palette." },
    { at: 58.3, to: 62.6, text: "Without it, each archive keeps its own colours." },
    { at: 63.0, to: 69.0, text: "Back to the overlay: the Difference blend shows what changed." },
    { at: 69.4, to: 73.2, text: "What stayed the same goes dark." },
    { at: 73.5, to: 80.0, text: "The divider swept to the edge: 2016 on its own, the blend left in a strip." },
  ],
}

export const demo5Duration = () => TITLE + takeFrames(BASIC) + CARD + takeFrames(HISTORICAL) + OUTRO - 4 * TRANSITION

const crossFade = () => <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />

export const Demo5: React.FC = () => (
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
