---
name: deckgl-raster-custom-projections
description: deck.gl-raster PR 694 (custom planar projections, polar stereographic COGs with no basemap, on deck.gl v10's _CustomProjectionView) and issue 322 (EPSG resolution in geotiff, the devseed epsg package / clj-proj for small CRS bundles). Jonathan flagged PR 694 as very exciting on 2026-10-08.
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
