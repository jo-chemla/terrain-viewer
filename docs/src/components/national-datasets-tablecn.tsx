import fs from "node:fs";
import path from "node:path";
import DATASET_DOIS from "@/data/dataset-dois.json";
import { NationalDatasetsTablecnClient, type NationalRow } from "./national-datasets-tablecn-client";

// The national datasets as one tablecn data table (docs/content/docs/features/
// national-datasets-tablecn.mdx), the twin of national-datasets-table.tsx for
// comparison. This half runs on the server at build time: it reads
// lib/custom-sources.json with fs, as the original does, and hands plain rows
// to the client half (national-datasets-tablecn-client.tsx), where tablecn's
// useDataTable sorts, filters and paginates them in memory. Turbopack's root
// is docs/, so the client bundle cannot import ../lib itself.
//
// The original keeps its lookup tables (FACTS, COUNTRY, SUB_NATIONAL, ...)
// private to its module, and that module imports node:fs, so they are copied
// here rather than imported. Keep the two in step when one changes.

type Source = {
  id: string;
  name: string;
  url: string;
  type: string;
  bounds?: [number, number, number, number];
  resolutionM?: number;
  bulkResolutionM?: number;
  infoUrl?: string;
};

type DatasetId = { doi?: string | null; mirror_doi?: string | null; mirror_publisher?: string | null; citation?: string; program_page?: string | null };
const DOIS = DATASET_DOIS as Record<string, DatasetId>;

const COUNTRY: Record<string, string> = {
  AFR: "Africa (continental)", AUS: "Australia", CAN: "Canada", DEU: "Germany", SAM: "South America", AUT: "Austria", BEL: "Belgium", IDN: "Indonesia", CZE: "Czechia", ESP: "Spain", FIN: "Finland", FRA: "France",
  EST: "Estonia", FRO: "Faroe Islands", GBR: "United Kingdom", GRC: "Greece", HTI: "Haiti", ITA: "Italy", JPN: "Japan", MEX: "Mexico",
  NLD: "Netherlands", NOR: "Norway", SYR: "Syria", URY: "Uruguay", USA: "United States",
};

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
  "custom-global-aw3d30": { res: "30 m", coverage: "Global 82 N–82 S, JAXA optical-stereo DSM (via titiler)" },
  "custom-global-aw3d30-minus-mapterhorn": { res: "30 m", coverage: "Global — AW3D30 minus Mapterhorn" },
  "custom-us-ny-dem1": { res: "1 m", coverage: "New York State, newest LiDAR on top (metres, verified)" },
  "custom-lt-klaipeda-dtm05": { res: "0.5 m", coverage: "Klaipėda city only (LERC tiles; licence unclear)" },
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
  "custom-1762932753466": { res: "1 m", coverage: "Andalucía region only (286 GB COG)" },
  "custom-1763115512226": { res: "1 m", coverage: "Mainland France (RGE ALTI, community repack)" },
  "custom-1763118373252": { res: "1 m", coverage: "Mainland France (same data, via titiler)" },
};

const SERVING: Record<string, string> = {
  "wms-raw": "WMS/WCS raw Float32",
  terrainrgb: "XYZ tiles (Terrain-RGB)",
  terrarium: "XYZ tiles (Terrarium)",
  cog: "COG",
  vrt: "VRT",
  tilejson: "TileJSON",
};

const ISO_RE = /^([A-Z]{3}) - /;
const PROJECT_SCANS = new Set(["dura-w-05mm", "dura-grid-2mm", "custom-1763032004272"]);
const EVENT_PAIRS = /^custom-(nz-kaikoura|us-hi-kilauea-2018|is-fagradalsfjall|us-ak-columbia|in-chamoli|us-ridgecrest)-/;
const SUB_NATIONAL = new Set([
  "custom-au-nsw-dem5", "custom-au-qld-dem", "custom-ca-ontario-dtm05",
  "custom-de-nrw-dgm1", "custom-mx-aguadafenix-lidar", "custom-at-tirol-dgm5",
  "custom-be-vlaanderen-dtm1", "custom-1762932753466", "custom-fr-ign-lidarhd-reunion",
  "custom-us-hi-dtm1-lerc", "custom-us-hi-dsm1", "custom-us-hi-ndsm",
  "custom-us-hi-maui-dtm03-lerc", "custom-us-ak-ifsar-dtm5", "custom-us-ak-ifsar-dsm5",
  "custom-us-ak-ifsar-ndsm", "custom-us-ny-dem1", "custom-ca-nb-dtm1",
  "custom-ca-nb-dsm1", "custom-ca-nb-ndsm", "custom-au-sa-murray-dtm05",
  "custom-mx-aguadafenix-dsm", "custom-mx-aguadafenix-ndsm",
]);

const parseRes = (r: string | undefined) => {
  const m = r?.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
};

function extentKm(bounds?: number[]): number | null {
  if (!bounds || bounds.length !== 4) return null;
  const [w, s, e, n] = bounds;
  const midLat = (((s + n) / 2) * Math.PI) / 180;
  return Math.max(Math.abs(e - w) * 111.32 * Math.cos(midLat), Math.abs(n - s) * 110.57);
}
const isSubNational = (s: Source) => {
  const km = extentKm(s.bounds);
  return SUB_NATIONAL.has(s.id) || (km !== null && km < 30);
};
const isSurfaceModel = (s: Source) => /\(surface\)|\bn?DSM\b|\bDOM\b/.test(s.name) && !/bare-earth DTM/.test(s.name);

function bucketOf(ours: number | null, mh: number | null | undefined): NationalRow["bucket"] {
  if (mh === null || mh === undefined) return "new";
  if (ours === null) return "same";
  return ours < mh ? "finer" : ours > mh ? "coarser" : "same";
}

