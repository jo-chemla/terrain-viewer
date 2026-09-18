import data from "@/generated/url-params.json";

// Reference tables from src/generated/url-params.json, which
// scripts/build-url-params.mjs writes from the app's own source before every
// docs build: every nuqs state parameter (URL spelling), the instruction
// parameters, and every localStorage-backed jotai atom.

type Param = (typeof data.params)[number];
type Instruction = (typeof data.instructions)[number];
type Atom = (typeof data.atoms)[number];

const cell = "px-2 py-1 align-top text-xs";

const typeLabel = (p: Param | Instruction) => {
  const q = p as Param;
  if (q.type === "enum" && q.enum) return `one of ${q.enum.join(" | ")}`;
  if (q.type === "array") return `list of ${q.items ?? "string"}${(p as Instruction).repeatable ? " (repeat the parameter)" : " (comma-separated)"}`;
  return q.type;
};

export function UrlParamsReference() {
  return (
    <div className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border">
      <table className="w-full text-left">
        <thead className="bg-fd-muted text-xs">
          <tr><th className={cell}>Parameter</th><th className={cell}>Type</th><th className={cell}>Default</th><th className={cell}>Note</th></tr>
        </thead>
        <tbody>
          {data.params.map((p) => (
            <tr key={p.key} className="border-t border-fd-border">
              <td className={`${cell} font-mono whitespace-nowrap`}>{p.key}</td>
              <td className={`${cell} font-mono`}>{typeLabel(p)}</td>
              <td className={`${cell} font-mono`}>{p.defaultSource}</td>
              <td className={`${cell} text-fd-muted-foreground`}>{p.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[11px] text-fd-muted-foreground">{data.params.length} parameters read from the app source at build time{data.skipped ? `; ${data.skipped} multi-line declarations not parsed` : ""}.</p>
    </div>
  );
}

export function InstructionParamsReference() {
  return (
    <div className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border">
      <table className="w-full text-left">
        <thead className="bg-fd-muted text-xs">
          <tr><th className={cell}>Parameter</th><th className={cell}>Type</th><th className={cell}>Effect</th></tr>
        </thead>
        <tbody>
          {data.instructions.map((p) => (
            <tr key={p.key} className="border-t border-fd-border">
              <td className={`${cell} font-mono whitespace-nowrap`}>{p.key}</td>
              <td className={`${cell} font-mono`}>{typeLabel(p)}</td>
              <td className={`${cell} text-fd-muted-foreground`}>{p.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StorageAtomsReference() {
  return (
    <div className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border">
      <table className="w-full text-left">
        <thead className="bg-fd-muted text-xs">
          <tr><th className={cell}>localStorage key</th><th className={cell}>Default</th><th className={cell}>Note</th><th className={cell}>Defined in</th></tr>
        </thead>
        <tbody>
          {data.atoms.map((a: Atom) => (
            <tr key={`${a.file}:${a.key}`} className="border-t border-fd-border">
              <td className={`${cell} font-mono whitespace-nowrap`}>{a.key}</td>
              <td className={`${cell} font-mono`}>{a.default}</td>
              <td className={`${cell} text-fd-muted-foreground`}>{a.note}</td>
              <td className={`${cell} font-mono text-fd-muted-foreground whitespace-nowrap`}>{a.file}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[11px] text-fd-muted-foreground">{data.atoms.length} stored settings read from the app source at build time. None is in the URL; a project export carries a curated subset.</p>
    </div>
  );
}
