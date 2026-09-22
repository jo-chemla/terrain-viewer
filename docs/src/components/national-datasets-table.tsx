import fs from "node:fs";
import path from "node:path";
import WORLD from "./world-110m.json";

type Country = { iso: string; name: string; rings: number[][] };

// lib/custom-sources.json at the repo root is the single source of truth for the
// sample library the app ships — same "read the real file at build time" trick
// changelog-list.tsx uses for CHANGELOG.md, so this table cannot drift from what
// actually appears in Sources → Terrain → Load Sample Sources.
type Source = {
  id: string;
  name: string;
  url: string;
  type: string;
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
  loadWithSamples?: boolean;
  cogViaTitiler?: boolean;
  resolutionM?: number;
  bulkResolutionM?: number;
  infoUrl?: string;
  description?: string;
};

// ISO 3166-1 alpha-3 -> English short name, for the codes actually in use.
const COUNTRY: Record<string, string> = {
  AFR: "Africa (continental)", AUS: "Australia", CAN: "Canada", DEU: "Germany", SAM: "South America", AUT: "Austria", BEL: "Belgium", IDN: "Indonesia", CZE: "Czechia", ESP: "Spain", FIN: "Finland", FRA: "France",
  EST: "Estonia", FRO: "Faroe Islands", GBR: "United Kingdom", GRC: "Greece", HTI: "Haiti", ITA: "Italy", JPN: "Japan", MEX: "Mexico",
  NLD: "Netherlands", NOR: "Norway", SYR: "Syria", URY: "Uruguay", USA: "United States",
};

// Native ground resolution and real-world coverage. Kept here rather than in
// custom-sources.json because neither is something the app itself consumes —
// they are documentation, and the app config should stay free of prose.
const FACTS: Record<string, { res: string; coverage: string }> = {
  "custom-at-tirol-dgm5": { res: "5 m", coverage: "Tirol only — no Austria-wide open service exists" },
  "custom-cz-cuzk-dmr5g": { res: "2 m", coverage: "Nationwide" },
  "custom-cz-cuzk-dmp05": { res: "0.5 m", coverage: "Nationwide (surface model)" },
  "custom-ch-swissaltiregio": { res: "10 m", coverage: "Nationwide, one single COG file" },
  "custom-1762932753467": { res: "~5 m", coverage: "Mainland + Balearics (not the Canaries)" },
  "custom-fi-nls-dem10": { res: "10 m", coverage: "Nationwide" },
  "custom-ign-lidarhd-dsm-wms-raw": { res: "0.5 m", coverage: "Mainland France + Corsica" },
  "custom-ign-lidarhd-dtm-wms-raw": { res: "0.5 m", coverage: "Mainland France + Corsica" },
  "custom-uk-ea-lidar-dtm1": { res: "1 m", coverage: "England only, ~75% covered" },
  "custom-it-tinitaly": { res: "10 m", coverage: "Nationwide" },
  "custom-idn-big-demnas": { res: "~8 m", coverage: "Nationwide" },
  "custom-au-qld-dem": { res: "0.5–1 m", coverage: "Queensland only" },
  "custom-be-vlaanderen-dtm1": { res: "1 m", coverage: "Flanders only (not Wallonia/Brussels)" },
  "custom-mx-inegi-cem": { res: "~15 m", coverage: "Nationwide (clips above ~5553 m)" },
  "custom-nl-ahn-dtm": { res: "0.5 m", coverage: "Nationwide" },
  "custom-nl-ahn-dsm": { res: "0.5 m", coverage: "Nationwide" },
  "custom-no-kartverket-dtm1": { res: "0.25 m", coverage: "Nationwide (excl. Svalbard)" },
  "custom-no-kartverket-dom1": { res: "0.25 m", coverage: "Nationwide (excl. Svalbard)" },
  "custom-africa-deafrica-cop30": { res: "30 m", coverage: "All of Africa + Arabia from one endpoint" },
  "custom-nz-linz-dem1": { res: "1 m", coverage: "Regional 1 m LiDAR over an 8 m national base" },
  "custom-ca-ontario-dtm05": { res: "0.5 m", coverage: "Ontario, surveyed LiDAR blocks only" },
  "custom-au-nsw-dem5": { res: "5 m", coverage: "New South Wales only" },
  "custom-de-nrw-dgm1": { res: "1 m", coverage: "North Rhine-Westphalia only" },
  "custom-mx-aguadafenix-lidar": { res: "0.5 m", coverage: "Middle Usumacinta survey area (archaeology)" },
  "custom-us-3dep": { res: "1–10 m", coverage: "Nationwide incl. AK, HI, PR" },
  "custom-us-3dep-wms": { res: "1–10 m", coverage: "Nationwide incl. AK, HI, PR — same mosaic over the WMS front end" },
  "custom-ee-maaamet-dtm1": { res: "1 m", coverage: "Nationwide" },
  "custom-fo-us-dsm25": { res: "25 m", coverage: "All islands (satellite DSM, coarse)" },
  "custom-ca-nrcan-mrdem30": { res: "30 m", coverage: "Nationwide, one single COG (via titiler)" },
  "custom-fr-ign-rgealti-highres": { res: "1–5 m", coverage: "Mainland + Réunion, Guadeloupe, Martinique, Guyane, Mayotte, St-Pierre-et-Miquelon" },
  "custom-fr-ign-lidarhd-reunion": { res: "0.5 m", coverage: "Réunion only" },
  "custom-fr-ign-lidarhd-minus-rgealti": { res: "1 m", coverage: "Mainland + Corsica — ground change between the two IGN DTM generations" },
  "custom-hk-landsd-dtm5": { res: "5 m", coverage: "Hong Kong SAR (LERC tiles, includes elevated roads)" },
  "custom-us-hi-dtm1-lerc": { res: "1 m", coverage: "Hawaii, LiDAR-covered parts of all islands (LERC tile cache)" },
  "custom-us-hi-maui-dtm03-lerc": { res: "0.3 m", coverage: "Maui and Molokai, 2019 (LERC tile cache)" },
  "custom-us-hi-dsm1": { res: "1 m", coverage: "Hawaii surface model, same footprint as the DTM" },
  "custom-us-hi-ndsm": { res: "1 m", coverage: "Hawaii — DSM minus DTM" },
  "custom-ca-nb-dtm1": { res: "1 m", coverage: "New Brunswick, province-wide" },
  "custom-ca-nb-dsm1": { res: "1 m", coverage: "New Brunswick surface model, province-wide" },
  "custom-ca-nb-ndsm": { res: "1 m", coverage: "New Brunswick — DSM minus DEM" },
  "custom-us-ak-ifsar-dtm5": { res: "5 m", coverage: "Alaska statewide IfSAR terrain" },
  "custom-us-ak-ifsar-dsm5": { res: "5 m", coverage: "Alaska statewide IfSAR surface" },
  "custom-us-ak-ifsar-ndsm": { res: "5 m", coverage: "Alaska — IfSAR DSM minus DTM" },
  "custom-au-sa-murray-dtm05": { res: "0.5 m", coverage: "River Murray corridor, SA border to Murray Mouth (licence unclear on the service)" },
  "custom-mx-aguadafenix-dsm": { res: "0.5 m", coverage: "Middle Usumacinta survey area, canopy surface" },
  "custom-mx-aguadafenix-ndsm": { res: "0.5 m", coverage: "Middle Usumacinta — canopy height" },
  "custom-tz-msimbazi-dtm05": { res: "0.5 m", coverage: "Lower Msimbazi valley, Dar es Salaam (~3.6 × 3.6 km)" },
  "custom-tz-msimbazi-uav-dsm05": { res: "0.5 m", coverage: "Same footprint, drone surface model" },
  "custom-tz-msimbazi-ndsm": { res: "0.5 m", coverage: "Msimbazi — UAV DSM minus LiDAR DTM" },
  "custom-jp-gsj-terrainrgb": { res: "5–10 m", coverage: "Nationwide (5 m where DEM5 exists, 10 m elsewhere)" },
  "custom-uy-ideuy-mdt30": { res: "30 m", coverage: "Nationwide (7–11 s per tile)" },
  "custom-ht-cnigs-dtm15": { res: "1.5 m", coverage: "Nationwide, but renders only from z12 (VRT without overviews)" },
  "custom-gedtm30": { res: "30 m", coverage: "Global 65 S–85 N, bare earth (via titiler, z6+)" },
  "custom-pgc-arcticdem": { res: "2 m", coverage: "All land north of 60 N, ellipsoidal heights" },
  "custom-pgc-rema": { res: "2 m", coverage: "Antarctica to 85 S, ellipsoidal heights" },
  "custom-emodnet-bathymetry": { res: "~115 m", coverage: "All European seas (bathymetry)" },
  "custom-openwaters-seascape": { res: "varies", coverage: "Global bathymetry compilation" },
  "custom-reearth-terrarium": { res: "~30 m", coverage: "Global, ellipsoidal heights" },
  "custom-sam-anadem": { res: "30 m", coverage: "All South America, bare-earth under canopy (via titiler)" },
  // Served through titiler / the browser COG reader rather than a live agency API.
  "custom-1762932753466": { res: "1 m", coverage: "Andalucía region only (286 GB COG)" },
  "custom-1763115512226": { res: "1 m", coverage: "Mainland France (RGE ALTI, community repack)" },
  "custom-1763118373252": { res: "1 m", coverage: "Mainland France (same data, via titiler)" },
};

