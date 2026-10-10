---
name: event-dems-research
description: Research of 2026-10-10 on public pre/post disaster DEMs for the library (Kilauea 2018, Chamoli EIDC, Xinmo 2017, Melamchi 2021, La Palma 2021, LA fires 2025, Ridgecrest, LINZ, USGS ScienceBase): URLs, CRS, COG, CORS and titiler checks, licences, draft entries; none is a Web Mercator COG, all go through titiler; the Zenodo Chamoli pair fails on titiler too.
type: reference
---

# Public pre/post event DEMs for the library (research 2026-10-10)

Research run 2026-10-10. Every check below was run from this machine. The tools are in this folder:

- `check.mjs`: HEAD plus a `Range: bytes=0-1023` GET, both with `Origin: https://terrain-viewer.iconem.com`. It records `access-control-allow-origin`, `accept-ranges` and the 206.
- `gi.sh`: `gdalinfo /vsicurl/` with GDAL 3.11.4 from anaconda.
- `tt.mjs`: fetches one terrainrgb tile from `https://titiler.xyz` (the app's default endpoint) at a given z/lon/lat with a given `nodata`.

Raw outputs are in `check1.jsonl`, `check_eidc.jsonl` and `gdal1.txt`. Bucket listings are in `rfiles.txt` (OpenTopography dataspace rasters) and `ot_raster.xml`.

## Headline findings

1. **The library's current Chamoli pair is broken on titiler too, not only in-page.** Zenodo still sends no `Access-Control-Allow-Origin`; range requests work, but only with a browser-like User-Agent (node's default UA gets 403). The bigger problem is that titiler.xyz answers **HTTP 500** for both Zenodo files at z11, z13 and z15, and for `/cog/info`, after about 10 s each time. The same files open fine with local GDAL. The cause was not established; the likeliest explanation is that Zenodo refuses or throttles titiler.xyz's server.
2. **There is a working second host for Chamoli: NERC EIDC, under the Open Government Licence.** It holds Westoby and Berthier's post-event Pléiades 2 m DEMs (six dates, 2021-02-10 to 2022-04-02) and DEMs of difference. One of them, `1509_composite_210210_dod.tif`, is the 2015 Shean composite subtracted from the 2021-02-10 DEM. EIDC supports range requests but sends no CORS header, so it is titiler-only, and titiler renders both files tested (z13). The DoD reads **−90 m** at 79.731 E, 30.377 N, at the Ronti detachment.
3. **None of the candidates is an EPSG:3857 COG.** Every event dataset found is in UTM or a national CRS. The best in-browser path is a **VRT on OpenTopography's S3**: it reflects the request `Origin` back as `access-control-allow-origin` and supports ranges, and the app's `vrt://` reader reprojects arbitrary CRSs in the browser. The VRT candidates are Kilauea July 2018 and the Ridgecrest pre/post pair. Single-file UTM COGs need `cogViaTitiler`.
4. **OpenTopography's "dataspace" bucket** (`opentopography.s3.sdsc.edu/dataspace/OTDS.*`, community datasets) is the richest source of event pairs. It is separate from the `raster/` bucket the library already uses, and both pass the CORS and range checks.

## Candidate table

Abbreviations:

- **COG:** "COG" means `LAYOUT=COG`. "tiled+ovr" means tiled with internal overviews but no COG layout tag. "tiled" means tiled with no overviews. "strip" means row-strips with no overviews, which is bad for remote reads.
- **CORS:** "echo" means the server reflects the request Origin.
- **Titiler:** the result of the tile test, with the lowest zoom that rendered.
- **Hosts:** DS = `https://opentopography.s3.sdsc.edu/dataspace`, R = `https://opentopography.s3.sdsc.edu/raster`, EIDC = `https://catalogue.ceh.ac.uk/datastore/eidchub`.

