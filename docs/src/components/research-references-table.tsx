'use client';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import references from "@/data/research-references.json";
import { openUrl, changeUrl } from "./research-references";

// The Research References as tables, one per section of the page
// (docs/content/docs/resources/research-references-table.mdx), the twin of
// the sectioned page. Plain React after Iconem's open-geodata-catalog coverage
// table (tools/src/pages/coverage/DataTable.tsx): over ~120 rows in memory,
// sort and filter are a useMemo, not a table library.
//
// One filter bar (ReferencesTableControls) drives every section's table
// (ReferencesTableSection) through a small shared store, so the sections can
// sit under real MDX headings and appear in the page's table of contents. The
// view (search, sort, filters, years, columns) lives in the query string, so a
// filtered table is a link; which groups are folded is local.

type Ref = (typeof references)[number] & {
  group: string;
  oa_url?: string | null;
  cites?: string[];
  change?: { id: string; range: number; lat: number; lng: number; zoom: number };
};

const ROWS = references as unknown as Ref[];

// Sections and their groups, in the order of the sectioned page.
export const SECTIONS: [string, string[]][] = [
  ["Landscape archaeology", ["Settlements under forest", "Mounds, tells and field systems", "Conflict landscapes", "Historic industry and mining"]],
  ["Earth surface processes", ["Faults and earthquakes", "Volcanoes", "Landslides and mass movements", "Glaciers and glacial landforms", "Rivers and palaeochannels", "Karst", "Dunes, coasts and permafrost", "Soils and ecology"]],
  ["Historical imagery", ["Looting, damage and threats", "Prospection with Google Earth", "Declassified CORONA imagery", "Sentinel-2 and Landsat time series"]],
  ["Methods", ["Relief visualization", "Geomorphometry"]],
  ["Elevation data", ["Global DEMs"]],
];
const SECTION_OF = new Map(SECTIONS.flatMap(([s, gs]) => gs.map((g) => [g, s] as const)));
const GROUP_RANK = new Map(SECTIONS.flatMap(([, gs]) => gs).map((g, i) => [g, i]));
const sectionOf = (r: Ref) => SECTION_OF.get(r.group) ?? r.category;

// Yes/no filters, each one question about a row.
const FLAGS: { key: string; label: string; tip: string; test: (r: Ref) => boolean }[] = [
  { key: "app", label: "Opens in the app", tip: "Has a study area, so a link opens it in Terrain Viewer", test: (r) => openUrl(r as never) != null },
  { key: "lib", label: "On a library dataset", tip: "Opens on a national or LiDAR dataset finer than Mapterhorn there, rather than on Mapterhorn", test: (r) => Boolean(r.library_id) },
  { key: "change", label: "Elevation change", tip: "The app has a before/after difference for the event", test: (r) => Boolean(r.change) },
  { key: "free", label: "Free copy", tip: "An open-access copy exists (OpenAlex), or the paper is open access at its DOI", test: (r) => Boolean(r.oa_url) },
  { key: "doi", label: "Has a DOI", tip: "", test: (r) => Boolean(r.doi) },
  { key: "rvt", label: "Cites RVT", tip: "Cites the founding papers of the Relief Visualization Toolbox", test: (r) => Boolean(r.cites?.includes("RVT")) },
  { key: "glo30", label: "Cites GLO-30", tip: "Cites the Copernicus DEM", test: (r) => Boolean(r.cites?.includes("GLO-30")) },
];

type SortKey = "section" | "year" | "authors" | "title" | "area";
type Sort = { key: SortKey; dir: "asc" | "desc" };
const DEFAULT_SORT: Sort = { key: "section", dir: "asc" };

const COLUMNS: { key: string; title: string; sort?: SortKey; off?: boolean }[] = [
  { key: "year", title: "Year", sort: "year" },
  { key: "authors", title: "Authors", sort: "authors" },
  { key: "title", title: "Title", sort: "title" },
  { key: "summary", title: "Description" },
  { key: "area", title: "Study area", sort: "area" },
  { key: "app", title: "In the app" },
  { key: "change", title: "Change" },
  { key: "free", title: "Free copy" },
  { key: "doi", title: "DOI" },
  { key: "cites", title: "Cites" },
  { key: "group", title: "Group", off: true },
  { key: "data", title: "Data", off: true },
  { key: "modes", title: "Modes", off: true },
];
const COLUMN_KEYS = new Set(COLUMNS.map((c) => c.key));

