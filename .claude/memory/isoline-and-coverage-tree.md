---
name: isoline-and-coverage-tree
description: How the Iso-line reads any viz mode (terrarium scalars, luma://, scale table), the fill-alpha bug that was variable shadowing, and the coverage tree's fold/pick plumbing
type: project
---

# Iso-line over any measure, coverage tree plumbing (2026-10-05)

**Iso-line = contour engine over a DEM-shaped template.** `lib/isoline-measures.ts`
is the table: every derived protocol already writes its measure as a Terrarium
scalar (slope as Terrain-RGB), so `derivedModeTemplate()` / `lightingTemplate()`
from MapSources give the template and `ContoursLayer` takes a `dem` prop that
bypasses its own source resolution (registry DEM source for custom schemes).
`threshold://` wraps that template for "at a value" (two plateaus, 500/1500,
interval 1000) and the same URL with `&fill=rrggbb&a=` gives the raster fill, so
the fill and the line come from identical pixels. "Every interval" is the
engine on the measure template directly, with `interval × scale`.
`scale` per measure: curvature ×100 (det-hessian ×10000, shape-index ×1), SVF
×100, blobness ×100, the rest ×1. Lighting tiles are RGBA overlays (Phong: black
or white with alpha as strength; shadow: black alpha 255 where shaded), so
`luma://` composites over grey 128 before taking the luminance: 128 neutral.

**Second pass (same day):** "at a value" is no longer the raster threshold
plus the contour engine: `isoband://` (lib/isoband-protocol.ts) runs d3-contour
on the padded measure grid and emits polygons + boundary lines in one vector
tile (mvt-encode gained POLYGON/ClosePath), so the fill is exactly the line.
d3 puts pixel i at i+0.5 and closes rings along the grid edge; those border
runs are dropped from the "isoline" layer. The horizon modes are out of the
measure list (too slow). Phong raster tiles carry the Fresnel rim now
(`?f=&p=&d=` on phong://, uniforms in gpu-phong-compute); with diffuse 0 and a
dark rim the luma range is 0–45, so a Phong threshold must be low.
The contour vector source's maxzoom follows the DEM (15..19; WMS = 19).

**Why:** the user wanted thresholding on every viz mode and sub-mode, not only
elevation and slope, and the fill to match the polylines exactly.

**The fill bug:** inside the slope kernel `const a0 = padded[...], a1 = ...`
shadowed the outer `[r0,g0,b0,a0]` alpha, so the alpha channel got the
elevation (238/240/242/255 = clamped metres). Renamed to `alpha0/alpha1`; the
slope branch is gone now (slope goes through `slope://`).

**How to apply:** a new viz mode becomes an Iso-line measure by adding one row
to `ISOLINE_MEASURES` (its `sourceId` for derivedModeTemplate, unit, range,
scale). Headless checks: `.cache/pw/isoline3.mjs "<query>"` prints the
contour feature count and the `ele` values; `.cache/pw/lumatest.mjs` histograms
a luma/threshold tile over a Phong tile.

**Allmaps "remove paper":** per-map render options `removeColor`,
`removeColorColor` (hex), `removeColorThreshold`, `removeColorHardness` via
`layer.setMapsOptions(() => opts)` (@allmaps/render WebGL2WarpedMap options,
not in the d.ts of @allmaps/maplibre); `allmapsRemoveColorAtom`.

**Coverage tree:** `coverageFoldsAtom` (storage "coverageTreeOpen") holds
open-state by key: `cov:<group>` (picker groups), `cat:<root>/<continent>/<iso3>`
(catalog tree, `catalogTreeKeys()` lists them), `sec:*` (level-1 sections and
the collapsibles, default open), `res:*` (search-result groups). Nothing in the
record = folded. `HistoricalCatalogTree` takes `roots` and `bare`; the
Community indexes root renders bare inside the static "community" coverage
group (ELI + QMS children, `cat-agol` and `eli` catalog rows), the other three
roots under Basemaps · Historical (`HISTORICAL_TREE_ROOTS`).

**Catalog items off the timeline:** the panel publishes `catalogItemsAtom`
(every loaded tick with bounds) and richer footprint properties (label,
detail, url, ref, gsd, b0..b3); `CoverageOverlayLayer` hit-tests
`catalog-footprints-fill` and a Use/click posts `coverageUseRequest`
`catalog:<ref>` → `catalogPickRequestAtom` → the panel applies the tick
(overlay role → overlay stack). `tickByRef` in the panel keeps every tick seen
this session so a view keeps its item after the results change; `step()`
starts from `resolveDisplayTick`, not from `dateForSide` key equality (catalog
keys are bumped for duplicate dates, which broke the arrows).

**Allmaps dates:** `allmapsLikeOf` keeps the IIIF canvas/manifest title, the
manifest URL and a year from the title; `allmapsTicks` reads ≤ 40 manifests per
load (cached). Rumsey v2 manifests have empty metadata, BnF has "Date".
`loadAllmapsCoverage` keeps `maxArea ≥ 2e9 m²` so city plans survive zooming in.
