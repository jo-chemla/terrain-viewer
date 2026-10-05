# How the first demo video was made, and what to do differently

A trace of the 2026-10-05 attempt, so the next one starts from the lessons
and not from scratch. The result (`out/terrain-viewer-demo.mp4`, 48 s) was
judged not great; the pipeline is what is worth keeping.

## What was built, in order

1. **Takes with agent-browser** (`scripts/record.sh`). Headless Chrome driven
   by the CLI: open a URL with the app state in it, click the real controls,
   wait. Six attempts before a take came out:
   - The app overwrote the localStorage I had set (write it from a
     same-origin page that is not the app, `/@vite/client`).
   - Base UI checkboxes hide the input: click `label[for=…]`.
   - Headless Chrome rendered WebGL on SwiftShader; `--args
     "--use-angle=d3d11,--ignore-gpu-blocklist"` puts it on the GPU.
   - **agent-browser's `record` dropped every map take** ("encoder fell more
     than 500 ms behind capture"), at 30, 20, 15 and 12 fps, 1600×900 and
     1280×720, with and without `--cursor`, even a one-second take of a static
     page showing the atlas. It records simple pages fine. Not fixable from
     outside (the ffmpeg call is baked in, already `-preset ultrafast`).
   - Replacement: `scripts/capture.mjs` attaches to the same Chrome over the
     DevTools protocol (`agent-browser get cdp-url`), `Page.startScreencast`,
     writes the frames with timestamps, assembles them afterwards with the
     concat demuxer. Chrome sends a frame only when the page changes: a take
     is 20-70 frames, which is right for an interface demo.
   - Rumsey's IIIF server takes ~2 s a tile: frame the whole sheet and
     pre-roll 45 s. Git Bash rewrote `/…` arguments into Windows paths
     (`MSYS_NO_PATHCONV=1`); piping agent-browser output hung the daemon.
2. **Motion design with Remotion and Remocn** (`src/Demo.tsx`). Remocn
   components arrive through the shadcn CLI (`npx shadcn add
   @remocn/<name>`, registry `https://remocn.dev/r/{name}.json`; the list is
   in the repo's `registry/remocn/registry.json`, 180 items, plus five
   templates). They ship as full-frame scenes with their own white
   background and split text per character: our copies gained an `inline`
   mode and a word split. Remotion needs `Config.setChromiumOpenGlRenderer("angle")`
   for the shader backdrops. `scripts/prepare-clips.mjs` scales the takes
   to 1080p and writes their lengths; each take's in-point, speed and the
   seconds of its clicks are constants at the top of `Demo.tsx`.
3. Render: `pnpm render` → `out/terrain-viewer-demo.mp4` (about 3 min).

About 300k tokens went into the recording loop, most of it on the encoder
problem and on finding an Allmaps map that loads in reasonable time.

## What was wrong with the result

- The content: two features (paper removal, iso-line) rather than a generic
  introduction of Terrain Viewer. The brief should have been the slide
  deck's story (what it is, sources, modes, historical, tools), in video.
- The takes are flat: a fixed view, a click, a wait. Camera moves (fly-to,
  tilt, a slow pan) and cuts between places are what make a map demo.
- Captions as the only motion; no voice, no music.

## Next time

- **Rushes by hand, or by a dedicated agent**, from a shot list: a fly-in,
  a tilt to 3D, a mode switched on, a split dragged, the timeline scrubbed.
  The app has `?animate=` camera animations and the Animation section;
  a script that drives them through the dev hook (`window.__tv.state`,
  `setState`) and `capture.mjs` would give moving rushes without a human.
  Record at 1920×1080 directly.
- **Story from the slides**: one deck page = one scene, the deck's titles as
  the captions.
- **Motion**: keep Remocn for text (titles, lower thirds, transitions). Try
  fframes for the title and end cards (Rust + SVG on the GPU, no browser;
  on Windows it needs LLVM, Vulkan and a shared FFmpeg 9 build) and cut the
  rushes in Remotion or with ffmpeg.
- Voice: a TTS track from the captions, or none and music only.
