import { Composition } from "remotion"
import { Demo, demoDuration, FPS, type DemoProps } from "./Demo"
import clips from "../public/clips.json"

// The clips' lengths in frames, written by scripts/prepare-clips.mjs from
// ffprobe after recording.
const props: DemoProps = { paperFrames: clips.paperFrames, isolineFrames: clips.isolineFrames }

export const Root: React.FC = () => (
  <Composition id="Demo" component={Demo} width={1920} height={1080} fps={FPS} durationInFrames={demoDuration(props)} defaultProps={props} />
)
