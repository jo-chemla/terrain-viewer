'use client';
import * as React from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { NuqsAdapter } from "nuqs/adapters/react";
import { ChevronUp, ChevronDown, Equal, Globe } from "lucide-react";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/hooks/use-data-table";
import { Button } from "@/components/ui/button";

// The client half of national-datasets-tablecn.tsx: tablecn's useDataTable in
// client mode over the rows the server half read from lib/custom-sources.json.
// The original page's separate tables (four Mapterhorn groups, regional,
// surface models, global) are one table here, with Category and vs Mapterhorn
// as faceted filters.

export type NationalRow = {
  id: string;
  category: "national" | "regional" | "surface" | "global";
  iso: string;
  country: string;
  name: string;
  label: string;
  infoUrl: string | null;
  doi: { href: string; text: string; title: string } | null;
  openUrl: string;
  compareUrl: string;
  coverage: string;
  res: string;
  resM: number | null;
  mh: number | null;
  bucket: "new" | "finer" | "same" | "coarser" | "global";
  bulk: string;
  serving: string;
  endpoint: { href: string; host: string } | null;
  model: "dtm" | "dsm" | "ndsm" | "diff";
};

const CATEGORIES = [
  { value: "national", label: "National" },
  { value: "regional", label: "Regional" },
  { value: "surface", label: "Surface model" },
  { value: "global", label: "Global" },
] as const;
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label])) as Record<NationalRow["category"], string>;

const BUCKETS = [
  { value: "new", label: "Not in Mapterhorn", icon: ChevronUp },
  { value: "finer", label: "Finer here", icon: ChevronUp },
  { value: "same", label: "Same as Mapterhorn", icon: Equal },
  { value: "coarser", label: "Finer in Mapterhorn", icon: ChevronDown },
  { value: "global", label: "Global (no comparison)", icon: Globe },
] as const;
const BUCKET_BY = Object.fromEntries(BUCKETS.map((b) => [b.value, b])) as Record<NationalRow["bucket"], (typeof BUCKETS)[number]>;

const MODELS = [
  { value: "dtm", label: "Terrain (DTM)" },
  { value: "dsm", label: "Surface (DSM, DOM)" },
  { value: "ndsm", label: "Height above ground (nDSM)" },
  { value: "diff", label: "Difference of two models" },
] as const;
const MODEL_LABEL = Object.fromEntries(MODELS.map((m) => [m.value, m.label])) as Record<NationalRow["model"], string>;

// Resolution classes. The values run from micrometres (a painting scan) to
// 27 km (a geoid), and tablecn's slider steps in whole units on a linear
// scale, so a range filter could not tell 0.25 m from 1 m: a faceted filter
// over classes stands in, and the column still sorts by the number.
const RES_CLASSES = [
  { value: "sub1", label: "Finer than 1 m", test: (m: number) => m < 1 },
  { value: "1", label: "1 m", test: (m: number) => m === 1 },
  { value: "1-5", label: "1 to 5 m", test: (m: number) => m > 1 && m <= 5 },
  { value: "5-10", label: "5 to 10 m", test: (m: number) => m > 5 && m <= 10 },
  { value: "10-30", label: "10 to 30 m", test: (m: number) => m > 10 && m <= 30 },
  { value: "30+", label: "Coarser than 30 m", test: (m: number) => m > 30 },
] as const;
const resClass = (m: number | null) => (m === null ? "unknown" : RES_CLASSES.find((c) => c.test(m))?.value ?? "unknown");

const rank = <T extends { value: string }>(list: readonly T[]) => new Map(list.map((x, i) => [x.value, i]));
const CATEGORY_RANK = rank(CATEGORIES);
const BUCKET_RANK = rank(BUCKETS);

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
const NONE = <span className="text-muted-foreground">-</span>;
const ICON = "inline-block size-[1em] align-[-0.125em] shrink-0";

const col = createColumnHelper<DataTableFeatures, NationalRow>();

