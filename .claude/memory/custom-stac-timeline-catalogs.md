---
name: custom-stac-timeline-catalogs
description: Design for letting the user attach their own STAC catalogs (API or static) to the historical timeline's Catalogs tree, in a "My catalogs" group - data model, loader, self-describing ids, UI, caveats, effort. Asked 2026-10-08, not built.
type: project
---

# Custom STAC catalogs on the timeline (design, not built)

**Ask (2026-10-08):** attach custom STAC catalogs, static or search API, to the
timeline catalogs, in their own group.

## What exists to reuse

- `lib/timeline-catalogs.ts`: `TIMELINE_CATALOGS` (static list, `group`
  decides the tree root), `loadCatalogTicks(catalog, bbox, signal, range)`
  dispatches per id; `hotStacTicks` is already a STAC API search loader
  (bbox + datetime + collections, one tick per acquisition, asset pick
  visual/cog/image, `cogSource` through titiler or cog://). `planetTicks`
  is already a static-catalog walker (catalog.json → collections → items,
  indexed once per session).
- `lib/stac-presets.ts` and the STAC search panel's catalog combobox
  (presets by name, or a pasted URL); `lib/source-url-detect.ts` tells a
  STAC API from a static catalog from an item.
- Catalog ids are self-describing where links must work on another
  browser (Allmaps: `custom-basemap-cat-cat-allmaps--<id>`).

## Design

1. **Loader**: generalise `hotStacTicks` into `stacTicks(spec, bbox, signal,
   range)` with `spec = { endpoint, kind: "api" | "static", collections?,
   assetKeys? }`. API: `GET /search?bbox&datetime&collections&limit=200`
   (POST when GET is refused). Static: walk `catalog.json` → collections
   (filter by `extent.spatial` against the bbox first) → items, cap the
   walk (e.g. 2,000 items), cache per session like Planet. Asset: the
   given keys, else visual/cog/image, else the first GeoTIFF; non-COG via
   titiler. Date: `datetime`, else `start_datetime`; items without bbox or
   date skipped. Thumbnail, gsd, licence from properties as today.
2. **Ids, self-describing** so a shared link resolves without the
   recipient having the catalog: `cat-stac--<base64url(endpoint|kind|
   collection)>`; `catalogOfBasemapId` and `resolveCatalogSourceId`
   already split on `--`. The user's list is only for the picker.
3. **State**: `customTimelineCatalogsAtom` (`atomWithStorage`, like
   `customBasemapSourcesAtom`): `{ id, label, short, endpoint, kind,
   collections, assetKeys, color }`. A derived `timelineCatalogsAtom =
   [...TIMELINE_CATALOGS, ...custom.map(toCatalog)]` with `group: "My
   catalogs"`; append the group to `CATALOG_ROOT_ORDER` /
   `HISTORICAL_TREE_ROOTS`. Every consumer that reads
   `TIMELINE_CATALOGS` (picker tree, coverage tree, search by name,
   `TIMELINE_CATALOG_BY_ID`) switches to the atom or a getter.
4. **Dispatch**: `loadCatalogTicks` sends `cat-stac--*` to `stacTicks`
   after decoding the id; `searchCatalogs` (search by name) can use the
   API's free-text `q`/`ids` when offered, else is "unsupported".
5. **UI**: an "Add a catalog" row at the end of the My catalogs group in
   the Catalogs picker, opening a small dialog: URL (presets combobox from
   `stac-presets.ts`, Auto-detect kind), collections (multi-select from
   `/collections`, or the static catalog's children), asset key, name,
   colour. Plus "Add to timeline" on the STAC search panel for its current
   catalog. Remove/edit from the same group (edit mode, like the sources
   list).

## Caveats

CORS decides everything (most STAC APIs and S3-hosted static catalogs
allow it; refusals get the Old Maps Online treatment: listed, disabled,
with the reason). Static catalogs can be huge: extent filter first, hard
cap, progress in `catalogStatusAtom`. One search per view move, debounced
as today.

**Effort:** about a day: half for loader, ids, atom and dispatch; half
for the dialog, the picker group, the search panel button, docs.
