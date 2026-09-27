import references from "@/data/research-references.json";

// The research references page (docs/content/docs/resources/research-references.mdx).
// Every entry was found and its DOI or official page fetched before being
// added; the data lives in src/data/research-references.json. A case study
// with a study area gets a link that opens Terrain Viewer there, with the
// modes that match what the paper used, and on the matching library dataset
// when the app has one.

type Ref = {
  category: string;
  authors: string;
  year: number | string;
  title: string;
  venue?: string;
  doi?: string | null;
  url: string;
  dataset?: string | null;
  modes?: string[];
  study_area?: { name?: string; lat: number; lng: number; zoom: number } | null;
  library_id?: string | null;
  one_line?: string;
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
  lrm: { showReliefVisualization: "true", showLrm: "true" },
  svf: { showReliefVisualization: "true", showSvf: "true" },
  openness: { showReliefVisualization: "true", showOpenness: "true" },
  matcap: { showLightingEffects: "true", showMatcap: "true" },
  "mound detector": { tellsBeta: "true", showTerrainAnalysis: "true", showTellsDetector: "true" },
};

export function openUrl(r: Ref): string | null {
  if (!r.study_area) return null;
  const q = new URLSearchParams({
    viewMode: "2d",
    lat: r.study_area.lat.toFixed(4),
    lng: r.study_area.lng.toFixed(4),
    zoom: String(r.study_area.zoom),
  });
  if (r.library_id) q.set("terrainSourceA", r.library_id);
  // Two modes at most, so the view stays readable; hillshade underneath.
  for (const m of (r.modes ?? []).map((x) => x.toLowerCase()).filter((x) => MODE_PARAMS[x]).slice(0, 2)) {
    for (const [k, v] of Object.entries(MODE_PARAMS[m])) q.set(k, v);
  }
  if (!q.has("showHillshade")) q.set("showHillshade", "true");
  return `${APP}?${q.toString()}`;
}

const ORDER = ["Relief visualization", "Geomorphometry", "Global DEMs", "Geoarchaeology case studies"];

export function ResearchReferences({ category }: { category: string }) {
  const rows = (references as Ref[])
    .filter((r) => r.category === category)
    .sort((a, b) => Number(a.year) - Number(b.year));
  return (
    <ul>
      {rows.map((r) => {
        const open = openUrl(r);
        return (
          <li key={r.url}>
            {r.authors} ({r.year}). <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
            {r.venue ? <>. <em>{r.venue}</em></> : null}.
            {r.one_line ? <> {r.one_line}</> : null}
            {r.dataset ? <> <span className="text-fd-muted-foreground">Data: {r.dataset}.</span></> : null}
            {open ? (
              <>
                {" "}
                <a href={open} target="_blank" rel="noopener noreferrer" title={`Open ${r.study_area?.name ?? "the study area"} in Terrain Viewer`}>
                  Open {r.study_area?.name ?? "the study area"} in Terrain Viewer ↗
                </a>
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export const referenceCategories = ORDER;