function buildColumns(rows: NationalRow[]) {
  const count = (pick: (r: NationalRow) => string, value: string) => rows.filter((r) => pick(r) === value).length;
  const countries = [...new Set(rows.map((r) => r.country).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const servings = [...new Set(rows.map((r) => r.serving))].sort((a, b) => a.localeCompare(b));
  const resOptions = [...RES_CLASSES, { value: "unknown", label: "Not stated" }]
    .map((c) => ({ label: c.label, value: c.value, count: count((r) => resClass(r.resM), c.value) }))
    .filter((o) => o.count > 0);

  return col.columns([
    // Hidden: a text filter over code, country, dataset name and coverage.
    col.accessor((r) => `${r.iso} ${r.country} ${r.name} ${r.coverage} ${r.id}`, {
      id: "search",
      header: () => null,
      meta: { label: "Search", placeholder: "Search datasets and countries...", variant: "text" },
      enableColumnFilter: true,
      enableSorting: false,
      enableHiding: false,
    }),
    col.accessor("category", {
      id: "category",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Category" />,
      cell: ({ cell }) => <span className="text-xs">{CATEGORY_LABEL[cell.getValue()]}</span>,
      sortFn: (a, b) => (CATEGORY_RANK.get(a.original.category) ?? 9) - (CATEGORY_RANK.get(b.original.category) ?? 9),
      meta: { label: "Category", variant: "multiSelect", options: CATEGORIES.map((c) => ({ label: c.label, value: c.value, count: count((r) => r.category, c.value) })) },
      enableColumnFilter: true,
      size: 110,
    }),
    col.accessor("bucket", {
      id: "vs",
      header: ({ column }) => <DataTableColumnHeader column={column} label="vs Mapterhorn" />,
      cell: ({ cell }) => {
        const b = BUCKET_BY[cell.getValue()];
        const Icon = b.icon;
        return <span className="whitespace-nowrap text-xs"><Icon className={ICON} aria-hidden /> {b.label}</span>;
      },
      sortFn: (a, b) => (BUCKET_RANK.get(a.original.bucket) ?? 9) - (BUCKET_RANK.get(b.original.bucket) ?? 9),
      meta: { label: "vs Mapterhorn", variant: "multiSelect", options: BUCKETS.map((b) => ({ label: b.label, value: b.value, icon: b.icon, count: count((r) => r.bucket, b.value) })) },
      enableColumnFilter: true,
      size: 150,
    }),
    col.accessor("iso", {
      id: "iso",
      header: ({ column }) => <DataTableColumnHeader column={column} label="ISO A3" />,
      cell: ({ cell }) => (cell.getValue() ? <code className="text-xs">{cell.getValue()}</code> : NONE),
      meta: { label: "ISO A3" },
      size: 70,
    }),
    col.accessor("country", {
      id: "country",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Country" />,
      cell: ({ cell }) => <span className="text-xs">{cell.getValue() || "-"}</span>,
      meta: { label: "Country", variant: "multiSelect", options: countries.map((c) => ({ label: c, value: c, count: count((r) => r.country, c) })) },
      enableColumnFilter: true,
      size: 120,
    }),
    col.accessor("name", {
      id: "dataset",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Dataset" />,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="block whitespace-normal">
            {r.infoUrl ? <a href={r.infoUrl} {...ext}>{r.name}</a> : r.name}
            {r.doi ? <>{" "}<a href={r.doi.href} {...ext} title={r.doi.title} className="text-xs">{r.doi.text}</a></> : null}
          </span>
        );
      },
      meta: { label: "Dataset" },
      size: 280,
    }),
    col.display({
      id: "view",
      header: () => <span>View</span>,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="whitespace-nowrap text-xs">
            <a href={r.openUrl} {...ext} title={`Open ${r.label} alone in Terrain Viewer, with hillshade`}>Open Solo ↗</a>
            <span className="text-muted-foreground"> or</span>
            <br />
            <a href={r.compareUrl} {...ext} title={`${r.label} (left) beside Mapterhorn (right), side by side`}>vs Mapterhorn ↗</a>
          </span>
        );
      },
      meta: { label: "View" },
      size: 120,
    }),
    col.accessor("coverage", {
      id: "coverage",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Coverage" />,
      cell: ({ cell }) => <span className="block whitespace-normal text-xs">{cell.getValue() || "-"}</span>,
      meta: { label: "Coverage" },
      enableSorting: false,
      size: 220,
    }),
    col.accessor((r) => resClass(r.resM), {
      id: "res",
      header: ({ column }) => <DataTableColumnHeader column={column} label="API resolution" />,
      cell: ({ row }) => <span className="whitespace-nowrap text-xs tabular-nums">{row.original.res || "-"}</span>,
      sortFn: (a, b) => (a.original.resM ?? Infinity) - (b.original.resM ?? Infinity),
      meta: { label: "API resolution", variant: "multiSelect", options: resOptions },
      enableColumnFilter: true,
      size: 100,
    }),
    col.accessor("mh", {
      id: "mh",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Mapterhorn" />,
      cell: ({ row }) => {
        const r = row.original;
        if (r.category === "global") return NONE;
        return <span className="whitespace-nowrap text-xs tabular-nums">{r.mh === null ? "not ingested" : `${r.mh} m`}</span>;
      },
      sortFn: (a, b) => (a.original.mh ?? Infinity) - (b.original.mh ?? Infinity),
      meta: { label: "Mapterhorn" },
      size: 100,
    }),
    col.accessor("bulk", {
      id: "bulk",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Bulk download" />,
      cell: ({ cell }) => <span className="whitespace-nowrap text-xs">{cell.getValue() || "-"}</span>,
      meta: { label: "Bulk download" },
      enableSorting: false,
      size: 100,
    }),
    col.accessor("serving", {
      id: "served",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Served as" />,
      cell: ({ cell }) => <span className="text-xs">{cell.getValue()}</span>,
      meta: { label: "Served as", variant: "multiSelect", options: servings.map((s) => ({ label: s, value: s, count: count((r) => r.serving, s) })) },
      enableColumnFilter: true,
      size: 140,
    }),
    col.accessor("model", {
      id: "model",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Model" />,
      cell: ({ cell }) => <span className="text-xs">{MODEL_LABEL[cell.getValue()]}</span>,
      meta: { label: "Model", variant: "multiSelect", options: MODELS.map((m) => ({ label: m.label, value: m.value, count: count((r) => r.model, m.value) })) },
      enableColumnFilter: true,
      size: 130,
    }),
    col.accessor((r) => r.endpoint?.host ?? "", {
      id: "endpoint",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Endpoint" />,
      cell: ({ row }) => {
        const e = row.original.endpoint;
        return e ? <a href={e.href} {...ext} className="block break-all text-xs">{e.host}</a> : <span className="text-xs">derived in the browser</span>;
      },
      meta: { label: "Endpoint" },
      size: 170,
    }),
    col.accessor("id", {
      id: "sourceId",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Source id" />,
      cell: ({ cell }) => <code className="block break-all text-xs">{cell.getValue()}</code>,
      meta: { label: "Source id (?terrainSourceA=)" },
      size: 170,
    }),
  ]);
}

