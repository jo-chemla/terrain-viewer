---
name: allmaps-overlays
description: Allmaps WarpedMapLayer has no pitch support (hidden while tilted), catalog overlay ids are self-describing for shared links, and the overlay draw order follows the Overlays list
type: project
---

# Allmaps overlays (2026-10-06)

- `@allmaps/maplibre` 1.0.0-beta.44 (latest) draws a warped map from a flat
  viewport (the four screen corners unprojected, a centre, a scale, a
  rotation); its README: "WarpedMapLayer currently does not support pitch".
  In a tilted view the map lands flat over the perspective. `AllmapsOverlayLayer`
  hides the warped layer while `map.getPitch() > 0.5` and shows a raster layer
  from `https://allmaps.xyz/{z}/{x}/{y}.png?url=<annotation>` instead (works
  for any annotation URL); `allmapsTiles: true` on the source draws from the
  tile server always. Revisit when Allmaps takes MapLibre's projection (request
  drafted in docs/content/docs/dev/upstream-requests.mdx).
- Shared links name catalog overlays by id; `resolveCatalogSourceId` in
  `lib/timeline-catalogs.ts` rebuilds the source from the id alone for Allmaps
  maps (`custom-basemap-allmaps-<id>`, `custom-basemap-cat-cat-allmaps--<id>`),
  David Rumsey sheets (`…--rumsey-RUMSEY_8_1_…`: the Luna id with `~` as `_`,
  the annotation keyed by the SHA-1 of the IIIF image URL) and Map Warper /
  Wikimaps maps (`…cat-mapwarper--<n>`). Other catalogs' items are not
  rebuildable from their id. The hook lives in TerrainViewer after the state
  declaration.
- Overlay draw order: `OverlayBasemapLayers` inserts the Overlays list in
  reverse, keyed on position, so the first of the list draws on top; edit
  mode's drag handle reorders `customBasemapSources`.

- Rumsey's Luna IIIF server is erratic (one tile 0.6 s, the same tile 102 s
  next time, no cache headers). Allmaps' tile server warps any Allmaps map
  server-side and caches it: `https://allmaps.xyz/maps/<mapId>/{z}/{x}/{y}.png`
  (also `/tiles.json` with bounds, maxzoom 20). Auto turns a Rumsey detail page
  into that template.
- Shared links: `makePortableShareUrl` now names catalog items by URL with
  `?sourceMeta=` (bounds, zooms, stack, type) and leaves the rebuildable ids
  alone; Planet tile URLs carry a `{planetKey}` placeholder filled by
  `lib/key-placeholders.ts` in `buildRasterTileSource`.

- Plain images in Allmaps (the georeferencer's polynomial and TPS fits drawn on
  the GPU): `@allmaps/render` only takes IIIF image services, but it accepts a
  `fetchFn`. The workaround to build when wanted: a synthetic IIIF Image API
  level-0 description (`info.json` with width, height, one tile size) answered
  from memory by that fetchFn, the tiles cut from the image with a canvas, then
  our control points and transformation handed to
  `WarpedMapLayer.addGeoreferencedMap`. The cleaner route is the upstream
  request (docs/dev/upstream-requests.mdx).

**Why:** these three came up together when tilted views broke and shared
links lost their overlays.
