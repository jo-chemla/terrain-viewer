---
name: google-3d-coverage-dead-end
description: Google 3D coverage - why the 3D Tiles tree cannot answer it, and the Google Earth bpb layer that can
metadata:
  type: project
---

**Solved, but not the way it looks like it should be.** The overlay is built by
`docs/scripts/build-google-3d-coverage.mjs`; this note is why the obvious route
fails, so nobody tries it a third time.

## The 3D Tiles tree cannot answer it

Bing's tileset is implicit-tiled, so a subtree's `contentAvailability` bitstream
literally lists which tiles have mesh — that is what
`build-bing-3d-coverage.mjs` reads. Google's is explicit 3D Tiles 1.0: a node
exists or it does not, with no availability structure. The natural substitute,
"how deep does the tree refine", is wrong (measured with
`docs/scripts/probe-google-3d-detail.mjs`):

| place | deepest node | geometric error |
|---|---|---|
| Paris (Eiffel) | depth 20 | 2 m |
| **rural Nepal** | **depth 20** | **2 m** |
| Sahara | depth 16 | 32 m |

Depth tracks imagery resolution, not photogrammetry. Everything is one dataset
id (`/v1/3dtiles/datasets/CgIYAQ/files/...`), and a global crawl costs millions
of requests (21 848 sub-tileset JSONs just to reach depth 8; the API is *not*
rate-limited to 1/s as an earlier note claimed — 190 req/s measured).

Jonathan separately confirmed glb *size* works as a signal (level-18 leaves:
Paris 193 KB, NYC 217 KB against 12–18 KB for draped terrain) but the server
ignores `Range` on glbs, so probing means downloading them: a global level-12
scan would be tens of GB.

## What does work: Google Earth's own coverage layer

`www.google.com/maps/vt/proto/bpb=<protobuf>`, the layer Earth draws for "3D
buildings where available". Decoding one captured request gave the message
shape (tile coords in field 1, two layer entries in field 2 — `"m"` and
`"ml:xsr:c:<149-char token>"`). Three things make it usable:

- **`&token=` is not validated.** It looks like the anti-abuse checksum; the
  endpoint answers identically with a wrong token, no token, or `token=0`.
- Only field 1 changes per tile; everything else replays byte for byte.
- **The response SIZE is the answer** — no need to decode the payload, which is
  7.97 bits/byte entropy and defeats every standard decompressor. An empty tile
  collapses to a fixed stub (132 bytes at z10); a covered one is thousands.
  Counter-intuitively the stub is *smaller* than a base-map-only response for
  the same tile, so the coverage layer suppresses the base map rather than
  adding to it, which is what makes the size test clean.

Hierarchical crawl z4→z10: **19 060 requests, 42 s, 6 548 covered cells, 472
polygons**. Verified 19/19 against known places, including the five Normandy
cities Jonathan saw on Google's official layer, and negatives at Moscow,
Nairobi, Timbuktu and Uluru.

**Limits.** z10 is the floor: at z12 central Paris is 261 bytes against 187 for
farmland 60 km away. At ~39 km cells adjacent cities merge, so western Europe
is one polygon. The `ml:xsr:c:` token is from a captured request and may rotate;
re-capture from earth.google.com's network tab if the script stops working.

## The official dataset layer, and why it is not used here

Google's coverage page embeds `maps-docs-team.web.app/samples/3d-coverage-map/`,
which is a Maps JS `getDatasetFeatureLayer('bcf6598c-…')` on map id
`ccfdf8d031b6b83cc90ddc70`, updated daily. It renders with any key and gives a
point-in-coverage oracle, but the geometry arrives over gRPC-web
`MapsJsInternalService/GetViewportInfo` as Google's internal proto — so
extracting polygons needs the Maps JS library plus screen-scraping, which a
build script cannot do. Useful as ground truth, not as a source.

Related: [[national-terrain-sources]]; `lib/coverage-overlays.ts` wires all
three 3D overlays.

## Routes found but NOT taken

Jonathan ruled out rasterising, twice. Recording both so they are not
rediscovered as if new:

- **The plain raster endpoint renders the coverage layer.** Append a second
  layer spec to an ordinary `/maps/vt?pb=` request -
  `!2m3!1e2!2s<the ml:xsr:c: id>!3i<epoch>` - and the PNG comes back with the
  overlay drawn on it. Fetch each tile twice, with and without, and the
  coverage is the difference: pixel-exact at any zoom, 2 requests per tile, no
  Maps JS and no headless browser. Verified at z6/z8/z10 with the Sahara
  returning zero overlay pixels. Two traps if it is ever wanted: a raw pixel
  diff also lights up every label and road, because Maps re-renders them once
  another layer is present, so classify by the DIRECTION of the delta instead
  (the overlay is a fixed warm blend, about (dR,dG,dB) = (-3,-32,-67)); and
  city labels are drawn over the fill, punching holes that need closing.
