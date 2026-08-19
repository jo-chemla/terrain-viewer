# Changelog — Docs Site Expansion and Open-In Additions
<!-- released: 2026-08-19 -->

#### TL;DR
- **Docs site expansion** — dozens of new or re-shot real screenshots across Visualization Modes, the full guided-tour Walkthrough, Split & Compare, and more; new user-facing pages (Walkthrough, Tools, Frescoes & Artifact Scans) in the Features guide; new developer documentation (Lighting Effects, Terrain Analysis Pipeline, ESRI Wayback).
- New **Open In** destinations (Iconem River-REM, Google Maps 3D, Google Earth Historical/3D), a `?startTour=true` deep link to launch the guided tour directly, plus assorted fixes (lightbox caption links, changelog date-key collisions, KaTeX formula layout).

### Features
- **Docs site** — Visualization Modes, Walkthrough, Split & Compare, Basemaps & Historical, Sources, Tools, Frescoes & Artifact Scans, and several Dev pages substantially expanded with real app screenshots, reproduction URLs, and clarifying prose.
- **Open In** — Iconem River-REM, Google Maps 3D, and separate Google Earth Historical (web) / Google Earth 3D (web) destinations; ESRI Wayback Machine moved to the top of the list.
- `?startTour=true` URL param launches the guided product tour directly, independent of first-visit state.

### Bug Fixes
- Docs lightbox: a caption link followed by trailing text (e.g. a parenthetical note) no longer gets pushed past the title bar's truncation, hiding the actual clickable link.
- Changelog: two entries sharing the same release date collided on the same React key — a browser console warning explains it, but see the fix in this entry's own `<!-- released -->` marker for the general pattern.
- Terrain Source "Google 3D Tiles (via DeckGL only)" removed from Worldwide Defaults — the same experience is reachable via the Google Maps 3D / Google Earth 3D (web) Open-In destinations instead.

# Changelog — Terrain Camera Fixes, Terrain Sources Docs, and Favicon Polish
<!-- released: 2026-08-16T17:00 -->

