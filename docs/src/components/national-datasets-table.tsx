import fs from "node:fs";
import path from "node:path";
import WORLD from "./world-110m.json";

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
  description?: string;
};

// ISO 3166-1 alpha-3 -> English short name, for the codes actually in use.
const COUNTRY: Record<string, string> = {
  AFR: "Africa (continental)", AUS: "Australia", CAN: "Canada", DEU: "Germany", SAM: "South America", AUT: "Austria", BEL: "Belgium", IDN: "Indonesia", CZE: "Czechia", ESP: "Spain", FIN: "Finland", FRA: "France",
  GBR: "United Kingdom", GRC: "Greece", ITA: "Italy", MEX: "Mexico",
  NLD: "Netherlands", NOR: "Norway", SYR: "Syria", USA: "United States",
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
  "custom-sam-anadem": { res: "30 m", coverage: "All South America, bare-earth under canopy" },
  "custom-us-3dep": { res: "1–10 m", coverage: "Nationwide incl. AK, HI, PR" },
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

// Best native resolution Mapterhorn ingests per country, read off its
// source-catalog (153 sources, 32 country groups) on 2026-09-14. null = the
// country has no entry, so Mapterhorn falls back to global GLO-30 (~30 m).
const MAPTERHORN_RES: Record<string, number | null> = {
  AUT: 1, BEL: 0.5, CAN: 2, CHE: 0.5, CYP: 1, CZE: 5, DEU: 0.25, DNK: 0.4,
  ESP: 0.5, EST: 1, FIN: 2, FRA: 0.5, GBR: 1, ISL: 10, ITA: 1, JPN: 1, LUX: 0.5,
  // NLD is AHN5 5 m in the catalogue (nlahn5lowresfilled), NOT 0.5 m; AUS is the
  // 5 m LiDAR grid; CHE is 0.5 m nationally (the 0.25 m entry is Canton Zurich only).
  LVA: 20, NLD: 5, NOR: 1, NZL: 1, POL: 1, PRT: 0.5, ROU: 0.5, RWA: 10,
  SVK: 1, SVN: 1, SWE: 1, TWN: 20, USA: 1, AUS: 5,
  MEX: null, GRC: null, SYR: null, IDN: null, SAM: null,
  // Not a country: DE Africa re-serves the same GLO-30 Mapterhorn already uses globally.
  AFR: 30,
};
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
  "custom-be-vlaanderen-dtm1", "custom-1762932753466",
]);

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
    .map(({ s, iso }) => ({ s, iso, ours: parseRes(FACTS[s.id]?.res), mh: MAPTERHORN_RES[iso] }))
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
                  <th>Endpoint</th><th>Resolution</th><th>Coverage</th><th>Mapterhorn</th>
                </tr>
              </thead>
              <tbody>
                {group.map(({ s, iso, mh }) => {
                  const facts = FACTS[s.id];
                  return (
                    <tr key={s.id}>
                      <td><code>{iso}</code></td>
                      <td>{COUNTRY[iso] ?? iso}</td>
                      <td>{s.name.replace(ISO_RE, "")}</td>
                      <td>{SERVING_LABEL(s.type)}</td>
                      <td>
                        <a href={endpointOf(s.url)} target="_blank" rel="noopener noreferrer">{hostOf(s.url)}</a>
                      </td>
                      <td>{facts?.res ?? "—"}</td>
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
              <td>{s.name.replace(ISO_RE, "")}</td>
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
        national, but each remains importable with a <code>?sourceA=&lt;id&gt;</code> link.
      </p>
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
 * Coverage diagram. Country outlines are Natural Earth 110m, Douglas-Peucker
 * simplified to ~0.55 deg and drawn in an Equal Earth projection and stored as flat integer arrays in tenths of a
 * degree — 176 rings / 2227 points / 19 KB, which is under a pixel of error at
 * this size. Covered countries are marked by their source's own declared
 * bounds, so the highlight is real data rather than a hand-coloured map.
 */
export function NationalCoverageMap() {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "..", "lib", "custom-sources.json"),
    "utf8",
  );
  const sources: Source[] = JSON.parse(raw).SAMPLE_TERRAIN_SOURCES;

  const byIso = new Map<string, [number, number, number, number]>();
  for (const s of sources) {
    const iso = ISO_RE.exec(s.name)?.[1];
    // AFR is continental Copernicus GLO-30, not a national dataset - it would
    // shade half the map and misrepresent what this chart is about.
    if (!iso || iso === "AFR" || !s.bounds || s.loadWithSamples === false) continue;
    if (!byIso.has(iso)) byIso.set(iso, s.bounds);
  }

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
  // World extent in projected units, used to fit the drawing to the viewBox.
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
  // A lat/lng box is not a rectangle once projected, so walk its edges.
  const boxPath = (b: [number, number, number, number]) => {
    const [w, s0, e, n] = b, STEP = 8;
    const pts: [number, number][] = [];
    for (let i = 0; i <= STEP; i++) pts.push(project(w + ((e - w) * i) / STEP, n));
    for (let i = 0; i <= STEP; i++) pts.push(project(e, n - ((n - s0) * i) / STEP));
    for (let i = 0; i <= STEP; i++) pts.push(project(e - ((e - w) * i) / STEP, s0));
    for (let i = 0; i <= STEP; i++) pts.push(project(w, s0 + ((n - s0) * i) / STEP));
    return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
  };

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-fd-border bg-fd-muted/20" role="img"
           aria-label="World map in Equal Earth projection showing which countries have an integrated national elevation endpoint">
        {/* borders only, no fill */}
        <g fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.5" strokeLinejoin="round">
          {(WORLD as number[][]).map((ring, i) => <path key={i} d={ringPath(ring)} />)}
        </g>
        {[...byIso.entries()].map(([iso, b]) => {
          const [cx, cy] = project((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
          return (
            <g key={iso}>
              <path d={boxPath(b)} fill="#22c55e" fillOpacity="0.45" stroke="#15803d" strokeWidth="1" />
              <text x={cx} y={cy + 3} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#052e16">{iso}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-fd-muted-foreground">
        {byIso.size} countries with an integrated national endpoint. Highlights are each source&apos;s declared
        bounding box, not exact coverage — England&apos;s dataset covers ~75% of England, and Austria&apos;s is
        Tirol only. Continental Copernicus GLO-30 is excluded; see below.
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
  { iso: "CAN", country: "Canada", product: "NRCan MRDEM-30 / CDEM", served: "Single COG",
    reason: "Usable, but an 84 GB BigTIFF in EPSG:3979 with no CORS — titiler only, not the browser reader." },
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
    reason: "Works and is keyless, but uses GSI's own signed-24-bit ×0.01 m packing — neither Terrarium nor Terrain-RGB, so it needs a bespoke protocol." },
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