- **Screenshotting the Maps JS dataset layer** (Google docs-team map id
  `ccfdf8d031b6b83cc90ddc70`, dataset `bcf6598c-7603-4698-9493-9e927d8d3d38`)
  - 64 screenshots at z6 for 2.4 km, 256 at z7 for 1.2 km. Maps JS cannot be
  tree-shaken or module-scoped, so it is a build-time tool only.

The shipped script stays on the byte-size probe at z10, whose ceiling is
documented in its own header.

## Update 2026-09-23 (later): decoded, and complete - blocked only on file size

Jonathan's parallel agent cracked the tile format: the body is **XOR 0x9b**
(why every standard decompressor failed), then a protobuf whose geometry is
pre-triangulated. Two decoders are committed - `docs/scripts/
build-google-3d-coverage.py` (shapely, installed here) and
`docs/scripts/google3d-coverage.ts` (zero deps, tsx). Both run fully from
Node: `mapConfigs:batchGet` mints the layer id from the API key. Two traps the
TS one fixes that my own decoder had: zero-area collinear triangles are part
of the mesh and must be counted, and clamping vertices to the tile box makes
invalid rings.

**The layer is generalised per zoom; no single zoom is complete.** Union of
z8+z9+z10 scores 34/39 on the ground-truth set, and the 5 "misses" all have
coverage geometry 0.3-3.3 km from the test coordinate (Paris's nearest vertex
is 0.5 km and it hits) - so they are in the dataset and the union is
effectively complete. z10 is 19 768 requests / 95 MB / ~1 min.

**Blocker: size.** The 3-way union is 225 MB undissolved. Needs `polygon-
clipping` (not a repo dep - one `npm i -D`, ask first) for `--dissolve`, then
simplify, or PMTiles via the app's existing pmtiles protocol. The shipped
overlay stays on the coarse payload-size probe until then. Do NOT re-derive
the per-zoom finding; the table is in the .ts header.

**Shipped 2026-09-23.** `docs/scripts/dissolve-google-3d-coverage.mjs` unions
the z8+z9+z10 decodes per 5-degree bucket with `@turf/turf` (no new dep),
then generalises. Re-running: `GOOGLE_KEY=... pnpm google-3d-fetch` (all three
zooms, fetch + decode into `.cache/`), then `pnpm google-3d-dissolve`.

**The union was throwing, and the fallback hid it.** `turf.union`
(polygon-clipping) raises "Unable to complete output ring" on raw decoded
coordinates - full-precision doubles over a mesh full of near-coincident
vertices. The fallback caught it, split the group in half, unioned each half
and **returned both without unioning them with each other**, so the output
kept every overlap the union existed to remove. Over Paris: 2 110 km2 of
polygons for 1 346 km2 of coverage, 69 polygons with 89 intersecting pairs -
the three zooms' outlines stacked, drawn as a red crosshatch. `failed` was 0
and nothing looked wrong.

Two fixes, both necessary:

- **Snap before unioning.** `truncate` to 5 decimals (~1 m) plus `cleanCoords`
  on every input ring. Measured on the Paris window: full precision throws,
  5 decimals unions 484 polygons in 1.0 s. Also drop inputs under 1000 m2 -
  single mesh triangles that cannot survive a 500 m generalisation and are
  each another chance for the clipper to fail.
- **Never return unmerged partial unions.** Chunk, then tree-merge the chunk
  results pairwise until nothing merges, rotating the pairing each pass.
  Anything still unmerged is counted and printed loudly, because silence is
  exactly what shipped the first two versions.

**The third fix, and the real one (2026-09-24).** After both of the above the
world still reported 66 partials "left unmerged", and a retry ladder aimed at
the clipper rescued one. The Paris-bucket experiment then showed "2 parts, 0
pair failures" - a pair that never failed was simply never attempted. The
tree-merge rotates its pairing on odd passes (offset 1), so with two parts
left an odd pass pairs nothing, sees no progress, and the loop broke. Fix:
only a full EVEN pass that merges nothing ends the loop. Plus pre-snapping to
the OUTPUT precision (3 decimals, 110 m) instead of 5: below anything the
500 m simplification keeps, and it is what lets a whole bucket union cleanly
(Paris bucket at 5 decimals: 1 779 km2 out for 1 346 in; at 3: 1 339, one
part, zero failures). Shipped: Paris 10 polygons, 0 overlapping pairs,
1 333 km2; world 7 268 polygons, 0.977 Mkm2, 2.53 MB, 18/18 cities inside.