| Event | Date | Pre / post file | Host | URL (path) | CRS | Res | COG | CORS | Ranges | Licence | Size | Titiler |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Kilauea summit caldera collapse | May-Aug 2018 | pre: 2009 lidar (first-return) | OT raster | R/HI09_Big_Island/HI09_Big_Island_hh.vrt (ArcGrid .adf sources) | UTM 5N | 1 m | no (ArcGrid) | echo | yes | CC BY 4.0 | VRT 4.5 KB over ~1 GB | only z16 (z13-15 time out) |
| " | " | post: 8-12 Jul 2018 lidar DTM | OT raster | R/HI18_KilaueaJL/HI18_KilaueaJL_be/20180711_kilauea_summit_dtm_filled.tif | EPSG:6635 (UTM 5N) | 0.5 m | tiled+ovr, LZW, Float64 | echo | yes | "Not provided" on OT (USGS/CRREL/UH, FEMA-funded) | 1.94 GB | ok z12 |
| " | " | post, whole survey | OT raster | R/HI18_KilaueaJL/HI18_KilaueaJL_be.vrt (2 tif sources) | EPSG:6635 | 0.5 m | sources tiled+ovr | echo | yes | " | 4.3 GB | VRT fails z12-14, ok z15 |
| Chamoli rock-ice avalanche | 7 Feb 2021 | pre: Sept 2015 composite (in library) | Zenodo | zenodo.org/records/4554647/files/Chamoli_Sept2015_Composite_DEM2m_wmean.tif | UTM 44N | 2 m | tiled+ovr | **no** | yes (browser UA only) | CC BY 4.0 | 849 MB | **500 at z11/13/15** |
| " | " | post: 10-11 Feb 2021 composite (in library) | Zenodo | zenodo.org/records/4558692/files/Chamoli_Feb2021_Composite_DEM2m_order_PHR_wmean.tif | UTM 44N | 2 m | tiled, no ovr (per library note) | **no** | yes | CC BY 4.0 | n/m | **500 at z13** |
| " | " | post: Pléiades 2021-02-10 | NERC EIDC | EIDC/5a1eaef4-9211-4227-a017-d20b08be5784/210210_dem.tif (also 210606, 211225, 220127, 220221, 220402) | UTM 44N | 2 m | tiled 256, no ovr, Float64 | **no** | yes (206; no `accept-ranges` header) | OGL | 136 MB | ok z13 |
| " | " | change: 2015 composite → 2021-02-10 DoD | NERC EIDC | EIDC/f5394eaa-5ccb-4cf7-9ee4-c057c35b8517/1509_composite_210210_dod.tif (+4 Pléiades-to-Pléiades DoDs) | UTM 44N | 2 m | strip | **no** | yes | OGL | 632 MB | ok z13 (8.6 s) |
| Xinmo landslide | 24 Jun 2017 | pre: WV-2 2012-12 / 2013-09 SETSM | OT dataspace | DS/OTDS.112021.32648.1/raster/xinmoprelandslide_DEM.tif (+ `...flitered_DEM.tif`) | UTM 48N | 2 m | tiled 128, no ovr | echo | yes | CC BY 4.0 | 14 MB | ok z12, z14 |
| " | " | post: WV-2 2017-07-17 SETSM | OT dataspace | DS/OTDS.112021.32648.1/raster/Xinmopostlandslide_DEM.tif (+ filtered) | UTM 48N | 2 m | tiled, no ovr | echo | yes | CC BY 4.0 | 14 MB | ok z14 |
| Melamchi flood (debris flood cascade) | 15 Jun 2021 | pre: Pléiades 2021-01 (P05) | OT dataspace | DS/OTDS.102024.32645.1/raster/Melamchi_DSM_P05_202101.tif | UTM 45N | 1 m | tiled 512 deflate, no ovr | echo | yes | CC BY 4.0 | 993 MB | ok z13, **fails z12** |
| " | " | post: Pléiades 2021-10 (P06, P07) | OT dataspace | DS/OTDS.102024.32645.1/raster/Melamchi_DSM_P06_202110.tif, ..._P07_202110.tif | UTM 45N | 1 m | tiled, no ovr | echo | yes | CC BY 4.0 | 619 MB / 1.28 GB | P06 ok z13, fails z11-12 |
| " | 2014-2024 series | P01-P02 2014-11, P03-P04 2020-11, P08-P11 2023-12, P12 2024-01 | OT dataspace | same folder | UTM 45N | 1 m | tiled | echo | yes | CC BY 4.0 | 0.2-1.3 GB each | not tested |
| La Palma (Tajogaite) eruption | 19 Sep-13 Dec 2021 | syn-eruptive: 26-27 Sep 2021 UAS SfM | OT dataspace | DS/OTDS.062022.4083.1/raster/Cumbre_Vieja_DSM_SfM_09_2021_50cm_REGCAN95.tif | EPSG:4083 (REGCAN95 UTM 28N) | 0.5 m | tiled 128, no ovr | echo | yes | CC BY 4.0 | 103 MB | ok z13, z14 |
| " | " | post: Jan 2022 SfM | OT dataspace | DS/OTDS.032022.4083.1/raster/Cumbre_Vieja_DSM_SfM_January_2022_20cm_REGCAN95.tif | EPSG:4083 | 0.2 m | BigTIFF, tiled, no ovr | echo | yes | CC BY 4.0 | 1.42 GB | **500 at z14-16**, ok only z17 |
| " | " | post: cone only, Mar 2022 (series to Jul 2024) | OT dataspace | DS/OTDS.022026.4083.1/raster/Tajogaite_cone_2022_03_DSM_20cm.tif (.2 to .6 = 2022-10 ... 2024-07) | EPSG:4083 | 0.2 m | tiled, no ovr | echo | yes | CC BY 4.0 (checked on the 2021/22 records; the cone series licence was not opened) | ~100-112 MB each | ok z13, z14 |
| LA fires, Eaton and Palisades | Jan 2025 | pre: 2016 lidar DSM/DTM, aligned | OT dataspace | DS/OTDS.022025.32611.1/raster/dsm_eaton_alignedNK_1m_PREFIRE.tif (+ dtm_, palisades_) | UTM 11N | 1 m | **COG** w/ ovr | echo | yes | **CC0 1.0** | 0.9-1.4 GB | ok z13 |
| " | " | post: Jan 2025 lidar DSM/DTM | OT dataspace | DS/OTDS.022025.32611.1/raster/dsm_eaton_epsg32611_geoid12b_1m_POSTFIRE.tif (+ dtm_, palisades_) | UTM 11N | 1 m | **strip** | echo | yes | CC0 | 0.86-1.65 GB | ok z15 (untested lower) |
| " | " | change: 2025-2016 DSM/DTM difference (by the authors) | OT dataspace | DS/OTDS.022025.32611.1/raster/difference_dsm_eaton_2025_2016_aligned_1m_cog.tif (+ dtm_, palisades) | UTM 11N | 1 m | **COG** w/ 6 ovr | echo | yes | CC0 | 0.67-1.23 GB | ok z11 (needs nodata −3.4e38) |
| Ridgecrest earthquakes | 4-6 Jul 2019 | pre: WV 2014-2016 stereo DSM v2 | OT raster | R/CA19_Barn2Pre/CA19_Barn2Pre_hh.vrt (5 tiled tifs) | UTM 11N | 2 m | sources tiled, no ovr | echo | yes | "Not provided" (USGS/SCEC) | ~2 GB | ok z13 |
| " | " | post: WV Jul-Aug 2019 stereo DSM | OT raster | R/CA19_Barn2Post/CA19_Barn2Post_hh.vrt (4 tifs) | UTM 11N | 2 m | sources tiled, no ovr | echo | yes | "Not provided" | ~2 GB | ok z13 |
| Baluchistan earthquake | 24 Sep 2013 | pre / post WV stereo DEMs | OT raster | R/PrePak13_Barn/PrePak13_Barn_hh.vrt, R/PostPak13_Barn/PostPak13_Barn_hh.vrt (2,100+ keys) | UTM 41N | 2 m | **strip** sources | echo | yes | "Not provided" | tens of GB | not tested |
| Stromboli paroxysms | 3 Jul and 28 Aug 2019 | 2018-09, 2019-05, 2019-08, 2019-09 UAS SfM (+ 2021-2025 series) | OT dataspace | DS/OTDS.052021.32633.1/raster/Stromboli_20190511_DSM_25cm_UTM33.tif, ..._20190804-05_..., ..._20180912_... | UTM 33N | 0.25 m | tiled, no ovr | echo | yes | CC BY 4.0 | 13-33 MB | ok z16 |
| Kaikōura earthquake | 14 Nov 2016 | pre 2012 / post 2016-17 lidar DEM | LINZ on AWS | nz-elevation.s3-ap-southeast-2.amazonaws.com/canterbury/kaikoura_2012/dem_1m/2193/ (44 tiles), .../kaikoura_2016-2017/dem_1m/2193/ (115 tiles) | EPSG:2193 | 1 m | **COG** (LERC) per tile | `*` | yes | CC BY 4.0 | ~20 MB/tile | not tested; **no single file or VRT** |
| Cyclone Gabrielle flood | Feb 2023 | pre: hawkes-bay_2020-2021; post: gisborne-and-hawkes-bay-cyclone-gabrielle-river-flood_2023 | LINZ on AWS | nz-elevation.../hawkes-bay/... dem_1m and dsm_1m | EPSG:2193 | 1 m | COG per tile | `*` (same bucket) | yes | CC BY 4.0 (bucket-wide; not opened per collection) | tiles | listing only |
| Lamplugh rock avalanche | 28 Jun 2016 | pre 2016-06-15; post 07-16, 08-27, 09-27, 09-28 | USGS ScienceBase | sciencebase.gov/catalog/file/get/5a132005e4b0738ee13026be?f=__disk__... (one **ZIP** per date) | UTM 7N, ellipsoid | 2 m | inside ZIP | `*` | **no** (200 full body) | US public domain | 9-42 MB zips | unusable as-is; needs re-hosting |
| Oso / SR530 landslide | 22 Mar 2014 | post only: 9 SfM DEMs Jul 2014-Jul 2015 | USGS ScienceBase | sciencebase.gov/catalog/item/5702a5a3e4b0328dcb817435 (ZIPs) | n/v | n/v | ZIP | `*` | no | US public domain | 24-346 MB | unusable as-is |
| Hebgen Lake earthquake | 1959 | pre: 1947 photogrammetric DEM | OT dataspace | DS/OTDS.082022.32612.1/raster/hebgen_lake_dem_1947.tif | UTM 12N | n/v | n/v | echo (bucket) | yes (bucket) | n/v | 1.4 GB | not tested |
| Melamchi, Stromboli, Sinabung, Eaton debris flows | various | further multi-epoch sets | OT dataspace | see `rfiles.txt` (e.g. OTDS.092026.6340.1 Eaton wash debris-flow events before/after, Nov 2025-Feb 2026, small DTM/DSM tifs) | | | | | | | | |

