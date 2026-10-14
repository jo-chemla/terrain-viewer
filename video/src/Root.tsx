import { Composition } from "remotion"
import { Demo, demoDuration, FPS, type DemoProps } from "./Demo"
import { Demo2, demo2Duration } from "./Demo2"
import { Demo3, demo3Duration } from "./Demo3"
import { Demo4, demo4Duration } from "./Demo4"
import { Demo5, demo5Duration } from "./Demo5"
import clips from "../public/clips.json"

// The clips' lengths in frames, written by scripts/prepare-clips.mjs from
// ffprobe after recording.
const props: DemoProps = { paperFrames: clips.paperFrames, isolineFrames: clips.isolineFrames }

export const Root: React.FC = () => (
  <>
    <Composition id="Demo" component={Demo} width={1920} height={1080} fps={FPS} durationInFrames={demoDuration(props)} defaultProps={props} />
    {/* 2026-10-10: basic modes v5 and the historical grid, 1x, in- and out-points in Demo2.tsx. */}
    <Composition id="Demo2" component={Demo2} width={1920} height={1080} fps={FPS} durationInFrames={demo2Duration()} />
    {/* 2026-10-10, second cut: basic modes v6 and historical grid v3, 1x, in the slide decks' look; in- and out-points in Demo3.tsx. */}
    <Composition id="Demo3" component={Demo3} width={1920} height={1080} fps={FPS} durationInFrames={demo3Duration()} />
    {/* 2026-10-10, third cut: basic modes v7 and historical grid v4, 1x, narrator subtitles; in- and out-points in Demo4.tsx. */}
    <Composition id="Demo4" component={Demo4} width={1920} height={1080} fps={FPS} durationInFrames={demo4Duration()} />
    {/* 2026-10-14, fourth cut: basic modes v8 and historical grid v5 (after the see-through fix), the divider sweep at the end; in- and out-points in Demo5.tsx. */}
    <Composition id="Demo5" component={Demo5} width={1920} height={1080} fps={FPS} durationInFrames={demo5Duration()} />
  </>
)
