# Take five: slope and hypsometric tint over Mont Blanc (2026-10-10)

The reference take for automated screencasts: 29.2 s, 1920×1080, 30 fps, recorded on
the production site by a delegated agent. The MP4 is on the `demo-takes` GitHub release.

## What it shows

Mont Blanc in 2D with the hillshade on for the whole take: a slow pan; Terrain
Analysis ticked and its "go to" arrow; the Slope Range maximum held and swept down
to about 28° and back, released at 60°, the minimum untouched; the sidebar wheeled
back to the top; Elevation Hypso ticked and its "go to" arrow; the ramp select
opened and GMT_globe picked (a ramp whose bounds are in metres); the Min/Max
elevation thumbs dragged from 0–8100 m to 1400–4300 m; a scroll-zoom into the map.

## How it ran

- `take-v5.sh`: the agent-browser driver (session `tv-basic5`, Chrome launched on the
  real GPU with `--use-angle=d3d11,--ignore-gpu-blocklist,--enable-gpu-rasterization`,
  viewport 1920×1080 so the screencast frames are FHD at device pixel ratio 1).
  It writes localStorage from `/robots.txt` (a same-origin non-app URL, because the
  app overwrites its storage on first load), warms the slope tiles by opening the
  views the take will visit, opens the start URL, closes the extra `chrome://newtab`
  tab, then starts `video/scripts/capture.mjs` (a DevTools screencast written as
  frames and assembled with ffmpeg) and runs `take-v5.mjs`.
- `take-v5.mjs`: the pointer and the actions over the DevTools protocol: eased,
  slightly curved moves at about 60 steps a second; clicks on the real controls;
  slider drags as press, move, release; wheel events sent without awaiting each one.
  It injects the cursor, an `<img>` at the top layer holding the Windows arrow
  (`aero_arrow.b64`, the 32 px frame cut out of `C:\Windows\Cursors\aero_arrow.cur`,
  hotspot at the tip), moved on every pointer step. After a "go to" click the
  sidebar smooth-scrolls for up to 0.8 s, so element positions are re-read until two
  reads agree before the next action, while the pointer keeps moving.
- `rehearse-v5.sh`: the same run without capture, to catch wrong positions before
  spending a recording run.

Lessons and traps are in `.claude/memory/agent-browser-recording.md` and on the docs
page Demo videos. Paths inside the scripts point at the worktree they ran from;
adjust `ROOT` and `OUT` before reuse.