"n/v" means not verified.

Elevation checks (gdallocationinfo on the remote files):

- **Kilauea, Halemaʻumaʻu** (155.2830 W, 19.4065 N): 1053.9 m in 2009, 591.7 m in July 2018, a 462 m drop. A second point (155.29 W, 19.41 N) reads 1133.3 m then 1061.7 m.
- **Xinmo:** at the source area (103.660 E, 32.083 N), 3389.5 m pre and 3048.4 m post (−341 m). At 103.645 E, 32.065 N, −93 m. At 103.655 E, 32.078 N, +10 m.
- **Melamchi Bazaar reach**, P05 (2021-01) to P06 (2021-10): +4.2 m at 85.574 E, 27.820 N. ±1 m at the other three points.
- **La Palma cone:** 929.9 m (Sep 2021) to 1008.3 m (Jan 2022) and 1007.7 m (Mar 2022 cone file), +78 m. At 17.870 W, 28.614 N, 860.8 m to 953.1 m (+92 m).
- **Eaton DSM difference** at five Altadena points: +5.2, −0.05, −0.5, −4.6, −0.6 m. Approximate stats: min −40, max +211, mean +0.8, sd 3.8. The authors note the difference spans 2016-2025, so it includes change unrelated to the fire.
- **Chamoli EIDC DoD** at 79.731 E, 30.377 N: −90.5 m. EIDC `210210_dem.tif` declares nodata **1188.6539…**: it is the fill value outside coverage (the real minimum is 1259.6 m), so `titilerNodata` must be set to it.