// How each source is fetched, in the terms the rest of the docs use.
const SERVING: Record<string, string> = {
  "wms-raw": "WMS/WCS raw Float32",
  terrainrgb: "XYZ tiles (Terrain-RGB)",
  terrarium: "XYZ tiles (Terrarium)",
  cog: "COG",
  vrt: "VRT",
  tilejson: "TileJSON",
};

// Best native resolution Mapterhorn ingests per country, kept in
// lib/custom-sources.json (MAPTERHORN_BEST_RESOLUTION_M) so the app's sample
// picker and this page grade sources against the same numbers. Absent = the
// country has no entry, so Mapterhorn falls back to global GLO-30 (~30 m).
const MAPTERHORN_RES: Record<string, number | null> = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "..", "lib", "custom-sources.json"), "utf8"),
).MAPTERHORN_BEST_RESOLUTION_M;
const GLO30 = 30; // Mapterhorn's global fallback

// "0.5 m" / "~15 m" / "1–10 m" -> the finest number present.
const parseRes = (r: string | undefined) => {
  const m = r?.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
};

const ISO_RE = /^([A-Z]{3}) - /;

// Heritage/site surveys, not national elevation products — excluded from the
// national tables entirely.
const PROJECT_SCANS = new Set(["dura-w-05mm", "dura-grid-2mm", "custom-1763032004272"]);

// Sub-national or otherwise partial coverage. Shown in their own section rather
// than mixed in with national datasets, and kept out of Load Sample Sources.
const SUB_NATIONAL = new Set([
  "custom-au-nsw-dem5", "custom-au-qld-dem", "custom-ca-ontario-dtm05",
  "custom-de-nrw-dgm1", "custom-mx-aguadafenix-lidar", "custom-at-tirol-dgm5",
  "custom-be-vlaanderen-dtm1", "custom-1762932753466", "custom-fr-ign-lidarhd-reunion",
]);

