'use client';
import * as React from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { NuqsAdapter } from "nuqs/adapters/react";
import references from "@/data/research-references.json";
import { openUrl, changeUrl } from "./research-references";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/hooks/use-data-table";
import { Button } from "@/components/ui/button";

// The Research References as one tablecn data table (docs/content/docs/
// resources/research-references-tablecn.mdx), the twin of the hand-written
// research-references-table.tsx for comparison. tablecn's useDataTable in
// client mode (PR #1164): TanStack Table v9 sorts, filters and paginates the
// rows in memory, nuqs keeps sort, filters and page in the query string. One
// table over every section, with Section and Group as faceted filters
// instead of one table per section.

type Ref = (typeof references)[number] & {
  group: string;
  oa_url?: string | null;
  cites?: string[];
  ran?: string[];
  focus_area?: { name: string; lat: number; lng: number; zoom: number; figure?: string | null } | null;
  change?: { id: string; range: number; lat: number; lng: number; zoom: number };
};

const SECTIONS: [string, string[]][] = [
  ["Landscape archaeology", ["Settlements under forest", "Mounds, tells and field systems", "Conflict landscapes", "Historic industry and mining"]],
  ["Earth surface processes", ["Faults and earthquakes", "Volcanoes", "Landslides and mass movements", "Glaciers and glacial landforms", "Rivers and palaeochannels", "Karst", "Dunes, coasts and permafrost", "Soils and ecology"]],
  ["Historical imagery", ["Looting, damage and threats", "Prospection with Google Earth", "Declassified CORONA imagery", "Sentinel-2 and Landsat time series"]],
  ["Methods", ["Relief visualization", "Geomorphometry"]],
  ["Elevation data", ["Global DEMs"]],
];
const SECTION_OF = new Map(SECTIONS.flatMap(([s, gs]) => gs.map((g) => [g, s] as const)));
const SECTION_RANK = new Map(SECTIONS.map(([s], i) => [s, i]));
const GROUP_RANK = new Map(SECTIONS.flatMap(([, gs]) => gs).map((g, i) => [g, i]));

// Yes/no questions about a row. tablecn's filter model has a "boolean"
// variant (eq / ne), but its toolbar renders no control for it, so each flag
// is a "select" column over "yes" | "no" with a Yes / No faceted filter.
const FLAGS = [
  { key: "app", label: "Opens in the app", test: (r: Ref) => openUrl(r as never) != null },
  { key: "lib", label: "On a library dataset", test: (r: Ref) => Boolean(r.library_id) },
  { key: "change", label: "Elevation change", test: (r: Ref) => Boolean(r.change) },
  { key: "free", label: "Free copy", test: (r: Ref) => Boolean(r.oa_url) },
  { key: "doi", label: "Has a DOI", test: (r: Ref) => Boolean(r.doi) },
  { key: "rvt", label: "Cites RVT", test: (r: Ref) => Boolean(r.cites?.includes("RVT")) },
  { key: "glo30", label: "Cites GLO-30", test: (r: Ref) => Boolean(r.cites?.includes("GLO-30")) },
  { key: "wbt", label: "Cites WBT", test: (r: Ref) => Boolean(r.cites?.includes("WBT")) },
] as const;
type FlagKey = (typeof FLAGS)[number]["key"];
type YesNo = "yes" | "no";
const flagLabel = (key: FlagKey) => FLAGS.find((f) => f.key === key)!.label;

type Row = Ref & { section: string; yearNum: number; search: string; flags: Record<FlagKey, YesNo> };

const ROWS: Row[] = (references as unknown as Ref[]).map((r) => ({
  ...r,
  section: SECTION_OF.get(r.group) ?? r.category,
  yearNum: Number(r.year) || 0,
  search: `${r.title} ${r.authors}`,
  flags: Object.fromEntries(FLAGS.map((f) => [f.key, f.test(r) ? "yes" : "no"])) as Record<FlagKey, YesNo>,
}));

const count = (pick: (r: Row) => string) => {
  const m = new Map<string, number>();
  for (const r of ROWS) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1);
  return m;
};
const SECTION_COUNT = count((r) => r.section);
const GROUP_COUNT = count((r) => r.group);
const YEARS = ROWS.map((r) => r.yearNum).filter(Boolean);
const YEAR_RANGE: [number, number] = [Math.min(...YEARS), Math.max(...YEARS)];

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
const LINK = "whitespace-nowrap rounded border border-border px-1.5 py-0.5 text-xs no-underline hover:bg-accent";
const CHIP = "rounded-full border border-border px-2 py-0.5 text-xs";
const NONE = <span className="text-muted-foreground">-</span>;

const yesNo = (key: FlagKey) => [
  { label: "Yes", value: "yes", count: ROWS.filter((r) => r.flags[key] === "yes").length },
  { label: "No", value: "no", count: ROWS.filter((r) => r.flags[key] === "no").length },
];

