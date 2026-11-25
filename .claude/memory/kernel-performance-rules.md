---
name: kernel-performance-rules
description: Rules for per-pixel loops (lib/*-protocol.ts, lib/*kernel*.ts, tile-server/direct.mjs, qgis-plugin live/kernels.py) — no allocation per pixel, taps made once per tile, atan after the max, numpy bands at 512 px, bit-identical checks with bench-direct.mjs
metadata:
  type: project
---

Per-pixel kernels run 65 000 (256 px) to 262 000 (512 px) times a tile, on the
main thread in the app and in the tile service's workers. Two audits
(b7c3996 for the hillshade, 2026-11-25 for the rest) found the same mistakes
costing 2x to 4x. The rules:

1. **Nothing allocated per pixel.** No `{dx, dy}` returned from a helper, no
   window object literal, no `[r, g, b]` from an encoder, no destructuring of
   a fresh array (`const [u, v] = c ? [..] : [..]`), no `.map` / `.forEach`
   over lights or channels, no closure made inside the loop. V8's escape
   analysis does not reliably remove them: inlining `hornGradient` and the
   window literal made the normals loop 2x faster (21 → 9 ms a 512 px tile).
   If a helper must hand back several numbers, refill one module-level record
   (`curvature-protocol.ts`'s `D` and `K`) or write into a scratch typed array.
2. **Whatever depends only on the column or the row is made once a tile.**
   Bilinear reads: per output column the two clamped indices and the weight,
   per row the same (`taps()` / `resampleTaps()` in direct.mjs); latitude,
   ground resolution and cos(lat) per row. A closure sampler `G(i, j)` with a
   floor and two clamps per read was most of a resample's time.
3. **Neighbouring reads share work.** The nine bilinear reads of a Horn window
   share their weights (fx ± 1 has fx's fraction): lerp across the 4x4 source
   block once per row (12 lerps, not 18), then down (direct.mjs
   `liveLighting`). Blobness computes each gradient once into a grid.
4. **Constants out of the loop**, e.g. the hillshade's `pow(base, π/2) − 1`.
5. **Keep the arithmetic, in its order, so outputs stay bit-identical.**
   `Math.hypot` is not `Math.sqrt(x² + y²)` (they differ in ~35 % of random
   cases): keep hypot where the reference (MapLibre's shader port) has it.
   `writeTerrariumPx` is byte-identical to `elevationToTerrarium` and is the
   encoder to use in loops.
6. **Measure, then compare bytes.** `tile-server/bench-direct.mjs` draws every
   mode on 16 Mont Blanc tiles; `TV_PROTOCOL_CACHE_MB=0` makes each tile run
   its kernel (otherwise most tiles are cache hits). Write `out-a/` before and
   `out-b/` after, then `--compare`: every file must be identical. For an A/B
   on a loaded machine run old and new alternately: `BENCH_DIRECT=./direct-old.mjs`
   times another copy of direct.mjs (point its `./generated/` imports at a
   copy built from the old lib). Medians move ±30 % between runs here.

Already clean (checked 2026-11-25): slope, aspect, tri, tpi, roughness,
blobness, lrm, horizon kernel (svf/openness), local dominance, shadow kernel,
phong/matcap CPU shading. Their remaining cost is the maths itself (atan per
ray, pow), not allocation. The live GL layers' CPU side has no per-pixel loop.

Vectors and per-vertex work (second audit, 2026-11-25):

7. **Bytes into a typed array, not a JS array.** `tile-server/mvt.mjs`'s
   writer pushed every byte onto a number[] and copied each sub-message
   into its parent byte by byte (four levels for a vertex): a growing
   Uint8Array with `set()` made contours 3.1 -> 1.1-1.4 ms and an interval
   iso-line 2.4-3.1 -> 0.9 ms a tile, same bytes.
8. **Large float buffers straight into a Float32Array** that doubles when
   full, not a number[] converted at the end: the building shadow sweep
   (BuildingShadowLayer.tsx `buildGeometry`, 16 central-Paris tiles, 15 M
   floats) 1250 -> 600 ms, same bytes (each double rounds to float32 the
   same either way).
9. **Where a library does the work, leave it.** The iso-line / plane slicer
   tile (`lib/isoband-protocol.ts`) is d3-contour's isorings and stitch;
   dropping the [x, y] per vertex and feeding a Float64Array made no
   measurable difference, so it was not kept. maplibre-contour and earcut
   likewise.

Third pass (2026-11-25, every mode in the app, the tile service and the
QGIS backend):

10. **Monotone functions commute with max: compare before the
    transcendental.** The horizon kernel took atan per direction and per
    far ring, then kept the largest angle; atan is non-decreasing, so the
    atan of the largest tangent is the largest atan, bit for bit. One atan
    a direction (openness with far rings ~1.35x), and none for the sky view
    factor, whose sin(atan(t)) is t / sqrt(1 + t²) (an ulp of a 0-100
    value; the same Terrarium bytes on every bench tile). An atan or sin is
    20-40 ns here: in svf, local dominance and openness it is most of the
    time once the loops are clean.
11. **Bilinear reads at a fixed offset are separable**: a sample's column
    depends on the output column only, its row on the output row only, so
    floors, clamps and weights go in per-column arrays (once a call) and
    per-row scalars (once a row) - the far rings of the horizon kernel,
    the ancestor levels of local dominance (same arithmetic, same bytes).
12. **Duplicate ray steps** (round(r cos 45) repeats for r = 1, 2) add
    nothing to a max: build the ray once, without them (QGIS's `seen`).
13. **Bounding boxes before geometry.** The tile service's building shadow
    SVG held every building of the z14 tiles fetched for the longest shadow
    (10-12 MB a tile in Midtown, ~2 min in sharp); a footprint-plus-sweep
    box test leaves ~3 % of them: 115 s -> 1.4 s, the same picture up to the
    rasteriser's antialiasing (0.2 % of pixels, 8/255 at most). Also the
    roofs bug: one even-odd path over overlapping parts cancels where they
    overlap; MVT winding is consistent, so fill nonzero.
14. **numpy at 512 px: stay in cache, reuse scratch, mind memory order.**
    A 512 px tile cost 8-12x a 256 px one in live/kernels.py: whole-tile
    float32/float64 arrays (1-2 MB each, several live) fall out of L2 and
    every fresh temporary is a page-faulted allocation. Process bands of
    ~32 k values (`_band_rows`), refill preallocated scratch with `out=`,
    and keep the expression's order (a + b -> b + a only where exact) for
    the same bits. `np.take(..., out=)` buffers unless `mode="clip"`, and
    gathering rows of `a[:, cols]` (not C-ordered) was 30x slower than of
    `np.take(a, cols, axis=1)`. svf r8 512 px 63 -> 31 ms, local dominance
    ~300 -> ~110 ms, structure tensor modes ~1.7x, all np.array_equal.
15. **What is left is the maths**: per-pixel framework costs in direct.mjs
    (padding, Terrarium packing, resample, ramp, PNG) are ~10 ms a 256 px
    tile; with TV_PROTOCOL_CACHE_MB=0 a 256 px output tile recomputes its
    whole 512 px source tile (4x the work the cache saves in service).