// Regional services that were verified but are NOT shipped as sample sources —
// the app's library stays national, and these are documented so nobody has to
// re-discover them. Every row is a live-decoded window, same bar as the rest.
const REGIONAL_DOCS_ONLY: { iso: string; region: string; product: string; res: string; served: string; host: string; url: string; note: string }[] = [
  { iso: "AUT", region: "Steiermark", product: "GIS Steiermark ALS DGM 1 m (+ DOM)", res: "1 m", served: "WCS 1.0 (ArcGIS), F32",
    host: "gis.stmk.gv.at", url: "https://gis.stmk.gv.at/arcgis/services/OGD/ALSGelaendeinformation_1m_UTM33N/MapServer/WCSServer?SERVICE=WCS&REQUEST=GetCapabilities",
    note: "COVERAGE=4 is the full model (1 and 2 are hillshades). Dachstein 2994.6 m (true 2995). DSM on ALSHoeheninformation_1m_UTM33N. CC BY 4.0 AT." },
  { iso: "DEU", region: "Baden-Württemberg", product: "LGL DGM1 (INSPIRE WCS)", res: "1 m", served: "WCS 1.0, F32",
    host: "owsproxy.lgl-bw.de", url: "https://owsproxy.lgl-bw.de/owsproxy/wcs/WCS_INSP_BW_Hoehe_Coverage_DGM1?SERVICE=WCS&REQUEST=GetCapabilities",
    note: "COVERAGE=EL.ElevationGridCoverage, FORMAT=GeoTIFF. Feldberg 1494.3 m (true 1493). GDAL nodata tag wrongly says 0. dl-de/by-2.0." },
  { iso: "DEU", region: "Brandenburg + Berlin", product: "LGB DGM1", res: "1 m", served: "WCS 1.0, F32",
    host: "isk.geobasis-bb.de", url: "https://isk.geobasis-bb.de/ows/dgm_wcs?SERVICE=WCS&REQUEST=GetCapabilities",
    note: "COVERAGE=bb_dgm, FORMAT=image/tiff (GeoTIFF errors). Teufelsberg 120.07 m (true 120.1). Nodata −9999. dl-de/by-2.0." },
  { iso: "DEU", region: "Mecklenburg-Vorpommern", product: "LAiV DGM1 (+ DOM1)", res: "1 m", served: "WCS 1.0, F32",
    host: "www.geodaten-mv.de", url: "https://www.geodaten-mv.de/dienste/dgm_wcs?SERVICE=WCS&REQUEST=GetCapabilities",
    note: "COVERAGE=mv_dgm; DSM mv_dom1 on /dienste/dom_wcs. Königsstuhl 123.8 m. No conditions of use, attribution required." },
  { iso: "DEU", region: "Niedersachsen", product: "LGLN DGM1 (+ DOM1)", res: "1 m", served: "WCS 1.0, F32",
    host: "opendata.geoservices.lgln.niedersachsen.de", url: "https://opendata.geoservices.lgln.niedersachsen.de/dgm_wcs?SERVICE=WCS&REQUEST=GetCapabilities",
    note: "COVERAGE=ni_dgm1; DSM ni_dom1 on /dom_wcs. Wurmberg 972.07 m (true 971). Outside the Land returns bare 0. CC BY 4.0." },
  { iso: "DEU", region: "Sachsen-Anhalt", product: "LVermGeo DGM1 (INSPIRE WCS)", res: "1 m", served: "WCS 1.0, F32",
    host: "geodatenportal.sachsen-anhalt.de", url: "https://geodatenportal.sachsen-anhalt.de/ows_INSPIRE_LVermGeo_ATKIS_EL_DGM_WCS?SERVICE=WCS&REQUEST=GetCapabilities",
    note: "COVERAGE=1 (literally). Brocken 1141.16 m (true 1141.2). dl-de/by-2.0." },
  { iso: "ITA", region: "Emilia-Romagna", product: "RER DTM 5×5 LiDAR mosaic", res: "5 m", served: "WCS 1.0, F32",
    host: "servizigis.regione.emilia-romagna.it", url: "https://servizigis.regione.emilia-romagna.it/wcs/dtm5x5?SERVICE=WCS&REQUEST=GetCapabilities",
    note: "COVERAGE=DTM5X5_RDN32_RMD. Monte Cimone 2162.5 m (true 2165). The 0.5 m WCS returns degenerate TIFFs. CC BY 4.0." },
  { iso: "ITA", region: "Sardegna", product: "RAS DTM 10 m island-wide (+ 1 m partial)", res: "10 m / 1 m", served: "WCS 1.0, F32",
    host: "webgis.regione.sardegna.it", url: "https://webgis.regione.sardegna.it/geoserverraster/ows?SERVICE=WCS&REQUEST=GetCapabilities",
    note: "COVERAGE=raster:DTM_10M_ALTIMETRIA_REV01 covers the whole island (La Marmora 1827.9 m); the 1 m mosaic only covers surveyed corridors." },
  { iso: "ITA", region: "Toscana", product: "GEOscopio DTM 1 m LiDAR (partial) / 10 m / DSM 2021", res: "1 m / 10 m", served: "WMS GetMap, F32",
    host: "www502.regione.toscana.it", url: "https://www502.regione.toscana.it/wmsraster/com.rt.wms.RTmap/wms?map=wmsmorfologia&SERVICE=WMS&REQUEST=GetCapabilities",
    note: "One of the rare WMS servers whose image/tiff is real Float32. LAYERS=rt_morfologia.iddtm.1m.irs (1 m, partial), .iddtm.10m.rt (full), .iddsm2021.1m.rt. Monte Amiata 1730.7 m." },
  { iso: "ARG", region: "Córdoba", product: "IDECOR MDE 5 m (dem_5m_cba_ext)", res: "5 m", served: "WCS 1.0, Int16",
    host: "idecor-ws.mapascordoba.gob.ar", url: "https://idecor-ws.mapascordoba.gob.ar/geoserver/ows?service=WCS&version=1.0.0&request=GetCapabilities",
    note: "Cerro Champaquí 2787 m (true 2790). Nodata 32767. Also MDE-Ar 30 m and MERIT 90 m clips of the province." },
  { iso: "AUS", region: "Murray–Darling Basin", product: "MDBA 1 m LiDAR DTMs + srtm_1sec_demh_v1", res: "1 m / 30 m", served: "ArcGIS ImageServer, F32",
    host: "gis.mdba.gov.au", url: "https://gis.mdba.gov.au/arcgis/rest/services/ELEVATION?f=pjson",
    note: "25 ImageServers; Kosciuszko 2223 m via the SRTM DEM-H one. Needs noData=-9999&noDataInterpretation=esriNoDataMatchAny." },
  { iso: "CAN", region: "New Brunswick", product: "GeoNB LiDAR DEM 1 m (DEM_Raw_MNE_Brut)", res: "1 m", served: "ArcGIS ImageServer, F32",
    host: "geonb.snb.ca", url: "https://geonb.snb.ca/image/rest/services/Elevation/DEM_Raw_MNE_Brut/ImageServer",
    note: "Mount Carleton 815 m (true 820). DSM twin DSM_Raw_MNT_Brut. Pass noData=-9999." },
  { iso: "FIN", region: "Helsinki", product: "City of Helsinki Korkeusmalli 2021 1 m", res: "1 m", served: "WCS 2.0, F32",
    host: "kartta.hel.fi", url: "https://kartta.hel.fi/ws/geoserver/avoindata/wcs?service=WCS&request=GetCapabilities",
    note: "Needs the __wcs2subset=X,Y,ij rewrite (bare i()/j() scaleSize). Nodata -32767. CC BY 4.0." },
  { iso: "NLD", region: "Zeeland waters", product: "Rijkswaterstaat bodemhoogte_zeeland bathymetry", res: "~20 m", served: "WCS 2.0, F32",
    host: "geo.rijkswaterstaat.nl", url: "https://geo.rijkswaterstaat.nl/services/ogc/gdr/bodemhoogte_zeeland/ows?service=WCS&request=GetCapabilities",
    note: "Bed level in NAP metres, Westerschelde channel −27 m. Same ij scaleSize rewrite as Helsinki. CC0." },
  { iso: "USA", region: "Kentucky", product: "KyFromAbove 2 ft DTM (Phase 2, Z metres)", res: "0.6 m", served: "ArcGIS ImageServer, F32",
    host: "kyraster.ky.gov", url: "https://kyraster.ky.gov/arcgis/rest/services/ElevationServices/Ky_DEM_KYAPED_2FT_Phase2_ZMeters_WGS84WM/ImageServer",
    note: "Statewide, finer than 3DEP. Lexington airport 297 m (true 298)." },
  { iso: "USA", region: "Vermont", product: "VCGI LiDAR DEM / DSM 0.35 m", res: "0.35 m", served: "ArcGIS ImageServer, F32",
    host: "maps.vcgi.vermont.gov", url: "https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_LIDARDEM_SP_NOCACHE_v1/ImageServer",
    note: "Finest statewide grid found in the US; first-return DSM twin IMG_VCGI_LIDARDSM_SP_NOCACHE_V1." },
  { iso: "USA", region: "Oregon", product: "DOGAMI DTM / DSM mosaics (Z feet)", res: "0.9 m", served: "ArcGIS ImageServer, F32",
    host: "gis.dogami.oregon.gov", url: "https://gis.dogami.oregon.gov/arcgis/rest/services/lidar/DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer",
    note: "LiDAR footprint only, not the whole state. Values in feet." },
  { iso: "USA", region: "Iowa", product: "ISU lidar_2020_dem / lidar_2020_dsm 1 m", res: "1 m", served: "ArcGIS ImageServer, F32",
    host: "ortho.gis.iastate.edu", url: "https://ortho.gis.iastate.edu/arcgis/rest/services/ortho/lidar_2020_dem/ImageServer",
    note: "Statewide DTM and a draft DSM." },
  { iso: "USA", region: "Connecticut", product: "CT ECO 2023 lidar DEM 2 ft (Z feet) + DSM", res: "0.6 m", served: "ArcGIS ImageServer, F32",
    host: "cteco.uconn.edu", url: "https://cteco.uconn.edu/ctraster/rest/services/elevation/Elevation/ImageServer",
    note: "DSM at MaxSurfaceHeight_2023. Values in feet." },
  { iso: "USA", region: "Illinois", product: "ISGS statewide lidar DEM (Z feet)", res: "0.3 m", served: "ArcGIS ImageServer, F32",
    host: "data.isgs.illinois.edu", url: "https://data.isgs.illinois.edu/arcgis/rest/services/Elevation/IL_Statewide_Lidar_DEM_WGS/ImageServer",
    note: "Per-county DSM services on the same server. Values in feet." },
  { iso: "USA", region: "New York", product: "NYS ITS Latest_DEM 1 m mosaic", res: "1 m", served: "ArcGIS ImageServer, F32",
    host: "elevation.its.ny.gov", url: "https://elevation.its.ny.gov/arcgis/rest/services/Latest_DEM/ImageServer",
    note: "Newest / highest-resolution-on-top statewide mosaic." },
  { iso: "USA", region: "North Carolina", product: "NC OneMap DEM03 QL2 (Z feet)", res: "0.95 m", served: "ArcGIS ImageServer, F32",
    host: "services.nconemap.gov", url: "https://services.nconemap.gov/secure/rest/services/Elevation/DEM03/ImageServer",
    note: "Declared nodata −9999. Values in feet." },
  { iso: "USA", region: "Wisconsin, Ohio, Louisiana, Massachusetts, New Jersey, Alaska", product: "State DEM ImageServers", res: "0.3–5 m", served: "ArcGIS ImageServer",
    host: "dnrmaps.wi.gov …", url: "https://dnrmaps.wi.gov/arcgis_image/rest/services/DW_Elevation/EN_DEM_from_LiDAR/ImageServer",
    note: "All verified F32 with CORS: WI EN_DEM_from_LiDAR, OH OH_DEM_test (feet), LA 2017_2024_Louisiana_1M_DTM (feet), MA ELEVATION_LIDAR_INT_2013to2021 (Int16), NJ NJ_10ft_DEM (3 m), AK IFSAR_DTM (5 m). None finer than 3DEP." },
];

