---
name: esri-3d-coverage
description: Esri has no global photorealistic mesh — what Esri3D_Buildings_v1 actually is, and the one search key that finds all 10 900 Integrated Mesh services
metadata:
  type: project
---

**Esri has no Google/Bing equivalent.** There is no single Esri tileset you
can point a camera at anywhere and get photogrammetry. Two things look like
one and are not:

- **`Esri3D_Buildings_v1`** (`basemaps3d.arcgis.com/.../Esri3D_Buildings_v1`,
  AGOL item `b8fec5af7dfe4866b1b8ac2d2800f282`) is one global I3S layer of
  **modelled** buildings — TomTom, Vantor, Community Maps, Overture, refreshed
  quarterly. Not imagery-derived. It declares a whole-world extent, so there
  is nothing to map. It was briefly an "Open In" destination and was removed:
  next to Google Earth and Bing Maps 3D it promised real 3D and delivered
  extrusions.
- **Integrated Mesh** scene layers ARE photogrammetry, published one service
  per capture — a city, a district, a road corridor, one drone flight.

## The single point of entry, and the key that matters

ArcGIS Online's public search API, no key and no crawl: the item's extent
comes back with the search result. The whole game is WHICH field you match.

| query | hits |
|---|---|
| `tags:"integrated mesh"` (free text, what a publisher typed) | 48 |
| `typeKeywords:"IntegratedMesh"` (set by ArcGIS on publish) | **~10 900** |

The first version of `docs/scripts/build-esri-3d-coverage.mjs` used the tag
and looked complete. Search caps any one query at 10 000 items and stops
paging, so the script now queries a `modified` year at a time (biggest year so
far ~2 800). Dedupe by SERVICE url, not item id — the same hosted mesh is
routinely registered as several items.

Most are small: median extent ~0.02° (~2 km). That is what the data is.
Items over 4° are dropped as mis-tagged indexes. 121 requests, ~4.4 MB out
(840 KB gzipped).

## Linking to one

`https://www.arcgis.com/home/webscene/viewer.html?url=<serviceUrl>&viewpoint=cam:<lng>,<lat>,<height>;<heading>,<tilt>`

`?url=` is documented and opens that ONE service in a scene of its own, which
is why it beats `?layers=<itemid>` and the item page: nothing else is in the
scene, so Esri's 3D Buildings basemap layer is not there to z-fight with the
mesh. **Scene Viewer has no URL parameter that switches that layer off** had
it been present — checked the AGOL help for scene URL parameters, which
documents only `webscene`, `layers`, `url`, `viewpoint`, `ui` and `#<slide>`.

None of it renders here — I3S is Esri's own format and maplibre has no reader.
The overlay answers "who has photogrammetry here", alongside
[[google-3d-coverage-dead-end]] and Bing.
