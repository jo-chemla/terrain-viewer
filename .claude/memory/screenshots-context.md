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

- **Local-only code changes (new `id`s, reordered tour steps, new URL params)
  must be captured from `http://localhost:5173/` (the Vite dev server), not
  prod** — prod only reflects what's actually deployed. Screenshots look
  pixel-identical either way (Playwright captures only the page viewport, not
  browser chrome/URL bar), so this is easy to forget. The dev server is
  noticeably slower to compile/hydrate on first navigation than prod's static
  build — give it a longer initial settle wait (~8s vs ~3.5s) before the
  first `waitForStep`-style assertion.
- **The Coachmark's "Next" button (`[data-tour-nav="next"]`) hangs Playwright
  on `.click()` with "waiting for scheduled navigations to finish"** — the
  click itself completes, but Playwright's post-click auto-wait never
  resolves, so every `.click()` call eventually times out (30s+) even though
  the tour visibly advances. **Fix: `.click({ noWaitAfter: true })`.** Do NOT
  paper over this with a retry loop — retrying a "failed" click here means
  the underlying click actually succeeded and a retry double/triple-fires it,
  silently skipping tour steps (confirmed: a 3x-retried click at step 8 left
  the app on step 11, having blown through 9 and 10 with no time for their
  viz modes to render). `force: true` alone does NOT fix this — the hang is
  after the click dispatches, not in the pre-click actionability checks.
- **Screenshots of tour steps that toggle a viz mode via the tour's own
  `onEnter` handler (Hypsometric, Terrain Analysis, Relief Visualization —
  see `prepareHypsoOnly`/`prepareTerrainAnalysisOnly`/
  `prepareReliefVisualizationOnly` in `product-tour.tsx`) render as a blank
  grayscale hillshade with none of the new layer's color if you screenshot
  right after the step-change assertion resolves.** Root cause: each of
  these `onEnter` handlers unconditionally re-sets the relevant `show*`
  fields fresh every time the step is entered — **pre-setting the equivalent
  URL param before `page.goto` does NOT help**, the handler stomps it anyway
  the moment the step is reached, so the render always starts from a cold
  toggle no matter what. The fix that actually works is a generous plain
  wait after the step is reached — 8-13s was enough in every case tried;
  a mouse-wheel nudge (`page.mouse.wheel(0,-3)` then `(0,3)`) sometimes helped
  but was not reliable on its own and is not required if the wait is long
  enough. GPU/WebGL launch flags (`--use-gl=angle`, `--enable-unsafe-swiftshader`,
  etc.) made no difference — this is a render-timing race, not a headless-GPU
  capability gap.
- **~50 orphaned `chrome.exe` processes accumulated over one session** from
  Playwright scripts that crashed via uncaught exception (every crash skips
  the script's own `browser.close()`). These don't show in the Bash tool's
  `ps aux` (msys-only process view) — check via PowerShell
  `Get-Process chrome`. Left unchecked they degrade every subsequent
  Playwright run (multi-minute stdout-flush delays, click timeouts) even
  though `Get-CimInstance Win32_Processor | Select LoadPercentage` reads 0%,
  so CPU-load monitoring alone won't catch this. **Clean up periodically**
  with `Stop-Process` filtered to `StartTime` after the session started —
  identify the user's real browser cluster first (its processes all share
  one much-earlier `StartTime`) and exclude it explicitly; never mass-kill
  `chrome.exe` without that check.
- **A backgrounded `node script.mjs > log.txt 2>&1 &` can fully buffer stdout
  for minutes** on this Windows/git-bash setup — lines only appear in bursts,
  not in real time, sometimes with 5+ minutes between flushes even though the
  script is actively progressing. Don't conclude a background run is stuck
  from a stale log alone; check `ps aux` for the process still being alive,
  and if you need real per-line diagnosis, run the script in the foreground
  through the Bash tool instead (which captures output live without the
  buffering) rather than continuing to poll a redirected file.

## Dev-only floating widgets (react-scan, TanStack Devtools) contaminate localhost captures