type Row = { s: Source; iso: string; ours: number | null; mh: number | null | undefined };

function loadRows(): Row[] {
  const raw = fs.readFileSync(path.join(process.cwd(), "..", "lib", "custom-sources.json"), "utf8");
  const sources: Source[] = JSON.parse(raw).SAMPLE_TERRAIN_SOURCES;
  return sources
    .map((s) => ({ s, iso: ISO_RE.exec(s.name)?.[1] }))
    // NOT filtered on loadWithSamples: several entries are deliberately kept out
    // of "Load Sample Sources" (sub-national, or project scans) while still being
    // documented and still importable by permalink. Only the site-specific scans
    // are dropped, since they are not national elevation products at all.
    .filter((r): r is { s: Source; iso: string } =>
      Boolean(r.iso) && r.iso !== "AFR" && !PROJECT_SCANS.has(r.s.id))
    .map(({ s, iso }) => ({ s, iso, ours: s.resolutionM ?? parseRes(FACTS[s.id]?.res), mh: MAPTERHORN_RES[iso] }))
    .sort((a, b) => a.iso.localeCompare(b.iso) || a.s.name.localeCompare(b.s.name));
}

/** Which bucket a source falls into versus Mapterhorn's best ingested resolution. */
function bucketOf(r: Row): "new" | "finer" | "same" | "coarser" {
  if (r.mh === null || r.mh === undefined) return "new";
  if (r.ours === null) return "same";
  return r.ours < r.mh ? "finer" : r.ours > r.mh ? "coarser" : "same";
}

const GROUPS = [
  { key: "new", icon: "⬆️", title: "Not in Mapterhorn",
    blurb: "Countries Mapterhorn has no national source for, so it falls back to global Copernicus GLO-30 (~30 m). These add coverage that does not otherwise exist." },
  { key: "finer", icon: "⬆️", title: "In Mapterhorn, but finer here",
    blurb: "The agency's live API serves a finer grid than the bulk data Mapterhorn ingested." },
  { key: "same", icon: "↔️", title: "In Mapterhorn at the same resolution",
    blurb: "No resolution gain. Worth using only when you want data straight from the agency rather than a re-published tileset." },
  { key: "coarser", icon: "⬇️", title: "In Mapterhorn at finer resolution",
    blurb: "Mapterhorn ingested higher-resolution bulk data than the agency exposes over its API — for these, Mapterhorn is the better choice." },
] as const;

