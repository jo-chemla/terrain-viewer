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