`src/main.tsx` mounts react-scan's toolbar and `<TanStackDevtools />` behind
`import.meta.env.DEV` — always on for `localhost:5173`, never present on prod.
Any screenshot captured from the dev server (necessary for local-only code
changes — see the earlier gotcha) shows their floating icons unless hidden.
Hide via a CSS injection right after `page.goto`, **not** an app code change
(keeps the dev experience untouched for real local development):

```js
const HIDE_DEVTOOLS_CSS = `#react-scan-root { display: none !important; } button[aria-label="Open TanStack Devtools"] { display: none !important; }`
await page.goto(url, { waitUntil: "load" })
await page.addStyleTag({ content: HIDE_DEVTOOLS_CSS })
```

`#react-scan-root` is a shadow-DOM host, safe to target directly. TanStack
Devtools has **no stable id** on its actual toggle button — `#tanstack_devtools`
is the (usually off-screen, `display:block` by default) drawer panel, not the
button; the button only carries a goober-hashed class. Its `aria-label="Open
TanStack Devtools"` is the one stable selector — use that, not the class.

## Coachmark tour dismisses on ANY interaction, not just clicks outside the card

Confirmed empirically: a real mouse drag on the map, a `canvas.click()` (even
`force: true`), and even a same-size `page.setViewportSize` round-trip (no
pointer event at all) all silently end the active tour step — the coachmark
card disappears and viz state resets, with no exception thrown, so a script
can easily keep "succeeding" while actually capturing a dead page. **Always
verify** with `page.getByText("STEP N OF total", { exact: true }).isVisible()`
after any nudge attempt during a tour-driven capture, not just after the
initial `waitForStep`. Only a `page.mouse.wheel(...)` zoom-in/out pair reliably
leaves the tour alone — but see the next gotcha for its limits.

**One unresolved case:** the walkthrough's "Color by Elevation" (Hypso) step
renders with only a band of terrain colored (typically near the top of frame)
and the rest staying plain gray hillshade, no matter how long you wait (tried
up to 90s) or how many wheel-nudge cycles you throw at it. A real pan
*does* force the full repaint, but real pans kill the tour (see above), so
there is currently no known fix that both keeps the tour overlay alive and
gets Hypso to fully paint in this specific capture path — Slope, Curvature,
TPI, LRM, and every other viz-mode-via-tour step render fine with the same
wheel-nudge treatment. Whatever's different about Hypso's color-relief source
specifically, it's a real, reproducible app-level quirk worth a from-scratch
investigation outside of screenshot-script tweaking, not a capture timing
issue. Current committed screenshot is the best achievable (tour intact,
partial coloring) rather than a fully-colored capture.

## Gallery component (hero + filmstrip)

`docs/src/components/gallery.tsx` shows a single large "hero" image (the
first item in each group) with a horizontally-scrollable filmstrip of every
item below it — not a grid of cards. The hero is deliberately **not** marked
`data-lightbox` itself; its `onClick` finds the filmstrip's own first
`[data-lightbox]` element and calls `.click()` on it directly. This avoids
creating two DOM entries for the same image in the shared lightbox's
`document.querySelectorAll('[data-lightbox]')` item list (which would break
clean prev/next counting) — only the filmstrip thumbnails carry the
`data-lightbox`/`data-lightbox-title`/`data-lightbox-href` attributes. Visible
on-page text labels were removed entirely (title lives only in the `title`
tooltip attr / lightbox title bar) — this was a deliberate fix for an earlier
grid-of-cards version where inconsistent 1-line vs 2-line label wrapping
broke row alignment. The component takes no `cols` prop (that was a
grid-only concept) — remove `cols={N}` from any `<Gallery>` call site.

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
6. Gallery redesign + tour reorder + screenshot fixes (`004cfbe`) — Gallery
   rewritten from grid-of-cards to hero+filmstrip (see dedicated section
   above); Coachmark Terrain Tools steps reordered (Hillshade → Hypso →
   Terrain Analysis → Relief Viz → Terrain Sources → Basemap → BYOD); new
   `?startTour=true` one-shot URL param; walkthrough screenshot set
   recaptured against the new order from `localhost:5173` (see the
   local-only-code-changes and onEnter-viz-toggle gotchas above — both
   discovered this pass after several failed attempts); historical 4×2 grid
   redone with source+date pills (`isComparisonMixAdvancedOpen` localStorage
   key + `showCaptureDatePill=source-date` URL param); Google Earth Web
   "Open in" destinations fixed against real user-captured URLs.
