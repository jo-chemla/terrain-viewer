---
name: cdse-stac-access
description: Copernicus Data Space (CDSE) STAC - open catalog, no anonymously readable data; what each host answers, the CopDEM AWS rewrite, quicklook quirks, the Sentinel Hub instance-id route not built
type: project
---

Checked with anonymous requests on 2026-11-14 (presets `cdse` and `cdse-dem`, helpers in `lib/cdse.ts`, table in `docs/content/docs/dev/stac-search.mdx`).

- `stac.dataspace.copernicus.eu/v1`: CORS `*`, POST search with `query`/CQL2, POST `next` links with a `token`, ~430 collections, **429 after a dozen quick requests** (do not script bursts against it).
- Every data href is `s3://eodata/...`. The `alternate.https` copies on `download.dataspace.copernicus.eu/odata/v1/Products(..)/Nodes(..)/$value` answer **401** without an OIDC token (CORS is fine: `*`, Range and Authorization allowed). Some mosaics' `alternate.https.href` is the literal string `zipper`.
- Public: quicklooks `datahub.creodias.eu/odata/v1/Assets(..)/$value` -> 301 -> `zipper.creodias.eu`, 200 with CORS but `application/octet-stream` (an `<img>` is fine; a link downloads it). `thumbnails.dataspace.copernicus.eu/wms` only accepts a fixed size list per product (Landsat mosaics: 250x250 only), and the catalog's own 500x500 Landsat-mosaic thumbnails get 403. Do not use that WMS as a tile source: the size guard is deliberate.
- Copernicus DEM: CDSE's `auxdata/CopDEM_COG/copernicus-dem-{30,90}m/<name>/<name>.tif` has the same names as AWS Open Data `https://copernicus-dem-{30,90}m.s3.amazonaws.com/<name>/<name>.tif` (Range yes, CORS no, so titiler; EPSG:4326 declared, so the panel pins it there). The AWS release may lag.
- Copernicus Browser deep links: ids are case-sensitive and an unknown `datasetId` silently switches to Sentinel-2; the reference is `public/datasets.txt` and `public/deep-linking.txt` in github.com/eu-cdse/copernicus-browser.
- Not built: Sentinel Hub OGC `sh.dataspace.copernicus.eu/ogc/wms/{instanceId}` authenticates by instance id alone and reflects the calling origin in CORS (a bad id gives 400 "Invalid instance id"). A user-made instance id in Settings (localStorage, `{cdseInstance}` placeholder like `{planetKey}` in `lib/key-placeholders.ts`) would make scenes addable as WMS tiles; layer names depend on the user's configuration, so read them from GetCapabilities (or the WMTS parser).

**Why:** the obvious move (add CDSE like Earth Search) yields buttons with s3:// hrefs that fail silently; the catalog is only useful as discovery plus the DEM rewrite.

**How to apply:** before promising CDSE imagery on the map, check whether the user has a Sentinel Hub instance id; for streamable Sentinel-2/Landsat point to Earth Search. Related: [[custom-stac-timeline-catalogs]], [[commercial-dem-api-access]].
