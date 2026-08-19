---
name: screenshots-context
description: Real headless-Chromium screenshot capture for docs — Playwright setup, gotchas, URL conventions, and history of the docs-update screenshot passes
metadata:
  type: project
---

This repo's docs (`docs/content/docs/**/*.mdx`) use real screenshots of the live
prod app (`https://terrain-viewer.iconem.com/`), captured via a throwaway
Playwright install (not a repo dependency) driving real headless Chromium.
This file is the durable reference for doing that again — conventions, known
gotchas, and a history of what's been captured/fixed across sessions. See
`.claude/CLAUDE.md` for the rest of the app's architecture.

## Why not the built-in agent preview browser

The preview browser available to agents never fires `requestAnimationFrame`,
so MapLibre never loads a style there (see `.claude/CLAUDE.md`). Real headless
Chromium via Playwright is the only way to get real screenshots of this app.

## Setup

Playwright isn't installed in the repo and shouldn't be added as a dependency
just for this — every session does a throwaway `mkdir /tmp/pw-XXX && npm init
-y && npm install playwright@1.48` (the Chromium binary itself caches under
`~/AppData/Local/ms-playwright`, so repeat `npm install` calls after the first
are fast).

Seed `localStorage` via `page.addInitScript`, **before** `page.goto`, hitting
the real prod URL directly — don't run the dev server for screenshots, prod
is simpler and matches what ships. Keys commonly used: `hasSeenTour`,
`isSidebarOpen`, `sectionOpen` (JSON, shape below), `vizModePinned`,
`bookmarksListHeight`, `bookmarks` (only if pre-seeding rather than creating
via real UI interaction).

```js
const SECTION_DEFAULTS = {
  general: true, comparisonMix: false, visualizationModes: true, download: false, bookmarks: false,
  terrainSource: false, hillshade: false, lightingEffects: false, hypsometricTint: false,
  terrainAnalysis: false, reliefVisualization: false, tellsDetector: false, rasterBasemap: false,
  contour: false, background: false, drawing: false, elevationPicker: false, sunShadowCalculator: false,
  animation: false, sourceInfo: false, footer: false,
}
```
Override just the one section that should be open per shot.

Screenshot convention: `viewport: {1920, 1080}, deviceScaleFactor: 2` → 3840×2160
JPEG output, `quality: 92`. Matches every existing screenshot in the repo —
don't deviate without a reason.

## Gotchas (all confirmed this session, not theoretical)

- **`splitStyle` valid values are `"off" | "overlay" | "side-by-side"`** — NOT
  `"side"`. An invalid value silently falls back to `"off"` with no error,
  producing a wrong single-pane screenshot. Source of truth: `SPLIT_STYLES` in
  `lib/grid-layouts.ts`.
- **`matcapRenderer` must be `"raster"` for headless screenshots** — the
  default `"live"` (real-time WebGL) renderer renders blank in headless
  Chromium.
- **WebGL context exhaustion across many sequential `page.newPage()` calls in
  one long-lived browser.** Reusing a single `chromium.launch()` across ~20
  sequential shots produced intermittent, non-deterministic totally-blank
  canvases starting partway through the batch (not always the same shot —
  flaky) — almost certainly headless/software-GL Chromium's WebGL context
  limit, since `page.close()` doesn't synchronously release the GPU context.
  **Fix: launch a fresh `chromium.launch()` + `browser.close()` per shot**
  when running more than a handful of shots back-to-back. Costs more
  wall-clock but is reliable.
- **`waitUntil: "networkidle"` times out (60s) on historical/Wayback-heavy
  shots** — the historical timeline machinery keeps some background polling
  alive that never goes fully idle. Use `waitUntil: "load"` instead, then a
  fixed `page.waitForTimeout(...)` after. Wrap `goto()` in try/catch
  regardless so one bad shot doesn't crash a whole batch script.
- **Run screenshot batches as a single process/agent, not several concurrent
  Playwright processes.** Running multiple batches in parallel (e.g. via
  several background Bash tasks at once) starved individual shots of
  CPU/network and produced incomplete-tile-load screenshots (BYOD, Terrain
  Sources) even with otherwise-generous waits. One script, one process, run
  to completion, then the next.
- **SVF/Openness's ray-marched per-tile computation can get permanently stuck
  at "Computing... (0/16 tiles)"** in headless Chromium — confirmed across
  ~6 attempts (75s waits, polling for the badge to disappear — which falsely
  reported done at least twice while still visibly stuck — forcing Precision
  from "Precise" to "Fast", whose toggle click itself timed out waiting for
  the element to be "stable"). Every other mode (hard-shadows, LRM, curvature,
  TPI, phong) completed fine at similar or shorter waits, so this looks
  specific to SVF/Openness — working theory is a Worker/GPU-readback path
  that doesn't execute under headless Chromium's software (SwiftShader)
  rendering, not an app bug. If you hit this again: try
  `chromium.launch({ headless: false })` with a virtual display, explicit
  `--use-gl=swiftshader`/`--enable-webgl` flags, or `channel: "chrome"` (real
  Chrome instead of bundled Chromium) — none of these were tried yet.
