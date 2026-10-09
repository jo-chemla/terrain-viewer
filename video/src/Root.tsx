import { Composition } from "remotion"
import { Demo, demoDuration, FPS, type DemoProps } from "./Demo"
import { Demo2, demo2Duration } from "./Demo2"
import clips from "../public/clips.json"

// The clips' lengths in frames, written by scripts/prepare-clips.mjs from
// ffprobe after recording.
const props: DemoProps = { paperFrames: clips.paperFrames, isolineFrames: clips.isolineFrames }

export const Root: React.FC = () => (
  <>
    <Composition id="Demo" component={Demo} width={1920} height={1080} fps={FPS} durationInFrames={demoDuration(props)} defaultProps={props} />
    {/* 2026-10-10: basic modes v5 and the historical grid, 1x, in- and out-points in Demo2.tsx. */}
    <Composition id="Demo2" component={Demo2} width={1920} height={1080} fps={FPS} durationInFrames={demo2Duration()} />
  </>
)
