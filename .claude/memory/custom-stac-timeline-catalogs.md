---
name: custom-stac-timeline-catalogs
description: User-attached STAC catalogs (API or static) on the historical timeline's Catalogs tree, "My catalogs" group - built 2026-10-08. Where the pieces live, the self-describing id scheme, the Proxy trick for TIMELINE_CATALOG_BY_ID and SOURCE_CONFIG, what is verified, what is not.
type: project
---

# Custom STAC catalogs on the timeline (built 2026-10-08)

**Ask (2026-10-08):** attach custom STAC catalogs, static or search API, to
the timeline catalogs, in their own group. First the HOT loader generalised,
then Planet's heritage static catalog
(`https://data.source.coop/planet/heritage-hackathon-2026/catalog.json`).

## Where

- `lib/stac-crawl.ts` (new): the STAC types, `fetchJson` with the preset's
  auth header, `listCollections`, `crawlStaticItems` (extent filter on the
  way down, bbox + date window on items; nodes AND items cached per session,
  so the timeline's re-crawl on every view move is cheap). Moved out of
  `stac-search-panel.tsx` (lazy-loaded) so `lib/timeline-catalogs.ts` can
  share it without dragging the panel into the initial bundle; the panel
  re-exports the item/collection types for `lib/stac-presets.ts`.
- `lib/timeline-catalogs.ts`: `StacSpec { endpoint, kind, collection?,
  assetKeys?, licence? }`; `HOT_SPECS` (the four HOT catalogs are specs
  now); `stacTicks(catalog, spec, bbox, signal, range)` replaces
  `hotStacTicks` (API: GET /search, POST on 405/400; static:
  `crawlStaticItems`, cap 400 items); `stacAssetHref` (given keys, then
  visual/ortho_visual/cog/image, then the visual role, then a GeoTIFF that
  is not a mask). `MY_CATALOGS_ROOT = "My catalogs"` appended to
  `CATALOG_ROOTS`, `CATALOG_ROOT_ORDER`, `HISTORICAL_TREE_ROOTS`.
- `lib/settings-atoms.ts`: `CustomTimelineCatalog` and
  `customTimelineCatalogsAtom` (local storage `customTimelineCatalogs`).
- `components/TerrainControlPanel/add-timeline-catalog-dialog.tsx` (new):
  preset or saved catalog or URL, collection (API /collections or static
  children), name, short name; `onAdd` stores and ticks it.
- `historical-catalog-tree.tsx`: entries from `timelineCatalogsAtom`
  (built-in + custom); the My catalogs root always renders with the
  "Add a catalog…" row; custom rows have a ✕; a link-selected id not in the
  list is still listed (from `stacCatalogDef`) with a Keep (BookmarkPlus)
  button. The dialog is rendered inside the tree, so inside the picker's
  Popover: verified headless that the Popover stays open under the Dialog.
- `stac-search-panel.tsx`: "Add to the timeline" button (basemap target,
  api/static) for the catalog + chosen collection, with a toast.
- Docs: `features/historical-sources.mdx` "My catalogs" section.

## The id scheme (why it looks odd)

`cat-stac-` + base64 of `kind|endpoint|collection` with `+`→`_`, `/`→`.`,
no padding: alphabet `[A-Za-z0-9_.]`, no `-`, so a catalog id never holds
the `--` that `catalogOfBasemapId` splits a basemap id on
(`custom-basemap-cat-<catalog>--<item>`). `stacCatalogId` / `stacSpecOfId`.
A link from another browser therefore resolves without the stored entry.

## The Proxy trick

`TIMELINE_CATALOG_BY_ID` is a Proxy over the built-in record: `get` and `in`
fall back to `stacCatalogDef(id)` (the stored entry's label/short/colour
when present, else a synthesized one: host · last collection segment).
Every `x in TIMELINE_CATALOG_BY_ID` / `TIMELINE_CATALOG_BY_ID[x]` consumer
in the timeline panel kept working unchanged. `SOURCE_CONFIG` in
`historical-timeline-panel.tsx` is the same Proxy pattern (resClass "vhr").
`SOURCE_IDS` (the pill row) is the built-in keys only.

## Verified (headless, .cache/pw/stac-timeline-check.mjs, dbg2.mjs)

Heritage catalog by link over Agadez: listed under My catalogs, 19 ticks.
Dialog from the picker: URL pasted, 8 children listed, Agadez picked,
suggested name "data.source.coop · Agadez, Niger", added, stored, selected,
removed. HOT OAM 44 and Maxar 7 over Kathmandu through the new loader.
The STAC panel's Add to the timeline (stac-panel-button.mjs): pasted URL,
click, stored as its host, button turns "On the timeline", toast shown.

## Later the same day

- Group renamed "My STAC catalogs" (`MY_CATALOGS_ROOT`); the folds key is
  `cat:My STAC catalogs`.
- A shipped entry in that group: `cat-planet-heritage` (built-in
  TimelineCatalog with a `stac` spec, static, `PLANET_HERITAGE_STAC`), and
  the `planet-heritage` STAC preset in the library. Its GeoTIFFs are plain
  (IFD at the end of the file, not COG): they draw through titiler, which
  reads any GeoTIFF with GDAL range requests, slower without overviews.
- The VHR / Medium res pills judge a catalog tick by its own `gsd`
  (`tickResClass` in historical-timeline-panel.tsx): > 1 m/px is medium.
- The dialog has no short-name field: `shortNameOf(label)` (first words,
  14 chars) is stored as `short`.

## Not verified / not done

- Picking a heritage tick as a view's basemap (titiler over a UTM COG on
  source.coop) in a real browser.
- Search by name for custom catalogs: "unsupported". Edit (rename, colour)
  of an entry: remove and add again.
- The tree's folds key for the new root is `cat:My catalogs`.
