# Changelog — August 11, 2026: Histogram Color Matching in Compare and Blend

#### TL;DR
- **Match Colors** — automatically recolors every other view onto View A's color histogram, so two different imagery sources (or two dates of the same source) no longer look noticeably darker/bluer/warmer next to each other when compared or blended.
- Five color spaces to choose from — RGB is instant (a live CSS filter); HSL/HSV/LAB/LCH are slower but can match more subtle color differences. Ported from Iconem/historical-satellite's standalone [histogram-matching demo](/histogram-matching-example/histogram-matching.html), vendored under `public/histogram-matching-example/` for reference.

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

# Changelog — August 10, 2026: N-Map Grid & Overlay Comparison

#### TL;DR
- Compare and Blend section now supports a full grid of up to 8 synced map views, not just a 2-way split.
- Export historical GeoTIFFs across a date range, with an option to generate ready-to-run `gdal_translate` scripts.
- Optional colored map borders and a capture-date pill make it easy to tell which pane is which.
- Overlay's Blend Mode dropdown now exposes every CSS blend mode, not just a curated handful.

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

# Changelog — August 7, 2026: Historical Satellite Imagery Timeline, Terrain vs Historical Mode Picker

#### TL;DR
- New "Historical Imagery" mode: scrub a real per-tile capture-date timeline bottom panel, across **ESRI Wayback, Google Earth Historical**, Landsat/Sentinel, Planet, and Bing.
- **Mode Picker** switches the whole sidebar between Terrain Viewer and a simplified Historical Imagery layout.
- Every historical basemap source now feeds real attribution, including dynamically-resolved provider/date info for Wayback, Google Earth Historical, and Bing.
- Sun Shadow Calculator: new **Reverse** mode — click a shadow to back-solve the light direction and time of day; the light-direction pad itself gained the same inverse lookup. Also see the standalone [sun-position estimator](/sun-position-estimator.html) tool.