7. Elevation Picker/SVF/Hillshade/Matcap/Overlay redo, Open-In revamp, calendar
   year fix (`bbd10aa`) — SVF/Hillshade/Matcap recaptured at correct sidebar
   width scrolled to their own options section; Split Overlay redone with a
   real 10px drag-and-release nudge on each pane for gutter alignment;
   Elevation Picker scrolled so Tools sits under the scroll-fade; Open-In
   destinations reordered/renamed/two commented out, River-REM + Google Maps
   3D added; Datetime calendar caption drops the year.
8. Dev-tools-icon cleanup, tour pure-hillshade enforcement, camera-matched
   Overlay/Off pair, Open-In reorder — Open In reordered again (River-REM,
   Search-EO, ESRI Wayback, Maps, Earth Historical, Earth 3D, BBBike) and
   Google Maps entry shortened to "Google Maps 3D"; `product-tour.tsx`'s
   `terrain-section` step gained `onEnter: prepareHillshadeOnly` so Terrain
   Sources through Split Compare no longer carry over the previous step's
   viz mode; discovered and fixed the react-scan/TanStack-devtools icon
   contamination (see dedicated gotcha above) across the full Terrain-branch
   walkthrough set (17 screenshots) plus viz-modes hillshade.jpg; SVF/Phong/
   Matcap recaptured on the exact shared viz-modes camera (matcap's own
   close-up camera retired); Overlay redone with a longer settle wait and its
   exact post-nudge camera reused verbatim for Off so the two match pixel-for-
   pixel; blend-normal-100 redone with Compare-and-Blend + Advanced expanded;
   Mapterhorn terrain-source-info dialog redone at a zoomed-out Patagonia
   camera that avoids the DEM-strip artifact; Elevation Picker's scroll target
   changed from the Tools group to the Elevation Picker section itself so the
   Plane Slicer options are more visible.

If you're reading this expecting exact current URLs/params per screenshot,
don't trust anything beyond point 3 above as still-current — check the actual
`.mdx` files' `href`/`data-lightbox-href` values and `git log` instead; this
file documents technique and gotchas, not a live snapshot of every screenshot's
exact state.

