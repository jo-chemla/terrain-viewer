---
name: agent-browser-recording
description: Recording app demos with agent-browser on this Windows laptop - why `record` fails on map scenes, the CDP capture workaround, and the setup traps (storage, Git Bash paths, pipes, slow IIIF hosts)
type: project
---

# Recording demos with agent-browser (2026-10-05)

`video/scripts/record.sh` drives the app with agent-browser 0.38 (pinned in
`video/`) and captures with `video/scripts/capture.mjs`.

**`record start` does not work for map scenes here.** It pipes CDP screencast
JPEGs into ffmpeg (`image2pipe`, already `-preset ultrafast`) and drops the whole
take with "Recording encoder fell more than 500 ms behind capture". It failed at
30, 20, 15 and 12 fps, with and without `--cursor`, at 1600x900 and 1280x720,
even for a one-second take of an idle page showing the warped atlas; it worked
for example.com and for imagery-only scenes. Not the Scoop ffmpeg shim, not a
cold ffmpeg start. **Workaround:** `capture.mjs` attaches to the same Chrome
(`agent-browser get cdp-url`), runs `Page.startScreencast`, writes frames with
their timestamps and assembles them afterwards (concat demuxer with per-frame
durations, `fps=30`). Chrome only sends a frame when the page changes, so a take
is ~20-70 frames; that is fine.

**Why:** the user asked for demo videos made by agents (agent-browser plus a
motion layer); this is what made it work.

**How to apply / traps:**
- GPU: launch with `--args "--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization"`;
  the default headless launch renders WebGL on SwiftShader.
- Write localStorage from a same-origin non-app URL (`/@vite/client`): the app
  saves its own defaults on first load and overwrote the setup.
- Base UI checkboxes put the `id` on a hidden input: click `label[for=...]`.
- Git Bash rewrites arguments starting with `/` into Windows paths: export
  `MSYS_NO_PATHCONV=1`. Never pipe agent-browser output (`| tail`): the daemon
  the first command spawns inherits the pipe and the shell never sees EOF.
- `--find text … scrollintoview` is not an action; use `hover`.
- MapLibre custom layers (Allmaps) are not in `getStyle().layers`; check with `map.getLayer(id)`.
- Rumsey's IIIF server takes ~2 s a tile: frame the whole sheet (zoom 13.25 for
  the Paris atlas) and pre-roll 45 s. Leiden's IIIF host refused connections.
- Remocn components (`npx shadcn add @remocn/<name>`, registry
  `https://remocn.dev/r/{name}.json`) ship as full-frame scenes with their own
  background; `StaggeredFadeUp` splits per character. Our copies have `inline` and
  `by="word"`. Remotion needs `Config.setChromiumOpenGlRenderer("angle")` for the
  shader backdrops and a `type` (not `interface`) for composition props.

## Feedback on the first delegated screencast (2026-10-09)

A T3 subagent (Opus 5.5) recorded a 27 s take of hillshade to slope over
Mont Blanc with this pipeline (.cache/recordings/basic-slope-2026-10-09.mp4,
its script take-slope.sh). Jonathan: a nice first try, but too static.
**Next time:** about 15 s; keep the camera moving (a slow pan or zoom, a
pitch into 3D) rather than holding a frame; show the cursor (capture.mjs
has no cursor layer: draw one from the pointer position, or move the mouse
in visible steps and overlay a cursor in Remotion); and no dev widgets
(the FPS counter, the TanStack devtools button, the notification bell):
record against a production build (pnpm build, serve dist) or hide them
with a CSS injection before the take.
