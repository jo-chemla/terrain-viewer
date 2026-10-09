---
name: deckgl-raster-custom-projections
description: Custom CRS in the browser: deck.gl-raster PR 694 (custom planar projections, polar stereographic COGs with no basemap, on deck.gl v10's _CustomProjectionView) and issue 322 (EPSG resolution in geotiff, the devseed epsg package / clj-proj for small CRS bundles). Jonathan flagged PR 694 as very exciting on 2026-10-08. Added 2026-10-09: MapLibre PR 8286 -> PR 8723 (addProjection, experimental), the new math.gl repo with CRS support (alpine-ice-age example) and its deck.gl integration PR 10744, and the compatibility thread (one {forward, inverse} converter for both libraries).
type: reference
---

# deck.gl-raster: custom projections, and EPSG in the browser

- **PR 694** https://github.com/developmentseed/deck.gl-raster/pull/694
  (closed/merged 2026): an experimental example rendering COGs in
  arbitrary planar projections with no basemap, polar stereographic as the
  headline (Web Mercator cannot show the poles), Equal Earth and Web
  Mercator through the same pipeline. Built on deck.gl's
  `_CustomProjectionView` (visgl/deck.gl#10741, tracker #10739), shipped
  with deck.gl v10; the example runs on 9.4 through a stand-in. Written by
  Claude Code for Kyle Barron. **Why it matters here:** ArcticDEM, REMA and
  any polar DEM or imagery could be viewed in their own CRS, which MapLibre
  (Web Mercator only, globe aside) cannot do; a possible route for a
  "polar view" of the PGC catalogs (lib/stac-presets.ts `pgc`).
- **Issue 322** https://github.com/developmentseed/deck.gl-raster/issues/322
  "geotiff: Make CRS resolution async?" (open): the thread on resolving an
  EPSG code to a projection in the browser without a huge bundle: the
  devseed `epsg` package, or willcohen's clj-proj (a PROJ port, smaller
  bundle per Kyle). Relevant to our export's output-CRS field
  (lib/output-crs.ts: proj4 with built-in 4326/3857/UTM, epsg.io fetch for
  the rest); if that field ever needs offline arbitrary EPSG, look here.

## The CRS ecosystem converging (noted 2026-10-09)

- **MapLibre**: PR 8286 https://github.com/maplibre/maplibre-gl-js/pull/8286
  led to PR 8723 https://github.com/maplibre/maplibre-gl-js/pull/8723,
  `addProjection` with a `CrsDefinition` (still experimental): tiles are
  loaded already in the CRS grid, the tile matrix is MapLibre's own.
- **math.gl**: a new repo https://github.com/visgl/math.gl whose next
  version supports CRS, example
  https://visgl.github.io/math.gl/next/examples/alpine-ice-age; being
  integrated into deck.gl in PR 10744
  https://github.com/visgl/deck.gl/pull/10744.
- **The compatibility thread** (on the MapLibre PR, the ask being that
  MapLibre and deck.gl end up compatible): deck.gl's custom projection
  takes proj4's converter, `{ forward, inverse }` over position arrays, and
  math.gl's project/unproject have the same shape, while MapLibre's
  `CrsDefinition` takes `project(lng, lat)` and `unproject(x, y)`.
  Switching it to a `projection: { forward, inverse }` field would let one
  converter object serve both libraries. Open question to @birkskyum:
  whether the compatibility meant is only that, or deck.gl layers
  interleaved on a CRS MapLibre map, which also needs both sides to put CRS
  coordinates on the same world square.
- **For us**: the export's output CRS (lib/output-crs.ts, proj4) already
  produces a proj4 converter; if a CRS map view ever lands in MapLibre,
  that converter is the object to hand it. See also
  [[custom-stac-timeline-catalogs]] for the UTM GeoTIFFs served through
  titiler today.