**THE ROOT CAUSE, found 2026-09-24 after three wrong explanations: the
decoder's delta rule.** `zz` used protobuf zigzag (`v/2`, `-(v+1)/2`). This
format is NOT zigzag; the rule is `v` / `-(v+1)`. Every polygon was deflated
2x about its first vertex. Consequences, all of which were misread as data
properties: each zoom covered ~25% of central Paris ((1/2)^2); different
zooms' pieces landed in different places so unions grew with every zoom and
never converged (wrongly called "generalised per zoom", then "per-tile
budget", then "sharded across zooms"); London and San Francisco tested
outside. Jonathan spotted the 2x deflation from the polygon shapes in
kepler.gl. Settled by cross-zoom agreement on tile 10/518/352 vs its four
z11 children, seven decode variants scored by Jaccard:

| variant | z10 | z11 | Jaccard |
|---|---|---|---|
| zigzag (old) | 23.2% | 23.7% | 0.32 |
| **deltas x2** | **96.2%** | **96.3%** | **1.00** |
| coords x1/2, y-flip, x/y swap, zigzag-first, no-zigzag | 6-24% | 6-25% | 0.04-0.31 |

Decoded correctly, every zoom z5..z12 gives ~2.05 Mkm2 worldwide and
91-96% of that tile: an ordinary generalised layer. **One zoom is enough.**
Shipped z8 (Jonathan's pick - its blocks read like Google Earth's own
coverage view): crawl to z8 (4 120 requests, 32 MB, ~10 s), decode 5 s,
dissolve 49 s -> 1 601 polygons, 0.99 MB. Central Paris 97.1%, Paris window
ONE polygon of 2 894 km2 (was 18 polygons / 2 258 km2 / holes), 20/20 cities.
z9/z10 are identical to 0.2%. A second agent reached the same bug
independently (`prev + 2*zz(v)`, IoU 1.00 across z8/z9/z10) - and found that
Google Earth's own `ml:xsr:c:` layer id works on the same maps/vt endpoint
with no key (`fetch --layer-id`), giving blockier per-region blobs. The Python port had the same bug and is fixed.

Lesson worth keeping: when a per-zoom measurement lands on a suspiciously
round fraction (25%), test the decoder against itself across zoom levels
before theorising about the data. Cross-zoom Jaccard is a one-line oracle.

**Diagnostic that settles it in one line:** compare the output's total area
over a window against the raw decodes'. A correct union is at most the largest
single zoom plus a little; three times it means no union happened.

**Generalising leaves its own rubbish**, separately from the union bug above. Measured on
the largest Paris polygon (656 km2) of that file:

- **30 holes, 26 of them under 1 km2**, most under 0.2 km2 - pinpricks where
  two tile-clipped triangles met imperfectly, not gaps in coverage. They are
  smaller than the error of the outline that contains them, and they render
  as a city peppered with specks. That is what "looks weeeeeeird" was.
- **7 self-intersections** created by `simplify` + `truncate`, absent from the
  union. Douglas-Peucker on a ring with thousands of vertices crosses it over
  itself; snapping to 3 decimals crosses a few more. maplibre then draws the
  bowties.

Fix, per merged polygon: drop holes < 1 km2, simplify, truncate, **re-node**,
drop small holes again, drop outer rings < 1 km2. Re-noding is `union(p, p)` -
polygon-clipping nodes every intersection before reassembling, so a polygon
unioned with a copy of itself comes back with no crossings. Verified on that
polygon: 7 kinks -> 0, 39 rings -> 31, area 655.9 -> 655.8 km2. Do NOT
reorder these steps.

Whole-world result of the fix: 73 317 -> 11 084 polygons, 3.17 MB (was 4.02),
**11 208 artefact holes dropped**, self-intersections 10 231 -> 4 103 (the
remainder are mostly holes that legitimately touch their outer ring, which
`turf.kinks` counts). Paris went from one 656 km2 polygon with 30 holes to
clean outlines with none. Total covered area barely moved: 1.074 -> 1.062
Mkm2, so nothing was thrown away.

**RETRACTED (2026-09-24): "London is outside Google's layer".** It was the
delta-rule bug deflating the polygon that contains it. Fixed; 20/20.

