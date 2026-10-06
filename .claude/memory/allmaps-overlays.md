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
  sets the layer's visibility to none while `map.getPitch() > 0.5` and the
  Overlays list explains it. Revisit when Allmaps adds a projection matrix.
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

**Why:** these three came up together when tilted views broke and shared
links lost their overlays.