## Recommendation: five additions

Selection order: a dramatic, legible event; a real pre/post pair, or an author-made difference; a clear open licence; checks that pass (CORS, ranges, tiled); titiler tested. All five need `cogViaTitiler`, because none is in Web Mercator. Kilauea also has an in-browser VRT route.

1. **Kilauea 2018 summit collapse** (volcanic, ~460 m of subsidence, the strongest signal found). Post: the July 2018 0.5 m summit DTM, which is tiled with overviews and renders on titiler from z12. Pre: the 2009 1 m survey works only from z16 on titiler, because its ArcGrid sources defeat both titiler at lower zooms and the in-browser `vrt://` reader. For an overview-scale before/after, difference the 2018 DTM against the library's existing **AW3D30** entry (2006-2011, pre-collapse). Caveats: the July 2018 licence is "Not provided" on OpenTopography; the vertical datums of HI18 (NAD83(PA11)), HI09 and AW3D30 (EGM96) were not reconciled, so an offset of a few metres is possible.
2. **Chamoli 2021, from NERC EIDC (OGL)**, to replace or back up the Zenodo pair, which no longer renders. Add the 2021-02-10 Pléiades DEM and the authors' 2015→2021 DoD. A pre-event surface can be rebuilt in-app as `210210_dem − DoD`, which gives the 2015 composite on the 2021 grid wherever both exist.
3. **Xinmo 2017 landslide** (Sichuan, ~10 people killed per the record's paper; not re-checked). Two 14 MB co-registered 2 m DEMs, CC BY 4.0: the smallest and fastest pair found, and both render on titiler at z12.
4. **Melamchi 2021 flood** (Nepal; it complements the Bhote Koshi entries). January 2021 and October 2021 1 m Pléiades DSMs, CC BY 4.0, from the Chen et al. 2024 (Nature Geoscience) series. Titiler renders them from z13 only, because there are no overviews.
5. **La Palma 2021 eruption.** The 26-27 Sep 2021 DSM (one week in, so syn-eruptive rather than pre-event) and the March 2022 Tajogaite cone DSM, both CC BY 4.0. The difference shows the cone building by about 80-90 m. The full-area Jan 2022 DSM is avoided because titiler fails below z17 on that 1.4 GB BigTIFF with no overviews.

Runners-up:

- **LA fires 2025:** CC0, real COGs, and an author-made difference that renders from z11. It is a wildfire rather than the event types asked for, and the difference spans eight years.
- **Ridgecrest 2019:** pre/post 2 m VRTs that the app's `vrt://` reader could read in-page (CORS echo, tiled tif sources), but the licence is "Not provided" and rupture offsets of a few metres are subtle at 2 m.
- **Stromboli 2019:** CC BY 4.0, tiny files, but a small crater area.

### Draft JSON entries (shape of `lib/custom-sources.json` → `SAMPLE_TERRAIN_SOURCES`)

Bounds come from gdalinfo corners. For difference entries the bounds are the overlap of the two operands. `minzoom` is the lowest zoom that rendered on titiler.xyz in this run.

```json
[
  {
    "id": "custom-us-kilauea-2018-07-dtm05",
    "name": "USA - Kilauea summit after the 2018 caldera collapse, lidar DTM 0.5m, July 2018 - COG",
    "url": "https://opentopography.s3.sdsc.edu/raster/HI18_KilaueaJL/HI18_KilaueaJL_be/20180711_kilauea_summit_dtm_filled.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": -9999,
    "minzoom": 12,
    "loadWithSamples": false,
    "bounds": [-155.3117, 19.3788, -155.0884, 19.4560],
    "resolutionM": 0.5,
    "description": "Kilauea's summit on 8-12 July 2018, mid-way through the May-August caldera collapse: helicopter lidar by CRREL, the University of Houston and the USGS (FEMA / State of Hawaii funding), hosted by OpenTopography (OTSDEM.072018.6635.1). Tiled Float64 with five overviews, CORS and range requests open; EPSG:6635 (NAD83(PA11) / UTM 5N), so pinned to titiler. Verified: Halemaumau floor 592 m, against 1054 m in the 2009 survey. Nodata -9999. Licence not stated on the OpenTopography record. The whole July survey, including the Puna lava flows, is the VRT R/HI18_KilaueaJL/HI18_KilaueaJL_be.vrt (titiler only from z15).",
    "infoUrl": "https://portal.opentopography.org/raster?opentopoID=OTSDEM.072018.6635.1"
  },
  {
    "id": "custom-us-kilauea-2009-dsm1",
    "name": "USA - Kilauea summit before the collapse, lidar first-return 1m, June 2009 - VRT via titiler",
    "url": "https://opentopography.s3.sdsc.edu/raster/HI09_Big_Island/HI09_Big_Island_hh.vrt",
    "type": "vrt",
    "cogViaTitiler": true,
    "titilerNodata": -3.4028234663852886e+38,
    "minzoom": 16,
    "loadWithSamples": false,
    "bounds": [-155.6127, 19.2326, -155.1784, 19.6333],
    "resolutionM": 1,
    "description": "The 2009 Big Island lidar (OTSDEM.032012.32605.1, CC BY 4.0), highest-hit surface, as an OpenTopography VRT over ArcGrid (.adf) tiles. The in-browser vrt:// reader cannot read ArcGrid, hence titiler; titiler.xyz renders it only from z16 (z13-15 time out). Verified: Halemaumau 1054 m.",
    "infoUrl": "https://portal.opentopography.org/raster?opentopoID=OTSDEM.032012.32605.1"
  },
  {
    "id": "custom-us-kilauea-collapse-vs-aw3d30",
    "name": "USA - Change: Kilauea 2018 caldera collapse, July 2018 DTM - AW3D30 (2006-2011) - derived",
    "url": "diff://custom-us-kilauea-2018-07-dtm05-custom-global-aw3d30",
    "type": "dem-diff",
    "diffMinuendId": "custom-us-kilauea-2018-07-dtm05",
    "diffSubtrahendId": "custom-global-aw3d30",
    "loadWithSamples": false,
    "bounds": [-155.3117, 19.3788, -155.0884, 19.4560],
    "resolutionM": 30,
    "description": "The 2018 summit collapse at overview zooms: July 2018 lidar minus JAXA's 30 m AW3D30 (2006-2011, before the collapse). Expect several hundred metres of lowering over Halemaumau. The vertical datums (NAD83(PA11) and EGM96) were not reconciled, so set diffOffsetM after reading a stable area. For 1 m detail from z16, difference against custom-us-kilauea-2009-dsm1 instead.",
    "infoUrl": "https://www.usgs.gov/volcanoes/kilauea/2018-lower-east-rift-zone-eruption-and-summit-collapse"
  },
  {
    "id": "custom-in-chamoli-2021-02-10-dem2-eidc",
    "name": "IND - Chamoli post-event DEM 2m, Pléiades 10 Feb 2021 (NERC EIDC) - COG",
    "url": "https://catalogue.ceh.ac.uk/datastore/eidchub/5a1eaef4-9211-4227-a017-d20b08be5784/210210_dem.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": 1188.6539306640625,
    "minzoom": 13,
    "loadWithSamples": false,
    "bounds": [79.4900, 30.3695, 79.7725, 30.5775],
    "resolutionM": 2,
    "description": "Pléiades along-track stereo DEM of the Rishiganga and Dhauliganga valleys three days after the 7 February 2021 rock and ice avalanche, by Westoby and Berthier (doi:10.5285/5a1eaef4-9211-4227-a017-d20b08be5784), Open Government Licence. Range requests but no CORS, so titiler. Tiled Float64, no overviews (z13 verified). The file's nodata is 1188.65 m, a fill value outside coverage (real minimum 1260 m). Later dates sit beside it: 210606, 211225, 220127, 220221, 220402_dem.tif.",
    "infoUrl": "https://catalogue.ceh.ac.uk/documents/5a1eaef4-9211-4227-a017-d20b08be5784"
  },
  {
    "id": "custom-in-chamoli-dod-2015-2021-eidc",
    "name": "IND - Change: Chamoli 2021, DEM of difference Sept 2015 composite → 10 Feb 2021 (NERC EIDC) 2m - COG",
    "url": "https://catalogue.ceh.ac.uk/datastore/eidchub/f5394eaa-5ccb-4cf7-9ee4-c057c35b8517/1509_composite_210210_dod.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": -3.4028234663852886e+38,
    "minzoom": 13,
    "loadWithSamples": false,
    "bounds": [79.4900, 30.3695, 79.7725, 30.5792],
    "resolutionM": 2,
    "description": "Not an elevation but a difference: the 10 February 2021 Pléiades DEM minus the September 2015 WorldView composite (Shean), by Westoby and Berthier (doi:10.5285/f5394eaa-5ccb-4cf7-9ee4-c057c35b8517), OGL. Negative is lowering (the Ronti detachment reads -90 m at 79.731 E, 30.377 N), positive is deposition. Read with a diverging ramp around 0. Strip layout with no overviews, so slow; it rendered at z13 in about 9 s. No CORS, so titiler.",
    "infoUrl": "https://catalogue.ceh.ac.uk/documents/f5394eaa-5ccb-4cf7-9ee4-c057c35b8517"
  },
  {
    "id": "custom-cn-xinmo-2013-dem2",
    "name": "CHN - Xinmo pre-landslide DEM 2m, WorldView-2 2012-2013 (SETSM) - COG",
    "url": "https://opentopography.s3.sdsc.edu/dataspace/OTDS.112021.32648.1/raster/xinmoprelandslide_DEM.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": -9999,
    "minzoom": 12,
    "loadWithSamples": false,
    "bounds": [103.6327, 32.0581, 103.6812, 32.0849],
    "resolutionM": 2,
    "description": "Xinmo valley (Maoxian, Sichuan) before the 24 June 2017 rock avalanche that buried Xinmo village: SETSM DEM from WorldView-2 stereo of December 2012 and September 2013, co-registered by the authors (Nuth and Kaab) to the post-event DEM. Atwood and West, OpenTopography OTDS.112021.32648.1, CC BY 4.0. 14 MB, tiled, CORS and ranges open; UTM 48N, so titiler. A filtered variant sits beside it (xinmoprelandslideflitered_DEM.tif, sic).",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.112021.32648.1"
  },
  {
    "id": "custom-cn-xinmo-2017-dem2",
    "name": "CHN - Xinmo post-landslide DEM 2m, WorldView-2 17 Jul 2017 (SETSM) - COG",
    "url": "https://opentopography.s3.sdsc.edu/dataspace/OTDS.112021.32648.1/raster/Xinmopostlandslide_DEM.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": -9999,
    "minzoom": 12,
    "loadWithSamples": false,
    "bounds": [103.6327, 32.0581, 103.6812, 32.0849],
    "resolutionM": 2,
    "description": "The same valley three weeks after the collapse, same grid as the pre-event DEM. CC BY 4.0. Verified: 3390 m to 3048 m at the source area (103.660 E, 32.083 N).",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.112021.32648.1"
  },
  {
    "id": "custom-cn-xinmo-landslide",
    "name": "CHN - Change: Xinmo 2017 landslide, DEM 2017 - 2013 - derived",
    "url": "diff://custom-cn-xinmo-2017-dem2-custom-cn-xinmo-2013-dem2",
    "type": "dem-diff",
    "diffMinuendId": "custom-cn-xinmo-2017-dem2",
    "diffSubtrahendId": "custom-cn-xinmo-2013-dem2",
    "loadWithSamples": false,
    "bounds": [103.6327, 32.0581, 103.6812, 32.0849],
    "resolutionM": 2,
    "description": "The 2017 Xinmo rock avalanche in elevation: the scar high on the ridge and the deposit across the valley floor. Post-event minus pre-event, co-registered by the authors. Atwood and West, OTDS.112021.32648.1.",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.112021.32648.1"
  },
  {
    "id": "custom-np-melamchi-2021-01-dsm1",
    "name": "NPL - Melamchi valley pre-flood DSM 1m, Pléiades Jan 2021 - COG",
    "url": "https://opentopography.s3.sdsc.edu/dataspace/OTDS.102024.32645.1/raster/Melamchi_DSM_P05_202101.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": -32768,
    "minzoom": 13,
    "loadWithSamples": false,
    "bounds": [85.4910, 27.7096, 85.6268, 27.9937],
    "resolutionM": 1,
    "description": "Pléiades photogrammetric DSM of the lower Melamchi valley five months before the 15 June 2021 debris flood, one of twelve 2014-2024 DSMs by Chen, West et al. (Nature Geoscience 2024), OpenTopography OTDS.102024.32645.1, CC BY 4.0. Tiled Float32, no overviews, so titiler renders it from z13 only. CORS and ranges open; UTM 45N.",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.102024.32645.1"
  },
  {
    "id": "custom-np-melamchi-2021-10-dsm1",
    "name": "NPL - Melamchi valley post-flood DSM 1m, Pléiades Oct 2021 - COG",
    "url": "https://opentopography.s3.sdsc.edu/dataspace/OTDS.102024.32645.1/raster/Melamchi_DSM_P06_202110.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": -32768,
    "minzoom": 13,
    "loadWithSamples": false,
    "bounds": [85.4394, 27.7100, 85.6265, 27.8570],
    "resolutionM": 1,
    "description": "The same reach four months after the flood (P06). The upper valley, Melamchi headworks to the Bhemathang fan, is the second October 2021 file, Melamchi_DSM_P07_202110.tif (1.3 GB). CC BY 4.0.",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.102024.32645.1"
  },
  {
    "id": "custom-np-melamchi-flood",
    "name": "NPL - Change: Melamchi 2021 flood, DSM Oct 2021 - Jan 2021 - derived",
    "url": "diff://custom-np-melamchi-2021-10-dsm1-custom-np-melamchi-2021-01-dsm1",
    "type": "dem-diff",
    "diffMinuendId": "custom-np-melamchi-2021-10-dsm1",
    "diffSubtrahendId": "custom-np-melamchi-2021-01-dsm1",
    "loadWithSamples": false,
    "bounds": [85.4910, 27.7100, 85.6265, 27.8570],
    "resolutionM": 1,
    "description": "Aggradation and bank erosion of the June 2021 Melamchi flood along the lower valley. Both DSMs come from the same Pléiades series; co-registration was not checked here. Usable from z13.",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.102024.32645.1"
  },
  {
    "id": "custom-es-lapalma-2021-09-dsm05",
    "name": "ESP - La Palma Cumbre Vieja eruption DSM 0.5m, UAS 26-27 Sep 2021 - COG",
    "url": "https://opentopography.s3.sdsc.edu/dataspace/OTDS.062022.4083.1/raster/Cumbre_Vieja_DSM_SfM_09_2021_50cm_REGCAN95.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": -3.4028234663852886e+38,
    "minzoom": 13,
    "loadWithSamples": false,
    "bounds": [-17.9055, 28.6089, -17.8645, 28.6222],
    "resolutionM": 0.5,
    "description": "Drone structure-from-motion DSM of the Tajogaite vent area one week into the 2021 Cumbre Vieja eruption, by INGV (OTDS.062022.4083.1), CC BY 4.0. REGCAN95 / UTM 28N, so titiler; tiled, no overviews.",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.062022.4083.1"
  },
  {
    "id": "custom-es-lapalma-2022-03-cone-dsm02",
    "name": "ESP - La Palma Tajogaite cone DSM 0.2m, UAS March 2022 - COG",
    "url": "https://opentopography.s3.sdsc.edu/dataspace/OTDS.022026.4083.1/raster/Tajogaite_cone_2022_03_DSM_20cm.tif",
    "type": "cog",
    "cogViaTitiler": true,
    "titilerNodata": -3.4028234663852886e+38,
    "minzoom": 13,
    "loadWithSamples": false,
    "bounds": [-17.8749, 28.6106, -17.8632, 28.6183],
    "resolutionM": 0.2,
    "description": "The new Tajogaite cone three months after the eruption ended, the first of six UAS surveys to July 2024 (OTDS.022026.4083.1 to .6), CC BY 4.0 (licence confirmed on the 2021/22 records, not opened for this series). Verified: summit area 1008 m, 78 m above the September 2021 surface. The full-area January 2022 DSM (OTDS.032022.4083.1, 1.4 GB BigTIFF) only renders on titiler at z17.",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.022026.4083.1"
  },
  {
    "id": "custom-es-lapalma-cone-growth",
    "name": "ESP - Change: Tajogaite cone growth, DSM Mar 2022 - Sep 2021 - derived",
    "url": "diff://custom-es-lapalma-2022-03-cone-dsm02-custom-es-lapalma-2021-09-dsm05",
    "type": "dem-diff",
    "diffMinuendId": "custom-es-lapalma-2022-03-cone-dsm02",
    "diffSubtrahendId": "custom-es-lapalma-2021-09-dsm05",
    "loadWithSamples": false,
    "bounds": [-17.8749, 28.6106, -17.8645, 28.6183],
    "resolutionM": 0.5,
    "description": "How much the cone grew after its first week: up to about 80-90 m over the vent. The pre-eruption surface is not in either file; for the full cone height, difference the March 2022 DSM against Mapterhorn or AW3D30 instead.",
    "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.022026.4083.1"
  }
]
```

Runner-up entry (LA fires), if wanted:

```json
{
  "id": "custom-us-eaton-dsm-change-2016-2025",
  "name": "USA - Change: Eaton Fire 2025, lidar DSM 2025 - 2016, 1m (authors' difference) - COG",
  "url": "https://opentopography.s3.sdsc.edu/dataspace/OTDS.022025.32611.1/raster/difference_dsm_eaton_2025_2016_aligned_1m_cog.tif",
  "type": "cog",
  "cogViaTitiler": true,
  "titilerNodata": -3.4028234663852886e+38,
  "minzoom": 11,
  "loadWithSamples": false,
  "bounds": [-118.1947, 34.1501, -117.9980, 34.2566],
  "resolutionM": 1,
  "description": "Post-fire (January 2025) minus pre-fire (2016) lidar surface over Altadena and the Eaton burn, co-registered by the authors (OTDS.022025.32611.1), CC0. A real COG with six overviews. It spans eight years, so tree growth and construction are mixed with burned buildings. The aligned pre-fire DSM/DTM are COGs too; the post-fire rasters are strip GeoTIFFs. Palisades has the same set.",
  "infoUrl": "https://portal.opentopography.org/dataspace/dataset?opentopoID=OTDS.022025.32611.1"
}
```

## Searched, nothing usable found

| Event | What exists | Why not usable |
|---|---|---|
| Chamoli on OpenTopography | No dataset in the `raster/` bucket listing (295 prefixes) or the OT catalog for that bbox. | — |
| Chamoli on NSIDC HMA2_CPRE / HMA2_CPOST | NSIDC lists them as non-NSIDC data with no files; the access link goes back to Zenodo (4558692). | Same Zenodo files. |
| Chamoli on GEE community catalog, Source Cooperative, AWS | A web search found nothing. | Not exhaustively checked. |
| Lamplugh 2016 (ScienceBase, doi:10.5066/F7TT4Q4B) | 5 DEMs (1 pre, 4 post), 2 m, public domain. | ZIPs only, and ScienceBase ignores Range (200 with the full body), so neither the browser nor titiler can read them. The fix is to re-host as COGs. The release notes the DEMs are not precisely co-registered. |
| Marmolada 2022 | CESBIO built a Pléiades DEM against Copernicus EEA-10. | No public file found. |
| Blatten / Birch glacier 2025 | swisstopo STAC has swissALTI3D 2019 and 2024 and swissSURFACE3D 2021 at Blatten (tiles 2629-2630 / 1139-1141): pre-event only. | No 2025 post-event tiles. swisstopo's rapid-mapping products are imagery; a third-party photogrammetric DEM is on Sketchfab / Google Drive, which is not a stable host. |
| Anak Krakatau 2018 | Papers (Darmawan 2020, Hunt 2021); DEMNAS as a pre-event baseline. | No public post-event DEM found. |
| Oso 2014 | USGS SfM DEMs, post-event only, in ZIPs (same ScienceBase limitation). | Pre-event 2013 lidar is on the WA DNR lidar portal, which was not checked. |
| Türkiye 2023 | Terrestrial lidar point clouds (DesignSafe); General Directorate of Mapping aerial photogrammetry (ULAKBIM record 274145, not opened). | No regional open DEM pair confirmed. |
| Wayanad 2024 | NRSC rapid maps cite a Cartosat 2.5 m DEM. | No download found. |
| Sikkim / South Lhonak 2023 | Papers and NRSC slides. | No public DEM found. |
| Hunza / Shisper | Zenodo 4039797 (PlanetScope-derived topography). | Not opened. Zenodo would have the same CORS and titiler problems anyway. |
| Langtang 2015 | Lacroix 2016 (SPOT6/7), Nagai 2016, Fujita 2017. | No public DEM files found. |
| Ridgecrest, Baluchistan | Both on OpenTopography. | Licence "Not provided". Baluchistan sources are strip GeoTIFFs over a huge extent. |
| Kaikōura 2016, Cyclone Gabrielle 2023 (LINZ) | Pre and post 1 m DEMs exist as CORS-open LERC COGs. | Published only as per-tile files indexed by STAC: no single file or VRT. A VRT listing the tiles, hosted somewhere CORS-open, would make them library-ready. Not built here. |

## Could not verify

- **Whether the app renders these sources.** Nothing was loaded in Terrain Viewer itself: the agent browser cannot run MapLibre. "Titiler ok" means titiler.xyz returned a 200 terrainrgb PNG for one tile at the stated zoom. Lower zooms on files without overviews, and other areas, were not swept.
- **The in-browser `vrt://` path** for the Kilauea July 2018 and Ridgecrest VRTs. The preconditions hold (CORS echo, ranges, tiled TIFF sources), but the reader itself was not run. HI18 sources are Float64; geotiff.js should read them, but that is untested.
- **Why titiler.xyz fails on the Zenodo Chamoli files.** Zenodo answers this machine with a GDAL-like UA, and local gdalinfo opens the file, but titiler.xyz returns 500 at every zoom tried and on `/cog/info`.
- **Licences "Not provided"** on OpenTopography for Kilauea July 2018, Ridgecrest pre/post and Baluchistan. The Tajogaite cone series (OTDS.022026.*) licence page was not opened; CC BY 4.0 was confirmed on the 2021 and 2022 Cumbre Vieja records by the same INGV group.
- **Vertical datums and offsets** between pre and post surfaces. They were compared only where the authors state co-registration (Xinmo, Eaton/Palisades, the EIDC DoD).
- **Mapterhorn's source and vintage** over Hawaii and La Palma, which decides whether a "post − Mapterhorn" difference is a real before/after. Not checked: decoding its WebP tiles was out of scope.
- **The Melamchi DSMs' vertical datum and co-registration** between P05 and P06.
- **Search coverage.** Not checked: the Google Earth Engine community catalog, Source Cooperative (beyond a web search), the WA DNR lidar portal, the IGN Spain / GRAFCAN post-eruption lidar for La Palma, the Shisper Zenodo record, and the ULAKBIM Türkiye record.