#### TL;DR
- **Camera sync fixes** — DEM tiles arriving after terrain turns on, pane resizes, and the padding `easeTo` all leave the elevation reference stale. Re-anchored on `idle` via `recalculateZoomAndCenter` (holds camera position, solves for the new center/zoom — nothing moves on screen), guarded by a 1 m epsilon so padding changes and mode switches don't nudge the focus point. The view you last touched is authoritative; the others are copied wholesale from it.
- **Elevation is now a synced camera parameter** — a terrain camera has a sixth parameter beyond center/zoom/bearing/pitch/roll (the elevation of the point it looks at), and it wasn't being forwarded in split/overlay. MapLibre freezes it for the whole drag on the moved view while re-resolving it live on every `jumpTo` to the others, so the panes drifted vertically apart for the duration of a drag and snapped back on release. The moved view's elevation is now forwarded explicitly.
- **Fixed several camera-reset edge cases**: MapLibre's `easeTo` leaves `_elevationFreeze` stuck on unless `freezeElevation` is passed (suppressing per-frame reclamp and leaving panes in asymmetric internal state after whichever one you'd last dragged); ground-clamping bookkeeping was keyed by view id which outlives the map instance (a remounted pane stayed permanently clamped); programmatic camera commands now stand down while a pointer is held (previously `jumpTo`/`easeTo`'s `Map#stop()` silently ate a press-and-hold gesture).
- Panel open/close now animated (padding, pane rects, gutter, borders ease over 200ms); sidebar/timeline avoidance padding extended to lone view, single-row/column grids, and Overlay panes; Map B defaults to **AWS terrain** (no API key); new **Terrain Sources** docs page; favicon shape reactive to live app mode.

### Features
- **Terrain Sources docs page** (`docs/content/docs/features/terrain-sources.mdx`) — one-paragraph summary of each built-in terrain source (Mapterhorn's coverage page, Mapbox's SDK-only + compression, MapTiler's companion Ocean RGB bathymetry tileset, AWS's genuine ETOPO1 ocean bathymetry blending), linked from Sources → Terrain → ⓘ (`source-info-dialog.tsx`) as "Compare all built-in terrain sources →".
- Docs: Features sidebar group now expanded by default; homepage feature-card order now matches Terrain Visualization Modes → Light-Direction XYPad → Historical Imagery → Split Screen & N-Map Compare.

### Bug Fixes
- **Camera/focus-point shift on init** — the padding is what keeps the focus point centered in the part of a pane that isn't covered by the sidebar or timeline panel, so it belongs on every pane those overlap: each row's rightmost, the last row's, the lone non-split view (trivially both), and both full-bleed Overlay panes. It's now also seeded into each view's `initialViewState`, so a view is *built* with its vanishing point already shifted clear rather than rendering centered on the full canvas for a frame and then sliding across — that slide was the actual "shift on init". An interim version of this fix instead gated the padding on the grid having more than one row/column, on the theory that it only mattered for aligning vanishing points between side-by-side panes; that was wrong, and left a lone pane's focus point sitting under the sidebar.
- **Split-view pan/drag desync, requiring an extra manual pan to resync** — the cross-view sync handler's re-entrancy guard (needed because `jumpTo()` fires `move` events synchronously, which would otherwise recurse) was being released on a 50ms `setTimeout` instead of immediately after the synchronous re-entrant call already returned. Since real drag frames fire roughly every 16ms, that 50ms window silently dropped ~2 of every 3 legitimate frames from propagating to the other view(s) — including, sometimes, the drag's very last frame, leaving the passive view a few frames behind until nudged. Fixed by releasing the guard synchronously right after the sync loop, instead of on a timer.
- **Terrain camera mis-centering, on load and on every split-mode switch** ("the Matterhorn summit sits a bit low") — root-caused live via `map.project(map.getCenter())`, watched across the actual load/interaction timeline rather than guessed from docs. `setTerrain()` is applied the moment the terrain source object exists, before that view's actual DEM tiles for the current viewport have fetched/decoded, so the camera's aim elevation gets computed from nothing yet — confirmed: the projected center sat well off true screen-middle the entire time terrain was active, snapping back to dead-center immediately after re-calling `setTerrain()` a second time once `idle`. But that alone wasn't enough: the same off-centering kept recurring on every subsequent Off/Overlay/Side toggle too, each time from a *different* culprit — the padding effect's own `easeTo(duration:0)` call, that `easeTo` in turn firing a `move` event the cross-view sync handler propagated onward via `jumpTo()`, and `resize()` (each pane's own pixel dimensions changing between Overlay's full-width and Side's half-width panes) — every one of which independently resets the same elevation reference, confirmed live one at a time. The deeper cause turned out to be MapLibre's own `easeTo`: `_prepareElevation` sets `Map#_elevationFreeze` unconditionally, but `_finalizeElevation` — the only thing that clears it — runs only when `freezeElevation` is passed. So the padding `easeTo` left that flag stuck on, which suppresses MapLibre's own per-frame reclamp, and the only other thing that ever cleared it was completing an interactive drag *on that map*. That also explains why the very first drag after load jumped, and why one pane could follow the terrain while the other was panned. Passing `freezeElevation` fixes the flag; a cheap `idle` listener re-anchors the height when it's genuinely stale (see the entry above); and the padding effect's own `easeTo` is guarded against triggering a cross-view sync jump. An interim version re-affirmed the whole of `setTerrain()` on every idle instead, which worked but rebuilt Terrain + RenderToTexture each time — see the blinking entry above.
- **"Weird follow-terrain" while dragging, inconsistent between split views** — MapLibre's `centerClampedToGround` (on by default) continuously re-resolves the center point's elevation live, every frame, while panning/zooming — the bob/climb effect, and a source of cross-view inconsistency since two views on different DEM providers each resolve elevation independently a moment apart. This file's keyframe-recording animation already disabled this same flag for its own one map instance; now every split view disables it too, right after its own terrain has settled (order matters — disabling before that settle would freeze the wrong, pre-terrain elevation guess instead of the correct one; confirmed live both ways). Read from the map's own `getCenterClampedToGround()` rather than remembered per view id: a view id outlives the map behind it, so an id-keyed "already done" flag left a rebuilt pane (view B, after a split off/on cycle) permanently ground-clamped.
- Default terrain source for split mode's Map B changed from MapTiler to **AWS** — MapTiler (and Mapbox) require an API key a fresh visitor won't have configured, so Map B previously rendered blank by default.
- Default initial viewport recentered to `lat=45.9788, lng=7.674, zoom=12.37` (also updated in the camera-keyframe tool's own fallback pose, which mirrors this default by convention).
- `beta.historical-satellite.iconem.com` not defaulting to Historical mode despite a correct favicon — an effect-ordering race (the appMode-persistence effect ran before the first-visit hostname-default check on the very first render, so it always looked like a returning visitor). Fixed by snapshotting whether `appMode` was already stored *before* any effect runs.
- `jo-chemla.github.io` not defaulting to the blue/prod mountain favicon, and docs-in-dev not showing the purple book-open icon — both hostname-detection helpers now recognize `jo-chemla.github.io` as a real prod deploy, and the docs favicon-swap script's logic was flipped from "swap away from prod unless proven dev" to "swap up to prod only once confirmed" (safe default either way, since the previous logic could race Next's `beforeInteractive` script queuing).
- App favicon *shape* (mountain vs. clock) now reactive to the live app mode, not just the hostname — switching modes mid-session (or a first-visit guess that turns out wrong) now updates it instead of leaving it stuck at whatever `index.html`'s inline pre-mount script guessed.
- Docs: XYPad demo video 404 (`visualization-modes.mdx`'s `<video src>` was missing the `/docs` base-path prefix).

# Changelog — Guided Product Tour
<!-- released: 2026-08-16T09:00 -->

#### TL;DR
- New **guided product tour** (Compass icon in Settings, or auto-starts on first visit): a branching walkthrough covering the shared basics, then either the Terrain visualization tools or Historical Satellite imagery mode, chosen at a fork partway through.
- Each branch ends with a **Tools** step listing that mode's map-based utilities (Drawing, Elevation Picker, Sun/Shadow Calculator beta, Animation, Source Info — the historical branch's subset excludes the terrain-only ones).

### Features
- **Guided product tour** (`components/TerrainControlPanel/product-tour.tsx`, built on the `coachmark` library) — walks through the map viewport, control panel, general settings, and Terrain-vs-Historical mode switch, then forks into either the Terrain tools (Hillshade, Hypsometric Color, Terrain Analysis, Relief Visualization, Sources, BYOD, Split Mode, Tools, Keyboard Shortcuts) or Historical Satellite imagery (Compare and Blend, Split Mode, Blend Modes, Grid Layout, Timeline, Tools) branch. Each step temporarily forces whatever sidebar/section/mode state its target needs to exist, and everything is snapshotted at tour start and restored verbatim on close/finish, regardless of which steps were actually visited.
- **Tools step** (one per branch) — a bulleted rundown of that mode's Tools group, with every tool section folded and the whole group (separator + all tool titles) spotlighted together as one block.

### Bug Fixes
- **Popup silently not appearing for several steps** (Hypsometric, Terrain Analysis, Relief Visualization — Hillshade, near the top of the panel, was unaffected) — root cause: Coachmark's own built-in scroll-into-view could resolve before the actual scroll distance was covered for a target further down the sidebar's scroll container, leaving the popup positioned against a target rect still (partly) below the fold — visually indistinguishable from no popup at all, just the dimmed backdrop. Fixed by having the tour scroll its own target into view itself (instant, before Coachmark's own step-change effect ever runs), so Coachmark's internal attempt finds nothing left to do.
- **Raster Basemap / Terrain Sources steps** could scroll the section's own title off-screen once enough BYOD custom sources were added to make the section unusually tall — switched the tour's default scroll alignment from centering the (possibly very tall) target to anchoring its top edge instead, so the title stays visible with as much of the rest as fits below it.
- Terrain Analysis step was switching on both Slope and Curvature as its demo; now just Slope, matching its own description text.
- The "Curious about the other mode? Take that tour instead" link could overflow its popup at typical widths — shortened and restyled as a proper full-width button.

# Changelog — Docs Site, Featured Bookmarks, and Tells Freeze Fixes
<!-- released: 2026-08-14 -->

#### TL;DR
- Added a [documentation site](/docs), live-linked from the app general settings.
- **Featured bookmarks**: a curated "Featured" strip of starter viewpoints (different terrain shapes, visualization combinations, and a historical-imagery example) now sits above your own saved bookmark list.
- **Mound detector (Tells)**: new Frozen/Live toggle — pin the currently-detected candidates in place so panning/zooming doesn't keep re-querying and recomputing them.
- Visiting historical-satellite.iconem.com now lands you straight in **Historical Imagery mode**, with its own clock-shaped favicon (matching the timeline toggle's own icon) instead of the terrain mountain.
- In split/grid compare mode, clicking a basemap's **name** (not just its per-view toggle) now sets that source on every active view at once.

### Features
- **Documentation site** (`docs/`) — a separate Fumadocs (Next.js) app, deployed alongside the main app and proxied at `/docs` in dev, covering Overview, Visualization Modes (a shared markdown source also rendered inline in Settings → Visualization Modes, so both stay in sync), Keyboard Shortcuts, Changelog (renders the same TL;DRs shown in-app, sourced straight from this file), Resources and Inspiration (MapLibre features, geomorphometry/hydrology literature, credits), and a Dev page (structure, architecture, running the app). Homepage and docs images open in a lightbox on click.
- **Featured bookmarks** (`lib/preset-bookmarks.ts`) — a small, read-only set of curated viewpoints shipped with the app, separate from the user's own `bookmarksAtom`-backed list: restoring one never edits or removes it, and an app update to this set never touches anyone's own saved bookmarks.
- **Tells Frozen/Live toggle** — "Frozen" snapshots the currently-rendered mound candidates (via `querySourceFeatures` off the live vector tiles) into a static geojson source, so panning/zooming stops triggering new `tells://` tile fetches and recomputation; "Live" (the default) resumes the normal fetch-as-you-pan behavior and forces an immediate tile reload for wherever you'd panned to while frozen, rather than waiting for the next pan.
- **Historical hostname auto-routing** — a first-ever visit to historical-satellite.iconem.com (no `?appMode=` in the URL, no locally-stored preference yet) now opens in Historical mode by default instead of the app's normal Terrain default; any other/unknown hostname is unaffected.
- **Click a basemap's label to sync it everywhere** — in split/N-grid compare mode, clicking a basemap's name now applies it to every currently active view, not just the row it was clicked from.

### Bug Fixes
- **Tells freeze — three real, distinct bugs**:
  - `Error: can't serialize object of unregistered class nf` — `querySourceFeatures()` returns MapLibre's internal feature-wrapper instances, not plain objects; handing those straight to a new geojson `<Source>` failed MapLibre's worker-side structured-clone step. Fixed by round-tripping through `JSON.parse(JSON.stringify(...))` first.
  - `DataCloneError: ArrayBuffer ... already detached` — root cause was actually in the shared finished-tile LRU cache (`lib/tile-result-cache.ts`, used by every "Slope and More" derivative — Slope/Curvature/TPI/Roughness/LRM/SVF/Openness and more, not just Tells): it handed out the exact same underlying `ArrayBuffer` on every cache hit, and MapLibre detaches a tile response's buffer when transferring it to a worker — so a second request for an already-cached tile tried to transfer an already-dead buffer. Fixed by always storing and returning independent copies.
  - Unfreezing (back to Live) didn't recompute for wherever the view had panned to while frozen, until an extra pan/zoom — MapLibre only fetches a source's tiles when a visible layer references it, and no layer referenced the live vector source while frozen, so tiles for a newly-panned-to area were never requested. Fixed by forcing a tile reload (`source.setTiles(...)`) the moment Live resumes.
  - The frozen geojson source also now mounts under its own id instead of swapping the live vector source's type in place under the same one, avoiding a MapLibre worker-teardown race when a tile request was still in flight the instant Frozen flipped on.
- **Historical mode wiping Terrain-mode visualization settings** — switching into Historical mode used to force roughly a dozen viz-mode flags (Hillshade, Lighting, Shadows, Color Relief, Terrain Analysis, Relief Visualization, Plane Slicer, Tells, Contours/Graticules, Background) to off, destroying whatever a visitor had set in Terrain mode. Every one of those is now instead gated on "not Historical mode" directly at render time, so the underlying settings are preserved and simply resume when switching back.
- **Historical timeline zoom-out over-padding** — the zoom-out limit and pan-gutter extent padded a flat 10% of the full date range past each real end, which for a very long outlier range (e.g. an 80-year span) let the zoomed-out view pan years past either real boundary. Now capped at 6 months per side, whichever of the two is smaller.
- **Changelog image lightbox** — was rendering far too small with no dimmed background, then (once resized correctly) showed black letterbox bars whenever an image's aspect ratio didn't match a fixed 90vw×90vh box, and outside-click/Escape didn't reliably close it due to a Base UI nested-dialog dismiss quirk (confirmed: Escape closed it while a real backdrop click did not, and a naive workaround ended up closing the Settings dialog behind it too). Rebuilt as a plain, correctly-dimmed overlay that shrink-wraps to the image's own aspect ratio (never upscaling past it), with its own outside-click/Escape handling scoped to just the lightbox.
- **`@tanstack/devtools-vite`'s dev-tooling breaking MapLibre sources** — its "click to open in editor" `data-tsd-source` attribute, injected onto every JSX element in dev, was landing on react-map-gl's `<Source>`/`<Layer>` components, which spread all received props straight into `map.addSource()`/`addLayer()` — tripping MapLibre's schema validator ("unknown property") whenever such a source/layer mounted fresh at runtime. Scoped out via the plugin's own `injectSource.ignore.components` option.

# Changelog — Histogram Color Matching in Compare and Blend
<!-- released: 2026-08-11 -->

#### TL;DR
- **Match Colors via Histogram Matching**: automatically recolors every other view onto View A's color histogram, so two different imagery sources (or two dates of the same source) no longer look noticeably darker/bluer/warmer next to each other when compared or blended.
- Five color spaces to choose from: RGB is instant (a live CSS filter); HSL/HSV/LAB/LCH are slower but can match more subtle color differences. Ported from Iconem/historical-satellite's standalone [histogram-matching demo](/histogram-matching-example/histogram-matching.html).

### Features
- **Match Colors, in Compare and Blend** — TL;DR: automatically recolors the other view(s) to match View A, so two different imagery sources — or two different dates of the same source — line up visually instead of one looking noticeably darker/bluer/warmer than the other when compared or blended. A new "Color Space" picker lets you choose how thorough the match is; the default (RGB) is instant, the others are slower but can match more subtle color differences.
  *Implementation, for developers:* new "Match Colors" collapsible (folded by default, persisted like the existing "Advanced" one) at the bottom of Compare and Blend, gated on `isSplit` (works in both Overlay and grid/side-by-side). `state.matchColorsToA` (bool) and `state.matchColorsColorSpace` (`"rgb" | "hsl" | "hsv" | "lab" | "lch"`) are both nuqs/URL state. One `HistogramMatchFilter` instance is mounted per non-A active view (overlay: just B; grid: each of B..H independently), always matched onto A as the reference — see `components/MapControls/HistogramMatchFilter.tsx` and the algorithm in `lib/histogram-matching.ts`.
  Two paths, chosen per color space:
  - **RGB** (fast): computes a per-channel 256-entry lookup table (via exact empirical-CDF histogram matching — see the Bug Fixes entry below) and applies it as a live CSS SVG `feComponentTransfer` filter directly on the target's `<canvas>`. No pixel data is ever touched; GPU-composited every frame for free.
  - **HSL / HSV / LAB / LCH** (slower, flagged with an hourglass in the picker): `feComponentTransfer` can only ever transform raw R/G/B output independently, so a mapping computed in one of these spaces can't be expressed as a CSS filter. Instead: hand-rolled sRGB↔space conversions (not chroma-js — its per-call Color-object construction/dispatch overhead is real at pixel-loop scale, measured ~4-5x slower) convert a small 96×96 sample of each view to the target color space, compute the matching per channel, then a coarse 25³-point 3D color LUT (the same technique real color-grading tools use — DaVinci Resolve/Lightroom camera profiles, `.cube` LUT files) is built once from that mapping and applied to the target's *own native canvas resolution* via trilinear interpolation — cheap per pixel (8 LUT reads + weighted blends, no transcendental math), which is what makes native-resolution output affordable at all (a naive full per-pixel conversion measured 0.5-0.9s at typical/high-DPI canvas sizes; the LUT approach is 100-400ms for the same sizes). Result is drawn onto a `pointer-events-none` overlay canvas stacked on the target's own live canvas (which stays interactive underneath), faded to `opacity:0` on either map's `movestart` and back to `1` once the next recompute lands, so a pan/zoom gesture always shows the live map moving instead of a stale, non-updating overlay sitting on top of it with no feedback.
  - Both paths re-sample on `idle` (either the reference or the target map), debounced to at most once/second.
  - Also vendors Iconem/historical-satellite's original standalone [histogram-matching demo](/histogram-matching-example/histogram-matching.html) (`public/histogram-matching-example/`) for reference — the algorithm this whole feature is ported from.

### Bug Fixes
- **LAB/LCH histogram matching producing wildly wrong colors** — root cause: the CDF matching binned each channel into a *fixed grid spanning its theoretical range* (e.g. LAB's a/b as ±100, later widened to ±128 as a first attempted fix — still wrong). Any low-variance sample (a flat-colored tile — open water, snow, a cloud deck) has almost all its mass in one or two bins, and the standard CDF-inversion boundary handling (`x <= xp[0]` / `x >= xp[last]`) then snaps those bins straight to the array's *theoretical* min/max the instant a query's cumulative fraction hits exactly 0 or 1 — which happens far more often than it sounds, not just at the sample's true extremes. For RGB that clamped to plain black/white (usually visually benign by luck); for LAB it clamped to wildly saturated colors that never appeared anywhere in either image. Fixed by replacing the fixed-bin approach with an exact empirical CDF (ECDF) over each channel's actually-observed values — sorted + deduplicated real samples, matching what scikit-image's own `exposure.match_histograms` does (`np.unique` + cumulative counts) — so both the lookup arrays and their boundary clamps are always real data points, never a synthetic range edge. Applied to the RGB path too (same root cause, just visually subtler). Verified against the exact degenerate case that exposed it (a perfectly flat-colored source/target pair, which used to land on arbitrary extreme colors) now matching exactly; realistic noisy-sample correctness and native-resolution LUT performance both reconfirmed unaffected (ECDF construction adds ~7-9ms on top of the existing 60-210ms LUT-apply cost).

# Changelog — N-Map Grid, Overlay blend, and export historical imagery
<!-- released: 2026-08-10 -->

#### TL;DR
- **N-Map Grid mode**: in addition to 2x1, can now also do 3x1, 4x1, or 2 rows, 2x2 up to 4x2. Gains a **Grid** shape, now supporting up to 8 synced map views, not just a 2-way split.

  ![Comparing basemap sources side-by-side in grid mode](/docs/screenshots/n-grid.jpg)
- **Compare and Blend's Split Mode: Off/Side/Overlay**, where gutter can be horizontally dragged for clip ratio, or the pill vertical position controls map view B transparency
- **Blend Mode for overlaid Map View**: Multiply, Difference, Soft-Light etc. Dropdown now exposes every CSS blend mode, not just a curated handful.
- **Export historical GeoTIFFs** across a date range, with an option to generate ready-to-run `gdal_translate` scripts.
- Optional colored map borders and a capture-date pill make it easy to tell which pane is which.

### Features
- **N-map grid & overlay comparison mode** — Compare and Blend's Split Mode gains a third shape alongside Off/Overlay: a full grid (2×1/3×1/4×1/2×2/3×2/4×2, up to 8 simultaneous views A–H), each with its own basemap source, driven by a shared `GRID_LAYOUTS` registry (`lib/grid-layouts.ts`) rather than a hardcoded A/B pair. Every pane is absolutely positioned off one shared layout pass so switching shapes never remounts a `<Map>` instance (keeps its WebGL context/tile cache). The last row absorbs whatever height the historical timeline panel actually eats into, so its own *visible* portion still matches every other row instead of a naive equal split leaving it visibly squished. Switching back to Terrain mode forces the shape back to plain 2×1 and re-derives the timeline's own grid layout to match — it previously kept showing all 8 A–H pills even after the map itself had collapsed back down. Inspired by Capturing Reality's RealityScan multi-view comparison grid and BBBike's MapCompare side-by-side.
- **Visual grid-layout picker** — Grid Layout's text SegmentedToggle replaced with a borderless 2-row × 4-col "table size picker" (same convention as the ABCDEF basemap-source toggle / color swatches, no per-cell text): the selected NxM shape lights up in solid primary, hovering a different valid cell previews the resulting shape in a lighter primary before committing. Every cell is a real, wired-up layout up to 4×2 (8 views, A–H) except the top-left 1×1 cell (a single unsplit view, meaningless as a grid-layout choice), which stays disabled rather than hidden so the control still reads as a clean fixed rectangle.
- **Per-side colored map borders** — an optional colored border per view (Compare and Blend → Advanced → Colorize Map Borders), toggle between a 3px-inset frame or a flush, thicker one. In overlay mode each side's border is drawn independently (not clipped from one shared rect) and split exactly at the drag pill's own position; in every mode borders clamp to the actually-*visible* edge instead of running under the floating sidebar or the historical timeline panel. The flush (no-inset) mode also avoids rounded corners and halves each side's stroke width exactly where it's shared with a neighboring pane's border, so a seam between two panes reads as one continuous stroke instead of visibly doubled. Borders now render as their own layer instead of nested inside the blended overlay pane, so an Overlay-mode mix-blend-mode (e.g. Difference/Exclusion) no longer discolors the border itself.
- **Capture-date pill** — a small floating pill per pane showing that view's real capture date, off by default, with an off/date-only/source+date 3-way toggle. Placement is sidebar- and timeline-aware (centers on the actually-visible width, not the full DOM box that intentionally extends underneath either), and in overlay mode centers each pane's pill in its own visible half of the split rather than stacking both at the shared left edge. Shows the source's short name instead of a fabricated "Unknown" when no real per-tile date is available (e.g. a static basemap), rather than disappearing entirely.
- **Split gutter / drag pill** — the 2×1 overlay divider is now a circle pill (drag = ratio + opacity together) sitting on a wider invisible gutter strip (drag = ratio only, `cursor-col-resize`), so grabbing near-but-not-exactly-on the pill no longer silently changes blend opacity too.
- **Ctrl+drag group-move for timeline handles** — holding Ctrl (or Cmd) while dragging a per-view handle now sweeps every other handle on one side of it by the same number of tick-marks, all measured in one flattened, all-sources index space so "N marks" reads as the same visual distance for every handle regardless of which source it's actually on. Which side is swept is decided once, from each handle's position relative to the dragged one plus the first real pointer-movement direction, so a handle dragged past the anchor mid-gesture stays swept; dragging back to the exact start position resets every swept handle too.
- **Multi-feature historical export** (`Export Multi (Historical)`, new dialog) — one GeoTIFF per export target × selected historical source × real capture date in a picked range, bundled into a `.zip`. Target is either **Viewport** (the current map view, nothing needs to be drawn) or **Per-Feature** (every currently-drawn TerraDraw feature, independently padded — a fixed meters radius for points, a percent-of-own-extent buffer for polygons/lines). An **Include gdal_translate script** option additionally writes one `.bat` per target with a ready-to-run `gdal_translate` command for every capture whose source exposes a real fetchable tile URL — Wayback/HLS/Planet/EOX Sentinel-2 via a `GDAL_WMS` TMS mini-driver (same technique as Iconem's prior historical-satellite export tooling), Bing via `GDAL_WMS`'s dedicated VirtualEarth service (quadkey-addressed, not `{z}/{x}/{y}`) — only Google Earth Historical is REM-commented out instead, since it has no public tile URL at all (this app resolves it internally against Google's own encrypted `dbRoot`).
- **Blend modes** — Overlay's Blend Mode dropdown now exposes every CSS `mix-blend-mode` keyword, not a curated handful, grouped into "Standard" (normal/multiply/screen/overlay/darken/lighten/color-dodge/color-burn/hard-light/soft-light/difference/exclusion) and "Extra" (hue/saturation/color/luminosity/plus-darker/plus-lighter).
- **Compare and Blend sidebar section** (renamed from "Comparison and Mix") split out of General Settings, with an "Advanced" sub-section (capture-date pill, border colorization + side colors) collapsed by default, its own collapsed/expanded state now persisted like every other sidebar section instead of resetting on reload. The "Open In…" launcher (Google Earth Web/ESRI Wayback/BBBike/etc.) lives in this section for Compare and Blend; in Terrain mode (which doesn't show this section at all) it lives instead in the historical timeline panel's own A/B caption row, centered between the two dates.
- **Historical mode defaults** — entering Historical Imagery mode (Mode Picker, or a direct `?appMode=historical` link) now also forces `showHillshade` off, so only the raster basemap actually renders — previously the one terrain-mode viz toggle that still defaulted on.
- Historical timeline's default (non-zoomed) view no longer stretches all the way back to a single old outlier tick (Google Earth Historical often has one isolated ~1945 capture for well-covered cities) — floored at 2010 by default unless every available tick genuinely predates that.
- Timeline per-view handle chips/side-picker/A-B captions fall back to a plain primary-colored look instead of each view's own hue when Colorize Map Borders is off, since that per-side color coding is meaningless once nothing on the map actually shows it — the same neutral fallback now also applies automatically in Terrain mode, which forces colored borders off but doesn't expose the toggle to reflect that.
- Source Info's per-view basemap attribution list no longer merges two views that share a source but resolved to a *different* real attribution (e.g. two views both on Google Earth Historical at different dates, different actual imagery provider) into one row showing only the first view's text — dedup now compares the resolved text itself, not just the source id.
- **ESRI World Imagery (live basemap) capture-date pill** now resolves a real per-tile date via the newest local Wayback release instead of always showing "Unknown," and shows that date next to its label in the basemap picker the same way Bing already did. ESRI Wayback's own Source Info attribution now reads a short "Provider (Source)" label (e.g. "Maxar (WV03_VNIR)") resolved from wayback-core's real per-release metadata, instead of sharing the live basemap's location-only, always-current contributor-coverage feed.
- **Chevron off-screen handle click** now zooms out 20% toward that handle's date instead of recentering exactly on it, so the timeline between "here" and "there" stays visible instead of jumping straight to the target.
- Historical-only keyboard shortcuts (L-hold lighting, Ctrl-tap viz-mode toggle, Shift-tap basemap toggle) are now disabled in Historical Satellite mode, where they don't apply; Ctrl+K and Space stay universal. These, plus arrow-key stepping and the timeline's Ctrl+drag behavior, are now documented in Settings → Keyboard Shortcuts.
- Terrain mode's description in the Mode Picker now specifically names Relief Visualization alongside hillshade/lighting/contours/terrain analysis.
- "Export Multi (Historical)" renamed to "Export Historical GeoTiffs" and moved above the Max Download Resolution input it shares a section with, instead of below it.

### Bug Fixes
- **Split-gutter drag drift** — the pill's horizontal drag read the small ~32px gutter strip's own (ratio-dependent, moving) bounding rect instead of the true split container's, so dragging the pill (as opposed to the surrounding gutter) silently drifted from the cursor. Fixed by reading the gutter's parent rect for both.
- **Historical timeline panel height/desync** — its `ResizeObserver` was attached once at first mount and never reattached after the panel unmounted and remounted (collapsing/re-expanding the floating timeline), silently freezing the reported height forever after the first such cycle. This fed the map borders' bottom clamp, the minimap's offset, and the scale/attribution clearance, so a stale height desynced all of them at once — e.g. a colored border landing behind the timeline panel after toggling it off and back on. Replaced the effect with a callback ref that reattaches on every real mount.
- **Minimap flush against the expanded timeline panel** — its clearance formula added the panel's own 16px `bottom-4` anchor offset and the intended 16px visual gap as if they were the same 16px, leaving zero actual margin whenever the full (non-collapsed) panel was showing; the collapsed-to-icon case already accounted for both separately. Now adds both.
- **AttributionControl force-opening itself** — a real MapLibre `attribution_control.ts` quirk: `compact` mode force-opens the `<details>` the first time real attribution content resolves while the map's canvas is ≤640px wide (true for most split panes), and never auto-collapses again. Worked around with a capture-phase click listener (to still respect a genuine user click) plus a `MutationObserver` that immediately re-collapses any *other* `open` addition.
- Bottom-row capture-date pills now anchor to that row's own true bottom (clearing the timeline) instead of the seam with the row above, now that the border/timeline clamping they share is correct — previously both rows' pills crowded onto the same middle seam.
- **Arrow-key timeline stepping vs. Blend Mode dropdown** — arrowing through an open Blend Mode `<Select>` also stepped the historical date underneath it, since the timeline's own arrow handler wasn't scoped to whether the timeline panel was actually the last thing clicked. Now gated on that.
- **Year-gridline UTC bug** — the gridline generator compared a local-time year against a UTC-floored boundary, silently dropping the "2010" floor label for anyone in a UTC+ timezone.
- **Pan gutter / wheel-pan gating** — both the horizontal pan gutter and wheel-driven horizontal pan were gated on `viewWindow` being set rather than on a real hidden range actually existing, so e.g. re-toggling a source pill back on (which can only become reachable via the 2010 default-view floor, not an actual zoom/pan) left the gutter transparent/inert. Wheel gestures also now lock to pan-or-zoom for the gesture's full duration (trackpad swipes rarely produce pure `deltaX`, so switching mode per-event read as stutter), and wheel-driven `viewWindow` updates coalesce to one per animation frame instead of one per wheel event, since momentum-decay tails can fire well past 60fps.
- **Ctrl+drag handle index math** — iterated from each handle scrubbing by nearest-pixel (reading as time-distance rather than a clean N-marks shift when sources differ in tick density) to indexing within its own source's list, to its final form: indexing within the flattened, all-sources list, so "N marks" is the same visual distance for the dragged handle and every swept handle alike, regardless of source.

# Changelog — Historical Satellite Imagery Timeline, Terrain vs Historical Mode Picker
<!-- released: 2026-08-07 -->

#### TL;DR
- **New "Historical Imagery" mode**: scrub a real per-tile capture-date timeline bottom panel, across **[ESRI Wayback](https://livingatlas.arcgis.com/wayback/), [Google Earth Historical](https://github.com/Iconem/GE_TimeMachine)**, [Landsat/Sentinel (HLS)](https://hls.gsfc.nasa.gov/), [Planet](https://www.planet.com/products/basemap/), and [Bing](https://www.bing.com/maps/aerial).

  ![Scrubbing the historical timeline across capture dates](/docs/screenshots/historical-timeline.jpg)
- **Mode Picker: Terrain vs Historical** switches the whole sidebar between Terrain Viewer and a simplified Historical Imagery layout.
- Every historical basemap source feeds real attribution, including dynamically-resolved provider/date info for Wayback, Google Earth Historical, and Bing.
- **The light-direction XY pad itself gained a full bidirectional datetime binding**: drag it and it back-solves the closest matching day-of-year/time-of-day (and the sliders still drive it forward as before), hatching every position the sun can't physically reach at the current latitude (a real day/night-boundary constraint).
- Sun Shadow Calculator: new **Reverse** mode: click a shadow to back-solve the light direction and time of day, knowing building height. Also see the standalone [sun-position estimator](/sun-position-estimator.html) tool.

### Features
- **Historical satellite imagery basemaps + timeline scrubber** — five date-driven basemap sources (ESRI Wayback, NASA HLS Landsat/Sentinel, Google Earth Historical via a reverse-engineered `gehist://` MapLibre protocol (scaffolded from [Iconem/GE_TimeMachine](https://github.com/Iconem/GE_TimeMachine)), Planet Monthly Mosaics behind an API key, and Bing's single current mosaic), consolidated into one "Historical Imagery" sidebar entry rather than five separate rows (which underlying source is active per side is a separate `historicalActiveSource(A/B)` field). A bottom timeline panel shows per-source colored pills (toggle which sources' ticks are shown, filterable by VHR/medium resolution) and a scrubbable track of real per-tile capture dates — not each source's own catalog-wide "release date." Split-screen/per-view mode gets a sync toggle (single chain icon) to move both sides' scrub position together or independently via an A/B picker. Off-screen A/B handles collapse into a rounded chevron chip ("A>"/"<B") that recenters the view on click instead of colliding with the round in-view handle. A "Open in…" launcher opens the current view in BBBike MapCompare or similar external tools.
- **Real per-tile capture dates, not catalog metadata** — Wayback resolves via its own metadata endpoint (deduped by resolved real date, since distinct releases commonly share one — the earlier culprit behind ticks piling onto one pixel), Bing reads a deliberately CORS-exposed `X-VE-TILEMETA-CaptureDatesRange` response header (undocumented but confirmed live to vary genuinely by location/zoom), GE Historical decodes Google's own encrypted `dbRoot`/quadtree-packet protocol.
- **Mode Picker** — clicking the sidebar title ("Terrain Viewer" / "Historical Sat") opens a dialog to switch the app's meta-mode between **Terrain** (the full toolset, unchanged) and **Historical Imagery** (a deliberately stripped-down 2D-only sidebar: no View Mode toggle, no Visualization Modes/Options/Detectors groups, no Elevation Picker, just General Settings, Bookmarks, Download, an ungrouped Basemap picker, and Tools). Settings dialog hides what's terrain-only in this mode too (the Visualization Modes reference section, Tells/Mound-detector beta toggle, high-precision Terrarium-vs-TerrainRGB toggle, MapTiler API key). `appMode` is nuqs/URL state (sorted right after `project` in the URL's own param order), not a local-only setting, and persists its last value across a fresh session like the existing beta-gate flags.
- **Basemap attribution** — every basemap source now feeds MapLibre's attribution control (previously only terrain sources did). Static per-provider strings for OSM/Mapbox/HERE/Bing/Google/Planet/HLS/EOX Sentinel-2-cloudless; genuinely dynamic, current-view-resolved attribution for Esri/Wayback (Esri's public contributor-coverage feed, `static.arcgis.com/attribution/World_Imagery`), Google Earth Historical (the real per-tile capturing provider, decoded straight from Google's own `dbRoot` — a `providerId → copyright` table shipped in the same response already fetched for other purposes, reverse-engineered against Open GEE's `dbroot_v2.proto` and cross-checked against CesiumJS's own `GoogleEarthEnterpriseMetadata`), and Bing (real per-tile capture-date range, see above). The corner `AttributionControl` shows a short static pointer for the three dynamic sources ("see dynamic source attribution in sidebar source panel") since a `<Source>`'s `attribution` prop can never be live-updated post-mount (react-map-gl's own reconciler has no case for it) — but is *also* pushed the real resolved text directly via the underlying MapLibre `Map` instance plus a synthetic `sourcedata` event (`Map.fire`, fully public API, no private methods), so the corner control shows it live too. The sidebar's Source Info section lists every historical source's attribution (dynamic + static) and works in both Terrain and Historical app modes — a raster basemap can be active in either.
- **Inverse solar-position lookup + shadow-based light estimator** (`a43a99f`, refined `09f3803`) — the light-direction XY pad (Hillshade/Phong native + Sun Shadow Calculator) is now a full bidirectional binding in Datetime mode: dragging it back-solves the closest matching day-of-year + time-of-day (closed-form, picking whichever of the two annually-recurring declination solutions is nearer the day already set) and updates the Date/Time sliders, while the sliders still drive the pad forward as before. Free mode shows the same back-solved day/time as a "closest match" caption. The pad hatches every position the sun can never reach at the current latitude (a closed-form spherical-astronomy inequality, not a restrictive tint) and its drag pill turns destructive-red in real time outside that region. Sun Shadow Calculator gains a **Reverse** mode: click an object's base, then its real shadow tip as seen in the imagery, and the shadow's length/bearing plus the object's height back-solve a light direction (and closest-matching day/time) instead of the other way around. A standalone prototype of the forward solve — pick a date/time/location, see the resulting sun position and shadow length — ships alongside it as a mini tool (`bba319b`): [sun-position-estimator.html](/sun-position-estimator.html).

### Bug Fixes
- **Ghost/duplicate timeline marks** — root-caused to distinct Wayback releases resolving to an identical real capture date, which collided on both the tick list's React key and the tick-position map's key, causing React to reuse/misplace DOM nodes (worse after repeated zooming). Fixed by deduplicating Wayback ticks by resolved date at the source, not by trying to visually nudge duplicates apart.
- **Handle-to-mark exact-match jump bug** — the timeline handle resolved which tick was "active" via exact floating-point/timestamp equality, which is fragile across independent data-refresh cycles; switched to nearest-match resolution.
- **Timeline mousewheel zoom/pan stale-closure bug** — the wheel-handler's own `useEffect` depended on values that changed on every tick, causing listener teardown/re-add churn that showed up as occasional freezes/stale positions during fast horizontal scrolling.
- **A/B handle collision** — an off-screen handle previously rendered both the clamped round handle pinned at the track edge *and* a separate off-screen chevron indicator simultaneously; now mutually exclusive.
- Split-mode centering, per-map sidebar padding, minimap/attribution-corner layout regressions, and pastel per-source tick colors derived from each provider's own brand color, from the historical-timeline work above.

# Changelog — Draw export split, Colorramp Editor, Bookmarks Gallery
<!-- released: 2026-07-31 -->

#### TL;DR
- **TerraDraw export split mode**: button with a "split by layer" option.
- **Colorramp editor**: A live session-only for quick, non-persisted ramp-stop edits.
- **Bookmarks gallery** now flattens into one continuous grid by default.

### Features
- **Bookmarks gallery** — flatten toggle (now default-on) shows every view as one continuous grid with two-line "Project" / "View" labels, instead of one grid per project leaving empty slots when a project isn't a multiple of 3 or has just one view.
- **Live colorramp session editor** — a pencil next to every named-ramp picker opens a live stops editor (same alpha-aware color picker as layer colors) for the currently selected ramp; edits are session-only (a plain jotai atom, never persisted to localStorage or the URL) and revert on reload. A Paintbrush toggle next to it swaps the ramp's (near-)black or white stop to transparent, no-op if it has neither.
- **TerraDraw export** — now a split button: the main button exports immediately with the last-used setting; its chevron opens a small popover with a "split export by layer" toggle (one `.geojson` per layer, bundled into a `.zip`, instead of every layer flattened into one file). Import/Clear resized to match (Import/Export at a 2:3 flex ratio, Clear an icon-only button matching their height).
- **Expanding-search geocoder** — collapses to just the search icon until clicked, focused, or typed into (and stays expanded once it has text or a picked result); `Ctrl+G` expands/focuses it alongside the existing `Ctrl+K`. The collapsed icon now matches the other native maplibre controls exactly (size, background, border ring, centering). Enter without arrow-key navigation now commits the top suggestion *and* closes the dropdown, matching arrow+Enter/click behavior. Per-result pin icons removed from the suggestions list.
- **MapLibre native controls (zoom/compass/geolocate) restyled** — their vendor icons were background-image data URIs with a hardcoded gray fill and no theming hook (previously patched over with a blanket CSS `invert()` filter); replaced with real lucide-react icons that follow the theme's foreground color automatically in light and dark, with geolocate's active/error tracking states keeping fixed status colors. Compass now correctly points north (was a diagonal, off-center default icon shape). Both the control group and the geocoder now read the active color preset's card background and corner radius (`--card`/`--radius`) instead of a hardcoded white/fixed radius — switching to a very square (neo-brutalism) or very round preset now visibly carries over to these controls too.
- **`<Select>` keyboard nav** — Left/Right arrow keys now cycle the trigger's value directly without opening the popup (Down/Up still open + navigate it as before), for every existing select in the app with no call-site changes.
- **Mapbox/MapTiler terrain sources** are now hidden from the picker until their API key is set, matching the existing Mapbox/HERE basemap gating.
- **shadcn/ui** — `components.json` style moved to `base-vega` (Base UI's renamed "classic" preset); `package.json` gained a `shadcn:add` script pinned to `-b base` so the CLI can't silently fall back to Radix.

### Bug Fixes
- **Beta toggle persistence** — the Tells and Sun Shadow beta gates were URL-only (nuqs), with no localStorage backing, so they silently reset to off on every reload without an explicit `?tellsBeta=`/`?sunShadowBeta=` param. Fixed by mirroring the last value into a small `atomWithStorage` and restoring it on first load unless the URL already overrides it — the two-system split (nuqs for the shareable gate, jotai for "what I last had it set to") is a bit of an odd shape, but keeps `?tellsBeta=true` links working exactly as before while fixing the reload case.
- **Geocoder dark mode** — the suggestions dropdown background stayed vendor-white (its dark override targeted a BEM class this geocoder version never actually renders) and the clear (X) button stayed a bright white square with a dark icon; both now follow the theme correctly. A stray `overflow: hidden` on the base (not collapsed-only) rule had also been clipping the suggestions dropdown even while expanded.
- **Phong/Matcap tile redraw churn** — the "Terrain Exaggeration" slider (and, less visibly, `matcapRotationDeg`/`phongDiffuseStrength`/`phongSpecularStrength`) fed straight into the `matcap://`/`phong://` tile URL undebounced, so dragging it re-fetched every visible raster tile on every animation frame. All four now go through the same read-side debounce already used for light direction (0ms in the GPU-uniform "live" renderer, 150ms in "raster").
- **Openness/SVF tiles not caching on toggle** — their ray-marched compute yields to the main thread for responsiveness, and the yield point doubled as an abort checkpoint: toggling the mode off mid-tile threw the in-flight result away instead of caching it, which fast (never-yielding) modes never hit. Removed the abort-throw so an already-fetched tile's remaining (bounded) CPU work always finishes and lands in the cache.
- **Bookmark deletion** now cascades to a project's children instead of leaving them orphaned.
- **Copy-template button** (TMS/WMS URL hint) shows a checkmark instead of the green copy icon for 1s after clicking.
- **Sky/horizon/fog colors** moved from an entirely unpersisted plain jotai atom (lost on every reload) to URL/nuqs state, consistent with every other viz-mode setting — also makes them shareable via URL/bookmark like everything else, not just locally remembered.
- Keyframes "Complete vs Smooth" toggle now uses the app's default small `Switch` instead of a custom oversized one.
- Export modal shows a count of local BYOD COG sources next to "Include local COG files".

# Changelog — COG GSD surfacing & Foldable Bookmarks Tree 
<!-- released: 2026-07-30 -->

#### TL;DR
- COG sources now auto-show their inferred native resolution and ground-sample distance.
- Bookmarks: drag-and-drop reordering, collapsible project folders, fold/expand-all, and an edit mode to keep the everyday view uncluttered.

### Features
- **Foldable bookmarks tree** — project (root) bookmarks collapse/expand their child views, file-tree style; a collapsed project shows a stand-in thumbnail (its first child's, by current order, or a placeholder), which hides once expanded since the children show their own.
- **Drag-and-drop reordering for bookmarks** — drag a project to reorder among projects, or a child view to reorder among its own project's siblings; a highlighted line under the target row shows where it'll land instead of outlining the row. Dragging a project only targets other projects (never children), dragging a child only targets siblings of the same project, and dropping over an *expanded* project lands the indicator below its last child rather than right under the header.
- **Fold-all / expand-all** and an **Edit mode toggle** (same convention as the Drawing panel's own layer-edit toggle) for the bookmarks list — rename/delete stay hidden until switched on, so the everyday view is just thumbnails, names, and add-child.
- **Bookmarks gallery** now groups view cards under their parent project's name instead of showing the parent as its own card.
- Clicking a project now restores (and highlights) its first child *by current display order* — reordering children changes what a project click shows, instead of always the originally-created child.
- **Project export**: local COG files now bundle into a `local-cogs/` subfolder inside the export zip instead of the zip root; a new "Bookmark thumbnails as a .zip" option (independent of "Include local COG files") externalizes thumbnails into `bookmarks_thumbs/` on request. Sub-options now sit directly under the category they modify (local COGs under Sources, thumbnails-in-zip under Bookmarks) instead of all at the bottom, and View & Viz State moved to the top of the list.
- **Basemap/terrain source modals** — a copy-to-clipboard icon next to the `{z}/{x}/{y}` / bbox template hint.
- **HERE Maps satellite** added as a builtin basemap provider, key-gated (hidden from the picker until a HERE API key is set, in Settings or `VITE_HERE_API_KEY`) — reordered the builtin basemap picker to Google Hybrid, Bing, Esri, Mapbox, HERE, Google Sat, OSM.
- **BYOD basemap sources** gain user-settable Min/Max Zoom (previously only BYOD terrain sources had this).
- **COG native-resolution inference** — the Add/Edit Terrain/Basemap modals now show the geomatico-inferred native-resolution zoom and mean ground-sample-distance (GSD) for COG/local-COG sources, with Min/Max Zoom as an explicit override; a permanently failed fetch (e.g. CORS) now shows a clear message instead of "Detecting…" forever.
- **BYOD modal rework** — field order is now Name → Type → URL; Advanced now leads with Description and Min/Max Zoom ahead of Linked Source/Bounds and only auto-expands for a non-default value in one of those (not Description alone); COG file requirements are now a "Must be:" bullet list below the file picker.
- Mapbox/MapTiler/Google/HERE API keys moved out of committed source into a local, gitignored `.env`; the Settings batch-edit textarea now uses the same `MAPBOX_ACCESS_TOKEN`-style names (just add/remove `VITE_` to copy between the two).
- **react-scan** added for local dev (dead-code-eliminated from production builds) — outline-rerenders off by default, toggle via its own toolbar.

### Bug Fixes
- **Elevation Picker / Sun-Shadow Calculator** — toggling back to "Select" after drawing something could permanently disable the picker toggle; both now track the shared draw-mode state directly instead of a stale local mirror that only updated on feature edits.
- **Basemap source modal** — pasting a URL containing `{z}/{x}/{y}` while the source type is WMS no longer corrupts the braces into percent-encoded characters (a `new URL()` round-trip was re-encoding the *entire* URL, not just the bbox param it was meant to normalize).
- **Project export** — a plain export (no local COGs) that still had bookmark thumbnails was silently producing real zip bytes labeled and downloaded as `.json`; it now stays a genuine bare JSON document unless a zip is actually requested.
- **Umami analytics** — the `options-relief-visualization` event fired on almost every render instead of only on an actual toggle: the tracked snapshot never stored `svfPrecision`/`opennessPrecision`, so the diff check compared a real value against permanently-`undefined`. Dropped the broken tracking for those two settings.
- **Esri/Bing/Google Satellite maxzoom** corrected (Esri 19, Bing/Google Sat 21) and Bing's hardcoded-token tile URL replaced with the public quadkey endpoint.
- **Color-ramp `<Select>`** — the gradient swatch stopped showing in the closed trigger after the radix→base-ui migration (base-ui's `SelectValue` only renders plain text by default); fixed via its render-prop.
- **Symmetric-range sliders** (Curvature, LRM, Shape Index, Openness, Local Dominance, TPI) could be dragged to a degenerate zero-width range at their minimum; each now floors at its own step instead of 0. TRI/Roughness max range 500→250, TPI max range 100→50.
- **Basemap source-info section** now always renders in the sidebar (matching Terrain), instead of only when Raster Basemap is toggled on.

# Changelog — Whole-Project Export, Hard Shadows & Sun Shadow Calculator
<!-- released: 2026-07-28T17:41 -->

#### TL;DR
- **Whole-project import/export** in one file (terrain/basemap sources, bookmarks, drawings, settings, with zip to embed vector drawings/local COGs as an option).
- **Hard Shadows**: a new visualization mode casting real hard shadows from the shared light direction, independent of the Sun Shadow Calculator tool.
- **Sun Shadow Calculator**: pick a point + an object's height, get its shadow at the current sun position.
- SVF/Openness gain faster precision, plus a new Principal Components (PCA) relief-mode family (Blobness, Eigenvalue Ratio, Dominant Orientation, Shape Index).
- Terrain Analysis's Settings description split into 3 subheadings (Surface derivatives, Neighborhood statistics, Principal Components) to match.

### Features
- **Whole-project import/export** (`138d369`) — sources, bookmarks, drawings, and settings in one file.
- **Hard Shadows visualization mode** (`f802f12`) — hard cast shadows from the shared light direction, as its own toggleable layer independent of the Sun Shadow Calculator tool.
- **Sun Shadow Calculator** (`fc00c4d`) — pick a point and an object height, get its shadow at the current sun position; gated behind Beta (`3ac9196`).
- **SVF/Openness/PCA relief-mode family** (`5806ea9`) — faster precision plus Principal Components siblings (Blobness, Eigenvalue Ratio, Dominant Orientation) and a standalone Shape Index (`d16b23e`).
- **Terrain Analysis Settings description split into Surface derivatives / Neighborhood statistics / Principal Components subheadings** (`b303d9b`) — matching the PCA family's arrival above; also documents Shadows.

# Changelog — Bookmarks & Feature Iterator
<!-- released: 2026-07-28T09:20 -->

#### TL;DR
- **View bookmarks**: save/restore full viewport + viz state, sidebar list + gallery.
- **Feature Iterator**: step through a drawn/imported layer's features one at a time (select, delete, arrow-key nav, fly-to-next).
- A compute-time estimate now shows for slow modes (SVF, Openness, Local Dominance) while their tiles are still loading.

### Features
- **View bookmarks** (`4f7970e`) — save/restore full viewport + viz state, sidebar list + gallery; reorder/hierarchy and geocoded names followed within days (`122a57f`).
- **Feature Iterator** (`46ff80c`) — step through a TerraDraw layer's features one at a time; select/delete/arrow-key nav and fly-to-next-on-delete followed the same session (`26b8670`, `72f3c07`, `82c1668`).
- **Compute-time estimate for slow modes** (`37cd729`) — SVF/Openness/Local Dominance now show an estimated time-remaining while their ray-marched tiles are still computing, based on an empirically-tracked concurrency rather than a naive sequential assumption.

# Changelog — Linked Terrain/Basemap Sources & Non-Geo Mode
<!-- released: 2026-07-28T01:32 -->

#### TL;DR
**Linked terrain/basemap source pairing**: for paired datasets like a fresco's DTM plus its own albedo photo, picking one auto-selects the other. Part of this app's non-geo mode, a **complementary** viewer to RTI/PTM tools like [OpenLime](https://github.com/cnr-isti-vclab/openlime) (not a replacement) for viewing normal-map/albedo photogrammetry data as if it were terrain. See [issue #1](https://github.com/Iconem/terrain-viewer/issues/1) for the feature-parity tracker, and a real example on [OpenLime itself](https://3d.iconem.com/syria/DuraEuropos_Synagogue/index-openlime.html) for comparison.

### Features
- **Linked terrain/basemap source pairing** (`e63746f`) — for paired datasets like a fresco's DTM + albedo photo, picking one auto-selects the other; fixed for real the next morning — imperative resolution, folded link UI, extended to split-view B side (`971d813`, `17fb8fb`). The mechanism behind this app's non-geo mode: a complementary viewer to RTI/PTM tools like OpenLime (not a replacement), for viewing normal-map/albedo photogrammetry data as if it were terrain — see issue #1 for the feature-parity tracker, and a real example on OpenLime itself for comparison.

# Changelog — Contours extended, Local Persistence, Routing & New Tools
<!-- released: 2026-07-27T20:31 -->

#### TL;DR
- Contours extended to local/BYOD COG sources via a dedicated worker, plus line-weight and color controls.
- Local COG files and vector layers now survive a reload via OPFS persistence.
- **Routing mode for Elevation Picker**: a BRouter/Valhalla road-following route (foot/cycle/vehicle profiles) between two picked points instead of a straight line, with a routed elevation profile along it.
- New tools: Source Info panel (states which underlying provider a composited Mapterhorn/AWS tile actually came from, not just the mosaic's name), Plane Slicer (choose Local Relief Model or raw altitude as the reference plane; Contours share the same choice), Local Dominance relief mode (later sped up via pyramid octaves).
- Shared custom colorramp editor extended across every viz mode.
- A cancel button for DTM export appears after ~1.5s if the export is still running.

### Features
- **Routing mode for Elevation Picker** (`214e8df`) — a BRouter/Valhalla road-following route between two picked points (foot/cycle/vehicle profiles) instead of a straight line, with a routed elevation profile along it.
- **Source Info panel** (`81617b1`) — per-tile data-provenance display: for a composited/mosaicked source like AWS Terrain Tiles or Mapterhorn, states which underlying provider tile a given viewport area actually came from, instead of just naming the mosaic itself.
- **Plane Slicer** (`53b5c32`) under Elevation Picker — like Contours, lets you choose whether the slicing/height reference is raw altitude or the Local Relief Model (`planeSlicerReferenceMode`).
- **Local Dominance relief mode** (`22daa85`) — sped up via pyramid octaves (`5c04c82`) — plus a point-to-point profile/line-of-sight tool.
- **Contours extended to local/BYOD COG sources** (`0bb59df`, verified working `1896cfd`) via a dedicated worker — previously contours only worked against the builtin tiled sources (see the Nov 2025/Feb 2026 contours history further down). Gained a line-weight control (1×/2×/4×, `8a6dc12`) and dedicated color pickers (`40a5bb3`); a mount-order race that could drop the layer on a fresh page load was fixed the same week (`8ad313d`).
- **OPFS persistence** for local COG files (`c8948b2`) and drawn/imported vector layers (`00de93b`) — both now survive a reload.
- **Shared custom colorramp editor** extended across every viz mode (`3fab95a`, `9d69b46`).
- **Cancel button for DTM export** (`6798152`) — appears after ~1.5s if the export is still running (most finish faster, so the affordance only shows up when it's actually worth using).

# Changelog — RiverREM
<!-- released: 2026-07-27T12:03 -->

#### TL;DR
The footer's "Also see" links now explicitly describe **[RiverREM](https://rem.prod.heritagewatch.ai/)** ([repo](https://github.com/Iconem/RiverREM_UI)), a separate app built for a similar use case, on rivers instead of terrain: draw or import a river centerline (or fetch one from OSM via Overpass/QLever, the longest named waterway, or all matches), smooth/interpolate its water-surface elevation (WSE) along that line, then de-trend the DEM against it (`REM = DEM − WSE`) to get a Relative Elevation Model highlighting fluvial terraces a flat elevation map hides, pure client-side, or server-based via OpenTopography's Python `RiverREM`.

### Features
- **RiverREM footer link** (`115d789`) — the same commit that added the shared hillshade/Phong datetime light (see the historical-satellite entry above) also added this app's own footer link to RiverREM, a separate Iconem app for the analogous river-relative-elevation-model use case.

# Changelog — Matcap/Phong Lighting Rebuilt as Live WebGL Shaders
<!-- released: 2026-07-22T15:26 -->

#### TL;DR
Matcap/Phong lighting was rebuilt as live WebGL shaders, then reverted the same morning to a GPU-accelerated raster-tile approach after the WebGL version proved unstable; native MapLibre Hillshade was restored as its own mode alongside it.

### Features
- **Matcap/Phong Lighting rebuilt as live WebGL shaders, then reverted to GPU-accelerated raster tiles** — Lighting Effects was first redesigned around local-file/COG basemap sources (`674103f`), then rebuilt as custom WebGL layers with live shader uniforms less than 20 minutes later (`e047058`). After native MapLibre Hillshade was restored as its own mode alongside it (`5619d6c`) and a globe-rendering fix was attempted (`7153d02`), the WebGL rebuild proved unstable and was reverted back to plain raster-tile protocols the same morning (`d2833b0`), which then got GPU-accelerated instead (`6ef0651`), the version that stuck. An RTI-style hold-L light-control overlay for quick relighting had landed a few days earlier (`3f941c0`). An absolute/camera-relative light-mode toggle (`5367e36`) and, the next day, camera-attached live light plus a no-debounce "2D Fast" mode (`3067467`) rounded it out.

# Changelog — Theme Editor
<!-- released: 2026-07-21T23:14 -->

#### TL;DR
New standalone **Theme Editor**: live Tailwind v4/shadcn theming with tweakcn/shadcnstudio presets.

### Features
- **Theme Editor** (`690fa35`, presets `35ba71c`/`a6ea8e8`, Basic mode `42e9c16`) — a standalone, drop-in live Tailwind v4/shadcn theme editor with HSL adjustment/randomize and localStorage-saved custom themes (`ed4f502`), plus themux/shadcnstudio preset packs; later moved into Settings (`b9b6622`).

### Bug Fixes
- `7579f06` fixed the Theme Editor's fonts never actually applying.

# Changelog — Relief Visualization Split & Sidebar Labels
<!-- released: 2026-07-18T19:05 -->

#### TL;DR
- **Relief Visualization** split into its own separate group (**Sky View Factor SVF, Openness**) from **Terrain-analysis (Curvature, TPI, Roughness, Det-Hessian, Blobness)**.

  ![Sky-View Factor relief visualization](/docs/screenshots/svf.jpg)
- Relief Visualization and Terrain Analysishave a Basic/Advanced collapse toggle to either just activate/deactivate the additional sub-modes, or go further and edit their symbology.
- **Keyboard shortcuts**: Shift-tap to peek at the raster basemap, Ctrl-tap to hide every overlay down to just the basemap. See all keyboard shortcuts in the dedicated section of General Settings modal. 
- **Labeled Sources / Options / Detectors / Tools sidebar dividers** for scanning a long control panel.

### Features
- **Terrain Analysis / Relief Visualization split into separate groups** (`34065c4`) — same commit also added the Shift-tap basemap-peek shortcut and macro-group separators.
- **Basic / Advanced mode toggle** — Terrain Analysis and Relief Visualization sections collapse to just checkbox + opacity slider, hiding sub-mode options until wanted.
- **Keyboard shortcuts** — Shift-tap to peek at the raster basemap; Ctrl-tap to hide every overlay down to just the basemap, tap again to restore.
- **Labeled sidebar dividers** (`8e8d71a`) — Sources / Options / Detectors / Tools section breaks for scanning a long control panel; pinned open + reordered a day later (`7e2069d`).
- **Same source on both A/B** — split-screen source pickers only ever showed one side as selected, even when both used the same source; fixed to show both independently.

### Bug Fixes
- **Sidebar scroll/header glitches** — corner-rounding squaring off, button group shifting, fast-scroll jitter.
- **Overlays ignoring their own max zoom** — hardcoded limit overrode a source's real tile pyramid (e.g. NASA GIBS), causing tile-request errors.
- **2D Elevation Picker freeze** on large COG files.

# Changelog — TerraDraw Multi-Layer Drawing
<!-- released: 2026-07-18T12:12 -->

#### TL;DR
TerraDraw becomes multi-layer: drawing and GeoJSON import now target whichever layer is active.

### Features
- **Multi-layer TerraDraw** (`2218813`) — drawing and importing GeoJSON now target a specific layer instead of one implicit layer (GeoJSON import itself dates back to TerraDrawSystem's original introduction, Feb 2026 — see further down); the same commit also fixed a TerraDraw cold-start delay.

# Changelog — Local COG (BYOD) Terrain Sources
<!-- released: 2026-07-15 -->

#### TL;DR
- **Local COG (BYOD) terrain sources**: load a `.cog.tif` straight off disk, no upload.
- **Viz-mode tile caching**: an LRU of finished viz-mode tile bytes that makes re-toggling a mode instant instead of recomputing it.

### Features
- **Local COG (BYOD) terrain sources** (`a0c9da3`) — pick a `.tif` off disk, no upload, with CRS/tiling validation.
- **Viz-mode tile caching** (`cacheVizTiles`, same commit `a0c9da3`, later touched again `138d369`) — an LRU of finished viz-mode tile bytes that makes re-toggling a mode instant instead of recomputing it.

# Changelog — Mound Local Tops Detector Beta
<!-- released: 2026-07-12 -->

#### TL;DR
Experimental **"Tells" archaeological mound detector**, gated behind a Beta toggle: flags candidate mounds by finding local extrema/maxima of the LRM, then veto-filters them by Blobness, Plan Curvature/Divergence, and Det-Hessian to reject saddles and ridges.

### Features
- **Archaeological mound detection ("Tells")** (`125edbb` protocol, gated `76c55f5`, explainer `3bada59`) — experimental detector flags candidate mounds from curvature/blobness; own section, color-by ramps, export, explainer, beta toggle.

# Changelog — Terrain Analysis: Curvature Suite Expanded
<!-- released: 2026-07-11 -->

#### TL;DR
**Terrain-analysis suite**: **Profile curvature** (rate of slope change along the steepest-descent direction, i.e. flow acceleration) and **Plan curvature** (rate of aspect change across contours, i.e. flow convergence/divergence), plus **TPI and Roughness; Det-Hessian and Blobness** followed.

### Features
- **Curvature/TPI/Roughness terrain-analysis suite** (`ca3b679`) — Profile curvature and Plan curvature (defined in the TL;DR above), TPI, and Roughness; the 3×3-neighborhood default and the profile/plan split were documented in Settings the same day (`5d0c200`).
- **Det-Hessian curvature mode and Blobness structure-tensor sub-mode** (`23f6079`) — added a day later.
- **Higher-precision terrain-derived tiles** — curvature, aspect, TRI, roughness, openness, blobness, and LRM now wire-encode ~25x finer, cutting visible banding.

### Bug Fixes
- **TerraDraw**: init race, GeoJSON import double-counting, Fast-Refresh break.
- **Minimap**: cold-start delay and resize bug.
- **TypeScript errors cleared to zero**.

# Changelog — Local Relief Model (LRM) Relative Elevation to neighborhood
<!-- released: 2026-07-10T12:41 -->

#### TL;DR
**Local Relief Model (LRM)**: a new relief mode isolating local bumps from the regional trend. This is compute-optimized by subtracting the elevation tiles altitude at native viewport resolution from the bi-linearly interpolated trend, requested from a lower resolution version of the pyramid. User can control how many levels lower, and sees the resulting gaussian mean scale he chooses.

### Features
- **Local Relief Model (LRM)** (`d45a4ae`) — multi-scale relief mode isolating local bumps from the regional trend.

# Changelog — Client-Side DSM Export, Project Presets, Basemap Overlays & Elevation Picker
<!-- released: 2026-07-09T22:52 -->

#### TL;DR
- **Client-side GeoTIFF export** without Titiler, and shareable per-project embed configs.
- **Project embed presets**: `?project=` links can seed a fully preconfigured view: 
   - **[Mapterhorn Globe](/?project=mapterhorn-globe)** (zoomed-out world view, Mapterhorn-only, source pickers hidden), 
   - **[Dura Frescoes Viewer](/?project=dura)** (fixed 2D non-geo fresco view, most terrain-analysis tooling hidden), 
   - and a minimal **[Example Embed](/?project=example-embed)**, see [lib/projects.json](https://github.com/Iconem/terrain-viewer/blob/main/lib/projects.json).
- **Basemap overlays** (samples ships demo radar, trails, stamen watercolor) that layer on top of any basemap instead of replacing it.
- **Elevation Picker**: click-to-sample elevation at point or delta between two-points

### Features
- **Client-side DTM export & project embed system** (`57c3d7a`) — export GeoTIFF from the browser without Titiler; per-project embed/URL config; a WMS layer picker for BYOD WMS sources.
- **Project embed presets** (`a1d8ab8`) — `?project=` presets can seed custom sources, auto-zoom to a source's real (COG-read) bounds, override the sidebar title, and are exportable via a "Save Project Preset" tool in Settings. Shipped with: **Mapterhorn Globe** and **Dura Frescoes Viewer** presets (`lib/projects.json`), each simplifying the sidebar to just what that site needs — Dura hides contours/Terrain-Analysis/Relief-Visualization/split-screen/elevation-picker entirely and disables the globe view mode, Mapterhorn Globe hides every source picker and opens straight into a zoomed-out globe.
- **Elevation Picker** (`a1d8ab8`) — click-to-sample elevation (3D/globe via `queryTerrainElevation`, 2D via client-side tile fetch/decode), two-point delta, auto-deactivates during TerraDraw drawing modes.
- **Basemap overlays** (`a1d8ab8`) — role (basemap/overlay) on custom basemap sources, multi-select overlay checklist, stacked rendering, sample overlays (Stadia Watercolor, Waymarked Trails, OpenWeatherMap radar), shared basemap opacity slider.

### Bug Fixes
- **Slope-and-More now supports all source types**, project embed polish, several stale-state fixes (`dd2f462`).

# Changelog — Slope Visualization Mode 
<!-- released: 2026-07-08T17:14 -->

#### TL;DR
**Slope visualization mode**: launched as a PlanTopo server-hosted overlay (computed offline from Mapterhorn), upgraded to a client-side "Slope and More" v2: a custom MapLibre protocol computed directly from whichever terrain source is active (BYOD included), rather than PlanTopo's own fixed dataset. Later grew into the full curvature/TPI/roughness/LRM/Tells suite above.

![Slope-angle visualization mode](/docs/screenshots/slope.jpg)

### Features
- **Slope viz mode** (`ba51907`) — a PlanTopo-hosted server overlay (their own precomputed slope-angle raster); upgraded the same day (`8612990`) to a client-side custom MapLibre protocol computed from whichever terrain source is active ("Slope and More" v2) — the same viz mode that later grew into the full curvature/TPI/roughness/LRM/Tells suite (see the Jul 10–12 entries above).

# Changelog — NextGIS QMS, Photon Geocoder, Animation Pose via URL & TileJSON
<!-- released: 2026-07-07T23:39 -->

#### TL;DR
- **NextGIS QMS search**: search and add basemaps directly from [NextGIS QuickMapServices](https://qms.nextgis.com/) public catalog; 
- Switched search location geocoder to **Photon geocoder**.
- Camera/animation poses are now URL-shareable.
- Added TileJSON data source type
- Added new colorramps CET/SDR ramps 

### Features
- **Camera/animation pose rework** (`ca16705`) — URL-shareable camera state (nuqs, deltas between pose1/pose2 rather than compressed absolutes); Home now correctly resets saved poses.
- **NextGIS QMS search** (`517898a`, overflow/templating fix `a2e24cd`) — search and add basemaps directly from NextGIS's public QuickMapServices catalog.
- **More data sources** — TileJSON, CET/SDR ramps, WMS-raw, Photon geocoder.

# Changelog — Light-Direction Spherical Control via XYPad
<!-- released: 2026-02-19T14:24 -->

#### TL;DR
Light-direction control for Hillshade via XYPad: drag a 2D pad to set illumination azimuth/elevation, instead of two separate sliders.

![Dragging the XYPad to set light azimuth/elevation](/docs/screenshots/hillshade-direction.webp)

### Features
- **XYPad for 2D illumination-direction selection** (`07fc46e`) — drag a pad to set Hillshade/Phong light azimuth+elevation together; gained real angular constraints (can't drag past the sun's physically reachable range) five days later (`3b85160`). The *true* bidirectional datetime binding (drag the pad, back-solve the closest matching day/time; day/night-boundary hatching) came much later — see the Aug 7 entry above (`a43a99f`, `09f3803`).

# Changelog — Animation, Video Export & Minimap
<!-- released: 2026-02-19T10:30 -->

#### TL;DR
- **Animation Capabilities**, with keyframe-based (Complete vs Smooth) video export.
- **Video export** tries **MediaBunny** first (real muxed MP4/H.264 via WebCodecs), falling back to raw **WebCodecs** (H.264, no muxing) if MediaBunny throws, then all the way to **MediaRecorder** (WebM) if the browser lacks WebCodecs entirely.
- **Minimap** with main viewport footprint/frustum bbox shown, fully configurable.
- Finer Terrarium quantization (4mm vs. TerrainRGB 10cm) shipped as a High-Precision toggle.

### Features
- **Minimap with footprint and frustum** (`96d8b04`, preceded by WIP passes `349785e`/`1c0e656`).
- **Animation Capabilities** (`40b32c7`) — keyframe poses, Complete (interpolates every numeric setting) vs Smooth (camera-only) modes; native share for mobile (`a00f613`, `cd90bb3`).
- **Video export overhaul** (`93cbc77`, superseding earlier attempts `3b88d97`/`878fb70`) — three-tier fallback chain: **MediaBunny** (`69c3efe`) first, a real muxed MP4/H.264 via WebCodecs under the hood, no per-browser codec-support roulette; falls back to raw **WebCodecs** (H.264-ish, no muxing) if MediaBunny itself throws; falls all the way back to **MediaRecorder** (WebM, VP9/VP8) if the browser has no WebCodecs `VideoEncoder` at all. Restored/hardened in July (`740b724`).
- **High-Precision Elevation Quantization** (`ecd76ba`) — finer Terrarium encoding (3.9mm steps) as an alternative to TerrainRGB (10cm steps) via the Geomatico COG-protocol middleware, with a same-day fix for reset/layer state on high-res-quantized COGs (`b614aae`).

# Changelog — Drawing Tools via TerraDraw, Sources Samples & Contours Consolidation
<!-- released: 2026-02-18 -->

#### TL;DR
- **Drawing Tools** via TerraDraw: draw shapes, points, and more; import/export geojson features.
- **Load Sample buttons** added to the terrain/basemap source pickers with a variety of nation-wide sources.
- **Contours** reworked and consolidated into their own "Contours & GeoGrid" section.
- Fold/expand-all for every sidebar section, with collapsed state now persisted via jotai atomWithStorage.

### Features
- **TerraDrawSystem** (`42e5760`) — the drawing-tools system (shapes, points, GeoJSON import/export), alongside a rework of the main terrain-viewer component; reworked again the next day (`282304c`).
- **Contours reworked** (`8574074`, `f136a94`) — restructured into their own "Contours & GeoGrid" section (color pickers/line-weight controls followed later, July 2026 — see above).
- **Fold/expand-all for sidebar sections** (`4d96202`) — every section's collapsed/expanded state now persists via `atomWithStorage`, alongside a broader foldable-sections rework.
- Custom terrain/basemap samples added to the BYOD modals (`3cd8688`).
- **"Load Sample" buttons** on the terrain/basemap source pickers — likely also originate here (`3cd8688`), though not confirmed by a distinct commit citing that exact label; flagged as unconfirmed rather than guessed further.

# Changelog — BYOD Basemaps & WMS/DTM-DSM Sources
<!-- released: 2026-02-13 -->

#### TL;DR
- **BYOD basemaps** TMS, WMS, COG, finalized as their own custom-source type via custom protocol, alongside the existing BYOD terrain sources.
- **WMS raw-elevation support** (e.g. IGN France) now stream as MapLibre raster-dem via a custom MapLibre protocol. Standalone demo: [maplibre-raster-dem-wms-float32-generic.html](/maplibre-raster-dem-wms-float32-generic.html).
- DTM-DSM LidarHD selector in samples
- Graticule layer
- Share section

### Features
- **BYOD Basemaps finalized** (`3582cbd` prepare Feb 2, `671bd0b` finalize Feb 3) — custom basemap sources alongside the existing BYOD terrain-source support from Nov 2025.
- **IGN France WMS raster-DEM example** (`4606dd1`) — a real WMS raw-elevation source wired up as a MapLibre raster-dem terrain source.
- **WMS-raw elevation as raster-dem, generalized** (`d0fde9c`) — generalized the IGN France example above into a reusable **MapLibre custom protocol** (not a one-off fetch/transform) that decodes raw Float32 WMS elevation responses into MapLibre's raster-dem tile format directly. Standalone demo: [maplibre-raster-dem-wms-float32-generic.html](/maplibre-raster-dem-wms-float32-generic.html).
- **Graticule layer** (`0b5c12d`), **Share section** (`db380d1`), **DTM-DSM LidarHD selector** (`10e9609`).
- `TerrainControlPanel` exploded into one-file-per-section sub-components (`c4d2218`) — the sidebar's file structure since.

# Changelog — cpt-city Colorramp Library
<!-- released: 2025-11-18 -->

#### TL;DR
Adding a large open-license colorramp library, [cpt-city](https://phillips.shef.ac.uk/pub/cpt-city/), with classic, topo, topobath, top qgis, and temp groups.

### Features
- **cpt-city colorramp pipeline** (`ba2b492`): a large open-license colorramp library parsed via a new `cpt2js`-based pipeline, a standalone cpt-city archive-parser mini-app to harvest it (`57bf00a`), topobath ramps (`0ccb447`), and a further significant expansion (`b5254fc`).

# Changelog — Geomatico COG Protocol vs. Titiler
<!-- released: 2025-11-14 -->

#### TL;DR
Offer the choice to stream COG via **Geomatico's native MapLibre COG-protocol vs. Titiler**. The direct client protocol avoids Titiler's rate limiting and is faster (no middleware hop), but is less permissive: it only reads COGs already in Web Mercator (EPSG:3857), where Titiler can reproject on the fly server-side.

### Features
- **Geomatico COG Protocol introduced alongside Titiler** (`b6beb09`, toggle `9618fbc`). Direct client-side COG consumption as an alternative to the Titiler middleware: no server-side hop means no Titiler rate-limiting and lower latency, at the cost of only handling COGs already tiled in Web Mercator (EPSG:3857) — Titiler can reproject arbitrary source CRS on the fly, this can't. The toggle between them (`useCogProtocolVsTitiler`) is still in Settings → Streaming today.

# Changelog — BYOD (Bring Your Own Data) Terrain Sources
<!-- released: 2025-11-07 -->

#### TL;DR
**Bring Your Own Data (BYOD) Terrain** sources let users import their own TMS, COG remote endpoint terrain sources.

### Features
- **BYOD (Bring Your Own Data) terrain sources** (`f24c1bc`): the initial scaffold's `terrain-types.ts` already had a placeholder `"custom"` encoding value, but the real user-facing feature (Add Custom Terrain Source modal, wiring it up like any other source) landed 3 days later, in `f24c1bc`.

# Changelog — Initial Launch, Viz Modes, Shareable URLs & Split Mode
<!-- released: 2025-11-04 -->

#### TL;DR
- **Initial launch** with all user-controls on one foldable, sidebar control panel. UI transparency on slider change enables better-feedback, 2D/3D/Globe map projection modes.
- **Terrain visualization modes**: Hillshade (Combined, Standard, Aspect Multidir colors, Igor, Basic), Hypsometric color-relief, Raster Basemap
- **Sources for Terrain** (Terrarium /TerrainRGB): [Mapterhorn](https://mapterhorn.com/), [Mapbox](https://www.mapbox.com/), [Maptiler](https://www.maptiler.com/). [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
- Source for Raster Basemaps: [Google](https://mapsplatform.google.com/), [Bing](https://www.bing.com/maps/aerial), [ESRI](https://www.esri.com/en-us/arcgis/products/arcgis-image/services/world-imagery), [Mapbox](https://www.mapbox.com/), [Here](https://www.here.com/), [OSM](https://www.openstreetmap.org/)
- **Shareable URLs**, State persisted to URL via nuqs so any shared url results in visually the exact same map.
- **Split Mode**: A/B side-by-side comparison, originally built for comparing the same location's resolution/quality across different terrain sources (Mapterhorn vs. Mapbox/MapLibre terrain-RGB vs. AWS Terrain Tiles).

### Features
- **Initial launch** (`29ced9e`, `1e12655`, `535bb2a`, `c4d067f`) — the app's first version already had Hillshade, hypsometric tint (color-relief), a raster basemap, split-screen A/B comparison, and a UI-transparency option, all driven from the sidebar control panel (`components/terrain-controls.tsx`, `components/terrain-viewer.tsx`, `components/ui/sidebar.tsx`) — contours were present too, stabilized two days later (`069570e`).
- **Split Mode (A/B side-by-side comparison)** — built to compare the same location across different terrain sources at various resolutions/qualities (e.g. Mapterhorn vs. Mapbox/MapLibre terrain-RGB vs. AWS Terrain Tiles), not just different imagery. The later Overlay (blend-mode compositing) and Grid (up to 8 views) shapes both grew out of this original two-way split — see July/August 2026 above.