const col = createColumnHelper<DataTableFeatures, Row>();

const COLUMNS = col.columns([
  // Hidden: a text filter over title and authors (the toolbar's search box).
  col.accessor("search", {
    id: "search",
    header: () => null,
    meta: { label: "Search", placeholder: "Search titles and authors...", variant: "text" },
    enableColumnFilter: true,
    enableSorting: false,
    enableHiding: false,
  }),
  col.accessor("section", {
    id: "section",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Section" />,
    cell: ({ cell }) => <span className="text-xs">{cell.getValue()}</span>,
    sortFn: (a, b) => (SECTION_RANK.get(a.original.section) ?? 99) - (SECTION_RANK.get(b.original.section) ?? 99),
    meta: { label: "Section", variant: "multiSelect", options: SECTIONS.map(([s]) => ({ label: s, value: s, count: SECTION_COUNT.get(s) ?? 0 })) },
    enableColumnFilter: true,
    size: 150,
  }),
  col.accessor("group", {
    id: "group",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Group" />,
    cell: ({ cell }) => <span className="text-xs">{cell.getValue()}</span>,
    sortFn: (a, b) => (GROUP_RANK.get(a.original.group) ?? 99) - (GROUP_RANK.get(b.original.group) ?? 99),
    meta: { label: "Group", variant: "multiSelect", options: SECTIONS.flatMap(([, gs]) => gs).map((g) => ({ label: g, value: g, count: GROUP_COUNT.get(g) ?? 0 })) },
    enableColumnFilter: true,
    size: 170,
  }),
  col.accessor("yearNum", {
    id: "year",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Year" />,
    cell: ({ cell }) => <span className="tabular-nums">{cell.getValue() || "-"}</span>,
    meta: { label: "Year", variant: "range", range: YEAR_RANGE },
    enableColumnFilter: true,
    size: 80,
  }),
  col.accessor("authors", {
    id: "authors",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Authors" />,
    cell: ({ cell }) => <span className="block whitespace-normal text-xs">{cell.getValue()}</span>,
    meta: { label: "Authors" },
    size: 180,
  }),
  col.accessor("title", {
    id: "title",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Title" />,
    cell: ({ row }) => {
      const r = row.original;
      const href = r.doi ? `https://doi.org/${r.doi}` : r.oa_url ?? r.url;
      return (
        <span className="block whitespace-normal">
          <a href={href} {...ext} className="font-medium">{r.title}</a>
          {r.venue ? <span className="block text-xs text-muted-foreground"><em>{r.venue}</em></span> : null}
        </span>
      );
    },
    meta: { label: "Title" },
    size: 320,
  }),
  col.accessor("one_line", {
    id: "summary",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Description" />,
    cell: ({ cell }) => <span className="block whitespace-normal text-xs">{cell.getValue() ?? ""}</span>,
    meta: { label: "Description" },
    enableSorting: false,
    size: 320,
  }),
  col.accessor((r) => r.study_area?.name ?? "", {
    id: "area",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Study area" />,
    cell: ({ row }) => {
      const r = row.original;
      const name = r.study_area?.name;
      if (!name) return NONE;
      const open = openUrl(r as never);
      return open
        ? <a href={open} {...ext} className="block whitespace-normal text-xs" title={`Open ${name} in Terrain Viewer`}>{name}</a>
        : <span className="block whitespace-normal text-xs">{name}</span>;
    },
    meta: { label: "Study area" },
    size: 170,
  }),
  col.accessor((r) => r.flags.app, {
    id: "app",
    header: ({ column }) => <DataTableColumnHeader column={column} label="In the app" />,
    cell: ({ row }) => {
      const r = row.original;
      const open = openUrl(r as never);
      if (!open) return NONE;
      const fa = r.focus_area;
      return (
        <span className="flex flex-wrap gap-1">
          <a href={open} {...ext} className={LINK}>{fa ? "Region" : "Open"}</a>
          {fa ? <a href={openUrl(r as never, fa)!} {...ext} className={LINK} title={`${fa.name}: the site of ${fa.figure ?? "a figure"} of the paper`}>{fa.figure ?? "Site"}</a> : null}
        </span>
      );
    },
    meta: { label: "Opens in the app", variant: "select", options: yesNo("app") },
    enableColumnFilter: true,
    enableSorting: false,
    size: 110,
  }),
  col.accessor((r) => r.flags.change, {
    id: "change",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Change" />,
    cell: ({ row }) => {
      const r = row.original;
      return r.change ? <a href={changeUrl(r.change, r.study_area?.name)} {...ext} className={LINK} title="The difference of two surveys, before and after">Change</a> : NONE;
    },
    meta: { label: "Elevation change", variant: "select", options: yesNo("change") },
    enableColumnFilter: true,
    enableSorting: false,
    size: 90,
  }),
  col.accessor((r) => r.flags.free, {
    id: "free",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Free copy" />,
    cell: ({ row }) => row.original.oa_url ? <a href={row.original.oa_url} {...ext} className={LINK} title="Open-access copy">Free</a> : NONE,
    meta: { label: "Free copy", variant: "select", options: yesNo("free") },
    enableColumnFilter: true,
    enableSorting: false,
    size: 90,
  }),
  col.accessor((r) => r.flags.doi, {
    id: "doi",
    header: ({ column }) => <DataTableColumnHeader column={column} label="DOI" />,
    cell: ({ row }) => row.original.doi ? <a href={`https://doi.org/${row.original.doi}`} {...ext} className="block break-all text-xs">{row.original.doi}</a> : NONE,
    meta: { label: "Has a DOI", variant: "select", options: yesNo("doi") },
    enableColumnFilter: true,
    enableSorting: false,
    size: 150,
  }),
  col.accessor((r) => (r.cites ?? []).join(" "), {
    id: "cites",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Cites" />,
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-1">
        {(row.original.cites ?? []).map((c) => (
          <span key={c} className={CHIP} title={row.original.ran?.includes(c) ? `The full text says the study ran ${c}` : `Cites ${c}`}>
            {row.original.ran?.includes(c) ? `ran ${c}` : c}
          </span>
        ))}
      </span>
    ),
    meta: { label: "Cites" },
    enableSorting: false,
    size: 130,
  }),
  // Filter-only by default: shown as Yes / dash columns from the View menu.
  ...(["lib", "rvt", "glo30", "wbt"] as const).map((key) =>
    col.accessor((r) => r.flags[key], {
      id: key,
      header: ({ column }) => <DataTableColumnHeader column={column} label={flagLabel(key)} />,
      cell: ({ cell }) => cell.getValue() === "yes" ? <span className="text-xs">Yes</span> : NONE,
      meta: { label: flagLabel(key), variant: "select", options: yesNo(key) },
      enableColumnFilter: true,
      enableSorting: false,
      size: 110,
    }),
  ),
  col.accessor("dataset", {
    id: "data",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Data" />,
    cell: ({ cell }) => <span className="block whitespace-normal text-xs">{cell.getValue() ?? "-"}</span>,
    meta: { label: "Data" },
    enableSorting: false,
    size: 170,
  }),
  col.accessor((r) => (r.modes ?? []).join(", "), {
    id: "modes",
    header: ({ column }) => <DataTableColumnHeader column={column} label="Modes" />,
    cell: ({ cell }) => <span className="block whitespace-normal text-xs">{cell.getValue() || "-"}</span>,
    meta: { label: "Modes" },
    enableSorting: false,
    size: 150,
  }),
]);

