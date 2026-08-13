# Maxar + Sentinel/Landsat Basemap Integration — Plan

Status: Plan B1 (Sentinel Hub/CDSE) and B2 (Planetary Computer) are implemented and confirmed live; Plan C (Nearmap/Vexcel, §7) and Plan A (Maxar, §3) are scaffolded but untested — no keys yet for any of the three. All on branch `feat-stac-maxar`. This doc is meant to be self-contained — a fresh agent/engineer should be able to pick up implementation from this file alone, without the originating chat.

Repo: `elevation-terrain-visualizer` (this repo). Sibling project referenced for context: [Iconem/search-satellite-imagery](https://github.com/Iconem/search-satellite-imagery) (does not yet use Maxar either — Maxar Xpress is listed there only as a future/evaluated aggregator, no integration exists).

---

## 1. Background & decision log

Kept as a running log — append new decisions at the bottom with a date, rather than editing earlier entries, so the reasoning trail stays intact.

**2026-08-11 — Goal.** Jonathan (Iconem) wants to integrate Maxar's Basemaps WMTS/WMS, Seamlines WFS, and STAC search to demo the value of terrain + historical satellite imagery to a client/prospect. Maxar has been asked for API keys and will send them, but they haven't arrived yet.

**Key blocker found.** No self-service trial exists for Maxar's API (confirmed via their own docs: WMTS basemap guide, WFS seamlines guide, CQL playground page, API key guide — none expose a demo/sandbox key or a signup flow; key generation requires an existing Vantor Hub account tied to a contract). No demo/leaked key was found or searched for — deliberately did not search for actual leaked/other-people's credentials, since using them would be unauthorized regardless of "just for testing" intent, and did not fabricate a trial signup on Jonathan's behalf since that requires a real verified identity/company relationship.

**Decision: prep architecture only, no mocking, while waiting for real keys.** Rather than build against fake data, the plan below is written so it drops into the existing per-source module pattern with minimal touch points once real keys exist.

**Jonathan's refinements to the initial sketch (this is the plan baked into §3 below):**
- Maxar's WMTS **basemap** should behave like the existing Bing integration: always show the *latest* available mosaic, with a small "as of `<date>`" indicator next to the source label and as a single marker on the timeline — not a full per-date scrubbable history on this path.
- The **historical** date list should come from querying Seamlines WFS (or another mechanism) for which imagery footprint(s) cover the *current viewport center* at the *current zoom*, surface those real dates to the user, then build the WMTS `cql_filter` as "acquisition date ≤ picked date" (best-available-as-of, not exact-equality) so you don't get blank tiles between real capture dates.
- Only a **VHR vs. Medium-resolution** pill should be exposed to the user for now — it selects which product tier(s) to look up in the seamline query, but does **not** need to be threaded into the CQL date filter itself. Keep v1 simple.

**2026-08-12 — Plan B1 (Sentinel Hub/CDSE) implemented and confirmed live.** Jonathan already had a CDSE account and shared a real Configuration Instance ID (instance named "quarterly-mosaic", account jchemla@ico...). Live-tested via GetCapabilities + two real GetMap requests over Paris: the instance has a custom layer literally named `LAYER-MOSAIC` (not a guessed default-template name), which renders visibly better (brighter, more natural true-color) than the generic `TRUE_COLOR` layer also present — `LAYER-MOSAIC` is what `lib/sentinel-hub.ts` uses. **Caveat found:** every tile from this instance carries a visible "Copernicus — Europe's eyes on Earth" watermark logo baked into the image — a CDSE-side rendering behavior, not fixable from the app; worth knowing before relying on this for a client-facing demo. The real instance ID is now in local `.env` (`VITE_SENTINEL_HUB_INSTANCE_ID`, gitignored) so this source is live in the running app, not just scaffolding.

**Separately, an adjacent ask:** Jonathan flagged that the existing `lib/hls.ts` (NASA HLS via titiler-cmr) renders low-resolution compared to EOX's Sentinel-2 cloudless mosaic (`lib/eox-s2-cloudless.ts`), but EOX is a fixed annual composite, not date-filterable. He asked what other ways exist to stream/mosaic Sentinel-2 or Landsat as a date-filtered basemap, ideally as a generic "load any STAC/COG catalog as a basemap layer" feature (comparable to NextGIS QMS's WMS/layer list). Research turned up three real, currently-usable options — written up as **Plan B** (§4) below, since two of them (CDSE/Sentinel Hub and Microsoft Planetary Computer) are self-serve *today* and can be used to prototype the exact CQL/timeline UX Maxar will eventually need, without waiting on Maxar at all.

