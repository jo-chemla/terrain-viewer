---
name: annotation-tools-survey
description: Survey (2026-10-09) of free and paid tools for annotating before/after imagery pairs (COG, geo polygons, task assignment and review), task coordination (Tasking Manager, Mergin, Kart), editors (iD, QGIS, GeoLibre, Terra Draw) and COG gateways (TiTiler, neoserver, GeoLens). Kept for a future annotation workflow around the viewer.
type: reference
---

# Annotation tools survey (noted 2026-10-09)

Jonathan's comparison, kept verbatim: "might be useful at some point". The
case: annotate change between a before and an after image (heritage sites),
polygons in a real CRS, per-user assignment and review, self-hosted if
possible. The viewer's own Terra Draw layer is the from-scratch option
([[custom-stac-timeline-catalogs]] for the imagery side).

## 1. Annotation tools, free to use

| Tool | Repo / site | Install | Geo and COG | Before/after pairs | Assignment and review | Main drawback |
|---|---|---|---|---|---|---|
| GeoLabel (DeadTrees) | [frontend](https://github.com/Deadwood-ai/deadtrees-frontend), [backend](https://github.com/Deadwood-ai/deadtrees-backend) | Docker Compose plus Supabase, MIT | Yes, native COG, geo polygons in PostGIS | Not native, single image per dataset, fork needed | Auditor queue with approve and revert, row-level security | Built for deadwood, small team, needs a fork for pairs and your classes |
| CVAT | [cvat-ai/cvat](https://github.com/cvat-ai/cvat), [docs](https://docs.cvat.ai/docs/administration/basics/installation/) | `docker compose up -d`, or hosted app.cvat.ai | No, pixel only, accepts image URLs | Two-frame task, keyboard flicker | Good: jobs, assignees, review stage, QA | Georeferencing on export via your own manifest |
| Label Studio | [HumanSignal/label-studio](https://github.com/HumanSignal/label-studio) | `docker run heartexlabs/label-studio` or pip | No, pixel only, accepts image URLs | Native side by side, COG ids in task JSON | Basic in community, review is Enterprise | No synced zoom across the pair |
| GroundWork | [element84.com/groundwork](https://element84.com/groundwork/) | Hosted, free tier: 10 campaigns, 10 GB, 5 collaborators | Yes, converts uploads to COG, GeoJSON and STAC export | Not native, campaigns are per image | Campaigns with validation, on free tier | No self-host, imagery counts against 10 GB |
| labelme | [wkentaro/labelme](https://github.com/wkentaro/labelme), [satellite demo](https://github.com/wkentaro/labelme-satellite-image-demo) | `pip install labelme`, [releases](https://github.com/wkentaro/labelme/releases) | No, chip to GeoJSON recipe exists | No | None | Single user, standalone app paid |

(The "1b light version" was the same five tools as bullets: GeoLabel geo yes
native COG and PostGIS polygons, pairs by fork; CVAT pixel only, two-frame
flicker, jobs/assignees/review; Label Studio pixel only, native side by side,
review is Enterprise; GroundWork hosted, COG conversion, GeoJSON and STAC
export, no external COG by URL; labelme single user.)

## 2. Annotation tools, paid SaaS

| Tool | Site | Self-host | Geo and COG | Before/after pairs | Assignment and review | Main drawback |
|---|---|---|---|---|---|---|
| Labelbox | [tiled editor docs](https://docs.labelbox.com/docs/tiled-editor) | No, [support confirms](https://community.labelbox.com/t/on-premise-usage/627) | Yes, COG by URL, polygons in file CRS | Not native, two-COG overlay [reported broken](https://community.labelbox.com/t/importing-geotiff-with-overlay/2412) | Full workflow | Paid, data leaves your infra |
| Kili | [geospatial docs](https://docs.kili-technology.com/docs/geospatialtiled-imagery) | No | Yes, GeoTIFF and COG, EPSG 4326 or 3857, GeoJSON export | Not native | Yes | Geospatial type in [private beta](https://docs.kili-technology.com/docs/labeling-geospatial-assets) |

## 3. Task coordination and permissioned collaboration

| Tool | Repo / site | Install | Data target and permissions | Task split, assign, validate | Fit for your case |
|---|---|---|---|---|---|
| HOT Tasking Manager | [hotosm/tasking-manager](https://github.com/hotosm/tasking-manager) | Docker Compose, needs OSM OAuth app | One OSM API per instance, world readable | Yes, mature | Blocked by the shared OSM data model |
| HOT Field-TM | [hotosm/field-tm](https://github.com/hotosm/field-tm) | Docker Compose, bundles ODK Central | Own PostGIS, per-organisation access | Yes, PostGIS task splitting | Field forms on mobile, not imagery annotation |
| MapSwipe | [mapswipe workers](https://mapswipe-workers.readthedocs.io/) | Self-hostable backend, needs Firebase | Own Postgres | Yes, crowd tasks with redundancy | Native before/after change type, but tile yes/no only. Good triage stage |
| Mergin Maps CE | [MerginMaps/mergin](https://github.com/MerginMaps/mergin) | Docker Compose | QGIS projects, workspace and project roles, DB sync to PostGIS | No tasking, full history with per-feature diffs | Best off-the-shelf permissioned QGIS workflow, tasks via attribute column |
| QFieldCloud | [opengisch/QFieldCloud](https://github.com/opengisch/QFieldCloud) | Docker Compose | QGIS projects, project roles, PostGIS layers direct or offline | No tasking, change history | Same model as Mergin, more field oriented, weaker history |
| Kart | [kartproject.org](https://koordinates.com/products/kart/) | CLI plus any git remote, QGIS plugin | PostGIS or GeoPackage working copy | Branches, diffs, PR review on a git host | Review and audit layer, pair with a tasks table |
| ArcGIS Workforce | esri.com | SaaS | Esri feature services | Yes | Commercial, Esri stack |
| DIY tasks table | your PostGIS | SQL | Same database, row-level security per user or theme | Status, lock, assignee, reviewer columns | Smallest honest answer |

## 4. Editors and annotator hosts

| Tool | Repo | Self-host | Data target | Before/after | Note |
|---|---|---|---|---|---|
| iD | [openstreetmap/iD](https://github.com/openstreetmap/iD) | Static build | OSM API only | Ctrl+B swaps to previous background | Needs your own OSM instance |
| Rapid | [facebook/Rapid](https://github.com/facebook/Rapid) | Static build | OSM API only | Same as iD | iD fork, same constraint |
| QGIS + QuickMapCompare | [Siddh75/quick_map_compare](https://github.com/Siddh75/quick_map_compare) | Desktop | Anything, PostGIS direct | Synced viewports, hold-S swipe | Add Geo-SAM or Magic Wand for click-to-polygon speed |
| GeoLibre | [opengeos/GeoLibre](https://github.com/opengeos/GeoLibre), [downloads](https://geolibre.app/downloads/) | Web, Tauri desktop for all three OSes, Docker | Local files, COG, GeoParquet, DuckDB-WASM | Layer toggle | Plugin API makes it a candidate host for a thin annotator |
| pgMaps | [nogurtMon/pgMaps](https://github.com/nogurtMon/pgMaps) | One Docker container, any PostGIS | PostGIS, file and ArcGIS FeatureServer import, deck.gl rendering, editing, shared live maps | Layer toggle | Single app password, no per-user roles, no tasking |
| MapLibre + Terra Draw | [JamesLMilner/terra-draw](https://github.com/JamesLMilner/terra-draw) | Your own page | Anything, GeoJSON to PostGIS | maplibre-gl-compare swipe, layer flicker | The from-scratch thin annotator |
| NextGIS Web | [nextgis/nextgisweb](https://github.com/nextgis/nextgisweb) | Docker | Own PostGIS, resource permissions | Layer toggle | Browser feature editing, no tasking |

## 5. COG serving and permissioned data gateways

| Tool | Repo | Install | Remote COG | Permissions and editing | Role |
|---|---|---|---|---|---|
| TiTiler | [developmentseed/titiler](https://developmentseed.org/titiler/endpoints/cog/) | `docker run developmentseed/titiler` | Yes | None | Tiles and bbox crops as virtual chips for CVAT and Label Studio |
| tileserver-rs | [vinayakkulkarni/tileserver-rs](https://github.com/vinayakkulkarni/tileserver-rs) | Docker Compose | Yes, direct and from STAC API sources | OGC API Features with CRUD on PostGIS, no RBAC noted | TiTiler plus feature server in one Rust binary, built-in viewer |
| neoserver | [tobilg/neoserver](https://github.com/tobilg/neoserver) | Single Go binary or Docker | Yes, plus PostGIS, DuckDB, GeoParquet | Workspace RBAC, per-layer read control, WFS-T editing and locking, OIDC | One workspace per theme as the permission boundary. v0.3.0, single author, single node, store key not rotatable |
| GeoLens | [geolens-io/geolens](https://github.com/geolens-io/geolens) | Install script, Docker Compose | Yes, auto-converts uploads, VRT mosaics | Per-dataset RBAC, OIDC, no feature editing | Catalog and tile URLs for QGIS or MapLibre, STAC and OGC API, exports GeoPackage and GeoParquet |
| Martin | [maplibre/martin](https://maplibre.org/martin/sources-cog-files/) | Binary or Docker | No, local only, unstable flag | None | Only if already running it for vector tiles |
| GeoServer | geoserver.org | Java, Docker | Yes with COG plugin | Roles, WFS-T | Heavy, fine if already deployed |
| geotiff.js in browser | [geotiffjs/geotiff.js](https://github.com/geotiffjs/geotiff.js) | None | Yes, range requests | n/a | Terrain Viewer approach, works for your own annotator, not for URL-based tools |

## A before/after example worth citing (2026-10-09, "it's funny")

Aurélien Chaumet's LinkedIn post, https://lnkd.in/p/esHvsQmk: the
Observatoire du littoral of the Île d'Oléron compares IGN 1950 and 2024
aerial photos with a swipe slider and a **magnifier mode** (the 2024 photo
only inside a circle following the cursor, over the 1950 background), on
Business Geografic's GEO with ol-ext (Jean-Marc Viglino); the starting code
shared under the Beerware licence by Malo Tartevet, modified by Pierre
Caritey, so the author owes them a round. 291 reactions. A magnifier mode is
a cheap idea for the historical split (a circle clip on view B).
