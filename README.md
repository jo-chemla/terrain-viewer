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
- **Must be a genuinely tiled COG, not just a `.tif`.** Range-based streaming only works efficiently against a file that's internally 2D-tiled (e.g. produced with `gdal_translate -of COG src.tif out_cog.tif`, or `TILED=YES` + `gdaladdo` overviews) — a plain strip-organized GeoTIFF (GDAL's default when no COG/tiling option is passed) forces the reader to decode large chunks of the file repeatedly on every pan/zoom, which can manifest as anything from sluggishness to a hard crash (`RangeError: Array buffer allocation failed`). The "Add New Terrain Dataset" dialog checks this on pick and warns if the file isn't tiled or has no overviews, but can't fix the file for you — re-export it as a real COG first.
- **Must already be in Web Mercator (EPSG:3857).** `@geomatico/maplibre-cog-protocol`'s zoom/bounds math (`lib/read/math.js`) hardcodes every COG as EPSG:3857 with no reprojection step — it feeds the raw pixel resolution straight into a mercator-meters zoom formula and inverse-mercator-projects the raw bounding box as if it were already in mercator meters. A geographic (EPSG:4326, degree-based) source gets its degree-sized pixels misread as meter-sized ones, producing a wildly inflated "native zoom" (this is what fed z27+ into the terrain-elevation crash fixed above); a different projected CRS (e.g. a UTM zone) has correct units but the wrong origin, so the detected bounds land nowhere near the real data. **Almost no publicly published DSM/DTM data is natively in EPSG:3857** (national/agency DEMs are typically geographic or UTM) — reproject first with `gdalwarp -t_srs EPSG:3857 -of COG src.tif out_3857.tif`, or use the remote **COG** type in titiler mode instead, which reprojects server-side via rio-tiler and isn't affected by this. The BYOD dialog checks the picked file's CRS and warns if it isn't 3857.

### Localhost static file server (works today, zero app changes)

Browsers treat `http://localhost` as a "potentially trustworthy" origin, exempt from mixed-content blocking — so this HTTPS app can `fetch()` a plain `http://localhost:PORT/your.tif` COG even without a certificate. Serve the directory containing your COG with any static file server that supports Range requests, e.g.:

```bash
npx serve --cors -p 8080 .
```

Then add it as a normal **COG** BYOD source with URL `http://localhost:8080/your-file.tif`. Unlike the built-in local-file picker, this survives reloads (the URL is a real, stable address) and works in any browser, at the cost of needing a terminal command running alongside the app.

Watching [vinayakkulkarni/tileserver-rs#1008](https://github.com/vinayakkulkarni/tileserver-rs/issues/1008) (proposed native Terrarium/Mapbox-RGB DEM tile encoding straight from a COG/GeoTIFF source) — if it lands, it'd be a much lighter self-hosted alternative to titiler for this exact "serve a local COG as real terrain-rgb tiles" case, without needing titiler's fuller COG/mosaic/STAC feature set.

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
- **Sky View Factor (SVF)**: fraction of the sky hemisphere visible from each point, from a ray-marched horizon angle in 8 directions — low in enclosed pits/canyons, high on open summits/ridges
- **Openness**: mean angular distance from zenith to the horizon across the same 8 directions — reads above flat (90°) on ridges/summits (Positive mode) or in valleys/pits (Negative mode)

#### How LRM is computed

- **Fine layer**: the center tile's own per-pixel elevation at native zoom, decoded directly (no 3×3 neighbor fetch needed — unlike Slope/Curvature, LRM doesn't need a gradient).
- **Coarse layer**: pick `k` (levels up the pyramid, exposed as the "Smoothing Radius" control via `k = round(log2(radiusPx))`), fetch the ancestor tile at `z-k` plus its 8 same-zoom neighbors, decode, and stitch into a padded elevation grid — the same 3×3-stitch logic the other neighborhood-based modes use, just parameterized to run at `z-k` instead of `z`.
- **Bilinear upsample**: for each output pixel, map its full-res tile-pixel coordinate into the ancestor tile's fractional pixel coordinate (scale = `2^k`) and bilinearly sample the padded coarse grid — this is what avoids the "boxy" hard edges a naive nearest-neighbor pyramid lookup would give.
- **Combine**: `LRM = fine[pixel] - bilinear(coarseGrid, mappedCoord)`, re-encoded via the standard terrain-rgb elevation encoding.

#### Sky View Factor and Openness