// ---- shared store, mirrored in the URL ------------------------------------------

type State = {
  q: string;
  sort: Sort;
  sections: string[];
  groups: string[];
  flags: Record<string, "yes" | "no">;
  from: number | null;
  to: number | null;
  shown: string[];
};

const initial = (): State => ({
  q: "", sort: DEFAULT_SORT, sections: [], groups: [], flags: {}, from: null, to: null,
  shown: COLUMNS.filter((c) => !c.off).map((c) => c.key),
});
// What the static export rendered: the first client render must match it.
const SERVER_STATE = initial();

function readUrl(): State {
  const s = initial();
  const p = new URLSearchParams(window.location.search);
  s.q = p.get("q") ?? "";
  const [k, d] = (p.get("sort") ?? "").split(":");
  if (k) s.sort = { key: k as SortKey, dir: d === "desc" ? "desc" : "asc" };
  s.sections = p.get("section")?.split("|").filter(Boolean) ?? [];
  s.groups = p.get("group")?.split("|").filter(Boolean) ?? [];
  for (const f of p.get("has")?.split(",") ?? []) {
    const [key, v] = f.split(":");
    if (key && (v === "yes" || v === "no")) s.flags[key] = v;
  }
  const [lo, hi] = (p.get("years") ?? "").split("..");
  s.from = lo ? Number(lo) : null;
  s.to = hi ? Number(hi) : null;
  // Unknown keys are dropped: a link from an older layout of the table (one
  // Links column, since split in four) must not blank the link columns.
  const cols = p.get("columns")?.split(",").filter((c) => COLUMN_KEYS.has(c));
  if (cols?.length) s.shown = cols;
  return s;
}

function writeUrl(s: State) {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.sort.key !== DEFAULT_SORT.key || s.sort.dir !== DEFAULT_SORT.dir) p.set("sort", `${s.sort.key}:${s.sort.dir}`);
  if (s.sections.length) p.set("section", s.sections.join("|"));
  if (s.groups.length) p.set("group", s.groups.join("|"));
  const flags = Object.entries(s.flags).map(([k, v]) => `${k}:${v}`);
  if (flags.length) p.set("has", flags.join(","));
  if (s.from != null || s.to != null) p.set("years", `${s.from ?? ""}..${s.to ?? ""}`);
  if (s.shown.join(",") !== SERVER_STATE.shown.join(",")) p.set("columns", s.shown.join(","));
  const qs = p.toString();
  window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
}

let STATE: State = SERVER_STATE;
let fromUrl = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<State>) {
  STATE = { ...STATE, ...patch };
  writeUrl(STATE);
  emit();
}

function useTableState(): State {
  const s = useSyncExternalStore(subscribe, () => STATE, () => SERVER_STATE);
  // The URL is read once, after hydration, by whichever component mounts first.
  useEffect(() => {
    if (fromUrl) return;
    fromUrl = true;
    STATE = readUrl();
    emit();
  }, []);
  return s;
}

const HAY = ROWS.map((r) => [r.authors, r.title, r.venue, r.group, sectionOf(r), r.study_area?.name, r.dataset, r.one_line, r.doi, (r.modes ?? []).join(" ")].join(" ").toLowerCase());

/** Rows passing every filter except the section one (each table owns its section). */
function filtered(s: State): Ref[] {
  const needle = s.q.trim().toLowerCase();
  return ROWS.filter((r, i) => {
    if (needle && !HAY[i].includes(needle)) return false;
    if (s.groups.length && !s.groups.includes(r.group)) return false;
    for (const f of FLAGS) {
      const want = s.flags[f.key];
      if (want && f.test(r) !== (want === "yes")) return false;
    }
    const y = Number(r.year);
    if (s.from != null && !(y >= s.from)) return false;
    if (s.to != null && !(y <= s.to)) return false;
    return true;
  });
}