9. Viz-modes recapture pass, ROOT-CAUSE of the recurring "hrefs match but
   captured file looks totally different" mystery, several new Playwright
   gotchas — **`https://terrain-viewer.iconem.com/` (the URL these captures
   use) is NOT built from `main`, it's a separate deploy that can lag the
   `docs-update` branch by several commits.** Confirmed directly: `git
   merge-base --is-ancestor <commit> origin/main` showed the commit that added
   `id="tour-lighting-effects-section"` (`e670cd0`, a docs-update-only commit)
   is **not** an ancestor of `origin/main`, while the commit that added
   `id="tour-hypso-section"` (`803c224`) **is**. Real-world effect: a
   `scrollIntoView`-by-id script silently no-ops when the id isn't in prod's
   DOM yet (my `page.evaluate` returned `null` for `querySelector`, and I'd
   forgotten to wire up `page.on('console')` so the in-browser `console.warn`
   was invisible in the Node terminal — always pipe browser console to Node
   when debugging a silent scroll/click failure). **Fix used: scroll by the
   Section's own title `<span>` exact-text match, walking up to the nearest
   ancestor whose className contains `scroll-mt-` (see `Section` in
   `controls-components.tsx`), instead of the `id`** — this works regardless
   of whether prod has the id yet. This is almost certainly why past rounds'
   "I used the same URL, I swear" captures kept coming back showing the wrong
   sidebar section/scroll position — not a camera problem at all, a silent
   scroll-target-not-found problem that happened to *also* correlate with
   camera-looking-wrong reports.
   - **This same prod/branch-lag issue also breaks the guided-tour step
     count/order**, independent of the DOM-id issue above: walking the tour
     step-by-step on prod (via `startTour=true` + repeated `ArrowRight`)
     landed on completely different step content than the local
     `product-tour.tsx` source predicts (e.g. local source says step 9 of the
     terrain branch is "Color by Elevation", but prod's actual step 9 was
     "Terrain Sources", step 11 was "Bring Your Own Data" — a totally
     different, shorter/reordered step list). **Do not trust local
     `product-tour.tsx` array order to predict prod step numbers.** If you
     need a specific tour step from prod, walk it empirically (advance one
     step at a time, read the actual title each time) rather than
     precomputing "N general steps + branch + M terrain steps".
   - **Seeding `localStorage.hasSeenTour = true` also silently blocks the
     `?startTour=true` deep link**, even though `product-tour.tsx`'s own code
     comment says the deep-link effect "fires regardless of `hasSeenTour`".
     Confirmed empirically (isolated A/B test: identical page+URL, only
     difference was this one localStorage key, tour opened with it unset/false
     and never opened with it seeded true) — this looks like a real app bug
     worth a from-scratch fix, not a capture-script problem. **Workaround:
     don't seed `hasSeenTour` at all (or seed it explicitly `false`) for any
     tour-driven capture.**
   - **Coachmark's `ArrowRight` tour-advance keyboard shortcut occasionally
     drops or double-fires a press** — confirmed via a press-by-press log
     (6 sequential `ArrowRight` presses with 1.8-2s gaps only advanced the
     step counter 4 times in one run). A fixed "press N times" script is not
     reliable. **Fix: loop pressing one at a time, checking the actual
     visible step/title text after each press, until the target is reached
     (cap the loop, don't spin forever).**
   - **Phong's raster-basemap-blended render can get stuck with several
     tile-sized patches showing a lighter/less-shaded, not-fully-composited
     appearance**, similar in spirit to the SVF stuck-compute gotcha above
     but for the Phong "2D Fast" shader path specifically — confirmed it is a
     genuine timing race, not permanent basemap-mosaic seams: two separate
     long-plain-wait attempts (70s, then 90s+45s=135s) reproduced very
     similar-but-not-identical patch layouts, and neither wait length alone
     resolved it. **What actually fixed it: a `page.mouse.wheel` zoom-out
     then zoom-in "nudge" partway through the wait** (45s wait → nudge → 45s
     wait → nudge → 45s wait → screenshot) — after that the render was fully,
     evenly shaded with zero patches. Same nudge trick as the stuck-tour-step
     gotcha elsewhere in this file, now confirmed useful for a non-tour,
     plain-URL capture too.
   - **Don't assume a "quilted"/non-uniform raster-basemap appearance is
     real source-mosaic data without testing in isolation** — I initially
     misdiagnosed the Phong patches above as genuine ESRI-style mosaic
     seams because they looked visually plausible and didn't obviously
     change between two wait lengths; a wheel-nudge later proved that wrong.
     Conversely, for **AWS Terrarium** specifically, a fine uniform
     scanline/moiré hillshade texture (looks like a subtle grid hatching
     across the whole terrain) reproduced **pixel-identically** across two
     very different capture treatments (plain 90s wait vs. 55s+nudge+55s+
     nudge+drag) AND in a totally isolated single-source (no split, no
     overlay) capture — that level of exact reproducibility across different
     code paths is what actually confirms "real source data", not just "it
     looked stable once". When in doubt, isolate the suspect layer alone
     (drop every other layer/source) and compare.
   - Session ended with **three item groups (walkthrough screenshots,
     split-modes screenshots, elevation-picker screenshot) explicitly taken
     back over by the user mid-session** to redo manually. The controlling
     agent was told to stop touching those files, but its background task was
     killed (`TaskStop`) before it finished acting on that — it had NOT
     actually reverted anything via `git checkout --` (despite an earlier,
     inaccurate draft of this note claiming it had); `git status` right after
     the kill still showed all of those files as modified. The user then
     personally reviewed the final on-disk state of every affected file
     (both their own manual recaptures and whatever the agent had last
     written) and confirmed it was correct before committing — so the
     committed result is user-verified, but be aware the "taken back over"
     files may be a mix of user and agent output rather than purely one or
     the other. See `handoff-docs-update.md` for the exact current
     disposition. **Lesson: a background agent's own claim of having cleaned
     up/reverted something is not reliable if the task was killed
     mid-sentence — verify against `git status`/mtimes rather than trusting
     the agent's last written note.**
