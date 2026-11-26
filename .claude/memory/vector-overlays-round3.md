---
name: vector-overlays-round3
description: 2026-11-26 vector overlays round 3 - feature cards and their click rules, the Library's Vector tab, why the inventories are outlines, Overture base and OCS GE tile weights, UNESCO compact files on the dataset release, the worldheritagesite.org dump that is not a tentative list
type: project
---

# Vector overlays, round 3 (2026-11-26)

User docs: `docs/content/docs/features/vector-overlays.mdx`; schema and measurements: `docs/content/docs/dev/source-schema.mdx` (Vector overlays). What is not in either:

**Feature cards** (`VectorFeaturePopup.tsx`, `lib/vector-popup.ts`). One per view, mounted by `VectorOverlayLayers`. Rules that are easy to break:
- Query the exact layer ids `vectorLayerSpecs` returns per part, never an id prefix: `vector-overlay-hwai-heritage-osm-` is a prefix of the `…-osm-condition` layers.
- No card while a tool owns clicks: `elevationPickerActiveAtom`, `sunShadowActiveAtom`, `georefActiveAtom`, `activeDrawModeAtom !== "select"`; and none when the click hits a `td-` layer (terra-draw). A new click tool must be added to that list (River REM's centerline pick was not checked: it belongs to another branch).
- Properties are untrusted: text only, links from fixed templates with encoded values and a `pattern`, or a value that is itself http(s). A `{url}` template takes the raw value (encoding it broke every inventory's Record link: caught by the unit test).
- A popup opened in a view covers the map under it: a second click "through" the card lands on the card. Not a bug.

**Library dialog.** `LibraryDialogHost` takes the Vector tab as `children` (the vector list is atoms only, no sidebar section owns it); the Terrain and Basemap lists are still portals from their sections. `useLibraryTabSwitch` keeps the three open atoms exclusive. In historical mode the Terrain tab is left out (`terrainTab`).

**Heritage inventories: outlines, not a size filter.** The shapes archive has no area property and the huge polygons are spread over dozens of inventories (measured over 658 zoom 6 tiles), so neither a property filter nor a per-inventory list holds. MapLibre has no area expression. Chosen: `polygonFill: false` on the shapes companion plus a filter on `id == "EPSG:4326"` (extent boxes of the HOT exports). The real fix is upstream: an `area_km2` column in Heritage Watch's export (Iconem's own pipeline), then one `filter` line and fills can come back.

**Heritage order.** The Heritage map's SOURCES panel lists OSM heritage, Wikidata, OSM destroyed and damaged, then the inventories (checked live in Chrome; the bundle is `tools/assets/MapApp-*.js` and `counts-*.js`, which also hold the card code). The app follows that.

**Overture `base.pmtiles`** holds six layers in one archive, so land cover and land use cannot be had without water, bathymetry and infrastructure. `land_use` carries `subtype` / `class` only at zoom 13 (below, features are unclassed). Hence minzoom 9 (cover) and 13 (use). Weights are in the schema doc.

**Géoplateforme vector tiles.** `https://data.geopf.fr/tms/1.0.0/` lists every tile set; the ones with `extension="pbf"` are vector, each with a TileJSON at `<set>/metadata.json`. OCS GE `COUVERTURE` and `USAGE` hold the same polygons and fields. Tiles are not compressed. Coverage is by department and incomplete.

**UNESCO.** `scripts/build-unesco-vectors.mjs` reads the portal's live `whc001` export by default (1,273 records on 2026-11-26; the download in the user's folder, 1,248, predates the 2026 session). Live records have a MultiPoint geometry and `components_list` as a JSON string; an older saved file has a Point and a bare `{name: …}` form: the script reads both. Files are on the `dataset-indexes` release under `public/vector/` (gitignored, guarded by `check-media.mjs`).

**No Tentative List source.** `worldheritagesiteorg-tentative-sites-dump-2026-02-02.geojson` is misnamed: all 8,419 features have `site_status: "Inscribed"` (8,299 official locations, 120 community ones), every one stamped `copyright: worldheritagesite.org`. The site sits behind a Cloudflare challenge, its terms could not be read, so nothing of it is published or added. UNESCO's open data portal (45 datasets) has no tentative list.

**Building shadows.** `buildingPart` caches the companion-backed entry in a WeakMap: the shadow layer keys its work on the entry's identity, a new object per render would restart it.

**KML / GPX** as vector sources: `type: "geojson"` with `format`, converted by `parseVector`. `detectVectorSource` now reads the response as text (it was `res.json()`): a fetch stub in a test needs `text()`.