Visibility-analysis modes, both built on the same "horizon angle" ray march (see `lib/horizon-angle.ts`): march outward from each pixel in 8 compass directions up to a configurable "Search Radius" (same-zoom pixels), and in each direction find the steepest elevation angle to any point along the ray — the horizon angle in that direction.

- **Sky View Factor (SVF)**: fraction of the sky hemisphere visible from a point (0 = fully enclosed, e.g. the bottom of a narrow pit; 1 = fully open, e.g. a summit) — the standard proxy for ambient/diffuse illumination in relief visualization (RVT's "Sky-View Factor" mode), from [Zakšek, Oštir & Kokalj, 2011](https://www.mdpi.com/2072-4292/3/2/398). Uses the common simplified estimator `SVF ≈ 1 - mean(sin(max(0, horizonAngle)))` across the 8 directions, scaled ×100.
- **Openness** (Yokoyama, Merry & Pike, 2002): mean angular distance from zenith to the horizon across the 8 directions, using the *unclamped* (signed) horizon angle — unlike SVF, this isn't capped at "fully open": a summit with nothing higher anywhere nearby reads *above* 90°, a flat plain reads exactly 90°, and a valley/pit reads below 90°. **Positive** mode uses the terrain as-is (highlights ridges/summits); **Negative** mode computes the identical formula on the terrain flipped upside down (elevation × -1), which highlights enclosed valleys/pits the same way Positive highlights ridges. Displayed re-centered on 0 (subtracting the 90° flat-ground reference) to match the diverging-ramp convention TPI/LRM already use.

Deliberately the *simplest* viable version of both — not the literature's full accuracy: fixed 8 directions (not RVT's usual 16-32), integer-pixel ray steps (no bilinear sampling along the ray), and SVF's simplified mean-of-sines estimator rather than a per-sector solid-angle-weighted integral. A later pass can raise direction count, switch to bilinear ray sampling, or adopt a more precise SVF integral without changing the overall approach.

### Tells (Mound Candidate) Detection — Beta

Computes a Difference-of-Gaussians of the LRM (DoG-of-LRM) as the primary bump signal, keeps only its local maxima (non-maximum suppression scaled to the configured tell size), then vetoes candidates that fail any of three shape filters: Blobness (structure-tensor peak/pit detector), Plan Curvature / Divergence (rejects saddles and ridges where flow diverges outward across contours), and Det-Hessian (rejects saddle points, keeps bowl/dome shapes). Opt in via Settings, or directly with the `?tellsBeta=true` URL param.

#### Known limitation: resampling quality on COG-streamed sources

The detector's low-pass component is built from "ancestor" tiles fetched several pyramid levels coarser than the current view (up to 6 levels for the largest smoothing radius). For pre-tiled terrarium/mapbox-encoded sources, each zoom level is pre-baked by the tile server with real downsampling, so an ancestor tile is a genuine smoothed version of the terrain. For a source streamed live through [@geomatico/maplibre-cog-protocol](https://github.com/geomatico/maplibre-cog-protocol/), every tile read — including these coarse ancestor reads — is hardcoded to `resampleMethod: 'nearest'` deep inside the library's `CogReader` (confirmed in `node_modules/@geomatico/maplibre-cog-protocol/dist/esm/read/CogReader.js`), with no option exposed to override it. That means ancestor tiles for a COG source are nearest-neighbor-decimated rather than area-averaged, which can introduce aliasing into the low-pass signal — most noticeably at the coarser pyramid levels — rather than a true smoothed regional trend. This affects every terrain-derivative mode that fetches ancestor tiles for a COG source (LRM, Tells), not just Tells.

Confirmed via the "GRE - Amphipolis COG clamped" DSM source: the tile-pyramid arithmetic itself (`fetchAncestorScale` in `lib/tells-protocol.ts`) is standard XYZ tiling and is correct regardless of upstream type — the COG protocol answers any `{z}/{x}/{y}` request the same way a real tile server would. The actual limitation is resampling quality, not level/index misalignment.

Options considered, not yet implemented:
1. **Leave as a known/documented limitation** — it's a third-party library constraint, not an app bug.
2. **Patch the vendored library** (would need `patch-package`, not currently set up in this repo) to force `resampleMethod: 'bilinear'` — the underlying `geotiff.js` resampler only supports `'nearest'` or `'bilinear'` (no true box/average filter), so this reduces aliasing but still isn't a real low-pass.
3. **Bypass the library for ancestor-tile fetches** — call the underlying `geotiff` package directly for `cog://` ancestor reads in `lib/normal-derived-protocol.ts`, requesting at native resolution and doing a proper box-average downsample ourselves. More correct, but touches a shared code path used by every terrain-derivative protocol, not just Tells.