const PAGE_SIZE = 20;

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function ReferencesTablecnInner() {
  const { table } = useDataTable({
    data: ROWS,
    columns: COLUMNS,
    mode: "client",
    initialState: {
      sorting: [{ id: "group", desc: false }, { id: "year", desc: false }],
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE },
      columnVisibility: { search: false, lib: false, rvt: false, glo30: false, wbt: false, data: false, modes: false },
    },
    getRowId: (_row, index) => String(index),
    clearOnDefault: true,
  });

  const shown = table.getFilteredRowModel().rows.length;
  const pageSize = table.atoms.pagination.get().pageSize;
  const all = pageSize >= ROWS.length;

  const csv = () => {
    const rows = table.getSortedRowModel().rows.map((row) => row.original);
    const head = ["Section", "Group", "Year", "Authors", "Title", "Venue", "DOI", "URL", "Free copy", "Study area", "Open in Terrain Viewer", "Elevation change", "Cites", "Data", "Modes", "Summary"];
    const body = rows.map((r) => [r.section, r.group, r.year, r.authors, r.title, r.venue, r.doi, r.url, r.oa_url, r.study_area?.name, openUrl(r as never), r.change ? changeUrl(r.change, r.study_area?.name) : "", (r.cites ?? []).join(" "), r.dataset, (r.modes ?? []).join(" "), r.one_line].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([head.join(",") + "\n" + body.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "terrain-viewer-research-references.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tv-wide not-prose text-sm [&_td]:align-top [&_td]:whitespace-normal">
      <DataTable table={table}>
        <DataTableToolbar table={table}>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{shown} of {ROWS.length}</span>
          <Button variant="outline" size="sm" onClick={() => table.setPageSize(all ? PAGE_SIZE : ROWS.length)}>
            {all ? `Pages of ${PAGE_SIZE}` : "Show all"}
          </Button>
          <Button variant="outline" size="sm" onClick={csv}>Export CSV</Button>
        </DataTableToolbar>
      </DataTable>
    </div>
  );
}

/** The table, with its own nuqs adapter: the plain React one, which reads
 *  window.location and writes with history.replaceState, so the static
 *  export renders the table and no Suspense fallback. */
export function ReferencesTablecn() {
  return (
    <NuqsAdapter>
      <ReferencesTablecnInner />
    </NuqsAdapter>
  );
}
