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
  in the thread, not a middle frame; the frame is optional. In the parent's
  reply to Jonathan, write the absolute path in plain text too: a bare
  <video> tag showed him nothing in T3 (2026-10-09).
- Added 2026-10-09 after take three: **FHD** (1920x1080); **keep Hillshade
  on** under slope or any mode (slope alone looks wrong); the cursor must
  be the **real Windows cursor** (C:\Windows\Cursors\aero_arrow.cur
  converted to PNG with Pillow, 32 px at FHD), not a drawn arrow; tooltips
  are fine; a slope take ends with the max at 90 degrees, then Elevation
  Hypso joins.
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

## The fourth take (2026-10-10, production, FHD): the current base

.cache/recordings/basic-modes-v4-2026-10-09.mp4 (1920x1080, 30 fps, 18.4 s,
551 frames), scripts take-v4.sh and take-v4.mjs: hillshade kept on, pan,
Terrain Analysis, its go-to arrow, Slope Range max to 90 then min to 10,
a wheel scroll of the sidebar back to the top, Elevation Hypso, a scroll-zoom.
- **Cursor:** aero_arrow.cur holds 5 frames (128..32 px), all hotspot 0,0.
  Pillow opens only the 128 px one: slice the 32 px entry out of the ICO
  directory into a one-entry ICO, convert to PNG (aero_arrow.png and .b64
  next to the scripts), inject as an <img> 32x32 at (clientX, clientY).
  The arrow itself is 12x19 px inside the 32 px frame, as on Windows at 100 %.
- `set viewport 1920 1080` gives DPR 1 and 1920x1080 screencast frames;
  capture.mjs needed no change.
- Dragging any slider makes the side panel see-through (the app's
  transparentUiAtom): the map shows through the sidebar during the drag.
  Expected app behaviour, not a capture glitch.
- With the slope max at 90 the slope tint over hillshade becomes faint.
- Evaluating element positions mid-take (the slider thumbs, the hypso box
  after the scroll) costs ~0.3 s of pointer stillness each; keep them few.

## The fifth take (2026-10-10): basic-modes-v5-2026-10-10.mp4, take-v5.sh/.mjs
- A "go to" arrow smooth-scrolls the sidebar for ~0.5-0.8 s: positions read during it are wrong (the slope drag missed, the ramp select never opened). Poll until two reads agree (`settled()` in take-v5.mjs), started un-awaited while the pointer drifts; rehearse the choreography once without capture (rehearse-v5.sh) before a recording run.
- Hypso ramp bounds differ widely (bcyr, elevation, Sunset_Real are 0..100, usgs 0..1): pick one in metres for a bounds drag (GMT_globe -10000..10000, ETOPO1 -11000..8500). The URL `colorRamp` takes the lowercased key (`gmt_globe`), not the label.

## Where the reference take lives (2026-10-10)

Take five is the reference for automated takes. Its scripts are tracked in
`video/takes/basic-modes-v5/` (take-v5.sh, take-v5.mjs, rehearse-v5.sh,
aero_arrow.b64/png, a README on how it ran); the MP4 is an asset of the
GitHub release `demo-takes` on Iconem/terrain-viewer, and a copy sits in
the main checkout's video/recordings/ (ignored). Known gap: the injected
cursor never changes shape (no hand over buttons and links); swapping the
image from the computed `cursor` style under the pointer would fix it.

## The historical take (2026-10-10): historical-grid-2026-10-10.mp4, take-hist.sh/.mjs
- A historical view goes white until its date's tiles load: dragging a timeline handle across many ticks left a view white ~6 s, and zooming out a 3x2 grid showed white gaps. Click only ticks whose dates were warmed through the URL in the prep, and zoom in rather than out (the parent tiles cover it). A handle's new date reaches the URL ~0.5 s after the release; wait for it before "Sort views by date", or the sort click is lost.