const PAGE_SIZE = 25;

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function Inner({ rows: input }: { rows: NationalRow[] }) {
  // The original page's order: by section, then Mapterhorn group, then code
  // and name. The default sort names the first two; the stable sort keeps the
  // rest of this order within them.
  const rows = React.useMemo(
    () => [...input].sort((a, b) =>
      (CATEGORY_RANK.get(a.category)! - CATEGORY_RANK.get(b.category)!) ||
      (BUCKET_RANK.get(a.bucket)! - BUCKET_RANK.get(b.bucket)!) ||
      a.iso.localeCompare(b.iso) || a.name.localeCompare(b.name)),
    [input],
  );
  const columns = React.useMemo(() => buildColumns(rows), [rows]);

  const { table } = useDataTable({
    data: rows,
    columns,
    mode: "client",
    initialState: {
      sorting: [{ id: "category", desc: false }, { id: "vs", desc: false }],
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE },
      columnVisibility: { search: false, model: false, sourceId: false },
    },
    getRowId: (row) => row.id,
    clearOnDefault: true,
  });

  const shown = table.getFilteredRowModel().rows.length;
  const pageSize = table.atoms.pagination.get().pageSize;
  const all = pageSize >= rows.length;

  const csv = () => {
    const out = table.getSortedRowModel().rows.map((row) => row.original);
    const head = ["Category", "vs Mapterhorn", "ISO A3", "Country", "Dataset", "Info", "DOI", "Open in Terrain Viewer", "vs Mapterhorn link", "Coverage", "API resolution", "API resolution (m)", "Mapterhorn (m)", "Bulk download", "Served as", "Model", "Endpoint", "Source id"];
    const body = out.map((r) => [
      CATEGORY_LABEL[r.category], BUCKET_BY[r.bucket].label, r.iso, r.country, r.name, r.infoUrl, r.doi?.href, r.openUrl, r.compareUrl,
      r.coverage, r.res, r.resM, r.category === "global" ? "" : r.mh ?? "not ingested", r.bulk, r.serving, MODEL_LABEL[r.model], r.endpoint?.href ?? "derived in the browser", r.id,
    ].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([head.join(",") + "\n" + body.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "terrain-viewer-national-datasets.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tv-wide not-prose text-sm [&_td]:align-top [&_td]:whitespace-normal">
      <DataTable table={table}>
        <DataTableToolbar table={table}>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{shown} of {rows.length}</span>
          <Button variant="outline" size="sm" onClick={() => table.setPageSize(all ? PAGE_SIZE : rows.length)}>
            {all ? `Pages of ${PAGE_SIZE}` : "Show all"}
          </Button>
          <Button variant="outline" size="sm" onClick={csv}>Export CSV</Button>
        </DataTableToolbar>
      </DataTable>
    </div>
  );
}

/** With its own plain React nuqs adapter, as research-references-tablecn.tsx,
 *  so the static export renders the table rather than a Suspense fallback. */
export function NationalDatasetsTablecnClient({ rows }: { rows: NationalRow[] }) {
  return (
    <NuqsAdapter>
      <Inner rows={rows} />
    </NuqsAdapter>
  );
}
