---
name: stac-browser-components
description: Future direction for the STAC search panel - reuse an open React STAC browser instead of growing the hand-rolled panel
type: project
---

The STAC search panel (components/TerrainControlPanel/stac-search-panel.tsx) is
hand-rolled: presets, /search POST, static-catalog crawl, federated
collection discovery, COG asset picking. Jonathan noted on 2026-09-16 that
collection navigation should eventually reuse existing React components
rather than keep growing this panel. Candidates:

- Development Seed stac-map (https://github.com/developmentseed/stac-map) -
  React + MapLibre STAC explorer, handles web-map-links, `?href=` deep links
  (OpenAerialMap's own map at api.imagery.hotosm.org/map is this).
- GeoLibre (https://github.com/opengeos/GeoLibre) - its STAC tree /
  collection-asset browser, plus the Portolan registry browser from PR 2371.
- GeoLens (https://github.com/geolens-io/geolens) - self-hosted catalog with
  STAC / OGC APIs and semantic search; a possible *backend* to point the
  panel at rather than UI to embed.
- Radiant Earth stac-browser is Vue, not React - link target only.

**Why:** the panel already duplicates catalogue browsing that these
projects maintain; the value here is what happens after an asset is picked
(titiler pin, terrain vs basemap, coverage overlays), not the tree.

**How to apply:** when the next STAC feature is asked for (WMTS web-map-links,
item pagination, deeper static trees), evaluate embedding one of the above
before extending the panel.
