// Prepares generated/ (not tracked):
//   app-lib.mjs   the app's own catalog code, bundled for Node (app-lib.ts)
//   library.json  the terrain library and the catalogs with their extents
//
// import.meta.env is defined empty: no key from .env can reach the bundle.
// Keyed catalogs (Planet) therefore answer nothing here, which is intended.
import { build } from "esbuild"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
mkdirSync(here("./generated"), { recursive: true })

await build({
  entryPoints: [here("./app-lib.ts")],
  outfile: here("./generated/app-lib.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node20",
  tsconfig: here("../tsconfig.json"),
  logLevel: "error",
  define: { "import.meta.env": "{}" },
  loader: { ".gz": "empty", ".png": "empty", ".jpg": "empty", ".svg": "empty", ".css": "empty", ".mdx": "empty" },
})

const src = JSON.parse(readFileSync(here("../lib/custom-sources.json"), "utf8"))
const terrain = src.SAMPLE_TERRAIN_SOURCES
  // Ids made on one machine (custom-<timestamp>) and project-only entries are not library datasets.
  .filter((s) => /^custom-[a-z]/.test(s.id))
  .map((s) => ({ id: s.id, name: s.name, type: s.type, bounds: s.bounds ?? null, resolutionM: s.resolutionM ?? null, description: s.description ?? "", infoUrl: s.infoUrl ?? "" }))
writeFileSync(here("./generated/library.json"), JSON.stringify({ terrain, mapterhornBestResolutionM: src.MAPTERHORN_BEST_RESOLUTION_M }))
console.log(`generated: app-lib.mjs, library.json (${terrain.length} terrain datasets)`)