### Features
- **Historical satellite imagery basemaps + timeline scrubber** — five date-driven basemap sources (ESRI Wayback, NASA HLS Landsat/Sentinel, Google Earth Historical via a reverse-engineered `gehist://` MapLibre protocol, Planet Monthly Mosaics behind an API key, and Bing's single current mosaic), consolidated into one "Historical Imagery" sidebar entry rather than five separate rows (which underlying source is active per side is a separate `historicalActiveSource(A/B)` field). A bottom timeline panel shows per-source colored pills (toggle which sources' ticks are shown, filterable by VHR/medium resolution) and a scrubbable track of real per-tile capture dates — not each source's own catalog-wide "release date." Split-screen/per-view mode gets a sync toggle (single chain icon) to move both sides' scrub position together or independently via an A/B picker. Off-screen A/B handles collapse into a rounded chevron chip ("A>"/"<B") that recenters the view on click instead of colliding with the round in-view handle. A "Open in…" launcher opens the current view in BBBike MapCompare or similar external tools.
- **Real per-tile capture dates, not catalog metadata** — Wayback resolves via its own metadata endpoint (deduped by resolved real date, since distinct releases commonly share one — the earlier culprit behind ticks piling onto one pixel), Bing reads a deliberately CORS-exposed `X-VE-TILEMETA-CaptureDatesRange` response header (undocumented but confirmed live to vary genuinely by location/zoom), GE Historical decodes Google's own encrypted `dbRoot`/quadtree-packet protocol.
- **Mode Picker** — clicking the sidebar title ("Terrain Viewer" / "Historical Sat") opens a dialog to switch the app's meta-mode between **Terrain** (the full toolset, unchanged) and **Historical Imagery** (a deliberately stripped-down 2D-only sidebar: no View Mode toggle, no Visualization Modes/Options/Detectors groups, no Elevation Picker, just General Settings, Bookmarks, Download, an ungrouped Basemap picker, and Tools). Settings dialog hides what's terrain-only in this mode too (the Visualization Modes reference section, Tells/Mound-detector beta toggle, high-precision Terrarium-vs-TerrainRGB toggle, MapTiler API key). `appMode` is nuqs/URL state (sorted right after `project` in the URL's own param order), not a local-only setting, and persists its last value across a fresh session like the existing beta-gate flags.
- **Basemap attribution** — every basemap source now feeds MapLibre's attribution control (previously only terrain sources did). Static per-provider strings for OSM/Mapbox/HERE/Bing/Google/Planet/HLS/EOX Sentinel-2-cloudless; genuinely dynamic, current-view-resolved attribution for Esri/Wayback (Esri's public contributor-coverage feed, `static.arcgis.com/attribution/World_Imagery`), Google Earth Historical (the real per-tile capturing provider, decoded straight from Google's own `dbRoot` — a `providerId → copyright` table shipped in the same response already fetched for other purposes, reverse-engineered against Open GEE's `dbroot_v2.proto` and cross-checked against CesiumJS's own `GoogleEarthEnterpriseMetadata`), and Bing (real per-tile capture-date range, see above). The corner `AttributionControl` shows a short static pointer for the three dynamic sources ("see dynamic source attribution in sidebar source panel") since a `<Source>`'s `attribution` prop can never be live-updated post-mount (react-map-gl's own reconciler has no case for it) — but is *also* pushed the real resolved text directly via the underlying MapLibre `Map` instance plus a synthetic `sourcedata` event (`Map.fire`, fully public API, no private methods), so the corner control shows it live too. The sidebar's Source Info section lists every historical source's attribution (dynamic + static) and works in both Terrain and Historical app modes — a raster basemap can be active in either.
- **Inverse solar-position lookup + shadow-based light estimator** — the light-direction XY pad (Hillshade/Phong native + Sun Shadow Calculator) is now a full bidirectional binding in Datetime mode: dragging it back-solves the closest matching day-of-year + time-of-day (closed-form, picking whichever of the two annually-recurring declination solutions is nearer the day already set) and updates the Date/Time sliders, while the sliders still drive the pad forward as before. Free mode shows the same back-solved day/time as a "closest match" caption. The pad hatches every position the sun can never reach at the current latitude (a closed-form spherical-astronomy inequality, not a restrictive tint) and its drag pill turns destructive-red in real time outside that region. Sun Shadow Calculator gains a **Reverse** mode: click an object's base, then its real shadow tip as seen in the imagery, and the shadow's length/bearing plus the object's height back-solve a light direction (and closest-matching day/time) instead of the other way around. A standalone prototype of the forward solve — pick a date/time/location, see the resulting sun position and shadow length — ships alongside it as a mini tool: [sun-position-estimator.html](/sun-position-estimator.html).

### Bug Fixes
- **Ghost/duplicate timeline marks** — root-caused to distinct Wayback releases resolving to an identical real capture date, which collided on both the tick list's React key and the tick-position map's key, causing React to reuse/misplace DOM nodes (worse after repeated zooming). Fixed by deduplicating Wayback ticks by resolved date at the source, not by trying to visually nudge duplicates apart.
- **Handle-to-mark exact-match jump bug** — the timeline handle resolved which tick was "active" via exact floating-point/timestamp equality, which is fragile across independent data-refresh cycles; switched to nearest-match resolution.
- **Timeline mousewheel zoom/pan stale-closure bug** — the wheel-handler's own `useEffect` depended on values that changed on every tick, causing listener teardown/re-add churn that showed up as occasional freezes/stale positions during fast horizontal scrolling.
- **A/B handle collision** — an off-screen handle previously rendered both the clamped round handle pinned at the track edge *and* a separate off-screen chevron indicator simultaneously; now mutually exclusive.
- Split-mode centering, per-map sidebar padding, minimap/attribution-corner layout regressions, and pastel per-source tick colors derived from each provider's own brand color, from the historical-timeline work above.

# Changelog — July 31, 2026: Draw export split, Colorramp Editor, Bookmarks Gallery

#### TL;DR
- TerraDraw export becomes a split button with a "split by layer" option.
- A live colorramp session editor for quick, non-persisted ramp-stop edits.
- **Bookmarks gallery** now flattens into one continuous grid by default.
- Native map controls (zoom/compass/geolocate) and the geocoder now follow your color theme.
- shadcn/ui moved to Base UI's `base-vega` preset.

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

# Changelog — July 30, 2026: Foldable Bookmarks Tree, COG GSD surfacing & BYOD Source Polish

#### TL;DR
- Bookmarks: drag-and-drop reordering, collapsible project folders, fold/expand-all, and an edit mode to keep the everyday view uncluttered.
- COG sources now auto-show their inferred native resolution and ground-sample distance.
- Project export: local COG files now bundle into their own `local-cogs/` subfolder instead of the zip root.
- BYOD modal reworked: clearer field order (Name → Type → URL) and a "Must be:" file-requirements checklist.

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

# Changelog — July 28, 2026: Bookmarks, Project Export & Sun Shadow Calculator

#### TL;DR
- **View bookmarks introduced** — save/restore full viewport + viz state, sidebar list + gallery.
- Whole-project import/export in one file (terrain/basemap sources, bookmarks, drawings, settings, with zip to embed vector drawings/local COGs as an option).
- **Sun Shadow Calculator** — pick a point + an object's height, get its shadow at the current sun position; plus a hard cast-shadow **Shadows** layer as its own visualization mode.
- SVF/Openness gain faster precision, plus a new Principal Components (PCA) relief-mode family (Blobness, Eigenvalue Ratio, Dominant Orientation, Shape Index).

### Features
- **View bookmarks introduced** (`4f7970e`) — save/restore full viewport + viz state, sidebar list + gallery; reorder/hierarchy and geocoded names followed within days (`122a57f`).
- **Whole-project import/export** (`138d369`) — sources, bookmarks, drawings, and settings in one file.
- **Sun Shadow Calculator** (`fc00c4d`) — pick a point and an object height, get its shadow at the current sun position; gated behind Beta (`3ac9196`). A **Shadows** layer (hard cast shadows from the shared light direction) followed (`f802f12`).
- **SVF/Openness/PCA relief-mode family** (`5806ea9`) — faster precision plus Principal Components siblings (Blobness, Eigenvalue Ratio, Dominant Orientation) and a standalone Shape Index (`d16b23e`).

### Bug Fixes
- The following day (`b3252fb`, Jul 29) was almost entirely the Radix→Base UI component migration and dependency cleanup — no new features that week.

# Changelog — July 21, 2026: Multi-layer Drawing Tools & Lighting/Relief Tools

#### TL;DR
- **TerraDraw becomes multi-layer** — drawing and GeoJSON import now target whichever layer is active; local COG files and vector layers now survive a reload via OPFS persistence.
- **Matcap/Phong lighting** introduced as live WebGL shaders; native MapLibre Hillshade restored as its own mode alongside it.
- New visualization modes: Local Dominance relief mode, point-to-point profile/line-of-sight.
- New tools: Source Info panel, Plane Slicer.
- Contours extended to local/BYOD COG sources via a dedicated worker, plus line-weight and color controls.
- New standalone **Theme Editor** — live Tailwind v4/shadcn theming with tweakcn/shadcnstudio presets.
- **Linked terrain/basemap source pairing** — for datasets like a fresco's DTM plus its own albedo photo, picking one auto-selects the other.

### Features
- **Theme Editor** (`690fa35`, presets `35ba71c`/`a6ea8e8`, Basic mode `42e9c16`) — a standalone, drop-in live Tailwind v4/shadcn theme editor with HSL adjustment/randomize and localStorage-saved custom themes (`ed4f502`), plus themux/shadcnstudio preset packs; later moved into Settings (`b9b6622`).
- **Matcap/Phong lighting rebuilt as live WebGL layers** (`e047058`, GPU-accelerated `6ef0651`) — replacing the earlier raster-tile-only approach; redesigned again around local-file/COG basemap sources shortly after (`674103f`). Native MapLibre Hillshade was restored as its own mode alongside the new Lighting Effects (`5619d6c`), and an RTI-style hold-L light-control overlay was added for quick relighting (`3f941c0`, weight-control follow-up `8a6dc12`). Camera-attached live light plus a no-debounce "2D Fast" mode landed a day later (`3067467`), followed by an absolute/camera-relative light-mode toggle (`5367e36`) and a shared hillshade/Phong datetime light with a UTC/local toggle (`115d789`).
- **Contours extended to local/BYOD COG sources** (`0bb59df`, verified working `1896cfd`) via a dedicated worker — previously contours only worked against the builtin tiled sources (see the Nov 2025/Feb 2026 contours history further down). Gained a line-weight control (1×/2×/4×, `8a6dc12`) and dedicated color pickers (`40a5bb3`); a mount-order race that could drop the layer on a fresh page load was fixed the same week (`8ad313d`).
- **Local Dominance relief mode + point-to-point profile/line-of-sight tool** (`22daa85`) and a **Plane Slicer** under Elevation Picker (`53b5c32`).
- **Source Info panel** (`81617b1`) — per-tile data-provenance display for AWS/Mapterhorn sources.
- **Routing mode for Elevation Picker** (`214e8df`, BRouter/Valhalla) with a routed elevation profile.
- **Multi-layer TerraDraw** (`2218813`) — drawing and importing GeoJSON now target a specific layer instead of one implicit layer (GeoJSON import itself dates back to TerraDrawSystem's original introduction, Feb 2026 — see further down). **OPFS persistence** for local COG files (`c8948b2`) and drawn/imported vector layers (`00de93b`) — both now survive a reload.
- **Shared custom colorramp editor** extended across every viz mode (`3fab95a`, `9d69b46`), and **linked terrain/basemap source pairing** for paired datasets like a fresco's DTM + albedo photo (`e63746f`).

### Bug Fixes
- `d2833b0` reverted the same day's WebGL Matcap/Phong rebuild back to plain raster-tile protocols after `e047058` proved unstable — the live-shader version that stuck landed via the redesign in `674103f` instead.
- `7153d02` fixed Matcap/Phong globe rendering; `7579f06` fixed the Theme Editor's fonts never actually applying.

# Changelog — July 7–17, 2026: Terrain Analysis Suite, Tell Detector & Local COG Sources

#### TL;DR
- Terrain-analysis suite (Curvature, TPI, Roughness, Det-Hessian, Blobness) expanded, with **Relief Visualization split out as its own group** alongside it (Sky View Factor, Openness).
- **Local Relief Model (LRM) introduced** — a new relief mode isolating local bumps from the regional trend.
- Experimental **"Tells" archaeological mound detector**, gated behind a Beta toggle, based on finding local extrema/maxima of the Local Relief Model (LRM).
- **Labeled section grouped into Sources / Options / Detectors / Tools sidebar with dividers** for scanning a long control panel.
- **Keyboard shortcuts**: Shift-tap to peek at the raster basemap, Ctrl-tap to hide every overlay down to just the basemap.
- **Elevation Picker introduced** — click-to-sample elevation with a two-point delta, plus basemap **overlays** (radar, trails, watercolor and more) that layer on top of any basemap instead of replacing it.
- Local COG (BYOD) terrain sources — load a `.tif` straight off disk, no upload.
- Client-side GeoTIFF export without Titiler, and shareable per-project embed configs.
- Camera/animation poses are now URL-shareable.

### Features
- **Expanded curvature & terrain-analysis suite** — Profile/Plan curvature, TPI, Roughness, Det-Hessian, Blobness structure-tensor, auto-scaled ranges per mode.
- **Local COG (BYOD) terrain sources** — pick a `.tif` off disk, no upload, with CRS/tiling validation.
- **Basic / Advanced mode toggle** — Terrain Analysis and Relief Visualization sections collapse to just checkbox + opacity slider, hiding sub-mode options until wanted.
- **Local Relief Model (LRM)** — multi-scale relief mode isolating local bumps from the regional trend.
- **Sky View Factor & Openness** — new horizon-angle-based visibility modes.
- **Archaeological mound detection ("Tells")** — experimental detector flags candidate mounds from curvature/blobness; own section, color-by ramps, export, explainer, beta toggle.
- **Keyboard shortcuts** — Shift-tap to peek at the raster basemap; Ctrl-tap to hide every overlay down to just the basemap, tap again to restore.
- **More data sources** — PlanTopo slope overlay, TileJSON, CET/SDR ramps, NextGIS QMS search, WMS-raw, Photon geocoder.
- **Labeled sidebar dividers** — Sources / Options / Detectors / Tools section breaks for scanning a long control panel.
- **Same source on both A/B** — split-screen source pickers only ever showed one side as selected, even when both used the same source; fixed to show both independently.
- **Elevation Picker** — now shows distance between points and decimal lat/lng.
- **Camera/animation pose rework** — URL-shareable camera state; Home now correctly resets saved poses.
- **Higher-precision terrain-derived tiles** — curvature, aspect, TRI, roughness, openness, blobness, and LRM now wire-encode ~25x finer, cutting visible banding.
- **Client-side DTM export & project embed system** — export GeoTIFF from the browser; per-project embed/URL config.

### Bug Fixes
- **TerraDraw**: init race, GeoJSON import double-counting, Fast-Refresh break.
- **Minimap**: cold-start delay and resize bug.
- **TypeScript errors cleared to zero**.
- **Sidebar scroll/header glitches** — corner-rounding squaring off, button group shifting, fast-scroll jitter.
- **Overlays ignoring their own max zoom** — hardcoded limit overrode a source's real tile pyramid (e.g. NASA GIBS), causing tile-request errors.
- **2D Elevation Picker freeze** on large COG files.

# Changelog — March 2026: Colorramp Refinements & Terrain-Source Fixes

#### TL;DR
- Discrete vs. continuous colorramps distinguished, with an inversion option.
- Terrarium/TerrainRGB terrain-source fixes.
- A "corking" procedure added for non-geo terrain-visualization COGs.

### Features
- **Discrete vs. continuous colorramps** (`51812d1`) — some ramps (e.g. classification-style) are meant to show hard bands, not a smooth gradient; now distinguished explicitly.
- **Colorramp inversion** (`687d03e`).
- **Corking procedure for non-geo terrain-viz COGs** (`5184b4b`) — supports the non-geo relief-visualization workflow (murals/frescoes) alongside real georeferenced terrain.

### Bug Fixes
- **Terrarium/TerrainRGB sources** (`6d8d24e`) — fixed after `fbae55f`'s WIP min/max-zoom and `MapSources` factoring work exposed the issue.
- **Custom-source batch edit** (`17b7c6d`) — fixed for terrain sources (see the original batch-edit tool from Nov 2025 below).

# Changelog — February 2026: Drawing Tools, BYOD Basemaps, Contours & Animation Tools

#### TL;DR
- Drawing Tools introduced via TerraDraw — draw shapes, points, rects, import/export features, and more.
- BYOD basemaps finalized as their own custom-source type, alongside the existing BYOD terrain sources.
- Contours reworked into their own "Contours & GeoGrid" section.
- Keyframe-based, video-export overhaul (MediaBunny-based MP4 export rather than browser MediaCodec).
- Minimap with footprint/frustum.
- Finer Terrarium quantization (4mm vs. TerrainRGB 10cm) shipped as a High-Precision toggle.
- Fold/expand-all for every sidebar section, with collapsed state now persisted.
- WMS raw-elevation sources (e.g. IGN France) now stream as MapLibre raster-dem — standalone demo: [maplibre-raster-dem-wms-float32-generic.html](/maplibre-raster-dem-wms-float32-generic.html).

### Features
- **TerraDrawSystem** (`42e5760`) — introduced the drawing-tools system, alongside a rework of the main terrain-viewer component.
- **Minimap with footprint and frustum** (`96d8b04`, preceded by WIP passes `349785e`/`1c0e656`).
- **Video export overhaul** (`93cbc77`) — a large rework the commit itself flags as needing cleanup; **MediaBunny**-based MP4 export followed (`69c3efe`) and animation capabilities were added (`40b32c7`).
- **BYOD Basemaps finalized** (`3582cbd` prepare, `671bd0b` finalize) — custom basemap sources alongside the existing BYOD terrain-source support from Nov 2025.
- **Contours reworked** (`8574074`, `f136a94`) — restructured into their own "Contours & GeoGrid" section (color pickers/line-weight controls followed later, July 2026 — see above).
- **High-Precision Elevation Quantization** (`ecd76ba`) — finer Terrarium encoding (3.9mm steps) as an alternative to TerrainRGB (10cm steps) via the Geomatico COG-protocol middleware, with a same-day fix for reset/layer state on high-res-quantized COGs (`b614aae`).
- **Fold/expand-all for sidebar sections** (`4d96202`) — every section's collapsed/expanded state now persists via `atomWithStorage`, alongside a broader foldable-sections rework.
- **XYPad for 2D illumination-direction selection** (`07fc46e`) — precursor to the later light-direction pad work.
- **IGN France WMS raster-DEM example** (`4606dd1`), **Graticule layer** (`0b5c12d`), **Share section** (`db380d1`), **DTM-DSM LidarHD selector** (`10e9609`), auto-set elevation from loaded terrain tiles (`c0747c7`).
- **WMS-raw elevation as raster-dem** (`d0fde9c`) — a new terrain-source type reading raw Float32 WMS elevation directly as MapLibre raster-dem, generalizing the IGN France example above into a reusable pattern. Standalone demo: [maplibre-raster-dem-wms-float32-generic.html](/maplibre-raster-dem-wms-float32-generic.html).

# Changelog — November 2025: Initial Launch, BYOD Terrain & COG Streaming

#### TL;DR
- Initial launch — expose terrain visualization modes Hillshade, hypsometric color-relief, raster basemaps (Google, Bing, ESRI, Mapbox, Here, OSM), split-screen comparison, and UI transparency, all from one sidebar control panel.
- Bring Your Own Data (BYOD) terrain sources let user import their own TMS, COG remote endpoint terrain sources.
- Offer the choice to stream COG via Geomatico native maplibre COG-protocol vs. Titiler.
- Adding large open-license colorramp library, cpt-city.
- Batch-editing custom terrain/basemap sources as JSON.

### Features
- **Initial launch** (`29ced9e`, `1e12655`, `535bb2a`, `c4d067f`) — the app's first version already had Hillshade, hypsometric tint (color-relief), a raster basemap, split-screen A/B comparison, and a UI-transparency option, all driven from the sidebar control panel (`components/terrain-controls.tsx`, `components/terrain-viewer.tsx`, `components/ui/sidebar.tsx`) — contours were present too, stabilized two days later (`069570e`).
- **BYOD (Bring Your Own Data) terrain sources** (`f24c1bc`) — the original bring-your-own-terrain-source feature, with COG and VRT support added the same week (`c479102`, `9786d0e`).
- **Geomatico COG Protocol introduced alongside Titiler** (`b6beb09`, toggle `9618fbc`) — direct client-side COG consumption as an alternative to the Titiler middleware; the toggle between them (`useCogProtocolVsTitiler`) is still in Settings → Streaming today.
- **cpt-city colorramp pipeline** — a large open-license colorramp library parsed via a new `cpt2js`-based pipeline (`ba2b492`), a standalone cpt-city archive-parser mini-app to harvest it (`57bf00a`), topobath ramps (`0ccb447`), and a further significant expansion (`b5254fc`).
- **Custom sources batch edit** (`f959bae`) — bulk-edit custom terrain/basemap source definitions as JSON (distinct from the later, API-key-specific batch editor added July 30, 2026 — see above).
- **Background layer, sky, and fog controls** (`2625628`, configurable `e7c6857`).
