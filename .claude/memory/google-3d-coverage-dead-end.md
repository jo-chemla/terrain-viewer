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
