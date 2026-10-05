# Terrain Viewer demo videos

A Remotion workspace (its own install, outside the pnpm workspace, like `slides/`):
takes of the app recorded by an agent with agent-browser, cut with Remocn motion
components into a 1080p demo.

```bash
cd video
pnpm install --ignore-workspace
pnpm record        # agent-browser drives the app on :5204; takes land in recordings/
pnpm clips         # scale the takes to 1080p/30 fps into public/, write public/clips.json
pnpm studio        # Remotion Studio, to edit and preview
pnpm render        # out/terrain-viewer-demo.mp4
```

- `scripts/record.sh` drives headless Chrome on the real GPU (`--args --use-angle=d3d11`)
  and captures frames over the DevTools protocol with `scripts/capture.mjs`.
  agent-browser's own `record` was not usable for map scenes on this machine (see
  `.claude/memory/agent-browser-recording.md`).
- `src/Demo.tsx` is the cut: title, the two takes with captions on the clicks,
  focus-pull transitions, outro. Each take's in-point, speed and click times are at the
  top of the file; change them after a new recording.
- `src/components/remocn/` holds the Remocn components, copied in with
  `npx shadcn@latest add @remocn/<name>` (registry in `components.json`). They are ours
  to edit: `StaggeredFadeUp` and `FocusBlurResolve` gained an `inline` mode (they ship
  as full-frame scenes) and a word split.
- fframes (Rust, GPU, no browser) was not tried: on Windows it needs a shared
  FFmpeg 9 build, LLVM and Vulkan.