#### Known limitation: DEM resolution ceiling for small mounds

Curvature/blobness-based detection is only as good as the underlying DEM's real (not just nominal) resolution. Mapterhorn's global coverage, and most other freely-available global tilesets, are built from Copernicus GLO-30 — TanDEM-X-derived (infilled with SRTM/ASTER/ALOS), ~30 m posting. A 3×3–5×5 derivative kernel there has an effective footprint of 90–150 m. Mound-type sites in Bronze/Iron-Age arid-zone settlement landscapes (e.g. the Balkh/Helmand/Sistan basins) commonly run 50–300 m across and 3–20 m tall — the smaller half of that range is close to or below what a curvature operator can reliably resolve at 30 m, and TanDEM-X's own correlated stripe/mosaic-seam noise has spatial-frequency content that can masquerade as small domes. Realistically this pipeline reliably catches the larger mega-tells and misses or false-positives on smaller ones — a real ceiling to flag before investing further in this detector, and a good reason to prefer a finer-resolution source (LidarHD, a local high-res COG, etc.) wherever one is available for the area of interest.

#### Related literature

- [Zakšek, K., Oštir, K., Kokalj, Ž., 2011. Sky-View Factor as a Relief Visualization Technique. Remote Sensing 3(2): 398-415.](https://www.mdpi.com/2072-4292/3/2/398)
- [Kokalj, Ž., 2025. Standardizing visualization in ancient Maya lidar research: techniques, challenges and recommendations. Archaeological Prospection.](https://dx.doi.org/10.1002/arp.70002)
- [Remote Sensing 2026, 18(13), 2255](https://www.mdpi.com/2072-4292/18/13/2255)
- Dorison, A. & Michelin, Y. *Forgotten Landscapes on Lava Flows in France and Western Mexico*

Mound/tell detection specifically — related approaches and how they compare to this project's curvature/blobness pipeline:

| Study | Region | Data source | Method | Notes |
|---|---|---|---|---|
| [Menze & Ur, PNAS 2012](https://www.pnas.org/doi/10.1073/pnas.1115472109) | NE Syria (Fragile Crescent) | ASTER multispectral time series, 15 m | Random Forest on multi-temporal "anthrosol" spectral signature | ~14,000 sites; spectral, not terrain |
| [Tapete, Traviglia, Delpozzo & Cigna, RS 2021](https://www.mdpi.com/2072-4292/13/16/3106) | Near/Middle East tell landscapes | COSMO-SkyMed SAR-derived DEM + imagery, 3 m | Regional systematic mound mapping + looting-pit detection | Closest DEM-based analog at usable resolution for tells |
| [Trier et al., PNAS 2020](https://www.pnas.org/doi/10.1073/pnas.2005583117) | Cholistan, Pakistan (Indus) | Multisensor/multitemporal SAR + multispectral | ML classifier → mound probability field | Same arid mounded-settlement morphology as Afghanistan; not DEM-curvature |
| [Kokalj & Hesse, 2017 / RVT toolbox](https://github.com/EarthObservation/RVT) | General (methodology) | Any LiDAR/DEM | Hillshade-from-multiple-directions, sky-view factor, local relief, openness, slope | The standard "combine several derivative visualizations" reference; [repo](https://github.com/EarthObservation/RVT_py) |
| [Gallwey et al., RS 2018](https://doi.org/10.3390/rs10020225) | Carnac/Morbihan, France | Airborne LiDAR | Multi-scale Topographic Position (micro/meso/macro) + Random Forest | Methodologically closest to what this project proposes — literally multi-scale TPI extrema + ML, κ=0.98 |
| [PMC7070870, "Geomorphometric Methods for Burial Mound Recognition"](https://ncbi.nlm.nih.gov/pmc/articles/PMC7070870) | Europe (general) | High-res LiDAR DEM | Curvature/geomorphometric feature extraction for mound recognition | Direct precedent for curvature-based (not spectral) mound extraction |
| [Pistola, Orrù, Marchetti, Roccetti & Gordin, PLOS ONE 2025](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0330419) | Abu Ghraib, Mesopotamia (Iraq) | Declassified CORONA imagery | CNN retrained on historical imagery for vanished/destroyed sites | Most recent (2025); imagery not DEM, but same region family |
| [Rajani (Kandahar survey), PLOS ONE 2021](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0259228) | Kandahar, Afghanistan | Public satellite imagery (visual survey) | Manual identification, not automated | Only Afghanistan-specific study found — not curvature/ML-based |

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

