// The third 2026-10-10 demo, in the slide decks' look, with Demo3's cards and
// caption panel: take seven of the basic modes over Mont Blanc (video/takes/
// basic-modes-v7) and the fourth historical grid take over the Champ de Mars
// (video/takes/historical-grid-v4), both paced for subtitles. The captions are
// a narrator's sentences, 4 to 6 s each, starting a beat before the action;
// cards of about 4 s; takes at 1x; 12-frame cross-fades.
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
  src: "clip-basic-v7.mp4", in: 0.3, out: 50.35, spot: { x: 760, bottom: 90 }, beats: [
    { at: 0.4, to: 4.6, text: "Mont Blanc in 2D, with a hillshade." },
    { at: 5.0, to: 9.8, text: "We add slope over the hillshade." },
    { at: 10.2, to: 16.2, text: "Then narrow its range to 60 degrees." },
    { at: 19.8, to: 25.8, text: "Now the hypsometric tint, with another ramp." },
    { at: 28.4, to: 34.2, text: "Its bounds pulled in to 1,400 and 4,300 metres." },
    { at: 36.6, to: 41.0, text: "A scroll zooms in." },
    { at: 41.6, to: 46.6, text: "Every visualization mode, as a card.", spot: { x: 940, bottom: 6, size: 36 } },
    { at: 46.8, to: 50.35, text: "Each with a picture and a line of text.", spot: { x: 940, bottom: 6, size: 36 } },
  ],
}

// The timeline covers y ≥ 900: captions sit above it. The two white refills
// (3x2 at 36.2..37.7 s, overlay at 68.5..70.0 s) play under a caption already up.
const HISTORICAL: Take = {
  src: "clip-historical-v4.mp4", in: 0, out: 80.6, spot: { x: 760, bottom: 230 }, beats: [
    { at: 0.5, to: 6.5, text: "The Champ de Mars on Esri Wayback, October 2024." },
    { at: 6.8, to: 12.6, text: "A swipe against Bing: two dates on one map." },
    { at: 13.0, to: 18.8, text: "The divider runs left, right, back to the centre." },
    { at: 21.0, to: 27.0, text: "Three more dates from the timeline: 2013, 2017, 2025." },
    { at: 34.2, to: 40.0, text: "Six dated views in a grid." },
    { at: 41.8, to: 46.8, text: "A view re-dated by its timeline handle." },
    { at: 47.2, to: 51.4, text: "And another, to Wayback 2024." },
    { at: 51.6, to: 56.4, text: "Sort views by date." },
    { at: 56.6, to: 62.4, text: "Match Colors brings them to one palette." },
    { at: 62.6, to: 67.4, text: "Off, then on again, to compare." },
    { at: 68.0, to: 74.0, text: "Difference blend shows what changed." },
    { at: 74.4, to: 80.2, text: "What stayed the same goes dark." },
  ],
}

export const demo4Duration = () => TITLE + takeFrames(BASIC) + CARD + takeFrames(HISTORICAL) + OUTRO - 4 * TRANSITION

const crossFade = () => <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />

export const Demo4: React.FC = () => (
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
