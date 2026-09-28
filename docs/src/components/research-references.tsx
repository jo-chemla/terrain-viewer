import references from "@/data/research-references.json";
import datasetDois from "@/data/dataset-dois.json";

// The research references page (docs/content/docs/resources/research-references.mdx).
// Every entry was found and its DOI or official page fetched before being
// added; the data lives in src/data/research-references.json, one `group` per
// section of the page. A study with an area gets a link that opens Terrain
// Viewer there: with the modes the paper used, on the matching library dataset
// when the app has one; in historical mode for imagery studies, before and
// after side by side when the paper gives dates; and on the before/after
// difference when the library has both surveys (`change`).

type Ref = {
  category: string;
  group: string;
  authors: string;
  year: number | string;
  title: string;
  venue?: string | null;
  doi?: string | null;
  url: string;
  oa_url?: string | null;
  cites?: string[];
  dataset?: string | null;
  modes?: string[];
  study_area?: { name?: string; lat: number; lng: number; zoom: number } | null;
  library_id?: string | null;
  app_basemaps?: string[] | null;
  date_hint?: number[] | null;
  change?: { id: string; range: number; lat: number; lng: number; zoom: number };
  one_line?: string | null;
};

const APP = "https://terrain-viewer.iconem.com/";

// A paper's modes as URL parameters: each mode's section switch plus the mode.
const MODE_PARAMS: Record<string, Record<string, string>> = {
  hillshade: { showHillshade: "true" },
  slope: { showTerrainAnalysis: "true", showSlope: "true" },
  aspect: { showTerrainAnalysis: "true", showAspect: "true" },
  curvature: { showTerrainAnalysis: "true", showCurvature: "true" },
  tpi: { showTerrainAnalysis: "true", showTpi: "true" },
  roughness: { showTerrainAnalysis: "true", showRoughness: "true" },
  tri: { showTerrainAnalysis: "true", showTri: "true" },
  "local dominance": { showReliefVisualization: "true", showLocalDominance: "true" },
  shadows: { showLightingEffects: "true", showShadows: "true" },
  contours: { showContours: "true" },
  lrm: { showReliefVisualization: "true", showLrm: "true" },
  svf: { showReliefVisualization: "true", showSvf: "true" },
  openness: { showReliefVisualization: "true", showOpenness: "true" },
  matcap: { showLightingEffects: "true", showMatcap: "true" },
  "mound detector": { tellsBeta: "true", showTerrainAnalysis: "true", showTellsDetector: "true" },
};

// Every link says where it lands: the place name in the search box and the
// minimap open (?place=, ?minimapMinimized=false).
const camera = (a: { lat: number; lng: number; zoom: number; name?: string }) => {
  const q = new URLSearchParams({ viewMode: "2d", lat: a.lat.toFixed(4), lng: a.lng.toFixed(4), zoom: String(a.zoom), minimapMinimized: "false" });
  if (a.name) q.set("place", a.name);
  return q;
};

// "Today" for the recent side of a historical comparison: the build date,
// so the link asks Wayback for its newest capture.
const TODAY_MS = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);

export function openUrl(r: Ref): string | null {
  if (!r.study_area) return null;
  const q = camera(r.study_area);
  if (r.category === "Historical imagery") {
    // Always old against recent, side by side: the paper's "before" year (or
    // 2010, when Google Earth's archive thickens) on the left, today's newest
    // Wayback capture on the right.
    q.set("appMode", "historical");
    q.set("splitStyle", "side-by-side");
    const before = r.date_hint?.[0] ?? 2010;
    q.set("basemapSourceA", "historical");
    q.set("historicalActiveSourceA", before < 2014 ? "ge-historical" : "wayback");
    q.set("dateA", String(Date.UTC(before, 5, 1)));
    q.set("basemapSourceB", "historical");
    q.set("historicalActiveSourceB", "wayback");
    q.set("dateB", String(TODAY_MS));
    return `${APP}?${q.toString()}`;
  }
  if (r.library_id) q.set("terrainSourceA", r.library_id);
  // Two modes at most, so the view stays readable; hillshade underneath.
  for (const m of (r.modes ?? []).map((x) => x.toLowerCase()).filter((x) => MODE_PARAMS[x]).slice(0, 2)) {
    for (const [k, v] of Object.entries(MODE_PARAMS[m])) q.set(k, v);
  }
  if (!q.has("showHillshade")) q.set("showHillshade", "true");
  return `${APP}?${q.toString()}`;
}