- **The `svg.lucide-mountain-snow` selector for the hypso auto-min/max button
  is ambiguous** — there are two MountainSnow icons in the DOM (one in the
  Download/Snapshot section's "Export Contours" button, one in the real
  Hypsometric-Tint auto-set button). `.first()` can resolve to the wrong
  (possibly hidden/collapsed) one and time out. **Fix: scope the selector to
  `#tour-hypso-section svg.lucide-mountain-snow`** — the `Section` wrapper
  around Hypsometric Tint options has a stable `id="tour-hypso-section"` (see
  `components/TerrainControlPanel/hypsometric-tint-options-section.tsx`
  around line 320). The same pattern — scoping into a section's stable
  `id="tour-*-section"` — is worth reaching for on any similar icon-collision;
  check `TerrainControlPanel.tsx` for which sections have one.
- **The bookmark "add child" `+` button (`svg.lucide-plus.h-4`)** worked
  reliably for ~9 sequential bookmark saves but timed out once, for no
  identified reason (possibly a transient render/animation timing issue, not
  selector ambiguity — there's only one `+` per project row). Wrap in
  try/catch so a batch degrades gracefully rather than crashing.
- Bookmarks should be created via **real UI interaction** (click "Save View",
  wait ~7s for the geocode+thumbnail, then click the child project's `+`
  button and wait ~4.5s per child) — not by seeding the `bookmarks`
  localStorage key with fake JSON directly. The app's own reverse-geocoded
  names (e.g. "Chile - Torres del Paine", "Italia - Valtournenche") are real
  and worth having in the docs rather than made-up labels.
- **Image + caption `<p>` in `.mdx` files must have a blank line between
  them.** Without one, remark/mdast folds the caption's JSX `<p>` into the
  *same* paragraph node as the image instead of treating it as its own
  flow-level block, producing invalid nested `<p><p>...</p></p>` markup and a
  client hydration mismatch on that page. This was a real, sitewide,
  previously-unnoticed bug (fixed across 12 files in one pass) — keep the
  blank line on every new image+caption pair or it silently reappears.
  Verify with a real headless-browser console-error sweep, not `curl` (curl
  never executes JS, so it can never detect a hydration error).

## URL / nuqs conventions for reproducible screenshots

Every screenshot I (an agent) produce should be reproducible by URL — see
`docs/src/components/viz-mode-grid.tsx`'s `href` field and the "open in app
↗" links appended to captions across `visualization-modes.mdx`,
`split-modes.mdx`, etc. Two categories are deliberately NOT linked:

- **Non-reproducible-by-me images** (sourced from the user's own Twitter
  posts or otherwise not captured via a URL this session) — don't fabricate
  a URL for these.
- **Dialog-open screenshots where the dialog state isn't in the URL** (e.g.
  the terrain-source info dialog, the Add-New-Terrain-Dataset dialog) — link
  the base camera location if useful, but don't claim the dialog itself is
  reproducible.

The shared lightbox (`docs/src/components/lightbox.tsx`) shows a title above
the enlarged image, clickable through to that URL when present — reads
`data-lightbox-title`/`data-lightbox-href` if the marking `<img>` sets them
explicitly (used by `viz-mode-grid.tsx`, whose own label link precedes the
image rather than following it in a caption), else falls back to the image's
`alt` text for the title and to an `<a href>` found inside the very next
sibling `<p>` (the caption convention used everywhere else in the docs) for
the link.

## History (may be stale — check git log for current state)

**docs-update branch**, chronological:

1. First screenshot pass (`30bccb7`) — initial viz-modes grid, Split Modes +
   Frescoes pages, captions.
2. App fixes (`9d521fb`) — historical-hostname default view, Open-in Google
   3D, GDAL tab syntax, CRLF frontmatter-strip regex bug (both
   `docs/src/components/visualization-modes-description.tsx` and
   `lib/shared-docs.ts` had `/^---\n.../`, which silently failed on this
   Windows checkout's CRLF `.mdx` files).
3. Screenshot re-pass (`8ceb1df`) — re-shot everything at `exaggeration=1`
   (was accidentally 1.5), hypso auto-min/max click, contours top-down, split
   off/overlay redone, historical grid moved to Paris/Île de la Cité to show
   GE Historical's coarse resolution, new blend-modes section (Normal
   100/50%, Multiply, Difference), matcap set to a reddish material, prod-URL
   links added to every self-produced screenshot, new bookmark set
   (Matterhorn/Patagonia/Grand Canyon). SVF/Openness left stale (see gotcha
   above) rather than overwritten with blank captures.
4. Merge (`d43b90f`) of `origin/t3code/run-docs-server` — user's own shared
   `LightboxProvider` (`lightbox.tsx`, new file) giving every docs image
   click-to-zoom with looping left/right arrow-key navigation, replacing two
   near-duplicate per-component lightbox implementations. One conflict in
   `viz-mode-grid.tsx` (resolved keeping both the `href` label-link feature
   and the new `data-lightbox` mechanism).
5. Hydration fix (`dbe438d`) — see gotcha above.

If you're reading this expecting exact current URLs/params per screenshot,
don't trust anything beyond point 3 above as still-current — check the actual
`.mdx` files' `href`/`data-lightbox-href` values and `git log` instead; this
file documents technique and gotchas, not a live snapshot of every screenshot's
exact state.
