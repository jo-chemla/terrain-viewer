# Terrain Visualization Modes

A comprehensive terrain visualization and downloading tool, built on top of MapLibre GL via react-map-gl. Explore different terrain visualization modes introduced in 2025 including hillshade, hypsometric tinting, contour lines, and more.

![terrainn-viewer-screenshot](terrain-viewer.jpg)

![bring-your-own-data](byod.jpg)

[demo screencast recording](https://www.dropbox.com/scl/fi/9m0gt1lonbo3sm1bqk3ha/elevation-terrain-viewer.mp4?rlkey=nqbo8w16q44f96sq126orr2k4&st=es40sopg&dl=0)

## Features

- **Multiple Terrain Sources**: Mapterhorn, Mapbox, MapTiler, AWS Elevation Tiles (based on mapzen)
- **Visualization Modes**:
  - Hillshade with multiple algorithms (Standard, Combined, Igor, Basic, Multidirectional and colored, similar to aspect), see [Hillshade Methods PR #5768](https://github.com/maplibre/maplibre-gl-js/pull/5768)
  - Hypsometric Tint (color encoded elevation) with customizable color ramps, see [Hypsometric Tint PR #5913](https://github.com/maplibre/maplibre-gl-js/pull/5913) and additional hypsos in [CPT City Color Ramps](http://seaviewsensing.com/pub/cpt-city/)
  - Contour Lines with configurable intervals via [Contour Lines Discussion](https://github.com/maplibre/maplibre-style-spec/issues/583) which resulted in the [onthegomap/maplibre-contour](https://github.com/onthegomap/maplibre-contour) plugin
  - Raster basemap on which the terrain viz modes are overlaid
- **Bring Your Own Data**: Add terrain sources XYZ terrainrgb/terrarium or COG (wip, via titiler), including a COG file straight off your own disk — see [Local (offline) COG terrain sources](#local-offline-cog-terrain-sources)
- **View Modes**: 2D, 3D, and Globe projections
- **Split Screen**: Compare two terrain sources side-by-side
- **Download**: Export terrain as GeoTIFF via Titiler or screenshot canvas, and copy source URL for QGIS integration/gdal download (terrarium/terrainrgb encoding) + procedures
- **User configuration**: Settings persisted to localStorage via jotai like titiler instance and maximum resolution, theme style switcher, API keys, additional terrain sources, and info

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/iconem/elevation-terrain-visualizer.git
cd elevation-terrain-visualizer

pnpm install
pnpm run dev
pnpm run build # bundles to dist dir
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

## Procedure for non-geo relief visualization (frescoes etc)
See the [guide](./Non-Geo-Relief-Visualization.md) for producing a COG, with required set of parameters, for correct version, with no artifacts.

## Local (offline) COG terrain sources

Two ways to use a COG that lives on your own disk as a BYOD terrain source, without uploading it anywhere:

### Local COG file (built into the app)

The "Add New Terrain Dataset" dialog has a **Local COG file (this browser only)** type: pick a `.tif`/`.tiff` and the app streams it straight off disk via a `blob:` object URL, through the same `@geomatico/maplibre-cog-protocol` `cog://` reader used for remote COGs — HTTP Range semantics work the same way against a `blob:` URL as against a real server (confirmed 206/Content-Range responses in this app's target Chromium build), so no server is involved at all.

Trade-offs:
- The file is never uploaded, but it's also never persisted — only kept in memory for the current browser tab. After a reload (or in a new tab), the source shows up with a **Re-select file…** prompt instead of rendering, and you pick the same file again to resume. This can't be worked around without the (more invasive) File System Access API, which isn't wired up here.
- Works for the primary terrain source, its derivative visualizations (Slope, Aspect, Curvature, TRI/TPI/Roughness/LRM, Tells), the Elevation Picker, and client-side GeoTIFF export.
- Contour Lines still requires titiler (it fetches tiles through `maplibre-contour`'s own DEM-source machinery, independent of the `cog://` protocol) — a local file can't feed it, same as it can't reach titiler over the network.
- Safari/Firefox `blob:` Range-fetch support is less consistently tested than Chromium's — if candidates hit issues there, the localhost option below is the fallback.

### Localhost static file server (works today, zero app changes)

Browsers treat `http://localhost` as a "potentially trustworthy" origin, exempt from mixed-content blocking — so this HTTPS app can `fetch()` a plain `http://localhost:PORT/your.tif` COG even without a certificate. Serve the directory containing your COG with any static file server that supports Range requests, e.g.:

```bash
npx serve --cors -p 8080 .
```

Then add it as a normal **COG** BYOD source with URL `http://localhost:8080/your-file.tif`. Unlike the built-in local-file picker, this survives reloads (the URL is a real, stable address) and works in any browser, at the cost of needing a terminal command running alongside the app.

## Slope and More Modes

Most of these modes are supported by — and inspired by — `gdaldem` and the RVT (Relief Visualization Toolbox) QGIS plugin. Neighborhood usually refers to a 3×3 kernel centered on the pixel.

- **Slope**: magnitude of the gradient
- **Aspect**: direction of the gradient
- **Curvature**: rate of slope change — Profile, Plan/Divergence, Det Hessian or Combined
  - **Profile**: rate of slope change along the steepest-descent direction, affects flow acceleration
  - **Plan (Divergence)**: rate of aspect change across contours, affects flow convergence/divergence — equivalent to the divergence of the normalized gradient field, div(∇z/|∇z|)
  - **Det Hessian**: determinant of the Hessian (fxx·fyy − fxy²) — a blob/saddle detector, positive at bowl/dome-shaped extrema and negative at saddle points
  - **Combined**: discrete Laplacian (∇²z) — general surface bending that doesn't separate flow direction from contour direction
- **TRI (Terrain Ruggedness Index)**: mean elevation difference to neighbors
- **TPI (Topographic Position Index)**: elevation relative to neighborhood mean
- **Roughness**: max−min elevation in a neighborhood
- **Blobness**: structure-tensor measure of how much the gradient direction varies across a small window (det/trace of the smoothed gradient outer-product matrix) — high at peaks, pits, saddles and knolls, near zero on a uniform slope or straight ridge/valley
- **LRM (Local Relief Model)**: raw elevation minus a low-pass-filtered version, isolating small features from large-scale topography — the low-pass mean is bilinearly interpolated from a lower-resolution tile further up the pyramid tree

### Tells (Mound Candidate) Detection — Beta

Computes a Difference-of-Gaussians of the LRM (DoG-of-LRM) as the primary bump signal, keeps only its local maxima (non-maximum suppression scaled to the configured tell size), then vetoes candidates that fail any of three shape filters: Blobness (structure-tensor peak/pit detector), Plan Curvature / Divergence (rejects saddles and ridges where flow diverges outward across contours), and Det-Hessian (rejects saddle points, keeps bowl/dome shapes). Opt in via Settings, or directly with the `?tellsBeta=true` URL param.

#### Known limitation: resampling quality on COG-streamed sources

The detector's low-pass component is built from "ancestor" tiles fetched several pyramid levels coarser than the current view (up to 6 levels for the largest smoothing radius). For pre-tiled terrarium/mapbox-encoded sources, each zoom level is pre-baked by the tile server with real downsampling, so an ancestor tile is a genuine smoothed version of the terrain. For a source streamed live through [@geomatico/maplibre-cog-protocol](https://github.com/geomatico/maplibre-cog-protocol/), every tile read — including these coarse ancestor reads — is hardcoded to `resampleMethod: 'nearest'` deep inside the library's `CogReader` (confirmed in `node_modules/@geomatico/maplibre-cog-protocol/dist/esm/read/CogReader.js`), with no option exposed to override it. That means ancestor tiles for a COG source are nearest-neighbor-decimated rather than area-averaged, which can introduce aliasing into the low-pass signal — most noticeably at the coarser pyramid levels — rather than a true smoothed regional trend. This affects every terrain-derivative mode that fetches ancestor tiles for a COG source (LRM, Tells), not just Tells.

Confirmed via the "GRE - Amphipolis COG clamped" DSM source: the tile-pyramid arithmetic itself (`fetchAncestorScale` in `lib/tells-protocol.ts`) is standard XYZ tiling and is correct regardless of upstream type — the COG protocol answers any `{z}/{x}/{y}` request the same way a real tile server would. The actual limitation is resampling quality, not level/index misalignment.

Options considered, not yet implemented:
1. **Leave as a known/documented limitation** — it's a third-party library constraint, not an app bug.
2. **Patch the vendored library** (would need `patch-package`, not currently set up in this repo) to force `resampleMethod: 'bilinear'` — the underlying `geotiff.js` resampler only supports `'nearest'` or `'bilinear'` (no true box/average filter), so this reduces aliasing but still isn't a real low-pass.
3. **Bypass the library for ancestor-tile fetches** — call the underlying `geotiff` package directly for `cog://` ancestor reads in `lib/normal-derived-protocol.ts`, requesting at native resolution and doing a proper box-average downsample ourselves. More correct, but touches a shared code path used by every terrain-derivative protocol, not just Tells.

## Technologies

- [MapLibre GL v5](https://maplibre.org/maplibre-gl-js/docs/)
- [React Map GL](https://visgl.github.io/react-map-gl/)
- [nuqs](https://nuqs.dev/docs/basic-usage) for url search query state persistence
- [jotai](https://jotai.org/docs/utilities/storage) for atomWithStorage
- [shadcn/ui components](https://ui.shadcn.com/docs/components) + [Tailwind CSS](https://tailwindcss.com/docs/styling-with-utility-classes) v4 for components and UI
- [onthegomap/maplibre-contour](https://github.com/onthegomap/maplibre-contour)
- [geomatico/maplibre-cog-protocol](https://github.com/geomatico/maplibre-cog-protocol/)

## Inspiration

This project was inspired by:
- [Mapterhorn](https://mapterhorn.com/), a free global Terrarium-encoded terrain tileset built from open elevation data — one of this app's builtin terrain sources
- [Tangram Height Mapper](https://tangrams.github.io/heightmapper/)
- [Impasto CAS Viewer](https://impasto.dev/)
- Codetard threejs terrain demos [ui](https://x.com/codetaur/status/1968896182744207599), [modes](https://x.com/codetaur/status/1967783305866252557) and [TSL/webgpu globe](https://x.com/codetaur/status/1986614344957006075) + [threegs repo](https://github.com/ngwnos/threegs)

Know a good terrain tileset (Terrain-RGB or Terrarium encoded) that isn't in the built-in source list? [Suggest it](https://github.com/mapterhorn/mapterhorn/issues/27).

## License

MIT License - feel free to use this project for any purpose.

