import fs from "node:fs";
import path from "node:path";

// Reference tables generated at build time from the app's own source, so
// they cannot drift: every nuqs state parameter (components/TerrainViewer.tsx,
// QUERY_STATE_PARSERS, with the URL spelling from lib/url-keys.ts) and every
// localStorage-backed jotai atom (atomWithStorage across lib/ and
// components/). Both are plain regex passes over the files: an entry that
// does not fit the one-line `key: parseAsX(...).withDefault(...)` shape is
// listed with what could be read of it.

const ROOT = path.resolve(process.cwd(), "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Param = { key: string; type: string; def: string; note: string };

function stateParams(): Param[] {
  const src = read("components/TerrainViewer.tsx");
  const start = src.indexOf("export const QUERY_STATE_PARSERS");
  const end = src.indexOf("\n}", start);
  const block = src.slice(start, end);
  // URL spelling: lib/url-keys.ts renames source{A..H} -> terrainSource{A..H}.
  const urlKey = (k: string) => (/^source[A-H]$/.test(k) ? `terrainSource${k.slice(6)}` : k);
  const out: Param[] = [];
  let pending: string[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("//")) { pending.push(line.replace(/^\/\/\s?/, "")); continue; }
    const m = /^([A-Za-z0-9_]+):\s*(parseAs[A-Za-z]+)(?:\(([^)]*)\))?(?:\.withDefault\((.*)\))?,?$/.exec(line);
    if (!m) { if (line === "") pending = []; continue; }
    const [, key, parser, arg, def] = m;
    const type =
      parser === "parseAsBoolean" ? "boolean"
      : parser === "parseAsFloat" || parser === "parseAsFloatPrecise" ? "number"
      : parser === "parseAsInteger" ? "integer"
      : parser === "parseAsString" ? "string"
      : parser === "parseAsStringLiteral" ? `one of ${arg}`
      : parser === "parseAsArrayOf" ? `list of ${(arg ?? "").replace("parseAs", "").toLowerCase()} (comma-separated)`
      : parser === "parseAsColor" ? "color (hex)"
      : parser === "parseAsCustomRampStops" ? "colour ramp stops"
      : parser.replace("parseAs", "");
    // The comment directly above an entry, first sentence only.
    const note = pending.join(" ").split(/(?<=\.)\s/)[0] ?? "";
    out.push({ key: urlKey(key), type, def: def ?? "", note: note.length > 160 ? note.slice(0, 157) + "…" : note });
    pending = [];
  }
  return out;
}

type Atom = { file: string; key: string; def: string; note: string };

function storageAtoms(): Atom[] {
  const files = ["lib/settings-atoms.ts", "lib/layout-constants.ts", "components/TerrainControlPanel/TerrainControlPanel.tsx", "components/TerrainControlPanel/TerraDrawSystem.tsx", "components/TerrainControlPanel/ShareSection.tsx", "components/TerrainControlPanel/bookmarks-section.tsx", "lib/coverage-overlays.ts"];
  const out: Atom[] = [];
  for (const file of files) {
    let src: string;
    try { src = read(file); } catch { continue; }
    const lines = src.split("\n");
    lines.forEach((raw, i) => {
      const m = /atomWithStorage(?:<[^>]*>)?\(\s*["']([A-Za-z0-9_-]+)["']\s*,\s*(.*?)(?:,\s*undefined.*)?\)\s*$/.exec(raw.trim());
      if (!m) return;
      const notes: string[] = [];
      for (let j = i - 1; j >= 0 && lines[j].trim().startsWith("//"); j--) notes.unshift(lines[j].trim().replace(/^\/\/\s?/, ""));
      const note = notes.join(" ").split(/(?<=\.)\s/)[0] ?? "";
      out.push({ file, key: m[1], def: m[2].length > 60 ? m[2].slice(0, 57) + "…" : m[2], note: note.length > 160 ? note.slice(0, 157) + "…" : note });
    });
  }
  return out;
}

const cell = "px-2 py-1 align-top text-xs";

export function UrlParamsReference() {
  const params = stateParams();
  return (
    <div className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border">
      <table className="w-full text-left">
        <thead className="bg-fd-muted text-xs">
          <tr><th className={cell}>Parameter</th><th className={cell}>Type</th><th className={cell}>Default</th><th className={cell}>Note</th></tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.key} className="border-t border-fd-border">
              <td className={`${cell} font-mono whitespace-nowrap`}>{p.key}</td>
              <td className={`${cell} font-mono`}>{p.type}</td>
              <td className={`${cell} font-mono`}>{p.def}</td>
              <td className={`${cell} text-fd-muted-foreground`}>{p.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[11px] text-fd-muted-foreground">{params.length} parameters, read from the app source at build time.</p>
    </div>
  );
}

export function StorageAtomsReference() {
  const atoms = storageAtoms();
  return (
    <div className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border">
      <table className="w-full text-left">
        <thead className="bg-fd-muted text-xs">
          <tr><th className={cell}>localStorage key</th><th className={cell}>Default</th><th className={cell}>Note</th><th className={cell}>Defined in</th></tr>
        </thead>
        <tbody>
          {atoms.map((a) => (
            <tr key={`${a.file}:${a.key}`} className="border-t border-fd-border">
              <td className={`${cell} font-mono whitespace-nowrap`}>{a.key}</td>
              <td className={`${cell} font-mono`}>{a.def}</td>
              <td className={`${cell} text-fd-muted-foreground`}>{a.note}</td>
              <td className={`${cell} font-mono text-fd-muted-foreground whitespace-nowrap`}>{a.file}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[11px] text-fd-muted-foreground">{atoms.length} stored settings, read from the app source at build time. None of these is in the URL; a project export carries a curated subset.</p>
    </div>
  );
}
