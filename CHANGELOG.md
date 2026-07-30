# Changelog — July 30, 2026

### Features
- **Foldable bookmarks tree** — project (root) bookmarks collapse/expand their child views, file-tree style; a collapsed project shows a stand-in thumbnail (its first child's, by current order, or a placeholder), which hides once expanded since the children show their own.
- **Drag-and-drop reordering for bookmarks** — drag a project to reorder among projects, or a child view to reorder among its own project's siblings; a highlighted line under the target row shows where it'll land instead of outlining the row. Dragging a project only targets other projects (never children), dragging a child only targets siblings of the same project, and dropping over an *expanded* project lands the indicator below its last child rather than right under the header.
- **Fold-all / expand-all** and an **Edit mode toggle** (same convention as the Drawing panel's own layer-edit toggle) for the bookmarks list — rename/delete stay hidden until switched on, so the everyday view is just thumbnails, names, and add-child.
- **Bookmarks gallery** now groups view cards under their parent project's name instead of showing the parent as its own card.
- Clicking a project now restores (and highlights) its first child *by current display order* — reordering children changes what a project click shows, instead of always the originally-created child.
- **Project export**: local COG files now bundle into a `local-cogs/` subfolder inside the export zip instead of the zip root; a new "Bookmark thumbnails as a .zip" option (independent of "Include local COG files") externalizes thumbnails into `bookmarks_thumbs/` on request. Sub-options now sit directly under the category they modify (local COGs under Sources, thumbnails-in-zip under Bookmarks) instead of all at the bottom, and View & Viz State moved to the top of the list.
- **Basemap/terrain source modals** — a copy-to-clipboard icon next to the `{z}/{x}/{y}` / bbox template hint.

### Bug Fixes
- **Elevation Picker / Sun-Shadow Calculator** — toggling back to "Select" after drawing something could permanently disable the picker toggle; both now track the shared draw-mode state directly instead of a stale local mirror that only updated on feature edits.
- **Basemap source modal** — pasting a URL containing `{z}/{x}/{y}` while the source type is WMS no longer corrupts the braces into percent-encoded characters (a `new URL()` round-trip was re-encoding the *entire* URL, not just the bbox param it was meant to normalize).
- **Project export** — a plain export (no local COGs) that still had bookmark thumbnails was silently producing real zip bytes labeled and downloaded as `.json`; it now stays a genuine bare JSON document unless a zip is actually requested.

# Changelog — July 7–17, 2026

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