const SERVING_LABEL = (t: string) => SERVING[t] ?? t;
const hostOf = (u: string) =>
  u.replace(/^[a-z]+:\/\/\/vsicurl\//i, "").replace(/^WMS:/i, "").replace(/^https?:\/\//, "").split(/[/?]/)[0];
const endpointOf = (u: string) => {
  const bare = u.replace(/^[a-z]+:\/\/\/vsicurl\//i, "").replace(/^WMS:/i, "");
  return bare.startsWith("http") ? bare : `https://${bare}`;
};

/** Headline comparison, shown before the detail tables. */
export function MapterhornSummary() {
  const rows = loadRows();
  const by = (k: string) => rows.filter((r) => bucketOf(r) === k && !SUB_NATIONAL.has(r.s.id));
  // No "vs" when the two agree — "FRA 0.5 m" says it without the noise.
  const label = (r: Row) => {
    const mine = `${r.iso} ${r.ours ?? "?"} m`;
    if (r.mh === null || r.mh === undefined) return `${mine} vs 30 m global`;
    return r.ours === r.mh ? mine : `${mine} vs ${r.mh} m`;
  };
  const LINES = [
    { icon: "⬆️", verdict: "Not in Mapterhorn", rows: by("new") },
    { icon: "⬆️", verdict: "Finer here", rows: by("finer") },
    { icon: "↔️", verdict: "Same as Mapterhorn", rows: by("same") },
    { icon: "⬇️", verdict: "Finer in Mapterhorn", rows: by("coarser") },
  ];
  return (
    <table className="text-sm">
      <thead>
        <tr><th>vs Mapterhorn</th><th>Count</th><th>Sources</th></tr>
      </thead>
      <tbody>
        {LINES.map((l) => (
          <tr key={l.verdict}>
            <td><strong>{l.icon} {l.verdict}</strong></td>
            <td>{l.rows.length}</td>
            <td>{l.rows.length ? [...new Set(l.rows.map(label))].join(" · ") : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NationalDatasetsTable() {
  const rows = loadRows();
  return (
    <>
      {GROUPS.map((g) => {
        const group = rows.filter((r) => bucketOf(r) === g.key && !SUB_NATIONAL.has(r.s.id));
        if (!group.length) return null;
        return (
          <div key={g.key} className="overflow-x-auto">
            <h3>{g.icon} {g.title}</h3>
            <p className="text-sm text-fd-muted-foreground">{g.blurb}</p>
            <table className="text-sm">
              <thead>
                <tr>
                  <th>ISO A3</th><th>Country</th><th>Dataset</th><th>Served as</th>
                  <th>Endpoint</th><th>API resolution</th><th>Bulk download</th><th>Coverage</th><th>Mapterhorn</th>
                </tr>
              </thead>
              <tbody>
                {group.map(({ s, iso, mh }) => {
                  const facts = FACTS[s.id];
                  return (
                    <tr key={s.id}>
                      <td><code>{iso}</code></td>
                      <td>{COUNTRY[iso] ?? iso}</td>
                      <td>{s.infoUrl ? <a href={s.infoUrl} target="_blank" rel="noopener noreferrer">{s.name.replace(ISO_RE, "")}</a> : s.name.replace(ISO_RE, "")}</td>
                      <td>{SERVING_LABEL(s.type)}</td>
                      <td>
                        <a href={endpointOf(s.url)} target="_blank" rel="noopener noreferrer">{hostOf(s.url)}</a>
                      </td>
                      <td>{facts?.res ?? "—"}</td>
                      <td>{s.bulkResolutionM !== undefined ? `${s.bulkResolutionM} m` : facts?.res ? "same" : "—"}</td>
                      <td>{facts?.coverage ?? "—"}</td>
                      <td>{mh === null || mh === undefined ? "not ingested" : `${mh} m`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-xs text-fd-muted-foreground">
        <em>API resolution</em> is the grid the live service streams (what the viewer renders and what the grading above uses);{" "}
        <em>Bulk download</em> is the finest grid the agency advertises for download, which is what Mapterhorn itself ingests.
        The sample picker in the app can regrade by either.
      </p>
      <p className="text-xs text-fd-muted-foreground">
        {rows.length} national datasets, generated at build time from{" "}
        <a href="https://github.com/Iconem/terrain-viewer/blob/main/lib/custom-sources.json" target="_blank" rel="noopener noreferrer">
          <code>lib/custom-sources.json</code>
        </a>
        .
      </p>
    </>
  );
}

/** Regional / sub-national datasets — real data, partial footprint. */
export function SubNationalTable() {
  const rows = loadRows().filter((r) => SUB_NATIONAL.has(r.s.id));
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr><th>ISO A3</th><th>Region</th><th>Dataset</th><th>Served as</th><th>Endpoint</th><th>Resolution</th><th>Coverage</th></tr>
        </thead>
        <tbody>
          {rows.map(({ s, iso }) => (
            <tr key={s.id}>
              <td><code>{iso}</code></td>
              <td>{COUNTRY[iso] ?? iso}</td>
              <td>{s.infoUrl ? <a href={s.infoUrl} target="_blank" rel="noopener noreferrer">{s.name.replace(ISO_RE, "")}</a> : s.name.replace(ISO_RE, "")}</td>
              <td>{SERVING_LABEL(s.type)}</td>
              <td><a href={endpointOf(s.url)} target="_blank" rel="noopener noreferrer">{hostOf(s.url)}</a></td>
              <td>{FACTS[s.id]?.res ?? "—"}</td>
              <td>{FACTS[s.id]?.coverage ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-fd-muted-foreground">
        {rows.length} regional datasets. Kept out of <em>Load Sample Sources</em> so the list stays
        national, but each remains importable with a <code>?terrainSourceA=&lt;id&gt;</code> link.
      </p>
    </div>
  );
}

/** "Global -" sources: worldwide, polar and continental products that are not a
 *  national agency's, generated from the same JSON so they cannot drift. */
export function GlobalDatasetsTable() {
  const raw = fs.readFileSync(path.join(process.cwd(), "..", "lib", "custom-sources.json"), "utf8");
  const sources: Source[] = JSON.parse(raw).SAMPLE_TERRAIN_SOURCES;
  const rows = sources.filter((s) => s.name.startsWith("Global - "));
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr><th>Dataset</th><th>Served as</th><th>Endpoint</th><th>Resolution</th><th>Coverage</th></tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>{s.infoUrl ? <a href={s.infoUrl} target="_blank" rel="noopener noreferrer">{s.name.replace(/^Global - /, "")}</a> : s.name.replace(/^Global - /, "")}</td>
              <td>{SERVING_LABEL(s.type)}</td>
              <td><a href={endpointOf(s.url)} target="_blank" rel="noopener noreferrer">{hostOf(s.url)}</a></td>
              <td>{FACTS[s.id]?.res ?? "—"}</td>
              <td>{FACTS[s.id]?.coverage ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Verified regional services documented here but not shipped in the library. */
export function RegionalDocsOnlyTable() {
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr><th>ISO A3</th><th>Region</th><th>Dataset</th><th>Resolution</th><th>Served as</th><th>Endpoint</th><th>Notes</th></tr>
        </thead>
        <tbody>
          {REGIONAL_DOCS_ONLY.map((r) => (
            <tr key={`${r.iso}-${r.region}`}>
              <td><code>{r.iso}</code></td>
              <td>{r.region}</td>
              <td>{r.product}</td>
              <td>{r.res}</td>
              <td>{r.served}</td>
              <td><a href={r.url} target="_blank" rel="noopener noreferrer">{r.host}</a></td>
              <td>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Supra-national Copernicus GLO-30 services, kept out of the national tables. */
export function Glo30Table() {
  const raw = fs.readFileSync(path.join(process.cwd(), "..", "lib", "custom-sources.json"), "utf8");
  const sources: Source[] = JSON.parse(raw).SAMPLE_TERRAIN_SOURCES;
  const dea = sources.find((s) => s.id === "custom-africa-deafrica-cop30");
  const ROWS = [
    { who: "Digital Earth Africa", scope: "Africa + Arabia", how: "WCS 2.1, raw Float32",
      status: dea ? "Shipped as a sample source" : "—",
      host: "ows.digitalearth.africa", url: "https://ows.digitalearth.africa/wcs?service=WCS&request=GetCapabilities" },
    { who: "Mapterhorn", scope: "Worldwide", how: "Terrarium PMTiles",
      status: "Built in as the default terrain source",
      host: "tiles.mapterhorn.com", url: "https://mapterhorn.com/" },
    { who: "OpenTopography", scope: "Worldwide", how: "Single global .vrt over COGs",
      status: "Not shipped — VRT header is 11.7 MB per read",
      host: "opentopography.s3.sdsc.edu", url: "https://opentopography.s3.sdsc.edu/raster/COP30/COP30_hh.vrt" },
    { who: "AWS Open Data", scope: "Worldwide", how: "Per-1° COGs",
      status: "Not usable — bucket sends no CORS header",
      host: "copernicus-dem-30m.s3.amazonaws.com", url: "https://registry.opendata.aws/copernicus-dem/" },
  ];
  return (
    <table className="text-sm">
      <thead><tr><th>Provider</th><th>Scope</th><th>Served as</th><th>Endpoint</th><th>Status here</th></tr></thead>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.who}>
            <td>{r.who}</td><td>{r.scope}</td><td>{r.how}</td>
            <td><a href={r.url} target="_blank" rel="noopener noreferrer">{r.host}</a></td>
            <td>{r.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Coverage choropleth. Country polygons are Natural Earth 110m admin-0, tagged
 * with ISO-3 and name and Douglas-Peucker simplified by docs/scripts/
 * build-world-110m.mjs, drawn in an Equal Earth projection. A country is
 * filled when a shipped national source covers it, lightly filled when only a
 * regional one does, and each polygon carries a native <title> tooltip with
 * its code and name. `region="europe"` renders the same drawing cropped to
 * Europe, where most of the sources are and the world view is too small to
 * read.
 */
export function NationalCoverageMap({ region = "world" }: { region?: "world" | "europe" }) {
  const rows = loadRows();
  const national = new Set(rows.filter((r) => !SUB_NATIONAL.has(r.s.id)).map((r) => r.iso));
  const partial = new Set([
    ...rows.filter((r) => SUB_NATIONAL.has(r.s.id)).map((r) => r.iso),
    ...REGIONAL_DOCS_ONLY.map((r) => r.iso),
  ].filter((iso) => !national.has(iso)));

  // Equal Earth (Savric/Patterson/Jenny 2018) - equal-area, so a country's
  // highlight is proportional to its real size instead of Mercator-inflated,
  // and it avoids the stretched poles of plate carree. Closed form, no library.
  const M = Math.sqrt(3) / 2;
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
  const eqEarth = (lng: number, lat: number): [number, number] => {
    const l = (lng * Math.PI) / 180, p = (lat * Math.PI) / 180;
    const t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
    return [
      (l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
      t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)),
    ];
  };
  const [XMAX] = eqEarth(180, 0);
  const [, YMAX] = eqEarth(0, 90);
  const W = 720, H = Math.round((W * YMAX) / XMAX);
  const project = (lng: number, lat: number): [number, number] => {
    const [x, y] = eqEarth(lng, lat);
    return [((x + XMAX) / (2 * XMAX)) * W, ((YMAX - y) / (2 * YMAX)) * H];
  };
  const ringPath = (ring: number[]) => {
    let d = "";
    for (let j = 0; j < ring.length; j += 2) {
      const [x, y] = project(ring[j] / 10, ring[j + 1] / 10);
      d += `${j ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d + "Z";
  };
  // Label anchor: vertex mean of the country's largest ring, which is inside
  // for every country we label (the mean of a concave ring can fall outside,
  // but none of these do at 110m).
  const centroid = (c: Country): [number, number] => {
    const ring = c.rings.reduce((a, b) => (b.length > a.length ? b : a));
    let sx = 0, sy = 0;
    for (let j = 0; j < ring.length; j += 2) { sx += ring[j]; sy += ring[j + 1]; }
    const n = ring.length / 2;
    return project(sx / n / 10, sy / n / 10);
  };
  // Width of the largest ring on screen, to skip labels that could not fit:
  // in the world view the Benelux/Alpine cluster would otherwise pile up
  // into one unreadable knot, which is what the Europe figure is for.
  const screenWidth = (c: Country, scale: number) => {
    const ring = c.rings.reduce((a, b) => (b.length > a.length ? b : a));
    let minX = Infinity, maxX = -Infinity;
    for (let j = 0; j < ring.length; j += 2) {
      const [x] = project(ring[j] / 10, ring[j + 1] / 10);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    return (maxX - minX) * scale;
  };

  // The viewBox is the crop; everything else is drawn in world coordinates and
  // scaled back so strokes and type stay the same size on screen.
  const world: [number, number, number, number] = [0, 0, W, H];
  const eu = (() => {
    const [x0, y0] = project(-12, 72);
    const [x1, y1] = project(35, 34);
    return [x0, y0, x1 - x0, y1 - y0] as [number, number, number, number];
  })();
  const vb = region === "europe" ? eu : world;
  const scale = W / vb[2];
  const labelled = (WORLD as Country[]).filter((c) => (national.has(c.iso) || partial.has(c.iso)) && screenWidth(c, scale) >= 12);

  return (
    <figure>
      <svg viewBox={vb.join(" ")} className="w-full rounded-lg border border-fd-border bg-fd-muted/20" role="img"
           aria-label={region === "europe"
             ? "Europe, Equal Earth projection, countries with an integrated national elevation endpoint filled"
             : "World map in Equal Earth projection, countries with an integrated national elevation endpoint filled"}>
        <g stroke="currentColor" strokeOpacity="0.35" strokeWidth={0.5 / scale} strokeLinejoin="round">
          {(WORLD as Country[]).map((c) => {
            const cls = national.has(c.iso) ? "fill-emerald-500/60" : partial.has(c.iso) ? "fill-emerald-500/20" : "fill-transparent";
            return (
              <g key={c.iso} className={cls}>
                {/* The tooltip <title> sits INSIDE every path, not once on the
                    group: browsers only reliably show a title that is a direct
                    child of the hovered element. One string child, because
                    React 19 renders a <title> with array children as empty. */}
                {c.rings.map((ring, i) => (
                  <path key={i} d={ringPath(ring)}>
                    <title>{`${c.iso} — ${c.name}${national.has(c.iso) ? "" : partial.has(c.iso) ? " (regional data only)" : ""}`}</title>
                  </path>
                ))}
              </g>
            );
          })}
        </g>
        <g fontSize={8.5 / scale} fontWeight="700" textAnchor="middle" className="fill-[#052e16] dark:fill-white pointer-events-none">
          {labelled.map((c) => {
            const [cx, cy] = centroid(c);
            return <text key={c.iso} x={cx} y={cy + 3 / scale}>{c.iso}</text>;
          })}
        </g>
      </svg>
      <figcaption className="text-xs text-fd-muted-foreground">
        {region === "europe"
          ? "Europe at 3×. "
          : `${national.size} countries with an integrated national endpoint (filled), ${partial.size} with regional data only (light). `}
        Hover a country for its code and name. Filling the whole country is a simplification — England&apos;s dataset
        covers ~75% of England, and Austria&apos;s shipped source is Tirol only. Continental Copernicus GLO-30 is excluded; see below.
      </figcaption>
    </figure>
  );
}

// Countries where a national elevation product demonstrably EXISTS but cannot be
// consumed here. Every row was probed and the failure reproduced — the reason is
// the specific observed behaviour, not a guess. Curated by hand because it is a
// record of negative results; nothing in the app config describes it.
const UNUSABLE: {
  iso: string; country: string; product: string; served: string; reason: string;
}[] = [
  { iso: "COL", country: "Colombia", product: "IGAC municipal MDT/MDS", served: "504 ArcGIS ImageServers",
    reason: "Live, CORS-clean, correct metadata — and the pixels are synthetic. Every Ov_i02_L0* overview is corrupt above 10 m/px, and below it the base rasters decode to an 8-value dither oscillating between the service's own minValues and maxValues. Confirmed by reading raw IEEE floats out of the uncompressed TIFF without GDAL. Worth reporting to IGAC." },
  { iso: "ECU", country: "Ecuador", product: "IGM mapabase:igmdtm", served: "Cascaded WMS",
    reason: "Real national DTM including Galápagos, and GetFeatureInfo returns genuine metres (5737.7 m near Chimborazo) — but the layer is cascaded and WMS-only, absent from WCS, and image/geotiff returns 8-bit RGB. One pixel per request, no raster endpoint. SIGTIERRAS' own 3 m LiDAR host resolves but every TCP connect times out." },
  { iso: "PHL", country: "Philippines", product: "DREAM/PhilLiDAR 1 m", served: "GeoServer",
    reason: "lipad-geoserver answers but 502s on every OWS path across repeated retries; the one endpoint that responds proxies a test instance publishing a single vector tile-index layer. No DTM coverage exists to serve." },
  { iso: "ARG", country: "Argentina", product: "IGN ign:mde", served: "WMS",
    reason: "Advertises image/geotiff and has CORS, but returns 3-band 8-bit RGB — a rendered colour ramp. WCS is explicitly disabled." },
  { iso: "BRA", country: "Brazil", product: "IBGE national MDE", served: "Download only",
    reason: "The WCS publishes 14 coverages, none elevation; of 10,646 WMS layers none is a national DEM raster. Distribution is per-state GeoTIFF download." },
  { iso: "CAN", country: "Canada (Quebec)", product: "Forêt ouverte LiDAR 1 m", served: "Per-sheet COGs",
    reason: "The WMS is rendered RGB and its WCS exposes zero coverages. The underlying 1 m COGs are keyless with CORS, but there are 2,630 separate sheets and no mosaic." },
  { iso: "SVN", country: "Slovenia", product: "ARSO Slovenija_DMR 1 m", served: "ArcGIS ImageServer",
    reason: "Now live and the data is flawless — 1 m Float32, Triglav decodes to 2863.2 m against 2864 m true — but CORS is allowlisted to ARSO's own domains, so a browser cannot read it. Would work behind a proxy." },
  { iso: "AND", country: "Andorra", product: "IDE Andorra relleu", served: "WCS 1.0",
    reason: "An undocumented WCS exists with 17 coverages, but no MDT among them — the relief layer returns 3-band 8-bit RGB shaded relief." },
  { iso: "ALB", country: "Albania", product: "ASIG DSM / DTM 2015", served: "WMS hillshade",
    reason: "Only Dsm_Hill_Group and Hillshade_2015_group are published; the WCS lists hundreds of coverages but none from the DSM/DTM workspaces." },
  { iso: "BIH", country: "Bosnia & Herzegovina", product: "FGU Digitalni model reljefa 5 m", served: "GeoServer",
    reason: "Every OWS path returns HTTP 401 — login required across all 125 workspaces." },
  { iso: "IRL", country: "Ireland", product: "GSI Open Topographic LiDAR", served: "ArcGIS ImageServer",
    reason: "All nine services are hillshade — bandCount 1, pixelType U8, '_HS_' in every name. The DEM 10 m is an INSPIRE view service derived from contours." },
  { iso: "ISL", country: "Iceland", product: "ÍslandsDEM 2 m / 10 m", served: "GeoServer WCS",
    reason: "The coverage named 'islandsdem_hillshade_10m' is Float32 — so it survives a dtype check — but its values run 0 to 254.6: a hillshade stored as float. The 14.9 GB full DEM is downloadable but sends no CORS." },
  { iso: "LIE", country: "Liechtenstein", product: "DHM25 / swissALTI3D", served: "MapServer WCS",
    reason: "WCS is enabled but the only elevation coverages are relief and hillshade; swissALTI3D coverage is distributed by a fee-based office." },
  { iso: "MDA", country: "Moldova", product: "geodata.gov.md", served: "GeoServer",
    reason: "WCS returns 'Service WCS is disabled'; the sibling portal's WCS contains only stock GeoServer demo coverages." },
  { iso: "MLT", country: "Malta", product: "MSDI EL.ElevationGridCoverage 1 m LiDAR", served: "GeoServer",
    reason: "The INSPIRE elevation layers exist but WCS is disabled, leaving only rendered WMS — and the host sits behind a Cloudflare interstitial that 403s non-browser clients." },
  { iso: "TUR", country: "Türkiye", product: "HGM grid elevation", served: "Paid service",
    reason: "Priced as a product with access by written request; no anonymous endpoint." },
  { iso: "AUS", country: "Australia", product: "Geoscience Australia 5 m DEM", served: "Download portal",
    reason: "No ImageServer exists; the WMS is a MapServer returning rendered RGB. Elvis is a clip-and-ship portal." },
  { iso: "CHE", country: "Switzerland", product: "swissALTI3D / swissSURFACE3D 0.5 m", served: "Per-tile COGs + WMS",
    reason: "Every swisstopo WMS elevation layer is 'reliefschattierung' — hillshade — and the 0.5 m products are only per-tile COGs indexed by STAC. The 10 m swissALTIRegio single COG above is the one live option." },
  { iso: "ITA", country: "Italy (Sardinia)", product: "Regione Sardegna DTM 1 m", served: "GeoServer WCS",
    reason: "Works and is genuine 1 m Float32, but the mosaic only covers surveyed blocks — mostly river corridors and the coast, roughly half the island — so on the map it reads as scattered ribbons of detail with nodata between them. TINITALY covers the island at 10 m." },
  { iso: "CHN", country: "China", product: "Tianditu elevation", served: "WMTS / WCS",
    reason: "Every endpoint requires a registered tk= key." },
  { iso: "DNK", country: "Denmark", product: "Dataforsyningen DHM", served: "WCS",
    reason: "GetCapabilities is open, but GetCoverage returns 403 'User not authorized' — token required at the data step." },
  { iso: "GRC", country: "Greece", product: "Hellenic Cadastre DEM 5 m", served: "Offline / licensed",
    reason: "Never published as INSPIRE Elevation — the national catalogue's 147 records contain zero elevation entries. geodata.gov.gr is unreachable." },
  { iso: "HRV", country: "Croatia", product: "DGU DMR", served: "WMS",
    reason: "Advertises image/geotiff but returns a 3-band RGB hillshade, and sends no CORS header." },
  { iso: "JPN", country: "Japan", product: "GSI 標高タイル (1 / 5 / 10 m)", served: "XYZ PNG tiles",
    reason: "GSI's own tiles use a signed-24-bit ×0.01 m packing no raster-dem encoding can express. The Geological Survey of Japan's Terrain-RGB conversion of the same tiles is what is shipped instead." },
  { iso: "DEU", country: "Germany (other Länder)", product: "Bayern, Hessen, Sachsen, Thüringen, Hamburg, S-H, RLP DGM1", served: "WCS / WMS",
    reason: "Bayern and Sachsen WCS need credentials (401/403); Hessen's WCS 2.0 only accepts its native EPSG:25832 axes; Thüringen serves an RGB hillshade; Hamburg, Schleswig-Holstein and Rheinland-Pfalz have no open WCS. Six Länder do work and are in the regional table." },
  { iso: "AUT", country: "Austria (other Länder)", product: "BEV, Wien, Kärnten, Salzburg, OÖ, Vorarlberg, NÖ", served: "—",
    reason: "BEV's INSPIRE WMS needs registration; the Länder publish hillshade MapServers, RGB WMS or downloads only. Tirol and Steiermark are the two live raw services." },
  { iso: "BEL", country: "Belgium (Wallonia)", product: "WALLONIE_MNT_2021_2022", served: "MapServer",
    reason: "MapServer only — export returns PNG and the WCSServer answers HTTP 400. Flanders is the live half." },
  { iso: "LUX", country: "Luxembourg", product: "ACT DTM 2024", served: "GeoServer WCS",
    reason: "The INSPIRE WCS lists zero coverages; the DTM is download-only." },
  { iso: "LTU", country: "Lithuania", product: "Elevation_V2", served: "AGOL ImageServer",
    reason: "TilesOnly with no exportImage, and the licence is non-commercial Esri-only." },
  { iso: "ESP", country: "Spain (Catalonia, Euskadi, Canarias)", product: "ICGC MDT 2 m / 5 m, Euskadi MDT, Grafcan MDT", served: "WCS / WPS",
    reason: "ICGC's WCS only emits ArcGrid; Euskadi lists no MDT coverage; Grafcan is WPS/WMS only. The national IDEE Terrain-RGB covers all three anyway." },
  { iso: "ITA", country: "Italy (other regions)", product: "Trentino, Veneto, Lombardia, Piemonte, FVG, PCN LiDAR 1 m", served: "—",
    reason: "WCS with zero coverages, disabled, unreachable, or download-only; the ministry's PCN 1 m LiDAR WCS returns HTTP 500." },
  { iso: "GBR", country: "United Kingdom (Scotland, Wales, N. Ireland)", product: "Scottish Remote Sensing Portal, DataMapWales, OpenDataNI LiDAR", served: "GeoServer / downloads",
    reason: "Scotland's WCS is switched off, Wales' WCS exposes only noise maps, Northern Ireland is file download only. England's EA service is the live one." },
  { iso: "AUS", country: "Australia", product: "Geoscience Australia DEM_LiDAR_5m / SRTM 1 s WCS", served: "MapServer WCS 1.0",
    reason: "Genuine Float32 with CORS, but requestResponseCRSs is EPSG:4326 only — a 3857 BBOX is refused with HTTP 400, and this app only templates Web Mercator windows." },
  { iso: "USA", country: "United States (Minnesota)", product: "MnGeo 0.5 m Gen-2 lidar DEM", served: "33 COGs + VRT",
    reason: "Float32 COGs with CORS and range support, but in EPSG:6344 and split across 33 files under one VRT — no single reprojectable file." },
  { iso: "CAN", country: "Canada (HRDEM)", product: "NRCan HRDEM mosaic 1–2 m", served: "WCS 1.1.1 / per-tile COGs",
    reason: "Only WCS 1.1.1 is served, which needs GRIDOFFSETS derived from the window; the COGs are per 100 km tile with no mosaic file. MRDEM 30 m is the single-file product and is shipped." },
  { iso: "IND", country: "India", product: "NRSC Bhuvan CartoDEM", served: "GeoServer",
    reason: "WCS is disabled and the WMS carries no raw elevation layer; CartoDEM is download-only via Bhoonidhi." },
  { iso: "HKG", country: "Hong Kong", product: "Lands Department 5 m DTM (2020 LiDAR)", served: "CSDI MapServer / AGOL tiles",
    reason: "The CSDI service is rendered WMS only; the AGOL ImageServer is TilesOnly LERC with no exportImage." },
  { iso: "KOR", country: "South Korea", product: "NGII / VWorld DEM", served: "WMS",
    reason: "Every endpoint requires a key registered to a domain." },
  { iso: "TWN", country: "Taiwan", product: "MOI 20 m DTM", served: "NLSC WMTS",
    reason: "Only hillshade, slope and aspect derivatives are served; the DTM itself is download-only on data.gov.tw." },
  { iso: "CRI", country: "Costa Rica", product: "SNIT IGN MDT", served: "GeoServer",
    reason: "WCS disabled; the WMS exposes only 1:5000 contour vectors." },
  { iso: "GTM", country: "Guatemala", product: "IDEG / PACUNAM LiDAR", served: "GeoServer WCS",
    reason: "The WCS answers with zero coverages; the Maya LiDAR surveys are not published as a service." },
  { iso: "ZAF", country: "South Africa", product: "NGI 5 m / SUDEM", served: "—",
    reason: "No NGI ImageServer or WCS exists; the documented SUDEM WCS host is unreachable and was a hillshade." },
  { iso: "AFR", country: "Africa (RCMRD)", product: "RCMRD country SRTM 30 m ImageServers", served: "ArcGIS ImageServer",
    reason: "Five countries (Uganda, Botswana, Burundi, Comoros, South Sudan) are keyless Float32 with CORS, the rest need a token — and all are the same SRTM/GLO-30 class data Mapterhorn already has, so nothing is gained." },
  { iso: "POL", country: "Poland", product: "GUGiK NMT 1 m", served: "WCS 2.0",
    reason: "Works and is free — the highest-resolution national DEM found anywhere — but sends no CORS headers at all, so a browser cannot read it." },
  { iso: "PRT", country: "Portugal", product: "DGT MDT 0.5 m / 2 m LiDAR", served: "STAC + OAuth2",
    reason: "Public STAC index, CC BY 4.0, genuine Float32 — but every asset redirects to Keycloak login, and there is no CORS. The MDT50m WMS 'image/geotiff' is 8-bit RGBA, and the INSPIRE 'ElevationGridCoverage' ATOM is a hypsometric colour ramp (non-monotonic: Torre 1993 m reads darker than Larouco 1527 m)." },
  { iso: "SVK", country: "Slovakia", product: "ÚGKK DMR 5", served: "MapServer only",
    reason: "52 MapServers and zero ImageServers; every DMR layer is rendered hypsometry." },
  { iso: "SWE", country: "Sweden", product: "Lantmäteriet Markhöjdmodell 1 m", served: "STAC + Basic auth",
    reason: "STAC index is keyless and CORS-enabled, but every raster asset 401s behind a free Geotorget account — while sibling /pub/ paths stay open, so the gating is deliberate." },
];

/** Companion to NationalDatasetsTable: what was surveyed and rejected, and why. */
export function UnusableDatasetsTable() {
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr>
            <th>ISO A3</th>
            <th>Country</th>
            <th>Product</th>
            <th>Served as</th>
            <th>Why it can&apos;t be used</th>
          </tr>
        </thead>
        <tbody>
          {UNUSABLE.map((u) => (
            <tr key={`${u.iso}-${u.product}`}>
              <td><code>{u.iso}</code></td>
              <td>{u.country}</td>
              <td>{u.product}</td>
              <td>{u.served}</td>
              <td>{u.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