**2026-08-13 — Researched further Sentinel/Landsat mosaic-provider alternatives.** Landsat on Planetary Computer: confirmed live (`landsat-c2-l2` registers/tiles the same way as Sentinel-2), but deliberately **not added** — 30m native resolution reads visibly coarser than Sentinel-2's 10m, not worth it for this use case. Landsat on CDSE: added to CDSE's own catalog in January 2026, but not configured on the "quarterly-mosaic" instance; not pursued for the same resolution reason. **Airbus OneAtlas Basemap** (the closest Maxar-tier VHR equivalent, 1.5m global/50cm-30cm cities): confirmed via their own docs it's a single always-current mosaic, **one-shot like Bing** — no dated versions/time-series the way Maxar's seamlines work; commercial account required. **Planet NICFI** (free tropical mosaics, 4.77m, monthly): confirmed **discontinued** — contract with Planet ended January 2025, free access phased out by April 2025, Norway cancelled the next-phase renewal tender in September 2025 — not viable. **Copernicus Sentinel-2 Global Mosaic (S2GM)**: a real official free cloud-free mosaic product, but it's an on-demand ordering service (Mosaic Hub), not an always-on tile endpoint — doesn't fit the live-scrub UX without pre-generating specific mosaics first; not pursued.

**2026-08-13 — Provider landscape survey (Albedo, Geopera, Satellogic Aleph, Pixxel, Maxar Open Data/eAPI/Discovery, birdi.io, AxelGlobe, Umbra, SpyMeSat) + UI fixes.** In one research pass: none of the "new space" names (Albedo/Geopera/Satellogic) publish a Maxar-style mosaic product — Geopera is a self-serve aggregator/broker (no mosaic), Satellogic/Aleph gates real API access behind sales despite a free web trial, Albedo has no public API story at all. Pixxel/Aurora has a genuine self-serve STAC-style archive-search API + free 1-month trial, no mosaic. **Found but deliberately not pursued: Maxar Open Data (public no-key S3+STAC) and Maxar Discovery/Catalog Search (free self-serve account at discover.vantor.com)** — Jonathan already covers this exact need at search-eo.iconem.com, so skipped. birdi.io is a dead end (no dev API at all). AxelGlobe has real docs but is contract-scoped only, no self-serve keys, no open global search, and the GraphQL tile-lookup idea from earlier notes turned out to be speculation, not real. Umbra's STAC v2 API is real but account creation is sales-gated (SAR is also a different modality — not a drop-in for an optical timeline anyway). SpyMeSat is confirmed to be just a broker (Maxar+Planet+SI Imaging+ST Engineering), not an independent source. Separately: the CDSE tile watermark was fixed (Jonathan unchecked "Show logo" in the instance's Configuration Utility) — confirmed via a re-fetched tile, clean now.

