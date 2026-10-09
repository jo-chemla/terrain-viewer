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

## The second delegated take (2026-10-09): what worked

.cache/recordings/basic-slope-v2-2026-10-09.mp4 (16.8 s, 505 frames), scripts
take-v2.sh and take-v2.mjs next to it. Reusable parts:
- **Cursor:** a 20 px SVG arrow injected at the top layer (pointer-events
  none) following mousemove; the pointer driven over CDP in ~60 small steps
  a second along slight arcs, so every move shows.
- **Vite reload mid-take:** the first toggle of a mode Vite had not bundled
  yet forces a full reload (run 1 lost). Load every mode the take uses once
  before recording, or record a production build.
- **Dev widgets:** React Scan's toolbar (FPS counter, bell) hides with CSS on
  `#react-scan-root` and its overlay canvas; the TanStack devtools button is
  a div added later under <body>, missed by a top-level-only observer, so
  watch every added div, or hide by its text/aria, or use a production build.
- Hover tooltips flash as the pointer crosses the modes list; route the
  pointer around the labels or pause under one on purpose.
- The take and capture scripts must not share a log file (lines lost).

## Standing instructions for screencasts (Jonathan, 2026-10-09)

- **Record the production site** (https://terrain-viewer.iconem.com) unless
  told otherwise: a dev server reloads under other agents' edits and on
  Vite's late bundling, and shows dev widgets.
- No pauses: keep something moving the whole take (camera, pointer, a
  control). Cursor motion natural: eased, slightly curved, varied speed,
  no straight constant-speed lines. The cursor drawn by the injected arrow
  looked odd: use a standard arrow cursor image (a plain black arrow with
  a white outline, 16 to 20 px, hotspot at its tip).
- The subagent's report puts the **video path** (the MP4) first, as a link
  in the thread, not a middle frame; the frame is optional.
- The Vite mid-take reload was the node-polyfill shims being bundled on a
  mode's first toggle; vite.config.ts now pre-bundles them
  (optimizeDeps.include), so a dev take no longer needs the warm-up.

## The third take (2026-10-09, production site): the base to reuse

.cache/recordings/basic-modes-v3-2026-10-09.mp4 (16 s, 480 frames), scripts
take-v3.sh and take-v3.mjs next to it: pan, tick Terrain Analysis, untick
Hillshade, the mode's "go to" arrow, a slider drag (Slope Range), a
scroll-zoom; eased curved pointer, a 12x19 px arrow cursor. Start from
these scripts next time. Two more traps from its run 1:
- **capture.mjs attaches to the first page** when none is localhost:5204;
  agent-browser leaves a chrome://newtab tab first, so close the other
  tabs in the prep step or the capture records nothing ("no frames").
- **Do not await each wheel event** over CDP: waiting for Chrome's
  confirmation made a 2 s zoom take 6.6 s. Fire and forget.
- Chrome sends no frame for up to 0.3 s on a mode toggle or a slider
  press: brief holds in the video that are not pauses in the script.