## The second historical take (2026-10-10): historical-grid-v2-2026-10-10.mp4, take-hist2.sh/.mjs
- URL keys: the terrain per view is `terrainSourceA..H` (state `sourceA..H`; `terrainSourceX=mapterhorn` on all views keeps the terrain name off the pills); the overlay blend is the `splitBlendModeEnabled` switch over `splitBlendMode` (default `difference`, so flipping the switch is enough); `matchColorsToA` works in side-by-side grids too, not only overlay. Switches: `label[for=<id>]`, then `[data-slot=switch]` in its `.justify-between` row.
- Each layout change (Side 3x1, 3x2, the sort, the overlay after the grid) whitens the newly shown or resized views for 0.2-1 s while their tiles fade back in, even with the tiles in the HTTP cache. Warming inside the same page (`history.pushState` + `dispatchEvent(new PopStateEvent("popstate"))` drives nuqs without a reload) did not remove the flashes, and it kept every map mounted, so the renderer slowed the CDP-driven take by 8 s. Warm through separate page loads instead.

## Remocn cuts follow the slide decks' look (Jonathan, 2026-10-10)

The first cut (video/src/Demo2.tsx) used dark frosted caption cards and
blurred white titles on black. Jonathan prefers the simplicity of the
open-slide decks (slides/slides/*/index.tsx, the shared "deck kit"): follow
it in every cut.
- **Palette:** white background #ffffff, text #0a0a0a, soft #404040, muted
  #6b6b6b, rules #e4e4e4, panel #f7f7f7, one accent #1A237E (light
  #3F51B5). No gradients, no blur backdrops, no shader backgrounds.
- **Type:** Geist (fallback Inter, system-ui); display weight 500, letter
  spacing -0.01em; a mono eyebrow in small caps (20 px, 0.08em) for labels
  like "TERRAIN VIEWER · HISTORICAL IMAGERY".
- **Title and outro cards:** white, the deck's hero scale (the title at
  about 120 px, a one-line subtitle at 32 to 40 px in muted), a hairline
  rule, the accent only on one word or the rule. A plain fade, no
  FocusBlurResolve.
- **Captions on the takes:** a white panel (#ffffff at 0.92, hairline border
  #e4e4e4, radius 12, padding 14 x 24) with dark text at 36 to 40 px,
  weight 500, lower third over the map, never over the sidebar or the
  timeline; one line each; StaggeredFadeUp by word is fine, kept subtle
  (distance 8, stagger 2).
- **Transitions:** a short cross-fade or a plain cut, not focus pulls.
- **Footer line** on cards, mono, muted: "terrain viewer · <deck> ·
  <site>", as the decks do.

## The third historical take (2026-10-10): historical-grid-v3-2026-10-10.mp4, take-hist3.sh/.mjs
- Side 2x1 straight to 3x2 (no 3x1 in between) shows four new views at once: D-F stayed white ~1.5 s in the capture although that exact grid was warmed by a page load; v2's 3x1 step spread the same whitening over two changes. If a take needs the 3x2 to appear clean, go through a 3x1 or keep the pointer busy elsewhere for that second and a half.

## The sixth take (2026-10-10): basic-modes-v6-2026-10-10.mp4, take-v6.sh/.mjs (take five plus the Data layers picker)
- After take five's hypso "go to" the Visualization Modes heading (and its Layers button) has scrolled out of the sidebar; the picker opened from the panel title bar's Layers copy. Warm the picker's 19 pictures with a page load on `?openDataLayers=true` and `img.loading = "eager"`; its scroll range at FHD is only ~636 px, so a 7 s wheel is slow and smooth.
- Closing it with Escape hands focus back to the Layers button after the close animation, and its tooltip (delay 0) reopens and stays to the last frame. Blurring `document.activeElement` for 180 ms right after the Escape did not help (focus returns later). Untested next try: wait until the dialog element is gone plus ~300 ms, then blur.