**Root-caused and fixed: Sentinel Hub pill wasn't appearing in the app.** Two compounding causes: (1) Settings UI never actually exposed `maxarKey`/`sentinelHubInstanceId` as editable fields — the only way either atom got a value was `.env`'s default, which `atomWithStorage` only applies the first time a browser has never seen that localStorage key, so a browser that had already initialized it to `""` (near-certain after this many reloads across the session) was stuck with no way to override it; (2) the dev server + `node_modules` had been swapped out from under the working directory by other concurrent agent activity on `main` (a `react-syntax-highlighter` → `sugar-high` migration pruned a dependency this branch's `gdal-tabs.tsx`/`json-editor.tsx` still need). Fixed both: added "Maxar API Key"/"Sentinel Hub / CDSE Instance ID" fields to Settings → API Keys (+ batch-edit), and re-ran `pnpm install` to restore this branch's `node_modules`. Dev server is now on port 5173 (not the earlier 5199).

**UI polish:** the Maxar VHR/Medium-resolution toggle was removed from the Basemap section entirely (per Jonathan's call to simplify) — `lib/maxar.ts`'s historical branch now always requests the `"vhr"` tier; the underlying function still accepts a tier param for whenever this needs reintroducing, but nothing in the UI/state layer surfaces it anymore (`maxarResolutionTierAtom` deleted). (A timeline zoom-out-padding change was tried here too but reverted — Jonathan implemented the same idea independently on another branch and didn't want the conflict.)

---

## 2. Existing repo architecture (what both plans plug into)

No formal "Source" plugin interface exists. Each historical/date-driven basemap is its own module under `lib/`, wired into a dispatcher via if/else branches, plus several registries that must each be updated per new source. This was confirmed by direct code exploration (file:line references below) — verify these still hold before implementing, since the codebase moves.

- **Tile-building dispatcher:** `components/LayersAndSources/MapSources.tsx`. Static-URL basemaps live in a `rasterBasemaps` dict (~L85-94: `osm/googlesat/google/esri/mapbox/bing/here`, each `{url, tileSize, maxzoom}` with `{API_KEY}`/`{quadkey}` templating). Date-driven sources are dispatched in `RasterBasemapSource` (~L309-424): an if/else chain per `basemapSource` id (`wayback` ~L374, `hls` ~L392, `ge-historical` ~L397, `planet` ~L406, `eox-s2` ~L411, else static ~L416), plus a second if/else for zoom range (~L427-433).
- **Per-source date modules:** `lib/wayback.ts`, `lib/hls.ts`, `lib/ge-historical.ts`, `lib/planet.ts`, `lib/eox-s2-cloudless.ts`, `lib/bing.ts`. Two informal flavors:
  - *Real per-location capture dates* (network-backed, location/zoom-keyed): `useWaybackItemsWithLocalChanges` / `useWaybackRealCaptureDates` (`lib/wayback.ts:78,164`), `useGeHistoricalDates` (`lib/ge-historical.ts`), `useBingCaptureDate` (`lib/bing.ts`). **This is the flavor both Maxar's historical branch and any STAC-based source should follow.**
  - *Synthetic/fixed cadence* (no real per-location catalog): `syntheticHlsTicks()` (`lib/hls.ts:66`), `planetMonthlyTicks()` (`lib/planet.ts:26`), `eoxS2CloudlessTicks()`. Not the right template for date-accurate sources.
- **Timeline registry:** `components/TerrainControlPanel/historical-timeline-panel.tsx` — imports all per-source date hooks (~L10-15), normalizes into `TimelineTick{source,key,dateMs,label}`, merges into `allTicks` (~L428). New sources add a hook import + an entry in `SOURCE_CONFIG` (~L56-66).
- **Basemap-id registry:** `lib/historical-sources.ts` — `HISTORICAL_BASEMAP_IDS` / `TIMELINE_SOURCE_IDS` sets (~L12, L18).
- **Basemap picker + key-gating:** `components/TerrainControlPanel/raster-basemap-section.tsx` — `BUILTIN_BASEMAP_OPTIONS` (~L25) lists selectable sources; `KEY_GATED_BASEMAPS` (~L48) hides a source from the picker until its API key atom is non-empty (currently gates `here`, `mapbox`, `planet`).
- **API key convention:** env var in `.env` (`VITE_MAPBOX_ACCESS_TOKEN`, `VITE_MAPTILER_API_KEY`, `VITE_HERE_API_KEY`, `VITE_GOOGLE_API_KEY`, `VITE_PLANET_API_KEY`, …) → a jotai `atomWithStorage` in `lib/settings-atoms.ts:17-31` defaulting to `import.meta.env.VITE_X ?? ""` (e.g. `hereKeyAtom`, `planetKeyAtom`), user-overridable in Settings UI. **New keys (Maxar, CDSE/Sentinel Hub, Planetary Computer) should follow this exact pattern.**
- **Attribution:** static strings in `STATIC_BASEMAP_ATTRIBUTIONS` (`lib/basemap-attribution.ts:21-44`), applied as each MapLibre `<Source>`'s `attribution` prop. Live/dynamic per-date attribution (since MapLibre can't update a mounted source's attribution string) is rendered only in the sidebar via hooks like `useEsriDynamicAttribution` / `useWaybackDynamicAttribution` (`lib/basemap-attribution.ts:123`, `lib/wayback.ts:339`), `useGeHistoricalDynamicAttribution`, `useBingDynamicAttribution`, dispatched through `textFor()` in `components/TerrainControlPanel/SourceInfoSection.tsx:103-110`.
- **Existing date-filtered-mosaic precedent:** `lib/hls.ts`'s `hlsTileUrl` (~L36-52) already builds a titiler-cmr tile request with a `temporal=<ISO start>/<ISO end>` window and `collection_concept_id` — the closest existing thing in this codebase to a "STAC/CMR temporal query as basemap tiles" pattern. Worth reading before implementing either plan below.
- **STAC support today:** none. Grep for "stac"/"STAC"/"catalog" only hits incidental matches (comments loosely describing Wayback's release list as a "catalog", and an unrelated literal `'stac'` string in `CustomTerrainSource.type`'s union in `lib/settings-atoms.ts:76` that is unimplemented elsewhere). Any STAC-search-as-basemap feature (Plan B, Option B2/B3) is new surface area, not an extension of something existing.

---

## 3. Plan A — Maxar Basemaps + Seamlines

**Status: blocked on API key.** Cannot be implemented or tested until Maxar sends real credentials (no self-serve trial, no legitimate demo key found). Everything below is the design to implement the moment a key arrives.

### 3.1 Endpoints & auth (confirmed from Maxar's own docs)

| Purpose | Endpoint | Notes |
|---|---|---|
| WMTS basemap tiles | `https://api.maxar.com/basemaps/v1/ogc/gwc/service/wmts` | `service=WMTS&request=GetTile&layer=Maxar:Imagery&tileMatrixSet=...&tileMatrix=EPSG:<code>:<zoom>&tileCol=...&tileRow=...&format=image/png|jpeg`. Optional `cql_filter`, `shoreline_masking`. |
| Seamlines WFS | `https://api.maxar.com/basemaps/v1/seamlines/wfs` | `service=WFS&request=GetFeature&version=2.0.0&typeNames=seamline&bbox=<minLat,minLon,maxLat,maxLon>`, optional `cql_filter` e.g. `product_name='VIVID_STANDARD_30' AND BBOX(seamline_geometry,...)`. Schema includes `acq_time_earliest`, `acq_time_latest`, `product_name`. |

Auth (either works): query param `maxar_api_key=<key>`, or header `maxar-api-key: <key>`, or OAuth2 `Authorization: Bearer <token>`. Keys expire 180 days from creation by default.

### 3.2 Basemap branch — "latest mosaic" (models on Bing)

- New module `lib/maxar.ts`. No per-date CQL on this path — just render the WMTS layer with no `cql_filter` (or the default/latest product) so it's always current.
- To get the "as of `<date>`" badge: query Seamlines WFS for the seamline covering the current viewport center point (small bbox around center), read `acq_time_latest` off the returned feature, expose via a `useMaxarLatestCaptureDate()` hook — same shape/role as `useBingCaptureDate` (`lib/bing.ts`).
- Badge renders in two places, matching Bing's existing pattern: next to the source label (wherever Bing's equivalent lives today — check `raster-basemap-section.tsx`/`SourceInfoSection.tsx` for how Bing's date badge is wired) and as a single point marker on the timeline (one more entry in `SOURCE_CONFIG`, `historical-timeline-panel.tsx`).
- Attribution: static fallback string in `STATIC_BASEMAP_ATTRIBUTIONS`, plus a `useMaxarDynamicAttribution` hook (same role as `useWaybackDynamicAttribution`) if Maxar's per-scene attribution needs to be scene-specific rather than a fixed string.

### 3.3 Historical branch — seamlines-driven real dates + CQL "as of" filter

1. **Date discovery.** On viewport move/zoom (debounced), call Seamlines WFS `GetFeature` with a small bbox around the viewport center, optionally filtered by the selected resolution tier: `cql_filter=product_name IN (<VHR product names>) ` or `IN (<medium-res product names>)` depending on the pill state (§3.4). Exact `product_name` enum values are unconfirmed — **must be verified against a real API response once a key exists** (placeholder names like `VIVID_STANDARD_30` appear in Maxar's own doc examples but the full VHR/medium-res taxonomy isn't documented publicly).
2. **Surface ticks.** Map each returned seamline feature to a `{dateMs, label}` tick using `acq_time_earliest`/`acq_time_latest` (need to confirm which field represents "the date to show" — likely `acq_time_latest` per footprint, but confirm against real data since a seamline can span a range). Register this as a `useMaxarSeamlineDates(bbox)` hook, added to `historical-timeline-panel.tsx`'s `SOURCE_CONFIG` exactly like Wayback/GE Historical are today (the "real per-location dates" flavor from §2, not the synthetic-cadence flavor).
3. **Apply the filter.** On tick selection, build the WMTS tile request with `cql_filter=acq_date<='<picked date>'` (best-available-as-of semantics — confirm exact date-field name and operator support against the live API; Maxar's docs show equality/AND/BBOX composition but not explicitly a `<=` comparison, so this needs a live smoke-test against the CQL Playground once a key exists, per Jonathan's original note that "CQL filter can dynamically filter out by collection date").
4. Wire the new basemap id into `lib/historical-sources.ts` (`HISTORICAL_BASEMAP_IDS`/`TIMELINE_SOURCE_IDS`) and the `MapSources.tsx` dispatcher (new `maxar-historical` branch, or a `mode` flag on a single `maxar` branch shared with §3.2 — implementer's call based on how much the "latest" and "historical" code paths end up sharing).

### 3.4 VHR vs. Medium-resolution pill

- Simple two-state UI toggle (not per-scene, not fed into the date CQL filter). Feeds only the `product_name IN (...)` clause of the seamline lookup query in step 1 of §3.3, restricting which footprints/dates are even offered to the user for that tier.
- Belongs in the basemap picker (`raster-basemap-section.tsx`) as a sub-control under the Maxar entry, likely gated behind `KEY_GATED_BASEMAPS` the same way `here`/`mapbox`/`planet` are gated on their key atoms today.

### 3.5 File touch list (Plan A)

New: `lib/maxar.ts`.
Edited: `components/LayersAndSources/MapSources.tsx` (dispatcher branch), `lib/historical-sources.ts` (id registration), `raster-basemap-section.tsx` (`BUILTIN_BASEMAP_OPTIONS`, `KEY_GATED_BASEMAPS`, resolution pill), `historical-timeline-panel.tsx` (`SOURCE_CONFIG` entry), `lib/settings-atoms.ts` (`maxarKeyAtom`, same pattern as `hereKeyAtom`), `lib/basemap-attribution.ts` (static string + dynamic hook), `SourceInfoSection.tsx` (`textFor` branch), `.env`/`.env.example` (`VITE_MAXAR_API_KEY`).

### 3.6 Open questions to resolve once API access exists

- Real `product_name` enum values and which ones map to "VHR" vs "Medium resolution."
- Whether `cql_filter` genuinely supports a `<=` date comparison on the WMTS `GetTile` request (vs. only exact/BBOX/IN on WFS) — test in the CQL Playground first.
- Which seamline date field (`acq_time_earliest` vs `acq_time_latest`) is the right one to show as "the" date per footprint.
- Rate limits / tile-caching behavior for WMTS under a trial-tier key.

---

## 4. Plan B — Self-serve prototyping now: CDSE/Sentinel Hub + Microsoft Planetary Computer

**Status: unblocked — both have free/self-serve access today.** Independent of Maxar; can be built and demoed immediately, and doubles as a testbed for the CQL/timeline interaction pattern Plan A will need.

Origin of this plan: `lib/hls.ts` (NASA HLS via titiler-cmr) renders soft/low-resolution; `lib/eox-s2-cloudless.ts` is a fixed annual composite with no date filtering. Neither gives a genuinely date-scrubbable, decent-resolution Sentinel-2/Landsat basemap. Three real alternatives were identified:

### 4.1 Option B1 — Copernicus Data Space Ecosystem (CDSE) / Sentinel Hub OGC services

Closest interaction model to Maxar's Basemaps+CQL design, and testable **today** with a free CDSE account (self-service signup at dataspace.copernicus.eu — no waiting on anyone).

- Real OGC WMS/WMTS/WFS/WCS endpoints in front of raw Sentinel-1/2/3/5P COGs.
- Genuine request-time params: `time=<start>/<end>` (date range, lowercase — confirmed from live GetCapabilities), `maxcc=<0-100>` (max cloud coverage, confirmed as a percentage not a 0-1 fraction).
- Base URL: `https://sh.dataspace.copernicus.eu/ogc/wms/<instanceId>` — confirmed live, CDSE's own domain (not the legacy Sinergise sentinel-hub.com one).
- Auth: the instance id alone in the URL path is sufficient — confirmed live, no OAuth client id/secret needed for a plain GetMap request.
- **Status: DONE, live in the app.** Implemented in `lib/sentinel-hub.ts`, confirmed against Jonathan's real "quarterly-mosaic" CDSE instance (see the 2026-08-12 decision-log entry above) — uses that instance's custom `LAYER-MOSAIC` layer, not a guessed default-template name. Known caveat: tiles carry a baked-in Copernicus watermark logo.

Validates the exact "timeline tick → TIME-filtered mosaic tile" UX end-to-end — this is the reference implementation the Maxar branch's own CQL-filtered-tile UX (§3.3) should look like once a Maxar key exists.

### 4.2 Option B2 — Microsoft Planetary Computer mosaic/tiler API

Best fit for the literal "STAC search → filter → tile mosaic" flow described (NextGIS-QMS-style).

- Free; many collections usable without a subscription key, a free key raises rate limits.
- Hosts Sentinel-2 L2A and Landsat Collection 2 as STAC collections.
- Its `/mosaic` API registers a STAC search (bbox + `datetime` range + `eo:cloud_cover` filter, expressed as CQL2-JSON) and returns a TileJSON/XYZ tile endpoint rendering the matching scenes, mosaicked on the fly.
- Repo/docs: `github.com/microsoft/planetary-computer-apis`, `planetarycomputer.microsoft.com/docs/quickstarts/using-the-data-api/`.

**Recommended as the reference implementation for a generic "STAC search as a basemap source" feature** — i.e., treat this as the shape a future generic STAC-source module (`lib/stac-basemap.ts`?) should take, since it's the most literal match to "let me load any STAC catalog as a filtered mosaic basemap."

### 4.3 Option B3 — AWS Earth Search (Element84) + a tiler — the generic building block, heavier lift

This is the actually-generic version of B2 (works with *any* STAC catalog, not just Planetary Computer's curated collections) but requires more infrastructure:

- `earth-search.aws.element84.com/v1` is Element84's free public STAC API over Sentinel-2 L2A and Landsat Collection 2 COGs on AWS Open Data (`stac-server` + Elasticsearch backend).
- **Requirement not present in B1/B2: Earth Search does not host its own public tiler.** You get STAC search results (item metadata + COG URLs) but need a separate tiling service — self-hosted TiTiler (open-source, deployable as a small server/Lambda) or another hosted instance — to actually turn a STAC search + mosaic into map tiles.
- This is the right long-term building block if the goal (per Jonathan's NextGIS QMS comparison) is "point this at any STAC catalog, including a future Maxar STAC endpoint" — but it means standing up/maintaining a tiler, which B1 and B2 don't require.

### 4.4 File touch list (Plan B)

Same registries as Plan A, generalized:
- New module(s): `lib/sentinel-hub.ts` (B1) and/or `lib/stac-mosaic.ts` (B2, parameterized by STAC API base URL + collection id, reusable for Planetary Computer now and any other STAC API — including Maxar's — later).
- Same touch points as §3.5: `MapSources.tsx` dispatcher, `lib/historical-sources.ts`, `raster-basemap-section.tsx` (+ `KEY_GATED_BASEMAPS` for B1's CDSE credentials), `historical-timeline-panel.tsx` (`SOURCE_CONFIG`), `lib/settings-atoms.ts` (new key/credential atoms), `lib/basemap-attribution.ts`.
- Date ticks for B1/B2 are **not** per-location-real-footprint like Maxar seamlines — they'd more likely be "query STAC for available scene dates intersecting viewport + date range" on demand, closer to a search-driven tick list than a fixed catalog. Worth deciding whether this reuses the same `TimelineTick` shape or needs its own UI (a search panel rather than a passive timeline scrub) — leaning toward the latter given how STAC search naturally works (bbox + date range + cloud cover → result list), similar to the earlier note that full STAC search deserves its own panel rather than being forced into the timeline model.

### 4.5 Recommended sequencing within Plan B

1. B1 (Sentinel Hub/CDSE) first — fastest to a working date-filtered-mosaic demo, validates the UX.
2. B2 (Planetary Computer) second — generalize into a reusable STAC-mosaic module once B1's interaction pattern is proven.
3. B3 (Earth Search + tiler) only if/when a use case needs a catalog Planetary Computer doesn't host, or Maxar itself exposes a STAC endpoint later (bullet 4 in Plan A's original ask, "Search STAC items in a collection") — at that point B3's generic module is what would also serve Maxar's STAC search.

---

## 5. Suggested overall rollout order

1. **Plan B1** (Sentinel Hub/CDSE) — unblocked today, proves the CQL/timeline UX cheaply.
2. **Plan B2** (Planetary Computer) — generalizes B1's pattern into a reusable STAC-mosaic module; strongest demo-day story for "any Sentinel/Landsat date, decent resolution."
3. **Plan A §3.2** (Maxar latest-mosaic basemap) — as soon as a key arrives; lowest-risk Maxar feature since there's no CQL/date logic to get wrong.
4. **Plan A §3.3** (Maxar seamlines-driven historical + CQL "as of" filter) — once §3.6's open questions are confirmed against the live API/CQL Playground.
5. **Plan B3 / Maxar STAC search** — later, only once a concrete need for full STAC search (vs. the timeline-scrub UX) shows up in a demo.

---

## 6. Open questions / risks (cross-cutting)

- Maxar: no confirmed timeline for when keys arrive; §3's product-name taxonomy and CQL comparison-operator support are unverified until then.
- Sentinel Hub/CDSE: verify current auth scheme (client-credentials OAuth2 vs. legacy instance-ID) against live docs before implementing, since Sinergise → CDSE migration has changed this before.
- Resolution/quality tradeoff across all Sentinel-2 options (B1/B2/B3) is still 10m native — better than HLS's rendering but not VHR; useful as a "recent, real, date-filtered" mid-resolution layer, not a Maxar VHR substitute. Don't oversell it as equivalent in the demo.
- No source in this doc has been implemented or smoke-tested yet — treat every endpoint/param name above as "documented, not yet verified against a live response" until someone actually calls it.

---

## 7. Plan C — Other direct (non-broker) VHR mosaic providers: Nearmap + Vexcel (+ EarthDaily note)

Following the provider survey in §1's 2026-08-13 entry, these two are the only other providers found that publish a genuine dated/historical imagery archive (Maxar-style, not Airbus-OneAtlas-style single-current) through a real, non-broker API — as opposed to Geopera (broker), Satellogic/AxelGlobe/Umbra (sales-gated), or Airbus OneAtlas (one-shot, no history). Both are implemented as scaffolding (`lib/nearmap.ts`, `lib/vexcel.ts`) — **neither has a confirmed self-serve free tier**, so like Maxar, both are untested against a live account.

### 7.1 Nearmap — higher confidence

- Real developer portal (`developer.nearmap.com`), base domain `https://api.nearmap.com` confirmed live from a doc example.
- **Coverage API is a genuine seamlines equivalent**: `GET /coverage/v2/point/{lon},{lat}` returns real per-location survey metadata (dates/resolution/content types), each survey with a `surveyId` that feeds the Tile API. This is the strongest match to Maxar's mechanism found in the entire survey.
- Tile API path shape confirmed (`{base}/{contentType}/{z}/{x}/{y}.{format}` and a `surveys/{surveyId}/...` variant for a specific date), but the literal `contentType` value (placeholder `"Vert"` in `lib/nearmap.ts`) was **not** confirmed — every doc page with a full worked example was unreachable during research (either 404, or a JS-rendered reference explorer WebFetch couldn't extract). Auth is a `apikey` query param (confirmed).
- **Not global**: US, Australia, New Zealand, Canada are Nearmap's named core markets; `isInNearmapCoverageArea()` is a coarse bounding-box gate, not real per-city coverage.
- Access model: docs only say "a valid account with an active subscription" — no confirmed free/self-serve trial.

### 7.2 Vexcel — lower confidence

- Current API base confirmed: `https://api.vexcelgroup.com/v2/` (their own docs state the older `api.gic.org`-domain API 1.0 was deprecated July 2026 — don't use it even though some search results still surface it).
- Real product exists: a standard OGC WMTS (GetCapabilities+GetTile) for their Ortho imagery, alongside a custom `GetOrthoImageTile` endpoint. Resources are organized by collection/event/extract/tile, consistent with genuinely dated imagery (their own marketing describes an "annually refreshed" historical library going back years) — but **no metadata/coverage endpoint (Nearmap's Coverage API equivalent) was found**, so `lib/vexcel.ts` cannot build real per-location ticks the way `lib/nearmap.ts` does. `vexcelAnnualTicks()` is a **synthetic once-a-year placeholder**, not a real catalog — same honesty caveat as `lib/hls.ts`'s synthetic monthly ticks.
- The exact WMTS layer name/vintage-selection mechanism (`VEXCEL_ORTHO_LAYER = "Ortho"`, `time=<year>` param) is an unverified best guess extrapolated from standard OGC WMTS conventions (the same shape Maxar's own confirmed-working WMTS uses) — most sub-pages of Vexcel's Confluence docs 404'd during research, so treat this as a starting point to correct against a real account, not a confirmed request shape.
- Coverage: North America + parts of Europe/Australia-NZ, "40+ countries" per marketing — `isInVexcelCoverageArea()` is a coarse placeholder.
- Access model: no self-serve signup found anywhere — reads as enterprise-only (support ticketing).

### 7.3 EarthDaily (formerly Descartes Labs) — researched, not integrated

Their **"EarthMosaics"** product is real: self-serve web UI *and* an actual XYZ tile-streaming service, historical archive back to 2016. Worth knowing but **not pursued as a separate integration**: it's built on the same Sentinel-2/Landsat 10m open data this repo already streams directly via Planetary Computer (§4.2) and Sentinel Hub (§4.1) — a nicer packaged product, not a resolution upgrade. Their own new VHR constellation (5m GSD, 16-imager array) only started delivering data in February 2026 and isn't commercially self-serve yet — worth revisiting in a future pass once that matures.