// ---- small pieces ---------------------------------------------------------------

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
const CHIP = "rounded-full border px-2 py-0.5 text-xs transition-colors";
const chip = (on: boolean) => `${CHIP} ${on ? "border-fd-primary bg-fd-primary/10 text-fd-primary" : "border-fd-border text-fd-muted-foreground hover:bg-fd-accent"}`;
const LINK = "whitespace-nowrap rounded border border-fd-border px-1.5 py-0.5 text-xs no-underline hover:bg-fd-accent";
const NONE = <span className="text-fd-muted-foreground">—</span>;

function TriState({ label, tip, value, onChange }: { label: string; tip: string; value?: "yes" | "no"; onChange: (v?: "yes" | "no") => void }) {
  // any -> yes -> no -> any
  const next = value === undefined ? "yes" : value === "yes" ? "no" : undefined;
  return (
    <button type="button" title={tip ? `${tip}. Click: any, yes, no.` : "Click: any, yes, no."} onClick={() => onChange(next)} className={chip(value !== undefined)}>
      {value === "no" ? "No " : ""}{label}{value === "yes" ? " ✓" : value === "no" ? " ✗" : ""}
    </button>
  );
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---- the filter bar ---------------------------------------------------------------

export function ReferencesTableControls() {
  const s = useTableState();
  const rows = useMemo(() => filtered(s).filter((r) => !s.sections.length || s.sections.includes(sectionOf(r))), [s]);
  const anyFilter = Boolean(s.q || s.sections.length || s.groups.length || Object.keys(s.flags).length || s.from != null || s.to != null);
  const years = ROWS.map((r) => Number(r.year)).filter(Boolean);
  const groupsShown = SECTIONS.filter(([sec]) => !s.sections.length || s.sections.includes(sec)).flatMap(([, gs]) => gs);

  const csv = () => {
    const head = ["Section", "Group", "Year", "Authors", "Title", "Venue", "DOI", "URL", "Free copy", "Study area", "Lat", "Lng", "Open in Terrain Viewer", "Elevation change", "Cites", "Data", "Modes", "Summary"];
    const body = rows.map((r) => [sectionOf(r), r.group, r.year, r.authors, r.title, r.venue, r.doi, r.url, r.oa_url, r.study_area?.name, r.study_area?.lat, r.study_area?.lng, openUrl(r as never), r.change ? changeUrl(r.change, r.study_area?.name) : "", (r.cites ?? []).join(" "), r.dataset, (r.modes ?? []).join(" "), r.one_line].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([head.join(",") + "\n" + body.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "terrain-viewer-research-references.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tv-wide not-prose flex flex-col gap-2 rounded-lg border border-fd-border bg-fd-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={s.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search authors, titles, places, data…"
          className="h-8 min-w-[14rem] flex-1 rounded-md border border-fd-border bg-fd-background px-2 text-sm outline-none focus:border-fd-primary" />
        <span className="flex items-center gap-1 text-xs text-fd-muted-foreground">
          Years
          <input type="number" value={s.from ?? ""} placeholder={String(Math.min(...years))} onChange={(e) => set({ from: e.target.value ? Number(e.target.value) : null })}
            className="h-8 w-[4.5rem] rounded-md border border-fd-border bg-fd-background px-1.5 text-sm" />
          to
          <input type="number" value={s.to ?? ""} placeholder={String(Math.max(...years))} onChange={(e) => set({ to: e.target.value ? Number(e.target.value) : null })}
            className="h-8 w-[4.5rem] rounded-md border border-fd-border bg-fd-background px-1.5 text-sm" />
        </span>
        <button type="button" onClick={csv} className={chip(false)}>Export CSV</button>
        <button type="button" disabled={!anyFilter} onClick={() => set({ q: "", sections: [], groups: [], flags: {}, from: null, to: null })} className={`${chip(false)} disabled:opacity-40`}>Clear filters</button>
        <span className="ml-auto text-xs text-fd-muted-foreground tabular-nums">{rows.length} of {ROWS.length} references</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 text-xs text-fd-muted-foreground">Has</span>
        {FLAGS.map((f) => (
          <TriState key={f.key} label={f.label} tip={f.tip} value={s.flags[f.key]}
            onChange={(v) => { const flags = { ...s.flags }; if (v) flags[f.key] = v; else delete flags[f.key]; set({ flags }); }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 text-xs text-fd-muted-foreground">Section</span>
        {SECTIONS.map(([sec]) => (
          <button key={sec} type="button" className={chip(s.sections.includes(sec))}
            onClick={() => set({ sections: s.sections.includes(sec) ? s.sections.filter((x) => x !== sec) : [...s.sections, sec], groups: [] })}>
            {sec}
          </button>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-fd-muted-foreground">Groups{s.groups.length ? ` (${s.groups.length})` : ""} and columns</summary>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-xs text-fd-muted-foreground">Group</span>
          {groupsShown.map((g) => (
            <button key={g} type="button" className={chip(s.groups.includes(g))}
              onClick={() => set({ groups: s.groups.includes(g) ? s.groups.filter((x) => x !== g) : [...s.groups, g] })}>
              {g}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-xs text-fd-muted-foreground">Columns</span>
          {COLUMNS.map((c) => (
            <button key={c.key} type="button" className={chip(s.shown.includes(c.key))}
              onClick={() => set({ shown: s.shown.includes(c.key) ? s.shown.filter((x) => x !== c.key) : COLUMNS.map((x) => x.key).filter((k) => k === c.key || s.shown.includes(k)) })}>
              {c.title}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

// ---- one section's table ------------------------------------------------------------

export function ReferencesTableSection({ section }: { section: string }) {
  const s = useTableState();
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  // The header row sticks to the top of the window, which only works while
  // nothing between it and the page scrolls. So the table scrolls sideways
  // on its own only when it is wider than the page (a phone, a narrow
  // window), and then the header scrolls away with it.
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const wrap = wrapRef.current, table = tableRef.current;
    if (!wrap || !table) return;
    const check = () => setOverflows(table.scrollWidth > wrap.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(wrap);
    ro.observe(table);
    return () => ro.disconnect();
  }, []);

  const hidden = s.sections.length > 0 && !s.sections.includes(section);
  const view = useMemo(() => {
    const dir = s.sort.dir === "asc" ? 1 : -1;
    const by: Record<SortKey, (a: Ref, b: Ref) => number> = {
      section: (a, b) => ((GROUP_RANK.get(a.group) ?? 99) - (GROUP_RANK.get(b.group) ?? 99)) || Number(a.year) - Number(b.year),
      year: (a, b) => (Number(a.year) || 0) - (Number(b.year) || 0),
      authors: (a, b) => a.authors.localeCompare(b.authors),
      title: (a, b) => a.title.localeCompare(b.title),
      area: (a, b) => (a.study_area?.name ?? "￿").localeCompare(b.study_area?.name ?? "￿"),
    };
    return filtered(s).filter((r) => sectionOf(r) === section)
      .sort((a, b) => dir * by[s.sort.key](a, b) || Number(a.year) - Number(b.year));
  }, [s, section]);

  if (hidden) return <p className="text-sm text-fd-muted-foreground">Hidden by the Section filter.</p>;

  // Group rows while ordered by group: over rows sorted by year they would
  // draw boundaries that are not there. A section with one group has none.
  const grouped = s.sort.key === "section" && new Set(view.map((r) => r.group)).size > 1;
  const counts = new Map<string, number>();
  for (const r of view) counts.set(r.group, (counts.get(r.group) ?? 0) + 1);
  const toggleFold = (k: string) => setFolded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const onHeader = (key: SortKey) =>
    set({ sort: s.sort.key !== key ? { key, dir: key === "year" ? "desc" : "asc" } : s.sort.dir === "asc" ? { key, dir: "desc" } : DEFAULT_SORT });
  const visible = COLUMNS.filter((c) => s.shown.includes(c.key));

  const cell = (r: Ref, key: string): ReactNode => {
    switch (key) {
      case "year": return <span className="tabular-nums">{r.year || "—"}</span>;
      case "authors": return <span className="block min-w-[7rem] max-w-[13rem]">{r.authors}</span>;
      case "title": return (
        <span className="block min-w-[12rem] max-w-[24rem]">
          <a href={r.url} {...ext} className="font-medium">{r.title}</a>
          {r.venue ? <span className="block text-xs text-fd-muted-foreground"><em>{r.venue}</em></span> : null}
        </span>
      );
      case "summary": return <span className="block min-w-[14rem] max-w-[28rem] text-xs">{r.one_line ?? ""}</span>;
      case "group": return <span className="text-xs">{r.group}</span>;
      case "area": return <span className="block max-w-[11rem] text-xs">{r.study_area?.name ?? "—"}</span>;
      case "app": {
        const open = openUrl(r as never);
        return open ? <a href={open} {...ext} className={LINK} title={`Open ${r.study_area?.name ?? "the study area"} in Terrain Viewer`}>Open ↗</a> : NONE;
      }
      case "change": return r.change ? <a href={changeUrl(r.change, r.study_area?.name)} {...ext} className={LINK} title="The difference of two surveys, before and after">Change ↗</a> : NONE;
      case "free": return r.oa_url ? <a href={r.oa_url} {...ext} className={LINK} title="Open-access copy">Free ↗</a> : NONE;
      case "doi": return r.doi ? <a href={`https://doi.org/${r.doi}`} {...ext} className="block max-w-[10rem] text-xs break-all" title={`doi:${r.doi}`}>{r.doi}</a> : NONE;
      case "cites": return <span className="flex flex-wrap gap-1">{(r.cites ?? []).map((c) => <span key={c} className={`${CHIP} border-fd-border`}>{c}</span>)}</span>;
      case "data": return <span className="block max-w-[14rem] text-xs">{r.dataset ?? "—"}</span>;
      case "modes": return <span className="block max-w-[12rem] text-xs">{(r.modes ?? []).join(", ") || "—"}</span>;
    }
    return null;
  };

  let lastGroup = "";
  return (
    <div ref={wrapRef} className={`tv-wide not-prose rounded-lg border border-fd-border text-sm ${overflows ? "overflow-x-auto" : ""}`}>
      <table ref={tableRef} className="w-full border-collapse text-left">
        <thead className={overflows ? "" : "sticky top-0 z-10"}>
          <tr className="bg-fd-card shadow-[0_1px_0_var(--color-fd-border)]">
            <th className="bg-fd-card px-2 py-2 text-xs font-semibold">
              <button type="button" onClick={() => onHeader("section")} title="Order by group" className="whitespace-nowrap">
                {s.sort.key === "section" ? "By group ▾" : "Group ▸"}
              </button>
            </th>
            {visible.map((c) => (
              <th key={c.key} className="border-l border-fd-border bg-fd-card px-2 py-2 text-xs font-semibold">
                {c.sort ? (
                  <button type="button" onClick={() => onHeader(c.sort!)} className="flex items-center gap-1 whitespace-nowrap">
                    {c.title}<span className="text-fd-muted-foreground">{s.sort.key === c.sort ? (s.sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                ) : c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.length === 0 ? (
            <tr><td colSpan={visible.length + 1} className="px-3 py-4 text-center text-fd-muted-foreground">No reference in this section matches these filters.</td></tr>
          ) : null}
          {view.map((r, i) => {
            const newGroup = grouped && r.group !== lastGroup;
            lastGroup = r.group;
            const isFolded = grouped && folded.has(r.group);
            return (
              <Fragment key={r.url + i}>
                {newGroup ? (
                  <tr className="bg-fd-accent/60">
                    <td colSpan={visible.length + 1} className="border-y border-fd-border p-0">
                      <button type="button" onClick={() => toggleFold(r.group)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs font-semibold">
                        <span className={`inline-block transition-transform ${folded.has(r.group) ? "" : "rotate-90"}`}>›</span>
                        {r.group}<span className="font-normal text-fd-muted-foreground">{counts.get(r.group)}</span>
                      </button>
                    </td>
                  </tr>
                ) : null}
                {isFolded ? null : (
                  <tr className="border-t border-fd-border align-top hover:bg-fd-accent/30">
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums text-fd-muted-foreground">{i + 1}</td>
                    {visible.map((c) => <td key={c.key} className="border-l border-fd-border px-2 py-1.5">{cell(r, c.key)}</td>)}
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