// The difference of two surveys, on a diverging ramp centred on 0.
export function changeUrl(c: NonNullable<Ref["change"]>, place?: string): string {
  const q = camera({ ...c, name: place });
  q.set("terrainSourceA", c.id);
  q.set("showHillshade", "true");
  q.set("showColorRelief", "true");
  q.set("colorReliefOpacity", "0.8");
  q.set("colorRamp", "diverging-blue-white-red");
  q.set("customHypsoMinMax", "true");
  q.set("hypsoSymmetric", "true");
  q.set("minElevation", String(-c.range));
  q.set("maxElevation", String(c.range));
  return `${APP}?${q.toString()}`;
}

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

export function ResearchReferences({ group }: { group: string }) {
  const rows = (references as Ref[]).filter((r) => r.group === group).sort((a, b) => Number(a.year) - Number(b.year));
  return (
    <ul>
      {rows.map((r) => {
        const open = openUrl(r);
        const place = r.study_area?.name ?? "the study area";
        return (
          <li key={r.url}>
            {r.authors} ({r.year}). <a href={r.url} {...ext}>{r.title}</a>
            {r.venue ? <>. <em>{r.venue}</em></> : null}.
            {r.doi && !r.url.includes(r.doi) ? <> <a href={`https://doi.org/${r.doi}`} {...ext}>doi:{r.doi}</a>.</> : null}
            {r.oa_url ? <> <a href={r.oa_url} {...ext} title="An open-access copy of the paper">Free copy</a>.</> : null}
            {r.cites?.length ? <> <span className="text-fd-muted-foreground" title="Cites RVT's founding papers or the Copernicus DEM, per OpenAlex or the paper itself">[cites {r.cites.join(", ")}]</span></> : null}
            {r.one_line ? <> {r.one_line}</> : null}
            {r.dataset ? <> <span className="text-fd-muted-foreground">Data: {r.dataset}.</span></> : null}
            {open ? <> <a href={open} {...ext}>Open {place} in Terrain Viewer ↗</a></> : null}
            {r.change ? <> · <a href={changeUrl(r.change, r.study_area?.name)} {...ext}>See the elevation change ↗</a></> : null}
          </li>
        );
      })}
    </ul>
  );
}

// Dataset citations, from the same list as the National Datasets table
// (src/data/dataset-dois.json): datasets with a DOI of their own, then those
// only cited through a DOI'd copy, then the producers' pages for the rest.
type Dataset = { name: string; doi?: string | null; mirror_doi?: string | null; mirror_publisher?: string | null; citation?: string; program_page?: string | null };

const doiLink = (doi: string) => <a href={`https://doi.org/${doi}`} target="_blank" rel="noopener noreferrer">doi:{doi}</a>;

export function DatasetCitations({ kind }: { kind: "doi" | "mirror" | "page" }) {
  const all = Object.values(datasetDois as Record<string, Dataset>);
  const seen = new Set<string>();
  const rows = all.filter((d) => {
    const k = kind === "doi" ? d.doi : kind === "mirror" ? (!d.doi && d.mirror_doi) : (!d.doi && !d.mirror_doi && d.program_page);
    if (!k || seen.has(k)) return false; // DTM and DSM of one survey share a DOI or a page
    seen.add(k);
    return true;
  });
  return (
    <ul>
      {rows.map((d) => (
        <li key={d.name}>
          {kind === "page" ? (
            <><a href={d.program_page!} target="_blank" rel="noopener noreferrer">{d.name}</a>{d.citation ? <>: {d.citation}.</> : null}</>
          ) : (
            <>{d.citation || d.name}. {doiLink((kind === "doi" ? d.doi : d.mirror_doi)!)}{kind === "mirror" ? <> ({d.mirror_publisher ?? "a copy"}; producer page: <a href={d.program_page ?? "#"} target="_blank" rel="noopener noreferrer">{new URL(d.program_page ?? "https://example.org").hostname}</a>)</> : null}.</>
          )}
        </li>
      ))}
    </ul>
  );
}
