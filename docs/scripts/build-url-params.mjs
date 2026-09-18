// Generates, from the app's own source:
//   src/generated/url-params.json  - every nuqs state parameter (with the
//                                    URL spelling), the instruction
//                                    parameters, and every localStorage-
//                                    backed jotai atom
//   public/openapi.json            - the same state + instruction parameters
//                                    as one GET operation, for the Scalar
//                                    reference page (dev/url-api)
// Run before `next dev` / `next build` (see package.json). Plain regex over
// the files; an entry that does not fit the one-line
// `key: parseAsX(...).withDefault(...)` shape is skipped and counted.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const clip = (s, n = 200) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const firstSentence = (lines) => (lines.join(" ").split(/(?<=\.)\s/)[0] ?? "").trim();

// ── state parameters ──────────────────────────────────────────────────────
const viewer = read("components/TerrainViewer.tsx");
const start = viewer.indexOf("export const QUERY_STATE_PARSERS");
const block = viewer.slice(start, viewer.indexOf("\n}", start));
const urlKey = (k) => (/^source[A-H]$/.test(k) ? `terrainSource${k.slice(6)}` : k);
// Literal unions referenced by name (VIEW_MODES, APP_MODES, ...): resolved
// from a few known modules so the spec can list the allowed values.
const literalSources = ["lib/grid-layouts.ts", "components/TerrainViewer.tsx", "lib/settings-atoms.ts", "lib/terrain-types.ts", "lib/max-bounds.ts"].map(read).join("\n");
const literals = (name) => {
  if (name.trim().startsWith("[")) return name.replace(/[\[\]]/g, "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  if (!/^[A-Za-z0-9_]+$/.test(name.trim())) return null;
  name = name.trim();
  const m = new RegExp(`(?:export )?const ${name}(?:: [^=]+)? = \\[([^\\]]*)\\] as const`).exec(literalSources)
    ?? new RegExp(`(?:export )?const ${name}(?:: [^=]+)? = \\[([^\\]]*)\\]`).exec(literalSources);
  if (!m) return null;
  const values = m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  // A union assembled from other arrays ("...STANDARD_BLEND_MODES") is not
  // resolved: listed as a free string rather than a wrong enum.
  return values.some((v) => v.startsWith("...")) ? null : values;
};

const params = [];
let skipped = 0;
let pending = [];
for (const raw of block.split("\n")) {
  const line = raw.trim();
  if (line.startsWith("//")) { pending.push(line.replace(/^\/\/\s?/, "")); continue; }
  if (line === "") { pending = []; continue; }
  const m = /^([A-Za-z0-9_]+):\s*(parseAs[A-Za-z]+)(?:\(([^)]*)\))?(?:\.withDefault\((.*)\))?,?$/.exec(line);
  if (!m) { if (/^[A-Za-z0-9_]+:\s*parseAs/.test(line)) skipped++; continue; }
  const [, key, parser, arg, def] = m;
  let type = "string", enumValues = null, items = null;
  if (parser === "parseAsBoolean") type = "boolean";
  else if (parser === "parseAsFloat" || parser === "parseAsFloatPrecise") type = "number";
  else if (parser === "parseAsInteger") type = "integer";
  else if (parser === "parseAsStringLiteral") { enumValues = literals(arg); type = enumValues ? "enum" : "string"; }
  else if (parser === "parseAsArrayOf") { type = "array"; items = (arg ?? "parseAsString").replace("parseAs", "").toLowerCase(); }
  else if (parser === "parseAsColor") type = "color";
  else if (parser === "parseAsCustomRampStops") type = "ramp-stops";
  let defaultValue;
  try { defaultValue = def === undefined ? undefined : JSON.parse(def.replace(/'/g, '"')); } catch { defaultValue = def; }
  params.push({ key: urlKey(key), stateKey: key, type, items, enum: enumValues, default: defaultValue, defaultSource: def ?? "", note: clip(firstSentence(pending)) });
  pending = [];
}

// ── instruction parameters (hand-maintained: they are read ad hoc) ────────
const instructions = [
  { key: "project", type: "string", note: "A named preset from lib/projects.json: hidden panels, initial state, bundled sources." },
  { key: "terrainUrl", type: "string", note: "View A's terrain as a URL, registered under a fixed id (older form of terrainSourceA=https://…)." },
  { key: "basemapUrl", type: "string", note: "View A's basemap as a URL (older form of basemapSource=https://…)." },
  { key: "terrainType", type: "string", note: "Type of URL terrain sources (cog, terrarium, terrainrgb, wms-raw, tilejson …) instead of the {z} guess." },
  { key: "basemapType", type: "string", note: "Type of URL basemap sources (cog, tms, wms, wmts, tilejson) instead of the {z} guess." },
  { key: "viaTitiler", type: "boolean", note: "Route URL COGs through titiler (files not in Web Mercator)." },
  { key: "addSources", type: "array", items: "string", note: "Library entries (by id) made available in the BYOD lists without being selected." },
  { key: "addTerrainUrl", type: "array", items: "string", repeatable: true, note: "URL terrain sources made available without being selected (repeat the parameter)." },
  { key: "addBasemapUrl", type: "array", items: "string", repeatable: true, note: "URL basemaps made available without being selected (repeat the parameter)." },
  { key: "addOverlayUrl", type: "array", items: "string", repeatable: true, note: "URL overlays made available; overlayBasemapIds (state) turns overlays on." },
  { key: "openSections", type: "array", items: "string", note: "Sidebar sections expanded on load (general, terrainSource, hillshade, drawing …)." },
  { key: "closeSections", type: "array", items: "string", note: "Sidebar sections collapsed on load." },
  { key: "scrollTo", type: "string", note: "Section key (or element id) the side panel opens and scrolls to." },
  { key: "startTour", type: "boolean", note: "Starts the product walkthrough." },
];

// ── stored settings ───────────────────────────────────────────────────────
const atomFiles = ["lib/settings-atoms.ts", "lib/layout-constants.ts", "components/TerrainControlPanel/TerrainControlPanel.tsx", "components/TerrainControlPanel/TerraDrawSystem.tsx", "components/TerrainControlPanel/ShareSection.tsx", "components/TerrainControlPanel/bookmarks-section.tsx"];
const atoms = [];
for (const file of atomFiles) {
  let src; try { src = read(file); } catch { continue; }
  const lines = src.split("\n");
  lines.forEach((raw, i) => {
    const m = /atomWithStorage(?:<[^>]*>)?\(\s*["']([A-Za-z0-9_-]+)["']\s*,\s*(.*?)(?:,\s*undefined.*)?\)\s*$/.exec(raw.trim());
    if (!m) return;
    const notes = [];
    for (let j = i - 1; j >= 0 && lines[j].trim().startsWith("//"); j--) notes.unshift(lines[j].trim().replace(/^\/\/\s?/, ""));
    atoms.push({ file, key: m[1], default: clip(m[2], 60), note: clip(firstSentence(notes)) });
  });
}

fs.mkdirSync(path.join(process.cwd(), "src/generated"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "src/generated/url-params.json"), JSON.stringify({ generatedAt: new Date().toISOString(), skipped, params, instructions, atoms }, null, 2));

// ── OpenAPI ───────────────────────────────────────────────────────────────
const schemaOf = (p) => {
  if (p.type === "boolean") return { type: "boolean", default: p.default };
  if (p.type === "number") return { type: "number", default: p.default };
  if (p.type === "integer") return { type: "integer", default: p.default };
  if (p.type === "enum") return { type: "string", enum: p.enum, default: p.default };
  if (p.type === "array") return { type: "array", items: { type: p.items === "float" || p.items === "integer" ? "number" : "string" }, default: Array.isArray(p.default) ? p.default : [] };
  if (p.type === "color") return { type: "string", format: "color", default: p.default };
  return { type: "string", ...(typeof p.default === "string" ? { default: p.default } : {}) };
};
const toParam = (p, group) => ({
  name: p.key,
  in: "query",
  required: false,
  description: `${group}. ${p.note ?? ""}`.trim(),
  schema: schemaOf(p),
  ...(p.type === "array" ? { style: "form", explode: !!p.repeatable } : {}),
});
const openapi = {
  openapi: "3.1.0",
  info: {
    title: "terrain-viewer URL",
    version: "1",
    description: "Not an HTTP API: the viewer's URL. Every query parameter is state the app mirrors to the address bar (booleans, numbers, enums, lists) or an instruction read once on load. Lists are comma-separated unless marked repeatable.",
  },
  servers: [{ url: "https://jo-chemla.github.io/terrain-viewer" }],
  paths: {
    "/": {
      get: {
        summary: "Open the viewer",
        operationId: "openViewer",
        parameters: [...instructions.map((p) => toParam(p, "Instruction")), ...params.map((p) => toParam(p, "State"))],
        responses: { 200: { description: "The application page." } },
      },
    },
  },
};
fs.mkdirSync(path.join(process.cwd(), "public"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "public/openapi.json"), JSON.stringify(openapi, null, 2));
console.log(`url-params: ${params.length} state (${skipped} skipped), ${instructions.length} instruction, ${atoms.length} stored`);