const hostOf = (u: string) =>
  u.replace(/^[a-z]+:\/\/\/vsicurl\//i, "").replace(/^WMS:/i, "").replace(/^https?:\/\//, "").split(/[/?]/)[0];
const endpointOf = (u: string) => {
  const bare = u.replace(/^[a-z]+:\/\/\/vsicurl\//i, "").replace(/^WMS:/i, "");
  return bare.startsWith("http") ? bare : `https://${bare}`;
};

function openUrl(s: Source): string {
  const q = new URLSearchParams({ terrainSourceA: s.id, showHillshade: "true", viewMode: "2d" });
  if (s.bounds && s.bounds.length === 4) {
    const [w, so, e, n] = s.bounds;
    const span = Math.max(e - w, (n - so) * 1.4, 1e-4);
    const zoom = Math.max(3, Math.min(15, Math.round(Math.log2(360 / span)) + 1));
    q.set("lat", ((so + n) / 2).toFixed(4));
    q.set("lng", ((w + e) / 2).toFixed(4));
    q.set("zoom", String(zoom));
  }
  return `https://terrain-viewer.iconem.com/?${q.toString()}`;
}
function compareUrl(s: Source): string {
  const u = new URL(openUrl(s));
  u.searchParams.set("terrainSourceB", "mapterhorn");
  u.searchParams.set("splitStyle", "side-by-side");
  u.searchParams.set("gridLayout", "2x1");
  u.searchParams.set("zoom", String(Math.max(Number(u.searchParams.get("zoom") ?? 3), 13)));
  return u.toString();
}

function doiOf(s: Source): NationalRow["doi"] {
  const d = DOIS[s.id];
  if (!d) return null;
  if (d.doi) return { href: `https://doi.org/${d.doi}`, text: "DOI", title: d.citation ?? d.doi };
  if (d.mirror_doi) return { href: `https://doi.org/${d.mirror_doi}`, text: `DOI (${d.mirror_publisher ?? "copy"})`, title: `No DOI from the producer; this is the DOI of the ${d.mirror_publisher ?? "mirrored"} copy` };
  if (d.program_page && d.program_page !== s.infoUrl) return { href: d.program_page, text: "about", title: "The producer's page for this dataset (it has no DOI)" };
  return null;
}

/** DTM, DSM, nDSM, or a difference of two models (dem-diff that is not an nDSM). */
function modelOf(s: Source): NationalRow["model"] {
  if (/\bnDSM\b/.test(s.name)) return "ndsm";
  if (s.type === "dem-diff") return "diff";
  if (isSurfaceModel(s)) return "dsm";
  return "dtm";
}

function loadRows(): NationalRow[] {
  const json = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "lib", "custom-sources.json"), "utf8"));
  const sources: Source[] = json.SAMPLE_TERRAIN_SOURCES;
  const MH: Record<string, number | null> = json.MAPTERHORN_BEST_RESOLUTION_M;

  // The original's loadRows(): every "XXX - " source but the continental AFR
  // one, the site scans and the before/after event pairs.
  const withIso = sources
    .map((s) => ({ s, iso: ISO_RE.exec(s.name)?.[1] }))
    .filter((r): r is { s: Source; iso: string } =>
      Boolean(r.iso) && r.iso !== "AFR" && !PROJECT_SCANS.has(r.s.id) && !EVENT_PAIRS.test(r.s.id));
  // splitSurface(): a surface model goes to its own table when the same
  // country also has a terrain model.
  const hasTerrain = new Set(withIso.filter((r) => !isSurfaceModel(r.s)).map((r) => r.iso));

  const row = (s: Source, iso: string, category: NationalRow["category"]): NationalRow => {
    const facts = FACTS[s.id];
    const res = category === "surface" && s.resolutionM !== undefined ? `${s.resolutionM} m` : facts?.res ?? "";
    const resM = s.resolutionM ?? parseRes(facts?.res);
    const mh = iso ? MH[iso] : undefined;
    const name = s.name.replace(category === "global" ? /^Global - / : ISO_RE, "");
    const country = iso ? COUNTRY[iso] ?? iso : "";
    return {
      id: s.id,
      category,
      iso,
      country,
      name,
      label: category === "national" ? `${country} ${name}` : s.name,
      infoUrl: s.infoUrl ?? null,
      doi: doiOf(s),
      openUrl: openUrl(s),
      compareUrl: compareUrl(s),
      coverage: facts?.coverage ?? "",
      res,
      resM,
      mh: category === "global" ? null : mh ?? null,
      bucket: category === "global" ? "global" : bucketOf(resM, mh),
      bulk: s.bulkResolutionM !== undefined ? `${s.bulkResolutionM} m` : facts?.res ? "same" : "",
      serving: SERVING[s.type] ?? s.type,
      endpoint: category === "surface" && s.type === "dem-diff" ? null : { href: endpointOf(s.url), host: hostOf(s.url) },
      model: modelOf(s),
    };
  };

  const out: NationalRow[] = [];
  for (const { s, iso } of withIso) {
    const surface = isSurfaceModel(s) && hasTerrain.has(iso);
    out.push(row(s, iso, surface ? "surface" : isSubNational(s) ? "regional" : "national"));
  }
  for (const s of sources.filter((s) => s.name.startsWith("Global - "))) out.push(row(s, "", "global"));
  return out;
}

/** The library's terrain datasets (national, regional, surface models,
 *  global) as one tablecn data table. */
export function NationalDatasetsTablecn() {
  return <NationalDatasetsTablecnClient rows={loadRows()} />;
}
