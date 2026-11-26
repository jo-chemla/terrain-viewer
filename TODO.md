# TODO / Future Work

Notes for later — not scheduled, don't start without explicit go-ahead.

## Local COG: service worker fallback (option 2)

Context pasted 2026-07-16. Blob URL streaming (already implemented) covers Chromium;
this would be the more robust, cross-browser fallback if blob: Range-fetch support
turns out to be a real problem in the field (Safari/Firefox).

> Service worker as a local range server (the robust no-companion answer): register
> a small SW; when the user picks a COG, post the File object to it (Files are
> structured-cloneable); the SW intercepts `GET /local-cog/{id}` and answers Range
> requests with 206 responses built from `file.slice(start, end)`. From the app's
> point of view this is a plain same-origin HTTPS URL — no mixed content, no CORS,
> no server, and the geomatico protocol plus all your existing BYOD plumbing (zoom
> detection, source config) work unchanged. With the File System Access API you can
> persist the file handle in IndexedDB so the source survives reloads in Chromium
> (one permission re-prompt); Safari/Firefox users just re-pick the file per session.

## Arbitrary-CRS COG streaming: custom maplibre protocol

Context pasted 2026-07-16, following research into `developmentseed/deck.gl-raster`
(see conversation history) — that project's rewrite does now support arbitrary-CRS
COGs via GPU-based reprojection, but as a deck.gl overlay layer, not a maplibre
protocol, and it isn't built to feed maplibre's own `raster-dem`/`setTerrain()`
elevation pipeline directly.

> The realistic path to actually fix our CRS problem using this ecosystem wouldn't
> be adopting deck.gl wholesale — it'd be using their new building blocks
> (`@developmentseed/geotiff` reader + `@developmentseed/epsg`/`proj` reprojection
> math) to write our own new maplibre custom protocol (same pattern as our existing
> `cog://`/`slope://` handlers) that reprojects+resamples elevation into terrain-rgb
> tiles on the fly. That's a real, scoped project — want me to spike whether
> `@developmentseed/geotiff` + `epsg` are usable standalone (outside deck.gl) for
> that?

Status 2026-11-18: a GDAL VRT in any projection is now reprojected in the browser (`vrt://`, proj4 on a coarse grid). What is still open is a single COG read directly (`cog://`, local or remote), which must be in Web Mercator.

This would directly fix the EPSG:3857-only limitation documented in the README's
"Local (offline) COG terrain sources" section, for both local and remote COGs.
